// AEGIS – Asset-Viewer (G3): eigenständige Seite viewer.html
// Zeigt Hero-Autos (herocar.js), Nutzfahrzeuge (heavyvehicles.js, G7), Figuren (characters.js), Fluggeräte/UFOs (craftmodels.js), alle GLBs aus
// assets/manifest.json, Textur-Sets und eine Auswahl prozeduraler Props (models.js) mit Statistik, LOD-Umschaltung,
// Animationen und Prüfungen (✓/⚠/✗). Renderpfad: eigener WebGLRenderer + environment.js (HDRI/PMREM),
// Tonemapping AgX/ACES/Neutral (Belichtungsabgleich aus engine.js), Sonne passend zum HDRI-Preset, PBR-Boden.
//
// Test-/Skript-Schnittstelle: window.__viewer = { ready, entries, select(id), current(), stats(), checks(),
//   checkAll(), results, setLod(sel), setView(opts), playClip(name) }
// URL-Parameter: ?a=<asset-id> &check=1 (Alle prüfen starten) &list=0|1 &info=0|1 &view=shaded|normals|uv
//   &wire=1 &turn=0|1 &env=day|overcast|dusk|night|hangar &floor=asphalt|concrete|pavers|none &cat=<kategorie>
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { initEnvironment, applyEnvironment, ENVIRONMENTS } from './environment.js';
import { TONEMAPS } from './engine.js';
import { validateVehicle, applyVehicleMaterials, classifyMaterialName } from './vehiclematerials.js';
import { makeHeroCar, HERO_TYPES, disposeHeroCar, setHeroCarLights } from './herocar.js';
import { makeHeavyVehicle, HEAVY_TYPES, HEAVY_VARIANTS, disposeHeavyVehicle, setHeavyVehicleLights } from './heavyvehicles.js';
import { loadCharacterLibrary, makeCharacter, CHARACTER_STATES, CHARACTER_BASES } from './characters.js';
import { makeInterceptor, makeTransport, makeUfo, autoLod, animateCraft, setHatch, disposeCraft } from './craftmodels.js';

// =====================================================================================================
// Grenzwerte der Prüfungen
// =====================================================================================================
export const RULES = {
  triNoLod: 30000,            // > 30k Dreiecke ohne LOD = ⚠
  texMax: 2048,               // Texturkante > 2048 = ⚠
  carLen: [3.5, 6.0],         // Auto: Länge in m
  figH: [1.5, 2.1],           // Figur: Höhe in m
  scaleFail: 0.25,            // > 25 % außerhalb des Bereichs = ✗ statt ⚠
};

// =====================================================================================================
// Kleine Helfer
// =====================================================================================================
const $ = (s, r = document) => r.querySelector(s);
const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n) => nf0.format(Math.round(n || 0));
const fmtM = (n) => nf2.format(n || 0);
const fmtBytes = (b) => (b >= 1048576 ? `${nf2.format(b / 1048576)} MB` : b >= 1024 ? `${nf0.format(b / 1024)} KB` : `${nf0.format(b)} B`);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const STATUS_ICON = { ok: '✓', warn: '⚠', fail: '✗' };
const STATUS_RANK = { ok: 0, warn: 1, fail: 2 };
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const params = new URLSearchParams(location.search);
const MOBILE = (() => {
  try { return (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900) || innerWidth <= 820; } catch { return false; }
})();
const LS_KEY = 'aegis-viewer-v1';
function loadPrefs() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch { return {}; } }
function savePrefs() {
  try {
    const { env, bg, hdriQ, tone, exposure, envInt, envRot, sunInt, shadows, floor, bloom, turntable } = state;
    localStorage.setItem(LS_KEY, JSON.stringify({ env, bg, hdriQ, tone, exposure, envInt, envRot, sunInt, shadows, floor, bloom, turntable }));
  } catch { /* privates Fenster */ }
}

// =====================================================================================================
// Zustand
// =====================================================================================================
const prefs = loadPrefs();
const state = Object.assign({
  env: 'day', bg: 'blurred', hdriQ: '1k', tone: 'agx', exposure: 1.0, envInt: 1.0, envRot: 0, sunInt: 1.0,
  shadows: true, floor: 'asphalt', bloom: !MOBILE, turntable: false,
  wire: false, view: 'shaded', cat: 'all', query: '', lodSel: 'auto',
}, prefs);
if (params.has('env') && ENVIRONMENTS[params.get('env')]) state.env = params.get('env');
if (params.has('floor')) state.floor = params.get('floor');
if (params.has('view')) state.view = params.get('view');
if (params.has('wire')) state.wire = params.get('wire') === '1';
if (params.has('turn')) state.turntable = params.get('turn') === '1';
if (params.has('cat')) state.cat = params.get('cat');
if (params.has('tone') && TONEMAPS[params.get('tone')]) state.tone = params.get('tone');

// =====================================================================================================
// Renderer, Szene, Kamera, Steuerung
// =====================================================================================================
const canvas = $('#vw-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, MOBILE ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = state.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1622);
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 2000);
camera.position.set(5, 2.5, 7);
const holder = new THREE.Group(); holder.name = 'viewer_holder'; scene.add(holder);
let needsRender = true;
const invalidate = () => { needsRender = true; };

// Kompakte Orbit-Steuerung (vendor/ enthält kein OrbitControls-Addon). Gleiche Schnittstelle wie
// three/addons/controls/OrbitControls.js (target, enableDamping, autoRotate, minDistance/maxDistance, update()).
// Liegt das Addon später in vendor/, wird es automatisch verwendet (siehe initControls).
class MiniOrbitControls {
  constructor(object, dom) {
    this.object = object; this.domElement = dom; this.target = new THREE.Vector3();
    this.enableDamping = true; this.dampingFactor = 0.15; this.minDistance = 0.2; this.maxDistance = 2000;
    this.minPolarAngle = 0.01; this.maxPolarAngle = Math.PI * 0.495; this.rotateSpeed = 1; this.zoomSpeed = 1;
    this._sph = new THREE.Spherical(); this._d = { theta: 0, phi: 0 }; this._scale = 1; this._pan = new THREE.Vector3();
    this._ptrs = new Map(); this._mode = null; this._pinch = 0; this._mid = new THREE.Vector2(); this._dirty = true;
    const v = new THREE.Vector3();
    this._panBy = (dx, dy) => {
      const el = this.domElement, dist = v.subVectors(this.object.position, this.target).length();
      const k = (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.object.fov) / 2)) / Math.max(1, el.clientHeight);
      const m = this.object.matrix.elements;
      this._pan.x += (-dx * m[0] + dy * m[4]) * k; this._pan.y += (-dx * m[1] + dy * m[5]) * k; this._pan.z += (-dx * m[2] + dy * m[6]) * k;
    };
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      dom.setPointerCapture?.(e.pointerId);
      this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._ptrs.size === 2) { this._mode = 'touch2'; this._pinch = this._dist2(); this._mid.copy(this._midPt()); }
      else this._mode = e.button === 2 || e.shiftKey || e.ctrlKey ? 'pan' : e.button === 1 ? 'dolly' : 'rotate';
    });
    dom.addEventListener('pointermove', (e) => {
      const p = this._ptrs.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      const H = Math.max(1, dom.clientHeight);
      if (this._mode === 'touch2' && this._ptrs.size >= 2) {
        const d = this._dist2(); if (this._pinch > 0 && d > 0) this._scale *= this._pinch / d; this._pinch = d;
        const m = this._midPt(); this._panBy(m.x - this._mid.x, m.y - this._mid.y); this._mid.copy(m);
      } else if (this._mode === 'rotate') { this._d.theta -= (2 * Math.PI * dx / H) * this.rotateSpeed; this._d.phi -= (2 * Math.PI * dy / H) * this.rotateSpeed; }
      else if (this._mode === 'pan') this._panBy(dx, dy);
      else if (this._mode === 'dolly') this._scale *= Math.pow(0.95, -dy * 0.2 * this.zoomSpeed);
      this._dirty = true;
    });
    const up = (e) => { this._ptrs.delete(e.pointerId); if (this._ptrs.size === 1) { this._mode = 'rotate'; } else if (!this._ptrs.size) this._mode = null; };
    dom.addEventListener('pointerup', up); dom.addEventListener('pointercancel', up);
    dom.addEventListener('wheel', (e) => { e.preventDefault(); this._scale *= Math.pow(0.95, -Math.sign(e.deltaY) * this.zoomSpeed); this._dirty = true; }, { passive: false });
  }
  _dist2() { const [a, b] = [...this._ptrs.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; }
  _midPt() { const [a, b] = [...this._ptrs.values()]; return new THREE.Vector2((a.x + b.x) / 2, (a.y + b.y) / 2); }
  update() {
    const off = new THREE.Vector3().subVectors(this.object.position, this.target);
    this._sph.setFromVector3(off);
    const f = this.enableDamping ? this.dampingFactor : 1;
    this._sph.theta += this._d.theta * f; this._sph.phi += this._d.phi * f;
    this._sph.phi = THREE.MathUtils.clamp(this._sph.phi, this.minPolarAngle, this.maxPolarAngle);
    this._sph.radius = THREE.MathUtils.clamp(this._sph.radius * this._scale, this.minDistance, this.maxDistance);
    this.target.addScaledVector(this._pan, f);
    off.setFromSpherical(this._sph);
    this.object.position.copy(this.target).add(off);
    this.object.lookAt(this.target);
    const moving = Math.abs(this._d.theta) + Math.abs(this._d.phi) > 1e-5 || this._pan.lengthSq() > 1e-12 || this._scale !== 1 || this._dirty;
    if (this.enableDamping) { this._d.theta *= 1 - f; this._d.phi *= 1 - f; this._pan.multiplyScalar(1 - f); } else { this._d.theta = this._d.phi = 0; this._pan.set(0, 0, 0); }
    if (Math.abs(this._d.theta) + Math.abs(this._d.phi) < 1e-5) this._d.theta = this._d.phi = 0;
    this._scale = 1; this._dirty = false;
    return moving;
  }
  dispose() {}
}
let controls = new MiniOrbitControls(camera, canvas);
let controlsKind = 'MiniOrbitControls (viewer.js)';
async function initControls() {
  try {
    const mod = await import('three/addons/controls/OrbitControls.js');
    const c = new mod.OrbitControls(camera, canvas);
    c.enableDamping = true; c.dampingFactor = 0.15; c.maxPolarAngle = Math.PI * 0.495;
    c.target.copy(controls.target); controls.dispose?.();
    controls = c; controlsKind = 'OrbitControls (three r170)';
    c.addEventListener('change', invalidate);
  } catch { /* Addon nicht vorhanden → eingebaute Steuerung */ }
}

// Nachbearbeitung nur für Bloom (OutputPass übernimmt Tonemapping + sRGB)
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: MOBILE ? 0 : 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.4, 1.0);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

function resize() {
  const el = $('#vw-view'), w = Math.max(1, el.clientWidth), hgt = Math.max(1, el.clientHeight);
  renderer.setSize(w, hgt, false);
  composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, hgt);
  camera.aspect = w / hgt; camera.updateProjectionMatrix();
  invalidate();
}
new ResizeObserver(resize).observe($('#vw-view'));

// =====================================================================================================
// Umgebung (environment.js), Sonne, Boden
// =====================================================================================================
const envEngine = { renderer, settings: { hdri: state.hdriQ }, mobile: MOBILE, resetHistory() {}, invalidate, active: { scene } };
initEnvironment(envEngine);
const sun = new THREE.DirectionalLight(0xffffff, 2.5);
sun.name = 'viewer_sun'; sun.castShadow = true;
sun.shadow.mapSize.set(MOBILE ? 1024 : 2048, MOBILE ? 1024 : 2048);
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 3;
scene.add(sun, sun.target);
let envLoading = 0;
const ENV_LABEL = (k) => ENVIRONMENTS[k]?.label || k;

function updateSun() {
  const fb = (ENVIRONMENTS[state.env] || ENVIRONMENTS.day).fb;
  const d = new THREE.Vector3(...fb.sunDir); d.y = Math.max(d.y, 0.3); d.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), state.envRot);
  const c = new THREE.Color(fb.sun[0], fb.sun[1], fb.sun[2]); const mx = Math.max(c.r, c.g, c.b, 1e-3); c.multiplyScalar(1 / mx);
  sun.color.copy(c); sun.intensity = state.sunInt * mx * (2.5 / 6);
  sun.userData.dir = d;
  fitSun();
}
function fitSun() {
  const b = current?.bounds; const ctr = b ? b.center : new THREE.Vector3(0, 1, 0), r = b ? Math.max(0.5, b.radius) : 3;
  const d = sun.userData.dir || new THREE.Vector3(0.5, 0.8, 0.3).normalize();
  sun.position.copy(ctr).addScaledVector(d, r * 4); sun.target.position.copy(ctr); sun.target.updateMatrixWorld();
  const sc = sun.shadow.camera, e = r * 1.6;
  sc.left = -e; sc.right = e; sc.top = e; sc.bottom = -e; sc.near = 0.05; sc.far = r * 9; sc.updateProjectionMatrix();
  invalidate();
}
function applyEnv() {
  envEngine.settings.hdri = state.hdriQ;
  if (state.bg === 'none') { scene.background = new THREE.Color(0x0b1622); }
  envLoading++; setStatus();
  applyEnvironment(scene, state.env, { background: state.bg === 'none' ? 'none' : state.bg, intensity: state.envInt, rotation: state.envRot, blurriness: 0.35, quality: state.hdriQ })
    .catch((e) => console.warn('Viewer: Umgebung', e))
    .finally(() => { envLoading--; setStatus(); invalidate(); });
  updateSun();
}
function applyTone() {
  const t = TONEMAPS[state.tone] || TONEMAPS.agx;
  renderer.toneMapping = t.tm; renderer.toneMappingExposure = state.exposure * t.exposure;
  invalidate();
}

// Boden mit PBR-Textur (assets/textures, CC0) und weichem Rand (alphaMap)
const FLOORS = {
  asphalt: { label: 'Asphalt', dir: 'asphalt', scale: 3.0 },
  concrete: { label: 'Beton', dir: 'concrete', scale: 1.23 },
  pavers: { label: 'Gehwegplatten', dir: 'sidewalk_pavers', scale: 1.8 },
  grid: { label: 'Raster (neutral)' },
  none: { label: 'Aus' },
};
const texLoader = new THREE.TextureLoader();
const floorTex = new Map();
function loadFloorSet(key) {
  const f = FLOORS[key]; if (!f?.dir) return null;
  if (!floorTex.has(key)) {
    const ld = (n, srgb) => { const t = texLoader.load(`assets/textures/${f.dir}/${n}.webp`, invalidate, undefined, () => console.warn('Viewer: Bodentextur fehlt', f.dir, n));
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
    floorTex.set(key, { map: ld('albedo', true), normalMap: ld('normal'), roughnessMap: ld('roughness') });
  }
  return floorTex.get(key);
}
const fadeTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 40, 128, 128, 128); gr.addColorStop(0, '#fff'); gr.addColorStop(0.55, '#fff'); gr.addColorStop(1, '#000');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c);
})();
const gridTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#5a6068'; g.fillRect(0, 0, 256, 256); g.strokeStyle = '#7a8088'; g.lineWidth = 2; g.strokeRect(0, 0, 256, 256);
  g.strokeStyle = '#686e76'; g.lineWidth = 1; for (let i = 32; i < 256; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
})();
const floorMat = new THREE.MeshStandardMaterial({ name: 'viewer_floor', roughness: 1, metalness: 0, alphaMap: fadeTex, transparent: true, depthWrite: true });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), floorMat);
floor.name = 'viewer_floor'; floor.receiveShadow = true; floor.renderOrder = -1; scene.add(floor);
function applyFloor() {
  const key = FLOORS[state.floor] ? state.floor : 'asphalt';
  floor.visible = key !== 'none';
  const set = loadFloorSet(key);
  floorMat.map = set ? set.map : key === 'grid' ? gridTex : null;
  floorMat.normalMap = set ? set.normalMap : null;
  floorMat.roughnessMap = set ? set.roughnessMap : null;
  floorMat.roughness = set ? 1 : 0.85;
  floorMat.needsUpdate = true;
  sizeFloor();
}
function sizeFloor() {
  const r = current?.bounds?.radius || 3, S = Math.max(40, r * 14);
  floor.scale.set(S, 1, S);
  const key = FLOORS[state.floor] ? state.floor : 'asphalt', sc = FLOORS[key].scale || 2;
  const rep = S / sc;
  for (const t of [floorMat.map, floorMat.normalMap, floorMat.roughnessMap]) if (t && t !== fadeTex) t.repeat.set(rep, rep);
  invalidate();
}

// Ansichts-Materialien (Normalen, UV-Checker)
const uvChecker = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 1024; const g = c.getContext('2d'); const n = 8, s = 1024 / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    g.fillStyle = (x + y) % 2 ? `hsl(${(x * 45 + y * 20) % 360} 60% 55%)` : '#1d2631'; g.fillRect(x * s, y * s, s, s);
    g.fillStyle = (x + y) % 2 ? '#0b1622' : '#e8f4fa'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(`${'ABCDEFGH'[x]}${n - y}`, x * s + s / 2, y * s + s / 2);
  }
  g.strokeStyle = '#ff3050'; g.lineWidth = 10; g.beginPath(); g.moveTo(20, 1004); g.lineTo(220, 1004); g.stroke(); // +U
  g.strokeStyle = '#30ff80'; g.beginPath(); g.moveTo(20, 1004); g.lineTo(20, 804); g.stroke(); // +V
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
})();
const VIEW_MATS = {
  normals: new THREE.MeshNormalMaterial({ name: 'viewer_normals', side: THREE.DoubleSide }),
  uv: new THREE.MeshBasicMaterial({ name: 'viewer_uvchecker', map: uvChecker, side: THREE.DoubleSide }),
};
const VIEW_LABELS = { shaded: 'Schattiert', normals: 'Normalen', uv: 'UV-Checker' };

// =====================================================================================================
// Asset-Register
// =====================================================================================================
const CATS = {
  hero: 'Hero-Autos', heavy: 'Nutzfahrzeuge', char: 'Figuren', craft: 'Fluggeräte & UFOs', glb: 'GLB-Assets', tex: 'Texturen', prop: 'Props (models.js)',
};
const entries = [];
const byId = new Map();
function addEntry(e) { if (byId.has(e.id)) return; e.status = null; entries.push(e); byId.set(e.id, e); }

const SWATCHES = ['#8a1c22', '#1d3f6e', '#e8e6e0', '#151719', '#5d6066', '#2f5a3a', '#c9a227', '#c45a1a'];
const STATE_LABEL = {
  idle: 'Stehen', aimIdle: 'Bereit', walk: 'Gehen', run: 'Laufen', crouch: 'Hocken', crouchWalk: 'Schleichen', kneel: 'Knien',
  aim: 'Zielen', shoot: 'Schießen', reload: 'Nachladen', hit: 'Treffer', die: 'Sterben', dead: 'Tot',
};
const STATE_SPEED = { walk: 1.4, run: 4.0, crouchWalk: 0.7 };

// --- Hero-Autos (herocar.js, G4)
const HERO_LABEL = { sedan: 'Limousine', suv: 'SUV', pickup: 'Pick-up', van: 'Van' };
for (const t of HERO_TYPES) {
  addEntry({
    id: 'hero:' + t, cat: 'hero', grp: 'Hero-Autos (herocar.js)', label: `Varenne ${HERO_LABEL[t] || t}`, sub: `makeHeroCar · ${t}`, kind: 'vehicle', front: 1,
    opts: [
      { k: 'color', type: 'color', label: 'Lackfarbe', def: '#8a1c22', swatches: SWATCHES },
      { k: 'damage', type: 'range', label: 'Schaden', min: 0, max: 1, step: 0.05, def: 0 },
      { k: 'seed', type: 'number', label: 'Seed', def: 1 },
      { k: 'head', type: 'bool', label: 'Scheinwerfer', def: false, live: true },
      { k: 'brake', type: 'bool', label: 'Bremslicht', def: false, live: true },
    ],
    build(o) {
      const root = makeHeroCar({ type: t, paintColor: o.color, damage: +o.damage, seed: o.seed | 0, lod: 'auto' });
      setHeroCarLights(root, { head: o.head, brake: o.brake });
      return { root, dispose: () => disposeHeroCar(root), live: (n) => setHeroCarLights(root, { head: n.head, brake: n.brake }) };
    },
  });
}

// --- Nutzfahrzeuge (heavyvehicles.js, G7): Traktor, Mähdrescher, Bus, LKW, Stapler, Panzerwrack
const HEAVY_INFO = {
  tractor: { label: 'AGRION Traktor „Terra 165“', color: '#2f6b2a', len: [3.8, 6.5], swatches: ['#2f6b2a', '#a3201b', '#1f4f8f', '#c9861a'] },
  combine: { label: 'AGRION Mähdrescher „Messor 7“', color: '#2f6b2a', len: [7, 11], swatches: ['#2f6b2a', '#a3201b', '#c9a21a'] },
  bus: { label: 'VARENNE Bus „Urbis“ / „Orbis“', color: '#e9e7e1', len: [8, 15], swatches: ['#e9e7e1', '#d8a91c', '#b3261e', '#2b5fa0'] },
  truck: { label: 'VARENNE LKW „Carrus“', color: '#e9e7e1', len: [6.5, 18.75], swatches: ['#e9e7e1', '#1c3f73', '#a3201b', '#2a2c2f'] },
  forklift: { label: 'VARENNE Gabelstapler „Lyft 25“', color: '#e0a312', len: [2.8, 4.2], swatches: ['#e0a312', '#d8621a', '#b3261e', '#2e6e3a'] },
  milwreck: { label: 'Schützenpanzer (ausgebrannt)', color: '#4f5236', len: [5.5, 10], swatches: ['#4f5236', '#6b6a4a', '#8a7a5a'] },
};
const VARIANT_LABEL = { standard: 'Standard', loader: 'mit Frontlader', city: 'Stadtbus 12 m', coach: 'Reisebus 12,2 m', box: 'Koffer-LKW 8,5 m', semi: 'Sattelzug 16 m' };
for (const t of HEAVY_TYPES) {
  const hi = HEAVY_INFO[t], vars = HEAVY_VARIANTS[t];
  addEntry({
    id: 'heavy:' + t, cat: 'heavy', grp: 'Nutzfahrzeuge (heavyvehicles.js)', label: hi.label, sub: `makeHeavyVehicle · ${t}`, kind: 'vehicle', front: 1, lenRange: hi.len,
    opts: [
      ...(vars.length > 1 ? [{ k: 'variant', type: 'select', label: 'Typ', def: vars[0], options: vars.map((v) => [v, VARIANT_LABEL[v] || v]) }] : []),
      { k: 'color', type: 'color', label: 'Farbe', def: hi.color, swatches: hi.swatches },
      { k: 'damage', type: 'range', label: t === 'milwreck' ? 'Rost/Alter' : 'Schaden/Schmutz', min: 0, max: 1, step: 0.05, def: t === 'milwreck' ? 1 : 0 },
      { k: 'lod', type: 'select', label: 'LOD', def: 'auto', options: [['auto', 'Automatisch (THREE.LOD)'], ['0', 'LOD0'], ['1', 'LOD1'], ['2', 'LOD2']] },
      { k: 'seed', type: 'number', label: 'Seed', def: 1 },
      ...(t === 'milwreck' ? [] : [
        { k: 'head', type: 'bool', label: 'Scheinwerfer', def: false, live: true },
        { k: 'beacon', type: 'bool', label: 'Rundumleuchte/Blinker', def: false, live: true },
      ]),
    ],
    build(o) {
      const root = makeHeavyVehicle({ type: t, variant: o.variant, color: o.color, damage: +o.damage, seed: o.seed | 0, lod: o.lod === 'auto' ? 'auto' : +o.lod });
      const lights = (n) => setHeavyVehicleLights(root, { head: n.head, brake: n.head, beacon: n.beacon });
      lights(o);
      return { root, dispose: () => disposeHeavyVehicle(root), live: lights };
    },
  });
}

// --- Figuren (characters.js, G5): jede Basis × Ausrüstung
const OUTFITS = {
  personal: { label: 'Soldat, Personal-Panzerung', role: 'soldier', armor: 'personal' },
  power: { label: 'Soldat, Power-Rüstung', role: 'soldier', armor: 'power' },
  civ: { label: 'Zivil', role: 'civilian', armor: 'none' },
};
const baseLabel = (b) => { const m = b.match(/_(m|f)_0?(\d+)$/); return m ? `${m[1] === 'f' ? 'Frau' : 'Mann'} ${m[2]}` : b; };
let charLib = null;
const ensureCharLib = () => (charLib ||= loadCharacterLibrary({ quality: autoLod() === 'low' ? 'low' : 'high' }).catch((e) => { charLib = null; throw e; }));
for (const base of CHARACTER_BASES) {
  for (const [ok, of] of Object.entries(OUTFITS)) {
    const soldier = of.role === 'soldier';
    addEntry({
      id: `char:${base}:${ok}`, cat: 'char', grp: 'Figuren (characters.js)', label: `${baseLabel(base)} – ${of.label}`, sub: `makeCharacter · ${base} · ${of.role}/${of.armor}`, kind: 'character', front: 1,
      opts: [
        { k: 'state', type: 'select', label: 'Zustand', def: 'idle', live: true, options: CHARACTER_STATES.map((s) => [s, STATE_LABEL[s] || s]) },
        soldier && { k: 'weapon', type: 'select', label: 'Waffe', def: 'rifle', options: [['rifle', 'Gewehr'], ['pistol', 'Pistole'], ['none', 'keine']] },
        { k: 'seed', type: 'number', label: 'Seed', def: 7 },
      ].filter(Boolean),
      async build(o) {
        const lib = await ensureCharLib();
        const c = makeCharacter({ base, role: of.role, armor: { type: of.armor }, weapon: soldier ? (o.weapon === 'none' ? null : o.weapon || 'rifle') : null, seed: o.seed | 0 });
        c.setState(o.state || 'idle', { speedMps: STATE_SPEED[o.state] || 0, force: true, fade: 0.0001 });
        c.update(1 / 60, () => 0);
        const clips = [...(lib.bases.get(base)?.clips?.values() || [])];
        return {
          root: c.root, character: c, mixer: c.mixer, clips,
          update: (dt) => c.update(dt, () => 0),
          live: (n) => { c.setState(n.state || 'idle', { speedMps: STATE_SPEED[n.state] || 0, force: true }); },
          playClip: (clip) => { c.mixer.stopAllAction(); const a = c.mixer.clipAction(clip); a.reset(); a.setLoop(THREE.LoopRepeat, Infinity); a.setEffectiveWeight(1); a.play(); return a; },
          stopClip: () => { c.mixer.stopAllAction(); c.setState('idle', { force: true, fade: 0.0001 }); },
          dispose: () => c.dispose(),
        };
      },
    });
  }
}

// --- Fluggeräte und UFOs (craftmodels.js): Stufe „hoch“/„niedrig“ = autoLod-Varianten
const CRAFTS = [
  ['falcon', 'Abfangjäger „Falke“', 'jet'], ['phantom', 'Abfangjäger „Phantom“', 'jet'], ['kondor', 'Transporter „Kondor“', 'transport'],
  ['scout', 'UFO Aufklärer', 'ufo'], ['fighter', 'UFO Jäger', 'ufo'], ['freighter', 'UFO Frachter', 'ufo'], ['battleship', 'UFO Schlachtschiff', 'ufo'],
];
for (const [type, label, kind] of CRAFTS) {
  addEntry({
    id: `craft:${type}`, cat: 'craft', grp: kind === 'ufo' ? 'UFOs (craftmodels.js)' : 'Fluggeräte (craftmodels.js)', label, sub: kind === 'ufo' ? `makeUfo('${type}')` : kind === 'jet' ? `makeInterceptor('${type}')` : 'makeTransport()', kind: 'craft', front: -1,
    opts: [
      { k: 'damage', type: 'range', label: 'Schaden', min: 0, max: 1, step: 0.05, def: 0 },
      { k: 'seed', type: 'number', label: 'Seed', def: 1 },
      kind !== 'ufo' && { k: 'gear', type: 'bool', label: 'Fahrwerk', def: true },
      kind !== 'jet' && { k: 'hatch', type: 'range', label: kind === 'ufo' ? 'Luke' : 'Heckrampe', min: 0, max: 1, step: 0.05, def: 0, live: true },
      { k: 'throttle', type: 'range', label: 'Schub/Leuchten', min: 0, max: 1, step: 0.05, def: kind === 'ufo' ? 1 : 0.3, live: true },
    ].filter(Boolean),
    build(o) {
      const mk = (lod) => {
        const op = { lod, damage: +o.damage, seed: o.seed | 0, gear: !!o.gear, throttle: +o.throttle };
        return kind === 'ufo' ? makeUfo(type, op) : kind === 'jet' ? makeInterceptor(type, op) : makeTransport(op);
      };
      const hi = mk('high'), lo = mk('low');
      hi.name = `${type}_high`; lo.name = `${type}_low`;
      const root = new THREE.Group(); root.name = `craft_${type}`; root.add(hi, lo);
      const live = (n) => { for (const g of [hi, lo]) { setHatch(g, +n.hatch || 0); g.userData.throttle = +n.throttle; } };
      live(o);
      return {
        root, lods: { type: 'variants', auto: autoLod() === 'low' ? 1 : 0, levels: [{ label: 'hoch', object: hi }, { label: 'niedrig', object: lo }] },
        update: (dt, t) => { animateCraft(hi, t); animateCraft(lo, t); }, live,
        dispose: () => { disposeCraft(hi); disposeCraft(lo); root.removeFromParent(); },
      };
    },
  });
}

// --- GLBs und Texturen aus assets/manifest.json
const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const gltfCache = new Map();
const loadGLB = (url) => { if (!gltfCache.has(url)) gltfCache.set(url, gltfLoader.loadAsync(url).catch((e) => { gltfCache.delete(url); throw e; })); return gltfCache.get(url); };
const texSetCache = new Map();
let manifest = null;
const GLB_GRP = { character: 'Figuren (GLB)', vehicle: 'Fahrzeuge (GLB)', prop: 'Props (GLB)' };
async function loadManifest() {
  try {
    const r = await fetch('assets/manifest.json', { cache: 'no-cache' });
    manifest = await r.json();
  } catch (e) { console.warn('Viewer: assets/manifest.json nicht ladbar', e); manifest = { assets: [] }; }
  const base = manifest.base_path || 'assets/';
  for (const a of manifest.assets || []) {
    if (/\.glb$/i.test(a.file || '')) {
      const kind = a.type === 'vehicle' ? 'vehicle' : a.type === 'character' ? 'character' : 'prop';
      addEntry({
        id: `glb:${a.id}`, cat: 'glb', grp: GLB_GRP[a.type] || 'Sonstige (GLB)', label: a.id, sub: `${a.file} · ${a.license || ''}`, kind, front: 1, manifest: a,
        opts: kind === 'vehicle' ? [
          { k: 'g2', type: 'bool', label: 'G2-Materialien anwenden', def: false },
          { k: 'color', type: 'color', label: 'Lackfarbe (G2)', def: '#1d3f6e', swatches: SWATCHES },
        ] : [],
        async build(o) {
          const gltf = await loadGLB(base + a.file);
          const root = SkeletonUtils.clone(gltf.scene); root.name = a.id;
          if (kind === 'vehicle' && o.g2) applyVehicleMaterials(root, { paintColor: o.color, quality: autoLod() === 'low' ? 'low' : 'high' });
          root.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
          const clips = gltf.animations || [];
          const mixer = clips.length ? new THREE.AnimationMixer(root) : null;
          const built = {
            root, clips, mixer,
            update: mixer ? (dt) => { if (!built.activeClip) return false; mixer.update(dt); return true; } : null,
            playClip: (clip) => { mixer.stopAllAction(); const ac = mixer.clipAction(clip); ac.reset().play(); return ac; },
            stopClip: () => mixer?.stopAllAction(),
            dispose: () => { mixer?.stopAllAction(); mixer?.uncacheRoot(root); root.removeFromParent(); },
          };
          return built;
        },
      });
    } else if (a.type === 'texture') {
      addEntry({
        id: `tex:${a.id}`, cat: 'tex', grp: 'Textur-Sets (PBR)', label: a.id.replace(/^tex_/, ''), sub: `${a.file} · Kachel ${fmtM(a.scale_hint_m)} m`, kind: 'texture', front: 1, manifest: a, opts: [],
          async build() {
          if (!texSetCache.has(a.id)) {
            const files = Object.entries(a.maps || {}).map(([k, v]) => [k, String(v).split(/\s/)[0]]);
            texSetCache.set(a.id, Promise.all(files.map(([k, f]) => texLoader.loadAsync(base + a.file + f).then((t) => {
              t.name = `${a.id}/${f}`; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
              if (k === 'albedo') t.colorSpace = THREE.SRGBColorSpace;
              return [k, t];
            }))).then((l) => Object.fromEntries(l)));
          }
          const T = await texSetCache.get(a.id);
          const mat = new THREE.MeshStandardMaterial({ name: a.id, map: T.albedo || null, normalMap: T.normal || null, roughnessMap: T.roughness || null, roughness: 1 });
          const root = new THREE.Group(); root.name = a.id;
          const ball = new THREE.Mesh(new THREE.SphereGeometry(0.6, 64, 32), mat); ball.position.set(-0.75, 0.6, 0); ball.name = 'Kugel';
          const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), mat); box.position.set(0.75, 0.6, 0); box.name = 'Würfel';
          for (const m of [ball, box]) { m.castShadow = m.receiveShadow = true; root.add(m); }
          return { root, dispose: () => { ball.geometry.dispose(); box.geometry.dispose(); mat.dispose(); root.removeFromParent(); } };
        },
      });
    }
  }
}

// --- Prozedurale Props aus models.js (nur Lesen; Import tolerant, falls die Datei gerade bearbeitet wird)
let MODELS = null, PROPS = null;
const PROP_PICK = [
  ['crate', 'Holzkiste'], ['barrier', 'Betonsperre'], ['hay', 'Heuballen'], ['tree', 'Laubbaum'], ['pine', 'Nadelbaum'], ['bigrock', 'Felsen'],
  ['fence', 'Zaun'], ['hedge', 'Hecke'], ['console', 'Alien-Konsole'], ['reactor', 'UFO-Reaktor'], ['pod', 'Alien-Kapsel'],
  ['car:sedan', 'Karten-Auto Limousine'], ['car:kombi', 'Karten-Auto Kombi'], ['car:suv', 'Karten-Auto SUV'], ['car:van', 'Karten-Lieferwagen'],
  ['car:pickup', 'Karten-Pick-up'], ['car:burnt', 'Autowrack'], ['car:tractor', 'Traktor'],
  ['furn:table', 'Tisch'], ['furn:sofa', 'Sofa'], ['furn:bed', 'Bett'], ['furn:shelf', 'Regal'],
  ['deco:bench', 'Parkbank'], ['deco:hydrant', 'Hydrant'], ['deco:lamp', 'Straßenlaterne'], ['deco:tlight', 'Ampel'], ['deco:bin', 'Mülleimer'],
  ['deco:mailbox', 'Briefkasten'], ['deco:cactus', 'Kaktus'], ['sandbag', 'Sandsackwall'], ['barrel', 'Fass'], ['fuelpump', 'Zapfsäule'],
  ['milwreck', 'Militärwrack'], ['statue', 'Statue'], ['pylon', 'Strommast'], ['watertank', 'Wassertank'], ['silo', 'Silo'],
  ['tent:dome', 'Kuppelzelt'], ['milcrate', 'Militärkiste'], ['oak', 'Eiche'], ['palm', 'Palme'], ['birch', 'Birke'], ['well', 'Brunnen'], ['fountain', 'Springbrunnen'],
];
const ALIEN_LABEL = { vael: 'Vael', krull: 'Krull', drone: 'Wächterdrohne', beast: 'Klauenbestie', hive: 'Hive-Kommandant' };
function disposeGeos(root) { root.traverse((o) => { if (o.isMesh) o.geometry?.dispose?.(); }); root.removeFromParent(); }
async function loadModels() {
  try {
    MODELS = await import('./models.js');
    if (typeof MODELS.propParts !== 'function') throw new Error('propParts fehlt');
    // Nebel-des-Krieges-Patch neutralisieren (weiße 1×1-Karte, außen = 1): Props erscheinen unverdunkelt
    const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true;
    if (MODELS.fogUniforms) { MODELS.fogUniforms.fogMap.value = white; MODELS.fogUniforms.fogOutside.value = 1; }
  } catch (e) { console.warn('Viewer: models.js nicht nutzbar – Kategorie „Props“ entfällt', e); MODELS = null; return; }
  const getParts = () => (PROPS ||= MODELS.propParts()).parts;
  let parts = null;
  try { parts = getParts(); } catch (e) { console.warn('Viewer: propParts() fehlgeschlagen', e); }
  if (parts) for (const [key, label] of PROP_PICK) {
    if (!(key in parts)) continue;
    const kind = key.startsWith('car:') && key !== 'car:tractor' && key !== 'car:burnt' ? 'vehicle-prop' : 'prop';
    addEntry({
      id: `prop:${key}`, cat: 'prop', grp: 'Karten-Props (propParts)', label, sub: `propParts().parts['${key}']`, kind, front: 1, opts: [],
      build() {
        const list = getParts()[key] || [];
        const root = new THREE.Group(); root.name = `prop_${key}`;
        list.forEach((p, i) => {
          const m = new THREE.Mesh(p.geo, p.mat); m.name = `${key}#${i}`; m.castShadow = p.shadow !== false; m.receiveShadow = true;
          if (p.mat?.vertexColors && !p.geo.attributes.color) { /* Instanzfarbe fehlt außerhalb von InstancedMesh – unkritisch */ }
          root.add(m);
        });
        return { root, dispose: () => root.removeFromParent() }; // Geometrien/Materialien gehören dem propParts-Cache
      },
    });
  }
  const units = [
    ['soldier', 'Soldat (alt)', 'character', () => MODELS.makeSoldier({ look: { skin: 0xe0ac69, hair: 0x2c1b10 } }, 0x4f5538, 'bullet')],
    ['civilian', 'Zivilist (alt)', 'character', () => MODELS.makeCivilian()],
    ...Object.entries(ALIEN_LABEL).map(([k, l]) => [`alien:${k}`, `Alien ${l}`, 'alien', () => MODELS.makeAlien(k)]),
    ['transport', 'Transporter (alt)', 'craft', () => MODELS.makeTransport()],
  ];
  for (const [k, label, kind, fn] of units) {
    const fname = { soldier: 'makeSoldier', civilian: 'makeCivilian', transport: 'makeTransport' }[k] || 'makeAlien';
    if (typeof MODELS[fname] !== 'function') continue;
    addEntry({
      id: `unit:${k}`, cat: 'prop', grp: 'Einheiten & Fahrzeuge (models.js, alt)', label, sub: `models.${fname}()`, kind, front: kind === 'craft' ? -1 : 1, opts: [],
      build() { const root = fn(); return { root, dispose: () => disposeGeos(root) }; },
    });
  }
}

// =====================================================================================================
// Statistik
// =====================================================================================================
const TEX_KEYS_UV = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap', 'alphaMap', 'lightMap', 'displacementMap',
  'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'sheenColorMap', 'sheenRoughnessMap', 'transmissionMap', 'thicknessMap',
  'specularIntensityMap', 'specularColorMap', 'iridescenceMap', 'iridescenceThicknessMap', 'anisotropyMap', 'specularMap'];
const matsOf = (o) => (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []);
const isDrawable = (o) => (o.isMesh || o.isLine || o.isPoints) && o.geometry?.attributes?.position;
function walkVisible(obj, fn, skipRootVis = false) {
  if (!skipRootVis && !obj.visible) return;
  fn(obj);
  for (const c of obj.children) walkVisible(c, fn);
}
function triCount(o) {
  const g = o.geometry; if (!o.isMesh || !g?.attributes?.position) return 0;
  let n = g.index ? g.index.count : g.attributes.position.count;
  if (Number.isFinite(g.drawRange?.count)) n = Math.min(n, g.drawRange.count);
  return (n / 3) * (o.isInstancedMesh ? o.count : 1);
}
function drawCalls(o) {
  if (Array.isArray(o.material)) return Math.max(1, (o.geometry.groups || []).filter((gr) => o.material[gr.materialIndex]?.visible !== false).length);
  return o.material?.visible === false ? 0 : 1;
}
function geomStats(obj, skipRootVis = false) {
  let triangles = 0, vertices = 0, meshes = 0, dc = 0;
  walkVisible(obj, (o) => {
    if (!isDrawable(o)) return;
    meshes++; triangles += triCount(o); vertices += o.geometry.attributes.position.count * (o.isInstancedMesh ? o.count : 1); dc += drawCalls(o);
  }, skipRootVis);
  return { triangles: Math.round(triangles), vertices, meshes, drawCalls: dc };
}
function texSize(t) {
  const im = t.image; if (!im) return null;
  if (Array.isArray(im)) { const f = im[0]; return f ? { w: f.width || f.image?.width || 0, h: f.height || f.image?.height || 0, faces: im.length } : null; }
  const w = im.width ?? im.videoWidth ?? 0, hh = im.height ?? im.videoHeight ?? 0;
  return w && hh ? { w, h: hh, depth: im.depth || 1, faces: 1 } : null;
}
function texBytes(t, s) {
  if (!s) return 0;
  if (t.isCompressedTexture && t.mipmaps?.length) return t.mipmaps.reduce((a, m) => a + (m.data?.byteLength || 0), 0) * (s.faces || 1);
  const bpc = { [THREE.UnsignedByteType]: 1, [THREE.ByteType]: 1, [THREE.HalfFloatType]: 2, [THREE.FloatType]: 4, [THREE.UnsignedShortType]: 2, [THREE.ShortType]: 2 }[t.type] || 1;
  const ch = { [THREE.RedFormat]: 1, [THREE.RedIntegerFormat]: 1, [THREE.RGFormat]: 2, [THREE.RGIntegerFormat]: 2, [THREE.AlphaFormat]: 1, [THREE.LuminanceFormat]: 1, [THREE.LuminanceAlphaFormat]: 2 }[t.format] || 4;
  const mip = t.generateMipmaps !== false && t.minFilter !== THREE.NearestFilter && t.minFilter !== THREE.LinearFilter ? 4 / 3 : 1;
  return Math.round(s.w * s.h * (s.depth || 1) * (s.faces || 1) * bpc * ch * mip);
}
const isPOT = (n) => n > 0 && (n & (n - 1)) === 0;
function collectMaterials(root, kind) {
  const mats = new Map(), texs = new Map();
  root.traverse((o) => {
    if (!isDrawable(o)) return;
    for (const m of matsOf(o)) {
      let e = mats.get(m.uuid);
      if (!e) {
        const slot = m.userData?.slot || (kind === 'vehicle' || kind === 'vehicle-prop' ? classifyMaterialName(m.name).slot : null);
        e = { name: m.name || '', type: m.type, slot: slot || '', meshes: 0, mat: m };
        mats.set(m.uuid, e);
        const addTex = (t, key) => {
          if (!t?.isTexture) return;
          let te = texs.get(t.uuid);
          if (!te) {
            const s = texSize(t);
            te = { name: t.name || '', w: s?.w || 0, h: s?.h || 0, bytes: texBytes(t, s), uses: [], tex: t, kind: t.isCanvasTexture ? 'Canvas' : t.isDataTexture ? 'Daten' : t.isCompressedTexture ? 'komprimiert' : 'Bild' };
            texs.set(t.uuid, te);
          }
          te.uses.push(`${m.name || m.type}.${key}`);
        };
        for (const k of Object.keys(m)) if (m[k]?.isTexture) addTex(m[k], k);
        if (m.uniforms) for (const [k, u] of Object.entries(m.uniforms)) if (u?.value?.isTexture) addTex(u.value, k);
      }
      e.meshes++;
    }
  });
  return { materials: [...mats.values()], textures: [...texs.values()] };
}
function countBones(root) {
  const bones = new Set(); let skinned = 0;
  root.traverse((o) => { if (o.isSkinnedMesh) { skinned++; o.skeleton?.bones.forEach((b) => bones.add(b)); } });
  if (!bones.size) root.traverse((o) => { if (o.isBone) bones.add(o); });
  return { bones: bones.size, skinned };
}
// Achsparallele Box der sichtbaren Meshes im Koordinatensystem des Eltern-Objekts (ohne Drehteller-Drehung)
function measureBox(root) {
  root.updateWorldMatrix(true, true);
  const inv = root.parent ? new THREE.Matrix4().copy(root.parent.matrixWorld).invert() : new THREE.Matrix4();
  const box = new THREE.Box3(), tmp = new THREE.Box3(), m = new THREE.Matrix4();
  walkVisible(root, (o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    try {
      if (o.isSkinnedMesh || o.isInstancedMesh) { o.computeBoundingBox(); tmp.copy(o.boundingBox); }
      else { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); tmp.copy(o.geometry.boundingBox); }
    } catch { return; }
    if (tmp.isEmpty() || !Number.isFinite(tmp.min.x + tmp.max.x + tmp.min.y + tmp.max.y)) return;
    box.union(tmp.applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld)));
  });
  return box;
}
function lodInfo(built) {
  if (built.lods) return built.lods;
  let lod = null;
  built.root.traverse((o) => { if (!lod && o.isLOD && o.levels.length > 1) lod = o; });
  if (lod) return { type: 'three', lod, levels: lod.levels.map((l, i) => ({ label: `LOD${i}`, object: l.object, distance: l.distance })) };
  const ul = built.root.userData?.lods;
  if (Array.isArray(ul) && ul.length > 1 && ul.every((o) => o?.isObject3D)) return { type: 'list', auto: 0, levels: ul.map((o, i) => ({ label: `LOD${i}`, object: o })) };
  return null;
}
function setLodLevel(built, sel) {
  const li = built?.lodInfo; if (!li) return;
  if (li.type === 'three') {
    li.lod.autoUpdate = sel === 'auto';
    if (sel === 'auto') li.lod.update(camera);
    else li.levels.forEach((l, i) => { l.object.visible = i === sel; });
  } else {
    const idx = sel === 'auto' ? li.auto || 0 : sel;
    li.levels.forEach((l, i) => { l.object.visible = i === idx; });
  }
  invalidate();
}
function activeLevel(built) {
  const li = built?.lodInfo; if (!li) return -1;
  const i = li.levels.findIndex((l) => l.object.visible);
  return i;
}
function computeStats(built) {
  const kind = built.entry.kind, root = built.root;
  const act = geomStats(root);
  const { materials, textures } = collectMaterials(root, kind);
  const li = built.lodInfo;
  const levels = li ? li.levels.map((l, i) => ({ label: l.label, distance: l.distance, index: i, ...geomStats(l.object, true) })) : [];
  const box = measureBox(root), size = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());
  const maxTex = textures.reduce((a, t) => (t.w * t.h > (a ? a.w * a.h : -1) ? t : a), null);
  return {
    ...act, materials, textures, texBytes: textures.reduce((a, t) => a + t.bytes, 0), maxTex, levels, active: activeLevel(built),
    tri0: levels.length ? levels[0].triangles : act.triangles, ...countBones(root), clips: built.clips || [],
    box, size: { x: size.x, y: size.y, z: size.z },
  };
}

// =====================================================================================================
// Prüfungen
// =====================================================================================================
function hasNaN(g) {
  for (const k of ['position', 'normal', 'uv', 'tangent']) {
    const a = g.attributes[k]; if (!a) continue;
    const arr = a.isInterleavedBufferAttribute ? a.data.array : a.array;
    if (!(arr instanceof Float32Array || arr instanceof Float64Array)) continue;
    for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) return k;
  }
  return null;
}
const needsNormals = (m) => !(m.isMeshBasicMaterial || m.isLineBasicMaterial || m.isPointsMaterial || m.isSpriteMaterial
  || (m.isShaderMaterial && !m.lights) || m.flatShading || m.isMeshDepthMaterial || m.isMeshDistanceMaterial);
const usesUvTex = (m) => TEX_KEYS_UV.some((k) => m[k]?.isTexture);
const list = (arr, n = 4) => arr.slice(0, n).join(', ') + (arr.length > n ? ` … (+${arr.length - n})` : '');
function scaleCheck(add, what, v, [lo, hi]) {
  const ok = v >= lo && v <= hi;
  const off = v < lo ? (lo - v) / lo : v > hi ? (v - hi) / hi : 0;
  add(ok ? 'ok' : off > RULES.scaleFail ? 'fail' : 'warn', `${what} ${fmtM(v)} m (plausibel ${fmtM(lo)}–${fmtM(hi)} m)`, 'Maßstab');
}
function runChecks(entry, built, st) {
  const R = [], add = (s, t, g) => R.push({ s, t, g });
  const root = built.root, kind = entry.kind;
  // Fahrzeuge: G2-Slotprüfung
  if (kind === 'vehicle' || kind === 'vehicle-prop') {
    const v = validateVehicle(root, { allowMissing: kind === 'vehicle-prop' });
    if (kind === 'vehicle-prop') {
      // Karten-Props (instanzierte Sammelgeometrie) folgen der Slot-Konvention nicht: ein zusammengefasster Hinweis
      const miss = v.warnings.map((w) => w.match(/^Pflicht-Slot "(\w+)" fehlt/)?.[1]).filter(Boolean);
      v.errors.forEach((e) => add('fail', e, 'Fahrzeug'));
      add(miss.length ? 'warn' : 'ok', miss.length ? `Karten-Prop ohne G2-Slots (fehlen: ${miss.join(', ')}) – für Hero-Darstellung herocar.js/GLB nutzen` : 'Slots vorhanden', 'Fahrzeug');
    } else {
    if (v.ok) add('ok', `validateVehicle: Slots getrennt – ${v.stats.materials} Materialien (${Object.keys(v.slots).join(', ')})`, 'Fahrzeug');
    v.errors.forEach((e) => add('fail', e, 'Fahrzeug'));
    const optMissing = [];
    for (const w of v.warnings) {
      const m = w.match(/^Optionaler Slot "(\w+)"/);
      if (m) { if (m[1] !== 'beacon') optMissing.push(m[1]); continue; }
      add('warn', w, 'Fahrzeug');
    }
    if (optMissing.length) add('warn', `Optionale Slots fehlen: ${optMissing.join(', ')}`, 'Fahrzeug');
    for (const [s, names] of Object.entries(v.slots)) if (names.length > 1) add('warn', `Slot „${s}“ doppelt belegt (${names.length}×): ${list(names)}`, 'Fahrzeug');
    }
  }
  // Geometrie: Normalen, UVs, NaN
  const noN = [], noUvTex = [], noUv = [], nan = [], seen = new Set();
  let meshCount = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    meshCount++;
    const g = o.geometry, ms = matsOf(o), nm = o.name || g.name || o.type;
    if (!g.attributes.normal && ms.some(needsNormals)) noN.push(nm);
    if (!g.attributes.uv) {
      if (ms.some(usesUvTex)) noUvTex.push(nm);
      else if (ms.some(needsNormals)) noUv.push(nm); // unbeleuchtete Effekt-Meshes (Glühen, Leuchten) brauchen keine UVs
    }
    if (!seen.has(g.uuid)) { seen.add(g.uuid); const k = hasNaN(g); if (k) nan.push(`${nm} (${k})`); }
  });
  add(noN.length ? 'fail' : 'ok', noN.length ? `${noN.length} Meshes ohne Normalen: ${list(noN)}` : `Normalen vorhanden (${meshCount} Meshes)`, 'Geometrie');
  if (noUvTex.length) add('fail', `${noUvTex.length} Meshes mit Textur, aber ohne UVs: ${list(noUvTex)}`, 'Geometrie');
  if (noUv.length) add('warn', `${noUv.length} Meshes ohne UVs (keine Textur möglich): ${list(noUv)}`, 'Geometrie');
  if (!noUvTex.length && !noUv.length) add('ok', 'UVs vorhanden', 'Geometrie');
  add(nan.length ? 'fail' : 'ok', nan.length ? `NaN/∞ in der Geometrie: ${list(nan)}` : 'keine NaN/∞-Werte in Position/Normale/UV', 'Geometrie');
  // Dreiecke / LOD
  const nl = st.levels.length;
  if (nl > 1) add('ok', `LOD: ${nl} Stufen (${st.levels.map((l) => fmtInt(l.triangles)).join(' / ')} Δ)`, 'Leistung');
  else if (st.tri0 > RULES.triNoLod) add('warn', `${fmtInt(st.tri0)} Dreiecke ohne LOD (Grenze ${fmtInt(RULES.triNoLod)})`, 'Leistung');
  else add('ok', `${fmtInt(st.tri0)} Dreiecke – ohne LOD unkritisch`, 'Leistung');
  // Materialien
  const unnamed = st.materials.filter((m) => !m.name);
  if (unnamed.length) {
    const types = {}; unnamed.forEach((m) => { types[m.type] = (types[m.type] || 0) + 1; });
    add('warn', `${unnamed.length} von ${st.materials.length} Materialien ohne Namen (${Object.entries(types).map(([t, n]) => `${t} ×${n}`).join(', ')})`, 'Materialien');
  } else add('ok', `alle ${st.materials.length} Materialien benannt`, 'Materialien');
  // Texturen
  const npot = st.textures.filter((t) => t.w && (!isPOT(t.w) || !isPOT(t.h)));
  const big = st.textures.filter((t) => t.w > RULES.texMax || t.h > RULES.texMax);
  if (!st.textures.length) add('ok', 'keine Texturen', 'Texturen');
  else {
    add(npot.length ? 'warn' : 'ok', npot.length ? `${npot.length} Texturen ohne Zweierpotenz: ${list(npot.map((t) => `${t.name || t.uses[0]} ${t.w}×${t.h}`), 3)}` : `${st.textures.length} Texturen, alle Zweierpotenz`, 'Texturen');
    add(big.length ? 'warn' : 'ok', big.length ? `${big.length} Texturen > ${RULES.texMax}: ${list(big.map((t) => `${t.name || t.uses[0]} ${t.w}×${t.h}`), 3)}` : `max. ${st.maxTex ? `${st.maxTex.w}×${st.maxTex.h}` : '–'} (≤ ${RULES.texMax})`, 'Texturen');
  }
  // Maßstab
  if (kind === 'vehicle' || kind === 'vehicle-prop') scaleCheck(add, 'Fahrzeuglänge', Math.max(st.size.x, st.size.z), entry.lenRange || RULES.carLen);
  else if (kind === 'character') scaleCheck(add, 'Figurhöhe', st.size.y, RULES.figH);
  return R;
}
const worst = (checks) => checks.reduce((a, c) => (STATUS_RANK[c.s] > STATUS_RANK[a] ? c.s : a), 'ok');

// =====================================================================================================
// Auswahl / Laden
// =====================================================================================================
let current = null;             // { entry, root, lodInfo, stats, checks, bounds, … }
let loadToken = 0;
const optState = new Map();     // entry.id -> Optionswerte
function optsFor(e) {
  if (!optState.has(e.id)) optState.set(e.id, Object.fromEntries((e.opts || []).map((o) => [o.k, o.def])));
  return optState.get(e.id);
}
const defaultsFor = (e) => Object.fromEntries((e.opts || []).map((o) => [o.k, o.def]));

const origMat = new WeakMap(); // Mesh -> Originalmaterial
const wireOrig = new Map();    // Material -> ursprüngliches wireframe
function applyViewMode() {
  if (!current) return;
  current.root.traverse((o) => {
    if (!o.isMesh) return;
    if (!origMat.has(o)) origMat.set(o, o.material);
    const orig = origMat.get(o);
    if (state.view === 'shaded' || !VIEW_MATS[state.view]) o.material = orig;
    else { const dm = VIEW_MATS[state.view]; o.material = Array.isArray(orig) ? orig.map(() => dm) : dm; }
    for (const m of matsOf(o)) {
      if (m === VIEW_MATS.normals || m === VIEW_MATS.uv) continue;
      if (!wireOrig.has(m)) wireOrig.set(m, m.wireframe);
      m.wireframe = state.wire ? true : wireOrig.get(m);
    }
  });
  VIEW_MATS.normals.wireframe = VIEW_MATS.uv.wireframe = state.wire;
  $('#vw-quick-view').textContent = VIEW_LABELS[state.view] || state.view;
  document.querySelectorAll('#vw-quick [data-quick]').forEach((b) => {
    const q = b.dataset.quick; b.classList.toggle('on', (q === 'turntable' && state.turntable) || (q === 'wire' && state.wire) || (q === 'view' && state.view !== 'shaded'));
  });
  invalidate();
}
function restoreMaterials(root) {
  root.traverse((o) => { if (o.isMesh && origMat.has(o)) { o.material = origMat.get(o); origMat.delete(o); } });
  for (const [m, w] of wireOrig) m.wireframe = w;
  wireOrig.clear();
}
function unloadCurrent() {
  if (!current) return;
  try { restoreMaterials(current.root); } catch { /* */ }
  try { current.dispose?.(); } catch (e) { console.warn('Viewer: dispose', e); }
  current.root.removeFromParent();
  current = null;
}
function fitDistance(r) {
  const vf = THREE.MathUtils.degToRad(camera.fov), hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
  return (r / Math.sin(Math.min(vf, hf) / 2)) * 1.08;
}
function frameCamera(b, front = 1, keepDir = false) {
  const dist = fitDistance(b.radius);
  const dir = keepDir ? new THREE.Vector3().subVectors(camera.position, controls.target).normalize() : new THREE.Vector3(0.95, 0.42, 1.25 * (front >= 0 ? 1 : -1)).normalize();
  camera.near = Math.max(0.01, b.radius / 200); camera.far = Math.max(200, b.radius * 60); camera.updateProjectionMatrix();
  camera.position.copy(b.center).addScaledVector(dir, dist);
  controls.target.copy(b.center);
  controls.minDistance = b.radius * 0.3; controls.maxDistance = b.radius * 20;
  controls.update(); invalidate();
}
function computeBounds(root) {
  const box = measureBox(root);
  if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
  const sph = box.getBoundingSphere(new THREE.Sphere());
  const ctr = sph.center.clone().applyMatrix4(holder.matrixWorld);
  return { box, center: ctr, radius: Math.max(0.2, sph.radius) };
}

async function select(id, { keepCamera = false } = {}) {
  const e = byId.get(id); if (!e) return null;
  const tok = ++loadToken;
  setLoading(`Lade ${e.label} …`);
  markListSelection(id);
  let built;
  const t0 = performance.now();
  try {
    built = await e.build(optsFor(e));
  } catch (err) {
    if (tok !== loadToken) return null;
    console.error('Viewer: Laden fehlgeschlagen', id, err);
    unloadCurrent();
    showLoadError(e, err);
    setLoading(null);
    return null;
  }
  if (tok !== loadToken) { try { built.dispose?.(); } catch { /* */ } return null; }
  unloadCurrent();
  current = Object.assign(built, { entry: e, ms: performance.now() - t0 });
  current.lodInfo = lodInfo(current);
  holder.rotation.set(0, 0, 0); holder.position.set(0, 0, 0); holder.updateMatrixWorld(true);
  holder.add(current.root);
  if (current.lodInfo?.type === 'three') current.lodInfo.lod.update(camera);
  setLodLevel(current, 'auto'); state.lodSel = 'auto';
  // auf den Boden stellen (Figuren stehen bereits mit den Füßen auf y = 0)
  const b0 = measureBox(current.root);
  if (!b0.isEmpty() && e.kind !== 'character' && Math.abs(b0.min.y) > 0.01) holder.position.y = -b0.min.y;
  holder.updateMatrixWorld(true);
  current.bounds = computeBounds(current.root);
  if (!keepCamera) frameCamera(current.bounds, e.front);
  if (current.lodInfo?.type === 'three') { current.lodInfo.lod.update(camera); }
  current.lastLevel = activeLevel(current);
  fitSun(); sizeFloor();
  applyViewMode();
  current.stats = computeStats(current);
  current.checks = runChecks(e, current, current.stats);
  e.status = worst(current.checks);
  renderInfo();
  updateListStatus(e);
  $('#vw-asset-name').textContent = e.label;
  $('#vw-asset-sub').textContent = `${CATS[e.cat]} · ${e.sub}`;
  try { const u = new URL(location.href); u.searchParams.set('a', id); history.replaceState(null, '', u); } catch { /* */ }
  setLoading(null);
  invalidate();
  return current;
}
function showLoadError(e, err) {
  e.status = 'fail'; updateListStatus(e);
  $('#vw-asset-name').textContent = e.label; $('#vw-asset-sub').textContent = 'Laden fehlgeschlagen';
  $('#vw-checks').innerHTML = `<ul class="vw-checks"><li><span class="s s-fail">✗</span><span>Laden fehlgeschlagen: ${esc(err?.message || err)}</span></li></ul>`;
  for (const s of ['#vw-stats', '#vw-lod', '#vw-anim', '#vw-mats', '#vw-tex', '#vw-opts']) $(s).innerHTML = '';
  renderOptions(e);
}
async function rebuildCurrent() { if (current) await select(current.entry.id, { keepCamera: true }); }
function setLod(sel) {
  if (!current?.lodInfo) return;
  state.lodSel = sel;
  setLodLevel(current, sel);
  current.stats = computeStats(current);
  current.lastLevel = current.stats.active;
  renderStats(); renderLod();
}

// =====================================================================================================
// Oberfläche
// =====================================================================================================
function setStatus(msg) {
  const parts = [];
  if (msg) parts.push(msg);
  if (envLoading > 0) parts.push(`HDRI „${ENV_LABEL(state.env)}“ wird geladen …`);
  $('#vw-status').textContent = parts.join(' · ') || `${entries.length} Assets · ${controlsKind} · ${ENV_LABEL(state.env)} · ${TONEMAPS[state.tone]?.label || state.tone}`;
}
function setLoading(msg) {
  const el = $('#vw-loading'); el.hidden = !msg; if (msg) $('#vw-loading-txt').textContent = msg;
}

// --- Liste
function renderCats() {
  const counts = { all: entries.length };
  entries.forEach((e) => { counts[e.cat] = (counts[e.cat] || 0) + 1; });
  const box = $('#vw-cats'); box.innerHTML = '';
  for (const [k, l] of [['all', 'Alle'], ...Object.entries(CATS)]) {
    if (k !== 'all' && !counts[k]) continue;
    box.append(h('button', { class: 'vw-chip' + (state.cat === k ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': state.cat === k ? 'true' : 'false', 'data-cat': k,
      onclick: () => { state.cat = k; renderCats(); renderList(); } }, l, h('span', { class: 'n' }, counts[k] || 0)));
  }
}
function matches(e) {
  if (state.cat !== 'all' && e.cat !== state.cat) return false;
  const q = state.query.trim().toLowerCase(); if (!q) return true;
  return q.split(/\s+/).every((w) => `${e.label} ${e.sub} ${e.id} ${CATS[e.cat]} ${e.grp} ${e.kind}`.toLowerCase().includes(w));
}
function renderList() {
  const ul = $('#vw-items'); ul.innerHTML = '';
  let lastGrp = null, n = 0;
  for (const e of entries) {
    if (!matches(e)) continue;
    n++;
    if (e.grp !== lastGrp) { ul.append(h('li', { class: 'grp' }, e.grp)); lastGrp = e.grp; }
    ul.append(h('li', { class: 'vw-item' + (current?.entry === e ? ' on' : ''), 'data-id': e.id, tabindex: '0', role: 'button',
      onclick: () => { select(e.id); if (innerWidth <= 820) togglePanel('list', false); },
      onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(e.id); } } },
    h('span', { class: 'nm' }, e.label, h('span', { class: 'sub' }, e.sub)),
    h('span', { class: 'st' + (e.status ? ` s-${e.status}` : ''), title: 'Prüfergebnis' }, e.status ? STATUS_ICON[e.status] : '')));
  }
  $('#vw-count').textContent = `${n} von ${entries.length} Assets`;
}
function markListSelection(id) { document.querySelectorAll('.vw-item').forEach((li) => li.classList.toggle('on', li.dataset.id === id)); }
function updateListStatus(e) {
  const li = document.querySelector(`.vw-item[data-id="${CSS.escape(e.id)}"] .st`);
  if (li) { li.className = 'st' + (e.status ? ` s-${e.status}` : ''); li.textContent = e.status ? STATUS_ICON[e.status] : ''; }
}

// --- Optionen des Assets
function renderOptions(e) {
  const box = $('#vw-opts'); box.innerHTML = '';
  const o = optsFor(e);
  if (!(e.opts || []).length) box.append(h('p', { class: 'muted' }, 'Keine Optionen für dieses Asset.'));
  for (const op of e.opts || []) {
    const id = `opt-${op.k}`;
    const commit = (v) => {
      o[op.k] = v;
      if (op.live && current?.entry === e && current.live) { current.live(o); invalidate(); } else rebuildCurrent();
    };
    let input;
    if (op.type === 'bool') input = h('label', { class: 'vw-check' }, h('input', { type: 'checkbox', id, checked: !!o[op.k], onchange: (ev) => commit(ev.target.checked) }), 'an');
    else if (op.type === 'select') input = h('select', { id, onchange: (ev) => commit(ev.target.value) }, op.options.map(([v, l]) => h('option', { value: v, selected: o[op.k] === v }, l)));
    else if (op.type === 'range') {
      const val = h('span', { class: 'val' }, nf2.format(+o[op.k]));
      input = h('div', {}, h('input', { type: 'range', id, min: op.min, max: op.max, step: op.step, value: o[op.k], oninput: (ev) => { val.textContent = nf2.format(+ev.target.value); if (op.live) commit(+ev.target.value); }, onchange: (ev) => { if (!op.live) commit(+ev.target.value); } }), val);
    } else if (op.type === 'color') {
      const inp = h('input', { type: 'color', id, value: o[op.k], onchange: (ev) => commit(ev.target.value) });
      input = h('div', {}, inp, op.swatches ? h('div', { class: 'vw-swatches' }, op.swatches.map((c) => h('button', { type: 'button', title: c, style: `background:${c}`, onclick: () => { inp.value = c; commit(c); } }))) : null);
    } else input = h('input', { type: 'number', id, value: o[op.k], step: 1, onchange: (ev) => commit(+ev.target.value) });
    box.append(h('div', { class: 'vw-row' }, h('label', { for: id }, op.label), input));
  }
  box.append(h('div', { class: 'vw-btns' },
    h('button', { class: 'btn x', type: 'button', onclick: () => { optState.delete(e.id); renderOptions(e); rebuildCurrent(); } }, 'Zurücksetzen'),
    h('button', { class: 'btn x', type: 'button', onclick: () => rebuildCurrent() }, 'Neu erzeugen')));
}

// --- Statistik
function renderStats() {
  const s = current?.stats, box = $('#vw-stats'); box.innerHTML = ''; if (!s) return;
  const lvl = s.levels.length ? ` (Stufe ${s.levels[s.active]?.label ?? '–'})` : '';
  const rows = [
    ['Dreiecke' + lvl, fmtInt(s.triangles)],
    ['Vertices', fmtInt(s.vertices)],
    ['Meshes / Draw-Calls', `${fmtInt(s.meshes)} / ${fmtInt(s.drawCalls)}`],
    ['Materialien (eindeutig)', fmtInt(s.materials.length)],
    ['Texturen (eindeutig)', `${fmtInt(s.textures.length)} · ≈ ${fmtBytes(s.texBytes)} GPU`],
    ['Höchste Texturauflösung', s.maxTex ? h('span', {}, `${s.maxTex.w} × ${s.maxTex.h}`, h('span', { class: 'tag hi' }, 'max')) : '–'],
    ['LOD-Stufen', s.levels.length ? `${s.levels.length}: ${s.levels.map((l) => `${l.label} ${fmtInt(l.triangles)} Δ`).join(' · ')}` : 'keine'],
    ['Bones / Skinned Meshes', `${fmtInt(s.bones)} / ${fmtInt(s.skinned)}`],
    ['Animationsclips', fmtInt(s.clips.length)],
    ['Maße B × H × T', `${fmtM(s.size.x)} × ${fmtM(s.size.y)} × ${fmtM(s.size.z)} m`],
    ['Erzeugung/Laden', `${fmtInt(current.ms)} ms`],
  ];
  box.append(h('table', { class: 'vw-kv', id: 'vw-stats-table' }, h('tbody', {}, rows.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', { class: 'num' }, v))))));
  $('#sec-mats summary').innerHTML = `Materialien <span class="badge muted">${s.materials.length}</span>`;
  $('#sec-tex summary').innerHTML = `Texturen <span class="badge muted">${s.textures.length} · ${fmtBytes(s.texBytes)}</span>`;
  // Materialliste
  const mb = $('#vw-mats'); mb.innerHTML = '';
  mb.append(h('table', { class: 'vw-mini' }, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Typ'), h('th', {}, 'Slot'), h('th', { class: 'num' }, 'Meshes'))),
    h('tbody', {}, s.materials.map((m) => h('tr', {}, h('td', { class: m.name ? '' : 'warn' }, m.name || '(ohne Namen)'), h('td', {}, m.type.replace(/^Mesh|Material$/g, '')), h('td', {}, m.slot || '–'), h('td', { class: 'num' }, m.meshes))))));
  // Texturliste
  const tb = $('#vw-tex'); tb.innerHTML = '';
  if (!s.textures.length) tb.append(h('p', { class: 'muted' }, 'Keine Texturen.'));
  else {
    const sorted = [...s.textures].sort((a, b) => b.w * b.h - a.w * a.h);
    tb.append(h('table', { class: 'vw-mini' }, h('thead', {}, h('tr', {}, h('th', {}, 'Textur / Verwendung'), h('th', { class: 'num' }, 'B × H'), h('th', { class: 'num' }, 'GPU ≈'))),
      h('tbody', {}, sorted.map((t) => h('tr', { class: t === s.maxTex ? 'hi' : '' },
        h('td', {}, t.name || t.kind, h('span', { class: 'sub muted', style: 'display:block;font-size:.85em' }, list(t.uses, 3))),
        h('td', { class: 'num' }, `${t.w} × ${t.h}`, !isPOT(t.w) || !isPOT(t.h) ? h('span', { class: 'tag' }, 'NPOT') : null),
        h('td', { class: 'num' }, fmtBytes(t.bytes)))))),
    h('p', { class: 'muted' }, `Summe ≈ ${fmtBytes(s.texBytes)} (RGBA8 + Mipmaps geschätzt; geteilte Texturen einfach gezählt).`));
  }
}
function renderLod() {
  const s = current?.stats, box = $('#vw-lod'); box.innerHTML = ''; if (!s) return;
  const li = current.lodInfo;
  if (!li) { box.append(h('p', { class: 'muted' }, 'Keine LOD-Stufen (weder THREE.LOD noch userData.lods/autoLod-Varianten).')); return; }
  const src = li.type === 'three' ? 'THREE.LOD' : li.type === 'variants' ? `autoLod-Varianten (Gerät: ${autoLod()})` : 'userData.lods';
  box.append(h('p', { class: 'muted' }, `Quelle: ${src}`));
  box.append(h('table', { class: 'vw-mini', id: 'vw-lod-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Stufe'), h('th', { class: 'num' }, 'Distanz'), h('th', { class: 'num' }, 'Dreiecke'), h('th', { class: 'num' }, 'Vertices'), h('th', { class: 'num' }, 'Draw-Calls'))),
    h('tbody', {}, s.levels.map((l, i) => h('tr', { class: 'click' + (i === s.active ? ' cur' : ''), onclick: () => setLod(i) },
      h('td', {}, l.label), h('td', { class: 'num' }, l.distance != null ? `${fmtInt(l.distance)} m` : '–'), h('td', { class: 'num' }, fmtInt(l.triangles)),
      h('td', { class: 'num' }, fmtInt(l.vertices)), h('td', { class: 'num' }, fmtInt(l.drawCalls)))))));
  box.append(h('div', { class: 'vw-btns' },
    h('button', { class: 'btn x' + (state.lodSel === 'auto' ? ' on' : ''), type: 'button', onclick: () => setLod('auto') }, 'Auto'),
    s.levels.map((l, i) => h('button', { class: 'btn x' + (state.lodSel === i ? ' on' : ''), type: 'button', 'data-lod': i, onclick: () => setLod(i) }, l.label))));
}
function renderAnim() {
  const s = current?.stats, box = $('#vw-anim'); box.innerHTML = ''; if (!s) return;
  box.append(h('table', { class: 'vw-kv' }, h('tbody', {},
    h('tr', {}, h('td', {}, 'Bones'), h('td', { class: 'num' }, fmtInt(s.bones))),
    h('tr', {}, h('td', {}, 'Skinned Meshes'), h('td', { class: 'num' }, fmtInt(s.skinned))),
    h('tr', {}, h('td', {}, 'Clips'), h('td', { class: 'num' }, fmtInt(s.clips.length))))));
  if (current.character) box.append(h('p', { class: 'muted' }, 'Zustände (setState) unter „Asset-Optionen“; Clips unten spielen die Rohanimation ab.'));
  if (!s.clips.length) return;
  const btns = h('div', { class: 'vw-btns', id: 'vw-clips' });
  const stop = h('button', { class: 'btn x', type: 'button', onclick: () => { current.stopClip?.(); current.activeClip = null; renderAnim(); invalidate(); } }, '■ Stopp');
  btns.append(stop);
  for (const c of s.clips) {
    btns.append(h('button', { class: 'btn x' + (current.activeClip === c.name ? ' on' : ''), type: 'button', 'data-clip': c.name, title: `${c.tracks.length} Spuren`,
      onclick: () => { playClip(c.name); } }, `▶ ${c.name} (${nf2.format(c.duration)} s)`));
  }
  box.append(btns);
}
function playClip(name) {
  const c = current?.clips?.find((x) => x.name === name); if (!c || !current.playClip) return false;
  current.playClip(c); current.activeClip = name; renderAnim(); invalidate(); return true;
}
function renderChecks() {
  const box = $('#vw-checks'); box.innerHTML = ''; if (!current?.checks) return;
  const w = worst(current.checks);
  $('#sec-checks summary').innerHTML = `Prüfungen <span class="badge s-${w}">${STATUS_ICON[w]} ${current.checks.filter((c) => c.s === 'fail').length} ✗ · ${current.checks.filter((c) => c.s === 'warn').length} ⚠</span>`;
  box.append(h('ul', { class: 'vw-checks', id: 'vw-check-list' }, current.checks.map((c) => h('li', { 'data-s': c.s },
    h('span', { class: `s s-${c.s}` }, STATUS_ICON[c.s]), h('span', {}, h('span', { class: 'grp' }, c.g), c.t)))));
}
function renderInfo() {
  if (!current) return;
  renderOptions(current.entry); renderStats(); renderLod(); renderChecks(); renderAnim();
}

// --- Ansicht & Licht
function renderViewOpts() {
  const box = $('#vw-viewopts'); box.innerHTML = '';
  const row = (label, input) => box.append(h('div', { class: 'vw-row' }, h('label', {}, label), input));
  const sel = (key, opts, after) => h('select', { 'data-key': key, onchange: (ev) => { state[key] = ev.target.value; savePrefs(); after(); } }, opts.map(([v, l]) => h('option', { value: v, selected: state[key] === v }, l)));
  const rng = (key, min, max, step, after, fmt = (v) => nf2.format(v)) => {
    const val = h('span', { class: 'val' }, fmt(state[key]));
    return h('div', {}, h('input', { type: 'range', min, max, step, value: state[key], 'data-key': key, oninput: (ev) => { state[key] = +ev.target.value; val.textContent = fmt(state[key]); after(); }, onchange: savePrefs }), val);
  };
  const chk = (key, after) => h('label', { class: 'vw-check' }, h('input', { type: 'checkbox', 'data-key': key, checked: !!state[key], onchange: (ev) => { state[key] = ev.target.checked; savePrefs(); after(); } }), 'an');
  row('Umgebung (HDRI)', sel('env', Object.keys(ENVIRONMENTS).map((k) => [k, ENV_LABEL(k)]), applyEnv));
  row('Hintergrund', sel('bg', [['blurred', 'HDRI unscharf'], ['sky', 'HDRI scharf'], ['none', 'einfarbig']], applyEnv));
  row('HDRI-Auflösung', sel('hdriQ', [['1k', '1K'], ['2k', '2K'], ['off', 'aus (prozedural)']], applyEnv));
  row('Tonemapping', sel('tone', Object.entries(TONEMAPS).map(([k, t]) => [k, t.label]), () => { applyTone(); setStatus(); }));
  row('Belichtung', rng('exposure', 0.2, 3, 0.05, applyTone));
  row('Umgebungsintensität', rng('envInt', 0, 3, 0.05, () => { scene.environmentIntensity = state.envInt; if (state.bg !== 'none') scene.backgroundIntensity = state.envInt; invalidate(); }));
  row('HDRI-Drehung', rng('envRot', 0, Math.PI * 2, 0.05, () => { scene.environmentRotation?.set(0, state.envRot, 0); scene.backgroundRotation?.set(0, state.envRot, 0); updateSun(); }, (v) => `${nf0.format(v * 180 / Math.PI)}°`));
  row('Sonne (Schattenlicht)', rng('sunInt', 0, 3, 0.05, updateSun));
  row('Schatten', chk('shadows', () => { renderer.shadowMap.enabled = state.shadows; sun.castShadow = state.shadows; scene.traverse((o) => { if (o.isMesh) matsOf(o).forEach((m) => { m.needsUpdate = true; }); }); invalidate(); }));
  row('Boden', sel('floor', Object.entries(FLOORS).map(([k, f]) => [k, f.label]), applyFloor));
  row('Bloom', chk('bloom', invalidate));
  row('Drehteller', chk('turntable', () => { applyViewMode(); }));
  row('Drahtgitter', chk('wire', applyViewMode));
  row('Darstellung', sel('view', Object.entries(VIEW_LABELS), applyViewMode));
  box.append(h('p', { class: 'muted' }, `Steuerung: ${controlsKind}. Maus: links drehen, rechts/Shift verschieben, Rad zoomen. Touch: 1 Finger drehen, 2 Finger zoomen/verschieben. Tasten: T Drehteller, W Drahtgitter, V Ansicht, F Zentrieren, / Suche.`));
}
function syncViewOptInputs() {
  document.querySelectorAll('#vw-viewopts [data-key]').forEach((el) => {
    const k = el.dataset.key; if (el.type === 'checkbox') el.checked = !!state[k]; else el.value = state[k];
  });
}

// --- Panels ein-/ausklappen
function togglePanel(which, force) {
  const cls = which === 'list' ? 'list-collapsed' : 'info-collapsed';
  const open = force ?? document.body.classList.contains(cls);
  document.body.classList.toggle(cls, !open);
  if (open && innerWidth <= 820) document.body.classList.add(which === 'list' ? 'info-collapsed' : 'list-collapsed');
  $('#vw-btn-list').setAttribute('aria-expanded', String(!document.body.classList.contains('list-collapsed')));
  $('#vw-btn-info').setAttribute('aria-expanded', String(!document.body.classList.contains('info-collapsed')));
  setTimeout(() => { resize(); if (current && innerWidth <= 820) frameCamera(current.bounds, current.entry.front, true); }, 240);
}

// =====================================================================================================
// „Alle prüfen“
// =====================================================================================================
let results = [];
let checking = false;
function rowFromCheck(e, st, ch, ms) {
  const fails = ch.filter((c) => c.s === 'fail'), warns = ch.filter((c) => c.s === 'warn');
  return {
    id: e.id, label: e.label, cat: CATS[e.cat], kind: e.kind, status: worst(ch), tri0: st.tri0, triangles: st.triangles, drawCalls: st.drawCalls,
    materials: st.materials.length, textures: st.textures.length, texBytes: st.texBytes, maxTex: st.maxTex ? `${st.maxTex.w}×${st.maxTex.h}` : '–',
    lods: st.levels.length, lodTris: st.levels.map((l) => l.triangles), bones: st.bones, clips: st.clips.length,
    size: [st.size.x, st.size.y, st.size.z].map((v) => +v.toFixed(2)), fails: fails.length, warns: warns.length,
    msgs: [...fails, ...warns].map((c) => `${STATUS_ICON[c.s]} ${c.t}`), ms: Math.round(ms),
  };
}
async function checkEntry(e) {
  const t0 = performance.now();
  let b = null;
  try {
    b = await e.build(defaultsFor(e));
    b.entry = e; b.lodInfo = lodInfo(b);
    if (b.lodInfo) setLodLevel(b, 0);
    b.update?.(1 / 60, 0);
    b.root.updateMatrixWorld(true);
    const st = computeStats(b), ch = runChecks(e, b, st);
    e.status = worst(ch);
    return rowFromCheck(e, st, ch, performance.now() - t0);
  } catch (err) {
    console.warn('Viewer: Prüfung fehlgeschlagen', e.id, err);
    e.status = 'fail';
    return { id: e.id, label: e.label, cat: CATS[e.cat], kind: e.kind, status: 'fail', tri0: 0, triangles: 0, drawCalls: 0, materials: 0, textures: 0, texBytes: 0, maxTex: '–', lods: 0, lodTris: [], bones: 0, clips: 0, size: [0, 0, 0], fails: 1, warns: 0, msgs: [`✗ Laden fehlgeschlagen: ${err?.message || err}`], ms: Math.round(performance.now() - t0) };
  } finally {
    if (b) { try { b.dispose?.(); } catch { /* */ } b.root?.removeFromParent(); }
  }
}
function renderTable() {
  const only = $('#vw-only-issues').checked;
  const rows = results.filter((r) => !only || r.status !== 'ok');
  const t = $('#vw-table'); t.innerHTML = '';
  t.append(h('thead', {}, h('tr', {}, ['', 'Asset', 'Kategorie', 'Δ (LOD0)', 'LOD-Stufen', 'Draw-Calls', 'Mat.', 'Tex. (max)', 'Maße B×H×T (m)', 'Befunde'].map((c) => h('th', {}, c)))));
  t.append(h('tbody', {}, rows.map((r) => h('tr', { 'data-id': r.id, onclick: () => { closeModal(); select(r.id); } },
    h('td', { class: `st s-${r.status}` }, STATUS_ICON[r.status]), h('td', {}, r.label), h('td', {}, r.cat),
    h('td', { class: 'num' }, fmtInt(r.tri0)), h('td', { class: 'num' }, r.lods ? `${r.lods} (${r.lodTris.map(fmtInt).join(' / ')})` : '–'),
    h('td', { class: 'num' }, fmtInt(r.drawCalls)), h('td', { class: 'num' }, r.materials), h('td', { class: 'num' }, `${r.textures} (${r.maxTex})`),
    h('td', { class: 'num' }, r.size.map(fmtM).join(' × ')), h('td', { class: 'msg' }, r.msgs.length ? r.msgs.slice(0, 4).join(' · ') + (r.msgs.length > 4 ? ` · … (+${r.msgs.length - 4})` : '') : '–')))));
}
function summaryText() {
  const c = { ok: 0, warn: 0, fail: 0 }; results.forEach((r) => { c[r.status]++; });
  return `${results.length} Assets geprüft: ${c.ok} ✓ · ${c.warn} ⚠ · ${c.fail} ✗`;
}
async function checkAll() {
  if (checking) return results;
  checking = true;
  results = [];
  openModal();
  const bar = $('#vw-progress > div');
  const todo = entries.slice();
  const t0 = performance.now();
  for (let i = 0; i < todo.length; i++) {
    const e = todo[i];
    $('#vw-summary').textContent = `Prüfe ${i + 1}/${todo.length}: ${e.label} …`;
    bar.style.width = `${(i / todo.length) * 100}%`;
    await nextFrame();
    results.push(await checkEntry(e));
    updateListStatus(e);
    if (i % 4 === 3 || i === todo.length - 1) renderTable();
  }
  bar.style.width = '100%';
  $('#vw-summary').textContent = `${summaryText()} · ${nf2.format((performance.now() - t0) / 1000)} s`;
  renderTable();
  checking = false;
  window.__viewer.results = results;
  return results;
}
function resultsMarkdown() {
  const lines = ['| | Asset | Kategorie | Δ (LOD0) | LOD-Stufen | Draw-Calls | Mat. | Tex. (max) | Maße B×H×T (m) | Befunde |', '|---|---|---|---:|---|---:|---:|---|---|---|'];
  for (const r of results) {
    lines.push(`| ${STATUS_ICON[r.status]} | ${r.label} | ${r.cat} | ${fmtInt(r.tri0)} | ${r.lods ? `${r.lods} (${r.lodTris.map(fmtInt).join(' / ')})` : '–'} | ${r.drawCalls} | ${r.materials} | ${r.textures} (${r.maxTex}) | ${r.size.map(fmtM).join(' × ')} | ${(r.msgs.join('; ') || '–').replace(/\|/g, '/')} |`);
  }
  return `${summaryText()}\n\n${lines.join('\n')}\n`;
}
function openModal() { $('#vw-modal').hidden = false; }
function closeModal() { $('#vw-modal').hidden = true; }

// =====================================================================================================
// Hauptschleife
// =====================================================================================================
let last = performance.now(), clock = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now; clock += dt;
  if (document.hidden) return;
  let active = false;
  if (controls.update()) active = true;
  if (current) {
    if (state.turntable) { holder.rotation.y += dt * 0.45; active = true; }
    if (current.update && current.update(dt, clock) !== false) active = true;
    if (current.lodInfo?.type === 'three' && state.lodSel === 'auto') {
      const lv = current.lodInfo.lod.getCurrentLevel();
      if (lv !== current.lastLevel) { current.lastLevel = lv; current.lodInfo.levels.forEach((l, i) => { l.object.visible = i === lv; }); setLod('auto'); }
    }
  }
  if (!active && !needsRender) return;
  needsRender = false;
  if (state.bloom) composer.render(dt); else renderer.render(scene, camera);
}

// =====================================================================================================
// Start
// =====================================================================================================
function bindUi() {
  $('#vw-search').addEventListener('input', (e) => { state.query = e.target.value; renderList(); });
  $('#vw-btn-list').addEventListener('click', () => togglePanel('list'));
  $('#vw-btn-info').addEventListener('click', () => togglePanel('info'));
  $('#vw-btn-check').addEventListener('click', () => checkAll());
  $('#vw-modal-close').addEventListener('click', closeModal);
  $('#vw-modal').addEventListener('click', (e) => { if (e.target.id === 'vw-modal') closeModal(); });
  $('#vw-only-issues').addEventListener('change', renderTable);
  $('#vw-copy-md').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(resultsMarkdown()); $('#vw-copy-md').textContent = 'Kopiert ✓'; } catch { $('#vw-copy-md').textContent = 'Kopieren nicht möglich'; }
    setTimeout(() => { $('#vw-copy-md').textContent = 'Markdown kopieren'; }, 1800);
  });
  document.querySelectorAll('#vw-quick [data-quick]').forEach((b) => b.addEventListener('click', () => quick(b.dataset.quick)));
  window.addEventListener('keydown', (e) => {
    if (e.target?.matches?.('input, select, textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
    const k = e.key.toLowerCase();
    if (k === 't') quick('turntable'); else if (k === 'w') quick('wire'); else if (k === 'v') quick('view'); else if (k === 'f') quick('frame');
    else if (k === '/') { e.preventDefault(); togglePanel('list', true); $('#vw-search').focus(); }
    else if (k === 'escape') closeModal();
  });
  window.addEventListener('pointerdown', (e) => { document.body.dataset.device = e.pointerType === 'touch' ? 'touch' : 'mouse'; }, true);
}
function quick(q) {
  if (q === 'turntable') { state.turntable = !state.turntable; savePrefs(); }
  else if (q === 'wire') state.wire = !state.wire;
  else if (q === 'view') { const ks = Object.keys(VIEW_LABELS); state.view = ks[(ks.indexOf(state.view) + 1) % ks.length]; }
  else if (q === 'frame' && current) { holder.updateMatrixWorld(true); current.bounds = computeBounds(current.root); frameCamera(current.bounds, current.entry.front); }
  applyViewMode(); syncViewOptInputs();
}

let readyResolve;
const ready = new Promise((r) => { readyResolve = r; });
window.__viewer = {
  ready, entries, CATS, RULES, results,
  select: (id) => select(id), current: () => current, stats: () => current?.stats, checks: () => current?.checks,
  checkAll, setLod, playClip, resultsMarkdown, togglePanel, closeModal,
  setView: (o) => { Object.assign(state, o); applyTone(); applyFloor(); applyViewMode(); syncViewOptInputs(); if ('env' in o || 'bg' in o || 'hdriQ' in o) applyEnv(); invalidate(); },
  renderOnce: () => { needsRender = true; },
  envReady: () => envLoading === 0,
};

async function init() {
  if (innerWidth <= 820) document.body.classList.add('list-collapsed', 'info-collapsed');
  if (params.get('list') === '0') document.body.classList.add('list-collapsed');
  if (params.get('list') === '1') document.body.classList.remove('list-collapsed');
  if (params.get('info') === '0') document.body.classList.add('info-collapsed');
  if (params.get('info') === '1') document.body.classList.remove('info-collapsed');
  $('#vw-btn-list').setAttribute('aria-expanded', String(!document.body.classList.contains('list-collapsed')));
  $('#vw-btn-info').setAttribute('aria-expanded', String(!document.body.classList.contains('info-collapsed')));
  bindUi();
  resize();
  applyTone(); applyFloor(); applyEnv();
  renderViewOpts();
  renderCats(); renderList();
  requestAnimationFrame(frame);
  await Promise.all([initControls(), loadManifest(), loadModels()]);
  renderViewOpts(); renderCats(); renderList(); setStatus();
  const first = params.get('a') && byId.has(params.get('a')) ? params.get('a') : 'hero:sedan';
  await select(first);
  readyResolve(true);
  if (params.get('check') === '1') checkAll();
}
init().catch((e) => { console.error('Viewer: Start fehlgeschlagen', e); setStatus('Start fehlgeschlagen: ' + (e?.message || e)); readyResolve(false); });
