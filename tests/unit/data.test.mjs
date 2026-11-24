import test from 'node:test';
import assert from 'node:assert';
import * as D from '../../js/data.js';

test('Forschung: needs/after verweisen auf Existierendes', () => {
  const ids = new Set(D.RESEARCH.map((r) => r.id));
  assert.equal(ids.size, D.RESEARCH.length, 'doppelte IDs');
  for (const r of D.RESEARCH) {
    assert(r.name && r.cost > 0, r.id);
    for (const t of r.after || []) assert(ids.has(t), `${r.id}.after ${t}`);
    for (const a of r.needs || []) assert(typeof a === 'string' && a.length, `${r.id}.needs`);
  }
  for (const a of Object.values(D.ALIENS)) assert(a.corpse, 'corpse');
});

test('Forschung: after-Abhängigkeiten zyklenfrei', () => {
  const by = Object.fromEntries(D.RESEARCH.map((r) => [r.id, r]));
  const visit = (id, path) => {
    assert(!path.includes(id), 'Zyklus: ' + [...path, id].join('>'));
    for (const t of by[id].after || []) visit(t, [...path, id]);
  };
  D.RESEARCH.forEach((r) => visit(r.id, []));
});

test('Aliens: Waffen und UFO-Besatzungen existieren', () => {
  for (const [id, a] of Object.entries(D.ALIENS)) {
    assert(D.WEAPONS[a.weapon], `${id}: Waffe ${a.weapon}`);
    assert(a.hp > 0 && a.tu > 0, id);
  }
  for (const [id, u] of Object.entries(D.UFOS)) for (const a of u.roster) assert(D.ALIENS[a], `${id}: ${a}`);
});

test('Ausrüstung vollständig', () => {
  const ids = new Set(D.RESEARCH.map((r) => r.id));
  for (const [id, w] of Object.entries(D.WEAPONS)) {
    assert(w.name && w.dmg > 0 && w.range > 0 && w.snap, `Waffe ${id}`);
    if (w.req) assert(ids.has(w.req), `Waffe ${id} req ${w.req}`);
  }
  for (const [id, it] of Object.entries(D.ITEMS)) {
    assert(it.name && it.short && it.kind && it.cost > 0, `Item ${id}`);
    if (it.req) assert(ids.has(it.req), `Item ${id} req`);
  }
  for (const [id, a] of Object.entries(D.ARMORS)) {
    assert(a.name && typeof a.armor === 'number', `Rüstung ${id}`);
    if (a.req) assert(ids.has(a.req), `Rüstung ${id} req`);
  }
  for (const [id, c] of Object.entries(D.CRAFTS)) if (c.req) assert(ids.has(c.req), `Craft ${id}`);
  assert(D.BELT_SLOTS >= 1);
  assert.equal(D.RANKS.length, D.RANK_XP.length);
});
