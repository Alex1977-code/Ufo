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
};

export function generateMap({ biome, ufoType, kind, night }) {
  const sizes = { scout: 30, fighter: 34, freighter: 38, battleship: 42 };
  let W = kind === 'terror' ? 36 : kind === 'hive' ? 36 : sizes[ufoType] || 32;
  const H = W;
  const cells = Array.from({ length: W * H }, () => ({ floor: 'grass', wall: null }));
  const map = { W, H, biome, night, kind, cells, lz: [], playerSpawns: [], alienSpawns: [], civSpawns: [], ufo: null, props: [], lights: [] };
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
  const reach = floodReach(map);
  const lzc = { x: lzx + 2, y: H - 2 };
  const farFromLz = (s) => Math.hypot(s.x - lzc.x, s.y - lzc.y) >= Math.min(16, H * 0.5);
  map.alienSpawns = map.alienSpawns.filter((s) => reach[s.y * W + s.x] && !at(s.x, s.y).wall && farFromLz(s));
  map.civSpawns = map.civSpawns.filter((s) => reach[s.y * W + s.x] && !at(s.x, s.y).wall);
  if (map.alienSpawns.length < 4) {
    const free = [];
    for (let y = 0; y < H * 0.6; y++) for (let x = 0; x < W; x++) if (reach[y * W + x] && !at(x, y).wall && farFromLz({ x, y })) free.push({ x, y });
    shuffle(free); map.alienSpawns.push(...free.slice(0, 12));
  }
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

function building(map, at, setWall, x0, y0, w, h, opts = {}) {
  const mat = opts.mat || 'brick';
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const c = at(x, y); if (!c || c.reserved) return false;
  }
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const c = at(x, y);
    c.floor = opts.floor || 'wood';
    c.wall = null;
    c.indoor = true;
    const edge = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
    if (edge) setWall(x, y, rand() < (opts.windows ?? 0.18) && !(x === x0 || x === x0 + w - 1) !== !(y === y0 || y === y0 + h - 1) ? 'window' : mat);
  }
  // Türen
  const sides = shuffle(['n', 's', 'e', 'w']).slice(0, randInt(1, 3));
  for (const s of sides) {
    if (s === 'n' || s === 's') { const dx = randInt(x0 + 1, x0 + w - 2); const y = s === 'n' ? y0 : y0 + h - 1; at(dx, y).wall = null; if (w > 5 && rand() < 0.5) at(Math.min(dx + 1, x0 + w - 2), y).wall = null; }
    else { const dy = randInt(y0 + 1, y0 + h - 2); const x = s === 'w' ? x0 : x0 + w - 1; at(x, dy).wall = null; }
  }
  // Innenwand
  if (w >= 7 && rand() < 0.7) {
    const ix = randInt(x0 + 3, x0 + w - 4); const door = randInt(y0 + 1, y0 + h - 2);
    for (let y = y0 + 1; y < y0 + h - 1; y++) if (y !== door) setWall(ix, y, mat);
  }
  // Möbel/Kisten
  for (let k = 0; k < Math.floor(w * h / 14); k++) {
    const x = randInt(x0 + 1, x0 + w - 2), y = randInt(y0 + 1, y0 + h - 2);
    if (!at(x, y).wall && rand() < 0.6) setWall(x, y, 'crate');
  }
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
    if (building(map, at, setWall, randInt(1, W - w - 1), randInt(1, H - h - 6), w, h, { mat: mat === 'metal' ? 'brick' : mat, floor: biome === 'desert' ? 'tile' : 'wood' })) k++;
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
  // Innenraum
  if (R >= 4) {
    const r2 = R - 2.2;
    const gaps = shuffle([0, 1, 2, 3]).slice(0, 2);
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
  for (let k = 0; k < R; k++) {
    const a = rand() * Math.PI * 2, r = R - 1.3;
    const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
    const c = at(x, y); if (c && !c.wall && c.ufo && !c.door) setWall(x, y, 'console');
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
      const c = at(x, y); if (c && !c.wall && !c.reserved) { setWall(x, y, 'wreck'); c.floor = 'burnt'; }
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
  const isRoad = (x, y) => roadsX.some((r) => x >= r && x < r + 3) || roadsY.some((r) => y >= r && y < r + 3);
  const isWalk = (x, y) => !isRoad(x, y) && (roadsX.some((r) => x === r - 1 || x === r + 3) || roadsY.some((r) => y === r - 1 || y === r + 3));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = at(x, y);
    if (c.reserved) { c.floor = 'asphalt'; continue; }
    c.floor = isRoad(x, y) ? 'asphalt' : isWalk(x, y) ? 'sidewalk' : 'tile';
  }
  // Gebäude in Blocks
  for (let k = 0, t = 0; k < 9 && t < 120; t++) {
    const w = randInt(5, 10), h = randInt(5, 9);
    const x0 = randInt(0, W - w), y0 = randInt(0, H - h - 5);
    let ok = true;
    for (let y = y0 - 1; y <= y0 + h && ok; y++) for (let x = x0 - 1; x <= x0 + w && ok; x++) { if (isRoad(x, y) || isWalk(x, y) || at(x, y)?.indoor) ok = false; }
    if (ok && building(map, at, setWall, x0, y0, w, h, { mat: 'brick', floor: 'tile', windows: 0.35 })) k++;
  }
  // Autos & Barrieren
  for (let k = 0; k < 16; k++) {
    const x = randInt(0, W - 1), y = randInt(0, H - 1), c = at(x, y);
    if (c && !c.wall && !c.reserved && c.floor === 'asphalt') setWall(x, y, rand() < 0.7 ? 'car' : 'barrier');
  }
  for (let k = 0; k < 8; k++) { const x = randInt(0, W - 1), y = randInt(0, H - 1), c = at(x, y); if (c && !c.wall && !c.reserved && c.floor === 'tile' && !c.indoor) setWall(x, y, 'tree'); }
  // Straßenlaternen
  for (let i = 0; i < 4; i++) { const r = roadsX[i % roadsX.length]; if (r != null) map.lights.push({ x: r - 1, y: randInt(2, H - 10), color: 0xffc27a, intensity: 18, h: 4, lamp: true }); }
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
  while (y > by) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) grid[yy * W + xx] = 0; }
    if (rand() < 0.6) y--; else x = Math.max(2, Math.min(W - 3, x + (x < bx ? 1 : -1) * (rand() < 0.7 ? 1 : -1)));
  }
  for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
    const c = at(xx, yy); c.floor = 'hive';
    if (grid[yy * W + xx] && !c.reserved) setWall(xx, yy, 'hivewall');
  }
  for (let k = 0; k < 26; k++) { const px = randInt(1, W - 2), py = randInt(1, H - 7), c = at(px, py); if (!c.wall && !c.reserved && Math.hypot(px - bx, py - by) > 2) setWall(px, py, 'pod'); }
  map.boss = { x: bx, y: by };
  for (let k = 0; k < 60; k++) map.alienSpawns.push({ x: randInt(0, W - 1), y: randInt(0, Math.floor(H * 0.7)) });
  map.lights.push({ x: bx, y: by, color: 0xc04dff, intensity: 60, h: 3 });
}
