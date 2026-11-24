// Prozedurales „Hero-Auto“ der fiktiven Marke VARENNE (keine realen Marken, Logos oder Modellkopien).
// Karosserie = Loft über Querschnitte (Seitenprofil-, Draufsicht- und Querschnittsfunktionen je Typ),
// Material-Slots wie js/vehiclematerials.js: paint, glass, tyre, chrome, trim, headlight, taillight, interior, plate.
// Je LOD-Stufe ein Mesh pro Material (Räder als eigene Drehgruppen, in LOD2 eingebacken).
// Konventionen: Meter, Front = +Z, Boden y = 0, Fahrerseite (LHD) = +X.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const HERO_BRAND = 'Varenne';
export const HERO_TYPES = ['sedan', 'suv', 'pickup', 'van'];
export const HERO_SLOTS = ['paint', 'glass', 'tyre', 'chrome', 'trim', 'headlight', 'taillight', 'interior', 'plate'];
const MODEL_NAMES = { sedan: 'Elvra', suv: 'Taurek', pickup: 'Brasko', van: 'Pallion' };
const PALETTE = [0xb8bcc2, 0xf0f0ec, 0x16181b, 0x1c2f4f, 0x7a1418, 0x50555c, 0x26392e, 0x8c8676, 0x2b4d6e, 0x5e1f2c];
const LOD_DIST = [0, 14, 45];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smax = (a, b, k) => (a + b + Math.sqrt((a - b) * (a - b) + k * k)) / 2;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const YAX = V3(0, 1, 0);
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Monotone kubische Interpolation (Fritsch–Carlson) über [[x, y], …]. */
function pchip(tab) {
  const n = tab.length, xs = tab.map((p) => p[0]), ys = tab.map((p) => p[1]);
  if (n === 1) return () => ys[0];
  const d = [], m = new Array(n), h = [];
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

// =====================================================================
// Typ-Spezifikationen (Tabellen in z bzw. y; Werte in Metern)
// Querschnitts-Stücke k: 0 Boden, 1 Radhauswand, 2 Radhausdecke, 3 Schweller/Lippe, 4 Tür/Flanke,
// 5 obere Flanke (Leuchtenband), 6 Gürtelleiste, 7 Seitenscheibenband, 8 Dach außen/Frontscheibe, 9 Dachmitte
// =====================================================================
const SPEC_DATA = {
  sedan: {
    L: 4.62, H: 1.44,
    W: [[-2.31, 0.86], [-1.9, 0.905], [-1.4, 0.92], [0, 0.92], [1.4, 0.915], [1.9, 0.9], [2.31, 0.86]],
    yTop: [[-2.31, 1.0], [-2.2, 1.055], [-2.02, 1.075], [-1.55, 1.065], [-1.15, 1.25], [-0.75, 1.395], [-0.3, 1.44], [0, 1.44], [0.25, 1.405], [0.92, 1.0], [1.5, 0.915], [2.0, 0.85], [2.31, 0.8]],
    yBelt: [[-2.31, 0.98], [-1.6, 1.05], [-1.0, 1.035], [0, 1.0], [0.92, 0.975], [1.5, 0.89], [2.0, 0.825], [2.31, 0.78]],
    yShoulder: [[-2.31, 0.86], [-1.5, 0.88], [0, 0.865], [1.0, 0.84], [1.8, 0.76], [2.31, 0.7]],
    yBase: [[-2.31, 0.31], [-1.9, 0.25], [-1.4, 0.22], [1.4, 0.22], [1.9, 0.24], [2.31, 0.27]],
    yFloor: [[-2.31, 0.3], [-1.95, 0.18], [-1.5, 0.15], [1.5, 0.15], [1.95, 0.18], [2.31, 0.26]],
    ySill: 0.4, yRail: 1.355, crown: 0.085, k8f: 0.8, wellDepth: 0.3,
    wRail: [[-1.5, 0.62], [-0.75, 0.67], [0, 0.69], [0.6, 0.68], [1.0, 0.66]],
    front: { zs: 1.92, p: 2.4, ext: [[0.12, 2.16], [0.25, 2.27], [0.4, 2.31], [0.52, 2.305], [0.64, 2.27], [0.74, 2.2], [0.8, 2.13], [0.85, 2.06]] },
    rear: { zs: -1.92, p: 2.6, ext: [[0.2, -2.15], [0.32, -2.27], [0.5, -2.31], [0.85, -2.31], [1.0, -2.28], [1.08, -2.22]] },
    wheel: { r: 0.33, w: 0.235, rim: 0.2286, zF: 1.38, zR: -1.4, x: 0.785 }, archR: 0.47,
    ws: [0.25, 0.92], cowlW: 0.07, side: [[-1.08, 0.92]], pillars: [[-0.165, -0.085]],
    rw: [{ z: [-1.55, -0.75], k: [9] }], rearFace: null, beltMat: 'chrome', bed: null, dense: [],
    seams: [0.8, -0.125, -0.93], seamK: [4, 5, 6],
    regions: [
      { zone: 'F', k: [5], te: [0.3, 0.8], role: 'hl' },
      { zone: 'F', k: [4], te: [0.8, 1.01], y: [0.49, 9], mat: 'trim', inset: 0.035 },
      { zone: 'F', k: [3], te: [0.5, 1.01], mat: 'trim', inset: 0.022 },
      { zone: 'R', k: [5], te: [0.22, 1.01], mat: 'taillight', inset: 0.004 },
      { zone: 'R', k: [4], te: [0.84, 1.01], y: [0.52, 0.7], mat: 'paint', inset: 0.014 },
      { zone: 'R', k: [3], te: [0.55, 1.01], mat: 'trim' },
    ],
    shell: [-1.6, 0.92], floorY: 0.33,
    seats: { front: { z: -0.1, y: 0.52, x: 0.37 }, rear: { z: -0.8, y: 0.53, w: 1.25, hy: 0.55 } },
    steer: { z: 0.42, y: 0.93 }, dashZ: [0.52, 0.9], parcel: { z: [-1.6, -1.2], y: 1.03 }, bulkhead: null,
    mirrorZ: 0.74, handles: [0.06, -0.76],
    slats: { mat: 'chrome', ys: [0.53, 0.57, 0.61] }, emblemF: 0.66, plateF: 0.34, plateR: 0.61, emblemR: 0.79, wordR: [-0.5, 0.79, 1],
    exhaust: { x: [0.52, -0.52], y: 0.29 }, roofRails: false, wiperZ: 0.84,
  },
  suv: {
    L: 4.75, H: 1.72,
    W: [[-2.375, 0.91], [-2.0, 0.955], [-1.4, 0.965], [1.4, 0.965], [2.0, 0.95], [2.375, 0.9]],
    yTop: [[-2.375, 1.62], [-2.22, 1.71], [-1.9, 1.735], [-0.5, 1.74], [0.35, 1.735], [0.55, 1.7], [1.15, 1.22], [1.7, 1.15], [2.2, 1.09], [2.375, 1.05]],
    yBelt: [[-2.375, 1.17], [-1.8, 1.2], [0, 1.17], [1.15, 1.16], [1.7, 1.1], [2.2, 1.04], [2.375, 1.0]],
    yShoulder: [[-2.375, 1.02], [0, 1.02], [1.1, 1.0], [1.9, 0.93], [2.375, 0.87]],
    yBase: [[-2.375, 0.46], [-1.9, 0.39], [-1.4, 0.36], [1.4, 0.36], [1.9, 0.39], [2.375, 0.42]],
    yFloor: [[-2.375, 0.43], [-2.0, 0.28], [-1.5, 0.235], [1.5, 0.235], [2.0, 0.28], [2.375, 0.38]],
    ySill: 0.55, yRail: 1.635, crown: 0.085, k8f: 0.82, wellDepth: 0.32,
    wRail: [[-2.2, 0.73], [-1.0, 0.765], [0.5, 0.765], [1.0, 0.745]],
    front: { zs: 2.1, p: 3.0, ext: [[0.25, 2.26], [0.42, 2.35], [0.6, 2.375], [0.85, 2.37], [0.97, 2.33], [1.04, 2.27], [1.09, 2.21]] },
    rear: { zs: -2.15, p: 3.6, ext: [[0.3, -2.27], [0.45, -2.36], [0.7, -2.375], [1.1, -2.37], [1.25, -2.34], [1.6, -2.25], [1.72, -2.21]] },
    wheel: { r: 0.385, w: 0.265, rim: 0.254, zF: 1.455, zR: -1.395, x: 0.81 }, archR: 0.53,
    ws: [0.55, 1.15], cowlW: 0.07, side: [[-1.97, 1.15]], pillars: [[-0.12, -0.04], [-1.13, -1.04]],
    rw: [], rearFace: { te0: 0.45, y: [1.22, 1.62] }, beltMat: 'trim', bed: null, dense: [],
    seams: [1.0, -0.08, -1.05], seamK: [4, 5, 6],
    regions: [
      { zone: 'F', k: [5], te: [0.28, 0.78], role: 'hl' },
      { zone: 'F', k: [4], te: [0.74, 1.01], y: [0.65, 9], mat: 'trim', inset: 0.04 },
      { zone: 'F', k: [3], te: [0.45, 1.01], mat: 'trim', inset: 0.02 },
      { zone: 'R', k: [5], te: [0.12, 0.62], mat: 'taillight', inset: 0.004 },
      { zone: 'R', k: [4], te: [0.82, 1.01], y: [0.7, 0.88], mat: 'paint', inset: 0.014 },
      { zone: '*', k: [3], mat: 'trim' },
    ],
    shell: [-2.4, 1.15], floorY: 0.5,
    seats: { front: { z: 0.0, y: 0.75, x: 0.39 }, rear: { z: -0.92, y: 0.77, w: 1.35 } },
    steer: { z: 0.62, y: 1.13 }, dashZ: [0.75, 1.13], parcel: null, bulkhead: null,
    mirrorZ: 0.95, handles: [0.18, -0.72],
    slats: { mat: 'chrome', ys: [0.69, 0.73, 0.77] }, emblemF: 0.825, plateF: 0.48, plateR: 0.79, emblemR: 1.1, wordR: [-0.45, 0.96, 1],
    exhaust: { x: [0.55, -0.55], y: 0.43 }, roofRails: true, wiperZ: 1.07,
  },
  pickup: {
    L: 5.35, H: 1.86,
    W: [[-2.675, 0.95], [-2.4, 0.975], [0, 0.98], [2.2, 0.97], [2.675, 0.92]],
    yTop: [[-2.675, 0.98], [-0.64, 0.98], [-0.61, 1.05], [-0.575, 1.5], [-0.54, 1.78], [-0.47, 1.845], [0.5, 1.86], [0.68, 1.82], [1.22, 1.33], [1.8, 1.27], [2.4, 1.22], [2.675, 1.16]],
    yBelt: [[-2.675, 1.27], [-0.6, 1.29], [0, 1.28], [1.22, 1.265], [1.8, 1.23], [2.4, 1.17], [2.675, 1.13]],
    yShoulder: [[-2.675, 1.12], [0, 1.12], [1.3, 1.1], [2.3, 1.01], [2.675, 0.97]],
    yBase: [[-2.675, 0.5], [-2.3, 0.43], [-1.7, 0.39], [1.7, 0.39], [2.3, 0.43], [2.675, 0.41]],
    yFloor: [[-2.675, 0.46], [-2.35, 0.3], [-1.9, 0.27], [1.9, 0.27], [2.35, 0.3], [2.675, 0.4]],
    ySill: 0.58, yRail: 1.775, crown: 0.085, k8f: 0.84, wellDepth: 0.33,
    wRail: [[-0.6, 0.77], [0.6, 0.78], [1.1, 0.76]],
    front: { zs: 2.42, p: 3.2, ext: [[0.25, 2.56], [0.45, 2.66], [0.7, 2.675], [1.0, 2.67], [1.12, 2.62], [1.2, 2.56], [1.26, 2.5]] },
    rear: { zs: -2.52, p: 5, ext: [[0.35, -2.62], [0.5, -2.675], [1.3, -2.675]] },
    wheel: { r: 0.39, w: 0.265, rim: 0.254, zF: 1.725, zR: -1.675, x: 0.815 }, archR: 0.53,
    ws: [0.68, 1.22], cowlW: 0.07, side: [[-0.5, 1.22]], pillars: [[0.18, 0.27]],
    rw: [{ z: [-0.62, -0.49], y: [1.38, 1.74], k: [8, 9] }], rearFace: null, beltMat: 'chrome',
    bed: [-2.7, -0.605], dense: [[-0.64, -0.47, 10]],
    seams: [1.12, 0.22, -0.5, -0.615], seamK: [4, 5, 6],
    regions: [
      { zone: 'F', k: [5], te: [0.28, 0.7], role: 'hl' },
      { zone: 'F', k: [5], te: [0.7, 1.01], mat: 'trim', inset: 0.04 },
      { zone: 'F', k: [4], te: [0.62, 1.01], y: [0.7, 9], mat: 'trim', inset: 0.04 },
      { zone: 'F', k: [3], mat: 'trim' },
      { zone: 'R', k: [4, 5], te: [0.2, 0.5], y: [0.85, 9], mat: 'taillight', inset: 0.004 },
      { zone: 'R', k: [4], te: [0.85, 1.01], y: [0.66, 0.8], mat: 'paint', inset: 0.012 },
      { zone: 'R', k: [3], mat: 'chrome' },
      { zone: 'M', k: [3], mat: 'trim' },
    ],
    shell: [-0.62, 1.22], floorY: 0.62,
    seats: { front: { z: 0.3, y: 0.86, x: 0.4 }, rear: { z: -0.3, y: 0.88, w: 1.4 } },
    steer: { z: 0.8, y: 1.2 }, dashZ: [0.85, 1.2], parcel: null, bulkhead: null,
    mirrorZ: 1.02, handles: [0.38, -0.34],
    slats: { mat: 'chrome', ys: [0.76, 0.83, 0.9, 1.06] }, emblemF: 0.98, plateF: 0.48, plateR: 0.73, emblemR: 1.0, wordR: [0, 1.19, 1.8],
    exhaust: { x: [-0.62], y: 0.42 }, roofRails: false, wiperZ: 1.15,
  },
  van: {
    L: 5.1, H: 2.15,
    W: [[-2.55, 0.97], [-2.2, 0.99], [1.8, 0.99], [2.2, 0.965], [2.55, 0.9]],
    yTop: [[-2.55, 2.1], [-2.4, 2.145], [0.9, 2.15], [1.2, 2.08], [1.95, 1.19], [2.3, 1.09], [2.55, 1.03]],
    yBelt: [[-2.55, 1.12], [1.2, 1.12], [1.95, 1.1], [2.3, 1.03], [2.55, 0.99]],
    yShoulder: [[-2.55, 0.98], [1.6, 0.98], [2.2, 0.87], [2.55, 0.83]],
    yBase: [[-2.55, 0.4], [-2.0, 0.33], [2.0, 0.33], [2.55, 0.36]],
    yFloor: [[-2.55, 0.36], [-2.1, 0.22], [2.1, 0.22], [2.55, 0.32]],
    ySill: 0.52, yRail: 2.055, crown: 0.09, k8f: 0.86, wellDepth: 0.31,
    wRail: [[-2.3, 0.9], [0, 0.905], [1.2, 0.89], [1.6, 0.87]],
    front: { zs: 2.22, p: 2.6, ext: [[0.2, 2.4], [0.4, 2.52], [0.6, 2.55], [0.8, 2.54], [0.95, 2.48], [1.05, 2.41], [1.12, 2.35]] },
    rear: { zs: -2.42, p: 5, ext: [[0.3, -2.5], [0.45, -2.55], [2.0, -2.55], [2.15, -2.52]] },
    wheel: { r: 0.34, w: 0.235, rim: 0.2286, zF: 1.55, zR: -1.48, x: 0.83 }, archR: 0.48,
    ws: [1.2, 1.95], cowlW: 0.06, side: [[0.55, 1.95], [-0.62, 0.42]], pillars: [[0.42, 0.55]],
    rw: [], rearFace: { te0: 0.5, y: [1.28, 1.92] }, beltMat: 'trim', bed: null, dense: [],
    seams: [1.06, 0.5, -0.68], seamK: [4, 5, 6],
    regions: [
      { zone: 'F', k: [5], te: [0.25, 0.72], role: 'hl' },
      { zone: 'F', k: [4], te: [0.72, 1.01], y: [0.56, 9], mat: 'trim', inset: 0.035 },
      { zone: '*', k: [3], mat: 'trim' },
      { zone: 'R', k: [4, 5, 6, 7], te: [0.18, 0.42], y: [0.62, 1.45], mat: 'taillight', inset: 0.004 },
      { zone: 'R', k: [4], te: [0.85, 1.01], y: [0.58, 0.72], mat: 'paint', inset: 0.012 },
    ],
    shell: [-2.6, 1.95], floorY: 0.5,
    seats: { front: { z: 0.92, y: 0.8, x: 0.42 }, rear: null },
    steer: { z: 1.42, y: 1.2 }, dashZ: [1.5, 1.92], parcel: null, bulkhead: 0.45,
    mirrorZ: 1.78, handles: [0.65, -0.55],
    slats: { mat: 'chrome', ys: [0.61, 0.67, 0.73] }, emblemF: 0.785, plateF: 0.45, plateR: 0.65, emblemR: 1.02, wordR: [-0.45, 0.86, 1],
    exhaust: { x: [-0.6], y: 0.36 }, roofRails: false, wiperZ: 1.88,
  },
};
const SPEC_CACHE = {};
function getSpec(type) {
  if (SPEC_CACHE[type]) return SPEC_CACHE[type];
  const d = SPEC_DATA[type];
  const sp = {
    ...d, type, half: d.L / 2,
    W: pchip(d.W), yTop: pchip(d.yTop), yBelt: pchip(d.yBelt), yShoulder: pchip(d.yShoulder), yBase: pchip(d.yBase), yFloor: pchip(d.yFloor), wRail: pchip(d.wRail),
    front: { ...d.front, ext: pchip(d.front.ext), tip: d.L / 2 }, rear: { ...d.rear, ext: pchip(d.rear.ext), tip: -d.L / 2 },
  };
  return (SPEC_CACHE[type] = sp);
}

// =====================================================================
// Querschnitt
// =====================================================================
const PIECES = [[3, 2, 3, 4, 8, 5, 1, 6, 5, 7], [1, 1, 1, 2, 3, 2, 1, 3, 2, 3], [1, 1, 1, 1, 2, 1, 1, 1, 1, 2]];

function archY(sp, z) {
  let yA = sp.yBase(z);
  for (const zc of [sp.wheel.zF, sp.wheel.zR]) {
    const d = z - zc;
    if (Math.abs(d) < sp.archR) yA = Math.max(yA, sp.yBase(zc) + Math.sqrt(sp.archR * sp.archR - d * d));
  }
  return yA;
}
function sectionKeys(sp, z, mid) {
  const w = sp.W(z), yF = sp.yFloor(z);
  const yA = mid ? archY(sp, z) : sp.yBase(z);
  const yR0 = Math.max(sp.ySill, sp.yBase(z) + 0.05);
  const yS = Math.max(sp.yShoulder(z), yR0 + 0.08);
  const yR = Math.min(smax(yR0, yA + 0.05, 0.06), yS - 0.03);
  const yB = Math.max(sp.yBelt(z), yS + 0.04);
  const yT = sp.yTop(z);
  const wF = w - sp.wellDepth;
  const bed = yT < yB - 0.02;
  let x7, y7, x8, y8;
  if (bed) { y7 = yB + 0.012; x7 = w - 0.075; x8 = x7 - 0.07; y8 = yT + 0.03; }
  else {
    y7 = clamp(yT - sp.crown, yB + 0.03, sp.yRail);
    const f = clamp((y7 - yB) / (sp.yRail - yB), 0, 1);
    x7 = lerp(w - 0.062, sp.wRail(z), Math.pow(f, 0.8));
    x8 = x7 * sp.k8f; y8 = lerp(y7, yT, 0.8);
  }
  return [[0, yF], [wF, yF], [wF + 0.01, Math.max(yA - 0.012, yF + 0.02)], [w - 0.045, yA], [w - 0.018, yR], [w, yS],
    [w - 0.035, yB], [w - 0.047, yB + 0.018], [x7, y7], [x8, y8], [0, yT]];
}
// Zentripetaler Catmull-Rom zwischen p1 und p2, n Punkte (p1 inklusive)
function crSeg(p0, p1, p2, p3, n, out, o) {
  const k = (a, b) => Math.max(Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5), 1e-4);
  const t0 = 0, t1 = k(p0, p1), t2 = t1 + k(p1, p2), t3 = t2 + k(p2, p3);
  for (let s = 0; s < n; s++) {
    const t = t1 + (t2 - t1) * s / n;
    for (let c = 0; c < 2; c++) {
      const A1 = ((t1 - t) * p0[c] + (t - t0) * p1[c]) / (t1 - t0);
      const A2 = ((t2 - t) * p1[c] + (t - t1) * p2[c]) / (t2 - t1);
      const A3 = ((t3 - t) * p2[c] + (t - t2) * p3[c]) / (t3 - t2);
      const B1 = ((t2 - t) * A1 + (t - t0) * A2) / (t2 - t0);
      const B2 = ((t3 - t) * A2 + (t - t1) * A3) / (t3 - t1);
      out[(o + s) * 2 + c] = ((t2 - t) * B1 + (t - t1) * B2) / (t2 - t1);
    }
  }
}
// nb: Nachbarpunkte ohne Radlauf – Stücke ab k4 sehen nur diese, damit der Radlauf nicht in Schulter/Flanke ausstrahlt
const DENSE = new Float64Array(130);
function sampleHalf(keys, counts, out, nb = keys) {
  const n = keys.length;
  const get = (k, src) => (k < 0 ? [-src[1][0], src[1][1]] : k >= n ? [-src[n - 2][0], src[n - 2][1]] : src[k]);
  // Radlauf aktiv: Stück k4 exakt auf der Kurve ohne Radlauf ab Schnitthöhe yR abtasten
  let cut = null;
  if (nb !== keys && keys[4][1] > nb[4][1] + 1e-5) {
    const D = DENSE; crSeg(get(3, nb), nb[4], nb[5], get(6, nb), 64, D, 0); D[128] = nb[5][0]; D[129] = nb[5][1];
    let t = 0;
    for (let q = 0; q < 64; q++) { const y0 = D[q * 2 + 1], y1 = D[q * 2 + 3]; if ((y0 - keys[4][1]) * (y1 - keys[4][1]) <= 0 && y1 !== y0) { t = q + (keys[4][1] - y0) / (y1 - y0); break; } }
    cut = { D, t };
    const q = Math.min(Math.floor(t), 63), f = t - q;
    keys[4] = [lerp(D[q * 2], D[q * 2 + 2], f), keys[4][1]];
  }
  let o = 0;
  for (let k = 0; k < n - 1; k++) {
    if (k === 4 && cut) {
      for (let c = 0; c < counts[4]; c++) {
        const u = lerp(cut.t, 64, c / counts[4]), q = Math.min(Math.floor(u), 63), f = u - q;
        out[(o + c) * 2] = lerp(cut.D[q * 2], cut.D[q * 2 + 2], f); out[(o + c) * 2 + 1] = lerp(cut.D[q * 2 + 1], cut.D[q * 2 + 3], f);
      }
    } else { const src = k >= 4 ? nb : keys; crSeg(get(k - 1, src), keys[k], keys[k + 1], get(k + 2, src), counts[k], out, o); }
    o += counts[k];
  }
  out[o * 2] = keys[n - 1][0]; out[o * 2 + 1] = keys[n - 1][1];
}

// =====================================================================
// Stationen entlang Z (hinten -> vorne)
// =====================================================================
function buildStations(sp, lod) {
  const ds = [0.042, 0.12, 0.34][lod], nEnd = [18, 8, 4][lod], nArch = [24, 12, 6][lod];
  const zR = sp.rear.zs, zF = sp.front.zs;
  const list = [];
  const add = (z, pri) => { if (z > zR + 1e-4 && z < zF - 1e-4) list.push({ z, pri }); };
  const n = Math.ceil((zF - zR) / ds);
  for (let i = 1; i < n; i++) add(zR + (zF - zR) * i / n, 0);
  for (const zc of [sp.wheel.zF, sp.wheel.zR]) for (let a = 0; a <= nArch; a++) add(zc + sp.archR * Math.cos(Math.PI * a / nArch), 1);
  if (lod < 2) {
    const feats = [sp.ws[0], sp.ws[1], sp.ws[1] + sp.cowlW, ...sp.side.flat(), ...sp.pillars.flat(), ...sp.rw.flatMap((r) => r.z), ...(sp.bed || [])];
    for (const z of feats) add(z, 2);
    for (const [a, b, c] of sp.dense) for (let i = 0; i <= c; i++) add(lerp(a, b, i / c), 2);
  }
  if (lod === 0) for (const s of sp.seams) { add(s - 0.003, 3); add(s, 3); add(s + 0.003, 3); }
  list.sort((a, b) => a.z - b.z);
  const mid = [];
  for (const s of list) {
    const last = mid[mid.length - 1];
    if (last && s.z - last.z < 0.0015) { if (s.pri > last.pri) mid[mid.length - 1] = s; continue; }
    mid.push(s);
  }
  // Endzonen: Superellipse in der Draufsicht, Parameter θ
  const endSt = (zone) => {
    const e = zone === 'F' ? sp.front : sp.rear;
    const th = new Set();
    for (let i = 0; i <= nEnd; i++) th.add(i / nEnd);
    if (lod < 2) {
      for (const r of sp.regions) if (r.te && r.zone === zone) for (const t of r.te) if (t > 0 && t < 1) th.add(t);
      if (zone === 'R' && sp.rearFace) th.add(sp.rearFace.te0);
    }
    const arr = [...th].sort((a, b) => a - b).filter((t, i, a) => i === 0 || t - a[i - 1] > 0.004);
    return arr.map((te) => {
      const theta = te * Math.PI / 2, ex = 2 / e.p;
      const s = Math.pow(Math.max(Math.cos(theta), 0), ex), dz = Math.pow(Math.sin(theta), ex);
      return { zone, te, s: te >= 1 ? 0 : s, dz, zNom: e.zs + dz * (e.tip - e.zs), e };
    });
  };
  const R = endSt('R').reverse(), F = endSt('F');
  return [...R, ...mid.map((m) => ({ zone: 'M', te: 0, s: 1, dz: 0, zNom: m.z })), ...F];
}

// =====================================================================
// Karosserie-Gitter
// =====================================================================
function buildBodyGrid(sp, lod) {
  const counts = PIECES[lod];
  const NHc = counts.reduce((a, b) => a + b, 0), NH = NHc + 1, NR = 2 * NHc;
  const pieceOf = [], pStart = [];
  for (let k = 0, j = 0; k < counts.length; k++) { pStart[k] = j; for (let c = 0; c < counts[k]; c++) pieceOf[j++] = k; }
  pStart[counts.length] = NHc;
  const st = buildStations(sp, lod), NS = st.length;
  const P0 = new Float32Array(NS * NR * 3);
  const half = new Float64Array(NH * 2);
  for (let i = 0; i < NS; i++) {
    const S = st[i];
    const keys = sectionKeys(sp, S.zNom, S.zone === 'M');
    const nb = S.zone === 'M' ? sectionKeys(sp, S.zNom, false) : keys;
    if (S.s !== 1) for (const kp of keys) kp[0] *= S.s;
    sampleHalf(keys, counts, half, nb);
    for (let r = 0; r < NR; r++) {
      const j = r < NH ? r : NR - r, sx = r < NH ? 1 : -1;
      const x = half[j * 2] * sx, y = half[j * 2 + 1];
      const z = S.zone === 'M' ? S.zNom : S.e.zs + S.dz * (S.e.ext(y) - S.e.zs);
      const o = (i * NR + r) * 3; P0[o] = x; P0[o + 1] = y; P0[o + 2] = z;
    }
  }
  const N0 = gridNormals(P0, NS, NR);
  // Spitzen-Stationen (Ring auf x = 0 zusammengefallen): Normale symmetrisch
  for (const i of [0, NS - 1]) for (let r = 0; r < NR; r++) {
    const o = (i * NR + r) * 3; N0[o] = 0; const l = Math.hypot(N0[o + 1], N0[o + 2]) || 1; N0[o + 1] /= l; N0[o + 2] /= l;
  }
  return { sp, lod, counts, NH, NR, NS, st, P0, N0, pieceOf, pStart };
}
function gridNormals(P, NS, NR) {
  const N = new Float32Array(P.length);
  const acc = (a, b, c) => {
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
    const vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const q of [a, b, c]) { N[q * 3] += nx; N[q * 3 + 1] += ny; N[q * 3 + 2] += nz; }
  };
  for (let i = 0; i < NS - 1; i++) for (let r = 0; r < NR; r++) {
    const r1 = (r + 1) % NR, a = i * NR + r, b = i * NR + r1, c = (i + 1) * NR + r, d = (i + 1) * NR + r1;
    acc(a, b, c); acc(b, d, c);
  }
  for (let q = 0; q < N.length; q += 3) {
    const l = Math.hypot(N[q], N[q + 1], N[q + 2]);
    if (l > 1e-12) { N[q] /= l; N[q + 1] /= l; N[q + 2] /= l; } else { N[q + 1] = 1; }
  }
  return N;
}
const inR = (ranges, z) => ranges.some((r) => z >= r[0] && z <= r[1]);

function classifyCells(G) {
  const { sp, lod, st, NS, NR, NH, P0, pieceOf, pStart, counts } = G;
  const NHc = NH - 1;
  const cls = new Array((NS - 1) * NHc);
  const sideMin = Math.min(...sp.side.map((r) => r[0])), sideMax = Math.max(...sp.side.map((r) => r[1]));
  const seamCell = st.slice(0, -1).map((s, i) => lod === 0 && s.zone === 'M' && st[i + 1].zone === 'M' &&
    sp.seams.some((z) => s.zNom >= z - 0.0031 && st[i + 1].zNom <= z + 0.0031));
  const C = (mat, inset = 0, extra) => ({ mat, inset, ...extra });
  const GLASS = C('glass'), PAINT = C('paint'), TRIM = C('trim');
  for (let i = 0; i < NS - 1; i++) {
    const sa = st[i], sb = st[i + 1];
    const zone = sa.zone === sb.zone ? sa.zone : 'M';
    const z = (sa.zNom + sb.zNom) / 2, te = (sa.te + sb.te) / 2;
    for (let j = 0; j < NHc; j++) {
      const k = pieceOf[j];
      const a = (i * NR + j) * 3, b = a + 3, c = ((i + 1) * NR + j) * 3, d = c + 3;
      const yc = (P0[a + 1] + P0[b + 1] + P0[c + 1] + P0[d + 1]) / 4;
      const res = (() => {
        if (k <= 2) return TRIM;
        for (const R of sp.regions) {
          if (R.zone !== '*' && R.zone !== zone) continue;
          if (!R.k.includes(k)) continue;
          if (R.te && (zone === 'M' || te < R.te[0] || te > R.te[1])) continue;
          if (R.y && (yc < R.y[0] || yc > R.y[1])) continue;
          if (R.role === 'hl') return lod === 0 ? C('chrome', 0.03, { cover: true, hl: true }) : C('headlight', lod === 1 ? 0.004 : 0, { hl: true });
          return C(R.mat, lod === 2 ? 0 : (R.inset || 0), { tl: R.mat === 'taillight' });
        }
        if (seamCell[i] && sp.seamK.includes(k)) return C('trim', 0.006);
        if (zone === 'M') {
          const first8 = j === pStart[8], last7 = j === pStart[8] - 1;
          if (z >= sp.ws[0] && z <= sp.ws[1] && (k === 8 || k === 9)) return k === 8 && first8 && counts[8] >= 3 ? PAINT : GLASS;
          if (z > sp.ws[1] && z <= sp.ws[1] + sp.cowlW && k >= 7) return TRIM;
          for (const r of sp.rw) if (r.k.includes(k) && z >= r.z[0] && z <= r.z[1] && (!r.y || (yc >= r.y[0] && yc <= r.y[1]))) return GLASS;
          if (k === 7) {
            if (last7 && counts[7] >= 3) return PAINT;
            if (inR(sp.pillars, z)) return TRIM;
            if (inR(sp.side, z)) return GLASS;
          }
          if (k === 6 && z >= sideMin && z <= sideMax) return C(sp.beltMat);
          if (sp.bed && z >= sp.bed[0] && z <= sp.bed[1] && (k === 8 || k === 9)) return TRIM;
        } else if (zone === 'R') {
          if (sp.rearFace && k === 7 && te >= sp.rearFace.te0 && yc >= sp.rearFace.y[0] && yc <= sp.rearFace.y[1]) return GLASS;
          if (sp.bed && (k === 8 || k === 9)) return TRIM;
        }
        return PAINT;
      })();
      cls[i * NHc + j] = res;
    }
  }
  return cls;
}

// =====================================================================
// Geometrie-Sammler (ein Topf je Material)
// =====================================================================
class Bucket {
  constructor() { this.pos = []; this.uv = []; this.idx = []; this.map = new Map(); }
  v(key, x, y, z, u, w) {
    let id = this.map.get(key);
    if (id === undefined) { id = this.pos.length / 3; this.pos.push(x, y, z); this.uv.push(u, w); this.map.set(key, id); }
    return id;
  }
  geometry() {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx); g.computeVertexNormals();
    return g;
  }
}
function prep(g, m) {
  if (!g.index) { const n = g.attributes.position.count, a = []; for (let i = 0; i < n; i++) a.push(i); g.setIndex(a); }
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  if (m) {
    g.applyMatrix4(m);
    if (m.determinant() < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.index.needsUpdate = true; }
  }
  g.morphAttributes = {}; g.clearGroups();
  return g;
}
class Parts {
  constructor() { this.list = {}; }
  add(mat, g, m) { (this.list[mat] ||= []).push(prep(g, m)); return this; }
  /** Teil rechts und gespiegelt links */
  addSym(mat, g, m) { const g2 = g.clone(); this.add(mat, g, m); this.add(mat, g2, MIRX.clone().multiply(m || new THREE.Matrix4())); return this; }
  merge() {
    const out = {};
    for (const [mat, arr] of Object.entries(this.list)) {
      if (!arr.length) continue;
      out[mat] = arr.length === 1 ? arr[0] : mergeGeometries(arr, false);
      if (arr.length > 1) for (const g of arr) g.dispose();
    }
    return out;
  }
}
const MIRX = new THREE.Matrix4().makeScale(-1, 1, 1);
const M4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V3(sx, sy, sz));
/** Matrix: Ursprung p, lokale +Z = n, lokale +Y möglichst „up“ */
function frame(p, n, up = YAX, s = 1) {
  const z = n.clone().normalize();
  let x = up.clone().cross(z); if (x.lengthSq() < 1e-8) x = V3(1, 0, 0).cross(z); x.normalize();
  const y = z.clone().cross(x);
  return new THREE.Matrix4().makeBasis(x.multiplyScalar(s), y.multiplyScalar(s), z.multiplyScalar(s)).setPosition(p);
}

// --- Grundformen ---------------------------------------------------------
function roundedBox(w, h, d, r, seg = 3) {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const p = g.attributes.position, n = g.attributes.normal;
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r, v = V3(), c = V3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(clamp(v.x, -hx, hx), clamp(v.y, -hy, hy), clamp(v.z, -hz, hz));
    const dir = v.clone().sub(c);
    if (dir.lengthSq() > 1e-12) { dir.normalize(); v.copy(c).addScaledVector(dir, r); p.setXYZ(i, v.x, v.y, v.z); n.setXYZ(i, dir.x, dir.y, dir.z); }
  }
  return g;
}
/** Profil (CCW, [x,y]) entlang Pfad; Normalen glatt */
function sweep(pts, prof, { up = YAX, scale = null, caps = false } = {}) {
  const n = pts.length, m = prof.length;
  const pos = new Float32Array(n * m * 3), uv = new Float32Array(n * m * 2), idx = [];
  const T = V3(), S = V3(), U = V3(), q = V3();
  for (let i = 0; i < n; i++) {
    T.subVectors(pts[Math.min(i + 1, n - 1)], pts[Math.max(i - 1, 0)]).normalize();
    S.crossVectors(T, up); if (S.lengthSq() < 1e-8) S.crossVectors(T, V3(1, 0, 0)); S.normalize();
    U.crossVectors(S, T);
    const sc = scale ? scale(i / (n - 1)) : [1, 1];
    for (let k = 0; k < m; k++) {
      q.copy(pts[i]).addScaledVector(S, prof[k][0] * sc[0]).addScaledVector(U, prof[k][1] * sc[1]);
      pos.set([q.x, q.y, q.z], (i * m + k) * 3); uv.set([k / m, i / (n - 1)], (i * m + k) * 2);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < m; k++) {
    const a = i * m + k, b = i * m + (k + 1) % m, c = (i + 1) * m + k, d = (i + 1) * m + (k + 1) % m;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (caps) {
    const base = n * m, P = Array.from(pos);
    for (const [ring, flip] of [[0, true], [n - 1, false]]) {
      const ci = P.length / 3; P.push(pts[ring].x, pts[ring].y, pts[ring].z);
      for (let k = 0; k < m; k++) { const a = ring * m + k, b = ring * m + (k + 1) % m; flip ? idx.push(ci, a, b) : idx.push(ci, b, a); }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    const U2 = new Float32Array((P.length / 3) * 2); U2.set(uv); g.setAttribute('uv', new THREE.BufferAttribute(U2, 2));
    void base;
  }
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const rectProf = (w, h, bev = 0.25) => {
  const a = w / 2, b = h / 2, ca = a * (1 - bev), cb = b * (1 - bev);
  return [[a, -cb], [a, cb], [ca, b], [-ca, b], [-a, cb], [-a, -cb], [-ca, -b], [ca, -b]];
};
const circProf = (r, n = 6) => Array.from({ length: n }, (_, i) => [Math.cos(i / n * Math.PI * 2) * r, Math.sin(i / n * Math.PI * 2) * r]);

// --- Gitter-Abfragen (vor Einzug; rechte Hälfte) -------------------------
function gp(G, i, j, t = 0) {
  const { NR, P0, N0 } = G, a = (i * NR + j) * 3, b = (i * NR + j + 1) * 3;
  return {
    p: V3(lerp(P0[a], P0[b], t), lerp(P0[a + 1], P0[b + 1], t), lerp(P0[a + 2], P0[b + 2], t)),
    n: V3(lerp(N0[a], N0[b], t), lerp(N0[a + 1], N0[b + 1], t), lerp(N0[a + 2], N0[b + 2], t)).normalize(),
  };
}
function ringCross(G, i, axis, val, kMin, kMax) {
  const { NR, P0, pStart } = G, o = axis === 'x' ? 0 : 1;
  let best = null, bd = 1e9;
  for (let j = pStart[kMin]; j < pStart[kMax + 1]; j++) {
    const v0 = P0[(i * NR + j) * 3 + o], v1 = P0[(i * NR + j + 1) * 3 + o];
    if ((v0 - val) * (v1 - val) <= 0 && v0 !== v1) return gp(G, i, j, (val - v0) / (v1 - v0));
    const dd = Math.abs(v0 - val); if (dd < bd) { bd = dd; best = j; }
  }
  return gp(G, i, best ?? pStart[kMin], 0);
}
function pieceAt(G, i, k, f) {
  const u = G.pStart[k] + f * G.counts[k], j = Math.min(Math.floor(u), G.pStart[k + 1] - 1);
  return gp(G, i, j, u - j);
}
function stationAtZ(G, z) {
  let bi = 0, bd = 1e9;
  G.st.forEach((s, i) => { if (s.zone === 'M' && Math.abs(s.zNom - z) < bd) { bd = Math.abs(s.zNom - z); bi = i; } });
  return bi;
}
const zoneStations = (G, zone) => G.st.map((s, i) => (s.zone === zone ? i : -1)).filter((i) => i >= 0);
/** Punkt auf Front/Heck bei Höhe y und Querlage x (x >= 0) */
function endPoint(G, zone, x, y, kMin = 3, kMax = 6) {
  const ids = zoneStations(G, zone);
  let prev = null;
  for (const i of (zone === 'F' ? ids : ids.slice().reverse())) {
    const h = ringCross(G, i, 'y', y, kMin, kMax);
    if (prev && (prev.p.x - x) * (h.p.x - x) <= 0) {
      const t = (x - prev.p.x) / ((h.p.x - prev.p.x) || 1e-9);
      return { p: prev.p.clone().lerp(h.p, t), n: prev.n.clone().lerp(h.n, t).normalize() };
    }
    prev = h;
  }
  return prev;
}
const mirrorHit = (h) => ({ p: V3(-h.p.x, h.p.y, h.p.z), n: V3(-h.n.x, h.n.y, h.n.z) });

// =====================================================================
// Karosserie in Töpfe
// =====================================================================
function emitBody(G, cls) {
  const { sp, NS, NR, NH, P0, N0, st } = G;
  const NHc = NH - 1, NV = NS * NR, L = sp.L, H = sp.H;
  // Einzug je Vertex = Minimum der angrenzenden Zellen
  const P = new Float32Array(P0);
  for (let i = 0; i < NS; i++) for (let r = 0; r < NR; r++) {
    let m = Infinity;
    for (const di of [-1, 0]) for (const dr of [-1, 0]) {
      const ii = i + di; if (ii < 0 || ii >= NS - 1) continue;
      const rr = (r + dr + NR) % NR, j = rr < NHc ? rr : NR - 1 - rr;
      m = Math.min(m, cls[ii * NHc + j].inset);
    }
    if (m > 0 && m < Infinity) { const o = (i * NR + r) * 3; P[o] -= N0[o] * m; P[o + 1] -= N0[o + 1] * m; P[o + 2] -= N0[o + 2] * m; }
  }
  const B = {}, bk = (m) => (B[m] ||= new Bucket());
  const vtx = (b, id, arr, off, dn = 0) => {
    const o = id * 3, x = arr[o] - N0[o] * dn, y = arr[o + 1] - N0[o + 1] * dn, z = arr[o + 2] - N0[o + 2] * dn;
    return b.v(id + off, x, y, z, z / L + 0.5, y / H);
  };
  const shellIn = (i) => {
    const s = st[i];
    if (s.zone === 'M') return s.zNom >= sp.shell[0] && s.zNom <= sp.shell[1];
    if (s.zone === 'R') return sp.shell[0] <= -sp.half;
    return sp.shell[1] >= sp.half;
  };
  // Spitzen-Vertices links auf rechts verschweißen (gleiche Position) -> keine Naht in der Mitte
  const wid = (i, r) => ((i === 0 || i === NS - 1) && r > NHc ? i * NR + (NR - r) : i * NR + r);
  for (let i = 0; i < NS - 1; i++) {
    const sh = shellIn(i) && shellIn(i + 1);
    for (let r = 0; r < NR; r++) {
      const j = r < NHc ? r : NR - 1 - r, c = cls[i * NHc + j];
      const r1 = (r + 1) % NR, a = wid(i, r), b = wid(i, r1), cc = wid(i + 1, r), d = wid(i + 1, r1);
      const bu = bk(c.mat);
      const A = vtx(bu, a, P, 0), Bv = vtx(bu, b, P, 0), Cc = vtx(bu, cc, P, 0), D = vtx(bu, d, P, 0);
      bu.idx.push(A, Bv, Cc, Bv, D, Cc);
      if (c.cover) {
        const g = bk('glass'), o = NV;
        const A2 = vtx(g, a, P0, o), B2 = vtx(g, b, P0, o), C2 = vtx(g, cc, P0, o), D2 = vtx(g, d, P0, o);
        g.idx.push(A2, B2, C2, B2, D2, C2);
      }
      if (sh && G.pieceOf[j] >= 4 && c.mat !== 'glass') {
        const g = bk('interior'), o = 2 * NV, dn = 0.03;
        const A2 = vtx(g, a, P0, o, dn), B2 = vtx(g, b, P0, o, dn), C2 = vtx(g, cc, P0, o, dn), D2 = vtx(g, d, P0, o, dn);
        g.idx.push(A2, C2, B2, B2, C2, D2);
      }
    }
  }
  const out = {};
  for (const [m, b] of Object.entries(B)) { const g = b.geometry(); if (g) out[m] = g; }
  return out;
}

// =====================================================================
// Anbauteile
// =====================================================================
function addHeadlightInternals(G, cls, parts) {
  const { sp } = G;
  const R = sp.regions.find((r) => r.role === 'hl');
  const ids = zoneStations(G, 'F').filter((i) => G.st[i].te >= R.te[0] && G.st[i].te <= R.te[1]);
  if (ids.length < 2) return;
  const lensG = new THREE.SphereGeometry(0.021, 18, 8, 0, Math.PI * 2, 0, 0.95);
  const bowlPts = []; for (let t = 1; t >= 0; t -= 0.125) bowlPts.push(new THREE.Vector2(0.03 * t + 1e-4, 0.02 * t * t));
  const bowlG = new THREE.LatheGeometry(bowlPts, 20);
  for (const f of [0.3, 0.62]) {
    const i = ids[Math.round(f * (ids.length - 1))];
    const h = pieceAt(G, i, 5, 0.45);
    const axis = h.n.clone().multiplyScalar(0.45).add(V3(0, 0, 1)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(YAX, axis);
    const mB = new THREE.Matrix4().compose(h.p.clone().addScaledVector(h.n, -0.03), q, V3(1, 1, 1));
    const mL = new THREE.Matrix4().compose(h.p.clone().addScaledVector(h.n, -0.026), q, V3(1, 1, 1));
    parts.addSym('chrome', bowlG.clone(), mB);
    parts.addSym('headlight', lensG.clone(), mL);
  }
  // Tagfahrlicht-Leiste
  const pts = ids.map((i) => { const h = pieceAt(G, i, 5, 0.8); return h.p.addScaledVector(h.n, -0.012); });
  if (pts.length >= 2) parts.addSym('headlight', sweep(pts, circProf(0.0045, 6)));
  lensG.dispose(); bowlG.dispose();
}
function addGrille(G, parts) {
  const { sp } = G;
  const reg = sp.regions.filter((r) => r.zone === 'F' && r.mat === 'trim' && r.inset >= 0.03);
  const te0 = Math.min(...reg.map((r) => r.te[0]));
  const ids = zoneStations(G, 'F').filter((i) => G.st[i].te >= te0 - 0.02);
  for (const y of sp.slats.ys) {
    const right = ids.map((i) => { const h = ringCross(G, i, 'y', y, 3, 6); return h.p.addScaledVector(h.n, -0.016); });
    const pts = [...right.slice(0, -1).map((p) => V3(-p.x, p.y, p.z)), ...right.slice().reverse()];
    parts.add(sp.slats.mat, sweep(pts, rectProf(0.012, 0.014)));
  }
}
function addPlatesAndBadges(G, parts) {
  const { sp } = G;
  const tipF = G.NS - 1, tipR = 0;
  // Kennzeichen (UV-Bereich oben im Atlas)
  const plate = (h, outward) => {
    const g = new THREE.PlaneGeometry(0.52, 0.112);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, lerp(1 - 220 / 512, 1, uv.getY(i)));
    parts.add('plate', g, frame(h.p.clone().addScaledVector(h.n, outward + 0.002), h.n));
    parts.add('trim', new THREE.PlaneGeometry(0.54, 0.13), frame(h.p.clone().addScaledVector(h.n, outward - 0.002), h.n));
  };
  plate(ringCross(G, tipF, 'y', sp.plateF, 3, 5), 0.012);
  plate(ringCross(G, tipR, 'y', sp.plateR, 3, 5), 0.002);
  // Emblem (Sechseck, UV-Bereich unten links im Atlas)
  const emb = (h, R, out) => {
    const g = new THREE.CircleGeometry(R, 6, Math.PI / 6 * 0);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { uv.setXY(i, 0.125 + p.getX(i) / R * (118 / 128) * 0.125, 0.25 + p.getY(i) / R * (118 / 128) * 0.25); }
    parts.add('plate', g, frame(h.p.clone().addScaledVector(h.n, out), h.n));
  };
  emb(ringCross(G, tipF, 'y', sp.emblemF, 3, 6), 0.036, -0.004);
  emb(ringCross(G, tipR, 'y', sp.emblemR, 3, 6), 0.034, 0.003);
  // Schriftzug
  const [wx, wy, ws] = sp.wordR;
  const hw = wx === 0 ? ringCross(G, tipR, 'y', wy, 3, 6) : mirrorHitIf(endPoint(G, 'R', Math.abs(wx), wy), wx < 0);
  if (hw) {
    const g = new THREE.PlaneGeometry(0.3 * ws, 0.036 * ws);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, lerp(0.25, 1, uv.getX(i)), lerp(92 / 512, 212 / 512, uv.getY(i)));
    parts.add('plate', g, frame(hw.p.clone().addScaledVector(hw.n, 0.002), hw.n));
  }
}
const mirrorHitIf = (h, m) => (h && m ? mirrorHit(h) : h);
function addExhaust(G, parts) {
  const { sp } = G;
  for (const x of sp.exhaust.x) {
    const h = endPoint(G, 'R', Math.abs(x), sp.exhaust.y, 3, 4);
    if (!h) continue;
    const p = V3(x, sp.exhaust.y, h.p.z + 0.035);
    const tube = [[0.036, -0.065], [0.036, 0.065], [0.031, 0.065], [0.031, -0.065]].map(([r, a]) => new THREE.Vector2(r, a));
    parts.add('chrome', new THREE.LatheGeometry(tube, 20).rotateX(-Math.PI / 2), M4(p.x, p.y, p.z));
    parts.add('trim', new THREE.CircleGeometry(0.031, 16), M4(p.x, p.y, p.z - 0.03, 0, Math.PI, 0));
  }
}
function addMirrorsHandlesWipers(G, parts, lod) {
  const { sp } = G;
  // Außenspiegel
  const z = sp.mirrorZ, w = sp.W(z), yb = sp.yBelt(z);
  const hs = new THREE.SphereGeometry(1, lod === 0 ? 22 : 10, lod === 0 ? 12 : 6);
  const p = hs.attributes.position; for (let i = 0; i < p.count; i++) if (p.getZ(i) < 0) p.setZ(i, p.getZ(i) * 0.28);
  hs.computeVertexNormals();
  const cx = w + 0.085, cy = yb + 0.075, cz = z - 0.08;
  parts.addSym('paint', hs, M4(cx, cy, cz, 0, 0.12, 0, 0.105, 0.062, 0.06));
  parts.addSym('chrome', new THREE.CircleGeometry(1, 20), new THREE.Matrix4().compose(V3(cx - 0.002, cy, cz - 0.0175), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI + 0.12, 0)), V3(0.094, 0.052, 1)));
  parts.addSym('trim', roundedBox(0.1, 0.028, 0.07, 0.01, 1), M4(w + 0.01, yb + 0.04, z - 0.05, 0, 0, 0.3));
  if (lod > 0) return;
  // Türgriffe
  for (const hz of sp.handles) {
    const i = stationAtZ(G, hz), h = ringCross(G, i, 'y', sp.yShoulder(hz) - 0.05, 4, 5);
    parts.addSym('chrome', roundedBox(0.026, 0.024, 0.14, 0.01, 2), frame(h.p.clone().addScaledVector(h.n, 0.008), h.n).multiply(M4(0, 0, 0, 0, Math.PI / 2, 0)));
  }
  // Scheibenwischer
  const iw = stationAtZ(G, sp.wiperZ);
  const pts = [];
  for (let j = G.pStart[7]; j <= G.pStart[10]; j++) { const h = gp(G, iw, Math.min(j, G.NH - 2), j >= G.NH - 1 ? 1 : 0); if (h.p.x <= 0.66) pts.push(h.p.addScaledVector(h.n, 0.014)); }
  pts.reverse();
  const right = pts.filter((q) => q.x >= 0.05 && q.x <= 0.66);
  const left = pts.filter((q) => q.x <= 0.6 && q.x >= 0.0).map((q) => V3(-q.x, q.y + 0.004, q.z - 0.012)).reverse();
  for (const path of [right, left]) if (path.length >= 2) parts.add('trim', sweep(path, rectProf(0.02, 0.012), { up: V3(0, 0.5, 1).normalize() }));
}
function addRoofRails(G, parts) {
  const ids = zoneStations(G, 'M').filter((i) => G.st[i].zNom > -1.95 && G.st[i].zNom < 0.42);
  const pts = ids.filter((_, k) => k % 3 === 0).map((i) => { const h = ringCross(G, i, 'x', 0.6, 8, 9); return h.p.addScaledVector(h.n, 0.05); });
  if (pts.length < 2) return;
  parts.addSym('trim', sweep(pts, rectProf(0.028, 0.024)));
  for (const q of [pts[0], pts[pts.length - 1]]) parts.addSym('trim', roundedBox(0.03, 0.06, 0.09, 0.01, 1), M4(q.x, q.y - 0.025, q.z));
}
function addInterior(G, parts, lod) {
  const { sp } = G;
  const seg = lod === 0 ? 3 : 1, rb = (w, h, d, r) => roundedBox(w, h, d, r, seg);
  const zr0 = Math.max(sp.shell[0], sp.rear.zs + 0.05), zr1 = sp.shell[1];
  const wMin = Math.min(sp.W(zr0), sp.W(zr1), sp.W(0)) - 0.16;
  parts.add('interior', new THREE.PlaneGeometry(wMin * 2, zr1 - zr0).rotateX(-Math.PI / 2), M4(0, sp.floorY, (zr0 + zr1) / 2));
  const [d0, d1] = sp.dashZ, yb = sp.yBelt(d1);
  parts.add('interior', rb((sp.W(d0) - 0.14) * 2, 0.24, d1 - d0, 0.05), M4(0, yb - 0.1, (d0 + d1) / 2));
  const fs = sp.seats.front;
  parts.add('interior', rb(0.4, 0.14, 0.24, 0.04), M4(fs.x, sp.steer.y + 0.07 - 0.12, d0 + 0.05));
  parts.add('interior', rb(0.22, fs.y - sp.floorY, d0 - fs.z + 0.2, 0.04), M4(0, (fs.y + sp.floorY) / 2, (d0 + fs.z - 0.2) / 2));
  for (const sx of [fs.x, -fs.x]) {
    parts.add('interior', rb(0.5, 0.13, 0.5, 0.05), M4(sx, fs.y - 0.065, fs.z));
    parts.add('interior', rb(0.4, fs.y - sp.floorY - 0.1, 0.4, 0.03), M4(sx, (fs.y + sp.floorY) / 2 - 0.05, fs.z));
    parts.add('interior', rb(0.5, 0.6, 0.13, 0.05), M4(sx, fs.y + 0.28, fs.z - 0.3, -0.22));
    parts.add('interior', rb(0.26, 0.17, 0.09, 0.04), M4(sx, fs.y + 0.67, fs.z - 0.39, -0.2));
  }
  const rs = sp.seats.rear;
  if (rs) {
    parts.add('interior', rb(rs.w, 0.13, 0.5, 0.05), M4(0, rs.y - 0.065, rs.z));
    parts.add('interior', rb(rs.w, rs.y - sp.floorY, 0.45, 0.03), M4(0, (rs.y + sp.floorY) / 2 - 0.06, rs.z));
    parts.add('interior', rb(rs.w, 0.58, 0.13, 0.05), M4(0, rs.y + 0.27, rs.z - 0.3, -0.25));
    for (const sx of [rs.w / 2 - 0.25, -(rs.w / 2 - 0.25)]) parts.add('interior', rb(0.25, 0.15, 0.09, 0.04), M4(sx, rs.y + (rs.hy || 0.63), rs.z - 0.37, -0.22));
  }
  // Lenkrad
  const st = sp.steer, tilt = 0.4, fy = -Math.sin(tilt), fz = Math.cos(tilt);
  const at = (d) => M4(fs.x, st.y + fy * d, st.z + fz * d, tilt, 0, 0);
  parts.add('interior', new THREE.TorusGeometry(0.185, 0.017, lod === 0 ? 8 : 5, lod === 0 ? 36 : 14), at(0));
  parts.add('interior', new THREE.CylinderGeometry(0.05, 0.06, 0.06, 12).rotateX(Math.PI / 2), at(0.02));
  parts.add('interior', new THREE.BoxGeometry(0.34, 0.03, 0.02), at(0.01));
  parts.add('interior', new THREE.CylinderGeometry(0.025, 0.03, 0.4, 8).rotateX(Math.PI / 2), at(0.22));
  if (sp.parcel) parts.add('interior', new THREE.BoxGeometry((sp.W(sp.parcel.z[0]) - 0.12) * 2, 0.03, sp.parcel.z[1] - sp.parcel.z[0]), M4(0, sp.parcel.y, (sp.parcel.z[0] + sp.parcel.z[1]) / 2));
  if (sp.bulkhead != null) parts.add('interior', new THREE.BoxGeometry((sp.W(sp.bulkhead) - 0.12) * 2, sp.yRail - sp.floorY - 0.04, 0.04), M4(0, (sp.yRail + sp.floorY) / 2 - 0.02, sp.bulkhead));
}

// =====================================================================
// Räder
// =====================================================================
function buildWheel(sp, lod, style) {
  const { r: R, w: W, rim: Rr } = sp.wheel;
  const seg = [72, 32, 12][lod];
  const out = {};
  // Reifen: Profil (Radius, axial) von innen nach außen
  const tp = lod === 2
    ? [[Rr + 0.01, -W * 0.42], [R - 0.02, -W * 0.5], [R, 0], [R - 0.02, W * 0.5], [Rr + 0.01, W * 0.42]]
    : [[Rr + 0.004, -W * 0.42], [Rr + 0.03, -W * 0.48], [lerp(Rr, R, 0.55), -W * 0.505], [R - 0.022, -W * 0.475], [R - 0.006, -W * 0.425],
      [R, -W * 0.33], [R + 0.002, -W * 0.12], [R + 0.002, W * 0.12], [R, W * 0.33], [R - 0.006, W * 0.425], [R - 0.022, W * 0.475],
      [lerp(Rr, R, 0.55), W * 0.505], [Rr + 0.03, W * 0.48], [Rr + 0.004, W * 0.42]];
  const pts = lod === 1 ? tp.filter((_, i) => i % 2 === 0 || i === tp.length - 1) : tp;
  out.tyre = new THREE.LatheGeometry(pts.map(([r, a]) => new THREE.Vector2(r, a)), seg).rotateZ(-Math.PI / 2);
  if (lod === 2) { out.chrome = new THREE.CircleGeometry(Rr, seg).rotateY(Math.PI / 2).translate(W * 0.36, 0, 0); return out; }
  const rp = [[Rr + 0.012, W * 0.36], [Rr + 0.012, W * 0.46], [Rr + 0.004, W * 0.485], [Rr - 0.01, W * 0.48], [Rr - 0.017, W * 0.45],
    [Rr - 0.019, W * 0.42], [Rr - 0.021, W * 0.05], [Rr - 0.023, -W * 0.36], [Rr - 0.03, -W * 0.38], [0.09, -W * 0.38]];
  out.chrome = [prep(new THREE.LatheGeometry(rp.map(([r, a]) => new THREE.Vector2(r, a)), seg).rotateZ(-Math.PI / 2))];
  // Speichen
  const spokes = [];
  const nS = style === 0 ? 5 : 10, twin = style === 0;
  const np = lod === 0 ? 7 : 3;
  const prof = lod === 0 ? rectProf(style === 0 ? 0.022 : 0.026, 0.024, 0.3) : rectProf(0.03, 0.022, 0.0).filter((_, i) => i % 2 === 0);
  for (let s = 0; s < nS; s++) for (const off of twin ? [-0.075, 0.075] : [0]) {
    const phi = s / nS * Math.PI * 2 + off;
    const path = [];
    for (let t = 0; t < np; t++) {
      const u = t / (np - 1), r = lerp(0.058, Rr - 0.014, u), a = W * lerp(0.15, 0.44, Math.pow(u, 0.6));
      const ph = phi - (twin ? off * 0.55 * (1 - u) : 0);
      path.push(V3(a, r * Math.cos(ph), r * Math.sin(ph)));
    }
    spokes.push(prep(sweep(path, prof, { up: V3(1, 0, 0), scale: (u) => [lerp(1.25, 0.8, u), lerp(1.15, 0.85, u)] })));
  }
  out.chrome.push(...spokes);
  out.chrome.push(prep(new THREE.CylinderGeometry(0.068, 0.075, 0.04, seg / 2).rotateZ(-Math.PI / 2).translate(W * 0.13, 0, 0)));
  out.chrome.push(prep(new THREE.CylinderGeometry(0.03, 0.033, 0.015, seg / 2).rotateZ(-Math.PI / 2).translate(W * 0.13 + 0.025, 0, 0)));
  if (lod === 0) for (let n = 0; n < 5; n++) {
    const ph = n / 5 * Math.PI * 2 + 0.3;
    out.chrome.push(prep(new THREE.CylinderGeometry(0.0095, 0.011, 0.02, 6).rotateZ(-Math.PI / 2).translate(W * 0.13 + 0.024, 0.05 * Math.cos(ph), 0.05 * Math.sin(ph))));
  }
  out.chrome = mergeGeometries(out.chrome, false);
  // Bremse (steht still)
  out.brake = mergeGeometries([
    prep(new THREE.CylinderGeometry(Rr - 0.06, Rr - 0.06, 0.028, seg / 2).rotateZ(-Math.PI / 2).translate(-W * 0.12, 0, 0)),
    prep(roundedBox(0.06, 0.12, 0.065, 0.014, lod === 0 ? 2 : 1), M4(-W * 0.08, 0.142 * Math.sin(0.96), -0.142 * Math.cos(0.96), 0.96, 0, 0)),
  ], false);
  return out;
}

// =====================================================================
// Texturen (Canvas)
// =====================================================================
function makeCanvas(w, h) {
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return new OffscreenCanvas(w, h);
}
function hexPath(g, cx, cy, R) { g.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); } g.closePath(); }
/** VARENNE-Emblem: Sechseck, drei aufsteigende Bögen über Horizontlinie (eigene Gestaltung) */
function drawEmblem(g, cx, cy, R) {
  let gr = g.createLinearGradient(cx, cy - R, cx, cy + R);
  gr.addColorStop(0, '#f4f6f8'); gr.addColorStop(0.45, '#8a9096'); gr.addColorStop(0.55, '#c9ced3'); gr.addColorStop(1, '#6d7278');
  g.fillStyle = gr; hexPath(g, cx, cy, R); g.fill();
  gr = g.createRadialGradient(cx, cy - R * 0.3, R * 0.1, cx, cy, R * 0.9);
  gr.addColorStop(0, '#2d4d73'); gr.addColorStop(1, '#0d1726');
  g.fillStyle = gr; hexPath(g, cx, cy, R * 0.82); g.fill();
  g.strokeStyle = '#e6e9ec'; g.lineCap = 'round';
  for (let k = 0; k < 3; k++) { g.lineWidth = R * (0.1 - k * 0.018); g.beginPath(); g.arc(cx, cy + R * 0.28, R * (0.2 + k * 0.17), Math.PI * 1.12, Math.PI * 1.88); g.stroke(); }
  g.lineWidth = R * 0.07; g.beginPath(); g.moveTo(cx - R * 0.58, cy + R * 0.36); g.lineTo(cx + R * 0.58, cy + R * 0.36); g.stroke();
}
function plateTexture(text) {
  const c = makeCanvas(1024, 512), g = c.getContext('2d');
  g.fillStyle = '#1a1c1f'; g.fillRect(0, 0, 1024, 512);
  // Kennzeichen
  g.fillStyle = '#f3f2ec'; g.beginPath(); g.roundRect ? g.roundRect(4, 4, 1016, 212, 18) : g.rect(4, 4, 1016, 212); g.fill();
  g.lineWidth = 9; g.strokeStyle = '#141414'; g.beginPath(); g.roundRect ? g.roundRect(14, 14, 996, 192, 12) : g.rect(14, 14, 996, 192); g.stroke();
  g.fillStyle = '#1e5a7a'; g.fillRect(19, 19, 96, 182);
  drawEmblem(g, 67, 78, 34);
  g.fillStyle = '#f3f2ec'; g.font = 'bold 44px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('AE', 67, 160);
  g.fillStyle = '#141414'; g.font = 'bold 150px "Arial Narrow", Arial, sans-serif';
  const tw = g.measureText(text).width, sx = Math.min(1, 860 / tw);
  g.save(); g.translate(566, 114); g.scale(sx, 1); g.fillText(text, 0, 0); g.restore();
  // Emblem-Feld
  drawEmblem(g, 128, 384, 118);
  // Schriftzug
  const gr = g.createLinearGradient(0, 300, 0, 420);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, '#9aa0a6'); gr.addColorStop(1, '#e8eaec');
  g.fillStyle = '#16181b'; g.fillRect(256, 300, 768, 120);
  g.fillStyle = gr; g.font = '600 92px "Rajdhani", "Arial", sans-serif';
  const word = HERO_BRAND.toUpperCase(); const step = 96;
  for (let i = 0; i < word.length; i++) g.fillText(word[i], 640 + (i - (word.length - 1) / 2) * step, 362);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.userData.own = true;
  return t;
}
let TYRE_TEX = null;
function tyreTextures() {
  if (TYRE_TEX) return TYRE_TEX;
  const S = 256, hgt = new Float32Array(S * S);
  const frac = (x) => x - Math.floor(x);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x + 0.5) / S, v = 1 - (y + 0.5) / S;
    let h = 0.6;
    if (v > 0.32 && v < 0.68) {
      h = 1;
      for (const gv of [0.4, 0.5, 0.6]) if (Math.abs(v - gv) < 0.011) h = 0.1;
      const sh = v < 0.4 || v > 0.6;
      if (sh && frac(u * 2 + (v - 0.5) * 1.2) < 0.13) h = 0.15;
      if (!sh && frac(u * 4 + (v - 0.5) * 2.5) < 0.05) h = 0.45;
    } else {
      const d = v < 0.5 ? v : 1 - v;
      if (Math.abs(d - 0.12) < 0.012 || Math.abs(d - 0.2) < 0.006) h = 0.75;
    }
    hgt[y * S + x] = h;
  }
  const cN = makeCanvas(S, S), gN = cN.getContext('2d'), iN = gN.createImageData(S, S);
  const cC = makeCanvas(S, S), gC = cC.getContext('2d'), iC = gC.createImageData(S, S);
  const H = (x, y) => hgt[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * 2.2, dy = (H(x, y - 1) - H(x, y + 1)) * 2.2;
    const l = Math.hypot(dx, dy, 1), o = (y * S + x) * 4;
    iN.data[o] = (-dx / l * 0.5 + 0.5) * 255; iN.data[o + 1] = (-dy / l * 0.5 + 0.5) * 255; iN.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; iN.data[o + 3] = 255;
    const c = 70 + H(x, y) * 120; iC.data[o] = c; iC.data[o + 1] = c; iC.data[o + 2] = c; iC.data[o + 3] = 255;
  }
  gN.putImageData(iN, 0, 0); gC.putImageData(iC, 0, 0);
  const mk = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.repeat.set(30, 1); t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  return (TYRE_TEX = { normal: mk(cN, false), color: mk(cC, true) });
}
function damageTexture(color, seed, damage, sp) {
  const W = 1024, H = 512, c = makeCanvas(W, H), g = c.getContext('2d'), R = rng(seed * 31 + 7);
  g.fillStyle = '#' + color.getHexString(); g.fillRect(0, 0, W, H);
  // Staub an unteren Flanken (v = y/H; Canvas oben = v 1)
  const yDust = H * (1 - (sp.ySill + 0.25) / sp.H);
  const gr = g.createLinearGradient(0, yDust, 0, H);
  gr.addColorStop(0, 'rgba(150,135,110,0)'); gr.addColorStop(0.5, `rgba(140,124,98,${0.35 * damage})`); gr.addColorStop(1, `rgba(120,104,80,${0.85 * damage})`);
  g.fillStyle = gr; g.fillRect(0, yDust, W, H - yDust);
  for (let i = 0; i < 2500 * damage; i++) { g.fillStyle = `rgba(${110 + R() * 60},${100 + R() * 50},${80 + R() * 40},${0.15 + R() * 0.3})`; const y = lerp(yDust, H, Math.sqrt(R())); g.fillRect(R() * W, y, 1 + R() * 3, 1 + R() * 2); }
  // Schmutz um Radhäuser
  for (const zc of [sp.wheel.zF, sp.wheel.zR]) {
    const x = (zc / sp.L + 0.5) * W, y = H * (1 - (sp.wheel.r * 1.6) / sp.H);
    const rg = g.createRadialGradient(x, y, 10, x, y, W * 0.12);
    rg.addColorStop(0, `rgba(90,78,60,${0.5 * damage})`); rg.addColorStop(1, 'rgba(90,78,60,0)'); g.fillStyle = rg; g.fillRect(x - W * 0.12, y - W * 0.12, W * 0.24, W * 0.24);
  }
  // Kratzer
  g.lineCap = 'round';
  for (let i = 0; i < 40 * damage; i++) {
    const x = R() * W, y = H * (0.2 + R() * 0.55), l = 10 + R() * 60, a = (R() - 0.5) * 0.6;
    g.strokeStyle = `rgba(225,225,220,${0.25 + R() * 0.45})`; g.lineWidth = 0.6 + R() * 1.2;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + l * 0.5, y + (R() - 0.5) * 6, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  // Rostpunkte bei starker Abnutzung
  if (damage > 0.5) for (let i = 0; i < 18 * (damage - 0.5); i++) {
    const x = R() * W, y = H * (0.75 + R() * 0.2), r = 2 + R() * 7;
    const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, 'rgba(110,50,20,0.85)'); rg.addColorStop(1, 'rgba(110,50,20,0)');
    g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.userData.own = true;
  return t;
}

// =====================================================================
// Materialien (Namen = Slots für vehiclematerials.js)
// =====================================================================
let SHARED = null;
function sharedMaterials() {
  if (SHARED) return SHARED;
  const tt = tyreTextures();
  const M = (o) => { const m = new THREE.MeshPhysicalMaterial(o); m.userData.shared = true; return m; };
  SHARED = {
    glass: M({ name: 'glass', color: 0x1b2329, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.42, depthWrite: false, envMapIntensity: 1.4 }),
    tyre: M({ name: 'tyre', color: 0x2a2a2a, map: tt.color, normalMap: tt.normal, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.88, metalness: 0 }),
    chrome: M({ name: 'chrome', color: 0xe6e8ea, metalness: 1, roughness: 0.1 }),
    trim: M({ name: 'trim', color: 0x121314, metalness: 0.05, roughness: 0.55 }),
    interior: M({ name: 'interior', color: 0x2b2826, metalness: 0, roughness: 0.82 }),
  };
  return SHARED;
}
function carMaterials(color, seed, damage, sp, plateText) {
  const own = [];
  const M = (o) => { const m = new THREE.MeshPhysicalMaterial(o); own.push(m); return m; };
  const paint = M({ name: 'paint', color, metalness: 0.5, roughness: 0.3 + damage * 0.35, clearcoat: 1 - damage * 0.6, clearcoatRoughness: 0.03 + damage * 0.25 });
  paint.userData.paintColor = color.clone();
  if (damage > 0.02) { paint.map = damageTexture(color, seed, damage, sp); paint.color.set(0xffffff); }
  const headlight = M({ name: 'headlight', color: 0xdfe5ec, metalness: 0.1, roughness: 0.06, emissive: 0xfff3df, emissiveIntensity: 0.15 });
  const taillight = M({ name: 'taillight', color: 0x7c0b09, metalness: 0, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.05, emissive: 0xff1c10, emissiveIntensity: 0.35 });
  const plate = M({ name: 'plate', map: plateTexture(plateText), metalness: 0.25, roughness: 0.42 });
  return { mats: { ...sharedMaterials(), paint, headlight, taillight, plate }, own };
}

// =====================================================================
// Cache je Typ/LOD
// =====================================================================
const BODY_CACHE = new Map(), WHEEL_CACHE = new Map();
function bodyLevel(type, lod) {
  const key = type + '|' + lod;
  if (BODY_CACHE.has(key)) return BODY_CACHE.get(key);
  const sp = getSpec(type);
  const G = buildBodyGrid(sp, lod);
  const cls = classifyCells(G);
  const parts = new Parts();
  const body = emitBody(G, cls);
  for (const [m, g] of Object.entries(body)) parts.add(m, g);
  if (lod === 0) addHeadlightInternals(G, cls, parts);
  if (lod < 2) { addGrille(G, parts); addPlatesAndBadges(G, parts); addExhaust(G, parts); addInterior(G, parts, lod); }
  addMirrorsHandlesWipers(G, parts, lod);
  if (sp.roofRails && lod < 2) addRoofRails(G, parts);
  const wheelPos = wheelPositions(sp);
  if (lod === 2) {
    const wg = buildWheel(sp, 2, 0);
    for (const w of wheelPos) {
      const m = M4(w.x, w.y, w.z).multiply(w.side < 0 ? MIRX : new THREE.Matrix4());
      parts.add('tyre', wg.tyre.clone(), m); parts.add('chrome', wg.chrome.clone(), m);
    }
    wg.tyre.dispose(); wg.chrome.dispose();
  }
  // Leuchten-Marker (Schwerpunkt der Leuchtenzellen rechts)
  const marks = { hl: centroid(G, cls, (c) => c.hl), tl: centroid(G, cls, (c) => c.tl) };
  const entry = { geos: parts.merge(), marks, G: lod === 0 ? G : null };
  BODY_CACHE.set(key, entry);
  return entry;
}
function centroid(G, cls, f) {
  const { NS, NR, NH, P0 } = G, NHc = NH - 1, s = V3(); let n = 0;
  for (let i = 0; i < NS - 1; i++) for (let j = 0; j < NHc; j++) if (f(cls[i * NHc + j])) { const o = (i * NR + j) * 3; s.x += P0[o]; s.y += P0[o + 1]; s.z += P0[o + 2]; n++; }
  return n ? s.multiplyScalar(1 / n) : null;
}
function wheelPositions(sp) {
  const { x, r, zF, zR } = sp.wheel;
  return [[1, zF, true], [-1, zF, true], [1, zR, false], [-1, zR, false]].map(([side, z, front]) => ({ x: x * side, y: r, z, side, front }));
}
function wheelGeos(type, lod, style) {
  const key = type + '|' + lod + '|' + style;
  if (!WHEEL_CACHE.has(key)) WHEEL_CACHE.set(key, buildWheel(getSpec(type), lod, style));
  return WHEEL_CACHE.get(key);
}
/** Alle gecachten Geometrien freigeben (z. B. beim Szenenwechsel). */
export function clearHeroCarCache() {
  for (const e of BODY_CACHE.values()) for (const g of Object.values(e.geos)) g.dispose();
  for (const e of WHEEL_CACHE.values()) for (const g of Object.values(e)) g.dispose && g.dispose();
  BODY_CACHE.clear(); WHEEL_CACHE.clear();
}

// =====================================================================
// Beulen
// =====================================================================
function makeDents(sp, seed, damage) {
  const G = bodyLevel(sp.type, 0).G || buildBodyGrid(sp, 0);
  const R = rng(seed * 977 + 3), dents = [];
  const n = Math.round(1 + damage * 6);
  for (let k = 0; k < n; k++) {
    const z = lerp(-sp.half + 0.5, sp.half - 0.5, R()), y = lerp(sp.ySill + 0.05, sp.yBelt(z) - 0.06, R());
    let h = ringCross(G, stationAtZ(G, z), 'y', y, 4, 6);
    if (R() < 0.5) h = mirrorHit(h);
    dents.push({ c: h.p, n: h.n, r: lerp(0.1, 0.24, R()), d: lerp(0.01, 0.035, R()) * damage });
  }
  if (damage > 0.35) for (const zone of ['F', 'R']) {
    let h = endPoint(G, zone, sp.W(0) * 0.75, sp.ySill - 0.02, 3, 5); if (!h) continue;
    if (R() < 0.5) h = mirrorHit(h);
    dents.push({ c: h.p, n: h.n, r: 0.18, d: 0.03 * damage });
  }
  return dents;
}
function applyDents(geo, dents) {
  const p = geo.attributes.position, v = V3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    let dx = 0, dy = 0, dz = 0;
    for (const D of dents) {
      const d2 = v.distanceToSquared(D.c); if (d2 > D.r * D.r * 4) continue;
      const f = D.d * Math.exp(-d2 / (D.r * D.r));
      dx -= D.n.x * f; dy -= D.n.y * f; dz -= D.n.z * f;
    }
    if (dx || dy || dz) p.setXYZ(i, v.x + dx, v.y + dy, v.z + dz);
  }
  geo.computeVertexNormals();
  return geo;
}

// =====================================================================
// Öffentliche API
// =====================================================================
const triCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

function buildLevelObject(type, lod, style, mats, dents, wheelsOut) {
  const sp = getSpec(type), entry = bodyLevel(type, lod);
  const grp = new THREE.Group(); grp.name = `heroCar_LOD${lod}`;
  let tris = 0;
  for (const slot of HERO_SLOTS) {
    let g = entry.geos[slot]; if (!g) continue;
    let own = false;
    if (dents && slot !== 'interior') { g = applyDents(g.clone(), dents); own = true; }
    const m = new THREE.Mesh(g, mats[slot]); m.name = `${type}_${slot}`;
    m.castShadow = slot !== 'glass'; m.receiveShadow = true; m.userData.ownGeo = own; m.userData.slot = slot;
    grp.add(m); tris += triCount(g);
  }
  if (lod < 2) {
    const wg = wheelGeos(type, lod, style);
    wheelPositions(sp).forEach((w, k) => {
      const pivot = new THREE.Group(); pivot.name = `wheel_${w.front ? 'F' : 'R'}${w.side > 0 ? 'L' : 'R'}`; pivot.position.set(w.x, w.y, w.z);
      const spin = new THREE.Group(); pivot.add(spin);
      for (const [slot, g, parent] of [['tyre', wg.tyre, spin], ['chrome', wg.chrome, spin], ['trim', wg.brake, pivot]]) {
        const m = new THREE.Mesh(g, mats[slot]); m.name = `${type}_wheel_${slot}`; m.scale.x = w.side; m.castShadow = true; m.receiveShadow = true; m.userData.slot = slot;
        parent.add(m); tris += triCount(g);
      }
      grp.add(pivot);
      wheelsOut[k].pivots.push(pivot); wheelsOut[k].spins.push(spin);
    });
  }
  grp.userData.level = lod; grp.userData.triangles = tris;
  return grp;
}

/**
 * Erzeugt ein Hero-Auto.
 * @param {{type?:'sedan'|'suv'|'pickup'|'van', paintColor?:number|string|THREE.Color, lod?:'auto'|0|1|2, seed?:number, damage?:number, plateText?:string, lodDistances?:number[]}} opts
 * @returns {THREE.LOD|THREE.Group} userData: {headlights, taillights, wheels, lodLevels, lods, type, brand, model, buildMs}
 */
export function makeHeroCar(opts = {}) {
  const t0 = now();
  const type = HERO_TYPES.includes(opts.type) ? opts.type : 'sedan';
  const sp = getSpec(type);
  const seed = (opts.seed ?? 1) >>> 0;
  const damage = clamp(+opts.damage || 0, 0, 1);
  const R = rng(seed + 101);
  const color = new THREE.Color(opts.paintColor ?? PALETTE[seed % PALETTE.length]);
  const plateText = String(opts.plateText ?? `VR ${String.fromCharCode(65 + Math.floor(R() * 26))} ${1000 + Math.floor(R() * 8999)}`).slice(0, 10);
  const style = seed % 2;
  const auto = opts.lod === undefined || opts.lod === 'auto';
  const levels = auto ? [0, 1, 2] : [clamp(opts.lod | 0, 0, 2)];
  const dist = opts.lodDistances || LOD_DIST;
  const { mats, own } = carMaterials(color, seed, damage, sp, plateText);
  const dents = damage > 0.05 ? makeDents(sp, seed, damage) : null;
  const root = auto ? new THREE.LOD() : new THREE.Group();
  root.name = `Varenne_${MODEL_NAMES[type]}`;
  const wheels = wheelPositions(sp).map((w) => ({ position: V3(w.x, w.y, w.z), side: w.side, front: w.front, radius: sp.wheel.r, pivots: [], spins: [] }));
  const lodLevels = [], lods = [];
  for (const lv of levels) {
    const obj = buildLevelObject(type, lv, style, mats, dents, wheels);
    if (auto) root.addLevel(obj, dist[lv]); else root.add(obj);
    lods.push(obj); lodLevels.push({ level: lv, triangles: obj.userData.triangles, distance: auto ? dist[lv] : 0 });
  }
  // Leuchten-Marker (für Spot-/Punktlichter des Spiels)
  const e = bodyLevel(type, levels[0]).marks;
  const mk = (p, name, dir) => { const o = new THREE.Object3D(); o.name = name; if (p) o.position.copy(p); o.userData.dir = dir; root.add(o); return o; };
  const headlights = e.hl ? [mk(e.hl, 'headlight_L', V3(0, 0, 1)), mk(V3(-e.hl.x, e.hl.y, e.hl.z), 'headlight_R', V3(0, 0, 1))] : [];
  const taillights = e.tl ? [mk(e.tl, 'taillight_L', V3(0, 0, -1)), mk(V3(-e.tl.x, e.tl.y, e.tl.z), 'taillight_R', V3(0, 0, -1))] : [];
  Object.assign(root.userData, {
    type, brand: HERO_BRAND, model: MODEL_NAMES[type], seed, damage, plateText, paintColor: color.getHex(),
    headlights, taillights, wheels, lodLevels, lods, materials: mats, ownMaterials: own,
    lightMaterials: { headlight: mats.headlight, taillight: mats.taillight },
    dimensions: { length: sp.L, width: sp.W(0) * 2, height: sp.H, wheelbase: sp.wheel.zF - sp.wheel.zR },
  });
  root.userData.buildMs = now() - t0;
  return root;
}

/** Radstellung: spin = Abrollwinkel (rad), steer = Lenkwinkel (rad, nur Vorderräder). */
export function setHeroCarWheels(root, spin = 0, steer = 0) {
  for (const w of root.userData.wheels || []) {
    for (const p of w.pivots) p.rotation.y = w.front ? steer : 0;
    for (const s of w.spins) s.rotation.x = spin;
  }
}
/** Licht: head = Scheinwerfer an, brake = Bremslicht (Werte wie vehiclematerials.js). */
export function setHeroCarLights(root, { head = false, brake = false } = {}) {
  const m = root.userData.lightMaterials; if (!m) return;
  m.headlight.emissiveIntensity = head ? 4 : 0.15;
  m.taillight.emissiveIntensity = brake ? 4 : head ? 0.9 : 0.35;
}
/** Gibt car-eigene Ressourcen frei (gecachte Geometrie bleibt für weitere Autos erhalten). */
export function disposeHeroCar(root) {
  if (!root) return;
  root.traverse((o) => { if (o.isMesh && o.userData.ownGeo) o.geometry.dispose(); });
  for (const m of root.userData.ownMaterials || []) {
    for (const k of ['map', 'normalMap', 'roughnessMap']) if (m[k] && m[k].userData.own) m[k].dispose();
    m.dispose();
  }
  root.userData.ownMaterials = [];
  if (root.parent) root.parent.remove(root);
}
export function heroCarTriangles(root) {
  let n = 0; root.traverse((o) => { if (o.isMesh && o.visible) n += triCount(o.geometry); }); return n;
}
