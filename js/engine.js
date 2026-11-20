// Rendering-Kern: WebGL2-Renderer, Post-Processing (Bloom, Tonemapping) und
// KI-artiges Super-Resolution-Upscaling (DLSS-Stil) mit dynamischer Auflösung.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
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
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 srcSize; uniform float sharpness; uniform float enabled;
    varying vec2 vUv;
    vec3 tap(vec2 p) { return texture2D(tDiffuse, p).rgb; }
    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    void main() {
      vec2 px = 1.0 / srcSize;
      if (enabled < 0.5) { gl_FragColor = vec4(tap(vUv), 1.0); return; }
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
      gl_FragColor = vec4(mix(rec, sharp, clamp(sharpness * 1.4, 0.0, 1.0)), 1.0);
    }`,
};

// Leichtes Filmkorn + Vignette für cineastischen Look
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, vignette: { value: 0.35 }, grain: { value: 0.025 } },
  vertexShader: SuperResShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float time; uniform float vignette; uniform float grain;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      vec2 d = vUv - 0.5;
      c *= 1.0 - vignette * dot(d, d) * 1.6;
      c += (hash(vUv * 937.0) - 0.5) * grain;
      gl_FragColor = vec4(c, 1.0);
    }`,
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
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.82);
    this.output = new OutputPass();
    this.grade = new ShaderPass(GradeShader);
    this.superRes = new ShaderPass(SuperResShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
    this.composer.addPass(this.grade);
    this.composer.addPass(this.superRes);

    this.dynScale = 1; // Faktor der dynamischen Auflösung
    this.fpsSamples = [];
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

  get internalScale() {
    const mode = UPSCALE_MODES[this.settings.upscale] || UPSCALE_MODES.quality;
    let s = mode.scale;
    if (this.settings.dynamicRes) s *= this.dynScale;
    return clamp(s, 0.33, 1);
  }

  applySettings() {
    const s = this.settings;
    this.bloom.enabled = s.bloom;
    this.grade.enabled = s.filmGrain;
    this.renderer.shadowMap.enabled = s.shadows !== 'off';
    this.superRes.uniforms.sharpness.value = s.sharpness;
    this.superRes.uniforms.enabled.value = s.upscale === 'native' ? 0.0 : 1.0;
    this.shadowSize = s.shadows === 'high' ? 2048 : s.shadows === 'med' ? 1024 : 512;
    this.resize();
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, this.settings.maxDpr || 2);
    this.outW = Math.round(w * dpr);
    this.outH = Math.round(h * dpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, true);
    const scale = this.internalScale;
    // Interne Renderauflösung niedriger, finaler Pass skaliert auf volle Ausgabeauflösung hoch
    this.composer.setPixelRatio(dpr * scale);
    this.composer.setSize(w, h);
    this.internalW = Math.round(w * dpr * scale);
    this.internalH = Math.round(h * dpr * scale);
    this.superRes.uniforms.srcSize.value.set(this.internalW, this.internalH);
    this.bloom.resolution.set(this.internalW / 2, this.internalH / 2);
    if (this.active?.camera) {
      this.active.camera.aspect = w / h;
      this.active.camera.updateProjectionMatrix();
    }
    this.active?.onResize?.(w, h);
  }

  setMode(mode) {
    this.active = mode;
    this.renderPass.scene = mode ? mode.scene : this.scene;
    this.renderPass.camera = mode ? mode.camera : this.camera;
    this.resize();
  }

  // Dynamische Auflösung: hält Ziel-FPS durch Anpassung der internen Renderauflösung
  updateDynamicRes(dt) {
    this.fpsSamples.push(dt);
    if (this.fpsSamples.length < 30) return;
    const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
    this.fpsSamples.length = 0;
    this.fps = 1 / avg;
    this.frameMs = avg * 1000;
    if (!this.settings.dynamicRes) return;
    const target = this.settings.targetFps || 60;
    let ns = this.dynScale;
    if (this.fps < target * 0.9) ns -= 0.07;
    else if (this.fps > target * 0.98 && ns < 1) ns += 0.04;
    ns = clamp(ns, 0.6, 1);
    if (Math.abs(ns - this.dynScale) > 0.001) {
      this.dynScale = ns;
      const now = performance.now();
      if (now - this.lastResize > 400) { this.lastResize = now; this.resize(); }
    }
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
        this.grade.uniforms.time.value = this.time % 100;
        this.composer.render(dt);
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
