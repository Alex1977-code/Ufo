// Umgebungslicht (HDRI/IBL) und Sonnenlicht mit kaskadierten Schatten – gemeinsame Grundlage
// für alle Szenen („Richtung GTA-Look“).
//
// API (für Modi/Szenen):
//   initEnvironment(engine)                    – einmalig (main.js); merkt Renderer + Engine für resetHistory()
//   loadEnvironment(renderer, name, {quality}) – Promise<THREE.Texture> (PMREM, gecacht; lehnt nie ab:
//                                                bei Fehler/offline/„Aus“ prozedurale Himmels-PMREM)
//   applyEnvironment(scene, name, {background, intensity, rotation, blurriness, backgroundIntensity, quality})
//       background: 'none' (Hintergrund unverändert, Standard) | 'blurred' (weichgezeichnetes HDRI) | 'sky' (scharf)
//       intensity:  scene.environmentIntensity (Standard: Vorgabe des Presets)
//       rotation:   Drehung um die Hochachse in Radiant (environmentRotation/backgroundRotation)
//     Setzt sofort die prozedurale Fassung (kein schwarzes PBR-Material während des Ladens) und tauscht
//     beim Eintreffen des HDRIs; danach engine.resetHistory() + invalidate(). Rückgabe: Promise<Texture>.
//     Die Texturen gehören dem Cache – Szenen dürfen sie NICHT disposen.
//   environmentNames() / ENVIRONMENTS         – verfügbare Presets: day, overcast, dusk, night, hangar
//   createSunWithCSM(scene, camera, opts)      – Sonne mit Cascaded Shadow Maps (three CSM-Addon), siehe unten.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { CSM } from 'three/addons/csm/CSM.js';

const BASE = 'assets/hdri/';

// Poly-Haven-HDRIs (CC0, Lizenz/Autor in assets/hdri/hdri.json) + Farben der prozeduralen Ersatz-Umgebung
export const ENVIRONMENTS = {
  day: {
    id: 'kloofendal_48d_partly_cloudy_puresky', label: 'Tag, klar', intensity: 1.0,
    fb: { top: 0x3f74c4, hor: 0xc4d8ee, ground: 0x5d564c, sun: [6.0, 5.6, 5.0], sunDir: [0.5, 0.75, 0.3] },
  },
  overcast: {
    id: 'kloofendal_overcast_puresky', label: 'Bewölkt', intensity: 1.0,
    fb: { top: 0x8e98a4, hor: 0xc2c8ce, ground: 0x4c4c4a, sun: [0.8, 0.8, 0.8], sunDir: [0.2, 0.9, 0.1] },
  },
  dusk: {
    id: 'qwantani_dusk_2_puresky', label: 'Abenddämmerung', intensity: 1.0,
    fb: { top: 0x273a6a, hor: 0xf09a5a, ground: 0x2e241e, sun: [5.0, 2.6, 1.0], sunDir: [0.8, 0.12, -0.2] },
  },
  night: {
    id: 'shanghai_bund', label: 'Nacht, Stadt', intensity: 1.0,
    fb: { top: 0x04070e, hor: 0x2a2228, ground: 0x0b0a0a, sun: [1.4, 0.9, 0.5], sunDir: [0.0, 0.05, 1.0] },
  },
  hangar: {
    id: 'small_hangar_01', label: 'Hangar/Innenraum', intensity: 1.0,
    fb: { top: 0x55585c, hor: 0x2c2e31, ground: 0x1c1c1d, sun: [3.0, 3.0, 2.8], sunDir: [0.0, 1.0, 0.0] },
  },
};
export const environmentNames = () => Object.keys(ENVIRONMENTS);

let _engine = null, _renderer = null;
const _cache = new WeakMap(); // renderer -> Map(key -> Promise<Texture>)
const _pmrems = new WeakMap(); // renderer -> PMREMGenerator
export const envStats = { loaded: 0, failed: 0, fallbacks: 0, lastMs: 0 };

export function initEnvironment(engine) {
  _engine = engine;
  _renderer = engine?.renderer || null;
}

function cacheOf(r) {
  let c = _cache.get(r);
  if (!c) { c = new Map(); _cache.set(r, c); }
  return c;
}
function pmremOf(r) {
  let p = _pmrems.get(r);
  if (!p) { p = new THREE.PMREMGenerator(r); _pmrems.set(r, p); }
  return p;
}

// Qualitätsstufe: 'off' (nur prozedural) | '1k' | '2k' | 'auto' (Einstellung settings.hdri, sonst 2k)
function resolveQuality(q) {
  if (!q || q === 'auto') q = _engine?.settings?.hdri || (_engine?.mobile ? '1k' : '2k');
  return q === 'off' || q === '1k' || q === '2k' ? q : '1k';
}

// Prozedurale Ersatz-Umgebung (wie bisher im Bodenkampf: Himmelsverlauf + Sonne → PMREM)
function buildFallback(renderer, name) {
  const p = (ENVIRONMENTS[name] || ENVIRONMENTS.day).fb;
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color(p.top) }, hor: { value: new THREE.Color(p.hor) }, ground: { value: new THREE.Color(p.ground) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 ground; varying vec3 vP;
      void main(){ float y = vP.y; vec3 c = y > 0.0 ? mix(hor, top, smoothstep(0.0, 0.6, y)) : mix(hor, ground, smoothstep(0.0, 0.12, -y));
        gl_FragColor = vec4(c, 1.0); }`,
    side: THREE.BackSide, depthWrite: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat);
  scene.add(sky);
  const sun = new THREE.Mesh(new THREE.SphereGeometry(7, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(...p.sun) }));
  sun.position.set(...p.sunDir).normalize().multiplyScalar(80);
  scene.add(sun);
  const rt = pmremOf(renderer).fromScene(scene, 0.04);
  sky.geometry.dispose(); mat.dispose(); sun.geometry.dispose(); sun.material.dispose();
  const tex = rt.texture;
  tex.userData = { envName: name, fallback: true, quality: 'off' };
  envStats.fallbacks++;
  return tex;
}

function fallbackTexture(renderer, name) {
  const c = cacheOf(renderer), key = name + '|off';
  if (!c.has(key)) c.set(key, Promise.resolve(buildFallback(renderer, name)));
  return c.get(key);
}

// Synchron vorhandene Ersatzumgebung (für sofortiges Anwenden)
const _fbSync = new WeakMap();
function fallbackSync(renderer, name) {
  let m = _fbSync.get(renderer);
  if (!m) { m = new Map(); _fbSync.set(renderer, m); }
  if (!m.has(name)) {
    const t = buildFallback(renderer, name);
    m.set(name, t);
    cacheOf(renderer).set(name + '|off', Promise.resolve(t));
  }
  return m.get(name);
}

export function loadEnvironment(renderer, name, { quality } = {}) {
  renderer = renderer || _renderer;
  if (!ENVIRONMENTS[name]) { console.warn('AEGIS: unbekannte Umgebung', name); name = 'day'; }
  const q = resolveQuality(quality);
  if (q === 'off') return fallbackTexture(renderer, name);
  const c = cacheOf(renderer), key = `${name}|${q}`;
  if (c.has(key)) return c.get(key);
  const t0 = performance.now();
  const url = `${BASE}${ENVIRONMENTS[name].id}_${q}.hdr`;
  const pr = new Promise((resolve) => {
    new RGBELoader().setDataType(THREE.HalfFloatType).load(url, (hdr) => {
      try {
        hdr.mapping = THREE.EquirectangularReflectionMapping;
        const rt = pmremOf(renderer).fromEquirectangular(hdr);
        hdr.dispose();
        const tex = rt.texture;
        tex.userData = { envName: name, fallback: false, quality: q, url };
        envStats.loaded++;
        envStats.lastMs = Math.round(performance.now() - t0);
        resolve(tex);
      } catch (e) {
        console.warn('AEGIS: HDRI-Verarbeitung fehlgeschlagen – prozedurale Umgebung', e);
        envStats.failed++;
        c.delete(key);
        resolve(fallbackSync(renderer, name));
      }
    }, undefined, (err) => {
      console.warn('AEGIS: HDRI nicht ladbar (offline?) – prozedurale Umgebung:', url, err?.message || '');
      envStats.failed++;
      c.delete(key); // später erneut versuchen
      resolve(fallbackSync(renderer, name));
    });
  });
  c.set(key, pr);
  return pr;
}

function setOnScene(scene, tex, o) {
  scene.environment = tex;
  if (typeof o.intensity === 'number') scene.environmentIntensity = o.intensity;
  const rot = o.rotation || 0;
  if (scene.environmentRotation) scene.environmentRotation.set(0, rot, 0);
  if (o.background === 'blurred' || o.background === 'sky') {
    scene.background = tex;
    scene.backgroundBlurriness = o.background === 'sky' ? 0 : (typeof o.blurriness === 'number' ? o.blurriness : 0.35);
    scene.backgroundIntensity = typeof o.backgroundIntensity === 'number' ? o.backgroundIntensity : (typeof o.intensity === 'number' ? o.intensity : 1);
    if (scene.backgroundRotation) scene.backgroundRotation.set(0, rot, 0);
  }
  scene.userData.envName = tex.userData?.envName;
}

export function applyEnvironment(scene, name, opts = {}) {
  const renderer = opts.renderer || _renderer;
  if (!renderer) return Promise.reject(new Error('applyEnvironment: initEnvironment(engine) fehlt'));
  if (!ENVIRONMENTS[name]) name = 'day';
  const o = { background: 'none', intensity: ENVIRONMENTS[name].intensity, ...opts };
  const token = (scene.userData.__envToken = (scene.userData.__envToken || 0) + 1);
  // Sofort die prozedurale Fassung, falls das HDRI noch nicht im Cache liegt
  const q = resolveQuality(o.quality);
  const ready = cacheOf(renderer).get(`${name}|${q}`);
  if (!ready && !scene.environment) setOnScene(scene, fallbackSync(renderer, name), o);
  return loadEnvironment(renderer, name, { quality: q }).then((tex) => {
    if (scene.userData.__envToken !== token) return tex; // inzwischen anderes Preset gewählt
    setOnScene(scene, tex, o);
    if (_engine && _engine.active?.scene === scene) { _engine.resetHistory(); _engine.invalidate(); }
    return tex;
  });
}

// ---------------------------------------------------------------------------
// Sonne mit Cascaded Shadow Maps (große Szenen wie Bodenkampf):
//   const sun = createSunWithCSM(scene, camera, { cascades, maxFar, shadowMapSize, direction, color, intensity, lightMargin, fade })
//   sun.setupScene(scene)   – alle schattenempfangenden Materialien einbinden (nach dem Aufbau, erneut für neue Objekte)
//   sun.setupMaterial(mat)  – einzelnes Material (bestehendes onBeforeCompile bleibt erhalten)
//   sun.update()            – in mode.update(dt) jedes Bild aufrufen
//   sun.updateFrustums()    – nach Kamera-Projektionsänderung (onResize, FOV, near/far)
//   sun.setDirection(v)/setColor(c)/setIntensity(i), sun.dispose() – beim Verlassen der Szene
// Hinweis: CSM ersetzt global die Shader-Chunks lights_fragment_begin/lights_pars_begin (wirkungslos ohne USE_CSM).
// ---------------------------------------------------------------------------
export function createSunWithCSM(scene, camera, opts = {}) {
  const mobile = !!_engine?.mobile;
  const size = opts.shadowMapSize || Math.min(_engine?.shadowSize || 2048, mobile ? 1024 : 2048);
  const csm = new CSM({
    camera, parent: scene,
    cascades: opts.cascades || (mobile ? 2 : 3),
    maxFar: opts.maxFar || 150,
    mode: opts.mode || 'practical',
    shadowMapSize: size,
    shadowBias: opts.shadowBias ?? -0.0002,
    lightDirection: (opts.direction ? new THREE.Vector3().copy(opts.direction) : new THREE.Vector3(-0.5, -1, -0.35)).normalize(),
    lightIntensity: opts.intensity ?? 3,
    lightNear: opts.lightNear || 1,
    lightFar: opts.lightFar || 600,
    lightMargin: opts.lightMargin || 60,
  });
  csm.fade = opts.fade !== false;
  const color = new THREE.Color(opts.color ?? 0xfff0d8);
  for (const l of csm.lights) { l.color.copy(color); l.shadow.normalBias = opts.normalBias ?? 0.04; }
  const done = new WeakSet();
  const api = {
    csm, lights: csm.lights,
    setupMaterial(m) {
      if (!m || done.has(m) || !(m.isMeshStandardMaterial || m.isMeshPhongMaterial || m.isMeshLambertMaterial || m.isMeshToonMaterial)) return;
      done.add(m);
      const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey?.call(m) || '';
      csm.setupMaterial(m);
      const hook = m.onBeforeCompile;
      if (prev && prev !== THREE.Material.prototype.onBeforeCompile) m.onBeforeCompile = function (sh, r) { prev.call(this, sh, r); hook.call(this, sh, r); };
      m.customProgramCacheKey = () => 'csm|' + prevKey;
      m.needsUpdate = true;
    },
    setupScene(root) {
      root.traverse((o) => {
        if (!o.isMesh || !o.receiveShadow) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => api.setupMaterial(m));
      });
    },
    update() { camera.updateMatrixWorld(); csm.update(); },
    updateFrustums() { csm.updateFrustums(); },
    setDirection(v) { csm.lightDirection.copy(v).normalize(); },
    setColor(c) { for (const l of csm.lights) l.color.set(c); },
    setIntensity(i) { for (const l of csm.lights) l.intensity = i; },
    setCastShadow(on) { for (const l of csm.lights) l.castShadow = !!on; },
    dispose() { csm.dispose(); csm.remove(); for (const l of csm.lights) l.dispose?.(); },
  };
  return api;
}
