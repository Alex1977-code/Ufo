// W3: Waffen/Munition in der Kampagne – Migration, Kauf, Gürtel mit Ersatzmagazinen, Forschungsbaum
import test from 'node:test';
import assert from 'node:assert';
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { Game, createCampaign, migrateCampaign, newSoldier } = await import('../../js/game.js');
const { WEAPONS, ITEMS, ARMORS, ALIENS, RESEARCH, CRAFTS, BELT_SLOTS, ammoFits, ammoList, defaultLoad } = await import('../../js/data.js');
const { availableCount, setEquip, clampBelts, applyTemplate, beltTotals, pickLoad, itemEffect, weaponDesc } = await import('../../js/equip.js');

const mk = (over = {}) => ({ id: 'x' + Math.random(), weapon: 'rifle', load: 'mag', armor: 'none', items: ['frag', 'mag', 'mag'], ...over });

test('Neue Kampagne: Gewehr + 2 Ersatzmagazine + Granate', () => {
  const c = createCampaign();
  assert.equal(c.v, 3);
  for (const s of c.soldiers) {
    assert.equal(s.weapon, 'rifle'); assert.equal(s.load, 'mag');
    assert.equal(s.items.length, BELT_SLOTS);
    assert.equal(s.items.filter((i) => i === 'mag').length, 2);
    assert(s.items.includes('frag'));
  }
  assert.equal(newSoldier().load, 'mag');
});

test('Migration v1: Ladung, Ersatzmagazine, Startvorrat', () => {
  const c = { soldiers: [{ weapon: 'laser', items: ['frag', 'smoke', null] }, { weapon: 'plasma', items: ['frag', null, null] }, { weapon: 'rifle', grenades: 2 }, { weapon: 'gibtsnicht', items: ['frag', 'xxx', null] }], researched: ['plasma'], stock: { plasma: 2, frag: 3 } };
  migrateCampaign(c);
  assert.equal(c.v, 3);
  const [laser, plasma, rifle, odd] = c.soldiers;
  assert.equal(laser.load, null);                               // Laser braucht keine Munition
  assert.deepEqual(laser.items, ['frag', 'smoke', null]);       // und bekommt keine Magazine
  assert.equal(plasma.load, 'pz_cell');
  assert.equal(plasma.items.filter((i) => i === 'mag').length, 0); // Standardmagazin passt nicht zu Plasma
  assert.equal(rifle.load, 'mag');
  assert.deepEqual(rifle.items, ['frag', 'frag', 'mag']);       // freier Platz bekommt ein Magazin
  assert.equal(odd.weapon, 'rifle');
  assert(!odd.items.includes('xxx'));
  assert(odd.items.includes('mag'));
  assert(c.stock.pz_cell >= 6);                                 // Plasma-Besitzer: Startvorrat an Zellen
  assert.equal(c.stock.pistol, 2); assert.equal(c.stock.charge, 2); assert.equal(c.stock.stunrod, 1);
  assert.equal(c.stock.frag, 3);                                // vorhandene Bestände bleiben
  const snap = JSON.stringify(c); migrateCampaign(c);
  assert.equal(JSON.stringify(c), snap, 'idempotent');
});

test('Migration v2: Magazine werden nachgerüstet, falsche Ladung korrigiert', () => {
  const c = createCampaign(); c.v = 2;
  c.soldiers[0].items = ['frag', null, null];
  c.soldiers[1].weapon = 'cannon'; c.soldiers[1].load = 'pz_cell'; c.soldiers[1].items = ['rk_light', 'mag', null];
  c.stock.altlast = 5; c.stock.frag = -1;
  migrateCampaign(c);
  assert.deepEqual(c.soldiers[0].items, ['frag', 'mag', 'mag']);
  assert.equal(c.soldiers[1].load, 'mag');
  assert(!c.soldiers[1].items.includes('rk_light'));            // passt nicht zur Kanone
  assert.equal(c.stock.altlast, undefined); assert.equal(c.stock.frag, undefined);
  assert.equal(c.v, 3);
});

test('Gürtel: Standardmagazin ist unbegrenzt und wird nie entfernt', () => {
  const a = mk({ items: [null, null, null] }), b = mk({ items: [null, null, null] }), sq = [a, b];
  assert.equal(availableCount('mag', sq, a, {}, 'items', 0), Infinity);
  assert(setEquip(a, 'items', 'mag', sq, {}, 0)); assert(setEquip(a, 'items', 'mag', sq, {}, 1)); assert(setEquip(b, 'items', 'mag', sq, {}, 0));
  assert.deepEqual(a.items, ['mag', 'mag', null]);
  clampBelts(sq, {});                                           // Lager ganz leer
  assert.deepEqual(a.items, ['mag', 'mag', null]); assert.equal(b.items[0], 'mag');
  assert.deepEqual(beltTotals(sq), {});                         // gratis Magazine zählen nicht als Verbrauch
  assert.equal(availableCount('mag', sq, a, {}, 'items', 0, false), Infinity);
});

test('Munition passt nur zur Waffe; Ladung und Gürtel zählen gemeinsam', () => {
  const a = mk({ weapon: 'rocket', load: 'rk_light', items: [null, null, null] }), b = mk({ weapon: 'rocket', load: 'rk_light', items: [null, null, null] }), sq = [a, b];
  const stock = { rk_light: 3, rk_heavy: 1 };
  assert(!setEquip(a, 'items', 'mag', sq, stock, 0));           // Standardmagazin passt nicht zum Werfer
  assert(!setEquip(a, 'items', 'pz_cell', sq, { pz_cell: 9 }, 0));
  assert.equal(availableCount('rk_light', sq, a, stock, 'items', 0), 1);  // 3 − Ladung b − Ladung a
  assert(setEquip(a, 'items', 'rk_light', sq, stock, 0));
  assert(!setEquip(b, 'items', 'rk_light', sq, stock, 0));      // der letzte Stück liegt schon bei a
  assert.equal(availableCount('rk_light', sq, a, stock, 'items', 1), 0);
  assert(!setEquip(a, 'items', 'rk_light', sq, stock, 1));      // Bestand erschöpft
  assert(setEquip(a, 'items', 'rk_heavy', sq, stock, 1));
  const t = beltTotals(sq);
  assert(t.rk_light <= 3 && t.rk_heavy === 1, JSON.stringify(t));
});

test('Waffenwechsel passt Ladung und Gürtel an', () => {
  const a = mk(), sq = [a], stock = { cannon: 1, rocket: 1, rk_light: 2, laser: 1, mag_he: 1 };
  assert(setEquip(a, 'weapon', 'cannon', sq, stock, -1, false, sq));
  assert.equal(a.load, 'mag'); assert.deepEqual(a.items, ['frag', 'mag', 'mag']); // Magazin passt zur Kanone
  assert(setEquip(a, 'load', 'mag_he', sq, stock));
  assert.equal(a.load, 'mag_he');
  assert(!setEquip(a, 'load', 'rk_light', sq, stock));          // falsche Munition
  assert(setEquip(a, 'weapon', 'rocket', sq, stock, -1, false, sq));
  assert.equal(a.load, 'rk_light');                             // erste Munition mit Bestand
  assert.deepEqual(a.items, ['frag', null, null]);              // Magazine passen nicht zum Werfer
  assert(setEquip(a, 'weapon', 'laser', sq, stock, -1, false, sq));
  assert.equal(a.load, null);
  // kein Bestand: Standardmunition bleibt gesetzt, „short“ wird gemeldet
  const b = mk({ weapon: 'rocket', load: null, items: [null, null, null] });
  const r = pickLoad(b, [b], {});
  assert.equal(r.id, 'rk_light'); assert.equal(r.short, true);
});

test('clampBelts: Ladung ohne Bestand fällt auf verfügbare Munition zurück', () => {
  const a = mk({ weapon: 'rocket', load: 'rk_heavy', items: ['rk_light', 'rk_light', null] });
  clampBelts([a], { rk_light: 1 });
  assert.equal(a.load, 'rk_light');                             // schwere Rakete nicht im Lager
  assert.deepEqual(a.items.filter(Boolean), []);                // einzige L-Rakete steckt in der Waffe
});

test('Vorlage überträgt Ladung und Ersatzmagazine', () => {
  const src = mk({ weapon: 'cannon', load: 'mag_in', items: ['mag', 'mag', 'frag'] }), t = mk({ items: [null, null, null] }), sq = [src, t];
  const stock = { cannon: 2, mag_in: 2, frag: 2 };
  applyTemplate(src, sq, sq, stock);
  assert.equal(t.weapon, 'cannon'); assert.equal(t.load, 'mag_in');
  assert.deepEqual(t.items, ['mag', 'mag', 'frag']);
  const t2 = mk(); applyTemplate(src, [src, t2], [src, t2], { cannon: 1 }); // nur eine Kanone: Rückfall auf Gewehr
  assert.equal(t2.weapon, 'rifle'); assert.equal(t2.load, 'mag'); assert(t2.items.includes('mag'));
});

test('Kauf: nur erforscht, Lager, Budget, Standardmunition nicht kaufbar', () => {
  Game.newGame(); const c = Game.c; c.credits = 1000000;
  assert.equal(Game.priceOf('mag'), null); assert.equal(Game.priceOf('rifle'), null); assert.equal(Game.priceOf('none'), null);
  assert.equal(Game.purchase('mag').ok, false);
  assert.equal(Game.purchase('lpistol').reason, 'nicht erforscht');
  assert.equal(Game.purchase('pz_cell').ok, false);
  assert.equal(Game.purchase('rk_light', 5).ok, true);
  assert.equal(c.stock.rk_light, 5); assert.equal(c.credits, 1000000 - 5 * ITEMS.rk_light.cost);
  assert.equal(Game.purchase('rocket').ok, true); assert.equal(c.stock.rocket, 1);
  c.credits = 10;
  assert.equal(Game.purchase('cannon').reason, 'Budget'); assert.equal(c.credits, 10);
  // Freischalten per Cheat/Forschung
  c.credits = 1e9; Game.cheats.allGear = false;
  for (const id of ['laser', 'plasma', 'guidance']) c.researched.push(id);
  for (const id of ['laser', 'lpistol', 'pz_cell', 'plasma', 'ppistol', 'rk_guided', 'guided']) assert.equal(Game.purchase(id).ok, true, id);
  assert.equal(c.stock.rk_guided, 1); assert.equal(c.stock.guided, 1);
  Game.cheats.allGear = true;
  assert.equal(Game.purchase('hplasma').ok, true);             // Cheat: alle Ausrüstung freigeschaltet
  Game.cheats.allGear = false;
});

test('Jede Waffe: Munition existiert, kaufbare Dinge haben erreichbare Forschung', () => {
  const rids = new Set(RESEARCH.map((r) => r.id));
  for (const [id, w] of Object.entries(WEAPONS)) {
    for (const a of ammoList(id)) { assert(ITEMS[a]?.kind === 'ammo', `${id}: ${a}`); assert(ammoFits(id, a)); }
    assert.equal(defaultLoad(id), w.mag ? Object.keys(w.ammo)[0] : null, id);
    if (w.cost) assert(w.avail || rids.has(w.req), `${id}: req ${w.req}`);
    assert(weaponDesc(id).length > 0);
  }
  for (const [id, it] of Object.entries(ITEMS)) { if (it.req) assert(rids.has(it.req), `${id}: req ${it.req}`); assert(itemEffect(it) !== undefined); }
  for (const [id, a] of Object.entries(ARMORS)) if (a.req) assert(rids.has(a.req), id);
  for (const [id, cr] of Object.entries(CRAFTS)) if (cr.req) assert(rids.has(cr.req), id);
  const ids = [...Object.keys(WEAPONS), ...Object.keys(ITEMS), ...Object.keys(ARMORS)];
  assert.equal(new Set(ids).size, ids.length, 'Lager-IDs eindeutig');
});

test('Forschungsbaum: eindeutig, ohne Zyklen, alles erreichbar', () => {
  const ids = RESEARCH.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of RESEARCH) {
    assert(r.name && r.desc && r.cost > 0, r.id);
    for (const a of r.after || []) assert(ids.includes(a), `${r.id}.after ${a}`);
  }
  // Zyklen (DFS)
  const state = {};
  const visit = (id, path) => {
    assert.notEqual(state[id], 1, `Zyklus: ${[...path, id].join(' → ')}`);
    if (state[id] === 2) return; state[id] = 1;
    for (const a of RESEARCH.find((r) => r.id === id).after || []) visit(a, [...path, id]);
    state[id] = 2;
  };
  ids.forEach((id) => visit(id, []));
  // Erreichbarkeit: Artefakte, die Missionen liefern (Leichname, Gefangene, UFO-Beute – siehe Tactical.finish)
  const have = new Set(['Plasmawaffe', 'Alien-Legierung', 'Zerium', 'UFO-Navigationsmodul']);
  for (const a of Object.values(ALIENS)) { have.add(a.corpse); if (a.captive) have.add(a.captive); }
  const done = new Set();
  for (let changed = true; changed;) {
    changed = false;
    for (const r of RESEARCH) {
      if (done.has(r.id)) continue;
      const needs = (r.needs || []).map((n) => (typeof n === 'string' ? n : n.name));
      if (needs.every((n) => have.has(n)) && (r.after || []).every((a) => done.has(a))) { done.add(r.id); changed = true; }
    }
  }
  assert.deepEqual(ids.filter((i) => !done.has(i)), [], 'unerreichbare Forschung');
  // Verhör-Kette: Gefangene schalten Verhöre frei, diese die Alien-Spezialwaffen
  assert.deepEqual(RESEARCH.find((r) => r.id === 'verhoer_vael').needs, ['Gefangener Vael']);
  assert(RESEARCH.find((r) => r.id === 'stuntech').after.includes('verhoer_vael'));
  assert(RESEARCH.find((r) => r.id === 'guidance').after.includes('verhoer_krull'));
  assert.equal(RESEARCH.find((r) => r.id === 'hyperwave').after.some((a) => a.startsWith('verhoer')), false, 'Finale hängt nicht von Gefangenen ab');
});

test('Forschung: Gefangene werden verbraucht und schalten Verhör frei', () => {
  Game.newGame(); const c = Game.c;
  assert(!Game.researchAvailable().some((r) => r.id === 'verhoer_vael'));
  c.artifacts['Gefangener Vael'] = 1;
  assert(Game.researchAvailable().some((r) => r.id === 'verhoer_vael'));
  assert(Game.startResearch('verhoer_vael')); assert.equal(c.artifacts['Gefangener Vael'], 0);
  Game.completeResearch('verhoer_vael');
  assert(Game.has('verhoer_vael'));
});
