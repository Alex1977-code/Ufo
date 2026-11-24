// Basis-Ansicht: begehbare/rotierbare 3D-Ansicht des Hauptquartiers (teilversenkte Modulbasis im 6×6-Raster)
// Statische Geometrie wird pro Material zu wenigen Meshes zusammengeführt („Baking“) → wenige Draw-Calls, auch auf dem Handy.
import * as THREE from 'three';
import { canvasTexture } from './engine.js';
import { makeTransport } from './models.js';
import { Game } from './game.js';
import { FACILITIES, CRAFTS } from './data.js';
import { Input, padLabel } from './input.js';
import { el, anyModalOpen, bar } from './ui.js';
import { sfx } from './audio.js';
import { clamp, smooth, DEG } from './util.js';

// ---------- Raster & Maße ----------
const S = 10; // Kantenlänge einer Rasterzelle
const MARGIN = 1.5; // Abstand Modulwand ↔ Zellgrenze (Platz für Verbindungsgänge)
const FLOOR = -4; // Bodenhöhe der Module (Oberfläche = 0)
const TOP = 0.5; // Wandoberkante (leicht über Gelände → teilversenkt)
const PIT = -4.35; // Grubensohle
const HALF = 30.6; // halbe Grubenbreite
const UP = new THREE.Vector3(0, 1, 0);

const HANGAR_SLOTS = [[0, 1], [4, 1], [0, 3], [4, 3]]; // 2×2-Plätze, jeweils an die Kommandozentrale angrenzend
const SMALL_SLOTS = [[2, 1], [3, 1], [2, 4], [3, 4], [2, 0], [3, 0], [2, 5], [3, 5], [1, 0], [4, 0], [1, 5], [4, 5], [0, 0], [5, 0], [0, 5], [5, 5]];

const KIND = {
  command: { name: 'Kommandozentrale', icon: '⬢', glow: 'cyan', func: 'Operationszentrale mit holografischem Lagetisch und Zugangsschacht. Auf der Aufzugsplattform parkt der Truppentransporter „Kondor“.' },
  hangar: { name: FACILITIES.hangar.name, icon: '✈', glow: 'warm', func: 'Unterirdische Startbucht mit zwei Stellplätzen für Abfangjäger, Wartungskran und Dachschleuse.' },
  lab: { name: FACILITIES.lab.name, icon: '⚗', glow: 'green', func: 'Analyseplätze und Eindämmungszelle für Alien-Proben. Jedes Labor bietet Platz für 10 Wissenschaftler.' },
  radar: { name: FACILITIES.radar.name, icon: '◎', glow: 'cyan', func: 'Erfassungsrechner unter der Oberfläche; die rotierende Phalanx-Antenne erweitert die Radarreichweite der Basis.' },
  medbay: { name: FACILITIES.medbay.name, icon: '✚', glow: 'teal', func: 'Krankenstation mit Diagnosescanner – verwundete Soldaten heilen doppelt so schnell.' },
  quarters: { name: 'Quartiere', icon: '☗', glow: 'white', func: 'Unterkünfte, Spinde und Aufenthaltsbereich der Einsatztruppe (12 Plätze je Modul).' },
  storage: { name: 'Lager', icon: '▦', glow: 'amber', func: 'Ausrüstung, Munition und geborgene Alien-Artefakte.' },
};
const CRAFT_STATUS = { ready: 'Bereit', out: 'Im Einsatz', return: 'Rückflug', repair: 'Reparatur' };
const TRANSPORT_STATUS = { ready: 'Bereit', out: 'Im Einsatz', arrived: 'Am Einsatzort', return: 'Rückflug' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
function rng(seed) { let s = (seed * 2654435761) >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

// ---------- Geometrie-Helfer ----------
function mesh(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  parent.add(m); return m;
}
const box = (p, w, h, d, mat, x, y, z, ry = 0) => mesh(p, new THREE.BoxGeometry(w, h, d), mat, x, y, z, 0, ry, 0);
const cyl = (p, rt, rb, h, mat, x, y, z, seg = 16, rx = 0, rz = 0) => mesh(p, new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, rx, 0, rz);
function beam(parent, a, b, r, mat) {
  const d = new THREE.Vector3().subVectors(b, a); const len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(UP, d.normalize());
  parent.add(m); return m;
}

// Welt-UVs (planar je Hauptachse) → nahtlose Texturen über zusammengeführte Teile
function worldUV(g, T) {
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); } else if (ax >= az) { u = p.getZ(i); v = p.getY(i); } else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u / T; uv[i * 2 + 1] = v / T;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function mergeGeos(list) {
  let nv = 0, ni = 0;
  for (const g of list) { if (!g.attributes.normal) g.computeVertexNormals(); nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  const copy = (dst, attr, off, size) => {
    if (!attr) return;
    if (!attr.isInterleavedBufferAttribute && attr.itemSize === size && attr.array.length === attr.count * size) dst.set(attr.array, off * size);
    else for (let i = 0; i < attr.count; i++) for (let k = 0; k < size; k++) dst[(off + i) * size + k] = attr.getComponent(i, k);
  };
  for (const g of list) {
    const c = g.attributes.position.count;
    copy(pos, g.attributes.position, vo, 3); copy(nor, g.attributes.normal, vo, 3); copy(uv, g.attributes.uv, vo, 2);
    if (g.index) { const a = g.index.array; for (let k = 0; k < a.length; k++) idx[io + k] = a[k] + vo; io += a.length; }
    else { for (let k = 0; k < c; k++) idx[io + k] = vo + k; io += c; }
    vo += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// Gruppe → eine Geometrie (Materialien ignoriert), z. B. für instanzierte Teile
function flatten(group) {
  group.updateMatrixWorld(true);
  const list = [];
  group.traverse((o) => { if (o.isMesh) { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); list.push(g); o.geometry.dispose(); } });
  const out = mergeGeos(list); list.forEach((g) => g.dispose());
  return out;
}

// ---------- Prozedurale Texturen ----------
function makeTextures() {
  const R = rng(11);
  const T = {};
  const noise = (c, w, h, n, cols, s = 2) => { for (let i = 0; i < n; i++) { c.fillStyle = cols[(R() * cols.length) | 0]; c.fillRect(R() * w, R() * h, s, s); } };
  T.floor = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#545e68'; c.fillRect(0, 0, w, h);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      const v = 80 + R() * 14; c.fillStyle = `rgb(${v},${v + 8},${v + 16})`; c.fillRect(x * 128 + 3, y * 128 + 3, 122, 122);
      if ((x + y) % 2 === 0) { c.strokeStyle = 'rgba(20,26,32,0.35)'; c.lineWidth = 2; for (let k = 0; k < 9; k++) for (let j = 0; j < 9; j++) { const px = x * 128 + 10 + k * 13, py = y * 128 + 10 + j * 13; c.beginPath(); c.moveTo(px, py + ((k + j) % 2 ? 6 : 0)); c.lineTo(px + 6, py + ((k + j) % 2 ? 0 : 6)); c.stroke(); } }
      c.fillStyle = '#20262c'; [[8, 8], [118, 8], [8, 118], [118, 118]].forEach(([a, b]) => { c.beginPath(); c.arc(x * 128 + a, y * 128 + b, 3, 0, 7); c.fill(); });
    }
    c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(0, 127, w, 1); c.fillRect(127, 0, 1, h);
    noise(c, w, h, 2500, ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.05)'], 2);
  });
  T.wall = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#7d8995'; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 64) { const v = 118 + R() * 16; c.fillStyle = `rgb(${v},${v + 10},${v + 22})`; c.fillRect(x + 2, 0, 60, h); c.fillStyle = 'rgba(15,20,28,0.7)'; c.fillRect(x, 0, 2, h); }
    c.fillStyle = 'rgba(15,20,28,0.6)'; c.fillRect(0, 168, w, 3);
    c.fillStyle = '#3d4650'; c.fillRect(0, 214, w, 42);
    c.fillStyle = 'rgba(0,0,0,0.5)'; for (let i = 0; i < 4; i++) { const vx = 72 + (i % 2) * 128, vy = 40 + ((i / 2) | 0) * 70; for (let k = 0; k < 5; k++) c.fillRect(vx, vy + k * 6, 40, 3); }
    noise(c, w, h, 1800, ['rgba(0,0,0,0.08)', 'rgba(255,255,255,0.05)'], 1);
  });
  T.concrete = canvasTexture(128, 128, (c, w, h) => { c.fillStyle = '#8b8984'; c.fillRect(0, 0, w, h); noise(c, w, h, 2600, ['#7a7873', '#9d9b95', '#6c6a66', '#a7a59f'], 2); c.fillStyle = 'rgba(60,55,50,0.25)'; c.fillRect(0, 63, w, 2); });
  T.rock = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#4b433a'; c.fillRect(0, 0, w, h);
    noise(c, w, h, 5000, ['#3a332c', '#5d5448', '#2c2722', '#6a6052'], 4);
    c.strokeStyle = 'rgba(15,12,10,0.6)'; c.lineWidth = 1.5;
    for (let i = 0; i < 18; i++) { let x = R() * w, y = R() * h; c.beginPath(); c.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (R() - 0.5) * 40; y += (R() - 0.5) * 40; c.lineTo(x, y); } c.stroke(); }
  });
  T.ground = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#2d3824'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) { c.fillStyle = ['rgba(70,60,40,0.25)', 'rgba(40,60,30,0.3)', 'rgba(25,32,20,0.35)'][i % 3]; c.beginPath(); c.arc(R() * w, R() * h, 6 + R() * 26, 0, 7); c.fill(); }
    noise(c, w, h, 6000, ['#24301c', '#3b4a2c', '#4a4430', '#1c2416'], 2);
  });
  T.hazard = canvasTexture(128, 128, (c, w, h) => {
    c.fillStyle = '#e7b21f'; c.fillRect(0, 0, w, h); c.fillStyle = '#16181a';
    for (let k = -128; k < 256; k += 42) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k + 21, 0); c.lineTo(k + 21 + 128, 128); c.lineTo(k + 128, 128); c.fill(); }
    noise(c, w, h, 600, ['rgba(0,0,0,0.15)', 'rgba(255,255,255,0.08)'], 2);
  });
  T.crate = canvasTexture(128, 128, (c, w, h) => {
    c.fillStyle = '#56603d'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#3c4429'; c.lineWidth = 10; c.strokeRect(5, 5, 118, 118);
    c.lineWidth = 6; c.beginPath(); c.moveTo(10, 10); c.lineTo(118, 118); c.stroke();
    c.fillStyle = 'rgba(230,220,180,0.7)'; c.font = 'bold 18px sans-serif'; c.fillText('AEGIS', 36, 70);
    noise(c, w, h, 900, ['rgba(0,0,0,0.15)', 'rgba(255,255,255,0.06)'], 2);
  });
  T.screen = canvasTexture(256, 128, (c, w, h) => {
    c.fillStyle = '#04121c'; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(60,200,255,0.15)'; c.lineWidth = 1; for (let x = 0; x < w; x += 16) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); } for (let y = 0; y < h; y += 16) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    ['#3fe0ff', '#3dffb0'].forEach((col) => { c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); let y = 40 + R() * 50; c.moveTo(8, y); for (let x = 8; x < 150; x += 8) { y = clamp(y + (R() - 0.5) * 22, 12, 116); c.lineTo(x, y); } c.stroke(); });
    for (let i = 0; i < 8; i++) { c.fillStyle = i % 3 ? 'rgba(63,224,255,0.75)' : 'rgba(255,201,74,0.8)'; c.fillRect(165, 12 + i * 13, 20 + R() * 66, 6); }
  });
  T.map = canvasTexture(512, 256, (c, w, h) => {
    c.fillStyle = '#021019'; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(63,224,255,0.18)'; for (let x = 0; x < w; x += 32) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); } for (let y = 0; y < h; y += 32) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    c.fillStyle = 'rgba(40,150,190,0.35)'; c.strokeStyle = 'rgba(90,230,255,0.9)'; c.lineWidth = 2;
    for (let i = 0; i < 6; i++) { const cx = 50 + R() * 410, cy = 40 + R() * 170, r = 20 + R() * 45; c.beginPath(); for (let a = 0; a < 6.3; a += 0.4) { const rr = r * (0.6 + R() * 0.6); c.lineTo(cx + Math.cos(a) * rr * 1.4, cy + Math.sin(a) * rr); } c.closePath(); c.fill(); c.stroke(); }
    for (let i = 0; i < 7; i++) { const x = R() * w, y = R() * h; c.fillStyle = i < 2 ? '#ff5468' : '#ffc94a'; c.beginPath(); c.arc(x, y, 4, 0, 7); c.fill(); c.strokeStyle = c.fillStyle; c.lineWidth = 1; c.beginPath(); c.arc(x, y, 11, 0, 7); c.stroke(); }
  });
  T.rack = canvasTexture(64, 128, (c, w, h) => {
    c.fillStyle = '#0b0f13'; c.fillRect(0, 0, w, h);
    for (let y = 4; y < h; y += 10) { c.fillStyle = '#1a222a'; c.fillRect(3, y, w - 6, 7); for (let x = 8; x < w - 8; x += 7) if (R() < 0.55) { c.fillStyle = ['#3dffb0', '#3fe0ff', '#ffc94a', '#3dffb0'][(R() * 4) | 0]; c.fillRect(x, y + 2, 3, 3); } }
  });
  T.sky = canvasTexture(4, 256, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#050a14'); g.addColorStop(0.42, '#13243a'); g.addColorStop(0.5, '#2a3a4a'); g.addColorStop(0.53, '#1a2026'); g.addColorStop(1, '#0a0c0e');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }, { wrap: false });
  return T;
}

function makeMaterials(T) {
  const std = (o, tile) => { const m = new THREE.MeshStandardMaterial(o); if (tile) m.userData.tile = tile; return m; };
  const glow = (hex, k = 3) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) });
  const m = {
    floor: std({ map: T.floor, metalness: 0.45, roughness: 0.5 }, 4),
    wall: std({ map: T.wall, metalness: 0.3, roughness: 0.6 }, 4),
    steel: std({ color: 0x9aa5b1, metalness: 0.85, roughness: 0.3 }),
    steelDark: std({ color: 0x353d47, metalness: 0.7, roughness: 0.42 }),
    concrete: std({ map: T.concrete, metalness: 0, roughness: 0.92 }, 3),
    rock: std({ map: T.rock, metalness: 0, roughness: 0.95 }, 9),
    ground: std({ map: T.ground, metalness: 0, roughness: 1 }, 18),
    road: std({ color: 0x34383c, metalness: 0, roughness: 0.9 }),
    hazard: std({ map: T.hazard, metalness: 0.2, roughness: 0.6 }, 1.4),
    paint: std({ color: 0xe8b021, metalness: 0.1, roughness: 0.55 }),
    yellow: std({ color: 0xf0a81c, metalness: 0.45, roughness: 0.45 }),
    white: std({ color: 0xd9e0e6, metalness: 0.1, roughness: 0.42 }),
    fabric: std({ color: 0x4e6479, metalness: 0, roughness: 0.92 }),
    fabricLight: std({ color: 0xc6d2da, metalness: 0, roughness: 0.85 }),
    locker: std({ color: 0x3e5d71, metalness: 0.6, roughness: 0.38 }),
    crate: std({ map: T.crate, metalness: 0.05, roughness: 0.8 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xa8dcff, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.28, depthWrite: false }),
    hull: std({ color: 0x8b96a2, metalness: 0.78, roughness: 0.28 }),
    hull2: std({ color: 0x2a313d, metalness: 0.72, roughness: 0.26 }),
    canopy: std({ color: 0x0b1824, metalness: 0.7, roughness: 0.05 }),
    accent: std({ color: 0xd8641e, metalness: 0.2, roughness: 0.5 }),
    tire: std({ color: 0x15181b, metalness: 0, roughness: 0.9 }),
    dish: new THREE.MeshStandardMaterial({ color: 0xe2e7ec, metalness: 0.55, roughness: 0.32, side: THREE.DoubleSide }),
    cyan: glow(0x3fe0ff), warm: glow(0xffa64a), green: glow(0x3dffb0), teal: glow(0x40ffe0, 2.6), amber: glow(0xffc94a, 2.6),
    white2: glow(0xdfefff, 2.2), red: glow(0xff3048, 3.2), purple: glow(0xc45cff, 3.2), blue: glow(0x5a8cff, 3.4),
    blink: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff8a1a).multiplyScalar(4) }),
    sel: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3fe0ff).multiplyScalar(1.4), transparent: true, opacity: 0.8, depthWrite: false }),
    screen: new THREE.MeshBasicMaterial({ map: T.screen, color: new THREE.Color(1.5, 1.5, 1.5) }),
    map: new THREE.MeshBasicMaterial({ map: T.map, color: new THREE.Color(1.6, 1.6, 1.6) }),
    rack: new THREE.MeshBasicMaterial({ map: T.rack, color: new THREE.Color(1.8, 1.8, 1.8) }),
    holo: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3fe0ff).multiplyScalar(2.2), wireframe: true, transparent: true, opacity: 0.75, depthWrite: false }),
    sky: new THREE.MeshBasicMaterial({ map: T.sky, side: THREE.BackSide, fog: false, depthWrite: false }),
  };
  m.ground.userData.noCast = m.rock.userData.noCast = m.road.userData.noCast = true;
  return m;
}

// ---------- Basisplanung: Module im Raster anordnen ----------
function planBase(c) {
  const mods = [];
  const add = (kind, cells, extra = {}) => {
    let i0 = 9, i1 = -1, j0 = 9, j1 = -1;
    cells.forEach(([i, j]) => { i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); });
    const x0 = (i0 - 3) * S + MARGIN, x1 = (i1 - 2) * S - MARGIN, z0 = (j0 - 3) * S + MARGIN, z1 = (j1 - 2) * S - MARGIN;
    const m = { kind, cells, x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, ...extra };
    m.center = new THREE.Vector3(m.cx, FLOOR + 1, m.cz);
    mods.push(m); return m;
  };
  const big = ([i, j]) => [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]];
  add('command', big([2, 2]));
  let h = 0, s = 0;
  const nHangar = c.facilities.hangar || 0;
  for (let k = 0; k < nHangar && h < HANGAR_SLOTS.length; k++) add('hangar', big(HANGAR_SLOTS[h++]), { num: k + 1 });
  for (const b of c.building) if (b.type === 'hangar' && h < HANGAR_SLOTS.length) add('site', big(HANGAR_SLOTS[h++]), { type: b.type, b });
  const small = (kind, extra) => { if (s < SMALL_SLOTS.length) add(kind, [SMALL_SLOTS[s++]], extra); };
  const nQuarters = Math.min(2, Math.max(1, Math.ceil(c.soldiers.length / 12)));
  for (let k = 0; k < nQuarters; k++) small('quarters', { num: k + 1 });
  small('storage', { num: 1 });
  for (const kind of ['lab', 'radar', 'medbay']) for (let k = 0; k < (c.facilities[kind] || 0); k++) small(kind, { num: k + 1 });
  for (const b of c.building) if (b.type !== 'hangar') small('site', { type: b.type, b });
  // Fortlaufende Nummer je Bauplatz-Typ
  const siteN = {};
  mods.forEach((m) => { if (m.kind === 'site') m.num = (c.facilities[m.type] || 0) + (siteN[m.type] = (siteN[m.type] || 0) + 1); });
  // Gänge: zwischen benachbarten Zellen verschiedener Module (je Modulpaar einmal)
  const cellOf = new Map();
  mods.forEach((m, mi) => m.cells.forEach(([i, j]) => cellOf.set(i + ',' + j, mi)));
  const links = [], seen = new Set();
  for (const [key, a] of cellOf) {
    const [i, j] = key.split(',').map(Number);
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      const b = cellOf.get((i + di) + ',' + (j + dj));
      if (b == null || b === a) continue;
      const pk = Math.min(a, b) + '-' + Math.max(a, b);
      if (seen.has(pk)) continue; seen.add(pk);
      links.push(di ? { axis: 'x', x: (i - 2) * S, z: (j - 2.5) * S } : { axis: 'z', x: (i - 2.5) * S, z: (j - 2) * S });
    }
  }
  mods.forEach((m) => {
    const hTop = m.kind === 'radar' ? 6 : m.kind === 'site' ? 2.5 : TOP + 0.6;
    m.box = new THREE.Box3(new THREE.Vector3(m.x0, FLOOR - 0.3, m.z0), new THREE.Vector3(m.x1, hTop, m.z1));
  });
  return { mods, links };
}

// ---------- Modellbau ----------
function buildJet(parent, type, mt, glowMat) {
  const g = new THREE.Group(); parent.add(g);
  const P = type === 'phantom';
  const hull = P ? mt.hull2 : mt.hull;
  g.scale.setScalar(P ? 1.12 : 1);
  mesh(g, new THREE.CylinderGeometry(0.48, 0.36, 4.2, 14), hull, 0, 1.05, 0.2, Math.PI / 2);
  mesh(g, new THREE.ConeGeometry(0.36, 1.5, 14), hull, 0, 1.05, -2.65, -Math.PI / 2);
  const can = mesh(g, new THREE.SphereGeometry(0.34, 14, 10), mt.canopy, 0, 1.36, -1.2); can.scale.set(1, 0.75, 2.4);
  const wing = new THREE.Shape();
  const pts = P ? [[0.4, -0.4], [3.0, -1.3], [3.2, -0.8], [0.5, 1.9], [-0.5, 1.9], [-3.2, -0.8], [-3.0, -1.3], [-0.4, -0.4]]
    : [[0.3, -1.2], [2.7, 1.2], [2.5, 1.7], [-2.5, 1.7], [-2.7, 1.2], [-0.3, -1.2]];
  pts.forEach(([x, y], i) => (i ? wing.lineTo(x, y) : wing.moveTo(x, y)));
  mesh(g, new THREE.ExtrudeGeometry(wing, { depth: 0.09, bevelEnabled: false }), hull, 0, 1.02, 0.4, Math.PI / 2);
  if (P) for (const sx of [-1, 1]) box(g, 1.0, 0.05, 0.4, hull, sx * 0.75, 1.15, -1.9);
  for (const sx of [-1, 1]) {
    mesh(g, new THREE.BoxGeometry(0.07, 0.95, 1.0), hull, sx * 0.32, 1.6, 1.85, 0, 0, -sx * 0.3);
    box(g, 0.3, 0.4, 1.2, mt.steelDark, sx * 0.5, 0.95, -0.2);
    box(g, 0.6, 0.02, 0.25, mt.accent, sx * 1.6, 1.07, 0.9);
    cyl(g, 0.04, 0.04, 0.7, mt.steelDark, sx * 0.9, 0.5, 0.6, 6);
    cyl(g, 0.16, 0.16, 0.12, mt.tire, sx * 0.9, 0.16, 0.6, 10, 0, Math.PI / 2);
  }
  cyl(g, 0.04, 0.04, 0.7, mt.steelDark, 0, 0.5, -1.9, 6);
  cyl(g, 0.14, 0.14, 0.1, mt.tire, 0, 0.14, -1.9, 10, 0, Math.PI / 2);
  cyl(g, 0.3, 0.34, 0.45, mt.steelDark, 0, 1.05, 2.5, 14, Math.PI / 2);
  mesh(g, new THREE.CircleGeometry(0.27, 14), glowMat, 0, 1.05, 2.73);
  return g;
}

function radarHeadGeometry() {
  const g = new THREE.Group();
  cyl(g, 0.5, 0.6, 0.5, null, 0, 0, 0, 12);
  box(g, 0.25, 1.4, 0.25, null, 0, 0.8, 0);
  mesh(g, new THREE.SphereGeometry(2.0, 20, 6, 0, Math.PI * 2, 0, 0.7), null, 0, 1.6, -1.9, Math.PI / 2 + 0.3);
  beam(g, new THREE.Vector3(0, 1.1, 0.0), new THREE.Vector3(0, 1.55, -1.7), 0.05, null);
  mesh(g, new THREE.SphereGeometry(0.16, 8, 6), null, 0, 1.58, -1.8);
  box(g, 0.5, 0.5, 0.5, null, 0, 1.0, 0.45);
  return flatten(g);
}

// ---------- Basis-Ansicht ----------
let current = null;
export function isBaseViewOpen() { return !!current; }

export function openBaseView(engine, geo, opts = {}) {
  if (current) return current;
  if (!Game.c?.base) return null;
  current = new BaseView(engine, geo, opts);
  try { current.open(); } catch (e) { console.error(e); const v = current; current = null; try { v.close(true); } catch { /* bereits teilweise abgebaut */ } return null; }
  return current;
}

class BaseView {
  constructor(engine, geo, opts) {
    this.engine = engine; this.geo = geo; this.opts = opts;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 900);
    this.unsub = []; this.labels = []; this.tempMats = [];
    this.mods = []; this.sel = -1; this.infoOpen = false;
    this.t = 0; this.sigT = 0; this.navDir = null; this.navRepeat = 0;
    this.pointers = new Map();
    this.target = new THREE.Vector3(0, -2, 0); this.tTarget = this.target.clone();
    this.yaw = 0.4; this.pitch = 1.0; this.dist = 130;
    this.tYaw = 0.75; this.tPitch = 0.82; this.tDist = 78;
    this.raycaster = new THREE.Raycaster();
  }

  // ---------- Lebenszyklus (Vertrag mit Geoscape) ----------
  open() {
    this.geo.deactivate();
    this.hud = document.getElementById('hud');
    if (this.hud) this.hud.style.display = 'none';
    this.buildDom();
    this.buildScene();
    this.rebuild();
    this.bindInput();
    this.engine.setMode(this);
    this.update(0);
  }

  close(silent) {
    if (this.closed) return; this.closed = true;
    if (!silent) sfx('click');
    this.dom?.remove();
    this.unsub.forEach((f) => f()); this.unsub = [];
    try { this.disposeAll(); } catch (e) { console.error(e); }
    if (this.hud) this.hud.style.display = '';
    this.engine.setMode(this.geo);
    this.geo.active = true;
    if (current === this) current = null;
  }

  // ---------- Szene ----------
  buildScene() {
    const sc = this.scene;
    this.tex = makeTextures();
    this.mt = makeMaterials(this.tex);
    this.mtSet = new Set(Object.values(this.mt));
    sc.background = new THREE.Color(0x0b1520);
    sc.fog = new THREE.FogExp2(0x15202b, 0.0042);
    // Umgebungsreflexionen für PBR aus einer kleinen Lichtkulisse
    const pm = new THREE.PMREMGenerator(this.engine.renderer);
    const env = new THREE.Scene();
    const envMats = [new THREE.MeshBasicMaterial({ color: 0x18222c, side: THREE.BackSide }), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3.2, 3.4) }), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.4, 3) })];
    const envGeo = new THREE.BoxGeometry(1, 1, 1);
    const room = new THREE.Mesh(envGeo, envMats[0]); room.scale.set(30, 14, 30); env.add(room);
    [[0, 6.5, 0, 10, 0.2, 4, 1], [-12, 3, 0, 0.2, 3, 10, 2], [12, 3, 4, 0.2, 2, 8, 1], [0, 3, -14, 8, 2, 0.2, 2]].forEach(([x, y, z, w, h, d, k]) => { const p = new THREE.Mesh(envGeo, envMats[k]); p.position.set(x, y, z); p.scale.set(w, h, d); env.add(p); });
    this.envRT = pm.fromScene(env, 0.035);
    pm.dispose(); envGeo.dispose(); envMats.forEach((m) => m.dispose());
    sc.environment = this.envRT.texture;
    sc.environmentIntensity = 0.55;

    // Licht
    sc.add(new THREE.HemisphereLight(0x9cbfe8, 0x2b2219, 0.75));
    const dir = this.dir = new THREE.DirectionalLight(0xffeedd, 2.6);
    dir.position.set(38, 80, 28);
    dir.castShadow = true;
    const ss = Math.min(this.engine.shadowSize || 1024, 1024);
    dir.shadow.mapSize.set(ss, ss);
    Object.assign(dir.shadow.camera, { left: -44, right: 44, top: 44, bottom: -44, near: 10, far: 200 });
    dir.shadow.bias = -0.0006; dir.shadow.normalBias = 0.04;
    sc.add(dir, dir.target);
    this.lightA = new THREE.PointLight(0x3fe0ff, 40, 16, 2); this.lightA.position.set(-4.25, FLOOR + 2.6, 0);
    this.lightB = new THREE.PointLight(0xffb070, 0, 20, 2);
    sc.add(this.lightA, this.lightB);

    // Himmel
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 12), this.mt.sky); this.sky.renderOrder = -1; sc.add(this.sky);

    // Gelände mit ausgehobener Grube (statisch, eigenes Baking)
    const stage = new THREE.Group();
    this.buildTerrain(stage);
    this.terrain = new THREE.Group(); sc.add(this.terrain);
    this.bake(stage, this.terrain);

    // Instanzierte Oberflächen-Details: Felsen, Mastleuchten
    const R = rng(77), mat4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), this.mt.rock, 40);
    for (let i = 0; i < 40; i++) {
      let x, z; do { x = (R() - 0.5) * 170; z = (R() - 0.5) * 170; } while (Math.max(Math.abs(x), Math.abs(z)) < HALF + 6 || (Math.abs(x) < 6 && z > 0));
      const k = 0.6 + R() * 2.2;
      mat4.compose(p.set(x, k * 0.25, z), q.setFromEuler(e.set(R() * 3, R() * 3, R() * 3)), s.set(k * (1 + R()), k, k * (1 + R() * 0.6)));
      rocks.setMatrixAt(i, mat4);
    }
    rocks.castShadow = rocks.receiveShadow = true; rocks.frustumCulled = false; sc.add(rocks);
    const postPos = [];
    for (let k = -HALF + 2; k <= HALF - 1; k += 9.5) { postPos.push([k, -(HALF + 2.4)], [k, HALF + 2.4], [-(HALF + 2.4), k], [HALF + 2.4, k]); }
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 2.6, 0.22), this.mt.steelDark, postPos.length);
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.14, 0.5), this.mt.white2, postPos.length);
    postPos.forEach(([x, z], i) => {
      posts.setMatrixAt(i, mat4.makeTranslation(x, 1.3, z));
      heads.setMatrixAt(i, mat4.makeTranslation(x, 2.65, z));
    });
    posts.castShadow = true; posts.frustumCulled = heads.frustumCulled = false; sc.add(posts, heads);

    // Radarantennen: instanziert, rotieren an der Oberfläche
    this.dishGeo = radarHeadGeometry();
    this.dishes = new THREE.InstancedMesh(this.dishGeo, this.mt.dish, 4);
    this.dishes.count = 0; this.dishes.castShadow = true; this.dishes.frustumCulled = false;
    this.beacons = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 8, 6), this.mt.red, 4);
    this.beacons.count = 0; this.beacons.frustumCulled = false;
    sc.add(this.dishes, this.beacons);

    // Holo-Lagetisch der Kommandozentrale (dynamisch)
    this.holo = new THREE.Group(); this.holo.position.set(-4.25, FLOOR + 2.4, 0);
    this.holo.add(new THREE.Mesh(new THREE.SphereGeometry(1.05, 18, 12), this.mt.holo));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.035, 6, 40), this.mt.cyan); ring.rotation.x = Math.PI / 2 - 0.25; this.holo.add(ring);
    sc.add(this.holo);

    // Auswahlrahmen
    this.selMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mt.sel);
    this.selMesh.visible = false; this.selMesh.renderOrder = 5; sc.add(this.selMesh);

    this.content = new THREE.Group(); sc.add(this.content);
  }

  buildTerrain(st) {
    const mt = this.mt;
    const sh = new THREE.Shape(); sh.moveTo(-260, -260); sh.lineTo(260, -260); sh.lineTo(260, 260); sh.lineTo(-260, 260); sh.closePath();
    const hole = new THREE.Path(); hole.moveTo(-HALF - 1.3, -HALF - 1.3); hole.lineTo(-HALF - 1.3, HALF + 1.3); hole.lineTo(HALF + 1.3, HALF + 1.3); hole.lineTo(HALF + 1.3, -HALF - 1.3); hole.closePath();
    sh.holes.push(hole);
    mesh(st, new THREE.ShapeGeometry(sh), mt.ground, 0, 0, 0, -Math.PI / 2);
    // Grube
    box(st, HALF * 2, 0.3, HALF * 2, mt.rock, 0, PIT - 0.15, 0);
    for (const sg of [-1, 1]) {
      box(st, HALF * 2 + 2, -PIT, 1, mt.rock, 0, PIT / 2, sg * (HALF + 0.5));
      box(st, 1, -PIT, HALF * 2, mt.rock, sg * (HALF + 0.5), PIT / 2, 0);
      // Betonrand + Warnstreifen + Geländer
      box(st, HALF * 2 + 2.6, 0.35, 1.3, mt.concrete, 0, 0.17, sg * (HALF + 0.65));
      box(st, 1.3, 0.35, HALF * 2, mt.concrete, sg * (HALF + 0.65), 0.17, 0);
      box(st, HALF * 2, 0.37, 0.25, mt.hazard, 0, 0.18, sg * (HALF + 0.12));
      box(st, 0.25, 0.37, HALF * 2, mt.hazard, sg * (HALF + 0.12), 0.18, 0);
      box(st, HALF * 2 + 2, 0.08, 0.08, mt.steel, 0, 1.4, sg * (HALF + 1.0));
      box(st, 0.08, 0.08, HALF * 2 + 2, mt.steel, sg * (HALF + 1.0), 1.4, 0);
      for (let k = -HALF; k <= HALF; k += 3.06) {
        box(st, 0.1, 1.1, 0.1, mt.steel, k, 0.9, sg * (HALF + 1.0));
        box(st, 0.1, 1.1, 0.1, mt.steel, sg * (HALF + 1.0), 0.9, k);
      }
    }
    // Zufahrtsstraße mit Leitmarkierung
    box(st, 7, 0.06, 90, mt.road, 0, 0.03, HALF + 46.5);
    for (let z = HALF + 4; z < HALF + 90; z += 5) box(st, 0.25, 0.07, 2.2, mt.paint, 0, 0.04, z);
    for (const sx of [-1, 1]) for (let z = HALF + 6; z < HALF + 60; z += 10) box(st, 0.25, 0.12, 0.25, mt.amber, sx * 3.7, 0.08, z);
  }

  // Statische Teile pro Material zusammenführen
  bake(root, target) {
    root.updateMatrixWorld(true);
    const buckets = new Map();
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mat = o.material;
      let b = buckets.get(mat);
      if (!b) buckets.set(mat, b = []);
      const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); b.push(g);
      if (!this.mtSet.has(mat) && !this.tempMats.includes(mat)) this.tempMats.push(mat);
    });
    root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    for (const [mat, list] of buckets) {
      if (mat.userData.tile) list.forEach((g) => worldUV(g, mat.userData.tile));
      const g = mergeGeos(list); list.forEach((x) => x.dispose());
      const m = new THREE.Mesh(g, mat);
      const lit = !mat.isMeshBasicMaterial;
      m.castShadow = lit && !mat.transparent && !mat.userData.noCast;
      m.receiveShadow = lit;
      if (mat.transparent) m.renderOrder = 2;
      target.add(m);
    }
  }

  clearContent() {
    this.content.children.slice().forEach((m) => { m.geometry.dispose(); this.content.remove(m); });
    this.tempMats.forEach((m) => m.dispose()); this.tempMats = [];
    this.labels.forEach((l) => l.el.remove()); this.labels = [];
  }

  sig() {
    const c = Game.c;
    return JSON.stringify([c.facilities, c.building.map((b) => [b.type, Math.ceil(b.daysLeft)]), c.crafts.map((x) => [x.type, x.status, x.name]), c.transport?.status,
      c.soldiers.length, c.scientists, Object.values(c.artifacts || {}).some((n) => n > 0)]);
  }

  rebuild() {
    const c = Game.c;
    const prev = this.sel >= 0 ? this.mods[this.sel] : null;
    this.lastSig = this.sig();
    this.clearContent();
    const plan = planBase(c);
    this.mods = plan.mods;
    const stage = new THREE.Group();
    // Flugzeuge den Hangarstellplätzen zuordnen
    const hangars = this.mods.filter((m) => m.kind === 'hangar');
    hangars.forEach((h) => { h.bays = []; });
    c.crafts.forEach((cr, i) => { const h = hangars[(i / 2) | 0]; if (h) h.bays.push(cr); });
    this.radars = [];
    for (const m of this.mods) {
      const g = new THREE.Group(); g.position.set(m.cx, 0, m.cz); stage.add(g);
      if (m.kind === 'site') this.buildSite(g, m);
      else { this.shell(g, m.w, m.d, this.mt[KIND[m.kind].glow === 'white' ? 'white2' : KIND[m.kind].glow]); this['build_' + m.kind](g, m); }
    }
    for (const l of plan.links) this.corridor(stage, l);
    this.bake(stage, this.content);
    // Radarköpfe
    this.dishes.count = this.beacons.count = this.radars.length;
    const mat4 = new THREE.Matrix4();
    this.radars.forEach((r, i) => this.beacons.setMatrixAt(i, mat4.makeTranslation(r.x, 7.0, r.z)));
    this.beacons.instanceMatrix.needsUpdate = true;
    // Punktlicht im ersten Hangar
    if (hangars[0]) { this.lightB.position.set(hangars[0].cx, FLOOR + 3.4, hangars[0].cz); this.lightB.intensity = 45; } else this.lightB.intensity = 0;
    // Baustellen-Labels mit Fortschrittsbalken
    for (const m of this.mods) if (m.kind === 'site') {
      const f = FACILITIES[m.type];
      const done = clamp(f.days - m.b.daysLeft, 0, f.days);
      const lab = el('div', 'bs-label site', `<b>🚧 ${esc(f.name)}</b>${bar(done, f.days, 'good')}<small>noch ${Math.ceil(m.b.daysLeft)} ${Math.ceil(m.b.daysLeft) === 1 ? 'Tag' : 'Tage'}</small>`);
      this.labelWrap.appendChild(lab);
      this.labels.push({ el: lab, pos: new THREE.Vector3(m.cx, TOP + 3.2, m.cz) });
    }
    this.updateStats();
    // Auswahl wiederherstellen
    let ns = -1;
    if (prev) ns = this.mods.findIndex((m) => m.kind === prev.kind && m.num === prev.num && m.type === prev.type);
    if (ns < 0 && prev) ns = this.mods.findIndex((m) => m.cells[0][0] === prev.cells[0][0] && m.cells[0][1] === prev.cells[0][1]);
    this.sel = -1;
    if (ns >= 0) this.select(ns, false); else this.hideInfo();
  }

  // ---------- Module ----------
  shell(g, w, d, glow) {
    const mt = this.mt, H = TOP - FLOOR, yc = FLOOR + H / 2, t = 0.3;
    box(g, w, 0.3, d, mt.floor, 0, FLOOR - 0.15, 0);
    for (const sg of [-1, 1]) {
      box(g, w, H, t, mt.wall, 0, yc, sg * (d / 2 - t / 2));
      box(g, t, H, d - 2 * t, mt.wall, sg * (w / 2 - t / 2), yc, 0);
      box(g, w + 0.2, 0.2, 0.55, mt.steel, 0, TOP + 0.1, sg * (d / 2 - 0.15));
      box(g, 0.55, 0.2, d - 0.6, mt.steel, sg * (w / 2 - 0.15), TOP + 0.1, 0);
      box(g, w - 1, 0.1, 0.06, glow, 0, TOP - 0.45, sg * (d / 2 - t - 0.03));
      box(g, 0.06, 0.1, d - 1, glow, sg * (w / 2 - t - 0.03), TOP - 0.45, 0);
      box(g, w - 1.4, 0.03, 0.07, glow, 0, FLOOR + 0.015, sg * (d / 2 - 0.65));
      for (let x = -w / 2 + 1.6; x < w / 2 - 1; x += 2.3) box(g, 0.22, H - 0.7, 0.16, mt.steelDark, x, yc - 0.35, sg * (d / 2 - t - 0.08));
      for (let z = -d / 2 + 1.6; z < d / 2 - 1; z += 2.3) box(g, 0.16, H - 0.7, 0.22, mt.steelDark, sg * (w / 2 - t - 0.08), yc - 0.35, z);
    }
  }

  build_command(g, m) {
    const mt = this.mt, w = m.w, d = m.d, ox = -w / 4, lx = w / 4;
    // Trennwand mit Durchgang
    const L1 = d / 2 - 0.3 - 1.4;
    for (const sg of [-1, 1]) {
      box(g, 0.3, 3, L1, mt.wall, 0, FLOOR + 1.5, sg * (1.4 + L1 / 2));
      box(g, 0.4, 3.1, 0.12, mt.cyan, 0, FLOOR + 1.55, sg * 1.42);
    }
    // Operationszentrale: Lagetisch + Konsolenring
    cyl(g, 1.5, 1.75, 1.0, mt.steelDark, ox, FLOOR + 0.5, 0, 24);
    cyl(g, 1.42, 1.42, 0.05, mt.cyan, ox, FLOOR + 1.03, 0, 24);
    cyl(g, 0.25, 0.4, 0.3, mt.steel, ox, FLOOR + 1.2, 0, 12);
    for (const a of [60, 120, 180, 240, 300].map((x) => x * DEG)) {
      const cg = new THREE.Group(); cg.position.set(ox + Math.cos(a) * 3.3, 0, Math.sin(a) * 3.3); cg.rotation.y = Math.PI / 2 - a; g.add(cg);
      box(cg, 1.5, 0.85, 0.7, mt.steelDark, 0, FLOOR + 0.43, 0);
      mesh(cg, new THREE.BoxGeometry(1.3, 0.7, 0.05), mt.screen, 0, FLOOR + 1.25, 0.1, -0.35);
      box(cg, 0.5, 0.5, 0.5, mt.fabric, 0, FLOOR + 0.25, 0.95);
    }
    box(g, 0.06, 2.4, 7.5, mt.map, -w / 2 + 0.34, FLOOR + 2.3, 0);
    for (const sg of [-1, 1]) {
      box(g, 0.08, 1.4, 2.6, mt.screen, -w / 2 + 0.34, FLOOR + 2.0, sg * 5.6);
      box(g, 3, 0.9, 0.8, mt.white, ox, FLOOR + 0.45, sg * (d / 2 - 0.85));
      box(g, 2.6, 0.5, 0.05, mt.screen, ox, FLOOR + 1.15, sg * (d / 2 - 0.7));
    }
    // Zugangsschacht mit Aufzugsplattform und Transporter
    cyl(g, 3.4, 3.4, 0.25, mt.steel, lx, FLOOR + 0.13, 0, 40);
    mesh(g, new THREE.RingGeometry(3.4, 3.95, 40), mt.hazard, lx, FLOOR + 0.02, 0, -Math.PI / 2);
    mesh(g, new THREE.RingGeometry(1.6, 1.75, 40), mt.paint, lx, FLOOR + 0.27, 0, -Math.PI / 2);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      box(g, 0.5, 7, 0.5, mt.steelDark, lx + sx * 3.65, FLOOR + 3.5, sz * 3.65);
      box(g, 0.1, 6.4, 0.1, mt.warm, lx + sx * 3.38, FLOOR + 3.4, sz * 3.38);
      mesh(g, new THREE.SphereGeometry(0.2, 8, 6), mt.blink, lx + sx * 3.65, FLOOR + 7.15, sz * 3.65);
    }
    for (const sx of [-1, 1]) box(g, 0.3, 0.3, 7.6, mt.steel, lx + sx * 3.65, FLOOR + 6.8, 0);
    const tr = Game.c.transport;
    if (!tr || tr.status === 'ready') {
      const t = makeTransport(); t.scale.setScalar(0.33); t.position.set(lx, FLOOR + 0.25, 0.3); g.add(t);
    }
  }

  build_hangar(g, m) {
    const mt = this.mt, w = m.w, d = m.d;
    box(g, 0.6, 0.02, d - 1.4, mt.hazard, 0, FLOOR + 0.012, 0);
    const statusMat = { ready: mt.green, repair: mt.warm, out: mt.red, return: mt.amber };
    for (const [bi, sx] of [[0, -1], [1, 1]]) {
      const bx = sx * w / 4;
      mesh(g, new THREE.RingGeometry(3.0, 3.25, 40), mt.paint, bx, FLOOR + 0.012, 0, -Math.PI / 2);
      box(g, 0.15, 0.02, 5.4, mt.paint, bx, FLOOR + 0.012, 0);
      for (let z = -3; z <= 3; z += 1.5) for (const ex of [-1, 1]) box(g, 0.18, 0.05, 0.18, mt.warm, bx + ex * 3.6, FLOOR + 0.03, z);
      const cr = m.bays[bi];
      box(g, 1.4, 0.06, 0.35, cr ? statusMat[cr.status] || mt.green : mt.steelDark, bx, FLOOR + 0.03, -3.85);
      if (cr && (cr.status === 'ready' || cr.status === 'repair')) {
        const j = buildJet(g, cr.type, mt, cr.type === 'phantom' ? mt.blue : mt.warm);
        j.position.set(bx, FLOOR, 0.2);
        if (cr.status === 'repair') { // Wartungsarm + Arbeitsbühne
          box(g, 0.3, 2.6, 0.3, mt.yellow, bx + 2.3, FLOOR + 1.3, 1.5);
          beam(g, new THREE.Vector3(bx + 2.3, FLOOR + 2.5, 1.5), new THREE.Vector3(bx + 0.7, FLOOR + 1.9, 0.6), 0.1, mt.yellow);
          box(g, 1.6, 0.9, 1.2, mt.steelDark, bx + 2.6, FLOOR + 0.45, -1.4);
        }
      }
    }
    // Dachschleuse (geöffnet) mit Warnkanten
    for (const sx of [-1, 1]) {
      box(g, 3.0, 0.35, d + 0.3, mt.steelDark, sx * (w / 2 - 1.5), TOP + 0.38, 0);
      box(g, 0.3, 0.37, d + 0.3, mt.hazard, sx * (w / 2 - 3.15), TOP + 0.38, 0);
      cyl(g, 0.6, 0.6, 2.6, mt.white, sx * 6, FLOOR + 0.75, -d / 2 + 1.0, 14, 0, Math.PI / 2);
      box(g, 1.2, 0.9, 0.8, mt.accent, sx * (w / 2 - 1.1), FLOOR + 0.45, d / 2 - 1.6);
      box(g, 1.0, 0.3, 0.7, mt.steelDark, sx * (w / 2 - 1.1), FLOOR + 1.05, d / 2 - 1.6);
    }
    // Portalkran
    box(g, w - 0.8, 0.45, 0.5, mt.yellow, 0, TOP - 0.25, d / 4 + 1.2);
    box(g, 0.7, 0.5, 0.7, mt.steelDark, -w / 4, TOP - 0.7, d / 4 + 1.2);
    box(g, 0.05, 2.2, 0.05, mt.steelDark, -w / 4, TOP - 2.0, d / 4 + 1.2);
    box(g, 4, 0.12, 4, mt.floor, w / 2 - 2.4, FLOOR + 2.2, -d / 2 + 2.3);
    for (const px of [-1.8, 1.8]) box(g, 0.15, 2.2, 0.15, mt.steelDark, w / 2 - 2.4 + px, FLOOR + 1.1, -d / 2 + 4.2);
    box(g, 4, 0.06, 0.06, mt.warm, w / 2 - 2.4, FLOOR + 2.3, -d / 2 + 4.28);
    box(g, 2.2, 0.8, 0.05, mt.screen, w / 2 - 2.4, FLOOR + 2.9, -d / 2 + 0.36);
  }

  build_lab(g, m) {
    const mt = this.mt, w = m.w, d = m.d;
    for (const sg of [-1, 1]) {
      box(g, w - 1.6, 0.9, 0.8, mt.white, 0, FLOOR + 0.45, sg * (d / 2 - 0.75));
      for (const x of [-2, 0, 2]) mesh(g, new THREE.BoxGeometry(1.0, 0.62, 0.05), mt.screen, x, FLOOR + 1.3, sg * (d / 2 - 0.6), sg * -0.2);
      box(g, 0.4, 0.3, 0.4, mt.steelDark, sg * 1, FLOOR + 1.05, sg * (d / 2 - 0.9));
    }
    cyl(g, 0.95, 1.05, 0.35, mt.steel, 0, FLOOR + 0.18, 0, 20);
    mesh(g, new THREE.CylinderGeometry(0.8, 0.8, 2.4, 20, 1, true), mt.glass, 0, FLOOR + 1.55, 0);
    cyl(g, 0.95, 0.95, 0.3, mt.steel, 0, FLOOR + 2.9, 0, 20);
    mesh(g, new THREE.CapsuleGeometry(0.26, 0.7, 4, 10), mt.purple, 0, FLOOR + 1.5, 0);
    mesh(g, new THREE.TorusGeometry(0.82, 0.04, 6, 28), mt.green, 0, FLOOR + 0.42, 0, Math.PI / 2);
    box(g, 0.14, 0.14, w / 2 - 0.4, mt.steel, 0, FLOOR + 3.0, -(w / 4 + 0.1));
    box(g, 0.5, 2.2, 3, mt.steelDark, w / 2 - 0.6, FLOOR + 1.1, 0);
    for (let i = 0; i < 6; i++) box(g, 0.14, 0.25, 0.14, i % 2 ? mt.green : mt.purple, w / 2 - 0.75, FLOOR + 0.9 + (i % 3) * 0.6, -0.9 + ((i / 3) | 0) * 1.4);
    box(g, 1, 1.5, 1.4, mt.white, -w / 2 + 0.9, FLOOR + 0.75, 0);
    box(g, 0.05, 0.6, 1.0, mt.screen, -w / 2 + 1.42, FLOOR + 1.2, 0);
  }

  build_radar(g, m) {
    const mt = this.mt, w = m.w, d = m.d;
    for (const sz of [-1, 1]) for (const x of [-1.5, 0, 1.5]) {
      box(g, 1.2, 2.4, 0.8, mt.steelDark, x - 0.4, FLOOR + 1.2, sz * 2.3);
      box(g, 1.05, 2.2, 0.02, mt.rack, x - 0.4, FLOOR + 1.2, sz * (2.3 - 0.41));
    }
    cyl(g, 0.4, 0.55, 5.4 - FLOOR, mt.steel, w / 2 - 1.6, (5.4 + FLOOR) / 2, 0, 14);
    for (const sz of [-1, 1]) {
      beam(g, new THREE.Vector3(w / 2 - 0.3, TOP + 0.2, sz * (d / 2 - 0.3)), new THREE.Vector3(w / 2 - 1.6, 4.3, 0), 0.08, mt.steel);
      beam(g, new THREE.Vector3(-w / 2 + 0.3, TOP + 0.2, sz * (d / 2 - 0.3)), new THREE.Vector3(w / 2 - 1.6, 4.3, 0), 0.08, mt.steel);
    }
    cyl(g, 1.0, 1.0, 0.3, mt.steelDark, w / 2 - 1.6, FLOOR + 0.15, 0, 18);
    box(g, 0.8, 1, 1.8, mt.steelDark, -w / 2 + 0.8, FLOOR + 0.5, 0);
    mesh(g, new THREE.BoxGeometry(0.05, 0.8, 1.6), mt.map, -w / 2 + 1.22, FLOOR + 1.4, 0, 0, 0, -0.3);
    this.radars.push({ x: m.cx + w / 2 - 1.6, z: m.cz });
  }

  build_medbay(g, m) {
    const mt = this.mt, w = m.w, d = m.d;
    let first = true;
    for (const sz of [-1, 1]) for (const x of [-1.6, 1.0]) {
      const z = sz * (d / 2 - 1.45);
      box(g, 1.1, 0.55, 2.0, mt.white, x, FLOOR + 0.28, z);
      box(g, 1.0, 0.14, 1.85, mt.fabricLight, x, FLOOR + 0.62, z);
      box(g, 0.7, 0.12, 0.35, mt.white, x, FLOOR + 0.74, z + sz * 0.7);
      box(g, 0.08, 1.5, 0.08, mt.steel, x + 0.8, FLOOR + 0.75, z + sz * 0.7);
      box(g, 0.5, 0.35, 0.05, mt.screen, x + 0.8, FLOOR + 1.6, z + sz * 0.7);
      if (first) { mesh(g, new THREE.TorusGeometry(0.78, 0.07, 8, 24, Math.PI), mt.teal, x, FLOOR + 0.62, z); first = false; }
    }
    box(g, 2.2, 0.02, 0.6, mt.teal, 0, FLOOR + 0.012, 0);
    box(g, 0.6, 0.02, 2.2, mt.teal, 0, FLOOR + 0.012, 0);
    box(g, 0.5, 2.2, 3, mt.white, w / 2 - 0.6, FLOOR + 1.1, 0);
    box(g, 0.03, 0.8, 0.22, mt.teal, w / 2 - 0.86, FLOOR + 1.5, 0);
    box(g, 0.03, 0.22, 0.8, mt.teal, w / 2 - 0.86, FLOOR + 1.5, 0);
    box(g, 0.9, 1.0, 1.4, mt.steelDark, -w / 2 + 0.8, FLOOR + 0.5, 0);
  }

  build_quarters(g, m) {
    const mt = this.mt, w = m.w, d = m.d, zb = -d / 2 + 1.35;
    for (const x of [-2.2, 0, 2.2]) {
      for (const [px, pz] of [[-0.5, -0.95], [0.5, -0.95], [-0.5, 0.95], [0.5, 0.95]]) box(g, 0.08, 2.1, 0.08, mt.steel, x + px, FLOOR + 1.05, zb + pz);
      for (const y of [0.5, 1.6]) { box(g, 1.0, 0.12, 2.0, mt.steelDark, x, FLOOR + y, zb); box(g, 0.92, 0.16, 1.85, mt.fabric, x, FLOOR + y + 0.14, zb); box(g, 0.7, 0.1, 0.32, mt.fabricLight, x, FLOOR + y + 0.26, zb - 0.72); }
    }
    for (let i = 0; i < 6; i++) box(g, 0.55, 2.0, 0.55, mt.locker, -1.5 + i * 0.6, FLOOR + 1.0, d / 2 - 0.6);
    box(g, 3.5, 0.05, 0.05, mt.white2, 0, FLOOR + 2.05, d / 2 - 0.88);
    box(g, 1.7, 0.08, 1.0, mt.white, 0, FLOOR + 0.78, 0.6);
    cyl(g, 0.08, 0.12, 0.74, mt.steel, 0, FLOOR + 0.37, 0.6, 8);
    for (const [sx, sz] of [[-1.1, 0.6], [1.1, 0.6], [-0.4, 1.4], [0.4, 1.4]]) cyl(g, 0.22, 0.22, 0.45, mt.fabric, sx, FLOOR + 0.23, sz, 10);
  }

  build_storage(g, m) {
    const mt = this.mt, w = m.w, d = m.d, R = rng(m.cells[0][0] * 7 + m.cells[0][1] * 13 + 3);
    for (const x of [-2.0, 0.2]) for (const z of [-2.0, 2.0]) {
      const n = 1 + ((R() * 3) | 0);
      let y = FLOOR;
      for (let k = 0; k < n; k++) { const s = 0.9 + R() * 0.5; box(g, s, s, s, mt.crate, x + (R() - 0.5) * 0.3, y + s / 2, z + (R() - 0.5) * 0.3, (R() - 0.5) * 0.4); y += s; }
    }
    for (const pz of [-2.3, 0, 2.3]) for (const px of [-0.4, 0.4]) box(g, 0.08, 2.6, 0.08, mt.yellow, w / 2 - 0.65 + px, FLOOR + 1.3, pz);
    for (const y of [0.4, 1.3, 2.2]) {
      box(g, 0.85, 0.06, 4.6, mt.steelDark, w / 2 - 0.65, FLOOR + y, 0);
      for (let i = 0; i < 4; i++) box(g, 0.5, 0.35, 0.6, i % 2 ? mt.crate : mt.white, w / 2 - 0.65, FLOOR + y + 0.21, -1.7 + i * 1.15);
    }
    box(g, 1.2, 0.5, 0.8, mt.yellow, -w / 2 + 1.0, FLOOR + 0.35, 0);
    box(g, 0.08, 1.6, 0.6, mt.steelDark, -w / 2 + 1.65, FLOOR + 0.8, 0);
    if (Object.values(Game.c.artifacts || {}).some((n) => n > 0)) {
      cyl(g, 0.5, 0.55, 0.2, mt.steel, -1.0, FLOOR + 0.1, 0, 14);
      mesh(g, new THREE.CylinderGeometry(0.42, 0.42, 1.1, 14, 1, true), mt.glass, -1.0, FLOOR + 0.75, 0);
      mesh(g, new THREE.IcosahedronGeometry(0.25, 0), mt.purple, -1.0, FLOOR + 0.75, 0);
    }
  }

  buildSite(g, m) {
    const mt = this.mt, w = m.w, d = m.d, R = rng(m.cells[0][0] * 31 + m.cells[0][1] * 17 + 5);
    box(g, w, 0.3, d, mt.concrete, 0, FLOOR - 0.15, 0);
    // Rohbauwände unterschiedlicher Höhe
    for (const sg of [-1, 1]) for (const along of ['x', 'z']) {
      const len = along === 'x' ? w : d;
      for (let a = -len / 2; a < len / 2 - 0.1; a += 1.8) {
        if (R() < 0.18) continue;
        const seg = Math.min(1.8, len / 2 - a), hh = 0.8 + R() * 2.6;
        if (along === 'x') box(g, seg, hh, 0.3, mt.concrete, a + seg / 2, FLOOR + hh / 2, sg * (d / 2 - 0.15));
        else box(g, 0.3, hh, seg, mt.concrete, sg * (w / 2 - 0.15), FLOOR + hh / 2, a + seg / 2);
      }
    }
    // Gerüst
    const sx = w / 2 - 0.7, sz = d / 2 - 0.7, H = TOP + 1.6 - FLOOR;
    const xs = [], zs = [];
    for (let x = -sx; x <= sx + 0.01; x += (2 * sx) / Math.max(1, Math.round(2 * sx / 2.4))) xs.push(x);
    for (let z = -sz; z <= sz + 0.01; z += (2 * sz) / Math.max(1, Math.round(2 * sz / 2.4))) zs.push(z);
    for (const x of xs) for (const z of [-sz, sz]) box(g, 0.12, H, 0.12, mt.yellow, x, FLOOR + H / 2, z);
    for (const z of zs.slice(1, -1)) for (const x of [-sx, sx]) box(g, 0.12, H, 0.12, mt.yellow, x, FLOOR + H / 2, z);
    for (const y of [FLOOR + 1.6, FLOOR + 3.4]) for (const sg of [-1, 1]) {
      box(g, 2 * sx, 0.1, 0.1, mt.yellow, 0, y, sg * sz);
      box(g, 0.1, 0.1, 2 * sz, mt.yellow, sg * sx, y, 0);
      box(g, 2 * sx, 0.06, 0.55, mt.steelDark, 0, y - 0.08, sg * (sz - 0.35));
    }
    for (const sg of [-1, 1]) { box(g, 2 * sx, 0.12, 0.04, mt.hazard, 0, TOP + 0.9, sg * sz); box(g, 0.04, 0.12, 2 * sz, mt.hazard, sg * sx, TOP + 0.9, 0); }
    for (const x of [-sx, sx]) for (const z of [-sz, sz]) mesh(g, new THREE.SphereGeometry(0.2, 8, 6), mt.blink, x, FLOOR + H + 0.15, z);
    // Baukran
    const kx = sx - 0.6, kz = -sz + 0.6, kh = 10;
    box(g, 0.7, kh, 0.7, mt.yellow, kx, FLOOR + kh / 2, kz);
    for (let y = FLOOR + 1; y < FLOOR + kh; y += 1.4) box(g, 0.76, 0.08, 0.76, mt.steelDark, kx, y, kz);
    const jib = Math.min(7, w - 1.5);
    box(g, jib + 2.5, 0.45, 0.45, mt.yellow, kx - jib / 2 + 1.25, FLOOR + kh + 0.2, kz);
    box(g, 1.1, 0.8, 0.8, mt.concrete, kx + 1.7, FLOOR + kh - 0.25, kz);
    box(g, 0.04, 4.2, 0.04, mt.steelDark, kx - jib + 0.6, FLOOR + kh - 1.9, kz);
    box(g, 1.2, 0.5, 1.2, mt.crate, kx - jib + 0.6, FLOOR + kh - 4.2, kz);
    mesh(g, new THREE.SphereGeometry(0.18, 8, 6), mt.red, kx - jib - 0.4, FLOOR + kh + 0.6, kz);
    // Baumaterial
    for (let i = 0; i < 4; i++) box(g, 3, 0.15, 0.25, mt.steelDark, -1.2, FLOOR + 0.08 + i * 0.16, 1.2 + (i % 2) * 0.3);
    for (let i = 0; i < 3; i++) box(g, 0.8, 0.5, 0.6, mt.concrete, 0.8 + i * 0.85, FLOOR + 0.25, -1.4);
  }

  corridor(stage, l) {
    const mt = this.mt, L = 2 * MARGIN + 0.3, W = 2.6;
    const g = new THREE.Group(); g.position.set(l.x, 0, l.z); if (l.axis === 'z') g.rotation.y = Math.PI / 2; stage.add(g);
    box(g, L, 0.25, W, mt.floor, 0, FLOOR - 0.12, 0);
    for (const sg of [-1, 1]) {
      box(g, L, 2.9, 0.2, mt.wall, 0, FLOOR + 1.45, sg * (W / 2 - 0.1));
      box(g, L, 0.06, 0.06, mt.cyan, 0, FLOOR + 2.4, sg * (W / 2 - 0.23));
      // Tür + Leuchtrahmen an beiden Modulwänden
      const dx = sg * (MARGIN + 0.15);
      box(g, 0.42, 2.6, 2.0, mt.steelDark, dx, FLOOR + 1.3, 0);
      for (const sz of [-1, 1]) box(g, 0.46, 2.7, 0.1, mt.cyan, dx, FLOOR + 1.35, sz * 1.05);
      box(g, 0.46, 0.1, 2.2, mt.cyan, dx, FLOOR + 2.7, 0);
      box(g, 0.2, 0.2, W, mt.steel, sg * L / 4, FLOOR + 3.0, 0);
    }
    box(g, L, 0.05, W - 0.2, mt.glass, 0, FLOOR + 2.95, 0);
    box(g, L, 0.03, 0.14, mt.cyan, 0, FLOOR + 0.02, 0);
  }

  // ---------- DOM ----------
  buildDom() {
    const c = Game.c;
    this.dom = el('div', 'bs-ui');
    this.dom.innerHTML = `<div class="bs-top panel"><b>⬢ BASIS-ANSICHT</b><span>${esc(c.base.name)}</span><small class="bs-stats"></small></div>
      <div class="bs-labels"></div>
      <div class="bs-info panel" hidden></div>
      <div class="bs-bar"><span class="bs-hint"></span>
        <button class="btn" data-act="build">🏗 Bauen <kbd data-pad="X"></kbd></button>
        <button class="btn primary" data-act="close">✕ Schließen <kbd data-pad="B"></kbd></button></div>`;
    document.body.appendChild(this.dom);
    this.infoEl = this.dom.querySelector('.bs-info');
    this.labelWrap = this.dom.querySelector('.bs-labels');
    this.selLabel = el('div', 'bs-label sel'); this.selLabel.style.display = 'none'; this.labelWrap.appendChild(this.selLabel);
    this.dom.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'build') this.build();
      else if (b.dataset.act === 'close') this.close();
      else if (b.dataset.act === 'info-close') { sfx('click'); this.hideInfo(); }
    });
    this.updateHints();
  }

  updateStats() {
    const c = Game.c;
    const n = this.mods.filter((m) => m.kind !== 'site').length;
    this.dom.querySelector('.bs-stats').textContent = `${n} Module · ${c.building.length} im Bau · ${c.soldiers.length} Soldaten · ${c.scientists} Wissenschaftler`;
  }

  updateHints() {
    const d = Input.lastDevice;
    const pad = d === 'pad';
    const hint = pad ? `R-Stick drehen · ${padLabel('LT')}/${padLabel('RT')} Zoom · ✚/L-Stick Modul · ${padLabel('A')} Info · ${padLabel('Y')} Ansicht zurücksetzen`
      : d === 'touch' ? 'Wischen: drehen · Zwei Finger: zoomen/verschieben · Tippen: Modul-Info'
        : d === 'keyboard' ? 'WASD/Pfeile drehen · +/− Zoom · Q/E Modul · Enter Info · B Bauen · R Ansicht · Esc zurück'
          : 'Ziehen: drehen · Rechte Maustaste: verschieben · Mausrad: Zoom · Klick: Modul-Info';
    this.dom.querySelector('.bs-hint').textContent = hint;
    this.dom.querySelectorAll('kbd[data-pad]').forEach((k) => { k.textContent = pad ? padLabel(k.dataset.pad) : ''; k.style.display = pad ? '' : 'none'; });
  }

  infoHTML(m) {
    const c = Game.c;
    const kind = m.kind === 'site' ? m.type : m.kind;
    const K = KIND[kind];
    const count = { command: 1, storage: 1, quarters: this.mods.filter((x) => x.kind === 'quarters').length }[kind] ?? (c.facilities[kind] || 0);
    const nb = c.building.filter((b) => b.type === kind).length;
    const multi = count + nb > 1;
    const rows = [];
    rows.push(['Anzahl', `${count} betriebsbereit${nb ? ` · ${nb} im Bau` : ''}`]);
    let state, extra = '';
    if (m.kind === 'site') {
      const f = FACILITIES[m.type];
      const left = Math.ceil(m.b.daysLeft);
      state = `<span class="warn">Im Bau – noch ${left} ${left === 1 ? 'Tag' : 'Tage'}</span>${bar(clamp(f.days - m.b.daysLeft, 0, f.days), f.days, 'good')}`;
    } else state = '<span class="good">Betriebsbereit</span>';
    if (m.kind === 'command') {
      const t = c.transport;
      rows.push(['Transporter „Kondor“', TRANSPORT_STATUS[t?.status || 'ready'] || '—']);
      rows.push(['Standort', esc(c.base.name)]);
    } else if (m.kind === 'hangar') {
      extra = `<h4>Stellplätze</h4>${[0, 1].map((i) => { const cr = m.bays[i]; return cr ? `<div class="bs-row"><b>${esc(cr.name)}</b> <small>${CRAFTS[cr.type]?.name || cr.type} · Hülle ${Math.round(cr.hp)}/${CRAFTS[cr.type]?.hp || '?'}</small><span class="${cr.status === 'ready' ? 'good' : 'warn'}">${CRAFT_STATUS[cr.status] || cr.status}</span></div>` : '<div class="bs-row muted">— frei —</div>'; }).join('')}`;
      rows.push(['Abfangjäger gesamt', `${c.crafts.length} / ${c.facilities.hangar + 1} Plätze`]);
    } else if (m.kind === 'lab') {
      rows.push(['Wissenschaftler', `${c.scientists} / ${Game.labCapacity}`]);
      rows.push(['Projekt', c.research ? 'läuft' : '<span class="warn">keines</span>']);
    } else if (m.kind === 'radar') {
      rows.push(['Radarreichweite', `${Math.round(Game.radarRange / DEG * 111)} km`]);
    } else if (m.kind === 'medbay') {
      rows.push(['Verwundete', `${c.soldiers.filter((s) => s.wound > 0).length}`]);
    } else if (m.kind === 'quarters') {
      rows.push(['Belegung', `${c.soldiers.length} / ${count * 12} Soldaten`]);
    } else if (m.kind === 'storage') {
      rows.push(['Ausrüstung', `${Object.values(c.stock || {}).reduce((a, b) => a + (b || 0), 0)} Teile`]);
      rows.push(['Alien-Artefakte', `${Object.values(c.artifacts || {}).reduce((a, b) => a + (b || 0), 0)}`]);
    }
    const title = `${K.icon} ${esc(K.name)}${multi && m.num ? ` ${m.num}` : ''}`;
    return `<div class="bs-info-head"><h3>${title}</h3><button class="btn x" data-act="info-close" aria-label="Info schließen">✕</button></div>
      <p class="bs-func">${esc(m.kind === 'site' ? (FACILITIES[m.type].desc + ' – ' + K.func) : K.func)}</p>
      <dl class="bs-dl"><dt>Zustand</dt><dd>${state}</dd>${rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>${extra}`;
  }

  showInfo() {
    if (this.sel < 0) return;
    this.infoOpen = true;
    this.infoEl.innerHTML = this.infoHTML(this.mods[this.sel]);
    this.infoEl.hidden = false;
  }
  hideInfo() { this.infoOpen = false; if (this.infoEl) this.infoEl.hidden = true; }

  select(i, focus) {
    if (i < 0 || i >= this.mods.length) { this.sel = -1; this.selMesh.visible = false; this.selLabel.style.display = 'none'; this.hideInfo(); return; }
    this.sel = i;
    const m = this.mods[i];
    // Leuchtrahmen um das Modul
    const g = new THREE.Group(), y0 = FLOOR + 0.05, y1 = TOP + 0.45, t = 0.08, w = m.w + 0.5, d = m.d + 0.5;
    for (const sg of [-1, 1]) {
      box(g, w, t, t, null, 0, y1, sg * d / 2); box(g, t, t, d, null, sg * w / 2, y1, 0);
      box(g, w, t, t, null, 0, y0, sg * d / 2); box(g, t, t, d, null, sg * w / 2, y0, 0);
      for (const sz of [-1, 1]) box(g, t, y1 - y0, t, null, sg * w / 2, (y0 + y1) / 2, sz * d / 2);
    }
    g.position.set(m.cx, 0, m.cz);
    this.selMesh.geometry.dispose();
    this.selMesh.geometry = flatten(g);
    this.selMesh.visible = true;
    const K = KIND[m.kind === 'site' ? m.type : m.kind];
    this.selLabel.innerHTML = `${K.icon} ${esc(K.name)}${m.kind === 'site' ? ' (Baustelle)' : ''}`;
    this.selLabel.style.display = '';
    this.selPos = new THREE.Vector3(m.cx, TOP + 1.4, m.cz);
    if (focus) this.tTarget.set(m.cx, -2, m.cz);
    if (this.infoOpen) this.showInfo();
  }

  build() {
    sfx('click');
    if (this.opts.onBuild) this.opts.onBuild(); else this.geo.baseMenu?.();
  }

  resetView() { this.tTarget.set(0, -2, 0); this.tYaw = 0.75; this.tPitch = 0.82; this.tDist = 78; }

  // ---------- Eingabe ----------
  bindInput() {
    const cv = this.engine.canvas;
    const down = (e) => {
      cv.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), pan: e.button === 2 || e.shiftKey });
    };
    const move = (e) => {
      const p = this.pointers.get(e.pointerId); if (!p) return;
      if (this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const d0 = Math.hypot(a.x - b.x, a.y - b.y), m0x = (a.x + b.x) / 2, m0y = (a.y + b.y) / 2;
        p.x = e.clientX; p.y = e.clientY;
        const d1 = Math.hypot(a.x - b.x, a.y - b.y), m1x = (a.x + b.x) / 2, m1y = (a.y + b.y) / 2;
        if (d1 > 0 && d0 > 0) this.tDist = clamp(this.tDist * (d0 / d1), 16, 140);
        this.pan(m1x - m0x, m1y - m0y);
        return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (p.pan) this.pan(dx, dy);
      else { this.tYaw -= dx * 0.006; this.tPitch = clamp(this.tPitch + dy * 0.005, 0.18, 1.45); }
    };
    const up = (e) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (!p || anyModalOpen()) return;
      if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 8 && performance.now() - p.t < 600 && this.pointers.size === 0 && !p.pan) this.click(e.clientX, e.clientY);
    };
    const cancel = (e) => this.pointers.delete(e.pointerId);
    const wheel = (e) => { e.preventDefault(); this.tDist = clamp(this.tDist * (1 + Math.sign(e.deltaY) * 0.12), 16, 140); };
    const ctx = (e) => e.preventDefault();
    cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', cancel); cv.addEventListener('wheel', wheel, { passive: false }); cv.addEventListener('contextmenu', ctx);
    this.unsub.push(() => {
      cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up);
      cv.removeEventListener('pointercancel', cancel); cv.removeEventListener('wheel', wheel); cv.removeEventListener('contextmenu', ctx);
    });
    this.unsub.push(Input.on('pad', (b) => {
      if (this.closed || anyModalOpen()) return;
      if (['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(b)) this.navigate(b);
      else if (b === 'A') { if (this.sel < 0) this.select(0, true); if (this.infoOpen) this.hideInfo(); else this.showInfo(); sfx('click'); }
      else if (b === 'B') { if (this.infoOpen) { this.hideInfo(); sfx('click'); } else this.close(); }
      else if (b === 'X') this.build();
      else if (b === 'Y') this.resetView();
      else if (b === 'LB' || b === 'RB') this.cycle(b === 'RB' ? 1 : -1);
    }));
    this.unsub.push(Input.on('keydown', (code) => {
      if (this.closed || anyModalOpen()) return;
      if (code === 'Escape') { if (this.infoOpen) { this.hideInfo(); sfx('click'); } else this.close(); }
      else if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') { if (this.sel < 0) this.select(0, true); if (this.infoOpen) this.hideInfo(); else this.showInfo(); }
      else if (code === 'KeyQ') this.cycle(-1);
      else if (code === 'KeyE') this.cycle(1);
      else if (code === 'KeyB') this.build();
      else if (code === 'KeyR') this.resetView();
    }));
    this.unsub.push(Input.on('device', () => this.updateHints()));
  }

  pan(dx, dy) {
    const k = this.tDist * 0.0016;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw); // Blickrichtung am Boden
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    this.tTarget.x = clamp(this.tTarget.x - (rx * dx - fx * dy) * k, -36, 36);
    this.tTarget.z = clamp(this.tTarget.z - (rz * dx - fz * dy) * k, -36, 36);
  }

  click(x, y) {
    const r = this.engine.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), this.camera);
    const ray = this.raycaster.ray, hit = new THREE.Vector3();
    let best = -1, bd = Infinity;
    this.mods.forEach((m, i) => { if (ray.intersectBox(m.box, hit)) { const dd = hit.distanceTo(ray.origin); if (dd < bd) { bd = dd; best = i; } } });
    if (best >= 0) { sfx('click'); this.select(best, false); this.showInfo(); }
    else { this.select(-1); }
  }

  cycle(dir) {
    if (!this.mods.length) return;
    sfx('click');
    this.select(this.sel < 0 ? 0 : (this.sel + dir + this.mods.length) % this.mods.length, true);
  }

  project(v) {
    const p = v.clone().project(this.camera);
    const r = this.engine.canvas.getBoundingClientRect();
    return { x: (p.x + 1) / 2 * r.width, y: (1 - p.y) / 2 * r.height, behind: p.z > 1 };
  }

  // Räumliche Auswahl relativ zur Kamera (Steuerkreuz / Linkstick)
  navigate(dir) {
    if (!this.mods.length) return;
    if (this.sel < 0) { this.select(0, true); sfx('click'); return; }
    const cur = this.project(this.mods[this.sel].center);
    let best = -1, bs = Infinity;
    this.mods.forEach((m, i) => {
      if (i === this.sel) return;
      const p = this.project(m.center), dx = p.x - cur.x, dy = p.y - cur.y;
      let a, b;
      if (dir === 'UP') { if (dy >= -4) return; a = -dy; b = Math.abs(dx); }
      else if (dir === 'DOWN') { if (dy <= 4) return; a = dy; b = Math.abs(dx); }
      else if (dir === 'LEFT') { if (dx >= -4) return; a = -dx; b = Math.abs(dy); }
      else { if (dx <= 4) return; a = dx; b = Math.abs(dy); }
      const sc = a + b * 2.2;
      if (sc < bs) { bs = sc; best = i; }
    });
    if (best >= 0) { this.select(best, true); sfx('click'); }
  }

  pollInput(dt) {
    const k = (c) => Input.isDown(c);
    let ry = Input.axis(2), rp = -Input.axis(3), z = Input.trigger('LT') - Input.trigger('RT');
    if (k('ArrowLeft') || k('KeyA')) ry -= 1;
    if (k('ArrowRight') || k('KeyD')) ry += 1;
    if (k('ArrowUp') || k('KeyW')) rp += 1;
    if (k('ArrowDown') || k('KeyS')) rp -= 1;
    if (k('Equal') || k('NumpadAdd') || k('BracketRight') || k('PageUp')) z -= 1;
    if (k('Minus') || k('NumpadSubtract') || k('Slash') || k('PageDown')) z += 1;
    this.tYaw -= ry * 1.9 * dt;
    this.tPitch = clamp(this.tPitch + rp * 1.2 * dt, 0.18, 1.45);
    this.tDist = clamp(this.tDist * (1 + z * 1.5 * dt), 16, 140);
    // Linkstick: Modulauswahl mit Wiederholung
    const x = Input.axis(0), y = Input.axis(1);
    let d = null;
    if (Math.abs(x) > 0.6 || Math.abs(y) > 0.6) d = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'RIGHT' : 'LEFT') : (y > 0 ? 'DOWN' : 'UP');
    if (!d) this.navDir = null;
    else if (d !== this.navDir) { this.navDir = d; this.navRepeat = 0.4; this.navigate(d); }
    else if ((this.navRepeat -= dt) <= 0) { this.navRepeat = 0.2; this.navigate(d); }
  }

  // ---------- Frame ----------
  update(dt) {
    if (this.closed) return;
    this.t += dt;
    if (!anyModalOpen()) this.pollInput(dt);
    this.yaw = smooth(this.yaw, this.tYaw, 8, dt);
    this.pitch = smooth(this.pitch, this.tPitch, 8, dt);
    this.dist = smooth(this.dist, this.tDist, 3.5, dt);
    this.target.lerp(this.tTarget, 1 - Math.exp(-6 * dt));
    const cp = Math.cos(this.pitch);
    this.camera.position.set(this.target.x + Math.sin(this.yaw) * cp * this.dist, this.target.y + Math.sin(this.pitch) * this.dist, this.target.z + Math.cos(this.yaw) * cp * this.dist);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    // Animation: Radarantennen, Holo-Globus, Warnlichter, Auswahl
    if (this.radars.length) {
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
      this.radars.forEach((r, i) => { m4.compose(p.set(r.x, 5.4, r.z), q.setFromAxisAngle(UP, this.t * 0.9 + i * 1.7), s); this.dishes.setMatrixAt(i, m4); });
      this.dishes.instanceMatrix.needsUpdate = true;
    }
    this.holo.rotation.y = this.t * 0.5;
    this.holo.children[1].rotation.z = this.t * 1.3;
    const on = (this.t * 1.6) % 1 < 0.5;
    this.mt.blink.color.setRGB(1, 0.42, 0.05).multiplyScalar(on ? 4.5 : 0.25);
    this.mt.sel.opacity = 0.55 + Math.sin(this.t * 5) * 0.25;
    // Datenstand prüfen (z. B. nach Bauauftrag)
    if ((this.sigT -= dt) <= 0) { this.sigT = 0.5; if (this.sig() !== this.lastSig) this.rebuild(); }
    this.updateLabels();
  }

  updateLabels() {
    const place = (elx, pos) => {
      const p = this.project(pos);
      if (p.behind) { elx.style.visibility = 'hidden'; return; }
      elx.style.visibility = '';
      elx.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
    };
    this.labels.forEach((l) => place(l.el, l.pos));
    if (this.sel >= 0 && this.selPos) place(this.selLabel, this.selPos);
  }

  onResize() { this.updateLabels(); }

  // ---------- Aufräumen ----------
  disposeAll() {
    if (!this.mt) return;
    this.clearContent();
    this.scene.traverse((o) => { o.geometry?.dispose?.(); if (o.isInstancedMesh) o.dispose(); });
    this.dishGeo?.dispose();
    Object.values(this.mt).forEach((m) => m.dispose());
    Object.values(this.tex).forEach((t) => t.dispose());
    this.envRT?.dispose();
    this.scene.environment = null;
    this.dir?.dispose?.(); this.lightA?.dispose?.(); this.lightB?.dispose?.();
    this.scene.clear();
  }
}
