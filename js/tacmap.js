// Prozedurale Schlachtfeld-Generierung für Bodeneinsätze
import { rand, randInt, choice, shuffle } from './util.js';

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
};

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
  const map = { W, H, biome, night, kind, cells, lz: [], playerSpawns: [], alienSpawns: [], civSpawns: [], ufo: null, props: [], lights: [], buildings: [], deco: [], roads: null };
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

  if (biome === 'hive') genHive(map, at, setWall);
  else if (biome === 'urban') genUrban(map, at, setWall);
  else genRural(map, at, setWall, biome);

  if (ufoType && biome !== 'urban' && biome !== 'hive') placeUfo(map, at, setWall, ufoType, kind === 'crash');

  // Erreichbarkeit sicherstellen: alles, was nicht von der Landezone erreichbar ist, wird freigeräumt bzw. Spawns entfernt
  let reach = floodReach(map);
  const lzc = { x: lzx + 2, y: H - 2 };
  // Sicherstellen, dass die UFO-Tür bzw. der Hive-Boss von der Landezone aus erreichbar ist
  const goal = map.ufo ? map.ufo.door : map.boss;
  if (goal && ![[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => reach[(goal.y + dy) * W + goal.x + dx])) {
    // Schneise: von der Tür nach außen bis zum Kartenrand, dann am Rand entlang zur Landezone
    const clear = (x, y) => { const c = at(x, y); if (c?.wall && !c.hull) c.wall = null; };
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
  for (const c of cells) delete c.reserved;
  return map;
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

// Gebäude: Außenwände mit Fenstern, Türen, optionale Innenwand, Möbel an den Wänden.
// Die Bounding-Box landet in map.buildings (Stil, Dachform, Stockwerke, Türen) für Optik/Dächer.
function building(map, at, setWall, x0, y0, w, h, opts = {}) {
  const mat = opts.mat || 'brick';
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const c = at(x, y); if (!c || c.reserved || c.indoor) return false;
  }
  const bi = map.buildings.length;
  const b = { x0, y0, w, h, style: opts.style || mat, roof: opts.roof || 'gable', storeys: opts.storeys || 1, doors: [] };
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const c = at(x, y);
    c.floor = opts.floor || 'wood';
    c.wall = null;
    c.indoor = true;
    c.bld = bi;
    const edge = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
    if (edge) { setWall(x, y, rand() < (opts.windows ?? 0.18) && !(x === x0 || x === x0 + w - 1) !== !(y === y0 || y === y0 + h - 1) ? 'window' : mat); if (c.wall) c.wall.vert = x === x0 || x === x0 + w - 1; }
  }
  // Türen (Lage wird für Türrahmen gemerkt)
  const sides = shuffle(['n', 's', 'e', 'w']).slice(0, randInt(1, 3));
  const door = (x, y, side) => { at(x, y).wall = null; at(x, y).door = true; b.doors.push({ x, y, side }); };
  for (const s of sides) {
    if (s === 'n' || s === 's') { const dx = randInt(x0 + 1, x0 + w - 2); const y = s === 'n' ? y0 : y0 + h - 1; door(dx, y, s); if (w > 5 && rand() < 0.5) { const dx2 = Math.min(dx + 1, x0 + w - 2); if (dx2 !== dx) door(dx2, y, s); } }
    else { const dy = randInt(y0 + 1, y0 + h - 2); const x = s === 'w' ? x0 : x0 + w - 1; door(x, dy, s); }
  }
  // Innenwand
  const keep = new Set();
  for (const d of b.doors) { const n = { n: [0, 1], s: [0, -1], w: [1, 0], e: [-1, 0] }[d.side]; keep.add((d.y + n[1]) * map.W + d.x + n[0]); }
  if (w >= 7 && rand() < 0.7) {
    const ix = randInt(x0 + 3, x0 + w - 4); const dy = randInt(y0 + 1, y0 + h - 2);
    for (let y = y0 + 1; y < y0 + h - 1; y++) if (y !== dy) setWall(ix, y, mat);
    keep.add(dy * map.W + ix - 1); keep.add(dy * map.W + ix + 1);
  }
  // Möbel (Deckung wie Kisten) bevorzugt an den Wänden, Türbereiche bleiben frei
  const cand = [];
  for (let y = y0 + 1; y < y0 + h - 1; y++) for (let x = x0 + 1; x < x0 + w - 1; x++) {
    if (at(x, y).wall || keep.has(y * map.W + x)) continue;
    const nb = [[0, -1, 0], [0, 1, Math.PI], [-1, 0, Math.PI / 2], [1, 0, -Math.PI / 2]].filter(([dx, dy]) => { const t = at(x + dx, y + dy)?.wall?.type; return t && t !== 'crate'; });
    if (nb.length) cand.push({ x, y, rot: choice(nb)[2] });
  }
  shuffle(cand);
  let nf = Math.max(1, Math.floor(w * h / 13));
  for (const p of cand) {
    if (nf <= 0) break;
    let near = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (at(p.x + dx, p.y + dy)?.wall?.type === 'crate') near = true;
    if (near || rand() < 0.25) continue;
    setWall(p.x, p.y, 'crate'); at(p.x, p.y).wall.furn = true; at(p.x, p.y).wall.rot = p.rot; nf--;
  }
  map.buildings.push(b);
  return true;
}

function genRural(map, at, setWall, biome) {
  const { W, H } = map;
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
  // Gebäude
  const nb = { farm: randInt(2, 4), forest: randInt(0, 2), desert: randInt(2, 3), arctic: randInt(1, 2) }[biome];
  const mat = { farm: choice(['brick', 'wood']), forest: 'wood', desert: 'brick', arctic: 'metal' }[biome];
  for (let k = 0, tries = 0; k < nb && tries < 60; tries++) {
    const w = randInt(5, 9), h = randInt(5, 8);
    // Fassadenstil je Biom: Bauernhof Ziegel/Putz bzw. Holzscheune, Wald Blockhaus, Wüste Lehm (Flachdach), Arktis Fertigbau
    const m2 = biome === 'farm' && k > 0 ? choice(['brick', 'wood']) : mat;
    const style = { farm: m2 === 'wood' ? 'wood' : choice(['brick', 'plaster']), forest: 'log', desert: 'adobe', arctic: 'prefab' }[biome];
    if (building(map, at, setWall, randInt(1, W - w - 1), randInt(1, H - h - 6), w, h, { mat: m2 === 'metal' ? 'brick' : m2, style, roof: biome === 'desert' ? 'flat' : 'gable', floor: biome === 'desert' ? 'tile' : 'wood' })) k++;
  }
  // Zäune / Hecken
  const fenceN = biome === 'farm' ? randInt(4, 7) : biome === 'forest' ? 2 : 1;
  for (let k = 0; k < fenceN; k++) {
    const horiz = rand() < 0.5; let x = randInt(2, W - 3), y = randInt(2, H - 6); const len = randInt(4, 11);
    const t = biome === 'farm' ? choice(['fence', 'hedge']) : biome === 'desert' ? 'rock' : 'fence';
    for (let i = 0; i < len; i++) {
      const c = at(x, y); if (!c) break;
      if (!c.wall && !c.indoor && rand() > 0.12) setWall(x, y, t);
      if (horiz) x++; else y++;
    }
  }
  // Bäume / Felsen
  const treeN = { farm: 25, forest: 140, desert: 4, arctic: 30 }[biome];
  const treeT = biome === 'arctic' ? 'pine' : biome === 'forest' ? null : 'tree';
  for (let k = 0; k < treeN; k++) {
    const x = randInt(0, W - 1), y = randInt(0, H - 1), c = at(x, y);
    if (!c.wall && !c.indoor && !c.reserved) setWall(x, y, treeT || (rand() < 0.45 ? 'pine' : 'tree'));
  }
  const rockN = { farm: 6, forest: 14, desert: 40, arctic: 25 }[biome];
  for (let k = 0; k < rockN; k++) {
    const x = randInt(0, W - 1), y = randInt(0, H - 1), c = at(x, y);
    if (!c.wall && !c.indoor && !c.reserved) setWall(x, y, rand() < 0.25 ? 'bigrock' : 'rock');
  }
  if (biome === 'farm') for (let k = 0; k < 10; k++) { const x = randInt(0, W - 1), y = randInt(0, H - 1), c = at(x, y); if (!c.wall && !c.indoor && !c.reserved) setWall(x, y, 'hay'); }
  // Fahrzeuge (Deckung wie Autos): Traktor auf dem Feld, Pick-up am Haus
  const vehicles = biome === 'farm' ? ['tractor', 'pickup'] : biome === 'forest' ? ['pickup'] : biome === 'desert' ? ['pickup', 'burnt'] : ['suv'];
  for (const v of vehicles) for (let t = 0; t < 40; t++) {
    const x = randInt(1, W - 2), y = randInt(1, H - 7), c = at(x, y);
    if (!freeOut(at, x, y) || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(x + dx, y + dy)?.wall)) continue;
    setWall(x, y, 'car'); c.wall.variant = v; c.wall.vert = rand() < 0.5; break;
  }
  // umgestürzte Baumstämme im Wald (halbe Deckung)
  if (biome === 'forest') for (let k = 0; k < 9; k++) { const x = randInt(0, W - 1), y = randInt(0, H - 7); if (freeOut(at, x, y)) { setWall(x, y, 'log'); at(x, y).wall.vert = rand() < 0.5; } }
  // Deko je Biom (ohne Kollision)
  const decoN = { farm: { flowers: 26, mailbox: 2, bush: 10 }, forest: { bush: 45, fern: 60, mushroom: 30, stump: 10 }, desert: { cactus: 20, drybush: 30, bones: 4 }, arctic: { drift: 30, ice: 18 } }[biome] || {};
  for (const [t, n] of Object.entries(decoN)) for (let k = 0; k < n; k++) {
    const x = randInt(0, W - 1), y = randInt(0, H - 1);
    if (!freeOut(at, x, y)) continue;
    if (t === 'flowers') { // Blumen bevorzugt an Hauswänden
      const b = map.buildings.length ? choice(map.buildings) : null;
      if (b) { const side = randInt(0, 3); const fx = side < 2 ? randInt(b.x0, b.x0 + b.w - 1) : side === 2 ? b.x0 - 1 : b.x0 + b.w; const fy = side >= 2 ? randInt(b.y0, b.y0 + b.h - 1) : side === 0 ? b.y0 - 1 : b.y0 + b.h; if (freeOut(at, fx, fy)) deco(map, t, fx, fy); continue; }
    }
    if (t === 'mailbox') { const b = map.buildings[k % Math.max(1, map.buildings.length)]; if (b) { const d = b.doors[0]; if (d) { const n = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }[d.side]; const mx = d.x + n[0] * 2 + n[1], my = d.y + n[1] * 2 + n[0]; if (freeOut(at, mx, my)) deco(map, t, mx, my, { s: 1, rot: Math.atan2(-n[0], -n[1]) }); } } continue; }
    deco(map, t, x, y, t === 'cactus' ? { ox: (rand() < 0.5 ? -1 : 1) * 0.6, oz: (rand() < 0.5 ? -1 : 1) * 0.6 } : {});
  }
  // Alien-Spawns verstreut im Norden
  for (let k = 0; k < 30; k++) map.alienSpawns.push({ x: randInt(0, W - 1), y: randInt(0, Math.floor(H * 0.55)) });
}

function placeUfo(map, at, setWall, type, crashed) {
  const { W, H } = map;
  const R = { scout: 3, fighter: 4, freighter: 5, battleship: 6 }[type];
  const cx = randInt(R + 3, W - R - 4), cy = randInt(R + 3, Math.floor(H * 0.5));
  map.ufo = { cx, cy, r: R, type, crashed };
  // Fläche räumen
  for (let y = cy - R - 2; y <= cy + R + 2; y++) for (let x = cx - R - 2; x <= cx + R + 2; x++) {
    const c = at(x, y); if (!c) continue;
    const d = Math.hypot(x - cx, y - cy);
    if (d <= R + 1.6) { c.wall = null; c.indoor = false; if (crashed && d > R + 0.5) c.floor = 'burnt'; }
  }
  const doorDir = choice([[0, 1], [1, 0], [-1, 0], [0, -1]]);
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
    for (let k = 0; k < R * 3; k++) {
      const a = rand() * Math.PI * 2, r = R + 1 + rand() * 4;
      const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
      const c = at(x, y); if (c && !c.wall && !c.reserved && !c.door) { setWall(x, y, 'wreck'); c.floor = 'burnt'; }
    }
  }
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
  for (const r of roadsX) for (const x of [r, r + 2]) for (let y = 0; y < H; y++) if (!inRY(y)) lanes.push({ x, y, vert: true });
  for (const r of roadsY) for (const y of [r, r + 2]) for (let x = 0; x < W; x++) if (!inRX(x)) lanes.push({ x, y, vert: false });
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
