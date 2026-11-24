import test from 'node:test';
import assert from 'node:assert';
import { generateMap, WALLS } from '../../js/tacmap.js';
import { setSeed } from '../../js/util.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function reach(m) {
  const seen = new Uint8Array(m.W * m.H);
  const q = m.playerSpawns.map((p) => p.y * m.W + p.x);
  q.forEach((i) => (seen[i] = 1));
  while (q.length) {
    const i = q.pop(), x = i % m.W, y = (i / m.W) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.W || ny >= m.H) continue;
      const j = ny * m.W + nx;
      if (seen[j]) continue;
      const w = m.cells[j].wall;
      if (w && WALLS[w.type].move) continue;
      seen[j] = 1; q.push(j);
    }
  }
  return seen;
}
const near = (r, m, x, y) => [[0, 0], ...DIRS].some(([dx, dy]) => r[(y + dy) * m.W + x + dx]);

const CASES = [
  ['crash', 'farm', 'scout'], ['crash', 'arctic', 'freighter'], ['crash', 'desert', 'fighter'],
  ['landed', 'forest', 'fighter'], ['landed', 'desert', 'battleship'], ['landed', 'farm', 'scout'],
  ['hive', 'hive', null], ['terror', 'urban', null],
];

for (const [kind, biome, ufoType] of CASES) {
  test(`Karte ${kind}/${biome}/${ufoType}: 200 Seeds`, () => {
    for (let seed = 1; seed <= 200; seed++) {
      setSeed(seed * 7919);
      const m = generateMap({ biome, ufoType, kind, night: seed % 2 === 0 });
      const r = reach(m);
      const tag = `seed ${seed}`;
      assert(m.playerSpawns.length >= 6, `${tag}: Spieler-Spawns`);
      for (const p of m.playerSpawns) {
        const c = m.at(p.x, p.y);
        assert(c, `${tag}: Spawn außerhalb`);
        assert(!(c.wall && WALLS[c.wall.type].move), `${tag}: Spawn blockiert`);
        assert(r[p.y * m.W + p.x], `${tag}: Spawn nicht erreichbar`);
      }
      if (m.ufo) {
        const d = m.ufo.door;
        assert(d && near(r, m, d.x, d.y), `${tag}: UFO-Tür unerreichbar`);
      }
      if (kind === 'hive') {
        assert(m.boss, `${tag}: kein Boss`);
        assert(near(r, m, m.boss.x, m.boss.y), `${tag}: Boss unerreichbar`);
      }
      assert(m.alienSpawns.length >= (kind === 'terror' ? 6 : 8), `${tag}: nur ${m.alienSpawns.length} Alien-Spawns`);
      for (const a of m.alienSpawns) assert(m.at(a.x, a.y), `${tag}: Alien-Spawn außerhalb`);
    }
  });
}
