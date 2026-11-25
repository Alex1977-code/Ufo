// T6-Befunde F4, F5, F11, F14 (ohne Browser): Fahrzeugreihen, Erreichbarkeit, Kill-Zählung nach Missionsende, Schutt zerstörter Reihenfelder
import test from 'node:test';
import assert from 'node:assert';
import { generateMap, WALLS, nearRow, rowCutCells } from '../../js/tacmap.js';
import { recordKill, wreckRowCell, clearRowWreck } from '../../js/tacrules.js';
import { setSeed } from '../../js/util.js';

const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const rowsOf = (m) => {
  const g = new Map();
  for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) { const w = m.at(x, y).wall; if (w?.vid != null) (g.get(w.vid) || g.set(w.vid, []).get(w.vid)).push({ x, y, w }); }
  return [...g.values()];
};
const CASES = [['urban', 'terror'], ['farm', 'crash'], ['desert', 'landed'], ['forest', 'landed'], ['arctic', 'landed'], ['farm', 'landed'], ['desert', 'crash']];
const maps = [];
for (const [biome, kind] of CASES) for (let s = 1; s <= (biome === 'urban' ? 60 : 18); s++) {
  setSeed(5000 + s * 31 + biome.length * 7);
  maps.push(generateMap({ biome, ufoType: kind === 'terror' ? null : 'fighter', kind, night: false }));
}

test('F4: neben langen Fahrzeugen keine Hindernisse, Deko oder Laternen (Modell ragt quer ≈ 0,3 m hinaus)', () => {
  let rows = 0;
  const bad = [];
  for (const m of maps) for (const cells of rowsOf(m)) {
    rows++;
    const vid = cells[0].w.vid, own = new Set(cells.map((c) => c.y * m.W + c.x));
    for (const c of cells) {
      for (const [dx, dy] of D8) {
        const n = m.at(c.x + dx, c.y + dy);
        if (n && !own.has((c.y + dy) * m.W + c.x + dx) && n.wall) bad.push(`${m.biome} Wand ${n.wall.type} neben Reihe ${vid}`);
      }
      for (const d of m.deco) if (Math.abs(d.x - c.x) <= 1 && Math.abs(d.y - c.y) <= 1) bad.push(`${m.biome} Deko ${d.t} neben Reihe ${vid}`);
      for (const l of m.lights) if (l.lamp && Math.abs(l.x - c.x) <= 1 && Math.abs(l.y - c.y) <= 1) bad.push(`${m.biome} Laterne neben Reihe ${vid}`);
    }
  }
  assert(rows > 40, `zu wenige Reihen geprüft: ${rows}`);
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} Überschneidungen`);
});

test('F4: nearRow erkennt Nachbarfelder (auch diagonal)', () => {
  const m = maps.find((mm) => rowsOf(mm).length);
  const c = rowsOf(m)[0][0];
  const free = D8.map(([dx, dy]) => [c.x + dx, c.y + dy]).find(([x, y]) => m.at(x, y) && m.at(x, y).wall?.vid == null);
  assert(free, 'freies Nachbarfeld');
  assert.equal(nearRow(m, free[0], free[1]), true);
});

test('F5: keine Fahrzeugreihe schneidet begehbare Felder von der Landezone ab', () => {
  let withRows = 0;
  for (const m of maps) {
    if (!rowsOf(m).length) continue;
    withRows++;
    // unabhängige Flutfüllung (8 Richtungen, keine Ecken schneiden) mit und ohne Reihen
    const flood = (ignoreRows) => {
      const blocked = (x, y) => { const c = m.at(x, y); return !c || (!!c.wall && WALLS[c.wall.type].move && !(ignoreRows && c.wall.vid != null)); };
      const seen = new Uint8Array(m.W * m.H), q = m.lz.map((p) => [p.x, p.y]);
      for (const [x, y] of q) seen[y * m.W + x] = 1;
      while (q.length) {
        const [x, y] = q.pop();
        for (const [dx, dy] of D8) {
          const nx = x + dx, ny = y + dy;
          if (blocked(nx, ny) || seen[ny * m.W + nx]) continue;
          if (dx && dy && (blocked(x + dx, y) || blocked(x, y + dy))) continue;
          seen[ny * m.W + nx] = 1; q.push([nx, ny]);
        }
      }
      return seen;
    };
    const a = flood(false), b = flood(true);
    let lost = 0;
    for (let i = 0; i < a.length; i++) if (b[i] && !a[i] && m.cells[i].wall?.vid == null) lost++;
    assert.equal(lost, 0, `${m.biome}/${m.kind}: ${lost} Felder abgeschnitten`);
    assert.equal(rowCutCells(m).length, 0);
  }
  assert(withRows > 20, `zu wenige Karten mit Reihen: ${withRows}`);
});

test('F11: kill() nach Missionsende zählt keine Kills, Leichen oder Zivilopfer mehr', () => {
  const result = { kills: {}, corpses: [], civKilled: 0 };
  const sol = { team: 'player', kills: 0 };
  const a1 = { team: 'alien', spec: 'vael', x: 1, y: 2 }, a2 = { team: 'alien', spec: 'hive', x: 3, y: 4 };
  const civ = { team: 'civ', x: 0, y: 0 };
  assert.equal(recordKill(result, a1, sol, false), true);
  assert.equal(sol.kills, 1); assert.deepEqual(result.kills, { vael: 1 }); assert.equal(result.corpses.length, 1);
  // Mission beendet (z. B. Kommandant tot) – weitere Opfer derselben Explosion
  assert.equal(recordKill(result, a2, sol, true), false);
  assert.equal(recordKill(result, civ, sol, true), false);
  assert.equal(sol.kills, 1); assert.deepEqual(result.kills, { vael: 1 }); assert.equal(result.corpses.length, 1); assert.equal(result.civKilled, 0);
  // Zivilist vor Missionsende zählt; Soldat bekommt keinen Kill für Zivilisten
  assert.equal(recordKill(result, civ, sol, false), true);
  assert.equal(result.civKilled, 1); assert.equal(sol.kills, 1);
});

test('F14: zerstörtes Reihenfeld wird Schutt (nicht begehbar, halbe Deckung), frei erst beim Entfernen des Modells', () => {
  const m = maps.find((mm) => rowsOf(mm).some((r) => r.length >= 3));
  const cells = rowsOf(m).find((r) => r.length >= 3), vid = cells[0].w.vid;
  assert(WALLS.wreck.move && !WALLS.wreck.full && WALLS.wreck.cover === 1, 'WALLS.wreck = nicht begehbar, halbe Deckung');
  const [c0, ...rest] = cells;
  const r0 = wreckRowCell(m, c0.x, c0.y);
  assert.deepEqual(r0, { vid, last: false });
  const w0 = m.at(c0.x, c0.y).wall;
  assert.equal(w0.type, 'wreck'); assert.equal(w0.rowWreck, vid); assert.equal(w0.vid, undefined, 'Schutt zählt nicht mehr als Reihe');
  assert.equal(nearRow(m, c0.x, c0.y), true, 'übrige Felder sind noch Reihe');
  for (const c of rest.slice(0, -1)) assert.equal(wreckRowCell(m, c.x, c.y).last, false);
  const rl = wreckRowCell(m, rest.at(-1).x, rest.at(-1).y);
  assert.equal(rl.last, true);
  for (const c of cells) assert.equal(m.at(c.x, c.y).wall?.type, 'wreck', 'alle Felder Schutt, solange das Modell steht');
  assert.equal(wreckRowCell(m, c0.x, c0.y), null, 'Schutt ist kein Reihenfeld mehr');
  assert.equal(clearRowWreck(m, vid), cells.length);
  for (const c of cells) assert.equal(m.at(c.x, c.y).wall, null);
});
