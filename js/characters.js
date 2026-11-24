// AEGIS – Figuren-Modul (G5): realistische Soldaten/Zivilisten auf Basis der CC0-Figuren
// (assets/characters/human_{m,f}_0{1,2,3}.glb, MakeHuman-Rig, 21 gebackene UAL-Clips).
//
//   const lib = await loadCharacterLibrary({ quality: 'high' });
//   const c = makeCharacter({ base: 'auto', role: 'soldier', armor: { type: 'personal', color: 0x4a5236 },
//                             weapon: 'rifle', seed: 7 });
//   scene.add(c.root); c.setState('walk', { speedMps: 1.4 });  …  c.update(dt, (x, z) => groundY);
//
// Ausrüstung wird prozedural erzeugt und an das vorhandene Skelett gebunden:
//   * Uniform / Hosen / Handschuhe / Weste / Knieschützer / Panzerplatten = „Schalen“ aus der Haut-Topologie
//     (Haut-Dreiecke einer Region, entlang der Normalen versetzt, gleiche Skin-Gewichte → verformen sich exakt mit),
//     die verdeckte Haut wird ausgeblendet (kein Durchstoßen).
//   * Stiefel/Schuhe, Taschen = prozedurale Modelle, per k-nächste-Nachbarn an die Haut-Gewichte gebunden.
//   * Helm (Bone head) und Waffe (Bone wrist.R) = starre Kinder der Bones; Gewehr: Zwei-Knochen-IK beider Arme.
//   * Fuß-IK gegen groundHeightFn + Fuß-Fixierung im Stand.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const CHARACTER_BASES = ['human_m_01', 'human_m_02', 'human_m_03', 'human_f_01', 'human_f_02', 'human_f_03'];
export const CHARACTER_STATES = ['idle', 'aimIdle', 'walk', 'run', 'crouch', 'crouchWalk', 'kneel', 'aim', 'shoot', 'reload', 'hit', 'die', 'dead'];
const DEFAULT_URL = new URL('../assets/characters/', import.meta.url).href;

// ---------------------------------------------------------------------------------------------
// Bone-Namen: kanonisch = MakeHuman-Rig. Aliase für MetaHuman (UE5), Character Creator 4 und Mixamo,
// falls eine importierte Figur nicht über tools/import-character.mjs umbenannt wurde.
// ---------------------------------------------------------------------------------------------
const SIDE_ALIASES = {
  clavicle: ['clavicle_%l', 'CC_Base_%L_Clavicle', 'mixamorig:%SShoulder', '%SShoulder'],
  upperarm01: ['upperarm_%l', 'CC_Base_%L_Upperarm', 'mixamorig:%SArm', '%SArm'],
  lowerarm01: ['lowerarm_%l', 'CC_Base_%L_Forearm', 'mixamorig:%SForeArm', '%SForeArm'],
  wrist: ['hand_%l', 'CC_Base_%L_Hand', 'mixamorig:%SHand', '%SHand'],
  upperleg01: ['thigh_%l', 'CC_Base_%L_Thigh', 'mixamorig:%SUpLeg', '%SUpLeg'],
  lowerleg01: ['calf_%l', 'CC_Base_%L_Calf', 'mixamorig:%SLeg', '%SLeg'],
  foot: ['foot_%l', 'CC_Base_%L_Foot', 'mixamorig:%SFoot', '%SFoot'],
  'toe3-1': ['ball_%l', 'CC_Base_%L_ToeBase', 'mixamorig:%SToeBase', '%SToeBase'],
  'finger2-1': ['index_01_%l', 'CC_Base_%L_Index1', 'mixamorig:%SHandIndex1'],
  'finger3-1': ['middle_01_%l', 'CC_Base_%L_Mid1', 'mixamorig:%SHandMiddle1'],
  'finger5-1': ['pinky_01_%l', 'CC_Base_%L_Pinky1', 'mixamorig:%SHandPinky1'],
};
const CENTER_ALIASES = {
  root: ['pelvis', 'CC_Base_Hip', 'mixamorig:Hips', 'Hips'],
  spine01: ['spine_05', 'spine_03', 'CC_Base_Spine02', 'mixamorig:Spine2', 'Spine2'],
  spine03: ['spine_02', 'CC_Base_Waist', 'mixamorig:Spine', 'Spine'],
  neck01: ['neck_01', 'CC_Base_NeckTwist01', 'mixamorig:Neck', 'Neck'],
  head: ['head', 'CC_Base_Head', 'mixamorig:Head', 'Head'],
};
function aliasesOf(canon) {
  const m = canon.match(/^(.*)\.(L|R)$/);
  if (!m) return [canon, ...(CENTER_ALIASES[canon] || [])];
  const [, b, s] = m, l = s.toLowerCase(), S = s === 'L' ? 'Left' : 'Right';
  return [canon, ...(SIDE_ALIASES[b] || []).map((a) => a.replace('%l', l).replace('%L', s).replace('%S', S))];
}

// Regionen (über den dominanten Bone eines Haut-Vertex)
const R = { none: 0, head: 1, neck: 2, torso: 3, hips: 4, shoulder: 5, upperarm: 6, forearm: 7, hand: 8, thigh: 9, shin: 10, foot: 11 };
const REGION_ROOTS = [['wrist', R.hand], ['lowerarm01', R.forearm], ['upperarm01', R.upperarm], ['shoulder01', R.shoulder],
  ['clavicle', R.shoulder], ['foot', R.foot], ['lowerleg01', R.shin], ['upperleg01', R.thigh], ['pelvis', R.hips],
  ['neck02', R.head], ['head', R.head], ['neck01', R.neck], ['breast', R.torso], ['root', R.hips]];
function regionOfBone(bone) {
  for (let b = bone; b && b.isBone; b = b.parent) {
    const n = b.name.replace(/\.(L|R)$/, '');
    if (/^spine0\d$/.test(n)) return R.torso;
    for (const [k, r] of REGION_ROOTS) if (n === k) return r;
  }
  return R.none;
}
function sideOfBone(bone) {
  for (let b = bone; b && b.isBone; b = b.parent) { const m = b.name.match(/\.(L|R)$/); if (m) return m[1] === 'L' ? 1 : -1; }
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Kleinkram
// ---------------------------------------------------------------------------------------------
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth01 = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const UP = new THREE.Vector3(0, 1, 0);
const _v = [0, 1, 2, 3, 4, 5, 6, 7].map(() => new THREE.Vector3());
const _q = [0, 1, 2, 3].map(() => new THREE.Quaternion());
const _m = [0, 1].map(() => new THREE.Matrix4());
export function mulberry32(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const sgnpow = (x, p) => Math.sign(x) * Math.pow(Math.abs(x), p);
function wpos(o, t = new THREE.Vector3()) { return o.getWorldPosition(t); }
function wquat(o, t = new THREE.Quaternion()) { return o.getWorldQuaternion(t); }

// ---------------------------------------------------------------------------------------------
// Bibliothek
// ---------------------------------------------------------------------------------------------
const LIB = { quality: 'high', bases: new Map(), loading: new Map(), tex: null, shared: new Map(), loader: null };

export async function loadCharacterLibrary({ quality = 'high', bases = CHARACTER_BASES, baseUrl = DEFAULT_URL } = {}) {
  LIB.quality = quality;
  LIB.loader = LIB.loader || new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  await Promise.all(bases.map((id) => {
    if (LIB.bases.has(id)) return null;
    if (!LIB.loading.has(id)) {
      LIB.loading.set(id, LIB.loader.loadAsync(new URL(id + '.glb', baseUrl).href)
        .then((g) => registerCharacterBase(id, g, { sex: /_f_/.test(id) ? 'f' : 'm' })));
    }
    return LIB.loading.get(id);
  }));
  return LIB;
}

/** Fremde (importierte) Figur registrieren. Ohne eigene Clips werden die CC0-Clips von `animSource` retargetet. */
export function registerCharacterBase(id, gltf, { sex = 'm', animSource = null } = {}) {
  let animations = gltf.animations || [];
  if ((!animations.length || animSource) && (animSource || LIB.bases.size)) {
    const src = LIB.bases.get(animSource || [...LIB.bases.keys()][0]);
    if (src) animations = retargetClips(src, gltf.scene);
  }
  const base = { id, sex, gltf, template: gltf.scene, clips: new Map(animations.map((c) => [c.name, c])), an: null, cache: new Map(), mats: {} };
  LIB.bases.set(id, base);
  return base;
}

export function characterLibraryInfo() {
  return { quality: LIB.quality, bases: [...LIB.bases.keys()], cachedParts: [...LIB.bases.values()].reduce((s, b) => s + b.cache.size, 0) };
}

/** Gibt alle geteilten Ressourcen (Geometrien, Texturen, Materialien) der Bibliothek frei. */
export function disposeCharacterLibrary() {
  for (const b of LIB.bases.values()) {
    for (const v of b.cache.values()) disposeDeep(v);
    for (const set of Object.values(b.mats)) for (const m of Object.values(set)) m.dispose?.();
    b.template.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
  }
  for (const v of LIB.shared.values()) disposeDeep(v);
  if (LIB.tex) for (const t of Object.values(LIB.tex)) t.dispose?.();
  LIB.bases.clear(); LIB.loading.clear(); LIB.shared.clear(); LIB.tex = null;
}
function disposeDeep(v) {
  if (!v) return;
  if (v.isBufferGeometry || v.isMaterial || v.isTexture) { v.dispose(); return; }
  if (Array.isArray(v)) { v.forEach(disposeDeep); return; }
  if (typeof v === 'object') for (const k of Object.keys(v)) if (v[k] && (v[k].isBufferGeometry || v[k].isMaterial || Array.isArray(v[k]) || v[k].constructor === Object)) disposeDeep(v[k]);
}
function shared(key, make) { if (!LIB.shared.has(key)) LIB.shared.set(key, make()); return LIB.shared.get(key); }
function cached(base, key, make) { if (!base.cache.has(key)) base.cache.set(key, make()); return base.cache.get(key); }

// ---------------------------------------------------------------------------------------------
// Prozedurale Texturen (Canvas, kachelbar)
// ---------------------------------------------------------------------------------------------
function valueNoise(n, period, rnd) {
  const g = new Float32Array(period * period); for (let i = 0; i < g.length; i++) g[i] = rnd();
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const fx = (x / n) * period, fy = (y / n) * period, ix = Math.floor(fx), iy = Math.floor(fy);
    let tx = fx - ix, ty = fy - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const x0 = ix % period, x1 = (ix + 1) % period, y0 = iy % period, y1 = (iy + 1) % period;
    const a = g[y0 * period + x0], b = g[y0 * period + x1], c = g[y1 * period + x0], d = g[y1 * period + x1];
    out[y * n + x] = (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
  }
  return out;
}
function fbm(n, periods, amps, rnd) {
  const out = new Float32Array(n * n);
  periods.forEach((p, k) => { const v = valueNoise(n, p, rnd); for (let i = 0; i < out.length; i++) out[i] += v[i] * amps[k]; });
  return out;
}
function heightToNormal(h, n, strength, bChan) {
  const c = document.createElement('canvas'); c.width = c.height = n;
  const ctx = c.getContext('2d'), img = ctx.createImageData(n, n), d = img.data;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    const dx = (h[y * n + ((x + 1) % n)] - h[y * n + ((x - 1 + n) % n)]) * strength;
    const dy = (h[((y + 1) % n) * n + x] - h[((y - 1 + n) % n) * n + x]) * strength;
    const l = Math.hypot(dx, dy, 1);
    d[i * 4] = (-dx / l * 0.5 + 0.5) * 255; d[i * 4 + 1] = (dy / l * 0.5 + 0.5) * 255;
    d[i * 4 + 2] = bChan ? clamp(bChan[i], 0, 1) * 255 : (1 / l * 0.5 + 0.5) * 255; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
function canvasTex(c, srgb = false) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}
function textures() {
  if (LIB.tex) return LIB.tex;
  const rnd = mulberry32(1234);
  // Hautporen: RG = Detail-Normal, B = Rauheits-Variation
  const N = 256, pores = fbm(N, [32, 64, 128], [0.25, 0.18, 0.12], rnd);
  for (let k = 0; k < 2600; k++) {
    const cx = rnd() * N, cy = rnd() * N, r = 0.7 + rnd() * 1.1, dep = 0.35 + rnd() * 0.6;
    for (let y = Math.floor(cy - 3); y <= cy + 3; y++) for (let x = Math.floor(cx - 3); x <= cx + 3; x++) {
      const d2 = ((x - cx) ** 2 + (y - cy) ** 2) / (r * r);
      if (d2 < 9) pores[((y + N) % N) * N + ((x + N) % N)] -= dep * Math.exp(-d2);
    }
  }
  const rough = fbm(N, [8, 16, 64], [0.5, 0.3, 0.2], rnd);
  const poresTex = canvasTex(heightToNormal(pores, N, 1.6, rough));
  // Stoff: Köperbindung + große Falten
  const fab = fbm(N, [4, 8, 16], [0.9, 0.5, 0.25], rnd);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) fab[y * N + x] = fab[y * N + x] * 3 + 0.12 * Math.sin(((x + y) / N) * Math.PI * 2 * 48) + 0.05 * Math.sin((x / N) * Math.PI * 2 * 96);
  const fabricTex = canvasTex(heightToNormal(fab, N, 2.2));
  // Leder: Narbung
  const lea = fbm(N, [16, 32, 64, 128], [0.35, 0.35, 0.25, 0.15], rnd);
  for (let i = 0; i < lea.length; i++) lea[i] = Math.abs(lea[i] - 0.55);
  const leatherTex = canvasTex(heightToNormal(lea, N, 3.0));
  // Lack / Kunststoff fein
  const paint = fbm(N, [32, 64, 128], [0.4, 0.3, 0.3], rnd);
  const paintTex = canvasTex(heightToNormal(paint, N, 0.8));
  // Tarnmuster: RGB = Masken der Farbschichten 1..3 (Woodland-artig)
  const M = 256, cam = document.createElement('canvas'); cam.width = cam.height = M;
  const cctx = cam.getContext('2d'), img = cctx.createImageData(M, M);
  const layers = [0.52, 0.56, 0.62].map((th, k) => {
    const f = fbm(M, [3, 6, 12, 24], [0.5, 0.3, 0.14, 0.06], mulberry32(77 + k * 31));
    return f.map((v) => smooth01(th - 0.015, th + 0.015, v));
  });
  for (let i = 0; i < M * M; i++) { img.data[i * 4] = layers[0][i] * 255; img.data[i * 4 + 1] = layers[1][i] * 255; img.data[i * 4 + 2] = layers[2][i] * 255; img.data[i * 4 + 3] = 255; }
  cctx.putImageData(img, 0, 0);
  const camoTex = canvasTex(cam);
  LIB.tex = { pores: poresTex, fabric: fabricTex, leather: leatherTex, paint: paintTex, camo: camoTex };
  return LIB.tex;
}

// ---------------------------------------------------------------------------------------------
// Shader-Erweiterungen (onBeforeCompile)
// ---------------------------------------------------------------------------------------------
const LIGHTS_PATCHED = () => {
  let c = THREE.ShaderChunk.lights_physical_pars_fragment;
  const a = 'vec3 irradiance = dotNL * directLight.color;';
  const b = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );';
  if (!c.includes(a) || !c.includes(b)) return c;
  c = c.replace(b, `
  #ifdef SKIN_SSS
    // Subsurface-Ersatz: kanalweises Wrap-Lighting (Rot streut am weitesten) + Durchscheinen an dünnen Stellen/Rändern
    float nlRaw = dot( geometryNormal, directLight.direction );
    vec3 wrapW = uSssWrap * uSssColor;
    vec3 diffNL = clamp( ( vec3( nlRaw ) + wrapW ) / ( 1.0 + wrapW ), 0.0, 1.0 );
    float rimF = pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), 2.0 );
    float thinF = clamp( vThin + rimF * 0.45, 0.0, 1.0 );
    vec3 Lt = normalize( directLight.direction + geometryNormal * 0.4 );
    float backL = pow( saturate( dot( geometryViewDir, - Lt ) ), 3.0 ) * thinF * uSssTrans;
    reflectedLight.directDiffuse += ( diffNL + backL * uSssColor ) * directLight.color * BRDF_Lambert( material.diffuseColor );
  #else
    ${b}
  #endif
  #ifdef HAIR_ANISO
    {
      // Kajiya-Kay-Näherung: zwei verschobene Glanzlichter entlang der Strähnenrichtung
      vec3 Tn = normalize( gHairT - geometryNormal * dot( gHairT, geometryNormal ) );
      vec3 Hh = normalize( directLight.direction + geometryViewDir );
      vec3 T1 = normalize( Tn + geometryNormal * 0.12 ), T2 = normalize( Tn - geometryNormal * 0.18 );
      float d1 = dot( T1, Hh ), d2 = dot( T2, Hh );
      float s1 = pow( sqrt( max( 0.0, 1.0 - d1 * d1 ) ), 90.0 ), s2 = pow( sqrt( max( 0.0, 1.0 - d2 * d2 ) ), 24.0 );
      reflectedLight.directSpecular += saturate( nlRaw0 + 0.25 ) * directLight.color * ( s1 * 0.22 + s2 * 0.35 * material.diffuseColor ) * uHairSpec;
    }
  #endif`);
  c = c.replace(a, a + '\n  float nlRaw0 = dot( geometryNormal, directLight.direction );');
  return c;
};
let _lightsChunk = null;
function patchMaterial(mat, { key, defines = {}, uniforms = {}, vHead = '', vMain = '', fHead = '', fAfter = {} }) {
  mat.defines = Object.assign(mat.defines || {}, defines);
  mat.userData.aegisUniforms = uniforms;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = vHead + '\n' + sh.vertexShader;
    if (vMain) sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + vMain);
    sh.fragmentShader = fHead + '\n' + sh.fragmentShader;
    if (defines.SKIN_SSS !== undefined || defines.HAIR_ANISO !== undefined) {
      _lightsChunk = _lightsChunk || LIGHTS_PATCHED();
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_pars_fragment>', _lightsChunk);
    }
    for (const [inc, code] of Object.entries(fAfter)) sh.fragmentShader = sh.fragmentShader.replace(`#include <${inc}>`, `#include <${inc}>\n${code}`);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

function makeSkinMaterial(src) {
  const T = textures();
  const m = new THREE.MeshPhysicalMaterial({
    name: 'skin', map: src.map, normalMap: src.normalMap, normalScale: src.normalScale ? src.normalScale.clone() : new THREE.Vector2(1, 1),
    roughnessMap: src.roughnessMap, roughness: 1, metalness: 0, color: src.color.clone(),
    sheen: 0.3, sheenRoughness: 0.75, sheenColor: new THREE.Color(1.0, 0.86, 0.8), specularIntensity: 0.7, ior: 1.4,
  });
  return patchMaterial(m, {
    key: 'aegis-skin-1', defines: { SKIN_SSS: '', SKIN_DETAIL: '' },
    uniforms: { uSssColor: { value: new THREE.Color(1.0, 0.32, 0.18) }, uSssWrap: { value: 0.55 }, uSssTrans: { value: 0.55 },
      uDetailMap: { value: T.pores }, uDetailRepeat: { value: new THREE.Vector2(26, 26) }, uDetailStrength: { value: 0.5 }, uRoughVar: { value: 0.45 } },
    vHead: 'attribute float aThin; varying float vThin;', vMain: 'vThin = aThin;',
    fHead: 'varying float vThin; uniform vec3 uSssColor; uniform float uSssWrap; uniform float uSssTrans; uniform sampler2D uDetailMap; uniform vec2 uDetailRepeat; uniform float uDetailStrength; uniform float uRoughVar;',
    fAfter: {
      normal_fragment_maps: `
      #if defined( SKIN_DETAIL ) && defined( USE_NORMALMAP_TANGENTSPACE )
      { vec4 dt = texture2D( uDetailMap, vNormalMapUv * uDetailRepeat );
        vec2 dn = ( dt.rg * 2.0 - 1.0 ) * uDetailStrength;
        normal = normalize( normal + normalize( tbn[0] ) * dn.x + normalize( tbn[1] ) * dn.y );
        roughnessFactor = clamp( roughnessFactor * ( 1.0 + ( dt.b - 0.5 ) * uRoughVar ), 0.25, 1.0 ); }
      #endif`,
    },
  });
}
function makeHairMaterial(src) {
  const m = new THREE.MeshPhysicalMaterial({
    name: 'hair', map: src.map, normalMap: src.normalMap, color: src.color.clone(), roughness: 0.55, metalness: 0,
    side: THREE.DoubleSide, alphaTest: 0.35, alphaToCoverage: true, transparent: false, sheen: 0.25, sheenRoughness: 0.5,
    sheenColor: new THREE.Color(0.6, 0.5, 0.4), specularIntensity: 0.35,
  });
  return patchMaterial(m, {
    key: 'aegis-hair-1', defines: { HAIR_ANISO: '' }, uniforms: { uHairSpec: { value: 1.0 } },
    fHead: 'uniform float uHairSpec; vec3 gHairT = vec3( 0.0, 1.0, 0.0 );',
    fAfter: { normal_fragment_maps: '#ifdef USE_NORMALMAP_TANGENTSPACE\n gHairT = normalize( tbn[1] );\n#endif' },
  });
}
// Stoff mit Tarnmuster (triplanar im Ruhe-Raum → nahtlos, klebt am Stoff) bzw. MOLLE-Gurtband
function makeFabricMaterial({ color = 0x5b6345, camo = null, molle = false, roughness = 0.9, normalRepeat = 7, name = 'fabric', side = THREE.FrontSide }) {
  const T = textures();
  const m = new THREE.MeshStandardMaterial({ name, color: camo ? 0xffffff : color, roughness, metalness: 0, normalMap: T.fabric, normalScale: new THREE.Vector2(0.55, 0.55), side });
  m.normalMap = T.fabric.clone(); m.normalMap.repeat.set(normalRepeat, normalRepeat); m.normalMap.needsUpdate = true;
  m.userData.ownTex = [m.normalMap];
  const defines = {}; if (camo) defines.USE_CAMO = ''; if (molle) defines.USE_MOLLE = '';
  const cc = camo || [color, color, color, color];
  return patchMaterial(m, {
    key: 'aegis-fabric-' + (camo ? 'c' : '') + (molle ? 'm' : ''), defines,
    uniforms: { uCamo: { value: T.camo }, uCamoScale: { value: 1.9 }, uC0: { value: new THREE.Color(cc[0]) }, uC1: { value: new THREE.Color(cc[1]) }, uC2: { value: new THREE.Color(cc[2]) }, uC3: { value: new THREE.Color(cc[3]) } },
    vHead: 'attribute vec3 aRest; attribute vec3 aRestN; varying vec3 vRest; varying vec3 vRestN;', vMain: 'vRest = aRest; vRestN = aRestN;',
    fHead: 'varying vec3 vRest; varying vec3 vRestN; uniform sampler2D uCamo; uniform float uCamoScale; uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3;',
    fAfter: {
      map_fragment: `
      #ifdef USE_CAMO
      { vec3 w = pow( abs( normalize( vRestN + 1e-4 ) ), vec3( 4.0 ) ); w /= ( w.x + w.y + w.z );
        vec4 mk = texture2D( uCamo, vRest.zy * uCamoScale ) * w.x + texture2D( uCamo, vRest.xz * uCamoScale ) * w.y + texture2D( uCamo, vRest.xy * uCamoScale ) * w.z;
        diffuseColor.rgb *= mix( mix( mix( uC0, uC1, mk.r ), uC2, mk.g ), uC3, mk.b ); }
      #endif
      #ifdef USE_MOLLE
      { float r = fract( vRest.y / 0.05 + 0.3 );
        float band = smoothstep( 0.03, 0.09, r ) * ( 1.0 - smoothstep( 0.52, 0.58, r ) );
        float tack = smoothstep( 0.86, 0.9, fract( vRest.x / 0.038 + 0.5 ) );
        diffuseColor.rgb *= mix( 0.62, 1.0, band ) * ( 1.0 - 0.22 * tack * band ); }
      #endif`,
    },
  });
}
const physical = (o) => new THREE.MeshPhysicalMaterial(o);

// ---------------------------------------------------------------------------------------------
// Analyse einer Basisfigur (einmalig): Ruhepose, Regionen, Maße, Handrahmen, Schrittgeschwindigkeiten
// ---------------------------------------------------------------------------------------------
function blendMatrix(out, Mj, idx4, w4) {
  const e = out.elements; e.fill(0);
  for (let k = 0; k < 4; k++) { const w = w4[k]; if (!w) continue; const s = Mj[idx4[k]].elements; for (let i = 0; i < 16; i++) e[i] += w * s[i]; }
  return out;
}
function analyze(base) {
  if (base.an) return base.an;
  const T = base.template;
  T.updateMatrixWorld(true);
  const byMat = {};
  T.traverse((o) => { if (o.isSkinnedMesh) { o.frustumCulled = false; const n = (o.material && o.material.name) || o.name; (byMat[n] = byMat[n] || []).push(o); } });
  const all = Object.values(byMat).flat();
  const skin = (byMat.skin || all.sort((a, b) => b.geometry.attributes.position.count - a.geometry.attributes.position.count))[0];
  const skel = skin.skeleton, bones = skel.bones;
  const byName = new Map(bones.map((b, i) => [b.name, i]));
  const bi = (canon) => { for (const n of aliasesOf(canon)) if (byName.has(n)) return byName.get(n); return -1; };
  const bone = (canon) => { const i = bi(canon); return i < 0 ? null : bones[i]; };
  const bp = (canon) => { const b = bone(canon); return b ? wpos(b) : null; };
  const Mj = bones.map((b, j) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, skel.boneInverses[j]));
  const boneReg = bones.map(regionOfBone), boneSide = bones.map(sideOfBone);
  const g = skin.geometry, pos = g.attributes.position, nor = g.attributes.normal, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const n = pos.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), reg = new Uint8Array(n), side = new Int8Array(n);
  const SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4);
  const A = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3(), i4 = [0, 0, 0, 0], w4 = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) { i4[k] = si.getComponent(i, k); w4[k] = sw.getComponent(i, k); SI[i * 4 + k] = i4[k]; SW[i * 4 + k] = w4[k]; if (w4[k] > bw) { bw = w4[k]; best = i4[k]; } }
    blendMatrix(A, Mj, i4, w4).multiply(skin.bindMatrix);
    v.fromBufferAttribute(pos, i).applyMatrix4(A); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
    nm.getNormalMatrix(A); v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); N[i * 3] = v.x; N[i * 3 + 1] = v.y; N[i * 3 + 2] = v.z;
    reg[i] = boneReg[best]; side[i] = boneSide[best];
  }
  const index = g.index ? g.index.array : Uint32Array.from({ length: n }, (_, i) => i);
  // Restpositionen anderer Meshes (Haare, Augen)
  const restOf = (mesh) => { const c = mesh.geometry.attributes.position.count, out = new Float32Array(c * 3), t = new THREE.Vector3();
    for (let i = 0; i < c; i++) { mesh.getVertexPosition(i, t); t.applyMatrix4(mesh.matrixWorld); out[i * 3] = t.x; out[i * 3 + 1] = t.y; out[i * 3 + 2] = t.z; } return out; };
  const hairMesh = byMat.hair ? byMat.hair[0] : null, eyeMesh = byMat.eyes ? byMat.eyes[0] : null;
  const hairRest = hairMesh ? restOf(hairMesh) : null;
  // Kennmaße (Welt = Figurraum in Ruhepose, +Y oben, Blick +Z)
  const key = { hips: bp('root'), head: bp('head'), neck: bp('neck01'), spine01: bp('spine01'),
    shoulderL: bp('upperarm01.L'), shoulderR: bp('upperarm01.R'), kneeL: bp('lowerleg01.L'), kneeR: bp('lowerleg01.R'),
    ankleL: bp('foot.L'), ankleR: bp('foot.R'), hipL: bp('upperleg01.L'), hipR: bp('upperleg01.R'),
    elbowL: bp('lowerarm01.L'), elbowR: bp('lowerarm01.R'), wristL: bp('wrist.L'), wristR: bp('wrist.R') };
  let eyeC = null;
  if (eyeMesh) { const er = restOf(eyeMesh), b = new THREE.Box3(); for (let i = 0; i < er.length; i += 3) b.expandByPoint(v.set(er[i], er[i + 1], er[i + 2])); eyeC = b.getCenter(new THREE.Vector3()); }
  const headBox = new THREE.Box3(); let topY = -1e9;
  for (let i = 0; i < n; i++) if (reg[i] === R.head) { topY = Math.max(topY, P[i * 3 + 1]); }
  if (!eyeC) eyeC = new THREE.Vector3(key.head.x, key.head.y + 0.08, key.head.z + 0.08);
  for (let i = 0; i < n; i++) if (reg[i] === R.head && P[i * 3 + 1] > eyeC.y - 0.005) headBox.expandByPoint(v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
  let chin = null;
  for (let i = 0; i < n; i++) if (reg[i] === R.head && P[i * 3 + 2] > eyeC.z - 0.03 && Math.abs(P[i * 3]) < 0.02 && (!chin || P[i * 3 + 1] < chin.y)) chin = new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
  const torsoZ = []; for (let i = 0; i < n; i++) if (reg[i] === R.torso && Math.abs(P[i * 3 + 1] - key.spine01.y) < 0.08) torsoZ.push(P[i * 3 + 2]);
  const zc = torsoZ.length ? (Math.min(...torsoZ) + Math.max(...torsoZ)) / 2 : key.spine01.z;
  // dünne Stellen (Ohren, Nase, Finger) für den Durchschein-Anteil
  const thin = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (reg[i] === R.hand) thin[i] = 0.55;
    else if (reg[i] === R.head) {
      if (Math.abs(x - eyeC.x) > 0.062 && y > eyeC.y - 0.07 && y < eyeC.y + 0.03 && z < eyeC.z) thin[i] = 1.0; // Ohren
      else if (z > eyeC.z + 0.01 && y < eyeC.y - 0.005 && y > eyeC.y - 0.06 && Math.abs(x - eyeC.x) < 0.02) thin[i] = 0.6; // Nase
    }
  }
  if (!g.attributes.aThin) g.setAttribute('aThin', new THREE.BufferAttribute(thin, 1));
  // Handrahmen (im lokalen Raum des wrist-Bones): Griffpunkt, Fingerrichtung d, Knöchellinie a (Kleinfinger→Zeigefinger), Handflächennormale p
  const hand = {};
  for (const s of ['L', 'R']) {
    const W = bp('wrist.' + s), I = bp('finger2-1.' + s), P5 = bp('finger5-1.' + s), M3 = bp('finger3-1.' + s);
    if (!W || !I || !P5 || !M3) continue;
    const a = I.clone().sub(P5).normalize();
    const d = M3.clone().sub(W); const len = d.length(); d.normalize(); d.sub(a.clone().multiplyScalar(d.dot(a))).normalize();
    const pn = new THREE.Vector3().crossVectors(d, a); if (s === 'R') pn.negate();
    const palm = W.clone().addScaledVector(M3.clone().sub(W), 0.55).addScaledVector(pn, 0.026);
    const wb = bone('wrist.' + s), inv = new THREE.Matrix4().copy(wb.matrixWorld).invert(), qi = wquat(wb).invert();
    hand[s] = { palm: palm.applyMatrix4(inv), d: d.applyQuaternion(qi), a: a.applyQuaternion(qi), n: pn.applyQuaternion(qi), len };
  }
  const spineFwdLocal = new THREE.Vector3(0, 0, 1).applyQuaternion(wquat(bone('spine01')).invert());
  const headRestInv = new THREE.Matrix4().copy(bone('head').matrixWorld).invert();
  const height = topY;
  // Ruhepose sichern, natürliche Schrittgeschwindigkeiten messen, Ruhepose wiederherstellen
  const restLocal = []; T.traverse((o) => restLocal.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]));
  const speeds = {};
  const mixer = new THREE.AnimationMixer(T);
  for (const [nm2, def] of [['Walk_Loop', 1.3], ['Jog_Fwd_Loop', 3.0], ['Sprint_Loop', 5.0], ['Crouch_Fwd_Loop', 0.9]]) {
    const clip = base.clips.get(nm2); if (!clip) { speeds[nm2] = def; continue; }
    const act = mixer.clipAction(clip); act.play();
    const samples = [], S = 60, dt = clip.duration / S;
    for (const s of ['L', 'R']) {
      const fb = bone('foot.' + s); const ys = [], zs = [];
      for (let k = 0; k <= S; k++) { mixer.setTime(k * dt); T.updateMatrixWorld(true); const p = wpos(fb); ys.push(p.y); zs.push(p.z); }
      const minY = Math.min(...ys);
      for (let k = 0; k < S; k++) if (ys[k] < minY + 0.03 && ys[k + 1] < minY + 0.03) samples.push(-(zs[k + 1] - zs[k]) / dt);
    }
    act.stop(); mixer.uncacheAction(clip);
    samples.sort((x, y) => x - y);
    const med = samples.length ? samples[samples.length >> 1] : def;
    speeds[nm2] = med > 0.3 && med < 9 ? med : def;
  }
  mixer.uncacheRoot(T);
  for (const [o, p, q, s] of restLocal) { o.position.copy(p); o.quaternion.copy(q); o.scale.copy(s); }
  T.updateMatrixWorld(true);
  base.an = { skin, skel, bones, bi, bone, byMat, Mj, P, N, SI, SW, reg, side, n, index, key, eyeC, headBox, topY, chin, zc, hand,
    spineFwdLocal, headRestInv, hairMesh, hairRest, speeds, height };
  return base.an;
}

// ---------------------------------------------------------------------------------------------
// Geometrie-Bausteine
// ---------------------------------------------------------------------------------------------
/** Welt-(Ruhepose-)Geometrie mit Skin-Gewichten → lokale Bind-Geometrie für eine SkinnedMesh am Figurskelett */
function finalizeSkinned(an, { pos, nrm, uv, index, SI, SW }) {
  const n = pos.length / 3, lp = new Float32Array(n * 3), ln = new Float32Array(n * 3);
  const A = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3(), i4 = [0, 0, 0, 0], w4 = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 4; k++) { i4[k] = SI[i * 4 + k]; w4[k] = SW[i * 4 + k]; }
    blendMatrix(A, an.Mj, i4, w4).multiply(an.skin.bindMatrix).invert();
    v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(A); lp[i * 3] = v.x; lp[i * 3 + 1] = v.y; lp[i * 3 + 2] = v.z;
    nm.getNormalMatrix(A); v.set(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]).applyMatrix3(nm).normalize(); ln[i * 3] = v.x; ln[i * 3 + 1] = v.y; ln[i * 3 + 2] = v.z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(ln, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv || new Float32Array(n * 2), 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
  geo.setAttribute('aRest', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aRestN', new THREE.Float32BufferAttribute(nrm, 3));
  if (index) geo.setIndex(index.length > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2);
  return geo;
}
/** Gewichte der k nächsten Haut-Vertices (Kandidatenliste) mitteln → für prozedurale Teile */
function knnSkin(an, pos, cand, k = 4) {
  const n = pos.length / 3, SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4), P = an.P;
  const bestI = new Int32Array(k), bestD = new Float32Array(k);
  for (let i = 0; i < n; i++) {
    bestD.fill(1e9); bestI.fill(-1);
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    for (const c of cand) {
      const d = (P[c * 3] - x) ** 2 + (P[c * 3 + 1] - y) ** 2 + (P[c * 3 + 2] - z) ** 2;
      if (d < bestD[k - 1]) { let j = k - 1; while (j > 0 && bestD[j - 1] > d) { bestD[j] = bestD[j - 1]; bestI[j] = bestI[j - 1]; j--; } bestD[j] = d; bestI[j] = c; }
    }
    const acc = new Map();
    for (let j = 0; j < k; j++) { if (bestI[j] < 0) continue; const wv = 1 / (Math.sqrt(bestD[j]) + 0.004);
      for (let q = 0; q < 4; q++) { const b = an.SI[bestI[j] * 4 + q], w = an.SW[bestI[j] * 4 + q]; if (w > 0) acc.set(b, (acc.get(b) || 0) + w * wv); } }
    const top = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4); const sum = top.reduce((s, e) => s + e[1], 0) || 1;
    top.forEach(([b, w], q) => { SI[i * 4 + q] = b; SW[i * 4 + q] = w / sum; });
  }
  return { SI, SW };
}
/** Schale aus Haut-Dreiecken: äußere Fläche (outerFn), optional innere Fläche + Kantenwände (Materialstärke). */
function buildShell(an, triOk, outerFn, innerFn = null, { smooth = 0 } = {}) {
  const idx = an.index, tris = [];
  for (let t = 0; t < idx.length; t += 3) if (triOk(idx[t], idx[t + 1], idx[t + 2])) tris.push(idx[t], idx[t + 1], idx[t + 2]);
  if (!tris.length) return null;
  const map = new Map(), used = [];
  for (const v of tris) if (!map.has(v)) { map.set(v, used.length); used.push(v); }
  const m = used.length, t = new THREE.Vector3();
  const outer = new Float32Array(m * 3), inner = innerFn ? new Float32Array(m * 3) : null;
  used.forEach((v, k) => { outerFn(v, t); outer[k * 3] = t.x; outer[k * 3 + 1] = t.y; outer[k * 3 + 2] = t.z; if (inner) { innerFn(v, t); inner[k * 3] = t.x; inner[k * 3 + 1] = t.y; inner[k * 3 + 2] = t.z; } });
  const lt = tris.map((v) => map.get(v));
  // Randkanten
  const edges = new Map();
  for (let f = 0; f < lt.length; f += 3) for (let e = 0; e < 3; e++) {
    const a = lt[f + e], b = lt[f + (e + 1) % 3], kk = a < b ? a * m + b : b * m + a;
    const ex = edges.get(kk); if (ex) ex.n++; else edges.set(kk, { a, b, c: lt[f + (e + 2) % 3], n: 1 });
  }
  if (smooth) {
    const nb = Array.from({ length: m }, () => new Set());
    for (let f = 0; f < lt.length; f += 3) for (let e = 0; e < 3; e++) { nb[lt[f + e]].add(lt[f + (e + 1) % 3]); nb[lt[f + (e + 1) % 3]].add(lt[f + e]); }
    const boundary = new Uint8Array(m); for (const e of edges.values()) if (e.n === 1) { boundary[e.a] = 1; boundary[e.b] = 1; }
    for (let it = 0; it < smooth; it++) for (const arr of inner ? [outer, inner] : [outer]) {
      const cp = arr.slice();
      for (let i = 0; i < m; i++) { if (boundary[i] || !nb[i].size) continue; let sx = 0, sy = 0, sz = 0; for (const j of nb[i]) { sx += cp[j * 3]; sy += cp[j * 3 + 1]; sz += cp[j * 3 + 2]; } const c = nb[i].size;
        arr[i * 3] = cp[i * 3] * 0.5 + sx / c * 0.5; arr[i * 3 + 1] = cp[i * 3 + 1] * 0.5 + sy / c * 0.5; arr[i * 3 + 2] = cp[i * 3 + 2] * 0.5 + sz / c * 0.5; }
    }
  }
  const pos = [], src = [], ind = [], uvs = [];
  const uvA = an.skin.geometry.attributes.uv;
  const pushV = (arr, k, s) => { pos.push(arr[k * 3], arr[k * 3 + 1], arr[k * 3 + 2]); src.push(s); uvs.push(uvA ? uvA.getX(s) : 0, uvA ? uvA.getY(s) : 0); };
  for (let k = 0; k < m; k++) pushV(outer, k, used[k]);
  for (const x of lt) ind.push(x);
  if (inner) {
    for (let k = 0; k < m; k++) pushV(inner, k, used[k]);
    for (let f = 0; f < lt.length; f += 3) ind.push(lt[f] + m, lt[f + 2] + m, lt[f + 1] + m);
  }
  const nSmooth = pos.length / 3;
  if (inner) {
    for (const e of edges.values()) {
      if (e.n !== 1) continue;
      const base = pos.length / 3;
      pushV(outer, e.a, used[e.a]); pushV(outer, e.b, used[e.b]); pushV(inner, e.b, used[e.b]); pushV(inner, e.a, used[e.a]);
      // Orientierung: Wand zeigt vom dritten Dreieckspunkt weg
      const pa = new THREE.Vector3(outer[e.a * 3], outer[e.a * 3 + 1], outer[e.a * 3 + 2]), pb = new THREE.Vector3(outer[e.b * 3], outer[e.b * 3 + 1], outer[e.b * 3 + 2]);
      const pi = new THREE.Vector3(inner[e.a * 3], inner[e.a * 3 + 1], inner[e.a * 3 + 2]), pc = new THREE.Vector3(outer[e.c * 3], outer[e.c * 3 + 1], outer[e.c * 3 + 2]);
      const nrm = new THREE.Vector3().crossVectors(pb.clone().sub(pa), pi.clone().sub(pa));
      const out = pa.clone().add(pb).multiplyScalar(0.5).sub(pc);
      if (nrm.dot(out) > 0) ind.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else ind.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
  // Normalen (glatt für Flächen, flach für Wände)
  const nV = pos.length / 3, nrm = new Float32Array(nV * 3);
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3(), fn = new THREE.Vector3();
  for (let f = 0; f < ind.length; f += 3) {
    const a = ind[f], b = ind[f + 1], c = ind[f + 2];
    pA.fromArray(pos, a * 3); pB.fromArray(pos, b * 3); pC.fromArray(pos, c * 3);
    fn.subVectors(pC, pB).cross(pA.clone().sub(pB));
    for (const x of [a, b, c]) { nrm[x * 3] += fn.x; nrm[x * 3 + 1] += fn.y; nrm[x * 3 + 2] += fn.z; }
  }
  for (let i = 0; i < nV; i++) { fn.fromArray(nrm, i * 3).normalize(); if (i < nSmooth && fn.lengthSq() < 0.5) fn.set(an.N[src[i] * 3], an.N[src[i] * 3 + 1], an.N[src[i] * 3 + 2]); nrm[i * 3] = fn.x; nrm[i * 3 + 1] = fn.y; nrm[i * 3 + 2] = fn.z; }
  const SI = new Uint16Array(nV * 4), SW = new Float32Array(nV * 4);
  src.forEach((s, i) => { for (let q = 0; q < 4; q++) { SI[i * 4 + q] = an.SI[s * 4 + q]; SW[i * 4 + q] = an.SW[s * 4 + q]; } });
  return finalizeSkinned(an, { pos: new Float32Array(pos), nrm, uv: new Float32Array(uvs), index: ind, SI, SW });
}
const vtx = (an, i) => ({ x: an.P[i * 3], y: an.P[i * 3 + 1], z: an.P[i * 3 + 2], nx: an.N[i * 3], ny: an.N[i * 3 + 1], nz: an.N[i * 3 + 2], r: an.reg[i], s: an.side[i] });
const offsetFn = (an, offFn) => (i, t) => { const o = offFn(i); t.set(an.P[i * 3] + an.N[i * 3] * o, an.P[i * 3 + 1] + an.N[i * 3 + 1] * o, an.P[i * 3 + 2] + an.N[i * 3 + 2] * o); };
const all3 = (pred) => (a, b, c) => pred(a) && pred(b) && pred(c);
const maj3 = (pred) => (a, b, c) => (pred(a) + pred(b) + pred(c)) >= 2;
/** Parameter t eines Punkts entlang eines Knochensegments (0 = Kopf, 1 = Ende) */
const along = (an, i, A, B) => { const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z; return ((an.P[i * 3] - A.x) * dx + (an.P[i * 3 + 1] - A.y) * dy + (an.P[i * 3 + 2] - A.z) * dz) / (dx * dx + dy * dy + dz * dz); };

/** Haut-Index ohne die abgedeckten Dreiecke (geteilte Attribute, eigener Index) */
function skinVariant(base, coverKey, coverPred) {
  return cached(base, 'skin:' + coverKey, () => {
    const an = base.an, src = an.skin.geometry, keep = [];
    const covered = maj3(coverPred), idx = an.index;
    for (let t = 0; t < idx.length; t += 3) if (!covered(idx[t], idx[t + 1], idx[t + 2])) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    const g = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(src.attributes)) g.setAttribute(k, a);
    g.setIndex(keep); g.boundingSphere = src.boundingSphere ? src.boundingSphere.clone() : new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2);
    return g;
  });
}

// ---- Stiefel / Schuhe -------------------------------------------------------------------------
function buildFootwear(base, side, kind, clearance) {
  const an = base.an, S = side === 'L' ? 1 : -1;
  const ankle = an.key[side === 'L' ? 'ankleL' : 'ankleR'];
  const toeB = an.bone('toe3-1.' + side);
  const toe = toeB ? wpos(toeB) : ankle.clone().add(new THREE.Vector3(0, -0.06, 0.14));
  const Z = toe.clone().sub(ankle); Z.y = 0; Z.normalize();
  const X = new THREE.Vector3().crossVectors(UP, Z).normalize(), O = new THREE.Vector3(ankle.x, 0, ankle.z);
  const F = [], cand = [];
  for (let i = 0; i < an.n; i++) {
    if (an.side[i] !== S || (an.reg[i] !== R.foot && an.reg[i] !== R.shin)) continue;
    const x = an.P[i * 3] - O.x, z = an.P[i * 3 + 2] - O.z, y = an.P[i * 3 + 1];
    if (y > 0.42) continue;
    cand.push(i);
    if (an.reg[i] === R.foot) F.push([x * X.x + z * X.z, y, x * Z.x + z * Z.z]);
  }
  const soleY = Math.min(...F.map((p) => p[1])), heelZ = Math.min(...F.map((p) => p[2])), toeZ = Math.max(...F.map((p) => p[2]));
  const footTop = Math.max(...F.map((p) => p[1]));
  const NB = 12, L = toeZ - heelZ;
  const bins = Array.from({ length: NB }, (_, k) => ({ z: heelZ + (k + 0.5) / NB * L, x0: 1, x1: -1, h: soleY + 0.04 }));
  for (const [x, y, z] of F) { const b = bins[clamp(Math.floor((z - heelZ) / L * NB), 0, NB - 1)]; if (y < soleY + 0.045) { b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); } if (z > 0.02 || y < 0.12) b.h = Math.max(b.h, y); }
  for (let k = 0; k < NB; k++) if (bins[k].x0 > bins[k].x1) { const o = bins[k > 0 ? k - 1 : k + 1]; bins[k].x0 = o.x0; bins[k].x1 = o.x1; }
  const sm = (f) => bins.map((b, k) => (f(bins[Math.max(0, k - 1)]) + 2 * f(b) + f(bins[Math.min(NB - 1, k + 1)])) / 4);
  const cxs = sm((b) => (b.x0 + b.x1) / 2), hws = sm((b) => (b.x1 - b.x0) / 2), hs = sm((b) => b.h);
  // Umriss mit runden Kappen an Ferse und Spitze
  const bootish = kind === 'combat';
  const outline = (z, margin) => {
    const r0 = hws[0] + margin, r1 = hws[NB - 1] + margin;
    const z0 = heelZ - margin + r0 * 0.9, z1 = toeZ + margin - r1;
    if (z < z0) { const e = (z0 - z) / (r0 * 0.9); return [cxs[0], e >= 1 ? 0 : r0 * Math.sqrt(1 - e * e)]; }
    if (z > z1) { const e = (z - z1) / r1; return [cxs[NB - 1], e >= 1 ? 0 : r1 * Math.sqrt(1 - e * e)]; }
    const f = clamp((z - bins[0].z) / (bins[NB - 1].z - bins[0].z) * (NB - 1), 0, NB - 1), k = Math.min(NB - 2, Math.floor(f)), u = f - k;
    return [cxs[k] + (cxs[k + 1] - cxs[k]) * u, hws[k] + (hws[k + 1] - hws[k]) * u + margin];
  };
  const heightAt = (z) => { const f = clamp((z - bins[0].z) / (bins[NB - 1].z - bins[0].z) * (NB - 1), 0, NB - 1), k = Math.min(NB - 2, Math.floor(f)), u = f - k; return hs[k] + (hs[k + 1] - hs[k]) * u; };
  const soleT = kind === 'leather' ? 0.016 : 0.026, soleBottom = soleY - 0.008, soleTop = soleBottom + soleT;
  const parts = { upper: [], sole: [], lace: [] };
  const toWorld = new THREE.Matrix4().makeBasis(X, UP, Z).setPosition(O);
  // Sohle (Profil-Umriss extrudiert, gefast)
  {
    const m = 0.009, pts = [], K = 26;
    for (let k = 0; k <= K; k++) { const z = heelZ - m + (L + 2 * m) * k / K; const [cx, hw] = outline(z, m); pts.push([cx - hw, z]); }
    for (let k = K; k >= 0; k--) { const z = heelZ - m + (L + 2 * m) * k / K; const [cx, hw] = outline(z, m); pts.push([cx + hw, z]); }
    const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    const bev = 0.003, geo = new THREE.ExtrudeGeometry(shape, { depth: soleT - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: 4 });
    geo.rotateX(-Math.PI / 2); geo.translate(0, soleBottom + bev, 0);
    parts.sole.push(geo);
    if (kind !== 'sneaker') { // Absatzkante
      const hp = pts.filter(([, z]) => z < heelZ + 0.075);
      const hg = new THREE.ExtrudeGeometry(new THREE.Shape(hp.map(([x, z]) => new THREE.Vector2(x * 0.98, -z))), { depth: 0.006, bevelEnabled: false });
      hg.rotateX(-Math.PI / 2); hg.translate(0, soleBottom - 0.0005, 0); parts.sole.push(hg);
    }
  }
  // Schaftunterteil / Vorderfuß als geloftete U-Ringe
  const Q = bootish ? 22 : 18, ST = 22;
  {
    const pos = [], ind = [], uv = [];
    const z0 = heelZ - 0.003, z1 = toeZ + 0.004;
    for (let s = 0; s <= ST; s++) {
      const z = z0 + (z1 - z0) * s / ST, [cx, hw0] = outline(z, 0.0045);
      const cap = hw0 / (outline(clamp(z, bins[0].z, bins[NB - 1].z), 0.0045)[1] || 1);
      const top = Math.max(soleTop + 0.035, Math.min(heightAt(z) + 0.013, soleTop + (bootish ? 0.12 : 0.09)));
      const yTop = soleTop - 0.004 + (top - soleTop + 0.004) * Math.sqrt(clamp(cap, 0, 1));
      for (let q = 0; q <= Q; q++) {
        const ph = Math.PI * q / Q, cs = Math.cos(ph), sn = Math.sin(ph);
        pos.push(cx + hw0 * sgnpow(cs, 0.55), soleTop - 0.005 + (yTop - soleTop + 0.005) * Math.pow(sn, 0.45), z);
        uv.push(q / Q, s / ST);
      }
    }
    for (let s = 0; s < ST; s++) for (let q = 0; q < Q; q++) { const a = s * (Q + 1) + q, b = a + Q + 1; ind.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(ind);
    g.computeVertexNormals(); parts.upper.push(g);
  }
  // Schaft um Knöchel/Schienbein
  const shaftTop = kind === 'combat' ? soleY + 0.215 : Math.max(soleY + 0.075, Math.min(footTop + 0.01, soleY + 0.11));
  const ringsY = [], RN = kind === 'combat' ? 9 : 4;
  for (let k = 0; k <= RN; k++) ringsY.push(soleTop - 0.004 + (shaftTop - soleTop + 0.004) * k / RN);
  const ring = ringsY.map((y) => {
    let x0 = 1, x1 = -1, zz0 = 1, zz1 = -1;
    for (const i of cand) {
      const py = an.P[i * 3 + 1]; if (Math.abs(py - y) > 0.022) continue;
      const dx = an.P[i * 3] - O.x, dz = an.P[i * 3 + 2] - O.z, lx = dx * X.x + dz * X.z, lz = dx * Z.x + dz * Z.z;
      if (lz > 0.045) continue;
      x0 = Math.min(x0, lx); x1 = Math.max(x1, lx); zz0 = Math.min(zz0, lz); zz1 = Math.max(zz1, lz);
    }
    return { y, cx: (x0 + x1) / 2, cz: (zz0 + zz1) / 2, rx: (x1 - x0) / 2 + clearance, rz: (zz1 - zz0) / 2 + clearance };
  }).filter((r) => r.rx > 0.01);
  for (let it = 0; it < 2; it++) for (let k = 1; k < ring.length - 1; k++) for (const f of ['cx', 'cz', 'rx', 'rz']) ring[k][f] = (ring[k - 1][f] + 2 * ring[k][f] + ring[k + 1][f]) / 4;
  for (let k = 1; k < ring.length; k++) { ring[k].rx = Math.max(ring[k].rx, ring[k - 1].rx * 0.86); ring[k].rz = Math.max(ring[k].rz, ring[k - 1].rz * 0.86); }
  const top = ring[ring.length - 1];
  ring.push({ y: top.y + 0.004, cx: top.cx, cz: top.cz, rx: top.rx + 0.003, rz: top.rz + 0.003 });
  ring.push({ y: top.y + 0.006, cx: top.cx, cz: top.cz, rx: top.rx - 0.001, rz: top.rz - 0.001 });
  ring.push({ y: top.y - 0.012, cx: top.cx, cz: top.cz, rx: top.rx - 0.004, rz: top.rz - 0.004 });
  {
    const QQ = bootish ? 26 : 20, pos = [], ind = [], uv = [];
    ring.forEach((r, k) => { for (let q = 0; q <= QQ; q++) { const ph = (q / QQ) * Math.PI * 2; pos.push(r.cx + r.rx * sgnpow(Math.sin(ph), 0.8), r.y, r.cz + r.rz * sgnpow(Math.cos(ph), 0.8)); uv.push(q / QQ, k / ring.length); } });
    for (let k = 0; k < ring.length - 1; k++) for (let q = 0; q < QQ; q++) { const a = k * (QQ + 1) + q, b = a + QQ + 1; ind.push(a, a + 1, b, a + 1, b + 1, b); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(ind);
    g.computeVertexNormals(); parts.upper.push(g);
  }
  // Schnürung
  {
    const crossings = [];
    if (kind === 'combat') { for (let k = 0; k < 7; k++) { const y = soleTop + 0.045 + (shaftTop - soleTop - 0.06) * k / 6; const r = ring.reduce((a, b) => (Math.abs(b.y - y) < Math.abs(a.y - y) ? b : a)); crossings.push({ c: new THREE.Vector3(r.cx, y, r.cz + r.rz + 0.001), w: r.rx * 0.45, up: new THREE.Vector3(0, 1, 0), n: new THREE.Vector3(0, 0, 1) }); } }
    const zs = kind === 'combat' ? [0.02, 0.045] : [0.0, 0.025, 0.05, 0.075];
    for (const z of zs) { const [cx, hw] = outline(z, 0); const y = Math.min(heightAt(z) + 0.013, soleTop + (bootish ? 0.12 : 0.09)); crossings.push({ c: new THREE.Vector3(cx, y + 0.002, z), w: hw * 0.42, up: new THREE.Vector3(0, -0.35, 1).normalize(), n: new THREE.Vector3(0, 1, 0.35).normalize() }); }
    for (const cr of crossings) for (const sgn of [-1, 1]) {
      const a = new THREE.Vector3(cr.c.x - cr.w, 0, 0), b = new THREE.Vector3(cr.c.x + cr.w, 0, 0);
      const seg = new THREE.BoxGeometry(cr.w * 2.1, 0.0035, 0.0035);
      seg.rotateZ(sgn * 0.32 * (cr.n.y > 0.5 ? 0 : 1)); if (cr.n.y > 0.5) seg.rotateY(sgn * 0.35);
      const tilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), cr.n); seg.applyQuaternion(tilt);
      seg.translate(cr.c.x, cr.c.y, cr.c.z); parts.lace.push(seg.toNonIndexed()); void a; void b;
    }
  }
  const out = {};
  for (const [k, list] of Object.entries(parts)) {
    if (!list.length) continue;
    const gs = list.map((g) => { const x = g.index ? g.toNonIndexed() : g; if (!x.attributes.uv) x.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2)); if (!x.attributes.normal) x.computeVertexNormals(); for (const a of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(a)) x.deleteAttribute(a); return x; });
    const merged = mergeGeometries(gs); merged.applyMatrix4(toWorld);
    const pos = merged.attributes.position.array, nrm = merged.attributes.normal.array;
    const { SI, SW } = knnSkin(an, pos, cand, 4);
    out[k] = finalizeSkinned(an, { pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), uv: Float32Array.from(merged.attributes.uv.array), index: null, SI, SW });
    gs.forEach((g) => g.dispose()); merged.dispose(); list.forEach((g) => g.dispose());
  }
  return out;
}

// ---- Helm (starr am Bone head) ------------------------------------------------------------------
function buildHelmet(base, type) {
  const an = base.an, hb = an.headBox, e = an.eyeC;
  const c = new THREE.Vector3((hb.min.x + hb.max.x) / 2, e.y + 0.025, (hb.min.z + hb.max.z) / 2 - 0.004);
  const power = type === 'power', mg = power ? 0.045 : 0.03;
  const rx = (hb.max.x - hb.min.x) / 2 + mg, rzF = hb.max.z - c.z + mg, rzB = c.z - hb.min.z + mg, ry = an.topY - c.y + mg * 0.9;
  const ryDown = power ? 0.24 : 0.12;
  const f = power ? e.y - 0.135 : e.y + 0.042, s = power ? e.y - 0.14 : e.y + 0.0, b = power ? e.y - 0.16 : e.y - 0.045;
  const a1 = (f - b) / 2, a2 = ((f + b) / 2 - s) / 2, a0 = ((f + b) / 2 + s) / 2;
  const rimY = (ph) => a0 + a1 * Math.cos(ph) + a2 * Math.cos(2 * ph);
  const surf = (ph, y, grow) => { // Punkt auf der (Super-)Ellipsoid-Schale in Höhe y
    const ryy = y >= c.y ? ry : ryDown;
    const u = clamp((y - c.y) / (ryy + grow), -0.999, 0.999), k = Math.pow(1 - Math.pow(Math.abs(u), 2.4), 1 / 2.4);
    const rz = Math.cos(ph) > 0 ? rzF : rzB;
    return new THREE.Vector3(c.x + (rx + grow) * k * sgnpow(Math.sin(ph), 0.85), y, c.z + (rz + grow) * k * sgnpow(Math.cos(ph), 0.85));
  };
  const AZ = 40, EL = 14, pos = [], ind = [], grp = [];
  const shell = (grow, flip) => {
    const o = pos.length / 3;
    for (let j = 0; j <= EL; j++) for (let i = 0; i <= AZ; i++) {
      const ph = (i / AZ) * Math.PI * 2, y0 = c.y + ry + grow, y1 = rimY(ph), t = j / EL;
      const y = y0 + (y1 - y0) * (1 - Math.cos(t * Math.PI / 2)) ** 0.85;
      const p = surf(ph, Math.min(y, c.y + ry + grow - 1e-4), grow); pos.push(p.x, p.y, p.z);
    }
    for (let j = 0; j < EL; j++) for (let i = 0; i < AZ; i++) { const a = o + j * (AZ + 1) + i, b2 = a + AZ + 1; if (flip) ind.push(a, a + 1, b2, a + 1, b2 + 1, b2); else ind.push(a, b2, a + 1, a + 1, b2, b2 + 1); }
    return o;
  };
  const thick = 0.009;
  const oOut = shell(0, false), oIn = shell(-thick, true);
  for (let i = 0; i < AZ; i++) { const a = oOut + EL * (AZ + 1) + i, b2 = oIn + EL * (AZ + 1) + i; ind.push(a, b2, a + 1, a + 1, b2, b2 + 1); }
  let g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(ind);
  g = g.toNonIndexed(); g.computeVertexNormals();
  // glatte Normalen für die Außenschale
  { const gi = new THREE.BufferGeometry(); gi.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gi.setIndex(ind); gi.computeVertexNormals(); const nn = gi.attributes.normal.array, ia = ind;
    const na = g.attributes.normal.array; for (let k = 0; k < ia.length; k++) { na[k * 3] = nn[ia[k] * 3]; na[k * 3 + 1] = nn[ia[k] * 3 + 1]; na[k * 3 + 2] = nn[ia[k] * 3 + 2]; } gi.dispose(); }
  const uvs = new Float32Array(g.attributes.position.count * 2); for (let k = 0; k < uvs.length / 2; k++) { uvs[k * 2] = g.attributes.position.array[k * 3] * 4; uvs[k * 2 + 1] = g.attributes.position.array[k * 3 + 1] * 4; }
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  const parts = { shell: [g], dark: [], visor: [] };
  // Anbauteile: NVG-Halter, Seitenschienen, Kinnriemen
  const at = (ph, y, grow) => surf(ph, y, grow);
  const box = (w, h, d, p, lookOut, tiltX = 0) => { const bg = new THREE.BoxGeometry(w, h, d); if (tiltX) bg.rotateX(tiltX); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), lookOut); bg.applyQuaternion(q); bg.translate(p.x, p.y, p.z); return bg.toNonIndexed(); };
  if (!power) {
    const pf = at(0, f + 0.022, 0.004), nf = pf.clone().sub(c).setY(0).normalize();
    parts.dark.push(box(0.05, 0.035, 0.012, pf, nf, -0.25));
    for (const sgn of [-1, 1]) {
      for (let k = 0; k < 3; k++) { const ph = sgn * (Math.PI / 2 + (k - 1) * 0.28); const y = rimY(ph) + 0.022; const p = at(ph, y, 0.003); const nrm = p.clone().sub(c).setY(0).normalize(); parts.dark.push(box(0.03, 0.016, 0.01, p, nrm)); }
      // Kinnriemen
      const sp = at(sgn * Math.PI / 2 * 0.92, s + 0.004, -0.012), ch = an.chin ? an.chin.clone().add(new THREE.Vector3(0, -0.012, -0.012)) : new THREE.Vector3(c.x, e.y - 0.13, c.z + 0.06);
      const mid = new THREE.Vector3(c.x + sgn * rx * 0.62, (sp.y + ch.y) / 2, (sp.z + ch.z) / 2 - 0.012);
      const curve = new THREE.CatmullRomCurve3([sp, mid, new THREE.Vector3(ch.x + sgn * 0.025, ch.y + 0.004, ch.z - 0.006), ch]);
      parts.dark.push(new THREE.TubeGeometry(curve, 12, 0.0035, 5, false).toNonIndexed());
    }
  }
  // Visier: personal = klarer Gesichtsschutz, power = getöntes Vollvisier
  {
    const vpos = [], vind = [], VA = 18, VE = 8, grow = power ? 0.004 : 0.016;
    const phMax = power ? 1.05 : 1.2, yT = power ? e.y + 0.05 : f + 0.004, yB = power ? e.y - 0.075 : e.y - 0.085;
    for (let j = 0; j <= VE; j++) for (let i = 0; i <= VA; i++) { const ph = -phMax + 2 * phMax * i / VA; const y = yT + (yB - yT) * j / VE; const p = surf(ph, Math.min(y, c.y + ry), grow); if (!power) p.addScaledVector(new THREE.Vector3(Math.sin(ph), 0, Math.cos(ph)), 0.012 * (j / VE)); vpos.push(p.x, p.y, p.z); }
    for (let j = 0; j < VE; j++) for (let i = 0; i < VA; i++) { const a = j * (VA + 1) + i, b2 = a + VA + 1; vind.push(a, b2, a + 1, a + 1, b2, b2 + 1); }
    let vg = new THREE.BufferGeometry(); vg.setAttribute('position', new THREE.Float32BufferAttribute(vpos, 3)); vg.setIndex(vind); vg.computeVertexNormals(); vg = vg.toNonIndexed();
    vg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(vg.attributes.position.count * 2), 2)); parts.visor.push(vg);
    if (power) { // Visierrahmen
      for (const y of [yT + 0.004, yB - 0.004]) { const pts = []; for (let i = 0; i <= 16; i++) pts.push(surf(-phMax - 0.05 + (2 * phMax + 0.1) * i / 16, y, grow + 0.002)); parts.dark.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.005, 6, false).toNonIndexed()); }
    }
  }
  const out = {};
  for (const [k, list] of Object.entries(parts)) {
    if (!list.length) continue;
    const gs = list.map((x) => { if (!x.attributes.uv) x.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2)); if (!x.attributes.normal) x.computeVertexNormals(); return x; });
    out[k] = mergeGeometries(gs); out[k].applyMatrix4(an.headRestInv);
  }
  void grp;
  return { geos: out, rimY, center: c };
}

// ---- Waffen (prozedural, Ursprung = Griffpunkt in der Handfläche, +Z Mündung, +Y oben) ----------
function profile(pts, depth, bev = 0.0015) {
  const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.001, depth - 2 * bev), bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -(depth - 2 * bev) / 2); g.rotateY(-Math.PI / 2);
  return g;
}
function cylZ(r, z0, z1, y = 0, seg = 16, r2 = r) { const g = new THREE.CylinderGeometry(r2, r, z1 - z0, seg); g.rotateX(Math.PI / 2); g.translate(0, y, (z0 + z1) / 2); return g; }
function boxAt(w, h, d, x, y, z) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; }
function mergeList(list) {
  const gs = list.map((g) => { const x = g.index ? g.toNonIndexed() : g; if (!x.attributes.uv) x.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2)); return x; });
  const m = mergeGeometries(gs); gs.forEach((g) => g.dispose()); list.forEach((g) => g.dispose()); return m;
}
const GRIP_TILT = 0.31; // Griffwinkel ~18°
function buildRifle() {
  const metal = [], poly = [], glass = [];
  const bore = 0.072;
  metal.push(profile([[-0.062, 0.05], [0.172, 0.05], [0.172, 0.083], [0.165, 0.09], [-0.052, 0.09], [-0.062, 0.08]], 0.026)); // Oberes Gehäuse
  metal.push(profile([[-0.052, 0.05], [0.152, 0.05], [0.152, 0.032], [0.136, 0.032], [0.136, -0.004], [0.074, -0.004], [0.074, 0.02], [0.02, 0.02], [-0.02, 0.024], [-0.052, 0.036]], 0.024)); // Unteres Gehäuse + Magazinschacht
  metal.push(boxAt(0.021, 0.008, 0.49, 0, 0.094, 0.19)); // Picatinny-Schiene
  for (let k = 0; k < 44; k++) metal.push(boxAt(0.023, 0.004, 0.0052, 0, 0.1, -0.045 + k * 0.0105));
  { const hg = new THREE.CylinderGeometry(0.024, 0.024, 0.27, 8); hg.rotateY(Math.PI / 8); hg.rotateX(Math.PI / 2); hg.translate(0, bore, 0.305); poly.push(hg); } // Handschutz (achtkantig)
  for (let k = 0; k < 5; k++) for (const sgn of [-1, 1]) poly.push(boxAt(0.004, 0.009, 0.026, sgn * 0.0235, bore - 0.004, 0.2 + k * 0.045));
  metal.push(cylZ(0.0095, 0.44, 0.565, bore, 14)); // Lauf
  metal.push(boxAt(0.02, 0.022, 0.024, 0, bore + 0.002, 0.455)); // Gasblock
  metal.push(cylZ(0.0125, 0.565, 0.622, bore, 14)); // Mündungsbremse
  for (let k = 0; k < 3; k++) metal.push(boxAt(0.027, 0.004, 0.006, 0, bore + 0.009, 0.575 + k * 0.014));
  metal.push(cylZ(0.0158, -0.25, -0.055, bore - 0.004, 14)); // Pufferrohr
  poly.push(profile([[-0.17, 0.097], [-0.318, 0.097], [-0.334, 0.087], [-0.334, -0.032], [-0.305, -0.04], [-0.255, 0.012], [-0.2, 0.048], [-0.17, 0.056]], 0.042, 0.004)); // Schulterstütze
  poly.push(boxAt(0.044, 0.13, 0.01, 0, 0.03, -0.337)); // Schaftkappe
  poly.push(profile([[0.023, 0.034], [-0.013, 0.034], [-0.036, -0.058], [-0.022, -0.068], [0.002, -0.063], [0.012, -0.03], [0.02, -0.01]], 0.029, 0.003)); // Pistolengriff
  metal.push(profile([[0.022, 0.022], [0.078, 0.022], [0.078, 0.014], [0.03, 0.012], [0.022, 0.012]], 0.012)); // Abzugsbügel
  metal.push(boxAt(0.004, 0.018, 0.005, 0, 0.012, 0.042)); // Abzug
  poly.push(profile([[0.079, 0.0], [0.133, 0.0], [0.146, -0.085], [0.158, -0.17], [0.104, -0.176], [0.093, -0.09]], 0.022, 0.002)); // Magazin (gebogen)
  poly.push(profile([[0.1, -0.172], [0.162, -0.166], [0.163, -0.186], [0.1, -0.19]], 0.026, 0.002));
  metal.push(cylZ(0.019, 0.03, 0.122, 0.128, 18)); // Rotpunktvisier
  metal.push(boxAt(0.024, 0.03, 0.05, 0, 0.11, 0.076));
  metal.push(boxAt(0.012, 0.012, 0.016, 0.022, 0.13, 0.08));
  glass.push(cylZ(0.0165, 0.121, 0.124, 0.128, 18));
  metal.push(boxAt(0.012, 0.01, 0.03, -0.017, 0.074, -0.04)); // Ladehebel
  return { metal: mergeList(metal), poly: mergeList(poly), glass: mergeList(glass), muzzle: new THREE.Vector3(0, bore, 0.625), support: new THREE.Vector3(0, bore, 0.315), butt: new THREE.Vector3(0, 0.03, -0.338), bore };
}
function buildPistol() {
  const metal = [], poly = [];
  metal.push(profile([[-0.036, 0.043], [0.155, 0.043], [0.155, 0.068], [0.149, 0.075], [-0.031, 0.075], [-0.036, 0.069]], 0.023, 0.0015)); // Schlitten
  for (let k = 0; k < 7; k++) metal.push(boxAt(0.0245, 0.022, 0.0016, 0, 0.058, -0.028 + k * 0.0045));
  metal.push(boxAt(0.006, 0.006, 0.006, 0, 0.078, 0.145)); metal.push(boxAt(0.016, 0.006, 0.008, 0, 0.078, -0.02));
  poly.push(profile([[-0.026, 0.044], [0.142, 0.044], [0.142, 0.03], [0.075, 0.03], [0.072, 0.0], [0.06, -0.006], [0.018, -0.006], [0.012, 0.026], [-0.026, 0.03]], 0.021, 0.0015)); // Rahmen + Bügel
  poly.push(profile([[0.02, 0.03], [-0.016, 0.03], [-0.036, -0.068], [-0.006, -0.075], [0.012, -0.02]], 0.03, 0.003)); // Griff
  metal.push(boxAt(0.004, 0.016, 0.005, 0, 0.012, 0.038));
  metal.push(cylZ(0.0062, 0.153, 0.157, 0.059, 12));
  return { metal: mergeList(metal), poly: mergeList(poly), glass: null, muzzle: new THREE.Vector3(0, 0.059, 0.158), support: null, butt: null, bore: 0.059 };
}
/** Transform Waffe→wrist-Bone aus dem Handrahmen (Griffachse ↔ Knöchellinie, Lauf ↔ Fingerrichtung) */
const GRIP_ADJUST = { pitch: -0.08, yaw: 0.0, roll: 0.0, off: new THREE.Vector3(0.0, -0.004, 0.006) };
function weaponGripMatrix(hf) {
  const gA = new THREE.Vector3(0, Math.cos(GRIP_TILT), Math.sin(GRIP_TILT)), gF = new THREE.Vector3(0, -Math.sin(GRIP_TILT), Math.cos(GRIP_TILT));
  const basisGun = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(gA, gF), gA, gF);
  const hA = hf.a.clone().normalize(), hF = hf.d.clone().normalize();
  const basisHand = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(hA, hF), hA, hF);
  const rot = basisHand.multiply(basisGun.clone().transpose());
  const adj = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(GRIP_ADJUST.pitch, GRIP_ADJUST.yaw, GRIP_ADJUST.roll));
  rot.multiply(adj);
  const p = hf.palm.clone().add(GRIP_ADJUST.off.clone().applyMatrix4(new THREE.Matrix4().extractRotation(rot)));
  return rot.setPosition(p);
}

// ---------------------------------------------------------------------------------------------
// Ausstattung je Basis (gecacht): Haut-Varianten, Uniform, Weste, Panzer, Stiefel, Helm
// ---------------------------------------------------------------------------------------------
function outfitParts(base, o) {
  const an = analyze(base), K = an.key;
  const soldier = o.role === 'soldier', power = o.armorType === 'power', personal = o.armorType === 'personal';
  const hipsY = K.hips.y, shY = (K.shoulderL.y + K.shoulderR.y) / 2;
  const longPants = !soldier && o.longPants;
  // Abdeckung (Haut-Dreiecke ausblenden)
  const coverRegs = new Set([R.foot]);
  if (soldier) [R.torso, R.hips, R.shoulder, R.upperarm, R.forearm, R.thigh, R.shin].forEach((r) => coverRegs.add(r));
  if (soldier && power) coverRegs.add(R.neck);
  if (longPants) [R.hips, R.thigh, R.shin].forEach((r) => coverRegs.add(r));
  if (o.gloves) coverRegs.add(R.hand);
  const lowTorso = (i) => an.reg[i] === R.torso && an.P[i * 3 + 1] < hipsY + 0.1;
  const covered = (i) => coverRegs.has(an.reg[i]) || (longPants && lowTorso(i));
  const ckey = [...coverRegs].sort().join(',') + (longPants ? 'p' : '');
  const res = { skinGeo: skinVariant(base, ckey, covered), skinned: [], helmet: null, hideHair: false, hairGeo: null };
  const q = o.quality === 'low';
  // Uniform / Hose (Schale aus der Haut)
  const offU = { [R.torso]: 0.011, [R.hips]: 0.013, [R.shoulder]: 0.011, [R.upperarm]: 0.010, [R.forearm]: 0.009, [R.thigh]: 0.013, [R.shin]: 0.015, [R.neck]: 0.006 };
  if (soldier || longPants) {
    const regs = soldier ? [R.torso, R.hips, R.shoulder, R.upperarm, R.forearm, R.thigh, R.shin].concat(power ? [R.neck] : []) : [R.hips, R.thigh, R.shin];
    const rs = new Set(regs);
    const pred = (i) => rs.has(an.reg[i]) || (longPants && lowTorso(i));
    const geo = cached(base, 'uniform:' + regs.join(',') + (longPants ? 'p' : ''), () => buildShell(an, maj3(pred), offsetFn(an, (i) => offU[an.reg[i]] || 0.012), null, { smooth: 1 }));
    res.skinned.push({ geo, mat: soldier ? 'uniform' : 'pants', shadow: true });
  }
  if (o.gloves) res.skinned.push({ geo: cached(base, 'gloves', () => buildShell(an, maj3((i) => an.reg[i] === R.hand), offsetFn(an, () => 0.0028), null)), mat: 'gloves', shadow: !q });
  // Schuhwerk
  const fw = soldier ? 'combat' : (o.shoes || 'sneaker');
  const clr = soldier ? 0.022 : longPants ? 0.02 : 0.006;
  for (const s of ['L', 'R']) {
    const f = cached(base, `foot:${s}:${fw}:${clr}`, () => buildFootwear(base, s, fw, clr));
    if (f.upper) res.skinned.push({ geo: f.upper, mat: 'shoeUpper', shadow: true });
    if (f.sole) res.skinned.push({ geo: f.sole, mat: 'shoeSole', shadow: !q });
    if (f.lace) res.skinned.push({ geo: f.lace, mat: 'lace', shadow: false });
  }
  // Weste / Plattenträger
  if (soldier && (personal || power)) {
    const vest = cached(base, 'vest:' + o.armorType, () => {
      const plateW = power ? 0.15 : 0.125, bottom = hipsY + (power ? -0.01 : 0.055);
      const frontTop = shY - (power ? 0.02 : 0.085), backTop = shY - (power ? 0.0 : 0.05), sideTop = shY - (power ? 0.1 : 0.15);
      const torsoRegs = new Set([R.torso, R.hips, R.shoulder].concat(power ? [R.neck] : []));
      const ok = (i) => {
        const x = Math.abs(an.P[i * 3]), y = an.P[i * 3 + 1], front = an.P[i * 3 + 2] > an.zc;
        if (!torsoRegs.has(an.reg[i]) || y < bottom) return false;
        if (an.reg[i] === R.neck) return y < shY + 0.06;
        if (x >= 0.045 && x <= (power ? 0.2 : 0.118) && y <= shY + 0.1) return true; // Schultergurte / Schulterteil
        if (x < plateW) return y <= (front ? frontTop : backTop);
        return y <= sideTop;
      };
      let Zf = -1e9, Zb = 1e9; const offF = power ? 0.045 : 0.034;
      for (let i = 0; i < an.n; i++) if (ok(i) && Math.abs(an.P[i * 3]) < plateW && an.P[i * 3 + 1] < frontTop) {
        if (an.P[i * 3 + 2] > an.zc) Zf = Math.max(Zf, an.P[i * 3 + 2] + offF); else Zb = Math.min(Zb, an.P[i * 3 + 2] - offF + 0.006);
      }
      const outer = (i, t) => {
        const x = an.P[i * 3], y = an.P[i * 3 + 1], ax = Math.abs(x), front = an.P[i * 3 + 2] > an.zc;
        const plate = ax < plateW && y < (front ? frontTop : backTop) + 0.005;
        const o2 = plate ? 0.03 : (ax > 0.045 && y > sideTop) ? (power ? 0.03 : 0.02) : (power ? 0.028 : 0.022);
        t.set(x + an.N[i * 3] * o2, y + an.N[i * 3 + 1] * o2, an.P[i * 3 + 2] + an.N[i * 3 + 2] * o2);
        if (plate) { const k = 1.6 * x * x; if (front) t.z = Math.max(t.z, Zf - k); else t.z = Math.min(t.z, Zb + k); }
      };
      return buildShell(an, all3(ok), outer, offsetFn(an, () => 0.017), { smooth: power ? 1 : 2 });
    });
    res.skinned.push({ geo: vest, mat: power ? 'plate' : 'vest', shadow: true });
    // Taschen (Magazintaschen vorn, Mehrzwecktaschen seitlich)
    if (personal) {
      const pouches = cached(base, 'pouches', () => {
        const list = [], bottom = hipsY + 0.06; let Zf = -1e9, halfW = 0;
        for (let i = 0; i < an.n; i++) if (an.reg[i] === R.torso && an.P[i * 3 + 1] > bottom && an.P[i * 3 + 1] < shY - 0.09) { if (Math.abs(an.P[i * 3]) < 0.125 && an.P[i * 3 + 2] > an.zc) Zf = Math.max(Zf, an.P[i * 3 + 2] + 0.034); }
        for (let i = 0; i < an.n; i++) if (an.reg[i] === R.torso && Math.abs(an.P[i * 3 + 1] - (bottom + 0.07)) < 0.03) halfW = Math.max(halfW, Math.abs(an.P[i * 3]));
        const rb = (w, h, d, x, y, z, r = 0.006) => { const g = new THREE.BoxGeometry(w, h, d, 4, 4, 4), p = g.attributes.position, v = new THREE.Vector3(), inner = new THREE.Vector3(w / 2 - r, h / 2 - r, d / 2 - r);
          for (let k = 0; k < p.count; k++) { v.fromBufferAttribute(p, k); const cl = v.clone().clamp(inner.clone().negate(), inner); const dv = v.clone().sub(cl); if (dv.lengthSq() > 0) dv.setLength(r); p.setXYZ(k, x + cl.x + dv.x, y + cl.y + dv.y, z + cl.z + dv.z); }
          g.computeVertexNormals(); return g; };
        for (const x of [-0.068, 0, 0.068]) { list.push(rb(0.062, 0.12, 0.034, x, bottom + 0.072, Zf + 0.016)); list.push(rb(0.064, 0.03, 0.04, x, bottom + 0.128, Zf + 0.018, 0.008)); }
        for (const sgn of [-1, 1]) list.push(rb(0.04, 0.11, 0.085, sgn * (halfW + 0.04), bottom + 0.075, an.zc - 0.01, 0.01));
        const merged = mergeList(list), pos = merged.attributes.position.array;
        const cand = []; for (let i = 0; i < an.n; i++) if (an.reg[i] === R.torso || an.reg[i] === R.hips) cand.push(i);
        const { SI, SW } = knnSkin(an, pos, cand, 6);
        const out = finalizeSkinned(an, { pos: Float32Array.from(pos), nrm: Float32Array.from(merged.attributes.normal.array), uv: Float32Array.from(merged.attributes.uv.array), index: null, SI, SW });
        merged.dispose(); return out;
      });
      res.skinned.push({ geo: pouches, mat: 'vest', shadow: !q });
    }
  }
  // Knieschützer (personal) bzw. Panzerplatten (power)
  if (soldier && (personal || power)) {
    const pieces = cached(base, 'plates:' + o.armorType, () => {
      const geos = [];
      const fwdN = (i) => an.N[i * 3 + 2];
      for (const s of ['L', 'R']) {
        const S = s === 'L' ? 1 : -1, knee = K['knee' + s], hip = K['hip' + s], ank = K['ankle' + s], sh = K['shoulder' + s], el = K['elbow' + s], wr = K['wrist' + s];
        const onSide = (i) => an.side[i] === S;
        const kneeP = (i) => onSide(i) && (an.reg[i] === R.thigh || an.reg[i] === R.shin) && an.P[i * 3 + 1] < knee.y + 0.075 && an.P[i * 3 + 1] > knee.y - 0.085 && fwdN(i) > 0.15 && an.P[i * 3 + 2] > knee.z - 0.01;
        geos.push(buildShell(an, all3(kneeP), offsetFn(an, () => (power ? 0.042 : 0.036)), offsetFn(an, () => 0.018), { smooth: 3 }));
        if (!power) continue;
        const thighP = (i) => onSide(i) && an.reg[i] === R.thigh && fwdN(i) > -0.25 && (() => { const t = along(an, i, hip, knee); return t > 0.22 && t < 0.78; })();
        geos.push(buildShell(an, all3(thighP), offsetFn(an, () => 0.034), offsetFn(an, () => 0.019), { smooth: 2 }));
        const shinP = (i) => onSide(i) && an.reg[i] === R.shin && fwdN(i) > -0.1 && (() => { const t = along(an, i, knee, ank); return t > 0.22 && t < 0.56; })();
        geos.push(buildShell(an, all3(shinP), offsetFn(an, () => 0.034), offsetFn(an, () => 0.021), { smooth: 2 }));
        const paulP = (i) => onSide(i) && (an.reg[i] === R.upperarm || an.reg[i] === R.shoulder) && an.P[i * 3] * S > sh.x * S - 0.045 && an.P[i * 3 + 1] > sh.y - 0.15 && along(an, i, sh, el) < 0.5;
        geos.push(buildShell(an, all3(paulP), offsetFn(an, () => 0.05), offsetFn(an, () => 0.024), { smooth: 3 }));
        const braceP = (i) => onSide(i) && an.reg[i] === R.forearm && (() => { const t = along(an, i, el, wr); return t > 0.25 && t < 0.82; })();
        geos.push(buildShell(an, all3(braceP), offsetFn(an, () => 0.024), offsetFn(an, () => 0.012), { smooth: 1 }));
      }
      const valid = geos.filter(Boolean); if (!valid.length) return null;
      const m = mergeGeometries(valid); valid.forEach((g) => g.dispose()); return m;
    });
    if (pieces) res.skinned.push({ geo: pieces, mat: power ? 'plate' : 'kneepad', shadow: !q });
  }
  if (soldier && power) { // Energieeinheit auf dem Rücken
    res.skinned.push({ geo: cached(base, 'pack', () => {
      let Zb = 1e9; for (let i = 0; i < an.n; i++) if (an.reg[i] === R.torso && Math.abs(an.P[i * 3]) < 0.1 && an.P[i * 3 + 1] > hipsY + 0.15 && an.P[i * 3 + 1] < shY) Zb = Math.min(Zb, an.P[i * 3 + 2]);
      const g = mergeList([boxAt(0.24, 0.3, 0.09, 0, shY - 0.17, Zb - 0.085), boxAt(0.2, 0.05, 0.1, 0, shY - 0.33, Zb - 0.085), cylZ(0.025, Zb - 0.13, Zb - 0.04, shY - 0.03, 10)]);
      g.translate(0, 0, 0); const pos = g.attributes.position.array;
      const cand = []; for (let i = 0; i < an.n; i++) if (an.reg[i] === R.torso) cand.push(i);
      const { SI, SW } = knnSkin(an, pos, cand, 8);
      const out = finalizeSkinned(an, { pos: Float32Array.from(pos), nrm: Float32Array.from(g.attributes.normal.array), uv: Float32Array.from(g.attributes.uv.array), index: null, SI, SW }); g.dispose(); return out;
    }), mat: 'plateDark', shadow: !q });
  }
  // Helm + Haare unter dem Helm entfernen
  if (soldier && (personal || power)) {
    res.helmet = cached(base, 'helmet:' + o.armorType, () => buildHelmet(base, o.armorType));
    if (power) res.hideHair = true;
    else if (an.hairMesh) {
      res.hairGeo = cached(base, 'hair:helmet', () => {
        const hg = an.hairMesh.geometry, hr = an.hairRest, ix = hg.index ? hg.index.array : Uint32Array.from({ length: hr.length / 3 }, (_, i) => i), keep = [];
        const { rimY, center } = res.helmet;
        const under = (v) => hr[v * 3 + 1] > rimY(Math.atan2(hr[v * 3] - center.x, hr[v * 3 + 2] - center.z)) - 0.012;
        for (let t = 0; t < ix.length; t += 3) if (!under(ix[t]) && !under(ix[t + 1]) && !under(ix[t + 2])) keep.push(ix[t], ix[t + 1], ix[t + 2]);
        const g = new THREE.BufferGeometry(); for (const [k, a] of Object.entries(hg.attributes)) g.setAttribute(k, a); g.setIndex(keep); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3); return g;
      });
    }
  }
  return res;
}

// ---------------------------------------------------------------------------------------------
// Materialien je Figur
// ---------------------------------------------------------------------------------------------
function baseMaterials(base, quality) {
  if (base.mats[quality]) return base.mats[quality];
  const src = {}; base.template.traverse((o) => { if (o.isMesh && o.material && !src[o.material.name]) src[o.material.name] = o.material; });
  const out = {};
  if (quality === 'high') {
    if (src.skin) out.skin = makeSkinMaterial(src.skin);
    if (src.hair) out.hair = makeHairMaterial(src.hair);
    if (src.eyes) out.eyes = physical({ name: 'eyes', map: src.eyes.map, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.03, specularIntensity: 0.6 });
    for (const k of ['brows', 'brows.001']) if (src[k]) { const m = src[k].clone(); m.alphaToCoverage = true; out[k] = m; }
  } else {
    if (src.hair) { const m = src.hair.clone(); m.alphaTest = 0.4; out.hair = m; }
  }
  base.mats[quality] = out;
  return out;
}
function camoColors(base, rnd) {
  const c = new THREE.Color(base), hsl = {}; c.getHSL(hsl);
  const mk = (dl, dh = 0, ds = 0) => new THREE.Color().setHSL((hsl.h + dh + 1) % 1, clamp(hsl.s + ds, 0, 1), clamp(hsl.l + dl, 0.03, 0.9)).getHex();
  return [mk(0), mk(-0.1, 0.01), mk(-0.05, -0.04 + rnd() * 0.02, -0.05), mk(0.07, 0.02, -0.08)];
}

// ---------------------------------------------------------------------------------------------
// Zwei-Knochen-IK (Weltraum): Kniewinkel per Kosinussatz, dann Kette auf das Ziel ausrichten, optional Pol
// ---------------------------------------------------------------------------------------------
function setWorldQuat(bone, qWorld) {
  const pq = wquat(bone.parent, _q[3]).invert();
  bone.quaternion.copy(pq.multiply(qWorld));
}
function rotateWorld(bone, qDelta) {
  const w = wquat(bone, _q[2]); w.premultiply(qDelta); setWorldQuat(bone, w); bone.updateMatrixWorld(true);
}
function twoBoneIK(a, b, c, target, pole, bendFallback) {
  const pa = wpos(a, _v[0]), pb = wpos(b, _v[1]), pc = wpos(c, _v[2]);
  const lab = pa.distanceTo(pb), lcb = pb.distanceTo(pc);
  const lat = clamp(pa.distanceTo(target), 0.02, lab + lcb - 0.002);
  const ba = _v[3].subVectors(pa, pb).normalize(), bc = _v[4].subVectors(pc, pb).normalize();
  const cur = Math.acos(clamp(ba.dot(bc), -1, 1));
  const want = Math.acos(clamp((lab * lab + lcb * lcb - lat * lat) / (2 * lab * lcb), -1, 1));
  const axis = _v[5].crossVectors(ba, bc);
  if (axis.lengthSq() < 1e-8) axis.copy(bendFallback); axis.normalize();
  rotateWorld(b, _q[0].setFromAxisAngle(axis, want - cur));
  // Kette ausrichten
  wpos(c, pc); wpos(a, pa);
  const d0 = _v[3].subVectors(pc, pa).normalize(), d1 = _v[4].subVectors(target, pa).normalize();
  rotateWorld(a, _q[0].setFromUnitVectors(d0, d1));
  if (pole) { // Ellbogen/Knie zum Pol drehen
    wpos(b, pb); wpos(a, pa);
    const ax = d1, vb = _v[5].subVectors(pb, pa), vp = _v[6].copy(pole);
    vb.addScaledVector(ax, -vb.dot(ax)); vp.addScaledVector(ax, -vp.dot(ax));
    if (vb.lengthSq() > 1e-8 && vp.lengthSq() > 1e-8) {
      vb.normalize(); vp.normalize(); let ang = Math.acos(clamp(vb.dot(vp), -1, 1));
      if (_v[7].crossVectors(vb, vp).dot(ax) < 0) ang = -ang;
      rotateWorld(a, _q[0].setFromAxisAngle(ax, ang));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Clips: Ober-/Unterkörper-Masken
// ---------------------------------------------------------------------------------------------
function upperBoneSet(base) {
  return cached(base, 'upperSet', () => {
    const an = analyze(base), set = new Set(), s3 = an.bone('spine03');
    if (s3) s3.traverse((o) => { if (o.isBone) set.add(o.name); });
    return set;
  });
}
function maskedClip(base, name, part) {
  const key = 'clip:' + name + '|' + part;
  return cached(base, key, () => {
    const c = base.clips.get(name); if (!c) return null;
    const up = upperBoneSet(base);
    const tracks = c.tracks.filter((t) => { const bn = t.name.slice(0, t.name.lastIndexOf('.')); return part === 'upper' ? up.has(bn) : !up.has(bn); });
    return new THREE.AnimationClip(name + '|' + part, c.duration, tracks);
  });
}
function kneelClip(base) {
  return cached(base, 'clip:kneel', () => {
    const c = base.clips.get('Fixing_Kneeling'); if (!c) return null;
    const fps = 30, end = Math.round(c.duration * 0.42 * fps);
    return THREE.AnimationUtils.subclip(c, 'Kneel_Down', 0, end, fps);
  });
}

// ---------------------------------------------------------------------------------------------
// makeCharacter
// ---------------------------------------------------------------------------------------------
const STATIONARY = new Set(['idle', 'aimIdle', 'aim', 'shoot', 'reload', 'crouch', 'kneel']);
const UNIFORM_COLORS = [0x5b6345, 0x4e5a3c, 0x6b6450, 0x585c4a];
const CIV_TOPS = [0x8a2f2f, 0x2f4f7a, 0xd8d4c8, 0x3d6b4f, 0x6a4a7a, 0xc9a227, 0x333338, 0x9a6a4a];
const CIV_BOTTOMS = [0x2c3e5c, 0x34302c, 0x5c5240, 0x1f2226, 0x6b6b6b];

export function makeCharacter(opts = {}) {
  if (!LIB.bases.size) throw new Error('characters.js: zuerst loadCharacterLibrary() aufrufen');
  const seed = opts.seed ?? Math.floor(Math.random() * 1e9), rnd = mulberry32(seed);
  const role = opts.role || 'soldier', soldier = role === 'soldier';
  const quality = opts.quality || LIB.quality;
  let baseId = opts.base || 'auto';
  if (baseId === 'auto') {
    const ids = [...LIB.bases.keys()].filter((id) => !opts.sex || LIB.bases.get(id).sex === opts.sex);
    baseId = ids[Math.floor(rnd() * ids.length)] || [...LIB.bases.keys()][0];
  }
  const base = LIB.bases.get(baseId); if (!base) throw new Error('characters.js: Basis nicht geladen: ' + baseId);
  const an = analyze(base);
  const armor = Object.assign({ type: soldier ? 'personal' : 'none', color: 0x4f5538 }, opts.armor || {});
  const weapon = opts.weapon === undefined ? (soldier ? 'rifle' : null) : opts.weapon;
  const clothes = Object.assign({}, opts.clothes || {});
  if (soldier) { clothes.top = clothes.top ?? UNIFORM_COLORS[Math.floor(rnd() * UNIFORM_COLORS.length)]; clothes.bottom = clothes.bottom ?? clothes.top; }
  else { clothes.top = clothes.top ?? CIV_TOPS[Math.floor(rnd() * CIV_TOPS.length)]; clothes.bottom = clothes.bottom ?? CIV_BOTTOMS[Math.floor(rnd() * CIV_BOTTOMS.length)]; }
  const o = { role, quality, armorType: armor.type, gloves: opts.gloves ?? (soldier && armor.type !== 'none'), shoes: opts.shoes || (rnd() < 0.6 ? 'sneaker' : 'leather'), longPants: opts.longPants ?? (base.sex === 'm' && !soldier) };
  const parts = outfitParts(base, o);
  const bmats = baseMaterials(base, quality);
  const ownMats = [];
  const own = (m) => { ownMats.push(m); return m; };

  // --- Klon + gemeinsames Skelett
  const clone = SkeletonUtils.clone(base.template);
  const group = new THREE.Group(); group.name = 'character:' + baseId; group.add(clone);
  const meshes = {}; clone.traverse((x) => { if (x.isSkinnedMesh) { (meshes[x.material.name] = meshes[x.material.name] || []).push(x); x.frustumCulled = false; } });
  const skinMesh = (meshes.skin || [])[0] || Object.values(meshes).flat()[0];
  const skeleton = skinMesh.skeleton;
  const extraSkeletons = [];
  for (const list of Object.values(meshes)) for (const m of list) {
    if (m === skinMesh) continue;
    const sk = m.skeleton;
    if (sk.bones.length === skeleton.bones.length && sk.bones.every((b, i) => b === skeleton.bones[i]) && sk.boneInverses.every((mi, i) => mi.equals(skeleton.boneInverses[i]))) { m.bind(skeleton, m.bindMatrix); }
    else extraSkeletons.push(sk);
  }
  const boneByName = new Map(skeleton.bones.map((b) => [b.name, b]));
  const B = (canon) => { for (const n of aliasesOf(canon)) if (boneByName.has(n)) return boneByName.get(n); return null; };

  // --- Materialien & Sichtbarkeit
  const remove = [];
  for (const [name, list] of Object.entries(meshes)) for (const m of list) {
    if (name === 'skin') { m.geometry = parts.skinGeo; if (bmats.skin) m.material = bmats.skin; }
    else if (name === 'hair') { if (parts.hideHair) remove.push(m); else { if (parts.hairGeo) m.geometry = parts.hairGeo; if (bmats.hair) m.material = bmats.hair; } }
    else if (name === 'eyes') { if (bmats.eyes) m.material = bmats.eyes; }
    else if (bmats[name]) m.material = bmats[name];
    else if (name === 'clothes_top' || name === 'clothes_bottom') {
      if (soldier || (name === 'clothes_bottom' && o.longPants)) { remove.push(m); continue; }
      const mm = own(m.material.clone()); mm.color.set(name === 'clothes_top' ? clothes.top : clothes.bottom); m.material = mm;
    }
  }
  remove.forEach((m) => m.parent && m.parent.remove(m));
  const camo = soldier && clothes.pattern !== 'solid' ? camoColors(clothes.top, rnd) : null;
  const T = textures();
  const matFor = {
    uniform: () => own(makeFabricMaterial({ name: 'uniform', color: clothes.top, camo, side: THREE.DoubleSide })),
    pants: () => own(makeFabricMaterial({ name: 'pants', color: clothes.bottom, roughness: 0.85, side: THREE.DoubleSide })),
    vest: () => own(makeFabricMaterial({ name: 'vest', color: armor.color, molle: true, roughness: 0.88, normalRepeat: 10 })),
    gloves: () => own(new THREE.MeshStandardMaterial({ name: 'gloves', color: 0x1c1d1f, roughness: 0.68, normalMap: T.leather, normalScale: new THREE.Vector2(0.4, 0.4) })),
    shoeUpper: () => own(new THREE.MeshStandardMaterial({ name: 'shoeUpper', color: soldier ? (opts.bootColor ?? 0x2a241e) : o.shoes === 'leather' ? 0x3a2518 : CIV_TOPS[Math.floor(rnd() * CIV_TOPS.length)], roughness: soldier || o.shoes === 'leather' ? 0.55 : 0.8, normalMap: soldier || o.shoes === 'leather' ? T.leather : T.fabric, normalScale: new THREE.Vector2(0.5, 0.5) })),
    shoeSole: () => own(new THREE.MeshStandardMaterial({ name: 'shoeSole', color: soldier ? 0x141414 : o.shoes === 'sneaker' ? 0xe8e6e0 : 0x1e1612, roughness: 0.9 })),
    lace: () => own(new THREE.MeshStandardMaterial({ name: 'lace', color: soldier ? 0x1a1a18 : 0xdedad0, roughness: 0.9 })),
    kneepad: () => own(new THREE.MeshStandardMaterial({ name: 'kneepad', color: 0x26282a, roughness: 0.6, normalMap: T.paint, normalScale: new THREE.Vector2(0.3, 0.3) })),
    plate: () => own(physical({ name: 'plate', color: armor.color, metalness: 0.35, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.35, normalMap: T.paint, normalScale: new THREE.Vector2(0.25, 0.25) })),
    plateDark: () => own(physical({ name: 'plateDark', color: 0x2b2e31, metalness: 0.6, roughness: 0.45 })),
    helmet: () => own(new THREE.MeshStandardMaterial({ name: 'helmet', color: armor.color, roughness: 0.78, normalMap: T.paint, normalScale: new THREE.Vector2(0.6, 0.6) })),
  };
  const matCache = {};
  const getMat = (k) => (matCache[k] = matCache[k] || (k === 'helmet' && armor.type === 'power' ? matFor.plate() : matFor[k]()));
  const attached = [];
  for (const p of parts.skinned) {
    const sm = new THREE.SkinnedMesh(p.geo, getMat(p.mat));
    sm.bind(skeleton, skinMesh.bindMatrix); sm.frustumCulled = false; sm.castShadow = p.shadow; sm.receiveShadow = true; sm.name = 'gear:' + p.mat;
    skinMesh.parent.add(sm); attached.push(sm);
  }
  // Helm
  const headBone = B('head');
  if (parts.helmet && headBone) {
    const hg = new THREE.Group(); hg.name = 'helmet';
    const shellM = new THREE.Mesh(parts.helmet.geos.shell, getMat('helmet')); shellM.castShadow = true; hg.add(shellM);
    if (parts.helmet.geos.dark) { const dm = own(new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.55, metalness: 0.3 })); const d = new THREE.Mesh(parts.helmet.geos.dark, dm); d.castShadow = quality !== 'low'; hg.add(d); }
    if (parts.helmet.geos.visor) {
      const vm = armor.type === 'power'
        ? own(physical({ color: 0x1a1208, metalness: 1.0, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.02 }))
        : own(physical({ color: 0xc8d4dc, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, specularIntensity: 1 }));
      const vmesh = new THREE.Mesh(parts.helmet.geos.visor, vm); vmesh.renderOrder = 2; hg.add(vmesh);
    }
    headBone.add(hg); attached.push(hg);
  }
  // Waffe
  let weaponObj = null, muzzle = null, gun = null;
  const wristR = B('wrist.R'), wristL = B('wrist.L');
  if (weapon && wristR && an.hand.R) {
    gun = weapon === 'pistol' ? shared('pistol', buildPistol) : shared('rifle', buildRifle);
    weaponObj = new THREE.Group(); weaponObj.name = 'weapon:' + weapon;
    const wm = shared('mat:gunMetal', () => physical({ name: 'gunMetal', color: 0x26272a, metalness: 0.85, roughness: 0.34, clearcoat: 0.2, clearcoatRoughness: 0.5 }));
    const wp = shared('mat:gunPoly:' + (opts.weaponColor ?? 0x1b1c1e), () => new THREE.MeshStandardMaterial({ name: 'gunPolymer', color: opts.weaponColor ?? 0x1b1c1e, roughness: 0.62, normalMap: T.paint, normalScale: new THREE.Vector2(0.35, 0.35) }));
    const wg = shared('mat:gunGlass', () => physical({ color: 0x10202a, metalness: 0.2, roughness: 0.05, clearcoat: 1, emissive: 0x220000 }));
    for (const [g, m] of [[gun.metal, wm], [gun.poly, wp], [gun.glass, wg]]) if (g) { const x = new THREE.Mesh(g, m); x.castShadow = quality !== 'low' || weapon === 'rifle'; weaponObj.add(x); }
    muzzle = new THREE.Object3D(); muzzle.name = 'muzzle'; muzzle.position.copy(gun.muzzle); weaponObj.add(muzzle);
    const gm = weaponGripMatrix(an.hand.R); gm.decompose(weaponObj.position, weaponObj.quaternion, weaponObj.scale);
    wristR.add(weaponObj); attached.push(weaponObj);
  }
  group.traverse((x) => { if (x.isMesh) { x.receiveShadow = true; if (x.isSkinnedMesh && x.parent === skinMesh.parent && !x.name.startsWith('gear:')) x.castShadow = true; } });

  // --- Animation
  const mixer = new THREE.AnimationMixer(clone);
  const actions = {};
  const act = (clip) => { if (!clip) return null; if (!actions[clip.name]) actions[clip.name] = mixer.clipAction(clip); return actions[clip.name]; };
  const armed = !!weapon;
  const clipN = (n) => base.clips.get(n);
  const rifle = weapon === 'rifle';
  const ch = {
    root: group, mixer, actions, base: baseId, role, seed, options: { ...opts, armor, weapon, clothes, quality, base: baseId },
    state: null, prevState: 'idle', speedMps: 0, aimPitch: 0, footIK: quality !== 'low', footLock: true, height: an.height,
    weapon: weaponObj, muzzle, bones: { head: headBone, spine01: B('spine01'), wristR, wristL, footL: B('foot.L'), footR: B('foot.R'), hips: B('root') },
    onStateEnd: null,
  };
  let cur = [], stateTime = 0, oneShot = null, ikW = { R: 0, L: 0 }, ikTarget = { R: 0, L: 0 }, recoil = 0;
  const locoClip = (state, speed) => {
    if (state === 'walk') return 'Walk_Loop';
    if (state === 'crouchWalk') return 'Crouch_Fwd_Loop';
    if (state === 'run') return (!soldier && speed > 4.0) || speed > 4.6 ? 'Sprint_Loop' : 'Jog_Fwd_Loop';
    return null;
  };
  function specFor(state) {
    const sp = ch.speedMps;
    const L = locoClip(state, sp);
    const upperArmed = (n) => [{ clip: maskedClip(base, n, 'upper') }];
    switch (state) {
      case 'idle': return armed ? [{ clip: clipN('Pistol_Idle_Loop') }] : [{ clip: clipN('Idle_Loop') }];
      case 'aimIdle': return [{ clip: clipN(armed ? 'Pistol_Idle_Loop' : 'Idle_Loop') }];
      case 'walk': case 'run': case 'crouchWalk': {
        const ts = clamp(Math.max(sp, 0.2) / (an.speeds[L] || 1.3), 0.45, 2.2);
        return armed ? [{ clip: maskedClip(base, L, 'lower'), ts, loco: true }, ...upperArmed('Pistol_Idle_Loop')] : [{ clip: clipN(L), ts, loco: true }];
      }
      case 'crouch': return armed ? [{ clip: maskedClip(base, 'Crouch_Idle_Loop', 'lower') }, ...upperArmed('Pistol_Idle_Loop')] : [{ clip: clipN('Crouch_Idle_Loop') }];
      case 'kneel': { const k = kneelClip(base); return armed ? [{ clip: k, once: true, clamp: true, part: 'lower' }, ...upperArmed('Pistol_Idle_Loop')] : [{ clip: k, once: true, clamp: true }]; }
      case 'aim': return [{ clip: clipN('Pistol_Aim_Neutral'), aim: 0 }, { clip: clipN('Pistol_Aim_Up'), aim: 1 }, { clip: clipN('Pistol_Aim_Down'), aim: -1 }];
      case 'shoot': return [{ clip: clipN('Pistol_Shoot'), once: true, next: 'aim' }];
      case 'reload': return [{ clip: clipN('Pistol_Reload'), once: true, next: 'aimIdle' }];
      case 'hit': return [{ clip: clipN(rnd() < 0.5 ? 'Hit_Chest' : 'Hit_Head'), once: true, next: '@prev' }];
      case 'die': return [{ clip: clipN('Death01'), once: true, clamp: true, next: 'dead' }];
      case 'dead': return [{ clip: clipN('Death01'), once: true, clamp: true, toEnd: true }];
      default: return [{ clip: clipN('Idle_Loop') }];
    }
  }
  function aimWeights(a) { const p = clamp(ch.aimPitch / 0.7, -1, 1); return a === 1 ? Math.max(0, p) : a === -1 ? Math.max(0, -p) : 1 - Math.abs(p); }
  ch.setState = (state, sopts = {}) => {
    if (sopts.speedMps !== undefined) ch.speedMps = sopts.speedMps;
    if (state === ch.state && !sopts.force) { ch.setSpeed(ch.speedMps); return ch; }
    if (ch.state === 'dead' && state !== 'dead' && !sopts.force) return ch;
    const fade = sopts.fade ?? (state === 'die' || state === 'hit' ? 0.12 : state === 'shoot' ? 0.08 : 0.25);
    if (ch.state && !['hit', 'shoot', 'reload'].includes(ch.state)) ch.prevState = ch.state;
    const prevLoco = cur.find((c) => c.spec.loco);
    const spec = specFor(state).filter((s) => s.clip);
    const next = [];
    for (const s of spec) {
      const a = act(s.clip); if (!a) continue;
      const again = cur.find((c) => c.a === a);
      a.setLoop(s.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = !!s.clamp;
      a.setEffectiveTimeScale(s.ts ?? 1);
      const w = s.aim !== undefined ? aimWeights(s.aim) : 1;
      if (again && !s.once) { a.stopFading(); a.enabled = true; a.setEffectiveWeight(w); }
      else {
        a.reset(); a.setEffectiveWeight(w);
        if (s.loco && prevLoco && prevLoco.a !== a) a.time = (prevLoco.a.time / prevLoco.a.getClip().duration) * a.getClip().duration;
        if (s.toEnd) { a.time = a.getClip().duration - 1e-3; }
        a.fadeIn(s.toEnd ? 0.0001 : fade); a.play();
      }
      next.push({ a, spec: s });
    }
    for (const c of cur) if (!next.find((x) => x.a === c.a)) c.a.fadeOut(fade);
    cur = next; ch.state = state; stateTime = 0; oneShot = spec.find((s) => s.next) || null;
    if (state === 'shoot') recoil = 1;
    // IK-Ziele für das Gewehr
    const rifleIK = rifle && !['die', 'dead', 'hit'].includes(state);
    ikTarget.R = rifleIK ? 1 : state === 'hit' && rifle ? 0.5 : 0;
    ikTarget.L = rifleIK && state !== 'reload' ? 1 : 0;
    return ch;
  };
  ch.setSpeed = (mps) => {
    ch.speedMps = mps;
    for (const c of cur) if (c.spec.loco) { const L = locoClip(ch.state, mps); c.a.setEffectiveTimeScale(clamp(Math.max(mps, 0.2) / (an.speeds[L] || 1.3), 0.45, 2.2)); }
    return ch;
  };
  ch.setAimPitch = (rad) => { ch.aimPitch = clamp(rad, -1.0, 1.0); for (const c of cur) if (c.spec.aim !== undefined) c.a.setEffectiveWeight(aimWeights(c.spec.aim)); return ch; };
  mixer.addEventListener('finished', (e) => {
    const c = cur.find((x) => x.a === e.action); if (!c || !c.spec.next) return;
    const nxt = c.spec.next === '@prev' ? ch.prevState || 'idle' : c.spec.next;
    const ended = ch.state;
    if (nxt === 'dead') { ch.state = 'dead'; } else ch.setState(nxt, { fade: 0.2 });
    if (ch.onStateEnd) ch.onStateEnd(ended, nxt);
  });

  // --- IK-Daten
  const legs = ['L', 'R'].map((s) => ({ s, a: B('upperleg01.' + s), b: B('lowerleg01.' + s), c: B('foot.' + s), lock: null, lockW: 0, dy: 0 })).filter((l) => l.a && l.b && l.c);
  const arms = { R: { a: B('upperarm01.R'), b: B('lowerarm01.R'), c: wristR, w: 0 }, L: { a: B('upperarm01.L'), b: B('lowerarm01.L'), c: wristL, w: 0 } };
  const hips = B('root');
  let hipDrop = 0;
  const gripM = weaponObj ? weaponGripMatrix(an.hand.R) : null, gripInv = gripM ? gripM.clone().invert() : null;
  const tmpM = new THREE.Matrix4(), tmpM2 = new THREE.Matrix4(), saveQ = new THREE.Quaternion(), saveQ2 = new THREE.Quaternion();
  const chainSave = (arm) => [arm.a.quaternion.clone(), arm.b.quaternion.clone(), arm.c.quaternion.clone()];
  const chainBlend = (arm, saved, w) => { if (w >= 0.999) return; [arm.a, arm.b, arm.c].forEach((bn, i) => bn.quaternion.slerpQuaternions(saved[i], bn.quaternion.clone(), w)); };

  function rifleIK(dt) {
    ikW.R += (ikTarget.R - ikW.R) * Math.min(1, dt * 8); ikW.L += (ikTarget.L - ikW.L) * Math.min(1, dt * 8);
    if (!gun || !gun.butt || (ikW.R < 0.01 && ikW.L < 0.01)) return;
    const spine = ch.bones.spine01; if (!spine || !arms.R.a || !arms.L.a) return;
    const fwd = _v[0].copy(an.spineFwdLocal).applyQuaternion(wquat(spine, _q[1])); fwd.y = 0; fwd.normalize();
    let pitch = -0.32, yaw = 0.18;
    if (['aim', 'shoot'].includes(ch.state)) { pitch = ch.aimPitch; yaw = 0; }
    else if (['walk', 'run', 'crouchWalk'].includes(ch.state)) { pitch = -0.62; yaw = 0.38; }
    else if (ch.state === 'reload') { pitch = -0.45; yaw = 0.3; }
    recoil = Math.max(0, recoil - dt * 6);
    pitch += recoil * 0.09;
    const dir = fwd.clone().applyAxisAngle(UP, yaw); const right = new THREE.Vector3().crossVectors(dir, UP).normalize();
    dir.multiplyScalar(Math.cos(pitch)).addScaledVector(UP, Math.sin(pitch)).normalize();
    const xg = new THREE.Vector3().crossVectors(UP, dir).normalize(), yg = new THREE.Vector3().crossVectors(dir, xg);
    const gunWorld = tmpM.makeBasis(xg, yg, dir);
    const shoulder = wpos(arms.R.a, _v[1]);
    const rightH = right.clone(); rightH.y = 0; rightH.normalize();
    const pocket = shoulder.clone().addScaledVector(rightH, -0.035).addScaledVector(fwd, 0.035).addScaledVector(UP, -0.03).addScaledVector(dir, -recoil * 0.025);
    const buttW = gun.butt.clone().applyMatrix4(new THREE.Matrix4().extractRotation(gunWorld));
    gunWorld.setPosition(pocket.sub(buttW));
    // rechte Hand: Gelenkziel = Waffenpose · Griff⁻¹
    const wristWorld = tmpM2.multiplyMatrices(gunWorld, gripInv);
    const tPos = new THREE.Vector3(), tQ = new THREE.Quaternion(), tS = new THREE.Vector3(); wristWorld.decompose(tPos, tQ, tS);
    // Weltmatrix des Gruppen-Root berücksichtigen ist nicht nötig: alles in Weltkoordinaten
    if (ikW.R > 0.01) {
      const saved = chainSave(arms.R);
      const pole = right.clone().multiplyScalar(0.8).addScaledVector(UP, -1).normalize();
      twoBoneIK(arms.R.a, arms.R.b, arms.R.c, tPos, pole, xg);
      setWorldQuat(arms.R.c, tQ);
      chainBlend(arms.R, saved, ikW.R); arms.R.a.updateMatrixWorld(true);
    }
    if (ikW.L > 0.01 && an.hand.L) {
      const saved = chainSave(arms.L);
      const hf = an.hand.L;
      const supportW = gun.support.clone().applyMatrix4(gunWorld);
      const palmTarget = supportW.addScaledVector(yg, -0.046);
      const dWant = dir.clone().multiplyScalar(0.45).addScaledVector(right, 0.9).normalize(), nWant = yg.clone();
      const bH = new THREE.Matrix4().makeBasis(hf.d.clone(), hf.n.clone(), new THREE.Vector3().crossVectors(hf.d, hf.n).normalize());
      const nOrtho = nWant.clone().addScaledVector(dWant, -nWant.dot(dWant)).normalize();
      const bW = new THREE.Matrix4().makeBasis(dWant, nOrtho, new THREE.Vector3().crossVectors(dWant, nOrtho).normalize());
      const qW = new THREE.Quaternion().setFromRotationMatrix(bW.multiply(bH.transpose()));
      const wristTarget = palmTarget.sub(hf.palm.clone().applyQuaternion(qW));
      const pole = right.clone().multiplyScalar(-0.5).addScaledVector(UP, -1).normalize();
      twoBoneIK(arms.L.a, arms.L.b, arms.L.c, wristTarget, pole, xg);
      setWorldQuat(arms.L.c, qW);
      chainBlend(arms.L, saved, ikW.L); arms.L.a.updateMatrixWorld(true);
    }
  }

  function footIK(dt, ground) {
    if (!ch.footIK || !legs.length) return;
    const k = 1 - Math.exp(-dt * 14);
    const rootY = group.position.y;
    const stationary = STATIONARY.has(ch.state) && ch.speedMps < 0.05 && stateTime > 0.35;
    const ank = legs.map((l) => wpos(l.c, new THREE.Vector3()));
    let minD = 0;
    legs.forEach((l, i) => {
      const want = ground ? clamp(ground(ank[i].x, ank[i].z) - rootY, -0.45, 0.45) : 0;
      l.dy += (want - l.dy) * k; minD = Math.min(minD, l.dy);
      if (ch.footLock && stationary) {
        if (!l.lock) l.lock = ank[i].clone();
        l.lockW = Math.min(1, l.lockW + dt * 4);
        const d = Math.hypot(l.lock.x - ank[i].x, l.lock.z - ank[i].z);
        if (d > 0.1) { l.lock.x += (ank[i].x - l.lock.x) * Math.min(1, dt * 4); l.lock.z += (ank[i].z - l.lock.z) * Math.min(1, dt * 4); }
      } else { l.lockW = Math.max(0, l.lockW - dt * 5); if (l.lockW === 0) l.lock = null; }
    });
    const needs = legs.some((l) => Math.abs(l.dy) > 0.003 || l.lockW > 0.01) || Math.abs(hipDrop) > 0.002;
    if (!needs) return;
    hipDrop += (minD - hipDrop) * k;
    if (hips && Math.abs(hipDrop) > 1e-4) { const hp = wpos(hips, _v[0]); hp.y += hipDrop; hips.position.copy(hips.parent.worldToLocal(hp)); hips.updateMatrixWorld(true); }
    const bendFallback = new THREE.Vector3(-1, 0, 0).applyQuaternion(wquat(group, _q[1]));
    legs.forEach((l, i) => {
      const t = ank[i].clone(); t.y += l.dy;
      if (l.lock && l.lockW > 0) { t.x += (l.lock.x - t.x) * l.lockW; t.z += (l.lock.z - t.z) * l.lockW; }
      const fq = wquat(l.c, saveQ);
      twoBoneIK(l.a, l.b, l.c, t, null, bendFallback);
      // Fuß an Bodenneigung anpassen
      if (ground) {
        const e = 0.12, gx = (ground(t.x + e, t.z) - ground(t.x - e, t.z)) / (2 * e), gz = (ground(t.x, t.z + e) - ground(t.x, t.z - e)) / (2 * e);
        const nrm = _v[6].set(-gx, 1, -gz).normalize();
        const contact = 1 - smooth01(0.04, 0.14, ank[i].y - rootY - (an.key.ankleL.y));
        if (nrm.y < 0.999 && contact > 0) { const tilt = saveQ2.setFromUnitVectors(UP, nrm); const ang = Math.min(2 * Math.acos(clamp(tilt.w, -1, 1)), 0.45); tilt.copy(new THREE.Quaternion().setFromAxisAngle(_v[7].set(tilt.x, tilt.y, tilt.z).normalize(), ang * contact)); fq.premultiply(tilt); }
      }
      setWorldQuat(l.c, fq); l.c.updateMatrixWorld(true);
    });
  }

  ch.update = (dt, groundHeightFn) => {
    dt = Math.min(dt, 0.1);
    stateTime += dt;
    mixer.update(dt);
    group.updateMatrixWorld(true);
    if (hips) hips.updateMatrixWorld(true);
    rifleIK(dt);
    if (quality !== 'low') footIK(dt, groundHeightFn || null);
    return ch;
  };
  ch.setFootIK = (on) => { ch.footIK = !!on; return ch; };
  ch.setShadows = (on) => { group.traverse((x) => { if (x.isMesh && !(x.material && x.material.transparent)) x.castShadow = !!on; }); return ch; };
  ch.dispose = () => {
    mixer.stopAllAction(); mixer.uncacheRoot(clone);
    if (group.parent) group.parent.remove(group);
    skeleton.dispose(); extraSkeletons.forEach((s) => s.dispose());
    for (const m of ownMats) { m.dispose(); (m.userData.ownTex || []).forEach((t) => t.dispose()); }
    ownMats.length = 0; attached.length = 0;
  };
  ch.setState(opts.state || 'idle', { fade: 0.0001 });
  return ch;
}

// ---------------------------------------------------------------------------------------------
// Laufzeit-Retargeting (für importierte MetaHuman/CC4-Figuren ohne eigene Clips):
// Weltraum-Delta-Verfahren: q_ziel(t) = q_quelle(t) · q_quelle,ruhe⁻¹ · q_ziel,ruhe, Hüfthöhe skaliert.
// Bone-Namen müssen kanonisch sein (tools/import-character.mjs benennt um) oder per Alias auflösbar.
// ---------------------------------------------------------------------------------------------
export function retargetClips(srcBase, targetScene, { fps = 30, clipNames = null } = {}) {
  const src = srcBase.template; src.updateMatrixWorld(true); targetScene.updateMatrixWorld(true);
  const srcBones = new Map(); src.traverse((o) => { if (o.isBone) srcBones.set(o.name, o); });
  const tgtBones = new Map(); targetScene.traverse((o) => { if (o.isBone) tgtBones.set(o.name, o); });
  const pairs = [];
  for (const [name, sb] of srcBones) {
    const canon = name; let tb = null;
    for (const a of aliasesOf(canon)) if (tgtBones.has(a)) { tb = tgtBones.get(a); break; }
    if (tb) pairs.push([sb, tb]);
  }
  if (!pairs.length) return [];
  const srcRest = new Map(pairs.map(([s]) => [s, wquat(s)])), tgtRest = new Map(pairs.map(([, t]) => [t, wquat(t)]));
  const tgtLocalRest = new Map(); targetScene.traverse((o) => { if (o.isBone) tgtLocalRest.set(o, o.quaternion.clone()); });
  const sHip = pairs.find(([s]) => s.name === 'root'), hipK = sHip ? wpos(sHip[1]).y / Math.max(0.1, wpos(sHip[0]).y) : 1;
  const sHipRest = sHip ? wpos(sHip[0]) : null, tHipRest = sHip ? wpos(sHip[1]) : null;
  const tOrder = []; targetScene.traverse((o) => { if (o.isBone) tOrder.push(o); });
  const pairOf = new Map(pairs.map(([s, t]) => [t, s]));
  const restSave = []; src.traverse((o) => restSave.push([o, o.position.clone(), o.quaternion.clone()]));
  const mixer = new THREE.AnimationMixer(src), out = [];
  for (const clip of srcBase.clips.values()) {
    if (clipNames && !clipNames.includes(clip.name)) continue;
    const a = mixer.clipAction(clip); a.play();
    const n = Math.max(2, Math.round(clip.duration * fps) + 1), times = new Float32Array(n);
    const qv = new Map(tOrder.filter((t) => pairOf.has(t)).map((t) => [t, new Float32Array(n * 4)]));
    const hp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const tt = Math.min(clip.duration, i / fps); times[i] = tt; mixer.setTime(tt); src.updateMatrixWorld(true);
      const world = new Map();
      for (const t of tOrder) {
        const pq = world.get(t.parent) || (t.parent ? wquat(t.parent) : new THREE.Quaternion());
        const s = pairOf.get(t); let local;
        if (s) { const w = wquat(s).multiply(srcRest.get(s).clone().invert()).multiply(tgtRest.get(t)); local = pq.clone().invert().multiply(w).normalize(); qv.get(t).set([local.x, local.y, local.z, local.w], i * 4); }
        else local = tgtLocalRest.get(t);
        world.set(t, pq.clone().multiply(local));
      }
      if (sHip) { const d = wpos(sHip[0]).sub(sHipRest).multiplyScalar(hipK); const p = tHipRest.clone().add(d); const lp = sHip[1].parent.worldToLocal(p); hp.set([lp.x, lp.y, lp.z], i * 3); }
    }
    a.stop(); mixer.uncacheAction(clip);
    const tracks = [];
    for (const [t, arr] of qv) { for (let i = 1; i < n; i++) { let d = 0; for (let k = 0; k < 4; k++) d += arr[i * 4 + k] * arr[(i - 1) * 4 + k]; if (d < 0) for (let k = 0; k < 4; k++) arr[i * 4 + k] *= -1; } tracks.push(new THREE.QuaternionKeyframeTrack(t.name + '.quaternion', times, arr)); }
    if (sHip) tracks.push(new THREE.VectorKeyframeTrack(sHip[1].name + '.position', times, hp));
    out.push(new THREE.AnimationClip(clip.name, clip.duration, tracks));
  }
  mixer.uncacheRoot(src);
  for (const [o, p, q] of restSave) { o.position.copy(p); o.quaternion.copy(q); }
  src.updateMatrixWorld(true);
  return out;
}
