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
import { SSRPass } from 'three/addons/postprocessing/SSRPass.js';
import { clamp, isTouchDevice } from './util.js';
import { anyModalOpen } from './ui.js';

// Qualitätsstufen analog zu DLSS / FSR (Anteil der Ausgabeauflösung pro Achse)
export const UPSCALE_MODES = {
  native: { label: 'Nativ (DLAA)', scale: 1.0 },
  quality: { label: 'Qualität', scale: 0.77 },
  balanced: { label: 'Ausgewogen', scale: 0.67 },
  performance: { label: 'Leistung', scale: 0.58 },
  ultra: { label: 'Ultra-Leistung', scale: 0.5 },
};

// ---------------------------------------------------------------------------
// Tonemapping / Farbstimmung / Schatten (Einstellungen toneMap, grading, shadowFilter, ssr)
// ---------------------------------------------------------------------------
export const TONEMAPS = {
  agx: { label: 'AgX', tm: THREE.AgXToneMapping, exposure: 1.1 },
  aces: { label: 'ACES', tm: THREE.ACESFilmicToneMapping, exposure: 1.0 },
  neutral: { label: 'Neutral', tm: THREE.NeutralToneMapping, exposure: 0.95 },
};

// Farbstimmung im End-Shader (Ausgabeauflösung, nach Tonemapping, sRGB-Werte 0..1)
export const GRADINGS = {
  neutral: { label: 'Neutral', on: 0 },
  filmic: {
    label: 'Filmisch', on: 1, lift: [0.004, 0.007, 0.014], gamma: [1.0, 1.0, 1.0], gain: [1.02, 1.0, 0.975],
    sat: 1.1, con: 0.2, shadowTint: [-0.012, 0.0, 0.016], highTint: [0.018, 0.006, -0.016],
  },
  vivid: {
    label: 'Kräftig', on: 1, lift: [0.0, 0.002, 0.008], gamma: [1.0, 1.0, 1.02], gain: [1.04, 1.01, 0.98],
    sat: 1.3, con: 0.32, shadowTint: [-0.016, 0.0, 0.022], highTint: [0.024, 0.008, -0.02],
  },
};

const GRADE_UNIFORMS = () => ({
  gOn: { value: 0 }, gLift: { value: new THREE.Vector3() }, gGamma: { value: new THREE.Vector3(1, 1, 1) }, gGain: { value: new THREE.Vector3(1, 1, 1) },
  gSat: { value: 1 }, gCon: { value: 0 }, gShadowTint: { value: new THREE.Vector3() }, gHighTint: { value: new THREE.Vector3() },
});
const GRADE_GLSL = /* glsl */ `
    uniform float gOn; uniform vec3 gLift; uniform vec3 gGamma; uniform vec3 gGain;
    uniform float gSat; uniform float gCon; uniform vec3 gShadowTint; uniform vec3 gHighTint;
    // Lift/Gamma/Gain, Kontrast-S-Kurve, Sättigung, Split-Toning (kühle Schatten, warme Lichter)
    vec3 colorGrade(vec3 c) {
      if (gOn < 0.5) return c;
      c = clamp(c, 0.0, 1.0);
      c = gGain * (c + gLift * (1.0 - c));
      c = pow(max(c, vec3(0.0)), 1.0 / gGamma);
      c = mix(c, c * c * (3.0 - 2.0 * c), gCon);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, gSat);
      float lw = smoothstep(0.0, 1.0, l);
      c += gShadowTint * (1.0 - lw) * (1.0 - lw) + gHighTint * lw * lw;
      return clamp(c, 0.0, 1.0);
    }`;

// Bloom nur für HDR-Spitzen: weicher Schwellwert („soft knee“) – nur der Anteil ÜBER dem Schwellwert blüht,
// helle (diffus beleuchtete) Wände knapp über 1.0 tragen praktisch nichts bei.
const BLOOM_HIGHPASS_FRAG = /* glsl */ `
    uniform sampler2D tDiffuse; uniform float luminosityThreshold; uniform float smoothWidth;
    varying vec2 vUv;
    void main() {
      vec3 c = min(texture2D(tDiffuse, vUv).rgb, vec3(64.0));
      float br = max(c.r, max(c.g, c.b));
      float knee = max(smoothWidth, 1e-4);
      float soft = clamp(br - luminosityThreshold + knee, 0.0, 2.0 * knee);
      soft = soft * soft / (4.0 * knee);
      float w = max(soft, br - luminosityThreshold) / max(br, 1e-4);
      gl_FragColor = vec4(c * w, 1.0);
    }`;

// PCSS (Kontaktschatten, nach dem three-Beispiel webgl_shadowmap_pcss, MIT) als Ersatz des PCF-Zweigs in
// getShadow(): Blocker-Suche → Halbschattenbreite aus Tiefendifferenz → Poisson-PCF. Aktiv nur mit
// renderer.shadowMap.type === PCFShadowMap (PCFSoft/VSM unverändert). light.shadow.radius skaliert die Weichheit.
const PCSS_GLSL = /* glsl */ `
	#if defined( SHADOWMAP_TYPE_PCF )
	#define AEGIS_PCSS_BLOCKER 12
	#define AEGIS_PCSS_PCF 20
	#define AEGIS_PCSS_SEARCH 10.0
	#define AEGIS_PCSS_SOFTNESS 500.0
	vec2 aegisDisk( int i, int n, float a0 ) {
		float r = sqrt( ( float( i ) + 0.5 ) / float( n ) );
		float a = a0 + float( i ) * 2.39996323;
		return vec2( cos( a ), sin( a ) ) * r;
	}
	float aegisPCSS( sampler2D shadowMap, vec2 shadowMapSize, float shadowRadius, vec4 sc ) {
		vec2 texel = 1.0 / shadowMapSize;
		float a0 = rand( sc.xy ) * PI2;
		float blk = 0.0, nb = 0.0;
		for ( int i = 0; i < AEGIS_PCSS_BLOCKER; i ++ ) {
			float d = unpackRGBAToDepth( texture2D( shadowMap, sc.xy + aegisDisk( i, AEGIS_PCSS_BLOCKER, a0 ) * texel * AEGIS_PCSS_SEARCH ) );
			if ( d < sc.z ) { blk += d; nb += 1.0; }
		}
		if ( nb < 0.5 ) return 1.0;
		blk /= nb;
		float pen = clamp( ( sc.z - blk ) * AEGIS_PCSS_SOFTNESS * max( shadowRadius, 0.05 ), 1.0, AEGIS_PCSS_SEARCH );
		float s = 0.0;
		for ( int i = 0; i < AEGIS_PCSS_PCF; i ++ ) {
			s += texture2DCompare( shadowMap, sc.xy + aegisDisk( i, AEGIS_PCSS_PCF, a0 + 1.3 ) * texel * pen, sc.z );
		}
		return s / float( AEGIS_PCSS_PCF );
	}
	#endif
`;
function installPCSS() {
  try {
    const SC = THREE.ShaderChunk;
    let s = SC.shadowmap_pars_fragment;
    if (s.includes('aegisPCSS')) return true;
    const a = '\tfloat getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {';
    const b = '\t\t#if defined( SHADOWMAP_TYPE_PCF )\n\t\t\tvec2 texelSize = vec2( 1.0 ) / shadowMapSize;';
    if (!s.includes(a) || !s.includes(b)) return false;
    s = s.replace(a, PCSS_GLSL + a);
    s = s.replace(b, '\t\t#if defined( SHADOWMAP_TYPE_PCF )\n\t\t\tshadow = aegisPCSS( shadowMap, shadowMapSize, shadowRadius, shadowCoord );\n\t\t#elif 0\n\t\t\tvec2 texelSize = vec2( 1.0 ) / shadowMapSize;');
    SC.shadowmap_pars_fragment = s;
    return true;
  } catch {
    return false;
  }
}
export const PCSS_AVAILABLE = installPCSS();

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
    ...GRADE_UNIFORMS(),
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 srcSize; uniform float sharpness; uniform float enabled;
    uniform float time; uniform float vignette; uniform float grain;
    varying vec2 vUv;${GRADE_GLSL}
    vec3 tap(vec2 p) { return texture2D(tDiffuse, p).rgb; }
    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
    // Vignette und Filmkorn erst NACH der Rekonstruktion in Ausgabeauflösung
    vec4 grade(vec3 c) {
      c = colorGrade(c);
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
    ...GRADE_UNIFORMS(),
  },
  vertexShader: FSQ_VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 dstSize; uniform float sharpness;
    uniform float time; uniform float vignette; uniform float grain;
    varying vec2 vUv;${GRADE_GLSL}
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
      col = colorGrade(col);
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

// OutputPass mit Belichtungsfaktor (Tonemapper-Abgleich × mode.exposure), renderer.toneMappingExposure bleibt unberührt
class GradedOutputPass extends OutputPass {
  constructor() { super(); this.exposureScale = 1; }
  render(renderer, writeBuffer, readBuffer, dt, mask) {
    const e = renderer.toneMappingExposure;
    renderer.toneMappingExposure = e * this.exposureScale;
    try { super.render(renderer, writeBuffer, readBuffer, dt, mask); } finally { renderer.toneMappingExposure = e; }
  }
}

// Bildschirmraum-Spiegelungen (three SSRPass) in interner Auflösung, ersetzt den Szenen-Pass
// (rendert Farbe + Tiefe selbst; die Tiefe dient dann auch der TSR-Reprojektion).
// Ohne mode.ssrSelects spiegeln nur glatte PBR-Materialien, gewichtet nach Rauheit/Metall
// (material.userData.ssr = 0..1 überschreibt das); mit mode.ssrSelects (Mesh-Liste) wie im three-Original.
const SSR_AUTO = [];
const ssrHidden = (o) => o.isPoints || o.isLine || o.isSprite;
class SceneSSRPass extends SSRPass {
  constructor(o) {
    super(o);
    this.ssrMaterial.defines.MAX_STEP = Math.round(clamp(Math.hypot(o.width, o.height) * 0.4, 96, 320));
    // 24-Bit-Tiefe statt 16 Bit: dient auch der TSR-Reprojektion (16 Bit erzeugt Streifen in der Ferne)
    this.beautyRenderTarget.depthTexture.type = THREE.UnsignedIntType;
    // Maskenwert (0..1) als Reflexionsstärke statt nur Ja/Nein
    this.ssrMaterial.fragmentShader = this.ssrMaterial.fragmentShader.replace('gl_FragColor.a=op;', '#ifdef SELECTIVE\n op*=metalness;\n #endif\n gl_FragColor.a=op;');
    this.ssrMaterial.needsUpdate = true;
    this._levels = Array.from({ length: 8 }, (_, i) => new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar((i + 1) / 8) }));
    this.selects = SSR_AUTO;
  }
  get autoSelect() { return this._selects === SSR_AUTO; }
  maskFor(mat) {
    const m = Array.isArray(mat) ? mat[0] : mat;
    if (!m || m.transparent || m.visible === false || !m.isMeshStandardMaterial) return this.metalnessOffMaterial;
    let r = m.userData?.ssr;
    if (typeof r !== 'number') r = clamp((0.5 - m.roughness) / 0.45, 0, 1) * (0.55 + 0.45 * m.metalness);
    const i = Math.round(clamp(r, 0, 1) * 8) - 1;
    return i < 0 ? this.metalnessOffMaterial : this._levels[i];
  }
  dispose() { super.dispose(); for (const m of this._levels) m.dispose(); }
  render(renderer, writeBuffer, readBuffer, dt, mask) {
    const cam = this.camera, u = this.ssrMaterial.uniforms, d = this.ssrMaterial.defines;
    // Matrizen jedes Bild übernehmen (Jitter, Zoom, Seitenverhältnis)
    u.cameraProjectionMatrix.value.copy(cam.projectionMatrix);
    u.cameraInverseProjectionMatrix.value.copy(cam.projectionMatrixInverse);
    u.cameraNear.value = cam.near; u.cameraFar.value = cam.far;
    const persp = !!cam.isPerspectiveCamera;
    if (('PERSPECTIVE_CAMERA' in d) !== persp) {
      if (persp) d.PERSPECTIVE_CAMERA = true; else delete d.PERSPECTIVE_CAMERA;
      this.ssrMaterial.needsUpdate = true;
    }
    super.render(renderer, writeBuffer, readBuffer, dt, mask);
  }
  // Hilfsdurchläufe (Normalen/Reflexionsmaske) ohne erneutes Schattenkarten-Rendern, ohne Punkte/Linien/Sprites
  _aux(renderer, fn) {
    const au = renderer.shadowMap.autoUpdate, hidden = [];
    renderer.shadowMap.autoUpdate = false;
    this.scene.traverseVisible((o) => { if (ssrHidden(o)) hidden.push(o); });
    for (const o of hidden) o.visible = false;
    try { fn(); } finally {
      for (const o of hidden) o.visible = true;
      renderer.shadowMap.autoUpdate = au;
    }
  }
  renderOverride(renderer, ...args) { this._aux(renderer, () => super.renderOverride(renderer, ...args)); }
  renderMetalness(renderer, overrideMaterial, renderTarget, clearColor, clearAlpha) {
    if (!this.autoSelect) { this._aux(renderer, () => super.renderMetalness(renderer, overrideMaterial, renderTarget, clearColor, clearAlpha)); return; }
    this._aux(renderer, () => {
      const scene = this.scene, bg = scene.background, fog = scene.fog, ac = renderer.autoClear;
      this.originalClearColor.copy(renderer.getClearColor(this.tempColor));
      const ca = renderer.getClearAlpha();
      renderer.setRenderTarget(renderTarget);
      renderer.autoClear = false;
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      scene.background = null; scene.fog = null;
      const swapped = [];
      const tinted = [];
      scene.traverseVisible((o) => {
        if (!o.isMesh) return;
        swapped.push(o, o.material); o.material = this.maskFor(o.material);
        if (o.instanceColor) { tinted.push(o, o.instanceColor); o.instanceColor = null; } // Maske nicht einfärben
      });
      try { renderer.render(scene, this.camera); } finally {
        for (let i = 0; i < swapped.length; i += 2) swapped[i].material = swapped[i + 1];
        for (let i = 0; i < tinted.length; i += 2) tinted[i].instanceColor = tinted[i + 1];
        scene.background = bg; scene.fog = fog;
        renderer.autoClear = ac;
        renderer.setClearColor(this.originalClearColor, ca);
      }
    });
  }
}

function halton(i, b) {
  let f = 1, r = 0;
  while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); }
  return r;
}

// Energiesparen: Leerlauf-Drosselung (Bilder pro Sekunde) und Schwellen
const IDLE_AFTER_MS = 8000;  // so lange ohne Eingabe, bevor gedrosselt werden darf
const CALM_HOLD_MS = 600;    // Szene muss so lange ruhig sein (Hysterese)
const IDLE_FPS = 12;         // gedrosselte Rate, solange die TSR-History noch konvergiert
const STILL_FPS = 5;         // Update-Rate, wenn das Standbild fertig ist (kein Rendern mehr)

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
    this.mobile = isTouchDevice() && Math.min(screen.width, screen.height) < 900;
    this.renderer.toneMapping = THREE.AgXToneMapping;
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
    // Bloom: nur HDR-Spitzen (> 1.0, weiches Knie) – Emissionen/Spitzlichter, keine hellen Wände
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.45, 1.0);
    this.bloom.highPassUniforms.smoothWidth.value = 0.5;
    this.bloom.materialHighPassFilter.fragmentShader = BLOOM_HIGHPASS_FRAG;
    this.bloom.materialHighPassFilter.needsUpdate = true;
    this.output = new GradedOutputPass();
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
    this.ssr = null; // Spiegelungen (SSR) werden erst bei Bedarf erzeugt
    this.ssrActive = false;
    this._shadowKey = '';
    this._shadowVer = 0;

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
    // Energiesparen / Bildratenlimit
    this.renderCount = 0;     // tatsächlich gerenderte Bilder (für Messungen)
    this.updateCount = 0;     // verarbeitete Bilder (Update ausgeführt)
    this.powerState = 'full'; // 'full' | 'idle' | 'still' | 'paused' | 'hidden'
    this._nextDue = 0;
    this._lastInput = performance.now();
    this._calmSince = performance.now();
    this._camMoved = true;
    this._stillFrames = 0;
    this._jitterPhases = 8;
    this._camSig = new Float64Array(32);
    this._skipSample = false;
    this._padSeen = false;
    this._hidden = typeof document !== 'undefined' && !!document.hidden;
    this._raf = 0;
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
    return (UPSCALERS[this.method] || UPSCALERS.spatial).short + fb + (this.aoActive ? ` · AO ${this.settings.ao === 'high' ? 'hoch' : 'niedrig'}` : '') + (this.ssrActive ? ' · SSR' : '');
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
    // Tonemapping (OutputPass liest renderer.toneMapping) + sRGB-Ausgabe
    const tm = TONEMAPS[s.toneMap] || TONEMAPS.agx;
    this.renderer.toneMapping = tm.tm;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this._tmExposure = tm.exposure;
    // Farbstimmung
    const g = GRADINGS[s.grading] || GRADINGS.filmic;
    for (const u of [this.superRes.uniforms, fu]) {
      u.gOn.value = g.on;
      if (!g.on) continue;
      u.gLift.value.fromArray(g.lift); u.gGamma.value.fromArray(g.gamma); u.gGain.value.fromArray(g.gain);
      u.gSat.value = g.sat; u.gCon.value = g.con;
      u.gShadowTint.value.fromArray(g.shadowTint); u.gHighTint.value.fromArray(g.highTint);
    }
    this.applyShadowFilter();
    this.configurePipeline();
    this.resize();
    this.wake();
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
    this.superRes.enabled = !temporal;
    this.tsr.enabled = temporal;

    // Spiegelungen (SSR): nur Desktop, Einstellung an UND Szene will es (mode.ssr === true)
    const m = this.active;
    const ssrOn = !!m && m.ssr === true && s.ssr === true && !this.mobile && !this._ssrFailed;
    if (ssrOn && !this.ssr) {
      try {
        const w = Math.max(2, this.internalW || 2), h = Math.max(2, this.internalH || 2);
        this.ssr = new SceneSSRPass({ renderer: this.renderer, scene: m.scene, camera: m.camera, width: w, height: h, selects: null });
        this.ssr.blur = true;
        this.composer.insertPass(this.ssr, this.composer.passes.indexOf(this.tsrScene) + 1);
      } catch (e) {
        console.warn('AEGIS: Spiegelungen (SSR) nicht verfügbar', e);
        this.ssr = null; this._ssrFailed = true;
      }
    }
    if (this.ssr) {
      this.ssr.enabled = ssrOn;
      if (m) {
        this.ssr.scene = m.scene; this.ssr.camera = m.camera;
        this.ssr.selects = Array.isArray(m.ssrSelects) ? m.ssrSelects : SSR_AUTO;
        this.ssr.opacity = typeof m.ssrOpacity === 'number' ? m.ssrOpacity : 0.5;
        if (typeof m.ssrMaxDistance === 'number') this.ssr.maxDistance = m.ssrMaxDistance;
        if (typeof m.ssrThickness === 'number') this.ssr.thickness = m.ssrThickness;
      }
    }
    const ssrActive = !!(this.ssr && ssrOn);
    if (ssrActive !== this.ssrActive) this.resetHistory();
    this.ssrActive = ssrActive;
    this.renderPass.enabled = !temporal && !ssrActive;
    this.tsrScene.enabled = temporal && !ssrActive;
    this.tsr.depthTexture = ssrActive ? this.ssr.beautyRenderTarget.depthTexture : this.tsrScene.rt.depthTexture;

    // Umgebungsverdeckung: nur wenn die Szene es will (mode.ao oder Bodenkampf mit units)
    const wants = !!m && (m.ao === true || (m.ao !== false && Array.isArray(m.units)));
    const level = s.ao === 'high' || s.ao === 'low' ? s.ao : 'off';
    const on = wants && level !== 'off';
    if (on && !this.ao) {
      try {
        this.ao = new AOPass(m.scene, m.camera);
        this.ao.updateGtaoMaterial({ radius: 1.8, distanceExponent: 1.5, thickness: 2.5, distanceFallOff: 1, scale: 1.6 });
        this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6 });
        this.composer.insertPass(this.ao, this.composer.passes.indexOf(this.ssr || this.tsrScene) + 1);
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

  // Schattenqualität: off | pcf (weich, PCFSoft) | vsm (sehr weich) | pcss (Kontaktschatten, nur Desktop)
  get shadowFilter() {
    let f = this.settings.shadowFilter || 'pcf';
    if (f === 'pcss' && (this.mobile || !PCSS_AVAILABLE)) f = 'pcf';
    return ['off', 'pcf', 'vsm', 'pcss'].includes(f) ? f : 'pcf';
  }

  applyShadowFilter() {
    const f = this.shadowFilter, sm = this.renderer.shadowMap;
    const type = f === 'vsm' ? THREE.VSMShadowMap : f === 'pcss' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    const enabled = f !== 'off';
    const key = `${enabled}|${type}`;
    if (key === this._shadowKey) return;
    const first = !this._shadowKey;
    this._shadowKey = key;
    sm.enabled = enabled;
    sm.type = type;
    sm.needsUpdate = true;
    this._shadowVer++;
    if (!first) {
      // Programme hängen vom Schattentyp ab -> Materialien der aktiven Szene neu kompilieren
      if (this.active?.scene) this.refreshMaterials(this.active.scene);
      this.resetHistory();
    }
  }

  // Materialien neu kompilieren (Schattentyp/-modus gewechselt) und Schattenparameter je Typ setzen.
  // Modi rufen das nicht selbst auf: setMode() und applySettings() erledigen es für die aktive Szene.
  refreshMaterials(root) {
    const seen = new Set();
    this.applyShadowParams(root);
    root.traverse((o) => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : null;
      if (mats) for (const m of mats) if (m && !seen.has(m)) { seen.add(m); m.needsUpdate = true; }
    });
    root.userData.__shadowVer = this._shadowVer;
  }

  // Schattenparameter je Filtertyp (VSM: Weichzeichnungsradius; light.userData.vsmRadius überschreibt)
  applyShadowParams(root) {
    const vsm = this.renderer.shadowMap.type === THREE.VSMShadowMap;
    root.traverse((o) => {
      if (!(o.isLight && o.shadow && o.castShadow)) return;
      if (o.userData.__shadowRadius0 === undefined) o.userData.__shadowRadius0 = o.shadow.radius;
      if (vsm) { o.shadow.radius = o.userData.vsmRadius ?? 3; o.shadow.blurSamples = 10; }
      else o.shadow.radius = o.userData.__shadowRadius0;
      o.shadow.needsUpdate = true;
    });
  }

  // History verwerfen (Moduswechsel, Größenänderung, Kamerasprung, Verfahrenswechsel)
  resetHistory() {
    this._historyValid = false;
    this._jCam = null;
    this._stillFrames = 0; // Standbild muss neu aufgebaut werden
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
    this._stillFrames = 0; // Zeichenpuffer wurde geleert -> neu rendern
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
    // Szene wurde mit anderem Schattentyp kompiliert (Einstellung während eines anderen Modus geändert)
    const sv = scene.userData.__shadowVer;
    if (sv !== undefined && sv !== this._shadowVer) this.refreshMaterials(scene);
    else { scene.userData.__shadowVer = this._shadowVer; this.applyShadowParams(scene); }
    this.resetHistory();
    this.configurePipeline();
    this.resize();
    this.wake();
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
    this._jitterPhases = phases;
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
  // adjust=false: nur messen (Leerlauf-Drosselung ist kein „langsames“ Gerät)
  updateDynamicRes(dt, adjust = true) {
    if (this._skipSample) { this._skipSample = false; return; } // Lücke beim Zustandswechsel
    this.fpsSamples.push(dt);
    if (this.fpsSamples.length < (adjust ? 30 : 6)) return;
    const samples = this.fpsSamples.slice();
    this.fpsSamples.length = 0;
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    this.fps = 1 / avg;
    this.frameMs = avg * 1000;
    if (!adjust) return;
    // Fenster mit Ausreißern (Shader-Kompilierung, Moduswechsel, Tab im Hintergrund) ignorieren
    if (samples.some((s) => s >= 0.09)) return;
    this.peakFps = Math.max(this.peakFps * 0.995, this.fps);
    if (!this.settings.dynamicRes || this.settings.upscale === 'native') return;
    // Ziel nie über der tatsächlich erreichbaren Bildwiederholrate und nie über dem Bildratenlimit
    const lim = this.frameLimit;
    const target = Math.min(this.settings.targetFps || 60, lim > 0 ? lim : Infinity, this.peakFps * 0.97);
    if (performance.now() - this.lastResize < 600) return;
    let ns = this.dynScale;
    if (this.fps < target * 0.88) { ns -= 0.08; this.goodWindows = 0; }
    else if (this.fps > target * 0.97) { if (++this.goodWindows >= 4 && ns < 1) { ns += 0.05; this.goodWindows = 0; } }
    else this.goodWindows = 0;
    ns = Math.round(clamp(ns, 0.6, 1) * 100) / 100;
    if (ns !== this.dynScale) { this.dynScale = ns; this.resize(); }
  }

  renderFrame(dt) {
    // Belichtung: Tonemapper-Abgleich × optional mode.exposure (zusätzlich zu renderer.toneMappingExposure)
    const me = this.active?.exposure;
    this.output.exposureScale = (this._tmExposure || 1) * (typeof me === 'number' ? me : 1);
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

  // ---------------------------------------------------------------------------
  // Energiesparen: Bildratenlimit, Leerlauf-Drosselung, Standbild, Hintergrund
  // ---------------------------------------------------------------------------
  get frameLimit() { const v = +this.settings.fpsLimit; return v > 0 ? v : 0; }

  // Sofort wieder volle Rate (Eingabe, Moduswechsel, Einstellungen, Größenänderung)
  wake() {
    this._calmSince = performance.now();
    this._stillFrames = 0;
    this._nextDue = 0;
  }

  // Für Modi: Standbild ungültig machen (z. B. nach Szenenänderung ohne Kamerabewegung)
  invalidate() { this._stillFrames = 0; }

  installPowerHooks() {
    if (this._powerHooks) return;
    this._powerHooks = true;
    const onInput = () => {
      const was = this.powerState;
      this._lastInput = performance.now();
      if (was === 'idle' || was === 'still') this.wake();
    };
    const opts = { capture: true, passive: true };
    ['pointermove', 'pointerdown', 'pointerup', 'wheel', 'keydown', 'keyup', 'touchstart', 'touchmove'].forEach((ev) => window.addEventListener(ev, onInput, opts));
    window.addEventListener('gamepadconnected', () => { this._padSeen = true; onInput(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // Hintergrund: Schleife ruht vollständig (Audio läuft unabhängig weiter)
        this._hidden = true;
        this.powerState = 'hidden';
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
      } else if (this._hidden) {
        this._hidden = false;
        this._last = null; // erste dt nach der Rückkehr nicht als Riesensprung werten
        this._lastInput = performance.now();
        this.wake();
        this._skipSample = true;
        if (!this._raf && this._loop) this._raf = requestAnimationFrame(this._loop);
      }
    });
  }

  // Controller-Eingaben ohne Ereignis: Achsen/Tasten selbst abfragen (nur wenn je ein Pad da war)
  pollPadActivity(now) {
    if (!this._padSeen) return;
    let gps;
    try { gps = navigator.getGamepads?.() || []; } catch { return; }
    for (const g of gps) {
      if (!g || !g.connected) continue;
      if (g.buttons.some((b) => b.pressed || b.value > 0.2) || g.axes.some((a) => Math.abs(a) > 0.3)) {
        if (this.powerState === 'idle' || this.powerState === 'still') this.wake();
        this._lastInput = now;
        return;
      }
    }
  }

  // Ist die Szene ruhig genug, um zu drosseln? Modi können isBusy()/wantsFullFps() melden.
  sceneCalm(now) {
    if (this.settings.idleSaver === false) return false;
    if (now - this._lastInput < IDLE_AFTER_MS) return false;
    if (this._camMoved) return false;
    const m = this.active;
    if (!m) return false;
    try {
      if (m._frameWaiters?.length) return false; // jemand wartet auf Bilder (Animation)
      if (typeof m.wantsFullFps === 'function' || typeof m.isBusy === 'function') return !(m.wantsFullFps?.() || m.isBusy?.());
      // Bodenkampf: eigener Zug, keine laufende Aktion, keine Effekte/Partikel/Rauch
      if (Array.isArray(m.units) && 'phase' in m) {
        if (m.busy || m.ended || m.phase !== 'player' || m.shake > 0) return false;
        if (m.fx?.length || m.smokes?.length || m.flares?.length) return false;
        if (m.particles?.some((p) => p.life > 0)) return false;
        return true;
      }
      // Weltkarte: Zeit angehalten (Pause oder Dialog offen)
      if (typeof m.speed === 'number' && 'tLat' in m) return m.speed === 0 || anyModalOpen();
    } catch {
      return false;
    }
    return false; // unbekannte Modi (Menü, Basis, Abfangkampf): nie drosseln
  }

  // Kamera seit dem letzten verarbeiteten Bild bewegt? (Welt- + Projektionsmatrix)
  checkCamera() {
    const cam = this.active?.camera;
    if (!cam) { this._camMoved = false; return; }
    cam.updateMatrixWorld();
    const a = cam.matrixWorld.elements, b = cam.projectionMatrix.elements, sig = this._camSig;
    let moved = this._sigCam !== cam;
    for (let i = 0; i < 16; i++) {
      if (Math.abs(sig[i] - a[i]) > 1e-5) moved = true;
      if (Math.abs(sig[16 + i] - b[i]) > 1e-6) moved = true;
      sig[i] = a[i]; sig[16 + i] = b[i];
    }
    this._sigCam = cam;
    this._camMoved = moved;
  }

  // Anzahl ruhiger Bilder, bis das Standbild auskonvergiert ist (TSR: alle Jitter-Phasen + History)
  stillFramesNeeded() {
    return this.method === 'temporal' ? Math.max(24, this._jitterPhases + 12) : 3;
  }

  tick(now) {
    if (this._last == null) this._last = now - 1000 / 60;
    if (this.paused) { this._last = now; this.powerState = 'paused'; this._nextDue = 0; return; }
    this.pollPadActivity(now);
    if (!this.sceneCalm(now)) { this._calmSince = now; this._stillFrames = 0; }
    const state = now - this._calmSince < CALM_HOLD_MS ? 'full' : this._stillFrames >= this.stillFramesNeeded() ? 'still' : 'idle';
    if (state !== this.powerState) {
      this.powerState = state;
      this._nextDue = 0;
      this.fpsSamples.length = 0;
      this._skipSample = true;
    }
    // Bildratenlimit / Drosselung: zu frühe Bilder überspringen (dt läuft weiter auf)
    const cap = state === 'still' ? STILL_FPS : state === 'idle' ? Math.min(IDLE_FPS, this.frameLimit || IDLE_FPS) : this.frameLimit;
    if (cap > 0) {
      const interval = 1000 / cap, tol = interval * 0.2;
      if (this._nextDue && now < this._nextDue - tol) return;
      const base = this._nextDue && now - this._nextDue < interval ? this._nextDue : now;
      this._nextDue = base + interval;
    } else this._nextDue = 0;

    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > 0.1) dt = 0.1;
    if (dt < 0) dt = 0;
    this.time += dt;
    this.updateCount++;
    this.updateDynamicRes(dt, state === 'full');
    this.onFrame?.(dt);
    if (!this.active) return;
    this.active.update?.(dt);
    this.checkCamera();
    if (this._camMoved) this._stillFrames = 0;
    // Standbild fertig und Kamera unverändert: nichts neu zeichnen (Canvas behält das letzte Bild)
    if (state === 'still' && !this._camMoved) return;
    this.renderFrame(dt);
    this.renderCount++;
    if (state === 'idle' && !this._camMoved) this._stillFrames++;
  }

  start() {
    this.installPowerHooks();
    const loop = (now) => {
      this._raf = 0;
      if (this._hidden) return; // Hintergrund: keine neue Anforderung, Schleife ruht
      this._raf = requestAnimationFrame(loop);
      this.tick(now);
    };
    this._loop = loop;
    if (!this._hidden) this._raf = requestAnimationFrame(loop);
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
