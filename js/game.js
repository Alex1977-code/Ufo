// Kampagnenzustand: Finanzen, Soldaten, Forschung, Lager, Speichern/Laden
import { WEAPONS, ARMORS, GRENADES, ITEMS, BELT_SLOTS, RESEARCH, FACILITIES, RANKS, RANK_XP, REGIONS, CRAFTS, defaultLoad, ammoFits } from './data.js';
import { ARTIFACT_PRICES, ALIENS, UFOS, BOUNTY_ALIEN, BOUNTY_UFO, BOUNTY_TERROR, BOUNTY_CAPTURE_MUL, BOUNTY_LOSS_SHARE, RELAY_FROM, RELAY_CRASH_CHANCE, RETREAT_LOOT_RADIUS } from './data.js';
import { randInt, randomName, rand, Emitter } from './util.js';

const SAVE_KEY = 'aegis_save_v1';
export const CAMPAIGN_VERSION = 4;

// Wirtschaft und Game-Over-Regel (E1 E2/E3/E12/E16)
export const SALARY_SOLDIER = 20000, SALARY_SCIENTIST = 20000, UPKEEP_FACILITY = 40000, UPKEEP_CRAFT = 60000;
export const HIRE_SOLDIER = 40000;
export const FUNDING_START = 160000, FUNDING_MIN = 80000, FUNDING_MAX = 240000;
export const GAME_OVER_MONTHS = 3; // so viele schlechte Monate in Folge beenden die Kampagne
// Schwelle der Monatswertung; sie steigt mit dem Monat (Monat 0 zählt nicht als schlechter Monat)
export const badMonthThreshold = (monthIdx) => Math.max(-1000, -300 - 60 * Math.max(0, monthIdx));
export const HIVE_CREW = 11, HIVE_MIN_CREW = 5, HIVE_REGROW = 2; // E15

export function newSoldier() {
  return {
    id: 's' + Math.floor(rand() * 1e9).toString(36),
    name: randomName(),
    rank: 0, xp: 0, kills: 0, missions: 0,
    tu: randInt(50, 62), hp: randInt(38, 48), acc: randInt(45, 72), react: randInt(35, 65), brave: randInt(30, 70),
    wound: 0, // Heilungstage verbleibend
    weapon: 'rifle', load: 'mag', armor: 'none', grenades: 1, items: ['frag', 'mag', 'mag', 'smoke'], // Gürtel (4 Plätze): Granate + 2 Ersatzmagazine (gratis, unbegrenzt) + Nebelgranate
    look: { skin: [0xf1c27d, 0xc68642, 0x8d5524, 0xe0ac69, 0xffdbac][randInt(0, 4)], hair: [0x2c1b10, 0x6b4423, 0xd4b06a, 0x111111, 0x8a3b12][randInt(0, 4)] },
  };
}

export function createCampaign() {
  return {
    v: CAMPAIGN_VERSION,
    time: 0, // Minuten seit Spielstart
    credits: 4200000,
    base: null, // {lat, lon, name}
    facilities: { radar: 1, lab: 1, medbay: 0, hangar: 1 },
    building: [], // {type, daysLeft}
    scientists: 10,
    soldiers: Array.from({ length: 8 }, newSoldier),
    crafts: [
      { id: 'c1', type: 'falcon', name: 'Falke-1', hp: CRAFTS.falcon.hp, status: 'ready' },
      { id: 'c2', type: 'falcon', name: 'Falke-2', hp: CRAFTS.falcon.hp, status: 'ready' },
    ],
    researched: [],
    research: null, // {id, progress}
    artifacts: {},
    researchProgress: {}, researchPaid: {}, // Fortschritt je Projekt / Artefakte bereits verbraucht
    autoPauseHint: false,
    stock: { sniper: 1, shotgun: 1, pistol: 2, frag: 10, smoke: 8, flare: 4, medkit: 2, charge: 2, stunrod: 1 }, // gekaufte Ausrüstung (Waffen sind wiederverwendbar)
    score: 0, monthScore: 0,
    regionScore: Object.fromEntries(REGIONS.map((r) => [r.id, 0])),
    funding: Object.fromEntries(REGIONS.map((r) => [r.id, FUNDING_START])),
    lastMonth: 0,
    stats: { missions: 0, won: 0, ufosDown: 0, kills: 0, lost: 0 },
    negMonths: 0,
    finalUnlocked: false,
    won: false,
  };
}

// Ältere Spielstände auf das Gürtel-System umstellen; I1: bestehende Soldaten bekommen leere Plätze bis BELT_SLOTS (4)
export function migrateCampaign(c) {
  for (const s of c.soldiers || []) {
    if (!Array.isArray(s.items)) {
      s.items = Array(BELT_SLOTS).fill(null);
      for (let i = 0; i < Math.min(BELT_SLOTS, s.grenades || 0); i++) s.items[i] = 'frag';
    }
    while (s.items.length < BELT_SLOTS) s.items.push(null);
  }
  c.researchProgress ||= {}; c.researchPaid ||= {};
  if (c.research) c.researchPaid[c.research.id] = true; // laufende Altprojekte gelten als bezahlt
  for (const id of Object.keys(c.researchProgress)) c.researchPaid[id] = true;
  c.stock ||= {};
  if (c.stock.smoke == null) c.stock.smoke = 6;
  if (c.stock.flare == null) c.stock.flare = 4;
  if (c.stock.medkit == null) c.stock.medkit = 2;
  // Version 2 (W1/W2): Magazin je Soldat (soldier.load), neue Waffen/Gegenstände, Startvorrat
  if ((c.v || 1) < 2) {
    for (const s of c.soldiers || []) {
      if (!WEAPONS[s.weapon]) s.weapon = 'rifle';                // Sicherheitsnetz
      if (s.load === undefined) s.load = defaultLoad(s.weapon);  // rifle/sniper/shotgun → 'mag', laser → null, plasma → 'pz_cell'
      s.items = s.items.map((id) => (id && !ITEMS[id] ? null : id)); // unbekannte IDs entfernen
    }
    // Plasma-Besitzer dürfen nicht mit leerer Waffe starten: Startvorrat an Zellen
    if (c.stock.pz_cell == null) {
      const plasmaGuns = (c.stock.plasma || 0) + (c.stock.hplasma || 0);
      c.stock.pz_cell = (c.researched || []).includes('plasma') ? Math.max(6, 3 * plasmaGuns) : 0;
    }
    c.stock.pistol ??= 2; c.stock.charge ??= 2; c.stock.stunrod ??= 1;
    c.v = 2;
  }
  // Version 3 (W3): gültige Ladung je Soldat, Ersatzmagazine (gratis) im Gürtel, Lager aufräumen
  if ((c.v || 1) < 3) {
    for (const s of c.soldiers || []) {
      if (!WEAPONS[s.weapon]) s.weapon = 'rifle';
      const w = WEAPONS[s.weapon];
      if (w.mag) { if (!ammoFits(s.weapon, s.load)) s.load = defaultLoad(s.weapon); }
      else s.load = null;
      s.items = (s.items || []).slice(0, BELT_SLOTS);
      while (s.items.length < BELT_SLOTS) s.items.push(null);
      // Nicht passende Munition entfernen, bis zu 2 Ersatzmagazine in freie Plätze legen (nur Waffen mit Standardmagazin)
      s.items = s.items.map((id) => (id && ITEMS[id]?.kind === 'ammo' && !ammoFits(s.weapon, id) ? null : id));
      if (ammoFits(s.weapon, 'mag')) {
        let have = s.items.filter((id) => id === 'mag').length;
        for (let i = 0; i < s.items.length && have < 2; i++) if (!s.items[i]) { s.items[i] = 'mag'; have++; }
      }
    }
    c.stock ||= {};
    for (const k of Object.keys(c.stock)) if (!(WEAPONS[k] || ITEMS[k] || ARMORS[k]) || !(c.stock[k] >= 0)) delete c.stock[k]; // veraltete Schlüssel
    c.stock.pistol ??= 2; c.stock.charge ??= 2; c.stock.stunrod ??= 1;
    c.v = 3;
  }
  // Version 4 (E2): neue Forschungskosten, Hyperwellen-Relais, Game-Over-Regel mit 3 Monaten
  if ((c.v || 1) < 4) {
    c.researched ||= [];
    // laufende/fertige Dekodierung gilt als bezahlt (das Relais wird nicht nachträglich verlangt)
    if (c.researched.includes('hyperwave') || c.research?.id === 'hyperwave' || c.researchProgress.hyperwave != null) c.researchPaid.hyperwave = true;
    // Fortschritt laufender Projekte im Verhältnis zu den neuen Kosten umrechnen (fast fertige bleiben fast fertig)
    const scale = (id, v) => { const old = LEGACY_COST[id], now = RESEARCH.find((r) => r.id === id)?.cost; return old && now ? v * now / old : v; };
    if (c.research && typeof c.research.progress === 'number') c.research.progress = scale(c.research.id, c.research.progress);
    for (const id of Object.keys(c.researchProgress)) c.researchProgress[id] = scale(id, c.researchProgress[id]);
    // Finanzierung in die neuen Grenzen holen
    for (const id of Object.keys(c.funding || {})) c.funding[id] = Math.min(FUNDING_MAX, Math.max(FUNDING_MIN, c.funding[id]));
    c.negMonths = Math.min(c.negMonths || 0, GAME_OVER_MONTHS - 1);
    c.v = 4;
  }
}
// Forschungskosten vor E8 (nur für die Umrechnung alter Spielstände)
const LEGACY_COST = { laser: 160, autopsy_vael: 80, alloys: 140, plasma: 260, autopsy_krull: 120, navigation: 220, propulsion: 280, hplasma: 300, powerarmor: 380, drone_tech: 160, hyperwave: 480, proxmine: 80, scanner: 100, hlaser: 220, verhoer_vael: 120, verhoer_krull: 180, stuntech: 240, guidance: 380 };

// ======================= Reine Belohnungs-Funktionen (E1 §6, ohne Zustand und ohne DOM) =======================
const PLASMA_WEAPONS = ['a_rifle', 'a_pistol', 'a_heavy'];
const rngInt = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
const sumValues = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);

// Hive-Nest (E15): Besatzung schrumpft mit gefallenen Wachen und wächst langsam nach. site.hiveKilled / site.hiveMonth.
export function hiveCrew(site, monthIdx) {
  if (!site?.hiveKilled) return HIVE_CREW;
  const since = Math.max(0, monthIdx - (site.hiveMonth ?? monthIdx));
  return Math.min(HIVE_CREW, Math.max(HIVE_MIN_CREW, HIVE_CREW - site.hiveKilled + HIVE_REGROW * since));
}
// Neuer Stand der Abnutzung nach einem fehlgeschlagenen Angriff: { hiveKilled, hiveMonth }
export function hiveAttrition(site, hiveKills, monthIdx) {
  const since = Math.max(0, monthIdx - (site?.hiveMonth ?? monthIdx));
  return { hiveKilled: Math.max(0, (site?.hiveKilled || 0) - HIVE_REGROW * since) + (hiveKills || 0), hiveMonth: monthIdx };
}

// Alien-Aufstellung (E11/E15): { roster, n } je Einsatzort. rng() liefert [0,1).
export const TERROR_ROSTER_EARLY = ['vael', 'vael', 'vael_s', 'beast', 'vael_s']; // Monat 0–1: nur eine Bestie
export function alienCount(site, monthIdx = 0, rng = rand) {
  if (site.kind === 'hive') return { roster: ['krull', 'drone', 'vael_s', 'beast'], n: hiveCrew(site, monthIdx) };
  if (site.kind === 'terror') {
    const roster = monthIdx < 2 ? TERROR_ROSTER_EARLY.slice() : ['vael', 'vael_s', 'beast', 'beast', monthIdx > 2 ? 'krull' : 'vael_s'];
    return { roster, n: rngInt(rng, 7, 10) };
  }
  const us = UFOS[site.ufoType];
  let n = rngInt(rng, us.crew[0], us.crew[1]);
  if (site.kind === 'crash') n = Math.max(1, Math.round(n * 0.75));
  return { roster: us.roster.slice(), n };
}

// Gesamte Beute-, Prämien- und Wertungsrechnung eines Einsatzes. Der Aufrufer (tactical.js finish) trägt das Ergebnis ein.
//  site      { kind: crash|landed|terror|hive, ufoType }
//  won       Sieg; aborted: Rückzug (nur dann Teilbeute); kills { Art: n }; captures { Art: n } (Gefangene, nur bei Sieg)
//  corpses   [{ type, x, y }] Orte der getöteten Aliens; lzCells [{ x, y }] Landezone (Rückzug: Radius RETREAT_LOOT_RADIUS)
//  dead      verlorene Soldaten (gefallen/vermisst); civSaved/civKilled: nur Terror
//  verhoerVael/verhoerKrull/hasPlasma: erforschte Techs (Zerium +1 je UFO / Prämie +20 % / Plasma-Zellen als Beute)
// Rückgabe { score, bounty, artifacts, ammoLoot, hiveKills, hiveMonth, salvaged, notes }
export function missionRewards({ site, won, aborted = false, kills = {}, captures = {}, corpses = [], lzCells = [], monthIdx = 0, rng = rand,
  dead = 0, civSaved = 0, civKilled = 0, verhoerVael = false, verhoerKrull = false, hasPlasma = false }) {
  const artifacts = {}, ammoLoot = {}, notes = [];
  const addA = (k, n) => { if (n > 0) artifacts[k] = (artifacts[k] || 0) + n; };
  const terror = site.kind === 'terror';
  // E7: Terror-Einsätze tragen ufoType, die Stadtkarte hat aber kein UFO – keine Hüllenbeute, keine UFO-Prämie
  const hull = !!site.ufoType && !terror && !!UFOS[site.ufoType];
  const gain = (type, n, captive = false) => {
    const A = ALIENS[type]; if (!A || n <= 0) return;
    addA(captive && A.captive ? A.captive : A.corpse, n);
    if (PLASMA_WEAPONS.includes(A.weapon)) { addA('Plasmawaffe', n); if (hasPlasma) ammoLoot.pz_cell = (ammoLoot.pz_cell || 0) + n; }
  };
  let score = 0, alienBounty = 0;
  for (const [type, n] of Object.entries(kills)) {
    if (!ALIENS[type]) continue;
    score += ALIENS[type].score * n;
    alienBounty += (BOUNTY_ALIEN[type] || 0) * n;
    if (won) gain(type, n);
  }
  let capN = 0;
  if (won) for (const [type, n] of Object.entries(captures)) {
    if (!ALIENS[type] || !(n > 0)) continue;
    capN += n;
    score += Math.round(ALIENS[type].score * BOUNTY_CAPTURE_MUL) * n;
    alienBounty += Math.round((BOUNTY_ALIEN[type] || 0) * BOUNTY_CAPTURE_MUL) * n;
    gain(type, n, true);
  }
  // E6: beim Rückzug nur die Leichen nahe der Landezone
  let salvaged = 0;
  if (!won && aborted) {
    for (const k of corpses) {
      if (lzCells.some((p) => Math.max(Math.abs(p.x - k.x), Math.abs(p.y - k.y)) <= RETREAT_LOOT_RADIUS)) { gain(k.type, 1); salvaged++; }
    }
    if (salvaged) notes.push(`Geborgen (Rückzug): ${salvaged} Leichen/Wracks nahe der Landezone`);
    else if (sumValues(kills)) notes.push('Rückzug: keine Leiche in Reichweite der Landezone geborgen');
  }
  if (won && hull) {
    const type = site.ufoType, R = UFOS[type].radius, crash = site.kind === 'crash';
    addA('Alien-Legierung', R * (crash ? 2 : 3));
    addA('Zerium', (crash ? rngInt(rng, 1, 3) : rngInt(rng, 3, 6)) + (verhoerVael ? 1 : 0));
    if (type !== 'scout' || rng() < 0.3) addA('UFO-Navigationsmodul', 1);
    if (type !== 'scout' && rng() < 0.4) addA('Drohnen-Wrack', 1);
    if (RELAY_FROM[type] && (!crash || rng() < RELAY_CRASH_CHANCE)) { addA('Hyperwellen-Relais', RELAY_FROM[type]); notes.push('Hyperwellen-Relais geborgen'); }
    score += UFOS[type].score;
  }
  // E14: Fehlschlag kostet wenig, Sieg bringt Punkte
  score += won ? (terror ? 100 : 50) : (terror ? -60 : -20);
  score -= 10 * dead;
  if (terror) score += civSaved * 10 - civKilled * 15;
  // E4: Prämie nach Art; Rückzug/Niederlage zahlt die Hälfte der Alien-Summe
  let bounty = won ? alienBounty + (hull ? BOUNTY_UFO[site.ufoType] || 0 : 0) + (terror ? BOUNTY_TERROR : 0) : Math.round(alienBounty * BOUNTY_LOSS_SHARE);
  if (verhoerKrull) bounty = Math.round(bounty * 1.2);
  // E15: Hive-Abnutzung (gefallene Wachen ohne Kommandant)
  const hiveKills = site.kind === 'hive' && !won ? Object.entries(kills).filter(([t]) => t !== 'hive').reduce((a, [, n]) => a + n, 0) : 0;
  return { score, bounty, artifacts, ammoLoot, hiveKills, hiveMonth: monthIdx, salvaged, captured: capN, notes };
}

class GameState extends Emitter {
  constructor() { super(); this.c = null; this.cheats = {}; }

  newGame() { this.c = createCampaign(); this.emit('change'); }
  hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }
  save() {
    if (!this.c || this.c.lost) return; // verlorene Kampagnen werden nie wieder gespeichert
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.c)); } catch { /* Speicher nicht verfügbar */ }
    this.emit('saved', this.c);
  }
  load(data) {
    try {
      const raw = data || localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      this.c = typeof raw === 'string' ? JSON.parse(raw) : raw;
      migrateCampaign(this.c);
      this.emit('change');
      return true;
    } catch { return false; }
  }
  exportSave() { return this.c ? JSON.stringify(this.c) : null; }

  get radarRange() {
    let r = 0.32 * (1 + 0.35 * (this.c.facilities.radar - 1));
    if (this.has('navigation')) r *= 1.6;
    return r;
  }
  get labCapacity() { return 10 * this.c.facilities.lab; }
  has(tech) { return this.c.researched.includes(tech); }

  addCredits(v) { this.c.credits += v; this.emit('change'); }

  addScore(v, regionId) {
    this.c.score += v; this.c.monthScore += v;
    if (regionId) this.c.regionScore[regionId] = (this.c.regionScore[regionId] || 0) + v;
  }

  // Verfügbarkeit von Ausrüstung
  weaponAvailable(id) { const w = WEAPONS[id]; return !!w && (w.avail || (w.req && this.has(w.req)) || (this.cheats.allGear && w.cost > 0)); }
  armorAvailable(id) { const a = ARMORS[id]; return a && (a.avail || (a.req && this.has(a.req)) || this.cheats.allGear); }
  itemAvailable(id) { const it = ITEMS[id]; return !!it && (!it.req || this.has(it.req) || this.cheats.allGear); }
  ammoAvailable(id) { const it = ITEMS[id]; return !!it && it.kind === 'ammo' && this.itemAvailable(id); }
  // Preis einer kaufbaren Ware (Waffe, Rüstung, Gegenstand, Munition); null = nicht kaufbar (Gewehr, Kampfanzug, Standardmagazin)
  priceOf(id) {
    const o = WEAPONS[id] || ARMORS[id] || ITEMS[id];
    return o && o.cost > 0 && !o.free ? o.cost : null;
  }
  availableToBuy(id) { return WEAPONS[id] ? this.weaponAvailable(id) : ARMORS[id] ? this.armorAvailable(id) : this.itemAvailable(id); }
  // Kauf aus dem Shop: { ok, reason, cost }. Waren landen in c.stock.
  purchase(id, n = 1) {
    const price = this.priceOf(id);
    if (price == null) return { ok: false, reason: 'nicht kaufbar' };
    if (!this.availableToBuy(id)) return { ok: false, reason: 'nicht erforscht' };
    const cost = price * n;
    if (this.c.credits < cost) return { ok: false, reason: 'Budget', cost };
    this.c.credits -= cost;
    this.c.stock[id] = (this.c.stock[id] || 0) + n;
    this.emit('change');
    return { ok: true, cost };
  }
  grenadeAvailable(id) { const g = GRENADES[id]; return g && (!g.req || this.has(g.req) || this.cheats.allGear); }

  // needs normalisieren: ['X', {name:'Y', n:2}] -> [{name, n}]. alt = true: Alternativsatz (needsAlt, E9)
  researchNeeds(r, alt = false) { return ((alt ? r.needsAlt : r.needs) || []).map((a) => (typeof a === 'string' ? { name: a, n: 1 } : { name: a.name, n: a.n || 1 })); }
  researchPaid(id) { return !!(this.c.researchPaid && this.c.researchPaid[id]); }
  // Entfällt die Artefaktforderung, weil ein anderes Projekt erforscht ist (E13: Verhör Krull ersetzt das Relais)?
  researchWaived(r) { return !!r.waivedBy && this.has(r.waivedBy); }
  researchCost(r) { return r.cost - (this.researchWaived(r) ? (r.waivedCut || 0) : 0); }
  // Welcher Artefaktsatz würde jetzt verbraucht? [] = keiner nötig, null = Forderung nicht erfüllt
  researchPayment(r) {
    if (this.researchWaived(r)) return [];
    const have = (list) => list.every((a) => (this.c.artifacts[a.name] || 0) >= a.n);
    const main = this.researchNeeds(r);
    if (have(main)) return main;
    const alt = this.researchNeeds(r, true);
    if (alt.length && have(alt)) return alt;
    return null;
  }
  researchAvailable() {
    return RESEARCH.filter((r) => !this.has(r.id)
      && (this.researchPaid(r.id) || this.cheats.allResearch || this.researchPayment(r) !== null)
      && (r.after || []).every((t) => this.has(t)));
  }
  // Startet/wechselt ein Projekt: Artefakte werden beim ersten Start einmalig verbraucht (erst der Hauptsatz, sonst der Alternativsatz).
  startResearch(id) {
    const c = this.c, r = RESEARCH.find((x) => x.id === id);
    if (!r || this.has(id)) return false;
    c.researchProgress ||= {}; c.researchPaid ||= {};
    if (!c.researchPaid[id] && !this.cheats.allResearch) {
      const pay = this.researchPayment(r);
      if (!pay) return false;
      for (const a of pay) c.artifacts[a.name] -= a.n;
      c.researchPaid[id] = true;
    }
    if (c.research) c.researchProgress[c.research.id] = c.research.progress;
    c.research = { id, progress: c.researchProgress[id] || 0 };
    return true;
  }
  // Verkauft Artefakte; gibt den Erlös zurück (0 = nichts verkauft)
  sellArtifact(name, n = 1) {
    const have = this.c.artifacts[name] || 0, price = ARTIFACT_PRICES[name] || 0;
    const k = Math.min(have, n);
    if (!k || !price) return 0;
    this.c.artifacts[name] = have - k; this.c.credits += k * price;
    this.emit('change');
    return k * price;
  }
  // Wird ein Artefakt noch für ein offenes, unbezahltes Projekt gebraucht? (Alternativsatz nur, solange der Hauptsatz fehlt)
  artifactNeededFor(name) {
    return RESEARCH.filter((r) => {
      if (this.has(r.id) || this.researchPaid(r.id) || this.researchWaived(r)) return false;
      const main = this.researchNeeds(r), alt = this.researchNeeds(r, true);
      const mainOk = main.length > 0 && main.every((a) => (this.c.artifacts[a.name] || 0) >= a.n);
      return main.some((a) => a.name === name) || (!mainOk && alt.some((a) => a.name === name));
    });
  }

  completeResearch(id) {
    if (!this.has(id)) this.c.researched.push(id);
    if (this.c.research?.id === id) this.c.research = null;
    if (id === 'hyperwave') this.c.finalUnlocked = true;
    this.emit('research', id);
  }

  // Wird von der Geoscape-Zeitschleife pro vergangener Spielminute-Charge aufgerufen
  tickDays(days) {
    const c = this.c;
    // Forschung
    const rs = c.research && RESEARCH.find((x) => x.id === c.research.id);
    if (c.research && (!rs || this.has(rs.id))) c.research = null; // ungültiges Projekt verwerfen, Rest des Tages läuft weiter
    if (c.research) {
      const r = rs;
      const speed = this.cheats.instantResearch ? 9999 : 1;
      c.research.progress += c.scientists * days * speed;
      if (c.research.progress >= this.researchCost(r)) this.completeResearch(r.id);
    }
    // Bau
    for (const b of c.building) b.daysLeft -= days * (this.cheats.instantBuild ? 999 : 1);
    const done = c.building.filter((b) => b.daysLeft <= 0);
    c.building = c.building.filter((b) => b.daysLeft > 0);
    for (const b of done) {
      c.facilities[b.type] = (c.facilities[b.type] || 0) + 1;
      if (b.type === 'lab') c.scientists = Math.min(this.labCapacity, c.scientists + 10);
      this.emit('built', b.type);
    }
    // Heilung
    const heal = days * (c.facilities.medbay ? 2 : 1);
    for (const s of c.soldiers) if (s.wound > 0) s.wound = Math.max(0, s.wound - heal);
    // Reparatur der Abfangjäger
    for (const cr of c.crafts) {
      const max = CRAFTS[cr.type].hp;
      if (cr.status === 'repair') { cr.hp = Math.min(max, cr.hp + max * 0.25 * days); if (cr.hp >= max) cr.status = 'ready'; }
    }
  }

  // Monatsabschluss. Aufruf direkt nach dem Monatswechsel: der abgeschlossene Monat ist c.lastMonth − 1 (Monat 0 zählt nie als schlecht).
  monthlyReport() {
    const c = this.c;
    const monthIdx = (c.lastMonth || 0) - 1;
    let fundingTotal = 0;
    const lines = [];
    for (const r of REGIONS) {
      const sc = c.regionScore[r.id] || 0;
      const old = c.funding[r.id];
      let delta = 0;
      if (sc > 40) delta = Math.round(old * Math.min(0.25, sc / 800));
      else if (sc < -60) delta = -Math.round(old * Math.min(0.15, -sc / 1000));
      c.funding[r.id] = Math.min(FUNDING_MAX, Math.max(FUNDING_MIN, old + delta));
      fundingTotal += c.funding[r.id];
      lines.push({ name: r.name, funding: c.funding[r.id], delta: c.funding[r.id] - old, score: sc });
      c.regionScore[r.id] = 0;
    }
    const salaries = c.soldiers.length * SALARY_SOLDIER + c.scientists * SALARY_SCIENTIST;
    const upkeep = Object.entries(c.facilities).reduce((s, [k, n]) => s + n * (FACILITIES[k] ? UPKEEP_FACILITY : 0), 0) + c.crafts.length * UPKEEP_CRAFT;
    const net = fundingTotal - salaries - upkeep;
    c.credits += net;
    const monthScore = c.monthScore;
    c.monthScore = 0;
    const threshold = badMonthThreshold(monthIdx);
    const bad = monthIdx >= 1 && (c.credits < 0 || monthScore < threshold);
    if (bad) c.negMonths++; else c.negMonths = 0;
    return { lines, fundingTotal, salaries, upkeep, net, monthScore, threshold, bad, monthsLeft: Math.max(0, GAME_OVER_MONTHS - c.negMonths), gameOver: c.negMonths >= GAME_OVER_MONTHS };
  }

  awardXp(s, kills, survived) {
    s.missions++;
    s.kills += kills;
    s.xp += kills * 2 + (survived ? 1 : 0);
    let promoted = false;
    while (s.rank < RANKS.length - 1 && s.xp >= RANK_XP[s.rank + 1]) {
      s.rank++; promoted = true;
      s.acc += randInt(2, 5); s.tu += randInt(1, 3); s.hp += randInt(1, 3); s.react += randInt(2, 4);
    }
    return promoted;
  }
}

export const Game = new GameState();
