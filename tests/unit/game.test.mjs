import test from 'node:test';
import assert from 'node:assert';
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { Game, createCampaign, migrateCampaign } = await import('../../js/game.js');
const { RESEARCH, CRAFTS, REGIONS, BELT_SLOTS } = await import('../../js/data.js');

test('newGame erzeugt gültige Kampagne', () => {
  Game.newGame();
  const c = Game.c;
  assert.equal(c.soldiers.length, 8);
  assert(c.credits > 0 && c.scientists > 0);
  for (const s of c.soldiers) assert.equal(s.items.length, BELT_SLOTS);
  assert.equal(Object.keys(c.funding).length, REGIONS.length);
});

test('Speichern und Laden', () => {
  Game.newGame(); Game.c.credits = 1234; Game.save();
  assert(Game.hasSave());
  Game.c = null;
  assert(Game.load());
  assert.equal(Game.c.credits, 1234);
});

test('tickDays: Forschung, Bau, Heilung', () => {
  Game.newGame();
  const c = Game.c;
  c.research = { id: 'laser', progress: 0 };
  c.building = [{ type: 'medbay', daysLeft: 2 }];
  c.soldiers[0].wound = 5;
  Game.tickDays(1);
  assert.equal(c.research.progress, c.scientists);
  assert.equal(c.soldiers[0].wound, 4);
  assert.equal(c.building.length, 1);
  Game.tickDays(1);
  assert.equal(c.facilities.medbay, 1);
  assert.equal(c.building.length, 0);
  for (let i = 0; i < 30; i++) Game.tickDays(1);
  assert(Game.has('laser'));
  assert.equal(c.research, null);
  assert(c.soldiers[0].wound === 0);
});

test('tickDays: ungültiges Projekt blockiert Bau/Heilung nicht', () => {
  Game.newGame();
  const c = Game.c;
  c.research = { id: 'gibt_es_nicht', progress: 3 };
  c.building = [{ type: 'lab', daysLeft: 1 }];
  c.soldiers[1].wound = 3;
  assert.doesNotThrow(() => Game.tickDays(1));
  assert.equal(c.research, null);
  assert.equal(c.facilities.lab, 2);
  assert.equal(c.soldiers[1].wound, 2);
  // bereits erforschtes Projekt
  c.researched.push('laser'); c.research = { id: 'laser', progress: 0 };
  Game.tickDays(1);
  assert.equal(c.research, null);
});

test('Reparatur der Abfangjäger', () => {
  Game.newGame();
  const cr = Game.c.crafts[0]; cr.status = 'repair'; cr.hp = 0;
  Game.tickDays(2);
  assert(cr.hp > 0);
  Game.tickDays(10);
  assert.equal(cr.status, 'ready'); assert.equal(cr.hp, CRAFTS[cr.type].hp);
});

test('Forschungsverfügbarkeit', () => {
  Game.newGame();
  const av = Game.researchAvailable().map((r) => r.id);
  assert(av.includes('laser'));
  assert(!av.includes('plasma'));
  assert(RESEARCH.length > av.length);
});

test('monthlyReport', () => {
  Game.newGame();
  const c = Game.c, before = c.credits;
  c.monthScore = 50; c.regionScore[REGIONS[0].id] = 100;
  const f0 = c.funding[REGIONS[0].id];
  const r = Game.monthlyReport();
  assert.equal(r.lines.length, REGIONS.length);
  assert(c.funding[REGIONS[0].id] > f0);
  assert.equal(c.credits, before + r.net);
  assert.equal(c.monthScore, 0);
  assert.equal(r.gameOver, false);
  // Game Over erst nach 3 schlechten Monaten in Folge (E3); Monat 0 zählt nicht
  c.lastMonth = 3;
  c.credits = -1e9; assert.equal(Game.monthlyReport().gameOver, false);
  c.credits = -1e9; assert.equal(Game.monthlyReport().gameOver, false);
  c.credits = -1e9; const r2 = Game.monthlyReport();
  assert(r2.gameOver);
});

test('migrateCampaign: alter Spielstand ohne items', () => {
  const c = createCampaign();
  for (const s of c.soldiers) { delete s.items; s.grenades = 2; }
  delete c.stock.smoke; delete c.stock.flare; delete c.stock.medkit;
  migrateCampaign(c);
  for (const s of c.soldiers) {
    assert.equal(s.items.length, BELT_SLOTS);
    assert.deepEqual(s.items.slice(0, 2), ['frag', 'frag']);
    assert.equal(s.items[2], null);
  }
  assert(c.stock.smoke > 0 && c.stock.flare > 0 && c.stock.medkit > 0);
  const old = { soldiers: [{ grenades: 0, items: ['frag'] }] };
  migrateCampaign(old);
  assert.equal(old.soldiers[0].items.length, BELT_SLOTS);
  assert.deepEqual(old.stock.smoke, 6);
});
