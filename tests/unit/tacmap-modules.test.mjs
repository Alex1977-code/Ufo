import test from 'node:test';
import assert from 'node:assert';
import { generateMap, WALLS, MAP_MODULES, VEHICLE_ROWS } from '../../js/tacmap.js';
import { setSeed } from '../../js/util.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const blocked = (m, i) => { const w = m.cells[i].wall; return !!(w && WALLS[w.type].move); };
function reach(m, starts = m.playerSpawns) {
  const seen = new Uint8Array(m.W * m.H);
  const q = starts.map((p) => p.y * m.W + p.x);
  q.forEach((i) => (seen[i] = 1));
  while (q.length) {
    const i = q.pop(), x = i % m.W, y = (i / m.W) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.W || ny >= m.H) continue;
      const j = ny * m.W + nx;
      if (seen[j] || blocked(m, j)) continue;
      seen[j] = 1; q.push(j);
    }
  }
  return seen;
}
const near = (r, m, x, y) => [[0, 0], ...DIRS].some(([dx, dy]) => x + dx >= 0 && y + dy >= 0 && x + dx < m.W && y + dy < m.H && r[(y + dy) * m.W + x + dx]);

const BIOMES = ['farm', 'forest', 'desert', 'arctic'];
const SEEDS = 150;
const UFOS = ['scout', 'fighter', 'freighter', 'battleship'];
const KINDS = ['crash', 'landed'];
const seen = { modules: new Map(), walls: new Set(), floors: new Set(), sites: new Set() };
let genMs = 0, genN = 0;

for (const biome of BIOMES) {
  test(`Module ${biome}: ${SEEDS} Seeds, Invarianten`, () => {
    const fails = [];
    for (let s = 1; s <= SEEDS; s++) {
      const kind = KINDS[s % 2], ufoType = UFOS[s % 4];
      setSeed(s * 104729 + biome.length);
      const t0 = performance.now();
      const m = generateMap({ biome, ufoType, kind, night: s % 3 === 0 });
      genMs += performance.now() - t0; genN++;
      const tag = `${biome}/${kind}/${ufoType} seed ${s}`;
      const bad = (msg) => fails.length < 15 && fails.push(`${tag}: ${msg}`);
      assert(Array.isArray(m.modules), 'map.modules fehlt');
      for (const mod of m.modules) seen.modules.set(mod.id, (seen.modules.get(mod.id) || 0) + 1);
      if (m.ufo?.site) seen.sites.add(m.ufo.site);
      for (const c of m.cells) { if (c.wall) seen.walls.add(c.wall.type); if (c.floor) seen.floors.add(c.floor); }
      for (const p of m.props || []) if (p?.type) seen.walls.add(p.type);
      for (const p of m.playerSpawns) { const c = m.at(p.x, p.y); if (!c || blocked(m, p.y * m.W + p.x)) bad('Spawn blockiert'); }
      const r = reach(m);
      if (m.playerSpawns.some((p) => !r[p.y * m.W + p.x])) bad('Spawn nicht erreichbar');
      if (m.ufo) { const d = m.ufo.door; if (!(d && near(r, m, d.x, d.y))) bad('UFO-Tür unerreichbar'); }
      if (m.ufo?.site === 'pond') assert(m.ufo.pond && m.ufo.pond.r > 0, 'pond ohne map.ufo.pond');
      if (m.alienSpawns.length < 12) bad(`nur ${m.alienSpawns.length} Alien-Spawns`);
      const lx = m.lz.reduce((a, p) => a + p.x, 0) / m.lz.length, ly = m.lz.reduce((a, p) => a + p.y, 0) / m.lz.length;
      const minD = Math.min(16, m.H * 0.5) - 1;
      let nr = 0, nf = 0;
      for (const a of m.alienSpawns) { if (!near(r, m, a.x, a.y) && !m.at(a.x, a.y)?.ufo) nr++; if (Math.hypot(a.x - lx, a.y - ly) < minD && !a.inUfo) nf++; }
      if (nr) bad(`${nr} Alien-Spawns unerreichbar`);
      if (nf) bad(`${nf} Alien-Spawns zu nah an der Landezone`);
      for (const c of m.civSpawns || []) if (!near(r, m, c.x, c.y)) { bad('Zivilist unerreichbar'); break; }
      // Wasser: nie begehbar/zerstörbar-Eintrag, Brücke/Furt verbindet Flüsse
      const water = m.cells.filter((c) => c.wall?.type === 'water');
      if (water.length) {
        for (const c of water) if (!WALLS.water.indestructible) { bad('water nicht indestructible'); break; }
        if (m.modules.some((x) => /river|mill|muehle|steg/i.test(x.id))) {
          let pass = 0, un = 0;
          m.cells.forEach((c, i) => { if (!blocked(m, i) && !c.indoor) { pass++; if (!r[i]) un++; } });
          if (un > pass * 0.08) bad(`Fluss trennt Karte: ${un}/${pass} Außenfelder unerreichbar (Brücke/Furt fehlt?)`);
        }
      }
    }
    assert.equal(fails.length, 0, fails.join('\n'));
  });
}

for (const [kind, biome] of [['terror', 'urban'], ['hive', 'hive']]) {
  test(`Karte ${kind}/${biome}: Invarianten (60 Seeds)`, () => {
    for (let s = 1; s <= 60; s++) {
      setSeed(s * 7907);
      const t0 = performance.now();
      const m = generateMap({ biome, kind, ufoType: null, night: s % 2 === 0 });
      genMs += performance.now() - t0; genN++;
      const r = reach(m);
      assert(m.playerSpawns.every((p) => r[p.y * m.W + p.x] && !blocked(m, p.y * m.W + p.x)), `seed ${s}: Spawns`);
      assert(m.alienSpawns.length >= 12, `seed ${s}: ${m.alienSpawns.length} Alien-Spawns`);
      if (kind === 'hive') { assert(m.boss && near(r, m, m.boss.x, m.boss.y), `seed ${s}: Boss unerreichbar`); }
      for (const c of m.civSpawns || []) assert(near(r, m, c.x, c.y), `seed ${s}: Zivilist unerreichbar`);
      for (const c of m.cells) if (c.wall) seen.walls.add(c.wall.type);
      if (kind === 'terror') {
        // Straßen-/Platzobjekte müssen echte Deckung sein (nicht nur Dekoration)
        const cover = m.cells.filter((c) => c.wall && !c.indoor && c.bld == null && (WALLS[c.wall.type].full || WALLS[c.wall.type].cover)).length;
        assert(cover >= 35, `seed ${s}: nur ${cover} Deckungsobjekte im Freien`);
        const kinds = new Set(m.cells.filter((c) => c.wall && c.bld == null).map((c) => c.wall.type));
        assert(kinds.size >= 7, `seed ${s}: nur ${kinds.size} Deckungsarten`);
      }
    }
  });
}

test('Alle Module aus MAP_MODULES erscheinen', () => {
  assert(MAP_MODULES.length >= 25, `nur ${MAP_MODULES.length} Module`);
  const missing = MAP_MODULES.filter((m) => !seen.modules.has(m.id)).map((m) => m.id);
  assert.deepEqual(missing, [], 'nie erzeugt: ' + missing.join(', '));
  for (const m of MAP_MODULES) assert(m.id && m.name && Array.isArray(m.biomes), 'Modul-Metadaten ' + m.id);
});

test('WALLS: vollständige Felder, water indestructible', () => {
  for (const [k, w] of Object.entries(WALLS)) {
    assert.equal(typeof w.full, 'boolean', `${k}.full`);
    assert.equal(typeof w.move, 'boolean', `${k}.move`);
    assert(Number.isFinite(w.hp) && w.hp > 0, `${k}.hp`);
    assert(Number.isFinite(w.h) && w.h >= 0, `${k}.h`);
    // cover: bei nicht-vollen Wänden zwingend 0..2; volle Wände decken immer (cover optional)
    if (!w.full) assert([0, 1, 2].includes(w.cover), `${k}.cover fehlt/ungültig`);
    else assert(w.cover === undefined || [0, 1, 2].includes(w.cover), `${k}.cover ungültig`);
  }
  assert.equal(WALLS.water.indestructible, true);
  assert.equal(WALLS.water.move, true);
  assert.equal(WALLS.water.full, false);
});

test('Jeder WALLS-Typ kommt in mindestens einer erzeugten Karte vor', () => {
  const unused = Object.keys(WALLS).filter((k) => !seen.walls.has(k));
  assert.deepEqual(unused, [], 'nie verwendet: ' + unused.join(', '));
  for (const f of ['gravel', 'mud', 'plank', 'cobble', 'concretefloor', 'shore', 'crops', 'vineyard', 'graveyard', 'parking', 'ice'])
    assert(seen.floors.has(f), 'Boden nie verwendet: ' + f);
  for (const s of ['plow', 'pond', 'debris', 'crater', 'field', 'plaza']) assert(seen.sites.has(s), 'UFO-Platz nie: ' + s);
});

test('Generierung < 50 ms im Mittel', () => {
  const avg = genMs / genN;
  console.log(`# generateMap Ø ${avg.toFixed(2)} ms über ${genN} Karten`);
  assert(avg < 50, `Ø ${avg.toFixed(1)} ms`);
});

// I1: lange Fahrzeuge als Reihen (Bus ≈ 12 m = 6 Felder, Koffer-LKW 4, Sattelzug 8, Mähdrescher 5 + Schneidwerk)
test('Fahrzeug-Reihen: vollständig, gerade, ein Kopf, keine Türen/Landezone', () => {
  const found = {};
  const jobs = [];
  for (let s = 1; s <= 60; s++) jobs.push(['terror', 'urban', null, s * 7907]);
  for (const b of BIOMES) for (let s = 1; s <= 50; s++) jobs.push([KINDS[s % 2], b, UFOS[s % 4], s * 104729 + b.length]);
  for (const [kind, biome, ufoType, seed] of jobs) {
    setSeed(seed);
    const m = generateMap({ biome, kind, ufoType, night: false });
    const groups = new Map();
    m.cells.forEach((c, i) => { if (c.wall?.vid != null) (groups.get(c.wall.vid) || groups.set(c.wall.vid, []).get(c.wall.vid)).push({ c, x: i % m.W, y: (i / m.W) | 0 }); });
    const lz = new Set(m.lz.map((p) => p.y * m.W + p.x));
    for (const [vid, list] of groups) {
      const tag = `${biome} seed ${seed} vid ${vid}`;
      const w0 = list[0].c.wall;
      assert(list.every((e) => e.c.wall.type === w0.type && e.c.wall.rot === w0.rot && e.c.wall.vlen === w0.vlen), `${tag}: uneinheitlich`);
      assert.equal(list.length, w0.vcells, `${tag}: Felder fehlen`);
      const heads = list.filter((e) => e.c.wall.vhead);
      assert.equal(heads.length, 1, `${tag}: Kopf`);
      const lens = VEHICLE_ROWS[w0.type]?.[w0.hv];
      assert(lens && lens.includes(w0.vlen), `${tag}: Länge ${w0.type}/${w0.hv}/${w0.vlen}`);
      // Reihe: alle Felder entlang der Fahrtrichtung hinter dem Kopf (Mähdrescher: Frontreihe 3 breit)
      const [dx, dy] = [[0, 1], [-1, 0], [0, -1], [1, 0]][w0.rot], h = heads[0];
      for (let k = 0; k < w0.vlen; k++) assert(list.some((e) => e.x === h.x - dx * k && e.y === h.y - dy * k), `${tag}: Reihe unterbrochen`);
      for (const e of list) {
        assert(!lz.has(e.y * m.W + e.x), `${tag}: auf der Landezone`);
        assert(!e.c.indoor && !e.c.door, `${tag}: im Gebäude/Tür`);
        for (const [ex, ey] of DIRS) assert(!m.at(e.x + ex, e.y + ey)?.door, `${tag}: vor einer Tür`);
      }
      found[`${w0.type}:${w0.hv}`] = (found[`${w0.type}:${w0.hv}`] || 0) + 1;
    }
  }
  for (const k of ['bus:city', 'bus:coach', 'truck:box', 'truck:semi', 'car:combine']) assert(found[k] > 0, 'nie erzeugt: ' + k);
  assert(found['bus:city'] + found['bus:coach'] >= 20 && found['truck:box'] >= 20, JSON.stringify(found));
});
