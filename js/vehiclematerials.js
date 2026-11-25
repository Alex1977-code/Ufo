// Fahrzeug-Materialpipeline (G2).
// Erkennt Material-Slots (paint, glass, tyre, ...) aus Materialnamen, ersetzt sie durch
// MeshPhysicalMaterial-Presets und prueft, ob ein Modell getrennte Slots hat.
//
// NAMENSKONVENTION (auch fuer prozedurale Autos): mat.name = 'paint' | 'glass' | 'tyre' |
// 'chrome' | 'trim' | 'headlight' | 'taillight' | 'interior' | 'plate' | 'beacon'
// (Prefix 'car_' und Suffix '.001' sind erlaubt: 'car_paint', 'glass.002'). Ein Material darf
// NIE mehrere Slots mischen (kein 'body_glass'). Ein Material je Slot, mehrere Meshes duerfen es teilen.
import * as THREE from 'three';

const T = THREE;

export const VEHICLE_SLOTS = {
  paint:     { required: true,  pattern: /paint|body|lack|karosserie|carrosserie/i },
  glass:     { required: true,  pattern: /glass|window|windshield|scheibe|fenster/i },
  tyre:      { required: true,  pattern: /tyre|tire|reifen|rubber/i },
  chrome:    { required: false, pattern: /chrome|(^|[^a-z])rims?($|[^a-z])|felge|hubcap/i },
  trim:      { required: false, pattern: /trim|plastic|bumper|grille/i },
  headlight: { required: true,  pattern: /head ?_?lights?|front ?_?lights?|whitelights?/i },
  taillight: { required: true,  pattern: /tail ?_?lights?|rear ?_?lights?|brake/i },
  interior:  { required: false, pattern: /interior|seat|dashboard|innen|cabin/i },
  plate:     { required: false, pattern: /plate|licen[sc]e|kennzeichen/i },
  beacon:    { required: false, pattern: /bluelights?|beacon|siren|blaulicht/i }, // Polizei-Extra
};
// Bekannte zusammengesetzte Namen, die zwei Muster treffen wuerden (tyre_trim -> tyre).
const ALIASES = { tyre_trim: 'tyre', chrome_rims: 'chrome', tyre_rim: 'tyre' };
const PRIORITY = ['headlight', 'taillight', 'beacon', 'glass', 'tyre', 'chrome', 'plate', 'interior', 'trim', 'paint'];

const norm = (n) => String(n || '').replace(/\.\d+$/, '').replace(/^car_/i, '').toLowerCase();

/** @returns {{slot:string|null, matches:string[]}} */
export function classifyMaterialName(name) {
  const n = norm(name);
  if (ALIASES[n]) return { slot: ALIASES[n], matches: [ALIASES[n]] };
  const matches = PRIORITY.filter((s) => VEHICLE_SLOTS[s].pattern.test(n));
  return { slot: matches[0] || null, matches };
}

export const PRESETS = {
  paint:     { metalness: 0.5, roughness: 0.35, clearcoat: 1.0, clearcoatRoughness: 0.05, envMapIntensity: 1.0 },
  glass:     { metalness: 0, roughness: 0.05, ior: 1.5, thickness: 0.01, transmission: 1, color: 0x88a0b0, envMapIntensity: 1.2 },
  glassLow:  { metalness: 0, roughness: 0.05, ior: 1.5, color: 0x88a0b0, opacity: 0.35, transparent: true, envMapIntensity: 1.0 },
  chrome:    { metalness: 1, roughness: 0.1, color: 0xffffff, envMapIntensity: 1.2 },
  tyre:      { metalness: 0, roughness: 0.9, color: 0x111111 },
  trim:      { metalness: 0.2, roughness: 0.6 },
  headlight: { color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 4, metalness: 0, roughness: 0.1, headOff: 0.15 },
  taillight: { color: 0x661111, emissive: 0xff1010, emissiveIntensity: 2, metalness: 0, roughness: 0.2, idle: 0.35, brake: 4 },
  interior:  { metalness: 0, roughness: 0.8 },
  plate:     { metalness: 0, roughness: 0.5, color: 0xf0f0f0 },
  beacon:    { emissive: 0x2040ff, emissiveIntensity: 2.5, roughness: 0.2, metalness: 0 },
};

let _flake = null;
/** Prozedurale Metallic-Flakes als kleine Canvas-Normalmap (nur im Browser). */
export function getFlakeNormalMap() {
  if (_flake !== null) return _flake;
  _flake = undefined;
  try {
    if (typeof document === 'undefined') return _flake;
    const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'), img = g.createImageData(N, N);
    let s = 1337; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < N * N; i++) {
      const x = (rnd() - 0.5) * 0.5, y = (rnd() - 0.5) * 0.5, z = Math.sqrt(1 - x * x - y * y);
      img.data[i * 4] = (x * 0.5 + 0.5) * 255; img.data[i * 4 + 1] = (y * 0.5 + 0.5) * 255;
      img.data[i * 4 + 2] = (z * 0.5 + 0.5) * 255; img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(24, 24);
    _flake = t;
  } catch (e) { _flake = undefined; }
  return _flake;
}

function eachMesh(root, fn) {
  root.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) fn(o); });
}
const mats = (m) => (Array.isArray(m.material) ? m.material : [m.material]).filter(Boolean);

function buildMaterial(slot, old, opts) {
  const low = opts.quality === 'low';
  const p = { ...(slot === 'glass' && low ? PRESETS.glassLow : PRESETS[slot]) };
  delete p.headOff; delete p.idle; delete p.brake;
  if (slot === 'glass' && low) p.transmission = 0;
  const m = new T.MeshPhysicalMaterial(p);
  m.name = old.name;
  m.userData.slot = slot;
  // Texturen/Farbe des Originals uebernehmen
  for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) if (old[k]) m[k] = old[k];
  if (old.normalScale && old.normalMap) m.normalScale.copy(old.normalScale);
  if (slot === 'paint') {
    if (opts.paintColor != null) m.color.set(opts.paintColor); else if (old.color) m.color.copy(old.color);
    if (low) { m.clearcoat = 0; m.roughness = 0.45; }
  } else if (slot === 'glass') {
    if (old.map) m.color.set(0xffffff);
  } else if (['trim', 'interior', 'plate', 'tyre', 'chrome'].includes(slot) && old.color && !PRESETS[slot].color) {
    m.color.copy(old.color);
  }
  if (slot === 'beacon' && old.color) { m.color.copy(old.color); m.emissive.copy(old.color); }
  m.side = old.side === T.DoubleSide ? T.DoubleSide : T.FrontSide;
  return m;
}

function setLightState(m, slot, on) {
  if (slot === 'headlight') m.emissiveIntensity = on ? PRESETS.headlight.emissiveIntensity : PRESETS.headlight.headOff;
  else if (slot === 'taillight') m.emissiveIntensity = on ? PRESETS.taillight.brake : PRESETS.taillight.idle;
}

/** Ersetzt Materialien je Slot. Gibt Bericht {replaced:[{mesh,from,to,slot}], unknown:[names], slots} zurueck. */
export function applyVehicleMaterials(root, opts = {}) {
  opts = { quality: 'high', headlightsOn: false, brakeOn: false, flake: true, ...opts };
  const cache = new Map(), report = { replaced: [], unknown: [], slots: {} };
  const flake = opts.quality === 'high' && opts.flake ? getFlakeNormalMap() : undefined;
  eachMesh(root, (mesh) => {
    const arr = mats(mesh), out = arr.map((old) => {
      if (cache.has(old)) return cache.get(old);
      const { slot } = classifyMaterialName(old.name);
      let nm = old;
      if (!slot) { if (!report.unknown.includes(old.name)) report.unknown.push(old.name); }
      else {
        nm = buildMaterial(slot, old, opts);
        if (slot === 'paint' && flake && mesh.geometry?.attributes?.uv && !nm.normalMap) {
          nm.normalMap = flake; nm.normalScale.set(0.15, 0.15);
        }
        setLightState(nm, slot, slot === 'headlight' ? !!opts.headlightsOn : !!opts.brakeOn);
        (report.slots[slot] ||= []).push(old.name);
        report.replaced.push({ mesh: mesh.name, from: old.name, slot });
        mesh.castShadow = slot !== 'glass' ? mesh.castShadow : false;
      }
      cache.set(old, nm); return nm;
    });
    mesh.material = Array.isArray(mesh.material) ? out : out[0];
  });
  return report;
}

/** Prueft getrennte Material-Slots. opts.allowMissing: fehlende Pflicht-Slots nur als Warnung. */
export function validateVehicle(root, opts = {}) {
  const errors = [], warnings = [], slots = {}, seen = new Set(), unknown = [];
  let triangles = 0, meshes = 0;
  eachMesh(root, (mesh) => {
    meshes++;
    const g = mesh.geometry;
    triangles += g.index ? g.index.count / 3 : (g.attributes.position?.count || 0) / 3;
    const nameHint = classifyMaterialName(mesh.name).slot;
    for (const m of mats(mesh)) {
      const { slot, matches } = classifyMaterialName(m.name);
      if (matches.length > 1) {
        const msg = `Material "${m.name}" mischt Slots: ${matches.join('+')}`;
        if (!errors.includes(msg)) errors.push(msg);
      }
      if (slot && ['glass', 'tyre', 'headlight', 'taillight'].includes(nameHint) && slot === 'paint') {
        const msg = `Mesh "${mesh.name}" (${nameHint}) nutzt Karosserie-Material "${m.name}"`;
        if (!errors.includes(msg)) errors.push(msg);
      }
      if (seen.has(m.uuid)) continue;
      seen.add(m.uuid);
      if (!slot) unknown.push(m.name || '(unbenannt)'); else (slots[slot] ||= []).push(m.name);
    }
  });
  for (const [s, d] of Object.entries(VEHICLE_SLOTS)) {
    if (d.required && !slots[s]) {
      const msg = `Pflicht-Slot "${s}" fehlt`;
      (opts.allowMissing ? warnings : errors).push(msg);
    } else if (!d.required && !slots[s]) warnings.push(`Optionaler Slot "${s}" nicht vorhanden`);
  }
  if (unknown.length) warnings.push(`Unbekannte Materialien: ${unknown.join(', ')}`);
  return { ok: errors.length === 0, errors, warnings, slots, unknown, stats: { materials: seen.size, triangles: Math.round(triangles), meshes } };
}

function setSlots(root, names, fn) {
  eachMesh(root, (mesh) => {
    for (const m of mats(mesh)) { const s = m.userData.slot || classifyMaterialName(m.name).slot; if (names.includes(s)) fn(m, s); }
  });
}
/** Scheinwerfer an/aus (emissive; Materialien muessen Slot-Namen tragen, Original- oder ersetzte). */
export function setHeadlights(root, on) { setSlots(root, ['headlight'], (m, s) => setLightState(m, s, !!on)); }
/** Bremslicht an/aus (Ruecklicht hell vs. gedimmt). */
export function setBrake(root, on) { setSlots(root, ['taillight'], (m, s) => setLightState(m, s, !!on)); }
