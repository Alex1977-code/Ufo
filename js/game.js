// Kampagnenzustand: Finanzen, Soldaten, Forschung, Lager, Speichern/Laden
import { WEAPONS, ARMORS, GRENADES, ITEMS, BELT_SLOTS, RESEARCH, FACILITIES, RANKS, RANK_XP, REGIONS, CRAFTS } from './data.js';
import { randInt, randomName, rand, Emitter } from './util.js';

const SAVE_KEY = 'aegis_save_v1';

export function newSoldier() {
  return {
    id: 's' + Math.floor(rand() * 1e9).toString(36),
    name: randomName(),
    rank: 0, xp: 0, kills: 0, missions: 0,
    tu: randInt(50, 62), hp: randInt(38, 48), acc: randInt(45, 72), react: randInt(35, 65), brave: randInt(30, 70),
    wound: 0, // Heilungstage verbleibend
    weapon: 'rifle', armor: 'none', grenades: 1, items: ['frag', 'smoke', null],
    look: { skin: [0xf1c27d, 0xc68642, 0x8d5524, 0xe0ac69, 0xffdbac][randInt(0, 4)], hair: [0x2c1b10, 0x6b4423, 0xd4b06a, 0x111111, 0x8a3b12][randInt(0, 4)] },
  };
}

export function createCampaign() {
  return {
    v: 1,
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
    stock: { sniper: 1, shotgun: 1, frag: 10, smoke: 6, flare: 4, medkit: 2 }, // gekaufte Ausrüstung (Waffen sind wiederverwendbar)
    score: 0, monthScore: 0,
    regionScore: Object.fromEntries(REGIONS.map((r) => [r.id, 0])),
    funding: Object.fromEntries(REGIONS.map((r) => [r.id, 160000])),
    lastMonth: 0,
    stats: { missions: 0, won: 0, ufosDown: 0, kills: 0, lost: 0 },
    negMonths: 0,
    finalUnlocked: false,
    won: false,
  };
}

// Ältere Spielstände auf das Gürtel-System umstellen
export function migrateCampaign(c) {
  for (const s of c.soldiers || []) {
    if (!Array.isArray(s.items)) {
      s.items = Array(BELT_SLOTS).fill(null);
      for (let i = 0; i < Math.min(BELT_SLOTS, s.grenades || 0); i++) s.items[i] = 'frag';
    }
    while (s.items.length < BELT_SLOTS) s.items.push(null);
  }
  c.stock ||= {};
  if (c.stock.smoke == null) c.stock.smoke = 6;
  if (c.stock.flare == null) c.stock.flare = 4;
  if (c.stock.medkit == null) c.stock.medkit = 2;
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
  grenadeAvailable(id) { const g = GRENADES[id]; return g && (!g.req || this.has(g.req) || this.cheats.allGear); }

  researchAvailable() {
    return RESEARCH.filter((r) => !this.has(r.id)
      && (r.needs || []).every((a) => (this.c.artifacts[a] || 0) > 0 || this.cheats.allResearch)
      && (r.after || []).every((t) => this.has(t)));
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
    if (c.research) {
      const r = RESEARCH.find((x) => x.id === c.research.id);
      if (!r || this.has(r.id)) { c.research = null; return; }
      const speed = this.cheats.instantResearch ? 9999 : 1;
      c.research.progress += c.scientists * days * speed;
      if (c.research.progress >= r.cost) this.completeResearch(r.id);
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

  monthlyReport() {
    const c = this.c;
    const lines = [];
    let fundingTotal = 0;
    for (const r of REGIONS) {
      const sc = c.regionScore[r.id] || 0;
      const old = c.funding[r.id];
      let delta = 0;
      if (sc > 40) delta = Math.round(old * Math.min(0.25, sc / 800));
      else if (sc < -20) delta = -Math.round(old * Math.min(0.3, -sc / 500));
      c.funding[r.id] = Math.max(0, old + delta);
      fundingTotal += c.funding[r.id];
      lines.push({ name: r.name, funding: c.funding[r.id], delta, score: sc });
      c.regionScore[r.id] = 0;
    }
    const salaries = c.soldiers.length * 20000 + c.scientists * 25000;
    const upkeep = Object.entries(c.facilities).reduce((s, [k, n]) => s + n * (FACILITIES[k] ? 40000 : 0), 0) + c.crafts.length * 60000;
    const net = fundingTotal - salaries - upkeep;
    c.credits += net;
    const monthScore = c.monthScore;
    c.monthScore = 0;
    if (c.credits < 0 || monthScore < -300) c.negMonths++; else c.negMonths = 0;
    return { lines, fundingTotal, salaries, upkeep, net, monthScore, gameOver: c.negMonths >= 2 };
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
