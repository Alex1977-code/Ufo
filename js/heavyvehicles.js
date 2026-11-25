// Prozedurale Nutz- und Landfahrzeuge (G7) im Qualitätsniveau von herocar.js – nur fiktive Marken:
//   AGRION Landtechnik (Traktor „Terra 165“, Mähdrescher „Messor 7“) und VARENNE Nutzfahrzeuge
//   (Stadtbus „Urbis“, Reisebus „Orbis“, LKW „Carrus“, Gabelstapler „Lyft 25“). Dazu ein ausgebrannter,
//   markenloser Schützenpanzer (milwreck). Keine realen Logos, Modelle oder Markenzeichen.
// Bauweise: „Schalen“ (abgerundete Kästen mit Rundungs-Stützlinien, Material je Zelle, Fugen/Scheiben als
//   eingezogene Zellen, Radläufe als Ausschnitt), Rotationskörper für Reifen/Felgen (Stollen als Geometrie),
//   Rohre/Profile als Sweep. Material-Slots wie js/vehiclematerials.js (G2):
//   paint, glass, tyre, chrome, trim, headlight, taillight, interior, plate + beacon (Rundum-/Blinkleuchten, gelb).
// Gebrauchsspuren (damage 0..1): Canvas-Maps (Farbe + Rauheit/Metall/Klarlack) in einer Seitenprojektion
//   (u entlang der Länge, v = Höhe) für Lack, Anbauteile und Felgen, eigene Schlamm-Map für Reifen.
// Konventionen: Meter, Front = +Z, Boden y = 0, linke Fahrzeugseite = +X (Fahrerseite), rechte Seite = −X.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const HEAVY_TYPES = ['tractor', 'combine', 'bus', 'truck', 'forklift', 'milwreck'];
export const HEAVY_VARIANTS = {
  tractor: ['standard', 'loader'], combine: ['standard'], bus: ['city', 'coach'], truck: ['box', 'semi'], forklift: ['standard'], milwreck: ['standard'],
};
export const HEAVY_SLOTS = ['paint', 'glass', 'tyre', 'chrome', 'trim', 'headlight', 'taillight', 'interior', 'plate', 'beacon'];
export const HEAVY_BRANDS = { agrion: 'AGRION', varenne: 'VARENNE' };
const INFO = {
  tractor: { brand: 'AGRION', model: 'Terra 165', palette: [0x2f6b2a, 0xa3201b, 0x1f4f8f, 0xc9861a] },
  combine: { brand: 'AGRION', model: 'Messor 7', palette: [0x2f6b2a, 0xa3201b, 0xc9a21a] },
  bus: { brand: 'VARENNE', model: 'Urbis 12', palette: [0xe9e7e1, 0xd8a91c, 0xb3261e, 0x2b5fa0] },
  truck: { brand: 'VARENNE', model: 'Carrus 18', palette: [0xe9e7e1, 0x1c3f73, 0xa3201b, 0x2a2c2f] },
  forklift: { brand: 'VARENNE', model: 'Lyft 25', palette: [0xe0a312, 0xd8621a, 0xb3261e, 0x2e6e3a] },
  milwreck: { brand: null, model: 'SPz (ausgebrannt)', palette: [0x4f5236] },
};
const MODEL_NAME = { 'bus|coach': 'Orbis 13', 'truck|semi': 'Carrus 44 S', 'tractor|loader': 'Terra 165 FL' };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const XAX = V3(1, 0, 0), YAX = V3(0, 1, 0);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// =====================================================================
// Geometrie-Grundlagen
// =====================================================================
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
const MIRX = new THREE.Matrix4().makeScale(-1, 1, 1);
class Parts {
  constructor() { this.list = {}; }
  add(mat, g, m) { if (g) (this.list[mat] ||= []).push(prep(g, m)); return this; }
  /** Teil bei +X und gespiegelt bei −X */
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
const M4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V3(sx, sy, sz));
/** Matrix: Ursprung p, lokale +Z = n, lokale +Y möglichst „up“ */
function frame(p, n, up = YAX) {
  const z = n.clone().normalize();
  let x = up.clone().cross(z); if (x.lengthSq() < 1e-8) x = V3(1, 0, 0).cross(z); x.normalize();
  const y = z.clone().cross(x);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(p);
}
/** Matrix, die die lokale +Y-Achse von a nach b legt (für Zylinder) */
function between(a, b) {
  const d = b.clone().sub(a), l = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(YAX, d.clone().normalize());
  return new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V3(1, l, 1));
}
function roundedBox(w, h, d, r, seg = 3) {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
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
/** Kasten (Ecke unten = y0) */
const rb = (Q, w, h, d, r, x, y, z, rx = 0, ry = 0, rz = 0) => [roundedBox(w, h, d, r, Q.lod === 0 ? 2 : 1), M4(x, y, z, rx, ry, rz)];
/** Zylinder entlang einer Strecke a→b */
function cylAB(a, b, r1, r2 = r1, seg = 12, open = false) {
  return prep(new THREE.CylinderGeometry(r2, r1, 1, seg, 1, open), between(a, b));
}
/** Profil (CCW, [x,y]) entlang Pfad; Normalen glatt */
function sweep(pts, prof, { up = YAX, scale = null, caps = false } = {}) {
  const n = pts.length, m = prof.length;
  const pos = [], uv = [], idx = [];
  const T = V3(), S = V3(), U = V3(), q = V3();
  for (let i = 0; i < n; i++) {
    T.subVectors(pts[Math.min(i + 1, n - 1)], pts[Math.max(i - 1, 0)]).normalize();
    S.crossVectors(T, up); if (S.lengthSq() < 1e-8) S.crossVectors(T, V3(1, 0, 0)); S.normalize();
    U.crossVectors(S, T);
    const sc = scale ? scale(i / (n - 1)) : [1, 1];
    for (let k = 0; k < m; k++) {
      q.copy(pts[i]).addScaledVector(S, prof[k][0] * sc[0]).addScaledVector(U, prof[k][1] * sc[1]);
      pos.push(q.x, q.y, q.z); uv.push(k / m, i / (n - 1));
    }
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < m; k++) {
    const a = i * m + k, b = i * m + (k + 1) % m, c = (i + 1) * m + k, d = (i + 1) * m + (k + 1) % m;
    idx.push(a, c, b, b, c, d);
  }
  if (caps) {
    for (const [ring, flip] of [[0, true], [n - 1, false]]) {
      const ci = pos.length / 3; pos.push(pts[ring].x, pts[ring].y, pts[ring].z); uv.push(0, 0);
      for (let k = 0; k < m; k++) { const a = ring * m + k, b = ring * m + (k + 1) % m; flip ? idx.push(ci, a, b) : idx.push(ci, b, a); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const rectProf = (w, h, bev = 0.25) => {
  const a = w / 2, b = h / 2, ca = a * (1 - bev), cb = b * (1 - bev);
  return [[a, -cb], [a, cb], [ca, b], [-ca, b], [-a, cb], [-a, -cb], [-ca, -b], [ca, -b]];
};
const circProf = (r, n = 8) => Array.from({ length: n }, (_, i) => [Math.cos(i / n * Math.PI * 2) * r, Math.sin(i / n * Math.PI * 2) * r]);
/** Ringe gleicher Punktzahl verbinden (geschlossenes Profil), Orientierung automatisch nach außen */
function loftRings(rings, caps = true) {
  const n = rings.length, m = rings[0].length, pos = [], idx = [];
  for (const r of rings) for (const p of r) pos.push(p.x, p.y, p.z);
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < m; k++) {
    const a = i * m + k, b = i * m + (k + 1) % m, c = (i + 1) * m + k, d = (i + 1) * m + (k + 1) % m;
    idx.push(a, c, b, b, c, d);
  }
  // Orientierung prüfen: Normale des mittleren Rings gegen Ring-Schwerpunkt
  const mid = Math.floor((n - 1) / 2), cen = V3(); rings[mid].forEach((p) => cen.add(p)); cen.multiplyScalar(1 / m);
  let s = 0;
  for (let k = 0; k < m; k++) {
    const a = rings[mid][k], b = rings[mid][(k + 1) % m], c = rings[mid + 1][k];
    const nrm = b.clone().sub(a).cross(c.clone().sub(a));
    s += nrm.dot(a.clone().add(b).multiplyScalar(0.5).sub(cen));
  }
  const flip = s < 0;
  if (caps) for (const [ri, f] of [[0, false], [n - 1, true]]) {
    const ci = pos.length / 3, c = V3(); rings[ri].forEach((p) => c.add(p)); c.multiplyScalar(1 / m); pos.push(c.x, c.y, c.z);
    for (let k = 0; k < m; k++) { const a = ri * m + k, b = ri * m + (k + 1) % m; f ? idx.push(ci, a, b) : idx.push(ci, b, a); }
  }
  if (flip) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** Bogen-Sweep um die X-Achse (Kotflügel): Profil [radial, axial] (geschlossen), Winkel ab +Z Richtung +Y */
function arcSweep(cx, cy, cz, R, a0, a1, n, prof) {
  const rings = [];
  for (let i = 0; i <= n; i++) {
    const a = lerp(a0, a1, i / n), cs = Math.cos(a), sn = Math.sin(a);
    rings.push(prof.map(([r, ax]) => V3(cx + ax, cy + (R + r) * sn, cz + (R + r) * cs)));
  }
  return loftRings(rings, true);
}
/** Seitenprofil (Punkte [z, y]) in X extrudiert, Breite w um x = 0, optional gerundet */
function extrudeSide(pts, w, bevel = 0, bevSeg = 2, curveSeg = 8) {
  const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.001, w - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: bevSeg, curveSegments: curveSeg });
  g.rotateY(-Math.PI / 2).translate((w - 2 * bevel) / 2, 0, 0);
  return g;
}
/** Innenseite eines Radhauses: Halbzylinder um die X-Achse, Normalen nach innen */
function wheelhouse(z, y, r, x0, x1, seg) {
  const pos = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = Math.PI * i / seg, cz = z + r * Math.cos(a), cy = y + r * Math.sin(a);
    pos.push(x0, cy, cz, x1, cy, cz);
  }
  for (let i = 0; i < seg; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  // Normalen sollen zur Achse zeigen
  const nA = g.attributes.normal, p = g.attributes.position;
  const nx = nA.getY(seg), ny = nA.getZ(seg); void nx; void ny;
  const test = V3(nA.getX(seg), nA.getY(seg), nA.getZ(seg)), toAxis = V3(0, y - p.getY(seg), z - p.getZ(seg));
  if (test.dot(toAxis) < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
  return g;
}

// =====================================================================
// Schale: abgerundeter Kasten mit Material je Zelle
// =====================================================================
class Bucket {
  constructor() { this.pos = []; this.idx = []; this.map = new Map(); }
  v(key, p) {
    let id = this.map.get(key);
    if (id === undefined) { id = this.pos.length / 3; this.pos.push(p.x, p.y, p.z); this.map.set(key, id); }
    return id;
  }
  geometry() {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setIndex(this.idx); g.computeVertexNormals();
    return g;
  }
}
function axisCoords(h, rn, rp, m, sup, cell, extra, minGap = 0.0015) {
  const out = [-h, h];
  for (const [s, r] of [[-1, rn], [1, rp]]) {
    const base = s * (h - r);
    out.push(base);
    for (let k = 1; k < m; k++) out.push(base + s * r * Math.tan(k / m * Math.PI / 4));
    if (sup > 0) out.push(base - s * Math.min(sup, Math.max(0, (2 * h - rn - rp) / 4)));
  }
  const a = -h + rn, b = h - rp, n = Math.max(1, Math.ceil((b - a) / cell));
  if (Number.isFinite(cell)) for (let i = 1; i < n; i++) out.push(a + (b - a) * i / n);
  for (const e of extra) if (e > -h + 1e-4 && e < h - 1e-4) out.push(e);
  out.sort((p, q) => p - q);
  const res = [out[0]];
  for (const v of out) if (v - res[res.length - 1] > minGap) res.push(v);
  if (h - res[res.length - 1] > 1e-6) res.push(h); else res[res.length - 1] = h;
  return res;
}
const AX = ['x', 'y', 'z'];
/**
 * Schale in Fahrzeugkoordinaten.
 * o.box = [x0, y0, z0, x1, y1, z1]; o.r = {x:[n,p], y:[n,p], z:[n,p]} Rundungsradien je Seite (oder Zahl);
 * o.cls(face, c) -> 'slot' | [slot, inset] | null (Loch); c = Zellmitte (roh, Fahrzeugkoordinaten);
 * o.breaks = {x:[], y:[], z:[]} zusätzliche Gitterlinien; o.arches = [{z, y, r}] Radläufe (Flanken ±X);
 * o.deform(p, raw) verformt Punkte (Fahrzeugkoordinaten); o.skip = ['y-', …]
 */
function shell(P, Q, o) {
  const [x0, y0, z0, x1, y1, z1] = o.box;
  const C = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], hs = [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2];
  const rr = typeof o.r === 'number' ? { x: o.r, y: o.r, z: o.r } : (o.r || {});
  const R = AX.map((a, i) => { const v = rr[a] ?? 0.02; const p = Array.isArray(v) ? v : [v, v]; return p.map((q) => clamp(q, 0.004, hs[i] * 0.98)); });
  const m = o.m ?? Q.m, cell = o.cell ?? Q.cell, sup = Q.sup;
  const arches = o.arches || [];
  const extra = AX.map((a, i) => (o.breaks?.[a] || []).map((v) => v - C[i]));
  if (arches.length) {
    const na = Q.lod === 0 ? 24 : Q.lod === 1 ? 10 : 6;
    for (const ar of arches) for (let k = 0; k <= na; k++) {
      const t = Math.PI * k / na;
      extra[2].push(ar.z + ar.r * Math.cos(t) - C[2]);
      if (k <= na / 2) extra[1].push(ar.y + ar.r * Math.sin(t) - C[1]);
    }
  }
  const L = AX.map((_, i) => axisCoords(hs[i], R[i][0], R[i][1], m, sup, cell, extra[i], [0.0015, 0.05, 0.16][Q.lod]));
  const inArch = (c) => arches.some((ar) => { const dz = c.z - ar.z, dy = c.y - ar.y; return Math.abs(dz) < ar.r && (dy < 0 || dz * dz + dy * dy < ar.r * ar.r); });
  const B = {}, bk = (s) => (B[s] ||= new Bucket());
  const raw = V3(), p = V3(), e = V3(), cl = V3(), cc = { x: 0, y: 0, z: 0 };
  for (const A of [0, 1, 2]) for (const s of [-1, 1]) {
    const face = AX[A] + (s > 0 ? '+' : '-');
    if (o.skip?.includes(face)) continue;
    const Bx = (A + 1) % 3, Cx = (A + 2) % 3, LB = L[Bx], LC = L[Cx], nb = LB.length, nc = LC.length;
    const cls = new Array((nb - 1) * (nc - 1)), archCell = new Uint8Array((nb - 1) * (nc - 1));
    for (let i = 0; i < nb - 1; i++) for (let j = 0; j < nc - 1; j++) {
      const ci = i * (nc - 1) + j;
      cc[AX[A]] = C[A] + s * hs[A]; cc[AX[Bx]] = C[Bx] + (LB[i] + LB[i + 1]) / 2; cc[AX[Cx]] = C[Cx] + (LC[j] + LC[j + 1]) / 2;
      if (arches.length && (A === 0 || face === 'y-') && inArch(cc)) { cls[ci] = null; archCell[ci] = 1; continue; }
      let r = o.cls ? o.cls(face, cc) : (o.slot || 'paint');
      if (r && !Array.isArray(r)) r = [r, 0];
      cls[ci] = r ? { s: r[0], i: r[1] || 0 } : null;
    }
    const vid = new Map();
    const vert = (i, j, slot) => {
      // Einzug = Maximum der angrenzenden Zellen
      let ins = 0, nNull = 0, nArch = 0, nOk = 0;
      for (const di of [-1, 0]) for (const dj of [-1, 0]) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nb - 1 || jj >= nc - 1) continue;
        const c = cls[ii * (nc - 1) + jj];
        if (c) { ins = Math.max(ins, c.i); nOk++; } else { nNull++; if (archCell[ii * (nc - 1) + jj]) nArch++; }
      }
      const key0 = i * nc + j;
      if (vid.has(key0 + '|' + slot)) return vid.get(key0 + '|' + slot);
      raw.setComponent(A, s * hs[A]); raw.setComponent(Bx, LB[i]); raw.setComponent(Cx, LC[j]);
      // Radlauf: Randpunkte auf den Kreis legen
      if (nArch && nOk && A === 0) {
        let best = null, bd = 1e9;
        for (const ar of arches) { const d = Math.hypot(raw.z + C[2] - ar.z, raw.y + C[1] - ar.y); if (Math.abs(d - ar.r) < bd) { bd = Math.abs(d - ar.r); best = ar; } }
        const dz = raw.z + C[2] - best.z, dy = raw.y + C[1] - best.y;
        if (dy > 0) { const l = Math.hypot(dz, dy) || 1; raw.z = best.z - C[2] + dz * best.r / l; raw.y = best.y - C[1] + dy * best.r / l; }
        else raw.z = best.z - C[2] + Math.sign(dz || 1) * best.r;
      }
      // Projektion auf die Rundung
      for (let k = 0; k < 3; k++) {
        const lo = -hs[k] + R[k][0], hi = hs[k] - R[k][1], v = raw.getComponent(k), c = clamp(v, lo, hi);
        cl.setComponent(k, c); const off = v - c; e.setComponent(k, off < 0 ? off / R[k][0] : off / R[k][1]);
      }
      const len = e.length();
      if (len > 1e-9) { e.multiplyScalar(1 / len); for (let k = 0; k < 3; k++) p.setComponent(k, cl.getComponent(k) + e.getComponent(k) * R[k][e.getComponent(k) < 0 ? 0 : 1]); }
      else p.copy(raw);
      if (ins > 0) p.addScaledVector(e, -ins);
      p.x += C[0]; p.y += C[1]; p.z += C[2];
      const rw = { x: raw.x + C[0], y: raw.y + C[1], z: raw.z + C[2] };
      if (o.deform) o.deform(p, rw, face);
      const key = `${Math.round(p.x * 2e4)},${Math.round(p.y * 2e4)},${Math.round(p.z * 2e4)}` + (ins > 0 ? face : '');
      const id = bk(slot).v(key, p);
      vid.set(key0 + '|' + slot, id);
      return id;
    };
    for (let i = 0; i < nb - 1; i++) for (let j = 0; j < nc - 1; j++) {
      const c = cls[i * (nc - 1) + j]; if (!c) continue;
      const a = vert(i, j, c.s), b = vert(i + 1, j, c.s), d = vert(i + 1, j + 1, c.s), f = vert(i, j + 1, c.s);
      const I = bk(c.s).idx;
      if (s > 0) I.push(a, b, d, a, d, f); else I.push(a, d, b, a, f, d);
    }
  }
  for (const [slot, b] of Object.entries(B)) { const g = b.geometry(); if (g) P.add(slot, g); }
}
/** Hilfen für Zellklassifikation */
const inBox = (c, a, b, u0, u1, v0, v1) => c[a] >= u0 && c[a] <= u1 && c[b] >= v0 && c[b] <= v1;
/** Scheibe mit Rahmen: innen Glas (eingezogen), Rand fw breit Dichtung (trim) */
function pane(c, a, b, u0, u1, v0, v1, fw = 0.025, inset = 0.012, frameSlot = 'trim') {
  if (!inBox(c, a, b, u0, u1, v0, v1)) return null;
  if (c[a] < u0 + fw || c[a] > u1 - fw || c[b] < v0 + fw || c[b] > v1 - fw) return [frameSlot, inset * 0.35];
  return ['glass', inset];
}
const paneBreaks = (u0, u1, fw = 0.025) => [u0, u0 + fw, u1 - fw, u1];

// =====================================================================
// Räder
// =====================================================================
/**
 * Reifen als Rotationskörper um die X-Achse (+X = außen). lug > 0: Stollenhöhe (Karkasse = R − lug).
 * UV: u = Umfang (k Wiederholungen), v = Profilbogen (Lauffläche 0.3–0.7).
 */
function tyreGeo(R, W, rimR, seg, { lug = 0, k = 8, lowPoly = false } = {}) {
  const Rc = R - lug, Hs = Rc - rimR;
  let pr = [[rimR + 0.004, -0.42], [rimR + 0.15 * Hs, -0.48], [rimR + 0.55 * Hs, -0.505], [Rc - 0.09 * Hs, -0.478], [Rc - 0.022 * Hs, -0.43],
    [Rc, -0.35], [Rc + 0.003, -0.12], [Rc + 0.003, 0.12], [Rc, 0.35], [Rc - 0.022 * Hs, 0.43], [Rc - 0.09 * Hs, 0.478], [rimR + 0.55 * Hs, 0.505], [rimR + 0.15 * Hs, 0.48], [rimR + 0.004, 0.42]];
  let t0 = 5, t1 = 8;
  if (lowPoly) { pr = [pr[0], pr[2], pr[4], pr[6], pr[7], pr[9], pr[11], pr[13]]; t0 = 3; t1 = 4; }
  const n = pr.length, sLen = [0];
  for (let j = 1; j < n; j++) sLen[j] = sLen[j - 1] + Math.hypot(pr[j][0] - pr[j - 1][0], (pr[j][1] - pr[j - 1][1]) * W);
  const vOf = (j) => (j <= t0 ? 0.3 * sLen[j] / sLen[t0] : j <= t1 ? 0.3 + 0.4 * (sLen[j] - sLen[t0]) / (sLen[t1] - sLen[t0]) : 0.7 + 0.3 * (sLen[j] - sLen[t1]) / (sLen[n - 1] - sLen[t1]));
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = i / seg * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a);
    for (let j = 0; j < n; j++) { const [r, ax] = pr[j]; pos.push(ax * W, r * cs, r * sn); uv.push(i / seg * k, vOf(j)); }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < n - 1; j++) {
    const a = i * n + j, b = (i + 1) * n + j, c = i * n + j + 1, d = (i + 1) * n + j + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** Ackerstollen (Chevron) als Geometrie */
function lugGeo(R, W, lug, count, Q) {
  const out = [], Rc = R - lug, alpha = 0.62, lw = Math.min(0.085, 2 * Math.PI * R / count * 0.38), Ll = W * 0.62;
  const box = roundedBox(Ll, lug * 2 + 0.02, lw, Math.min(0.018, lug * 0.6), Q.lod === 0 ? 2 : 1);
  for (let i = 0; i < count; i++) for (const s of [-1, 1]) {
    const phi = (i + (s > 0 ? 0.5 : 0)) / count * Math.PI * 2;
    const n = V3(0, Math.cos(phi), Math.sin(phi)), t = V3(0, -Math.sin(phi), Math.cos(phi));
    const ld = XAX.clone().multiplyScalar(s * Math.cos(alpha)).addScaledVector(t, Math.sin(alpha)).normalize();
    const wd = ld.clone().cross(n).normalize();
    const ctr = XAX.clone().multiplyScalar(s * (W * 0.5 - Ll * Math.cos(alpha) * 0.5 + 0.02)).addScaledVector(n, Rc - 0.01).addScaledVector(t, -s * 0);
    const m = new THREE.Matrix4().makeBasis(ld, n, wd).setPosition(ctr);
    if (m.determinant() < 0) m.multiply(new THREE.Matrix4().makeScale(1, 1, -1));
    // UV: kleiner, glatter Ausschnitt der Reifenflanke (Gummi + Schlamm), nicht das Laufflächenmuster
    const g = box.clone(), uv = g.attributes.uv, du = (i * 0.137 + (s > 0 ? 0.5 : 0)) % 0.9;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, du + uv.getX(k) * 0.08, 0.225 + uv.getY(k) * 0.05);
    out.push(prep(g, m));
  }
  box.dispose();
  const g = mergeGeometries(out, false); out.forEach((x) => x.dispose());
  return g;
}
/** Lathe um X aus [r, a]-Punkten (a = axial, +außen) */
function latheX(pts, seg) {
  return new THREE.LatheGeometry(pts.map(([r, a]) => new THREE.Vector2(Math.max(r, 1e-4), a)), seg).rotateZ(-Math.PI / 2);
}
/**
 * Rad (lokal, Achse = X, +X außen): { tyre, rim (Slot rimSlot), hub (trim) }.
 * style: 'agri' (Stahlfelge, Schüssel mit Löchern, Nabenkappe), 'truck' (Stahlscheibe mit Handlöchern),
 *        'small' (Stapler), 'road' (Straßenwalze/Laufrolle)
 */
function wheelGeo(Q, spec) {
  const { R, W, rimR, style = 'truck', lug = 0, dual = false } = spec;
  const seg = spec.seg || Q.wheelSeg, out = { tyre: [], rim: [], trim: [] };
  const k = Math.max(1, Math.round(2 * Math.PI * R / (lug ? 0.36 : 0.11) / (lug ? 1 : 8)));
  const tyreOne = (dx) => {
    if (Q.lod === 2) { out.tyre.push(prep(new THREE.CylinderGeometry(R, R, W * 0.95, 10).rotateZ(Math.PI / 2), M4(dx))); return; }
    out.tyre.push(prep(tyreGeo(R, W, rimR, seg, { lug, k, lowPoly: Q.lod > 0 }), M4(dx)));
    if (lug && Q.lod < 2) out.tyre.push(prep(lugGeo(R, W, lug, Math.round(2 * Math.PI * R / (Q.lod === 0 ? 0.3 : 0.42)), Q), M4(dx)));
  };
  tyreOne(0);
  if (dual && Q.lod < 2) tyreOne(-W - 0.04);
  const rs = Math.max(10, Math.round(seg * 0.75));
  if (Q.lod === 2) {
    out.rim.push(prep(new THREE.CircleGeometry(rimR, 10).rotateY(Math.PI / 2), M4(W * 0.3)));
    return finishWheel(out);
  }
  if (style === 'agri') {
    // Felgenhorn + Tiefbett + Schüssel + Nabe
    out.rim.push(prep(latheX([[rimR + 0.03, W * 0.44], [rimR + 0.03, W * 0.4], [rimR, W * 0.38], [rimR - 0.02, W * 0.2], [rimR - 0.02, -W * 0.38], [rimR + 0.03, -W * 0.42], [rimR + 0.03, -W * 0.46]], rs)));
    out.rim.push(prep(latheX([[rimR - 0.02, W * 0.1], [rimR * 0.82, W * 0.14], [rimR * 0.55, W * 0.2], [rimR * 0.36, W * 0.24], [rimR * 0.34, W * 0.27], [0.001, W * 0.27]], rs)));
    // Löcher in der Schüssel (dunkle Einsätze) + Radmuttern + Nabenkappe
    const nh = 8;
    for (let i = 0; i < nh; i++) {
      const a = i / nh * Math.PI * 2, r = rimR * 0.68;
      out.trim.push(prep(new THREE.CircleGeometry(rimR * 0.1, Q.lod === 0 ? 12 : 6).rotateY(Math.PI / 2), M4(W * 0.17 + 0.006, r * Math.cos(a), r * Math.sin(a))));
    }
    const nb = Q.lod === 0 ? 10 : 0;
    for (let i = 0; i < nb; i++) { const a = i / nb * Math.PI * 2, r = rimR * 0.27; out.rim.push(prep(new THREE.CylinderGeometry(0.016, 0.018, 0.035, 6).rotateZ(-Math.PI / 2), M4(W * 0.28, r * Math.cos(a), r * Math.sin(a)))); }
    out.trim.push(prep(latheX([[rimR * 0.2, W * 0.27], [rimR * 0.19, W * 0.4], [rimR * 0.14, W * 0.46], [0.001, W * 0.47]], Math.max(10, rs / 2))));
  } else if (style === 'truck' || style === 'small') {
    const dish = style === 'truck' ? 0.32 : 0.15;
    out.rim.push(prep(latheX([[rimR + 0.022, W * 0.46], [rimR + 0.022, W * 0.41], [rimR, W * 0.38], [rimR - 0.015, W * 0.25], [rimR - 0.015, -W * 0.4], [rimR + 0.022, -W * 0.44]], rs)));
    out.rim.push(prep(latheX([[rimR - 0.015, W * dish], [rimR * 0.78, W * (dish + 0.04)], [rimR * 0.52, W * (dish + 0.06)], [rimR * 0.42, W * (dish + 0.1)], [rimR * 0.3, W * (dish + 0.1)], [0.001, W * (dish + 0.1)]], rs)));
    const nh = style === 'truck' ? 8 : 5;
    for (let i = 0; i < nh; i++) {
      const a = (i + 0.5) / nh * Math.PI * 2, r = rimR * 0.65;
      out.trim.push(prep(new THREE.CircleGeometry(rimR * (style === 'truck' ? 0.11 : 0.12), Q.lod === 0 ? 10 : 5).rotateY(Math.PI / 2).scale(1, 1.25, 0.9), M4(W * (dish + 0.05) + 0.004, r * Math.cos(a), r * Math.sin(a), a)));
    }
    const nn = Q.lod === 0 ? (style === 'truck' ? 10 : 5) : 0;
    for (let i = 0; i < nn; i++) { const a = i / nn * Math.PI * 2, r = rimR * 0.36; out.rim.push(prep(new THREE.CylinderGeometry(0.014, 0.016, 0.03, 6).rotateZ(-Math.PI / 2), M4(W * (dish + 0.11), r * Math.cos(a), r * Math.sin(a)))); }
    out.trim.push(prep(latheX([[rimR * 0.22, W * (dish + 0.1)], [rimR * 0.2, W * (dish + 0.22)], [rimR * 0.12, W * (dish + 0.26)], [0.001, W * (dish + 0.27)]], Math.max(10, rs / 2))));
  } else {
    // Laufrolle (Kettenfahrzeug): Scheibe mit Nabe
    out.rim.push(prep(latheX([[rimR, W * 0.45], [rimR * 0.9, W * 0.4], [rimR * 0.45, W * 0.32], [rimR * 0.3, W * 0.42], [0.001, W * 0.42]], rs)));
    out.rim.push(prep(latheX([[0.001, -W * 0.45], [rimR * 0.4, -W * 0.45], [rimR, -W * 0.45]], rs)));
  }
  return finishWheel(out);
}
function finishWheel(out) {
  const r = {};
  for (const [k, arr] of Object.entries(out)) if (arr.length) { r[k] = arr.length === 1 ? arr[0] : mergeGeometries(arr, false); if (arr.length > 1) arr.forEach((g) => g.dispose()); }
  return r;
}
/** Rad einsetzen: side +1 (links, +X) oder −1 (rechts, gespiegelt) */
function addWheel(P, wg, x, y, z, side, rimSlot = 'chrome') {
  const m = M4(x, y, z).multiply(side < 0 ? MIRX : new THREE.Matrix4());
  if (wg.tyre) P.add('tyre', wg.tyre.clone(), m);
  if (wg.rim) P.add(rimSlot, wg.rim.clone(), m);
  if (wg.trim) P.add('trim', wg.trim.clone(), m);
}

// =====================================================================
// Leuchten, Spiegel, Kleinteile
// =====================================================================
/** Leuchte: Gehäuse (trim) + Streuscheibe (Slot) auf Fläche mit Normale n */
function lamp(P, Q, slot, p, n, w, h, { round = false, depth = 0.06, reflector = true } = {}) {
  const m = frame(p, n);
  if (round) {
    const r = w / 2, s = Q.lod === 0 ? 20 : 8;
    P.add('trim', new THREE.CylinderGeometry(r * 1.12, r * 1.18, depth, s).rotateX(Math.PI / 2).translate(0, 0, -depth / 2 + 0.004), m);
    if (Q.lod === 0 && reflector) P.add('chrome', new THREE.CircleGeometry(r * 0.98, s), M4(0, 0, 0.003).premultiply(m));
    P.add(slot, new THREE.SphereGeometry(r, s, Q.lod === 0 ? 6 : 3, 0, Math.PI * 2, 0, 0.55).rotateX(Math.PI / 2).scale(1, 1, 0.35).translate(0, 0, 0.004), m);
  } else {
    P.add('trim', roundedBox(w + 0.02, h + 0.02, depth, 0.008, Q.lod === 0 ? 2 : 1).translate(0, 0, -depth / 2 + 0.006), m);
    if (Q.lod === 0 && reflector) P.add('chrome', new THREE.PlaneGeometry(w * 0.96, h * 0.9), M4(0, 0, 0.004).premultiply(m));
    P.add(slot, roundedBox(w, h, 0.016, 0.005, Q.lod === 0 ? 2 : 1).translate(0, 0, 0.012), m);
  }
}
/** Atlas-Quad (Kennzeichen/Embleme/Schriftzüge) – rect in Canvas-Pixeln des 1024×512-Atlas */
const ATLAS = { plate: [4, 4, 1020, 216], emblem: [10, 266, 246, 502], word: [262, 262, 1018, 352], model: [262, 362, 1018, 432], extra: [262, 440, 1018, 508] };
function atlasPlane(w, h, rect) {
  const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv, [x0, y0, x1, y1] = rect;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, lerp(x0, x1, uv.getX(i)) / 1024, 1 - lerp(y1, y0, uv.getY(i)) / 512);
  return g;
}
function decal(P, key, p, n, w, h) { P.add('plate', atlasPlane(w, h, ATLAS[key]), frame(p, n)); }
function plateUnit(P, p, n, w = 0.52) {
  const h = w * 212 / 1016;
  P.add('trim', new THREE.PlaneGeometry(w + 0.03, h + 0.03), frame(p.clone().addScaledVector(n, -0.003), n));
  decal(P, 'plate', p, n, w, h);
}
/** Außenspiegel an Arm: Arm von a nach Kopf-Mitte k, Spiegelglas schaut nach −Z */
function mirror(P, Q, a, k, w = 0.2, h = 0.34) {
  const pts = [a, a.clone().lerp(k, 0.5).add(V3(0, 0.04, 0)), k];
  P.add('trim', sweep(pts, circProf(0.016, Q.lod === 0 ? 8 : 4)));
  P.add('trim', roundedBox(w, h, 0.07, 0.025, Q.lod === 0 ? 2 : 1), M4(k.x, k.y - h * 0.4, k.z));
  P.add('chrome', new THREE.PlaneGeometry(w - 0.025, h - 0.025), M4(k.x, k.y - h * 0.4, k.z - 0.0365, 0, Math.PI, 0));
}
/** Rundumleuchte (Sockel + Kuppel) */
function beaconUnit(P, Q, x, y, z, r = 0.07) {
  const s = Q.lod === 0 ? 18 : 8;
  P.add('trim', new THREE.CylinderGeometry(r * 1.15, r * 1.25, 0.045, s), M4(x, y + 0.022, z));
  P.add('beacon', latheX([[0.001, 0.13], [r * 0.55, 0.12], [r * 0.92, 0.075], [r, 0.03], [r, 0]], s).rotateZ(Math.PI / 2), M4(x, y + 0.045, z));
}

// =====================================================================
// Fahrzeug 1: Traktor (AGRION Terra 165)
// =====================================================================
function buildTractor(Q, variant) {
  const P = new Parts(), loader = variant === 'loader';
  const RW = { R: 0.9, W: 0.58, rimR: 0.49, x: 0.9, z: -0.95, y: 0.9 }, FW = { R: 0.62, W: 0.44, rimR: 0.36, x: 0.84, z: 1.62, y: 0.62 };
  // --- Haube (verjüngt sich nach vorne, Front abgesenkt) ---
  const hz0 = 0.18, hz1 = 2.14, hy0 = 1.01, hy1 = 1.75;
  const hoodDef = (p) => { const t = clamp((p.z - hz0) / (hz1 - hz0), 0, 1); if (p.y > hy0) p.y -= 0.1 * t * (p.y - hy0) / (hy1 - hy0); p.x *= 1 - 0.05 * t; return p; };
  shell(P, Q, {
    box: [-0.45, hy0, hz0, 0.45, hy1, hz1], r: { x: 0.15, y: [0.02, 0.17], z: [0.02, 0.13] }, skip: ['y-', 'z-'],
    breaks: { x: [-0.3, 0.3, -0.43, -0.34, 0.34, 0.43], y: [1.08, 1.1, 1.18, 1.52, 1.56, 1.6, 1.46, 1.58], z: [1.35, 1.95, hz1 - 0.06] },
    deform: (p) => hoodDef(p),
    cls: (f, c) => {
      const ax = Math.abs(c.x);
      if (f === 'z+') {
        if (c.y < 1.1) return 'trim';
        if (ax > 0.34 && c.y > 1.46 && c.y < 1.58) return ['headlight', 0.012];
        if (ax < 0.3 && c.y > 1.1 && c.y < 1.56) return ['trim', Q.lod < 2 ? 0.035 : 0];
        return 'paint';
      }
      if (f === 'x+' || f === 'x-') {
        if (c.y < 1.08) return 'trim';
        if (c.z > hz1 - 0.06 && c.y > 1.46 && c.y < 1.58) return ['headlight', 0.012];
        if (c.z > 1.35 && c.z < 1.95 && c.y > 1.18 && c.y < 1.52) return ['trim', Q.lod < 2 ? 0.012 : 0];
      }
      return 'paint';
    },
  });
  const hp = (x, y, z) => hoodDef(V3(x, y, z));
  if (Q.lod < 2) {
    // Kühlergrill-Lamellen
    const ns = Q.lod === 0 ? 9 : 4;
    for (let i = 0; i < ns; i++) { const y = lerp(1.14, 1.53, (i + 0.5) / ns), q = hp(0, y, hz1 - 0.02); P.add('trim', roundedBox(0.58, 0.014, 0.02, 0.005, 1), M4(0, q.y, q.z, -0.5)); }
    // seitliche Luftschlitze
    if (Q.lod === 0) for (const s of [-1, 1]) for (let i = 0; i < 6; i++) {
      const y = lerp(1.21, 1.49, (i + 0.5) / 6), q = hp(0.45 * s, y, 1.65);
      P.add('trim', roundedBox(0.012, 0.016, 0.58, 0.004, 1), M4(q.x - s * 0.006, q.y, 1.65, 0, 0, s * 0.5));
    }
    // Embleme und Schriftzug
    const e = hp(0, 1.645, hz1); decal(P, 'emblem', V3(0, e.y, hz1 + 0.003), V3(0, 0, 1), 0.13, 0.13);
    for (const s of [-1, 1]) {
      const q = hp(0.45 * s, 1.5, 0.85), q2 = hp(0.45 * s, 1.33, 0.85);
      decal(P, 'word', V3(q.x + s * 0.003, q.y, 0.85), V3(s, 0, 0), 0.62, 0.074);
      decal(P, 'model', V3(q2.x + s * 0.003, q2.y, 0.85), V3(s, 0, 0), 0.52, 0.048);
    }
  }
  // --- Motorblock, Getriebe, Achsen ---
  shell(P, Q, { box: [-0.33, 0.5, 0.2, 0.33, 1.08, 2.08], r: 0.05, slot: 'trim', skip: ['z-'] });
  shell(P, Q, { box: [-0.43, 0.56, -1.5, 0.43, 1.22, 0.24], r: 0.08, slot: 'trim' });
  P.add('trim', cylAB(V3(-RW.x + 0.28, RW.y, RW.z), V3(RW.x - 0.28, RW.y, RW.z), 0.17, 0.17, Q.lod === 0 ? 20 : 8));
  P.add('trim', cylAB(V3(-FW.x + 0.2, FW.y, FW.z), V3(FW.x - 0.2, FW.y, FW.z), 0.11, 0.11, Q.lod === 0 ? 16 : 6));
  P.add('trim', ...rb(Q, 0.36, 0.22, 0.4, 0.04, 0, 0.66, FW.z));
  for (const s of [-1, 1]) {
    P.add('trim', cylAB(V3(s * (FW.x - 0.22), FW.y, FW.z), V3(s * (FW.x - 0.08), FW.y, FW.z), 0.16, 0.14, Q.lod === 0 ? 16 : 6));
    P.add('trim', cylAB(V3(s * (RW.x - 0.3), RW.y, RW.z), V3(s * (RW.x - 0.14), RW.y, RW.z), 0.22, 0.2, Q.lod === 0 ? 18 : 8));
  }
  // --- Kabine: unten schmal zwischen den Hinterrädern, oben ausgestellte Seitenscheiben ---
  const cz0 = -1.28, cz1 = 0.32, cy0 = 1.17, cy1 = 2.79;
  const bulge = (y) => 1 + 0.4 * sstep(1.86, 2.26, y);
  shell(P, Q, {
    box: [-0.56, cy0, cz0, 0.56, cy1, cz1], r: { x: 0.055, y: [0.02, 0.03], z: 0.055 }, skip: ['y+'],
    breaks: { x: [...paneBreaks(-0.49, 0.49)], y: [1.28, 1.3, 1.75, 1.775, 1.86, 1.96, 2.06, 2.16, 2.26, 2.7, 2.725], z: [...paneBreaks(-1.21, -0.3), ...paneBreaks(-0.24, 0.25), -0.15, 0.1] },
    deform: (p) => { p.x *= bulge(p.y); },
    cls: (f, c) => {
      if (f === 'y-') return 'trim';
      const side = f[0] === 'x';
      if (side ? (c.z > cz1 - 0.05 || c.z < cz0 + 0.05) : Math.abs(c.x) > 0.505) return 'trim';
      if (c.y < 1.28) return 'trim';
      if (side) return pane(c, 'z', 'y', -1.21, -0.3, 1.3, 2.725) || pane(c, 'z', 'y', -0.24, 0.25, 1.3, 2.725) || 'trim';
      if (f === 'z+') return pane(c, 'x', 'y', -0.49, 0.49, 1.3, 2.725) || 'trim';
      return pane(c, 'x', 'y', -0.49, 0.49, 1.775, 2.725) || 'paint';
    },
  });
  // Dach
  shell(P, Q, {
    box: [-0.86, 2.78, -1.42, 0.86, 2.97, 0.46], r: { x: 0.09, y: [0.015, 0.075], z: 0.1 },
    cls: (f) => (f === 'y-' ? 'trim' : 'paint'),
  });
  const heads = [], tails = [], beacons = [];
  // Arbeitsscheinwerfer im Dach (vorne 4, hinten 2)
  for (const x of [-0.62, -0.25, 0.25, 0.62]) { const p = V3(x, 2.74, 0.42); lamp(P, Q, 'headlight', p, V3(0, -0.25, 1), 0.14, 0.07); heads.push(p); }
  for (const x of [-0.45, 0.45]) lamp(P, Q, 'headlight', V3(x, 2.74, -1.38), V3(0, -0.25, -1), 0.14, 0.07);
  beaconUnit(P, Q, 0.55, 2.97, -1.1); beacons.push(V3(0.55, 3.08, -1.1));
  if (Q.lod === 0) P.add('trim', cylAB(V3(-0.6, 2.97, -1.2), V3(-0.62, 3.75, -1.24), 0.006, 0.004, 5)); // Antenne
  // Türgriff, Haltegriff, Scheibenwischer
  if (Q.lod < 2) {
    P.add('trim', ...rb(Q, 0.025, 0.03, 0.16, 0.01, 0.56 * bulge(1.95) + 0.01, 1.95, 0.08));
    P.add('trim', sweep([V3(0.6, 1.35, 0.36), V3(0.62, 1.38, 0.37), V3(0.62, 2.2, 0.37), V3(0.6, 2.24, 0.36)], circProf(0.014, Q.lod === 0 ? 8 : 4)));
    P.add('trim', roundedBox(0.012, 0.012, 0.9, 0.004, 1).rotateX(Math.PI / 2).rotateY(0.3), M4(0.05, 2.1, cz1 + 0.012, 0, 0, 0.45));
  }
  // Spiegel
  for (const s of [-1, 1]) mirror(P, Q, V3(s * 0.8, 2.55, 0.28), V3(s * 1.28, 2.42, 0.34), 0.2, 0.34);
  // --- Kotflügel hinten (mit Leuchten) und vorne ---
  const nf = Q.lod === 0 ? 30 : Q.lod === 1 ? 12 : 5;
  const fProf = [[0, -0.33], [0.035, -0.33], [0.045, 0.22], [0.035, 0.32], [0.0, 0.35], [-0.08, 0.355], [-0.08, 0.33], [-0.012, 0.315], [-0.006, 0.22]];
  for (const s of [-1, 1]) {
    const g = arcSweep(0, RW.y, RW.z, RW.R + 0.085, 0.42, 2.75, nf, fProf.map(([r, a]) => [r, s * a]));
    P.add('paint', g, M4(s * RW.x));
    const ff = arcSweep(0, FW.y, FW.z, FW.R + 0.07, 0.25, 2.55, Math.max(4, nf - 8), [[0, -0.25], [0.025, -0.25], [0.03, 0.25], [0.0, 0.27], [-0.05, 0.27], [-0.05, 0.25], [-0.006, 0.24]].map(([r, a]) => [r, s * a]));
    P.add('paint', ff, M4(s * FW.x));
    P.add('trim', cylAB(V3(s * (FW.x - 0.12), FW.y, FW.z), V3(s * (FW.x - 0.12), FW.y + FW.R + 0.06, FW.z - 0.25), 0.025, 0.025, 6));
    // Rückleuchten + Blinker am Kotflügel-Ende, Arbeitsleuchte oben
    const tp = V3(s * (RW.x + 0.22), 1.42, RW.z - 0.95);
    lamp(P, Q, 'taillight', tp, V3(0, 0.2, -1), 0.11, 0.09); tails.push(tp);
    lamp(P, Q, 'beacon', V3(s * (RW.x + 0.08), 1.42, RW.z - 0.95), V3(0, 0.2, -1), 0.07, 0.07);
    lamp(P, Q, 'beacon', hp(s * 0.43, 1.52, hz1 - 0.15).add(V3(s * 0.012, 0, 0)), V3(s, 0, 0.3), 0.05, 0.03, { reflector: false });
    if (Q.lod < 2) lamp(P, Q, 'headlight', V3(s * RW.x, RW.y + RW.R + 0.2, RW.z - 0.45), V3(0, 0.2, -1), 0.12, 0.08);
  }
  // --- Frontgewicht oder Frontlader ---
  if (!loader) {
    P.add('trim', ...rb(Q, 0.5, 0.3, 0.16, 0.02, 0, 0.72, 2.12));
    shell(P, Q, {
      box: [-0.46, 0.44, 2.2, 0.46, 1.02, 2.52], r: 0.045, breaks: { x: [-0.24, -0.225, 0.225, 0.24], y: [0.7, 0.715] },
      cls: (f, c) => ((f[0] !== 'x' && (Math.abs(Math.abs(c.x) - 0.2325) < 0.008)) || (f[0] !== 'y' && Math.abs(c.y - 0.7075) < 0.008) ? ['trim', 0.012] : 'trim'),
    });
    P.add('trim', sweep([V3(-0.16, 1.0, 2.36), V3(-0.16, 1.12, 2.36), V3(-0.1, 1.17, 2.36), V3(0.1, 1.17, 2.36), V3(0.16, 1.12, 2.36), V3(0.16, 1.0, 2.36)], circProf(0.022, Q.lod === 0 ? 8 : 4)));
    plateUnit(P, V3(0, 0.86, 2.523), V3(0, 0, 1), 0.42);
  } else {
    for (const s of [-1, 1]) {
      P.add('paint', ...rb(Q, 0.1, 0.78, 0.4, 0.02, s * 0.4, 0.98, 0.5));
      const path = new THREE.CatmullRomCurve3([V3(s * 0.56, 1.3, 0.48), V3(s * 0.6, 1.62, 1.15), V3(s * 0.64, 1.52, 2.1), V3(s * 0.66, 1.05, 2.75), V3(s * 0.66, 0.55, 3.08)]).getPoints(Q.lod === 0 ? 24 : 8);
      P.add('paint', sweep(path, rectProf(0.1, 0.18, 0.2), { up: XAX }));
      const c0 = V3(s * 0.48, 0.82, 0.62), c1 = V3(s * 0.6, 1.55, 1.6), cm = c0.clone().lerp(c1, 0.55);
      P.add('trim', cylAB(c0, cm, 0.05, 0.05, Q.lod === 0 ? 12 : 6)); P.add('trim', cylAB(cm.clone().lerp(c0, 0.1), c1, 0.025, 0.025, 8));
    }
    P.add('paint', cylAB(V3(-0.66, 1.28, 2.42), V3(0.66, 1.28, 2.42), 0.06, 0.06, Q.lod === 0 ? 14 : 6));
    // Schaufel (Seitenprofil extrudiert) + Seitenwangen
    const prof = [[3.0, 0.08], [3.86, 0.02], [3.88, 0.05], [3.04, 0.12], [2.98, 0.4], [3.02, 0.78], [3.2, 0.92], [3.18, 0.96], [2.96, 0.82], [2.92, 0.4]];
    P.add('trim', extrudeSide(prof, 2.18, Q.lod === 0 ? 0.008 : 0, 1));
    for (const s of [-1, 1]) P.add('trim', extrudeSide([[2.92, 0.05], [3.88, 0.02], [3.6, 0.5], [3.2, 0.95], [2.92, 0.82]], 0.02), M4(s * 1.08));
    plateUnit(P, V3(0, 0.84, 2.18), V3(0, 0, 1), 0.42);
  }
  // --- Auspuff (rechts vorne an der A-Säule), Ansaugrohr links ---
  const ex = -0.5, ez = 0.4;
  P.add('trim', cylAB(V3(ex, 1.55, ez), V3(ex, 3.02, ez), 0.055, 0.055, Q.lod === 0 ? 16 : 6));
  if (Q.lod < 2) {
    P.add('trim', new THREE.CylinderGeometry(0.075, 0.075, 0.75, Q.lod === 0 ? 16 : 6, 1, true, -Math.PI * 0.2, Math.PI * 1.1), M4(ex, 2.35, ez));
    P.add('trim', cylAB(V3(0.5, 1.6, 0.42), V3(0.5, 2.35, 0.42), 0.07, 0.07, Q.lod === 0 ? 14 : 6));
    P.add('trim', new THREE.SphereGeometry(0.085, Q.lod === 0 ? 14 : 6, 6, 0, Math.PI * 2, 0, Math.PI / 2), M4(0.5, 2.35, 0.42));
  }
  // --- Aufstieg links, Tank rechts ---
  for (const y of [0.42, 0.78, 1.12]) P.add('trim', ...rb(Q, 0.3, 0.035, 0.28, 0.01, 0.74, y, 0.16));
  for (const z of [0.03, 0.29]) P.add('trim', ...rb(Q, 0.3, 0.8, 0.025, 0.01, 0.74, 0.78, z));
  shell(P, Q, { box: [-0.78, 0.52, -0.04, -0.46, 1.1, 0.38], r: 0.08, slot: 'paint' });
  P.add('trim', new THREE.CylinderGeometry(0.045, 0.045, 0.03, 12), M4(-0.64, 1.11, 0.1));
  // --- Heck: Dreipunkt, Zapfwelle, Zugmaul, Steuergeräte ---
  if (Q.lod < 2) {
    for (const s of [-1, 1]) {
      P.add('trim', sweep([V3(s * 0.34, 0.62, -1.35), V3(s * 0.4, 0.5, -1.7), V3(s * 0.44, 0.45, -1.98)], rectProf(0.06, 0.1)));
      P.add('trim', sweep([V3(s * 0.3, 1.2, -1.4), V3(s * 0.34, 1.12, -1.78)], rectProf(0.05, 0.09)));
      P.add('trim', cylAB(V3(s * 0.34, 1.1, -1.76), V3(s * 0.4, 0.53, -1.72), 0.018, 0.018, 6));
      P.add('trim', new THREE.SphereGeometry(0.045, 10, 6), M4(s * 0.44, 0.45, -1.98));
    }
    P.add('trim', cylAB(V3(0, 1.33, -1.45), V3(0, 1.22, -1.75), 0.04, 0.04, 10)); P.add('trim', cylAB(V3(0, 1.22, -1.72), V3(0, 1.17, -1.95), 0.022, 0.022, 8));
    P.add('trim', cylAB(V3(0, 0.78, -1.48), V3(0, 0.78, -1.62), 0.035, 0.035, 12));
    P.add('paint', new THREE.CylinderGeometry(0.16, 0.16, 0.24, Q.lod === 0 ? 16 : 8, 1, true, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2), M4(0, 0.82, -1.56));
    P.add('trim', ...rb(Q, 0.16, 0.12, 0.3, 0.02, 0, 0.5, -1.6));
    for (let i = 0; i < 4; i++) P.add('trim', cylAB(V3(-0.27 + i * 0.18, 1.22, -1.5), V3(-0.27 + i * 0.18, 1.22, -1.58), 0.026, 0.026, 8));
  }
  plateUnit(P, V3(0.92, 1.25, RW.z - 0.99), V3(0, 0.15, -1), 0.42);
  // --- Innenraum ---
  if (Q.lod < 2) {
    P.add('interior', new THREE.PlaneGeometry(1.0, 1.5).rotateX(-Math.PI / 2), M4(0, 1.23, -0.48));
    P.add('interior', ...rb(Q, 0.5, 0.12, 0.48, 0.04, 0, 1.58, -0.72));
    P.add('interior', ...rb(Q, 0.5, 0.62, 0.12, 0.04, 0, 1.92, -0.98, -0.18));
    P.add('trim', ...rb(Q, 0.3, 0.3, 0.3, 0.03, 0, 1.38, -0.72));
    P.add('interior', ...rb(Q, 0.17, 0.15, 0.56, 0.03, -0.33, 1.72, -0.6));
    P.add('trim', cylAB(V3(-0.33, 1.79, -0.45), V3(-0.33, 1.9, -0.42), 0.02, 0.025, 6));
    P.add('interior', cylAB(V3(0, 1.3, 0.18), V3(0, 1.95, -0.06), 0.04, 0.035, 8));
    P.add('interior', new THREE.TorusGeometry(0.19, 0.016, Q.lod === 0 ? 8 : 4, Q.lod === 0 ? 32 : 12), M4(0, 1.97, -0.07, -1.2));
    P.add('interior', ...rb(Q, 0.36, 0.14, 0.12, 0.03, 0, 1.86, 0.06, -0.5));
  }
  // --- Räder ---
  const rear = wheelGeo(Q, { R: RW.R, W: RW.W, rimR: RW.rimR, style: 'agri', lug: 0.05 });
  const front = wheelGeo(Q, { R: FW.R, W: FW.W, rimR: FW.rimR, style: 'agri', lug: 0.04 });
  for (const s of [-1, 1]) { addWheel(P, rear, s * RW.x, RW.y, RW.z, s); addWheel(P, front, s * FW.x, FW.y, FW.z, s); }
  const zMax = loader ? 3.88 : 2.52, zMin = -1.98;
  return {
    P, marks: { head: heads, tail: tails, beacon: beacons },
    dims: { length: zMax - zMin, width: 2 * (RW.x + RW.W * 0.505), height: 2.97, wheelbase: FW.z - RW.z, zMin, zMax },
    wheels: [{ ...FW, front: true }, { ...RW, front: false }],
    wear: { mud: 1, wheels: [RW, FW] },
  };
}

// =====================================================================
// Fahrzeug 2: Bus (VARENNE Urbis = Stadtbus, Orbis = Reisebus)
// =====================================================================
function buildBus(Q, variant, length) {
  const P = new Parts(), coach = variant === 'coach';
  const L = length ?? (coach ? 12.2 : 12.0), hw = 1.275, zf = L / 2, zr = -L / 2;
  const bot = coach ? 0.4 : 0.3, top = coach ? 3.5 : 2.92;
  const wR = coach ? 0.53 : 0.5, wW = 0.3, rimR = 0.286, ar = wR + 0.08;
  const zFa = zf - (coach ? 2.55 : 2.7), zRa = zr + (coach ? 3.2 : 3.4);
  const wy0 = coach ? 1.55 : 1.08, wy1 = coach ? 3.22 : 2.58;
  const ws0 = coach ? 1.05 : 0.98, ws1 = coach ? 3.3 : 2.42;
  const mid = (zFa + zRa) / 2;
  const doors = coach ? [[zf - 1.3, zf - 0.35], [zRa + ar + 0.15, zRa + ar + 1.05]]
    : [[zf - 1.42, zf - 0.18], [mid - 0.62, mid + 0.62], ...(L >= 11 ? [[zRa - ar - 1.32, zRa - ar - 0.1]] : [])];
  const dTop = coach ? 3.3 : 2.6;
  const zb0 = zr + 0.32, zb1 = zf - 0.14;
  const nP = Math.max(3, Math.round((zb1 - zb0) / (coach ? 1.25 : 1.5)));
  const pillars = []; for (let i = 1; i < nP; i++) pillars.push(lerp(zb0, zb1, i / nP));
  const pw = 0.05, fw = 0.022;
  const inPillar = (z) => pillars.some((q) => Math.abs(z - q) < pw);
  const inDoor = (z) => doors.find(([a, b]) => z >= a && z <= b);
  const zBreaks = [zb0, zb1, zf - 0.12, zr + 0.1, ...pillars.flatMap((q) => [q - pw, q + pw, q - pw - fw, q + pw + fw]), ...doors.flatMap(([a, b]) => [a, b, a + 0.05, b - 0.05, (a + b) / 2 - 0.015, (a + b) / 2 + 0.015])];
  const hatches = coach ? [[zFa - ar - 2.3, zFa - ar - 0.25], [zRa + ar + 1.25, zFa - ar - 2.45]] : [];
  const hatchZ = hatches.flatMap(([a, b]) => [a, a + 0.012, b - 0.012, b]);
  const yBreaks = [0.45, 0.5, 0.55, 0.6, 0.68, 0.72, 1.6, 1.85, 1.95, 2.47, 2.62, 2.75, ws0, ws0 + 0.04, ws1 - 0.04, ws1, wy0, wy0 + fw, wy1 - fw, wy1, dTop, dTop - 0.05, bot + 0.06, bot + 0.11, 0.5, 0.512, 1.3, 1.312];
  const xBreaks = [hw - 0.07, hw - 0.11, 0.95, 0.98, 0.72, 1.16, 0.55, 0.85, 0.3, 1.0].flatMap((v) => [v, -v]);
  const lo2 = Q.lod === 2;
  shell(P, Q, {
    box: [-hw, bot, zr, hw, top, zf], r: { x: 0.1, y: [0.03, 0.2], z: [0.08, 0.14] }, cell: Q.lod === 0 ? 0.42 : Q.cell,
    breaks: { x: xBreaks, y: yBreaks, z: lo2 ? [zb0, zb1, ...doors.flat()] : [...zBreaks, ...hatchZ] },
    arches: [{ z: zFa, y: wR, r: ar }, { z: zRa, y: wR, r: ar }],
    deform: (p, raw) => { const w = sstep(zf - 0.5, zf, raw.z); p.z -= 0.05 * w * sstep(ws0, ws1, p.y); },
    cls: (f, c) => {
      const ax = Math.abs(c.x);
      if (f === 'y-') return 'trim';
      if (f === 'y+') return 'paint';
      if (f === 'z+') {
        if (c.y < 0.45) return 'trim';
        const pn = pane(c, 'x', 'y', -(hw - 0.07), hw - 0.07, ws0, ws1, 0.04, 0.02); if (pn) return pn;
        if (!coach && ax < 0.95 && c.y > 2.47 && c.y < 2.75) return ['trim', 0.014];
        if (ax > 0.72 && ax < 1.16 && c.y > 0.5 && c.y < 0.68) return ['headlight', 0.01];
        if (ax < 0.55 && c.y > 0.5 && c.y < 0.72) return ['trim', 0.012];
        return 'paint';
      }
      if (f === 'z-') {
        if (c.y < 0.45) return 'trim';
        if (ax > 1.0 && c.y > 0.55 && c.y < 1.85) return ['taillight', 0.008];
        if (!coach) { const pn = pane(c, 'x', 'y', -0.95, 0.95, 1.95, 2.62, 0.03, 0.015); if (pn) return pn; }
        if (ax < 0.85 && c.y > 0.6 && c.y < 1.6) return ['trim', 0.02];
        return 'paint';
      }
      // Flanken
      if (c.z > zf - 0.12 && c.y > 0.5 && c.y < 0.68) return ['headlight', 0.01];
      if (c.z < zr + 0.1 && c.y > 0.55 && c.y < 1.85) return ['taillight', 0.008];
      const d = f === 'x-' && inDoor(c.z);
      if (d && c.y > bot + 0.06 && c.y < dTop) {
        const dm = (d[0] + d[1]) / 2;
        if (c.z < d[0] + 0.05 || c.z > d[1] - 0.05 || c.y > dTop - 0.05 || c.y < bot + 0.11 || Math.abs(c.z - dm) < 0.015) return ['trim', 0.02];
        if (coach && c.y < wy0) return ['trim', 0.02];
        return ['glass', 0.035];
      }
      if (c.y > wy0 && c.y < wy1 && c.z > zb0 && c.z < zb1) {
        if (inPillar(c.z) || lo2) return lo2 ? 'glass' : 'trim';
        if (c.y < wy0 + fw || c.y > wy1 - fw || pillars.some((q) => Math.abs(c.z - q) < pw + fw)) return ['trim', 0.004];
        return ['glass', 0.01];
      }
      const hh = coach && c.y > 0.5 && c.y < 1.312 && hatches.find(([a, b]) => c.z > a && c.z < b);
      if (hh && (c.y < 0.512 || c.y > 1.3 || c.z < hh[0] + 0.012 || c.z > hh[1] - 0.012)) return ['trim', 0.006];
      if (c.y < bot + 0.06) return 'trim';
      return 'paint';
    },
  });
  // Radhäuser
  for (const z of [zFa, zRa]) P.add('trim', wheelhouse(z, wR, ar, -hw + 0.02, hw - 0.02, Q.lod === 0 ? 20 : Q.lod === 1 ? 8 : 4));
  // Dach: Klimaanlage, Lüftungsklappen
  const acZ = coach ? zr + 2.4 : zf - 3.2;
  shell(P, Q, { box: [-0.92, top - 0.02, acZ - 1.3, 0.92, top + (coach ? 0.16 : 0.24), acZ + 1.3], r: { x: 0.12, y: [0.01, 0.1], z: 0.2 }, cls: (f) => (f === 'y-' ? null : 'paint') });
  if (Q.lod < 2) for (const z of [zr + 2.5, mid - 0.5]) P.add('trim', ...rb(Q, 0.7, 0.06, 0.7, 0.02, 0, top + 0.02, z));
  // Spiegel, Wischer
  for (const s of [-1, 1]) {
    if (coach) mirror(P, Q, V3(s * 1.22, top - 0.55, zf - 0.08), V3(s * 1.42, top - 0.75, zf + 0.42), 0.22, 0.4);
    else mirror(P, Q, V3(s * 1.2, top - 0.22, zf - 0.12), V3(s * 1.4, top - 0.42, zf + 0.34), 0.2, 0.36);
    if (Q.lod < 2) P.add('trim', roundedBox(0.95, 0.018, 0.014, 0.005, 1), M4(s * 0.5, ws0 + 0.08, zf + 0.012, 0, 0, s * 0.35));
  }
  // Front: Emblem, Kennzeichen, Zielanzeige
  const fz = zf; // Front ist unten senkrecht
  decal(P, 'emblem', V3(0, 0.86, fz + 0.002), V3(0, 0, 1), 0.16, 0.16);
  plateUnit(P, V3(0, 0.33, fz + 0.004), V3(0, 0, 1));
  if (!coach) decal(P, 'extra', V3(0, 2.61, zf - 0.05 - 0.014 + 0.003), V3(0, 0, 1), 1.82, 0.164);
  else decal(P, 'extra', V3(0, ws1 - 0.2, zf - 0.05 - 0.02 - 0.03), V3(0, 0, 1), 1.4, 0.126);
  plateUnit(P, V3(0, 0.33, zr - 0.004), V3(0, 0, -1));
  decal(P, 'word', V3(0, coach ? 2.0 : 1.78, zr - 0.003), V3(0, 0, -1), 1.0, 0.12);
  for (const s of [-1, 1]) {
    const z = s > 0 ? 0 : (doors[0][0] + doors[1][1]) / 2;
    decal(P, 'word', V3(s * (hw + 0.002), coach ? 1.43 : 0.86, coach ? zFa - 1.6 : z), V3(s, 0, 0), coach ? 1.5 : 1.5, 0.18);
    if (coach) decal(P, 'model', V3(s * (hw + 0.002), 1.43, zRa + 1.3), V3(s, 0, 0), 1.2, 0.111);
    lamp(P, Q, 'beacon', V3(s * (hw + 0.004), 0.75, zf - 0.55), V3(s, 0, 0), 0.1, 0.035, { reflector: false });
    if (Q.lod === 0) for (let z = zr + 1.5; z < zf - 1; z += 2.2) lamp(P, Q, 'beacon', V3(s * (hw + 0.003), bot + 0.18, z), V3(s, 0, 0), 0.05, 0.025, { reflector: false });
  }
  // Rückseite: Motorgitter-Lamellen
  if (Q.lod === 0) for (let i = 0; i < 12; i++) P.add('trim', roundedBox(1.6, 0.018, 0.03, 0.006, 1), M4(0, lerp(0.66, 1.54, (i + 0.5) / 12), zr + 0.012, 0.4));
  // Innenraum
  if (Q.lod < 2) {
    const fy = coach ? 1.25 : bot + 0.06, ceil = top - 0.12;
    P.add('interior', new THREE.PlaneGeometry(2 * hw - 0.1, L - 0.4).rotateX(-Math.PI / 2), M4(0, fy, 0));
    P.add('interior', new THREE.PlaneGeometry(2 * hw - 0.1, L - 0.4).rotateX(Math.PI / 2), M4(0, ceil, 0));
    const seat = (x, z, y) => {
      P.add('interior', ...rb(Q, 0.42, 0.1, 0.42, 0.035, x, y, z));
      P.add('interior', ...rb(Q, 0.42, coach ? 0.72 : 0.52, 0.08, 0.03, x, y + (coach ? 0.36 : 0.26), z - 0.22, -0.12));
      if (Q.lod === 0) P.add('trim', ...rb(Q, 0.08, y - fy, 0.08, 0.01, x, (y + fy) / 2, z));
    };
    const sy = fy + 0.45;
    for (let z = zf - 2.05; z > zr + 0.6; z -= coach ? 0.85 : 0.82) {
      for (const s of [-1, 1]) {
        if (s < 0 && doors.some(([a, b]) => z > a - 0.45 && z < b + 0.3)) continue;
        if (!coach && Math.abs(z - zFa) < ar + 0.2) continue;
        if (!coach && Math.abs(z - zRa) < ar + 0.15) { seat(s * 0.78, z, sy + 0.3); continue; }
        seat(s * 0.5, z, sy); seat(s * 0.94, z, sy);
      }
    }
    // Fahrerplatz (links), Armaturen, Haltestangen
    seat(0.72, zf - 1.25, fy + 0.45);
    P.add('interior', ...rb(Q, 1.0, 0.3, 0.45, 0.05, 0.65, fy + 0.62, zf - 0.42));
    P.add('interior', new THREE.TorusGeometry(0.22, 0.018, Q.lod === 0 ? 8 : 4, Q.lod === 0 ? 30 : 12), M4(0.72, fy + 0.95, zf - 0.75, -1.1));
    if (!coach) for (const [a, b] of doors) for (const z of [a - 0.08, b + 0.08]) P.add('chrome', cylAB(V3(-0.82, fy, z), V3(-0.82, ceil, z), 0.018, 0.018, Q.lod === 0 ? 8 : 4));
    if (!coach) for (const s of [-1, 1]) P.add('chrome', cylAB(V3(s * 0.55, ceil - 0.18, zr + 0.6), V3(s * 0.55, ceil - 0.18, zf - 1.6), 0.016, 0.016, Q.lod === 0 ? 8 : 4));
  }
  // Räder
  const fwg = wheelGeo(Q, { R: wR, W: wW, rimR, style: 'truck' }), rwg = wheelGeo(Q, { R: wR, W: wW, rimR, style: 'truck', dual: true });
  const wx = hw - wW / 2 - 0.05;
  for (const s of [-1, 1]) { addWheel(P, fwg, s * wx, wR, zFa, s); addWheel(P, rwg, s * wx, wR, zRa, s); }
  const heads = [V3(0.94, 0.59, zf), V3(-0.94, 0.59, zf)], tails = [V3(1.12, 1.2, zr), V3(-1.12, 1.2, zr)];
  if (Q.lod === 2) for (const h of heads) lamp(P, Q, 'headlight', h, V3(0, 0, 1), 0.4, 0.16);
  return {
    P, marks: { head: heads, tail: tails, beacon: [] },
    dims: { length: L, width: 2 * hw, height: top + (coach ? 0.16 : 0.24), wheelbase: zFa - zRa, zMin: zr, zMax: zf },
    wheels: [{ x: wx, y: wR, z: zFa, R: wR, W: wW, front: true }, { x: wx, y: wR, z: zRa, R: wR, W: wW }],
    wear: { wheels: [{ z: zFa, y: wR, R: wR }, { z: zRa, y: wR, R: wR }] },
  };
}

// =====================================================================
// Fahrzeug 3: LKW (VARENNE Carrus) – Koffer-LKW (box) oder Sattelzug mit Kofferauflieger (semi)
// =====================================================================
function truckCab(P, Q, zf, { spoilerTop }) {
  const z0 = zf - 2.25, y0 = 1.05, y1 = 3.2, hw = 1.24;
  const dz0 = zf - 1.32, dz1 = zf - 0.12;
  shell(P, Q, {
    box: [-hw, y0, z0, hw, y1, zf], r: { x: 0.07, y: [0.03, 0.14], z: [0.05, 0.12] },
    breaks: { x: [...paneBreaks(-1.1, 1.1, 0.045), -0.86, 0.86], y: [1.2, 1.88, 2.0, 2.045, 2.935, 2.98, 2.02, 2.06, 2.88, 2.92, 1.1, 1.108, 2.992, 3.0], z: [dz0, dz0 + 0.008, dz1 - 0.008, dz1, ...paneBreaks(dz0 + 0.1, dz1 - 0.08, 0.04)] },
    deform: (p, raw) => { const w = sstep(zf - 0.5, zf, raw.z); p.z -= w * Math.max(0, p.y - 1.9) * 0.1; },
    cls: (f, c) => {
      const ax = Math.abs(c.x);
      if (f === 'y-') return 'trim';
      if (f === 'z+') {
        const pn = pane(c, 'x', 'y', -1.1, 1.1, 2.0, 2.98, 0.045, 0.02); if (pn) return pn;
        if (ax < 0.86 && c.y > 1.2 && c.y < 1.88) return ['trim', Q.lod < 2 ? 0.03 : 0];
        return 'paint';
      }
      if (f[0] === 'x') {
        const pn = pane(c, 'z', 'y', dz0 + 0.1, dz1 - 0.08, 2.02, 2.92, 0.04, 0.015); if (pn) return pn;
        if (Q.lod < 2 && c.z > dz0 && c.z < dz1 && c.y > 1.1 && c.y < 3.0 && (c.z < dz0 + 0.008 || c.z > dz1 - 0.008 || c.y < 1.108 || c.y > 2.992)) return ['trim', 0.008];
        if (c.y < 1.15) return 'trim';
      }
      return 'paint';
    },
  });
  // Stoßfänger mit Scheinwerfern
  shell(P, Q, {
    box: [-1.22, 0.38, zf - 0.42, 1.22, 1.06, zf + 0.04], r: 0.05, skip: ['z-'],
    breaks: { x: [0.62, 1.12, 1.2, 0.75, 0.95, -0.62, -1.12, -1.2, -0.75, -0.95, 0.3, -0.3], y: [0.8, 0.97, 0.5, 0.6, 0.72, 0.45, 0.6] },
    cls: (f, c) => {
      const ax = Math.abs(c.x);
      if (f === 'z+') {
        if (ax > 0.62 && ax < 1.12 && c.y > 0.8 && c.y < 0.97) return ['headlight', 0.012];
        if (ax > 1.12 && c.y > 0.8 && c.y < 0.97) return ['beacon', 0.008];
        if (ax > 0.75 && ax < 0.95 && c.y > 0.5 && c.y < 0.6) return ['headlight', 0.008];
        if (ax < 0.3 && c.y > 0.45 && c.y < 0.6) return ['trim', 0.01];
      }
      if (f[0] === 'x' && c.z > zf - 0.02 && c.y > 0.8 && c.y < 0.97) return ['beacon', 0.008];
      return c.y > 0.72 ? 'paint' : 'trim';
    },
  });
  plateUnit(P, V3(0, 0.525, zf + 0.035), V3(0, 0, 1));
  // Grill-Lamellen, Emblem, Schriftzug
  if (Q.lod < 2) for (let i = 0; i < (Q.lod === 0 ? 7 : 3); i++) P.add('chrome', roundedBox(1.66, 0.03, 0.02, 0.008, 1), M4(0, lerp(1.26, 1.82, (i + 0.5) / (Q.lod === 0 ? 7 : 3)), zf - 0.022));
  decal(P, 'emblem', V3(0, 1.55, zf - 0.005), V3(0, 0, 1), 0.2, 0.2);
  decal(P, 'word', V3(0, 1.94, zf + 0.003), V3(0, 0, 1), 0.9, 0.107);
  // Sonnenblende, Dachleuchten, Windleitkörper
  P.add('trim', ...rb(Q, 2.3, 0.04, 0.3, 0.015, 0, y1 - 0.02, zf - 0.02, -0.25));
  for (let i = 0; i < 5; i++) lamp(P, Q, 'beacon', V3(-0.5 + i * 0.25, y1 + 0.01, zf - 0.22), V3(0, 0.3, 1), 0.06, 0.03, { reflector: false });
  if (spoilerTop > y1 + 0.2) {
    const h = spoilerTop - y1;
    P.add('paint', extrudeSide([[zf - 0.35, y1 - 0.02], [zf - 0.55, y1 + h * 0.45], [zf - 1.2, y1 + h * 0.92], [zf - 1.9, y1 + h], [z0 + 0.02, y1 + h], [z0 + 0.02, y1 - 0.02]], 2.3, Q.lod === 0 ? 0.05 : 0.02, Q.lod === 0 ? 3 : 1));
  }
  // Einstieg, Spiegel, Griffe
  for (const s of [-1, 1]) {
    P.add('trim', ...rb(Q, 0.1, 0.64, 0.7, 0.02, s * 1.18, 0.73, zf - 0.75));
    for (const y of [0.52, 0.82]) P.add('trim', ...rb(Q, 0.26, 0.03, 0.56, 0.01, s * 1.1, y, zf - 0.75));
    mirror(P, Q, V3(s * 1.24, 2.75, zf - 0.32), V3(s * 1.52, 2.62, zf - 0.12), 0.22, 0.46);
    if (Q.lod < 2) {
      P.add('chrome', sweep([V3(s * 1.25, 1.35, zf - 1.36), V3(s * 1.28, 1.38, zf - 1.37), V3(s * 1.28, 2.6, zf - 1.37), V3(s * 1.25, 2.63, zf - 1.36)], circProf(0.016, Q.lod === 0 ? 8 : 4)));
      P.add('chrome', ...rb(Q, 0.03, 0.035, 0.2, 0.01, s * 1.245, 1.85, zf - 1.1));
      P.add('trim', roundedBox(1.0, 0.018, 0.014, 0.005, 1), M4(s * 0.52, 2.07, zf - 0.008, 0, 0, s * 0.3));
    }
  }
  // Innenraum
  if (Q.lod < 2) {
    P.add('interior', new THREE.PlaneGeometry(2.3, 2.1).rotateX(-Math.PI / 2), M4(0, 1.35, zf - 1.15));
    for (const s of [-1, 1]) {
      P.add('interior', ...rb(Q, 0.52, 0.14, 0.5, 0.04, s * 0.6, 1.75, zf - 1.0));
      P.add('interior', ...rb(Q, 0.52, 0.72, 0.13, 0.04, s * 0.6, 2.18, zf - 1.28, -0.15));
    }
    P.add('interior', ...rb(Q, 2.2, 0.35, 0.5, 0.06, 0, 1.92, zf - 0.38));
    P.add('interior', new THREE.TorusGeometry(0.24, 0.02, Q.lod === 0 ? 8 : 4, Q.lod === 0 ? 30 : 12), M4(0.6, 2.18, zf - 0.68, -1.0));
    P.add('interior', ...rb(Q, 2.3, 1.4, 0.1, 0.03, 0, 2.05, z0 + 0.1));
  }
}
function buildTruck(Q, variant, length) {
  const P = new Parts(), semi = variant === 'semi';
  const L = semi ? 16.05 : (length ?? 8.5), zf = L / 2, zr = -L / 2;
  const fR = 0.53, fW = 0.32, rimR = 0.286, wx = 1.05;
  const zFa = zf - 1.45;
  const zRa = semi ? zf - 5.25 : zr + 2.0;
  const boxTop = semi ? 4.0 : 3.85, boxBot = 1.25, bw = 1.27;
  const bz1 = zf - (semi ? 2.45 : 2.4), bz0 = zr;
  truckCab(P, Q, zf, { spoilerTop: boxTop - 0.08 });
  // Rahmen
  const railEnd = semi ? zf - 6.0 : zr + 0.2;
  for (const s of [-1, 1]) P.add('trim', ...rb(Q, 0.08, 0.3, zf - 0.4 - railEnd, 0.01, s * 0.43, 0.9, (zf - 0.4 + railEnd) / 2));
  for (let z = zf - 0.6; z > railEnd; z -= 1.2) P.add('trim', ...rb(Q, 0.8, 0.2, 0.08, 0.01, 0, 0.9, z));
  // Tank links (Alu), Batteriekasten rechts
  const tz1 = zFa - 0.75, tz0 = tz1 - (semi ? 1.2 : 1.0);
  shell(P, Q, { box: [0.62, 0.52, tz0, 1.2, 1.1, tz1], r: { x: [0.04, 0.2], y: 0.2, z: 0.04 }, slot: 'chrome' });
  if (Q.lod < 2) for (const z of [tz0 + 0.15, tz1 - 0.15]) P.add('trim', sweep([V3(0.6, 1.12, z), V3(0.95, 1.13, z), V3(1.22, 0.85, z), V3(0.95, 0.5, z), V3(0.6, 0.5, z)], rectProf(0.012, 0.05)));
  shell(P, Q, { box: [-1.18, 0.55, tz0 + 0.2, -0.6, 1.05, tz1], r: 0.03, slot: 'trim' });
  // Kotflügel vorne (Kunststoff), hinten flach mit Schmutzfängern
  const nf = Q.lod === 0 ? 20 : Q.lod === 1 ? 8 : 4;
  for (const s of [-1, 1]) {
    P.add('trim', arcSweep(s * wx, fR, zFa, fR + 0.07, 0.15, 2.75, nf, [[0, -0.2], [0.03, -0.2], [0.03, 0.22], [0, 0.22]]));
  }
  const rearMud = (z, n) => {
    for (const s of [-1, 1]) {
      P.add('trim', ...rb(Q, 0.72, 0.03, 0.7 + (n - 1) * 1.31, 0.01, s * (wx - 0.16), 2 * fR + 0.1, z - (n - 1) * 0.655));
      P.add('trim', new THREE.PlaneGeometry(0.62, 0.42), M4(s * (wx - 0.16), 0.42, z - (n - 1) * 1.31 - fR - 0.12));
    }
  };
  // Aufbau
  const heads = [V3(0.87, 0.885, zf + 0.04), V3(-0.87, 0.885, zf + 0.04)], tails = [];
  const boxShell = (z0, z1, yb, yt) => {
    const nS = Math.max(2, Math.round((z1 - z0) / 1.2)), seams = []; for (let i = 1; i < nS; i++) seams.push(lerp(z0, z1, i / nS));
    shell(P, Q, {
      box: [-bw, yb, z0, bw, yt, z1], r: 0.035, cell: Q.lod === 0 ? 0.5 : Q.cell,
      breaks: { x: [-0.012, 0.012, ...paneBreaks(-bw + 0.07, bw - 0.07, 0.0)], y: [yb + 0.13, yt - 0.12], z: seams.flatMap((q) => [q - 0.008, q + 0.008]) },
      cls: (f, c) => {
        if (f === 'y-') return 'trim';
        if (f === 'y+') return 'paint';
        if (c.y < yb + 0.13 || c.y > yt - 0.12) return 'chrome';
        if (f[0] === 'x') return Q.lod < 2 && seams.some((q) => Math.abs(c.z - q) < 0.008) ? ['trim', 0.003] : 'paint';
        if (f === 'z-') { if (Math.abs(c.x) > bw - 0.07) return 'chrome'; if (Math.abs(c.x) < 0.012) return ['trim', 0.004]; }
        return 'paint';
      },
    });
    P.add('trim', ...rb(Q, 1.0, 0.18, z1 - z0, 0.01, 0, yb - 0.09, (z0 + z1) / 2));
    // Hecktüren: Scharniere, Verschlussstangen
    if (Q.lod < 2) for (const s of [-1, 1]) {
      for (const y of [yb + 0.45, (yb + yt) / 2, yt - 0.45]) P.add('chrome', ...rb(Q, 0.12, 0.08, 0.03, 0.01, s * (bw - 0.1), y, z0 - 0.015));
      for (const x of [0.25, 0.85]) {
        P.add('chrome', cylAB(V3(s * x, yb + 0.1, z0 - 0.03), V3(s * x, yt - 0.1, z0 - 0.03), 0.018, 0.018, Q.lod === 0 ? 8 : 4));
        if (Q.lod === 0) P.add('chrome', ...rb(Q, 0.18, 0.04, 0.03, 0.01, s * (x + 0.08), yb + 0.9, z0 - 0.045));
      }
    }
    // Beschriftung, Seitenmarkierungsleuchten
    for (const s of [-1, 1]) {
      decal(P, 'word', V3(s * (bw + 0.002), lerp(yb, yt, 0.62), (z0 + z1) / 2), V3(s, 0, 0), Math.min(3.6, (z1 - z0) * 0.6), Math.min(3.6, (z1 - z0) * 0.6) * 90 / 756);
      decal(P, 'extra', V3(s * (bw + 0.002), lerp(yb, yt, 0.32), (z0 + z1) / 2), V3(s, 0, 0), Math.min(3.4, (z1 - z0) * 0.55), Math.min(3.4, (z1 - z0) * 0.55) * 68 / 756);
      if (Q.lod < 2) for (let z = z0 + 0.6; z < z1 - 0.3; z += 2.0) lamp(P, Q, 'beacon', V3(s * (bw + 0.004), yb + 0.06, z), V3(s, 0, 0), 0.06, 0.03, { reflector: false });
    }
    decal(P, 'emblem', V3(0.6, yt - 0.5, z0 - 0.002), V3(0, 0, -1), 0.3, 0.3);
    // Unterfahrschutz hinten + Leuchten + Kennzeichen
    P.add('trim', ...rb(Q, 2.2, 0.14, 0.1, 0.02, 0, 0.55, z0 + 0.12));
    for (const s of [-1, 1]) { P.add('trim', ...rb(Q, 0.08, 0.6, 0.08, 0.01, s * 0.6, 0.86, z0 + 0.25)); const tp = V3(s * 0.88, 0.7, z0 + 0.06); lamp(P, Q, 'taillight', tp, V3(0, 0, -1), 0.3, 0.12); tails.push(tp); lamp(P, Q, 'beacon', V3(s * 1.1, 0.7, z0 + 0.06), V3(0, 0, -1), 0.1, 0.1); }
    plateUnit(P, V3(0, 0.7, z0 + 0.06), V3(0, 0, -1));
  };
  boxShell(bz0, bz1, boxBot, boxTop);
  // seitlicher Unterfahrschutz
  const guard = (za, zb) => { if (zb - za < 0.6) return; for (const s of [-1, 1]) for (const y of [0.55, 0.85]) P.add('trim', ...rb(Q, 0.04, 0.1, zb - za, 0.01, s * 1.2, y, (za + zb) / 2)); };
  const fw = wheelGeo(Q, { R: fR, W: fW, rimR, style: 'truck' }), dw = wheelGeo(Q, { R: fR, W: fW, rimR, style: 'truck', dual: true });
  const wheels = [{ x: wx, y: fR, z: zFa, R: fR, W: fW, front: true }];
  for (const s of [-1, 1]) { addWheel(P, fw, s * wx, fR, zFa, s); addWheel(P, dw, s * wx, fR, zRa, s); }
  wheels.push({ x: wx, y: fR, z: zRa, R: fR, W: fW });
  rearMud(zRa, 1);
  if (semi) {
    // Sattelkupplung, Auflieger-Achsen, Stützbeine
    P.add('trim', new THREE.CylinderGeometry(0.42, 0.42, 0.08, Q.lod === 0 ? 24 : 10), M4(0, 1.15, zRa + 0.3));
    const sw = wheelGeo(Q, { R: fR, W: 0.38, rimR, style: 'truck' });
    for (let k = 0; k < 3; k++) {
      const z = bz0 + 1.9 + k * 1.31;
      for (const s of [-1, 1]) addWheel(P, sw, s * 1.03, fR, z, s);
      wheels.push({ x: 1.03, y: fR, z, R: fR, W: 0.38 });
    }
    rearMud(bz0 + 1.9 + 2.62, 3);
    for (const s of [-1, 1]) {
      P.add('trim', ...rb(Q, 0.12, 0.9, 0.12, 0.01, s * 0.95, 0.65, bz1 - 2.3));
      P.add('trim', ...rb(Q, 0.25, 0.05, 0.3, 0.01, s * 0.95, 0.12, bz1 - 2.3));
      for (const zz of [[bz1 - 0.3, bz1 - 2.0], [bz1 - 2.5, bz0 + 1.9 + 2.62 + 0.75]]) P.add('trim', ...rb(Q, 0.08, 0.2, zz[0] - zz[1], 0.01, s * 0.45, 1.12, (zz[0] + zz[1]) / 2));
    }
    if (Q.lod < 2) P.add('chrome', cylAB(V3(0.95, 0.9, bz1 - 2.3), V3(1.25, 0.9, bz1 - 2.3), 0.015, 0.015, 6));
    guard(bz1 - 2.6, bz0 + 1.9 + 2.62 + 0.75);
    // Rückleuchten der Zugmaschine am Rahmenende
    for (const s of [-1, 1]) lamp(P, Q, 'taillight', V3(s * 0.75, 0.8, railEnd - 0.02), V3(0, 0, -1), 0.2, 0.1);
  } else guard(zRa + fR + 0.45, zFa - fR - 0.55);
  return {
    P, marks: { head: heads, tail: tails, beacon: [] },
    dims: { length: L, width: 2 * 1.27, height: boxTop, wheelbase: zFa - zRa, zMin: zr, zMax: zf + 0.04 },
    wheels, wear: { wheels: wheels.map((w) => ({ z: w.z, y: w.y, R: w.R })) },
  };
}

// =====================================================================
// Fahrzeug 4: Gabelstapler (VARENNE Lyft 25)
// =====================================================================
function buildForklift(Q) {
  const P = new Parts();
  const FW = { R: 0.3, W: 0.22, rimR: 0.17, x: 0.44, z: 0.55, y: 0.3 }, RW = { R: 0.23, W: 0.17, rimR: 0.13, x: 0.38, z: -0.78, y: 0.23 };
  const fine = Q.lod === 0 ? { m: 4, cell: 0.1 } : {};
  // Fahrgestell mit Radläufen
  shell(P, Q, {
    box: [-0.56, 0.16, -0.95, 0.56, 0.98, 0.74], r: { x: 0.06, y: [0.03, 0.07], z: 0.08 }, ...fine,
    arches: [{ z: FW.z, y: FW.y, r: FW.R + 0.05 }, { z: RW.z, y: RW.y, r: RW.R + 0.05 }],
    breaks: { y: [0.3, 0.33, 0.86, 0.9] },
    cls: (f, c) => { if (f === 'y-') return 'trim'; if (f[0] === 'x' && (c.y < 0.3 || (c.y > 0.86 && c.y < 0.9))) return 'trim'; return 'paint'; },
  });
  for (const w of [FW, RW]) P.add('trim', wheelhouse(w.z, w.y, w.R + 0.05, -0.55, 0.55, Q.lod === 0 ? 14 : 6));
  // Gegengewicht (abgerundet, mit Leuchten-Aussparungen)
  shell(P, Q, {
    box: [-0.57, 0.14, -1.34, 0.57, 1.14, -0.84], r: { x: 0.14, y: [0.04, 0.16], z: [0.22, 0.04] }, ...fine,
    breaks: { x: [0.3, 0.46, -0.3, -0.46], y: [0.88, 1.0, 0.3, 0.42] },
    cls: (f, c) => {
      const ax = Math.abs(c.x);
      if (f === 'y-') return 'trim';
      if (f === 'z-' && ax > 0.3 && ax < 0.46 && c.y > 0.88 && c.y < 1.0) return ['taillight', 0.012];
      if (f === 'z-' && ax < 0.12 && c.y > 0.3 && c.y < 0.42) return ['trim', 0.03];
      return c.y < 0.3 ? 'trim' : 'paint';
    },
  });
  decal(P, 'extra', V3(0, 0.64, -1.342), V3(0, 0, -1), 0.9, 0.081);
  for (const s of [-1, 1]) { decal(P, 'word', V3(s * 0.572, 0.62, -0.55), V3(s, 0, 0), 0.6, 0.071); decal(P, 'model', V3(s * 0.572, 0.5, -0.55), V3(s, 0, 0), 0.4, 0.037); }
  decal(P, 'emblem', V3(0, 0.95, -1.3), V3(0, 0.3, -1), 0.14, 0.14);
  // Treibgas-Flasche
  P.add('chrome', cylAB(V3(-0.36, 1.38, -1.06), V3(0.36, 1.38, -1.06), 0.17, 0.17, Q.lod === 0 ? 24 : 8));
  for (const s of [-1, 1]) P.add('chrome', new THREE.SphereGeometry(0.17, Q.lod === 0 ? 16 : 6, Q.lod === 0 ? 8 : 4, 0, Math.PI), M4(s * 0.36, 1.38, -1.06, 0, s * Math.PI / 2, 0));
  if (Q.lod < 2) { for (const x of [-0.22, 0.22]) P.add('trim', sweep([V3(x, 1.14, -0.92), V3(x, 1.3, -0.86), V3(x, 1.56, -0.98), V3(x, 1.58, -1.12), V3(x, 1.3, -1.25), V3(x, 1.14, -1.24)], rectProf(0.04, 0.012))); P.add('chrome', cylAB(V3(0.38, 1.38, -1.06), V3(0.46, 1.42, -1.06), 0.03, 0.03, 8)); }
  // Haube unter dem Sitz, Sitz, Lenkung, Armaturen
  shell(P, Q, { box: [-0.44, 0.97, -0.78, 0.44, 1.12, 0.1], r: { x: 0.05, y: [0.01, 0.05], z: 0.06 }, slot: 'paint', skip: ['y-'], ...fine });
  if (Q.lod < 2) {
    P.add('interior', ...rb(Q, 0.48, 0.1, 0.44, 0.04, 0, 1.17, -0.4));
    P.add('interior', ...rb(Q, 0.48, 0.5, 0.1, 0.04, 0, 1.45, -0.66, -0.2));
    P.add('trim', ...rb(Q, 0.9, 0.3, 0.3, 0.04, 0, 1.02, 0.6));
    P.add('interior', ...rb(Q, 0.5, 0.22, 0.22, 0.04, 0, 1.22, 0.55, -0.4));
    P.add('interior', cylAB(V3(0, 1.2, 0.48), V3(0, 1.55, 0.28), 0.03, 0.03, 8));
    P.add('interior', new THREE.TorusGeometry(0.16, 0.014, Q.lod === 0 ? 8 : 4, Q.lod === 0 ? 28 : 12), M4(0, 1.56, 0.27, -1.0));
    for (let i = 0; i < 3; i++) P.add('trim', cylAB(V3(0.18 + i * 0.06, 1.2, 0.58), V3(0.18 + i * 0.06, 1.38, 0.52), 0.01, 0.01, 5));
  }
  // Fahrerschutzdach
  const gy = 2.12;
  for (const s of [-1, 1]) {
    P.add('trim', sweep([V3(s * 0.47, 0.98, 0.46), V3(s * 0.47, gy - 0.05, 0.3), V3(s * 0.47, gy, 0.22)], rectProf(0.06, 0.05)));
    P.add('trim', sweep([V3(s * 0.47, 1.1, -0.86), V3(s * 0.47, gy - 0.05, -0.74), V3(s * 0.47, gy, -0.72)], rectProf(0.06, 0.05)));
    P.add('trim', ...rb(Q, 0.06, 0.06, 1.0, 0.012, s * 0.47, gy, -0.25));
  }
  for (const z of [0.22, -0.72]) P.add('trim', ...rb(Q, 1.0, 0.06, 0.06, 0.012, 0, gy, z));
  if (Q.lod < 2) for (let i = 0; i < 7; i++) P.add('trim', ...rb(Q, 0.9, 0.012, 0.05, 0.004, 0, gy + 0.02, lerp(0.12, -0.62, i / 6)));
  P.add('glass', new THREE.BoxGeometry(0.88, 0.008, 0.88), M4(0, gy + 0.034, -0.25)); // Dachscheibe (Polycarbonat)
  const heads = [];
  for (const s of [-1, 1]) { const p = V3(s * 0.47, 1.8, 0.37); lamp(P, Q, 'headlight', p, V3(0, 0, 1), 0.11, 0.11, { round: true }); heads.push(p); }
  const tails = [V3(0.38, 0.94, -1.35), V3(-0.38, 0.94, -1.35)];
  if (Q.lod === 2) for (const t of tails) lamp(P, Q, 'taillight', t, V3(0, 0, -1), 0.14, 0.1);
  lamp(P, Q, 'headlight', V3(0.4, gy - 0.02, -0.76), V3(0, -0.2, -1), 0.1, 0.06);
  beaconUnit(P, Q, -0.35, gy + 0.03, -0.66, 0.06);
  // Hubmast
  const mz = 0.86, mh = 2.28;
  for (const s of [-1, 1]) {
    P.add('trim', ...rb(Q, 0.08, mh, 0.13, 0.01, s * 0.34, 0.1 + mh / 2, mz));
    P.add('trim', ...rb(Q, 0.07, mh - 0.06, 0.1, 0.01, s * 0.25, 0.14 + (mh - 0.06) / 2, mz + 0.06));
    P.add('trim', cylAB(V3(s * 0.44, 0.84, 0.62), V3(s * 0.36, 1.02, mz - 0.05), 0.04, 0.04, 8));
    P.add('chrome', cylAB(V3(s * 0.4, 0.93, 0.72), V3(s * 0.36, 1.02, mz - 0.05), 0.02, 0.02, 6));
    if (Q.lod === 1) P.add('trim', ...rb(Q, 0.03, 1.9, 0.02, 0.005, s * 0.12, 1.2, mz + 0.1));
    if (Q.lod === 0) {
      const link = new THREE.TorusGeometry(0.022, 0.006, 5, 10).scale(1, 1.6, 1);
      for (let i = 0; i < 44; i++) P.add('trim', link.clone(), M4(s * 0.12, 0.28 + i * 0.043, mz + 0.1, 0, i % 2 ? Math.PI / 2 : 0, 0));
      link.dispose();
      const hose = new THREE.CatmullRomCurve3([V3(s * 0.2, 0.9, 0.7), V3(s * 0.2, 1.3, mz - 0.06), V3(s * 0.19, 2.15, mz - 0.04), V3(s * 0.17, 2.3, mz + 0.05), V3(s * 0.16, 1.9, mz + 0.06), V3(s * 0.2, 0.62, mz + 0.12)]).getPoints(60);
      P.add('trim', sweep(hose, circProf(0.012, 8)));
    }
  }
  for (const y of [0.35, 1.3, 2.32]) P.add('trim', ...rb(Q, 0.76, 0.08, 0.1, 0.01, 0, y, mz));
  P.add('trim', cylAB(V3(0, 0.12, mz - 0.03), V3(0, 1.35, mz - 0.03), 0.05, 0.05, Q.lod === 0 ? 12 : 6));
  P.add('chrome', cylAB(V3(0, 1.35, mz - 0.03), V3(0, 2.2, mz - 0.03), 0.028, 0.028, Q.lod === 0 ? 10 : 6));
  // Gabelträger, Lastschutzgitter, Gabeln
  P.add('trim', ...rb(Q, 1.04, 0.1, 0.06, 0.01, 0, 0.18, mz + 0.14));
  P.add('trim', ...rb(Q, 1.04, 0.1, 0.06, 0.01, 0, 0.52, mz + 0.14));
  if (Q.lod < 2) for (let i = 0; i < 7; i++) P.add('trim', ...rb(Q, 0.025, 0.8, 0.03, 0.006, lerp(-0.48, 0.48, i / 6), 0.95, mz + 0.14));
  P.add('trim', ...rb(Q, 1.04, 0.04, 0.04, 0.008, 0, 1.35, mz + 0.14));
  for (const s of [-1, 1]) {
    P.add('trim', ...rb(Q, 0.12, 0.55, 0.045, 0.008, s * 0.3, 0.33, mz + 0.2));
    P.add('trim', extrudeSide([[mz + 0.18, 0.06], [mz + 1.3, 0.06], [mz + 1.34, 0.075], [mz + 1.3, 0.105], [mz + 0.18, 0.105]], 0.12), M4(s * 0.3));
  }
  // Räder
  const fw = wheelGeo(Q, { R: FW.R, W: FW.W, rimR: FW.rimR, style: 'small' }), rw = wheelGeo(Q, { R: RW.R, W: RW.W, rimR: RW.rimR, style: 'small' });
  for (const s of [-1, 1]) { addWheel(P, fw, s * FW.x, FW.y, FW.z, s); addWheel(P, rw, s * RW.x, RW.y, RW.z, s); }
  return {
    P, marks: { head: heads, tail: tails, beacon: [V3(-0.35, gy + 0.15, -0.66)] },
    dims: { length: mz + 1.34 + 1.34, width: 1.14, height: gy + 0.2, wheelbase: FW.z - RW.z, zMin: -1.34, zMax: mz + 1.34 },
    wheels: [{ ...FW, front: true }, RW], wear: { wheels: [FW, RW] },
  };
}

// =====================================================================
// Fahrzeug 5: ausgebrannter Schützenpanzer (fiktiv, markenlos)
// =====================================================================
function transfer(P, T, m) { for (const [slot, arr] of Object.entries(T.list)) for (const g of arr) P.add(slot, g, m); }
function trackPath(Q, side, broken) {
  const pts = [[-2.5, 0.035], [-0.6, 0.035], [1.2, 0.035], [2.25, 0.04], [2.72, 0.3], [2.98, 0.72], [2.88, 1.03], [2.55, 1.14], [1.3, 1.16], [0, 1.13], [-1.3, 1.16], [-2.62, 1.08], [-3.22, 0.82], [-3.24, 0.52], [-2.95, 0.16]];
  const curve = new THREE.CatmullRomCurve3(pts.map(([z, y]) => V3(0, y, z)), true, 'centripetal');
  const n = Math.round(curve.getLength() / 0.155);
  const sp = curve.getSpacedPoints(n).slice(0, n);
  return sp.map((p, i) => {
    const t = curve.getTangentAt(i / n), nrm = V3(0, -t.z, t.y);
    if (nrm.dot(V3(0, p.y - 0.6, p.z + 0.1)) < 0) nrm.negate();
    return { p: p.clone().setX(side), n: nrm };
  }).filter((s) => !broken || !(s.p.y > 0.6 && s.p.z < 0.9));
}
function buildMilwreck(Q) {
  const P = new Parts(), R = rng(31337);
  // Wanne unten (zwischen den Ketten) und oben (über den Ketten, Bugplatte geneigt)
  shell(P, Q, {
    box: [-1.0, 0.45, -3.15, 1.0, 1.3, 2.95], r: 0.04, skip: ['y+'],
    deform: (p) => { if (p.z > 2.2) p.y += (p.z - 2.2) * 0.55 * (1.3 - p.y) / 0.85; },
    cls: (f) => (f === 'y-' ? 'trim' : 'paint'),
  });
  const glacis = (p) => { if (p.z > 1.1) p.y -= (p.z - 1.1) * 0.36 * clamp((p.y - 1.18) / 0.72, 0, 1); p.x *= 1 - 0.05 * clamp((p.y - 1.18) / 0.72, 0, 1); return p; };
  shell(P, Q, {
    box: [-1.55, 1.18, -3.25, 1.55, 1.9, 2.78], r: { x: 0.04, y: [0.02, 0.05], z: 0.05 },
    breaks: { x: [-0.45, 0.45, -0.44, 0.44, 0.75, 1.25], y: [1.32, 1.75, 1.76], z: [-0.4, 0.4, 1.3, 2.0, 0.6, 0.1] },
    deform: (p) => glacis(p),
    cls: (f, c) => {
      if (f === 'y-') return 'trim';
      if (f === 'z-' && Math.abs(c.x) < 0.45 && c.y > 1.32 && c.y < 1.76) return Math.abs(c.x) > 0.44 ? ['trim', 0.01] : ['paint', 0.006];
      if (f === 'y+' && c.x > 0.75 && c.x < 1.25 && c.z > 1.3 && c.z < 2.0) return ['trim', 0.03];
      if (f === 'y+' && Math.abs(c.x) < 0.45 && c.z > -0.4 && c.z < 0.4) return null; // Turmdrehkranz
      return 'paint';
    },
  });
  P.add('trim', new THREE.CylinderGeometry(0.62, 0.62, 0.06, Q.lod === 0 ? 32 : 12, 1, true), M4(0, 1.88, 0));
  if (Q.lod < 2) for (let i = 0; i < (Q.lod === 0 ? 9 : 4); i++) P.add('trim', ...rb(Q, 0.5, 0.02, 0.04, 0.005, 1.0, 1.91, lerp(1.35, 1.95, (i + 0.5) / (Q.lod === 0 ? 9 : 4))));
  // Heckklappe (Scharniere), Bugleuchten mit Schutzbügeln, Rückleuchten, Abschlepphaken
  const heads = [], tails = [];
  for (const s of [-1, 1]) {
    const hp = glacis(V3(s * 1.15, 1.55, 2.55));
    lamp(P, Q, 'headlight', hp.clone().add(V3(0, 0.08, 0.02)), V3(0, 0.3, 1), 0.12, 0.12, { round: true }); heads.push(hp);
    if (Q.lod < 2) P.add('trim', sweep([hp.clone().add(V3(-0.12, 0, -0.05)), hp.clone().add(V3(-0.12, 0.12, 0.12)), hp.clone().add(V3(0.12, 0.12, 0.12)), hp.clone().add(V3(0.12, 0, -0.05))], circProf(0.012, 5)));
    const tp = V3(s * 1.2, 1.6, -3.25); lamp(P, Q, 'taillight', tp, V3(0, 0, -1), 0.1, 0.08); tails.push(tp);
    if (Q.lod < 2) {
      P.add('trim', new THREE.TorusGeometry(0.09, 0.025, 6, 12), M4(s * 0.7, 0.75, 3.0, 0, Math.PI / 2, 0));
      P.add('trim', new THREE.TorusGeometry(0.09, 0.025, 6, 12), M4(s * 0.7, 0.75, -3.2, 0, Math.PI / 2, 0));
      P.add('chrome', ...rb(Q, 0.08, 0.14, 0.05, 0.01, s * 0.45, 1.68, -3.27));
    }
  }
  // Ersatz-Kettenglieder auf der Bugplatte, Werkzeug
  if (Q.lod < 2) for (let i = 0; i < 5; i++) { const q = glacis(V3(-0.55 + i * 0.16, 1.82, 1.9)); P.add('trim', ...rb(Q, 0.13, 0.04, 0.46, 0.01, q.x, q.y + 0.03, q.z, 0.36, 0, 0)); }
  // Laufwerk: Laufrollen, Treibrad, Leitrad, Stützrollen, Kettenglieder
  const rw = wheelGeo(Q, { R: 0.34, W: 0.15, rimR: 0.29, style: 'road', dual: true, seg: Math.max(10, Q.wheelSeg / 2) });
  const wheels = [];
  for (const s of [-1, 1]) for (let k = 0; k < 6; k++) { const z = 2.0 - k * 0.86; addWheel(P, rw, s * 1.26, 0.4, z, s, 'trim'); wheels.push({ x: 1.26, y: 0.4, z, R: 0.34, W: 0.32 }); }
  const sprocket = (s, z, y, r) => {
    P.add('trim', cylAB(V3(s * 1.0, y, z), V3(s * 1.36, y, z), r * 0.85, r * 0.85, Q.lod === 0 ? 20 : 8));
    if (Q.lod < 2) for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; P.add('trim', ...rb(Q, 0.08, 0.07, 0.06, 0.01, s * 1.12, y + Math.sin(a) * r, z + Math.cos(a) * r, a)); P.add('trim', ...rb(Q, 0.08, 0.07, 0.06, 0.01, s * 1.28, y + Math.sin(a) * r, z + Math.cos(a) * r, a)); }
  };
  for (const s of [-1, 1]) {
    sprocket(s, 2.72, 0.78, 0.3); sprocket(s, -2.98, 0.68, 0.28);
    for (const z of [1.3, 0, -1.3]) P.add('trim', cylAB(V3(s * 1.05, 1.06, z), V3(s * 1.4, 1.06, z), 0.08, 0.08, Q.lod === 0 ? 14 : 6));
    const broken = s < 0, path = trackPath(Q, s * 1.2, broken);
    if (Q.lod === 2) {
      // Kette als Band
      const pts = path.filter((_, i) => i % 3 === 0).map((q) => q.p);
      P.add('trim', sweep([...pts, pts[0]], rectProf(0.46, 0.05, 0.1).filter((_, i) => i % 2 === 0), { up: XAX }));
    } else {
      const shoe = roundedBox(0.46, 0.05, 0.13, 0.012, Q.lod === 0 ? 2 : 1), horn = Q.lod === 0 ? roundedBox(0.04, 0.08, 0.09, 0.008, 1) : null;
      const put = (p, n, wob = 0) => {
        const t = XAX.clone().cross(n).normalize(), m = new THREE.Matrix4().makeBasis(XAX, n, t).setPosition(p);
        if (wob) m.multiply(M4(0, 0, 0, 0, wob, 0));
        P.add('trim', shoe.clone(), m);
        if (horn) P.add('trim', horn.clone(), m.clone().multiply(M4(0, -0.05, 0)));
      };
      for (const q of path) put(q.p, q.n);
      if (broken) for (let i = 0; i < 16; i++) { const z = -3.45 - i * 0.155, wob = Math.sin(i * 0.4) * 0.12; put(V3(s * (1.25 + i * 0.03), 0.026, z), V3(0, 1, 0), wob); }
      shoe.dispose(); horn?.dispose();
    }
    // Kettenschürzen (rechts eine Platte abgerissen)
    for (let k = 0; k < 4; k++) {
      if (s < 0 && k === 1) continue;
      P.add('paint', ...rb(Q, 0.03, 0.45, 1.45, 0.01, s * 1.56, 1.1, 2.15 - k * 1.5));
    }
  }
  // abgerissene Schürze und Trümmer am Boden
  P.add('paint', ...rb(Q, 1.45, 0.03, 0.45, 0.01, -2.3, 0.03, 0.9, 0.05, 0.4, 0));
  if (Q.lod < 2) for (let i = 0; i < 9; i++) {
    const a = R() * Math.PI * 2, d = 2.4 + R() * 1.4;
    P.add(R() < 0.5 ? 'trim' : 'paint', ...rb(Q, 0.15 + R() * 0.4, 0.02 + R() * 0.03, 0.1 + R() * 0.35, 0.005, Math.cos(a) * d * 0.7, 0.02, Math.sin(a) * d, (R() - 0.5) * 0.3, R() * 3, 0));
  }
  // Turm (verdreht), Rohr gesenkt, Lukendeckel abgerissen
  const T = new Parts();
  const tur = (p) => { const t = clamp((p.y - 1.88) / 0.55, 0, 1); p.x *= 1 - 0.2 * t; if (p.z > 0.3) p.y -= (p.z - 0.3) * 0.35 * t; return p; };
  shell(T, Q, { box: [-0.85, 1.88, -1.15, 0.85, 2.43, 0.78], r: { x: 0.04, y: [0.02, 0.06], z: 0.06 }, deform: tur, breaks: { x: [0.2, 0.6], z: [-0.6, -0.15] }, cls: (f, c) => (f === 'y-' ? 'trim' : f === 'y+' && c.x > 0.2 && c.x < 0.6 && c.z > -0.6 && c.z < -0.15 ? null : 'paint') });
  T.add('trim', new THREE.TorusGeometry(0.2, 0.035, 6, Q.lod === 0 ? 20 : 8).rotateX(Math.PI / 2), M4(0.4, 2.44, -0.375));
  T.add('trim', ...rb(Q, 0.42, 0.36, 0.3, 0.04, 0, 2.15, 0.88));
  T.add('chrome', cylAB(V3(0, 2.15, 0.95), V3(0, 1.62, 2.95), 0.06, 0.05, Q.lod === 0 ? 14 : 6));
  T.add('chrome', cylAB(V3(0, 1.625, 2.93), V3(0, 1.58, 3.1), 0.075, 0.075, Q.lod === 0 ? 14 : 6));
  T.add('chrome', cylAB(V3(0.25, 2.12, 1.0), V3(0.25, 2.0, 1.6), 0.025, 0.02, 8));
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) T.add('chrome', cylAB(V3(s * 0.72, 2.0 + i * 0.07, 0.55), V3(s * 0.84, 2.06 + i * 0.07, 0.78), 0.035, 0.035, Q.lod === 0 ? 10 : 5));
  for (const [x, z] of [[-0.55, 0.6], [0.55, -0.9], [-0.3, -1.0]]) { T.add('glass', ...rb(Q, 0.16, 0.08, 0.12, 0.01, x, 2.43, z)); T.add('trim', ...rb(Q, 0.2, 0.06, 0.16, 0.01, x, 2.38, z)); }
  if (Q.lod < 2) T.add('interior', ...rb(Q, 0.5, 0.35, 0.5, 0.04, 0.1, 2.05, -0.5));
  const yaw = 0.55, m = new THREE.Matrix4().makeRotationY(yaw).premultiply(new THREE.Matrix4().makeTranslation(0.08, 0, -0.15));
  transfer(P, T, m);
  P.add('trim', new THREE.CylinderGeometry(0.21, 0.21, 0.04, 16), M4(1.95, 0.04, -1.5, 0.08, 0.4, 0.06));
  // Bug-Periskope (Fahrer), ausgebrannter Innenraum durch die Luke sichtbar
  for (const x of [-0.3, 0, 0.3]) { const q = glacis(V3(x - 0.55, 1.9, 1.15)); P.add('glass', ...rb(Q, 0.15, 0.07, 0.1, 0.01, q.x, q.y + 0.02, q.z)); }
  P.add('interior', ...rb(Q, 1.6, 0.4, 3.0, 0.04, 0, 0.95, -1.5));
  // Markierungen (verblasst)
  for (const s of [-1, 1]) { decal(P, 'emblem', V3(s * 1.553, 1.55, -1.9), V3(s, 0, 0), 0.32, 0.32); decal(P, 'word', V3(s * 1.553, 1.55, -1.1), V3(s, 0, 0), 0.6, 0.071); }
  return {
    P, marks: { head: heads, tail: tails, beacon: [] },
    dims: { length: 3.1 + 3.27, width: 3.12, height: 2.46, wheelbase: 4.3, zMin: -3.27, zMax: 3.1, uvLayout: 'split' },
    wheels, wear: { wheels: [] },
  };
}

// =====================================================================
// Fahrzeug 6: Mähdrescher (AGRION Messor 7)
// =====================================================================
function buildCombine(Q) {
  const P = new Parts();
  const FW = { R: 0.86, W: 0.62, rimR: 0.48, x: 1.4, z: 1.05, y: 0.86 }, RW = { R: 0.56, W: 0.42, rimR: 0.33, x: 1.15, z: -2.55, y: 0.56 };
  // Grundkörper
  shell(P, Q, {
    box: [-1.02, 0.85, -3.62, 1.02, 3.05, 1.55], r: { x: 0.06, y: [0.03, 0.06], z: 0.08 },
    breaks: { y: [1.0, 1.1, 1.112, 2.6, 2.612, 2.0, 2.9], z: [-3.3, -2.3, -1.6, -1.588, -0.2, -0.188, 1.2, 1.212, -3.0, -2.6] },
    cls: (f, c) => {
      if (f === 'y-') return 'trim';
      if (f[0] === 'x') {
        if (c.y < 1.0) return 'trim';
        if (f === 'x+' && c.z > -3.3 && c.z < -2.3 && c.y > 2.0 && c.y < 2.9) return ['trim', Q.lod < 2 ? 0.02 : 0];
        if (Q.lod < 2 && c.y > 1.1 && c.y < 2.612 && c.z > -1.6 && c.z < 1.212 && (c.y < 1.112 || c.y > 2.6 || Math.abs(c.z + 1.594) < 0.006 || Math.abs(c.z + 0.194) < 0.006 || Math.abs(c.z - 1.206) < 0.006)) return ['trim', 0.006];
      }
      if (f === 'z-' && c.y < 1.6) return 'trim';
      return 'paint';
    },
  });
  if (Q.lod < 2) { P.add('trim', new THREE.CircleGeometry(0.42, Q.lod === 0 ? 32 : 12), M4(1.005, 2.45, -2.8, 0, Math.PI / 2, 0)); P.add('chrome', new THREE.TorusGeometry(0.42, 0.02, 6, Q.lod === 0 ? 32 : 12), M4(1.01, 2.45, -2.8, 0, Math.PI / 2, 0)); }
  for (const s of [-1, 1]) { decal(P, 'word', V3(s * 1.022, 1.85, -0.4), V3(s, 0, 0), 1.6, 0.19); decal(P, 'model', V3(s * 1.022, 1.55, -0.4), V3(s, 0, 0), 1.2, 0.111); }
  // Motorhaube hinten, Auspuff
  shell(P, Q, { box: [-1.1, 3.0, -3.7, 1.1, 3.38, -1.6], r: { x: 0.1, y: [0.01, 0.12], z: 0.1 }, skip: ['y-'], cls: (f, c) => (f === 'y+' && c.z < -2.2 && c.z > -3.3 && Math.abs(c.x) < 0.6 ? ['trim', 0.015] : 'paint'), breaks: { x: [-0.6, 0.6], z: [-3.3, -2.2] } });
  P.add('trim', cylAB(V3(-0.75, 3.3, -2.0), V3(-0.75, 3.95, -2.0), 0.07, 0.07, Q.lod === 0 ? 14 : 6));
  // Korntank (oben ausgestellt) mit Klappdeckel
  shell(P, Q, {
    box: [-1.32, 3.0, -1.6, 1.32, 3.92, 1.42], r: { x: 0.05, y: [0.02, 0.04], z: 0.05 }, skip: ['y-'],
    breaks: { x: [-1.2, 1.2], z: [-1.48, 1.3], y: [3.3, 3.6] },
    deform: (p) => { p.x *= 1 + 0.12 * clamp((p.y - 3.0) / 0.92, 0, 1); },
    cls: (f, c) => {
      if (f === 'y+') return Math.abs(c.x) < 1.2 && c.z > -1.48 && c.z < 1.3 ? ['trim', 0.02] : 'paint';
      if (f === 'z+' && Math.abs(c.x) < 0.6 && c.y > 3.3 && c.y < 3.6) return ['glass', 0.01];
      return 'paint';
    },
  });
  if (Q.lod < 2) for (let i = 0; i < (Q.lod === 0 ? 10 : 4); i++) P.add('trim', ...rb(Q, 2.4, 0.02, 0.04, 0.005, 0, 3.92, lerp(-1.4, 1.2, (i + 0.5) / (Q.lod === 0 ? 10 : 4))));
  // Kabine
  const cz0 = 1.45, cz1 = 2.78, cy0 = 2.15, cy1 = 3.55;
  shell(P, Q, {
    box: [-0.82, cy0, cz0, 0.82, cy1, cz1], r: { x: 0.06, y: 0.03, z: 0.06 }, skip: ['y+'],
    breaks: { x: paneBreaks(-0.76, 0.76), y: [2.3, 2.325, 3.475, 3.5], z: paneBreaks(1.6, 2.72) },
    deform: (p, raw) => { const w = sstep(cz1 - 0.6, cz1, raw.z); p.z += 0.14 * w * (1 - (p.x / 0.82) ** 2) * sstep(cy0, cy0 + 0.5, p.y); },
    cls: (f, c) => {
      if (f === 'y-') return 'trim';
      if (f === 'z+') return pane(c, 'x', 'y', -0.76, 0.76, 2.3, 3.5) || 'trim';
      if (f[0] === 'x') return pane(c, 'z', 'y', 1.6, 2.72, 2.3, 3.5) || 'trim';
      return 'paint';
    },
  });
  shell(P, Q, { box: [-0.98, 3.52, 1.3, 0.98, 3.74, 2.95], r: { x: 0.1, y: [0.02, 0.08], z: 0.12 }, cls: (f) => (f === 'y-' ? 'trim' : 'paint') });
  const heads = [];
  for (const x of [-0.75, -0.45, -0.15, 0.15, 0.45, 0.75]) { const p = V3(x, 3.7, 2.96); lamp(P, Q, 'headlight', p, V3(0, -0.2, 1), 0.13, 0.08); heads.push(p); }
  beaconUnit(P, Q, 0.8, 3.74, 1.45); beaconUnit(P, Q, -0.8, 3.74, 1.45);
  for (const s of [-1, 1]) mirror(P, Q, V3(s * 0.9, 3.3, 2.7), V3(s * 1.35, 3.15, 2.9), 0.22, 0.36);
  if (Q.lod < 2) {
    P.add('interior', ...rb(Q, 0.5, 0.12, 0.48, 0.04, 0, 2.62, 1.95));
    P.add('interior', ...rb(Q, 0.5, 0.6, 0.12, 0.04, 0, 2.95, 1.7, -0.15));
    P.add('interior', new THREE.TorusGeometry(0.18, 0.015, 6, 24), M4(0, 2.9, 2.4, -1.1));
    P.add('interior', ...rb(Q, 0.16, 0.14, 0.5, 0.03, 0.32, 2.75, 2.0));
  }
  // Plattform + Leiter links
  P.add('trim', ...rb(Q, 0.55, 0.05, 1.4, 0.01, 1.1, 2.15, 2.1));
  if (Q.lod < 2) {
    for (const z of [1.45, 2.78]) P.add('chrome', cylAB(V3(1.36, 2.17, z), V3(1.36, 3.1, z), 0.02, 0.02, 6));
    P.add('chrome', cylAB(V3(1.36, 3.1, 1.45), V3(1.36, 3.1, 2.78), 0.02, 0.02, 6));
    for (const s of [0, 1]) P.add('trim', cylAB(V3(1.3 + s * 0.0, 0.4, 3.05 - s * 0), V3(1.3, 2.15, 2.6), 0.02, 0.02, 6).translate(0, 0, s * -0.4));
    for (let i = 0; i < 6; i++) { const t = (i + 0.5) / 6; P.add('trim', ...rb(Q, 0.06, 0.025, 0.42, 0.005, 1.3, lerp(0.4, 2.15, t), lerp(3.05, 2.6, t) - 0.2)); }
  }
  // Schrägförderer (geneigt) und Schneidwerk
  shell(P, Q, { box: [-0.62, 0.72, 1.5, 0.62, 1.5, 3.25], r: 0.05, skip: ['z-'], deform: (p) => { p.y -= (p.z - 1.5) * 0.22; }, slot: 'paint' });
  const hw = 3.05, hz0 = 3.2, hz1 = 4.88;
  P.add('paint', extrudeSide([[hz1, 0.1], [hz1 - 0.06, 0.16], [hz0 + 0.3, 0.2], [hz0 + 0.1, 0.36], [hz0, 1.2], [hz0 + 0.25, 1.32], [hz0 + 0.27, 1.28], [hz0 + 0.06, 1.18], [hz0 + 0.14, 0.38], [hz0 + 0.32, 0.24], [hz1 - 0.1, 0.13], [hz1 - 0.02, 0.08]], 2 * hw, Q.lod === 0 ? 0.01 : 0, 1));
  for (const s of [-1, 1]) {
    P.add('paint', extrudeSide([[hz0, 0.12], [hz1, 0.08], [hz1 - 0.3, 0.55], [hz0 + 0.5, 1.32], [hz0, 1.25]], 0.025), M4(s * (hw - 0.012)));
    P.add('trim', new THREE.ConeGeometry(0.12, 0.7, Q.lod === 0 ? 12 : 5).rotateX(Math.PI / 2), M4(s * (hw - 0.05), 0.2, hz1 + 0.12));
  }
  P.add('chrome', ...rb(Q, 2 * hw - 0.1, 0.02, 0.08, 0.005, 0, 0.11, hz1 - 0.02));
  P.add('paint', cylAB(V3(-hw + 0.05, 0.5, 3.62), V3(hw - 0.05, 0.5, 3.62), 0.25, 0.25, Q.lod === 0 ? 20 : 8));
  if (Q.lod === 0) for (const s of [-1, 1]) {
    const pts = []; for (let i = 0; i <= 120; i++) { const t = i / 120, a = t * Math.PI * 2 * 7 * s; pts.push(V3(s * lerp(hw - 0.1, 0.5, t), 0.5 + Math.sin(a) * 0.3, 3.62 + Math.cos(a) * 0.3)); }
    P.add('trim', sweep(pts, rectProf(0.012, 0.1, 0.1), { up: XAX }));
  }
  // Haspel
  const rc = V3(0, 1.55, 4.15), rr = 0.58, nb = 5;
  P.add('trim', cylAB(V3(-hw + 0.1, rc.y, rc.z), V3(hw - 0.1, rc.y, rc.z), 0.07, 0.07, Q.lod === 0 ? 12 : 6));
  for (let b = 0; b < nb; b++) {
    const a = b / nb * Math.PI * 2 + 0.3, y = rc.y + Math.sin(a) * rr, z = rc.z + Math.cos(a) * rr;
    P.add('trim', cylAB(V3(-hw + 0.15, y, z), V3(hw - 0.15, y, z), 0.025, 0.025, Q.lod === 0 ? 8 : 4));
    for (const x of Q.lod < 2 ? [-hw + 0.3, 0, hw - 0.3] : []) P.add('trim', cylAB(V3(x, rc.y, rc.z), V3(x, y, z), 0.018, 0.018, 4));
    if (Q.lod === 0) for (let x = -hw + 0.25; x < hw - 0.2; x += 0.15) P.add('trim', cylAB(V3(x, y, z), V3(x, y - 0.3, z + 0.05), 0.005, 0.004, 4));
  }
  for (const s of [-1, 1]) {
    P.add('paint', sweep([V3(s * 2.85, 1.3, 3.25), V3(s * 2.9, 1.7, 3.6), V3(s * 2.95, rc.y + 0.05, rc.z)], rectProf(0.08, 0.12), { up: XAX }));
    if (Q.lod < 2) { P.add('trim', cylAB(V3(s * 2.8, 1.1, 3.3), V3(s * 2.8, 1.45, 3.9), 0.035, 0.035, 8)); }
  }
  // Abtankrohr (eingeklappt, links) mit Auslauf
  P.add('paint', cylAB(V3(1.32, 3.1, -1.2), V3(1.45, 3.6, 2.2), 0.15, 0.15, Q.lod === 0 ? 16 : 6));
  P.add('trim', cylAB(V3(1.45, 3.6, 2.2), V3(1.45, 3.25, 2.42), 0.12, 0.08, Q.lod === 0 ? 14 : 6));
  P.add('trim', ...rb(Q, 0.12, 0.6, 0.12, 0.01, 1.28, 2.75, 1.0));
  // Heck: Häcksler/Streuer, Leuchten, Kennzeichen
  shell(P, Q, { box: [-0.95, 0.75, -4.0, 0.95, 1.45, -3.58], r: 0.06, slot: 'trim' });
  const tails = [];
  for (const s of [-1, 1]) { const tp = V3(s * 0.85, 1.8, -3.625); lamp(P, Q, 'taillight', tp, V3(0, 0, -1), 0.12, 0.1); tails.push(tp); lamp(P, Q, 'beacon', V3(s * 0.85, 1.95, -3.625), V3(0, 0, -1), 0.08, 0.06); }
  plateUnit(P, V3(0, 1.72, -3.625), V3(0, 0, -1), 0.42);
  decal(P, 'emblem', V3(0, 2.6, -3.623), V3(0, 0, -1), 0.3, 0.3);
  // Achsen, Räder
  P.add('trim', cylAB(V3(-1.1, FW.y, FW.z), V3(1.1, FW.y, FW.z), 0.18, 0.18, Q.lod === 0 ? 18 : 8));
  P.add('trim', cylAB(V3(-0.95, RW.y + 0.1, RW.z), V3(0.95, RW.y + 0.1, RW.z), 0.1, 0.1, Q.lod === 0 ? 12 : 6));
  for (const s of [-1, 1]) {
    P.add('trim', cylAB(V3(s * 0.9, RW.y + 0.1, RW.z), V3(s * 0.9, 1.0, RW.z), 0.08, 0.08, 8));
    P.add('paint', arcSweep(s * FW.x, FW.y, FW.z, FW.R + 0.08, 0.35, 2.75, Q.lod === 0 ? 24 : Q.lod === 1 ? 10 : 5, [[0, -0.34], [0.03, -0.34], [0.03, 0.34], [0, 0.34]]));
  }
  const fw = wheelGeo(Q, { R: FW.R, W: FW.W, rimR: FW.rimR, style: 'agri', lug: 0.05 }), rw = wheelGeo(Q, { R: RW.R, W: RW.W, rimR: RW.rimR, style: 'agri', lug: 0.035 });
  for (const s of [-1, 1]) { addWheel(P, fw, s * FW.x, FW.y, FW.z, s); addWheel(P, rw, s * RW.x, RW.y, RW.z, s); }
  return {
    P, marks: { head: heads, tail: tails, beacon: [V3(0.8, 3.86, 1.45), V3(-0.8, 3.86, 1.45)] },
    dims: { length: hz1 + 0.24 + 4.0, width: 2 * hw, height: 3.95, wheelbase: FW.z - RW.z, zMin: -4.0, zMax: hz1 + 0.24 },
    wheels: [{ ...FW, front: true }, RW], wear: { wheels: [FW, RW] },
  };
}

// =====================================================================
// Texturen
// =====================================================================
function makeCanvas(w, h) {
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return new OffscreenCanvas(w, h);
}
function canvasTex(c, srgb, own = true) {
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.userData.own = own;
  return t;
}
const hex = (c) => '#' + new THREE.Color(c).getHexString();
// ---- Embleme (eigene Gestaltung) ----
function hexPath(g, cx, cy, R) { g.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); } g.closePath(); }
/** VARENNE: Sechseck, drei aufsteigende Bögen über Horizontlinie */
function emblemVarenne(g, cx, cy, R) {
  let gr = g.createLinearGradient(cx, cy - R, cx, cy + R);
  gr.addColorStop(0, '#f4f6f8'); gr.addColorStop(0.45, '#8a9096'); gr.addColorStop(0.55, '#c9ced3'); gr.addColorStop(1, '#6d7278');
  g.fillStyle = gr; hexPath(g, cx, cy, R); g.fill();
  gr = g.createRadialGradient(cx, cy - R * 0.3, R * 0.1, cx, cy, R * 0.9); gr.addColorStop(0, '#2d4d73'); gr.addColorStop(1, '#0d1726');
  g.fillStyle = gr; hexPath(g, cx, cy, R * 0.82); g.fill();
  g.strokeStyle = '#e6e9ec'; g.lineCap = 'round';
  for (let k = 0; k < 3; k++) { g.lineWidth = R * (0.1 - k * 0.018); g.beginPath(); g.arc(cx, cy + R * 0.28, R * (0.2 + k * 0.17), Math.PI * 1.12, Math.PI * 1.88); g.stroke(); }
  g.lineWidth = R * 0.07; g.beginPath(); g.moveTo(cx - R * 0.58, cy + R * 0.36); g.lineTo(cx + R * 0.58, cy + R * 0.36); g.stroke();
}
/** AGRION: Wappenschild, Keimling aus zwei Blättern über drei Ackerfurchen */
function emblemAgrion(g, cx, cy, R) {
  const shield = (s) => { g.beginPath(); g.moveTo(cx - R * s, cy - R * 0.85 * s); g.lineTo(cx + R * s, cy - R * 0.85 * s); g.lineTo(cx + R * s, cy + R * 0.1 * s); g.quadraticCurveTo(cx + R * 0.9 * s, cy + R * 0.75 * s, cx, cy + R * s); g.quadraticCurveTo(cx - R * 0.9 * s, cy + R * 0.75 * s, cx - R * s, cy + R * 0.1 * s); g.closePath(); };
  let gr = g.createLinearGradient(cx, cy - R, cx, cy + R); gr.addColorStop(0, '#f6e7a8'); gr.addColorStop(0.5, '#b8922e'); gr.addColorStop(1, '#e9cf73');
  g.fillStyle = gr; shield(1); g.fill();
  gr = g.createLinearGradient(cx, cy - R, cx, cy + R); gr.addColorStop(0, '#2c6a34'); gr.addColorStop(1, '#123018');
  g.fillStyle = gr; shield(0.84); g.fill();
  g.fillStyle = '#e8c65a'; g.strokeStyle = '#e8c65a'; g.lineCap = 'round';
  g.lineWidth = R * 0.07; g.beginPath(); g.moveTo(cx, cy + R * 0.22); g.quadraticCurveTo(cx - R * 0.04, cy - R * 0.1, cx, cy - R * 0.35); g.stroke();
  for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * R * 0.22, cy - R * 0.3, R * 0.25, R * 0.1, -s * 0.6, 0, Math.PI * 2); g.fill(); }
  g.lineWidth = R * 0.055;
  for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(cx, cy + R * (1.05 + k * 0.16), R * (0.75 + k * 0.05), Math.PI * 1.32, Math.PI * 1.68); g.stroke(); }
}
function spacedText(g, word, x, y, step) { for (let i = 0; i < word.length; i++) g.fillText(word[i], x + (i - (word.length - 1) / 2) * step, y); }
function fitText(g, text, x, y, maxW) { const w = g.measureText(text).width, k = Math.min(1, maxW / w); g.save(); g.translate(x, y); g.scale(k, 1); g.fillText(text, 0, 0); g.restore(); }
const ATLAS_CACHE = new Map();
function atlasTexture(type, variant, brand, model, plateText) {
  const key = [type, variant, brand, model, plateText].join('|');
  if (ATLAS_CACHE.has(key)) return ATLAS_CACHE.get(key);
  const c = makeCanvas(1024, 512), g = c.getContext('2d');
  g.fillStyle = '#1a1c1f'; g.fillRect(0, 0, 1024, 512);
  // Kennzeichen (fiktives Länderfeld „AE“)
  const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); };
  g.fillStyle = '#f3f2ec'; rr(4, 4, 1016, 212, 18); g.fill();
  g.lineWidth = 9; g.strokeStyle = '#141414'; rr(14, 14, 996, 192, 12); g.stroke();
  g.fillStyle = '#1e5a7a'; g.fillRect(19, 19, 96, 182);
  g.fillStyle = '#f3f2ec'; g.font = 'bold 44px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('AE', 67, 160);
  g.strokeStyle = '#e8c65a'; g.lineWidth = 4; g.beginPath(); g.arc(67, 78, 30, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#141414'; g.font = 'bold 150px "Arial Narrow", Arial, sans-serif';
  const tw = g.measureText(plateText).width, sx = Math.min(1, 860 / tw);
  g.save(); g.translate(566, 114); g.scale(sx, 1); g.fillText(plateText, 0, 0); g.restore();
  // Emblem
  if (brand === 'AGRION') emblemAgrion(g, 128, 384, 112);
  else if (brand === 'VARENNE') emblemVarenne(g, 128, 384, 112);
  else { // Wrack: verblasste taktische Markierung (fiktiv)
    g.fillStyle = '#2b2a24'; g.fillRect(10, 266, 236, 236);
    g.strokeStyle = 'rgba(225,222,210,0.8)'; g.lineWidth = 16; g.beginPath(); g.moveTo(40, 300); g.lineTo(128, 470); g.lineTo(216, 300); g.stroke();
  }
  // Schriftzug
  if (brand) {
    const gr = g.createLinearGradient(0, 262, 0, 352);
    if (brand === 'AGRION') { gr.addColorStop(0, '#fff6cf'); gr.addColorStop(0.5, '#e2c15a'); gr.addColorStop(1, '#f6e3a0'); g.fillStyle = '#16351c'; }
    else { gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, '#9aa0a6'); gr.addColorStop(1, '#e8eaec'); g.fillStyle = '#16181b'; }
    g.fillRect(262, 262, 756, 90);
    g.fillStyle = gr; g.font = '700 84px "Rajdhani", "Arial", sans-serif';
    spacedText(g, brand.toUpperCase(), 640, 309, brand.length > 6 ? 92 : 104);
    g.fillStyle = '#16181b'; g.fillRect(262, 362, 756, 70);
    g.fillStyle = '#e9e9e4'; g.font = '600 56px "Rajdhani", "Arial", sans-serif';
    spacedText(g, model.toUpperCase(), 640, 399, 40);
  } else {
    g.fillStyle = '#2b2a24'; g.fillRect(262, 262, 756, 170);
    g.fillStyle = 'rgba(225,222,210,0.75)'; g.font = 'bold 80px "Arial Narrow", Arial, sans-serif'; g.fillText('3 1 2', 640, 310);
  }
  // Zusatzfeld: Zielanzeige (Bus), Warnstreifen (Stapler) bzw. Logistik-Schriftzug
  if (type === 'bus') {
    g.fillStyle = '#0a0a0a'; g.fillRect(262, 440, 756, 68);
    g.fillStyle = '#ffa21c'; g.font = 'bold 54px "Arial Narrow", Arial, sans-serif'; g.textAlign = 'left'; g.fillText(variant === 'coach' ? 'SONDERFAHRT' : '24', 285, 476);
    g.textAlign = 'center'; if (variant !== 'coach') fitText(g, 'ZENTRUM  ·  OSTPARK', 690, 476, 600);
  } else if (type === 'forklift' || type === 'milwreck') {
    for (let x = 262 - 68; x < 1018; x += 48) { g.fillStyle = '#e8b818'; g.beginPath(); g.moveTo(x, 508); g.lineTo(x + 24, 508); g.lineTo(x + 92, 440); g.lineTo(x + 68, 440); g.closePath(); g.fill(); }
    g.fillStyle = '#121212'; g.globalCompositeOperation = 'destination-over'; g.fillRect(262, 440, 756, 68); g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 440, 262, 72); g.fillStyle = '#1a1c1f'; g.fillRect(0, 440, 262, 72); g.fillRect(1018, 440, 6, 72);
  } else {
    g.fillStyle = '#f2f2ee'; g.fillRect(262, 440, 756, 68);
    g.fillStyle = '#1c3f73'; g.font = '700 50px "Rajdhani", "Arial", sans-serif'; g.textAlign = 'center';
    fitText(g, type === 'truck' ? 'VARENNE LOGISTIK  ·  KÜHL & FRISCH' : `${brand || ''} SERVICE`, 640, 476, 720);
  }
  const t = canvasTex(c, true, false); t.anisotropy = 8;
  ATLAS_CACHE.set(key, t);
  return t;
}
// ---- Reifen (Normal-/Farb-Maps je Profil) ----
const TYRE_TEX = {};
function tyreTextures(kind) {
  if (TYRE_TEX[kind]) return TYRE_TEX[kind];
  const S = 256, hgt = new Float32Array(S * S), frac = (x) => x - Math.floor(x);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x + 0.5) / S, v = 1 - (y + 0.5) / S;
    let h = 0.6;
    if (v > 0.3 && v < 0.7) {
      if (kind === 'lug') {
        // Chevron-Stollen: zwei Reihen schräger Balken, versetzt
        const side = v < 0.5 ? -1 : 1, d = Math.abs(v - 0.5);
        const ph = frac(u + side * d * 1.1 + (side > 0 ? 0.5 : 0));
        h = ph < 0.3 && d > 0.015 ? 1 : 0.25;
      } else {
        h = 1;
        for (const gv of [0.4, 0.5, 0.6]) if (Math.abs(v - gv) < 0.011) h = 0.1;
        const sh = v < 0.4 || v > 0.6;
        if (sh && frac(u * 2 + (v - 0.5) * 1.2) < 0.13) h = 0.15;
        if (!sh && frac(u * 4 + (v - 0.5) * 2.5) < 0.05) h = 0.45;
      }
    } else {
      const d = v < 0.5 ? v : 1 - v;
      if (Math.abs(d - 0.12) < 0.012 || Math.abs(d - 0.2) < 0.006) h = 0.75;
      if (kind === 'lug' && d > 0.22 && frac(u * 3) < 0.04) h = 0.7;
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
    const c = 62 + H(x, y) * 110; iC.data[o] = c; iC.data[o + 1] = c; iC.data[o + 2] = c * 0.98; iC.data[o + 3] = 255;
  }
  gN.putImageData(iN, 0, 0); gC.putImageData(iC, 0, 0);
  const mk = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  return (TYRE_TEX[kind] = { normal: mk(cN, false), color: mk(cC, true), canvas: cC });
}
/** Reifen-Farbmap mit Schlamm/Staub (oder verbranntem Gummi) */
function tyreWearTexture(kind, damage, seed, mode) {
  const base = tyreTextures(kind).canvas, S = 256, c = makeCanvas(S, S), g = c.getContext('2d'), R = rng(seed * 13 + 5);
  g.drawImage(base, 0, 0);
  if (mode === 'burnt') {
    g.fillStyle = 'rgba(30,26,22,0.55)'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${90 + R() * 50},${80 + R() * 40},${70 + R() * 40},${0.2 + R() * 0.4})`; g.beginPath(); g.ellipse(R() * S, R() * S, 2 + R() * 10, 1 + R() * 5, R() * 3, 0, 7); g.fill(); }
  } else {
    const mud = mode === 'mud';
    const col = mud ? [86, 66, 44] : [138, 124, 104];
    const n = (mud ? 420 : 160) * damage;
    for (let i = 0; i < n; i++) {
      const tread = R() < 0.7, y = tread ? S * (0.3 + R() * 0.4) : S * (R() < 0.5 ? R() * 0.32 : 0.68 + R() * 0.32);
      g.fillStyle = `rgba(${col[0] + R() * 30},${col[1] + R() * 25},${col[2] + R() * 20},${(mud ? 0.35 : 0.2) + R() * 0.45 * damage})`;
      g.beginPath(); g.ellipse(R() * S, y, 3 + R() * (mud ? 18 : 8), 2 + R() * (mud ? 9 : 4), R() * 3, 0, 7); g.fill();
    }
    const gr = g.createLinearGradient(0, 0, 0, S);
    const a = (mud ? 0.45 : 0.2) * damage;
    gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(0.3, `rgba(${col},${a * 0.4})`); gr.addColorStop(0.5, `rgba(${col},${a * 0.8})`); gr.addColorStop(0.7, `rgba(${col},${a * 0.4})`); gr.addColorStop(1, `rgba(${col},${a})`);
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.userData.own = true;
  return t;
}
// ---- Wertrauschen für Brand-/Rostflächen ----
const BURNT_CACHE = new Map();
function noise2(seed) {
  const N = 256, perm = new Uint8Array(512), R = rng(seed), val = new Float32Array(N);
  for (let i = 0; i < N; i++) { perm[i] = i; val[i] = R(); }
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < N; i++) perm[i + N] = perm[i];
  const at = (x, y) => val[perm[(perm[x & 255] + (y & 255)) & 511]];
  const n = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return lerp(lerp(at(xi, yi), at(xi + 1, yi), u), lerp(at(xi, yi + 1), at(xi + 1, yi + 1), u), v);
  };
  return (x, y, oct = 4) => { let s = 0, a = 0.5, f = 1, w = 0; for (let o = 0; o < oct; o++) { s += n(x * f, y * f) * a; w += a; a *= 0.5; f *= 2.03; } return s / w; };
}
/**
 * Verschleiß-Maps für Lack/Anbauteile/Felgen in Seitenprojektion (u = Länge, v = Höhe).
 * Rückgabe je Basis: { map (Farbe, sRGB), rmc (R = Klarlack, G = Rauheit, B = Metall), normal? }
 * prof: { L, H, zMin, wheels:[{z,y,R}], mud }, mode: 'mud' | 'road' | 'scuff' | 'burnt'
 */
function wearMaps(prof, damage, seed, mode, bases) {
  const W = 1024, Hh = 512, R = rng(seed * 31 + 7);
  const U = (z) => (z - prof.zMin) / prof.L * W, Vy = (y) => (1 - y / prof.H) * Hh;
  const out = {};
  if (mode === 'burnt') {
    // pixelweise: Ruß, Rost, Asche, Reste der Originalfarbe; Höhenfeld für Blasen/Narben
    const fkey = seed + '|' + damage.toFixed(2) + '|' + prof.L + '|' + prof.H + '|' + prof.Wd;
    let F = BURNT_CACHE.get(fkey);
    if (!F) {
    const nz = noise2(seed * 7 + 3), nz2 = noise2(seed * 11 + 9);
    const fields = new Float32Array(W * Hh * 4), hgt = new Float32Array(W * Hh);
    // Weltkoordinaten (Meter): untere Hälfte = Seitenansicht (z, y), obere Hälfte = Draufsicht (z, x)
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      const u = x / W, v = 1 - y / Hh, zw = u * prof.L, side = v < 0.5;
      const hw = side ? v / 0.5 * prof.H : 40 + (v - 0.5) / 0.5 * prof.Wd;
      const big = nz(zw * 1.25, hw * 1.25, 4), fine = nz2(zw * 9, hw * 9, 3), mid = nz2(zw * 3.4 + 3, hw * 3.4, 3);
      const top = side ? sstep(0.4, 0.95, hw / prof.H) : 1;
      const rust = sstep(0.5, 0.74, big * 0.62 + mid * 0.28 + fine * 0.1 + damage * 0.1 + top * 0.06);
      const soot = sstep(0.42, 0.66, (1 - big) * 0.5 + (1 - top) * 0.22 + mid * 0.3) * (1 - rust * 0.5);
      const ash = sstep(0.64, 0.74, nz2(zw * 2 + 5, hw * 2, 3)) * (1 - soot) * 0.7;
      const paint = sstep(0.55, 0.8, (1 - top) * 0.5 + (1 - big) * 0.4 + fine * 0.1) * (1 - damage * 0.5) * (1 - soot);
      const o = (y * W + x) * 4; fields[o] = rust; fields[o + 1] = soot; fields[o + 2] = ash; fields[o + 3] = paint;
      hgt[y * W + x] = fine * 0.6 + rust * 0.4 * nz2(zw * 22, hw * 22, 2);
    }
    F = { fields, hgt }; BURNT_CACHE.set(fkey, F);
    if (BURNT_CACHE.size > 4) BURNT_CACHE.delete(BURNT_CACHE.keys().next().value);
    }
    const { fields, hgt } = F;
    for (const [k, b] of Object.entries(bases)) {
      const c = makeCanvas(W, Hh), g = c.getContext('2d'), id = g.createImageData(W, Hh);
      const c2 = makeCanvas(W, Hh), g2 = c2.getContext('2d'), id2 = g2.createImageData(W, Hh);
      const base = new THREE.Color(b.color), br = base.r * 255, bgc = base.g * 255, bb = base.b * 255;
      for (let i = 0; i < W * Hh; i++) {
        const o = i * 4, rust = fields[o], soot = fields[o + 1], ash = fields[o + 2], paint = fields[o + 3], f = hgt[i];
        let r = 46 + 22 * f, gg = 40 + 17 * f, bl = 36 + 14 * f;                           // verbranntes Blech
        r = lerp(r, 72 + 30 * f, rust); gg = lerp(gg, 42 + 14 * f, rust); bl = lerp(bl, 28 + 9 * f, rust);
        r = lerp(r, 20, soot); gg = lerp(gg, 18, soot); bl = lerp(bl, 17, soot);
        r = lerp(r, 128, ash * 0.8); gg = lerp(gg, 123, ash * 0.8); bl = lerp(bl, 116, ash * 0.8);
        r = lerp(r, br, paint); gg = lerp(gg, bgc, paint); bl = lerp(bl, bb, paint);
        id.data[o] = r; id.data[o + 1] = gg; id.data[o + 2] = bl; id.data[o + 3] = 255;
        id2.data[o] = paint * 90; id2.data[o + 1] = 255 * lerp(lerp(0.82, 0.95, rust), 0.98, soot); id2.data[o + 2] = 255 * lerp(0.35 * (1 - rust), 0.02, soot); id2.data[o + 3] = 255;
      }
      g.putImageData(id, 0, 0); g2.putImageData(id2, 0, 0);
      out[k] = { map: canvasTex(c, true), rmc: canvasTex(c2, false) };
    }
    // Normalmap (Narben, Blasen)
    const cn = makeCanvas(W, Hh), gn = cn.getContext('2d'), idn = gn.createImageData(W, Hh);
    const Hf = (x, y) => hgt[clamp(y, 0, Hh - 1) * W + ((x + W) % W)];
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      const dx = (Hf(x + 1, y) - Hf(x - 1, y)) * 6, dy = (Hf(x, y - 1) - Hf(x, y + 1)) * 6, l = Math.hypot(dx, dy, 1), o = (y * W + x) * 4;
      idn.data[o] = (-dx / l * 0.5 + 0.5) * 255; idn.data[o + 1] = (-dy / l * 0.5 + 0.5) * 255; idn.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; idn.data[o + 3] = 255;
    }
    gn.putImageData(idn, 0, 0);
    const nt = canvasTex(cn, false);
    for (const k of Object.keys(out)) out[k].normal = nt;
    out._normal = nt;
    return out;
  }
  // Stempel einmal würfeln, dann in jede Basis zeichnen (gleiches Muster für Farbe und Rauheit)
  const st = [];
  const mud = mode === 'mud', road = mode === 'road', scuff = mode === 'scuff';
  const yDust = (mud ? 1.25 : road ? 1.0 : 0.6);
  st.push({ t: 'grad', y0: Vy(yDust + 0.4), y1: Hh, a0: 0, a1: (mud ? 0.55 : 0.45) * damage, k: 'dust' });
  for (let i = 0; i < 2600 * damage; i++) st.push({ t: 'dot', x: R() * W, y: lerp(Vy(yDust + 0.6), Hh, Math.sqrt(R())), r: 0.6 + R() * 1.8, a: 0.15 + R() * 0.3, k: 'dust' });
  if (mud || road) for (const w of prof.wheels) {
    const x = U(w.z), y = Vy(w.y), rr = (w.R / prof.L) * W * 1.15;
    st.push({ t: 'rad', x, y, r: rr * (mud ? 1.5 : 1.2), a: (mud ? 0.75 : 0.45) * damage, k: mud ? 'mud' : 'grime' });
    const n = (mud ? 140 : 40) * damage;
    for (let i = 0; i < n; i++) {
      const a = (R() - 0.5) * Math.PI * 1.6 + Math.PI, d = rr * (0.7 + R() * 0.9);
      st.push({ t: 'blob', x: x + Math.cos(a) * d * 1.3, y: y - Math.abs(Math.sin(a)) * d * 0.9 + rr * 0.3, rx: 2 + R() * (mud ? 14 : 6), ry: 1.5 + R() * (mud ? 7 : 3), rot: R() * 3, a: 0.3 + R() * 0.6, k: mud ? 'mud' : 'grime' });
    }
  }
  if (mud) {
    st.push({ t: 'grad', y0: Vy(0.85), y1: Hh, a0: 0, a1: 0.9 * damage, k: 'mud' });
    for (let i = 0; i < 500 * damage; i++) st.push({ t: 'blob', x: R() * W, y: lerp(Vy(1.3), Hh, Math.pow(R(), 0.6)), rx: 1 + R() * 6, ry: 1 + R() * 3, rot: R() * 3, a: 0.4 + R() * 0.5, k: 'mud' });
  }
  if (road) {
    st.push({ t: 'grad', y0: Vy(0.7), y1: Hh, a0: 0, a1: 0.6 * damage, k: 'grime' });
    // Regenstreifen
    for (let i = 0; i < 70 * damage; i++) { const x = R() * W, y = R() * Hh * 0.5; st.push({ t: 'line', pts: [[x, y], [x + (R() - 0.5) * 4, y + 20 + R() * 120]], w: 1 + R() * 3, a: 0.08 + R() * 0.12, k: 'grime' }); }
  }
  // Kratzer
  for (let i = 0; i < (scuff ? 120 : 45) * damage; i++) {
    const x = R() * W, y = Hh * (scuff ? 0.35 + R() * 0.6 : 0.2 + R() * 0.6), l = 8 + R() * 60, a = (R() - 0.5) * 0.7;
    st.push({ t: 'line', pts: [[x, y], [x + l * 0.5, y + (R() - 0.5) * 6], [x + Math.cos(a) * l, y + Math.sin(a) * l]], w: 0.6 + R() * 1.4, a: 0.3 + R() * 0.5, k: 'scratch' });
  }
  if (scuff) for (let i = 0; i < 90 * damage; i++) st.push({ t: 'blob', x: R() * W, y: Hh * (0.55 + R() * 0.45), rx: 2 + R() * 10, ry: 1 + R() * 4, rot: (R() - 0.5) * 0.6, a: 0.6 + R() * 0.4, k: 'chip' });
  // Rost ab mittlerem Verschleiß
  if (damage > 0.45) for (let i = 0; i < 40 * (damage - 0.45) * (mud ? 1.5 : 1); i++) {
    const near = prof.wheels.length && R() < 0.6 ? prof.wheels[Math.floor(R() * prof.wheels.length)] : null;
    const x = near ? U(near.z) + (R() - 0.5) * 140 : R() * W, y = near ? Vy(near.y + near.R * (0.8 + R() * 0.4)) : Hh * (0.72 + R() * 0.25);
    st.push({ t: 'rad', x, y, r: 3 + R() * 12, a: 0.85, k: 'rust' });
    for (let j = 0; j < 4; j++) st.push({ t: 'line', pts: [[x + (R() - 0.5) * 8, y], [x + (R() - 0.5) * 10, y + 10 + R() * 40]], w: 1 + R() * 2, a: 0.25, k: 'rust' });
  }
  // Farben/Eigenschaften je Stempelart: [r,g,b] Farbe, [klarlack, rauheit, metall]
  const KC = { dust: [[150, 136, 112], [0.25, 0.85, 0]], mud: [[78, 60, 40], [0, 0.97, 0]], grime: [[62, 56, 48], [0.2, 0.8, 0]], scratch: [[206, 206, 200], [0.2, 0.5, 0.6]], chip: [[48, 48, 50], [0, 0.55, 0.5]], rust: [[112, 54, 24], [0, 0.93, 0.1]] };
  const draw = (g, prop) => {
    for (const s of st) {
      const [col, pr] = KC[s.k];
      const rgb = prop ? [pr[0] * 255, pr[1] * 255, pr[2] * 255] : col;
      const css = (a) => `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},${a})`;
      if (s.t === 'grad') { const gr = g.createLinearGradient(0, s.y0, 0, s.y1); gr.addColorStop(0, css(s.a0)); gr.addColorStop(1, css(s.a1)); g.fillStyle = gr; g.fillRect(0, s.y0, W, s.y1 - s.y0); }
      else if (s.t === 'dot') { g.fillStyle = css(s.a); g.fillRect(s.x, s.y, s.r * 2, s.r); }
      else if (s.t === 'rad') { const gr = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r); gr.addColorStop(0, css(s.a)); gr.addColorStop(1, css(0)); g.fillStyle = gr; g.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2); }
      else if (s.t === 'blob') { g.fillStyle = css(s.a); g.beginPath(); g.ellipse(s.x, s.y, s.rx, s.ry, s.rot, 0, Math.PI * 2); g.fill(); }
      else if (s.t === 'line') { g.strokeStyle = css(s.a); g.lineWidth = s.w; g.lineCap = 'round'; g.beginPath(); g.moveTo(...s.pts[0]); for (const q of s.pts.slice(1)) g.lineTo(...q); g.stroke(); }
    }
  };
  for (const [k, b] of Object.entries(bases)) {
    const c = makeCanvas(W, Hh), g = c.getContext('2d');
    g.fillStyle = hex(b.color); g.fillRect(0, 0, W, Hh); draw(g, false);
    const c2 = makeCanvas(W, Hh), g2 = c2.getContext('2d');
    g2.fillStyle = `rgb(${b.cc * 255 | 0},${b.rough * 255 | 0},${b.metal * 255 | 0})`; g2.fillRect(0, 0, W, Hh); draw(g2, true);
    out[k] = { map: canvasTex(c, true), rmc: canvasTex(c2, false) };
  }
  return out;
}

// =====================================================================
// Materialien (Namen = Slots für vehiclematerials.js)
// =====================================================================
let SHARED = null;
function sharedMaterials() {
  if (SHARED) return SHARED;
  const M = (o) => { const m = new THREE.MeshPhysicalMaterial(o); m.userData.shared = true; return m; };
  SHARED = {
    glass: M({ name: 'glass', color: 0x1b2329, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.4, depthWrite: false, envMapIntensity: 1.4 }),
    interior: M({ name: 'interior', color: 0x2b2826, metalness: 0, roughness: 0.82 }),
  };
  return SHARED;
}
// Basiswerte je Typ: Lack (Klarlack/Rauheit/Metall), Anbauteile, Felgen
const LOOK = {
  tractor: { paint: { cc: 0.8, rough: 0.32, metal: 0.08 }, trim: 0x1c1d1e, rim: (c) => (c.g > c.r * 1.3 ? 0xd6a51c : c.b > c.r ? 0xb8bcc0 : 0xc9c9c4), tyre: 'lug', wear: 'mud' },
  combine: { paint: { cc: 0.7, rough: 0.34, metal: 0.08 }, trim: 0x1c1d1e, rim: (c) => (c.g > c.r * 1.3 ? 0xd6a51c : 0xc9c9c4), tyre: 'lug', wear: 'mud' },
  bus: { paint: { cc: 1, rough: 0.3, metal: 0.35 }, trim: 0x141516, rim: () => 0xc8ccd0, tyre: 'road', wear: 'road' },
  truck: { paint: { cc: 1, rough: 0.3, metal: 0.3 }, trim: 0x161718, rim: () => 0xc8ccd0, tyre: 'road', wear: 'road' },
  forklift: { paint: { cc: 0.6, rough: 0.38, metal: 0.05 }, trim: 0x1d1e1f, rim: () => 0xd9d9d4, tyre: 'road', wear: 'scuff' },
  milwreck: { paint: { cc: 0, rough: 0.9, metal: 0.2 }, trim: 0x2a2622, rim: () => 0x3a3430, tyre: 'road', wear: 'burnt' },
};
function vehicleMaterials(type, variant, color, seed, damage, plateText, build) {
  const own = [], L = LOOK[type], info = INFO[type];
  const M = (o) => { const m = new THREE.MeshPhysicalMaterial(o); own.push(m); return m; };
  const wreck = type === 'milwreck';
  const rimColor = new THREE.Color(L.rim(color));
  const paint = M({ name: 'paint', color, metalness: L.paint.metal, roughness: L.paint.rough + damage * 0.25, clearcoat: L.paint.cc * (1 - damage * 0.6), clearcoatRoughness: 0.04 + damage * 0.2 });
  const trim = M({ name: 'trim', color: L.trim, metalness: 0.15, roughness: 0.6 });
  const chrome = M({ name: 'chrome', color: type === 'tractor' || type === 'combine' || type === 'forklift' ? rimColor : 0xe6e8ea, metalness: type === 'tractor' || type === 'combine' || type === 'forklift' ? 0.35 : 1, roughness: type === 'tractor' || type === 'combine' || type === 'forklift' ? 0.38 : 0.12, clearcoat: type === 'tractor' ? 0.6 : 0 });
  paint.userData.paintColor = color.clone();
  const dmg = wreck ? Math.max(0.6, damage) : damage;
  if (dmg > 0.02) {
    const prof = { L: build.dims.length, H: build.dims.height, Wd: build.dims.width, zMin: build.dims.zMin, wheels: build.wear.wheels.map((w) => ({ z: w.z, y: w.y, R: w.R })) };
    const maps = wearMaps(prof, dmg, seed, L.wear, {
      paint: { color, ...L.paint }, trim: { color: L.trim, cc: 0, rough: 0.6, metal: 0.15 }, chrome: { color: chrome.color.getHex(), cc: chrome.clearcoat, rough: chrome.roughness, metal: chrome.metalness },
    });
    const use = (m, w, base) => {
      m.map = w.map; m.color.set(0xffffff);
      m.roughnessMap = w.rmc; m.roughness = 1; m.metalnessMap = w.rmc; m.metalness = 1;
      if (base.cc > 0) { m.clearcoatMap = w.rmc; m.clearcoat = 1; m.clearcoatRoughness = 0.06 + dmg * 0.1; } else m.clearcoat = 0;
      if (w.normal) { m.normalMap = w.normal; m.normalScale.set(0.6, 0.6); }
    };
    use(paint, maps.paint, L.paint); use(trim, maps.trim, { cc: 0 }); use(chrome, maps.chrome, { cc: chrome.clearcoat });
    paint.userData.wearTextures = [maps.paint.map, maps.paint.rmc, maps.trim.map, maps.trim.rmc, maps.chrome.map, maps.chrome.rmc, maps._normal].filter(Boolean);
  }
  const tt = tyreTextures(L.tyre);
  const tyre = M({ name: 'tyre', color: 0x2a2a2a, map: tt.color, normalMap: tt.normal, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.9, metalness: 0 });
  if (dmg > 0.05) { tyre.map = tyreWearTexture(L.tyre, dmg, seed, wreck ? 'burnt' : L.wear === 'mud' ? 'mud' : 'dust'); tyre.color.set(wreck ? 0x8a8a8a : 0x9a9a9a); }
  const headlight = M({ name: 'headlight', color: wreck ? 0x2a2622 : 0xdfe5ec, metalness: 0.1, roughness: wreck ? 0.8 : 0.06, emissive: 0xfff3df, emissiveIntensity: wreck ? 0 : 0.15 });
  const taillight = M({ name: 'taillight', color: wreck ? 0x2a1210 : 0x7c0b09, metalness: 0, roughness: wreck ? 0.85 : 0.14, clearcoat: wreck ? 0 : 1, clearcoatRoughness: 0.05, emissive: 0xff1c10, emissiveIntensity: wreck ? 0 : 0.35 });
  const beacon = M({ name: 'beacon', color: wreck ? 0x3a2a12 : 0xd88a10, metalness: 0, roughness: wreck ? 0.85 : 0.12, clearcoat: wreck ? 0 : 1, emissive: 0xff8a10, emissiveIntensity: wreck ? 0 : 0.2 });
  const atlas = atlasTexture(type, variant, info.brand, MODEL_NAME[type + '|' + variant] || info.model, plateText);
  const plate = M({ name: 'plate', map: atlas, metalness: 0.25, roughness: wreck ? 0.9 : 0.42, color: wreck ? 0x8a847c : 0xffffff });
  const sh = sharedMaterials();
  let glass = sh.glass;
  if (wreck) glass = M({ name: 'glass', color: 0x0e0d0c, metalness: 0, roughness: 0.6, transparent: true, opacity: 0.85, depthWrite: false });
  let interior = sh.interior;
  if (wreck) interior = M({ name: 'interior', color: 0x1a1816, metalness: 0, roughness: 0.95 });
  return { mats: { paint, glass, tyre, chrome, trim, headlight, taillight, interior, plate, beacon }, own };
}

// =====================================================================
// Cache je Typ/Variante/LOD + Seitenprojektion der UVs
// =====================================================================
const QUAL = [
  { lod: 0, m: 3, cell: 0.24, sup: 0.012, wheelSeg: 64 },
  { lod: 1, m: 1, cell: 0.9, sup: 0, wheelSeg: 20 },
  { lod: 2, m: 1, cell: Infinity, sup: 0, wheelSeg: 10 },
];
const BUILDERS = { tractor: buildTractor, combine: buildCombine, bus: buildBus, truck: buildTruck, forklift: buildForklift, milwreck: buildMilwreck };
const LEVEL_CACHE = new Map();
function projectUV(g, d) {
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), nx = Math.abs(n.getX(i)), ny = n.getY(i), nz = Math.abs(n.getZ(i));
    const u = (z - d.zMin) / d.length;
    // Oberseiten -> oberes Band der Map, Unterseiten -> unteres Band, Front/Heck -> Streifen um ihre z-Lage
    if (d.uvLayout === 'split') { // Seiten unten (v 0..0.5), Draufsicht oben (v 0.5..1), isotrop für Brandspuren
      if (ny > Math.max(nx, nz) * 1.1) uv.setXY(i, u, 0.5 + 0.5 * clamp(x / d.width + 0.5, 0, 1));
      else uv.setXY(i, u + (nz > nx * 1.2 ? x / d.length * 0.6 : 0), ny < -Math.max(nx, nz) ? 0.01 : 0.5 * clamp(y / d.height, 0, 1));
    } else if (Math.abs(ny) > Math.max(nx, nz) * 1.1) uv.setXY(i, u, ny > 0 ? 0.78 + 0.2 * (x / d.width + 0.5) : 0.02 + 0.08 * (x / d.width + 0.5));
    else uv.setXY(i, u + (nz > nx * 1.2 ? x / d.length * 0.6 : 0), y / d.height);
  }
  uv.needsUpdate = true;
}
function buildLevel(type, variant, lod, length) {
  const key = `${type}|${variant}|${lod}|${length ?? ''}`;
  if (LEVEL_CACHE.has(key)) return LEVEL_CACHE.get(key);
  const t0 = now();
  const b = BUILDERS[type](QUAL[lod], variant, length);
  // LOD2: Innenraum-Platzhalter (verdeckt), damit alle Stufen dieselben Slots haben
  if (!b.P.list.interior) b.P.add('interior', new THREE.BoxGeometry(0.2, 0.2, 0.2), M4(0, b.dims.height * 0.45, (b.dims.zMin + b.dims.zMax) / 2));
  const geos = b.P.merge();
  for (const s of ['paint', 'trim', 'chrome']) if (geos[s]) projectUV(geos[s], b.dims);
  for (const g of Object.values(geos)) g.computeBoundingSphere();
  const entry = { geos, marks: b.marks, dims: b.dims, wheels: b.wheels, wear: b.wear, ms: now() - t0 };
  LEVEL_CACHE.set(key, entry);
  return entry;
}
/** Alle gecachten Geometrien freigeben (z. B. beim Szenenwechsel). */
export function clearHeavyVehicleCache() {
  for (const e of LEVEL_CACHE.values()) for (const g of Object.values(e.geos)) g.dispose();
  LEVEL_CACHE.clear();
  for (const k of KIT_CACHE.values()) for (const m of k.own) { disposeMatTextures(m); m.dispose(); }
  KIT_CACHE.clear();
}
function disposeMatTextures(m) {
  for (const t of m.userData.wearTextures || []) t.dispose();
  for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'clearcoatMap']) if (m[k]?.userData?.own) m[k].dispose();
}

// =====================================================================
// Öffentliche API
// =====================================================================
const triCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
function normType(type) { return HEAVY_TYPES.includes(type) && BUILDERS[type] ? type : 'tractor'; }
function normVariant(type, v) { const vs = HEAVY_VARIANTS[type]; return vs.includes(v) ? v : vs[0]; }
function normLength(type, variant, len) {
  if (len == null || !Number.isFinite(+len)) return null;
  if (type === 'bus') return clamp(Math.round(+len * 2) / 2, variant === 'coach' ? 10 : 8, variant === 'coach' ? 14 : 13.5);
  if (type === 'truck' && variant === 'box') return clamp(Math.round(+len * 2) / 2, 6.5, 10.5);
  return null;
}
/** Fußabdruck in Spielfeldern (TILE = 2 m): along = Felder in Fahrtrichtung, across = quer */
export function heavyVehicleFootprint(type, { variant, length, tile = 2 } = {}) {
  type = normType(type); variant = normVariant(type, variant);
  const d = buildLevel(type, variant, 2, normLength(type, variant, length)).dims;
  return { length: d.length, width: d.width, along: Math.max(1, Math.round(d.length / tile)), across: Math.max(1, Math.round(d.width / tile)) };
}
function levelObject(type, variant, lod, length, mats) {
  const e = buildLevel(type, variant, lod, length);
  const grp = new THREE.Group(); grp.name = `${type}_LOD${lod}`;
  let tris = 0;
  for (const slot of HEAVY_SLOTS) {
    const g = e.geos[slot]; if (!g) continue;
    const m = new THREE.Mesh(g, mats[slot]); m.name = `${type}_${slot}`;
    m.castShadow = slot !== 'glass' && slot !== 'plate'; m.receiveShadow = true; m.userData.slot = slot;
    grp.add(m); tris += triCount(g);
  }
  grp.userData.level = lod; grp.userData.triangles = tris;
  return grp;
}

/**
 * Erzeugt ein Nutzfahrzeug.
 * @param {{type?:'tractor'|'combine'|'bus'|'truck'|'forklift'|'milwreck', variant?:string, color?:number|string|THREE.Color,
 *   seed?:number, damage?:number, lod?:'auto'|0|1|2, length?:number, plateText?:string, lodDistances?:number[]}} opts
 * @returns {THREE.LOD|THREE.Group} userData: {type, variant, brand, model, dimensions, footprint, lodLevels, lods, materials,
 *   headlights, taillights, beacons, wheels, buildMs}
 */
export function makeHeavyVehicle(opts = {}) {
  const t0 = now();
  const type = normType(opts.type), variant = normVariant(type, opts.variant), info = INFO[type];
  const length = normLength(type, variant, opts.length);
  const seed = (opts.seed ?? 1) >>> 0;
  const damage = type === 'milwreck' ? clamp(opts.damage ?? 1, 0, 1) : clamp(+opts.damage || 0, 0, 1);
  const R = rng(seed + 101);
  const color = new THREE.Color(opts.color ?? info.palette[seed % info.palette.length]);
  const plateText = String(opts.plateText ?? `${type === 'tractor' || type === 'combine' ? 'LW' : 'VR'} ${String.fromCharCode(65 + Math.floor(R() * 26))} ${100 + Math.floor(R() * 899)}`).slice(0, 10);
  const auto = opts.lod === undefined || opts.lod === 'auto';
  const levels = auto ? [0, 1, 2] : [clamp(opts.lod | 0, 0, 2)];
  const base = buildLevel(type, variant, levels[0], length);
  const Ld = base.dims.length;
  const dist = opts.lodDistances || [0, Math.round(Ld * 3), Math.round(Ld * 10)];
  const { mats, own } = vehicleMaterials(type, variant, color, seed, damage, plateText, base);
  const root = auto ? new THREE.LOD() : new THREE.Group();
  const model = MODEL_NAME[type + '|' + variant] || info.model;
  root.name = `${info.brand ? info.brand[0] + info.brand.slice(1).toLowerCase() + '_' : ''}${model.replace(/\s+/g, '_')}`;
  const lodLevels = [], lods = [];
  for (const lv of levels) {
    const obj = levelObject(type, variant, lv, length, mats);
    if (auto) root.addLevel(obj, dist[lv]); else root.add(obj);
    lods.push(obj); lodLevels.push({ level: lv, triangles: obj.userData.triangles, distance: auto ? dist[lv] : 0 });
  }
  const mk = (p, name, dir) => { const o = new THREE.Object3D(); o.name = name; o.position.copy(p); o.userData.dir = dir; root.add(o); return o; };
  const mk2 = (list, name, dir) => (list || []).map((p, i) => mk(p, `${name}_${i}`, dir));
  const d = base.dims;
  Object.assign(root.userData, {
    type, variant, brand: info.brand, model, seed, damage, plateText, paintColor: color.getHex(),
    headlights: mk2(base.marks.head, 'headlight', V3(0, 0, 1)), taillights: mk2(base.marks.tail, 'taillight', V3(0, 0, -1)), beacons: mk2(base.marks.beacon, 'beacon', V3(0, 1, 0)),
    wheels: base.wheels.map((w) => ({ position: V3(w.x, w.y, w.z), radius: w.R, width: w.W, front: !!w.front })),
    lodLevels, lods, materials: mats, ownMaterials: own,
    lightMaterials: { headlight: mats.headlight, taillight: mats.taillight, beacon: mats.beacon },
    dimensions: { length: d.length, width: d.width, height: d.height, wheelbase: d.wheelbase },
    footprint: { along: Math.max(1, Math.round(d.length / 2)), across: Math.max(1, Math.round(d.width / 2)), tile: 2 },
  });
  root.userData.buildMs = now() - t0;
  return root;
}
/** Licht: head = Scheinwerfer/Arbeitsscheinwerfer, brake = Bremslicht, beacon = Rundumleuchte/Blinker (gelb). */
export function setHeavyVehicleLights(root, { head = false, brake = false, beacon = false } = {}) {
  const m = root?.userData?.lightMaterials; if (!m || root.userData.type === 'milwreck') return;
  m.headlight.emissiveIntensity = head ? 4 : 0.15;
  m.taillight.emissiveIntensity = brake ? 4 : head ? 0.9 : 0.35;
  m.beacon.emissiveIntensity = beacon ? 3 : 0.2;
}
/** Gibt fahrzeugeigene Materialien/Texturen frei (gecachte Geometrie bleibt erhalten). */
export function disposeHeavyVehicle(root) {
  if (!root) return;
  for (const m of root.userData.ownMaterials || []) { disposeMatTextures(m); m.dispose(); }
  root.userData.ownMaterials = [];
  if (root.parent) root.parent.remove(root);
}
export function heavyVehicleTriangles(root) {
  let n = 0; root.traverse((o) => { if (o.isMesh && o.visible) n += triCount(o.geometry); }); return n;
}
const KIT_CACHE = new Map();
/**
 * Statischer Bausatz für InstancedMesh (gleiche Struktur wie herocar.getHeroCarKit → HeroCarSet in tactical.js):
 * { type, levels: {lod: {slot: geometry}}, mats, own, damaged, dims }. Geometrien gehören dem Cache (nicht disposen,
 * clearHeavyVehicleCache gibt alles frei). Ungeschädigt: Lack weiß (Farbe aus instanceColor); mit Schaden: Farbe in der Map.
 */
export function getHeavyVehicleKit(type, { variant, damage = 0, color, seed = 7, length, plateText = 'AE 1994', levels = [0, 1, 2] } = {}) {
  type = normType(type); variant = normVariant(type, variant); length = normLength(type, variant, length);
  damage = type === 'milwreck' ? clamp(damage || 1, 0, 1) : clamp(+damage || 0, 0, 1);
  const damaged = damage > 0.02, col = new THREE.Color(color ?? INFO[type].palette[0]);
  const key = `${type}|${variant}|${length}|${damaged ? damage.toFixed(2) + '|' + col.getHexString() : 'clean'}|${levels.join(',')}`;
  if (KIT_CACHE.has(key)) return KIT_CACHE.get(key);
  const base = buildLevel(type, variant, levels[0], length);
  const { mats, own } = vehicleMaterials(type, variant, damaged ? col : new THREE.Color(0xffffff), seed, damage, plateText, base);
  if (!damaged) mats.paint.color.set(0xffffff);
  const out = {};
  for (const lv of levels) out[lv] = { ...buildLevel(type, variant, lv, length).geos };
  const d = base.dims;
  const kit = { type, variant, levels: out, mats, own, damaged, dims: { length: d.length, width: d.width, height: d.height } };
  KIT_CACHE.set(key, kit);
  return kit;
}
