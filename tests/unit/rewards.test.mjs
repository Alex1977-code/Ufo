// E2: Belohnungssystem (missionRewards, alienCount), Alternativ-Forschung (needsAlt), Game-Over-Regel, Migration v4
import test from 'node:test';
import assert from 'node:assert';
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const G = await import('../../js/game.js');
const { Game, createCampaign, migrateCampaign, missionRewards, alienCount, hiveCrew, hiveAttrition, badMonthThreshold } = G;
const D = await import('../../js/data.js');
const { ALIENS, UFOS, RESEARCH, ARTIFACT_PRICES, BOUNTY_ALIEN, BOUNTY_UFO, BOUNTY_TERROR, RELAY_FROM } = D;

// feste Zufallsfolgen: rngConst(0.99) = „Pech“ (kein Zufallstreffer), rngConst(0.01) = „Glück“
const rngConst = (v) => () => v;
const lz = [{ x: 5, y: 5 }];
const base = { won: true, kills: {}, rng: rngConst(0.99) };

test('Daten: Prämien und Preise vollständig', () => {
  for (const id of Object.keys(ALIENS)) assert(id in BOUNTY_ALIEN, `BOUNTY_ALIEN.${id}`);
  for (const id of Object.keys(UFOS)) assert(BOUNTY_UFO[id] > 0, `BOUNTY_UFO.${id}`);
  assert.equal(BOUNTY_TERROR, 120000);
  for (const a of Object.values(ALIENS)) assert(ARTIFACT_PRICES[a.corpse] > 0, `Preis ${a.corpse}`);
  assert.equal(ARTIFACT_PRICES['Bestien-Kadaver'], 15000);
  assert.equal(ARTIFACT_PRICES['Hyperwellen-Relais'], 150000);
  assert.deepEqual([ARTIFACT_PRICES['Gefangener Vael'], ARTIFACT_PRICES['Gefangener Krull'], ARTIFACT_PRICES['Gefangene Klauenbestie']], [60000, 90000, 50000]);
  assert.deepEqual(RELAY_FROM, { freighter: 1, battleship: 1 });
  const hw = RESEARCH.find((r) => r.id === 'hyperwave');
  assert.deepEqual(hw.needs, ['Hyperwellen-Relais']);
  assert.equal(hw.cost, 2400);
});

test('missionRewards: Kopfprämie nach Art, Gefangene ×1,5', () => {
  const site = { kind: 'landed', ufoType: 'fighter' };
  const r = missionRewards({ ...base, site, kills: { vael: 2, krull: 1, drone: 1, beast: 1 }, captures: { krull: 1 } });
  const alien = 2 * 8000 + 20000 + 20000 + 15000 + 30000;
  assert.equal(r.bounty, alien + BOUNTY_UFO.fighter);
  assert.equal(r.artifacts['Gefangener Krull'], 1);
  assert.equal(r.artifacts['Krull-Leichnam'], 1);
  assert.equal(r.artifacts['Drohnen-Wrack'] >= 1, true);
  assert.equal(r.artifacts['Bestien-Kadaver'], 1);
  // Wertung: Kills + 1,5 × Krull + UFO + Sieg
  assert.equal(r.score, 2 * ALIENS.vael.score + ALIENS.krull.score + ALIENS.drone.score + ALIENS.beast.score + Math.round(ALIENS.krull.score * 1.5) + UFOS.fighter.score + 50);
  // nicht fangbare Art (Drohne) wird als Wrack gezählt
  const r2 = missionRewards({ ...base, site, captures: { drone: 2 } });
  assert.equal(r2.artifacts['Drohnen-Wrack'] >= 2, true);
  assert.equal(r2.artifacts['Gefangene Drohne'], undefined);
});

test('missionRewards: UFO-Beute (Rumpf, Zerium, Navigation, Wrack, Relais)', () => {
  const crash = missionRewards({ ...base, site: { kind: 'crash', ufoType: 'freighter' }, rng: rngConst(0.99) });
  assert.equal(crash.artifacts['Alien-Legierung'], UFOS.freighter.radius * 2);
  assert(crash.artifacts.Zerium >= 1 && crash.artifacts.Zerium <= 3);
  assert.equal(crash.artifacts['UFO-Navigationsmodul'], 1);
  assert.equal(crash.artifacts['Hyperwellen-Relais'], undefined, 'Absturz: Relais nur mit 60 %');
  assert.equal(crash.artifacts['Drohnen-Wrack'], undefined);
  const lucky = missionRewards({ ...base, site: { kind: 'crash', ufoType: 'freighter' }, rng: rngConst(0.01) });
  assert.equal(lucky.artifacts['Hyperwellen-Relais'], 1);
  assert.equal(lucky.artifacts['Drohnen-Wrack'], 1);
  const landed = missionRewards({ ...base, site: { kind: 'landed', ufoType: 'freighter' }, rng: rngConst(0.99) });
  assert.equal(landed.artifacts['Alien-Legierung'], UFOS.freighter.radius * 3);
  assert(landed.artifacts.Zerium >= 3 && landed.artifacts.Zerium <= 6);
  assert.equal(landed.artifacts['Hyperwellen-Relais'], 1, 'Landung: Relais sicher');
  assert.equal(landed.bounty, BOUNTY_UFO.freighter);
  // Schlachtschiff: Relais; Jäger und Späher nie
  assert.equal(missionRewards({ ...base, site: { kind: 'landed', ufoType: 'battleship' } }).artifacts['Hyperwellen-Relais'], 1);
  assert.equal(missionRewards({ ...base, site: { kind: 'landed', ufoType: 'fighter' }, rng: rngConst(0.01) }).artifacts['Hyperwellen-Relais'], undefined);
  // Späher: Navigationsmodul nur zu 30 %, kein Drohnen-Wrack
  const scoutPech = missionRewards({ ...base, site: { kind: 'crash', ufoType: 'scout' }, rng: rngConst(0.99) });
  assert.equal(scoutPech.artifacts['UFO-Navigationsmodul'], undefined);
  const scoutGluck = missionRewards({ ...base, site: { kind: 'crash', ufoType: 'scout' }, rng: rngConst(0.01) });
  assert.equal(scoutGluck.artifacts['UFO-Navigationsmodul'], 1);
  assert.equal(scoutGluck.artifacts['Drohnen-Wrack'], undefined);
  // Verhör Vael: +1 Zerium
  const v0 = missionRewards({ ...base, site: { kind: 'landed', ufoType: 'scout' }, rng: rngConst(0.5) });
  const v1 = missionRewards({ ...base, site: { kind: 'landed', ufoType: 'scout' }, rng: rngConst(0.5), verhoerVael: true });
  assert.equal(v1.artifacts.Zerium, v0.artifacts.Zerium + 1);
});

test('missionRewards: Terror liefert keine UFO-Hülle (Terror-Beutefehler)', () => {
  const site = { kind: 'terror', ufoType: 'freighter' };
  const r = missionRewards({ ...base, site, kills: { vael: 3, beast: 2 }, civSaved: 5, civKilled: 1, rng: rngConst(0.01) });
  for (const k of ['Alien-Legierung', 'Zerium', 'UFO-Navigationsmodul', 'Hyperwellen-Relais', 'Drohnen-Wrack']) assert.equal(r.artifacts[k], undefined, k);
  assert.equal(r.artifacts['Bestien-Kadaver'], 2);
  assert.equal(r.bounty, 3 * 8000 + 2 * 15000 + BOUNTY_TERROR, 'Terrorprämie, keine UFO-Prämie');
  assert.equal(r.score, 3 * ALIENS.vael.score + 2 * ALIENS.beast.score + 100 + 5 * 10 - 15);
});

test('missionRewards: Plasmawaffen und Zellen', () => {
  const r = missionRewards({ ...base, site: { kind: 'terror', ufoType: 'fighter' }, kills: { vael: 2, beast: 1, drone: 1 }, hasPlasma: true });
  assert.equal(r.artifacts.Plasmawaffe, 2, 'Vael tragen Plasma, Bestie und Drohne nicht');
  assert.equal(r.ammoLoot.pz_cell, 2);
  assert.equal(missionRewards({ ...base, site: { kind: 'terror' }, kills: { vael: 2 } }).ammoLoot.pz_cell, undefined);
});

test('missionRewards: Rückzug – Teilbeute im Umkreis 6, halbe Prämie', () => {
  const site = { kind: 'landed', ufoType: 'freighter' };
  const corpses = [{ type: 'krull', x: 11, y: 5 }, { type: 'vael_s', x: 5, y: 11 }, { type: 'drone', x: 12, y: 5 }, { type: 'beast', x: 40, y: 40 }];
  const kills = { krull: 1, vael_s: 1, drone: 1, beast: 1 };
  const r = missionRewards({ won: false, aborted: true, site, kills, corpses, lzCells: lz, rng: rngConst(0.01), dead: 2 });
  assert.equal(r.artifacts['Krull-Leichnam'], 1, 'Abstand genau 6 zählt');
  assert.equal(r.artifacts['Vael-Leichnam'], 1);
  assert.equal(r.artifacts['Drohnen-Wrack'], undefined, 'Abstand 7 zählt nicht');
  assert.equal(r.artifacts['Bestien-Kadaver'], undefined);
  assert.equal(r.artifacts.Plasmawaffe, 2, 'Plasmawaffen der geborgenen Plasmaträger');
  assert.equal(r.salvaged, 2);
  for (const k of ['Alien-Legierung', 'Zerium', 'UFO-Navigationsmodul', 'Hyperwellen-Relais']) assert.equal(r.artifacts[k], undefined, `${k} nur bei Sieg`);
  assert.equal(r.bounty, Math.round((20000 + 12000 + 20000 + 15000) * 0.5));
  assert.equal(r.score, ALIENS.krull.score + ALIENS.vael_s.score + ALIENS.drone.score + ALIENS.beast.score - 20 - 10 * 2, '-20 Fehlschlag, -10 je Gefallenem');
  assert(r.notes.some((n) => /Geborgen/.test(n)));
});

test('missionRewards: Niederlage – keine Beute, 50 % Prämie, Terror −60', () => {
  const r = missionRewards({ won: false, aborted: false, site: { kind: 'terror', ufoType: 'fighter' }, kills: { vael: 4 }, corpses: [{ type: 'vael', x: 5, y: 5 }], lzCells: lz, dead: 6, civKilled: 3 });
  assert.deepEqual(r.artifacts, {});
  assert.equal(r.bounty, 4 * 8000 / 2);
  assert.equal(r.score, 4 * ALIENS.vael.score - 60 - 60 - 45);
  // ohne Kill keine Prämie
  assert.equal(missionRewards({ won: false, aborted: true, site: { kind: 'crash', ufoType: 'scout' } }).bounty, 0);
});

test('missionRewards: Verhör Krull +20 %, Gefangene nur bei Sieg', () => {
  const site = { kind: 'landed', ufoType: 'scout' };
  const a = missionRewards({ ...base, site, kills: { krull: 2 } }), b = missionRewards({ ...base, site, kills: { krull: 2 }, verhoerKrull: true });
  assert.equal(b.bounty, Math.round(a.bounty * 1.2));
  const lost = missionRewards({ won: false, aborted: true, site, kills: {}, captures: { vael: 3 } });
  assert.deepEqual(lost.artifacts, {});
  assert.equal(lost.bounty, 0);
});

test('missionRewards: Hive-Abnutzung zählt Wachen, nicht den Kommandanten', () => {
  const site = { kind: 'hive' };
  const r = missionRewards({ won: false, aborted: true, site, kills: { krull: 3, drone: 2, hive: 0 }, monthIdx: 7 });
  assert.equal(r.hiveKills, 5);
  assert.equal(r.hiveMonth, 7);
  assert.equal(missionRewards({ won: true, site, kills: { krull: 3, hive: 1 } }).hiveKills, 0);
  assert.equal(missionRewards({ won: false, site: { kind: 'landed', ufoType: 'scout' }, kills: { vael: 2 } }).hiveKills, 0);
  assert.equal(r.bounty, Math.round((3 * 20000 + 2 * 20000) / 2));
});

test('hiveCrew/hiveAttrition: Zermürbung mit Nachwuchs', () => {
  assert.equal(hiveCrew({ kind: 'hive' }, 5), 11);
  const s = { kind: 'hive' };
  Object.assign(s, hiveAttrition(s, 5, 4)); // 5 Wachen gefallen im Monat 4
  assert.deepEqual([s.hiveKilled, s.hiveMonth], [5, 4]);
  assert.equal(hiveCrew(s, 4), 6);
  assert.equal(hiveCrew(s, 6), 10, '+2 je Monat');
  assert.equal(hiveCrew(s, 20), 11, 'nie über 11');
  Object.assign(s, hiveAttrition(s, 9, 4)); // 5 + 9 = 14 → Untergrenze 5
  assert.equal(hiveCrew(s, 4), 5);
  Object.assign(s, hiveAttrition(s, 0, 9)); // 5 Monate später: 14 − 10 = 4
  assert.equal(s.hiveKilled, 4);
});

test('alienCount: Terror (E11), Hive (E15), UFO', () => {
  const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
  const early = alienCount({ kind: 'terror', ufoType: 'fighter' }, 0, rngConst(0.5));
  assert.deepEqual(early.roster, ['vael', 'vael', 'vael_s', 'beast', 'vael_s']);
  assert.equal(alienCount({ kind: 'terror' }, 1, rngConst(0.5)).roster.filter((t) => t === 'beast').length, 1);
  const m2 = alienCount({ kind: 'terror' }, 2, rngConst(0.5));
  assert.deepEqual(m2.roster, ['vael', 'vael_s', 'beast', 'beast', 'vael_s']);
  assert.equal(alienCount({ kind: 'terror' }, 3, rngConst(0.5)).roster.at(-1), 'krull');
  assert.equal(alienCount({ kind: 'terror' }, 0, rngConst(0)).n, 7);
  assert.equal(alienCount({ kind: 'terror' }, 0, rngConst(0.999)).n, 10);
  assert.equal(alienCount({ kind: 'hive' }, 3).n, 11);
  assert.equal(alienCount({ kind: 'hive', hiveKilled: 4, hiveMonth: 3 }, 4).n, 9);
  assert.equal(alienCount({ kind: 'hive', hiveKilled: 9, hiveMonth: 3 }, 3).n, 5);
  const f = alienCount({ kind: 'landed', ufoType: 'freighter' }, 0, seq(0.999));
  assert.equal(f.n, UFOS.freighter.crew[1]);
  const cr = alienCount({ kind: 'crash', ufoType: 'freighter' }, 0, seq(0.999));
  assert.equal(cr.n, Math.round(UFOS.freighter.crew[1] * 0.75));
  assert.deepEqual(cr.roster, UFOS.freighter.roster);
  assert.equal(alienCount({ kind: 'crash', ufoType: 'scout' }, 0, rngConst(0)).n, Math.max(1, Math.round(UFOS.scout.crew[0] * 0.75)));
});

test('needsAlt: Alternativsatz erschließt und verbraucht', () => {
  Game.newGame(); const c = Game.c;
  const dt = RESEARCH.find((r) => r.id === 'drone_tech'), nav = RESEARCH.find((r) => r.id === 'navigation');
  assert.deepEqual(Game.researchNeeds(dt, true), [{ name: 'Plasmawaffe', n: 3 }, { name: 'Zerium', n: 1 }]);
  assert.deepEqual(Game.researchNeeds(nav, true), [{ name: 'Alien-Legierung', n: 8 }, { name: 'Zerium', n: 2 }]);
  assert.deepEqual(Game.researchNeeds(dt), [{ name: 'Drohnen-Wrack', n: 1 }]);
  assert(!Game.researchAvailable().some((r) => r.id === 'drone_tech'));
  c.artifacts = { Plasmawaffe: 2, Zerium: 1 };
  assert(!Game.researchAvailable().some((r) => r.id === 'drone_tech'), '2 Plasmawaffen genügen nicht');
  assert.equal(Game.startResearch('drone_tech'), false);
  c.artifacts = { Plasmawaffe: 4, Zerium: 5 };
  assert(Game.researchAvailable().some((r) => r.id === 'drone_tech'));
  assert(Game.startResearch('drone_tech'));
  assert.deepEqual([c.artifacts.Plasmawaffe, c.artifacts.Zerium], [1, 4]);
  assert(c.researchPaid.drone_tech);
  // Hauptsatz hat Vorrang
  Game.newGame(); const c2 = Game.c;
  c2.artifacts = { 'Alien-Legierung': 9, Zerium: 3, 'UFO-Navigationsmodul': 1 };
  assert(Game.startResearch('navigation'));
  assert.deepEqual([c2.artifacts['UFO-Navigationsmodul'], c2.artifacts['Alien-Legierung'], c2.artifacts.Zerium], [0, 9, 3]);
  // Alternativsatz für Navigation
  Game.newGame(); const c3 = Game.c;
  c3.artifacts = { 'Alien-Legierung': 9, Zerium: 3 };
  assert(Game.startResearch('navigation'));
  assert.deepEqual([c3.artifacts['Alien-Legierung'], c3.artifacts.Zerium], [1, 1]);
});

test('artifactNeededFor: Alternativsatz zählt nur, solange der Hauptsatz fehlt', () => {
  Game.newGame(); const c = Game.c;
  c.artifacts = {};
  assert(Game.artifactNeededFor('Zerium').some((r) => r.id === 'navigation'), 'Zerium als Alternative');
  assert(Game.artifactNeededFor('Plasmawaffe').some((r) => r.id === 'drone_tech'));
  c.artifacts = { 'UFO-Navigationsmodul': 1, 'Drohnen-Wrack': 1 };
  assert(!Game.artifactNeededFor('Zerium').some((r) => r.id === 'navigation' || r.id === 'drone_tech'), 'Hauptsatz vorhanden');
  assert(Game.artifactNeededFor('UFO-Navigationsmodul').some((r) => r.id === 'navigation'));
  assert(Game.artifactNeededFor('Hyperwellen-Relais').some((r) => r.id === 'hyperwave'));
});

test('hyperwave: braucht das Relais, Verhör Krull ersetzt es und kürzt um 200 WT', () => {
  Game.newGame(); const c = Game.c;
  const hw = RESEARCH.find((r) => r.id === 'hyperwave');
  c.researched.push('navigation', 'drone_tech');
  assert(!Game.researchAvailable().some((r) => r.id === 'hyperwave'));
  assert.equal(Game.startResearch('hyperwave'), false);
  c.artifacts['Hyperwellen-Relais'] = 1;
  assert(Game.researchAvailable().some((r) => r.id === 'hyperwave'));
  assert.equal(Game.researchCost(hw), 2400);
  assert(Game.startResearch('hyperwave'));
  assert.equal(c.artifacts['Hyperwellen-Relais'], 0);
  // Alternative ohne Relais
  Game.newGame(); const d = Game.c;
  d.researched.push('navigation', 'drone_tech', 'verhoer_krull');
  assert(Game.researchAvailable().some((r) => r.id === 'hyperwave'));
  assert.equal(Game.researchCost(hw), 2200);
  assert.deepEqual(Game.artifactNeededFor('Hyperwellen-Relais'), []);
  assert(Game.startResearch('hyperwave'));
  d.research.progress = 2190; Game.tickDays(0.5); // 2195 < 2200 → noch nicht fertig
  assert(!Game.has('hyperwave'));
  d.research.progress = 2200 - d.scientists; Game.tickDays(1);
  assert(Game.has('hyperwave') && d.finalUnlocked);
});

test('Game Over: 3 schlechte Monate in Folge, Schwelle steigt, Monat 0 zählt nicht', () => {
  assert.equal(badMonthThreshold(0), -300);
  assert.equal(badMonthThreshold(5), -600);
  assert.equal(badMonthThreshold(11), -960);
  assert.equal(badMonthThreshold(12), -1000);
  assert.equal(badMonthThreshold(40), -1000);
  Game.newGame(); const c = Game.c;
  const month = (m, score, credits = 1e6) => { c.lastMonth = m + 1; c.monthScore = score; c.credits = credits; return Game.monthlyReport(); };
  let r = month(0, -5000); assert.equal(r.bad, false, 'Monat 0 zählt nie'); assert.equal(c.negMonths, 0);
  r = month(1, -361); assert(r.bad); assert.equal(r.monthsLeft, 2); assert.equal(r.gameOver, false);
  r = month(2, -421); assert.equal(c.negMonths, 2); assert.equal(r.gameOver, false);
  r = month(3, 200); assert.equal(c.negMonths, 0, 'guter Monat setzt zurück');
  r = month(4, -400); assert.equal(r.bad, false, 'Schwelle Monat 4 = −540: −400 ist ok');
  assert.equal(r.threshold, -540);
  r = month(4, -600); assert(r.bad);
  month(5, -2000); r = month(6, -2000);
  assert(r.gameOver && c.negMonths === 3);
  // negatives Guthaben zählt ebenfalls
  Game.newGame(); const d = Game.c;
  for (let m = 1; m <= 3; m++) { d.lastMonth = m + 1; d.monthScore = 500; d.credits = -1e9; Game.monthlyReport(); }
  assert.equal(d.negMonths, 3);
});

test('monthlyReport: Finanzierung mit Ober- und Untergrenze, Abzug erst ab −60', () => {
  Game.newGame(); const c = Game.c; c.lastMonth = 3;
  const [a, b, d, e, f, g] = D.REGIONS.map((x) => x.id);
  c.regionScore[a] = -50;  // keine Änderung
  c.regionScore[b] = -400; // −min(15 %, 0,4) = −15 %
  c.regionScore[d] = 4000; c.funding[d] = 230000; // Anstieg gedeckelt auf 240 000
  c.regionScore[e] = -5000; c.funding[e] = 85000; // Untergrenze 80 000
  c.regionScore[f] = 100; // +12,5 %
  const r = Game.monthlyReport();
  assert.equal(c.funding[a], 160000);
  assert.equal(c.funding[b], 136000);
  assert.equal(c.funding[d], 240000);
  assert.equal(c.funding[e], 80000);
  assert.equal(c.funding[f], 180000);
  assert.equal(r.salaries, 8 * 20000 + 10 * 20000, 'Wissenschaftler 20 000');
});

test('migrateCampaign v3 → v4: Relais bezahlt, Fortschritt skaliert, Grenzen', () => {
  const c = createCampaign();
  c.v = 3; c.researched = ['navigation']; c.research = { id: 'hyperwave', progress: 240 };
  c.researchProgress = { plasma: 130, laser: 80 }; c.researchPaid = {};
  c.funding.nw = 400000; c.funding.ne = 10000; c.negMonths = 1;
  migrateCampaign(c);
  assert.equal(c.v, 4);
  assert(c.researchPaid.hyperwave, 'laufende Dekodierung braucht das Relais nicht');
  assert.equal(c.research.progress, 240 * 2400 / 480);
  assert.equal(c.researchProgress.plasma, 130 * 800 / 260);
  assert.equal(c.researchProgress.laser, 80 * 300 / 160);
  assert.equal(c.funding.nw, 240000); assert.equal(c.funding.ne, 80000);
  assert.equal(c.negMonths, 1);
  // fertige Dekodierung, Spielstand mit 2 schlechten Monaten bleibt spielbar (max. 2)
  const d = createCampaign(); d.v = 3; d.researched = ['hyperwave']; d.negMonths = 2; d.research = null;
  migrateCampaign(d);
  assert(d.researchPaid.hyperwave); assert.equal(d.negMonths, 2);
  // idempotent
  migrateCampaign(c); assert.equal(c.research.progress, 240 * 2400 / 480);
  // neue Kampagne ist bereits v4
  assert.equal(createCampaign().v, 4);
});
