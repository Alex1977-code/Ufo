// Rundenbasierter Bodenkampf: Zeiteinheiten, Sichtlinien, Nebel des Krieges, Reaktionsfeuer,
// zerstörbare Umgebung, Alien-KI – steuerbar per Maus, Touch, Tastatur und Controller.
import * as THREE from 'three';
import { generateMap, WALLS } from './tacmap.js';
import { TILE, propParts, patchFog, fogUniforms, makeSoldier, makeAlien, makeCivilian, makeTransport, textures, FACADES, atlasTile, makeRoof, releaseTextures, makeWater } from './models.js';
import { canvasTexture } from './engine.js';
import { applyEnvironment, createSunWithCSM } from './environment.js';
import { getHeroCarKit } from './herocar.js';
import { loadCharacterLibrary, makeCharacter } from './characters.js';
import { makeTransport as makeKondor, animateCraft, setHatch } from './craftmodels.js';
import { WEAPONS, ARMORS, ALIENS, ITEMS, BELT_SLOTS, RANKS, UFOS, effWeapon, ammoFits, ammoList, defaultLoad, isInstantItem, guidedMode } from './data.js';
import { Game, alienCount, missionRewards } from './game.js';
import { Input, padLabel } from './input.js';
import { modal, toast, confirmBox, anyModalOpen, floatText, banner, bar, el } from './ui.js';
import { sfx, setMusicMood } from './audio.js';
import { clamp, rand, randInt, randRange, choice, shuffle, sleep, smooth, lerp, makeValueNoise2D, fbm2 } from './util.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
// Waffenform für models.js gun(): 'fx:variante' (pistol = einhändig, tube = Werfer, heavy = schwer)
const gunFx = (w) => `${w.fx}:${w.hands === 1 ? 'pistol' : w.tile ? 'tube' : w.heavy ? 'heavy' : 'rifle'}`;
const FX_COLORS = { bullet: 0xffd27a, laser: 0xff3030, plasma: 0x50ff7a, beam: 0xff40a0, melee: 0xffffff, rocket: 0xffa040, stun: 0x60a0ff };
// ZE-Kosten der Gürtel-Gegenstände (Rückfall, falls ITEMS[id].tu fehlt) und Wurf-/Zonenfarben
const ITEM_TU = { grenade: 0.3, smoke: 0.25, flare: 0.2, medkit: 0.3, mine: 0.3, charge: 0.35, stunrod: 0.25, scanner: 0.15, ammo: 0.15 };
const ITEM_COLORS = { grenade: 0xff8030, smoke: 0xb8c0c8, flare: 0xffe070, medkit: 0x60ff90, mine: 0xff4040, charge: 0xff5020, stunrod: 0x60a0ff, scanner: 0xffe040, fire: 0xff7020, stun: 0x60a0ff };
// Brand (W1 4.4)
const BURN_DMG = 15, MAX_FIRE = 60;
const FLAMMABLE_FLOOR = new Set(['grass', 'field', 'field2', 'wood', 'crops', 'vineyard', 'plank']);
const FLAMMABLE_WALL = new Set(['wood', 'tree', 'pine', 'hedge', 'hay', 'crate', 'fence', 'log', 'woodpile', 'bush', 'tallhedge', 'birch', 'oak', 'palm', 'deadtree', 'stump', 'pallet', 'tent', 'scaffold', 'fuelbarrel', 'fuelpump']);
const BLIPS = 16, CHAIN_MAX = 8; // Scanner-Ringe, max. Kettenexplosionen (Fässer/Minen) je Auslösung
const KNEEL_TU = 4, STAND_TU = 8; // Knien 4 ZE, Aufstehen 8 ZE (wie im Original)
const THROW_RANGE = 13;
const PATH_LABELS = 60;
const SMOKE_SPRITES = 96;

class Heap {
  constructor() { this.a = []; }
  push(i, p) { const a = this.a; a.push([p, i]); let k = a.length - 1; while (k > 0) { const pk = (k - 1) >> 1; if (a[pk][0] <= a[k][0]) break; [a[pk], a[k]] = [a[k], a[pk]]; k = pk; } }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) { a[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === k) break; [a[m], a[k]] = [a[k], a[m]]; k = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

// Instanzierte Hindernis-Gruppe (ein InstancedMesh pro Bauteil).
// Teile mit atlas: Fassadenkachel je Instanz; Teile mit bit: per Maske ausblendbar (Obergeschosse)
class PropSet {
  constructor(scene, parts, count, shadows) {
    this.meshes = parts.map((p) => {
      let geo = p.geo;
      if (p.atlas) { geo = geo.clone(); geo.setAttribute('aTile', new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2)); }
      const m = new THREE.InstancedMesh(geo, p.mat, count);
      m.castShadow = shadows && p.shadow !== false; m.receiveShadow = true;
      m.count = 0; m.frustumCulled = false;
      m.userData.bit = p.bit || 0;
      scene.add(m);
      return m;
    });
    this.base = [];
    this.mask = []; this.shown = [];
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
  }
  add(mtx, colors, tiles, mask = 0) {
    const i = this.base.length;
    this.base.push(mtx.clone());
    this.mask.push(mask); this.shown.push(false);
    this.meshes.forEach((m, k) => {
      m.count = i + 1;
      m.setMatrixAt(i, this.zero);
      if (colors) m.setColorAt(i, colors[k] || new THREE.Color(1, 1, 1));
      const at = m.geometry.attributes.aTile;
      if (at && tiles?.[k]) { at.setXY(i, tiles[k][0], tiles[k][1]); at.needsUpdate = true; }
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
    return i;
  }
  show(i, on) {
    this.shown[i] = on;
    this.meshes.forEach((m) => { m.setMatrixAt(i, on && !(m.userData.bit & this.mask[i]) ? this.base[i] : this.zero); m.instanceMatrix.needsUpdate = true; });
  }
  setMask(i, bits) { if (this.mask[i] === bits) return; this.mask[i] = bits; if (this.shown[i]) this.show(i, true); }
}
// Mehrere Optik-Varianten eines Wandtyps (z. B. Fahrzeugmodelle, Möbel, Außen-/Innenwand) mit gemeinsamer Indexierung
class VariantSet {
  constructor(sets) { this.sets = sets; this.ref = []; this.base = []; this.zero = new THREE.Matrix4().makeScale(0, 0, 0); }
  add(mtx, colors, tiles, mask, v) { const s = this.sets[v]; this.ref.push([s, s.add(mtx, colors, tiles, mask)]); this.base.push(mtx.clone()); return this.ref.length - 1; }
  show(i, on) { const [s, li] = this.ref[i]; s.show(li, on && this.base[i] !== this.zero); }
  setMask(i, bits) { const [s, li] = this.ref[i]; s.setMask(li, bits); }
}
// G6: geparkte Hero-Autos (herocar.js) als InstancedMeshes je (LOD-Stufe, Material-Slot); gleiche Schnittstelle wie PropSet.
// LOD je Instanz nach Kameraabstand; sichtbare Instanzen werden je Stufe dicht gepackt (count = Anzahl → keine leeren Draws).
const HERO_VARIANT = {
  sedan: { type: 'sedan' }, kombi: { type: 'sedan' }, suv: { type: 'suv' }, pickup: { type: 'pickup' }, van: { type: 'van' },
  burnt: { type: 'sedan', damage: 1, paint: 0x141414, seed: 5, burnt: true },
};
const HERO_LOD_DIST = { desktop: [16, 40], mobile: [0, 24] };
class HeroCarSet {
  constructor(scene, kit, count, shadows, { scale = 1, mobile = false, burnt = false } = {}) {
    this.kit = kit; this.scale = scale; this.mobile = mobile;
    this.levels = Object.keys(kit.levels).map(Number).sort();
    this.meshes = {};
    for (const lv of this.levels) {
      this.meshes[lv] = Object.entries(kit.levels[lv]).filter(([slot]) => !(burnt && slot === 'glass')).map(([slot, geo]) => {
        const m = new THREE.InstancedMesh(geo, kit.mats[slot], count);
        m.count = 0; m.frustumCulled = false; m.visible = false;
        m.castShadow = shadows && slot !== 'glass' && slot !== 'interior' && slot !== 'plate'; m.receiveShadow = true;
        m.userData.slot = slot; m.userData.heroCar = true;
        if (slot === 'paint') m.setColorAt(0, new THREE.Color(1, 1, 1));
        scene.add(m);
        return m;
      });
    }
    this.base = []; this.color = []; this.shown = []; this.lod = []; this.dirty = true;
    this._p = new THREE.Vector3(); this._S = new THREE.Matrix4().makeScale(scale, scale, scale);
  }
  add(mtx, colors) {
    const i = this.base.length;
    this.base.push(mtx.clone().multiply(this._S));
    this.color.push(colors?.[0] ? new THREE.Color(colors[0]) : new THREE.Color(1, 1, 1));
    this.shown.push(false); this.lod.push(this.levels[this.levels.length - 1]);
    return i;
  }
  show(i, on) { if (this.shown[i] !== on) { this.shown[i] = on; this.dirty = true; } }
  setMask() {}
  posOf(i) { return this._p.setFromMatrixPosition(this.base[i]); }
  // LOD nach Kameraabstand; packt nur bei Änderungen neu
  update(cam) {
    const D = this.mobile ? HERO_LOD_DIST.mobile : HERO_LOD_DIST.desktop, L = this.levels;
    for (let i = 0; i < this.base.length; i++) {
      if (!this.shown[i]) continue;
      const d = cam.distanceTo(this.posOf(i));
      let want = d < D[0] ? 0 : d < D[1] ? 1 : 2;
      if (!L.includes(want)) want = L.find((l) => l >= want) ?? L[L.length - 1];
      if (want !== this.lod[i]) { this.lod[i] = want; this.dirty = true; }
    }
    if (!this.dirty) return;
    this.dirty = false;
    const white = this._w || (this._w = new THREE.Color(1, 1, 1));
    for (const lv of L) {
      let n = 0;
      for (let i = 0; i < this.base.length; i++) {
        if (!this.shown[i] || this.lod[i] !== lv) continue;
        for (const m of this.meshes[lv]) { m.setMatrixAt(n, this.base[i]); if (m.instanceColor) m.setColorAt(n, this.kit.damaged ? white : this.color[i]); }
        n++;
      }
      for (const m of this.meshes[lv]) { m.count = n; m.visible = n > 0; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    }
  }
  // Einzelnes, nicht instanziertes Modell (für Zerstörung: ausgebranntes Wrack) aus einer Stufe des Bausatzes
  static single(kit, lv, mtx, burnt) {
    const g = new THREE.Group();
    for (const [slot, geo] of Object.entries(kit.levels[lv] || kit.levels[Object.keys(kit.levels).pop()])) {
      if (burnt && slot === 'glass') continue;
      const m = new THREE.Mesh(geo, kit.mats[slot]); m.castShadow = slot !== 'glass'; m.receiveShadow = true; m.userData.sharedGeo = true; g.add(m);
    }
    mtx.decompose(g.position, g.quaternion, g.scale);
    return g;
  }
  dispose() { for (const lv of this.levels) for (const m of this.meshes[lv]) { m.removeFromParent(); m.dispose(); } }
}
const FURNITURE = ['furn:table', 'furn:table', 'furn:bed', 'furn:shelf', 'furn:cabinet', 'furn:sofa', 'furn:counter'];
const CAR_PAINT = ['#e8e8e6', '#c8ccd0', '#2a2c30', '#1e2e4a', '#8a1a1a', '#2e4a34', '#d8ccb0', '#4a5a6a', '#b04a1a', '#e0c040', '#3a6a9a', '#6a6e72'];
const DECO_TINT = { flowers: ['#ff4a6a', '#ffd040', '#ffffff', '#c070ff', '#ff8a30'], bush: ['#ffffff', '#e0ffd0', '#c8e8b0', '#f0f4d0'], rug: ['#a83a32', '#3a5a8a', '#c8a050', '#5a7a4a', '#8a6a9a'] };

// ======================= G6: realistische Figuren (characters.js) =======================
// Basen: Soldaten ohne human_m_02 (wirkt jugendlich), human_f_02 gar nicht (wirkt füllig) – Nutzervorgabe „schön/kräftig“
const FIG_SOLDIER = { m: ['human_m_01', 'human_m_03'], f: ['human_f_01', 'human_f_03'] };
const FIG_CIV = ['human_m_01', 'human_m_02', 'human_m_03', 'human_f_01', 'human_f_03'];
const FIG_BASES = ['human_m_01', 'human_m_02', 'human_m_03', 'human_f_01', 'human_f_03'];
const FIG_STEP = 0.3; // s je Feld (sichtbar) für echte Figuren – Lauf-Clip ohne Fußgleiten
const hashStr = (str) => { let h = 2166136261; for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
// Einstellung „Figuren“: engine.settings.figures 'real' | 'simple'; Standard: PC real, schwache Geräte simple
export function figuresMode(engine) {
  const v = engine?.settings?.figures;
  if (v === 'real' || v === 'simple') return v;
  try {
    const nav = globalThis.navigator || {};
    const weak = (nav.deviceMemory && nav.deviceMemory < 3) || (nav.hardwareConcurrency && nav.hardwareConcurrency <= 2) || (engine?.renderer?.capabilities?.maxTextureSize || 4096) < 4096;
    return weak ? 'simple' : 'real';
  } catch { return 'real'; }
}

// ======================= G6: PBR-Boden (CC0-Texturen aus assets/textures) =======================
// Schichten eines Textur-Arrays (Albedo sRGB + Rauheit in Alpha, Normal-Map); 0 = keine Schicht (nur bisherige Canvas-Textur)
const GROUND_LAYERS = [null, ['asphalt', 3], ['concrete', 2.4], ['grass', 2], ['sand', 1.8], ['snow', 2.2], ['dirt', 2], ['sidewalk_pavers', 1.8], ['wood_floor', 1.7]];
const FLOOR_LAYER = {
  asphalt: 1, parking: 1, concretefloor: 2, tile: 2, gravel: 6, sidewalk: 7, cobble: 7,
  grass: 3, graveyard: 3, field: 6, field2: 6, crops: 6, vineyard: 6, mud: 6, dirt: 6, burnt: 6,
  sand: 4, shore: 4, snow: 5, ice: 5, wood: 8, plank: 8,
};
let _groundPBR = null; // Promise<{alb, nrm, mean[], scale[]}> | null (einmal je Sitzung, wird über Missionen geteilt)
function loadGroundPBR(size) {
  if (_groundPBR) return _groundPBR;
  const img = (src) => new Promise((res, rej) => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = () => rej(new Error('Textur fehlt: ' + src)); i.src = src; });
  _groundPBR = (async () => {
    const n = GROUND_LAYERS.length, S = size, px = S * S * 4;
    const alb = new Uint8Array(px * n), nrm = new Uint8Array(px * n);
    const mean = [[0.5, 0.5, 0.5]], scale = [1];
    const cv = document.createElement('canvas'); cv.width = cv.height = S;
    const c = cv.getContext('2d', { willReadFrequently: true });
    const read = (im) => { c.clearRect(0, 0, S, S); c.drawImage(im, 0, 0, S, S); return c.getImageData(0, 0, S, S).data; };
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const LUT = new Float32Array(256).map((_, i) => lin(i));
    alb.fill(128, 0, px); nrm.fill(128, 0, px);
    for (let l = 1; l < n; l++) {
      const [id, sc] = GROUND_LAYERS[l], base = `assets/textures/${id}/`;
      const [a, nn, r] = await Promise.all([img(base + 'albedo.webp'), img(base + 'normal.webp'), img(base + 'roughness.webp')]);
      const da = read(a), o = l * px;
      let sr = 0, sg = 0, sb = 0;
      for (let i = 0; i < px; i += 4) { alb[o + i] = da[i]; alb[o + i + 1] = da[i + 1]; alb[o + i + 2] = da[i + 2]; sr += LUT[da[i]]; sg += LUT[da[i + 1]]; sb += LUT[da[i + 2]]; }
      const dr = read(r); for (let i = 0; i < px; i += 4) alb[o + i + 3] = dr[i];
      const dn = read(nn); for (let i = 0; i < px; i++) nrm[o + i] = dn[i];
      const k = 4 / px; mean.push([sr * k, sg * k, sb * k]); scale.push(sc);
    }
    const mk = (data, srgb) => {
      const t = new THREE.DataArrayTexture(data, S, S, n);
      t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true; t.anisotropy = 4; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.needsUpdate = true; t.userData.shared = true;
      return t;
    };
    return { alb: mk(alb, true), nrm: mk(nrm, false), mean, scale };
  })().catch((e) => { console.warn('AEGIS: PBR-Bodentexturen nicht ladbar – bisherige Bodentextur', e?.message || e); _groundPBR = null; return null; });
  return _groundPBR;
}
// Boden-Material um PBR-Detail erweitern: Gewichte je Feld (2 RGBA-Texturen = 8 Schichten, linear gefiltert → weiche Übergänge,
// Höhen-Blend über die Albedo-Helligkeit), Farbe der Canvas-Textur wird mit (Detail / Mittelwert) moduliert, Normal- und Rauheitskarte
// aus dem Array. Ohne geladene Texturen (Define fehlt) bleibt das Material wie bisher.
function groundPBRMaterial(mat, uni) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGroundW = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vGroundW;
        #ifdef GROUND_PBR
        uniform highp sampler2DArray gAlb; uniform highp sampler2DArray gNrm; uniform sampler2D gW0; uniform sampler2D gW1;
        uniform vec2 gMapSize; uniform float gScale[9]; uniform vec3 gMean[9]; uniform float gStrength;
        #endif`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float gUse = 0.0; vec3 gNt = vec3(0.0, 0.0, 1.0); float gRough = 1.0;
        #ifdef GROUND_PBR
        {
          vec2 cuv = vGroundW / gMapSize + 0.5;
          vec4 w0 = texture2D(gW0, cuv), w1 = texture2D(gW1, cuv);
          float ws[9]; ws[0] = 0.0; ws[1] = w0.r; ws[2] = w0.g; ws[3] = w0.b; ws[4] = w0.a; ws[5] = w1.r; ws[6] = w1.g; ws[7] = w1.b; ws[8] = w1.a;
          vec3 acc = vec3(0.0), nacc = vec3(0.0); float racc = 0.0, wsum = 0.0, wtot = 0.0;
          for (int l = 1; l < 9; l++) {
            float w = ws[l]; wtot += w;
            if (w < 0.02) continue;
            vec2 tuv = vec2(vGroundW.x, -vGroundW.y) / gScale[l];
            vec4 a = texture(gAlb, vec3(tuv, float(l)));
            float h = dot(a.rgb, vec3(0.3, 0.5, 0.2));
            float hw = w * w * w * (0.35 + h) * (0.35 + h);
            acc += a.rgb / max(gMean[l], vec3(0.015)) * hw; racc += a.a * hw;
            nacc += (texture(gNrm, vec3(tuv, float(l))).xyz * 2.0 - 1.0) * hw; wsum += hw;
          }
          if (wsum > 1e-4) {
            gUse = clamp(wtot, 0.0, 1.0);
            vec3 det = clamp(acc / wsum, 0.0, 3.0);
            diffuseColor.rgb *= mix(vec3(1.0), det, gStrength * gUse);
            gRough = racc / wsum; gNt = normalize(nacc / wsum);
          }
        }
        #endif`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, clamp(gRough, 0.04, 1.0), gUse);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (gUse > 0.0) {
          vec3 gT = normalize(mat3(viewMatrix) * vec3(1.0, 0.0, 0.0)), gB = normalize(mat3(viewMatrix) * vec3(0.0, 0.0, -1.0)), gN = normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0));
          vec3 dn = gT * gNt.x + gB * gNt.y + gN * gNt.z;
          normal = normalize(normal + (dn - gN) * gUse);
        }`);
  };
  mat.customProgramCacheKey = () => 'groundPBR' + (mat.defines?.GROUND_PBR !== undefined ? '1' : '0');
  return mat;
}

export class Tactical {
  constructor(engine, opts, hooks) {
    this.engine = engine;
    this.opts = opts;
    this.hooks = hooks;
    this.site = opts.site;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 600);
    this.units = [];
    this.turn = 1;
    this.phase = 'player';
    this.busy = false;
    this.mode = 'snap';
    this.selected = null;
    this.target = null;
    this.hover = null;
    this.pendingMove = null;
    this.cursor = { x: 0, y: 0 };
    this.padCursorAcc = { x: 0, y: 0 };
    this.cam = { x: 0, z: 0, yaw: 0.6, pitch: 0.95, dist: 30 };
    this.camT = { ...this.cam };
    this.shake = 0;
    this.pointers = new Map();
    this.unsub = [];
    this.fx = [];
    this.lightPool = [];
    this.result = { kills: {}, corpses: [], civSaved: 0, civKilled: 0, itemsUsed: {} };
    this.beltSlot = 0;
    this.smokes = []; this.flares = [];
    this.mines = []; this.charges = []; this.blips = []; this.waypoints = []; this.groundTarget = null;
    this.blastQueue = []; this.fireCount = 0;
    this.result.captured = {}; this.result.ammoLoot = {};
    this.pathLabelData = []; this.plabCount = 0;
    this.ended = false;
    this._frameWaiters = [];
    this.build();
  }

  // ======================= Aufbau =======================
  build() {
    const o = this.opts;
    const kind = o.site.kind;
    // G6: Figuren-Bibliothek sofort anfordern (lädt parallel zum Kartenaufbau); 'simple' = bisherige Modelle
    this.figMode = figuresMode(this.engine);
    this.realModels = this.figMode === 'real';
    this.figures = { state: this.realModels ? 'loading' : 'off', quality: this.engine.mobile ? 'low' : 'high', queue: [] };
    if (this.realModels) {
      try { this.figLoad = loadCharacterLibrary({ quality: this.figures.quality, bases: FIG_BASES }); this.figLoad.catch(() => {}); }
      catch (e) { this.figLoad = Promise.reject(e); this.figLoad.catch(() => {}); }
    }
    this.map = generateMap({ biome: o.biome, ufoType: o.site.ufoType, kind, night: o.night && kind !== 'hive' });
    const m = this.map;
    this.W = m.W; this.H = m.H;
    this.N = m.W * m.H;
    this.occ = new Int32Array(this.N).fill(-1);
    this.vis = new Uint8Array(this.N);
    this.explored = new Uint8Array(this.N);
    this.fogCur = new Float32Array(this.N).fill(0.05);
    this.fogData = new Uint8Array(this.N);
    this.fogTex = new THREE.DataTexture(this.fogData, m.W, m.H, THREE.RedFormat);
    this.fogTex.magFilter = THREE.LinearFilter; this.fogTex.minFilter = THREE.LinearFilter;
    this.fogTex.needsUpdate = true;
    fogUniforms.fogMap.value = this.fogTex;
    fogUniforms.fogMapSize.value.set(m.W * TILE, m.H * TILE);
    fogUniforms.fogOutside.value = m.night ? 0.25 : 0.38;

    this.buildEnvironment();
    this.buildGround();
    this.buildProps();
    this.buildDeco();
    this.buildHelpers();
    this.spawnUnits();
    this.initFigures();
    this.buildHud();
    this.bindInput();
    this.updateVisibility(true);
    if (this.csm) { this.csm.setupAll(this.scene); this.csm.updateFrustums(); }
    const s = this.units.find((u) => u.team === 'player' && u.alive);
    this.select(s, true);
    const p = this.cellPos(s.x, s.y - 4);
    this.cam.x = this.camT.x = p.x; this.cam.z = this.camT.z = p.z;
  }

  // G6: Umgebungslicht über environment.js (HDRI je Biom/Tageszeit), Sonne bzw. CSM-Sonne auf großen Karten
  pickSky() {
    const o = this.opts, biome = o.biome, kind = o.site?.kind;
    if (biome === 'hive') return 'hive';
    if (this.map.night) return 'night';
    // stabil je Einsatzort: Hash aus Ort-ID → Wetter/Tageszeit
    let h = 2166136261; for (const ch of String(o.site?.id ?? o.site?.name ?? '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    const r = ((h >>> 0) % 1000) / 1000;
    if (o.sky && ['day', 'overcast', 'dusk'].includes(o.sky)) return o.sky;
    if (biome === 'arctic') return r < 0.6 ? 'overcast' : r < 0.75 ? 'dusk' : 'day';
    if (biome === 'forest') return r < 0.4 ? 'overcast' : r < 0.55 ? 'dusk' : 'day';
    if (biome === 'desert') return r < 0.15 ? 'dusk' : 'day';
    if (kind === 'terror') return r < 0.25 ? 'overcast' : r < 0.4 ? 'dusk' : 'day';
    return r < 0.25 ? 'overcast' : r < 0.4 ? 'dusk' : 'day';
  }

  buildEnvironment() {
    if (!this.realModels) return this.buildEnvironmentLegacy();
    const night = this.map.night, hive = this.opts.biome === 'hive';
    const sky = this.sky = this.pickSky();
    // Voreinstellungen: Nebel-/Horizontfarbe (passend zum HDRI-Horizont), Sonne, Hemisphäre, Umgebungsintensität
    const P = {
      day: { fog: this.opts.biome === 'desert' ? 0xd8c8a8 : 0xb4c6d8, dens: 0.0065, sun: 0xfff0d8, si: 3.0, sunPos: [0.6, 1.1, 0.35], hemi: [0xbdd8ff, 0x4a3a28, 0.35], env: 0.85, bg: 0.9 },
      overcast: { fog: 0x8e969e, dens: 0.0052, sun: 0xe8ecf0, si: 1.3, sunPos: [0.3, 1.2, 0.2], hemi: [0xc8d0d8, 0x3e3a34, 0.35], env: 0.9, bg: 0.8 },
      dusk: { fog: 0x8a6a62, dens: 0.0075, sun: 0xffb27a, si: 2.4, sunPos: [0.95, 0.38, -0.25], hemi: [0x8a90b8, 0x3a2a22, 0.4], env: 0.9, bg: 0.8 },
      night: { fog: 0x0d1730, dens: 0.012, sun: 0x8fa8ff, si: 0.6, sunPos: [0.6, 1.1, 0.35], hemi: [0x223355, 0x080808, 0.35], env: 0.28 },
      hive: { fog: 0x2a0d30, dens: 0.0065, sun: 0xc080ff, si: 0.7, sunPos: [0.6, 1.1, 0.35], hemi: [0xbdd8ff, 0x4a3a28, 0.5], env: 0.22 },
    }[sky];
    const proceduralSky = sky === 'night' || sky === 'hive';
    if (proceduralSky) {
      const top = hive ? new THREE.Color(0x0a0410) : new THREE.Color(0x02040b);
      const hor = hive ? new THREE.Color(0x2a0d30) : new THREE.Color(0x0d1730);
      const skyMat = new THREE.ShaderMaterial({
        uniforms: { top: { value: top }, hor: { value: hor }, night: { value: 1 } },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform float night; varying vec3 vP;
          float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
          void main(){ float t = smoothstep(-0.05, 0.6, vP.y); vec3 c = mix(hor, top, t);
            if (night > 0.5) { vec3 q = floor(vP * 300.0); float s = step(0.997, h(q)) * t; c += vec3(s); }
            gl_FragColor = vec4(c, 1.0); }`,
        side: THREE.BackSide, depthWrite: false,
      });
      this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat));
    }
    // HDRI (Hive: Nacht-HDRI stark gedämpft); bis zum Laden setzt environment.js sofort die prozedurale Ersatz-PMREM
    const envName = sky === 'hive' ? 'night' : sky;
    try {
      applyEnvironment(this.scene, envName, { background: proceduralSky ? 'none' : 'sky', intensity: P.env, backgroundIntensity: P.bg, rotation: sky === 'dusk' ? -0.6 : 0.4 }).catch(() => {});
    } catch (e) { console.warn('AEGIS: Umgebung nicht verfügbar', e); }
    if (this.scene.environment) this.scene.environmentIntensity = P.env;
    if (!proceduralSky && !this.scene.background) this.scene.background = new THREE.Color(P.fog);
    this.scene.fog = new THREE.FogExp2(P.fog, P.dens);

    const S = this.engine.shadowSize;
    const ext = this.W * TILE * 0.75;
    const shadowsOn = this.engine.settings.shadows !== 'off';
    const sunDir = new THREE.Vector3(...P.sunPos).normalize();
    // Große Karten (Frachter/Schlachtschiff) auf dem PC mit hoher Schattenstufe: kaskadierte Schatten (environment.js)
    const useCSM = !proceduralSky && shadowsOn && !this.engine.mobile && this.engine.settings.shadows === 'high' && this.W >= 38 && this.engine.settings.csm !== false;
    if (useCSM) {
      try {
        this.csm = createSunWithCSM(this.scene, this.camera, { cascades: 3, maxFar: 120, shadowMapSize: Math.min(S, 2048), direction: sunDir.clone().negate(), color: P.sun, intensity: P.si, lightMargin: 40 });
      } catch (e) { console.warn('AEGIS: CSM nicht verfügbar – einfache Sonne', e); this.csm = null; }
    }
    if (!this.csm) {
      const sun = new THREE.DirectionalLight(P.sun, P.si);
      sun.position.copy(sunDir).multiplyScalar(ext * 1.27);
      sun.castShadow = shadowsOn;
      sun.shadow.mapSize.set(S, S);
      Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: ext * 4 });
      sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
      this.scene.add(sun, sun.target);
      this.sun = sun;
    }
    this.scene.add(new THREE.HemisphereLight(P.hemi[0], P.hemi[1], P.hemi[2]));
    for (const l of this.map.lights) {
      const p = this.cellPos(l.x, l.y);
      const pl = new THREE.PointLight(l.color, l.intensity * (sky === 'dusk' ? 0.6 : 1), 18, 1.6);
      pl.position.set(p.x, l.h, p.z);
      this.scene.add(pl);
      if (l.lamp) { const d = l.dir || [1, 0]; pl.position.x += d[0] * 0.9; pl.position.z += d[1] * 0.9; } // Mast als instanzierte Deko (buildDeco)
    }
    // Lichtpool für Mündungsfeuer/Explosionen
    for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffaa55, 0, 14, 2); this.scene.add(l); this.lightPool.push(l); }
    this.unitLight = new THREE.PointLight(0xcfe6ff, night ? 22 : 0, 16, 1.6);
    this.scene.add(this.unitLight);
    this.engine.renderer.toneMappingExposure = night ? 1.25 : sky === 'dusk' ? 1.1 : 1.0;
  }

  // Bisherige prozedurale Umgebung (Einstellung „Figuren: einfach“ = Aussehen wie vor G6)
  buildEnvironmentLegacy() {
    const night = this.map.night, hive = this.opts.biome === 'hive';
    const top = hive ? new THREE.Color(0x0a0410) : night ? new THREE.Color(0x02040b) : new THREE.Color(0x3f78c8);
    const hor = hive ? new THREE.Color(0x2a0d30) : night ? new THREE.Color(0x0d1730) : new THREE.Color(this.opts.biome === 'desert' ? 0xe8d2a8 : 0xbcd4ea);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: { top: { value: top }, hor: { value: hor }, night: { value: night || hive ? 1 : 0 } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform float night; varying vec3 vP;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
        void main(){ float t = smoothstep(-0.05, 0.6, vP.y); vec3 c = mix(hor, top, t);
          if (night > 0.5) { vec3 q = floor(vP * 300.0); float s = step(0.997, h(q)) * t; c += vec3(s); }
          gl_FragColor = vec4(c, 1.0); }`,
      side: THREE.BackSide, depthWrite: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat);
    this.scene.add(sky);
    // Umgebungsbeleuchtung (IBL) aus dem Himmel erzeugen
    const pmrem = new THREE.PMREMGenerator(this.engine.renderer);
    const envScene = new THREE.Scene(); envScene.add(sky.clone());
    const ground = new THREE.Mesh(new THREE.CircleGeometry(300, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: hor.clone().multiplyScalar(0.3) }));
    ground.position.y = -5; envScene.add(ground);
    this.envRT = pmrem.fromScene(envScene, 0.04);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = night ? 0.25 : hive ? 0.35 : 0.8;
    pmrem.dispose();
    this.scene.fog = new THREE.FogExp2(hor, night ? 0.012 : 0.0065);

    const S = this.engine.shadowSize;
    const sun = new THREE.DirectionalLight(night ? 0x8fa8ff : hive ? 0xc080ff : 0xfff0d8, night ? 0.6 : hive ? 0.7 : 3.2);
    const ext = this.W * TILE * 0.75;
    sun.position.set(ext * 0.6, ext * 1.1, ext * 0.35);
    sun.castShadow = this.engine.settings.shadows !== 'off';
    sun.shadow.mapSize.set(S, S);
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: ext * 4 });
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
    this.scene.add(sun, sun.target);
    this.sun = sun;
    this.scene.add(new THREE.HemisphereLight(night ? 0x223355 : 0xbdd8ff, night ? 0x080808 : 0x4a3a28, night ? 0.35 : 0.9));
    for (const l of this.map.lights) {
      const p = this.cellPos(l.x, l.y);
      const pl = new THREE.PointLight(l.color, l.intensity, 18, 1.6);
      pl.position.set(p.x, l.h, p.z);
      this.scene.add(pl);
      if (l.lamp) { const d = l.dir || [1, 0]; pl.position.x += d[0] * 0.9; pl.position.z += d[1] * 0.9; } // Mast als instanzierte Deko (buildDeco)
    }
    // Lichtpool für Mündungsfeuer/Explosionen
    for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffaa55, 0, 14, 2); this.scene.add(l); this.lightPool.push(l); }
    this.unitLight = new THREE.PointLight(0xcfe6ff, night ? 22 : 0, 16, 1.6);
    this.scene.add(this.unitLight);
    this.engine.renderer.toneMappingExposure = night ? 1.25 : 1.0;
  }

  buildGround() {
    const m = this.map, P = 32;
    const noise = makeValueNoise2D(64);
    const cols = {
      grass: ['#4c6b2e', '#56782f', '#45632a'], field: ['#5a4630', '#4d6a2c'], field2: ['#b69a48', '#a58a3c'], dirt: ['#6e5638', '#7a6040'], sand: ['#c9ad7a', '#bfa16c'], snow: ['#dfe6ee', '#cfd9e4'],
      asphalt: ['#2d2f33', '#34363a'], sidewalk: ['#8a8882', '#7f7d78'], tile: ['#7d6f62', '#6f6357'], wood: ['#6b4a2e', '#5e4027'], metal: ['#3d434d', '#454c57'], burnt: ['#221d18', '#2c241c'], hive: ['#2a1530', '#341a3b'],
      // Bodentypen der Kartenmodule
      gravel: ['#8a8478', '#827c70', '#8f897c'], mud: ['#4e3d2a', '#45362a', '#544230'], plank: ['#7a5a3a', '#6e5034'], cobble: ['#5e5a55', '#625e58'], concretefloor: ['#9c9a94', '#a29f99'], shore: ['#9c875e', '#947f58', '#a28c64'],
      crops: ['#4e4128', '#4a3e26'], vineyard: ['#6a5636', '#625032'], graveyard: ['#4a6a2e', '#527030', '#4d6c2e'], parking: ['#323438', '#2e3034'], ice: ['#b8d2e0', '#c4dcea', '#b0cad8'],
    };
    const natural = new Set(['grass', 'field', 'field2', 'dirt', 'sand', 'snow', 'burnt', 'hive', 'gravel', 'mud', 'shore', 'crops', 'vineyard', 'graveyard', 'ice']);
    const isW = (x, y) => m.at(x, y)?.wall?.type === 'water';
    const sp = (X, Y, w, h, n, pal, sz = 2) => { for (let i = 0; i < n; i++) { c2.fillStyle = pal[(rand() * pal.length) | 0]; c2.fillRect(X + rand() * w, Y + rand() * h, sz * (0.6 + rand() * 0.8), sz * (0.6 + rand() * 0.8)); } };
    let c2 = null;
    const groundTex = canvasTexture(m.W * P, m.H * P, (c) => {
      c2 = c;
      c.filter = 'blur(5px)';
      for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
        const f = m.at(x, y).floor; if (!natural.has(f)) continue;
        const pal = cols[f];
        c.fillStyle = pal[(x * 7 + y * 13) % pal.length];
        c.fillRect(x * P - 6, y * P - 6, P + 12, P + 12);
      }
      // Wassergrund: zur Mitte hin tiefer/dunkler (Wasserfläche selbst ist halbtransparent)
      for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
        if (!isW(x, y)) continue;
        let d = 1; while (d < 4) { let all = true; for (let dy = -d; dy <= d && all; dy++) for (let dx = -d; dx <= d; dx++) if (m.at(x + dx, y + dy) && !isW(x + dx, y + dy)) { all = false; break; } if (!all) break; d++; }
        c.fillStyle = ['#5e5a42', '#33443e', '#1f3236', '#15262b'][d - 1];
        c.fillRect(x * P - 6, y * P - 6, P + 12, P + 12);
      }
      c.filter = 'none';
      for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
        const cell = m.at(x, y), f = cell.floor; const X = x * P, Y = y * P;
        if (natural.has(f)) {
          if (f === 'field' || f === 'field2') { c.fillStyle = f === 'field' ? 'rgba(30,50,15,0.5)' : 'rgba(120,95,30,0.5)'; for (let k = 0; k < P; k += 6) c.fillRect(X, Y + k, P, 2); }
          else if (f === 'gravel') { sp(X, Y, P, P, 70, ['#a39d90', '#6e695f', '#b5afa2', '#5d5850', '#958f82'], 2); sp(X, Y, P, P, 25, ['rgba(0,0,0,0.25)'], 1.5); }
          else if (f === 'mud') {
            for (let k = 0; k < 3; k++) { c.fillStyle = 'rgba(28,20,12,0.35)'; c.beginPath(); c.ellipse(X + rand() * P, Y + rand() * P, 3 + rand() * 7, 2 + rand() * 4, rand() * 3, 0, 7); c.fill(); }
            if (rand() < 0.5) { c.fillStyle = 'rgba(90,100,105,0.45)'; c.beginPath(); c.ellipse(X + rand() * P, Y + rand() * P, 3 + rand() * 5, 2 + rand() * 3, rand() * 3, 0, 7); c.fill(); }
            const hz = m.at(x - 1, y)?.floor === 'mud' || m.at(x + 1, y)?.floor === 'mud';
            c.fillStyle = 'rgba(25,18,10,0.22)'; if (hz) { c.fillRect(X, Y + 9, P, 2); c.fillRect(X, Y + 21, P, 2); } else { c.fillRect(X + 9, Y, 2, P); c.fillRect(X + 21, Y, 2, P); }
          } else if (f === 'shore') {
            sp(X, Y, P, P, 30, ['#7a6a4a', '#b8a47c', '#8a8070', '#6a6258'], 2);
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isW(x + dx, y + dy)) {
              const g = c.createLinearGradient(X + P / 2, Y + P / 2, X + P / 2 + dx * P / 2, Y + P / 2 + dy * P / 2); g.addColorStop(0, 'rgba(50,42,28,0)'); g.addColorStop(1, 'rgba(50,42,28,0.55)'); c.fillStyle = g; c.fillRect(X, Y, P, P);
            }
          } else if (f === 'crops') { for (let k = 2; k < P; k += 6) { c.fillStyle = 'rgba(70,100,30,0.75)'; c.fillRect(X, Y + k, P, 3); sp(X, Y + k - 1, P, 4, 10, ['#6e8e34', '#8aa040', '#a89a48', '#4e6a24'], 2); } }
          else if (f === 'vineyard') { c.fillStyle = 'rgba(80,110,40,0.35)'; c.fillRect(X, Y, P, P); c.fillStyle = '#4a3a26'; c.fillRect(X, Y + 11, P, 10); sp(X, Y + 12, P, 8, 18, ['#3a5a22', '#4a6a2a', '#2e4a1a'], 3); c.fillStyle = '#3a2a1a'; c.fillRect(X + 2, Y + 15, 2, 2); }
          else if (f === 'graveyard') {
            if (!cell.wall) { c.fillStyle = '#8a8478'; c.fillRect(X, Y, P, P); sp(X, Y, P, P, 45, ['#a39d90', '#6e695f', '#b5afa2'], 2); }
            else sp(X, Y, P, P, 20, ['#3e5a24', '#5a7a34'], 2);
          } else if (f === 'ice') {
            sp(X, Y, P, P, 14, ['rgba(255,255,255,0.35)', 'rgba(150,180,200,0.3)'], 4);
            c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 1; c.beginPath(); let px = X + rand() * P, py = Y + rand() * P; c.moveTo(px, py); for (let k = 0; k < 4; k++) { px += (rand() - 0.5) * 22; py += (rand() - 0.5) * 22; c.lineTo(px, py); } c.stroke();
            if (rand() < 0.4) { c.strokeStyle = 'rgba(40,70,90,0.45)'; c.beginPath(); c.moveTo(X + rand() * P, Y + rand() * P); c.lineTo(X + rand() * P, Y + rand() * P); c.stroke(); }
          }
          continue;
        }
        const pal = cols[f] || cols.grass;
        c.fillStyle = pal[(x + y) % 2]; c.fillRect(X, Y, P, P);
        if (f === 'tile' || f === 'sidewalk') { c.strokeStyle = 'rgba(0,0,0,0.25)'; c.strokeRect(X + 0.5, Y + 0.5, P - 1, P - 1); }
        if (f === 'wood') { c.fillStyle = 'rgba(0,0,0,0.3)'; for (let k = 0; k < P; k += 8) c.fillRect(X, Y + k, P, 1); }
        if (f === 'metal') { c.strokeStyle = 'rgba(20,25,35,0.9)'; c.lineWidth = 2; c.strokeRect(X + 1, Y + 1, P - 2, P - 2); c.fillStyle = 'rgba(60,255,200,0.25)'; if ((x + y) % 3 === 0) c.fillRect(X + P / 2 - 1, Y + 4, 2, P - 8); }
        if (f === 'plank') { // Bohlen quer zur Laufrichtung, Fugen, Nägel, Schatten zum Wasser
          const alongX = m.at(x - 1, y)?.floor === 'plank' || m.at(x + 1, y)?.floor === 'plank';
          for (let k = 0; k < 5; k++) {
            const v = 0.8 + rand() * 0.4; c.fillStyle = `rgb(${120 * v},${88 * v},${56 * v})`;
            if (alongX) { c.fillRect(X + k * 6.4, Y, 5.6, P); c.fillStyle = 'rgba(40,30,20,0.7)'; c.fillRect(X + k * 6.4 + 2, Y + 3, 1.2, 1.2); c.fillRect(X + k * 6.4 + 2, Y + P - 4, 1.2, 1.2); }
            else { c.fillRect(X, Y + k * 6.4, P, 5.6); c.fillStyle = 'rgba(40,30,20,0.7)'; c.fillRect(X + 3, Y + k * 6.4 + 2, 1.2, 1.2); c.fillRect(X + P - 4, Y + k * 6.4 + 2, 1.2, 1.2); }
          }
          c.fillStyle = 'rgba(10,8,6,0.55)'; if (isW(x - 1, y)) c.fillRect(X, Y, 2, P); if (isW(x + 1, y)) c.fillRect(X + P - 2, Y, 2, P); if (isW(x, y - 1)) c.fillRect(X, Y, P, 2); if (isW(x, y + 1)) c.fillRect(X, Y + P - 2, P, 2);
        }
        if (f === 'cobble') { // Kopfsteinpflaster: Reihen kleiner, gerundeter Steine
          for (let yy = 0; yy < P; yy += 4) for (let xx = -((yy / 4) % 2) * 2; xx < P; xx += 3 + rand() * 2.5) { const v = 95 + rand() * 50; c.fillStyle = `rgb(${v},${v * 0.97},${v * 0.92})`; c.beginPath(); c.ellipse(X + xx + 1.6, Y + yy + 2, 1.5, 1.6, 0, 0, 7); c.fill(); }
        }
        if (f === 'concretefloor') { c.fillStyle = 'rgba(40,40,40,0.45)'; c.fillRect(X, Y, P, 1); c.fillRect(X, Y, 1, P); sp(X, Y, P, P, 30, ['rgba(0,0,0,0.08)', 'rgba(255,255,255,0.1)'], 2); if (rand() < 0.25) { c.fillStyle = 'rgba(50,45,40,0.25)'; c.beginPath(); c.ellipse(X + rand() * P, Y + rand() * P, 3 + rand() * 6, 2 + rand() * 4, rand() * 3, 0, 7); c.fill(); } }
        if (f === 'parking') { // Parkbuchten: Trennlinien je Feld, Abschlusslinie am Rand der Fläche, Ölflecken
          c.fillStyle = 'rgba(235,235,225,0.85)';
          c.fillRect(X, Y + (m.at(x, y - 1)?.floor === 'parking' ? 0 : 3), 1.5, P - (m.at(x, y - 1)?.floor === 'parking' ? 0 : 3) - (m.at(x, y + 1)?.floor === 'parking' ? 0 : 3));
          if (m.at(x, y - 1)?.floor !== 'parking') c.fillRect(X, Y + 2, P, 1.5);
          if (rand() < 0.3) { c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(X + P / 2 + (rand() - 0.5) * 8, Y + P / 2 + (rand() - 0.5) * 8, 4 + rand() * 4, 3 + rand() * 3, rand() * 3, 0, 7); c.fill(); }
        }
      }
      // Ruß unter ausgebrannten Militärfahrzeugen
      for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) if (m.at(x, y).wall?.type === 'milwreck') {
        const g = c.createRadialGradient((x + 0.5) * P, (y + 0.5) * P, 0, (x + 0.5) * P, (y + 0.5) * P, P * 1.8); g.addColorStop(0, 'rgba(12,10,8,0.8)'); g.addColorStop(1, 'rgba(12,10,8,0)');
        c.fillStyle = g; c.fillRect((x - 2) * P, (y - 2) * P, P * 5, P * 5);
      }
      this.paintMarkings(c, P);
      // Rauschen/Detail
      const img = c.getImageData(0, 0, m.W * P, m.H * P); const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const px = (i / 4) % (m.W * P), py = Math.floor(i / 4 / (m.W * P));
        const n = (fbm2(noise, px / 24, py / 24, 3) - 0.5) * 38 + (Math.random() - 0.5) * 16;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
      }
      c.putImageData(img, 0, 0);
    }, { wrap: false });
    groundTex.wrapS = groundTex.wrapT = THREE.ClampToEdgeWrapping;
    this.groundCanvas = groundTex.image;
    this.groundTex = groundTex;
    const gw = m.W * TILE, gh = m.H * TILE;
    // G6: PBR-Detailschichten je Bodentyp (Gewichte je Feld, 2×RGBA = 8 Schichten)
    const wd = [new Uint8Array(m.W * m.H * 4), new Uint8Array(m.W * m.H * 4)];
    for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
      const L = FLOOR_LAYER[m.at(x, y).floor] || 0; if (!L) continue;
      wd[(L - 1) >> 2][(y * m.W + x) * 4 + ((L - 1) & 3)] = 255;
    }
    const wTex = wd.map((d) => { const t = new THREE.DataTexture(d, m.W, m.H, THREE.RGBAFormat); t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t; });
    this.groundWeights = wTex;
    const gUni = {
      gAlb: { value: null }, gNrm: { value: null }, gW0: { value: wTex[0] }, gW1: { value: wTex[1] },
      gMapSize: { value: new THREE.Vector2(gw, gh) }, gScale: { value: new Array(9).fill(1) }, gMean: { value: Array.from({ length: 9 }, () => new THREE.Vector3(0.5, 0.5, 0.5)) },
      gStrength: { value: 0.85 },
    };
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh).rotateX(-Math.PI / 2), patchFog(groundPBRMaterial(new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95, bumpMap: groundTex, bumpScale: 1.2 }), gUni)));
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;
    // Umgebung außerhalb der Karte
    const baseCol = cols[m.at(0, 0).floor] || cols.grass;
    const outerTex = canvasTexture(256, 256, (c, w, h) => { c.fillStyle = baseCol[0]; c.fillRect(0, 0, w, h); for (let i = 0; i < 4000; i++) { c.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},0.07)`; c.fillRect(Math.random() * w, Math.random() * h, 3, 3); } });
    outerTex.repeat.set(30, 30);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(800, 800).rotateX(-Math.PI / 2), patchFog(groundPBRMaterial(new THREE.MeshStandardMaterial({ map: outerTex, roughness: 1 }), gUni)));
    outer.position.y = -0.02; outer.receiveShadow = true;
    this.scene.add(outer);
    this.groundPBR = this.realModels ? 'loading' : 'off';
    if (this.realModels) loadGroundPBR(this.engine.mobile ? 256 : 512).then((P) => {
      if (this.disposed) return;
      if (!P) { this.groundPBR = 'fallback'; return; }
      gUni.gAlb.value = P.alb; gUni.gNrm.value = P.nrm;
      gUni.gScale.value = P.scale.slice(); gUni.gMean.value = P.mean.map((c) => new THREE.Vector3(...c));
      for (const mm of [ground.material, outer.material]) { mm.defines = { ...(mm.defines || {}), GROUND_PBR: '' }; mm.needsUpdate = true; }
      this.groundPBR = 'pbr';
      this.engine.resetHistory?.(); this.engine.invalidate?.();
    });
    // Grasbüschel als Detail
    const tufts = [];
    for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) { const c = m.at(x, y); if (['grass', 'field', 'field2', 'graveyard'].includes(c.floor) && !c.wall) tufts.push([x, y, c.floor === 'field2']); if (c.floor === 'crops' && !c.wall) for (let k = 0; k < 2; k++) tufts.push([x, y, 'crop']); }
    const per = 5, count = Math.min(7000, tufts.length * per);
    if (count) {
      const geo = new THREE.ConeGeometry(0.07, 0.45, 3).translate(0, 0.22, 0);
      const mat = patchFog(new THREE.MeshStandardMaterial({ color: 0x6d8f3a, roughness: 1 }));
      const inst = new THREE.InstancedMesh(geo, mat, count);
      const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), col = new THREE.Color();
      let k = 0;
      for (const [x, y, wheat] of tufts) for (let j = 0; j < per && k < count; j++, k++) {
        const p = this.cellPos(x, y);
        pos.set(p.x + randRange(-0.95, 0.95), 0, p.z + randRange(-0.95, 0.95));
        q.setFromEuler(new THREE.Euler(randRange(-0.3, 0.3), rand() * 6, randRange(-0.3, 0.3)));
        const crop = wheat === 'crop';
        sc.set(crop ? 1.6 : 1, crop ? randRange(2.4, 3.2) : wheat ? randRange(1.6, 2.2) : randRange(0.6, 1.6), crop ? 1.6 : 1);
        inst.setMatrixAt(k, mtx.compose(pos, q, sc));
        inst.setColorAt(k, crop ? col.setHSL(0.2 + rand() * 0.06, 0.55, 0.3 + rand() * 0.15) : wheat ? col.setHSL(0.12 + rand() * 0.03, 0.6, 0.45 + rand() * 0.12) : col.setHSL(0.22 + rand() * 0.06, 0.5, 0.25 + rand() * 0.15));
      }
      this.scene.add(inst);
    }
    // Weinreben: Laubwand entlang der Reihe (je Feld zwei Ballen + Pfahl), ein InstancedMesh
    const vines = [];
    for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) { const c = m.at(x, y); if (c.floor === 'vineyard' && !c.wall) vines.push([x, y]); }
    if (vines.length) {
      const g = new THREE.IcosahedronGeometry(0.5, 1).scale(1.0, 0.85, 0.42).translate(0, 0.95, 0);
      const vm = patchFog(new THREE.MeshStandardMaterial({ map: textures().leaf, color: 0x9ab87a, roughness: 0.9 }));
      const inst = new THREE.InstancedMesh(g, vm, vines.length * 2);
      const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
      let k = 0;
      for (const [x, y] of vines) for (const o of [-0.5, 0.5]) { const p = this.cellPos(x, y); inst.setMatrixAt(k++, mtx.compose(pos.set(p.x + o + randRange(-0.1, 0.1), 0, p.z), q.setFromAxisAngle(Y, randRange(-0.15, 0.15)), sc.set(randRange(0.95, 1.15), randRange(0.85, 1.15), 1))); }
      inst.castShadow = this.engine.settings.shadows !== 'off'; inst.receiveShadow = true;
      this.scene.add(inst);
    }
  }

  buildProps() {
    const m = this.map;
    const { parts, mats } = propParts();
    this.propParts = parts;
    const shadows = this.engine.settings.shadows !== 'off';
    const T2 = Math.PI / 2;
    // Gebäude: Fassadenstil (Atlas-Kachel + Tönung), sichtbare Zusatzstockwerke, Instanzen für Dach-/Obergeschoss-Ausblendung
    this.bInfo = m.buildings.map((b) => {
      const f = FACADES[b.style] || FACADES.brick;
      const extra = b.ruined ? 0 : Math.max(0, Math.min(2, (b.storeys || 1) - 1));
      return { b, f, extra, perm: extra >= 2 ? 0 : extra === 1 ? 2 : 3, tint: new THREE.Color(choice(f.tint)).multiplyScalar(randRange(0.94, 1.04)), trim: new THREE.Color(f.trim), inst: [], doors: [], open: false, revealed: false, roof: null };
    });
    const inner = new THREE.Color('#f2eee6'), white = new THREE.Color(1, 1, 1);
    const plan = [], counts = {};
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    const same = (x, y, t) => m.at(x, y)?.wall?.type === t;
    // ---- Karten-Hindernisse aus dem Vertrag (orchestrator/karten/vertrag.md) ----
    // wall.rot = Blickrichtung in Vierteldrehungen (0 Süd/+z, 1 West, 2 Nord, 3 Ost) → Winkel -rot·90°; wall.variant 0..3
    const BMAT = new Set(['stone', 'concrete', 'metalsheet', 'plaster']);
    const WALLISH = new Set(['brick', 'wood', 'window', 'metal', 'stone', 'concrete', 'metalsheet', 'plaster', 'glass']);
    const LINE = new Set(['glass', 'stonewall', 'sandbag', 'tallhedge', 'chainlink']);
    const RUN = new Set(['bus', 'truck', 'container']);
    const TREE = new Set(['birch', 'oak', 'palm', 'deadtree']), ORG = new Set(['bush', 'stump', 'rockpile', ...TREE]);
    const FREE = new Set(['barrel', 'fuelbarrel', 'well', 'fountain']);
    const NEWT = new Set(['stone', 'concrete', 'metalsheet', 'plaster', 'glass', 'stonewall', 'sandbag', 'woodpile', 'bush', 'tallhedge', 'birch', 'oak', 'palm', 'deadtree', 'stump', 'rockpile', 'container', 'pallet', 'barrel', 'fuelbarrel', 'fuelpump', 'bus', 'truck', 'milwreck', 'well', 'fountain', 'gravestone', 'statue', 'pylon', 'watertank', 'silo', 'scaffold', 'tent', 'milcrate', 'chainlink']);
    const biome = this.opts.biome;
    const FOL = biome === 'desert' ? ['#eae4b4', '#dcd6a4', '#cfd0a4', '#f2e2b0'] : biome === 'arctic' ? ['#dfe8e2', '#cfdcd6', '#e6eee8', '#c8d4cc'] : ['#ffffff', '#e4f2c8', '#c8dcb0', '#f6dc98'];
    const PAL = {
      stone: ['#ffffff', '#efe4d2', '#dcdfe2', '#f2e2c4'], concrete: ['#ffffff', '#e6e8ec', '#f2ede2', '#d6d6d2'], metalsheet: ['#eef2f4', '#b8483a', '#6a947a', '#6a8cb4'], plaster: ['#f6efe2', '#f2dcb8', '#e0ead8', '#f2d6c6'],
      rockpile: ['#ffffff', '#e8c8a8', '#c8ccd0', '#a8a098'], barrel: ['#3a6aa8', '#4a7a40', '#9a9ea2', '#d8b43a'], tent: ['#e8742a', '#4a8a46', '#3466b0', '#c83a32', '#e2c234'],
      bus: ['#f0c020', '#ececea', '#c83a2a', '#2f62a2'], cab: ['#c8302a', '#2a4a8a', '#ececea', '#2f6e3e'], trailer: ['#f2f2f0', '#c8ccd0', '#3a5a9a', '#b03a2a'], grave: ['#a8a8a6', '#5a5a5e', '#a88478', '#d4c8ac'], tank: ['#f2f2f2', '#cfe0ee', '#c4c8cc', '#c27a5c'],
    };
    const col = (h) => (h ? new THREE.Color(h) : null);
    const eul = new THREE.Euler();
    const water = [];
    const put = (c, t, v, B = null, colors = null, tiles = null, mask = 0, extraOf = null) => {
      const e = { c, t, v, m: mtx.clone(), colors, tiles, mask, B, extraOf };
      plan.push(e); (counts[t] ||= {})[v] = (counts[t][v] || 0) + 1; return e;
    };
    const M4 = (px, pz, ang, sx = 1, sy = 1, sz = 1, tx = 0, tz = 0) => mtx.compose(pos.set(px, 0, pz), q.setFromEuler(eul.set(tx, ang, tz)), s.set(sx, sy, sz));
    const addNew = (c, x, y, t, p) => {
      const w = c.wall, vr = Number.isInteger(w.variant) ? w.variant & 3 : (x * 7 + y * 13) & 3, rr = Number.isInteger(w.rot) ? w.rot & 3 : null;
      const qa = rr == null ? randInt(0, 3) * T2 : -rr * T2, hash = (x * 31 + y * 17) >>> 0;
      const bld = c.bld != null ? this.bInfo[c.bld] : null;
      // Gebäudewände aus neuen Materialien: wie brick/wood mit Obergeschossen, Fenstern und Innenwänden
      if (bld && (BMAT.has(t) || (t === 'window' && BMAT.has(bld.b.mat)))) {
        const b = bld.b, edge = x === b.x0 || y === b.y0 || x === b.x0 + b.w - 1 || y === b.y0 + b.h - 1;
        if (t === 'window') { M4(p.x, p.z, w.vert ? T2 : 0); put(c, t, b.mat + ':win', bld, [bld.tint, bld.trim, null, bld.tint, bld.tint], null, bld.perm); }
        else if (edge) { M4(p.x, p.z, randInt(0, 3) * T2); put(c, t, t + ':out', bld, [bld.tint, bld.trim, bld.tint, bld.tint], null, bld.perm); }
        else { M4(p.x, p.z, 0); put(c, t, 'wallIn', null, [inner, white], [atlasTile(2), null]); }
        return;
      }
      if (t === 'bench' || t === 'bin') {
        // Stadtmobiliar als Deckung: Modelle der Deko (Front +z), Blickrichtung zur Fahrbahn aus wall.rot, an den Bordstein gerückt
        const v2 = 'wall:' + t;
        if (!parts[v2] && parts['deco:' + t]) parts[v2] = parts['deco:' + t].map((pp) => ({ ...pp, shadow: true }));
        if (parts[v2]) {
          const a = rr == null ? randInt(0, 3) * T2 : -rr * T2, off = t === 'bench' ? 0.5 : 0.55;
          M4(p.x + Math.sin(a) * off + (t === 'bin' ? Math.cos(a) * randRange(-0.4, 0.4) : 0), p.z + Math.cos(a) * off - (t === 'bin' ? Math.sin(a) * randRange(-0.4, 0.4) : 0), a + randRange(-0.04, 0.04));
          put(c, t, v2); return;
        }
      }
      if (!parts[t] && !LINE.has(t) && !RUN.has(t) && !['gravestone', 'tent'].includes(t)) {
        // Unbekannter Typ (noch ohne Modell): Platzhalter-Kiste in Typhöhe, damit nichts abstürzt
        M4(p.x, p.z, rand() * 6.28, 1, (WALLS[t]?.h || 1.15) / 1.15, 1); put(c, t, 'crate'); return;
      }
      if (BMAT.has(t)) { M4(p.x, p.z, randInt(0, 3) * T2); put(c, t, t, null, [col(PAL[t][vr]), null]); return; }
      if (LINE.has(t)) {
        // An Nachbarn ausrichten; Ecken/T-Stöße aus Halbstücken (Instanz in Achsrichtung halb skaliert)
        const conn = (xx, yy) => { const o = m.at(xx, yy)?.wall?.type; return !!o && (o === t || (t === 'glass' && WALLISH.has(o)) || (t === 'chainlink' && o === 'fence')); };
        const E = conn(x + 1, y), Wn = conn(x - 1, y), S = conn(x, y + 1), N = conn(x, y - 1), pcs = [];
        if (E && Wn) pcs.push([0, 0, 0, 1]); else if (E || Wn) pcs.push(S || N ? [E ? 0.5 : -0.5, 0, 0, 0.5] : [0, 0, 0, 1]);
        if (S && N) pcs.push([0, 0, T2, 1]); else if (S || N) pcs.push(E || Wn ? [0, S ? 0.5 : -0.5, T2, 0.5] : [0, 0, T2, 1]);
        if (!pcs.length) pcs.push([0, 0, w.vert != null ? (w.vert ? T2 : 0) : rr != null ? (rr % 2 ? 0 : T2) : randInt(0, 1) * T2, 1]);
        const tint = t === 'tallhedge' ? [col(FOL[vr]).lerp(white, 0.3)] : null;
        let main = null;
        for (const [dx, dz, a, sx] of pcs) {
          const flip = t === 'sandbag' || t === 'stonewall' || t === 'tallhedge' ? (rand() < 0.5 ? Math.PI : 0) : 0;
          M4(p.x + dx, p.z + dz, a + flip, sx);
          const e = put(c, t, t, null, tint, null, 0, main); main ||= e;
        }
        return;
      }
      if (RUN.has(t)) {
        // Fahrzeuge/Container über mehrere Felder: Reihe entlang einer Achse → Segmente vorne/Mitte/hinten bzw. einzeln
        const run = (dx, dy) => { let a = 0, b = 0; while (same(x - dx * (a + 1), y - dy * (a + 1), t)) a++; while (same(x + dx * (b + 1), y + dy * (b + 1), t)) b++; return [a, b]; };
        const rx = run(1, 0), ry = run(0, 1), lx = rx[0] + rx[1] + 1, ly = ry[0] + ry[1] + 1;
        const axis = lx > 1 && ly === 1 ? 0 : ly > 1 && lx === 1 ? 1 : rr != null ? (rr % 2 ? 0 : 1) : lx > 1 ? (lx >= ly ? 0 : 1) : hash & 1;
        const [a, b] = axis === 0 ? rx : ry, L = a + b + 1, sx0 = axis === 0 ? x - a : x, sy0 = axis === 0 ? y : y - a, sw = m.at(sx0, sy0).wall;
        const r0 = Number.isInteger(sw.rot) ? sw.rot & 3 : rr, v0 = Number.isInteger(sw.variant) ? sw.variant & 3 : (sx0 * 7 + sy0 * 13) & 3;
        const fwd = r0 != null && (r0 % 2 === 1) === (axis === 0) ? (r0 === 0 || r0 === 3 ? 1 : -1) : ((sx0 * 31 + sy0 * 17) >>> 2) & 1 ? 1 : -1;
        const f = fwd > 0 ? L - 1 - a : a, role = L === 1 ? 'single' : f === 0 ? 'front' : f === L - 1 ? 'rear' : 'mid';
        const ang = L === 1 && r0 == null ? randInt(0, 3) * T2 : axis === 0 ? (fwd > 0 ? T2 : -T2) : fwd > 0 ? 0 : Math.PI;
        M4(p.x, p.z, ang);
        const v = t + ':' + role;
        if (t === 'container') put(c, t, v, null, null, [atlasTile(v0)]);
        else put(c, t, v, null, [col(t === 'bus' ? PAL.bus[v0] : role === 'front' || role === 'single' ? PAL.cab[v0] : PAL.trailer[(v0 + (sx0 + sy0)) & 3]), null]);
        return;
      }
      if (ORG.has(t)) {
        const tree = TREE.has(t), j = tree ? 0.3 : 0.15, sc = randRange(0.85, 1.15);
        M4(p.x + randRange(-j, j), p.z + randRange(-j, j), (rr == null ? 0 : -rr * T2) + rand() * 6.28, sc, sc * (tree ? randRange(0.9, 1.15) : 1), sc);
        const fol = col(FOL[vr]).multiplyScalar(randRange(0.9, 1.05));
        put(c, t, t, null, t === 'bush' ? [fol] : t === 'birch' || t === 'oak' || t === 'palm' ? [null, fol] : t === 'rockpile' ? [col(PAL.rockpile[vr])] : null);
        return;
      }
      // Einzelobjekte: Drehung aus rot (sonst zufällige Vierteldrehung) + leichte Zufallsdrehung
      let v = t, ang = qa + randRange(-0.06, 0.06), colors = null, tx = 0, tz = 0;
      if (FREE.has(t)) ang = rand() * 6.28;
      if (t === 'gravestone') { v = 'gravestone:' + vr; ang = (rr == null ? 0 : -rr * T2) + randRange(-0.05, 0.05); colors = [col(PAL.grave[(vr + hash) & 3])]; }
      if (t === 'tent') { v = vr < 2 ? 'tent:dome' : 'tent:ridge'; colors = [col(PAL.tent[hash % 5])]; }
      if (t === 'pallet') v = vr & 1 ? 'pallet:load' : 'pallet';
      if (t === 'barrel') colors = [col(PAL.barrel[vr])];
      if (t === 'watertank') colors = [col(PAL.tank[vr]), null];
      if (t === 'milwreck') { tx = randRange(-0.04, 0.04); tz = randRange(-0.05, 0.05); }
      if (t === 'scaffold') ang = same(x - 1, y, t) || same(x + 1, y, t) ? 0 : same(x, y - 1, t) || same(x, y + 1, t) ? T2 : rr != null ? (rr % 2 ? 0 : T2) : 0;
      M4(p.x, p.z, ang, 1, 1, 1, tx, tz);
      put(c, t, v, null, colors);
    };
    for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
      const c = m.at(x, y); if (!c.wall) continue;
      const t = c.wall.type;
      const p = this.cellPos(x, y);
      pos.set(p.x, 0, p.z);
      if (t === 'water') { water.push([x, y]); continue; }
      if (!(t in parts) || NEWT.has(t) || (t === 'window' && c.bld != null && BMAT.has(m.buildings[c.bld]?.mat))) { addNew(c, x, y, t, p); continue; }
      let v = t, rot = 0, scl = 1, colors = null, tiles = null, mask = 0, B = null;
      if (['tree', 'pine', 'rock', 'bigrock', 'hivewall', 'wreck', 'pod', 'crate'].includes(t)) { rot = rand() * Math.PI * 2; scl = randRange(0.85, 1.2); }
      if (t === 'crate') { scl = 1; rot = randInt(0, 3) * T2 + randRange(-0.2, 0.2); if (c.wall.furn) { v = choice(FURNITURE); rot = (c.wall.rot || 0) + randRange(-0.04, 0.04); } }
      if (['fence', 'hedge', 'barrier'].includes(t)) rot = (same(x, y - 1, t) || same(x, y + 1, t)) ? T2 : 0;
      if (t === 'brick' || t === 'wood' || t === 'window') {
        // Wandmodule: Außenwand (mit Obergeschossen), Fenster, Innenwand
        B = c.bld != null ? this.bInfo[c.bld] : null;
        const b = B?.b, f = B?.f || FACADES.brick;
        const edge = !b || x === b.x0 || y === b.y0 || x === b.x0 + b.w - 1 || y === b.y0 + b.h - 1;
        mask = B ? B.perm : 3;
        if (t === 'window') { v = 'window'; rot = c.wall.vert ? T2 : 0; colors = [B?.tint, B?.trim, null, B?.tint, B?.tint]; tiles = [atlasTile(f.tile), null, null, atlasTile(f.up), atlasTile(f.up)]; }
        else if (edge) { v = 'wallOut'; colors = [B?.tint, B?.trim, B?.tint, B?.tint]; tiles = [atlasTile(f.tile), null, atlasTile(f.up), atlasTile(f.up)]; }
        else { v = 'wallIn'; colors = [inner, white]; tiles = [atlasTile(2), null]; B = null; mask = 0; }
      }
      if (t === 'car') {
        // Fahrzeugmodell, längs zur Straße; Lack nur auf der Karosserie
        const variant = c.wall.variant || choice(['sedan', 'sedan', 'kombi', 'suv', 'van', 'pickup']);
        v = 'car:' + variant;
        rot = c.wall.vert == null ? randInt(0, 3) * T2 + randRange(-0.15, 0.15) : (c.wall.vert ? 0 : T2) + (rand() < 0.5 ? Math.PI : 0) + randRange(-0.06, 0.06);
        const paint = new THREE.Color(variant === 'tractor' ? choice(['#3a7a2a', '#b82a1a', '#2a5a9a', '#d0a020']) : choice(CAR_PAINT));
        // G6: Hero-Auto (Lack/Glas/Chrom aus herocar.js) statt Kastenmodell; Traktor bleibt das alte Modell
        const hv = this.realModels && HERO_VARIANT[variant];
        if (hv) { v = 'hero:' + variant; c.wall.hero = hv; colors = [paint]; }
        else colors = parts[v].map((pp) => (pp.paint ? paint : null));
      }
      if (t === 'hay' && rand() < 0.4) v = 'hay:stack';
      if (t === 'log') rot = (c.wall.vert ? T2 : 0) + randRange(-0.25, 0.25);
      if (t === 'tree' || t === 'pine') colors = [null, new THREE.Color().setHSL(0.25 + rand() * 0.08, 0.5, 0.6 + rand() * 0.3), new THREE.Color().setHSL(0.25 + rand() * 0.08, 0.5, 0.6 + rand() * 0.3), new THREE.Color(1, 1, 1)];
      if (t === 'tree' || t === 'pine') pos.x += randRange(-0.3, 0.3), pos.z += randRange(-0.3, 0.3);
      if (!colors && parts[v].some((pp) => pp.tint)) { const tc = new THREE.Color(choice(DECO_TINT.rug)).lerp(white, 0.35); colors = parts[v].map((pp) => (pp.tint ? tc : null)); }
      q.setFromAxisAngle(Y, rot);
      s.set(scl, t === 'tree' || t === 'pine' ? scl * randRange(0.9, 1.25) : scl, scl);
      mtx.compose(pos, q, s);
      plan.push({ c, t, v, m: mtx.clone(), colors, tiles, mask, B });
      (counts[t] ||= {})[v] = (counts[t][v] || 0) + 1;
    }
    this.props = {};
    for (const [t, vs] of Object.entries(counts)) {
      const sets = {};
      for (const [v, n] of Object.entries(vs)) sets[v] = v.startsWith('hero:') ? this.makeHeroSet(v.slice(5), n, shadows) : new PropSet(this.scene, parts[v], n, shadows);
      this.props[t] = new VariantSet(sets);
    }
    const links = {};
    for (const e of plan) {
      const i = this.props[e.t].add(e.m, e.colors, e.tiles, e.mask, e.v);
      if (e.extraOf) { ((links[e.t] ||= {})[e.extraOf.c.wall.idx] ||= []).push(i); continue; }
      e.c.wall.idx = i;
      if (e.B) e.B.inst.push([this.props[e.t], e.c.wall.idx, e.mask]);
    }
    // Typen mit mehreren Instanzen je Feld (Ecken linearer Objekte): Ein-/Ausblenden und Zerstören wirken auf alle Teile
    for (const [t, lk] of Object.entries(links)) {
      const vs = this.props[t];
      this.props[t] = { sets: vs.sets, ref: vs.ref, base: vs.base, zero: vs.zero, add: (...a) => vs.add(...a), setMask: (i, b) => vs.setMask(i, b),
        show: (i, on) => { on = on && vs.base[i] !== vs.zero; vs.show(i, on); for (const j of lk[i] || []) vs.show(j, on); } };
    }
    // Türrahmen samt Sturz und Obergeschoss über der Türöffnung (Deko ohne Kollision, erscheint mit dem Feld); Material je Gebäude
    const doors = [];
    for (const B of this.bInfo) for (const d of B.b.doors) { const c = m.at(d.x, d.y); if (c && !c.wall && !c.ufo && c.indoor) doors.push([B, d]); }
    if (doors.length) {
      const byV = {}, refs = [];
      for (const bd of doors) (byV[BMAT.has(bd[0].b.mat) ? bd[0].b.mat + ':door' : 'door'] ||= []).push(bd);
      for (const [v, list] of Object.entries(byV)) {
        const set = new PropSet(this.scene, parts[v], list.length, shadows);
        for (const [B, d] of list) {
          const p = this.cellPos(d.x, d.y);
          q.setFromAxisAngle(Y, { n: 0, s: Math.PI, w: T2, e: -T2 }[d.side]);
          mtx.compose(pos.set(p.x, 0, p.z), q, s.set(1, 1, 1));
          const i = set.add(mtx, [B.tint, B.trim, B.tint, B.tint], v === 'door' ? [atlasTile(B.f.tile), null, atlasTile(B.f.up), atlasTile(B.f.up)] : null, B.perm);
          B.inst.push([set, i, B.perm]); B.doors.push({ i: refs.length, k: d.y * m.W + d.x, on: false }); refs.push([set, i]);
        }
      }
      this.doorSet = { show: (i, on) => refs[i][0].show(refs[i][1], on) };
    }
    // Tiefes Wasser: eine gemeinsame, animierte Fläche über allen Wasserfeldern (+ Uferrand zum Ausblenden)
    if (water.length) {
      const data = new Uint8Array(m.W * m.H), cover = new Set(), P3 = [], UV = [];
      for (const [x, y] of water) { data[y * m.W + x] = 255; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (m.at(x + dx, y + dy)) cover.add((y + dy) * m.W + x + dx); }
      for (const k of cover) {
        const p = this.cellPos(k % m.W, (k / m.W) | 0), x0 = p.x - TILE / 2, x1 = p.x + TILE / 2, z0 = p.z - TILE / 2, z1 = p.z + TILE / 2;
        P3.push(x0, 0, z0, x0, 0, z1, x1, 0, z1, x0, 0, z0, x1, 0, z1, x1, 0, z0);
        for (let i = 0; i < 18; i += 3) UV.push(P3[P3.length - 18 + i] / 4, -P3[P3.length - 18 + i + 2] / 4);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P3, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(P3.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
      const mask = new THREE.DataTexture(data, m.W, m.H, THREE.RedFormat);
      mask.magFilter = mask.minFilter = THREE.LinearFilter; mask.needsUpdate = true;
      const wtr = makeWater(mask, this.scene.fog?.color), mesh = new THREE.Mesh(geo, wtr.mat);
      mesh.position.y = 0.04; mesh.receiveShadow = true; mesh.renderOrder = 1;
      this.scene.add(mesh);
      this.water = { mesh, mask, time: wtr.time };
    }
    // Dächer: je Gebäude ein Objekt, ausgeblendet solange man hineinsehen muss (updateBuildings)
    for (const B of this.bInfo) {
      const b = B.b; if (b.ruined) continue;
      const p0 = this.cellPos(b.x0, b.y0), p1 = this.cellPos(b.x0 + b.w - 1, b.y0 + b.h - 1);
      const wall = b.style === 'brick' ? new THREE.Color('#a65c42').multiply(B.tint) : B.tint.clone();
      const roof = makeRoof({ sx: b.w * TILE, sz: b.h * TILE, H: 2.8 * (1 + B.extra), kind: b.roof, roof: choice(B.f.roof), wall, trim: B.trim, tall: B.extra > 0, tank: b.style === 'adobe' }, mats);
      roof.position.set((p0.x + p1.x) / 2, 0, (p0.z + p1.z) / 2);
      roof.visible = false;
      this.scene.add(roof); B.roof = roof;
    }
    // UFO-Kuppel-Deko (abgestürzt: geneigt) – nur Rand, damit das Innere sichtbar bleibt
    if (m.ufo) {
      const pc = this.cellPos(m.ufo.cx, m.ufo.cy);
      const R = (m.ufo.r + 0.5) * TILE;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.45, 10, 64), patchFog(new THREE.MeshStandardMaterial({ map: textures().metal, color: 0x9aa4b0, metalness: 0.9, roughness: 0.25 })));
      rim.rotation.x = Math.PI / 2; rim.position.set(pc.x, 2.9, pc.z); rim.castShadow = true;
      this.scene.add(rim);
      const lights = new THREE.Mesh(new THREE.TorusGeometry(R + 0.3, 0.12, 6, 64), patchFog(new THREE.MeshStandardMaterial({ color: 0, emissive: m.ufo.crashed ? 0xff5030 : 0x40ffd0, emissiveIntensity: 3 })));
      lights.rotation.x = Math.PI / 2; lights.position.set(pc.x, 2.9, pc.z);
      this.scene.add(lights);
      this.ufoRim = [rim, lights];
      rim.visible = lights.visible = false;
    }
    // Transporter am Kartenrand (G6: Kondor aus craftmodels.js, Heck mit offener Rampe zur Landezone)
    const lz = this.map.lz[0];
    const tp = this.cellPos(lz.x + 2, m.H - 1);
    let tr = null;
    if (this.realModels) {
      try {
        tr = makeKondor({ gear: true, lod: this.engine.mobile ? 'low' : 'high', seed: 3, damage: 0.25, shadows: this.engine.settings.shadows !== 'off' });
        const ud = tr.userData;
        tr.rotation.y = Math.PI; // Nase (−Z) vom Einsatzgebiet weg, Heckrampe (+Z) zur Landezone
        tr.position.set(tp.x, -ud.groundY, tp.z + TILE * 0.5 + 14.6);
        setHatch(tr, 1);
        tr.traverse((o) => { if (o.isMesh) { o.castShadow = o.castShadow !== false; o.receiveShadow = true; } });
        this.transport = tr;
      } catch (e) { console.warn('AEGIS: Transporter (craftmodels) fehlgeschlagen – altes Modell', e); tr = null; }
    }
    if (!tr) { tr = makeTransport(); tr.position.set(tp.x, 0, tp.z + 10.5); }
    this.scene.add(tr);
  }

  // G6: Instanz-Satz für eine Hero-Auto-Variante (geteilte Geometrie/Materialien aus dem Cache von herocar.js)
  makeHeroSet(variant, n, shadows) {
    const hv = HERO_VARIANT[variant], mobile = !!this.engine.mobile;
    const kit = this.heroKit(hv);
    const set = new HeroCarSet(this.scene, kit, n, shadows, { scale: Math.min(1, 4.6 / kit.dims.length), mobile, burnt: hv.burnt });
    (this.heroSets ||= []).push(set);
    return set;
  }
  heroKit(hv) {
    const kit = getHeroCarKit(hv.type, { damage: hv.damage, paintColor: hv.paint, seed: hv.seed, levels: this.engine.mobile ? [1, 2] : [0, 1, 2] });
    for (const m of Object.values(kit.mats)) patchFog(m);
    if (hv.burnt && !kit.burntTuned) { // ausgebrannt: matter, rußiger Lack, Leuchten aus
      kit.burntTuned = true;
      Object.assign(kit.mats.paint, { clearcoat: 0, roughness: 0.92, metalness: 0.2 }); kit.mats.paint.color.setRGB(0.55, 0.5, 0.46);
      kit.mats.headlight.emissiveIntensity = 0; kit.mats.taillight.emissiveIntensity = 0;
      // Innenraum/Reifen/Chrom verkohlt (eigene Materialien statt der geteilten aus herocar.js)
      const soot = (c, r, m = 0) => { const mm = patchFog(new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m })); kit.own.push(mm); return mm; };
      kit.mats.interior = soot(0x0c0b0a, 1); kit.mats.tyre = soot(0x080808, 0.95); kit.mats.chrome = soot(0x2a2522, 0.7, 0.6);
    }
    return kit;
  }
  // Zerstörtes Hero-Auto: erst ausgebranntes Wrack mit Feuer/Rauch zeigen, danach wie bisher entfernen
  wreckHeroCar(t, idx, x, y) {
    const vs = this.props[t]; const ref = vs?.ref?.[idx]; if (!ref) return;
    const [set, li] = ref; if (!(set instanceof HeroCarSet)) return;
    const burnt = this.heroKit({ ...HERO_VARIANT.burnt, type: set.kit.type });
    if (this.csm) Object.values(burnt.mats).forEach((m) => this.csm.setupMaterial(m));
    const lv = this.engine.mobile ? 2 : 1;
    const g = HeroCarSet.single(burnt, lv, set.base[li], true);
    this.scene.add(g);
    const p = this.cellPos(x, y), pos = new THREE.Vector3(p.x, 0.8, p.z);
    this.flash(pos, 0xff8030, 5, 0.3);
    let k = 0, acc = 0;
    this.fx.push((dt) => {
      if (this.disposed) { g.removeFromParent(); return false; }
      k += dt; acc += dt;
      if (acc > 0.08) { acc = 0; this.emit(pos.clone(), new THREE.Color(2.2, 0.8, 0.2), 0.6, 0.35, 0.5); this.emit(pos.clone().setY(1.2), new THREE.Color(0.18, 0.17, 0.17), 0.5, 0.8, 1.6, false, true); }
      if (k < 1.8) return true;
      for (let i = 0; i < 10; i++) this.emit(pos.clone(), new THREE.Color(0.4, 0.38, 0.35), 0, 1.4, 1.1, false, true);
      g.removeFromParent();
      return false;
    });
  }

  // Nicht blockierende Umgebungsdetails (ein InstancedMesh je Bauteil und Typ)
  buildDeco() {
    const m = this.map, parts = this.propParts;
    const items = {};
    const add = (t, x, y, ox, oz, rot, s) => (items[t] ||= []).push({ x, y, ox, oz, rot, s });
    for (const d of m.deco || []) add(d.t, d.x, d.y, d.ox, d.oz, d.rot, d.s);
    for (const l of m.lights) if (l.lamp) { const d = l.dir || [1, 0]; add('lamp', l.x, l.y, 0, 0, Math.atan2(d[0], d[1]), 1); }
    for (const B of this.bInfo || []) {
      const b = B.b; if (b.ruined) continue;
      for (let k = 0; k < 2; k++) { const x = randInt(b.x0 + 1, b.x0 + b.w - 2), y = randInt(b.y0 + 1, b.y0 + b.h - 2), c = m.at(x, y); if (c && !c.wall && !c.door) add('rug', x, y, randRange(-0.15, 0.15), randRange(-0.15, 0.15), randInt(0, 1) * Math.PI / 2, 1); }
    }
    const shadows = this.engine.settings.shadows !== 'off';
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    for (const [t, list] of Object.entries(items)) {
      const pp = parts['deco:' + t]; if (!pp) continue;
      const meshes = pp.map((p) => { const im = new THREE.InstancedMesh(p.geo, p.mat, list.length); im.castShadow = shadows && p.shadow !== false; im.receiveShadow = true; this.scene.add(im); return im; });
      list.forEach((d, i) => {
        const p = this.cellPos(d.x, d.y);
        mtx.compose(pos.set(p.x + d.ox, 0, p.z + d.oz), q.setFromAxisAngle(Y, d.rot), sc.setScalar(d.s));
        const tint = DECO_TINT[t] ? new THREE.Color(choice(DECO_TINT[t])) : null;
        meshes.forEach((im, k) => { im.setMatrixAt(i, mtx); if (tint && pp[k].tint) im.setColorAt(i, tint); });
      });
    }
  }

  // Fahrbahnmarkierungen, Zebrastreifen, Bordsteine, Gullideckel und Ölflecken auf die Bodentextur malen
  paintMarkings(c, P) {
    const m = this.map, r = m.roads;
    if (!r) return;
    const inRY = (y) => r.ys.some((a) => y >= a && y < a + 3), inRX = (x) => r.xs.some((a) => x >= a && x < a + 3);
    for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
      if (m.at(x, y).floor !== 'sidewalk') continue;
      const X = x * P, Y = y * P;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (m.at(x + dx, y + dy)?.floor !== 'asphalt') continue;
        c.fillStyle = '#bdb9b0';
        if (dx === 1) c.fillRect(X + P - 3, Y, 3, P); if (dx === -1) c.fillRect(X, Y, 3, P); if (dy === 1) c.fillRect(X, Y + P - 3, P, 3); if (dy === -1) c.fillRect(X, Y, P, 3);
        c.fillStyle = 'rgba(0,0,0,0.35)';
        if (dx === 1) c.fillRect(X + P, Y, 2, P); if (dx === -1) c.fillRect(X - 2, Y, 2, P); if (dy === 1) c.fillRect(X, Y + P, P, 2); if (dy === -1) c.fillRect(X, Y - 2, P, 2);
      }
    }
    c.fillStyle = 'rgba(235,235,225,0.85)';
    for (const a of r.xs) {
      for (let y = 0; y < m.H; y++) if (!inRY(y)) { c.fillRect((a + 1.5) * P - 1.5, y * P + 4, 3, P * 0.5); c.fillRect(a * P + 3, y * P, 1.5, P); c.fillRect((a + 3) * P - 4.5, y * P, 1.5, P); }
      for (const ry of r.ys) for (const y of [ry - 1, ry + 3]) if (y >= 0 && y < m.H && !inRY(y)) for (let k = 0; k < 7; k++) c.fillRect(a * P + 4 + k * ((3 * P - 8) / 7), y * P + 5, (3 * P - 8) / 14, P - 10);
    }
    for (const a of r.ys) {
      for (let x = 0; x < m.W; x++) if (!inRX(x)) { c.fillRect(x * P + 4, (a + 1.5) * P - 1.5, P * 0.5, 3); c.fillRect(x * P, a * P + 3, P, 1.5); c.fillRect(x * P, (a + 3) * P - 4.5, P, 1.5); }
      for (const rx of r.xs) for (const x of [rx - 1, rx + 3]) if (x >= 0 && x < m.W && !inRX(x)) for (let k = 0; k < 7; k++) c.fillRect(x * P + 5, a * P + 4 + k * ((3 * P - 8) / 7), P - 10, (3 * P - 8) / 14);
    }
    for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
      const cell = m.at(x, y); if (cell.floor !== 'asphalt') continue;
      const cx = (x + 0.5) * P, cy = (y + 0.5) * P;
      if (cell.wall?.type === 'car') { c.fillStyle = 'rgba(0,0,0,0.28)'; c.beginPath(); c.ellipse(cx, cy, P * 0.35, P * 0.3, 0, 0, 7); c.fill(); }
      else if (rand() < 0.035) { // Gullideckel
        c.fillStyle = '#26282b'; c.beginPath(); c.arc(cx, cy, P * 0.2, 0, 7); c.fill();
        c.strokeStyle = '#4a4c50'; c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, P * 0.2, 0, 7); c.stroke();
        for (let k = -2; k <= 2; k++) { c.beginPath(); c.moveTo(cx + k * 2.5, cy - P * 0.15); c.lineTo(cx + k * 2.5, cy + P * 0.15); c.stroke(); }
      } else if (rand() < 0.08) { c.strokeStyle = 'rgba(15,15,15,0.5)'; c.lineWidth = 1; c.beginPath(); let px = x * P + rand() * P, py = y * P + rand() * P; c.moveTo(px, py); for (let k = 0; k < 5; k++) { px += (rand() - 0.5) * 14; py += (rand() - 0.5) * 14; c.lineTo(px, py); } c.stroke(); }
    }
  }

  // Dächer und Obergeschosse ausblenden, wenn ein Soldat, eine sichtbare Einheit oder der Cursor im Gebäude
  // (bzw. hinter hohen Gebäuden auf der kameraabgewandten Seite) ist; Türrahmen erscheinen mit ihrem Feld
  updateBuildings() {
    const list = this.bInfo; if (!list?.length) return;
    const W = this.W, ex = this.explored, cur = this.cursor;
    const fx = -Math.sin(this.cam.yaw), fz = -Math.cos(this.cam.yaw);
    for (const B of list) {
      const b = B.b;
      if (!B.revealed) { for (let y = b.y0; y < b.y0 + b.h && !B.revealed; y++) for (let x = b.x0; x < b.x0 + b.w; x++) if (ex[y * W + x]) { B.revealed = true; break; } }
      for (const d of B.doors) if (!d.on && ex[d.k]) { d.on = true; this.doorSet.show(d.i, true); }
      let open = false;
      for (const u of this.units) {
        if (!u.alive || u.evac || u.x < b.x0 || u.y < b.y0 || u.x >= b.x0 + b.w || u.y >= b.y0 + b.h) continue;
        if (u.team === 'player' || (u.team === 'alien' ? this.isVisibleAlien(u) : this.vis[u.y * W + u.x])) { open = true; break; }
      }
      if (!open && cur) {
        const mg = 1 + B.extra * 2;
        open = cur.x >= b.x0 - (fx < -0.3 ? mg : 0) && cur.x < b.x0 + b.w + (fx > 0.3 ? mg : 0) && cur.y >= b.y0 - (fz < -0.3 ? mg : 0) && cur.y < b.y0 + b.h + (fz > 0.3 ? mg : 0);
      }
      if (open !== B.open) { B.open = open; for (const [set, i, perm] of B.inst) set.setMask(i, open ? 3 : perm); }
      if (B.roof) B.roof.visible = B.revealed && !open;
    }
  }

  buildHelpers() {
    const add = (o) => { this.scene.add(o); return o; };
    const ringMat = (c, o = 0.9) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.2), transparent: true, opacity: o, depthWrite: false, side: THREE.DoubleSide });
    this.selRing = add(new THREE.Mesh(new THREE.RingGeometry(0.75, 0.92, 32).rotateX(-Math.PI / 2), ringMat(0x30d0ff)));
    this.selRing.position.y = 0.05;
    this.tgtRing = add(new THREE.Mesh(new THREE.RingGeometry(0.8, 1.0, 4).rotateX(-Math.PI / 2).rotateY(Math.PI / 4), ringMat(0xff3040)));
    this.tgtRing.position.y = 0.06; this.tgtRing.visible = false;
    const sq = new THREE.EdgesGeometry(new THREE.BoxGeometry(TILE * 0.96, 0.02, TILE * 0.96));
    this.cursorMesh = add(new THREE.LineSegments(sq, new THREE.LineBasicMaterial({ color: new THREE.Color(2, 2, 2) })));
    this.cursorMesh.position.y = 0.06;
    this.cursorFill = add(new THREE.Mesh(new THREE.PlaneGeometry(TILE * 0.94, TILE * 0.94).rotateX(-Math.PI / 2), ringMat(0xffffff, 0.12)));
    this.cursorFill.position.y = 0.04;
    this.pathDots = add(new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), 80));
    this.pathDots.count = 0; this.pathDots.frustumCulled = false;
    this.rangeMesh = add(new THREE.InstancedMesh(new THREE.PlaneGeometry(TILE * 0.97, TILE * 0.97).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.8, 1.4), transparent: true, opacity: this.map.night || this.opts.biome === 'hive' ? 0.03 : 0.055, depthWrite: false }), this.N));
    this.rangeMesh.count = 0; this.rangeMesh.position.y = 0.03; this.rangeMesh.frustumCulled = false;
    this.grenadeArea = add(new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), ringMat(0xff8030, 0.18)));
    this.grenadeArea.visible = false; this.grenadeArea.position.y = 0.07;
    // Partikel
    const pt = canvasTexture(64, 64, (c) => { const g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 64, 64); }, { wrap: false });
    this.particleTex = pt;
    this.particles = [];
    for (let i = 0; i < 220; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: pt, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff }));
      sp.visible = false; this.scene.add(sp);
      this.particles.push({ sp, life: 0 });
    }
    this.tracerGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    // Rauchwolken (Nebelgranate): Sichtblockade pro Feld (verbleibende Runden) + wiederverwendete Rauch-Sprites
    this.smokeCells = new Uint8Array(this.N);
    this.smokeTex = canvasTexture(128, 128, (c) => {
      for (let i = 0; i < 9; i++) {
        const x = 64 + randRange(-22, 22), y = 64 + randRange(-22, 22), r = randRange(22, 40);
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.6, 'rgba(235,235,235,0.22)'); g.addColorStop(1, 'rgba(220,220,220,0)');
        c.fillStyle = g; c.fillRect(0, 0, 128, 128);
      }
    }, { wrap: false });
    const smokeCol = this.map.night || this.opts.biome === 'hive' ? 0x59606b : 0xb4b6b8;
    this.smokePool = [];
    for (let i = 0; i < SMOKE_SPRITES; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, color: smokeCol, transparent: true, opacity: 0, depthWrite: false, blending: THREE.NormalBlending }));
      sp.visible = false; sp.renderOrder = 2; sp.userData.used = false;
      this.scene.add(sp); this.smokePool.push(sp);
    }
    // vorab angelegte Fackel-Lichter (keine Shader-Neukompilierung zur Laufzeit)
    this.flareLights = [];
    for (let i = 0; i < 2; i++) { const l = new THREE.PointLight(0xffd6a0, 0, 24, 1.5); l.userData.busy = false; this.scene.add(l); this.flareLights.push(l); }
    // Brand: Restrunden, Ausbreitungsgeneration, Nachrauch je Feld + ein Licht für das Brandzentrum
    this.fireCells = new Uint8Array(this.N); this.fireGen = new Uint8Array(this.N); this.fireSmoke = new Uint8Array(this.N);
    this.fireLight = new THREE.PointLight(0xff7a30, 0, 18, 1.6); this.scene.add(this.fireLight);
    this.flames = []; // flackernde Flammen-Sprites für brennende Felder (Pool, max. 40 Felder)
    for (let i = 0; i < 40; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: pt, color: new THREE.Color(1.9, 0.55, 0.08), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.visible = false; sp.userData.ph = rand() * 10; this.scene.add(sp); this.flames.push(sp);
    }
    // Scanner-Blips (gelbe, pulsierende Ringe) und Bodenziel-Markierung
    this.blipRings = [];
    for (let i = 0; i < BLIPS; i++) { const r = add(new THREE.Mesh(new THREE.RingGeometry(0.45, 0.62, 24).rotateX(-Math.PI / 2), ringMat(0xffe040, 0.85))); r.visible = false; r.position.y = 0.08; this.blipRings.push(r); }
  }

  spawnUnits() {
    const m = this.map;
    // Soldaten
    const spawns = m.playerSpawns.slice();
    const stockLeft = { ...(Game.c.stock || {}) };
    this.beltShort = [];
    this.opts.squad.forEach((s, i) => {
      const sp = spawns[i]; if (!sp) return;
      const arm = ARMORS[s.armor];
      // Magazin in der Waffe (soldier.load, W1 3.1); fehlt der Bestand, startet die Waffe leer
      const wid = WEAPONS[s.weapon] ? s.weapon : 'rifle', W0 = WEAPONS[wid];
      let load = null;
      if (W0.mag) {
        const lid = s.load && ammoFits(wid, s.load) ? s.load : defaultLoad(wid);
        const li = ITEMS[lid];
        if (li && (li.free || Game.cheats.allGear)) load = { id: lid, rounds: W0.mag };
        else if (li && (stockLeft[lid] || 0) > 0) { stockLeft[lid]--; load = { id: lid, rounds: W0.mag }; }
        else { load = { id: lid, rounds: 0, none: true }; this.beltShort.push(`${li?.short || 'Munition'} (Waffe leer)`); }
      }
      // Gürtel bestücken: jeder Gegenstand braucht ein Stück im Lager (Cheat „alle Ausrüstung“: unbegrenzt)
      const belt = [];
      for (let k = 0; k < BELT_SLOTS; k++) {
        const id = Array.isArray(s.items) ? s.items[k] : null;
        const it = id && ITEMS[id];
        if (!it) { belt.push(null); continue; }
        if (it.kind === 'ammo' && !ammoFits(wid, id)) { belt.push(null); continue; } // passt nicht zur Waffe: bleibt im Lager
        if (!Game.cheats.allGear && !it.free) {
          if ((stockLeft[id] || 0) <= 0) { belt.push(null); this.beltShort.push(it.short); continue; }
          stockLeft[id]--;
        }
        belt.push(it.kind === 'ammo' ? { id, uses: 1, rounds: null } : { id, uses: it.uses || 1 });
      }
      const u = this.addUnit({
        team: 'player', name: s.name, soldier: s, x: sp.x, y: sp.y, hp: s.hp + arm.hp, tu: s.tu, acc: s.acc, react: s.react, armor: arm.armor, weapon: wid,
        belt, load, healed: 0, captures: 0, stun: 0, obj: makeSoldier(s, arm.color, gunFx(W0)), sight: m.night ? 12 : 20, rank: s.rank,
      });
      u.obj.rotation.y = Math.PI;
    });
    // Aliens
    const site = this.opts.site;
    const monthIdx = Game.c.lastMonth || 0;
    const { roster, n } = alienCount(site, monthIdx); // E11 (Terror früh: 1 Bestie), E15 (Hive-Besatzung schrumpft mit site.hiveKilled)
    const inUfo = m.alienSpawns.filter((s) => s.inUfo), outUfo = m.alienSpawns.filter((s) => !s.inUfo);
    const used = new Set();
    if (site.kind === 'hive' && m.boss) { this.addAlien('hive', m.boss.x, m.boss.y, true); used.add(m.boss.y * m.W + m.boss.x); }
    const pick = (list) => { for (const s of list) { const k = s.y * m.W + s.x; if (!used.has(k) && !m.at(s.x, s.y).wall) { used.add(k); return s; } } return null; };
    for (let i = 0; i < n; i++) {
      const type = choice(roster);
      const sp = (m.ufo && rand() < (m.alienSpawnMix || 0.6) ? pick(inUfo) : pick(outUfo)) || pick(m.alienSpawns) || pick(inUfo);
      if (!sp) break;
      this.addAlien(type, sp.x, sp.y, !!sp.inUfo);
    }
    // Zivilisten
    if (site.kind === 'terror') {
      for (let i = 0; i < 8; i++) {
        const sp = pick(shuffle(m.civSpawns.slice())); if (!sp) break;
        this.spawnCivilian(sp.x, sp.y);
      }
    }
  }
  spawnCivilian(x, y) {
    const u = this.addUnit({ team: 'civ', name: 'Zivilist', x, y, hp: 20, tu: 50, acc: 0, react: 0, armor: 0, weapon: null, obj: makeCivilian(), sight: 12, figSeed: (rand() * 1e9) >>> 0 });
    if (this.figures?.state === 'ready') this.upgradeUnit(u);
    else if (this.figures?.queue) this.figures.queue.push(u);
    return u;
  }

  // ======================= G6: Figuren =======================
  initFigures() {
    const F = this.figures;
    if (!this.realModels) return;
    F.queue = this.units.filter((u) => u.team === 'player' || u.team === 'civ');
    this.figLoad.then(() => {
      if (this.disposed) return;
      F.state = 'upgrading';
      F.t0 = performance.now();
    }).catch((e) => {
      console.warn('AEGIS: Figuren nicht ladbar – einfache Figuren', e?.message || e);
      F.state = 'fallback'; F.queue = [];
    });
  }
  // Pro Bild einige Einheiten auf echte Figuren umstellen (verteilt die Erzeugungskosten)
  stepFigureUpgrade() {
    const F = this.figures; if (F.state !== 'upgrading') return;
    const t0 = performance.now();
    while (F.queue.length && performance.now() - t0 < 40) this.upgradeUnit(F.queue.shift());
    if (!F.queue.length) {
      F.state = 'ready'; F.ms = Math.round(performance.now() - F.t0);
      if (this.csm) this.csm.setupAll(this.scene);
      this.engine.resetHistory?.();
    }
  }
  makeFigure(u) {
    const q = this.figures.quality;
    let opts;
    if (u.team === 'player') {
      const s = u.soldier || {}, h = hashStr(s.id || s.name || u.name);
      const sex = s.sex === 'f' || s.look?.sex === 'f' ? 'f' : s.sex === 'm' || s.look?.sex === 'm' ? 'm' : (h % 100) < 30 ? 'f' : 'm';
      const bases = FIG_SOLDIER[sex], armorId = ARMORS[s.armor] ? s.armor : 'none';
      const w = WEAPONS[u.weapon] || {};
      opts = {
        base: bases[(h >>> 8) % bases.length], role: 'soldier', seed: h, quality: q,
        armor: { type: armorId, color: ARMORS[armorId].color }, weapon: w.hands === 1 ? 'pistol' : 'rifle',
        weaponColor: w.fx === 'plasma' ? 0x24302a : w.fx === 'laser' ? 0x30323c : undefined,
      };
    } else {
      const h = u.figSeed ?? ((rand() * 1e9) >>> 0);
      opts = { base: FIG_CIV[h % FIG_CIV.length], role: 'civilian', seed: h, quality: q, weapon: null };
    }
    const ch = makeCharacter(opts);
    ch.root.traverse((o) => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => patchFog(mm)); });
    ch.setFrustumCulled(true);
    if (ch.weapon) ch.weapon.userData.muzzle = ch.muzzle;
    return ch;
  }
  upgradeUnit(u) {
    if (!u || u.obj?.userData.char || !u.alive || u.ko || u.dying || this.disposed) return;
    let ch;
    try { ch = this.makeFigure(u); } catch (e) { console.warn('AEGIS: Figur fehlgeschlagen – einfache Figur', e); return; }
    const old = u.obj, root = new THREE.Group();
    root.name = 'unit:' + u.team; root.add(ch.root);
    root.position.copy(old.position); root.rotation.copy(old.rotation); root.visible = old.visible;
    root.userData = { char: ch, gun: ch.weapon, kind: u.team === 'player' ? 'soldier' : 'civ', real: true };
    this.scene.remove(old);
    old.traverse((o) => { o.geometry?.dispose(); if (u.team === 'civ' && o.material && !o.material.userData?.shared) o.material.dispose(); });
    this.scene.add(root);
    u.obj = root;
    this.csm?.setupAll(root);
    ch.setState(u.kneel ? 'kneel' : 'idle', { fade: 0.0001, force: true });
    ch.update(0.016, () => 0);
  }
  // Zustand der Figur aus dem Spielzustand ableiten und animieren
  updateFigure(u, dt) {
    const ch = u.obj.userData.char;
    // Detailstufe nach Kameraabstand (Handy immer vereinfacht), mit Hysterese
    if (u.obj.visible) { const d = this.camera.position.distanceTo(u.obj.position); ch.setLod(this.engine.mobile || d > (ch.lod ? 19 : 21) ? 1 : 0); }
    if (u.figSettled) return; // liegende Leiche/Bewusstlose: Pose eingefroren
    if (!u.obj.visible && u.alive) return;
    if (u.alive) {
      if (u.figHold > 0) u.figHold -= dt;
      const busyClip = ['hit', 'shoot', 'kneelShoot', 'reload'].includes(ch.state);
      if (!busyClip && !(u.figHold > 0)) {
        let want, speed = 0;
        if (u.anim.walk > 0) { speed = u.anim.speed || 4; want = speed > 3.2 ? 'run' : 'walk'; }
        else if (u.kneel) want = 'kneel';
        else if (u.team === 'civ' && this.civScared(u)) want = 'crouch';
        else want = 'idle';
        if (want !== ch.state) ch.setState(want, { speedMps: speed });
        else if (speed && Math.abs(ch.speedMps - speed) > 0.3) ch.setSpeed(speed);
      }
    } else if (u.figDeadT != null) {
      u.figDeadT += dt;
      if (ch.state === 'dead' || u.figDeadT > 3.2) { ch.update(dt, null); this.settleFigure(u); return; }
    }
    ch.update(dt, this._flat || (this._flat = () => 0));
  }
  civScared(u) {
    return this.units.some((a) => a.team === 'alien' && a.alive && Math.abs(a.x - u.x) + Math.abs(a.y - u.y) < 14 && this.isVisibleAlien(a));
  }
  // Präzise Hülle der aktuellen (gehäuteten) Pose
  figureBox(root) {
    const box = (this._fbb ||= new THREE.Box3()).makeEmpty(), tmp = (this._fbt ||= new THREE.Box3());
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || !o.visible || o.material?.transparent) return;
      if (o.isSkinnedMesh) { o.skeleton.update(); o.computeBoundingBox(); tmp.copy(o.boundingBox).applyMatrix4(o.matrixWorld); }
      else { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); }
      box.union(tmp);
    });
    return box;
  }
  // Leiche/Bewusstlose: liegt mittig auf dem Feld, tiefster Punkt knapp über dem Boden (T8), Pose eingefroren
  settleFigure(u) {
    const cp = this.cellPos(u.x, u.y), obj = u.obj;
    const bb = this.figureBox(obj);
    if (!bb.isEmpty()) {
      obj.position.x += cp.x - (bb.min.x + bb.max.x) / 2;
      obj.position.z += cp.z - (bb.min.z + bb.max.z) / 2;
      obj.position.y += 0.03 - bb.min.y;
    }
    u.figSettled = true; u.figDeadT = null;
    // Kugel für Frustum-Culling an die liegende Pose anpassen
    obj.traverse((o) => { if (o.isSkinnedMesh) { o.computeBoundingSphere(); o.boundingSphere.radius *= 1.3; } });
    u.dying = false;
    if (u.figOnSettle) { const f = u.figOnSettle; u.figOnSettle = null; f(); }
  }
  figAim(u, t) {
    const ch = u.obj.userData.char; if (!ch || !u.alive) return;
    const d = Math.hypot(t.x - u.x, t.y - u.y) * TILE || 1;
    const th = t.ground ? 0.1 : t.kneel ? 0.9 : 1.2;
    ch.setAimPitch(Math.atan2(th - (u.kneel ? 1.0 : 1.4), d));
    ch.setState(u.kneel ? 'kneelAim' : 'aim');
    u.figHold = 30;
  }
  figShot(u) { const ch = u.obj.userData.char; if (ch && u.alive) ch.setState(u.kneel ? 'kneelShoot' : 'shoot', { force: true }); }
  figDone(u) { if (u.obj?.userData.char) u.figHold = 0.6; }

  addAlien(type, x, y, guard) {
    const a = ALIENS[type];
    const scale = a.boss ? 1 : 1 + Math.min(0.5, (Game.c.lastMonth || 0) * 0.06);
    return this.addUnit({
      team: 'alien', name: a.name, spec: type, x, y, hp: Math.round(a.hp * scale), tu: a.tu, acc: a.acc, react: a.react, armor: a.armor, weapon: a.weapon,
      grenades: type === 'krull' || type === 'vael_s' ? (rand() < 0.4 ? 1 : 0) : 0, grenadeKind: 'alien', obj: makeAlien(a.model), sight: this.map.night ? Math.round(a.sight * 0.65) : a.sight, flying: !!a.flying, guard, boss: !!a.boss,
    });
  }

  addUnit(o) {
    const u = { id: this.units.length, alive: true, kneel: false, kills: 0, captures: 0, stun: 0, ko: false, dmgTaken: 0, maxHp: o.hp, maxTu: o.tu, ...o };
    u.tu = u.maxTu;
    const p = this.cellPos(u.x, u.y);
    u.obj.position.set(p.x, 0, p.z);
    u.obj.rotation.y = rand() * Math.PI * 2;
    if (!u.obj.userData.char) u.obj.traverse((c) => { if (c.isMesh) { c.castShadow = true; } });
    u.anim = { walk: 0, t: rand() * 10, speed: 0 };
    this.scene.add(u.obj);
    this.occ[u.y * this.W + u.x] = u.id;
    this.units.push(u);
    return u;
  }

  // ======================= Raster-Helfer =======================
  cellPos(x, y) { return { x: (x - this.W / 2 + 0.5) * TILE, z: (y - this.H / 2 + 0.5) * TILE }; }
  posCell(px, pz) { return { x: Math.floor(px / TILE + this.W / 2), y: Math.floor(pz / TILE + this.H / 2) }; }
  inb(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  wallAt(x, y) { return this.map.at(x, y)?.wall; }
  blocksMove(x, y, u) {
    const w = this.wallAt(x, y);
    if (w) { const d = WALLS[w.type]; if (d.move && !(u?.flying && !d.full)) return true; }
    return false;
  }
  blocksSight(x, y) {
    // Rauch blockiert die Sicht (nicht die Bewegung) – für alle Parteien
    if (x >= 0 && y >= 0 && x < this.W && y < this.H && this.smokeCells[y * this.W + x]) return true;
    const w = this.wallAt(x, y); return !!(w && WALLS[w.type].full);
  }
  inSmoke(x, y) { return !!(this.inb(x, y) && this.smokeCells[y * this.W + x]); }
  litByFlare(x, y) { return this.flares.some((f) => f.turns > 0 && Math.hypot(f.x - x, f.y - y) <= f.r); }
  unitAt(x, y) { const i = this.occ[y * this.W + x]; return i >= 0 ? this.units[i] : null; }
  // bewusstlose Einheit auf einem Feld (gibt ihr Feld frei, liegt aber noch dort)
  koAt(x, y) { return this.units.find((u) => u.ko && u.x === x && u.y === y) || null; }
  // alle betroffenen Einheiten eines Felds: lebend (occ) und bewusstlos (u.ko)
  unitsInCell(x, y) { const r = []; const a = this.unitAt(x, y); if (a) r.push(a); for (const u of this.units) if (u.ko && u.x === x && u.y === y && u !== a) r.push(u); return r; }
  mineAt(x, y) { return this.mines.find((m) => m.x === x && m.y === y) || null; }
  burning(x, y) { return !!(this.inb(x, y) && this.fireCells[y * this.W + x]); }
  // Waffe mit Überschreibungen der geladenen Munition (W1 4.0)
  weaponOf(u) { return effWeapon(u.weapon, u.load?.id) || WEAPONS[u.weapon]; }
  needsReload(u) { const w = WEAPONS[u?.weapon]; return !!(u && u.team === 'player' && w?.mag && !(u.load?.rounds > 0)); }
  dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  los(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2.5);
    let px = x0, py = y0;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const cx = Math.round(x0 + dx * t), cy = Math.round(y0 + dy * t);
      // diagonaler Übergang zwischen zwei sich berührenden Wänden blockiert die Sicht
      if (cx !== px && cy !== py && this.blocksSight(px, cy) && this.blocksSight(cx, py)) return false;
      px = cx; py = cy;
      if ((cx === x1 && cy === y1) || (cx === x0 && cy === y0)) continue;
      if (this.blocksSight(cx, cy)) return false;
    }
    return true;
  }
  canSee(u, x, y) {
    let range = u.sight;
    if (u.team === 'player' && this.map.night) {
      // beleuchtete Bereiche sind auch nachts weiter sichtbar
      if (this.map.lights.some((l) => Math.hypot(l.x - x, l.y - y) < 4)) range = 20;
      const t = this.unitAt(x, y); if (t && t.team === 'alien' && t.revealed) range = 20;
    }
    // Leuchtfackeln heben die Nacht-Sichtbeschränkung im Radius auf (wirkt für beide Seiten)
    if (this.map.night && range < 20 && this.flares.length && this.litByFlare(x, y)) range = 20;
    if (Math.hypot(u.x - x, u.y - y) > range) return false;
    return this.los(u.x, u.y, x, y);
  }

  dijkstra(u, maxCost = Infinity, ignoreUnits = false) {
    const N = this.N, W = this.W;
    const dist = new Float32Array(N).fill(Infinity); // echte ZE-Kosten entlang des gewählten Wegs
    const score = new Float32Array(N).fill(Infinity); // ZE + Strafkosten (Feuer) für die Wegwahl
    const prev = new Int32Array(N).fill(-1);
    const s = u.y * W + u.x;
    dist[s] = 0; score[s] = 0;
    const stand = u.kneel ? STAND_TU : 0; // kniender Soldat zahlt vor dem ersten Schritt das Aufstehen
    const h = new Heap(); h.push(s, 0);
    while (h.size) {
      const [d, i] = h.pop();
      if (d > score[i]) continue;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!this.inb(nx, ny)) continue;
        if (this.blocksMove(nx, ny, u)) continue;
        if (dx && dy && (this.blocksMove(x + dx, y, u) || this.blocksMove(x, y + dy, u))) continue;
        const j = ny * W + nx;
        if (!ignoreUnits && this.occ[j] >= 0 && this.occ[j] !== u.id && this.knownBlocker(u, this.units[this.occ[j]])) continue;
        const nt = dist[i] + (dx && dy ? 6 : 4) + (i === s ? stand : 0);
        const nd = d + (nt - dist[i]) + (this.fireCells[j] ? 12 : 0); // Feuer meiden (alle Parteien), zählt nicht als ZE
        if (nt > maxCost || nd >= score[j]) continue;
        dist[j] = nt; score[j] = nd; prev[j] = i; h.push(j, nd);
      }
    }
    return { dist, prev };
  }
  // Für die Wegplanung des Spielers zählen nur Einheiten, die er sehen kann
  knownBlocker(u, o) {
    if (u.team !== 'player') return true;
    if (o.team === 'player') return true;
    if (o.team === 'alien') return this.isVisibleAlien(o);
    return !!this.vis[o.y * this.W + o.x];
  }
  buildPath(prev, tx, ty) {
    const path = []; let i = ty * this.W + tx;
    while (prev[i] >= 0) { path.push({ x: i % this.W, y: (i / this.W) | 0 }); i = prev[i]; }
    return path.reverse();
  }

  // ======================= Sichtbarkeit =======================
  updateVisibility(initial = false) {
    const W = this.W;
    const before = new Set(this.units.filter((u) => u.team === 'alien' && u.alive && this.isVisibleAlien(u)).map((u) => u.id));
    this.vis.fill(0);
    const reveal = Game.cheats.revealMap;
    for (const u of this.units) {
      if (!u.alive || u.team !== 'player' || u.evac) continue;
      const r = Math.ceil(u.sight >= 20 ? 20 : 20);
      for (let y = Math.max(0, u.y - r); y <= Math.min(this.H - 1, u.y + r); y++) for (let x = Math.max(0, u.x - r); x <= Math.min(W - 1, u.x + r); x++) {
        const i = y * W + x;
        if (this.vis[i]) continue;
        if (this.canSee(u, x, y)) this.vis[i] = 1;
      }
      this.vis[u.y * W + u.x] = 1;
    }
    if (reveal) this.vis.fill(1);
    let changed = false;
    for (let i = 0; i < this.N; i++) {
      if (this.vis[i] && !this.explored[i]) {
        this.explored[i] = 1; changed = true;
        const c = this.map.cells[i];
        if (c.wall && c.wall.idx != null) this.props[c.wall.type].show(c.wall.idx, true);
        // angrenzende Wände mit aufdecken, damit Gebäudekanten sichtbar sind
      }
    }
    // Wände direkt neben sichtbaren Feldern aufdecken (man sieht die Wandfläche)
    for (let i = 0; i < this.N; i++) {
      if (!this.vis[i]) continue;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy; if (!this.inb(nx, ny)) continue;
        const j = ny * W + nx; const c = this.map.cells[j];
        if (!this.explored[j] && c.wall) { this.explored[j] = 1; if (c.wall.idx != null) this.props[c.wall.type].show(c.wall.idx, true); }
      }
    }
    if (this.ufoRim && !this.ufoRim[0].visible) {
      const u = this.map.ufo;
      if (this.explored[u.cy * W + u.cx] || [[u.r, 0], [-u.r, 0], [0, u.r], [0, -u.r]].some(([dx, dy]) => this.explored[(u.cy + dy) * W + u.cx + dx])) this.ufoRim.forEach((o) => (o.visible = true));
    }
    // Aliens ein-/ausblenden
    const spotted = [];
    for (const u of this.units) {
      if (!u.alive) { if (!u.dying) this.refreshCorpseVis(u); continue; }
      if (u.team === 'alien') {
        const v = this.isVisibleAlien(u);
        u.obj.visible = v || u.dying;
        if (v && !before.has(u.id) && !initial) spotted.push(u);
      } else if (u.team === 'civ') u.obj.visible = !!this.vis[u.y * W + u.x];
    }
    this.updateAlienBadges();
    return spotted;
  }
  isVisibleAlien(u) { return !!(this.vis[u.y * this.W + u.x] || u.revealed || Game.cheats.revealMap); }

  updateFog(dt) {
    const night = this.map.night;
    let dirty = false;
    for (let i = 0; i < this.N; i++) {
      const target = this.vis[i] ? 1 : this.explored[i] ? (night ? 0.42 : 0.55) : 0.05;
      const c = this.fogCur[i];
      if (Math.abs(c - target) > 0.004) { this.fogCur[i] = c + (target - c) * Math.min(1, dt * 6); dirty = true; }
      const b = Math.round(this.fogCur[i] * 255);
      if (b !== this.fogData[i]) { this.fogData[i] = b; dirty = true; }
    }
    if (dirty) this.fogTex.needsUpdate = true;
  }

  // ======================= Kampfregeln =======================
  modeCost(u, mode) {
    if (mode === 'grenade') return Math.round(u.maxTu * 0.3);
    const w = WEAPONS[u.weapon]; const m = w?.[mode];
    if (!m) return Infinity;
    return Math.round(u.maxTu * m.tu);
  }
  itemCost(u, id) {
    const it = ITEMS[id];
    if (it?.kind === 'ammo') return Math.round(u.maxTu * (WEAPONS[u.weapon]?.reload ?? 0.15)); // Nachladen
    return Math.round(u.maxTu * (it?.tu ?? ITEM_TU[it?.kind] ?? 0.3));
  }
  reloadCost(u) { return Math.round(u.maxTu * (WEAPONS[u.weapon]?.reload ?? 0.15)); }
  beltEntry(u, slot = this.beltSlot) { const b = u?.belt?.[slot]; return b && ITEMS[b.id] ? b : null; }
  beltSlots(u) { const r = []; (u?.belt || []).forEach((b, k) => { if (b && ITEMS[b.id]) r.push(k); }); return r; }
  hasTu(u, cost) { return (u.team === 'player' && Game.cheats.infTU) || u.tu >= cost; }
  spendTu(u, cost) { if (!(u.team === 'player' && Game.cheats.infTU)) u.tu = Math.max(0, u.tu - cost); }

  coverBetween(shooter, t) {
    if (t.flying) return false;
    const dx = Math.sign(shooter.x - t.x), dy = Math.sign(shooter.y - t.y);
    const cands = [[t.x + dx, t.y + dy]];
    if (dx && dy) cands.push([t.x + dx, t.y], [t.x, t.y + dy]);
    else if (dx) cands.push([t.x + dx, t.y + 1], [t.x + dx, t.y - 1]);
    else cands.push([t.x + 1, t.y + dy], [t.x - 1, t.y + dy]);
    if (Math.hypot(shooter.x - t.x, shooter.y - t.y) < 1.6) return false;
    return cands.slice(0, dx && dy ? 3 : 1).some(([x, y]) => { const w = this.wallAt(x, y); return w && WALLS[w.type].cover === 1; });
  }

  hitChance(u, t, mode) {
    if (u.team === 'player' && Game.cheats.aimbot) return 1;
    const w = this.weaponOf(u); const m = w?.[mode]; if (!m) return 0;
    if (w.melee) return this.dist(u, t) < 1.6 ? clamp((u.acc / 100) * m.acc * (t.kneel ? 0.92 : 1), 0.05, 0.95) : 0;
    let c = (u.acc / 100) * m.acc;
    if (u.kneel) c *= 1.15;
    else if (w.heavy && mode === 'snap') c *= 0.85; // schwere Waffe aus dem Stand
    const d = this.dist(u, t);
    if (d > 10) c -= (d - 10) * 0.02;
    if (w.falloff) c -= Math.max(0, d - 3) * w.falloff;
    if (d > w.range) c *= 0.5;
    if (this.coverBetween(u, t)) c *= 0.7;
    if (t.kneel) c *= 0.92;
    if (this.inSmoke(t.x, t.y)) c *= 0.6; // Ziel im Rauch
    if (u.team === 'player' && t.team === 'alien') c += (Game.has('autopsy_vael') ? 0.05 : 0) + (Game.has('autopsy_krull') ? 0.05 : 0);
    return clamp(c, 0.05, 0.95);
  }

  // ======================= Aktionen =======================
  async moveUnit(u, path, opts = {}) {
    if (!path.length) return;
    if (u.kneel) {
      const first = path[0], c1 = first.x !== u.x && first.y !== u.y ? 6 : 4;
      if (!this.hasTu(u, STAND_TU + c1)) { if (u.team === 'player') { toast(`Aufstehen kostet ${STAND_TU} ZE – nicht genug ZE zum Aufstehen und Gehen.`, 'warn', 2200); sfx('deny'); } return; }
      this.spendTu(u, STAND_TU);
      u.kneel = false;
    }
    this.busy = true;
    if (u.team === 'player') this.refreshUi();
    const spd = this.engine.settings.animSpeed || 1;
    for (const step of path) {
      if (!u.alive || this.ended) break;
      const diag = step.x !== u.x && step.y !== u.y;
      const cost = diag ? 6 : 4;
      if (!this.hasTu(u, cost)) break;
      if (this.unitAt(step.x, step.y)) { if (u.team === 'player') toast('Weg blockiert – unbekannter Kontakt!', 'warn', 1800); this.updateVisibility(); break; }
      this.spendTu(u, cost);
      this.occ[u.y * this.W + u.x] = -1;
      const from = this.cellPos(u.x, u.y), to = this.cellPos(step.x, step.y);
      u.obj.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
      u.x = step.x; u.y = step.y;
      this.occ[u.y * this.W + u.x] = u.id;
      u.movedTurn = this.turn; // Bewegungsscanner
      const visible = u.team === 'player' || this.isVisibleAlien(u) || (u.team === 'civ' && this.vis[u.y * this.W + u.x]);
      const real = !!u.obj.userData.char;
      const dur = (visible ? (real ? FIG_STEP : 0.24) : 0.02) / spd;
      u.anim.speed = (diag ? TILE * 1.414 : TILE) / Math.max(dur, 1e-3);
      if (visible && u.team !== 'civ') { this.camT.x = to.x; this.camT.z = to.z; }
      let t = 0;
      while (t < dur) {
        const dt = await this.frame();
        t += dt;
        const k = Math.min(1, t / dur);
        u.obj.position.x = lerp(from.x, to.x, k); u.obj.position.z = lerp(from.z, to.z, k);
        u.anim.walk += dt * 11 * spd;
      }
      u.obj.position.x = to.x; u.obj.position.z = to.z;
      if (visible) sfx('step');
      // brennendes Feld betreten: Brandschaden (einmal pro Schritt)
      if (this.fireCells[u.y * this.W + u.x]) { this.damage(u, BURN_DMG, null, { dtype: 'fire' }); if (!u.alive || this.ended) break; }
      // Sensormine (Freund-Feind-Kennung: nur Aliens lösen aus) – VOR jedem Reaktionsfeuer
      if (u.team === 'alien' && this.mines.length) {
        const mn = this.mines.find((q) => Math.hypot(q.x - u.x, q.y - u.y) <= (ITEMS[q.id].trigger || 1.5) && this.los(q.x, q.y, u.x, u.y));
        if (mn) {
          this.removeMine(mn);
          if (!u.obj.visible) { u.revealed = true; u.obj.visible = true; this.updateAlienBadges(); }
          this.camT.x = to.x; this.camT.z = to.z;
          toast('◎ Sensormine ausgelöst!', 'good', 1600);
          await this.explode(mn.x, mn.y, ITEMS[mn.id].dmg, ITEMS[mn.id].radius, mn.owner);
          if (!u.alive || this.ended) break;
        }
      }
      if (u.team === 'player') {
        const spotted = this.updateVisibility();
        if (spotted.length && !opts.noStop) {
          this.camT.x = spotted[0].obj.position.x; this.camT.z = spotted[0].obj.position.z;
          toast(`⚠ Feind gesichtet: ${spotted.map((s) => s.name).join(', ')}`, 'bad', 2200);
          sfx('alert');
          await this.reactionFire(u);
          break;
        }
      } else if (u.team === 'alien') {
        const wasVis = u.obj.visible;
        u.obj.visible = this.isVisibleAlien(u);
        if (u.obj.visible && !wasVis) { this.camT.x = to.x; this.camT.z = to.z; this.updateAlienBadges(); }
      }
      if (u.team !== 'civ') await this.reactionFire(u);
    }
    u.anim.walk = 0;
    this.busy = !!this.ended;
    if (u.team === 'player' && !this.ended) { this.updateVisibility(); this.refreshUi(); }
  }

  async reactionFire(mover) {
    if (!mover.alive) return;
    const enemies = this.units.filter((o) => o.alive && !o.evac && o.team !== mover.team && o.team !== 'civ' && o.weapon);
    shuffle(enemies);
    for (const o of enemies) {
      if (!mover.alive) return;
      if (o.team === 'alien' && mover.team === 'player' && Game.cheats.noReaction) continue;
      if (o.team === 'player' && !this.isVisibleAlien(mover)) continue;
      const w = this.weaponOf(o);
      if (w.noReact || w.radius || w.snap?.guided) continue;                     // Werfer, Explosiv-/Brand-/Schockmunition: nie Reaktionsfeuer
      if (o.team === 'player' && w.mag && !(o.load?.rounds > 0)) continue;       // leeres Magazin
      const cost = this.modeCost(o, 'snap');
      if (!this.hasTu(o, cost)) continue;
      if (w.melee && this.dist(o, mover) > 1.6) continue;
      if (!this.canSee(o, mover.x, mover.y)) continue;
      let chance = (o.react / 100) * (o.tu / o.maxTu) * 0.30;
      chance *= (w.hands === 1 ? 1.25 : 1) * (w.heavy ? 0.7 : 1);              // einhändig / schwer
      if (rand() < chance) {
        if (o.team === 'player') toast(`${o.name}: Reaktionsfeuer!`, 'good', 1500);
        else toast(`${o.name} eröffnet Reaktionsfeuer!`, 'bad', 1500);
        await this.fire(o, mover, 'snap', true);
        break;
      }
    }
  }

  frame() { return new Promise((r) => { this._frameWaiters.push(r); }); }

  faceTo(u, x, y) { const a = this.cellPos(u.x, u.y), b = this.cellPos(x, y); u.obj.rotation.y = Math.atan2(b.x - a.x, b.z - a.z); }

  muzzleWorld(u) {
    const m = u.obj.userData.gun?.userData.muzzle;
    const v = new THREE.Vector3();
    if (m) { u.obj.updateMatrixWorld(true); m.getWorldPosition(v); } else { v.copy(u.obj.position); v.y = 1.3; }
    return v;
  }
  bodyPoint(u) { return new THREE.Vector3(u.obj.position.x, u.kneel ? 0.9 : u.obj.userData.hover ? 1.5 : 1.2, u.obj.position.z); }

  async fire(u, t, mode, reaction = false) {
    const w = this.weaponOf(u);
    const m = w[mode];
    if (!m || m.guided) return false;
    const cost = this.modeCost(u, mode);
    if (this.ended || !u.alive) return false;
    if (this.needsReload(u)) { if (u.team === 'player' && !reaction) { toast('Magazin leer – nachladen (N)', 'warn'); sfx('deny'); } return false; }
    if (!this.hasTu(u, cost)) { if (u.team === 'player') { toast('Nicht genügend Zeiteinheiten.', 'warn'); sfx('deny'); } return false; }
    const wasBusy = this.busy; this.busy = true;
    this.spendTu(u, cost);
    this.faceTo(u, t.x, t.y);
    this.figAim(u, t);
    const showShot = u.team === 'player' || t.team === 'player' || (u.team === 'alien' && this.isVisibleAlien(u)) || !!this.vis[t.y * this.W + t.x];
    if (u.team === 'alien' && showShot) { u.revealed = true; u.obj.visible = true; this.updateAlienBadges(); }
    if (showShot) { this.camT.x = (u.obj.position.x + t.obj.position.x) / 2; this.camT.z = (u.obj.position.z + t.obj.position.z) / 2; await sleep(160 / (this.engine.settings.animSpeed || 1)); }
    const ammo = u.team === 'player' && w.mag ? u.load : null;
    const shots = ammo ? Math.min(m.shots || 1, ammo.rounds) : m.shots || 1;
    for (let s = 0; s < shots; s++) {
      if (!u.alive || this.ended) break;
      if (ammo) ammo.rounds = Math.max(0, ammo.rounds - 1);
      const chance = this.hitChance(u, t, mode);
      const hit = t.alive && rand() < chance;
      this.figShot(u);
      await this.shoot(u, t, hit, w, showShot);
      if (s < shots - 1) await sleep(90);
    }
    this.figDone(u);
    this.busy = this.ended ? true : wasBusy;
    if (u.team === 'player' && !this.ended) this.refreshUi();
    return true;
  }

  async shoot(u, t, hit, w, show) {
    const from = this.muzzleWorld(u);
    let to, impact = null;
    if (w.melee) {
      sfx('melee');
      if (u.obj.userData.body) { u.obj.userData.body.position.z = 0.4; setTimeout(() => { if (u.obj.userData.body) u.obj.userData.body.position.z = 0; }, 200); }
      else this.figShot(u);
      await sleep(150);
      if (hit) this.damage(t, w.dmg, u, { dtype: w.dtype }); else this.floatAt(t, 'Verfehlt', '#aaa');
      return;
    }
    if (hit) to = t.ground ? (() => { const gp = this.cellPos(t.x, t.y); return new THREE.Vector3(gp.x, 0.1, gp.z); })() : this.bodyPoint(t).add(new THREE.Vector3(randRange(-0.15, 0.15), randRange(-0.2, 0.2), randRange(-0.15, 0.15)));
    else {
      // Fehlschuss: abweichende Flugbahn verfolgen
      const dx = t.x - u.x, dy = t.y - u.y, len = Math.hypot(dx, dy) || 1;
      const ang = Math.atan2(dy, dx) + randRange(-0.12, 0.12) * (1 + 3 / len);
      const range = Math.max(len + 6, 14);
      let end = null;
      const steps = Math.ceil(range * 4);
      for (let i = 2; i <= steps; i++) {
        const fx = u.x + Math.cos(ang) * (i / 4), fy = u.y + Math.sin(ang) * (i / 4);
        const cx = Math.round(fx), cy = Math.round(fy);
        if (!this.inb(cx, cy)) { end = { fx, fy, ground: true }; break; }
        if (cx === u.x && cy === u.y) continue;
        const wl = this.wallAt(cx, cy);
        if (wl && (WALLS[wl.type].full || (WALLS[wl.type].cover && (Math.hypot(cx - t.x, cy - t.y) < 1.6 || rand() < 0.3)))) { end = { fx, fy, wall: { x: cx, y: cy } }; break; }
        const other = this.unitAt(cx, cy);
        if (other && other !== u && other !== t && other.alive && rand() < 0.4) { end = { fx, fy, unit: other }; break; }
      }
      if (!end) end = { fx: u.x + Math.cos(ang) * range, fy: u.y + Math.sin(ang) * range, ground: true };
      const p = this.cellPos(0, 0);
      to = new THREE.Vector3(p.x + end.fx * TILE, end.unit ? 1.1 : end.wall ? randRange(0.6, 1.8) : 0.05, p.z + end.fy * TILE);
      impact = end;
    }
    // Explosiv-, Brand- oder Schockgeschoss: auch ein Fehlschuss detoniert am Aufschlagpunkt (W1 4.3)
    if (w.radius) {
      let c;
      if (hit) c = { x: t.x, y: t.y };
      else if (impact?.wall) c = { ...impact.wall };
      else if (impact?.unit) c = { x: impact.unit.x, y: impact.unit.y };
      else c = { x: clamp(Math.round(impact.fy !== undefined ? impact.fx : t.x), 0, this.W - 1), y: clamp(Math.round(impact.fy ?? t.y), 0, this.H - 1) };
      if (!hit && show && t.team) this.floatAt(t, 'Verfehlt', '#9aa');
      await this.projectile(from, to, w.fx, show);
      await this.explode(c.x, c.y, w.dmg, w.radius, u, { dtype: w.dtype, burn: w.burn || 0 });
      return;
    }
    await this.projectile(from, to, w.fx, show);
    const opts = { dtype: w.dtype, pierce: w.pierce };
    if (hit) this.damage(t, w.dmg, u, opts);
    else {
      if (show && t.team) this.floatAt(t, 'Verfehlt', '#9aa');
      if (impact?.wall) this.damageWall(impact.wall.x, impact.wall.y, w.dmg * randRange(0.5, 1.5));
      if (impact?.unit) this.damage(impact.unit, w.dmg, u, opts);
      if (this.losDirty) { this.losDirty = false; this.updateVisibility(); }
      this.spark(to, FX_COLORS[w.fx], 10);
      await this.flushBlasts();
    }
  }

  async projectile(from, to, fx, show) {
    const spd = this.engine.settings.animSpeed || 1;
    if (!show) return;
    sfx(fx === 'rocket' ? 'launch' : fx === 'stun' ? 'plasma' : fx);
    this.flash(from, FX_COLORS[fx] ?? 0xffffff, 8);
    const col = new THREE.Color(FX_COLORS[fx] ?? 0xffffff).multiplyScalar(fx === 'bullet' ? 3 : 5);
    const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(this.tracerGeo, mat);
    const len = from.distanceTo(to);
    mesh.position.copy(from); mesh.lookAt(to);
    this.scene.add(mesh);
    if (fx === 'laser' || fx === 'beam') {
      mesh.scale.set(fx === 'beam' ? 2.5 : 1.6, fx === 'beam' ? 2.5 : 1.6, len);
      let t = 0; while (t < 0.18 / spd) { const dt = await this.frame(); t += dt; mat.opacity = 1 - t / (0.18 / spd); }
    } else {
      const glob = fx === 'plasma' || fx === 'stun';
      const speed = (fx === 'rocket' ? 30 : glob ? 40 : 110) * spd;
      const tl = fx === 'rocket' ? 0.9 : glob ? 1.6 : 2.4;
      const w = fx === 'rocket' ? 2.6 : glob ? 3.5 : 1;
      let d = 0;
      while (d < len) {
        const dt = await this.frame();
        d += speed * dt;
        const head = Math.min(d, len), tail = Math.max(0, head - tl);
        mesh.position.copy(from).lerp(to, tail / len);
        mesh.scale.set(w, w, Math.max(0.05, head - tail));
        if (glob) this.emit(mesh.position.clone(), col, 1, 0.25, 0.4);
        else if (fx === 'rocket') { this.emit(mesh.position.clone(), new THREE.Color(0.35, 0.34, 0.33), 0.2, 0.25, 1.1, false, true); this.emit(mesh.position.clone(), new THREE.Color(3, 1.5, 0.4), 0, 0.3, 0.25); }
      }
    }
    this.scene.remove(mesh); mat.dispose();
    this.flash(to, FX_COLORS[fx] ?? 0xffffff, 5);
  }

  // Schadensformel (P3) mit Schadensart: Resistenz je Alien, Panzerung ×0,3 bei Brand, ×0,5 bei Betäubung, pierce bei PB
  rollDamage(t, raw, opts = {}) {
    const dt = opts.dtype || 'proj';
    const res = t.team === 'alien' ? (ALIENS[t.spec]?.resist?.[dt] ?? 1) : 1;
    if (res === 0) return null;
    const armorEff = t.armor * (dt === 'fire' ? 0.3 : dt === 'stun' ? 0.5 : (opts.pierce ?? 1));
    const roll = raw * res * randRange(0.5, 1.5);
    return Math.max(Math.round(roll * 0.15), Math.round(roll - armorEff));
  }
  hurt(u, raw, src, opts) { if (u.alive) this.damage(u, raw, src, opts); else if (u.ko) this.hurtKo(u, raw, src, opts); }
  damage(t, raw, src, opts = {}) {
    if (!t.alive || this.disposed) return;
    let dmg = this.rollDamage(t, raw, opts);
    if (dmg === null) { this.floatAt(t, 'Immun', '#9ab'); return; }
    if (opts.dtype === 'stun') {
      if (src?.team === 'player' && Game.cheats.oneHit && t.team !== 'player') dmg = 9999;
      if (t.team === 'player' && Game.cheats.god) dmg = 0;
      t.stun = (t.stun || 0) + dmg;
      this.spark(this.bodyPoint(t), 0x60a0ff, 12); sfx('hit');
      this.floatAt(t, `⚡ ${Math.min(dmg, 999)}`, '#8fd0ff', dmg > 30);
      if (t.stun >= t.hp) this.knockOut(t, src);
      else if (t.team === 'player' && t === this.selected) this.refreshUi();
      return;
    }
    if (src?.team === 'player' && Game.cheats.oneHit && t.team !== 'player') dmg = 9999;
    if (t.team === 'player' && Game.cheats.god) dmg = 0;
    t.hp -= dmg; t.dmgTaken += dmg;
    this.spark(this.bodyPoint(t), opts.dtype === 'fire' ? 0xff8020 : t.team === 'alien' ? 0x80ff60 : 0xff3030, 14);
    sfx('hit');
    this.floatAt(t, dmg > 0 ? `${opts.dtype === 'fire' ? '🔥 ' : ''}−${dmg}` : 'Abgeprallt', dmg > 0 ? (t.team === 'player' ? '#ff5a5a' : '#ffe680') : '#9ab', dmg > 30);
    if (t.team === 'player' && dmg > 0) Input.rumble(0.8, 0.5, 220);
    if (t.team === 'player' && t === this.selected) this.refreshUi();
    if (t.hp <= 0) this.kill(t, src);
    else if (dmg > 0 && t.obj.userData.char && !(t.figHold > 0)) t.obj.userData.char.setState('hit', { force: true });
  }

  // Betäubung (W1 4.5): bewusstlos statt tot – liegt sichtbar, Feld wird frei, zählt für den Missionssieg
  knockOut(t, src) {
    t.alive = false; t.ko = true; t.koTurn = this.turn; t.kneel = false;
    if (this.occ[t.y * this.W + t.x] === t.id) this.occ[t.y * this.W + t.x] = -1;
    if (src && t.team === 'alien' && src.team === 'player') { src.captures = (src.captures || 0) + 1; t.koBy = src; }
    this.koEffects(t);
    this.floatAt(t, '⚡ BEWUSSTLOS', '#8fd0ff', true);
    if (t.team === 'player') toast(`⚡ ${t.name} ist bewusstlos.`, 'bad', 2600);
    else if (this.isVisibleAlien(t) || t.obj.visible) toast(`⚡ ${t.name} betäubt.`, 'good', 1800);
    if (this.target === t) this.target = null;
    this.updateAlienBadges(); this.checkEnd();
    if (t === this.selected && !this.ended) { this.selected = null; if (this.phase === 'player') this.cycleUnit(1); }
  }
  // Treffer auf Bewusstlose (nur Flächenwirkung: Explosion, Brand, Schock)
  hurtKo(t, raw, src, opts = {}) {
    if (!t.ko || this.disposed) return;
    let dmg = this.rollDamage(t, raw, opts); if (dmg === null) return;
    if (opts.dtype === 'stun') { t.stun += dmg; return; }
    if (t.team === 'player' && Game.cheats.god) dmg = 0;
    t.hp -= dmg; t.dmgTaken += dmg;
    if (dmg > 0) this.floatAt(t, `−${dmg}`, t.team === 'player' ? '#ff5a5a' : '#ffe680');
    if (t.hp <= 0) { t.ko = false; if (t.koBy) { t.koBy.captures = Math.max(0, t.koBy.captures - 1); t.koBy = null; } this.kill(t, src); }
  }
  koEffects(t) {
    if (t.obj.userData.char) return this.koFigure(t);
    const obj = t.obj, ud = obj.userData, cp = this.cellPos(t.x, t.y);
    obj.rotation.order = 'YXZ';
    t.koSave = { limbs: {}, by: ud.body?.position.y || 0 };
    for (const n of ['armL', 'armR', 'legL', 'legR']) if (ud[n]) t.koSave.limbs[n] = [ud[n].rotation.x, ud[n].rotation.z];
    this.spark(this.bodyPoint(t), 0x60a0ff, 16);
    // blauer Ring am Boden: „bewusstlos, nicht tot“
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.9, 2.4), transparent: true, opacity: 0.8, depthWrite: false }));
    ring.position.set(cp.x, 0.06, cp.z); this.scene.add(ring); t.koRing = ring;
    const side = rand() < 0.5 ? -1 : 1;
    const limbT = { armL: [-0.2, 0.6], armR: [0.2, -0.5], legL: [0.1, -0.2], legR: [-0.15, 0.25] };
    const from = {}; for (const n in t.koSave.limbs) from[n] = t.koSave.limbs[n];
    if (ud.body && !ud.hover) ud.body.position.y = 0;
    t.dying = true;
    let k = 0, ph = 0;
    this.fx.push((dt) => {
      if (this.disposed || !t.ko) return false;
      if (k < 1) {
        k = Math.min(1, k + dt / 0.8); const e = k * k;
        obj.rotation.z = side * Math.PI / 2 * e; obj.rotation.x = 0;
        for (const n in from) { ud[n].rotation.x = from[n][0] + (limbT[n][0] - from[n][0]) * e; ud[n].rotation.z = from[n][1] + (limbT[n][1] - from[n][1]) * e; }
        this.groundCorpse(obj, cp);
        if (k >= 1) { t.dying = false; this.refreshCorpseVis(t); }
      }
      ph += dt; ring.material.opacity = 0.45 + 0.35 * Math.sin(ph * 3);
      ring.visible = obj.visible;
      if (obj.visible && rand() < dt * 1.5) this.emit(obj.position.clone().setY(0.6), new THREE.Color(0.6, 1.2, 3), 0.4, 0.2, 0.6);
      return true;
    });
  }
  // G6: Bewusstlos (echte Figur): Sturz-Clip, liegen bleiben, blauer Ring
  koFigure(t) {
    const obj = t.obj, ch = obj.userData.char, cp = this.cellPos(t.x, t.y);
    this.spark(this.bodyPoint(t), 0x60a0ff, 16);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.9, 2.4), transparent: true, opacity: 0.8, depthWrite: false }));
    ring.position.set(cp.x, 0.06, cp.z); this.scene.add(ring); t.koRing = ring;
    t.dying = true; t.figSettled = false; t.figDeadT = 0; t.figHold = 0;
    ch.setFootIK(false); ch.setState('die', { force: true });
    t.figOnSettle = () => this.refreshCorpseVis(t);
    let ph = 0;
    this.fx.push((dt) => {
      if (this.disposed || !t.ko) return false;
      ph += dt; ring.material.opacity = 0.45 + 0.35 * Math.sin(ph * 3);
      ring.visible = obj.visible;
      if (obj.visible && rand() < dt * 1.5) this.emit(obj.position.clone().setY(0.4), new THREE.Color(0.6, 1.2, 3), 0.4, 0.2, 0.6);
      return true;
    });
  }
  // Aufwachen: Animation rückwärts, Feld wieder belegen
  standUp(u) {
    if (u.obj.userData.char) {
      const ch = u.obj.userData.char, cp = this.cellPos(u.x, u.y);
      if (u.koRing) { this.scene.remove(u.koRing); u.koRing.geometry.dispose(); u.koRing.material.dispose(); u.koRing = null; }
      u.figSettled = false; u.figDeadT = null; u.figOnSettle = null;
      u.obj.position.set(cp.x, 0, cp.z);
      u.obj.visible = u.team !== 'alien' || this.isVisibleAlien(u);
      ch.setFootIK(this.figures.quality !== 'low'); ch.setState('idle', { force: true, fade: 0.5 });
      return;
    }
    const obj = u.obj, ud = obj.userData, cp = this.cellPos(u.x, u.y);
    if (u.koRing) { this.scene.remove(u.koRing); u.koRing.geometry.dispose(); u.koRing.material.dispose(); u.koRing = null; }
    const z0 = obj.rotation.z, lim = u.koSave?.limbs || {};
    const cur = {}; for (const n in lim) if (ud[n]) cur[n] = [ud[n].rotation.x, ud[n].rotation.z];
    obj.visible = u.team !== 'alien' || this.isVisibleAlien(u);
    let k = 0;
    this.fx.push((dt) => {
      if (this.disposed) return false;
      k = Math.min(1, k + dt / 0.6); const e = 1 - (1 - k) * (1 - k);
      obj.rotation.z = z0 * (1 - e);
      for (const n in cur) { ud[n].rotation.x = cur[n][0] + (lim[n][0] - cur[n][0]) * e; ud[n].rotation.z = cur[n][1] + (lim[n][1] - cur[n][1]) * e; }
      obj.position.x = cp.x; obj.position.z = cp.z; obj.position.y = 0;
      return k < 1;
    });
  }
  wake(u, tu) {
    u.ko = false; u.alive = true; u.koTurn = null; u.dying = false; u.koBy = null;
    this.occ[u.y * this.W + u.x] = u.id;
    u.tu = tu;
    this.standUp(u);
    this.floatAt(u, 'erwacht', '#ffd080');
    if (u.team === 'player') toast(`${u.name} ist wieder bei Bewusstsein.`, 'good', 2200);
    this.updateAlienBadges();
  }

  kill(t, src) {
    t.alive = false; t.dying = true; t.ko = false;
    if (this.occ[t.y * this.W + t.x] === t.id) this.occ[t.y * this.W + t.x] = -1;
    if (t.koRing) { this.scene.remove(t.koRing); t.koRing.geometry.dispose(); t.koRing.material.dispose(); t.koRing = null; }
    if (src && src !== t && t.team === 'alien' && src.team === 'player') src.kills++;
    sfx(t.team === 'alien' ? 'alienDeath' : 'death');
    if (t.team === 'alien') {
      this.result.kills[t.spec] = (this.result.kills[t.spec] || 0) + 1;
      this.result.corpses.push({ type: t.spec, x: t.x, y: t.y }); // E6: Teilbeute beim Rückzug
      this.floatAt(t, '✖ ELIMINIERT', '#ffd080', true);
    } else if (t.team === 'player') {
      this.floatAt(t, '☠ GEFALLEN', '#ff7a7a', true);
      toast(`☠ ${t.name} ist gefallen.`, 'bad', 3500);
      Input.rumble(1, 1, 500);
    } else {
      this.result.civKilled++;
      this.floatAt(t, 'Zivilist getötet', '#ff9a6a', true);
    }
    this.deathEffects(t);
    if (this.target === t) { this.target = null; }
    this.updateAlienBadges();
    this.checkEnd();
    if (t === this.selected && !this.ended) { this.selected = null; if (this.phase === 'player') this.cycleUnit(1); }
  }

  // ======================= Tod & Leichen =======================
  // Leiche/Wrack bleibt sichtbar, sobald ihr Feld erkundet ist (auch im Nebel); Soldaten immer
  refreshCorpseVis(u) {
    if (!u.obj || u.alive) return;
    const i = u.y * this.W + u.x;
    const v = u.team === 'player' ? true : !!(this.explored[i] || this.vis[i] || Game.cheats.revealMap);
    u.obj.visible = v;
    if (u.deadGun) u.deadGun.visible = v;
  }
  // Materialien klonen, entsättigen/abdunkeln, Leuchtteile aus (Drohne: Teile merken für Flackern)
  deaden(root, keepGlow, list) {
    const hsl = { h: 0, s: 0, l: 0 };
    root.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material = o.material.clone();
      m.color.getHSL(hsl); m.color.setHSL(hsl.h, hsl.s * 0.3, hsl.l * 0.62);
      if (m.emissive && (m.emissive.getHex() !== 0 || m.emissiveMap)) {
        if (keepGlow) list.push({ m, i0: m.emissiveIntensity }); else m.emissiveIntensity = 0;
      }
    });
  }
  // Körper auf den Boden legen: Mitte über das Feld, tiefster Punkt knapp über y=0
  groundCorpse(obj, cp, minY = 0.04) {
    this._bb = this._bb || new THREE.Box3();
    obj.updateMatrixWorld(true); this._bb.setFromObject(obj);
    obj.position.x += cp.x - (this._bb.min.x + this._bb.max.x) / 2;
    obj.position.z += cp.z - (this._bb.min.z + this._bb.max.z) / 2;
    obj.position.y += minY - this._bb.min.y;
  }
  stain(x, y, css, r = 0.55, blobs = 7) {
    const c = this.groundCanvas.getContext('2d');
    const P = this.groundCanvas.width / this.W;
    c.fillStyle = css;
    for (let i = 0; i < blobs; i++) {
      const a = rand() * 6.283, d = rand() * P * r * 0.7, rr = P * r * (0.25 + rand() * 0.35);
      c.beginPath(); c.arc((x + 0.5) * P + Math.cos(a) * d, (y + 0.5) * P + Math.sin(a) * d, rr, 0, 7); c.fill();
    }
    this.groundTex.needsUpdate = true;
  }
  deadRing(x, y) {
    const c = this.groundCanvas.getContext('2d');
    const P = this.groundCanvas.width / this.W;
    c.strokeStyle = 'rgba(150,150,150,0.55)'; c.lineWidth = Math.max(1, P * 0.05);
    c.beginPath(); c.arc((x + 0.5) * P, (y + 0.5) * P, P * 0.46, 0, 7); c.stroke();
    this.groundTex.needsUpdate = true;
  }
  tossGun(t, cp) {
    const g = t.obj.userData.gun;
    if (!g || !g.children.some((c) => c.isMesh)) return;
    this.scene.attach(g);
    this.deaden(g, false);
    t.deadGun = g;
    const from = g.position.clone(), fq = g.quaternion.clone();
    const ang = rand() * 6.283, r = 0.75 + rand() * 0.35;
    const to = new THREE.Vector3(cp.x + Math.cos(ang) * r, 0, cp.z + Math.sin(ang) * r);
    const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand() * 6.283, (rand() - 0.5) * 0.3));
    let k = 0;
    this.fx.push((dt) => {
      k = Math.min(1, k + dt / 0.55);
      g.position.lerpVectors(from, to, k);
      g.position.y = from.y * (1 - k) + Math.sin(k * Math.PI) * 0.6;
      g.quaternion.copy(fq).slerp(tq, k);
      if (k < 1) return true;
      g.updateMatrixWorld(true); this._bb = this._bb || new THREE.Box3(); this._bb.setFromObject(g);
      g.position.y += 0.02 - this._bb.min.y;
      return false;
    });
  }
  deathEffects(t) {
    const obj = t.obj, ud = obj.userData, cp = this.cellPos(t.x, t.y);
    const drone = t.spec === 'drone';
    obj.rotation.order = 'YXZ';
    // Spritzer + Flash
    const bp = this.bodyPoint(t);
    const blood = t.team === 'alien' ? ({ vael: 0x66ff55, krull: 0xa6d03a, drone: 0xffa040, beast: 0xb060ff, hive: 0xc070ff }[t.spec] || 0x80ff60) : 0xc01818;
    for (let i = 0; i < (drone ? 8 : 22); i++) this.emit(bp, new THREE.Color(blood), 1.6, 2.4, 0.6 + rand() * 0.5, drone);
    if (drone) this.spark(bp, 0xffa040, 14);
    this.flash(bp, blood, 3, 0.2);
    // Bodendecal + grauer Ring
    if (drone) this.scorch(t.x, t.y, 0.75);
    else this.stain(t.x, t.y, t.team === 'alien' ? (t.spec === 'vael' || t.spec === 'krull' ? 'rgba(70,170,40,0.75)' : 'rgba(110,50,170,0.75)') : 'rgba(120,10,10,0.85)');
    this.deadRing(t.x, t.y);
    t.glow = [];
    if (ud.char) { // G6: echte Figur – Sterbe-Clip, Waffe fällt, Leiche liegt sichtbar über dem Boden
      const ch = ud.char;
      t.figHold = 0;
      if (t.koTurn != null && t.figSettled) { t.dying = false; this.refreshCorpseVis(t); return; }
      this.tossGun(t, cp);
      ch.setFootIK(false);
      if (t.koTurn == null || ch.state !== 'dead') ch.setState('die', { force: true });
      t.figSettled = false; t.figDeadT = 0;
      t.figOnSettle = () => this.refreshCorpseVis(t);
      return;
    }
    this.deaden(obj, drone, t.glow);
    const finish = () => { t.dying = false; this.refreshCorpseVis(t); if (drone) this.startWreck(t); };
    if (t.koTurn != null) { finish(); return; } // lag schon bewusstlos am Boden
    if (!drone) this.tossGun(t, cp);
    if (drone) {
      const tx = (rand() - 0.5) * 0.4, tz = (rand() - 0.5) * 0.6;
      const y0 = obj.position.y, yaw = obj.rotation.y, by0 = ud.body.position.y;
      ud.body.scale.set(1.08, 0.78, 0.95);
      obj.rotation.set(tx, yaw, tz); ud.body.position.y = 0.2; obj.position.y = 0;
      this.groundCorpse(obj, cp);
      const endY = obj.position.y, endX = obj.position.x, endZ = obj.position.z;
      obj.rotation.set(0, yaw, 0); obj.position.set(cp.x, y0, cp.z);
      let k = 0, landed = false, tb = 0;
      this.fx.push((dt) => {
        if (this.disposed) return false;
        if (!landed) {
          k = Math.min(1, k + dt / 0.75); const e = k * k;
          obj.rotation.set(tx * e, yaw + e * 2.2, tz * e);
          obj.position.set(cp.x + (endX - cp.x) * e, y0 + (endY - y0) * e, cp.z + (endZ - cp.z) * e);
          const p = obj.position.clone(); p.y += 1.5 + (1 - e) * 0.3;
          this.spark(p, 0xffa040, 2); if (rand() < 0.5) this.emit(p, new THREE.Color(0.25, 0.25, 0.27), 0.3, 0.6, 1, false, true);
          for (const g of t.glow) g.m.emissiveIntensity = g.i0 * (rand() < 0.5 ? 0 : 1);
          if (k >= 1) {
            landed = true;
            const q = obj.position.clone(); q.y += 0.4;
            this.flash(q, 0xff8030, 4, 0.25); this.spark(q, 0xffa040, 24);
            for (let i = 0; i < 6; i++) this.emit(q, new THREE.Color(0.3, 0.3, 0.32), 0.5, 1.2, 1.4, false, true);
            this.shake = Math.max(this.shake, 0.4);
          }
          return true;
        }
        tb += dt;
        obj.position.y = endY + Math.abs(Math.sin(tb * 11)) * 0.28 * Math.max(0, 1 - tb / 0.45);
        if (tb < 0.45) return true;
        obj.position.y = endY; finish(); return false;
      });
      return;
    }
    // Menschen/Aliens: kippen, Gliedmaßen schlaff
    const side = t.spec === 'beast' ? (rand() < 0.5 ? -1 : 1) : (rand() < 0.4 ? (rand() < 0.5 ? -1 : 1) : 0);
    const rx = side ? 0 : -Math.PI / 2, rz = side * Math.PI / 2;
    const sl = rand() < 0.5 ? 1 : -1;
    const limbT = { armL: [-0.25, 0.75], armR: [0.2, -0.55 * sl], legL: [0.15, -0.3], legR: [-0.25, 0.35 * sl] };
    const from = {};
    for (const n in limbT) if (ud[n]) from[n] = [ud[n].rotation.x, ud[n].rotation.z];
    ud.body.position.y = 0;
    if (ud.legL2) { ud.legL2.rotation.x = 0.4; ud.legR2.rotation.x = -0.4; }
    let k = 0;
    this.fx.push((dt) => {
      if (this.disposed) return false;
      k = Math.min(1, k + dt / 0.9); const e = k * k;
      obj.rotation.x = rx * e; obj.rotation.z = rz * e;
      for (const n in from) { ud[n].rotation.x = from[n][0] + (limbT[n][0] - from[n][0]) * e; ud[n].rotation.z = from[n][1] + (limbT[n][1] - from[n][1]) * e; }
      this.groundCorpse(obj, cp);
      if (k < 1) return true;
      finish(); return false;
    });
  }
  // Rauchendes, flackerndes Drohnenwrack für einige Runden (max. 4 Rauchquellen gleichzeitig)
  startWreck(t) {
    this._smokers = this._smokers || 0;
    const smoking = this._smokers < 4; if (smoking) this._smokers++;
    const born = this.turn; let acc = 0, ft = 0;
    this.fx.push((dt) => {
      const done = this.disposed || this.turn > born + 3;
      if (done) { for (const g of t.glow) g.m.emissiveIntensity = 0; if (smoking) this._smokers--; return false; }
      acc += dt; ft += dt;
      if (ft > 0.12) { ft = 0; for (const g of t.glow) g.m.emissiveIntensity = rand() < 0.4 ? g.i0 * rand() : 0; }
      if (smoking && t.obj.visible) {
        const p = t.obj.position.clone(); p.y += 0.5;
        if (acc > 0.5) { acc = 0; this.emit(p, new THREE.Color(0.22, 0.22, 0.24), 0.5, 0.6, 1.8, false, true); }
        if (rand() < dt * 0.7) this.flash(p, 0xff7030, 0.9, 0.1);
      }
      return true;
    });
  }

  damageWall(x, y, amount) {
    const c = this.map.at(x, y); if (!c?.wall) return;
    if (WALLS[c.wall.type]?.indestructible) return; // tiefes Wasser u. ä. ist nicht zerstörbar
    c.wall.hp -= amount;
    if (c.wall.hp <= 0) {
      const t = c.wall.type;
      if (c.wall.hero && c.wall.idx != null) { try { this.wreckHeroCar(t, c.wall.idx, x, y); } catch (e) { console.warn('AEGIS: Wrack', e); } }
      if (c.wall.idx != null) this.props[t].show(c.wall.idx, false);
      this.props[t].base[c.wall.idx] = this.props[t].zero;
      c.wall = null;
      const p = this.cellPos(x, y);
      const pos = new THREE.Vector3(p.x, 1, p.z);
      for (let i = 0; i < 14; i++) this.emit(pos, new THREE.Color(0.5, 0.45, 0.4), 0, 1.6, 1.2, false, true);
      this.scorch(x, y, 0.5);
      this.losDirty = true;
      if (WALLS[t]?.explosive) this.blastQueue.push({ x, y, type: t }); // Treibstoff: explodiert (flushBlasts)
      if (this.fireCells[y * this.W + x] && !FLAMMABLE_FLOOR.has(c.floor)) this.fireCells[y * this.W + x] = Math.min(this.fireCells[y * this.W + x], 1);
    }
  }
  // Explosionen zerstörter Treibstofffässer/Zapfsäulen nacheinander auslösen (Kettenreaktion begrenzt)
  async flushBlasts() {
    if (this._flushing || !this.blastQueue.length) return;
    this._flushing = true;
    let n = 0;
    while (this.blastQueue.length && n < CHAIN_MAX && !this.ended && !this.disposed) {
      const b = this.blastQueue.shift(); n++;
      const pump = b.type === 'fuelpump';
      if (this.vis[b.y * this.W + b.x] || this.explored[b.y * this.W + b.x]) toast(pump ? '💥 Zapfsäule explodiert!' : '💥 Treibstofffass explodiert!', 'warn', 1600);
      await this.explode(b.x, b.y, pump ? 85 : 65, pump ? 3 : 2.2, null, { dtype: 'expl', burn: 0 });
      if (!this.ended) this.igniteArea(b.x, b.y, pump ? 1.6 : 1.2, 2);
    }
    this.blastQueue.length = 0;
    this._flushing = false;
  }

  scorch(x, y, r) {
    const c = this.groundCanvas.getContext('2d');
    const P = this.groundCanvas.width / this.W;
    const g = c.createRadialGradient((x + 0.5) * P, (y + 0.5) * P, 0, (x + 0.5) * P, (y + 0.5) * P, P * (r + 0.6));
    g.addColorStop(0, 'rgba(10,8,6,0.85)'); g.addColorStop(1, 'rgba(10,8,6,0)');
    c.fillStyle = g; c.beginPath(); c.arc((x + 0.5) * P, (y + 0.5) * P, P * (r + 0.6), 0, 7); c.fill();
    this.groundTex.needsUpdate = true;
  }

  // Wurfbahn eines Gegenstands (Granate, Nebel, Fackel); liefert das tatsächliche Aufschlagfeld
  async lobObject(u, tx, ty, id) {
    this.faceTo(u, tx, ty);
    const acc = u.team === 'player' && Game.cheats.aimbot ? 1 : clamp(u.acc / 100 + 0.2, 0.3, 0.95);
    if (rand() > acc) { tx = clamp(tx + randInt(-2, 2), 0, this.W - 1); ty = clamp(ty + randInt(-2, 2), 0, this.H - 1); }
    const kind = ITEMS[id]?.kind || 'grenade';
    const glow = id === 'alien' ? 0x50ff80 : kind === 'smoke' ? 0x9aa0a8 : kind === 'flare' ? 0xffd080 : kind === 'mine' ? 0xff3030 : 0xff6020;
    const from = this.muzzleWorld(u);
    const tp = this.cellPos(tx, ty);
    const to = new THREE.Vector3(tp.x, 0.2, tp.z);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshStandardMaterial({ color: 0x334422, emissive: glow, emissiveIntensity: 2 }));
    this.scene.add(ball);
    const dist = from.distanceTo(to), dur = 0.35 + dist * 0.02;
    this.camT.x = (from.x + to.x) / 2; this.camT.z = (from.z + to.z) / 2;
    let t = 0;
    while (t < dur) { const dt = await this.frame(); t += dt; const k = Math.min(1, t / dur); ball.position.lerpVectors(from, to, k); ball.position.y += Math.sin(k * Math.PI) * (2 + dist * 0.15); }
    this.scene.remove(ball); ball.geometry.dispose(); ball.material.dispose();
    return { x: tx, y: ty };
  }

  // Alien-Granaten (Aliens behalten das einfache Zählsystem u.grenades)
  async throwGrenade(u, tx, ty) {
    const it = ITEMS[u.grenadeKind || 'alien'];
    const cost = this.modeCost(u, 'grenade');
    if (!(u.grenades > 0) || !this.hasTu(u, cost) || Math.hypot(tx - u.x, ty - u.y) > THROW_RANGE) return false;
    this.busy = true;
    this.spendTu(u, cost);
    u.grenades--;
    const p = await this.lobObject(u, tx, ty, u.grenadeKind || 'alien');
    await this.explode(p.x, p.y, it.dmg, it.radius, u);
    this.busy = !!this.ended;
    return true;
  }

  // Gürtel-Gegenstand eines Soldaten benutzen (Wurf oder Medi-Kit)
  async useBelt(u, slot, tx, ty) {
    const b = this.beltEntry(u, slot), it = b && ITEMS[b.id];
    const deny = (msg, type = 'warn') => { toast(msg, type); sfx('deny'); return false; };
    if (!it) return deny('Gürtelplatz leer.');
    if (it.kind === 'ammo') return this.reload(u, slot);
    const cost = this.itemCost(u, b.id);
    if (!this.hasTu(u, cost)) return deny('Nicht genügend Zeiteinheiten.');
    if (it.kind === 'scanner') {
      this.spendTu(u, cost); sfx('select');
      this.scan(u, it);
      this.refreshUi();
      return true;
    }
    if (it.kind === 'stunrod') {
      const t = this.unitAt(tx, ty);
      if (!t || t.team !== 'alien' || !t.alive || !this.isVisibleAlien(t)) return deny('Schockstab: angrenzendes, sichtbares Alien wählen.');
      if (Math.max(Math.abs(t.x - u.x), Math.abs(t.y - u.y)) > 1) return deny('Zu weit entfernt – Schockstab nur gegen angrenzende Aliens.');
      this.busy = true;
      this.spendTu(u, cost); this.faceTo(u, t.x, t.y);
      const c = this.stunrodChance(u, t, it);
      sfx('melee');
      if (u.obj.userData.body) { u.obj.userData.body.position.z = 0.4; setTimeout(() => { if (u.obj.userData.body) u.obj.userData.body.position.z = 0; }, 200); }
      await sleep(150);
      this.spark(this.bodyPoint(t), 0x60a0ff, 18); this.flash(this.bodyPoint(t), 0x60a0ff, 6);
      if (rand() < c) this.damage(t, it.dmg, u, { dtype: 'stun' }); else this.floatAt(t, 'Verfehlt', '#aaa');
      this.busy = !!this.ended;
      if (!this.ended) this.refreshUi();
      return true;
    }
    if (it.kind === 'medkit') {
      const t = this.unitAt(tx, ty) || this.koAt(tx, ty);
      if (!t || t.team !== 'player' || !(t.alive || t.ko)) return deny('Medi-Kit: eigenen Soldaten (selbst oder angrenzend) wählen.');
      if (Math.max(Math.abs(t.x - u.x), Math.abs(t.y - u.y)) > 1) return deny('Zu weit entfernt – nur angrenzende Felder.');
      if (t.ko) { // bewusstlosen Soldaten wecken: Betäubung weg, wacht mit 0 ZE auf
        if (this.occ[t.y * this.W + t.x] >= 0) return deny('Feld des Bewusstlosen ist besetzt – erst Platz machen.');
        this.spendTu(u, cost);
        t.stun = 0; this.wake(t, 0);
        this.consumeBelt(u, slot);
        this.faceTo(u, t.x, t.y);
        this.spark(this.bodyPoint(t), 0x60ff90, 12); sfx('select');
        return true;
      }
      if (t.hp >= t.maxHp) return deny(`${t.name} ist unverletzt.`, 'info');
      this.spendTu(u, cost);
      const heal = Math.min(it.heal, t.maxHp - t.hp);
      t.hp += heal; t.healed = (t.healed || 0) + heal;
      this.consumeBelt(u, slot);
      if (t !== u) this.faceTo(u, t.x, t.y);
      this.floatAt(t, `+${heal} LP`, '#7dffa0', true);
      this.spark(this.bodyPoint(t), 0x60ff90, 12);
      sfx('select');
      return true;
    }
    const range = it.throwRange || THROW_RANGE;
    if (Math.hypot(tx - u.x, ty - u.y) > range) return deny(`Zu weit entfernt (max. ${range} Felder).`);
    this.busy = true;
    this.spendTu(u, cost);
    this.consumeBelt(u, slot);
    const p = await this.lobObject(u, tx, ty, b.id);
    if (it.kind === 'grenade') await this.explode(p.x, p.y, it.dmg, it.radius, u, { dtype: it.dtype || 'expl' });
    else if (it.kind === 'smoke') this.addSmoke(p.x, p.y, it);
    else if (it.kind === 'flare') this.addFlare(p.x, p.y, it);
    else if (it.kind === 'mine') {
      const c = this.freeCellNear(p.x, p.y, u);
      this.mines.push({ x: c.x, y: c.y, id: b.id, owner: u, counted: !Game.cheats.allGear, obj: this.makeMineObj(c) });
      sfx('click'); toast('◎ Sensormine scharf – löst bei Alien-Bewegung im Umkreis aus.', 'info', 2200);
    } else if (it.kind === 'charge') {
      this.charges.push({ x: p.x, y: p.y, id: b.id, owner: u, obj: this.makeChargeObj(p) });
      sfx('click'); toast('🧨 Sprengladung scharf – zündet am Ende deines Zuges!', 'warn', 2600);
      this.floatCell(p.x, p.y, '💥 Zugende', '#ff9a50', true);
    }
    if (it.kind !== 'grenade' && !this.ended) this.updateVisibility();
    this.busy = !!this.ended;
    if (!this.ended) this.refreshUi();
    return true;
  }
  // Verbrauch zählen (nicht mit Cheat „alle Ausrüstung“); Medi-Kit zählt erst, wenn alle Ladungen weg sind
  consumeBelt(u, slot) {
    if (Game.cheats.allGear) return;
    const b = u.belt?.[slot]; if (!b || ITEMS[b.id]?.reusable) return;
    b.uses--;
    if (b.uses <= 0) { u.belt[slot] = null; this.result.itemsUsed[b.id] = (this.result.itemsUsed[b.id] || 0) + 1; }
  }

  // ---- Nebelgranate: Rauchwolke für it.turns Runden ----
  addSmoke(cx, cy, it) {
    const cloud = { x: cx, y: cy, r: it.radius, turns: it.turns, max: it.turns, alpha: 0, k: 0.4, puffs: [] };
    const p0 = this.cellPos(cx, cy);
    const R = it.radius * TILE;
    const want = Math.round(14 + it.radius * 6);
    for (let i = 0; i < want; i++) {
      const sp = this.smokePool.find((s) => !s.userData.used); if (!sp) break;
      sp.userData.used = true; sp.visible = true; sp.material.opacity = 0;
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * R * 0.95;
      const s = randRange(2.6, 4.4);
      sp.scale.setScalar(s); sp.material.rotation = rand() * 6;
      cloud.puffs.push({ sp, bx: Math.cos(a) * d, bz: Math.sin(a) * d, by: randRange(0.5, 2.6) * (1 - d / R * 0.4), s, ph: rand() * 6, rs: randRange(-0.25, 0.25), o: randRange(0.55, 1) });
    }
    cloud.px = p0.x; cloud.pz = p0.z;
    this.smokes.push(cloud);
    this.rebuildSmoke();
    sfx('hit');
    for (let i = 0; i < 12; i++) this.emit(new THREE.Vector3(p0.x, 0.4, p0.z), new THREE.Color(0.55, 0.56, 0.58), 0, 2.2, 1.2 + rand(), false, true);
  }
  rebuildSmoke() {
    this.smokeCells.fill(0);
    for (const c of this.smokes) {
      if (c.turns <= 0) continue;
      const r = c.r * (0.55 + 0.45 * c.turns / c.max), R = Math.ceil(r);
      for (let y = c.y - R; y <= c.y + R; y++) for (let x = c.x - R; x <= c.x + R; x++) {
        if (!this.inb(x, y) || Math.hypot(x - c.x, y - c.y) > r + 0.01) continue;
        const i = y * this.W + x; this.smokeCells[i] = Math.max(this.smokeCells[i], c.turns);
      }
    }
    if (this.fireCells) for (let i = 0; i < this.N; i++) if ((this.fireCells[i] || this.fireSmoke[i]) && !this.smokeCells[i]) this.smokeCells[i] = 1;
  }

  // ---- Leuchtfackel: Licht + glühendes Objekt für it.turns Runden ----
  addFlare(cx, cy, it) {
    const p = this.cellPos(cx, cy);
    const obj = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.55, 8).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xa02020, roughness: 0.6 }));
    stick.position.y = 0.07;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 4.2, 2.4) }));
    tip.position.set(0.28, 0.08, 0);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.particleTex, color: new THREE.Color(2.2, 1.5, 0.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.position.set(0.28, 0.25, 0); halo.scale.setScalar(2.4);
    obj.add(stick, tip, halo);
    obj.rotation.y = rand() * Math.PI * 2;
    obj.position.set(p.x, 0, p.z);
    this.scene.add(obj);
    const light = this.flareLights.find((l) => !l.userData.busy) || null;
    if (light) { light.userData.busy = true; light.position.set(p.x, 1.4, p.z); light.distance = it.radius * TILE * 1.7; }
    this.flares.push({ x: cx, y: cy, r: it.radius, turns: it.turns, max: it.turns, obj, halo, light, alpha: 0, t: rand() * 10 });
    sfx('click');
  }
  removeFlare(f) {
    this.scene.remove(f.obj);
    f.obj.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    if (f.light) { f.light.intensity = 0; f.light.userData.busy = false; }
  }
  // Rauch und Fackeln nehmen bei jedem Rundenwechsel ab
  decayEffects() {
    this.burnTick();
    for (const c of this.smokes) if (c.turns > 0) c.turns--;
    for (const f of this.flares) if (f.turns > 0) f.turns--;
    this.rebuildSmoke();
  }
  updateEffects(dt, time) {
    for (const c of this.smokes) {
      const target = c.turns > 0 ? 0.45 + 0.4 * Math.sqrt(c.turns / c.max) : 0;
      c.alpha = smooth(c.alpha, target, c.turns > 0 ? 2.5 : 0.9, dt);
      c.k = smooth(c.k, c.turns > 0 ? 0.6 + 0.4 * c.turns / c.max : 1.15, 1.2, dt);
      for (const p of c.puffs) {
        const sw = Math.sin(time * 0.35 + p.ph);
        p.sp.position.set(c.px + p.bx * c.k + sw * 0.35, p.by + Math.sin(time * 0.5 + p.ph * 2) * 0.15, c.pz + p.bz * c.k + Math.cos(time * 0.3 + p.ph) * 0.35);
        p.sp.material.rotation += p.rs * dt;
        p.sp.material.opacity = c.alpha * p.o;
        p.sp.scale.setScalar(p.s * (0.85 + 0.25 * c.k));
      }
      if (c.turns <= 0 && c.alpha < 0.01) { for (const p of c.puffs) { p.sp.visible = false; p.sp.userData.used = false; } c.dead = true; }
    }
    if (this.smokes.some((c) => c.dead)) this.smokes = this.smokes.filter((c) => !c.dead);
    for (const f of this.flares) {
      f.t += dt;
      f.alpha = smooth(f.alpha, f.turns > 0 ? 1 : 0, f.turns > 0 ? 4 : 1.5, dt);
      const fl = 0.82 + 0.1 * Math.sin(f.t * 23) + 0.08 * Math.sin(f.t * 37 + 1.3);
      if (f.light) f.light.intensity = (this.map.night ? 70 : 30) * f.alpha * fl;
      f.halo.material.opacity = f.alpha * fl;
      f.halo.scale.setScalar(2.2 + fl * 0.6);
      if (f.turns > 0 && rand() < dt * 10) this.emit(f.halo.getWorldPosition(new THREE.Vector3()), new THREE.Color(3, 1.6, 0.5), 0.6, 0.35, 0.35);
      if (f.turns <= 0 && f.alpha < 0.02) { this.removeFlare(f); f.dead = true; }
    }
    if (this.flares.some((f) => f.dead)) this.flares = this.flares.filter((f) => !f.dead);
  }

  // Flächenwirkung (W1 4.3): dtype expl (wie bisher) | fire (Brand + brennende Felder) | stun (blauer Blitz, nur Betäubung)
  async explode(cx, cy, dmg, radius, src, opts = {}) {
    const { dtype = 'expl', wallMul = 1.4, burn = 0 } = opts;
    if (this.disposed) return;
    const p = this.cellPos(cx, cy);
    const pos = new THREE.Vector3(p.x, 0.6, p.z);
    const stun = dtype === 'stun', fire = dtype === 'fire';
    sfx(stun ? 'plasma' : 'explosion'); Input.rumble(stun ? 0.5 : 1, stun ? 0.4 : 0.8, stun ? 250 : 450);
    this.shake = stun ? 0.35 : 0.9;
    this.flash(pos, stun ? 0x60a0ff : fire ? 0xff6a20 : 0xff9040, stun ? 40 : 60, 0.5);
    const hot = stun ? () => new THREE.Color(0.8, 1.6 + rand(), 3.2) : fire ? () => new THREE.Color(3, 0.9 + rand() * 0.8, 0.15) : () => new THREE.Color(3, 1.4 + rand(), 0.3);
    for (let i = 0; i < 40; i++) this.emit(pos, hot(), 0, (stun ? 2.5 : 4) + rand() * radius * 1.5, 0.7 + rand() * 0.4);
    if (!stun) for (let i = 0; i < 25; i++) this.emit(pos, new THREE.Color(0.25, 0.23, 0.22), 0, 2 + rand() * 2, 2 + rand(), false, true);
    if (!stun) this.scorch(cx, cy, radius * 0.8);
    const R = Math.ceil(radius), chained = [];
    for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {
      if (!this.inb(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy); if (d > radius) continue;
      const k = 1 - d / (radius + 0.5);
      for (const u of this.unitsInCell(x, y)) {
        if (dtype === 'expl') this.hurt(u, dmg * k + u.armor * 0.4, src, { dtype });
        else if (fire) this.hurt(u, dmg * k, src, { dtype });
        else this.hurt(u, dmg * k, src, { dtype: 'stun' });
      }
      if (!stun && this.wallAt(x, y)) this.damageWall(x, y, dmg * k * wallMul * randRange(0.7, 1.3));
      const m = this.mineAt(x, y); if (m && !stun) chained.push(m); // Minen im Radius detonieren mit
    }
    if (fire) this.igniteArea(cx, cy, radius, burn || 2);
    await sleep(stun ? 350 : 500);
    if (this.losDirty) { this.losDirty = false; this.updateVisibility(); }
    for (const m of chained) { if (this.ended || !this.mines.includes(m)) continue; this.removeMine(m); await this.explode(m.x, m.y, ITEMS[m.id].dmg, ITEMS[m.id].radius, m.owner); }
    await this.flushBlasts();
  }

  // ======================= Brand (W1 4.4) =======================
  fullWall(x, y) { const w = this.wallAt(x, y); return !!(w && WALLS[w.type]?.full); }
  flammable(x, y) { const c = this.map.at(x, y); if (!c) return false; if (c.wall) return FLAMMABLE_WALL.has(c.wall.type); return FLAMMABLE_FLOOR.has(c.floor); }
  igniteArea(cx, cy, r, turns) {
    const R = Math.ceil(r);
    for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {
      if (!this.inb(x, y) || Math.hypot(x - cx, y - cy) > r + 0.01) continue;
      if (this.wallAt(x, y)?.type === 'water' || (this.fullWall(x, y) && !this.flammable(x, y))) continue;
      if (this.fireCount >= MAX_FIRE) break;
      this.setFire(x, y, turns, 0);
    }
    this.rebuildSmoke(); this.losDirty = true;
  }
  setFire(x, y, turns, gen) {
    const i = y * this.W + x;
    if (this.fireCells[i] < turns) { if (!this.fireCells[i]) this.fireCount++; this.fireCells[i] = turns; this.fireGen[i] = gen; }
  }
  // Rundenwechsel: Schaden, brennbare Wände, begrenzte Ausbreitung, Abbau → Nachrauch
  burnTick() {
    if (!this.fireCount && !this.fireSmoke.some((v) => v)) return;
    const W = this.W;
    for (const u of this.units) if (u.alive && this.fireCells[u.y * W + u.x]) this.damage(u, BURN_DMG, null, { dtype: 'fire' });
    for (const u of this.units) if (u.ko && this.fireCells[u.y * W + u.x]) this.hurtKo(u, BURN_DMG, null, { dtype: 'fire' });
    const spread = [];
    for (let i = 0; i < this.N; i++) {
      if (!this.fireCells[i]) continue;
      const x = i % W, y = (i / W) | 0;
      const wl = this.wallAt(x, y);
      if (wl && FLAMMABLE_WALL.has(wl.type)) this.damageWall(x, y, 20);
      if (this.fireGen[i] < 2 && this.fireCells[i] >= 2) for (const [dx, dy] of DIRS.slice(0, 4)) {
        const nx = x + dx, ny = y + dy; if (!this.inb(nx, ny)) continue;
        const j = ny * W + nx;
        if (!this.fireCells[j] && this.flammable(nx, ny) && rand() < 0.15) spread.push([nx, ny, this.fireGen[i] + 1]);
      }
    }
    for (let i = 0; i < this.N; i++) {
      if (this.fireSmoke[i]) this.fireSmoke[i]--;
      if (!this.fireCells[i]) continue;
      this.fireCells[i]--;
      if (!this.fireCells[i]) { this.fireCount--; this.fireSmoke[i] = 1; this.scorch(i % W, (i / W) | 0, 0.3); }
    }
    for (const [x, y, g] of spread) if (this.fireCount < MAX_FIRE) this.setFire(x, y, 2, g);
    this.losDirty = true;
  }
  updateFire(dt) {
    if (!this.fireCount) { this.fireLight.intensity = 0; for (const f of this.flames) f.visible = false; return; }
    let n = 0, sx = 0, sz = 0;
    const v = this._fv || (this._fv = new THREE.Vector3()), t = this.engine.time;
    for (let i = 0; i < this.N && n < 40; i++) {
      if (!this.fireCells[i] || !this.explored[i]) continue;
      const p = this.cellPos(i % this.W, (i / this.W) | 0); sx += p.x; sz += p.z;
      const f = this.flames[n++], ph = f.userData.ph, fl = 0.75 + 0.25 * Math.sin(t * 13 + ph) * Math.sin(t * 7.3 + ph * 2);
      f.visible = true; f.position.set(p.x + Math.sin(t * 3 + ph) * 0.12, 0.7 + 0.15 * fl, p.z + Math.cos(t * 2.7 + ph) * 0.12);
      f.scale.set(1.3 * fl, 1.8 + 0.5 * fl, 1); f.material.opacity = 0.5 + 0.3 * fl;
      if (rand() < dt * 30) { v.set(p.x + randRange(-0.7, 0.7), 0.15, p.z + randRange(-0.7, 0.7)); this.emit(v, new THREE.Color(3, 1 + rand() * 0.9, 0.15), 1.8, 0.35, 0.5 + rand() * 0.3); }
      if (rand() < dt * 3) { v.set(p.x + randRange(-0.5, 0.5), 1.4, p.z + randRange(-0.5, 0.5)); this.emit(v, new THREE.Color(0.2, 0.19, 0.18), 0.8, 0.4, 1.6, false, true); }
    }
    for (let k = n; k < this.flames.length; k++) this.flames[k].visible = false;
    if (n) { this.fireLight.position.set(sx / n, 1.6, sz / n); this.fireLight.intensity = (this.map.night ? 30 : 14) * (0.85 + 0.15 * Math.sin(this.engine.time * 17)); this.fireLight.distance = 10 + Math.min(14, n); } else this.fireLight.intensity = 0;
  }

  // ======================= Minen, Ladungen, Scanner =======================
  makeMineObj(c) {
    const p = this.cellPos(c.x, c.y), g = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.1, 14), new THREE.MeshStandardMaterial({ color: 0x3a4232, roughness: 0.6, metalness: 0.4 }));
    disc.position.y = 0.05;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.2) }));
    led.position.y = 0.12;
    g.add(disc, led); g.position.set(p.x + randRange(-0.2, 0.2), 0, p.z + randRange(-0.2, 0.2));
    this.scene.add(g);
    let t = rand() * 3;
    this.fx.push((dt) => { if (!g.parent) return false; t += dt; led.visible = Math.sin(t * 6) > 0.2; return true; });
    return g;
  }
  removeObj(o) { if (!o) return; this.scene.remove(o); o.traverse((q) => { q.geometry?.dispose(); q.material?.dispose(); }); }
  removeMine(m) { this.mines = this.mines.filter((q) => q !== m); this.removeObj(m.obj); }
  makeChargeObj(c) {
    const p = this.cellPos(c.x, c.y), g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.3), new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.7 }));
    box.position.y = this.wallAt(c.x, c.y) ? 0.9 : 0.11;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.4, 0.2) }));
    led.position.set(0.12, box.position.y + 0.13, 0);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.particleTex, color: new THREE.Color(2.5, 0.4, 0.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.position.copy(led.position); halo.scale.setScalar(0.8);
    g.add(box, led, halo); g.position.set(p.x, 0, p.z);
    this.scene.add(g);
    let t = 0;
    this.fx.push((dt) => { if (!g.parent) return false; t += dt; const on = Math.sin(t * 9) > 0; led.visible = on; halo.visible = on; return true; });
    return g;
  }
  // Nachbarfeld ohne Vollwand in Richtung des Werfers (Mine landet auf einer Wand)
  freeCellNear(x, y, u) {
    if (!this.blocksMove(x, y)) return { x, y };
    const cands = [];
    for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy; if (this.inb(nx, ny) && !this.blocksMove(nx, ny)) cands.push({ x: nx, y: ny }); }
    cands.sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y));
    return cands[0] || { x: u.x, y: u.y };
  }
  scan(u, it) {
    this.blips = this.units.filter((o) => o.alive && o.team !== 'player' && o.movedTurn === this.turn - 1
      && Math.hypot(o.x - u.x, o.y - u.y) <= it.radius && !(o.team === 'alien' ? this.isVisibleAlien(o) : this.vis[o.y * this.W + o.x])).map((o) => ({ x: o.x, y: o.y }));
    this.showBlips(u, it.radius);
    toast(`📡 Scanner: ${this.blips.length} Bewegung(en) im Umkreis von ${it.radius} Feldern`, this.blips.length ? 'warn' : 'info', 2600);
  }
  showBlips(u, r) {
    this.blipRings.forEach((b, i) => { const bp = this.blips[i]; b.visible = !!bp; if (bp) { const p = this.cellPos(bp.x, bp.y); b.position.set(p.x, 0.08, p.z); } });
    if (u) { // Scan-Welle um den Soldaten
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2, 0.5), transparent: true, opacity: 0.7, depthWrite: false }));
      ring.position.set(u.obj.position.x, 0.1, u.obj.position.z); this.scene.add(ring);
      let k = 0;
      this.fx.push((dt) => { k = Math.min(1, k + dt / 0.9); ring.scale.setScalar(0.5 + k * r * TILE); ring.material.opacity = 0.7 * (1 - k); if (k < 1) return true; this.removeObj(ring); return false; });
    }
  }
  clearBlips() { this.blips = []; this.blipRings.forEach((b) => (b.visible = false)); }

  // ======================= Munition =======================
  // Gürtelplatz mit passender Munition: 1. gleiche Art wie geladen, 2. Reihenfolge von w.ammo
  autoAmmoSlot(u) {
    const slots = this.beltSlots(u).filter((k) => ITEMS[u.belt[k].id].kind === 'ammo' && ammoFits(u.weapon, u.belt[k].id));
    if (!slots.length) return null;
    const same = slots.find((k) => u.belt[k].id === u.load?.id);
    if (same != null) return same;
    for (const id of ammoList(u.weapon)) { const k = slots.find((s) => u.belt[s].id === id); if (k != null) return k; }
    return slots[0];
  }
  reload(u, slot = null) {
    const deny = (msg) => { if (u?.team === 'player') { toast(msg, 'warn'); sfx('deny'); } return false; };
    const w = WEAPONS[u?.weapon];
    if (!u || !u.alive || this.ended) return false;
    if (!w?.mag) return deny(`${w?.name || 'Waffe'} braucht keine Munition.`);
    if (slot == null) slot = this.autoAmmoSlot(u);
    if (slot == null) return deny('Kein passendes Magazin im Gürtel.');
    const b = this.beltEntry(u, slot);
    if (!b || ITEMS[b.id].kind !== 'ammo' || !ammoFits(u.weapon, b.id)) return deny('Diese Munition passt nicht zur Waffe.');
    const cost = this.reloadCost(u);
    if (!this.hasTu(u, cost)) return deny(`Nachladen kostet ${cost} ZE.`);
    this.spendTu(u, cost);
    const old = u.load, rounds = b.rounds ?? w.mag;
    u.load = { id: b.id, rounds };
    if (!Game.cheats.allGear) {
      if (old && old.rounds > 0) u.belt[slot] = { id: old.id, uses: 1, rounds: old.rounds }; // Tausch: angebrochenes Magazin in den Gürtel
      else { u.belt[slot] = null; if (old && !old.none && !ITEMS[old.id]?.free) this.result.itemsUsed[old.id] = (this.result.itemsUsed[old.id] || 0) + 1; }
    }
    sfx('click');
    this.floatAt(u, `${ITEMS[b.id].icon} nachgeladen`, '#cfe6ff');
    if (this.mode === 'belt' && !this.beltEntry(u)) this.mode = this.firstMode(u);
    this.computeRange(); this.updateHover(); this.refreshUi();
    return true;
  }
  firstMode(u) { const w = WEAPONS[u?.weapon]; return ['snap', 'aimed', 'auto'].find((m) => w?.[m]) || 'snap'; }

  // ======================= Effekte =======================
  emit(pos, color, vy = 0, spread = 1, life = 0.5, additive = true, smoke = false) {
    const p = this.particles.find((x) => x.life <= 0); if (!p) return;
    p.sp.visible = true;
    p.sp.position.copy(pos);
    p.sp.material.color.copy(color instanceof THREE.Color ? color : new THREE.Color(color));
    p.sp.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    p.sp.material.opacity = smoke ? 0.7 : 1;
    p.vel = new THREE.Vector3(randRange(-1, 1) * spread, vy + randRange(0.3, 1.2) * spread * (smoke ? 0.4 : 1), randRange(-1, 1) * spread);
    p.life = p.max = life;
    p.size0 = smoke ? 0.8 : 0.55; p.grow = smoke ? 2.4 : -0.3;
    p.smoke = smoke;
  }
  spark(pos, color, n) { for (let i = 0; i < n; i++) this.emit(pos, new THREE.Color(color).multiplyScalar(3), 0, 2.2, 0.3 + rand() * 0.2); }
  flash(pos, color, intensity, dur = 0.12) {
    const l = this.lightPool.find((x) => !x.userData.busy) || this.lightPool[0];
    l.position.copy(pos); l.position.y += 0.5; l.color.set(color); l.intensity = intensity; l.userData.busy = true;
    let t = 0;
    this.fx.push((dt) => { t += dt; l.intensity = intensity * Math.max(0, 1 - t / dur); if (t >= dur) { l.userData.busy = false; l.intensity = 0; return false; } return true; });
  }
  floatCell(x, y, text, color, big) { const c = this.cellPos(x, y), s = this.toScreen(new THREE.Vector3(c.x, 1.6, c.z)); if (s) floatText(s.x, s.y, text, color, big); }
  stunrodChance(u, t, it) { return u.team === 'player' && Game.cheats.aimbot ? 1 : clamp((u.acc / 100) * (it.acc || 1.1) * (t.kneel ? 0.92 : 1), 0.05, 0.95); }
  floatAt(u, text, color, big) {
    const p = (u.obj ? u.obj.position.clone() : new THREE.Vector3()).setY(2.4);
    const s = this.toScreen(p);
    if (s) floatText(s.x, s.y, text, color, big);
  }
  toScreen(v) {
    const p = v.clone().project(this.camera);
    if (p.z > 1) return null;
    const r = this.engine.canvas.getBoundingClientRect();
    return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height };
  }

  // ======================= Rundenablauf =======================
  async endTurn() {
    if (this.busy || this.phase !== 'player' || this.ended) return;
    // scharfe Sprengladungen zünden am Ende des eigenen Zuges (W1 4.7)
    if (this.charges.length) {
      this.busy = true; this.clearTarget(); this.clearPath(); this.grenadeArea.visible = false;
      for (const c of this.charges.splice(0)) {
        this.removeObj(c.obj);
        const it = ITEMS[c.id];
        const cp = this.cellPos(c.x, c.y); this.camT.x = cp.x; this.camT.z = cp.z;
        await sleep(250);
        await this.explode(c.x, c.y, it.dmg, it.radius, c.owner, { wallMul: it.wallMul || 1.4 });
        if (this.ended) return;
      }
      this.busy = false;
    }
    this.phase = 'alien';
    this.clearBlips(); this.waypoints = []; this.groundTarget = null;
    this.clearTarget();
    this.rangeMesh.count = 0;
    this.updateHover();
    this.refreshUi();
    banner('ALIEN-AKTIVITÄT', `Runde ${this.turn}`, 'alien');
    sfx('alienTurn');
    setMusicMood('tac');
    await sleep(900);
    if (this.ended) return;
    for (const u of this.units) { u.revealed = false; if (u.alive && u.team === 'alien') { u.tu = u.wokeHalf ? Math.round(u.maxTu / 2) : u.maxTu; u.wokeHalf = false; } }
    await this.alienTurn();
    if (this.ended) return;
    await this.civilianTurn();
    if (this.ended) return;
    this.turn++;
    this.decayEffects();
    if (this.losDirty) { this.losDirty = false; this.updateVisibility(); }
    await this.flushBlasts();
    if (this.ended) return;
    for (const u of this.units) if (u.alive && u.team !== 'alien') u.tu = u.maxTu;
    // Betäubung baut ab (10 % maxHp je Runde); Bewusstlose wachen auf, sobald Betäubung < LP und ihr Feld frei ist
    for (const u of this.units) {
      if (!(u.stun > 0)) continue;
      u.stun = Math.max(0, u.stun - Math.round(u.maxHp * 0.10));
      if (u.ko && u.stun < u.hp && this.occ[u.y * this.W + u.x] < 0) {
        this.wake(u, Math.round(u.maxTu / 2));
        if (u.team === 'alien') u.wokeHalf = true; // handelt im nächsten Alienzug mit halben ZE
      }
    }
    this.phase = 'player';
    this.updateVisibility();
    banner('DEIN ZUG', `Runde ${this.turn}`);
    sfx('turn');
    if (!this.selected?.alive) this.cycleUnit(1);
    else this.select(this.selected, true);
    this.updateHover();
    this.refreshUi();
  }

  async alienTurn() {
    this.busy = true;
    const aliens = this.units.filter((u) => u.team === 'alien' && u.alive);
    for (const a of aliens) {
      if (this.ended) break;
      if (!a.alive) continue;
      await this.alienAct(a);
      if (this.ended) break;
      await sleep(a.obj.visible ? 250 : 10);
    }
    this.busy = !!this.ended;
  }

  alienTargets(a) {
    return this.units.filter((t) => t.alive && !t.evac && (t.team === 'player' || (t.team === 'civ' && this.opts.site.kind === 'terror')) && this.canSee(a, t.x, t.y));
  }

  async alienAct(a) {
    const w = WEAPONS[a.weapon];
    let guard = 0, shots = 0;
    // steht das Alien im Feuer: zuerst auf das nächste nicht brennende Feld (W1 4.11)
    if (this.fireCells[a.y * this.W + a.x]) {
      const budget = Math.max(0, a.tu - this.modeCost(a, 'snap'));
      const { dist, prev } = this.dijkstra(a, budget);
      let best = -1, bd = Infinity;
      for (let i = 0; i < this.N; i++) if (dist[i] > 0 && dist[i] < bd && !this.fireCells[i] && this.occ[i] < 0) { bd = dist[i]; best = i; }
      if (best >= 0) await this.moveUnit(a, this.buildPath(prev, best % this.W, (best / this.W) | 0), { noStop: true });
      if (!a.alive || this.ended) return;
    }
    const maxShots = a.boss ? 3 : this.turn === 1 ? 1 : 2;
    while (a.alive && !this.ended && guard++ < 8 && shots < maxShots) {
      let targets = this.alienTargets(a);
      const soldiersSeen = targets.filter((t) => t.team === 'player');
      if (soldiersSeen.length) targets = soldiersSeen;
      if (targets.length) {
        if (w.melee) {
          const t = targets.sort((p, q) => this.dist(a, p) - this.dist(a, q))[0];
          if (this.dist(a, t) < 1.6) {
            if (!this.hasTu(a, this.modeCost(a, 'snap'))) return;
            await this.fire(a, t, 'snap'); shots++;
            continue;
          }
          const moved = await this.moveToward(a, t, 0);
          if (!moved) return;
          continue;
        }
        // Granate gegen Gruppen
        if (a.grenades > 0 && this.hasTu(a, this.modeCost(a, 'grenade'))) {
          const gr = ITEMS[a.grenadeKind || 'alien'].radius + 0.6;
          const t = targets.find((tt) => this.units.filter((o) => o.alive && o.team === 'player' && this.dist(o, tt) < 2.5).length >= 2 && this.dist(a, tt) < 12
            && !this.units.some((o) => o.alive && o.team === 'alien' && this.dist(o, tt) < gr));
          if (t && rand() < 0.6) { await this.throwGrenade(a, t.x, t.y); shots++; continue; }
        }
        let best = null, bs = -1, bm = 'snap';
        for (const t of targets) for (const mode of ['aimed', 'snap', 'auto']) {
          if (!w[mode] || !this.hasTu(a, this.modeCost(a, mode))) continue;
          const c = this.hitChance(a, t, mode) * (w[mode].shots || 1) * (mode === 'aimed' ? 0.95 : 1);
          const score = c * (1.4 - t.hp / t.maxHp) * (t.team === 'player' ? 1.5 : 1);
          if (score > bs) { bs = score; best = t; bm = mode; }
        }
        if (!best) {
          return; // keine Zeiteinheiten mehr für Schüsse
        }
        if (this.hitChance(a, best, bm) < 0.3 && a.tu > this.modeCost(a, 'snap') + 12) {
          const moved = await this.repositionToShoot(a, best);
          if (moved) continue;
        }
        await this.fire(a, best, bm); shots += bm === 'auto' ? 2 : 1;
        continue;
      }
      // Kein Ziel sichtbar: suchen / patrouillieren
      const known = this.units.filter((t) => t.alive && !t.evac && t.team === 'player');
      const hunt = this.turn >= 4 || a.spec === 'beast' || a.boss === false && rand() < 0.15 * this.turn;
      if (a.guard && this.turn < 3 && rand() < 0.75) return;
      if (a.boss && this.turn < 6) return;
      const budget = Math.max(0, a.tu - this.modeCost(a, 'snap'));
      if (budget < 4) return;
      if (hunt && known.length) {
        const t = known.sort((p, q) => this.dist(a, p) - this.dist(a, q))[0];
        const moved = await this.moveToward(a, t, w.melee ? 0 : this.modeCost(a, 'snap'));
        if (!moved) return;
      } else {
        const { dist } = this.dijkstra(a, budget);
        const opts = [];
        for (let i = 0; i < this.N; i++) if (dist[i] < Infinity && dist[i] > 6) opts.push(i);
        if (!opts.length) return;
        const i = choice(opts);
        const { prev } = this.dijkstra(a, budget);
        await this.moveUnit(a, this.buildPath(prev, i % this.W, (i / this.W) | 0), { noStop: true });
      }
      if (!this.alienTargets(a).length) return;
    }
  }

  async moveToward(a, t, keepTu) {
    const budget = a.tu - keepTu;
    if (budget < 4) return false;
    const full = this.dijkstra(a, Infinity, false);
    // nächstes freies Nachbarfeld des Ziels
    let best = null, bd = Infinity;
    for (const [dx, dy] of DIRS) {
      const x = t.x + dx, y = t.y + dy;
      if (!this.inb(x, y)) continue;
      const d = full.dist[y * this.W + x];
      if (d < bd) { bd = d; best = { x, y }; }
    }
    if (!best) return false;
    let path = this.buildPath(full.prev, best.x, best.y);
    // nur so weit gehen, wie das Budget reicht
    let acc = 0, cut = [];
    let px = a.x, py = a.y;
    for (const s of path) { const c = s.x !== px && s.y !== py ? 6 : 4; if (acc + c > budget) break; acc += c; cut.push(s); px = s.x; py = s.y; }
    if (!cut.length) return false;
    await this.moveUnit(a, cut, { noStop: true });
    return true;
  }

  async repositionToShoot(a, t) {
    const budget = a.tu - this.modeCost(a, 'snap');
    const { dist, prev } = this.dijkstra(a, budget);
    let best = null, bs = this.hitChance(a, t, 'snap') + 0.05;
    for (let i = 0; i < this.N; i++) {
      if (dist[i] === Infinity || dist[i] === 0) continue;
      const x = i % this.W, y = (i / this.W) | 0;
      if (Math.hypot(x - t.x, y - t.y) > 14 || !this.los(x, y, t.x, t.y)) continue;
      const ox = a.x, oy = a.y; a.x = x; a.y = y;
      let s = this.hitChance(a, t, 'snap');
      const covered = this.coverBetween(t, a);
      a.x = ox; a.y = oy;
      if (covered) s += 0.12;
      s -= dist[i] * 0.004;
      if (s > bs) { bs = s; best = { x, y }; }
    }
    if (!best) return false;
    await this.moveUnit(a, this.buildPath(prev, best.x, best.y), { noStop: true });
    return true;
  }

  async civilianTurn() {
    const civs = this.units.filter((u) => u.team === 'civ' && u.alive);
    for (const c of civs) {
      const threat = this.units.find((a) => a.team === 'alien' && a.alive && this.dist(a, c) < 10);
      if (!threat) continue;
      const { dist, prev } = this.dijkstra(c, 24);
      let best = null, bd = this.dist(c, threat);
      for (let i = 0; i < this.N; i++) {
        if (dist[i] === Infinity) continue;
        const x = i % this.W, y = (i / this.W) | 0;
        const d = Math.hypot(x - threat.x, y - threat.y) + rand() * 2;
        if (d > bd) { bd = d; best = { x, y }; }
      }
      if (best) await this.moveUnit(c, this.buildPath(prev, best.x, best.y), { noStop: true });
    }
  }

  checkEnd() {
    if (this.ended || this.disposed) return;
    const aliens = this.units.filter((u) => u.team === 'alien' && u.alive);
    const soldiers = this.units.filter((u) => u.team === 'player' && u.alive && !u.evac);
    const boss = this.units.find((u) => u.boss);
    if (!aliens.length || (boss && !boss.alive)) this.finish(true);
    else if (!soldiers.length) this.finish(false);
  }

  async abort() {
    if (this.ended || this.busy || this.phase !== 'player') { toast('Rückzug nur während deines Zuges möglich.', 'warn'); return; }
    const lzNow = () => this.units.filter((u) => u.team === 'player' && u.alive && this.map.lz.some((p) => p.x === u.x && p.y === u.y));
    const pre = lzNow();
    const total = this.units.filter((u) => u.team === 'player' && u.alive).length;
    const ok = await confirmBox(`Mission abbrechen?<br><br>${pre.length} von ${total} Soldaten befinden sich in der Landezone und werden evakuiert.${pre.length < total ? '<br><b class="bad">Alle anderen gelten als vermisst!</b>' : ''}`, 'Abbrechen & Rückzug');
    if (!ok || this.ended) return;
    const onLz = lzNow();
    for (const u of this.units) {
      if (u.team !== 'player' || !u.alive) continue;
      if (onLz.includes(u)) u.evac = true; else { u.alive = false; u.mia = true; }
    }
    this.finish(false, true);
  }

  finish(won, aborted = false) {
    if (this.ended) return;
    this.ended = true;
    this.busy = true;
    const c = Game.c;
    const site = this.opts.site;
    const r = this.result;
    r.won = won;
    let score = 0; // wird unten aus missionRewards() übernommen
    const lines = [];
    // Aliens & Artefakte: Beute, Prämie und Wertung berechnet missionRewards() (js/game.js, E1 §6.2) nach den Soldaten
    const totalKills = Object.values(r.kills).reduce((a, b) => a + b, 0);
    const artifacts = {};
    const loot = r.ammoLoot; // erbeutete Plasma-Zellen (nur mit erforschtem Plasma)
    // Bewusstlose Aliens werden bei Sieg Gefangene; nicht fangbare Arten zählt missionRewards wie eine Leiche
    if (won) for (const a of this.units.filter((u) => u.team === 'alien' && u.ko)) r.captured[a.spec] = (r.captured[a.spec] || 0) + 1;
    // Zivilisten
    if (site.kind === 'terror') r.civSaved = won ? this.units.filter((u) => u.team === 'civ' && u.alive).length : 0;
    // Soldaten (bewusstlos: bei Sieg gerettet, bei Niederlage vermisst)
    const dead = [], survivors = [];
    for (const u of this.units.filter((x) => x.team === 'player')) {
      const s = u.soldier;
      if (!u.alive && !(u.ko && won)) { if (u.ko) u.mia = true; dead.push(u); c.soldiers = c.soldiers.filter((x) => x.id !== s.id); c.stats.lost++; continue; }
      const promoted = Game.awardXp(s, (u.kills || 0) + (u.captures || 0), true);
      s.wound = Math.ceil(Math.max(0, u.dmgTaken - (u.healed || 0)) / 4);
      survivors.push({ u, promoted });
    }
    // Beute, Prämie, Wertung (E4–E7, E14, E15) – reine Funktion aus game.js
    const rw = missionRewards({
      site, won, aborted, kills: r.kills, captures: r.captured, corpses: r.corpses, lzCells: this.map.lz,
      monthIdx: c.lastMonth || 0, dead: dead.length, civSaved: r.civSaved || 0, civKilled: r.civKilled || 0,
      verhoerVael: Game.has('verhoer_vael'), verhoerKrull: Game.has('verhoer_krull'), hasPlasma: Game.has('plasma'),
    });
    score = rw.score;
    Object.assign(artifacts, rw.artifacts);
    for (const [k, n] of Object.entries(rw.ammoLoot)) loot[k] = (loot[k] || 0) + n;
    r.hiveKills = rw.hiveKills; // E15: geoscape.missionDone() zermürbt damit das Hive-Nest
    // Lager
    for (const [k, n] of Object.entries(artifacts)) c.artifacts[k] = (c.artifacts[k] || 0) + n;
    // gefallene/vermisste Soldaten verlieren ihre mitgeführten Gürtel-Gegenstände (Medi-Kit = 1 Stück)
    // Munition: Magazin zählt als verbraucht, wenn es leer in der Waffe steckt oder der Träger fällt (angebrochene kehren voll zurück)
    const used = (id, n = 1) => { if (id && ITEMS[id] && !ITEMS[id].free) r.itemsUsed[id] = (r.itemsUsed[id] || 0) + n; };
    if (!Game.cheats.allGear) {
      for (const u of dead) { for (const b of u.belt || []) if (b && ITEMS[b.id]) used(b.id); if (u.load && !u.load.none) used(u.load.id); }
      for (const { u } of survivors) if (u.load && !u.load.none && u.load.rounds <= 0) used(u.load.id);
      // nicht ausgelöste Sensorminen werden nach einem Sieg geborgen
      if (won) for (const m of this.mines) if (m.counted && r.itemsUsed[m.id] > 0) r.itemsUsed[m.id]--;
    }
    c.stock ||= {};
    for (const [k, n] of Object.entries(r.itemsUsed)) c.stock[k] = Math.max(0, (c.stock[k] || 0) - n);
    for (const [k, n] of Object.entries(loot)) c.stock[k] = (c.stock[k] || 0) + n;
    const usedTxt = Object.entries(r.itemsUsed).filter(([k, n]) => n > 0 && ITEMS[k]).map(([k, n]) => `${ITEMS[k].icon} ${ITEMS[k].name} ×${n}`).join('<br>');
    const capTxt = Object.entries(r.captured).map(([k, n]) => `${ALIENS[k].name} ×${n}`).join(', ');
    const lootTxt = Object.entries(loot).filter(([, n]) => n > 0).map(([k, n]) => `${ITEMS[k].icon} ${ITEMS[k].name} ×${n}`).join('<br>');
    // tote Soldaten verlieren ihre Ausrüstung
    for (const u of dead) { const s = u.soldier; if (s.weapon !== 'rifle') c.stock[s.weapon] = Math.max(0, (c.stock[s.weapon] || 0) - 1); if (s.armor !== 'none') c.stock[s.armor] = Math.max(0, (c.stock[s.armor] || 0) - 1); }
    const bounty = rw.bounty; // E4: nach Art, Gefangene ×1,5, Rückzug/Niederlage 50 %, Verhör Krull +20 % ist eingerechnet
    c.credits += bounty;
    c.stats.missions++; if (won) c.stats.won++;
    c.stats.kills += totalKills;
    Game.addScore(score, site.region);
    r.score = score;

    setTimeout(() => {
      sfx(won ? 'victory' : 'defeat');
      banner(won ? 'MISSION ERFOLGREICH' : aborted ? 'RÜCKZUG' : 'MISSION GESCHEITERT', '', won ? '' : 'alien');
      setTimeout(() => {
        modal({
          title: won ? '✔ Einsatzbericht – Erfolg' : '✖ Einsatzbericht – Fehlschlag', closable: false, wide: true,
          html: `<div class="grid2"><div>
            <h4>Ergebnis</h4>
            <p>Eliminierte Aliens: <b>${totalKills}</b></p>
            ${capTxt ? `<p>Gefangene: <b class="good">${capTxt}</b></p>` : ''}
            ${site.kind === 'terror' ? `<p>Gerettete Zivilisten: <b class="good">${r.civSaved}</b> · Opfer: <b class="bad">${r.civKilled}</b></p>` : ''}
            <p>Wertung: <b class="${score >= 0 ? 'good' : 'bad'}">${score >= 0 ? '+' : ''}${score}</b></p>
            ${bounty ? `<p>Bergungsprämie${won ? '' : ' (halbe Prämie)'}: <b class="good">${bounty.toLocaleString('de-DE')} ¢</b></p>` : ''}
            ${rw.notes.length ? `<p class="muted">${rw.notes.join('<br>')}</p>` : ''}
            <h4>Geborgene Artefakte</h4><p class="muted">${Object.entries(artifacts).map(([k, n]) => `${k} ×${n}`).join('<br>') || 'Keine'}</p>
            <h4>Verbrauchte Ausrüstung</h4><p class="muted">${usedTxt || 'Keine'}</p>
            ${lootTxt ? `<h4>Erbeutete Munition</h4><p class="muted">${lootTxt}</p>` : ''}</div>
            <div><h4>Trupp</h4>
            ${survivors.map(({ u, promoted }) => `<div class="res-sol">✔ ${u.name} <small>${RANKS[u.soldier.rank]} · ${u.kills} Kills${u.captures ? ` · ${u.captures} Gefangene` : ''}${u.soldier.wound ? ` · verwundet ${u.soldier.wound} T` : ''}</small>${promoted ? ' <b class="good">Beförderung!</b>' : ''}</div>`).join('')}
            ${dead.map((u) => `<div class="res-sol bad">☠ ${u.name} <small>${u.mia ? 'vermisst' : 'gefallen'}</small></div>`).join('')}
            </div></div>`,
          buttons: [{ label: 'Zurück zum Hauptquartier', primary: true, action: () => this.hooks.endMission(site, r) }],
        });
      }, 1400);
    }, 600);
  }

  // ======================= Spieler-Interaktion =======================
  select(u, quiet) {
    if (!u || !u.alive || u.team !== 'player' || u.evac) return;
    const prev = this.selected;
    this.selected = u;
    this.clearTarget();
    if (!quiet) sfx('select');
    this.camT.x = u.obj.position.x; this.camT.z = u.obj.position.z;
    this.cursor = { x: u.x, y: u.y };
    if (this.mode === 'belt' ? (u !== prev || !this.beltEntry(u) || isInstantItem(ITEMS[this.beltEntry(u).id])) : WEAPONS[u.weapon][this.mode] == null) this.mode = this.firstMode(u);
    this.computeRange();
    this.updateHover();
    this.refreshUi();
  }
  cycleUnit(dir) {
    if (this.busy && this.phase === 'player') return;
    const list = this.units.filter((u) => u.team === 'player' && u.alive && !u.evac);
    if (!list.length) return;
    const i = list.indexOf(this.selected);
    this.select(list[i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length]);
  }
  recenter() { const u = this.selected; if (u) { this.camT.x = u.obj.position.x; this.camT.z = u.obj.position.z; } }
  computeRange() {
    const u = this.selected;
    if (!u || this.phase !== 'player') { this.rangeMesh.count = 0; this.reach = null; return; }
    const budget = Game.cheats.infTU ? 80 : u.tu;
    this.reach = this.dijkstra(u, budget);
    const mtx = new THREE.Matrix4();
    let k = 0;
    for (let i = 0; i < this.N; i++) {
      if (this.reach.dist[i] === Infinity || this.reach.dist[i] === 0 || !this.explored[i]) continue;
      const p = this.cellPos(i % this.W, (i / this.W) | 0);
      mtx.makeTranslation(p.x, 0, p.z);
      this.rangeMesh.setMatrixAt(k++, mtx);
    }
    this.rangeMesh.count = k;
    this.rangeMesh.instanceMatrix.needsUpdate = true;
  }
  clearTarget() { this.target = null; this.grenadeTarget = null; this.pendingMove = null; this.tgtRing.visible = false; this.waypoints = []; this.groundTarget = null; this.groundAim = false; }
  // Lenkschuss-Modus aktiv? (Leitwerfer, W1 4.8)
  isGuided(u = this.selected) { const w = u && WEAPONS[u.weapon]; return !!(w && this.mode !== 'belt' && w[this.mode]?.guided); }
  // Waffe/Munition darf auf leere Felder feuern (Bodenziel, W1 4.3)
  canGround(u = this.selected) { const w = u && this.weaponOf(u); return !!(w && !w.melee && this.mode !== 'belt' && !this.isGuided(u) && (w.tile || w.radius)); }
  setMode(m) {
    const u = this.selected; if (!u || this.busy || this.phase !== 'player') return;
    if (m === 'grenade' || m === 'belt') { // Kompatibilität: erster Wurfgegenstand
      const k = this.beltSlots(u).find((i) => !['medkit', 'ammo', 'scanner', 'stunrod'].includes(ITEMS[u.belt[i].id].kind));
      if (k == null) { toast('Keine Wurfgegenstände im Gürtel.', 'warn'); sfx('deny'); return; }
      this.setBelt(k); return;
    }
    if (!WEAPONS[u.weapon][m]) { sfx('deny'); return; }
    if (m !== this.mode) { this.waypoints = []; this.groundAim = false; }
    this.mode = m; this.grenadeTarget = null; sfx('click');
    this.updateHover(); this.refreshUi();
  }
  // Gürtelplatz wählen (erneut wählen = zurück zum Schnappschuss)
  // Sofort-Gegenstände (Magazin, Scanner) lösen per Maus/Touch/Tastatur direkt aus; Controller (pad) wählt nur, Ⓐ löst aus
  setBelt(slot, pad = false) {
    const u = this.selected; if (!u || this.busy || this.phase !== 'player') return;
    if (this.mode === 'belt' && this.beltSlot === slot) { this.setMode(this.firstMode(u)); return; }
    const b = this.beltEntry(u, slot);
    if (!b) { toast('Gürtelplatz leer.', 'warn'); sfx('deny'); return; }
    if (isInstantItem(ITEMS[b.id]) && !pad) { this.useInstant(u, slot); return; }
    this.mode = 'belt'; this.beltSlot = slot; this.grenadeTarget = null; this.pendingMove = null; this.waypoints = []; this.groundTarget = null; this.groundAim = false;
    if (['medkit', 'ammo', 'scanner'].includes(ITEMS[b.id].kind)) { this.target = null; this.tgtRing.visible = false; }
    sfx('click');
    this.updateHover(); this.refreshUi();
  }
  // Controller ▼: Gürtelplätze nacheinander durchschalten, danach zurück zur Waffe
  cycleBelt() {
    const u = this.selected; if (!u) return;
    const slots = this.beltSlots(u);
    if (!slots.length) { toast('Gürtel leer.', 'warn'); sfx('deny'); return; }
    if (this.mode !== 'belt') { this.setBelt(slots[0], true); return; }
    const i = slots.indexOf(this.beltSlot);
    if (i < 0 || i === slots.length - 1) this.setMode(this.firstMode(u)); else this.setBelt(slots[i + 1], true);
  }
  async useInstant(u, slot) {
    if (this.busy) return;
    const it = ITEMS[this.beltEntry(u, slot)?.id];
    await this.useBelt(u, slot, u.x, u.y);
    if (this.mode === 'belt' && (!this.beltEntry(u) || it?.kind === 'ammo' || it?.kind === 'scanner')) this.mode = this.firstMode(u);
    this.afterAction();
  }
  cycleMode() {
    const u = this.selected; if (!u) return;
    const opts = ['snap', 'aimed', 'auto'].filter((m) => WEAPONS[u.weapon][m]).map((m) => ({ m }));
    this.beltSlots(u).filter((k) => !isInstantItem(ITEMS[u.belt[k].id])).forEach((k) => opts.push({ m: 'belt', k }));
    const i = opts.findIndex((o) => o.m === this.mode && (o.m !== 'belt' || o.k === this.beltSlot));
    const n = opts[(i + 1) % opts.length];
    if (n.m === 'belt') { if (this.mode === 'belt' && this.beltSlot === n.k) return; this.setBelt(n.k); } else this.setMode(n.m);
  }
  toggleKneel() {
    const u = this.selected; if (!u || !u.alive || this.busy || this.ended || this.phase !== 'player') return;
    const cost = u.kneel ? STAND_TU : KNEEL_TU;
    if (!this.hasTu(u, cost)) { toast(u.kneel ? `Aufstehen kostet ${STAND_TU} ZE.` : `Knien kostet ${KNEEL_TU} ZE.`, 'warn'); sfx('deny'); return; }
    this.spendTu(u, cost); u.kneel = !u.kneel; sfx('click'); this.computeRange(); this.updateHover(); this.refreshUi();
  }

  // Klick/Tipp/Ⓐ auf ein Feld
  async actAt(x, y, confirmTwice) {
    if (this.busy || this.phase !== 'player' || this.ended || !this.inb(x, y)) return;
    if (this.selected && !this.selected.alive) { this.selected = null; this.cycleUnit(1); }
    const u = this.selected;
    let other = this.unitAt(x, y);
    if (other && u && !this.knownBlocker(u, other)) other = null; // unsichtbare Einheiten nicht verraten
    const item = u && this.mode === 'belt' ? this.beltEntry(u) : null;
    const ik = item && ITEMS[item.id].kind;
    if (u && this.mode === 'belt' && !item) { this.mode = this.firstMode(u); this.refreshUi(); }
    // Sofort-Gegenstand per Controller gewählt: Ⓐ löst aus
    if (item && isInstantItem(ITEMS[item.id])) { await this.useInstant(u, this.beltSlot); return; }
    // Medi-Kit: Klick auf eigenen Soldaten heilt (bzw. weckt Bewusstlose) statt auszuwählen
    const koT = this.koAt(x, y);
    if (ik === 'medkit' && ((other && other.team === 'player') || (!other && koT?.team === 'player'))) {
      const ok = await this.useBelt(u, this.beltSlot, x, y);
      if (ok && !this.beltEntry(u)) this.mode = this.firstMode(u);
      this.afterAction(); return;
    }
    // Lenkschuss: Wegpunkte setzen / kürzen / starten
    if (u && this.isGuided(u)) { await this.guidedClick(u, x, y, other); return; }
    if (other && other.team === 'player' && other !== u) { this.select(other); return; }
    if (!u) return;
    if (other === u && !item && this.needsReload(u)) { this.reload(u); return; } // eigenen Soldaten antippen/Ⓐ bei leerem Magazin = Nachladen
    if (ik === 'medkit') { toast('Medi-Kit: eigenen Soldaten (selbst oder angrenzend) wählen.', 'warn'); sfx('deny'); return; }
    if (ik === 'stunrod') {
      if (other && other.team === 'alien' && this.isVisibleAlien(other)) { await this.useBelt(u, this.beltSlot, x, y); this.afterAction(); return; }
      toast('Schockstab: angrenzendes, sichtbares Alien antippen.', 'warn'); sfx('deny'); return;
    }
    if (item) {
      if (this.grenadeTarget && this.grenadeTarget.x === x && this.grenadeTarget.y === y) {
        this.grenadeArea.visible = false; this.clearPath();
        await this.useBelt(u, this.beltSlot, x, y);
        this.grenadeTarget = null; this.mode = this.firstMode(u); this.afterAction(); return;
      }
      this.grenadeTarget = { x, y }; sfx('click'); this.updateHover(); this.refreshUi(); return;
    }
    if (other && other.team !== 'player' && (other.team === 'civ' ? false : this.isVisibleAlien(other))) {
      if (this.target === other) { await this.fireAtTarget(); return; }
      this.target = other; sfx('select');
      this.tgtRing.visible = true;
      this.refreshUi();
      return;
    }
    if (other && !(this.canGround(u) && other.team !== 'player' && !this.knownBlocker(u, other))) return;
    // Bodenziel (Werfer, Explosiv-/Brand-/Schockmunition): zweiter Klick feuert
    if (this.groundTarget && this.groundTarget.x === x && this.groundTarget.y === y) { await this.fireAtTarget(); return; }
    if (!this.reach) this.computeRange();
    const d = this.reach.dist[y * this.W + x];
    if (this.canGround(u) && (this.groundAim || d === Infinity || d === 0) && !(x === u.x && y === u.y)) {
      if (this.vis[y * this.W + x] && this.canSee(u, x, y)) {
        this.groundTarget = { x, y }; this.target = null; this.tgtRing.visible = false; this.groundAim = false; this.pendingMove = null;
        sfx('click'); this.updateHover(); this.refreshUi(); return;
      }
      if (this.groundAim) { toast('Bodenziel: nur sichtbare Felder in Sichtlinie.', 'warn'); sfx('deny'); return; }
    }
    // Bewegung
    if (d === Infinity || d === 0) { if (this.explored[y * this.W + x]) { sfx('deny'); if (u.kneel && u.tu < STAND_TU + 4) toast(`Aufstehen kostet ${STAND_TU} ZE.`, 'warn', 1800); } return; }
    if (confirmTwice && !(this.pendingMove && this.pendingMove.x === x && this.pendingMove.y === y)) { this.pendingMove = { x, y }; this.cursor = { x, y }; this.updateHover(); sfx('click'); return; }
    this.pendingMove = null;
    this.clearTarget();
    this.clearPath(); this.rangeMesh.count = 0;
    await this.moveUnit(u, this.buildPath(this.reach.prev, x, y));
    this.afterAction();
  }
  async fireAtTarget() {
    const u = this.selected;
    if (!u || !u.alive || this.busy || this.ended || this.phase !== 'player' || this.mode === 'belt') return;
    if (this.needsReload(u)) { toast('Magazin leer – nachladen (N)', 'warn'); sfx('deny'); return; }
    if (this.groundTarget && !this.target) {
      const g = this.groundTarget;
      if (!this.canSee(u, g.x, g.y)) { toast('Keine Sichtlinie zum Bodenziel.', 'warn'); sfx('deny'); return; }
      const gp = this.cellPos(g.x, g.y);
      const pseudo = { x: g.x, y: g.y, ground: true, kneel: false, flying: false, alive: true, armor: 0, obj: { position: new THREE.Vector3(gp.x, 0, gp.z) } };
      this.rangeMesh.count = 0; this.clearPath(); this.grenadeArea.visible = false;
      this.groundTarget = null;
      await this.fire(u, pseudo, this.mode);
      this.afterAction(); return;
    }
    const t = this.target;
    if (!t || !t.alive) return;
    if (!this.canSee(u, t.x, t.y) && !(WEAPONS[u.weapon].melee)) { toast('Keine Sichtlinie zum Ziel.', 'warn'); sfx('deny'); return; }
    this.rangeMesh.count = 0; this.clearPath();
    await this.fire(u, t, this.mode);
    this.afterAction();
  }
  reloadAuto() {
    const u = this.selected;
    if (!u || this.busy || this.phase !== 'player' || this.ended) return;
    this.reload(u);
  }
  // ---- Lenkschuss (W1 4.8) ----
  guidedUndo() { if (!this.waypoints.length) return false; this.waypoints.pop(); sfx('click'); this.updateHover(); this.refreshUi(); return true; }
  async guidedClick(u, x, y, other) {
    const w = WEAPONS[u.weapon], wp = this.waypoints;
    if (other && other.team === 'player') {
      if (other === u) { if (wp.length) { this.waypoints = []; toast('Wegpunkte verworfen.', 'info', 1400); sfx('click'); } }
      else this.select(other);
      this.updateHover(); this.refreshUi(); return;
    }
    const last = wp[wp.length - 1];
    if (last && last.x === x && last.y === y) { await this.launchGuided(u); return; }
    const k = wp.findIndex((p) => p.x === x && p.y === y);
    if (k >= 0) { wp.length = k + 1; sfx('click'); this.updateHover(); this.refreshUi(); return; }
    if (x === u.x && y === u.y) return;
    if (wp.length >= (w.waypoints || 6)) { toast(`Maximal ${w.waypoints || 6} Wegpunkte – letzten Punkt erneut wählen oder „Abfeuern“.`, 'warn'); sfx('deny'); return; }
    const len = this.polyLength(u, [...wp, { x, y }]);
    if (len > w.range) { toast(`Flugstrecke zu lang (max. ${w.range} Felder).`, 'warn'); sfx('deny'); return; }
    wp.push({ x, y }); sfx('click');
    this.updateHover(); this.refreshUi();
  }
  polyLength(u, wps) { let L = 0, a = { x: u.x, y: u.y }; for (const b of wps) { L += Math.hypot(b.x - a.x, b.y - a.y); a = b; } return L; }
  // Flugbahn entlang der Rasterpunkte: halbe Deckung wird überflogen, Vollwände/Einheiten stoppen die Rakete
  guidedTrace(u, wps) {
    const pts = [{ x: u.x, y: u.y }, ...wps], samples = [];
    let hit = null, last = pts[0];
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k], L = Math.hypot(b.x - a.x, b.y - a.y);
      for (let s = 0.25; s <= L + 1e-6; s += 0.25) {
        const fx = a.x + (b.x - a.x) * s / L, fy = a.y + (b.y - a.y) * s / L, cx = Math.round(fx), cy = Math.round(fy);
        samples.push({ fx, fy, blocked: !!hit, seg: k });
        if (hit) continue;
        if (cx === u.x && cy === u.y) continue;
        if (!this.inb(cx, cy)) { hit = last; samples[samples.length - 1].blocked = true; continue; }
        const wl = this.wallAt(cx, cy);
        if ((wl && WALLS[wl.type]?.full) || (() => { const o = this.unitAt(cx, cy); return o && o !== u && o.alive && (o.team === 'player' || this.knownBlocker(u, o) || this._tracing); })()) { hit = { x: cx, y: cy, fx, fy }; continue; }
        last = { x: cx, y: cy, fx, fy };
      }
    }
    return { hit: hit || { ...pts[pts.length - 1], fx: pts[pts.length - 1].x, fy: pts[pts.length - 1].y }, samples, pts };
  }
  async launchGuided(u) {
    if (!u || this.busy || this.ended || this.phase !== 'player') return;
    const w = this.weaponOf(u), mode = this.mode;
    if (!this.waypoints.length) { toast('Lenkschuss: zuerst Wegpunkte auf Felder setzen.', 'warn'); sfx('deny'); return; }
    if (this.needsReload(u)) { toast('Kein Geschoss geladen – nachladen (N)', 'warn'); sfx('deny'); return; }
    const cost = this.modeCost(u, mode);
    if (!this.hasTu(u, cost)) { toast('Nicht genügend Zeiteinheiten.', 'warn'); sfx('deny'); return; }
    this.busy = true;
    this.spendTu(u, cost);
    if (u.load) u.load.rounds = Math.max(0, u.load.rounds - 1);
    this._tracing = true; const tr = this.guidedTrace(u, this.waypoints); this._tracing = false; // echte Einheiten (auch unentdeckte) stoppen die Rakete
    this.waypoints = []; this.clearPath(); this.grenadeArea.visible = false; this.rangeMesh.count = 0;
    const route = [{ fx: u.x, fy: u.y }];
    for (const s of tr.samples) { if (s.blocked) break; route.push(s); if (Math.round(s.fx) === tr.hit.x && Math.round(s.fy) === tr.hit.y) break; }
    this.faceTo(u, Math.round(route[Math.min(2, route.length - 1)].fx), Math.round(route[Math.min(2, route.length - 1)].fy));
    await this.flyAlong(u, route);
    await this.explode(tr.hit.x, tr.hit.y, w.dmg, w.radius, u, { dtype: w.dtype, burn: w.burn || 0 });
    this.busy = !!this.ended;
    this.afterAction();
  }
  async flyAlong(u, route) {
    const spd = this.engine.settings.animSpeed || 1, p0 = this.cellPos(0, 0);
    const P = route.map((r) => new THREE.Vector3(p0.x + r.fx * TILE, 1.6, p0.z + r.fy * TILE));
    P[0] = this.muzzleWorld(u);
    sfx('launch'); this.flash(P[0], 0xffa040, 8);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.6, 0.6), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(this.tracerGeo, mat); mesh.scale.set(2.6, 2.6, 0.8); this.scene.add(mesh);
    const seg = []; let total = 0;
    for (let i = 1; i < P.length; i++) { const l = P[i - 1].distanceTo(P[i]); seg.push(l); total += l; }
    let d = 0; const v = new THREE.Vector3(), look = new THREE.Vector3();
    while (d < total && !this.disposed) {
      const dt = await this.frame(); d = Math.min(total, d + 25 * TILE * spd * dt);
      let r = d, i = 0; while (i < seg.length - 1 && r > seg[i]) { r -= seg[i]; i++; }
      v.lerpVectors(P[i], P[i + 1], seg[i] ? Math.min(1, r / seg[i]) : 1);
      look.copy(P[i + 1]); mesh.position.copy(v); if (look.distanceToSquared(v) > 1e-6) mesh.lookAt(look);
      this.emit(v.clone(), new THREE.Color(0.32, 0.31, 0.3), 0.2, 0.25, 1.2, false, true);
      this.emit(v.clone(), new THREE.Color(3, 1.5, 0.4), 0, 0.3, 0.2);
      this.camT.x = v.x; this.camT.z = v.z;
    }
    this.scene.remove(mesh); mat.dispose();
  }
  afterAction() {
    if (this.ended) return;
    if (this.selected && !this.selected.alive) { this.selected = null; this.cycleUnit(1); }
    if (this.target && !this.target.alive) this.clearTarget();
    this.computeRange(); this.updateHover(); this.refreshUi();
  }

  // Pfadpunkte und ZE-Zählspur ausblenden
  clearPath() {
    this.pathDots.count = 0;
    this.pathLabelData.length = 0;
    this.syncPathLabels();
  }
  // DOM-Labels der ZE-Zählspur aktualisieren (Text/Farbe nur bei Pfadwechsel; Positionen pro Frame)
  syncPathLabels() {
    const els = this.plabEls; if (!els) return;
    const data = this.pathLabelData, n = Math.min(PATH_LABELS, data.length);
    for (let i = 0; i < n; i++) {
      const d = data[i], e = els[i];
      const txt = String(d.v), cls = `plab ${d.cls}${i === n - 1 ? ' end' : ''}`;
      if (e._t !== txt) { e.textContent = txt; e._t = txt; }
      if (e.className !== cls) e.className = cls;
      if (e._on !== true) { e.style.display = ''; e._on = true; }
    }
    for (let i = n; i < this.plabCount; i++) { els[i].style.display = 'none'; els[i]._on = false; }
    this.plabCount = n;
    if (n) this.placePathLabels();
  }
  placePathLabels() {
    const n = this.plabCount; if (!n) return;
    const els = this.plabEls;
    if (!this.active || this.ended || this.busy || this.phase !== 'player') { for (let i = 0; i < n; i++) els[i].style.visibility = 'hidden'; return; }
    this.camera.updateMatrixWorld();
    const r = this.engine.canvas.getBoundingClientRect();
    const v = this._plabV || (this._plabV = new THREE.Vector3());
    for (let i = 0; i < n; i++) {
      const d = this.pathLabelData[i], p = this.cellPos(d.x, d.y), e = els[i];
      v.set(p.x, 0.25, p.z).project(this.camera);
      if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) { e.style.visibility = 'hidden'; continue; }
      e.style.visibility = '';
      e.style.transform = `translate(${(r.left + (v.x * 0.5 + 0.5) * r.width).toFixed(1)}px,${(r.top + (-v.y * 0.5 + 0.5) * r.height).toFixed(1)}px)`;
    }
  }

  updateHover() {
    const { x, y } = this.cursor;
    if (this.phase !== 'player') { this.cursorMesh.visible = this.cursorFill.visible = false; this.clearPath(); this.grenadeArea.visible = false; const h = document.getElementById('t-hover'); if (h) h.textContent = ''; return; }
    const inb = this.inb(x, y);
    this.cursorMesh.visible = this.cursorFill.visible = inb && this.phase === 'player';
    this.pathDots.count = 0; this.grenadeArea.visible = false;
    this.pathLabelData.length = 0;
    this.hoverInfo = '';
    if (!inb) { this.syncPathLabels(); return; }
    const p = this.cellPos(x, y);
    this.cursorMesh.position.set(p.x, 0.06, p.z); this.cursorFill.position.set(p.x, 0.04, p.z);
    const u = this.selected;
    const other = this.unitAt(x, y);
    let col = new THREE.Color(2, 2, 2);
    const item = u && this.mode === 'belt' ? this.beltEntry(u) : null;
    const it = item && ITEMS[item.id];
    const ownInRadius = (cx, cy, r) => this.units.some((o) => o.team === 'player' && (o.alive || o.ko) && Math.hypot(o.x - cx, o.y - cy) <= r);
    const showArea = (cx, cy, r, kind) => {
      const pp = this.cellPos(cx, cy);
      this.grenadeArea.visible = true; this.grenadeArea.position.set(pp.x, 0.07, pp.z); this.grenadeArea.scale.setScalar(r * TILE);
      this.grenadeArea.material.color.set(ITEM_COLORS[kind] || ITEM_COLORS.grenade).multiplyScalar(2.2);
      this.grenadeArea.material.opacity = 0.18;
    };
    const wEff = u && this.weaponOf(u), dk = wEff?.dtype === 'stun' ? 'stun' : wEff?.dtype === 'fire' ? 'fire' : 'grenade';
    const warn = (cx, cy, r) => (ownInRadius(cx, cy, r) ? ' · ⚠ eigener Soldat im Radius' : '');
    const koHere = this.koAt(x, y);
    if (u && this.phase === 'player' && !this.busy && this.isGuided(u)) {
      // Lenkschuss-Vorschau: Polygonzug (Cyan) bis zum ersten Hindernis, danach rot; nummerierte Wegpunkte
      const w = WEAPONS[u.weapon], wp = this.waypoints;
      const tentative = !(other && this.knownBlocker(u, other)) && !wp.some((q) => q.x === x && q.y === y) && !(x === u.x && y === u.y) && wp.length < (w.waypoints || 6);
      const pts = tentative ? [...wp, { x, y }] : wp;
      if (pts.length) {
        const tr = this.guidedTrace(u, pts), p0 = this.cellPos(0, 0), mtx = new THREE.Matrix4(), c = new THREE.Color();
        const step = Math.max(2, Math.ceil(tr.samples.length / 80));
        let n = 0;
        for (let i = 0; i < tr.samples.length && n < 80; i += step) {
          const s = tr.samples[i];
          const tent = tentative && s.seg === pts.length; // noch nicht gesetzter Abschnitt zum Cursor: blasser
          mtx.makeTranslation(p0.x + s.fx * TILE, 0.9, p0.z + s.fy * TILE); this.pathDots.setMatrixAt(n, mtx);
          this.pathDots.setColorAt(n, s.blocked ? c.setRGB(2.6, 0.35, 0.3) : tent ? c.setRGB(0.6, 1.6, 2) : c.setRGB(0.3, 2.2, 2.8));
          n++;
        }
        this.pathDots.count = n; this.pathDots.instanceMatrix.needsUpdate = true; if (this.pathDots.instanceColor) this.pathDots.instanceColor.needsUpdate = true;
        wp.forEach((q, i) => this.pathLabelData.push({ x: q.x, y: q.y, v: `WP ${i + 1}`, cls: 'ok' }));
        const lastP = pts[pts.length - 1], early = tr.hit.x !== lastP.x || tr.hit.y !== lastP.y;
        this.pathLabelData.push({ x: tr.hit.x, y: tr.hit.y, v: early ? '💥 Aufschlag' : '💥', cls: early ? 'no' : 'mv' });
        showArea(tr.hit.x, tr.hit.y, w.radius || 4, 'grenade');
        const len = this.polyLength(u, pts);
        this.hoverInfo = `Lenkschuss: ${wp.length}/${w.waypoints || 6} Wegpunkte · Strecke ${len.toFixed(0)}/${w.range} F. · ${this.modeCost(u, this.mode)} ZE${early ? ' · ⚠ Hindernis – Aufschlag vorher' : ''}${warn(tr.hit.x, tr.hit.y, w.radius || 4)}${wp.length ? ' · letzten Wegpunkt erneut wählen = Abfeuern' : ' · Feld wählen = Wegpunkt setzen'}`;
        col = len > w.range ? new THREE.Color(2.5, 0.4, 0.3) : new THREE.Color(0.4, 2.2, 2.8);
      } else { this.hoverInfo = `Lenkschuss: Wegpunkte auf Felder setzen (max. ${w.waypoints || 6}), dann „Abfeuern“`; col = new THREE.Color(0.4, 2.2, 2.8); }
      if (this.needsReload(u)) this.hoverInfo += ' · Kein Geschoss geladen (N)';
    } else if (u && this.phase === 'player' && !this.busy) {
      if (it && it.kind === 'stunrod') {
        const near = other && other.team === 'alien' && other.alive && this.isVisibleAlien(other) && Math.max(Math.abs(other.x - u.x), Math.abs(other.y - u.y)) <= 1;
        if (near) { this.hoverInfo = `Schockstab: ${other.name} · Treffer ${Math.round(this.stunrodChance(u, other, it) * 100)} % · ${this.itemCost(u, item.id)} ZE${other.stun ? ` · Betäubung ${other.stun}/${other.hp}` : ''}`; col = new THREE.Color(0.6, 1.4, 3); }
        else { this.hoverInfo = 'Schockstab: angrenzendes, sichtbares Alien wählen'; col = new THREE.Color(2, 0.6, 0.3); }
      } else if (it && isInstantItem(it)) {
        this.hoverInfo = it.kind === 'ammo' ? `${it.icon} ${it.name}: Ⓐ/Klick = nachladen (${this.reloadCost(u)} ZE)` : `${it.name}: Ⓐ/Klick = scannen (${this.itemCost(u, item.id)} ZE, Radius ${it.radius} F.)`;
      } else if (it && it.kind === 'medkit') {
        if (koHere && koHere.team === 'player' && !other) {
          const nearKo = Math.max(Math.abs(koHere.x - u.x), Math.abs(koHere.y - u.y)) <= 1;
          this.hoverInfo = nearKo ? `Medi-Kit: ${koHere.name} wecken (bewusstlos) – ${this.itemCost(u, item.id)} ZE` : `${koHere.name} ist bewusstlos – Medi-Kit nur auf angrenzende Felder`;
          col = nearKo ? new THREE.Color(0.5, 2.8, 1.2) : new THREE.Color(2, 0.6, 0.3);
        } else {
        const near = other && other.team === 'player' && other.alive && Math.max(Math.abs(other.x - u.x), Math.abs(other.y - u.y)) <= 1;
        const left = Game.cheats.allGear ? '∞' : item.uses;
        if (!near) { this.hoverInfo = `Medi-Kit (${left} Ladung${item.uses === 1 ? '' : 'en'}): eigenen Soldaten – selbst oder angrenzend – wählen`; col = new THREE.Color(2, 0.6, 0.3); }
        else if (other.hp >= other.maxHp) { this.hoverInfo = `${other.name}: unverletzt (${other.hp}/${other.maxHp} LP)`; col = new THREE.Color(1.5, 1.5, 1.5); }
        else { this.hoverInfo = `Medi-Kit: ${other === u ? 'selbst' : other.name} heilen (+${Math.min(it.heal, other.maxHp - other.hp)} LP) – ${this.itemCost(u, item.id)} ZE · ${left} Ladung${item.uses === 1 ? '' : 'en'}`; col = new THREE.Color(0.5, 2.8, 1.2); }
        }
      } else if (it) {
        const area = it.radius || (it.kind === 'mine' ? it.trigger : 1);
        showArea(x, y, area, it.kind);
        this.grenadeArea.material.opacity = it.kind === 'flare' ? 0.1 : 0.18;
        const d = Math.hypot(x - u.x, y - u.y), range = it.throwRange || THROW_RANGE;
        const verb = it.kind === 'mine' ? 'legen' : it.kind === 'charge' ? 'platzieren (zündet am Zugende)' : 'werfen';
        this.hoverInfo = d > range ? `Außer Reichweite (max. ${range} F.)` : `${it.name} ${verb} – ${this.itemCost(u, item.id)} ZE${this.grenadeTarget ? ' · erneut bestätigen' : ''}${it.dmg ? warn(x, y, area) : ''}`;
        col = d > range ? new THREE.Color(2, 0.6, 0.3) : new THREE.Color(2.5, 1.2, 0.3);
      } else if (other && other.team === 'alien' && this.isVisibleAlien(other)) {
        const c = this.hitChance(u, other, this.mode);
        this.hoverInfo = `${other.name} · Treffer ${Math.round(c * 100)} % · ${this.modeCost(u, this.mode)} ZE${this.coverBetween(u, other) ? ' · in Deckung' : ''}${this.inSmoke(other.x, other.y) ? ' · im Rauch' : ''}${other.stun ? ` · ⚡ ${other.stun}/${other.hp}` : ''}`;
        if (wEff?.radius) { showArea(other.x, other.y, wEff.radius, dk); this.hoverInfo += warn(other.x, other.y, wEff.radius); }
        if (this.needsReload(u)) this.hoverInfo += ' · Magazin leer (N)';
        col = new THREE.Color(3, 0.4, 0.4);
      } else if (!other && this.canGround(u) && (this.groundAim || (this.groundTarget && this.groundTarget.x === x && this.groundTarget.y === y) || !(this.reach && this.reach.dist[y * this.W + x] > 0 && this.reach.dist[y * this.W + x] < Infinity)) && this.vis[y * this.W + x] && !(x === u.x && y === u.y)) {
        // Bodenziel
        const r = wEff.radius || 1;
        showArea(x, y, r, dk);
        const see = this.canSee(u, x, y);
        const c = see ? this.hitChance(u, { x, y, kneel: false, flying: false, ground: true }, this.mode) : 0;
        this.hoverInfo = see ? `Bodenziel · Treffer ${Math.round(c * 100)} % · ${this.modeCost(u, this.mode)} ZE${warn(x, y, r)}${this.groundTarget?.x === x && this.groundTarget?.y === y ? ' · erneut wählen = Feuer' : ''}${this.needsReload(u) ? ' · Magazin leer (N)' : ''}` : 'Bodenziel: keine Sichtlinie';
        col = see ? new THREE.Color(2.8, 1.2, 0.3) : new THREE.Color(2, 0.6, 0.3);
      } else if (!other && this.reach) {
        const d = this.reach.dist[y * this.W + x];
        if (d < Infinity && d > 0) {
          const path = this.buildPath(this.reach.prev, x, y);
          const mtx = new THREE.Matrix4(), c = new THREE.Color();
          const inf = Game.cheats.infTU, snap = this.modeCost(u, 'snap');
          const left = u.tu - d;
          const n = Math.min(80, path.length);
          // ZE-Zählspur: verbleibende ZE nach jedem Schritt (grün = Schnappschuss noch möglich, gelb = nur Bewegung)
          for (let i = 0; i < n; i++) {
            const s = path[i], pp = this.cellPos(s.x, s.y);
            const rem = inf ? u.tu : u.tu - this.reach.dist[s.y * this.W + s.x];
            const ok = inf || rem >= snap;
            mtx.makeTranslation(pp.x, 0.2, pp.z); this.pathDots.setMatrixAt(i, mtx);
            this.pathDots.setColorAt(i, ok ? c.setRGB(0.4, 2.5, 1.2) : rem >= 0 ? c.setRGB(2.5, 1.8, 0.3) : c.setRGB(2.5, 0.4, 0.3));
          }
          const first = Math.max(0, path.length - PATH_LABELS);
          for (let i = first; i < path.length; i++) {
            const s = path[i];
            const rem = inf ? u.tu : u.tu - this.reach.dist[s.y * this.W + s.x];
            this.pathLabelData.push({ x: s.x, y: s.y, v: Math.max(0, rem), cls: inf || rem >= snap ? 'ok' : rem >= 0 ? 'mv' : 'no' });
          }
          this.pathDots.count = n;
          this.pathDots.instanceMatrix.needsUpdate = true; if (this.pathDots.instanceColor) this.pathDots.instanceColor.needsUpdate = true;
          this.hoverInfo = `Bewegen: ${d} ZE${u.kneel ? ` (inkl. Aufstehen ${STAND_TU})` : ''} (Rest ${Math.max(0, left)})${this.pendingMove ? ' · erneut tippen zum Bestätigen' : ''}${this.burning(x, y) ? ' · 🔥 Feuer!' : ''}${this.charges.some((q) => Math.hypot(q.x - x, q.y - y) <= ITEMS[q.id].radius) ? ' · ⚠ im Sprengradius' : ''}`;
          col = new THREE.Color(0.5, 2.5, 1.5);
        } else if (this.explored[y * this.W + x]) { this.hoverInfo = koHere ? `${koHere.name} · bewusstlos` : 'Nicht erreichbar'; col = new THREE.Color(2, 0.6, 0.3); }
      }
      if (!it && this.groundTarget && !(this.groundTarget.x === x && this.groundTarget.y === y) && wEff?.radius) showArea(this.groundTarget.x, this.groundTarget.y, wEff.radius, dk);
      if (this.charges.some((q) => Math.hypot(q.x - u.x, q.y - u.y) <= ITEMS[q.id].radius) && !this.hoverInfo.includes('Sprengradius')) this.hoverInfo += `${this.hoverInfo ? ' · ' : ''}⚠ ${u.name} im Sprengradius`;
    }
    this.syncPathLabels();
    this.cursorMesh.material.color.copy(col);
    const hi = document.getElementById('t-hover'); if (hi) hi.textContent = this.hoverInfo;
  }

  // ======================= HUD =======================
  buildHud() {
    const hud = document.getElementById('hud');
    hud.innerHTML = `
      <div class="tac-plabels" id="t-plab"></div>
      <div class="tac-top">
        <div class="panel tac-turn"><b id="t-turn">Runde 1</b><span id="t-phase">Dein Zug</span></div>
        <div class="tac-aliens" id="t-aliens"></div>
        <button class="btn icon" id="t-menu" title="Menü">☰</button>
      </div>
      <div class="tac-hover" id="t-hover"></div>
      <div class="panel" id="t-guide" style="display:none;position:fixed;top:calc(96px + var(--safe-t, 0px));left:50%;transform:translateX(-50%);gap:6px;align-items:center;padding:6px 8px;max-width:94vw;flex-wrap:wrap;justify-content:center;z-index:5">
        <span id="t-guide-txt" style="font-weight:600">⌖ Lenkschuss</span>
        <button class="btn" data-a="g-fire" title="Rakete starten (F)">⤳ Abfeuern</button>
        <button class="btn" data-a="g-undo" title="Letzten Wegpunkt zurücknehmen (Rechtsklick / Rücktaste / Ⓑ)">↶ Wegpunkt</button>
        <button class="btn" data-a="g-cancel" title="Alle Wegpunkte verwerfen (Esc)">✖ Abbrechen</button>
      </div>
      <div class="tac-bottom">
        <div class="panel unit-card" id="t-unit"></div>
        <div class="tac-actions" id="t-actions">
          <button class="btn act" data-mode="snap"><b>⌖ Schnellschuss</b><small id="m-snap"></small></button>
          <button class="btn act" data-mode="aimed"><b>⌖ Gezielt</b><small id="m-aimed"></small></button>
          <button class="btn act" data-mode="auto"><b>⌖ Salve</b><small id="m-auto"></small></button>
          ${Array.from({ length: BELT_SLOTS }, (_, k) => `<button class="btn act belt" data-belt="${k}" title="Gürtelplatz ${k + 1} (Taste ${k + 4})"><b>Gürtel</b><small>leer</small></button>`).join('')}
          <button class="btn act fire" data-a="fire"><b>FEUER</b><small id="m-fire"></small></button>
          <button class="btn act" data-a="kneel"><b>Knien</b><small id="m-kneel">4 ZE</small></button>
          <button class="btn act" data-a="prev"><b>◀</b><small>Soldat</small></button>
          <button class="btn act" data-a="next"><b>▶</b><small>Soldat</small></button>
          <button class="btn act end" data-a="end"><b>Zug beenden</b><small id="m-end"></small></button>
          <button class="btn act danger" data-a="abort"><b>⚑</b><small>Rückzug</small></button>
        </div>
      </div>
      <div class="pad-hints" id="t-padhint"></div>`;
    // HUD-Buttons behalten keinen Fokus, damit Leertaste/Enter weiter als Tastenkürzel wirken
    hud.querySelectorAll('.tac-actions .btn, #t-menu, #t-guide .btn').forEach((b) => b.addEventListener('pointerdown', (e) => e.preventDefault()));
    hud.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { b.blur(); this.setMode(b.dataset.mode); }));
    hud.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => { b.blur(); this.btnAction(b.dataset.a); }));
    hud.querySelectorAll('[data-belt]').forEach((b) => b.addEventListener('click', () => { b.blur(); this.setBelt(+b.dataset.belt); }));
    // Pool für die ZE-Zählspur (wird wiederverwendet, nie pro Frame neu angelegt)
    const plab = hud.querySelector('#t-plab');
    this.plabEls = Array.from({ length: PATH_LABELS }, () => { const e = document.createElement('span'); e.className = 'plab'; e.style.display = 'none'; plab.appendChild(e); return e; });
    this.plabCount = 0;
    hud.querySelector('#t-menu').addEventListener('click', () => this.hooks.openMenu());
    this.updatePadHints();
  }
  btnAction(a) {
    if (a === 'fire') {
      const u = this.selected;
      if (!u || this.busy || this.phase !== 'player') return;
      if (this.isGuided(u)) { if (this.needsReload(u)) this.reloadAuto(); else this.launchGuided(u); }
      else if (this.mode === 'belt' && this.grenadeTarget) this.actAt(this.grenadeTarget.x, this.grenadeTarget.y, false);
      else if (this.mode !== 'belt' && this.needsReload(u)) this.reloadAuto();
      else if (this.target || this.groundTarget) this.fireAtTarget();
      else if (this.canGround(u)) { this.groundAim = !this.groundAim; sfx('click'); if (this.groundAim) toast('Bodenziel: sichtbares Feld antippen, erneut antippen oder FEUER = Schuss.', 'info', 2600); this.updateHover(); this.refreshUi(); }
    }
    if (a === 'reload') this.reloadAuto();
    if (a === 'g-fire') { const u = this.selected; if (u && this.isGuided(u)) this.launchGuided(u); }
    if (a === 'g-undo') this.guidedUndo();
    if (a === 'g-cancel') { this.waypoints = []; sfx('click'); this.updateHover(); this.refreshUi(); }
    if (a === 'kneel') this.toggleKneel();
    if (a === 'prev') this.cycleUnit(-1);
    if (a === 'next') this.cycleUnit(1);
    if (a === 'end') this.confirmEndTurn();
    if (a === 'abort') this.abort();
  }
  async confirmEndTurn() {
    if (this.busy || this.phase !== 'player') return;
    const idle = this.units.filter((u) => u.team === 'player' && u.alive && !u.evac && u.tu === u.maxTu).length;
    if (idle >= 2 && !Game.cheats.infTU && this.engine.settings.confirmEnd !== false) {
      if (!(await confirmBox(`${idle} Soldaten haben noch nicht gehandelt. Zug wirklich beenden?`, 'Zug beenden'))) return;
    }
    this.endTurn();
  }
  updatePadHints() {
    const h = document.getElementById('t-padhint'); if (!h) return;
    h.innerHTML = `<span>${padLabel('A')} Aktion</span><span>${padLabel('X')} Modus</span><span>${padLabel('Y')} Knien</span><span>${padLabel('B')} Abbruch</span><span>${padLabel('LB')}/${padLabel('RB')} Soldat</span><span>✚◀▶ Ziel</span><span>✚▼ Gürtel</span><span>${padLabel('SELECT')} Zug beenden</span><span>${padLabel('START')} Menü</span>`;
  }
  updateAlienBadges() {
    const box = document.getElementById('t-aliens'); if (!box) return;
    const seen = this.units.filter((u) => u.team === 'alien' && u.alive && this.isVisibleAlien(u));
    box.innerHTML = seen.map((u, i) => `<button class="alien-badge ${this.target === u ? 'on' : ''}" data-alien="${u.id}" title="${u.name}">${i + 1}</button>`).join('');
    box.querySelectorAll('[data-alien]').forEach((b) => b.addEventListener('click', () => { const a = this.units[+b.dataset.alien]; this.focusAlien(a); }));
  }
  focusAlien(a) {
    if (!a || this.busy || this.phase !== 'player') return;
    this.cursor = { x: a.x, y: a.y };
    this.camT.x = a.obj.position.x; this.camT.z = a.obj.position.z;
    if (this.mode === 'belt' || this.isGuided()) { this.mode = this.mode === 'belt' ? this.firstMode(this.selected) : this.mode; this.waypoints = []; }
    this.groundTarget = null; this.groundAim = false;
    this.target = a; this.tgtRing.visible = true; sfx('select');
    this.updateHover(); this.refreshUi();
  }
  cycleAlien(dir) {
    const seen = this.units.filter((u) => u.team === 'alien' && u.alive && this.isVisibleAlien(u));
    if (!seen.length) { sfx('deny'); return; }
    const i = seen.indexOf(this.target);
    this.focusAlien(seen[i < 0 ? (dir > 0 ? 0 : seen.length - 1) : (i + dir + seen.length) % seen.length]);
  }
  refreshUi() {
    const u = this.selected;
    const t = document.getElementById('t-turn'); if (!t) return;
    t.textContent = `Runde ${this.turn}`;
    document.getElementById('t-phase').textContent = this.phase === 'player' ? 'Dein Zug' : 'Alien-Aktivität …';
    document.body.classList.toggle('alien-phase', this.phase !== 'player');
    const card = document.getElementById('t-unit');
    if (u) {
      const W0 = WEAPONS[u.weapon], ld = u.load && ITEMS[u.load.id];
      const magTxt = W0.mag ? ` · <span class="${u.load?.rounds > 0 ? '' : 'bad'}">${ld?.icon || '▮'} ${u.load?.rounds ?? 0}/${W0.mag}${ld && u.load.id !== defaultLoad(u.weapon) ? ` ${ld.short}` : ''}</span>` : ' · ∞';
      card.innerHTML = `<div class="uc-head"><span class="rank r${u.rank}">${'★'.repeat(u.rank) || '•'}</span><b>${u.name}</b><small>${RANKS[u.rank]} · ${W0.icon ? W0.icon + ' ' : ''}${W0.name}${magTxt}${u.kneel ? ' · kniend' : ''}</small></div>
        <div class="uc-bars"><label>ZE</label>${bar(Game.cheats.infTU ? u.maxTu : u.tu, u.maxTu, 'tu')}<label>LP</label>${bar(u.hp, u.maxHp, u.hp < u.maxHp * 0.4 ? 'bad' : 'good')}</div>
        <div class="uc-extra uc-belt">Gürtel: ${(u.belt || []).filter((b) => b && ITEMS[b.id]).map((b) => `<span>${ITEMS[b.id].icon} ${ITEMS[b.id].short}${ITEMS[b.id].kind === 'medkit' ? ` (${Game.cheats.allGear ? '∞' : b.uses})` : ITEMS[b.id].kind === 'ammo' ? ` ${b.rounds ?? W0.mag}` : ''}</span>`).join(' · ') || 'leer'}</div>
        <div class="uc-extra">Kills: ${u.kills}${u.captures ? ` · Gefangene: ${u.captures}` : ''} · Treff: ${u.acc}${u.stun ? ` · ⚡ ${u.stun}` : ''}${this.inSmoke(u.x, u.y) ? ' · im Rauch' : ''}${this.burning(u.x, u.y) ? ' · 🔥' : ''}</div>`;
      const w = WEAPONS[u.weapon], empty = this.needsReload(u);
      const LBL = { snap: '⌖ Schnellschuss', aimed: '⌖ Gezielt', auto: '⌖ Salve' };
      for (const m of ['snap', 'aimed', 'auto']) {
        const b = document.querySelector(`[data-mode="${m}"]`);
        const ok = !!w[m];
        b.disabled = !ok || this.phase !== 'player';
        b.classList.toggle('active', this.mode === m);
        const lb = w[m]?.guided ? '⌖ Lenkschuss' : LBL[m];
        if (b.firstElementChild && b.firstElementChild.textContent !== lb) b.firstElementChild.textContent = lb;
        const chance = this.target && ok && !w[m].guided ? ` · ${Math.round(this.hitChance(u, this.target, m) * 100)}%` : '';
        document.getElementById('m-' + m).textContent = ok ? (empty ? 'leer' : `${this.modeCost(u, m)} ZE${chance}`) : '—';
      }
      // Gürtel: bis zu BELT_SLOTS Buttons (leere Plätze ausgeblendet)
      const slots = this.beltSlots(u);
      for (let k = 0; k < BELT_SLOTS; k++) {
        const bt = document.querySelector(`[data-belt="${k}"]`); if (!bt) continue;
        const b = this.beltEntry(u, k), it = b && ITEMS[b.id];
        bt.style.display = it || (!slots.length && k === 0) ? '' : 'none';
        const html = it ? `<b><span class="bi">${it.icon}</span>${it.short}${it.kind === 'ammo' ? ` ${b.rounds ?? w.mag}` : ''}</b><small>${it.kind === 'ammo' ? `Laden · ${this.reloadCost(u)} ZE` : `${this.itemCost(u, b.id)} ZE`}${it.kind === 'medkit' ? ` · ${Game.cheats.allGear ? '∞' : b.uses}×` : ''}</small>` : '<b>Gürtel</b><small>leer</small>';
        if (bt._h !== html) { bt.innerHTML = html; bt._h = html; }
        bt.title = it ? `${it.name}${it.kind === 'ammo' ? ' – antippen = sofort nachladen' : it.kind === 'scanner' ? ' – antippen = scannen' : ''} (Taste ${k + 4})` : 'Gürtel leer';
        bt.disabled = !it || this.phase !== 'player' || this.busy;
        bt.classList.toggle('active', this.mode === 'belt' && this.beltSlot === k && !!it);
      }
      const bi = this.mode === 'belt' ? this.beltEntry(u) : null;
      const fb = document.querySelector('[data-a="fire"]');
      const guided = this.isGuided(u), reloadNow = !bi && empty;
      fb.disabled = this.phase !== 'player' || this.busy || !(reloadNow ? this.autoAmmoSlot(u) != null : guided ? this.waypoints.length > 0 : ((this.target || this.groundTarget) && this.mode !== 'belt') || (bi && this.grenadeTarget) || (!bi && this.canGround(u)));
      const fl = reloadNow ? 'Nachladen' : guided ? 'Start' : 'FEUER';
      if (fb.firstElementChild && fb.firstElementChild.textContent !== fl) fb.firstElementChild.textContent = fl;
      { const mk = document.getElementById('m-kneel'); if (mk) { mk.textContent = `${u.kneel ? STAND_TU : KNEEL_TU} ZE`; mk.previousElementSibling.textContent = u.kneel ? 'Aufstehen' : 'Knien'; } }
      document.getElementById('m-fire').textContent = reloadNow ? (this.autoAmmoSlot(u) != null ? `${this.reloadCost(u)} ZE` : 'kein Magazin') : guided ? `${this.waypoints.length} WP` : this.target && this.mode !== 'belt' ? `${Math.round(this.hitChance(u, this.target, this.mode) * 100)} %` : this.groundTarget && !bi ? 'Bodenziel' : bi && this.grenadeTarget ? (ITEMS[bi.id].kind === 'mine' ? 'legen' : 'werfen') : bi && ITEMS[bi.id].kind === 'medkit' ? 'Soldat wählen' : bi && ITEMS[bi.id].kind === 'stunrod' ? 'Alien wählen' : this.groundAim ? 'Feld wählen' : this.canGround(u) ? 'Ziel/Boden' : 'Ziel wählen';
      // Lenkschuss-Leiste
      const gp = document.getElementById('t-guide');
      if (gp) {
        const show = guided && this.phase === 'player';
        gp.style.display = show ? 'flex' : 'none';
        if (show) {
          const wm = WEAPONS[u.weapon];
          document.getElementById('t-guide-txt').textContent = `⌖ Lenkschuss · ${this.waypoints.length}/${wm.waypoints || 6} Wegpunkte`;
          gp.querySelector('[data-a="g-fire"]').disabled = this.busy || !this.waypoints.length || empty;
          gp.querySelector('[data-a="g-undo"]').disabled = this.busy || !this.waypoints.length;
          gp.querySelector('[data-a="g-cancel"]').disabled = this.busy || !this.waypoints.length;
        }
      }
    } else { const gp = document.getElementById('t-guide'); if (gp) gp.style.display = 'none'; }
    document.querySelectorAll('.tac-actions .btn').forEach((b) => { if (!b.dataset.mode && b.dataset.belt == null && b.dataset.a !== 'fire') b.disabled = this.phase !== 'player' || this.busy && b.dataset.a !== 'abort'; });
    document.getElementById('m-end').textContent = this.phase === 'player' ? `Runde ${this.turn}` : '…';
    this.updateAlienBadges();
  }

  // ======================= Eingabe =======================
  bindInput() {
    const cv = this.engine.canvas;
    const ray = new THREE.Raycaster();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pick = (cx, cy) => {
      const r = cv.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), this.camera);
      // Einheiten bevorzugen
      let best = null, bd = 0.9;
      for (const u of this.units) {
        if (!u.alive || !u.obj.visible) continue;
        const c = new THREE.Vector3(u.obj.position.x, 1.1, u.obj.position.z);
        const d = ray.ray.distanceToPoint(c);
        if (d < bd) { bd = d; best = u; }
      }
      if (best) return { x: best.x, y: best.y };
      const hit = new THREE.Vector3();
      if (!ray.ray.intersectPlane(groundPlane, hit)) return null;
      return this.posCell(hit.x, hit.z);
    };
    const down = (e) => {
      if (!this.active) return;
      if (e.pointerType === 'touch') Input.setDevice('touch');
      cv.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), btn: e.button, type: e.pointerType });
      if (this.pointers.size >= 2) for (const p of this.pointers.values()) p.moved = true; // Geste, kein Tipp
    };
    const move = (e) => {
      if (!this.active) return;
      const p = this.pointers.get(e.pointerId);
      if (!p) {
        if (e.pointerType === 'mouse') { const c = pick(e.clientX, e.clientY); if (c && (c.x !== this.cursor.x || c.y !== this.cursor.y)) { this.cursor = c; this.updateHover(); } }
        return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d0 = Math.hypot(a.x - b.x, a.y - b.y), ang0 = Math.atan2(b.y - a.y, b.x - a.x);
        p.x = e.clientX; p.y = e.clientY;
        const d1 = Math.hypot(a.x - b.x, a.y - b.y), ang1 = Math.atan2(b.y - a.y, b.x - a.x);
        this.camT.dist = clamp(this.camT.dist * (d0 / d1), 12, 70);
        let dAng = ang1 - ang0;
        if (dAng > Math.PI) dAng -= Math.PI * 2; else if (dAng < -Math.PI) dAng += Math.PI * 2;
        this.camT.yaw += dAng;
        this.pan(dx * 0.5, dy * 0.5);
        p.moved = true;
        return;
      }
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 6) p.moved = true;
      if (!p.moved) return;
      if (p.btn === 2 || p.btn === 1) { this.camT.yaw -= dx * 0.006; this.camT.pitch = clamp(this.camT.pitch + dy * 0.004, 0.45, 1.35); }
      else this.pan(dx, dy);
    };
    const up = (e) => {
      if (!this.active) return;
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (!p || p.moved || this.pointers.size) return;
      if (performance.now() - p.t > 700) return;
      if (p.btn === 2) { if (this.isGuided() && this.guidedUndo()) return; this.clearTarget(); this.updateHover(); this.refreshUi(); return; }
      if (p.btn > 0) return;
      const c = pick(e.clientX, e.clientY);
      if (!c) return;
      this.cursor = c;
      this.updateHover();
      this.actAt(c.x, c.y, p.type === 'touch');
    };
    const wheel = (e) => { if (!this.active) return; e.preventDefault(); this.camT.dist = clamp(this.camT.dist * (1 + Math.sign(e.deltaY) * 0.1), 12, 70); };
    const ctx = (e) => e.preventDefault();
    cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up);
    const cancel = (e) => this.pointers.delete(e.pointerId);
    cv.addEventListener('pointercancel', cancel);
    cv.addEventListener('wheel', wheel, { passive: false }); cv.addEventListener('contextmenu', ctx);
    this.unsub.push(() => { cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', cancel); cv.removeEventListener('wheel', wheel); cv.removeEventListener('contextmenu', ctx); });

    this.unsub.push(Input.on('pad', (b) => {
      if (!this.active || anyModalOpen()) return;
      if (b === 'START') return this.hooks.openMenu();
      if (this.phase !== 'player' || this.busy) return;
      const map = {
        A: () => this.actAt(this.cursor.x, this.cursor.y, false),
        B: () => { if (this.isGuided() && this.guidedUndo()) return; this.clearTarget(); this.mode = this.mode === 'belt' ? this.firstMode(this.selected) : this.mode; this.updateHover(); this.refreshUi(); },
        X: () => this.cycleMode(), Y: () => this.toggleKneel(),
        LB: () => this.cycleUnit(-1), RB: () => this.cycleUnit(1),
        LEFT: () => this.cycleAlien(-1), RIGHT: () => this.cycleAlien(1),
        UP: () => this.recenter(),
        DOWN: () => this.cycleBelt(),
        SELECT: () => this.confirmEndTurn(),
      };
      map[b]?.();
    }));
    this.unsub.push(Input.on('keydown', (code, e) => {
      if (code === 'Tab' && this.active) e?.preventDefault();
      if (!this.active || anyModalOpen()) return;
      if (code === 'Escape') {
        if (this.isGuided() && this.waypoints.length) { this.waypoints = []; this.updateHover(); this.refreshUi(); return; }
        if (this.target || this.mode === 'belt' || this.groundTarget || this.groundAim) { this.clearTarget(); this.mode = this.mode === 'belt' ? this.firstMode(this.selected) : this.mode; this.updateHover(); this.refreshUi(); } else this.hooks.openMenu();
        return;
      }
      if (this.phase !== 'player' || this.busy) return;
      const map = {
        Tab: () => { e?.preventDefault(); this.cycleUnit(e?.shiftKey ? -1 : 1); },
        Digit1: () => this.setMode('snap'), Digit2: () => this.setMode('aimed'), Digit3: () => this.setMode('auto'), Digit4: () => this.setBelt(0), Digit5: () => this.setBelt(1), Digit6: () => this.setBelt(2), KeyG: () => this.setMode('belt'),
        KeyF: () => this.btnAction('fire'), KeyK: () => this.toggleKneel(), KeyC: () => this.toggleKneel(), Enter: () => this.confirmEndTurn(),
        Space: () => this.recenter(), KeyT: () => this.cycleAlien(1),
        KeyN: () => this.reloadAuto(), Backspace: () => { if (this.isGuided()) this.guidedUndo(); },
      };
      map[code]?.();
    }));
    this.unsub.push(Input.on('device', () => this.updatePadHints()));
  }

  pan(dx, dy) {
    const k = this.camT.dist * 0.0018;
    const s = Math.sin(this.camT.yaw), c = Math.cos(this.camT.yaw);
    this.camT.x -= (dx * c + dy * s) * k * 1.0;
    this.camT.z -= (-dx * s + dy * c) * k * 1.0;
    this.clampCam();
  }
  clampCam() {
    const ex = this.W * TILE / 2 + 4, ez = this.H * TILE / 2 + 8;
    this.camT.x = clamp(this.camT.x, -ex, ex); this.camT.z = clamp(this.camT.z, -ex, ez);
  }

  // ======================= Frame-Update =======================
  update(dt) {
    if (!this.active) return;
    // Frame-Promises auflösen (für Animationen)
    const waiters = this._frameWaiters; this._frameWaiters = [];
    waiters.forEach((r) => r(dt));
    // Kamera-Eingabe
    if (!anyModalOpen()) {
      const kk = dt * this.camT.dist * 1.1;
      const s = Math.sin(this.camT.yaw), c = Math.cos(this.camT.yaw);
      let mx = 0, mz = 0;
      if (Input.isDown('KeyW') || Input.isDown('ArrowUp')) mz -= 1;
      if (Input.isDown('KeyS') || Input.isDown('ArrowDown')) mz += 1;
      if (Input.isDown('KeyA') || Input.isDown('ArrowLeft')) mx -= 1;
      if (Input.isDown('KeyD') || Input.isDown('ArrowRight')) mx += 1;
      if (mx || mz) { this.camT.x += (mx * c + mz * s) * kk; this.camT.z += (-mx * s + mz * c) * kk; this.clampCam(); }
      if (Input.isDown('KeyQ')) this.camT.yaw += dt * 1.8;
      if (Input.isDown('KeyE')) this.camT.yaw -= dt * 1.8;
      if (Input.isDown('KeyR')) this.camT.dist = clamp(this.camT.dist - dt * 25, 12, 70);
      if (Input.isDown('KeyV')) this.camT.dist = clamp(this.camT.dist + dt * 25, 12, 70);
      // Controller: Cursor mit linkem Stick, Kamera mit rechtem Stick
      const lx = Input.axis(0), ly = Input.axis(1);
      if (lx || ly) {
        const sp = 9 * dt;
        this.padCursorAcc.x += (lx * c + ly * s) * sp;
        this.padCursorAcc.y += (-lx * s + ly * c) * sp;
        let moved = false;
        while (Math.abs(this.padCursorAcc.x) >= 1) { this.cursor.x = clamp(this.cursor.x + Math.sign(this.padCursorAcc.x), 0, this.W - 1); this.padCursorAcc.x -= Math.sign(this.padCursorAcc.x); moved = true; }
        while (Math.abs(this.padCursorAcc.y) >= 1) { this.cursor.y = clamp(this.cursor.y + Math.sign(this.padCursorAcc.y), 0, this.H - 1); this.padCursorAcc.y -= Math.sign(this.padCursorAcc.y); moved = true; }
        if (moved) { this.updateHover(); const p = this.cellPos(this.cursor.x, this.cursor.y); this.camT.x = lerp(this.camT.x, p.x, 0.25); this.camT.z = lerp(this.camT.z, p.z, 0.25); }
      } else { this.padCursorAcc.x *= 0.8; this.padCursorAcc.y *= 0.8; }
      const rx = Input.axis(2), ry = Input.axis(3);
      if (rx) this.camT.yaw -= rx * dt * 2.2;
      if (ry) this.camT.pitch = clamp(this.camT.pitch + ry * dt * 1.2, 0.45, 1.35);
      const z = Input.trigger('RT') - Input.trigger('LT');
      if (Math.abs(z) > 0.05) this.camT.dist = clamp(this.camT.dist * (1 - z * dt * 1.5), 12, 70);
    }
    for (const k of ['x', 'z', 'yaw', 'pitch', 'dist']) this.cam[k] = smooth(this.cam[k], this.camT[k], k === 'x' || k === 'z' ? 7 : 9, dt);
    this.shake = Math.max(0, this.shake - dt * 2);
    const sh = this.shake * this.shake * 0.6;
    const { x, z, yaw, pitch, dist } = this.cam;
    this.camera.position.set(x + Math.sin(yaw) * Math.cos(pitch) * dist + randRange(-sh, sh), Math.sin(pitch) * dist + randRange(-sh, sh), z + Math.cos(yaw) * Math.cos(pitch) * dist);
    this.camera.lookAt(x, 0.5, z);

    // Einheiten animieren
    const time = this.engine.time;
    this.stepFigureUpgrade();
    for (const u of this.units) {
      const ud = u.obj.userData;
      if (ud.char) { this.updateFigure(u, dt); continue; }
      if (!ud.body) continue;
      if (!u.alive) continue; // Sterbende/Tote werden von deathEffects() animiert
      u.anim.t += dt;
      const walking = u.anim.walk > 0;
      const sw = walking ? Math.sin(u.anim.walk) * 0.6 : 0;
      if (ud.legL) { ud.legL.rotation.x = sw; ud.legR.rotation.x = -sw; }
      if (ud.legL2) { ud.legL2.rotation.x = -sw; ud.legR2.rotation.x = sw; }
      if (u.team === 'civ' && ud.armL) {
        // verängstigt: Hände über dem Kopf, solange ein sichtbares Alien in der Nähe ist
        const scared = !walking && this.units.some((a) => a.team === 'alien' && a.alive && Math.abs(a.x - u.x) + Math.abs(a.y - u.y) < 14 && this.isVisibleAlien(a));
        const k = walking ? 1 : 1 - Math.exp(-10 * dt);
        ud.armL.rotation.x = lerp(ud.armL.rotation.x, scared ? -2.75 : -sw * 0.8, k); ud.armR.rotation.x = lerp(ud.armR.rotation.x, scared ? -2.75 : sw * 0.8, k);
        ud.armL.rotation.z = lerp(ud.armL.rotation.z, scared ? -0.35 : 0, k); ud.armR.rotation.z = lerp(ud.armR.rotation.z, scared ? 0.35 : 0, k);
      }
      if (ud.hover) ud.body.position.y = 0.2 + Math.sin(u.anim.t * 2.5) * 0.12;
      else if (u.alive) {
        const kneelY = u.kneel ? -0.38 : 0;
        ud.body.position.y = smooth(ud.body.position.y, kneelY + (walking ? Math.abs(Math.sin(u.anim.walk)) * 0.06 : Math.sin(u.anim.t * 1.6) * 0.01), 12, dt);
        if (ud.legL && u.kneel && !walking) { ud.legL.rotation.x = -1.3; ud.legR.rotation.x = 0.3; }
      }
    }
    // Auswahlringe
    const sel = this.selected;
    if (sel && sel.alive) {
      this.selRing.visible = this.phase === 'player';
      this.selRing.position.x = sel.obj.position.x; this.selRing.position.z = sel.obj.position.z;
      this.selRing.scale.setScalar(1 + Math.sin(time * 4) * 0.06);
      this.unitLight.position.set(sel.obj.position.x, 3.5, sel.obj.position.z);
    } else this.selRing.visible = false;
    if (this.target && this.target.alive) { this.tgtRing.visible = true; this.tgtRing.position.x = this.target.obj.position.x; this.tgtRing.position.z = this.target.obj.position.z; this.tgtRing.rotation.y += dt * 2; } else this.tgtRing.visible = false;
    // Partikel
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.sp.visible = false; continue; }
      const k = 1 - p.life / p.max;
      p.sp.position.addScaledVector(p.vel, dt);
      if (!p.smoke) p.vel.y -= 4 * dt; else p.vel.multiplyScalar(1 - dt * 1.5);
      p.sp.scale.setScalar(Math.max(0.05, p.size0 + p.grow * k));
      p.sp.material.opacity = (p.smoke ? 0.6 : 1) * (1 - k);
    }
    this.fx = this.fx.filter((f) => f(dt));
    // G6: Hero-Auto-LOD, CSM-Sonne, Transporter-Leuchten
    if (this.heroSets) { const cp = this.camera.position; for (const hs of this.heroSets) hs.update(cp); }
    if (this.csm) { this.csm.update(); if ((this._csmSweep = (this._csmSweep || 0) + dt) > 1) { this._csmSweep = 0; this.csm.setupAll(this.scene); } }
    if (this.transport) animateCraft(this.transport, time, { throttle: 0 });
    if (this.water) this.water.time.value += dt; // Wellen der Wasserflächen
    if (this.smokes.length || this.flares.length) this.updateEffects(dt, time);
    if (this.fireCount || this.fireLight.intensity) this.updateFire(dt);
    if (this.blips.length) for (const b of this.blipRings) if (b.visible) { const s = 1 + 0.25 * Math.sin(time * 5); b.scale.setScalar(s); b.material.opacity = 0.5 + 0.4 * Math.sin(time * 5); }
    this.updateBuildings();
    this.placePathLabels();
    this.updateFog(dt);
  }

  onResize() { if (this.csm) { this.camera.updateProjectionMatrix(); this.csm.updateFrustums(); } }

  // ======================= Lebenszyklus =======================
  activate() {
    this.active = true;
    document.body.dataset.mode = 'tac';
    setMusicMood('tac');
    banner(this.opts.site.kind === 'hive' ? 'FINALE MISSION' : 'EINSATZ BEGINNT', `${this.opts.site.name}${this.map.night ? ' · Nacht' : ''}`);
    this.updateHover(); this.refreshUi();
    if (this.beltShort?.length) { toast(`Lagerbestand reicht nicht – nicht mitgeführt: ${this.beltShort.join(', ')}`, 'warn', 4200); this.beltShort = null; }
  }
  deactivate() { this.active = false; document.body.classList.remove('alien-phase'); if (this.pathLabelData) this.clearPath(); }
  // Cheat-Schnittstellen
  cheatKillAll() { for (const u of this.units) if (u.team === 'alien' && u.alive) this.kill(u, this.selected); }
  cheatReveal() { this.updateVisibility(); }
  cheatHeal() { for (const u of this.units) if (u.team === 'player' && u.alive) { u.hp = u.maxHp; u.tu = u.maxTu; } this.refreshUi(); }
  cheatWin() { this.cheatKillAll(); if (!this.units.some((u) => u.team === 'alien')) this.finish(true); }
  dispose() {
    this.disposed = true; this.ended = true;
    this.deactivate();
    this.unsub.forEach((f) => f());
    // G6: geteilte Ressourcen (Figuren-Bibliothek, Hero-Auto-Bausätze) vor dem allgemeinen Aufräumen herauslösen
    for (const u of this.units) { const ch = u.obj?.userData.char; if (ch) { try { ch.dispose(); } catch { /* */ } u.obj.removeFromParent(); } }
    this.heroSets?.forEach((hs) => hs.dispose());
    this.scene.traverse((o) => { if (o.userData.sharedGeo) o.geometry = null; });
    this.csm?.dispose(); this.csm = null;
    this.groundWeights?.forEach((t) => t.dispose());
    this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.envRT?.dispose(); this.fogTex.dispose(); this.water?.mask.dispose(); this.groundTex.dispose(); this.particleTex?.dispose(); this.smokeTex?.dispose();
    this.smokePool?.forEach((s) => s.material.dispose());
    this.flames?.forEach((s) => s.material.dispose());
    this.sun?.dispose?.();
    this.scene.traverse((o) => { if (o.isInstancedMesh) o.dispose(); if (o.material && !o.isSprite) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (!m.userData.shared) m.dispose(); }); });
    document.getElementById('hud').innerHTML = '';
    this.engine.renderer.toneMappingExposure = 1.0;
    releaseTextures();
  }
}
