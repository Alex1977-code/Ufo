import test from 'node:test';
import assert from 'node:assert';
import { availableCount, setEquip, applyTemplate, clampBelts, beltTotals, canEquip } from '../../js/equip.js';

const mk = (n) => ({ id: n, weapon: 'rifle', armor: 'none', items: [null, null, null] });

test('Waffenbestand', () => {
  const a = mk('a'), b = mk('b'), all = [a, b];
  const stock = { sniper: 1 };
  assert.equal(availableCount('rifle', all, a, stock, 'weapon'), Infinity);
  assert.equal(availableCount('sniper', all, a, stock, 'weapon'), 1);
  assert(setEquip(a, 'weapon', 'sniper', all, stock));
  assert.equal(availableCount('sniper', all, b, stock, 'weapon'), 0);
  assert(!setEquip(b, 'weapon', 'sniper', all, stock));
  assert(!canEquip('sniper', all, b, stock, 'weapon'));
  assert.equal(availableCount('sniper', all, a, stock, 'weapon'), 1);
  assert.equal(availableCount('sniper', all, b, { sniper: 0 }, 'weapon', -1, true), Infinity);
});

test('Gürtel und Vorlage', () => {
  const a = mk('a'), b = mk('b'), c = mk('c'), all = [a, b, c];
  const stock = { sniper: 1, frag: 2, smoke: 1 };
  assert(setEquip(a, 'weapon', 'sniper', all, stock));
  assert(setEquip(a, 'items', 'frag', all, stock, 0));
  assert(setEquip(a, 'items', 'frag', all, stock, 1));
  assert(!setEquip(b, 'items', 'frag', all, stock, 0));
  assert(setEquip(a, 'items', null, all, stock, 1));
  assert(setEquip(b, 'items', 'frag', all, stock, 0));
  assert(setEquip(b, 'items', 'smoke', all, stock, 1));
  assert(!setEquip(c, 'items', 'smoke', all, stock, 0));
  applyTemplate(a, all, all, stock);
  assert.equal(b.weapon, 'rifle'); assert.equal(c.weapon, 'rifle');
  const t = beltTotals(all);
  assert(t.frag <= 2 && (t.smoke || 0) <= 1, JSON.stringify(t));
});

test('clampBelts begrenzt auf Bestand', () => {
  const b = mk('b'); b.items = ['frag', 'frag', 'frag'];
  clampBelts([b], { frag: 2 });
  assert.equal(b.items.filter(Boolean).length, 2);
});
