// Allgemeine Hilfsfunktionen: Zufall, Mathe, Namen, Formatierung
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (cur, target, rate, dt) => lerp(cur, target, 1 - Math.exp(-rate * dt));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const DEG = Math.PI / 180;

let seed = (Date.now() ^ 0x5bd1e995) >>> 0;
export function rand() {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const randInt = (a, b) => a + Math.floor(rand() * (b - a + 1));
export const randRange = (a, b) => a + rand() * (b - a);
export const choice = (arr) => arr[Math.floor(rand() * arr.length)];
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function fmtMoney(v) {
  const s = Math.round(v).toLocaleString('de-DE');
  return s + ' ¢';
}

export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// Spielzeit in Minuten seit Start (1. Januar 2031, 00:00)
export function fmtDate(minutes) {
  const d = new Date(Date.UTC(2031, 0, 1) + minutes * 60000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return { day: d.getUTCDate(), month: d.getUTCMonth(), year: d.getUTCFullYear(), text: `${d.getUTCDate()}. ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, time: `${hh}:${mm}` };
}

// Kugelkoordinaten (Breite/Länge in Radiant) <-> Einheitsvektor
export function latLonToVec(lat, lon, out = { x: 0, y: 0, z: 0 }) {
  const c = Math.cos(lat);
  out.x = c * Math.cos(lon);
  out.y = Math.sin(lat);
  out.z = -c * Math.sin(lon);
  return out;
}
export function vecToLatLon(v) {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { lat: Math.asin(clamp(v.y / len, -1, 1)), lon: Math.atan2(-v.z, v.x) };
}
export function angleBetween(a, b) {
  const d = clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1);
  return Math.acos(d);
}
// Großkreis-Schritt: bewegt Vektor a um 'step' Radiant Richtung b
export function slerpStep(a, b, step) {
  const ang = angleBetween(a, b);
  if (ang < 1e-6 || step >= ang) return { x: b.x, y: b.y, z: b.z, arrived: true };
  const t = step / ang;
  const s = Math.sin(ang);
  const w1 = Math.sin((1 - t) * ang) / s, w2 = Math.sin(t * ang) / s;
  return { x: a.x * w1 + b.x * w2, y: a.y * w1 + b.y * w2, z: a.z * w1 + b.z * w2, arrived: false };
}

const FIRST = ['Lena', 'Jonas', 'Aiko', 'Mateo', 'Sven', 'Nadia', 'Kofi', 'Ingrid', 'Ravi', 'Elena', 'Tomasz', 'Yara', 'Luca', 'Mira', 'Hugo', 'Amara', 'Erik', 'Sofia', 'Dmitri', 'Leila', 'Finn', 'Chen', 'Paula', 'Omar', 'Hana', 'Pierre', 'Zoe', 'Kenji', 'Marta', 'Diego', 'Freya', 'Tariq', 'Anouk', 'Viktor', 'Imani', 'Noah', 'Kaja', 'Rafael', 'Saoirse', 'Bjorn'];
const LAST = ['Becker', 'Tanaka', 'Silva', 'Nowak', 'Okafor', 'Lindqvist', 'Sharma', 'Rossi', 'Kowalski', 'Haddad', 'Moreau', 'Novak', 'Petrov', 'Nakamura', 'Fischer', 'Mensah', 'Larsen', 'García', 'Weber', 'Kim', 'Dubois', 'Schulz', 'Costa', 'Ivanova', 'Ahmed', 'Murphy', 'Jensen', 'Vargas', 'Wolff', 'Adeyemi', 'Brandt', 'Sato', 'Oliveira', 'Keller', 'Horvath', 'Yilmaz'];
export const randomName = () => `${choice(FIRST)} ${choice(LAST)}`;

// --- 2D-Wertrauschen für Texturen (schnell, kachelbar) ---
export function makeValueNoise2D(size, rng = rand) {
  const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const at = (x, y) => g[((y % size + size) % size) * size + ((x % size + size) % size)];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  };
}
export function fbm2(noise, x, y, oct = 4) {
  let a = 0.5, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += noise(x * f, y * f) * a; n += a; a *= 0.5; f *= 2; }
  return s / n;
}

export function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

export class Emitter {
  constructor() { this._h = {}; }
  on(ev, fn) { (this._h[ev] ||= []).push(fn); return () => this.off(ev, fn); }
  off(ev, fn) { const l = this._h[ev]; if (l) this._h[ev] = l.filter((f) => f !== fn); }
  emit(ev, ...a) { (this._h[ev] || []).slice().forEach((f) => f(...a)); }
}
