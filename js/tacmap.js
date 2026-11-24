// Prozedurale Schlachtfeld-Generierung für Bodeneinsätze
import { rand, randInt, choice, shuffle, clamp } from './util.js';

// full = blockiert Sicht, move = blockiert Bewegung, cover: 0 keine, 1 halbe, 2 volle Deckung
export const WALLS = {
  brick: { full: true, move: true, hp: 70, h: 2.8 },
  wood: { full: true, move: true, hp: 40, h: 2.6 },
  window: { full: false, move: true, hp: 30, h: 2.8, cover: 1 },
  metal: { full: true, move: true, hp: 400, h: 2.8 },
  hivewall: { full: true, move: true, hp: 260, h: 3.4 },
  tree: { full: true, move: true, hp: 45, h: 5 },
  pine: { full: true, move: true, hp: 45, h: 6 },
  bigrock: { full: true, move: true, hp: 300, h: 2.6 },
  fence: { full: false, move: true, hp: 14, h: 1.1, cover: 1 },
  hedge: { full: false, move: true, hp: 25, h: 1.3, cover: 1 },
  rock: { full: false, move: true, hp: 150, h: 1.1, cover: 1 },
  crate: { full: false, move: true, hp: 35, h: 1.15, cover: 1 },
  hay: { full: false, move: true, hp: 20, h: 1.2, cover: 1 },
  car: { full: false, move: true, hp: 90, h: 1.4, cover: 1 },
  barrier: { full: false, move: true, hp: 120, h: 1.0, cover: 1 },
  wreck: { full: false, move: true, hp: 120, h: 1.2, cover: 1 },
  console: { full: false, move: true, hp: 100, h: 1.2, cover: 1 },
  reactor: { full: false, move: true, hp: 250, h: 1.6, cover: 1 },
  pod: { full: false, move: true, hp: 60, h: 1.5, cover: 1 },
  log: { full: false, move: true, hp: 60, h: 0.9, cover: 1 },
  // --- Erweiterung laut orchestrator/karten/vertrag.md ---
  stone: { full: true, move: true, hp: 120, h: 2.8 },
  concrete: { full: true, move: true, hp: 200, h: 2.8 },
  metalsheet: { full: true, move: true, hp: 60, h: 3.2 },
  plaster: { full: true, move: true, hp: 70, h: 2.8 },
  glass: { full: false, move: true, hp: 10, h: 2.6, cover: 0 },
  stonewall: { full: false, move: true, hp: 90, h: 1.0, cover: 1 },
  sandbag: { full: false, move: true, hp: 80, h: 1.0, cover: 1 },
  woodpile: { full: false, move: true, hp: 40, h: 1.1, cover: 1 },
  bush: { full: false, move: true, hp: 15, h: 1.1, cover: 1 },
  tallhedge: { full: true, move: true, hp: 35, h: 2.2 },
  birch: { full: true, move: true, hp: 40, h: 6 },
  oak: { full: true, move: true, hp: 60, h: 7 },
  palm: { full: true, move: true, hp: 35, h: 6 },
  deadtree: { full: true, move: true, hp: 25, h: 4 },
  stump: { full: false, move: true, hp: 30, h: 0.6, cover: 1 },
  rockpile: { full: false, move: true, hp: 120, h: 0.9, cover: 1 },
  container: { full: true, move: true, hp: 200, h: 2.6 },
  pallet: { full: false, move: true, hp: 25, h: 0.9, cover: 1 },
  barrel: { full: false, move: true, hp: 30, h: 1.0, cover: 1 },
  fuelbarrel: { full: false, move: true, hp: 20, h: 1.0, cover: 1, explosive: true },
  fuelpump: { full: false, move: true, hp: 40, h: 1.6, cover: 1, explosive: true },
  bus: { full: true, move: true, hp: 150, h: 3.0 },
  truck: { full: true, move: true, hp: 160, h: 3.2 },
  milwreck: { full: true, move: true, hp: 300, h: 2.4 },
  well: { full: false, move: true, hp: 120, h: 1.0, cover: 1 },
  fountain: { full: false, move: true, hp: 150, h: 1.2, cover: 1 },
  gravestone: { full: false, move: true, hp: 60, h: 1.0, cover: 1 },
  statue: { full: true, move: true, hp: 200, h: 3.0 },
  pylon: { full: false, move: true, hp: 150, h: 6, cover: 1 },
  watertank: { full: true, move: true, hp: 150, h: 4 },
  silo: { full: true, move: true, hp: 200, h: 8 },
  scaffold: { full: false, move: true, hp: 30, h: 3.0, cover: 1 },
  tent: { full: false, move: true, hp: 10, h: 1.4, cover: 1 },
  milcrate: { full: false, move: true, hp: 60, h: 1.0, cover: 1 },
  chainlink: { full: false, move: true, hp: 20, h: 2.0, cover: 0 },
  // Tiefes Wasser: unpassierbar, Sicht frei, NICHT zerstörbar. Schadenscode (damageWall/Explosionen)
  // muss Felder mit WALLS[t].indestructible überspringen; hp ist nur ein Sicherheitsnetz.
  water: { full: false, move: true, hp: 99999, h: 0, cover: 0, indestructible: true },
};
// Neue Bodentypen (cell.floor): gravel, mud, plank (Steg/Brücke), cobble, concretefloor, shore, crops, vineyard,
// graveyard, parking, ice (gefrorener See, begehbar). Dazu weiterhin grass/field/field2/dirt/sand/snow/asphalt/... .
// Variation: wall.rot = Blickrichtung in Vierteldrehungen (0 = Süd/+y, 1 = West, 2 = Nord, 3 = Ost; längliche
// Objekte liegen entlang ihrer Blickrichtung), wall.variant = 0..3 (Farbe/Form). Fahrzeuge vom Typ 'car' behalten
// ihre Varianten-Namen ('tractor', 'pickup', ...) und 'vert'.
const VARY = new Set(['stonewall', 'sandbag', 'woodpile', 'bush', 'tallhedge', 'birch', 'oak', 'palm', 'deadtree', 'stump', 'rockpile', 'container', 'pallet', 'barrel', 'fuelbarrel', 'fuelpump', 'bus', 'truck', 'milwreck', 'well', 'fountain', 'gravestone', 'statue', 'pylon', 'watertank', 'silo', 'scaffold', 'tent', 'milcrate', 'chainlink']);
const SIDE_V = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };
const ROTSEQ = ['s', 'w', 'n', 'e'];
const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const TREES = new Set(['tree', 'pine', 'birch', 'oak', 'palm', 'deadtree']);
const HARD_FLOORS = new Set(['asphalt', 'sidewalk', 'tile', 'wood', 'metal', 'plank', 'cobble', 'concretefloor', 'parking', 'ice', 'hive']);
const NATURAL = new Set(['grass', 'field', 'field2', 'dirt', 'sand', 'snow', 'mud', 'gravel', 'shore', 'graveyard']);

function mkWall(type, o = {}) {
  const w = { type, hp: WALLS[type].hp };
  if (o.rot != null) w.rot = ((o.rot % 4) + 4) % 4;
  if (o.variant != null) w.variant = o.variant; else if (VARY.has(type)) w.variant = randInt(0, 3);
  if (o.vert != null) w.vert = o.vert;
  return w;
}
function pickW(obj) { let s = 0; for (const k in obj) s += obj[k]; let r = rand() * s; for (const k in obj) { r -= obj[k]; if (r < 0) return k; } return Object.keys(obj)[0]; }
// Freies Feld für Füll-Hindernisse (nicht in Modulen, Wegen, UFO-Zone oder Landezone)
const freeCell = (c) => !!c && !c.wall && !c.indoor && !c.reserved && !c.keep && !c.uz && !c.mod;

// Nicht blockierende Deko (nur Optik): Typ, Feld, Versatz im Feld (Welteinheiten), Drehung, Skalierung
function deco(map, t, x, y, o = {}) {
  map.deco.push({ t, x, y, ox: o.ox ?? (rand() - 0.5) * 1.2, oz: o.oz ?? (rand() - 0.5) * 1.2, rot: o.rot ?? rand() * Math.PI * 2, s: o.s ?? 0.8 + rand() * 0.45 });
}
// Freies Außenfeld für Deko
const freeOut = (at, x, y) => { const c = at(x, y); return c && !c.wall && !c.indoor && !c.reserved; };

export function generateMap({ biome, ufoType, kind, night }) {
  const sizes = { scout: 30, fighter: 34, freighter: 38, battleship: 42 };
  let W = kind === 'terror' ? 36 : kind === 'hive' ? 36 : sizes[ufoType] || 32;
  const H = W;
  const cells = Array.from({ length: W * H }, () => ({ floor: 'grass', wall: null }));
  const map = { W, H, biome, night, kind, cells, lz: [], playerSpawns: [], alienSpawns: [], civSpawns: [], ufo: null, props: [], lights: [], buildings: [], deco: [], roads: null, modules: [], _modSpawns: [] };
  const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? cells[y * W + x] : null);
  const setWall = (x, y, type) => { const c = at(x, y); if (c && !c.reserved) c.wall = { type, hp: WALLS[type].hp }; };
  map.at = at;

  const baseFloor = { farm: 'grass', forest: 'grass', desert: 'sand', arctic: 'snow', urban: 'asphalt', hive: 'hive' }[biome] || 'grass';
  cells.forEach((c) => (c.floor = baseFloor));

  // Landezone (Süden) reservieren
  const lzx = Math.floor(W / 2) - 2;
  for (let y = H - 3; y < H; y++) for (let x = lzx; x < lzx + 5; x++) { const c = at(x, y); c.reserved = true; c.floor = biome === 'hive' ? 'hive' : 'dirt'; map.lz.push({ x, y }); }
  for (let y = H - 2; y < H; y++) for (let x = lzx; x < lzx + 4; x++) map.playerSpawns.push({ x, y });
  map.playerSpawns.push({ x: lzx + 4, y: H - 2 }, { x: lzx + 4, y: H - 1 }, { x: lzx, y: H - 3 }, { x: lzx + 4, y: H - 3 });
  // Puffer um die Landezone frei halten
  for (let y = H - 5; y < H; y++) for (let x = lzx - 2; x < lzx + 7; x++) { const c = at(x, y); if (c) c.reserved = true; }
  const lzc = { x: lzx + 2, y: H - 2 };
  map._lzc = lzc;
  const rural = biome !== 'urban' && biome !== 'hive';
  // UFO-Platz zuerst wählen und als Zone sperren, damit Szenario-Module ihn nicht überbauen
  if (ufoType && rural) map._site = ufoSite(map, at, ufoType, kind === 'crash');

  if (biome === 'hive') genHive(map, at, setWall);
  else if (biome === 'urban') genUrban(map, at, setWall);
  else genRural(map, at, setWall, biome);

  if (ufoType && rural) placeUfo(map, at, setWall, ufoType, kind === 'crash');
  map.alienSpawns.push(...map._modSpawns);
  // Weg von der Landezone zur UFO-Tür freiräumen (Wasser wird zum Notsteg)
  if (map.ufo) {
    const d = map.ufo.door, [dx, dy] = map.ufo.dir;
    if (at(d.x + dx, d.y + dy)) { const p = route(map, lzc.x, lzc.y, d.x + dx, d.y + dy, ufoPathCost); if (p) applyPath(map, p, null); }
  }

  // Erreichbarkeit sicherstellen: alles, was nicht von der Landezone erreichbar ist, wird freigeräumt bzw. Spawns entfernt
  let reach = floodReach(map);
  // Sicherstellen, dass die UFO-Tür bzw. der Hive-Boss von der Landezone aus erreichbar ist
  const goal = map.ufo ? map.ufo.door : map.boss;
  if (goal && ![[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => reach[(goal.y + dy) * W + goal.x + dx])) {
    // Schneise: von der Tür nach außen bis zum Kartenrand, dann am Rand entlang zur Landezone
    const clear = (x, y) => { const c = at(x, y); if (c?.wall && !c.hull) { if (c.wall.type === 'water') c.floor = 'shore'; c.wall = null; } };
    const line = (x0, y0, x1, y1) => { let x = x0, y = y0; clear(x, y); while (x !== x1 || y !== y1) { if (x !== x1) x += Math.sign(x1 - x); else y += Math.sign(y1 - y); clear(x, y); } };
    let px = goal.x, py = goal.y;
    if (map.ufo) {
      const [dx, dy] = map.ufo.dir;
      px += dx; py += dy;
      while (px + dx >= 0 && py + dy >= 0 && px + dx < W && py + dy < H) { clear(px, py); px += dx; py += dy; }
      clear(px, py);
      const side = px < W / 2 ? 0 : W - 1;
      if (py !== H - 1) { line(px, py, side, py); line(side, py, side, H - 1); line(side, H - 1, lzc.x, H - 1); }
      else line(px, py, lzc.x, H - 1);
    } else line(lzc.x, lzc.y, goal.x, goal.y);
    reach = floodReach(map);
  }
  // Abgeschnittene Bereiche (z. B. Uferstreifen hinter einem Fluss) per Notsteg/Durchgang anbinden
  if (connectIsolated(map, reach)) reach = floodReach(map);
  const farFromLz = (s) => Math.hypot(s.x - lzc.x, s.y - lzc.y) >= Math.min(16, H * 0.5);
  map.alienSpawns = map.alienSpawns.filter((s) => reach[s.y * W + s.x] && !at(s.x, s.y).wall && farFromLz(s));
  map.civSpawns = map.civSpawns.filter((s) => reach[s.y * W + s.x] && !at(s.x, s.y).wall);
  // Doppelte entfernen und bei Bedarf auffüllen (genug Felder für die gesamte Besatzung)
  const seenSp = new Set();
  map.alienSpawns = map.alienSpawns.filter((s) => { const k = s.y * W + s.x; if (seenSp.has(k)) return false; seenSp.add(k); return true; });
  if (map.alienSpawns.length < 18) {
    const free = [];
    for (let y = 0; y < H * 0.7; y++) for (let x = 0; x < W; x++) if (reach[y * W + x] && !at(x, y).wall && farFromLz({ x, y }) && !seenSp.has(y * W + x)) free.push({ x, y });
    shuffle(free); map.alienSpawns.push(...free.slice(0, 18 - map.alienSpawns.length));
  }
  if (map.boss) map.alienSpawns = map.alienSpawns.filter((s) => s.x !== map.boss.x || s.y !== map.boss.y);
  // Gebäude, die vom UFO-Landeplatz angeschnitten wurden, bekommen kein Dach/Obergeschoss
  for (const b of map.buildings) {
    for (let y = b.y0; y < b.y0 + b.h && !b.ruined; y++) for (let x = b.x0; x < b.x0 + b.w; x++) { const c = at(x, y); if (c.ufo || !c.indoor) { b.ruined = true; break; } }
  }
  map.deco = map.deco.filter((d) => { const c = at(d.x, d.y); return c && !c.wall && !c.ufo && !c.indoor && c.floor !== 'burnt'; });
  for (const c of cells) { delete c.reserved; delete c.keep; delete c.uz; delete c.mod; }
  delete map._site; delete map._modSpawns; delete map._lzc;
  return map;
}

// Unerreichbare freie Bereiche ab minSize Feldern über den billigsten Weg (Wasser → Steg) mit dem erreichbaren Teil verbinden.
// Mehrquellen-Dijkstra vom Bereich zum nächsten erreichbaren Feld; der Weg räumt nur die Hindernisse direkt auf der Route.
function connectIsolated(map, reach, minSize = 4) {
  const { W, H, cells } = map, N = W * H;
  const blocked = (i) => { const w = cells[i].wall; return !!(w && WALLS[w.type].move); };
  const comp = new Int32Array(N).fill(-1);
  let changed = false;
  for (let s = 0; s < N; s++) {
    if (reach[s] || comp[s] >= 0 || blocked(s) || cells[s].ufo) continue;
    const members = [s]; comp[s] = s;
    for (let k = 0; k < members.length; k++) {
      const i = members[k], x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of DIR4) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx; if (reach[j] || comp[j] >= 0 || blocked(j) || cells[j].ufo) continue;
        comp[j] = s; members.push(j);
      }
    }
    if (members.length < minSize) continue;
    const cost = (c) => {
      if (c.ufo || c.hull) return Infinity;
      if (!c.wall || !WALLS[c.wall.type].move) return 1;
      return c.wall.type === 'water' ? 4 : c.bld != null ? 40 : 10;
    };
    const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
    const hd = [], hi = [];
    const push = (d, i) => { let k = hd.length; hd.push(d); hi.push(i); while (k > 0) { const p = (k - 1) >> 1; if (hd[p] <= d) break; hd[k] = hd[p]; hi[k] = hi[p]; k = p; } hd[k] = d; hi[k] = i; };
    const pop = () => {
      const i0 = hi[0], ld = hd.pop(), li = hi.pop(), n = hd.length;
      if (n) { let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = -1, md = ld; if (l < n && hd[l] < md) { m = l; md = hd[l]; } if (r < n && hd[r] < md) m = r; if (m < 0) break; hd[k] = hd[m]; hi[k] = hi[m]; k = m; } hd[k] = ld; hi[k] = li; }
      return i0;
    };
    for (const i of members) { dist[i] = 0; push(0, i); }
    let hit = -1;
    while (hd.length) {
      const d = hd[0], i = pop();
      if (d > dist[i]) continue;
      if (reach[i]) { hit = i; break; }
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of DIR4) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx, k = cost(cells[j]); if (k === Infinity) continue;
        const nd = d + k; if (nd < dist[j]) { dist[j] = nd; prev[j] = i; push(nd, j); }
      }
    }
    if (hit < 0) continue;
    for (let i = hit; i !== -1; i = prev[i]) {
      const c = cells[i];
      if (c.wall && WALLS[c.wall.type].move && !c.hull) {
        if (c.wall.type === 'water') c.floor = 'plank';
        else if (c.bld != null && c.indoor) c.door = true;
        c.wall = null; changed = true;
      }
    }
    // Bereich zählt ab jetzt als erreichbar (für weitere Bereiche als Ziel nutzbar)
    for (const i of members) reach[i] = 1;
    for (let i = hit; i !== -1; i = prev[i]) reach[i] = 1;
  }
  return changed;
}

function floodReach(map) {
  const { W, H, cells } = map;
  const seen = new Uint8Array(W * H);
  const q = map.playerSpawns.map((p) => p.y * W + p.x);
  q.forEach((i) => (seen[i] = 1));
  while (q.length) {
    const i = q.pop(); const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (seen[j]) continue;
      const w = cells[j].wall;
      if (w && WALLS[w.type].move) continue;
      seen[j] = 1; q.push(j);
    }
  }
  return seen;
}

// Gebäude-Stile: Wandmaterial(e), Dach, Innenboden, Fensteranteil, Möblierung
const STYLES = {
  farmhouse: { mats: ['plaster', 'plaster', 'brick', 'stone'], roof: 'gable', floor: 'wood', windows: 0.25, storeys: [1, 2] },
  barn: { mats: ['metalsheet', 'wood', 'wood'], roof: 'gable', floor: 'dirt', windows: 0.04, furn: 'hay', wide: true, open: true },
  warehouse: { mats: ['metalsheet'], roof: 'flat', floor: 'concretefloor', windows: 0.06, furn: 'pallet', wide: true, open: true },
  church: { mats: ['stone'], roof: 'gable', floor: 'tile', windows: 0.22, storeys: [2, 2], open: true },
  gasstation: { mats: ['concrete'], win: 'glass', roof: 'flat', floor: 'tile', windows: 0.5 },
  bunker: { mats: ['concrete'], roof: 'flat', floor: 'concretefloor', windows: 0, furn: 'milcrate' },
  cabin: { mats: ['wood'], roof: 'gable', floor: 'wood', windows: 0.2 },
  ruin: { mats: ['stone'], roof: 'gable', floor: 'gravel', windows: 0.15, ruin: true },
  greenhouse: { mats: ['glass'], win: 'glass', roof: 'gable', floor: 'dirt', windows: 0, furn: 'bush', open: true },
  motel: { mats: ['plaster'], roof: 'flat', floor: 'tile', windows: 0.3 },
};

// Gebäude: Außenwände mit Fenstern, Türen, optionale Innenwand, Möbel an den Wänden.
// Die Bounding-Box landet in map.buildings (Stil, Material, Dachform, Stockwerke, Türen) für Optik/Dächer.
// opts: style (STYLES oder freier Fassadenname), mat, win, windows, roof, floor, storeys, doors (Seiten, erste garantiert),
// wide (Doppeltüren), rooms+front (Zimmerreihe mit je eigener Tür zur Front), ruin/unfinished (Lücken, kein Dach), furn.
function building(map, at, setWall, x0, y0, w, h, opts = {}) {
  const S = STYLES[opts.style];
  const mat = opts.mat || (S ? choice(S.mats) : 'brick');
  const win = opts.win || S?.win || 'window';
  const winRate = opts.windows ?? S?.windows ?? 0.18;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const c = at(x, y); if (!c || c.reserved || c.indoor || c.uz) return false;
  }
  const bi = map.buildings.length;
  const b = { x0, y0, w, h, style: opts.style || mat, mat, roof: opts.roof || S?.roof || 'gable', storeys: opts.storeys || (S?.storeys ? randInt(S.storeys[0], S.storeys[1]) : 1), doors: [] };
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const c = at(x, y);
    c.floor = opts.floor || S?.floor || 'wood';
    c.wall = null;
    c.indoor = true;
    c.bld = bi;
    const ex = x === x0 || x === x0 + w - 1, ey = y === y0 || y === y0 + h - 1;
    if (ex || ey) { setWall(x, y, ex !== ey && rand() < winRate ? win : mat); if (c.wall) c.wall.vert = ex; }
  }
  // Türen (Lage wird für Türrahmen gemerkt); das Feld vor der Tür bleibt frei
  const door = (x, y, side) => {
    const c = at(x, y); c.wall = null; c.door = true; b.doors.push({ x, y, side });
    const n = SIDE_V[side], o = at(x + n[0], y + n[1]); if (o && !o.reserved && !o.indoor) o.keep = true;
  };
  const wide = opts.wide ?? S?.wide;
  let sides;
  if (opts.rooms && opts.front) sides = [];
  else if (opts.doors) { sides = [...new Set(opts.doors)]; if (rand() < 0.3 && sides.length < 4) sides.push(choice(['n', 's', 'e', 'w'].filter((s) => !sides.includes(s)))); }
  else sides = shuffle(['n', 's', 'e', 'w']).slice(0, randInt(1, 3));
  for (const s of sides) {
    if (s === 'n' || s === 's') { const dx = randInt(x0 + 1, x0 + w - 2); const y = s === 'n' ? y0 : y0 + h - 1; door(dx, y, s); if (w > 5 && (wide || rand() < 0.5)) { const dx2 = dx + 1 <= x0 + w - 2 ? dx + 1 : dx - 1; if (dx2 > x0) door(dx2, y, s); } }
    else { const dy = randInt(y0 + 1, y0 + h - 2); const x = s === 'w' ? x0 : x0 + w - 1; door(x, dy, s); if (wide && h > 5) { const dy2 = dy + 1 <= y0 + h - 2 ? dy + 1 : dy - 1; if (dy2 > y0) door(x, dy2, s); } }
  }
  // Zimmerreihe (Motel): Trennwände quer zur Front, jedes Zimmer mit eigener Tür
  if (opts.rooms && opts.front) {
    const f = opts.front, alongX = f === 'n' || f === 's';
    const start = alongX ? x0 : y0, last = start + (alongX ? w : h) - 2;
    for (let a = start + 1; a <= last;) {
      let e = Math.min(a + randInt(2, 3), last); if (last - e < 3) e = last;
      const p = randInt(a, e);
      if (alongX) door(p, f === 'n' ? y0 : y0 + h - 1, f); else door(f === 'w' ? x0 : x0 + w - 1, p, f);
      if (e < last) {
        if (alongX) for (let y = y0 + 1; y < y0 + h - 1; y++) { setWall(e + 1, y, mat); at(e + 1, y).wall.vert = true; }
        else for (let x = x0 + 1; x < x0 + w - 1; x++) { setWall(x, e + 1, mat); at(x, e + 1).wall.vert = false; }
      }
      a = e + 2;
    }
  }
  // Innenwand
  const keep = new Set();
  for (const d of b.doors) { const n = { n: [0, 1], s: [0, -1], w: [1, 0], e: [-1, 0] }[d.side]; keep.add((d.y + n[1]) * map.W + d.x + n[0]); }
  if (w >= 7 && !opts.rooms && !S?.open && rand() < 0.7) {
    const ix = randInt(x0 + 3, x0 + w - 4); const dy = randInt(y0 + 1, y0 + h - 2);
    for (let y = y0 + 1; y < y0 + h - 1; y++) if (y !== dy && !keep.has(y * map.W + ix)) setWall(ix, y, mat);
    keep.add(dy * map.W + ix - 1); keep.add(dy * map.W + ix + 1);
  }
  const ruin = opts.ruin || S?.ruin, unfinished = opts.unfinished;
  // Möbel (Deckung wie Kisten) bevorzugt an den Wänden, Türbereiche bleiben frei
  const furnT = ruin || unfinished ? null : opts.furn ?? S?.furn ?? 'crate';
  if (furnT) {
    const cand = [];
    for (let y = y0 + 1; y < y0 + h - 1; y++) for (let x = x0 + 1; x < x0 + w - 1; x++) {
      if (at(x, y).wall || keep.has(y * map.W + x)) continue;
      const nb = [[0, -1, 0], [0, 1, Math.PI], [-1, 0, Math.PI / 2], [1, 0, -Math.PI / 2]].filter(([dx, dy]) => { const t = at(x + dx, y + dy)?.wall?.type; return t && t !== furnT; });
      if (nb.length) cand.push({ x, y, rot: choice(nb)[2] });
    }
    shuffle(cand);
    let nf = Math.max(1, Math.floor(w * h / (furnT === 'crate' ? 13 : 10)));
    for (const p of cand) {
      if (nf <= 0) break;
      let near = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (at(p.x + dx, p.y + dy)?.wall?.type === furnT) near = true;
      if (near || rand() < 0.25) continue;
      if (furnT === 'crate') { setWall(p.x, p.y, 'crate'); at(p.x, p.y).wall.furn = true; at(p.x, p.y).wall.rot = p.rot; }
      else at(p.x, p.y).wall = mkWall(furnT, { rot: Math.round(p.rot / (Math.PI / 2)) });
      nf--;
    }
  }
  // Ruine / Rohbau: Lücken in den Wänden, Schutt bzw. Baumaterial innen, kein Dach
  if (ruin || unfinished) {
    b.ruined = true;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const c = at(x, y); if (!c.wall) continue;
      const ex = x === x0 || x === x0 + w - 1, ey = y === y0 || y === y0 + h - 1;
      if ((ex || ey) && !(ex && ey) && rand() < 0.38) c.wall = !unfinished && rand() < 0.45 ? mkWall('rockpile') : null;
      else if (!ex && !ey && rand() < 0.5) c.wall = null;
    }
    for (let k = 0, n = randInt(2, 4); k < n; k++) {
      const x = randInt(x0 + 1, x0 + w - 2), y = randInt(y0 + 1, y0 + h - 2);
      if (!at(x, y).wall && !keep.has(y * map.W + x)) at(x, y).wall = mkWall(unfinished ? 'pallet' : 'rockpile');
    }
  }
  map.buildings.push(b);
  return true;
}

function genRural(map, at, setWall, biome) {
  const { W, H } = map;
  const lzc = map._lzc;
  // Felder / Wege
  if (biome === 'farm') {
    for (let k = 0; k < 4; k++) {
      const x0 = randInt(0, W - 10), y0 = randInt(0, H - 12), w = randInt(6, 12), h = randInt(6, 10);
      const f = choice(['field', 'field2', 'dirt']);
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const c = at(x, y); if (c && !c.reserved) c.floor = f; }
    }
    const py = randInt(4, H - 10);
    for (let x = 0; x < W; x++) for (let y = py; y < py + 2; y++) if (!at(x, y).reserved) at(x, y).floor = 'dirt';
  }
  // Szenario-Module (1–3 Bausteine) samt Wegen zur Landezone
  const G = { map, at, setWall, biome, lzc };
  placeModules(G);
  // Füll-Gebäude: wenige, die Module bringen eigene mit
  const want = { farm: randInt(0, 2), forest: randInt(0, 1), desert: randInt(0, 2), arctic: randInt(0, 1) }[biome] - (map.buildings.length >> 1);
  const fill = { farm: { style: 'farmhouse' }, forest: { style: 'log', mat: 'wood' }, desert: { style: 'adobe', mat: 'plaster', roof: 'flat', floor: 'tile' }, arctic: { style: 'prefab', mat: 'metalsheet' } }[biome];
  for (let k = 0, tries = 0; k < want && tries < 10; tries++) {
    const r = findRect(G, randInt(5, 8), randInt(5, 7)); if (!r) continue;
    if (building(map, at, setWall, r.x0, r.y0, r.gw, r.gh, { ...fill, doors: [r.face] })) k++;
  }
  // Zäune / Hecken / Mauern
  const fenceN = Math.max(1, (biome === 'farm' ? randInt(4, 7) : biome === 'forest' ? 2 : 1) - map.modules.length);
  const fenceT = { farm: ['fence', 'fence', 'hedge', 'stonewall', 'tallhedge'], forest: ['fence', 'stonewall'], desert: ['rock', 'stonewall'], arctic: ['fence'] }[biome];
  for (let k = 0; k < fenceN; k++) {
    const horiz = rand() < 0.5; let x = randInt(2, W - 3), y = randInt(2, H - 6); const len = randInt(4, 11);
    const t = choice(fenceT);
    for (let i = 0; i < len; i++) {
      const c = at(x, y); if (!c || c.wall?.type === 'water') break;
      if (freeCell(c) && rand() > 0.12) c.wall = mkWall(t, { rot: horiz ? 1 : 0 });
      if (horiz) x++; else y++;
    }
  }
  // Bäume / Büsche / Felsen
  const treeN = { farm: 24, forest: 140, desert: 6, arctic: 30 }[biome];
  const treeT = { farm: { tree: 5, oak: 2, birch: 2, bush: 3 }, forest: { pine: 34, tree: 24, birch: 16, oak: 8, bush: 12, deadtree: 3, stump: 3 }, desert: { deadtree: 2, bush: 3 }, arctic: { pine: 70, birch: 10, deadtree: 20 } }[biome];
  for (let k = 0; k < treeN; k++) { const c = at(randInt(0, W - 1), randInt(0, H - 1)); if (freeCell(c)) c.wall = mkWall(pickW(treeT)); }
  const rockN = { farm: 6, forest: 14, desert: 40, arctic: 25 }[biome];
  const rockT = biome === 'desert' || biome === 'arctic' ? { rock: 5, bigrock: 2, rockpile: 2 } : { rock: 3, bigrock: 1 };
  for (let k = 0; k < rockN; k++) { const c = at(randInt(0, W - 1), randInt(0, H - 1)); if (freeCell(c)) c.wall = mkWall(pickW(rockT)); }
  if (biome === 'farm') for (let k = 0; k < 8; k++) { const c = at(randInt(0, W - 1), randInt(0, H - 1)); if (freeCell(c)) c.wall = mkWall('hay'); }
  // Fahrzeuge (Deckung wie Autos): Traktor auf dem Feld, Pick-up am Haus
  const vehicles = biome === 'farm' ? ['tractor', 'pickup'] : biome === 'forest' ? ['pickup'] : biome === 'desert' ? ['pickup', 'burnt'] : ['suv'];
  for (const v of vehicles) for (let t = 0; t < 40; t++) {
    if (map.modules.length && rand() < 0.5) break;
    const x = randInt(1, W - 2), y = randInt(1, H - 7), c = at(x, y);
    if (!freeCell(c) || DIR4.some(([dx, dy]) => at(x + dx, y + dy)?.wall)) continue;
    c.wall = mkWall('car', { variant: v, vert: rand() < 0.5 }); break;
  }
  // umgestürzte Baumstämme im Wald (halbe Deckung)
  if (biome === 'forest') for (let k = 0; k < 9; k++) { const c = at(randInt(0, W - 1), randInt(0, H - 7)); if (freeCell(c)) c.wall = mkWall('log', { vert: rand() < 0.5 }); }
  // Deko je Biom (ohne Kollision), nur auf natürlichem Boden
  const decoOk = (x, y) => freeOut(at, x, y) && NATURAL.has(at(x, y).floor);
  const decoN = { farm: { flowers: 26, mailbox: 2, bush: 10 }, forest: { bush: 45, fern: 60, mushroom: 30, stump: 10 }, desert: { cactus: 20, drybush: 30, pebbles: 14 }, arctic: { drift: 30, ice: 18 } }[biome] || {};
  for (const [t, n] of Object.entries(decoN)) for (let k = 0; k < n; k++) {
    const x = randInt(0, W - 1), y = randInt(0, H - 1);
    if (!decoOk(x, y)) continue;
    if (t === 'flowers') { // Blumen bevorzugt an Hauswänden
      const b = map.buildings.length ? choice(map.buildings) : null;
      if (b) { const side = randInt(0, 3); const fx = side < 2 ? randInt(b.x0, b.x0 + b.w - 1) : side === 2 ? b.x0 - 1 : b.x0 + b.w; const fy = side >= 2 ? randInt(b.y0, b.y0 + b.h - 1) : side === 0 ? b.y0 - 1 : b.y0 + b.h; if (decoOk(fx, fy)) deco(map, t, fx, fy); continue; }
    }
    if (t === 'mailbox') { const b = map.buildings[k % Math.max(1, map.buildings.length)]; if (b) { const d = b.doors[0]; if (d) { const n = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }[d.side]; const mx = d.x + n[0] * 2 + n[1], my = d.y + n[1] * 2 + n[0]; if (decoOk(mx, my)) deco(map, t, mx, my, { s: 1, rot: Math.atan2(-n[0], -n[1]) }); } } continue; }
    deco(map, t, x, y, t === 'cactus' ? { ox: (rand() < 0.5 ? -1 : 1) * 0.6, oz: (rand() < 0.5 ? -1 : 1) * 0.6 } : {});
  }
  // Alien-Spawns verstreut im Norden
  for (let k = 0; k < 30; k++) map.alienSpawns.push({ x: randInt(0, W - 1), y: randInt(0, Math.floor(H * 0.55)) });
}

// UFO-Platz vorab wählen (Mittelpunkt, Radius, Türrichtung, Variante) und als Zone c.uz sperren
function ufoSite(map, at, type, crashed) {
  const { W, H } = map;
  const R = { scout: 3, fighter: 4, freighter: 5, battleship: 6 }[type] || 4;
  const cx = randInt(R + 3, W - R - 4), cy = randInt(R + 3, Math.floor(H * 0.5));
  const dir = choice([[0, 1], [1, 0], [-1, 0], [0, -1]]);
  // Absturz: durch Gebäude/Wald gepflügt, halb im Teich, Trümmerfeld, Krater; Landung: freies Feld oder Platz
  const variant = crashed ? pickW({ plow: 30, pond: 22, debris: 24, crater: 24 }) : pickW({ field: 55, plaza: 45 });
  const s = { cx, cy, R, dir, variant };
  const mark = (px, py, r) => { for (let y = Math.floor(py - r); y <= py + r; y++) for (let x = Math.floor(px - r); x <= px + r; x++) { const c = at(x, y); if (c && Math.hypot(x - px, y - py) <= r) c.uz = true; } };
  mark(cx, cy, R + 2.5);
  if (variant === 'pond') { s.pcx = cx - dir[0] * (R + 1); s.pcy = cy - dir[1] * (R + 1); s.pr = R * 0.8 + 1.5; mark(s.pcx, s.pcy, s.pr + 1.5); }
  return s;
}

function placeUfo(map, at, setWall, type, crashed) {
  const { W, H } = map;
  const s = map._site || ufoSite(map, at, type, crashed);
  const { R, cx, cy } = s;
  map.ufo = { cx, cy, r: R, type, crashed, site: s.variant };
  // Fläche räumen
  for (let y = cy - R - 2; y <= cy + R + 2; y++) for (let x = cx - R - 2; x <= cx + R + 2; x++) {
    const c = at(x, y); if (!c) continue;
    const d = Math.hypot(x - cx, y - cy);
    if (d <= R + 1.6) { c.wall = null; c.indoor = false; if (crashed && d > R + 0.5) c.floor = 'burnt'; }
  }
  const doorDir = s.dir;
  for (let y = cy - R - 1; y <= cy + R + 1; y++) for (let x = cx - R - 1; x <= cx + R + 1; x++) {
    const c = at(x, y); if (!c) continue;
    const d = Math.hypot(x - cx, y - cy);
    if (d < R - 0.45) { c.floor = 'metal'; c.ufo = true; c.indoor = true; }
    else if (d < R + 0.5) { setWall(x, y, 'metal'); c.floor = 'metal'; c.ufo = true; c.hull = true; }
  }
  // Tür
  for (let i = R - 1; i <= R + 1; i++) { const c = at(cx + doorDir[0] * i, cy + doorDir[1] * i); if (c) { c.wall = null; c.door = true; } }
  map.ufo.door = { x: cx + doorDir[0] * R, y: cy + doorDir[1] * R };
  map.ufo.dir = doorDir;
  // Innenraum
  if (R >= 4) {
    const r2 = R - 2.2;
    // Eine Lücke im inneren Ring liegt immer in Türrichtung, damit der Reaktorraum erreichbar ist
    const doorGap = doorDir[0] === 1 ? 2 : doorDir[0] === -1 ? 0 : doorDir[1] === 1 ? 3 : 1;
    const gaps = [doorGap, choice([0, 1, 2, 3].filter((g) => g !== doorGap))];
    for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (Math.abs(d - r2) < 0.5) {
        const ang = Math.atan2(y - cy, x - cx);
        const q = Math.round(((ang + Math.PI) / (Math.PI * 2)) * 4) % 4;
        const nearGap = gaps.some((g) => Math.abs(((ang + Math.PI) / (Math.PI * 2)) * 4 - g) < 0.25 || Math.abs(((ang + Math.PI) / (Math.PI * 2)) * 4 - g - 4) < 0.25);
        if (!nearGap && q >= 0) setWall(x, y, 'metal');
      }
    }
  }
  setWall(cx, cy, 'reactor');
  // Alle freien UFO-Felder müssen von der Tür aus erreichbar bleiben
  const ufoConnected = () => {
    const start = { x: cx + doorDir[0] * (R - 1), y: cy + doorDir[1] * (R - 1) };
    let total = 0;
    for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) { const c = at(x, y); if (c?.ufo && !c.wall) total++; }
    const seen = new Set([start.y * W + start.x]); const q = [start];
    while (q.length) {
      const p = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = p.x + dx, ny = p.y + dy, c = at(nx, ny), k = ny * W + nx;
        if (!c?.ufo || c.wall || seen.has(k)) continue;
        seen.add(k); q.push({ x: nx, y: ny });
      }
    }
    return seen.size >= total;
  };
  for (let k = 0; k < R; k++) {
    const a = rand() * Math.PI * 2, r = R - 1.3;
    const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
    const c = at(x, y);
    if (c && !c.wall && c.ufo && !c.door) { setWall(x, y, 'console'); if (!ufoConnected()) c.wall = null; }
  }
  if (crashed) {
    // Rumpfbrüche und Trümmer
    for (let k = 0; k < randInt(2, 4); k++) {
      const a = rand() * Math.PI * 2;
      const x = Math.round(cx + Math.cos(a) * R), y = Math.round(cy + Math.sin(a) * R);
      const c = at(x, y); if (c?.wall?.type === 'metal') c.wall = null;
    }
    if (s.variant === 'crater') for (let k = 0; k < R * 3; k++) {
      const a = rand() * Math.PI * 2, r = R + 1 + rand() * 4;
      const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
      const c = at(x, y); if (c && !c.wall && !c.reserved && !c.door) { setWall(x, y, 'wreck'); c.floor = 'burnt'; }
    }
    if (s.variant === 'plow') ufoPlow(map, at, s);
    if (s.variant === 'pond') { ufoPond(map, at, s); map.ufo.pond = { x: s.pcx, y: s.pcy, r: s.pr }; }
    if (s.variant === 'debris') ufoDebris(map, at, s);
  } else if (s.variant === 'plaza') ufoPad(map, at, s);
  else ufoField(map, at, s);
  map.lights.push({ x: cx, y: cy, color: 0x7affd0, intensity: 30, h: 2.4 });
  // Aliens bevorzugt im UFO
  map.alienSpawns = [];
  for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) { const c = at(x, y); if (c?.ufo && !c.wall) map.alienSpawns.push({ x, y, inUfo: true }); }
  shuffle(map.alienSpawns);
  const outside = [];
  for (let k = 0; k < 40; k++) { const a = rand() * Math.PI * 2, r = R + 2 + rand() * 8; outside.push({ x: Math.round(cx + Math.cos(a) * r), y: Math.round(cy + Math.sin(a) * r) }); }
  map.alienSpawns = map.alienSpawns.concat(outside.filter((p) => p.x >= 0 && p.y >= 0 && p.x < W && p.y < H - 8));
  map.alienSpawnMix = crashed ? 0.45 : 0.7; // Anteil der Aliens im UFO
}

function genUrban(map, at, setWall) {
  const { W, H } = map;
  const roadsX = [], roadsY = [];
  for (let x = 4; x < W - 3; x += randInt(11, 14)) roadsX.push(x);
  for (let y = 3; y < H - 6; y += randInt(10, 13)) roadsY.push(y);
  map.roads = { xs: roadsX, ys: roadsY };
  const inRX = (x) => roadsX.some((r) => x >= r && x < r + 3), inRY = (y) => roadsY.some((r) => y >= r && y < r + 3);
  const walkX = (x) => roadsX.some((r) => x === r - 1 || x === r + 3), walkY = (y) => roadsY.some((r) => y === r - 1 || y === r + 3);
  const isRoad = (x, y) => inRX(x) || inRY(y);
  const isWalk = (x, y) => !isRoad(x, y) && (walkX(x) || walkY(y));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = at(x, y);
    if (c.reserved) { c.floor = 'asphalt'; continue; }
    c.floor = isRoad(x, y) ? 'asphalt' : isWalk(x, y) ? 'sidewalk' : 'tile';
  }
  // Gebäude füllen die Häuserblöcke zwischen den Gehwegen (große Blöcke: zwei Häuser mit Gasse)
  const runs = (n, bad) => { const out = []; let s0 = -1; for (let i = 0; i <= n; i++) { const b = i === n || bad(i); if (!b && s0 < 0) s0 = i; if (b && s0 >= 0) { out.push([s0, i - 1]); s0 = -1; } } return out; };
  const cols = runs(W, (x) => inRX(x) || walkX(x)), rows = runs(H, (y) => inRY(y) || walkY(y));
  const blocks = [];
  for (const [bx0, bx1] of cols) for (const [by0, by1] of rows) {
    const lx = bx1 - bx0 + 1, ly = by1 - by0 + 1;
    if (lx >= 12) { const sp = randInt(5, lx - 6); blocks.push([bx0, by0, bx0 + sp - 1, by1], [bx0 + sp + 1, by0, bx1, by1]); }
    else if (ly >= 12) { const sp = randInt(5, ly - 6); blocks.push([bx0, by0, bx1, by0 + sp - 1], [bx0, by0 + sp + 1, bx1, by1]); }
    else blocks.push([bx0, by0, bx1, by1]);
  }
  shuffle(blocks);
  let nb = 0;
  for (const [bx0, by0, bx1, by1] of blocks) {
    const lx = bx1 - bx0 + 1, ly = by1 - by0 + 1;
    if (lx < 5 || ly < 5 || nb >= 11) continue;
    for (let t = 0; t < 10; t++) {
      const w = randInt(5, Math.min(lx, 10)), h = randInt(5, Math.min(ly, 9));
      const x0 = randInt(bx0, bx1 - w + 1), y0 = randInt(by0, by1 - h + 1);
      const style = choice(['brick', 'brick', 'concrete', 'plaster']);
      if (building(map, at, setWall, x0, y0, w, h, { mat: 'brick', style, roof: 'flat', storeys: randInt(1, 3), floor: 'tile', windows: style === 'concrete' ? 0.5 : 0.35 })) { nb++; break; }
    }
  }
  // Geparkte Autos auf den Außenspuren (längs zur Straße), Mittelspur bleibt frei; einige ausgebrannt
  const lanes = [];
  for (const r of roadsX) for (const x of [r, r + 2]) for (let y = 0; y < H; y++) if (!inRY(y) && !walkY(y)) lanes.push({ x, y, vert: true });
  for (const r of roadsY) for (const y of [r, r + 2]) for (let x = 0; x < W; x++) if (!inRX(x) && !walkX(x)) lanes.push({ x, y, vert: false });
  shuffle(lanes);
  let nCar = 0, nBar = 0;
  for (const l of lanes) {
    if (nCar >= 13 && nBar >= 4) break;
    const c = at(l.x, l.y); if (!c || c.wall || c.reserved) continue;
    const [dx, dy] = l.vert ? [0, 1] : [1, 0];
    if (at(l.x + dx, l.y + dy)?.wall || at(l.x - dx, l.y - dy)?.wall) continue;
    if (nCar < 13) { setWall(l.x, l.y, 'car'); c.wall.vert = l.vert; c.wall.variant = rand() < 0.2 ? 'burnt' : choice(['sedan', 'sedan', 'kombi', 'suv', 'van', 'pickup']); nCar++; }
    else { setWall(l.x, l.y, 'barrier'); nBar++; }
  }
  for (let k = 0; k < 8; k++) { const x = randInt(0, W - 1), y = randInt(0, H - 1), c = at(x, y); if (c && !c.wall && !c.reserved && c.floor === 'tile' && !c.indoor) setWall(x, y, 'tree'); }
  // Straßenlaternen auf dem Gehweg, Mast zur Fahrbahn hin
  for (let i = 0, t = 0; i < 4 && t < 40; t++) {
    const r = choice(roadsX); if (r == null) break;
    const left = rand() < 0.5, x = left ? r - 1 : r + 3, y = randInt(2, H - 10);
    if (!freeOut(at, x, y) || inRY(y)) continue;
    map.lights.push({ x, y, color: 0xffc27a, intensity: 18, h: 4, lamp: true, dir: [left ? 1 : -1, 0] }); i++;
  }
  // Stadtmobiliar auf den Gehwegen, zur Fahrbahn hin versetzt
  const roadDir = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => { const c = at(x + dx, y + dy); return c && isRoad(x + dx, y + dy); });
  const walks = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isWalk(x, y) && freeOut(at, x, y) && roadDir(x, y)) walks.push({ x, y });
  shuffle(walks);
  const want = { bench: 6, bin: 8, hydrant: 5, sign: 6 };
  for (const w of walks) {
    const t = Object.keys(want).find((k) => want[k] > 0 && rand() < 0.5); if (!t) continue;
    if (map.deco.some((d) => d.x === w.x && d.y === w.y)) continue;
    const [dx, dy] = roadDir(w.x, w.y);
    const edge = t === 'bench' ? 0.45 : 0.75;
    deco(map, t, w.x, w.y, { ox: dx * edge + (dy ? (rand() - 0.5) * 1.2 : 0), oz: dy * edge + (dx ? (rand() - 0.5) * 1.2 : 0), rot: Math.atan2(dx, dy), s: 1 });
    want[t]--;
  }
  // Ampeln an den Kreuzungsecken
  for (const rx of roadsX) for (const ry of roadsY) {
    for (const [cx, cy, ax, ay] of [[rx - 1, ry - 1, 1, 1], [rx + 3, ry + 3, -1, -1]]) if (freeOut(at, cx, cy)) deco(map, 'tlight', cx, cy, { ox: ax * 0.75, oz: ay * 0.75, rot: Math.atan2(ax, ay), s: 1 });
  }
  for (let k = 0; k < 40; k++) map.alienSpawns.push({ x: randInt(0, W - 1), y: randInt(0, Math.floor(H * 0.6)) });
  for (let k = 0; k < 30; k++) map.civSpawns.push({ x: randInt(0, W - 1), y: randInt(2, H - 7) });
}

function genHive(map, at, setWall) {
  const { W, H } = map;
  // Höhlensystem via zellulärem Automaten
  let grid = new Uint8Array(W * H);
  for (let i = 0; i < grid.length; i++) grid[i] = rand() < 0.5 ? 1 : 0;
  for (let it = 0; it < 5; it++) {
    const ng = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H || grid[yy * W + xx]) n++; }
      ng[y * W + x] = n >= 5 ? 1 : 0;
    }
    grid = ng;
  }
  // Boss-Kammer
  const bx = Math.floor(W / 2) + randInt(-4, 4), by = 6;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.hypot(x - bx, y - by) < 5) grid[y * W + x] = 0;
  // Gewundener Korridor von der Landezone zur Kammer
  let x = Math.floor(W / 2), y = H - 4;
  const corridor = new Uint8Array(W * H);
  const carve = (cx0, cy0) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = cx0 + dx, yy = cy0 + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) { grid[yy * W + xx] = 0; corridor[yy * W + xx] = 1; } } };
  while (y > by) {
    carve(x, y);
    if (rand() < 0.6) y--; else x = Math.max(2, Math.min(W - 3, x + (x < bx ? 1 : -1) * (rand() < 0.7 ? 1 : -1)));
  }
  while (x !== bx) { carve(x, y); x += x < bx ? 1 : -1; }
  carve(x, y);
  for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
    const c = at(xx, yy); c.floor = 'hive';
    if (grid[yy * W + xx] && !c.reserved) setWall(xx, yy, 'hivewall');
  }
  for (let k = 0; k < 26; k++) { const px = randInt(1, W - 2), py = randInt(1, H - 7), c = at(px, py); if (!c.wall && !c.reserved && Math.hypot(px - bx, py - by) > 2 && !corridor[py * W + px]) setWall(px, py, 'pod'); }
  map.boss = { x: bx, y: by };
  for (let k = 0; k < 60; k++) map.alienSpawns.push({ x: randInt(0, W - 1), y: randInt(0, Math.floor(H * 0.7)) });
  map.lights.push({ x: bx, y: by, color: 0xc04dff, intensity: 60, h: 3 });
}

// =====================================================================================
// Wegfindung für Wege/Schneisen (Dijkstra, 4er-Nachbarschaft) – Kosten je Feld über cost(cell)
// =====================================================================================
function route(map, sx, sy, tx, ty, cost) {
  const { W, H, cells } = map;
  const N = W * H, dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
  const hd = [], hi = [];
  const push = (d, i) => { let k = hd.length; hd.push(d); hi.push(i); while (k > 0) { const p = (k - 1) >> 1; if (hd[p] <= d) break; hd[k] = hd[p]; hi[k] = hi[p]; k = p; } hd[k] = d; hi[k] = i; };
  const pop = () => {
    const i0 = hi[0], ld = hd.pop(), li = hi.pop(), n = hd.length;
    if (n) { let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = -1, md = ld; if (l < n && hd[l] < md) { m = l; md = hd[l]; } if (r < n && hd[r] < md) m = r; if (m < 0) break; hd[k] = hd[m]; hi[k] = hi[m]; k = m; } hd[k] = ld; hi[k] = li; }
    return i0;
  };
  const s = sy * W + sx, t = ty * W + tx;
  dist[s] = 0; push(0, s);
  while (hd.length) {
    const d = hd[0], i = pop();
    if (i === t) break;
    if (d > dist[i]) continue;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of DIR4) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx, k = j === t ? 1 : cost(cells[j]);
      if (k === Infinity) continue;
      const nd = d + k + rand() * 0.3;
      if (nd < dist[j]) { dist[j] = nd; prev[j] = i; push(nd, j); }
    }
  }
  if (dist[t] === Infinity) return null;
  const out = []; for (let i = t; i !== -1; i = prev[i]) out.push(i);
  return out.reverse();
}
// Wege zwischen Modulen: Häuser und Wasser meiden, vorhandene Wege bevorzugen
const modPathCost = (c) => {
  if (c.ufo) return Infinity;
  let k = c.keep || c.reserved ? 1 : 2;
  if (c.wall) k += c.wall.type === 'water' ? 25 : c.bld != null ? 40 : 6;
  else if (c.indoor) k += 3;
  if (c.uz) k += 2;
  return k;
};
// Schneise zur UFO-Tür: Rumpf tabu, Hindernisse möglichst umgehen
const ufoPathCost = (c) => {
  if (c.ufo) return Infinity;
  if (!c.wall) return c.indoor ? 3 : 1;
  return c.wall.type === 'water' ? 15 : c.bld != null ? 30 : 8;
};
// Weg anwenden: Hindernisse räumen (Wasser wird Steg), optional Boden als Weg färben, Felder für Füllung sperren
function applyPath(map, idxs, paint) {
  for (const i of idxs) {
    const c = map.cells[i]; if (c.reserved || c.ufo) continue;
    if (c.wall) {
      if (c.wall.type === 'water') c.floor = 'plank';
      else if (c.bld != null && c.indoor && !c.wall.furn) c.door = true;
      c.wall = null;
    }
    if (paint && !c.indoor && !HARD_FLOORS.has(c.floor) && c.floor !== 'shore') c.floor = paint;
    c.keep = true;
  }
}

// =====================================================================================
// UFO-Platz-Varianten
// =====================================================================================
// Absturz: das UFO hat eine Schneise durch Gebäude/Wald gepflügt (hinter ihm, weg von der Tür)
function ufoPlow(map, at, s) {
  const { cx, cy, R, dir } = s;
  const da = Math.atan2(dir[1], dir[0]), L = randInt(9, 16);
  const foot = (a, fn) => {
    const ux = Math.cos(a), uy = Math.sin(a), ext = L + R + 3;
    for (let y = Math.floor(cy - ext); y <= cy + ext; y++) for (let x = Math.floor(cx - ext); x <= cx + ext; x++) {
      const c = at(x, y); if (!c || c.reserved || c.ufo || c.door) continue;
      const rx = x - cx, ry = y - cy, t = rx * ux + ry * uy, p = Math.abs(-rx * uy + ry * ux);
      if (t < R - 0.5 || t > R + L) continue;
      const hw = Math.max(1, R * 0.9 * (1 - 0.6 * (t - R) / L));
      if (p <= hw + 1.5) fn(c, p, hw);
    }
  };
  // Richtung mit den meisten Hindernissen (Gebäude, Wald) bevorzugen, nie durch die Tür
  let best = 0, bs = -1;
  for (let k = 0; k < 4; k++) {
    let a = rand() * Math.PI * 2;
    if (Math.abs((((a - da) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) < 0.9) a += Math.PI;
    let sc = 0; foot(a, (c, p, hw) => { if (p <= hw && (c.wall || c.indoor)) sc++; });
    if (sc > bs) { bs = sc; best = a; }
  }
  const logVert = Math.abs(Math.sin(best)) > 0.7;
  foot(best, (c, p, hw) => {
    const t = c.wall?.type;
    if (t === 'water') return;
    if (p <= hw) {
      if (c.wall) {
        if (TREES.has(t) || t === 'bush') { const r = rand(); c.wall = r < 0.4 ? mkWall('stump') : r < 0.55 ? mkWall('deadtree') : null; }
        else if (c.bld != null) c.wall = rand() < 0.3 ? mkWall('rockpile') : null; // zerstörte Mauerreste
        else c.wall = rand() < 0.2 ? mkWall('wreck') : null;
      } else if (rand() < 0.05) c.wall = mkWall('wreck');
      c.indoor = false; c.door = false;
      c.floor = p < hw * 0.55 ? 'burnt' : rand() < 0.5 ? 'mud' : 'burnt';
    } else if (c.wall && TREES.has(t)) { if (rand() < 0.5) c.wall = rand() < 0.5 ? mkWall('deadtree') : mkWall('log', { vert: logVert }); }
    else if (!c.wall && !c.indoor) { if (rand() < 0.35) c.floor = 'mud'; if (rand() < 0.07) c.wall = mkWall('rockpile'); }
  });
}
// Absturz: UFO halb im Teich (Teich liegt der Tür gegenüber, Tür an Land)
function ufoPond(map, at, s) {
  const { cx, cy, R, pcx, pcy, pr } = s;
  for (let y = Math.floor(pcy - pr - 2); y <= pcy + pr + 2; y++) for (let x = Math.floor(pcx - pr - 2); x <= pcx + pr + 2; x++) {
    const c = at(x, y); if (!c || c.reserved || c.ufo || c.door) continue;
    const d = Math.hypot(x - pcx, y - pcy);
    if (d <= pr && Math.hypot(x - cx, y - cy) > R + 0.5) { c.wall = mkWall('water'); c.floor = 'shore'; c.indoor = false; }
    else if (d <= pr + 1.4 && !c.indoor && c.wall?.type !== 'water') {
      c.floor = rand() < 0.6 ? 'shore' : 'mud';
      if (!c.wall && rand() < 0.12) c.wall = mkWall('bush');
    }
  }
}
// Absturz: Trümmerfeld mit Einschlagkratern
function ufoDebris(map, at, s) {
  const { cx, cy, R } = s;
  const a = rand() * Math.PI * 2, ux = Math.cos(a), uy = Math.sin(a);
  const ok = (c) => c && !c.reserved && !c.ufo && !c.door && !c.indoor && c.wall?.type !== 'water';
  for (let k = 0; k < R * 5; k++) {
    const t = R + 1 + rand() * 10, sp = (rand() - 0.5) * (2 + t * 0.8);
    const x = Math.round(cx + ux * t - uy * sp), y = Math.round(cy + uy * t + ux * sp), c = at(x, y);
    if (!ok(c)) continue;
    if (c.wall && TREES.has(c.wall.type)) c.wall = mkWall('deadtree');
    else if (!c.wall) c.wall = mkWall(rand() < 0.8 ? 'wreck' : 'rockpile', { rot: randInt(0, 3) });
    c.floor = 'burnt';
    for (const [dx, dy] of DIR4) { const n = at(x + dx, y + dy); if (ok(n) && !HARD_FLOORS.has(n.floor) && rand() < 0.4) n.floor = 'burnt'; }
  }
  for (let k = 0, n = randInt(2, 3); k < n; k++) {
    const t = R + 2 + rand() * 8, px = cx + ux * t + (rand() - 0.5) * 4, py = cy + uy * t + (rand() - 0.5) * 4;
    for (let y = Math.floor(py - 2); y <= py + 2; y++) for (let x = Math.floor(px - 2); x <= px + 2; x++) {
      const c = at(x, y); if (!ok(c)) continue;
      const d = Math.hypot(x - px, y - py);
      if (d < 0.9) { if (c.wall) c.wall = null; c.floor = 'burnt'; }
      else if (d < 1.9) { c.floor = 'mud'; if (!c.wall && rand() < 0.3) c.wall = mkWall('rockpile'); }
    }
  }
}
// Landung auf einem Platz (Beton/Pflaster) mit ein paar Fässern/Kisten am Rand
function ufoPad(map, at, s) {
  const { cx, cy, R, dir } = s;
  const f = map.biome === 'desert' ? choice(['concretefloor', 'parking']) : choice(['concretefloor', 'cobble']);
  for (let y = cy - R - 3; y <= cy + R + 3; y++) for (let x = cx - R - 3; x <= cx + R + 3; x++) {
    const c = at(x, y); if (!c || c.reserved || c.ufo) continue;
    if (Math.hypot(x - cx, y - cy) > R + 2.3) continue;
    c.floor = f; if (c.wall && c.wall.type !== 'water') c.wall = null; c.indoor = false;
  }
  const da = Math.atan2(dir[1], dir[0]);
  for (let k = 0, n = randInt(3, 6); k < n; k++) {
    const a = rand() * Math.PI * 2; if (Math.abs((((a - da) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) < 0.7) continue;
    const c = at(Math.round(cx + Math.cos(a) * (R + 2.6)), Math.round(cy + Math.sin(a) * (R + 2.6)));
    if (c && !c.wall && !c.indoor && !c.keep && !c.reserved && !c.ufo) c.wall = mkWall(choice(['barrel', 'crate', 'barrier', 'fuelbarrel']));
  }
}
// Landung auf freiem Feld: plattgedrückter Ring und Brandspuren der Landestützen
function ufoField(map, at, s) {
  const { cx, cy, R } = s;
  const ring = { farm: 'field2', forest: 'dirt', desert: 'sand', arctic: 'snow' }[map.biome];
  for (let y = cy - R - 3; y <= cy + R + 3; y++) for (let x = cx - R - 3; x <= cx + R + 3; x++) {
    const c = at(x, y); if (!c || c.reserved || c.ufo || c.wall) continue;
    const d = Math.hypot(x - cx, y - cy); if (d > R + 0.5 && d <= R + 2.2 && ring && !HARD_FLOORS.has(c.floor)) c.floor = ring;
  }
  for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const c = at(Math.round(cx + dx * (R + 0.6) * 0.75), Math.round(cy + dy * (R + 0.6) * 0.75)); if (c && !c.ufo && !c.reserved) c.floor = 'burnt'; }
}

// =====================================================================================
// Szenario-Module: Bausteine, die einen Kartenbereich gestalten. Lokale Koordinaten (u, v),
// Front (v = lh - 1) zeigt zur Landezone bzw. zum Weg; Drehung/Spiegelung übernimmt modCtx.
// =====================================================================================
function modCtx(G, x0, y0, gw, gh, face, mirror) {
  const { map, at } = G;
  const ew = face === 'e' || face === 'w';
  const lw = ew ? gh : gw, lh = ew ? gw : gh;
  const T = (u, v) => {
    if (mirror) u = lw - 1 - u;
    if (face === 's') return [x0 + u, y0 + v];
    if (face === 'n') return [x0 + lw - 1 - u, y0 + lh - 1 - v];
    if (face === 'e') return [x0 + v, y0 + lw - 1 - u];
    return [x0 + lh - 1 - v, y0 + u];
  };
  const sideOf = (ls) => { const [du, dv] = SIDE_V[ls]; const a = T(2, 2), b = T(2 + du, 2 + dv); const dx = b[0] - a[0], dy = b[1] - a[1]; return dx > 0 ? 'e' : dx < 0 ? 'w' : dy > 0 ? 's' : 'n'; };
  const rotG = (q) => ROTSEQ.indexOf(sideOf(ROTSEQ[((q % 4) + 4) % 4]));
  const M = { G, map, biome: G.biome, lw, lh, face, T, sideOf, rotG, entry: [lw >> 1, lh - 1] };
  M.cell = (u, v) => (u < 0 || v < 0 || u >= lw || v >= lh ? null : at(...T(u, v)));
  M.free = (u, v) => { const c = M.cell(u, v); return !!c && !c.wall && !c.indoor && !c.reserved && !c.uz && !c.keep; };
  M.floor = (u, v, f) => { const c = M.cell(u, v); if (c && !c.reserved && !c.uz && !c.indoor) c.floor = f; };
  M.fill = (u0, v0, w, h, f) => { for (let v = v0; v < v0 + h; v++) for (let u = u0; u < u0 + w; u++) M.floor(u, v, f); };
  // Hindernis setzen; o.rot = lokale Blickrichtung (0 = Front), o.alongV = Fahrzeug längs zur Tiefe, o.car = Autovariante
  M.put = (u, v, type, o = {}) => {
    if (!M.free(u, v)) return false;
    M.cell(u, v).wall = mkWall(type, { rot: o.rot != null ? rotG(o.rot) : undefined, variant: o.car ?? o.variant, vert: o.alongV != null ? !!o.alongV !== ew : undefined });
    return true;
  };
  M.scatter = (type, n, area = [1, 1, lw - 2, lh - 2], o = {}) => {
    if (area[2] < 1 || area[3] < 1) return 0;
    let k = 0;
    for (let t = 0; t < n * 8 && k < n; t++) {
      const u = area[0] + randInt(0, area[2] - 1), v = area[1] + randInt(0, area[3] - 1);
      if (o.spaced && DIR4.some(([du, dv]) => M.cell(u + du, v + dv)?.wall)) continue;
      const oo = { ...o }; if (o.anyRot) oo.rot = randInt(0, 3); if (o.randAlong) oo.alongV = rand() < 0.5;
      if (M.put(u, v, Array.isArray(type) ? choice(type) : type, oo)) k++;
    }
    return k;
  };
  M.ring = (u0, v0, w, h, type, o = {}) => {
    const gates = new Set((o.gates || []).map(([u, v]) => v * 1000 + u));
    for (let v = v0; v < v0 + h; v++) for (let u = u0; u < u0 + w; u++) {
      const eV = v === v0 || v === v0 + h - 1, eU = u === u0 || u === u0 + w - 1;
      if ((!eV && !eU) || gates.has(v * 1000 + u) || rand() < (o.gap || 0)) continue;
      M.put(u, v, type, { rot: eV ? 1 : 0 });
    }
  };
  M.ell = (cu, cv, ru, rv, fn) => { for (let v = 0; v < lh; v++) for (let u = 0; u < lw; u++) fn(u, v, Math.hypot((u - cu) / ru, (v - cv) / rv)); };
  M.bld = (u0, v0, w, h, opts = {}) => {
    if (u0 < 0 || v0 < 0 || u0 + w > lw || v0 + h > lh || w < 4 || h < 4) return false;
    const [ax, ay] = T(u0, v0), [bx, by] = T(u0 + w - 1, v0 + h - 1);
    const o = { ...opts };
    if (opts.doors) o.doors = opts.doors.map(sideOf);
    if (opts.front) o.front = sideOf(opts.front);
    const ok = building(map, at, G.setWall, Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax) + 1, Math.abs(by - ay) + 1, o);
    if (ok) M.spawn(u0 + (w >> 1), v0 + (h >> 1));
    return ok;
  };
  M.spawn = (u, v) => { if (M.cell(u, v)) { const [x, y] = T(u, v); map._modSpawns.push({ x, y }); } };
  M.deco = (u, v, t, o) => { const c = M.cell(u, v); if (c && !c.wall && !c.reserved) { const [x, y] = T(u, v); deco(map, t, x, y, o); } };
  return M;
}

// Freies Rechteck (lokal lw × lh) suchen; Ausrichtung: Front zur Landezone (meist)
function findRect(G, lw, lh, centerFn) {
  const { map, at, lzc } = G; const { W, H } = map;
  for (let t = 0; t < 40; t++) {
    const [cx, cy] = centerFn ? centerFn() : [randInt(0, W - 1), randInt(0, H - 1)];
    const dx = lzc.x - cx, dy = lzc.y - cy;
    const face = rand() < 0.15 ? choice(['n', 's', 'e', 'w']) : Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? 's' : 'n') : (dx > 0 ? 'e' : 'w');
    const ew = face === 'e' || face === 'w', gw = ew ? lh : lw, gh = ew ? lw : lh;
    if (gw > W || gh > H) continue;
    const x0 = clamp(cx - (gw >> 1), 0, W - gw), y0 = clamp(cy - (gh >> 1), 0, H - gh);
    let ok = true;
    for (let y = y0 - 1; y <= y0 + gh && ok; y++) for (let x = x0 - 1; x <= x0 + gw; x++) {
      const c = at(x, y); if (!c) continue;
      const inside = x >= x0 && y >= y0 && x < x0 + gw && y < y0 + gh;
      if (c.uz || c.mod || (inside && (c.reserved || c.keep || c.indoor || c.wall))) { ok = false; break; }
    }
    if (ok) return { x0, y0, gw, gh, face };
  }
  return null;
}
function placeRect(G, spec, centerFn) {
  const { map, at } = G;
  for (let attempt = 0; attempt < 3; attempt++) {
    const [wr, hr] = spec.size;
    const lw = attempt < 2 ? randInt(wr[0], wr[1]) : wr[0], lh = attempt < 2 ? randInt(hr[0], hr[1]) : hr[0];
    const r = findRect(G, lw, lh, centerFn);
    if (!r) continue;
    for (let y = r.y0; y < r.y0 + r.gh; y++) for (let x = r.x0; x < r.x0 + r.gw; x++) at(x, y).mod = spec.id;
    const M = modCtx(G, r.x0, r.y0, r.gw, r.gh, r.face, rand() < 0.5);
    spec.fn(M, G.biome);
    const [ex, ey] = M.T(...M.entry);
    return { x0: r.x0, y0: r.y0, w: r.gw, h: r.gh, face: r.face, entry: { x: ex, y: ey } };
  }
  return null;
}

// 1–3 Module je Karte wählen und platzieren, danach Wege von den Moduleingängen zur Landezone
function placeModules(G) {
  const { map, biome, lzc } = G;
  const pool = MODULES.filter((m) => m.biomes.includes(biome));
  const order = pool.map((m) => ({ m, k: Math.pow(rand(), 1 / (m.biomes.length === 1 ? 1.3 : 0.85)) })).sort((a, b) => b.k - a.k).map((o) => o.m);
  const n = +pickW({ 1: 2, 2: 4.5, 3: 3.5 });
  const rank = (m) => (m.kind === 'band' ? 0 : m.kind === 'line' ? 2 : 1);
  const chosen = order.slice(0, n).sort((a, b) => rank(a) - rank(b)), spare = order.slice(n).filter((m) => !m.kind);
  const run = (m) => { const rec = m.kind ? m.fn(G) : placeRect(G, m); if (rec) map.modules.push({ id: m.id, ...rec }); return rec; };
  for (const m of chosen) if (!run(m) && m.kind !== 'line') while (spare.length) if (run(spare.shift())) break;
  const pf = { farm: choice(['dirt', 'gravel']), forest: 'dirt', desert: 'gravel', arctic: 'gravel' }[biome];
  const ents = map.modules.filter((r) => r.entry);
  for (const r of ents) { const p = route(map, lzc.x, lzc.y, r.entry.x, r.entry.y, modPathCost); if (p) applyPath(map, p, pf); }
  for (let i = 1; i < ents.length; i++) if (rand() < 0.4) { const a = ents[i - 1].entry, b = ents[i].entry; const p = route(map, a.x, a.y, b.x, b.y, modPathCost); if (p) applyPath(map, p, pf); }
}

// ---------- Flüsse (quer über die Karte) ----------
function carveRiver(G, width) {
  const { map, at } = G; const { W, H } = map;
  for (let t = 0; t < 30; t++) {
    const vert = rand() < 0.4, L = vert ? H : W, S = vert ? W : H;
    const base = vert ? randInt(2, S - width - 3) : randInt(2, S - width - 8);
    const amp = rand() * 2.4, f = 0.12 + rand() * 0.28, ph = rand() * 6.28; // Steigung < 1: Wasser bleibt lückenlos
    const cols = []; let ok = true;
    for (let a = 0; a < L && ok; a++) {
      const b0 = Math.round(base + amp * Math.sin(a * f + ph)), cells = [];
      for (let b = b0 - 1; b <= b0 + width && ok; b++) {
        const [x, y] = vert ? [b, a] : [a, b], c = at(x, y), wet = b >= b0 && b < b0 + width;
        if (!c) { if (wet) ok = false; continue; }
        if (c.reserved || c.uz || c.mod || c.indoor || c.keep) ok = false;
        else if (wet) cells.push([x, y]);
      }
      cols.push({ b0, cells });
    }
    if (!ok) continue;
    for (const col of cols) for (const [x, y] of col.cells) { const c = at(x, y); c.wall = mkWall('water'); c.floor = 'shore'; c.mod = 'river'; }
    for (let a = 0; a < L; a++) for (const b of [cols[a].b0 - 1, cols[a].b0 + width]) { const c = at(...(vert ? [b, a] : [a, b])); if (c && !c.wall) c.floor = 'shore'; }
    return { vert, width, L, cols };
  }
  return null;
}
// Querungen: Brücke (plank) oder Furt (shore), 1–2 Felder breit; Ufer davor bleiben frei
function crossings(G, river, n, floor) {
  const { at } = G; const { vert, width, L, cols } = river; const used = [];
  for (let t = 0; t < 40 && used.length < n; t++) {
    const a = randInt(2, L - 4); if (used.some((u) => Math.abs(u - a) < 5)) continue;
    for (const aa of rand() < 0.4 ? [a, a + 1] : [a]) for (let b = cols[aa].b0 - 1; b <= cols[aa].b0 + width; b++) {
      const c = at(...(vert ? [b, aa] : [aa, b])); if (!c) continue;
      if (c.wall?.type === 'water') { c.wall = null; c.floor = floor; }
      c.keep = true;
    }
    used.push(a);
  }
  return used;
}
const nearRiver = (river, w) => () => {
  const col = choice(river.cols.slice(3, -3)), [x, y] = col.cells[0];
  const off = rand() < 0.5 ? -(w + 1) : river.width + w;
  return river.vert ? [x + off, y] : [x, y + off];
};
// Mühle am Bach (farm): Bach quer über die Karte, 1–2 Brücken, Steinmühle am Ufer
function modMillstream(G) {
  const river = carveRiver(G, rand() < 0.3 ? 3 : 2); if (!river) return null;
  crossings(G, river, randInt(1, 2), 'plank');
  const mill = placeRect(G, { id: 'millstream', size: [[7, 9], [6, 8]], fn: modMill }, nearRiver(river, 5));
  return mill || { entry: null };
}
function modMill(M) {
  const { lw, lh } = M;
  M.fill(0, 0, lw, lh, 'gravel');
  M.bld(1, 0, lw - 2, lh - 2, { style: 'farmhouse', mat: rand() < 0.65 ? 'stone' : 'wood', doors: ['s'], storeys: 2 });
  M.scatter('woodpile', randInt(1, 2), [0, lh - 2, lw, 2], { rot: 1 });
  M.scatter(['pallet', 'crate', 'hay'], randInt(1, 3), [0, lh - 2, lw, 2]);
  if (rand() < 0.5) M.put(0, randInt(0, lh - 3), 'well');
  if (rand() < 0.5) for (let v = 0; v < lh - 2; v++) M.put(lw - 1, v, 'stonewall', { rot: 0 });
}
// Fluss mit Steg (forest): breiter Fluss, Bootshütte mit Steg, Brücke oder Furt
function modRiverdock(G) {
  const { at } = G;
  const river = carveRiver(G, randInt(2, 3)); if (!river) return null;
  crossings(G, river, rand() < 0.4 ? 2 : 1, rand() < 0.55 ? 'plank' : 'shore');
  const hut = placeRect(G, { id: 'riverdock', size: [[6, 8], [6, 7]], fn: modBoathouse }, nearRiver(river, 4));
  // Steg: von der Hüttenseite ins Wasser, endet vor dem anderen Ufer
  const { vert, width, cols, L } = river;
  let a = randInt(3, L - 4);
  if (hut) { let bd = Infinity; for (let i = 2; i < L - 2; i++) { const [x, y] = cols[i].cells[0]; const d = Math.hypot(x - hut.x0 - hut.w / 2, y - hut.y0 - hut.h / 2); if (d < bd) { bd = d; a = i; } } }
  const [fx, fy] = cols[a].cells[0];
  const low = hut ? (vert ? hut.x0 < fx : hut.y0 < fy) : rand() < 0.5;
  for (const [x, y] of low ? cols[a].cells.slice(0, width - 1) : cols[a].cells.slice(1)) { const c = at(x, y); if (c.wall?.type === 'water') { c.wall = null; c.floor = 'plank'; c.keep = true; } }
  return hut || { entry: null };
}
function modBoathouse(M) {
  const { lw, lh } = M;
  M.bld(1, 1, Math.min(5, lw - 2), Math.min(4, lh - 3), { style: 'cabin', doors: ['s'] });
  M.scatter(['barrel', 'barrel', 'woodpile', 'log', 'crate'], randInt(2, 4), [0, lh - 2, lw, 2]);
  if (rand() < 0.4) M.scatter('tent', 1, [0, lh - 2, lw, 2], { anyRot: true });
}
// Stromtrasse: Strommasten in einer Linie quer über die Karte, darunter ein Schotterstreifen
function modPowerline(G) {
  const { map, at } = G; const { W, H } = map;
  const vert = rand() < 0.5, L = vert ? H : W, pos = vert ? randInt(2, W - 3) : randInt(2, H - 9), step = randInt(5, 7);
  const track = rand() < 0.6 ? choice(['gravel', 'dirt']) : null;
  let n = 0;
  for (let a = randInt(1, 3); a < L; a += step) for (const off of [0, 1, -1]) {
    const c = at(...(vert ? [pos + off, a] : [a, pos + off]));
    if (!freeCell(c)) continue;
    c.wall = mkWall('pylon', { rot: vert ? 0 : 1 }); c.mod = 'powerline'; n++; break;
  }
  if (track) for (let a = 0; a < L; a++) { const c = at(...(vert ? [pos + 1, a] : [a, pos + 1])); if (freeCell(c) && NATURAL.has(c.floor)) c.floor = track; }
  return n >= 2 ? { axis: vert ? 'x' : 'y', pos } : null;
}

const treeOf = (biome) => ({ farm: ['oak', 'tree', 'birch'], forest: ['pine', 'birch', 'oak'], desert: ['palm', 'deadtree'], arctic: ['pine', 'birch'] }[biome] || ['tree']);

// ---------- farm ----------
function modFarmstead(M) {
  const { lw, lh } = M;
  M.fill(0, lh - 4, lw, 4, choice(['gravel', 'dirt']));
  const left = rand() < 0.5;
  const hw = randInt(5, 6), hh = randInt(5, Math.min(6, lh - 5));
  const bw = Math.min(randInt(6, 8), lw - hw - 3), bh = Math.min(randInt(6, 8), lh - 5);
  const hu = left ? 1 : lw - 1 - hw, bu = left ? lw - 1 - bw : 1;
  M.bld(hu, 1, hw, hh, { style: 'farmhouse', doors: ['s'] });
  if (bw >= 5) M.bld(bu, 1, bw, bh, { style: 'barn', doors: ['s'] });
  // Silos zwischen Wohnhaus und Scheune
  const g0 = left ? hu + hw : bu + bw, g1 = left ? bu - 1 : hu - 1;
  for (let k = 0, n = randInt(1, 3); k < n && g1 >= g0; k++) M.put(randInt(g0, g1), 1 + k, 'silo');
  if (lw >= 15 && rand() < 0.6) M.bld(left ? lw - 5 : 1, lh - 5, 4, 4, { style: 'greenhouse', doors: [left ? 'w' : 'e'] });
  const ft = choice(['fence', 'fence', 'stonewall', 'tallhedge']);
  for (let u = 0; u < lw; u++) if (rand() > 0.15) M.put(u, 0, ft, { rot: 1 });
  for (let v = 1; v < lh - 2; v++) { if (rand() > 0.25) M.put(0, v, ft, { rot: 0 }); if (rand() > 0.25) M.put(lw - 1, v, ft, { rot: 0 }); }
  M.scatter('hay', randInt(3, 6), [1, lh - 4, lw - 2, 3]);
  M.scatter('car', 1, [1, lh - 4, lw - 2, 3], { car: 'tractor', randAlong: true, spaced: true });
  M.scatter('car', 1, [1, lh - 4, lw - 2, 3], { car: 'pickup', randAlong: true, spaced: true });
  M.scatter(rand() < 0.5 ? 'well' : 'watertank', 1, [1, lh - 4, lw - 2, 3], { spaced: true });
  M.deco(M.entry[0] + 1, lh - 1, 'mailbox', { s: 1 });
}
function modVineyard(M) {
  const { lw, lh } = M;
  M.fill(0, 0, lw, lh, 'vineyard');
  const lane = randInt(2, lw - 3), t = rand() < 0.6 ? 'hedge' : 'fence';
  for (let v = 1; v < lh - 2; v += 2) for (let u = 1; u < lw - 1; u++) {
    if (u === lane || rand() < 0.06) continue;
    M.put(u, v, u === 1 || u === lw - 2 ? 'fence' : t, { rot: 1 }); // Rebzeilen mit Pfosten an den Enden
  }
  M.fill(lane, 0, 1, lh, 'dirt'); M.fill(0, lh - 2, lw, 2, 'dirt');
  const side = rand() < 0.5 ? 0 : lw - 1;
  for (let v = 0; v < lh - 2; v++) if (rand() > 0.1) M.put(side, v, 'tallhedge', { rot: 0 });
  for (let u = 0; u < lw; u++) if (rand() > 0.25) M.put(u, 0, 'stonewall', { rot: 1 });
  M.scatter('barrel', randInt(2, 4), [0, lh - 2, lw, 2]);
  M.scatter('crate', randInt(1, 3), [0, lh - 2, lw, 2]);
  if (rand() < 0.5) M.scatter('car', 1, [0, lh - 1, lw, 1], { car: 'tractor', alongV: false });
  for (let k = 0; k < 3; k++) M.spawn(randInt(1, lw - 2), 2 * randInt(1, (lh - 3) >> 1));
  M.entry = [lane, lh - 1];
}
function modOrchard(M) {
  const { lw, lh } = M;
  const sp = randInt(2, 3), kinds = shuffle(['oak', 'birch', 'tree']).slice(0, randInt(1, 2)), ou = randInt(1, 2), ov = randInt(1, 2);
  if (rand() < 0.6) M.ring(0, 0, lw, lh, choice(['fence', 'hedge', 'stonewall']), { gates: [[lw >> 1, lh - 1], [(lw >> 1) + 1, lh - 1], [lw >> 1, 0]], gap: 0.08 });
  for (let v = ov; v < lh - 1; v += sp) for (let u = ou; u < lw - 1; u += sp) if (rand() < 0.85) M.put(u, v, choice(kinds));
  M.scatter('crate', randInt(1, 3)); M.scatter('hay', randInt(0, 2));
  if (rand() < 0.5) M.scatter('bush', randInt(2, 3));
  if (rand() < 0.4) M.scatter('car', 1, [1, 1, lw - 2, lh - 2], { car: 'tractor', randAlong: true });
}
function modCornfield(M) {
  const { lw, lh } = M;
  M.fill(0, 0, lw, lh, 'crops');
  for (let k = 0, n = randInt(1, 2); k < n; k++) { if (rand() < 0.5) M.fill(randInt(1, lw - 2), 0, 1, lh, 'dirt'); else M.fill(0, randInt(1, lh - 2), lw, 1, 'dirt'); }
  M.fill(M.entry[0], lh - 3, 1, 3, 'dirt');
  if (rand() < 0.3) M.ell((lw - 1) / 2, (lh - 1) / 2, 3.2, 3.2, (u, v, d) => { if (d < 1) M.floor(u, v, d < 0.4 || d > 0.75 ? 'field2' : 'crops'); }); // Kornkreis
  M.scatter('hay', randInt(2, 5)); M.scatter('bush', randInt(0, 2));
  M.scatter('car', 1, [1, 1, lw - 2, lh - 2], { car: 'tractor', randAlong: true });
  if (rand() < 0.5) { const u = rand() < 0.5 ? 0 : lw - 1; for (let v = 0; v < lh; v++) if (rand() > 0.15) M.put(u, v, 'fence', { rot: 0 }); }
  for (let k = 0; k < 4; k++) M.spawn(randInt(1, lw - 2), randInt(1, lh - 3));
}
// ---------- forest ----------
function modClearing(M, biome) {
  const { lw, lh } = M; const cu = (lw - 1) / 2, cv = (lh - 1) / 2;
  M.ell(cu, cv, lw / 2, lh / 2, (u, v, d) => {
    if (d < 0.75) M.floor(u, v, rand() < 0.15 ? 'dirt' : 'grass');
    else if (d < 1.1 && rand() < 0.55 && !(v > cv && Math.abs(u - cu) < 1.6)) M.put(u, v, choice([...treeOf(biome), 'bush']));
  });
  const inner = [2, 2, lw - 4, lh - 4];
  M.scatter('log', randInt(2, 4), inner, { randAlong: true }); M.scatter('stump', randInt(2, 5), inner);
  M.scatter('rock', randInt(1, 3), inner); M.scatter('bush', 2, inner);
  if (rand() < 0.4) M.scatter('scaffold', 1, inner, { anyRot: true }); // Hochsitz
  if (rand() < 0.3) M.scatter('woodpile', 1, inner, { anyRot: true });
  for (let k = 0; k < 3; k++) M.spawn(Math.round(cu) + randInt(-2, 2), Math.round(cv) + randInt(-2, 2));
}
function modLumbercamp(M) {
  const { lw, lh } = M;
  M.fill(1, 1, lw - 2, lh - 2, 'dirt');
  M.ell(lw / 2, lh / 2, lw / 3, lh / 3, (u, v, d) => { if (d < 1 && rand() < 0.5) M.floor(u, v, 'mud'); });
  const cw = randInt(4, 5);
  M.bld(1, 1, cw, randInt(4, 5), { style: 'cabin', doors: ['s'] });
  for (let k = 0, rows = randInt(2, 3); k < rows; k++) { const v = 2 + k * 2, u0 = randInt(cw + 2, lw - 5); for (let u = u0; u < Math.min(lw - 1, u0 + randInt(2, 4)); u++) M.put(u, v, 'woodpile', { rot: 1 }); }
  M.scatter('stump', randInt(5, 9)); M.scatter('log', randInt(2, 4), undefined, { randAlong: true });
  M.scatter('fuelbarrel', randInt(1, 2)); M.scatter('barrel', randInt(0, 2)); M.scatter('pallet', randInt(1, 2));
  M.scatter('truck', 1, [1, lh - 3, lw - 2, 2], { rot: 1 });
}
function modRangerhut(M, biome) {
  const { lw, lh } = M;
  const bw = randInt(5, Math.min(7, lw - 3)), bh = randInt(4, 5), bu = randInt(1, lw - bw - 1);
  M.bld(bu, 1, bw, bh, { style: 'cabin', doors: ['s'] });
  M.fill(bu, 1 + bh, bw, 1, 'plank'); // Veranda
  for (let v = 1; v <= bh; v++) if (rand() < 0.6) M.put(bu + bw, v, 'woodpile', { rot: 0 });
  const gu = bu >= 5 ? 0 : lw - 4;
  if (lh - bh - 2 >= 4 && rand() < 0.7) { M.fill(gu + 1, lh - 4, 2, 2, 'field'); M.ring(gu, lh - 5, 4, 4, 'fence', { gates: [[gu + 1, lh - 5]] }); }
  M.scatter('car', 1, [1, bh + 2, lw - 2, lh - bh - 3], { car: 'pickup', randAlong: true, spaced: true });
  if (rand() < 0.4) M.scatter('well', 1); if (rand() < 0.25) M.scatter('watertank', 1);
  M.scatter('bush', randInt(1, 3)); M.scatter(treeOf(biome), randInt(1, 3));
  M.entry = [bu + (bw >> 1), lh - 1];
}
function modCampsite(M) {
  const { lw, lh } = M;
  M.fill(1, lh - 2, lw - 2, 1, 'gravel'); M.fill(1, 1, 1, lh - 2, 'gravel'); M.fill(lw - 2, 1, 1, lh - 2, 'gravel'); M.fill(1, 1, lw - 2, 1, 'gravel');
  if (rand() < 0.7) M.bld(lw - 7, 2, 4, 4, { style: 'cabin', doors: ['e'] }); // Sanitärhaus
  for (let v = 3; v < lh - 3; v += 3) for (let u = 3; u < lw - 3; u += 3) if (rand() < 0.6) M.put(u, v, 'tent', { rot: randInt(0, 3) });
  M.scatter('bus', randInt(1, 2), [2, 2, lw - 4, lh - 4], { rot: choice([1, 3]), spaced: true }); // Wohnmobile
  M.scatter('car', randInt(0, 2), [2, 2, lw - 4, lh - 4], { car: choice(['kombi', 'suv', 'van']), randAlong: true, spaced: true });
  M.scatter('barrel', 2); M.scatter('crate', randInt(2, 3)); M.scatter('bush', 2);
  for (let k = 0; k < 3; k++) M.spawn(randInt(2, lw - 3), randInt(2, lh - 3));
}
function modRuin(M, biome) {
  const { lw, lh } = M;
  M.ell(lw / 2, lh / 2, lw / 2, lh / 2, (u, v, d) => { if (d < 1 && rand() < 0.6) M.floor(u, v, 'gravel'); });
  const bw = randInt(5, Math.min(8, lw - 2)), bh = randInt(5, Math.min(7, lh - 3));
  M.bld(randInt(1, lw - bw - 1), randInt(1, lh - bh - 2), bw, bh, { style: 'ruin', doors: ['s'] });
  for (let k = 0, n = randInt(2, 3); k < n; k++) { // Mauerreste
    const horiz = rand() < 0.5, len = randInt(2, 4); let u = randInt(0, lw - 1), v = randInt(0, lh - 1);
    for (let i = 0; i < len; i++) { if (rand() < 0.8) M.put(u, v, rand() < 0.5 ? 'stone' : 'stonewall', { rot: horiz ? 1 : 0 }); if (horiz) u++; else v++; }
  }
  M.scatter('rockpile', randInt(3, 6)); M.scatter('bush', randInt(2, 3)); M.scatter([...treeOf(biome), 'deadtree'], randInt(1, 2));
  if (rand() < 0.3) M.scatter('gravestone', randInt(1, 3), undefined, { rot: 0 });
}
function modCabins(M, biome) {
  const { lw, lh } = M;
  const cw = randInt(4, 5), ch = randInt(4, 5);
  for (let k = 0, u = 1; k < 3 && u + cw <= lw - 1; k++, u += cw + 2) { // Hütten in einer Reihe, Türen zum Weg
    M.bld(u, 1 + randInt(0, 1), cw, ch, { style: 'cabin', doors: ['s'] });
    M.put(u + cw, 2, 'woodpile', { rot: 0 }); if (rand() < 0.5) M.put(u + cw, 3, 'woodpile', { rot: 0 });
  }
  M.fill(0, ch + 3, lw, 1, 'gravel');
  M.scatter(treeOf(biome), randInt(2, 4), [0, ch + 4, lw, Math.max(1, lh - ch - 4)]);
  M.scatter('car', 1, [1, ch + 3, lw - 2, Math.max(1, lh - ch - 4)], { car: biome === 'arctic' ? 'suv' : 'pickup', alongV: false });
  if (rand() < 0.3) M.scatter('well', 1); M.scatter('barrel', randInt(0, 2));
}
// ---------- desert ----------
function modGasstation(M) {
  const { lw, lh } = M;
  M.fill(0, 0, lw, lh, 'parking'); M.fill(0, lh - 2, lw, 2, 'asphalt'); // Highway vor der Tankstelle
  const sw = randInt(5, 7), sh = randInt(4, 5), su = rand() < 0.5 ? 1 : lw - sw - 1;
  M.bld(su, 1, sw, sh, { style: 'gasstation', doors: ['s'] });
  const pv = Math.min(sh + 2, lh - 3), n = randInt(2, 4), u0 = Math.max(1, (lw - n * 3) >> 1);
  for (let k = 0; k < n; k++) { M.put(u0 + k * 3, pv, 'fuelpump', { rot: 1 }); if (rand() < 0.6) M.put(u0 + k * 3 + 1, pv, 'car', { car: choice(['sedan', 'kombi', 'suv', 'pickup']), alongV: true }); }
  M.scatter('fuelbarrel', randInt(2, 4), [0, 0, lw, sh + 1]); M.scatter('barrel', randInt(1, 2), [0, 0, lw, sh + 1]);
  if (rand() < 0.5) M.scatter('truck', 1, [0, lh - 2, lw, 1], { rot: 1 });
  if (rand() < 0.4) M.scatter('watertank', 1, [0, 0, lw, sh + 1]);
}
function modOasis(M) {
  const { lw, lh } = M;
  const cu = (lw - 1) / 2, cv = (lh - 1) / 2 - 0.5, ru = Math.max(1.6, lw / 2 - 2.6), rv = Math.max(1.6, lh / 2 - 2.8);
  M.ell(cu, cv, ru, rv, (u, v, d) => {
    if (d < 1) { M.put(u, v, 'water'); M.floor(u, v, 'shore'); }
    else if (d < 1.45) M.floor(u, v, 'shore');
    else if (d < 2 && rand() < 0.4) M.put(u, v, rand() < 0.7 ? 'palm' : 'bush');
  });
  M.scatter('tent', randInt(0, 2), undefined, { anyRot: true }); if (rand() < 0.4) M.scatter('well', 1);
  M.scatter('rock', randInt(1, 3)); if (rand() < 0.4) M.scatter('car', 1, undefined, { car: 'pickup', randAlong: true });
}
function modMilpost(M) {
  const { lw, lh } = M; const gu = lw >> 1;
  M.fill(1, 1, lw - 2, lh - 2, rand() < 0.5 ? 'gravel' : 'concretefloor');
  M.ring(0, 0, lw, lh, 'chainlink', { gates: [[gu - 1, lh - 1], [gu, lh - 1], [gu + 1, lh - 1], ...(rand() < 0.5 ? [[gu, 0]] : [])], gap: 0.05 });
  const bw = randInt(5, 6); M.bld(rand() < 0.5 ? 1 : lw - bw - 1, 1, bw, 4, { style: 'bunker', doors: ['s'] });
  for (let k = 0, n = randInt(2, 3); k < n; k++) { // Sandsack-Stellungen (U-förmig, nach hinten offen)
    const u = randInt(2, lw - 3), v = randInt(6, lh - 3);
    for (const [du, dv] of [[-1, 1], [0, 1], [1, 1], [-1, 0], [1, 0]]) M.put(u + du, v + dv, 'sandbag', { rot: dv ? 1 : 0 });
  }
  M.scatter('milcrate', randInt(3, 5)); M.scatter('fuelbarrel', randInt(2, 3));
  M.scatter('milwreck', randInt(1, 2), undefined, { anyRot: true, spaced: true }); M.scatter('tent', randInt(1, 2), undefined, { rot: choice([0, 2]) });
  for (let k = 0; k < 3; k++) M.spawn(randInt(2, lw - 3), randInt(2, lh - 3));
}
function modCanyon(M) {
  const { lw, lh } = M;
  const open = new Uint8Array(lw * lh);
  const op = (a, b) => { if (a >= 0 && b >= 0 && a < lw && b < lh) open[b * lw + a] = 1; };
  // Hauptschlucht (2 breit) von vorne nach hinten, Seitenarm quer (2 breit), optional ein Felskessel
  let u = (lw >> 1) - 1;
  for (let v = lh - 1; v >= 0; v--) { op(u, v); op(u + 1, v); if (rand() < 0.45) u = clamp(u + choice([-1, 1]), 1, lw - 3); op(u, v); op(u + 1, v); }
  let v2 = randInt(2, lh - 4);
  for (let uu = 0; uu < lw; uu++) { op(uu, v2); op(uu, v2 + 1); if (rand() < 0.3) v2 = clamp(v2 + choice([-1, 1]), 1, lh - 3); op(uu, v2); op(uu, v2 + 1); }
  if (rand() < 0.6) { const ku = randInt(2, lw - 3), kv = randInt(2, lh - 3); for (let dv = -1; dv <= 1; dv++) for (let du = -1; du <= 1; du++) op(ku + du, kv + dv); }
  for (let v = 0; v < lh; v++) for (let uu = 0; uu < lw; uu++) {
    if (!open[v * lw + uu]) { if (rand() < 0.95) M.put(uu, v, rand() < 0.8 ? 'bigrock' : 'rockpile'); }
    else M.floor(uu, v, rand() < 0.6 ? 'gravel' : 'sand');
  }
  for (let v = 0; v < lh; v++) for (let uu = 0; uu < lw; uu++) {
    if (!open[v * lw + uu] || rand() > 0.06) continue;
    const walls = DIR4.filter(([du, dv]) => M.cell(uu + du, v + dv)?.wall).length;
    if (walls >= 2) M.put(uu, v, 'rockpile');
  }
  M.scatter('deadtree', randInt(0, 2), undefined, { spaced: true });
  for (let k = 0; k < 3; k++) { const a = randInt(0, lw * lh - 1); if (open[a]) M.spawn(a % lw, (a / lw) | 0); }
}
function modMotel(M) {
  const { lw, lh } = M;
  const bw = lw - 2 - randInt(0, 2), bh = randInt(4, 5), bu = randInt(1, lw - bw - 1);
  M.bld(bu, 1, bw, bh, { style: 'motel', front: 's', rooms: true });
  M.fill(0, bh + 2, lw, lh - bh - 2, 'parking'); M.fill(bu, bh + 1, bw, 1, 'concretefloor'); // Laubengang
  for (let u = 1; u < lw - 1; u += 2) if (rand() < 0.4) M.put(u, bh + 3, 'car', { car: choice(['sedan', 'kombi', 'suv', 'van', 'pickup', 'burnt']), alongV: true });
  if (rand() < 0.35) M.scatter('bus', 1, [1, lh - 2, lw - 2, 1], { rot: 1 });
  M.put(bu + bw, randInt(1, 3), 'watertank'); M.scatter('barrel', randInt(1, 2), [0, bh + 1, lw, lh - bh - 1]); M.scatter('bush', randInt(1, 2), [0, bh + 1, lw, lh - bh - 1]);
}
// ---------- arctic ----------
function modResearch(M) {
  const { lw, lh } = M;
  M.fill(1, 1, lw - 2, lh - 2, 'concretefloor');
  const bw = randInt(5, 7), bh = randInt(4, 5), left = rand() < 0.5, bu = left ? 1 : lw - bw - 1;
  M.bld(bu, 1, bw, bh, rand() < 0.6 ? { style: 'bunker', doors: ['s'] } : { style: 'warehouse', doors: ['s'] });
  const cu = left ? bw + 2 : 1, cw = lw - bw - 3;
  for (let k = 0, n = randInt(2, 4); k < n; k++) M.put(cu + randInt(0, Math.max(0, cw - 1)), 1 + k * 2, 'container', { rot: 1 });
  M.scatter('watertank', randInt(1, 2), undefined, { spaced: true }); M.scatter('fuelbarrel', randInt(2, 4)); M.scatter('crate', randInt(1, 3));
  if (rand() < 0.6) M.scatter('pylon', 1, undefined, { spaced: true }); // Antennenmast
  M.scatter('car', 1, [1, bh + 2, lw - 2, lh - bh - 3], { car: 'suv', randAlong: true, spaced: true });
  if (rand() < 0.5) for (let v = 0; v < lh - 2; v++) M.put(left ? lw - 1 : 0, v, 'chainlink', { rot: 0 });
}
function modFrozenLake(M) {
  const { lw, lh } = M; const cu = (lw - 1) / 2, cv = (lh - 1) / 2;
  const ice = [];
  M.ell(cu, cv, lw / 2 - 1, lh / 2 - 1, (u, v, d) => {
    if (d < 1) { M.floor(u, v, 'ice'); if (d < 0.6) ice.push([u, v]); }
    else if (d < 1.3) M.floor(u, v, rand() < 0.5 ? 'shore' : 'snow');
    else if (d < 1.6 && rand() < 0.3) M.put(u, v, choice(['bigrock', 'rock', 'pine', 'deadtree']));
  });
  for (let k = 0, n = randInt(1, 3); k < n && ice.length; k++) { // Eislöcher mit Angelzelt
    const [u, v] = choice(ice);
    if (M.put(u, v, 'water')) { const [du, dv] = choice(DIR4); M.put(u + du, v + dv, 'tent', { anyRot: true, rot: randInt(0, 3) }); if (rand() < 0.5) M.put(u - du, v - dv, choice(['barrel', 'crate'])); }
  }
  M.scatter('rock', randInt(0, 2));
  for (let k = 0; k < 2 && ice.length; k++) M.spawn(...choice(ice));
}
function modRadar(M) {
  const { lw, lh } = M; const cu = lw >> 1, cv = (lh >> 1) - 1;
  M.fill(1, 1, lw - 2, lh - 2, rand() < 0.5 ? 'concretefloor' : 'gravel');
  for (let k = 0; k < 4; k++) M.put(cu + (k & 1), cv + (k >> 1), 'pylon', { rot: k, variant: k }); // Radarmast auf vier Füßen
  M.ring(0, 0, lw, lh, 'chainlink', { gates: [[cu, lh - 1], [cu + 1, lh - 1]], gap: 0.04 });
  M.bld(1, 1, 4, 4, { style: 'bunker', doors: ['e'] });
  M.scatter('container', 1, undefined, { rot: 1, spaced: true }); M.scatter('fuelbarrel', randInt(1, 3));
  if (rand() < 0.5) M.scatter('watertank', 1, undefined, { spaced: true });
  M.scatter('car', 1, [1, lh - 4, lw - 2, 2], { car: 'suv', alongV: false });
}
// ---------- biomübergreifend ----------
function modVillage(M, biome) {
  const { lw, lh } = M;
  const cw = randInt(5, 6), chh = Math.min(randInt(7, 8), lh - 5), left = rand() < 0.5, cu = left ? 1 : lw - cw - 1;
  M.bld(cu, 0, cw, chh, { style: 'church', doors: ['s'] });
  const gw = Math.min(randInt(4, 6), lw - cw - 3), gu = left ? cu + cw + 1 : cu - gw - 1;
  if (gw >= 3) { // Friedhof neben der Kirche
    M.fill(gu, 0, gw, chh - 1, 'graveyard');
    const wt = rand() < 0.5 ? 'stonewall' : 'tallhedge', outer = left ? gu + gw - 1 : gu;
    for (let v = 0; v < chh - 1; v++) M.put(outer, v, wt, { rot: 0 });
    for (let u = gu; u < gu + gw; u++) if (u !== gu + (gw >> 1)) M.put(u, chh - 1, wt, { rot: 1 });
    for (let v = 1; v < chh - 2; v += 2) for (let u = gu + (left ? 0 : 1); u < gu + gw - (left ? 1 : 0); u += 2) M.put(u, v, 'gravestone', { rot: 0 });
    const hu = left ? gu + gw + 1 : 1, hw = left ? lw - hu - 1 : gu - 2;
    if (hw >= 5) M.bld(hu, 0, Math.min(hw, 6), randInt(4, Math.min(5, chh - 1)), { style: 'farmhouse', doors: ['s'] });
  }
  const pv = chh + 1;
  M.fill(1, pv - 1, lw - 2, lh - pv, 'cobble'); // Dorfplatz
  const mu = lw >> 1, mv = pv + ((lh - pv) >> 1);
  M.put(mu, mv, rand() < 0.65 ? 'fountain' : 'well');
  if (rand() < 0.5) M.put(mu + choice([-3, 3]), mv, 'statue', { rot: 0 });
  for (const [u, v] of [[1, pv], [lw - 2, pv], [1, lh - 2], [lw - 2, lh - 2]]) if (rand() < 0.6) M.put(u, v, biome === 'desert' ? 'palm' : biome === 'arctic' ? 'pine' : 'oak');
  for (const du of [-1, 1]) M.deco(mu + du * 2, mv, 'bench', { s: 1, ox: 0, oz: 0, rot: du * Math.PI / 2 });
  M.spawn(cu + (cw >> 1), chh >> 1);
}
function modIndustrial(M) {
  const { lw, lh } = M;
  M.fill(0, 0, lw, lh, 'concretefloor');
  const gu = lw >> 1;
  M.ring(0, 0, lw, lh, 'chainlink', { gates: [[gu - 1, lh - 1], [gu, lh - 1], [gu + 1, lh - 1]], gap: 0.08 });
  const ww = randInt(6, Math.min(9, lw - 5)), wh = randInt(5, Math.min(7, lh - 5)), left = rand() < 0.5, wu = left ? 1 : lw - ww - 1;
  M.bld(wu, 1, ww, wh, { style: 'warehouse', doors: ['s'] });
  const c0 = left ? wu + ww + 1 : 1, c1 = left ? lw - 2 : wu - 2;
  for (let v = 1; v < wh; v += 2) { const vr = randInt(0, 3); for (let u = c0; u <= c1; u++) if (rand() < 0.7) M.put(u, v, 'container', { rot: 1, variant: vr }); }
  M.scatter('truck', randInt(1, 2), [1, wh + 2, lw - 2, lh - wh - 3], { rot: choice([1, 3]), spaced: true });
  M.scatter('pallet', randInt(3, 6)); M.scatter('barrel', randInt(1, 3)); M.scatter('fuelbarrel', randInt(1, 2)); M.scatter('crate', 2);
}
function modConstruction(M) {
  const { lw, lh } = M;
  M.fill(0, 0, lw, lh, rand() < 0.5 ? 'mud' : 'gravel');
  const bw = randInt(5, Math.min(8, lw - 4)), bh = randInt(5, Math.min(7, lh - 4)), bu = randInt(2, lw - bw - 2), bv = 2;
  M.bld(bu, bv, bw, bh, { style: 'bunker', mat: 'concrete', unfinished: true, doors: ['s'] }); // Rohbau
  for (let u = bu; u < bu + bw; u++) if (rand() < 0.85) M.put(u, bv - 1, 'scaffold', { rot: 2 });
  const su = rand() < 0.5 ? bu - 1 : bu + bw;
  for (let v = bv; v < bv + bh; v++) if (rand() < 0.85) M.put(su, v, 'scaffold', { rot: su < bu ? 1 : 3 });
  M.scatter('pallet', randInt(3, 6)); M.scatter('rockpile', randInt(1, 3)); M.scatter('barrel', randInt(1, 2));
  M.scatter('container', 1, undefined, { rot: 1, spaced: true });
  if (rand() < 0.6) M.scatter('truck', 1, [1, lh - 3, lw - 2, 2], { rot: 1 });
  for (let u = 0; u < lw; u++) if (Math.abs(u - (lw >> 1)) > 1 && rand() < 0.8) M.put(u, lh - 1, 'chainlink', { rot: 1 });
}
function modReststop(M, biome) {
  const { lw, lh } = M;
  M.fill(0, 0, lw, lh, 'parking'); M.fill(0, lh - 2, lw, 2, 'asphalt');
  const left = rand() < 0.5;
  M.bld(left ? 1 : lw - 6, 1, 5, 4, biome === 'forest' || biome === 'arctic' ? { style: 'cabin', doors: ['s'] } : { style: 'motel', doors: ['s'] });
  for (let k = 0, n = randInt(2, 4); k < n; k++) M.scatter(choice(['bus', 'truck', 'truck']), 1, [1, 6, lw - 2, Math.max(1, lh - 8)], { rot: choice([1, 3]), spaced: true });
  M.scatter('car', randInt(2, 3), [1, 5, lw - 2, Math.max(1, lh - 7)], { car: choice(['sedan', 'kombi', 'suv', 'van']), alongV: true });
  M.scatter(treeOf(biome), 2, [0, 0, lw, 1]); M.scatter('crate', 2, [0, 0, lw, 5]); M.scatter('barrel', randInt(1, 2)); M.scatter('bush', 2, [0, 0, lw, 5]);
}

// Modul-Katalog: biomes = wo das Modul vorkommen kann; kind 'band' (Fluss) bzw. 'line' (Trasse) quer über die Karte
const MODULES = [
  { id: 'farmstead', name: 'Bauernhof', biomes: ['farm'], size: [[13, 16], [11, 13]], fn: modFarmstead },
  { id: 'vineyard', name: 'Weinberg', biomes: ['farm'], size: [[10, 14], [9, 12]], fn: modVineyard },
  { id: 'orchard', name: 'Obstgarten', biomes: ['farm'], size: [[9, 13], [9, 12]], fn: modOrchard },
  { id: 'cornfield', name: 'Maisfeld', biomes: ['farm'], size: [[10, 15], [8, 12]], fn: modCornfield },
  { id: 'millstream', name: 'Mühle am Bach', biomes: ['farm'], kind: 'band', fn: modMillstream },
  { id: 'clearing', name: 'Lichtung', biomes: ['forest'], size: [[9, 13], [9, 12]], fn: modClearing },
  { id: 'lumbercamp', name: 'Holzfällerlager', biomes: ['forest'], size: [[11, 14], [9, 12]], fn: modLumbercamp },
  { id: 'rangerhut', name: 'Försterhütte', biomes: ['forest'], size: [[9, 12], [8, 10]], fn: modRangerhut },
  { id: 'campsite', name: 'Campingplatz', biomes: ['forest'], size: [[11, 14], [9, 12]], fn: modCampsite },
  { id: 'riverdock', name: 'Fluss mit Steg', biomes: ['forest'], kind: 'band', fn: modRiverdock },
  { id: 'ruin', name: 'Ruine', biomes: ['forest', 'farm'], size: [[9, 13], [8, 11]], fn: modRuin },
  { id: 'gasstation', name: 'Tankstelle', biomes: ['desert'], size: [[12, 15], [9, 11]], fn: modGasstation },
  { id: 'oasis', name: 'Oase', biomes: ['desert'], size: [[9, 12], [9, 12]], fn: modOasis },
  { id: 'milpost', name: 'Militärposten', biomes: ['desert'], size: [[11, 14], [10, 12]], fn: modMilpost },
  { id: 'canyon', name: 'Felsschlucht', biomes: ['desert'], size: [[11, 15], [10, 13]], fn: modCanyon },
  { id: 'motel', name: 'Verlassenes Motel', biomes: ['desert'], size: [[12, 16], [8, 10]], fn: modMotel },
  { id: 'research', name: 'Forschungsstation', biomes: ['arctic'], size: [[12, 15], [10, 12]], fn: modResearch },
  { id: 'frozenlake', name: 'Gefrorener See', biomes: ['arctic'], size: [[10, 14], [9, 12]], fn: modFrozenLake },
  { id: 'radar', name: 'Radaranlage', biomes: ['arctic'], size: [[10, 13], [10, 12]], fn: modRadar },
  { id: 'cabins', name: 'Holzhütten', biomes: ['arctic', 'forest'], size: [[12, 15], [9, 11]], fn: modCabins },
  { id: 'village', name: 'Dorfplatz', biomes: ['farm', 'forest', 'desert', 'arctic'], size: [[13, 16], [12, 14]], fn: modVillage },
  { id: 'industrial', name: 'Industriegebiet', biomes: ['farm', 'desert', 'arctic'], size: [[13, 16], [11, 13]], fn: modIndustrial },
  { id: 'construction', name: 'Baustelle', biomes: ['farm', 'desert', 'forest'], size: [[11, 14], [10, 12]], fn: modConstruction },
  { id: 'reststop', name: 'Rastplatz', biomes: ['farm', 'desert', 'forest', 'arctic'], size: [[12, 15], [9, 11]], fn: modReststop },
  { id: 'powerline', name: 'Stromtrasse', biomes: ['farm', 'forest', 'desert', 'arctic'], kind: 'line', fn: modPowerline },
];
export const MAP_MODULES = MODULES.map(({ id, name, biomes }) => ({ id, name, biomes }));
