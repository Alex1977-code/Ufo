// Rendering-Kern: WebGL2-Renderer, Post-Processing (Bloom, Tonemapping, GTAO) und
// Super-Resolution-Upscaling: temporal (DLSS-2/FSR-2-artig, Jitter + History) oder
// räumlich (FSR-1-artig) – jeweils mit dynamischer Auflösung.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { clamp } from './util.js';

// Qualitätsstufen analog zu DLSS / FSR (Anteil der Ausgabeauflösung pro Achse)
export const UPSCALE_MODES = {
  native: { label: 'Nativ (DLAA)', scale: 1.0 },
  quality: { label: 'Qualität', scale: 0.77 },
  balanced: { label: 'Ausgewogen', scale: 0.67 },
  performance: { label: 'Leistung', scale: 0.58 },
  ultra: { label: 'Ultra-Leistung', scale: 0.5 },
};

// Kantenrekonstruktion + kontrastadaptives Nachschärfen (angelehnt an FSR 1 EASU/RCAS)
const SuperResShader = {
  uniforms: {
    tDiffuse: { value: null },
    srcSize: { value: new THREE.Vector2(1, 1) },
    sharpness: { value: 0.6 },
    enabled: { value: 1.0 },
    time: { value: 0 },
    vignette: { value: 0.35 },
    grain: { value: 0.025 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 srcSize; uniform float sharpness; uniform float enabled;
    uniform float time; uniform float vignette; uniform float grain;
    varying vec2 vUv;
    vec3 tap(vec2 p) { return texture2D(tDiffuse, p).rgb; }
    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
    // Vignette und Filmkorn erst NACH der Rekonstruktion in Ausgabeauflösung
    vec4 grade(vec3 c) {
      vec2 d = vUv - 0.5;
      c *= 1.0 - vignette * dot(d, d) * 1.6;
      c += (hash(gl_FragCoord.xy) - 0.5) * grain;
      return vec4(c, 1.0);
    }
    void main() {
      vec2 px = 1.0 / srcSize;
      if (enabled < 0.5) { gl_FragColor = grade(tap(vUv)); return; }
      // Kantenrichtungs-gesteuerte Rekonstruktion: Gradient bestimmen und entlang der Kante filtern
      vec3 c = tap(vUv);
      vec3 n = tap(vUv + vec2(0.0, px.y)), s = tap(vUv - vec2(0.0, px.y));
      vec3 e = tap(vUv + vec2(px.x, 0.0)), w = tap(vUv - vec2(px.x, 0.0));
      float ln = luma(n), ls = luma(s), le = luma(e), lw = luma(w), lc = luma(c);
      vec2 grad = vec2(le - lw, ln - ls);
      float g = length(grad);
      vec3 rec = c;
      if (g > 0.02) {
        vec2 dir = normalize(vec2(-grad.y, grad.x)) * px * 0.75;
        rec = (tap(vUv + dir) + tap(vUv - dir) + c * 2.0) * 0.25;
      }
      // RCAS: kontrastadaptives Schärfen, begrenzt durch lokale Min/Max (kein Überschwingen)
      vec3 mn = min(min(n, s), min(min(e, w), c));
      vec3 mx = max(max(n, s), max(max(e, w), c));
      vec3 amp = clamp(min(mn, 1.0 - mx) / max(mx, 1e-4), 0.0, 1.0);
      amp = sqrt(amp);
      vec3 wgt = -amp * mix(0.125, 0.2, sharpness);
      vec3 sharp = (rec + (n + s + e + w) * wgt) / (1.0 + 4.0 * wgt);
      sharp = clamp(sharp, mn, mx);
      gl_FragColor = grade(mix(rec, sharp, clamp(sharpness * 1.4, 0.0, 1.0)));
    }`,
};

// ---------------------------------------------------------------------------
// Temporale Super-Resolution (TSR, DLSS-2/FSR-2-artig, eigene Umsetzung):
// Jede interne Bildaufnahme wird per Halton(2,3)-Subpixel-Jitter leicht versetzt
// gerendert. Ein History-Puffer in AUSGABEauflösung sammelt die Abtastwerte über
// mehrere Bilder; Kamerabewegung wird aus Tiefenpuffer + vorheriger/aktueller
// View-Projection reprojiziert, YCoCg-Varianz-Clipping verhindert Geisterbilder.
// Danach RCAS-Schärfen + Filmkorn/Vignette in Ausgabeauflösung.
// ---------------------------------------------------------------------------
const FSQ_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const TSRResolveShader = {
  uniforms: {
    tColor: { value: null },
    tDepth: { value: null },
    tHistory: { value: null },
    srcSize: { value: new THREE.Vector2(1, 1) },
    dstSize: { value: new THREE.Vector2(1, 1) },
    jitter: { value: new THREE.Vector2() },
    curInvVP: { value: new THREE.Matrix4() },
    prevVP: { value: new THREE.Matrix4() },
    historyValid: { value: 0 },
    maxAccum: { value: 12 },
  },
  vertexShader: FSQ_VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tHistory;
    uniform vec2 srcSize; uniform vec2 dstSize; uniform vec2 jitter;
    uniform mat4 curInvVP; uniform mat4 prevVP;
    uniform float historyValid; uniform float maxAccum;
    varying vec2 vUv;
    vec3 toYCoCg(vec3 c) { return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25))); }
    vec3 fromYCoCg(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
    // Catmull-Rom-History-Abtastung mit 5 bilinearen Taps (schärfer als bilinear, weniger Verwischen über die Zeit)
    vec4 historyCR(vec2 uv) {
      vec2 sp = uv * dstSize;
      vec2 t1 = floor(sp - 0.5) + 0.5;
      vec2 f = sp - t1;
      vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
      vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
      vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
      vec2 w3 = f * f * (-0.5 + 0.5 * f);
      vec2 w12 = w1 + w2;
      vec2 t0 = (t1 - 1.0) / dstSize, t3 = (t1 + 2.0) / dstSize, t12 = (t1 + w2 / w12) / dstSize;
      vec4 r = texture2D(tHistory, vec2(t12.x, t0.y)) * (w12.x * w0.y)
             + texture2D(tHistory, vec2(t0.x, t12.y)) * (w0.x * w12.y)
             + texture2D(tHistory, t12) * (w12.x * w12.y)
             + texture2D(tHistory, vec2(t3.x, t12.y)) * (w3.x * w12.y)
             + texture2D(tHistory, vec2(t12.x, t3.y)) * (w12.x * w3.y);
      float ws = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
      return max(r / ws, vec4(0.0));
    }
    // Clipping der History in Richtung Box-Mitte (Varianz-Box im YCoCg-Raum)
    vec3 clipBox(vec3 h, vec3 mn, vec3 mx) {
      vec3 c = 0.5 * (mx + mn);
      vec3 e = 0.5 * (mx - mn) + 1e-4;
      vec3 v = h - c;
      vec3 a = abs(v / e);
      float m = max(a.x, max(a.y, a.z));
      return m > 1.0 ? c + v / m : h;
    }
    void main() {
      vec2 jUv = jitter / srcSize;               // Versatz der Geometrie im internen Bild (UV)
      vec2 srcPos = (vUv + jUv) * srcSize - 0.5; // Ausgabepixel im internen Pixelraster
      vec2 base = floor(srcPos + 0.5);
      vec2 scaleOut = dstSize / srcSize;         // Abstände in Ausgabepixeln gewichten
      vec3 sum = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0);
      float wsum = 0.0, wMax = 0.0;
      float dMin = 2.0; vec2 dUv = (base + 0.5) / srcSize;
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 idx = base + vec2(float(x), float(y));
          vec2 suv = (idx + 0.5) / srcSize;
          vec3 c = toYCoCg(texture2D(tColor, suv).rgb);
          vec2 d = (idx - srcPos) * scaleOut;
          float w = exp(-2.29 * dot(d, d));
          sum += c * w; wsum += w; wMax = max(wMax, w);
          m1 += c; m2 += c * c;
          if (x * y != 0 || (x == 0 && y == 0)) {   // nächstliegende Tiefe (Kreuz-X) für Bewegungsvektor
            float z = texture2D(tDepth, suv).x;
            if (z < dMin) { dMin = z; dUv = suv; }
          }
        }
      }
      vec3 cur = sum / max(wsum, 1e-5);
      // Bewegungsvektor aus Tiefe + Kameramatrizen (statische Geometrie)
      vec2 sUv = dUv - jUv;
      vec4 wp = curInvVP * vec4(sUv * 2.0 - 1.0, min(dMin, 1.0) * 2.0 - 1.0, 1.0);
      wp /= wp.w;
      vec4 pc = prevVP * wp;
      vec2 prevUv = pc.xy / max(abs(pc.w), 1e-6) * 0.5 + 0.5;
      vec2 hUv = vUv - (sUv - prevUv);
      float valid = historyValid * step(0.0, pc.w);
      valid *= step(0.0, hUv.x) * step(hUv.x, 1.0) * step(0.0, hUv.y) * step(hUv.y, 1.0);
      vec4 hist = historyCR(hUv);
      vec3 h = toYCoCg(hist.rgb);
      float accum = hist.a * valid;
      // Varianz-Clipping
      vec3 mean = m1 / 9.0;
      vec3 sigma = sqrt(max(m2 / 9.0 - mean * mean, 0.0));
      float mpx = length((sUv - prevUv) * dstSize);
      float gamma = mix(1.25, 0.85, clamp(mpx / 6.0, 0.0, 1.0));
      vec3 hc = clipBox(h, mean - gamma * sigma, mean + gamma * sigma);
      // Starke Korrektur = Verdeckung/bewegtes Objekt -> History schneller verwerfen
      float rej = clamp(length(hc - h) * 6.0, 0.0, 1.0);
      accum *= 1.0 - 0.8 * rej;
      accum = min(accum, mix(maxAccum, 3.0, clamp(mpx / 24.0, 0.0, 1.0)));
      float alpha = wMax / (accum + wMax);
      vec3 res = valid > 0.5 ? mix(hc, cur, alpha) : cur;
      gl_FragColor = vec4(max(fromYCoCg(res), vec3(0.0)), min(accum + wMax, maxAccum));
    }`,
};

// RCAS-Schärfen + Vignette/Filmkorn in Ausgabeauflösung (nach der Akkumulation, nicht in die History)
const TSRFinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    dstSize: { value: new THREE.Vector2(1, 1) },
    sharpness: { value: 0.5 },
    time: { value: 0 },
    vignette: { value: 0.35 },
    grain: { value: 0.025 },
  },
  vertexShader: FSQ_VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 dstSize; uniform float sharpness;
    uniform float time; uniform float vignette; uniform float grain;
    varying vec2 vUv;
    vec3 tap(vec2 p) { return texture2D(tDiffuse, p).rgb; }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
    void main() {
      vec2 px = 1.0 / dstSize;
      vec3 c = tap(vUv);
      vec3 n = tap(vUv + vec2(0.0, px.y)), s = tap(vUv - vec2(0.0, px.y));
      vec3 e = tap(vUv + vec2(px.x, 0.0)), w = tap(vUv - vec2(px.x, 0.0));
      vec3 mn = min(min(n, s), min(min(e, w), c));
      vec3 mx = max(max(n, s), max(max(e, w), c));
      vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, 1e-4), 0.0, 1.0));
      vec3 wgt = -amp * mix(0.04, 0.2, sharpness);
      vec3 col = clamp((c + (n + s + e + w) * wgt) / (1.0 + 4.0 * wgt), mn, mx);
      col = mix(c, col, clamp(sharpness * 1.6, 0.0, 1.0));
      vec2 d = vUv - 0.5;
      col *= 1.0 - vignette * dot(d, d) * 1.6;
      col += (hash(gl_FragCoord.xy) - 0.5) * grain;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const mkMat = (sh) => new THREE.ShaderMaterial({
  uniforms: THREE.UniformsUtils.clone(sh.uniforms), vertexShader: sh.vertexShader, fragmentShader: sh.fragmentShader,
  depthTest: false, depthWrite: false, blending: THREE.NoBlending,
});

// Szenen-Pass für TSR: rendert in ein eigenes Ziel mit Tiefentextur (ohne MSAA, TSR glättet)
// und kopiert die Farbe in den Composer-Puffer. Die Tiefe bleibt so für die Reprojektion erhalten.
class TSRScenePass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
    this.scene = null; this.camera = null;
    this.rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(2, 2) });
    this.copy = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } }, vertexShader: FSQ_VERT,
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }',
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    }));
  }
  setSize(w, h) { this.rt.setSize(Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h))); }
  render(renderer, writeBuffer, readBuffer) {
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, this.camera);
    this.copy.material.uniforms.tDiffuse.value = this.rt.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    this.copy.render(renderer);
  }
  dispose() { this.rt.dispose(); this.copy.dispose(); }
}

// Akkumulation in Ausgabeauflösung + finales Schärfen
class TSRResolvePass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
    this.depthTexture = null;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.history = [new THREE.WebGLRenderTarget(2, 2, opts), new THREE.WebGLRenderTarget(2, 2, opts)];
    this.idx = 0;
    this.resolveMat = mkMat(TSRResolveShader);
    this.finalMat = mkMat(TSRFinalShader);
    this.fsq = new FullScreenQuad(this.resolveMat);
  }
  setOutputSize(w, h) {
    for (const rt of this.history) rt.setSize(w, h);
    this.resolveMat.uniforms.dstSize.value.set(w, h);
    this.finalMat.uniforms.dstSize.value.set(w, h);
  }
  render(renderer, writeBuffer, readBuffer) {
    const prev = this.history[this.idx], cur = this.history[1 - this.idx];
    const u = this.resolveMat.uniforms;
    u.tColor.value = readBuffer.texture;
    u.tDepth.value = this.depthTexture;
    u.tHistory.value = prev.texture;
    this.fsq.material = this.resolveMat;
    renderer.setRenderTarget(cur);
    this.fsq.render(renderer);
    this.finalMat.uniforms.tDiffuse.value = cur.texture;
    this.fsq.material = this.finalMat;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsq.render(renderer);
    this.idx = 1 - this.idx;
  }
  dispose() { for (const rt of this.history) rt.dispose(); this.resolveMat.dispose(); this.finalMat.dispose(); this.fsq.dispose(); }
}

// Umgebungsverdeckung (GTAO aus three r170): ohne Partikel/Transparentes im G-Buffer,
// ohne erneutes Schattenkarten-Rendern, optional halbe Auflösung.
class AOPass extends GTAOPass {
  constructor(scene, camera) {
    super(scene, camera, 64, 64);
    this.resScale = 1;
  }
  setSize(w, h) {
    this._fullW = w; this._fullH = h;
    super.setSize(Math.max(1, Math.floor(w * this.resScale)), Math.max(1, Math.floor(h * this.resScale)));
  }
  overrideVisibility() {
    const cache = this._visibilityCache;
    this.scene.traverse((o) => {
      cache.set(o, o.visible);
      if (o.isPoints || o.isLine || o.isSprite) { o.visible = false; return; }
      if (o.isMesh) {
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (!m || m.transparent || m.depthWrite === false || m.visible === false || o.userData?.noAO) o.visible = false;
      }
    });
  }
  renderOverride(renderer, ...args) {
    const au = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    try { super.renderOverride(renderer, ...args); } finally { renderer.shadowMap.autoUpdate = au; }
  }
}

function halton(i, b) {
  let f = 1, r = 0;
  while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); }
  return r;
}

export const UPSCALERS = {
  temporal: { label: 'Temporal (DLSS-artig)', short: 'TSR' },
  spatial: { label: 'Räumlich (FSR1-artig)', short: 'Räumlich' },
};

export class Engine {
  constructor(container, settings) {
    this.container = container;
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);

    const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.tsrScene = new TSRScenePass();
    this.tsrScene.scene = this.scene; this.tsrScene.camera = this.camera;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.82);
    this.output = new OutputPass();
    this.superRes = new ShaderPass(SuperResShader);
    this.tsr = new TSRResolvePass();
    this.tsr.depthTexture = this.tsrScene.rt.depthTexture;
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.tsrScene);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
    this.composer.addPass(this.superRes);
    this.composer.addPass(this.tsr);
    this.ao = null; // GTAO wird erst bei Bedarf erzeugt
    this.aoActive = false;

    // TSR-Zustand
    this.tsrSupported = this.probeTSR();
    this.tsrFailed = false;
    this.method = 'spatial';
    this._jitterIndex = 0;
    this._historyValid = false;
    this._tsrFrames = 0;
    this._prevVP = new THREE.Matrix4();
    this._curVP = new THREE.Matrix4();
    this._savedP = new THREE.Matrix4();
    this._savedPI = new THREE.Matrix4();
    this._jm = new THREE.Matrix4();
    this._prevFwd = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._jCam = null;
    this._jitterOn = false;

    this.dynScale = 1; // Faktor der dynamischen Auflösung
    this.fpsSamples = [];
    this.peakFps = 30; // gemessene maximale Bildrate (≈ Bildwiederholrate des Displays)
    this.goodWindows = 0;
    this.pendingResize = false;
    this.fps = 60;
    this.frameMs = 16;
    this.lastResize = 0;
    this.time = 0;
    this.active = null; // aktiver Spielmodus {scene, camera, update(dt)}
    this._last = performance.now();
    this.onFrame = null;
    this.applySettings();
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
    this.resize();
  }

  // Prüft, ob Float-Renderziele mit Tiefentextur verfügbar sind (sonst räumlicher Fallback)
  probeTSR() {
    try {
      const r = this.renderer, gl = r.getContext();
      if (!(gl instanceof WebGL2RenderingContext)) return false;
      if (!r.extensions.has('EXT_color_buffer_float') && !r.extensions.has('EXT_color_buffer_half_float')) return false;
      const probe = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(4, 4) });
      r.setRenderTarget(probe);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      r.setRenderTarget(null);
      probe.dispose();
      return ok;
    } catch {
      return false;
    }
  }

  get internalScale() {
    const mode = UPSCALE_MODES[this.settings.upscale] || UPSCALE_MODES.quality;
    let s = mode.scale;
    if (this.settings.dynamicRes && this.settings.upscale !== 'native') s *= this.dynScale;
    return clamp(s, 0.33, 1);
  }

  // Anzeigename des aktiven Verfahrens (für Leistungsanzeige/Einstellungen)
  get methodLabel() {
    const fb = (this.settings.upscaler || 'temporal') === 'temporal' && this.method !== 'temporal' ? ' (Fallback)' : '';
    return (UPSCALERS[this.method] || UPSCALERS.spatial).short + fb + (this.aoActive ? ` · AO ${this.settings.ao === 'high' ? 'hoch' : 'niedrig'}` : '');
  }

  applySettings() {
    const s = this.settings;
    this.bloom.enabled = s.bloom;
    const vig = s.filmGrain ? 0.35 : 0, grain = s.filmGrain ? 0.025 : 0;
    this.superRes.uniforms.vignette.value = vig;
    this.superRes.uniforms.grain.value = grain;
    this.superRes.uniforms.sharpness.value = s.sharpness;
    const fu = this.tsr.finalMat.uniforms;
    fu.vignette.value = vig; fu.grain.value = grain; fu.sharpness.value = s.sharpness;
    this.shadowSize = s.shadows === 'high' ? 2048 : s.shadows === 'med' ? 1024 : 512;
    this.configurePipeline();
    this.resize();
  }

  // Wählt temporalen oder räumlichen Weg und schaltet AO je nach Szene/Einstellung
  configurePipeline() {
    const s = this.settings;
    const temporal = (s.upscaler || 'temporal') === 'temporal' && this.tsrSupported && !this.tsrFailed;
    const method = temporal ? 'temporal' : 'spatial';
    if (method !== this.method) {
      this.method = method;
      // TSR braucht kein MSAA (Jitter + Akkumulation glätten); räumlich behält 4× MSAA
      const samples = temporal ? 0 : 4;
      for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
        if (rt.samples !== samples) { rt.samples = samples; rt.dispose(); }
      }
      this.resetHistory();
    }
    this.renderPass.enabled = !temporal;
    this.superRes.enabled = !temporal;
    this.tsrScene.enabled = temporal;
    this.tsr.enabled = temporal;

    // Umgebungsverdeckung: nur wenn die Szene es will (mode.ao oder Bodenkampf mit units)
    const m = this.active;
    const wants = !!m && (m.ao === true || (m.ao !== false && Array.isArray(m.units)));
    const level = s.ao === 'high' || s.ao === 'low' ? s.ao : 'off';
    const on = wants && level !== 'off';
    if (on && !this.ao) {
      try {
        this.ao = new AOPass(m.scene, m.camera);
        this.ao.updateGtaoMaterial({ radius: 1.8, distanceExponent: 1.5, thickness: 2.5, distanceFallOff: 1, scale: 1.6 });
        this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6 });
        this.composer.insertPass(this.ao, this.composer.passes.indexOf(this.tsrScene) + 1);
        this._aoLevel = null;
      } catch (e) {
        console.warn('AEGIS: Umgebungsverdeckung nicht verfügbar', e);
        this.ao = null;
      }
    }
    if (this.ao) {
      this.ao.enabled = on;
      if (m) {
        this.ao.scene = m.scene; this.ao.camera = m.camera;
        const persp = m.camera.isPerspectiveCamera ? 1 : 0;
        if (this.ao.gtaoMaterial.defines.PERSPECTIVE_CAMERA !== persp) {
          this.ao.gtaoMaterial.defines.PERSPECTIVE_CAMERA = persp;
          this.ao.gtaoMaterial.needsUpdate = true;
        }
      }
      if (on && this._aoLevel !== level) {
        this._aoLevel = level;
        const high = level === 'high';
        this.ao.resScale = high ? 1 : 0.5;
        this.ao.updateGtaoMaterial({ samples: high ? 16 : 8 });
        this.ao.updatePdMaterial({ samples: high ? 16 : 8, rings: 2, radiusExponent: 2 });
        if (this.ao._fullW) this.ao.setSize(this.ao._fullW, this.ao._fullH);
      }
    }
    this.aoActive = !!(this.ao && on);
  }

  // History verwerfen (Moduswechsel, Größenänderung, Kamerasprung, Verfahrenswechsel)
  resetHistory() {
    this._historyValid = false;
    this._jCam = null;
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, this.settings.maxDpr || 2);
    const outW = Math.floor(w * dpr), outH = Math.floor(h * dpr);
    if (outW !== this.outW || outH !== this.outH) this.resetHistory();
    this.outW = outW;
    this.outH = outH;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, true);
    const scale = this.internalScale;
    // Interne Renderauflösung niedriger, finaler Pass skaliert auf volle Ausgabeauflösung hoch
    this.composer.setPixelRatio(dpr * scale);
    this.composer.setSize(w, h);
    this.internalW = this.composer.renderTarget1.width | 0;
    this.internalH = this.composer.renderTarget1.height | 0;
    this.superRes.uniforms.srcSize.value.set(this.internalW, this.internalH);
    this.superRes.uniforms.enabled.value = scale < 0.999 ? 1.0 : 0.0;
    // History liegt in Ausgabeauflösung – dynamische Auflösung verwirft sie daher nicht
    this.tsr.setOutputSize(this.outW, this.outH);
    this.tsr.resolveMat.uniforms.srcSize.value.set(this.tsrScene.rt.width, this.tsrScene.rt.height);
    this.pendingResize = false;
    this.lastResize = performance.now();
    if (this.active?.camera) {
      this.active.camera.aspect = w / h;
      this.active.camera.updateProjectionMatrix();
    }
    this.active?.onResize?.(w, h);
  }

  setMode(mode) {
    this.active = mode;
    const scene = mode ? mode.scene : this.scene, camera = mode ? mode.camera : this.camera;
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.tsrScene.scene = scene;
    this.tsrScene.camera = camera;
    this.resetHistory();
    this.configurePipeline();
    this.resize();
  }

  // Subpixel-Jitter (Halton 2,3) auf die Projektionsmatrix legen; unverjitterte Matrizen merken
  beginJitter() {
    const cam = this.active.camera, u = this.tsr.resolveMat.uniforms;
    cam.updateMatrixWorld();
    this._curVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    cam.getWorldDirection(this._fwd);
    // Kamerawechsel oder harter Schnitt (große Drehung) -> History verwerfen
    if (this._jCam !== cam || this._fwd.dot(this._prevFwd) < 0.7) this._historyValid = false;
    this._jCam = cam;
    this._prevFwd.copy(this._fwd);
    const iw = this.tsrScene.rt.width, ih = this.tsrScene.rt.height;
    const ratio = Math.max(this.outW / iw, this.outH / ih);
    const phases = clamp(Math.ceil(8 * ratio * ratio), 8, 32);
    this._jitterIndex = (this._jitterIndex % phases) + 1;
    const jx = halton(this._jitterIndex, 2) - 0.5, jy = halton(this._jitterIndex, 3) - 0.5;
    this._savedP.copy(cam.projectionMatrix);
    this._savedPI.copy(cam.projectionMatrixInverse);
    this._jm.makeTranslation(2 * jx / iw, 2 * jy / ih, 0);
    cam.projectionMatrix.premultiply(this._jm);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    this._jitterOn = true;
    u.jitter.value.set(jx, jy);
    u.srcSize.value.set(iw, ih);
    u.curInvVP.value.copy(this._curVP).invert();
    u.prevVP.value.copy(this._historyValid ? this._prevVP : this._curVP);
    u.historyValid.value = this._historyValid ? 1 : 0;
    // Szenen ohne vollständige Tiefe (Globus-Atmosphäre, Menü) bekommen kürzere History
    const m = this.active;
    u.maxAccum.value = typeof m.tsrHistory === 'number' ? m.tsrHistory : Array.isArray(m.units) ? 12 : 7;
  }

  endJitter() {
    if (!this._jitterOn) return;
    const cam = this._jCam;
    cam.projectionMatrix.copy(this._savedP);
    cam.projectionMatrixInverse.copy(this._savedPI);
    this._prevVP.copy(this._curVP);
    this._jitterOn = false;
  }

  // Bei Shader-/Framebuffer-Problemen still auf den räumlichen Weg zurückfallen
  checkTSRHealth() {
    try {
      for (const mat of [this.tsr.resolveMat, this.tsr.finalMat, this.tsrScene.copy.material]) {
        const prog = this.renderer.properties.get(mat).currentProgram;
        if (prog?.diagnostics && prog.diagnostics.runnable === false) return false;
      }
      const gl = this.renderer.getContext();
      this.renderer.setRenderTarget(this.tsr.history[0]);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      this.renderer.setRenderTarget(null);
      return ok;
    } catch {
      return false;
    }
  }

  tsrFallback(err) {
    console.warn('AEGIS: Temporales Upscaling nicht verfügbar – räumlicher Fallback aktiv.', err || '');
    this.tsrFailed = true;
    this.configurePipeline();
    this.resize();
  }

  // Dynamische Auflösung: hält Ziel-FPS durch Anpassung der internen Renderauflösung
  updateDynamicRes(dt) {
    this.fpsSamples.push(dt);
    if (this.fpsSamples.length < 30) return;
    const samples = this.fpsSamples.slice();
    this.fpsSamples.length = 0;
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    this.fps = 1 / avg;
    this.frameMs = avg * 1000;
    // Fenster mit Ausreißern (Shader-Kompilierung, Moduswechsel, Tab im Hintergrund) ignorieren
    if (samples.some((s) => s >= 0.09)) return;
    this.peakFps = Math.max(this.peakFps * 0.995, this.fps);
    if (!this.settings.dynamicRes || this.settings.upscale === 'native') return;
    // Ziel nie über der tatsächlich erreichbaren Bildwiederholrate
    const target = Math.min(this.settings.targetFps || 60, this.peakFps * 0.97);
    if (performance.now() - this.lastResize < 600) return;
    let ns = this.dynScale;
    if (this.fps < target * 0.88) { ns -= 0.08; this.goodWindows = 0; }
    else if (this.fps > target * 0.97) { if (++this.goodWindows >= 4 && ns < 1) { ns += 0.05; this.goodWindows = 0; } }
    else this.goodWindows = 0;
    ns = Math.round(clamp(ns, 0.6, 1) * 100) / 100;
    if (ns !== this.dynScale) { this.dynScale = ns; this.resize(); }
  }

  renderFrame(dt) {
    this.superRes.uniforms.time.value = this.time % 100;
    this.tsr.finalMat.uniforms.time.value = this.time % 100;
    const temporal = this.method === 'temporal' && !!this.active.camera;
    if (!temporal) { this.composer.render(dt); return; }
    try {
      this.beginJitter();
      this.composer.render(dt);
    } catch (e) {
      this.endJitter();
      this.tsrFallback(e);
      return;
    }
    this.endJitter();
    this._historyValid = true;
    if (++this._tsrFrames === 3 && !this.checkTSRHealth()) this.tsrFallback();
  }

  start() {
    const loop = (now) => {
      requestAnimationFrame(loop);
      let dt = (now - this._last) / 1000;
      this._last = now;
      if (dt > 0.1) dt = 0.1;
      if (this.paused) return;
      this.time += dt;
      this.updateDynamicRes(dt);
      this.onFrame?.(dt);
      if (this.active) {
        this.active.update?.(dt);
        this.renderFrame(dt);
      }
    };
    requestAnimationFrame(loop);
  }
}

// Gemeinsamer Generator für Canvas-Texturen
export function canvasTexture(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = opts.wrap === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
