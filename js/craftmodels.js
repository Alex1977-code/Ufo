// Realistische prozedurale Fluggeräte für AEGIS – gemeinsame Bibliothek
// Abfangjäger „Falke“/„Phantom“, Transporter „Kondor“ und die vier UFO-Klassen.
// Keine Bilddateien: Geometrie aus Loft/Lathe/Extrude, Gebrauchsspuren als Canvas-Texturen
// (Farbe, ORM = AO/Rauheit/Metall, Normal, Emission), die einmal pro Fahrzeugtyp erzeugt und gecacht werden.
// Konventionen: Nase/Front = −Z, Oberseite = +Y, Maßstab in Metern, Ursprung = Rumpfmitte.
import * as THREE from 'three';
import { canvasTexture } from './engine.js';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const V2 = (x, y) => new THREE.Vector2(x, y);
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0; };
function M4(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V3(sx, sy, sz));
}

/** 'low' auf kleinen Bildschirmen (Handy), sonst 'high'. */
export function autoLod() {
  try { return Math.min(screen.width, screen.height) < 700 ? 'low' : 'high'; } catch { return 'high'; }
}
function norm(o = {}) {
  const lod = o.lod === 'low' || o.lod === 'high' ? o.lod : autoLod();
  const hi = lod === 'high';
  return {
    lod, hi, S: o.texSize || (hi ? 1024 : 512), seed: (o.seed ?? 1) | 0, damage: clamp(+o.damage || 0, 0, 1),
    gear: !!o.gear, shadows: o.shadows !== false, transmission: hi && o.transmission !== false,
    code: o.code, tilt: o.tilt, throttle: o.throttle ?? 0, accent: o.accent,
  };
}

// =====================================================================
// Geometrie-Helfer (alles nicht-indiziert: position + normal, UV per Projektion)
// =====================================================================
function ni(g, keepUV = false) {
  const n = g.index ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && !(keepUV && k === 'uv')) n.deleteAttribute(k);
  if (!n.attributes.normal) n.computeVertexNormals();
  return n;
}
function merge(list, keepUV = false) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = keepUV ? new Float32Array(n * 2) : null;
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    if (uv) uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count; g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}
// Glatte Normalen mit Knickwinkel: Fasen/Rundungen weich, echte Kanten hart
function crease(g, deg = 30) {
  const p = g.attributes.position.array, nV = p.length / 3, nF = nV / 3;
  const fu = new Float32Array(nF * 3), fw = new Float32Array(nF * 3);
  for (let f = 0; f < nF; f++) {
    const i = f * 9;
    const ax = p[i + 3] - p[i], ay = p[i + 4] - p[i + 1], az = p[i + 5] - p[i + 2];
    const bx = p[i + 6] - p[i], by = p[i + 7] - p[i + 1], bz = p[i + 8] - p[i + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx, l = Math.hypot(cx, cy, cz);
    fw[f * 3] = cx; fw[f * 3 + 1] = cy; fw[f * 3 + 2] = cz;
    if (l > 1e-12) { fu[f * 3] = cx / l; fu[f * 3 + 1] = cy / l; fu[f * 3 + 2] = cz / l; }
  }
  const map = new Map(), keys = new Array(nV);
  for (let v = 0; v < nV; v++) {
    const k = Math.round(p[v * 3] * 2000) + ',' + Math.round(p[v * 3 + 1] * 2000) + ',' + Math.round(p[v * 3 + 2] * 2000);
    keys[v] = k; let l = map.get(k); if (!l) map.set(k, l = []); l.push(v);
  }
  const ct = Math.cos(deg * Math.PI / 180), nor = new Float32Array(nV * 3);
  for (let v = 0; v < nV; v++) {
    const f = (v / 3) | 0; let sx = 0, sy = 0, sz = 0;
    for (const u of map.get(keys[v])) {
      const h = (u / 3) | 0;
      if (fu[f * 3] * fu[h * 3] + fu[f * 3 + 1] * fu[h * 3 + 1] + fu[f * 3 + 2] * fu[h * 3 + 2] >= ct) { sx += fw[h * 3]; sy += fw[h * 3 + 1]; sz += fw[h * 3 + 2]; }
    }
    let l = Math.hypot(sx, sy, sz);
    if (l < 1e-12) { sx = fu[f * 3]; sy = fu[f * 3 + 1]; sz = fu[f * 3 + 2]; l = Math.hypot(sx, sy, sz); if (l < 1e-9) { sy = 1; l = 1; } }
    nor[v * 3] = sx / l; nor[v * 3 + 1] = sy / l; nor[v * 3 + 2] = sz / l;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}
// Superellipsen-Loft entlang z: Station = [z, halbeBreite, Höhe oben, Höhe unten, yMitte, Exponent]
function loft(st, seg, o = {}) {
  const part = o.t0 !== undefined, t0 = o.t0 ?? 0, t1 = o.t1 ?? TAU, cols = part ? seg + 1 : seg, ns = st.length, sc = o.scale ?? 1;
  const ox = o.x || 0, oy = o.y || 0;
  const P = (s, t, out, k) => {
    const [z, w, hT, hB, yc, n] = s, c = Math.cos(t), si = Math.sin(t), e = 2 / n;
    out[k] = w * sc * Math.sign(c) * Math.abs(c) ** e + ox;
    out[k + 1] = yc + (si >= 0 ? hT : hB) * sc * Math.sign(si) * Math.abs(si) ** e + oy;
    out[k + 2] = z;
  };
  const pos = new Float32Array(ns * cols * 3);
  for (let i = 0; i < ns; i++) for (let j = 0; j < cols; j++) P(st[i], t0 + (t1 - t0) * j / seg, pos, (i * cols + j) * 3);
  const idx = [];
  for (let i = 0; i < ns - 1; i++) for (let j = 0; j < seg; j++) {
    const j1 = part ? j + 1 : (j + 1) % seg;
    const a = i * cols + j, b = (i + 1) * cols + j, c = i * cols + j1, d = (i + 1) * cols + j1;
    if (o.inside) idx.push(a, b, c, c, b, d); else idx.push(a, c, b, c, d, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const list = [ni(g)];
  const cap = (s, end) => {
    const ring = new Float32Array(seg * 3 + 3); for (let j = 0; j <= seg; j++) P(s, t0 + (t1 - t0) * j / seg, ring, j * 3);
    const cx = ox, cy = s[4] + oy, cz = s[0], tri = [], nz = (end ? 1 : -1) * (o.inside ? -1 : 1);
    for (let j = 0; j < seg; j++) {
      const A = [ring[j * 3], ring[j * 3 + 1], ring[j * 3 + 2]], B = [ring[j * 3 + 3], ring[j * 3 + 4], ring[j * 3 + 5]];
      tri.push(cx, cy, cz, ...(nz > 0 ? A : B), ...(nz > 0 ? B : A));
    }
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
    const nn = new Float32Array(tri.length); for (let i = 2; i < nn.length; i += 3) nn[i] = nz; cg.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
    list.push(cg);
  };
  if (o.capS) cap(st[0], false);
  if (o.capE) cap(st[ns - 1], true);
  return list.length > 1 ? merge(list) : list[0];
}
function lathe(pts, seg, deg = 30, phi0 = 0, phiL = TAU) { return crease(ni(new THREE.LatheGeometry(pts.map(([r, y]) => V2(r, y)), seg, phi0, phiL)), deg); }
// Profilierte Platte (Flügel, Leitwerk): Grundriss [[x,z],…], Dicke entlang y, gefaste Kanten, Zuspitzung zur Spitze
function slab(pts, thick, o = {}) {
  const bt = thick * 0.3, bs = Math.min(thick * 0.4, 0.05), depth = Math.max(0.002, thick - 2 * bt);
  const g0 = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, z]) => V2(x, z))), { depth, bevelEnabled: o.bevel !== false, bevelThickness: bt, bevelSize: bs * 0.6, bevelSegments: o.segs ?? 2, curveSegments: 3 });
  g0.rotateX(Math.PI / 2); g0.translate(0, depth / 2, 0);
  const g = ni(g0), p = g.attributes.position.array;
  let xa = Infinity, xb = 0; for (const [x] of pts) { xa = Math.min(xa, Math.abs(x)); xb = Math.max(xb, Math.abs(x)); }
  for (let i = 0; i < p.length; i += 3) {
    const ax = Math.abs(p[i]), t = clamp((ax - xa) / Math.max(1e-3, xb - xa), 0, 1);
    p[i + 1] = p[i + 1] * lerp(1, o.tip ?? 1, t) + (ax - xa) * (o.dih || 0) + (o.y || 0);
  }
  return crease(g, o.crease ?? 50);
}
// Senkrechte Flosse: Kontur [[z,y],…] in der yz-Ebene, Dicke entlang x
function fin(pts, thick, tip = 0.5, segs = 2) { const g = slab(pts.map(([z, y]) => [y, z]), thick, { tip, segs }); g.rotateZ(Math.PI / 2); return g; }
const mirror = (pts, sx) => pts.map(([x, z]) => [x * sx, z]);
function stationAt(st, z) {
  if (z <= st[0][0]) return st[0].slice();
  for (let i = 0; i < st.length - 1; i++) if (z <= st[i + 1][0]) { const t = (z - st[i][0]) / (st[i + 1][0] - st[i][0]); return st[i].map((v, k) => lerp(v, st[i + 1][k], t)); }
  return st[st.length - 1].slice();
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cylZ = (r0, r1, len, seg = 12) => { const g = new THREE.CylinderGeometry(r0, r1, len, seg); g.rotateX(-Math.PI / 2); return g; }; // r0 vorne (−z)
const cylX = (r, len, seg = 12) => { const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateZ(Math.PI / 2); return g; };

class Kit {
  constructor() { this.parts = new Map(); }
  add(key, geo, m) { const g = ni(geo); if (m) g.applyMatrix4(m); if (!this.parts.has(key)) this.parts.set(key, []); this.parts.get(key).push(g); return this; }
  geo(key) { const l = this.parts.get(key); this.parts.delete(key); return l && l.length ? merge(l) : null; }
  has(key) { return this.parts.has(key); }
}

// =====================================================================
// UV-Layouts: Atlas-Regionen, die zu den gemalten Gebrauchsspuren passen
// =====================================================================
function region(u0, u1, v0, v1, ak, [al, ah], af, bk, [bl, bh], bf) {
  const r = { u0, u1, v0, v1, ak, bk, al, ah, bl, bh };
  r.u = (a) => { let t = (a - al) / (ah - al); if (af) t = 1 - t; return u0 + t * (u1 - u0); };
  r.v = (b) => { let t = (b - bl) / (bh - bl); if (bf) t = 1 - t; return v0 + t * (v1 - v0); };
  r.uv = (P) => [r.u(P[ak]), r.v(P[bk])];
  return r;
}
// Flugzeuge: Draufsicht | Unterseite | Seite (beidseitig gespiegelt, daher ohne Schrift)
function planeLayout(e) {
  const top = region(0, 0.5, 0, 1, 'x', e.x, false, 'z', e.z, true);
  const bot = region(0.5, 0.72, 0, 1, 'x', e.x, true, 'z', e.z, true);
  const side = region(0.72, 1, 0, 1, 'y', e.y, false, 'z', e.z, false);
  return { top, bot, side, pick: (n) => (n.y > 0.55 ? top : n.y < -0.55 ? bot : side) };
}
// UFOs: Oberseite (planar) | Unterseite (planar) | zylindrisches Randband (k Wiederholungen)
function discLayout(R, E, yr, k) {
  const top = region(0, 0.5, 0.5, 1, 'x', [-E, E], false, 'z', [-E, E], true);
  const bot = region(0.5, 1, 0.5, 1, 'x', [-E, E], true, 'z', [-E, E], true);
  const band = region(0, 1, 0, 0.5, 'x', [0, TAU * R / k], false, 'y', yr, false); // a = Bogenlänge in m je Wiederholung
  band.wrap = k;
  band.uv = (P) => [((Math.atan2(-P.z, P.x) / TAU + 1) % 1) * k, band.v(P.y)];
  return { top, bot, band, pick: (n) => (n.y > 0.45 ? top : n.y < -0.45 ? bot : band) };
}
function projectUV(g, L, m) {
  const p = g.attributes.position.array, n = p.length / 3, uv = new Float32Array(n * 2);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();
  for (let f = 0; f < n; f += 3) {
    A.fromArray(p, f * 3); B.fromArray(p, f * 3 + 3); C.fromArray(p, f * 3 + 6);
    if (m) { A.applyMatrix4(m); B.applyMatrix4(m); C.applyMatrix4(m); }
    fn.crossVectors(e1.subVectors(B, A), e2.subVectors(C, A)).normalize();
    const r = L.pick(fn);
    [A, B, C].forEach((P, k) => { const t = r.uv(P); uv[(f + k) * 2] = t[0]; uv[(f + k) * 2 + 1] = t[1]; });
    if (r.wrap) {
      const i = f * 2, a = uv[i], b = uv[i + 2], c = uv[i + 4];
      if (Math.max(a, b, c) - Math.min(a, b, c) > r.wrap / 2) for (const j of [i, i + 2, i + 4]) if (uv[j] < r.wrap / 2) uv[j] += r.wrap;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// =====================================================================
// Texturmaler: Ebenen A (Farbe), H (Höhe→Normal), R (Rauheit), M (Metall), O (AO/Schmutz), E (Emission)
// Zeichnen in Weltkoordinaten (Meter) der jeweiligen Atlas-Region.
// =====================================================================
const css = (v) => (v.length === 2 ? `rgba(${v[0] | 0},${v[0] | 0},${v[0] | 0},${v[1]})` : `rgba(${v[0] | 0},${v[1] | 0},${v[2] | 0},${v[3] ?? 1})`);
const cssA = (v, a) => css(v.length === 2 ? [v[0], a] : [v[0], v[1], v[2], a]);
const FONT = '"Arial Narrow", "Roboto Condensed", Arial, Helvetica, sans-serif';

class Painter {
  constructor(S, seed, base) {
    this.S = S; this.rand = rng(seed); this.ctx = {}; this.base = base;
    const fill = { A: base.color, H: [128, 1], R: [base.rough * 255, 1], M: [base.metal * 255, 1], O: [255, 1], E: [0, 0, 0, 1] };
    for (const k of base.emissive ? 'AHRMOE' : 'AHRMO') {
      const c = document.createElement('canvas'); c.width = c.height = S;
      const x = c.getContext('2d', { willReadFrequently: k !== 'A' && k !== 'E' });
      x.fillStyle = css(fill[k]); x.fillRect(0, 0, S, S); this.ctx[k] = x;
    }
  }
  rr(a, b) { return a + this.rand() * (b - a); }
  use(r) {
    const S = this.S;
    r.sx = S * (r.u(1) - r.u(0)); r.tx = S * r.u(0); r.sy = -S * (r.v(1) - r.v(0)); r.ty = S * (1 - r.v(0));
    r.clip = [S * r.u0, S * (1 - r.v1), S * (r.u1 - r.u0), S * (r.v1 - r.v0)];
    r.ppm = (Math.abs(r.sx) + Math.abs(r.sy)) / 2;
    this.r = r; return this;
  }
  _do(st, fn) {
    const r = this.r;
    for (const k in st) {
      const ctx = this.ctx[k]; if (!ctx || k.length > 1) continue;
      for (const off of r.wrap ? [-1, 0, 1] : [0]) {
        ctx.save(); ctx.beginPath(); ctx.rect(...r.clip); ctx.clip();
        ctx.setTransform(r.sx, 0, 0, r.sy, r.tx + off * r.sx * (r.ah - r.al), r.ty);
        if (st.op?.[k]) ctx.globalCompositeOperation = st.op[k];
        if (st.blur && (k === 'A' || k === 'O' || k === 'E')) ctx.filter = `blur(${st.blur}px)`;
        fn(ctx, st[k]); ctx.restore();
      }
    }
  }
  static path(c, pts, close) { pts.forEach(([a, b], i) => (i ? c.lineTo(a, b) : c.moveTo(a, b))); if (close) c.closePath(); }
  poly(pts, st) { this.polys([pts], st); }
  polys(list, st) { this._do(st, (c, v) => { c.fillStyle = css(v); c.beginPath(); for (const p of list) Painter.path(c, p, true); c.fill(); }); }
  strokes(list, w, st, o = {}) {
    this._do(st, (c, v) => {
      c.strokeStyle = css(v); c.lineWidth = w; c.lineCap = o.cap || 'round'; c.lineJoin = 'round';
      if (o.dash) c.setLineDash(o.dash);
      c.beginPath(); for (const p of list) Painter.path(c, p, !!o.closed); c.stroke();
    });
  }
  dots(list, st) { this._do(st, (c, v) => { c.fillStyle = css(v); c.beginPath(); for (const [a, b, r] of list) { c.moveTo(a + r, b); c.arc(a, b, r, 0, TAU); } c.fill(); }); }
  soft(a, b, ra, rb, st, rot = 0) {
    this._do(st, (c, v) => {
      c.translate(a, b); c.rotate(rot); c.scale(ra, rb);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, 1); g.addColorStop(0, css(v)); g.addColorStop(1, cssA(v, 0));
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, 1, 0, TAU); c.fill();
    });
  }
  streak(a, b, da, db, len, w0, w1, st) {
    this._do(st, (c, v) => {
      const l = Math.hypot(da, db) || 1, ux = da / l, uy = db / l, px = -uy, py = ux, ex = a + ux * len, ey = b + uy * len;
      const g = c.createLinearGradient(a, b, ex, ey); g.addColorStop(0, css(v)); g.addColorStop(1, cssA(v, 0));
      c.fillStyle = g; c.beginPath();
      c.moveTo(a + px * w0 / 2, b + py * w0 / 2); c.lineTo(ex + px * w1 / 2, ey + py * w1 / 2); c.lineTo(ex - px * w1 / 2, ey - py * w1 / 2); c.lineTo(a - px * w0 / 2, b - py * w0 / 2);
      c.fill();
    });
  }
  // Maske (Text, Glyphen) in Pixeln stempeln; Leserichtung dir in Weltkoordinaten
  stamp(mask, a, b, size, dir, st) {
    const r = this.r, l = Math.hypot(dir[0], dir[1]) || 1;
    const dx = r.sx * dir[0], dy = r.sy * dir[1], ang = Math.atan2(dy, dx);
    const along = Math.hypot(dx, dy) / l, perp = Math.hypot(r.sx * dir[1], r.sy * dir[0]) / l;
    const k = (size * perp) / mask.unit;
    for (const key in st) {
      const ctx = this.ctx[key]; if (!ctx || key.length > 1) continue;
      const tinted = tint(mask, css(st[key]));
      for (const off of r.wrap ? [-1, 0, 1] : [0]) {
        ctx.save(); ctx.beginPath(); ctx.rect(...r.clip); ctx.clip();
        ctx.translate(r.tx + r.sx * (a + off * (r.ah - r.al)), r.ty + r.sy * b); ctx.rotate(ang); ctx.scale(k * along / perp, k);
        ctx.drawImage(tinted, -tinted.width / 2, -tinted.height / 2); ctx.restore();
      }
    }
  }
  text(str, a, b, size, dir, st, wear = 0.35) { this.stamp(textMask(str, Math.round(clamp(size * this.r.ppm * 1.2, 14, 160)), this.rand, wear), a, b, size, dir, st); }
  // Fugen + Schmutz in den Fugen + Nieten
  panels(lines, o = {}) {
    const w = o.w ?? 0.02;
    this.strokes(lines, w * 7, { A: [48, 42, 34, 0.1], O: [140, 0.4], R: [205, 0.2] });
    this.strokes(lines, w, { A: [16, 18, 22, o.dark ?? 0.55], H: [62, 1], O: [110, 0.8], R: [210, 0.4] });
    if (o.rivet) {
      const dots = [], dark = [];
      for (const pl of lines) for (let i = 0; i < pl.length - 1; i++) {
        const [a0, b0] = pl[i], [a1, b1] = pl[i + 1], L = Math.hypot(a1 - a0, b1 - b0); if (L < 1e-4) continue;
        const nx = -(b1 - b0) / L, ny = (a1 - a0) / L, n = Math.floor(L / o.rivet);
        for (let k = 0; k <= n; k++) {
          const t = (k + 0.5) / (n + 1), a = lerp(a0, a1, t), b = lerp(b0, b1, t);
          for (const s of [-1, 1]) { const d = s * w * 2.2; dots.push([a + nx * d, b + ny * d, w * 0.55]); dark.push([a + nx * d, b + ny * d, w * 0.75]); }
        }
      }
      this.dots(dark, { H: [96, 1], A: [30, 30, 32, 0.25] });
      this.dots(dots, { H: [188, 1], A: [200, 205, 210, 0.12], R: [120, 0.4] });
    }
  }
  // abgeplatzter Lack entlang einer Kante
  chips(pl, n, spread, size, st, side = 0) {
    const segs = []; let tot = 0;
    for (let i = 0; i < pl.length - 1; i++) { const L = Math.hypot(pl[i + 1][0] - pl[i][0], pl[i + 1][1] - pl[i][1]); segs.push(L); tot += L; }
    const polys = [];
    for (let k = 0; k < n; k++) {
      let t = this.rand() * tot, i = 0; while (i < segs.length - 1 && t > segs[i]) t -= segs[i++];
      const [a0, b0] = pl[i], [a1, b1] = pl[i + 1], L = segs[i] || 1, ux = (a1 - a0) / L, uy = (b1 - b0) / L;
      const d = this.rand() ** 2.2 * spread * (side || (this.rand() < 0.5 ? -1 : 1));
      const ca = a0 + ux * t - uy * d, cb = b0 + uy * t + ux * d, rad = size * (0.3 + this.rand() * 0.9) * (1 - Math.abs(d) / spread * 0.6);
      const m = 5 + ((this.rand() * 4) | 0), pts = [];
      for (let j = 0; j < m; j++) { const ang = (j / m) * TAU, rj = rad * (0.45 + this.rand() * 0.75); pts.push([ca + Math.cos(ang) * rj * (1 + Math.abs(ux)), cb + Math.sin(ang) * rj * (1 + Math.abs(uy))]); }
      polys.push(pts);
    }
    this.polys(polys, st);
  }
  scratches(cx, cb, rad, n, len, st, w = 0.006) {
    const list = [];
    for (let i = 0; i < n; i++) {
      const a = cx + (this.rand() - 0.5) * 2 * rad, b = cb + (this.rand() - 0.5) * 2 * rad, ang = this.rand() * TAU, l = len * (0.3 + this.rand());
      list.push([[a, b], [a + Math.cos(ang) * l * 0.5, b + Math.sin(ang) * l * 0.5 + (this.rand() - 0.5) * l * 0.1], [a + Math.cos(ang) * l, b + Math.sin(ang) * l]]);
    }
    this.strokes(list, w, st);
  }
  hatch(a, b, w, h, ang = 0) {
    const c = Math.cos(ang), s = Math.sin(ang), P = (x, y) => [a + x * c - y * s, b + x * s + y * c];
    const pts = [P(-w / 2, -h / 2), P(w / 2, -h / 2), P(w / 2, h / 2), P(-w / 2, h / 2)];
    this.strokes([pts], 0.016, { A: [14, 16, 18, 0.6], H: [66, 1], O: [130, 0.8] }, { closed: true });
    this.dots([P(-w / 2 + 0.04, -h / 2 + 0.04), P(w / 2 - 0.04, -h / 2 + 0.04), P(w / 2 - 0.04, h / 2 - 0.04), P(-w / 2 + 0.04, h / 2 - 0.04)].map(([x, y]) => [x, y, 0.013]), { H: [175, 1], A: [40, 40, 40, 0.5] });
    this.poly([P(-w * 0.25, -0.03), P(w * 0.25, -0.03), P(w * 0.25, 0.03), P(-w * 0.25, 0.03)], { A: [25, 25, 25, 0.35] });
  }
  finish() {
    const S = this.S, c = this.ctx, R = this.rand, base = this.base;
    const A = c.A.getImageData(0, 0, S, S);
    for (let i = 0; i < A.data.length; i += 4) { const n = (R() - 0.5) * 9; A.data[i] += n; A.data[i + 1] += n; A.data[i + 2] += n; }
    c.A.putImageData(A, 0, 0);
    const H = c.H.getImageData(0, 0, S, S).data, Rr = c.R.getImageData(0, 0, S, S).data, Mm = c.M.getImageData(0, 0, S, S).data, O = c.O.getImageData(0, 0, S, S).data;
    const orm = new ImageData(S, S), nrm = new ImageData(S, S), od = orm.data, nd = nrm.data, k = (base.bump ?? 2.4) * (S / 1024);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      od[i] = O[i]; od[i + 1] = clamp(Rr[i] + (R() - 0.5) * 10, 8, 255); od[i + 2] = Mm[i]; od[i + 3] = 255;
      const xl = x > 0 ? i - 4 : i, xr = x < S - 1 ? i + 4 : i, yu = y > 0 ? i - S * 4 : i, yd = y < S - 1 ? i + S * 4 : i;
      const nx = -(H[xr] - H[xl]) / 255 * k, ny = (H[yd] - H[yu]) / 255 * k, l = Math.hypot(nx, ny, 1);
      nd[i] = (nx / l * 0.5 + 0.5) * 255; nd[i + 1] = (ny / l * 0.5 + 0.5) * 255; nd[i + 2] = (1 / l * 0.5 + 0.5) * 255; nd[i + 3] = 255;
    }
    const out = {
      map: canvasTexture(S, S, (x) => x.drawImage(c.A.canvas, 0, 0)),
      orm: canvasTexture(S, S, (x) => x.putImageData(orm, 0, 0), { srgb: false }),
      normal: canvasTexture(S, S, (x) => x.putImageData(nrm, 0, 0), { srgb: false }),
      emissive: c.E ? canvasTexture(S, S, (x) => x.drawImage(c.E.canvas, 0, 0)) : null,
    };
    for (const t of Object.values(out)) if (t) t.anisotropy = 4;
    for (const kk in c) c[kk].canvas.width = 1;
    return out;
  }
}
function textMask(str, F, rand, wear = 0.35, font = FONT) {
  const c = document.createElement('canvas'), x = c.getContext('2d');
  const f = `700 ${F}px ${font}`; x.font = f;
  const sp = F * 0.08, w = Math.ceil(x.measureText(str).width + sp * str.length + F * 0.5), h = Math.ceil(F * 1.15);
  c.width = w; c.height = h;
  x.font = f; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff';
  try { x.letterSpacing = `${sp}px`; } catch { /* ältere Browser */ }
  x.fillText(str, w / 2, h / 2 + F * 0.05);
  // Schablonen-Stege
  x.globalCompositeOperation = 'destination-out';
  x.fillStyle = '#000';
  const cw = (w - F * 0.5) / Math.max(1, str.length);
  for (let i = 0; i < str.length; i++) if (/[A-Z0-9]/.test(str[i]) && rand() < 0.6) x.fillRect(F * 0.25 + cw * (i + 0.5) - F * 0.03, h * (0.3 + rand() * 0.4), F * 0.06, F * 0.08);
  // Abnutzung
  const n = Math.round(w * h / 40 * wear);
  for (let i = 0; i < n; i++) { x.globalAlpha = 0.25 + rand() * 0.75; x.fillRect(rand() * w, rand() * h, 1 + rand() * F * 0.07, 1 + rand() * F * 0.04); }
  x.globalAlpha = 0.6; x.lineWidth = Math.max(1, F * 0.02); x.strokeStyle = '#000';
  for (let i = 0; i < 3 * wear * str.length; i++) { const a = rand() * w, b = rand() * h; x.beginPath(); x.moveTo(a, b); x.lineTo(a + (rand() - 0.5) * F * 2, b + (rand() - 0.5) * F * 0.3); x.stroke(); }
  c.unit = F * 0.72; // Versalhöhe ≈ 0.72·F
  return c;
}
// Fremdartige Glyphen statt Schrift (UFOs)
function glyphMask(n, F, rand, seed) {
  const R2 = rng(seed), c = document.createElement('canvas'), x = c.getContext('2d');
  c.width = Math.ceil(n * F * 1.25 + F * 0.3); c.height = Math.ceil(F * 1.3);
  x.strokeStyle = '#fff'; x.fillStyle = '#fff'; x.lineWidth = Math.max(1.5, F * 0.1); x.lineCap = 'round'; x.lineJoin = 'round';
  for (let g = 0; g < n; g++) {
    const ox = F * 0.3 + g * F * 1.25, oy = F * 0.15, N = (i, j) => [ox + i * F * 0.5, oy + j * F * 0.5];
    const segs = 2 + ((R2() * 3) | 0);
    x.beginPath();
    let [i, j] = [(R2() * 3) | 0, (R2() * 3) | 0];
    x.moveTo(...N(i, j));
    for (let s = 0; s < segs; s++) { i = clamp(i + ((R2() * 3) | 0) - 1, 0, 2); j = clamp(j + ((R2() * 3) | 0) - 1 || 1, 0, 2); x.lineTo(...N(i, j)); }
    x.stroke();
    if (R2() < 0.5) { x.beginPath(); x.arc(ox + F * 0.5, oy + F * 0.5, F * 0.42, R2() * TAU, R2() * TAU + 1.6); x.stroke(); }
    if (R2() < 0.6) { x.beginPath(); x.arc(...N((R2() * 3) | 0, (R2() * 3) | 0), F * 0.09, 0, TAU); x.fill(); }
  }
  x.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < c.width * c.height / 60; k++) { x.globalAlpha = rand(); x.fillRect(rand() * c.width, rand() * c.height, 1 + rand() * 2, 1 + rand() * 2); }
  c.unit = F;
  return c;
}
function tint(mask, color) {
  const c = document.createElement('canvas'); c.width = mask.width; c.height = mask.height;
  const x = c.getContext('2d'); x.drawImage(mask, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  return c;
}
function blob(cx, cy, r, R, n = 11, sa = 1, sb = 1) { const p = []; for (let i = 0; i < n; i++) { const a = (i / n) * TAU, k = r * (0.6 + R() * 0.55); p.push([cx + Math.cos(a) * k * sa, cy + Math.sin(a) * k * sb]); } return p; }

const TEX = new Map();
function typeTex(key, S, base, paint) {
  const k = key + '@' + S;
  if (!TEX.has(k)) { const P = new Painter(S, hash(key), base); paint(P); TEX.set(k, P.finish()); }
  return TEX.get(k);
}
const SMALL = {};
function glowTex() {
  return SMALL.glow || (SMALL.glow = canvasTexture(128, 128, (c, w, h) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.75)'); g.addColorStop(0.65, 'rgba(255,255,255,0.2)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }, { wrap: false }));
}
function plumeTex() {
  return SMALL.plume || (SMALL.plume = canvasTexture(64, 256, (c, w, h) => {
    const g = c.createLinearGradient(0, h, 0, 0);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 5; i++) { c.fillStyle = `rgba(255,255,255,${0.25 - i * 0.04})`; c.fillRect(0, h - (i + 1) * h * 0.13, w, h * 0.035); }
  }, { wrap: false }));
}

// Embleme in Weltkoordinaten (Kreis, Sechseck, Winkel – eigenes AEGIS-Abzeichen)
function emblem(P, a, b, r, up, low = false) {
  const [ua, ub] = up, ra = [-ub, ua];
  const pt = (x, y) => [a + ra[0] * x + ua * y, b + ra[1] * x + ub * y];
  const circ = (rad, n = 24) => Array.from({ length: n }, (_, i) => pt(Math.cos(i / n * TAU) * rad, Math.sin(i / n * TAU) * rad));
  const al = low ? 0.55 : 0.92;
  P.poly(circ(r), { A: low ? [70, 78, 88, al] : [26, 40, 66, al], H: [134, 1] });
  P.strokes([circ(r * 0.93)], r * 0.07, { A: low ? [120, 128, 136, al] : [205, 208, 212, al] }, { closed: true });
  P.poly(Array.from({ length: 6 }, (_, i) => pt(Math.cos(i / 6 * TAU + Math.PI / 6) * r * 0.62, Math.sin(i / 6 * TAU + Math.PI / 6) * r * 0.62)), { A: low ? [96, 104, 112, al] : [176, 182, 188, al] });
  P.poly([pt(0, r * 0.5), pt(r * 0.38, -r * 0.34), pt(r * 0.2, -r * 0.34), pt(0, r * 0.1), pt(-r * 0.2, -r * 0.34), pt(-r * 0.38, -r * 0.34)], { A: low ? [60, 66, 72, al] : [214, 110, 40, al] });
}

// =====================================================================
// Materialien
// =====================================================================
function damagePatch(mat, dmg, seed) {
  if (!(dmg > 0)) return mat;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.(sh, r);
    sh.uniforms.uDmg = { value: dmg }; sh.uniforms.uDmgSeed = { value: (seed % 97) * 1.37 };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vDmgP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDmgP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vDmgP; uniform float uDmg; uniform float uDmgSeed;
      float dmgH(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float dmgN(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(dmgH(i), dmgH(i + vec3(1,0,0)), f.x), mix(dmgH(i + vec3(0,1,0)), dmgH(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(dmgH(i + vec3(0,0,1)), dmgH(i + vec3(1,0,1)), f.x), mix(dmgH(i + vec3(0,1,1)), dmgH(i + vec3(1,1,1)), f.x), f.y), f.z); }
      float dmgF(vec3 p){ return 0.55 * dmgN(p) + 0.28 * dmgN(p * 2.3 + 7.1) + 0.17 * dmgN(p * 5.1 + 3.3); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float dmgV = dmgF(vDmgP * 0.85 + uDmgSeed);
        float dmgT = 1.0 - uDmg * 0.62;
        float dmgBurn = smoothstep(dmgT - 0.02, dmgT + 0.1, dmgV);
        float dmgCore = smoothstep(dmgT + 0.08, dmgT + 0.14, dmgV);
        float dmgHole = step(0.985 - uDmg * 0.03, dmgN(vDmgP * 9.0 + uDmgSeed)) * step(0.3, uDmg);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.045, 0.04), dmgBurn * 0.85);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012), max(dmgCore, dmgHole));`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.95, dmgBurn);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.15, dmgBurn);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.3, 0.05) * smoothstep(0.75, 1.0, dmgBurn - dmgCore) * step(0.55, uDmg) * 0.18;`);
  };
  mat.customProgramCacheKey = () => 'craftDmg' + mat.type;
  return mat;
}
function surfMat(tex, o, extra = {}, phys = {}) {
  const C = o.hi ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const m = new C({ roughnessMap: tex.orm, metalnessMap: tex.orm, aoMap: tex.orm, aoMapIntensity: 1, normalMap: tex.normal, roughness: 1, metalness: 1, ...extra, ...(o.hi ? phys : {}) });
  return damagePatch(m, o.damage, o.seed);
}
function glassMat(o, tintCol = 0x6d8796, att = 0xc9b07a) {
  if (o.transmission) return new THREE.MeshPhysicalMaterial({ color: tintCol, metalness: 0, roughness: 0.04, transmission: 0.82, thickness: 0.05, ior: 1.52, attenuationColor: att, attenuationDistance: 0.6, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.3, specularIntensity: 1 });
  const C = o.hi ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  return new C({ color: 0x1a2731, metalness: 0.6, roughness: 0.06, transparent: true, opacity: 0.78, ...(o.hi ? { clearcoat: 1, clearcoatRoughness: 0.04 } : {}) });
}
const lightMat = (hex, k = 3) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), toneMapped: false });
const glowMat = (hex, k = 1.6, map = plumeTex()) => new THREE.MeshBasicMaterial({ map, color: new THREE.Color(hex).multiplyScalar(k), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
function mk(parent, geo, mat, o, L, uvM, cast = true) {
  if (!geo) return null;
  if (L) projectUV(geo, L, uvM);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast && o.shadows; m.receiveShadow = o.shadows && !mat.isMeshBasicMaterial;
  parent.add(m); return m;
}
// Triebwerks-Glühen: Düsenscheibe + Abgasfahne (Achse +z), skaliert über Schub
function engineGlowGeo(r, len) {
  const disc = new THREE.CircleGeometry(r, 24);
  const cone = new THREE.ConeGeometry(r * 0.82, len, 20, 1, true); cone.rotateX(Math.PI / 2); cone.translate(0, 0, len / 2);
  const cone2 = new THREE.ConeGeometry(r * 0.45, len * 0.55, 16, 1, true); cone2.rotateX(Math.PI / 2); cone2.translate(0, 0, len * 0.275);
  return merge([ni(disc, true), ni(cone, true), ni(cone2, true)], true);
}
function lightsBundle(parent, list, o, sep = o.hi) {
  // list: [{p:[x,y,z], color, kind, phase, r}] – Dauerlichter ('nav') teilen sich ein Mesh
  const out = [];
  if (sep) {
    const geoCache = new Map(), nav = list.filter((L) => L.kind === 'nav');
    if (nav.length) { out.push(...lightsBundle(parent, nav, o, false)); out[out.length - 1].kind = 'nav'; }
    for (const L of list) {
      if (L.kind === 'nav') continue;
      const r = L.r || 0.07; if (!geoCache.has(r)) geoCache.set(r, new THREE.SphereGeometry(r, 10, 8));
      const m = new THREE.Mesh(geoCache.get(r).clone(), lightMat(L.color, L.k || 3)); m.position.set(...L.p); parent.add(m);
      out.push({ object: m, color: new THREE.Color(L.color).multiplyScalar(L.k || 3), kind: L.kind, phase: L.phase || 0 });
    }
    geoCache.forEach((g) => g.dispose());
    return out;
  }
  const parts = [], col = [];
  for (const L of list) {
    const g = ni(new THREE.SphereGeometry(L.r || 0.07, 6, 4)); g.translate(...L.p);
    const c = new THREE.Color(L.color).multiplyScalar(L.k || 3), n = g.attributes.position.count;
    for (let i = 0; i < n; i++) col.push(c.r, c.g, c.b);
    parts.push(g);
  }
  if (!parts.length) return out;
  const g = merge(parts); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })); parent.add(m);
  out.push({ object: m, color: new THREE.Color(1, 1, 1), kind: 'merged', phase: 0 });
  return out;
}

// Abziehbilder (Kennung, AEGIS-Schriftzug) – kleine Textur pro Kennung, gecacht
function decalTex(code, ink, low = false) {
  const k = `decal:${code}:${ink.join()}:${low}`;
  if (SMALL[k]) return SMALL[k];
  const R = rng(hash(k));
  SMALL[k] = canvasTexture(512, 512, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    const put = (mask, cx, cy, hh) => { const t = tint(mask, css(ink)); const s = hh / t.height; c.drawImage(t, cx - t.width * s / 2, cy - t.height * s / 2, t.width * s, t.height * s); };
    put(textMask(code, 150, R, 0.4), 256, 128, 200); // obere Hälfte: Kennung
    put(textMask('AEGIS', 90, R, 0.5), 335, 384, 105); // unten: Schriftzug + Abzeichen
    const cx = 74, cy = 384, r = 58;
    c.fillStyle = low ? 'rgba(70,78,88,0.9)' : 'rgba(26,40,66,0.95)'; c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fill();
    c.strokeStyle = low ? 'rgba(130,136,142,0.9)' : 'rgba(210,212,215,0.95)'; c.lineWidth = 7; c.beginPath(); c.arc(cx, cy, r - 6, 0, TAU); c.stroke();
    c.fillStyle = low ? 'rgba(100,106,112,0.95)' : 'rgba(178,184,190,0.95)'; c.beginPath();
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + Math.PI / 6; c.lineTo(cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62); } c.fill();
    c.fillStyle = low ? 'rgba(60,66,72,0.95)' : 'rgba(214,110,40,0.95)'; c.beginPath();
    [[0, -0.5], [0.38, 0.34], [0.2, 0.34], [0, -0.1], [-0.2, 0.34], [-0.38, 0.34]].forEach(([x, y]) => c.lineTo(cx + x * r, cy + y * r)); c.fill();
    c.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 2600; i++) { c.globalAlpha = R(); c.fillRect(R() * w, R() * h, 1 + R() * 3, 1 + R() * 2); }
  }, { wrap: false });
  SMALL[k].anisotropy = 4;
  return SMALL[k];
}
function decalQuad(w, h, cell /* 0 = Kennung, 1 = Abzeichen */, side, m) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, cell === 0 ? 0.5 + uv.getY(i) * 0.5 : uv.getY(i) * 0.5);
  g.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
  const out = ni(g, true); if (m) out.applyMatrix4(m); return out;
}
const decalMat = (tex) => new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.35, roughness: 0.62, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });

// =====================================================================
// Abfangjäger
// =====================================================================
const JETS = {
  falcon: {
    name: 'Falke', prefix: 'FK', len: 14, color: [128, 135, 142, 1], camo: [98, 106, 115], accent: [214, 104, 32], rough: 0.5, metal: 0.25,
    ink: [44, 50, 58, 0.95], glow: 0xff9440, glass: [0x6f8796, 0xb7a68a],
    ext: { x: [-5.3, 5.3], y: [-1.3, 3.4], z: [-7.45, 7.75] },
    fus: [[-7.25, 0, 0, 0, -0.06, 2], [-6.9, 0.12, 0.11, 0.1, -0.05, 2], [-6.3, 0.27, 0.25, 0.22, -0.03, 2.1], [-5.4, 0.43, 0.42, 0.36, 0, 2.2], [-4.4, 0.55, 0.56, 0.46, 0.04, 2.3],
      [-3.3, 0.62, 0.62, 0.52, 0.06, 2.4], [-2.2, 0.72, 0.6, 0.56, 0.06, 2.6], [-1.0, 0.86, 0.57, 0.6, 0.05, 3], [0.6, 0.92, 0.55, 0.6, 0.04, 3], [2.6, 0.88, 0.52, 0.56, 0.04, 2.8],
      [4.6, 0.74, 0.5, 0.5, 0.04, 2.4], [6.0, 0.62, 0.48, 0.47, 0.03, 2.2], [6.75, 0.57, 0.46, 0.45, 0.03, 2.1]],
    spine: [[-2.6, 0.05, 0.04, 0.05, 0.42, 2.2], [-2.1, 0.3, 0.36, 0.3, 0.42, 2.4], [0, 0.34, 0.33, 0.3, 0.42, 2.6], [3, 0.3, 0.27, 0.3, 0.42, 2.6], [5.6, 0.22, 0.17, 0.3, 0.42, 2.4], [6.4, 0.04, 0.03, 0.05, 0.4, 2]],
    canopy: [[-4.8, 0.02, 0.02, 0.05, 0.52, 2], [-4.45, 0.26, 0.2, 0.05, 0.52, 2.1], [-4.0, 0.38, 0.33, 0.05, 0.52, 2.2], [-3.4, 0.43, 0.43, 0.05, 0.52, 2.2], [-2.8, 0.41, 0.42, 0.05, 0.52, 2.2], [-2.3, 0.32, 0.33, 0.05, 0.5, 2.2], [-1.95, 0.12, 0.12, 0.05, 0.47, 2.2]],
    bow: -4.0, seat: -3.3,
    wing: [[0.75, -1.6], [4.75, 1.75], [4.75, 2.85], [0.75, 3.5]], wingY: -0.1, wingT: 0.24, wingTip: 0.42, dih: -0.035,
    lerx: [[0.55, -3.7], [1.1, -1.55], [0.6, -1.55]], lerxY: -0.04,
    htail: [[0.5, 4.75], [2.65, 6.2], [2.65, 6.95], [0.5, 7.0]], htailY: 0.02,
    fins: [{ x: 0, cant: 0, t: 0.16, pts: [[3.6, 0.45], [5.75, 3.1], [6.55, 3.1], [6.95, 0.45]] }],
    ventral: [{ x: 0.42, cant: 0.5, t: 0.08, pts: [[4.7, -0.3], [5.4, -0.85], [6.0, -0.85], [6.2, -0.3]] }],
    intakes: [{ x: 0.98, y: -0.14, z0: -2.55, z1: 0.8, w: 0.3, h: 0.4, n: 3.2 }],
    nozzles: [{ x: 0, y: 0.03, z: 6.6, r: 0.56 }],
    pylons: [2.7], tip: 4.85, mLen: 2.9, mR: 0.085,
    gun: [0.5, 0.2, -4.2],
    gear: { nose: { z: -4.6, r: 0.27 }, main: { x: 1.02, z: 1.3, r: 0.36 }, ground: -1.85 },
    panelZ: [-6.0, -5.0, -2.35, -1.1, 0.4, 1.9, 3.3, 4.7, 5.9],
  },
  phantom: {
    name: 'Phantom', prefix: 'PH', len: 16, color: [70, 80, 92, 1], camo: [56, 64, 75], accent: [40, 190, 225], rough: 0.42, metal: 0.35, emissive: true,
    ink: [150, 160, 172, 0.9], glow: 0x6fd0ff, glass: [0x7a7a62, 0xd2a640],
    ext: { x: [-6.0, 6.0], y: [-1.4, 3.0], z: [-8.4, 8.05] },
    fus: [[-8.15, 0, 0, 0, -0.03, 2], [-7.6, 0.2, 0.11, 0.09, -0.02, 1.7], [-6.6, 0.46, 0.25, 0.2, 0, 1.8], [-5.3, 0.72, 0.4, 0.33, 0.03, 2.0], [-3.9, 0.95, 0.52, 0.42, 0.05, 2.2],
      [-2.4, 1.3, 0.54, 0.5, 0.05, 2.6], [-0.6, 1.58, 0.55, 0.55, 0.04, 3.0], [2.0, 1.66, 0.5, 0.55, 0.03, 3.2], [4.6, 1.52, 0.46, 0.5, 0.03, 3.2], [6.4, 1.36, 0.43, 0.46, 0.03, 3.0], [7.0, 1.28, 0.42, 0.44, 0.03, 3.0]],
    spine: [[-3.3, 0.05, 0.04, 0.05, 0.36, 2.4], [-2.8, 0.42, 0.3, 0.3, 0.36, 2.6], [0, 0.52, 0.3, 0.3, 0.37, 3], [4, 0.46, 0.22, 0.3, 0.35, 3], [6.6, 0.3, 0.12, 0.3, 0.33, 2.6], [7.05, 0.05, 0.04, 0.04, 0.32, 2]],
    canopy: [[-6.1, 0.02, 0.02, 0.05, 0.44, 2], [-5.7, 0.3, 0.2, 0.05, 0.44, 2.0], [-5.1, 0.44, 0.34, 0.05, 0.44, 2.1], [-4.4, 0.48, 0.42, 0.05, 0.44, 2.2], [-3.7, 0.45, 0.4, 0.05, 0.43, 2.2], [-3.15, 0.32, 0.28, 0.05, 0.4, 2.2], [-2.85, 0.12, 0.1, 0.05, 0.38, 2.2]],
    bow: -5.2, seat: -4.4,
    wing: [[1.3, -2.3], [5.6, 2.9], [5.6, 3.75], [1.3, 5.4]], wingY: -0.06, wingT: 0.22, wingTip: 0.36, dih: 0,
    lerx: [[0.5, -6.0], [1.45, -2.3], [0.9, -2.3]], lerxY: -0.02,
    htail: [[1.25, 5.7], [3.55, 7.05], [3.55, 7.85], [1.25, 7.75]], htailY: 0.0,
    fins: [{ x: 1.05, cant: 0.4, t: 0.15, pts: [[4.2, 0.3], [6.4, 2.55], [7.25, 2.55], [7.55, 0.3]] }, { x: -1.05, cant: 0.4, t: 0.15, pts: [[4.2, 0.3], [6.4, 2.55], [7.25, 2.55], [7.55, 0.3]] }],
    ventral: [],
    intakes: [{ x: 1.22, y: -0.22, z0: -3.6, z1: 0.2, w: 0.36, h: 0.46, n: 3.4 }],
    nozzles: [{ x: -0.64, y: 0.02, z: 6.85, r: 0.5 }, { x: 0.64, y: 0.02, z: 6.85, r: 0.5 }],
    pylons: [2.3, 3.3, 4.3], tip: 0, mLen: 3.0, mR: 0.09,
    gun: [0.78, 0.12, -4.7],
    gear: { nose: { z: -5.6, r: 0.28 }, main: { x: 1.4, z: 1.7, r: 0.38 }, ground: -1.9 },
    panelZ: [-7.0, -5.8, -3.0, -1.5, 0.5, 2.2, 3.9, 5.5, 6.6],
  },
};
const quadPt = (Q, sx, s, c) => { const le = [lerp(Q[0][0], Q[1][0], s), lerp(Q[0][1], Q[1][1], s)], te = [lerp(Q[3][0], Q[2][0], s), lerp(Q[3][1], Q[2][1], s)]; return [sx * lerp(le[0], te[0], c), lerp(le[1], te[1], c)]; };
function wingAt(J, x) { const W = J.wing, s = clamp((Math.abs(x) - W[0][0]) / (W[1][0] - W[0][0]), 0, 1); return { le: lerp(W[0][1], W[1][1], s), te: lerp(W[3][1], W[2][1], s), y: J.wingY + (Math.abs(x) - W[0][0]) * J.dih, t: J.wingT * lerp(1, J.wingTip, s) }; }

function paintJet(P, J, L) {
  const R = P.rand, rr = (a, b) => P.rr(a, b);
  const { top, bot, side } = L, f = (z) => stationAt(J.fus, z);
  const bare = { A: [178, 183, 188, 1], M: [235, 1], R: [72, 1], H: [114, 1] }, primer = { A: [134, 140, 96, 1], M: [25, 1], R: [175, 1], H: [119, 1] };
  const wings = [[J.wing, 1], [J.wing, -1], [J.htail, 1], [J.htail, -1]];
  // 1) Grundton: Wolken, Tarnflecken, Ausbleichen
  for (const r of [top, bot, side]) {
    P.use(r);
    for (let i = 0; i < 150; i++) P.soft(rr(r.al, r.ah), rr(r.bl, r.bh), rr(0.3, 1.5), rr(0.3, 1.5), R() < 0.5 ? { A: [255, 255, 255, 0.045], R: [110, 0.15] } : { A: [8, 10, 12, 0.05], R: [175, 0.15] }, R() * 3);
    if (r !== bot) for (let i = 0; i < 12; i++) P.poly(blob(rr(r.al, r.ah), rr(r.bl, r.bh), rr(0.8, 2.0), R, 12), { A: [...J.camo, 0.75], blur: Math.max(1.5, r.ppm * 0.035) });
  }
  P.use(top); P.poly([[top.al, top.bl], [top.ah, top.bl], [top.ah, top.bh], [top.al, top.bh]], { A: [255, 250, 240, 0.05], R: [215, 0.12] });
  // 2) Fugen und Nieten
  const fusLines = (r) => {
    const lines = [];
    if (r === side) {
      for (const z of J.panelZ) { const s = f(z); lines.push([[s[4] - s[3] * 0.85, z], [s[4] + s[2] * 0.85, z]]); }
      const zs = []; for (let z = J.fus[1][0]; z <= J.fus[J.fus.length - 1][0]; z += 0.4) zs.push(z);
      lines.push(zs.map((z) => [f(z)[4] + 0.06, z])); lines.push(zs.filter((z) => z > J.canopy[J.canopy.length - 1][0]).map((z) => [f(z)[4] + f(z)[2] * 0.55, z]));
      for (const F of J.fins) { const p = F.pts, h = (k) => [lerp(p[0][1], p[1][1], k), lerp(lerp(p[0][0], p[3][0], 0.72), lerp(p[1][0], p[2][0], 0.72), k)]; lines.push([h(0.08), h(0.9)]); lines.push([[p[0][1] + 0.35, p[0][0] + 0.4], [p[0][1] + 0.35, p[3][0] - 0.1]]); }
    } else {
      for (const z of J.panelZ) { const w = f(z)[1] * 0.97; lines.push([[-w, z], [w, z]]); }
      const zs = []; for (let z = J.canopy[J.canopy.length - 1][0]; z <= J.fus[J.fus.length - 1][0]; z += 0.4) zs.push(z);
      for (const sx of [-1, 1]) lines.push(zs.map((z) => [sx * f(z)[1] * 0.42, z]));
      lines.push([[0, J.fus[1][0] + 0.3], [0, r === top ? J.canopy[0][0] - 0.1 : J.fus[J.fus.length - 1][0]]]);
      for (const [Q, sx] of wings) {
        for (const s of [0.28, 0.55, 0.8]) lines.push([quadPt(Q, sx, s, 0.04), quadPt(Q, sx, s, 0.96)]);
        for (const c of [0.12, 0.5]) lines.push([quadPt(Q, sx, 0, c), quadPt(Q, sx, 1, c)]);
      }
    }
    return lines;
  };
  for (const r of [top, bot, side]) { P.use(r); P.panels(fusLines(r), { w: 0.018, rivet: 0.12 }); }
  // Ruderflächen (Klappen, Querruder, Höhenruder)
  for (const r of [top, bot]) {
    P.use(r);
    const cs = [];
    for (const sx of [-1, 1]) { const Q = J.wing; cs.push([quadPt(Q, sx, 0.04, 0.76), quadPt(Q, sx, 0.5, 0.76), quadPt(Q, sx, 0.5, 1), quadPt(Q, sx, 0.04, 1)], [quadPt(Q, sx, 0.52, 0.74), quadPt(Q, sx, 0.93, 0.74), quadPt(Q, sx, 0.93, 1), quadPt(Q, sx, 0.52, 1)], [quadPt(J.htail, sx, 0.1, 0.6), quadPt(J.htail, sx, 0.95, 0.6), quadPt(J.htail, sx, 0.95, 1), quadPt(J.htail, sx, 0.1, 1)]); }
    P.strokes(cs, 0.028, { A: [10, 12, 14, 0.7], H: [50, 1], O: [100, 0.9] }, { closed: true });
    P.polys(cs, { A: [0, 0, 0, 0.05], R: [185, 0.3] });
  }
  // 3) Wartungsklappen
  P.use(side);
  for (const [y, z, w, h] of [[0.1, -5.6, 0.32, 0.45], [-0.2, -1.8, 0.28, 0.5], [0.15, 1.4, 0.3, 0.55], [-0.15, 3.6, 0.26, 0.4], [0.25, 5.2, 0.24, 0.34]]) P.hatch(y, z, w, h);
  P.use(top); for (const [x, z] of [[0.3, -5.6], [-0.35, 2.2], [0.4, 4.1]]) P.hatch(x, z, 0.3, 0.42);
  P.use(bot); for (const [x, z] of [[0, -2.8], [0.45, 4.0], [-0.45, 4.0], [0, 5.5]]) P.hatch(x, z, 0.36, 0.5);
  // Fahrwerksschächte
  const G = J.gear;
  P.strokes([[[-0.22, G.nose.z - 0.75], [0.22, G.nose.z - 0.75], [0.22, G.nose.z + 0.6], [-0.22, G.nose.z + 0.6]],
    ...[-1, 1].map((s) => [[s * (G.main.x - 0.35), G.main.z - 0.95], [s * (G.main.x + 0.2), G.main.z - 0.95], [s * (G.main.x + 0.2), G.main.z + 0.8], [s * (G.main.x - 0.35), G.main.z + 0.8]])],
  0.026, { A: [12, 12, 12, 0.7], H: [50, 1], O: [90, 1] }, { closed: true });
  // 4) Blendschutz vor der Kanzel, Rumpfrücken
  P.use(top);
  const ag = []; for (let z = J.fus[1][0] + 0.5; z <= J.canopy[0][0] + 0.05; z += 0.15) ag.push(z);
  P.poly([...ag.map((z) => [f(z)[1] * 0.55, z]), ...ag.reverse().map((z) => [-f(z)[1] * 0.55, z])], { A: [36, 40, 44, 0.85], R: [228, 1], M: [15, 1] });
  // 5) Trittflächen, Hinweise
  for (const sx of [-1, 1]) {
    const Q = J.wing, wk = [quadPt(Q, sx, 0.0, 0.18), quadPt(Q, sx, 0.2, 0.18), quadPt(Q, sx, 0.2, 0.62), quadPt(Q, sx, 0.0, 0.62)];
    P.poly(wk, { A: [30, 32, 34, 0.32], R: [235, 0.9], M: [10, 0.8] });
    P.strokes([wk], 0.022, { A: [20, 20, 20, 0.8] }, { closed: true, dash: [0.12, 0.08] });
    const [a, b] = quadPt(Q, sx, 0.3, 0.88); P.text('NICHT BETRETEN', a, b, 0.07, [1, 0], { A: [20, 22, 24, 0.85] });
    const [a2, b2] = quadPt(J.htail, sx, 0.45, 0.82); P.text('NICHT BETRETEN', a2, b2, 0.06, [1, 0], { A: [20, 22, 24, 0.8] });
  }
  // 6) Hoheitszeichen / Schriftzüge
  { const [a, b] = quadPt(J.wing, -1, 0.55, 0.4); P.text('AEGIS', a, b, 0.55, [1, 0], { A: [...J.ink.slice(0, 3), 0.85], H: [132, 1] }, 0.45); }
  { const [a, b] = quadPt(J.wing, 1, 0.58, 0.42); emblem(P, a, b, 0.48, [0, -1], J.prefix === 'PH'); }
  P.use(bot);
  { const [a, b] = quadPt(J.wing, -1, 0.5, 0.42); P.text('AEGIS', a, b, 0.65, [-1, 0], { A: [...J.ink.slice(0, 3), 0.8] }, 0.55); }
  { const [a, b] = quadPt(J.wing, 1, 0.55, 0.42); emblem(P, a, b, 0.5, [0, -1], J.prefix === 'PH'); }
  P.text('VORSICHT KANONE', 0.45, J.gun[2] + 0.6, 0.06, [-1, 0], { A: [170, 30, 20, 0.85] });
  // Flügelspitzen- und Seitenleitwerks-Farbband
  P.use(top);
  for (const sx of [-1, 1]) P.poly([quadPt(J.wing, sx, 0.93, 0), quadPt(J.wing, sx, 1.02, 0), quadPt(J.wing, sx, 1.02, 1), quadPt(J.wing, sx, 0.93, 1)], { A: [...J.accent, 0.8] });
  P.use(side);
  for (const F of J.fins) {
    const p = F.pts, k0 = 0.84;
    P.poly([[lerp(p[0][1], p[1][1], k0), lerp(p[0][0], p[1][0], k0)], [p[1][1] + 0.05, p[1][0]], [p[2][1] + 0.05, p[2][0] + 0.1], [lerp(p[3][1], p[2][1], k0), lerp(p[3][0], p[2][0], k0)]], { A: [...J.accent, 0.82] });
  }
  // Warnzeichen: Lufteinlass, Rettung, Schleudersitz (seitlich, symmetrisch)
  for (const it of J.intakes) {
    const a = it.y + it.h + 0.12, b = it.z0 + 0.35;
    P.poly([[a, b - 0.16], [a + 0.28, b], [a, b + 0.16]], { A: [190, 30, 22, 0.9] });
    P.poly([[a + 0.05, b - 0.09], [a + 0.2, b], [a + 0.05, b + 0.09]], { A: [235, 235, 228, 0.9] });
  }
  { const s = f(J.seat), a = s[4] + s[2] * 0.45, b = J.seat + 0.3;
    P.poly([[a, b + 0.45], [a + 0.06, b + 0.45], [a + 0.06, b - 0.05], [a + 0.13, b - 0.05], [a + 0.03, b - 0.22], [a - 0.07, b - 0.05], [a, b - 0.05]], { A: [230, 196, 30, 0.9] });
    P.poly([[a - 0.1, b + 0.7], [a + 0.12, b + 0.58], [a - 0.1, b + 0.46]], { A: [200, 30, 25, 0.9] }); }
  // Laufspuren entlang der Anströmung (Regen, Staub, Hydraulik)
  for (const r of [top, side]) {
    P.use(r);
    for (let i = 0; i < 110; i++) { const a = rr(r.al, r.ah) * (r === top ? 0.9 : 0.35), b = rr(r.bl + 2, r.bh - 1); P.streak(a, b, r === side ? -0.12 : 0, 1, rr(0.4, 2.2), rr(0.02, 0.07), rr(0.06, 0.16), { A: [38, 34, 28, rr(0.06, 0.16)], R: [195, 0.15] }); }
  }
  // 7) Ruß: Düsen, Bordkanone, Raketenstarts
  const zt = J.nozzles[0].z, soot = { A: [6, 6, 6, 0.9], R: [235, 0.8], M: [30, 0.6], O: [150, 0.6] };
  P.use(top); for (const n of J.nozzles) { P.soft(n.x, zt + 0.15, n.r * 1.9, 1.5, soot); P.streak(n.x, zt + 0.2, 0, -1, 2.6, n.r * 2.4, n.r * 1.2, { A: [8, 8, 8, 0.7], R: [230, 0.6] }); }
  P.use(bot); for (const n of J.nozzles) { P.soft(n.x, zt + 0.15, n.r * 2.0, 1.6, soot); P.streak(n.x, zt + 0.2, 0, -1, 3.0, n.r * 2.4, n.r * 1.2, { A: [8, 8, 8, 0.75], R: [230, 0.6] }); }
  P.use(side); for (const n of J.nozzles) { P.soft(n.y, zt + 0.15, n.r * 1.7, 1.5, soot); P.streak(n.y, zt + 0.2, 0, -1, 2.6, n.r * 2.2, n.r * 1.0, { A: [8, 8, 8, 0.7], R: [230, 0.6] }); }
  P.streak(J.gun[1], J.gun[2], -0.15, 1, 1.9, 0.12, 0.55, { A: [8, 8, 8, 0.85], R: [230, 0.8], M: [30, 0.6] });
  P.dots([[J.gun[1], J.gun[2], 0.045]], { A: [5, 5, 5, 1], H: [40, 1] });
  P.use(bot);
  for (const px of [...J.pylons, J.tip].filter(Boolean)) for (const sx of [-1, 1]) { const w = wingAt(J, px); P.streak(sx * px, lerp(w.le, w.te, 0.5), 0, 1, 2.4, 0.2, 0.7, { A: [10, 10, 10, 0.6], R: [225, 0.6] }); }
  // 8) Öl- und Hydraulikschlieren, Schmutz (Unterseite)
  for (let i = 0; i < 70; i++) P.soft(rr(bot.al, bot.ah) * 0.5, rr(bot.bl, bot.bh), rr(0.2, 0.9), rr(0.3, 1.2), { A: [62, 54, 42, 0.13], R: [200, 0.15], O: [200, 0.2] });
  for (let i = 0; i < 34; i++) {
    const src = R() < 0.5 ? [rr(-1, 1) * G.main.x, G.main.z + rr(-0.5, 0.9)] : [rr(-0.5, 0.5), rr(-3.5, 5.5)];
    P.streak(src[0], src[1], rr(-0.08, 0.08), 1, rr(0.6, 2.4), rr(0.03, 0.08), rr(0.12, 0.3), { A: [34, 26, 16, 0.38], R: [55, 0.6] });
  }
  P.use(side);
  for (let i = 0; i < 18; i++) { const y = rr(-0.3, 0.4), z = rr(-5, 5.5); P.streak(y, z, -0.45, 1, rr(0.4, 1.4), 0.03, 0.12, { A: [34, 26, 16, 0.35], R: [60, 0.5] }); }
  for (let i = 0; i < 40; i++) P.soft(rr(-1.1, -0.3), rr(side.bl, side.bh), rr(0.2, 0.5), rr(0.4, 1.0), { A: [60, 52, 40, 0.1] });
  // 9) Lackabplatzer: Vorderkanten, Nase, Einlasslippen, Einstieg
  for (const r of [top, bot]) {
    P.use(r);
    for (const [Q, sx] of wings) {
      const le = [quadPt(Q, sx, 0, 0), quadPt(Q, sx, 1, 0)], big = Q === J.wing;
      P.chips(le, big ? 130 : 45, 0.26, 0.04, bare);
      P.chips(le, big ? 25 : 10, 0.15, 0.03, primer);
      P.chips([quadPt(Q, sx, 1, 0), quadPt(Q, sx, 1, 1)], 18, 0.12, 0.025, bare);
    }
    const nz = J.fus[0][0];
    P.chips([[0, nz + 0.05], [0, nz + 1.4]], 50, 0.35, 0.035, bare);
  }
  P.use(top);
  for (const sx of [-1, 1]) P.chips(J.canopy.map((s) => [sx * (s[1] + 0.05), s[0]]), 40, 0.12, 0.022, bare);
  P.scratches(-0.7, J.canopy[2][0], 0.5, 40, 0.3, { A: [205, 210, 214, 0.35], M: [180, 0.5], R: [95, 0.5] });
  for (const sx of [-1, 1]) { const [a, b] = quadPt(J.wing, sx, 0.1, 0.4); P.scratches(a, b, 0.4, 30, 0.25, { A: [200, 205, 210, 0.3], M: [170, 0.5] }); }
  P.use(side);
  for (const it of J.intakes) P.chips([[it.y - it.h, it.z0], [it.y + it.h, it.z0]], 40, 0.18, 0.03, bare);
  for (const F of J.fins) P.chips([[F.pts[0][1], F.pts[0][0]], [F.pts[1][1], F.pts[1][0]]], 40, 0.16, 0.028, bare);
  P.chips([[f(J.seat)[4] + 0.2, J.seat - 1], [f(J.seat)[4] + 0.2, J.seat + 1]], 30, 0.3, 0.025, bare);
  P.scratches(0.1, J.seat - 0.2, 0.45, 30, 0.3, { A: [205, 210, 214, 0.3], M: [170, 0.5] });
  // Zerium-Kanäle (Phantom): schwach leuchtende Schlitze
  if (J.emissive) {
    P.use(top);
    for (const sx of [-1, 1]) {
      const pl = [[sx * 0.3, -2.2], [sx * 0.34, 1], [sx * 0.3, 4.5]];
      P.strokes([pl], 0.06, { A: [10, 20, 24, 1], H: [70, 1], R: [60, 1] });
      P.strokes([pl], 0.025, { E: [255, 255, 255, 0.95] });
      P.strokes([pl], 0.12, { E: [255, 255, 255, 0.2], blur: 2 });
    }
  }
  // 10) Staub und Fleckigkeit
  for (const r of [top, bot, side]) {
    P.use(r);
    const d = [];
    for (let i = 0; i < 1400; i++) d.push([rr(r.al, r.ah), rr(r.bl, r.bh), rr(0.004, 0.014)]);
    P.dots(d, { A: [70, 64, 54, 0.35], R: [190, 0.3] });
  }
}

export function makeInterceptor(type = 'falcon', opts = {}) {
  const key = JETS[type] ? type : 'falcon', J = JETS[key];
  const o = norm(opts), hi = o.hi, seg = hi ? 28 : 14, L = planeLayout(J.ext);
  const tex = typeTex(key, o.S, { color: J.color, rough: J.rough, metal: J.metal, emissive: !!J.emissive }, (P) => paintJet(P, J, L));
  const kit = new Kit();
  // Rumpf, Rückenwulst, Strakes
  kit.add('hull', loft(J.fus, seg, { capE: true }));
  kit.add('hull', loft(J.spine, (seg * 0.75) | 0));
  for (const sx of [-1, 1]) kit.add('hull', slab(mirror(J.lerx, sx), 0.08, { y: J.lerxY, tip: 0.6 }));
  // Tragflächen und Höhenleitwerk
  for (const sx of [-1, 1]) {
    kit.add('hull', slab(mirror(J.wing, sx), J.wingT, { y: J.wingY, tip: J.wingTip, dih: J.dih, segs: hi ? 3 : 1 }));
    kit.add('hull', slab(mirror(J.htail, sx), 0.15, { y: J.htailY, tip: 0.5, segs: hi ? 2 : 1 }));
  }
  // Seitenleitwerk(e) und Bauchflossen
  const finM = (F) => M4(F.x, 0, 0, 0, 0, -Math.sign(F.x) * F.cant);
  for (const F of J.fins) kit.add('hull', fin(F.pts, F.t, 0.45, hi ? 2 : 1), finM(F));
  for (const F of J.ventral) for (const sx of [-1, 1]) kit.add('hull', fin(F.pts, F.t, 0.6, 1), M4(sx * F.x, 0, 0, 0, 0, sx * F.cant));
  // Lufteinlässe mit Lippe und dunklem Schacht
  const iseg = hi ? 16 : 8;
  for (const it of J.intakes) for (const sx of [-1, 1]) {
    const st = (z, k) => [z, it.w * k, it.h * k, it.h * k, 0, it.n];
    const oo = { x: sx * it.x, y: it.y };
    kit.add('hull', loft([st(it.z0, 1), st(it.z0 + 0.5, 1.03), st(lerp(it.z0, it.z1, 0.6), 0.86), st(it.z1, 0.45)], iseg, oo));
    kit.add('hull', loft([st(it.z0 - 0.001, 1), st(it.z0 + 0.06, 0.84)], iseg, oo));
    kit.add('trim', loft([st(it.z0 + 0.06, 0.84), st(it.z0 + 0.9, 0.78)], iseg, { ...oo, inside: true, capE: true }));
    kit.add('hull', box(0.04, it.h * 1.7, 0.5), M4(sx * (it.x - it.w - 0.05), it.y, it.z0 + 0.3)); // Grenzschichtplatte
  }
  // Kanzel: Glas, Rahmen, Cockpit
  kit.add('glass', loft(J.canopy, seg));
  const cAt = (z) => stationAt(J.canopy, z);
  const arch = (z, s = 1.035) => { const c = cAt(z), pts = []; for (let k = 0; k <= 12; k++) { const t = (k / 12) * Math.PI, e = 2 / c[5]; pts.push(V3(c[1] * s * Math.sign(Math.cos(t)) * Math.abs(Math.cos(t)) ** e, c[4] + c[2] * s * Math.abs(Math.sin(t)) ** e, z)); } return pts; };
  kit.add('hull', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arch(J.bow)), 16, 0.035, 6));
  kit.add('hull', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arch(J.canopy[J.canopy.length - 2][0] + 0.05, 1.0)), 16, 0.04, 6));
  for (const sx of [-1, 1]) {
    const pts = []; for (let z = J.canopy[1][0]; z <= J.canopy[J.canopy.length - 1][0]; z += 0.2) pts.push(V3(sx * cAt(z)[1] * 1.01, cAt(z)[4] + 0.01, z));
    kit.add('hull', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.04, 6));
  }
  const cs = stationAt(J.fus, J.seat), sy = cs[4] + cs[2];
  kit.add('trim', box(0.46, 0.62, 0.4), M4(0, sy - 0.2, J.seat + 0.35, 0.18));
  kit.add('trim', box(0.3, 0.22, 0.18), M4(0, sy + 0.18, J.seat + 0.47, 0.12));
  kit.add('trim', box(0.62, 0.14, 0.36), M4(0, sy - 0.02, J.seat - 0.78));
  kit.add('trim', box(0.18, 0.16, 0.02), M4(0, sy + 0.1, J.seat - 0.88, -0.5));
  // Düsen (Konvergent-Divergent, Stellklappen) + Glühen
  const engines = [];
  const nozProf = [[0.72, 0], [1.0, 0], [0.98, 0.35], [0.9, 1.0], [0.83, 1.02], [0.76, 0.62], [0.72, 0.3]];
  for (const n of J.nozzles) {
    const g = lathe(nozProf.map(([r, y]) => [r * n.r, y]), hi ? 28 : 14, 35); g.rotateX(Math.PI / 2); g.translate(n.x, n.y, n.z);
    kit.add('trim', g);
    const face = lathe([[0, 0.2], [n.r * 0.73, 0.32], [n.r * 0.3, 0.42], [0, 0.55]], hi ? 18 : 10, 60); face.rotateX(Math.PI / 2); face.translate(n.x, n.y, n.z);
    kit.add('trim', face);
    if (hi) for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; kit.add('trim', box(0.06, 0.025, 0.7), M4(n.x + Math.cos(a) * n.r * 0.95, n.y + Math.sin(a) * n.r * 0.95, n.z + 0.62, 0.1 * Math.sin(a), -0.1 * Math.cos(a), a + Math.PI / 2)); }
  }
  // Waffen: Pylone, Raketen, Kanone
  const stores = [];
  for (const px of J.pylons) for (const sx of [-1, 1]) {
    const w = wingAt(J, px), zc = lerp(w.le, w.te, 0.45);
    kit.add('hull', slab([[-0.07, zc - 0.7], [0.07, zc - 0.7], [0.07, zc + 0.9], [-0.07, zc + 0.9]], 0.14, { segs: 1 }), M4(sx * px, w.y - w.t / 2 - 0.13, 0, 0, 0, 0, 1, 1.9, 1));
    stores.push([sx * px, w.y - w.t / 2 - 0.36, zc - 0.25]);
  }
  if (J.tip) for (const sx of [-1, 1]) { const w = wingAt(J, J.tip); kit.add('hull', box(0.1, 0.12, 2.0), M4(sx * (J.tip + 0.04), w.y - 0.02, lerp(w.le, w.te, 0.5) - 0.1)); stores.push([sx * (J.tip + 0.06), w.y - 0.16, lerp(w.le, w.te, 0.5) - 0.3]); }
  kit.add('trim', cylZ(0.035, 0.05, 0.5, 8), M4(J.gun[0], J.gun[1], J.gun[2] + 0.1));
  // Antennen, Staurohr
  kit.add('trim', cylZ(0.008, 0.02, 0.9, 6), M4(0, J.fus[0][4], J.fus[0][0] - 0.35));
  kit.add('hull', slab([[-0.03, 0], [0.03, 0], [0.02, 0.35], [-0.02, 0.32]], 0.03, { segs: 1, bevel: false }), M4(0, J.spine[2][4] + J.spine[2][2], 1.2, Math.PI / 2 - 0.25, 0, 0));
  kit.add('hull', slab([[-0.03, 0], [0.03, 0], [0.02, 0.28], [-0.02, 0.25]], 0.03, { segs: 1, bevel: false }), M4(0, -0.58, -1.8, -Math.PI / 2 + 0.3, 0, 0));
  // Fahrwerk (optional, z. B. im Hangar)
  let groundY = J.fus[6][4] - J.fus[6][3];
  if (o.gear) {
    const G = J.gear, gY = G.ground, ws = hi ? 18 : 10;
    const wheel = (x, y, z, r, w) => { kit.add('trim', cylX(r, w, ws), M4(x, y, z)); kit.add('hull', cylX(r * 0.55, w + 0.02, ws), M4(x, y, z)); };
    const n0 = stationAt(J.fus, G.nose.z), ny0 = n0[4] - n0[3] * 0.9, nyw = gY + G.nose.r;
    kit.add('trim', new THREE.CylinderGeometry(0.05, 0.06, ny0 - nyw, 8), M4(0, (ny0 + nyw) / 2, G.nose.z));
    kit.add('trim', box(0.06, 0.4, 0.06), M4(0, nyw + 0.35, G.nose.z + 0.12, 0.4));
    for (const dx of [-0.11, 0.11]) wheel(dx, nyw, G.nose.z, G.nose.r, 0.14);
    for (const sx of [-1, 1]) {
      kit.add('hull', box(0.025, 0.3, 0.85), M4(sx * 0.2, ny0 - 0.14, G.nose.z - 0.05));
      const mx = sx * G.main.x, m0 = stationAt(J.fus, G.main.z), my0 = m0[4] - m0[3] * 0.7, myw = gY + G.main.r;
      kit.add('trim', new THREE.CylinderGeometry(0.07, 0.08, my0 - myw, 8), M4(mx, (my0 + myw) / 2, G.main.z, 0, 0, -sx * 0.08));
      kit.add('trim', box(0.06, 0.6, 0.06), M4(mx - sx * 0.12, my0 - 0.4, G.main.z - 0.3, 0.5, 0, sx * 0.4));
      wheel(mx + sx * 0.05, myw, G.main.z, G.main.r, 0.24);
      kit.add('hull', box(0.025, 0.42, 1.1), M4(sx * (G.main.x + 0.28), my0 - 0.16, G.main.z, 0, 0, sx * 0.25));
    }
    groundY = gY;
  }
  // ---- Meshes ----
  const g = new THREE.Group(); g.name = J.name;
  const hull = surfMat(tex, o, { map: tex.map, ...(tex.emissive ? { emissiveMap: tex.emissive, emissive: new THREE.Color(J.glow), emissiveIntensity: 2.2 } : {}) }, { clearcoat: 0.22, clearcoatRoughness: 0.45 });
  const trim = surfMat(tex, o, { color: 0x34383d });
  mk(g, kit.geo('hull'), hull, o, L);
  mk(g, kit.geo('trim'), trim, o, L);
  mk(g, kit.geo('glass'), glassMat(o, ...J.glass), o, null, null, false);
  // Kennung am Seitenleitwerk
  const code = o.code || `${J.prefix}-${String(((Math.abs(o.seed) || 1) - 1) % 99 + 1).padStart(2, '0')}`;
  const dk = [];
  for (const F of J.fins) {
    const p = F.pts, at = (k) => ({ y: lerp(p[0][1], p[1][1], k), le: lerp(p[0][0], p[1][0], k), te: lerp(p[3][0], p[2][0], k), t: F.t * lerp(1, 0.45, k) / 2 + 0.012 });
    const a = at(0.6), b = at(0.24), sides = F.x === 0 ? [-1, 1] : [Math.sign(F.x), -Math.sign(F.x)];
    for (const s of sides) {
      const cw = Math.min((a.te - a.le) * 0.72, 1.6);
      dk.push(decalQuad(cw, cw * 0.4, 0, s, finM(F).multiply(M4(s * a.t, a.y, (a.le + a.te) / 2 + 0.1))));
      if (F.x === 0 || s === Math.sign(F.x)) { const bw = Math.min((b.te - b.le) * 0.7, 1.5); dk.push(decalQuad(bw, bw * 0.5, 1, s, finM(F).multiply(M4(s * (b.t + 0.004), b.y, (b.le + b.te) / 2 + 0.05)))); }
    }
  }
  const decal = mk(g, merge(dk, true), decalMat(decalTex(code, J.ink, J.prefix === 'PH')), o, null, null, false);
  decal.castShadow = false;
  // Triebwerke
  const glowM = glowMat(J.glow, 1.7);
  const glowGeo = (n) => { const gg = engineGlowGeo(n.r * 0.74, n.r * 7); return gg; };
  for (const n of J.nozzles) {
    const marker = new THREE.Object3D(); marker.position.set(n.x, n.y, n.z + 1.0); g.add(marker);
    let glow;
    if (hi || J.nozzles.length === 1) { glow = new THREE.Mesh(glowGeo(n), J.nozzles.length > 1 ? glowM.clone() : glowM); glow.position.copy(marker.position).z -= 0.42; g.add(glow); }
    engines.push({ object: marker, glow });
  }
  if (!hi && J.nozzles.length > 1) { // ein gemeinsames Glüh-Mesh
    const parts = J.nozzles.map((n) => { const gg = glowGeo(n); gg.translate(n.x, n.y, 0); return gg; });
    const glow = new THREE.Mesh(merge(parts, true), glowM); glow.position.set(0, 0, J.nozzles[0].z + 0.58); g.add(glow);
    engines.forEach((e) => { e.glow = glow; });
  }
  // Raketen: hoch = einzeln (für Abschuss), niedrig = zusammengefasst
  const weapons = [];
  const mProf = [[0, 0], [J.mR * 0.85, 0], [J.mR, 0.06], [J.mR, J.mLen * 0.8], [J.mR * 0.78, J.mLen * 0.9], [J.mR * 0.35, J.mLen * 0.975], [0, J.mLen]];
  const missileGeo = () => {
    const mk2 = new Kit(); const body = lathe(mProf, hi ? 12 : 6, 35); body.rotateX(-Math.PI / 2); body.translate(0, 0, J.mLen / 2); mk2.add('m', body);
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; mk2.add('m', box(0.012, J.mR * 2.6, 0.34), M4(Math.cos(a) * J.mR * 1.5, Math.sin(a) * J.mR * 1.5, J.mLen / 2 - 0.2, 0, 0, a + Math.PI / 2)); if (hi) mk2.add('m', box(0.01, J.mR * 1.6, 0.16), M4(Math.cos(a) * J.mR * 1.15, Math.sin(a) * J.mR * 1.15, -J.mLen * 0.22, 0, 0, a + Math.PI / 2)); }
    return mk2.geo('m');
  };
  const storeM = surfMat(tex, o, { map: tex.map, color: 0xe4e6e2 }, { clearcoat: 0.3 });
  if (hi) {
    for (const p of stores) {
      const m = mk(g, missileGeo(), storeM, o, L, M4(...p)); m.position.set(...p);
      const muzzle = new THREE.Object3D(); muzzle.position.z = -J.mLen / 2; m.add(muzzle);
      weapons.push({ object: m, muzzle, kind: 'missile' });
    }
  } else if (stores.length) {
    const sk = new Kit(); stores.forEach((p) => sk.add('s', missileGeo(), M4(...p)));
    mk(g, sk.geo('s'), storeM, o, L);
    for (const p of stores) { const m = new THREE.Object3D(); m.position.set(...p); g.add(m); const muzzle = new THREE.Object3D(); muzzle.position.z = -J.mLen / 2; m.add(muzzle); weapons.push({ object: m, muzzle, kind: 'missile' }); }
  }
  { const m = new THREE.Object3D(); m.position.set(J.gun[0], J.gun[1], J.gun[2] - 0.15); g.add(m); weapons.unshift({ object: m, muzzle: m, kind: 'gun' }); }
  // Positionslichter (rot links/backbord = −x, grün rechts = +x), Blitzer, Kollisionswarnlicht
  const tipX = J.wing[1][0] + 0.05, tw = wingAt(J, tipX), F0 = J.fins[0];
  const lights = lightsBundle(g, [
    { p: [-tipX, tw.y, lerp(tw.le, tw.te, 0.3)], color: 0xff2414, kind: 'nav' },
    { p: [tipX, tw.y, lerp(tw.le, tw.te, 0.3)], color: 0x20ff50, kind: 'nav' },
    { p: [F0.x + Math.sign(F0.x) * Math.sin(F0.cant) * F0.pts[2][1], F0.pts[2][1] * Math.cos(F0.cant) - 0.05, F0.pts[2][0] + 0.05], color: 0xffffff, kind: 'strobe', k: 4 },
    { p: [0, J.spine[2][4] + J.spine[2][2] + 0.04, 0.4], color: 0xff3020, kind: 'beacon', r: 0.06, phase: 0.5 },
  ], o);
  g.userData = {
    kind: 'interceptor', type: key, lod: o.lod, length: J.len, groundY, engines, lights, weapons, ring: null, hatch: null,
    throttle: o.throttle, code, nozzles: J.nozzles.map((n) => V3(n.x, n.y, n.z + 1.0)), missiles: weapons.filter((w) => w.kind === 'missile').map((w) => w.object),
  };
  animateCraft(g, 0);
  return g;
}

// =====================================================================
// Transporter „Kondor“
// =====================================================================
const KONDOR = {
  len: 28, color: [98, 106, 92, 1], camo: [74, 82, 70], tan: [128, 120, 98], accent: [222, 180, 40], rough: 0.62, metal: 0.2, ink: [28, 30, 30, 0.95], glow: 0x9fd4ff,
  ext: { x: [-12.6, 12.6], y: [-2.0, 7.2], z: [-14.5, 14.3] },
  fus: [[-14.25, 0.2, 0.22, 0.15, 0.55, 2.2], [-14.0, 0.62, 0.66, 0.45, 0.55, 2.5], [-13.5, 1.15, 1.15, 0.9, 0.5, 3], [-12.4, 1.7, 1.6, 1.35, 0.5, 3.6], [-10.6, 2.0, 1.88, 1.6, 0.5, 4.5], [-7.0, 2.1, 2.0, 1.7, 0.5, 5.5],
    [4.0, 2.1, 2.0, 1.7, 0.5, 5.5], [6.6, 2.05, 2.0, 1.55, 0.55, 5.2], [9.0, 1.75, 1.8, 0.9, 1.1, 4.5], [11.5, 1.2, 1.35, 0.55, 1.75, 3.6], [13.4, 0.6, 0.75, 0.35, 2.15, 3], [14.0, 0.25, 0.3, 0.2, 2.25, 2.5]],
  wing: [[1.8, -2.3], [9.2, -1.7], [9.2, 1.7], [1.8, 2.6]], wingY: 2.85, wingT: 0.5,
  fin: [[8.6, 2.3], [12.3, 6.9], [13.8, 6.9], [14.1, 2.3]], htail: [[0.1, 12.0], [4.2, 13.1], [4.2, 13.95], [0.1, 14.05]], htailY: 6.85,
  nac: 1.75, ramp: { z0: 6.7, z1: 10.4 }, windows: [-8.5, -6.5, -4.5, -2.5], door: [-6.2, -4.7],
  panelZ: [-12.6, -11.2, -9.5, -7.8, -6.1, -4.4, -2.7, -1, 0.7, 2.4, 4.1, 5.8, 7.5, 9.2, 10.9, 12.6],
};
function paintKondor(P, K, L) {
  const R = P.rand, rr = (a, b) => P.rr(a, b), { top, bot, side } = L, f = (z) => stationAt(K.fus, z);
  const bare = { A: [168, 172, 176, 1], M: [230, 1], R: [80, 1], H: [114, 1] }, primer = { A: [126, 132, 92, 1], M: [25, 1], R: [180, 1], H: [119, 1] };
  const hz = (r, pts, w) => { P.use(r); P.poly(pts, { A: [214, 172, 30, 0.92] }); const st = []; const [a0, b0] = pts[0]; for (let k = -40; k < 40; k++) st.push([[a0 + k * w - 6, b0 - 6], [a0 + k * w + 6, b0 + 6]]); P._do({ A: [20, 20, 20, 0.92] }, (c, v) => { c.beginPath(); Painter.path(c, pts, true); c.clip(); c.strokeStyle = css(v); c.lineWidth = w * 0.45; c.beginPath(); for (const s of st) Painter.path(c, s, false); c.stroke(); }); };
  for (const r of [top, bot, side]) {
    P.use(r);
    for (let i = 0; i < 160; i++) P.soft(rr(r.al, r.ah), rr(r.bl, r.bh), rr(0.4, 2.4), rr(0.4, 2.4), R() < 0.5 ? { A: [255, 255, 240, 0.045], R: [130, 0.15] } : { A: [10, 12, 8, 0.06], R: [190, 0.15] }, R() * 3);
    if (r !== bot) for (let i = 0; i < 14; i++) P.poly(blob(rr(r.al, r.ah), rr(r.bl, r.bh), rr(1.2, 3.2), R, 12, 1, 1.4), { A: [...(i % 3 ? K.camo : K.tan), 0.55], blur: Math.max(2, r.ppm * 0.12) });
  }
  // Fugen, Nieten
  P.use(top);
  { const lines = [];
    for (const z of K.panelZ) { const w = f(z)[1] * 0.97; lines.push([[-w, z], [w, z]]); }
    for (const sx of [-1, 1]) lines.push([[sx * 0.9, -12], [sx * 0.9, 13]]), lines.push([[sx * 1.7, -10], [sx * 1.7, 8.5]]);
    for (const sx of [-1, 1]) { for (const s of [0.2, 0.4, 0.6, 0.8]) lines.push([quadPt(K.wing, sx, s, 0.03), quadPt(K.wing, sx, s, 0.97)]); for (const c of [0.15, 0.55]) lines.push([quadPt(K.wing, sx, 0, c), quadPt(K.wing, sx, 1, c)]); }
    P.panels(lines, { w: 0.03, rivet: 0.16 }); }
  P.use(bot);
  { const lines = []; for (const z of K.panelZ) { const w = f(z)[1] * 0.97; lines.push([[-w, z], [w, z]]); } for (const sx of [-1, 1]) lines.push([[sx * 1.2, -12], [sx * 1.2, 6.6]]);
    for (const sx of [-1, 1]) { for (const s of [0.25, 0.5, 0.75]) lines.push([quadPt(K.wing, sx, s, 0.03), quadPt(K.wing, sx, s, 0.97)]); }
    P.panels(lines, { w: 0.03, rivet: 0.16 }); }
  P.use(side);
  { const lines = []; for (const z of K.panelZ) { const s = f(z); lines.push([[s[4] - s[3] * 0.92, z], [s[4] + s[2] * 0.92, z]]); }
    for (const y of [-0.6, 0.55, 1.8]) lines.push([[y, -11.5], [y, 8.0]]);
    const p = K.fin; lines.push([[lerp(p[0][1], p[1][1], 0.1), lerp(lerp(p[0][0], p[3][0], 0.7), lerp(p[1][0], p[2][0], 0.7), 0.1)], [lerp(p[0][1], p[1][1], 0.92), lerp(lerp(p[0][0], p[3][0], 0.7), lerp(p[1][0], p[2][0], 0.7), 0.92)]]);
    P.panels(lines, { w: 0.03, rivet: 0.16 });
    // Seitentür, Fenster (dunkel, im Hoch-LOD von Glas überdeckt)
    P.strokes([[[-1.15, K.door[0]], [1.25, K.door[0]], [1.25, K.door[1]], [-1.15, K.door[1]]]], 0.04, { A: [10, 10, 10, 0.8], H: [50, 1], O: [90, 1] }, { closed: true });
    P.poly([[-0.2, K.door[1] + 0.05], [0.0, K.door[1] + 0.05], [0.0, K.door[1] + 0.3], [-0.2, K.door[1] + 0.3]], { A: [30, 30, 30, 0.9] });
    for (const z of K.windows) P.poly([[0.9, z - 0.36], [1.4, z - 0.36], [1.4, z + 0.36], [0.9, z + 0.36]], { A: [14, 20, 26, 1], R: [20, 1], M: [200, 1] });
    for (const z of K.windows) P.strokes([[[0.86, z - 0.4], [1.44, z - 0.4], [1.44, z + 0.4], [0.86, z + 0.4]]], 0.05, { A: [30, 32, 30, 0.8], H: [90, 1] }, { closed: true });
    for (const [y, z, w, h] of [[-0.9, -9, 0.5, 0.6], [1.6, -1.5, 0.6, 0.5], [-0.9, 2.5, 0.7, 0.5], [0.4, 5.5, 0.5, 0.4], [-1.0, -12, 0.4, 0.5]]) P.hatch(y, z, w, h);
  }
  // Cockpitverglasung (dunkel) oben
  P.use(top); P.poly([[-1.6, -13.25], [1.6, -13.25], [1.95, -11.25], [-1.95, -11.25]], { A: [14, 20, 26, 1], R: [20, 1], M: [200, 1] });
  P.use(side); P.poly([[0.6, -13.4], [2.2, -13.0], [2.4, -11.2], [0.5, -11.2]], { A: [14, 20, 26, 1], R: [20, 1], M: [200, 1] });
  // Warnstreifen: Heckrampe, Tür
  const rz0 = K.ramp.z0, rz1 = K.ramp.z1;
  hz(bot, [[-1.55, rz0 - 0.25], [1.55, rz0 - 0.25], [1.55, rz0], [-1.55, rz0]], 0.3);
  for (const sx of [-1, 1]) hz(bot, [[sx * 1.55, rz0], [sx * 1.3, rz0], [sx * 1.3, rz1], [sx * 1.55, rz1]], 0.3);
  hz(side, [[-1.2, K.door[0] - 0.2], [-0.95, K.door[0] - 0.2], [-0.95, K.door[1] + 0.2], [-1.2, K.door[1] + 0.2]], 0.25);
  P.use(bot); P.text('VORSICHT RAMPE', 0, rz0 - 0.6, 0.22, [-1, 0], { A: [24, 24, 24, 0.85] });
  // Trittflächen und Schriftzüge
  P.use(top);
  for (const sx of [-1, 1]) {
    const wk = [quadPt(K.wing, sx, 0, 0.2), quadPt(K.wing, sx, 0.25, 0.2), quadPt(K.wing, sx, 0.25, 0.7), quadPt(K.wing, sx, 0, 0.7)];
    P.poly(wk, { A: [30, 32, 30, 0.35], R: [238, 0.9] }); P.strokes([wk], 0.04, { A: [20, 20, 20, 0.85] }, { closed: true, dash: [0.25, 0.15] });
    const [a, b] = quadPt(K.wing, sx, 0.4, 0.88); P.text('NICHT BETRETEN', a, b, 0.14, [1, 0], { A: [24, 24, 24, 0.85] });
  }
  { const [a, b] = quadPt(K.wing, -1, 0.62, 0.48); P.text('AEGIS', a, b, 0.9, [1, 0], { A: [...K.ink.slice(0, 3), 0.85], H: [132, 1] }, 0.5); }
  { const [a, b] = quadPt(K.wing, 1, 0.62, 0.48); emblem(P, a, b, 0.85, [0, -1]); }
  P.text('RETTUNG', 0, -6.5, 0.28, [1, 0], { A: [210, 170, 30, 0.85] });
  P.strokes([[[-0.55, -6.95], [0.55, -6.95], [0.55, -6.05], [-0.55, -6.05]]], 0.05, { A: [210, 170, 30, 0.85] }, { closed: true });
  P.use(bot);
  { const [a, b] = quadPt(K.wing, -1, 0.55, 0.5); P.text('AEGIS', a, b, 1.0, [-1, 0], { A: [...K.ink.slice(0, 3), 0.8] }, 0.55); }
  { const [a, b] = quadPt(K.wing, 1, 0.55, 0.5); emblem(P, a, b, 0.85, [0, -1]); }
  P.use(top); for (const sx of [-1, 1]) P.poly([quadPt(K.wing, sx, 0.95, 0), quadPt(K.wing, sx, 1.02, 0), quadPt(K.wing, sx, 1.02, 1), quadPt(K.wing, sx, 0.95, 1)], { A: [...K.accent, 0.8] });
  P.use(side); { const p = K.fin; P.poly([[lerp(p[0][1], p[1][1], 0.86), lerp(p[0][0], p[1][0], 0.86)], [p[1][1] + 0.1, p[1][0]], [p[2][1] + 0.1, p[2][0] + 0.1], [lerp(p[3][1], p[2][1], 0.86), lerp(p[3][0], p[2][0], 0.86)]], { A: [...K.accent, 0.8] }); }
  for (const r of [top, side]) {
    P.use(r);
    for (let i = 0; i < 120; i++) { const a = r === top ? rr(-2, 2) : rr(-1.2, 2.2), b = rr(-12, 12); P.streak(a, b, r === side ? -0.2 : 0, 1, rr(0.6, 3), rr(0.04, 0.1), rr(0.1, 0.25), { A: [40, 36, 26, rr(0.06, 0.16)], R: [200, 0.15] }); }
  }
  // Ruß: Gondeln (Flügelspitzen), Hilfsturbine, Bordkanone
  P.use(top);
  for (const sx of [-1, 1]) { P.soft(sx * 9.0, 1.2, 1.0, 2.2, { A: [8, 8, 8, 0.7], R: [235, 0.8], M: [30, 0.6] }); P.soft(sx * 9.0, -1.5, 0.8, 0.8, { A: [8, 8, 8, 0.35] }); }
  P.soft(0.0, 5.6, 0.5, 1.6, { A: [8, 8, 8, 0.6], R: [230, 0.8] });
  P.use(side);
  P.streak(1.7, 5.0, -0.1, 1, 3.0, 0.3, 1.0, { A: [8, 8, 8, 0.75], R: [230, 0.8], M: [30, 0.6] });
  P.streak(-1.1, -12.2, 0.05, 1, 2.5, 0.15, 0.7, { A: [8, 8, 8, 0.7], R: [230, 0.7] });
  // Schlamm, Staub, Öl: Unterseite und untere Flanken
  P.use(bot);
  for (let i = 0; i < 120; i++) P.soft(rr(-2, 2), rr(-13, 12), rr(0.3, 1.4), rr(0.3, 1.8), { A: [86, 70, 50, 0.16], R: [235, 0.2], M: [10, 0.2], O: [190, 0.2] });
  { const sp = []; for (let i = 0; i < 2200; i++) sp.push([rr(-2.2, 2.2), rr(-13, 12), rr(0.01, 0.05)]); P.dots(sp, { A: [92, 74, 52, 0.4], R: [240, 0.4], H: [140, 0.6] }); }
  for (let i = 0; i < 40; i++) P.streak(rr(-1.6, 1.6), rr(-10, 6), rr(-0.05, 0.05), 1, rr(0.5, 3), 0.05, 0.25, { A: [36, 28, 18, 0.4], R: [55, 0.6] });
  P.scratches(0, (rz0 + rz1) / 2, 1.3, 90, 0.9, { A: [180, 184, 186, 0.45], M: [200, 0.6], R: [90, 0.6] }, 0.012);
  P.use(side);
  for (let i = 0; i < 70; i++) { const z = rr(-13, 13), s = f(z); P.soft(s[4] - s[3] * rr(0.5, 1), z, rr(0.3, 0.8), rr(0.4, 1.3), { A: [90, 72, 50, 0.16], R: [235, 0.2] }); }
  { const sp = []; for (let i = 0; i < 1600; i++) { const z = rr(-13, 13), s = f(z); sp.push([s[4] - s[3] * (1 - rr(0, 0.5) ** 2), z, rr(0.008, 0.04)]); } P.dots(sp, { A: [96, 78, 56, 0.45], R: [240, 0.4] }); }
  for (let i = 0; i < 26; i++) P.streak(rr(-0.8, 2), rr(-11, 8), -1, 0.25, rr(0.5, 1.8), 0.04, 0.16, { A: [36, 28, 18, 0.32], R: [60, 0.5] });
  // Abplatzer: Vorderkanten, Nase, Rampe, Tür
  for (const r of [top, bot]) {
    P.use(r);
    for (const sx of [-1, 1]) { P.chips([quadPt(K.wing, sx, 0, 0), quadPt(K.wing, sx, 1, 0)], 120, 0.35, 0.05, bare); P.chips([quadPt(K.wing, sx, 0, 0), quadPt(K.wing, sx, 1, 0)], 30, 0.25, 0.05, primer); }
    P.chips([[-1, -14], [1, -14]], 60, 0.9, 0.06, bare);
  }
  P.use(bot); for (const sx of [-1, 1]) P.chips([[sx * 1.4, rz0], [sx * 1.4, rz1]], 60, 0.3, 0.05, bare);
  P.chips([[-1.4, rz1], [1.4, rz1]], 50, 0.3, 0.05, bare);
  P.use(side); P.chips([[-1.15, K.door[0]], [-1.15, K.door[1]]], 50, 0.25, 0.045, bare); P.chips([[K.fin[0][1], K.fin[0][0]], [K.fin[1][1], K.fin[1][0]]], 60, 0.3, 0.05, bare);
  P.chips([[-1.2, -13.8], [1.6, -13.8]], 50, 0.6, 0.05, bare);
  P.use(top); P.scratches(0, -9, 1.2, 50, 0.6, { A: [180, 184, 186, 0.35], M: [190, 0.5] }, 0.01);
  for (const r of [top, side]) { P.use(r); const d = []; for (let i = 0; i < 1500; i++) d.push([rr(r.al, r.ah), rr(r.bl, r.bh), rr(0.006, 0.02)]); P.dots(d, { A: [80, 72, 58, 0.25], R: [200, 0.3] }); }
}

export function makeTransport(opts = {}) {
  const K = KONDOR, o = norm(opts), hi = o.hi, seg = hi ? 32 : 16, L = planeLayout(K.ext);
  const tex = typeTex('kondor', o.S, { color: K.color, rough: K.rough, metal: K.metal }, (P) => paintKondor(P, K, L));
  const kit = new Kit(), f = (z) => stationAt(K.fus, z);
  kit.add('hull', loft(K.fus, seg, { capS: true, capE: true }));
  kit.add('hull', loft([[-3.4, 0.2, 0.1, 0.1, 2.42, 2.5], [-2.6, 1.7, 0.42, 0.2, 2.42, 3.5], [2.9, 1.7, 0.42, 0.2, 2.42, 3.5], [3.7, 0.2, 0.1, 0.1, 2.42, 2.5]], (seg / 2) | 0));
  // Seitliche Fahrwerksverkleidungen
  for (const sx of [-1, 1]) kit.add('hull', loft([[-3.6, 0.1, 0.1, 0.1, -0.85, 3], [-2.8, 0.72, 0.62, 0.55, -0.85, 3.5], [3.2, 0.72, 0.62, 0.55, -0.85, 3.5], [4.3, 0.1, 0.1, 0.1, -0.75, 3]], (seg / 2) | 0, { x: sx * 2.05 }));
  // Tragfläche, Leitwerk
  for (const sx of [-1, 1]) {
    kit.add('hull', slab(mirror(K.wing, sx), K.wingT, { y: K.wingY, tip: 0.65, dih: -0.03, segs: hi ? 3 : 1 }));
    kit.add('hull', slab(mirror(K.htail, sx), 0.26, { y: K.htailY, tip: 0.6, segs: hi ? 2 : 1 }));
    kit.add('hull', cylX(0.42, 0.7, hi ? 16 : 10), M4(sx * 9.3, K.wingY - 0.28, 0)); // Schwenklager
  }
  kit.add('hull', fin(K.fin, 0.38, 0.6, hi ? 2 : 1));
  kit.add('hull', lathe([[0, -0.4], [0.35, -0.3], [0.38, 0.3], [0.2, 0.6], [0, 0.65]], 12), M4(0, K.htailY + 0.05, 12.9, Math.PI / 2));
  // Cockpitverglasung mit Rahmen
  const gz = [-13.3, -12.8, -12.2, -11.6, -11.2], gst = gz.map((z) => f(z));
  if (hi) kit.add('glass', loft(gst, 24, { t0: 0.22, t1: Math.PI - 0.22, scale: 1.012 }));
  for (const t of [0.22, 0.78, 1.32, 1.82, 2.36, Math.PI - 0.22]) kit.add('hull', loft(gst, 1, { t0: t - 0.035, t1: t + 0.035, scale: 1.022 }));
  for (const z of [gz[0], gz[gz.length - 1]]) kit.add('hull', loft([f(z - 0.07), f(z + 0.07)], 16, { t0: 0.18, t1: Math.PI - 0.18, scale: 1.02 }));
  if (hi) for (const sx of [-1, 1]) for (const z of K.windows) kit.add('glass', box(0.04, 0.48, 0.68), M4(sx * (f(z)[1] + 0.004), 1.15, z));
  // Bugsensor, Antennen, Trittstufen
  kit.add('trim', new THREE.SphereGeometry(0.28, 14, 10), M4(0, -0.45, -13.25));
  kit.add('trim', cylZ(0.05, 0.05, 1.2, 6), M4(0.9, 0.2, -14.2));
  for (const z of [-6, 5.5]) kit.add('hull', slab([[-0.04, 0], [0.04, 0], [0.03, 0.55], [-0.03, 0.5]], 0.05, { segs: 1, bevel: false }), M4(0, 2.5, z, Math.PI / 2 - 0.3, 0, 0));
  kit.add('trim', cylZ(0.015, 0.015, 1.6, 4), M4(0.8, 2.6, 0, Math.PI / 2 - 0.2));
  for (const k of [0, 1]) kit.add('trim', box(0.5, 0.06, 0.25), M4(2.12, -1.0 + k * 0.45, -5.45));
  // Heckrampe (Scharnier vorne unten) + dunkle Öffnung
  const rz0 = K.ramp.z0, rz1 = K.ramp.z1, y0 = f(rz0)[4] - f(rz0)[3] - 0.02, y1 = f(rz1)[4] - f(rz1)[3] - 0.04;
  const rl = Math.hypot(rz1 - rz0, y1 - y0), ra = Math.atan2(y1 - y0, rz1 - rz0);
  kit.add('trim', box(2.7, 0.02, rl - 0.1), M4(0, y0 + 0.05 + (y1 - y0) / 2, (rz0 + rz1) / 2, -ra));
  const rk = new Kit();
  rk.add('hull', box(2.9, 0.14, rl), M4(0, -0.07, rl / 2));
  for (let k = 0; k < 7; k++) rk.add(hi ? 'trim' : 'hull', box(2.5, 0.05, 0.08), M4(0, 0.02, 0.4 + k * (rl - 0.8) / 6));
  for (const sx of [-1, 1]) rk.add(hi ? 'trim' : 'hull', box(0.08, 0.2, rl * 0.9), M4(sx * 1.35, 0.08, rl / 2));
  // Bordkanone im Kinnturm
  const tk = new Kit();
  tk.add('t', new THREE.SphereGeometry(0.42, hi ? 18 : 10, hi ? 12 : 8));
  for (let k = 0; k < 3; k++) { const a = k / 3 * TAU; tk.add('t', cylZ(0.04, 0.045, 1.3, 6), M4(Math.cos(a) * 0.07, -0.05 + Math.sin(a) * 0.07, -0.85)); }
  tk.add('t', cylZ(0.1, 0.1, 0.25, 8), M4(0, -0.05, -0.25));
  kit.add('trim', new THREE.CylinderGeometry(0.3, 0.3, 0.25, 12), M4(0, -1.0, -11.2));
  // Fahrwerk
  let groundY = -1.35;
  if (o.gear) {
    const ws = hi ? 20 : 10, gY = -2.45;
    const wheel = (x, z, r, w) => { kit.add('trim', cylX(r, w, ws), M4(x, gY + r, z)); kit.add('hull', cylX(r * 0.5, w + 0.02, ws), M4(x, gY + r, z)); };
    for (const sx of [-1, 1]) for (const z of [-1.2, 1.6]) { kit.add('trim', new THREE.CylinderGeometry(0.1, 0.1, 0.8, 8), M4(sx * 2.05, -1.55, z)); wheel(sx * 2.15, z, 0.55, 0.42); }
    kit.add('trim', new THREE.CylinderGeometry(0.09, 0.1, 1.2, 8), M4(0, -1.6, -10.8));
    for (const dx of [-0.2, 0.2]) wheel(dx, -10.8, 0.42, 0.22);
    groundY = gY;
  }
  // ---- Meshes ----
  const g = new THREE.Group(); g.name = 'Kondor';
  const hull = surfMat(tex, o, { map: tex.map }, { clearcoat: 0.08, clearcoatRoughness: 0.6 });
  const trim = surfMat(tex, o, { color: 0x2f3330 });
  mk(g, kit.geo('hull'), hull, o, L);
  mk(g, kit.geo('trim'), trim, o, L);
  mk(g, kit.geo('glass'), glassMat({ ...o, transmission: false }), o, null, null, false); // keine Innenausstattung → ohne Transmission
  // Rampe
  const ramp = new THREE.Group(); ramp.position.set(0, y0, rz0); ramp.rotation.x = -ra; g.add(ramp);
  const rampUV = new THREE.Matrix4().compose(V3(0, y0, rz0), new THREE.Quaternion().setFromEuler(new THREE.Euler(-ra, 0, 0)), V3(1, 1, 1));
  mk(ramp, rk.geo('hull'), hull, o, L, rampUV);
  if (rk.has('trim')) mk(ramp, rk.geo('trim'), trim, o, L, rampUV);
  // Kinnturm
  const turret = mk(g, tk.geo('t'), trim, o, L, M4(0, -1.35, -11.2)); turret.position.set(0, -1.35, -11.2);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, -0.05, -1.55); turret.add(muzzle);
  // Schwenkbare Mantelpropeller-Gondeln
  const engines = [], glowM = glowMat(K.glow, 1.4), tilt = o.tilt ?? (o.gear ? Math.PI / 2 : 0);
  const nacelles = [];
  for (const sx of [-1, 1]) {
    const piv = new THREE.Group(); piv.position.set(sx * 9.3, K.wingY - 0.28, 0); piv.rotation.x = tilt; g.add(piv);
    const nk = new Kit(), cx = sx * K.nac, nseg = hi ? 40 : 20;
    const duct = lathe([[1.36, -1.0], [1.5, -1.12], [1.62, -0.6], [1.6, 0.4], [1.5, 1.12], [1.32, 1.05], [1.3, 0]], nseg, 40); duct.rotateX(Math.PI / 2); nk.add('h', duct, M4(cx));
    const hub = lathe([[0, -1.0], [0.2, -0.92], [0.38, -0.62], [0.42, 0], [0.38, 0.8], [0.2, 1.15], [0, 1.25]], hi ? 18 : 10, 50); hub.rotateX(Math.PI / 2); nk.add('h', hub, M4(cx));
    for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; nk.add('h', box(0.08, 0.92, 0.32), M4(cx + Math.cos(a) * 0.86, Math.sin(a) * 0.86, 0.55, 0, 0, a - Math.PI / 2)); }
    for (let k = 0; k < 9; k++) { const a = k / 9 * TAU; nk.add(hi ? 't' : 'h', box(0.05, 0.9, 0.26), M4(cx + Math.cos(a) * 0.86, Math.sin(a) * 0.86, -0.4, 0, 0.45, a - Math.PI / 2)); }
    nk.add('t', cylX(0.24, 0.5, 12), M4(sx * 0.15));
    nk.add('h', cylX(0.3, 0.32, 12), M4(cx - sx * 1.55));
    const uvM = new THREE.Matrix4().compose(V3(sx * 9.3, K.wingY - 0.28, 0), new THREE.Quaternion(), V3(1, 1, 1));
    mk(piv, nk.geo('h'), hull, o, L, uvM);
    if (nk.has('t')) { const t = nk.geo('t'); if (hi) mk(piv, t, trim, o, L, uvM); else t.dispose(); }
    const glow = new THREE.Mesh(engineGlowGeo(1.28, 4.0), glowM); glow.position.set(cx, 0, 0.95); piv.add(glow);
    const marker = new THREE.Object3D(); marker.position.set(cx, 0, 1.3); piv.add(marker);
    engines.push({ object: marker, glow, pivot: piv }); nacelles.push(piv);
  }
  // Abziehbilder (nur hoch): AEGIS + Kennung an Rumpf und Leitwerk
  const code = o.code || `KD-${String(((Math.abs(o.seed) || 1) - 1) % 99 + 1).padStart(2, '0')}`;
  if (hi) {
    const dk = [];
    for (const s of [-1, 1]) {
      dk.push(decalQuad(3.2, 1.6, 1, s, M4(s * 2.112, 0.95, 1.2)));
      dk.push(decalQuad(2.0, 0.8, 0, s, M4(s * (f(-9.4)[1] + 0.01), 0.95, -9.4)));
      dk.push(decalQuad(2.0, 0.8, 0, s, M4(s * (0.19 * 0.8 + 0.016), 4.6, 12.2)));
    }
    mk(g, merge(dk, true), decalMat(decalTex(code, K.ink)), o, null, null, false);
  }
  const lights = lightsBundle(g, [
    { p: [-9.25, 2.64, -1.78], color: 0xff2414, kind: 'nav', r: 0.1 },
    { p: [9.25, 2.64, -1.78], color: 0x20ff50, kind: 'nav', r: 0.1 },
    { p: [0, K.htailY + 0.25, 14.05], color: 0xffffff, kind: 'strobe', r: 0.1, k: 4 },
    { p: [0, 2.58, 5.0], color: 0xff3020, kind: 'beacon', r: 0.11, phase: 0.5 },
    { p: [0, -1.25, -3.0], color: 0xff3020, kind: 'beacon', r: 0.11 },
  ], o);
  g.userData = {
    kind: 'transport', type: 'kondor', lod: o.lod, length: K.len, groundY, engines, lights, ring: null, code,
    weapons: [{ object: turret, muzzle, kind: 'gun' }], nacelles,
    hatch: { object: ramp, closed: { rx: -ra }, open: { rx: 0.2 }, value: 0 }, throttle: o.throttle,
  };
  animateCraft(g, 0);
  return g;
}

// =====================================================================
// UFOs
// =====================================================================
const UFO3D = {
  scout: {
    R: 5, accent: 0x44ffc0, base: [124, 130, 138, 1], tint: [[140, 150, 160], [110, 118, 130], [130, 126, 140]], rough: 0.3, metal: 0.88, k: 2,
    prof: [[0, -0.86], [1.0, -0.85], [1.85, -0.8], [1.9, -0.72], [3.0, -0.55], [4.3, -0.3], [4.85, -0.16], [5.0, -0.06], [4.9, -0.04], [4.9, 0.04], [4.95, 0.06], [4.6, 0.14], [3.9, 0.32], [2.6, 0.62], [1.35, 0.9], [1.3, 0.98], [0, 1.0]],
    topRings: [1.35, 2.3, 3.2, 4.1, 4.95], botRings: [1.9, 2.8, 3.8, 4.6, 5.0],
    domes: [{ r: 1.25, y: 0.97, sy: 0.62 }, ...[0, 1, 2].map((k) => ({ r: 0.3, az: k * TAU / 3 + Math.PI / 3, d: 3.0, y: 0.5, sy: 0.7 }))],
    emit: [{ d: 0, az: 0, r: 1.8, y: -0.81 }], hatch: { r: 0.9, y: -0.86 }, lights: { n: 12, r: 4.7, y: -0.2 }, ring: { r: 4.9, y: 0, tube: 0.05 },
    weapons: [{ az: 0, d: 3.6, y: -0.45, s: 0.55, down: true }], channels: 3, vanes: 3,
  },
  fighter: {
    R: 9, accent: 0xff6a24, base: [74, 76, 84, 1], tint: [[84, 84, 92], [64, 66, 74], [86, 78, 76]], rough: 0.34, metal: 0.9, k: 3,
    prof: [[0, -0.85], [1.55, -0.84], [1.6, -0.76], [3.4, -0.6], [5.5, -0.32], [6.35, -0.1], [6.5, -0.04], [6.4, -0.02], [6.4, 0.05], [6.45, 0.08], [6.2, 0.2], [5.0, 0.48], [3.2, 0.78], [2.05, 0.95], [2.0, 1.05], [0, 1.12]],
    topRings: [2.05, 3.0, 4.2, 5.3, 6.45], botRings: [1.6, 2.6, 3.9, 5.2, 6.5],
    domes: [{ r: 1.95, y: 1.07, sy: 0.45 }, ...[0, 1].map((k) => ({ r: 0.35, az: Math.PI + (k - 0.5) * 0.9, d: 3.6, y: 0.7, sy: 0.6 }))],
    emit: [{ d: 0, az: 0, r: 1.5, y: -0.8 }], hatch: { r: 0.7, y: -0.85 }, lights: { n: 15, r: 6.2, y: -0.14 }, ring: { r: 6.42, y: 0.01, tube: 0.06 },
    blades: { n: 3, pts: [[5.4, -1.5], [7.6, -1.2], [9.0, -0.35], [8.8, 0.25], [7.2, 0.5], [5.4, 1.3]], t: 0.5 },
    weapons: [0, 1, 2].map((k) => ({ az: k * TAU / 3, d: 8.75, y: 0, s: 0.75, rot: -0.15 })), channels: 3,
  },
  freighter: {
    R: 16, accent: 0x4aa8ff, base: [96, 92, 88, 1], tint: [[108, 102, 94], [84, 82, 80], [100, 96, 104]], rough: 0.4, metal: 0.82, k: 4,
    prof: [[0, -2.6], [2.9, -2.58], [3.0, -2.4], [6.5, -2.25], [11.5, -1.75], [14.5, -1.05], [15.7, -0.45], [16.0, -0.2], [15.85, -0.15], [15.85, 0.15], [16.0, 0.2], [15.7, 0.6], [14.0, 1.0], [10.0, 1.38], [9.7, 1.42],
      [9.55, 1.7], [9.2, 2.45], [8.5, 2.95], [6.4, 3.35], [3.9, 3.55], [3.6, 3.6], [3.5, 3.75], [0, 3.8]],
    topRings: [3.6, 6.4, 9.6, 12.5, 14.8, 16], botRings: [3.0, 6.5, 9.5, 12.0, 14.5, 16],
    domes: [{ r: 3.4, y: 3.7, sy: 0.5 }, ...[0, 1, 2].map((k) => ({ r: 0.8, az: k * TAU / 3 + Math.PI / 3, d: 6.9, y: 3.15, sy: 0.75 }))],
    emit: [0, 1, 2, 3].map((k) => ({ d: 8.2, az: k * TAU / 4 + Math.PI / 4, r: 1.6, y: -2.1 })), hatch: { r: 2.85, y: -2.6 }, lights: { n: 24, r: 15.6, y: -0.5 }, ring: { r: 15.85, y: 0, tube: 0.12 },
    pods: { n: 4, d: 10.6, y: -1.85, r: 1.1, len: 6.5 },
    weapons: [-0.55, 0.55].map((az) => ({ az, d: 13.6, y: 1.12, s: 1.3 })), channels: 4,
  },
  battleship: {
    R: 30, accent: 0xc256ff, base: [62, 64, 74, 1], tint: [[70, 70, 84], [54, 56, 66], [76, 68, 80]], rough: 0.36, metal: 0.9, k: 6,
    prof: [[0, -4.2], [4.9, -4.15], [5.0, -3.9], [12, -3.45], [20, -2.6], [26, -1.4], [28.5, -0.55], [29, -0.25], [28.8, -0.2], [28.8, 0.2], [29, 0.25], [28.4, 0.9], [24, 1.8], [18.6, 2.55], [18.3, 2.75], [18.0, 4.0],
      [16.6, 4.75], [12.2, 5.5], [11.9, 5.8], [11.6, 8.3], [10.2, 9.3], [7.2, 9.95], [6.9, 10.25], [6.6, 11.4], [4.6, 12.3], [0, 12.55]],
    topRings: [4.6, 7.0, 11.8, 16.5, 18.4, 22, 25.5, 29], botRings: [5.0, 9, 13, 17, 21, 25, 29],
    domes: [{ r: 4.3, y: 12.35, sy: 0.5 }, ...[0, 1, 2, 3].map((k) => ({ r: 1.6, az: k * TAU / 4 + Math.PI / 4, d: 15.0, y: 4.95, sy: 0.7 }))],
    emit: [0, 1, 2, 3].map((k) => ({ d: 13, az: k * TAU / 4, r: 2.6, y: -3.4 })), hatch: { r: 4.8, y: -4.2 }, lights: { n: 32, r: 28.3, y: -0.75 }, ring: { r: 28.85, y: 0, tube: 0.2 },
    blades: { n: 8, off: TAU / 16, pts: [[24, -1.6], [30.5, -0.6], [31.8, 0], [30.5, 0.6], [24, 1.6]], t: 1.2 },
    weapons: Array.from({ length: 8 }, (_, k) => ({ az: k * TAU / 8 + TAU / 16, d: 31.4, y: 0.55, s: 1.5 })), channels: 8,
  },
};
const azXZ = (az, d) => [Math.sin(az) * d, -Math.cos(az) * d];
function ufoYAt(U, r, upper) { // Hüllhöhe bei Radius r (Ober-/Unterseite)
  const p = U.prof, list = upper ? p.slice(p.findIndex(([, y]) => y >= 0)) : p.slice(0, p.findIndex(([, y]) => y >= 0));
  let best = upper ? -1e9 : 1e9;
  for (let i = 0; i < list.length - 1; i++) { const [r0, y0] = list[i], [r1, y1] = list[i + 1]; if ((r - r0) * (r - r1) <= 0 && r0 !== r1) { const y = lerp(y0, y1, (r - r0) / (r1 - r0)); best = upper ? Math.max(best, y) : Math.min(best, y); } }
  return Math.abs(best) > 1e8 ? 0 : best;
}
function paintUfo(P, U, L) {
  const R = P.rand, rr = (a, b) => P.rr(a, b), { top, bot, band } = L, Rad = U.R, s = Rad / 10, acc = new THREE.Color(U.accent);
  const accA = [acc.r * 255, acc.g * 255, acc.b * 255];
  const arc = (r, a0, a1, n = 12) => Array.from({ length: n + 1 }, (_, i) => { const a = lerp(a0, a1, i / n); return [Math.cos(a) * r, Math.sin(a) * r]; });
  // 1) Panelsegmente mit Legierungs-Tönung
  for (const [r, rings] of [[top, U.topRings], [bot, U.botRings]]) {
    P.use(r);
    const seams = [], nodes = [];
    for (let i = 0; i < rings.length - 1; i++) {
      const r0 = rings[i], r1 = rings[i + 1], n = Math.max(6, Math.round(TAU * r1 / (Rad * 0.32))), off = R() * TAU;
      for (let j = 0; j < n; j++) {
        const a0 = off + j / n * TAU, a1 = off + (j + 1) / n * TAU, tt = U.tint[(R() * U.tint.length) | 0];
        P.poly([...arc(r1, a0, a1, 8), ...arc(r0, a1, a0, 8)], { A: [...tt, rr(0.2, 0.5)], R: [rr(40, 130), 0.5], H: [rr(118, 138), 1] });
        seams.push([[Math.cos(a0) * r0, Math.sin(a0) * r0], [Math.cos(a0) * r1, Math.sin(a0) * r1]]);
        nodes.push([Math.cos(a0) * r1, Math.sin(a0) * r1, 0.035 * s * 3]);
      }
      seams.push(arc(r0, 0, TAU, 64));
    }
    P.panels(seams, { w: 0.03 * s * 1.6, dark: 0.7 });
    P.dots(nodes, { H: [190, 1], A: [170, 176, 186, 0.6], M: [250, 1], R: [50, 1] });
  }
  P.use(band);
  const C = band.ah, nb = Math.max(8, Math.round(C / (1.1 * s)));
  { const yr = [band.bl, band.bh], seams = []; for (let j = 0; j < nb; j++) seams.push([[j / nb * C, yr[0]], [j / nb * C, yr[1]]]);
    for (let j = 0; j < nb * 2; j++) P.poly([[j / nb / 2 * C, yr[0]], [(j + 1) / nb / 2 * C, yr[0]], [(j + 1) / nb / 2 * C, yr[1]], [j / nb / 2 * C, yr[1]]], { A: [...U.tint[(R() * U.tint.length) | 0], rr(0.15, 0.4)], R: [rr(50, 130), 0.4] });
    for (const y of [-0.3, 0.25, 0.6].map((k) => k * (yr[1] - yr[0]) * 0.5)) seams.push([[0, y], [C, y]]);
    P.panels(seams, { w: 0.03 * s * 1.6, dark: 0.6 }); }
  // 2) Leuchtende Kanäle (Emission) + Glyphen
  const chan = (pl, w) => { P.strokes([pl], w * 2.6, { A: [18, 22, 26, 1], H: [58, 1], R: [70, 1], M: [120, 1] }); P.strokes([pl], w, { E: [255, 255, 255, 1], A: [...accA.map((v) => v * 0.6 + 40), 1] }); P.strokes([pl], w * 4, { E: [255, 255, 255, 0.25], blur: 3 }); };
  P.use(top);
  for (let c = 0; c < U.channels; c++) {
    const a = c / U.channels * TAU + 0.3, r0 = U.topRings[1] + 0.1 * s, r1 = U.topRings[U.topRings.length - 2], k = lerp(r0, r1, 0.5);
    chan([[Math.cos(a) * r0, Math.sin(a) * r0], [Math.cos(a) * k, Math.sin(a) * k], [Math.cos(a + 0.12) * (k + 0.4 * s), Math.sin(a + 0.12) * (k + 0.4 * s)], [Math.cos(a + 0.12) * r1, Math.sin(a + 0.12) * r1]], 0.05 * s);
  }
  chan(arc(lerp(U.topRings[1], U.topRings[2], 0.5), 0, TAU, 96), 0.04 * s);
  P.use(bot);
  chan(arc(U.botRings[0] + 0.25 * s, 0, TAU, 96), 0.05 * s);
  chan(arc(U.botRings[U.botRings.length - 2] - 0.2 * s, 0, TAU, 128), 0.035 * s);
  P.use(band);
  { const ym = band.bl + (band.bh - band.bl) * 0.62; chan([[0, ym], [C, ym]], 0.04 * s);
    for (let j = 0; j < 6; j++) { const a = (j + 0.5) / 6 * C, hw = 0.07 * s; P.poly([[a - hw, ym + 0.12 * s], [a + hw, ym + 0.12 * s], [a + hw, ym + 0.5 * s], [a - hw, ym + 0.5 * s]], { E: [255, 255, 255, 0.85], A: [...accA, 0.7] }); } }
  // Glyphenzeilen
  P.use(band);
  for (let j = 0; j < 3; j++) {
    const m = glyphMask(5, 48, R, hash(U.accent + ':' + j));
    P.stamp(m, (j + 0.3) / 3 * C, band.bl + (band.bh - band.bl) * 0.45, 0.32 * s, [1, 0], { A: [24, 26, 30, 0.75], H: [92, 1], E: [255, 255, 255, j === 1 ? 0.5 : 0.18] });
  }
  P.use(top);
  { const rg = lerp(U.topRings[2], U.topRings[3], 0.5); for (let k = 0; k < 14; k++) { const a = k / 14 * TAU; P.stamp(glyphMask(1, 48, R, hash('g' + k + U.R)), Math.cos(a) * rg, Math.sin(a) * rg, 0.28 * s, [-Math.sin(a), Math.cos(a)], { A: [24, 26, 30, 0.7], H: [90, 1], E: [255, 255, 255, k % 4 ? 0.12 : 0.6] }); } }
  // 3) Anlauffarben (Hitzeverfärbung): Unterseite, Rand, um Emitter
  const heat = [[[214, 176, 90], 0.96], [[176, 104, 58], 0.88], [[120, 66, 160], 0.78], [[62, 96, 180], 0.66]];
  P.use(bot);
  for (const [c, k] of heat) P.strokes([arc(Rad * k, 0, TAU, 96)], Rad * 0.09, { A: [...c, 0.22], blur: Math.max(3, Rad * 0.03 * bot.ppm) });
  for (const e of U.emit) { const [x, z] = azXZ(e.az, e.d); for (const [c, k] of heat) P.strokes([arc(e.r * (1 + (1 - k) * 2.5), 0, TAU, 48).map(([a, b]) => [a + x, b + z])], e.r * 0.25, { A: [...c, 0.2], blur: 3 }); }
  P.use(top);
  for (const [c, k] of heat.slice(0, 2)) P.strokes([arc(Rad * k, 0, TAU, 96)], Rad * 0.05, { A: [...c, 0.14], blur: Math.max(3, Rad * 0.02 * top.ppm) });
  P.use(band);
  { const h = band.bh - band.bl; heat.forEach(([c], i) => P.poly([[-1, band.bl + h * i * 0.1], [C + 1, band.bl + h * i * 0.1], [C + 1, band.bl + h * (i * 0.1 + 0.14)], [-1, band.bl + h * (i * 0.1 + 0.14)]], { A: [...c, 0.2], blur: 4 })); }
  // 4) Mikrometeoriten-Pockennarben
  for (const r of [top, band, bot]) {
    P.use(r);
    const n = r === bot ? 600 : 1600, pits = [], rims = [];
    for (let i = 0; i < n; i++) {
      let a, b; if (r === band) { a = R() * C; b = rr(band.bl, band.bh); } else { const ang = R() * TAU, d = Math.sqrt(R()) * Rad; a = Math.cos(ang) * d; b = Math.sin(ang) * d; }
      const rad = (R() ** 6 * 0.05 + 0.006) * s;
      pits.push([a, b, rad]); if (rad > 0.03 * s) rims.push([a, b, rad * 1.5]);
    }
    P.dots(rims, { H: [150, 1], A: [190, 196, 205, 0.18] });
    P.dots(pits, { H: [96, 1], A: [30, 30, 34, 0.45], R: [170, 0.5], O: [170, 0.5] });
  }
  // 5) Eingebrannte Plasmaspuren
  for (const r of [top, band, bot]) {
    P.use(r);
    const nB = r === band ? 4 : 5;
    for (let i = 0; i < nB; i++) {
      let a, b, sc; if (r === band) { a = R() * C; b = rr(band.bl, band.bh); sc = 0.35 * s; } else { const ang = R() * TAU, d = rr(0.3, 0.92) * Rad; a = Math.cos(ang) * d; b = Math.sin(ang) * d; sc = 0.6 * s; }
      const sa = 1;
      P.soft(a, b, sc * 2.2 * sa, sc * 2.2, { A: [110, 70, 160, 0.28], R: [150, 0.3] });
      P.soft(a, b, sc * 1.4 * sa, sc * 1.4, { A: [150, 100, 60, 0.3] });
      P.polys([blob(a, b, sc, R, 13, sa, 1)], { A: [16, 12, 14, 0.85], R: [235, 1], M: [70, 1], H: [104, 1] });
      for (let k = 0; k < 5; k++) { const ang = R() * TAU; P.streak(a, b, Math.cos(ang) * sa, Math.sin(ang), sc * rr(1.5, 3.5), sc * 0.35 * sa, 0.0, { A: [20, 14, 18, 0.55], R: [220, 0.6] }); }
    }
  }
  P.use(top);
  for (let i = 0; i < 3; i++) { const ang = R() * TAU, d = rr(0.4, 0.8) * Rad, a = Math.cos(ang) * d, b = Math.sin(ang) * d, da = Math.cos(ang + 1.4), db = Math.sin(ang + 1.4); P.streak(a, b, da, db, Rad * 0.35, 0.12 * s, 0.03 * s, { A: [14, 10, 14, 0.8], R: [230, 0.8], M: [80, 0.7] }); P.streak(a, b, da, db, Rad * 0.38, 0.3 * s, 0.1 * s, { A: [100, 70, 150, 0.25] }); }
  // 6) Laufspuren am Rand, Kratzer
  P.use(band);
  for (let i = 0; i < 40; i++) P.streak(R() * C, rr(band.bl + (band.bh - band.bl) * 0.3, band.bh), 0, -1, rr(0.2, 0.8) * s, 0.06 * s, 0.02 * s, { A: [24, 22, 26, 0.4], R: [150, 0.4] });
  P.use(top);
  { const sc = []; for (let i = 0; i < 40; i++) { const r0 = rr(0.3, 0.95) * Rad, a0 = R() * TAU; sc.push(arc(r0, a0, a0 + rr(0.05, 0.3), 6)); } P.strokes(sc, 0.012 * s, { A: [190, 196, 206, 0.3], M: [250, 0.6], R: [40, 0.5] }); }
}

export function makeUfo(type = 'scout', opts = {}) {
  const key = UFO3D[type] ? type : 'scout', U = UFO3D[key];
  const o = norm(opts), hi = o.hi, seg = hi ? 96 : 40, Rad = U.R;
  const ys = U.prof.map(([, y]) => y), yr = [Math.min(...ys) - 0.05 * Rad, Math.max(...ys) + 0.05 * Rad];
  let E = Rad; for (const [x] of U.blades?.pts || []) E = Math.max(E, x); for (const w of U.weapons) E = Math.max(E, w.d + 1.6 * w.s);
  const L = discLayout(Rad, E + 0.1, yr, U.k);
  const accent = new THREE.Color(o.accent ?? U.accent);
  const tex = typeTex('ufo-' + key, o.S, { color: U.base, rough: U.rough, metal: U.metal, emissive: true, bump: 3 }, (P) => paintUfo(P, U, L));
  const kit = new Kit();
  kit.add('hull', lathe(U.prof, seg, 28));
  // Klingen / Stacheln
  if (U.blades) for (let k = 0; k < U.blades.n; k++) {
    const az = k * TAU / U.blades.n + (U.blades.off || 0);
    kit.add('hull', slab(U.blades.pts, U.blades.t, { tip: 0.45, segs: hi ? 2 : 1 }), M4(0, 0, 0, 0, Math.PI / 2 - az, 0));
  }
  // Frachtgondeln
  if (U.pods) for (let k = 0; k < U.pods.n; k++) {
    const az = k * TAU / U.pods.n + TAU / (2 * U.pods.n), [x, z] = azXZ(az, U.pods.d), P = U.pods;
    const pg = lathe([[0, -P.len / 2], [P.r * 0.6, -P.len / 2 + 0.1], [P.r, -P.len / 2 + P.r * 0.8], [P.r, P.len / 2 - P.r * 0.8], [P.r * 0.6, P.len / 2 - 0.1], [0, P.len / 2]], hi ? 24 : 12, 35);
    pg.rotateZ(Math.PI / 2);
    kit.add('hull', pg, M4(x, P.y, z, 0, -az, 0));
    kit.add('trim', box(P.len * 0.7, P.r * 0.5, 0.15), M4(x * 0.96, P.y + P.r * 0.6, z * 0.96, 0, -az, 0));
  }
  // Bauchflossen (Späher)
  if (U.vanes) for (let k = 0; k < U.vanes; k++) { const az = k * TAU / U.vanes + Math.PI / 3, [x, z] = azXZ(az, 3.4); kit.add('hull', fin([[-0.6, -0.3], [-0.2, -0.75], [0.4, -0.75], [0.7, -0.3]], 0.12, 0.6, 1), M4(x, -0.15, z, 0, -az + Math.PI / 2, 0)); }
  // Sensorkuppeln (Glas)
  for (const d of U.domes) {
    const [x, z] = d.d ? azXZ(d.az, d.d) : [0, 0];
    kit.add('dome', new THREE.SphereGeometry(d.r, hi ? 32 : 16, hi ? 12 : 6, 0, TAU, 0, Math.PI / 2), M4(x, d.y, z, 0, 0, 0, 1, d.sy, 1));
    kit.add('trim', new THREE.TorusGeometry(d.r * 1.02, d.r * 0.06, 6, hi ? 32 : 16), M4(x, d.y, z, Math.PI / 2));
  }
  // Antennenmast (Frachter/Schlachtschiff)
  if (Rad >= 16) { const [x, z] = azXZ(Math.PI, Rad * 0.32); const y = ufoYAt(U, Rad * 0.32, true); kit.add('trim', new THREE.CylinderGeometry(0.05 * Rad / 10, 0.12 * Rad / 10, Rad * 0.12, 6), M4(x, y + Rad * 0.06, z)); kit.add('trim', new THREE.SphereGeometry(0.15 * Rad / 10, 8, 6), M4(x, y + Rad * 0.12, z)); }
  // Waffenknoten
  const turretGeo = (s) => {
    const tk = new Kit();
    tk.add('t', lathe([[0, -0.32], [0.55, -0.32], [0.62, -0.1], [0.52, 0.25], [0.26, 0.42], [0, 0.45]].map(([r, y]) => [r * s, y * s]), hi ? 20 : 10, 35));
    for (const sx of [-1, 1]) tk.add('t', cylZ(0.07 * s, 0.11 * s, 1.3 * s, 8), M4(sx * 0.2 * s, 0.05 * s, -0.75 * s));
    tk.add('t', box(0.5 * s, 0.1 * s, 0.6 * s), M4(0, 0.05 * s, -0.45 * s));
    tk.add('t', new THREE.OctahedronGeometry(0.17 * s), M4(0, 0.05 * s, -1.38 * s));
    return tk.geo('t');
  };
  const g = new THREE.Group(); g.name = 'UFO ' + key;
  const hull = surfMat(tex, o, { map: tex.map, emissiveMap: tex.emissive, emissive: accent, emissiveIntensity: 2.4 }, { iridescence: 0.3, iridescenceIOR: 1.7, iridescenceThicknessRange: [180, 520], clearcoat: 0.15 });
  const trim = surfMat(tex, o, { color: 0x2c2e34, emissiveMap: tex.emissive, emissive: accent, emissiveIntensity: 0.6 });
  const weapons = [], wk = new Kit();
  for (const w of U.weapons) {
    const [x, z] = azXZ(w.az, w.d), rotY = -w.az;
    const eu = new THREE.Euler(w.down ? -0.1 : (w.rot || 0), rotY, w.down ? Math.PI : 0, 'YXZ');
    const m4 = new THREE.Matrix4().compose(V3(x, w.y, z), new THREE.Quaternion().setFromEuler(eu), V3(1, 1, 1));
    if (hi) {
      const m = mk(g, turretGeo(w.s), trim, o, L, m4); m.position.set(x, w.y, z); m.rotation.copy(eu);
      const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.05 * w.s, -1.5 * w.s); m.add(muzzle);
      weapons.push({ object: m, muzzle, kind: 'plasma' });
    } else {
      wk.add('t', turretGeo(w.s), m4);
      const m = new THREE.Object3D(); m.position.set(x, w.y, z); m.rotation.copy(eu); g.add(m);
      const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.05 * w.s, -1.5 * w.s); m.add(muzzle);
      weapons.push({ object: m, muzzle, kind: 'plasma' });
    }
  }
  if (!hi) for (const gg of wk.parts.get('t') || []) kit.add('trim', gg);
  mk(g, kit.geo('hull'), hull, o, L);
  mk(g, kit.geo('trim'), trim, o, L);
  const domeM = new (hi ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial)({ color: 0x070b0e, metalness: 0.5, roughness: 0.06, emissive: accent.clone().multiplyScalar(0.05), ...(hi ? { clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0.5, iridescenceIOR: 1.4 } : {}) });
  mk(g, kit.geo('dome'), domeM, o, null, null, false);
  // Leuchtring im Randfalz (segmentiert → Rotation sichtbar)
  const rk = new Kit(), nSeg = hi ? 36 : 18;
  for (let k = 0; k < nSeg; k++) { const t = new THREE.TorusGeometry(U.ring.r, U.ring.tube, 6, 4, TAU / nSeg * 0.72); t.rotateX(Math.PI / 2); t.rotateY(k / nSeg * TAU); rk.add('r', t); }
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: accent, emissiveIntensity: 3.2, roughness: 0.4, metalness: 0.2 });
  const ring = new THREE.Mesh(rk.geo('r'), ringMat); ring.position.y = U.ring.y; g.add(ring);
  // Unterseite: Antriebsfelder
  const emitM = glowMat(accent.getHex(), 2.4, glowTex()), engines = [];
  const emitGeo = (e) => { const c = new THREE.CircleGeometry(e.r, 32); c.rotateX(Math.PI / 2); return ni(c, true); };
  if (hi || U.emit.length === 1) {
    for (const e of U.emit) { const [x, z] = azXZ(e.az, e.d); const m = new THREE.Mesh(emitGeo(e), emitM); m.position.set(x, e.y - 0.02, z); g.add(m); engines.push({ object: m, glow: m }); }
  } else {
    const gl = new THREE.Mesh(merge(U.emit.map((e) => { const gg = emitGeo(e); const [x, z] = azXZ(e.az, e.d); gg.translate(x, e.y - 0.02, z); return gg; }), true), emitM); g.add(gl);
    for (const e of U.emit) { const [x, z] = azXZ(e.az, e.d); const m = new THREE.Object3D(); m.position.set(x, e.y, z); g.add(m); engines.push({ object: m, glow: gl }); }
  }
  // Bodenluke
  const hg = lathe([[0, -0.12], [U.hatch.r * 0.96, -0.08], [U.hatch.r, 0.05], [0, 0.06]], hi ? 40 : 20, 30);
  const hatchMesh = mk(g, hg, trim, o, L, M4(0, U.hatch.y, 0)); hatchMesh.position.y = U.hatch.y;
  // Randlichter (zwei Phasen)
  const LL = U.lights, la = [], lb = [];
  for (let i = 0; i < LL.n; i++) { const a = i / LL.n * TAU; (i % 2 ? lb : la).push({ p: [Math.cos(a) * LL.r, LL.y, Math.sin(a) * LL.r], r: 0.045 * Rad / 5 }); }
  const lights = [];
  const bundle = (list, col, phase) => {
    if (!list.length) return;
    const parts = list.map((l) => { const s = ni(new THREE.SphereGeometry(l.r, 8, 6)); s.translate(...l.p); return s; });
    const m = new THREE.Mesh(merge(parts), lightMat(col, 3)); g.add(m);
    lights.push({ object: m, color: new THREE.Color(col).multiplyScalar(3), kind: 'ufo', phase });
  };
  if (hi) { bundle(la, accent.getHex(), 0); bundle(lb, 0xffffff, 0.5); } else bundle([...la, ...lb], accent.getHex(), 0);
  g.userData = {
    kind: 'ufo', type: key, lod: o.lod, radius: Rad, length: Rad * 2, groundY: yr[0], engines, lights, weapons, ring, accent,
    hatch: { object: hatchMesh, closed: { y: U.hatch.y }, open: { y: U.hatch.y - Rad * 0.12 }, value: 0 }, throttle: o.throttle ?? 1,
  };
  animateCraft(g, 0);
  return g;
}

// =====================================================================
// Animation, Luke, Freigabe
// =====================================================================
/** Blinklichter, Triebwerksglühen (userData.throttle 0..1 oder opt.throttle), UFO-Ring. t in Sekunden. */
export function animateCraft(g, t, opt = {}) {
  const u = g?.userData; if (!u?.kind) return;
  const thr = clamp(opt.throttle ?? u.throttle ?? 0, 0, 1);
  const fl = 0.92 + 0.08 * Math.sin(t * 37) * Math.sin(t * 23);
  const seen = new Set();
  for (const e of u.engines || []) {
    const gl = e.glow; if (!gl || seen.has(gl)) continue; seen.add(gl);
    if (u.kind === 'ufo') { gl.visible = true; gl.material.opacity = (0.35 + 0.65 * thr) * (0.85 + 0.15 * Math.sin(t * 2.3)); continue; }
    gl.visible = thr > 0.01;
    gl.scale.set(1, 1, 0.25 + thr * 1.1 * fl);
    gl.material.opacity = (0.35 + 0.65 * thr) * fl;
  }
  for (const L of u.lights || []) {
    const m = L.object.material; if (!m || L.kind === 'merged') continue;
    let k = 1;
    if (L.kind === 'strobe') k = ((t * 1.1 + L.phase) % 1) < 0.07 ? 1.6 : 0.05;
    else if (L.kind === 'beacon') k = 0.15 + 0.85 * Math.max(0, Math.sin((t * 1.4 + L.phase) * TAU)) ** 4;
    else if (L.kind === 'ufo') k = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin((t * 1.2 + L.phase) * TAU));
    m.color.copy(L.color).multiplyScalar(k);
  }
  if (u.ring) { u.ring.rotation.y = t * 0.8; u.ring.material.emissiveIntensity = 2.6 + Math.sin(t * 3) * 0.8; }
}
/** Luke/Rampe öffnen: f = 0 (zu) … 1 (offen). */
export function setHatch(g, f) {
  const h = g?.userData?.hatch; if (!h) return;
  h.value = clamp(f, 0, 1);
  if (h.closed.rx !== undefined) h.object.rotation.x = lerp(h.closed.rx, h.open.rx, h.value);
  if (h.closed.y !== undefined) h.object.position.y = lerp(h.closed.y, h.open.y, h.value);
}
/** Kondor: Schwenkgondeln neigen (0 = Reiseflug, π/2 = senkrecht). */
export function setTilt(g, a) { for (const p of g?.userData?.nacelles || []) p.rotation.x = a; }
/** Geometrien und Materialien freigeben (gecachte Texturen bleiben erhalten). */
export function disposeCraft(g) {
  if (!g) return;
  g.traverse((o) => {
    o.geometry?.dispose?.();
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    ms.forEach((m) => m.dispose());
  });
  g.removeFromParent();
}
/** Optional: alle gecachten Fahrzeugtexturen freigeben (z. B. bei Speichermangel). */
export function clearCraftTextureCache() {
  for (const t of TEX.values()) Object.values(t).forEach((x) => x?.dispose?.());
  TEX.clear();
  for (const k in SMALL) { SMALL[k].dispose(); delete SMALL[k]; }
}
