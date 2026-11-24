// Spieldaten: Waffen, Rüstungen, Aliens, UFOs, Forschung, Anlagen
// Schema (W1 7.1): icon, dtype (proj|laser|plasma|expl|fire|stun), pierce (Faktor auf Panzerung), radius (Explosion),
// burn (Brennrunden), mag (Schuss je Magazin; fehlt = keine Munition), reload (ZE-Anteil), ammo ({ itemId: Überschreibungen },
// 1. Schlüssel = Standard), hands (1|2), heavy, noReact, tile (Bodenziel), waypoints (Lenkwaffe), aimed.guided.
export const WEAPONS = {
  pistol: { name: 'Dienstpistole P9', short: 'Pistole', icon: '🔫', dtype: 'proj', dmg: 24, fx: 'bullet', snap: { tu: 0.18, acc: 0.58 }, aimed: { tu: 0.36, acc: 0.8 }, range: 12, mag: 12, reload: 0.1, ammo: { mag: {} }, hands: 1, cost: 3000, avail: true },
  rifle: { name: 'Sturmgewehr M7', short: 'Gewehr', icon: '🪖', dtype: 'proj', dmg: 30, fx: 'bullet', snap: { tu: 0.25, acc: 0.6 }, aimed: { tu: 0.5, acc: 1.1 }, auto: { tu: 0.35, acc: 0.35, shots: 3 }, range: 22, mag: 24, reload: 0.15, ammo: { mag: {} }, hands: 2, cost: 0, avail: true },
  sniper: { name: 'Präzisionsgewehr S2', short: 'Sniper', icon: '🎯', dtype: 'proj', dmg: 40, fx: 'bullet', snap: { tu: 0.35, acc: 0.5 }, aimed: { tu: 0.6, acc: 1.35 }, range: 30, mag: 8, reload: 0.2, ammo: { mag: {} }, hands: 2, cost: 18000, avail: true },
  shotgun: { name: 'Schrotflinte K12', short: 'Schrot', icon: '💥', dtype: 'proj', dmg: 46, fx: 'bullet', snap: { tu: 0.25, acc: 0.9 }, aimed: { tu: 0.45, acc: 0.95 }, range: 9, falloff: 0.06, mag: 6, reload: 0.15, ammo: { mag: {} }, hands: 2, cost: 12000, avail: true },
  cannon: { name: 'Feldkanone FK-30', short: 'Kanone', icon: '🛡', dtype: 'proj', dmg: 50, pierce: 0.5, fx: 'bullet', snap: { tu: 0.35, acc: 0.55 }, aimed: { tu: 0.7, acc: 0.95 }, range: 24, mag: 6, reload: 0.25,
    ammo: { mag: {}, mag_he: { dmg: 44, dtype: 'expl', radius: 1.6, pierce: null }, mag_in: { dmg: 34, dtype: 'fire', radius: 1.2, burn: 3, pierce: null } }, hands: 2, heavy: true, cost: 25000, avail: true },
  autocannon: { name: 'Maschinenkanone MK-20', short: 'MK', icon: '⚙', dtype: 'proj', dmg: 40, pierce: 0.5, fx: 'bullet', snap: { tu: 0.33, acc: 0.55 }, aimed: { tu: 0.7, acc: 0.8 }, auto: { tu: 0.45, acc: 0.34, shots: 3 }, range: 22, mag: 12, reload: 0.25,
    ammo: { mag: {}, mag_he: { dmg: 32, dtype: 'expl', radius: 1.1, pierce: null }, mag_in: { dmg: 26, dtype: 'fire', radius: 0.8, burn: 2, pierce: null } }, hands: 2, heavy: true, cost: 32000, avail: true },
  rocket: { name: 'Raketenwerfer RW-3', short: 'Werfer', icon: '🚀', dtype: 'expl', dmg: 70, radius: 2.4, fx: 'rocket', snap: { tu: 0.45, acc: 0.55 }, aimed: { tu: 0.75, acc: 1.0 }, range: 30, mag: 1, reload: 0.25,
    ammo: { rk_light: {}, rk_heavy: { dmg: 105, radius: 3.2 }, rk_fire: { dmg: 50, dtype: 'fire', radius: 2.8, burn: 3 } }, hands: 2, heavy: true, noReact: true, tile: true, cost: 20000, avail: true },
  lpistol: { name: 'Laser-Pistole L2', short: 'L-Pistole', icon: '🔦', dtype: 'laser', dmg: 40, fx: 'laser', snap: { tu: 0.16, acc: 0.68 }, aimed: { tu: 0.32, acc: 0.9 }, range: 18, hands: 1, cost: 22000, req: 'laser' },
  laser: { name: 'Laser-Gewehr L4', short: 'Laser', icon: '🔴', dtype: 'laser', dmg: 52, fx: 'laser', snap: { tu: 0.25, acc: 0.68 }, aimed: { tu: 0.5, acc: 1.2 }, auto: { tu: 0.33, acc: 0.48, shots: 3 }, range: 26, hands: 2, cost: 42000, req: 'laser' },
  hlaser: { name: 'Schwerer Laser L9', short: 'S-Laser', icon: '🟥', dtype: 'laser', dmg: 85, pierce: 0.5, fx: 'laser', snap: { tu: 0.3, acc: 0.55 }, aimed: { tu: 0.6, acc: 0.95 }, range: 28, hands: 2, heavy: true, cost: 70000, req: 'hlaser' },
  ppistol: { name: 'Plasmapistole PZ-1', short: 'P-Pistole', icon: '🟢', dtype: 'plasma', dmg: 56, fx: 'plasma', snap: { tu: 0.16, acc: 0.72 }, aimed: { tu: 0.32, acc: 0.92 }, range: 20, mag: 20, reload: 0.12, ammo: { pz_cell: {} }, hands: 1, cost: 50000, req: 'plasma' },
  plasma: { name: 'Plasmagewehr', short: 'Plasma', icon: '🟩', dtype: 'plasma', dmg: 82, fx: 'plasma', snap: { tu: 0.3, acc: 0.75 }, aimed: { tu: 0.6, acc: 1.25 }, auto: { tu: 0.36, acc: 0.55, shots: 3 }, range: 28, mag: 24, reload: 0.15, ammo: { pz_cell: {} }, hands: 2, cost: 90000, req: 'plasma' },
  hplasma: { name: 'Schwerer Plasmawerfer', short: 'S-Plasma', icon: '☄', dtype: 'plasma', dmg: 118, fx: 'plasma', snap: { tu: 0.33, acc: 0.65 }, aimed: { tu: 0.6, acc: 1.1 }, auto: { tu: 0.4, acc: 0.5, shots: 3 }, range: 28, mag: 18, reload: 0.2, ammo: { pz_cell: {} }, hands: 2, heavy: true, cost: 160000, req: 'hplasma' },
  stunlauncher: { name: 'Schockwerfer SW-4', short: 'Schockw.', icon: '💫', dtype: 'stun', dmg: 90, radius: 2.0, fx: 'stun', snap: { tu: 0.35, acc: 0.6 }, aimed: { tu: 0.65, acc: 1.0 }, range: 24, mag: 1, reload: 0.2, ammo: { stunbomb: {} }, hands: 2, noReact: true, tile: true, cost: 60000, req: 'stuntech' },
  guided: { name: 'Leitwerfer LW-9', short: 'Leitwerfer', icon: '🛰', dtype: 'expl', dmg: 160, radius: 4.0, fx: 'rocket', aimed: { tu: 0.6, acc: 1, guided: true }, range: 60, waypoints: 6, mag: 1, reload: 0.3, ammo: { rk_guided: {} }, hands: 2, heavy: true, noReact: true, tile: true, cost: 150000, req: 'guidance' },
  // Alien-Waffen
  a_pistol: { name: 'Plasmapistole', dmg: 38, fx: 'plasma', snap: { tu: 0.3, acc: 0.65 }, aimed: { tu: 0.55, acc: 0.85 }, range: 20 },
  a_rifle: { name: 'Plasmagewehr', dmg: 56, fx: 'plasma', snap: { tu: 0.3, acc: 0.7 }, aimed: { tu: 0.6, acc: 1.0 }, auto: { tu: 0.36, acc: 0.5, shots: 3 }, range: 24 },
  a_beam: { name: 'Strahlemitter', dmg: 48, fx: 'beam', snap: { tu: 0.3, acc: 0.8 }, aimed: { tu: 0.5, acc: 1.0 }, range: 22 },
  a_heavy: { name: 'Hive-Kanone', dmg: 95, fx: 'plasma', snap: { tu: 0.3, acc: 0.7 }, aimed: { tu: 0.5, acc: 1.0 }, auto: { tu: 0.4, acc: 0.55, shots: 3 }, range: 26 },
  a_claw: { name: 'Klauen', dmg: 58, fx: 'melee', melee: true, snap: { tu: 0.25, acc: 1.1 }, range: 1.5 },
};

// Gürtel-Ausrüstung: jeder Soldat hat BELT_SLOTS Plätze (soldier.items = ['frag', 'smoke', null]).
// Lagerbestand liegt in Game.c.stock[<id>] (Verbrauchsgüter werden bei Benutzung abgezogen).
export const BELT_SLOTS = 3;
// Schema (W1 7.1): kind grenade|smoke|flare|medkit|mine|charge|stunrod|scanner|ammo; tu = ZE-Anteil; dtype; trigger (Mine);
// wallMul/throwRange (Ladung); acc (Schockstab); reusable (nie verbraucht); free (Munition kostenlos und unbegrenzt).
export const ITEMS = {
  frag: { name: 'Splittergranate', short: 'Splitter', kind: 'grenade', dtype: 'expl', dmg: 55, radius: 2.6, tu: 0.3, cost: 1500, icon: '💣' },
  alien: { name: 'Alien-Granate', short: 'Alien-Gr.', kind: 'grenade', dtype: 'expl', dmg: 95, radius: 3.2, tu: 0.3, cost: 9000, req: 'plasma', icon: '☢' },
  smoke: { name: 'Nebelgranate', short: 'Nebel', kind: 'smoke', radius: 2.5, turns: 3, tu: 0.25, cost: 800, icon: '☁' },
  flare: { name: 'Leuchtfackel', short: 'Fackel', kind: 'flare', radius: 6, turns: 4, tu: 0.2, cost: 500, icon: '✦' },
  medkit: { name: 'Medi-Kit', short: 'Medi-Kit', kind: 'medkit', heal: 25, uses: 3, tu: 0.3, cost: 6000, icon: '✚' },
  mine: { name: 'Sensormine SM-4', short: 'Mine', kind: 'mine', dtype: 'expl', dmg: 70, radius: 2.0, trigger: 1.5, tu: 0.3, cost: 2500, req: 'proxmine', icon: '◎' },
  charge: { name: 'Sprengladung SL-6', short: 'Ladung', kind: 'charge', dtype: 'expl', dmg: 120, radius: 3.0, wallMul: 4, throwRange: 7, tu: 0.35, cost: 4000, icon: '🧨' },
  stunrod: { name: 'Schockstab ST-1', short: 'Schockstab', kind: 'stunrod', dtype: 'stun', dmg: 55, acc: 1.1, tu: 0.25, reusable: true, cost: 6000, icon: '⚡' },
  scanner: { name: 'Bewegungsscanner BS-2', short: 'Scanner', kind: 'scanner', radius: 12, tu: 0.15, reusable: true, cost: 8000, req: 'scanner', icon: '📡' },
  // Munition (kind 'ammo'): passt zu den Waffen, die sie in WEAPONS[w].ammo führen
  mag: { name: 'Standardmagazin', short: 'Magazin', kind: 'ammo', cost: 0, free: true, icon: '▮' },
  mag_he: { name: 'Sprenggeschosse (HE)', short: 'HE', kind: 'ammo', cost: 1500, icon: '✹' },
  mag_in: { name: 'Brandgeschosse (IN)', short: 'Brand', kind: 'ammo', cost: 1200, icon: '🔥' },
  rk_light: { name: 'Leichte Rakete', short: 'L-Rakete', kind: 'ammo', cost: 1000, icon: '↑' },
  rk_heavy: { name: 'Schwere Rakete', short: 'S-Rakete', kind: 'ammo', cost: 1800, icon: '⇑' },
  rk_fire: { name: 'Brandrakete', short: 'B-Rakete', kind: 'ammo', cost: 1400, icon: '♨' },
  pz_cell: { name: 'Plasma-Zelle', short: 'P-Zelle', kind: 'ammo', cost: 2500, req: 'plasma', icon: '🔋' },
  stunbomb: { name: 'Schockbombe', short: 'Schockb.', kind: 'ammo', cost: 2000, req: 'stuntech', icon: '🌀' },
  rk_guided: { name: 'Lenkrakete', short: 'Lenkr.', kind: 'ammo', cost: 8000, req: 'guidance', icon: '⤳' },
};

// Reine Helfer (W1 4.0) – genutzt von tactical.js (W2) und Ausrüstung/Shop (W3)
export const DTYPE_NAMES = { proj: 'Projektil', laser: 'Laser', plasma: 'Plasma', expl: 'Explosiv', fire: 'Brand', stun: 'Betäubung' };
const FX_DTYPE = { bullet: 'proj', laser: 'laser', beam: 'laser', plasma: 'plasma', melee: 'proj', rocket: 'expl', stun: 'stun' };
export const dtypeOf = (w) => w.dtype || FX_DTYPE[w.fx] || 'proj';
export const ammoList = (wid) => Object.keys(WEAPONS[wid]?.ammo || {});
export const defaultLoad = (wid) => ammoList(wid)[0] ?? null;
export const ammoFits = (wid, itemId) => !!WEAPONS[wid]?.ammo?.[itemId];
// Wirksame Waffe mit geladener Munition (Überschreibungen; pierce: null entfernt den Waffenwert)
export function effWeapon(wid, ammoId) {
  const w = WEAPONS[wid]; if (!w) return null;
  const o = (ammoId && w.ammo?.[ammoId]) || {};
  const e = { ...w, ...o, dtype: o.dtype || dtypeOf(w) };
  if (o.pierce === null) delete e.pierce;
  return e;
}
export const isInstantItem = (it) => !!it && (it.kind === 'ammo' || it.kind === 'scanner');

// Veraltet – nur noch für Abwärtskompatibilität (Granaten-Werte)
export const GRENADES = {
  frag: { name: 'Splittergranate', dmg: 55, radius: 2.6, cost: 1500 },
  alien: { name: 'Alien-Granate', dmg: 95, radius: 3.2, cost: 9000, req: 'plasma' },
};

export const ARMORS = {
  none: { name: 'Kampfanzug', armor: 0, hp: 0, color: 0x4f6a52, cost: 0, avail: true },
  personal: { name: 'Legierungs-Panzerung', armor: 22, hp: 6, color: 0x3d4f6e, cost: 38000, req: 'alloys' },
  power: { name: 'Exo-Rüstung', armor: 45, hp: 15, color: 0xb8c0cc, cost: 120000, req: 'powerarmor' },
};

export const ALIENS = {
  vael: { name: 'Vael', hp: 30, armor: 4, tu: 54, acc: 46, react: 55, sight: 20, weapon: 'a_pistol', corpse: 'Vael-Leichnam', score: 10, model: 'vael', captive: 'Gefangener Vael' },
  vael_s: { name: 'Vael-Soldat', hp: 40, armor: 8, tu: 56, acc: 48, react: 60, sight: 20, weapon: 'a_rifle', corpse: 'Vael-Leichnam', score: 15, model: 'vael', captive: 'Gefangener Vael' },
  krull: { name: 'Krull', hp: 80, armor: 20, tu: 52, acc: 56, react: 50, sight: 20, weapon: 'a_rifle', corpse: 'Krull-Leichnam', score: 25, model: 'krull', captive: 'Gefangener Krull' },
  drone: { name: 'Wächterdrohne', hp: 55, armor: 28, tu: 60, acc: 56, react: 70, sight: 22, weapon: 'a_beam', corpse: 'Drohnen-Wrack', score: 25, model: 'drone', flying: true, resist: { stun: 0, fire: 0.5 }, captive: null },
  beast: { name: 'Klauenbestie', hp: 90, armor: 12, tu: 78, acc: 75, react: 40, sight: 18, weapon: 'a_claw', corpse: 'Bestien-Kadaver', score: 20, model: 'beast', resist: { fire: 1.25 }, captive: 'Gefangene Klauenbestie' },
  hive: { name: 'Hive-Kommandant', hp: 300, armor: 34, tu: 60, acc: 62, react: 70, sight: 24, weapon: 'a_heavy', corpse: 'Hive-Gewebe', score: 200, model: 'hive', boss: true, resist: { stun: 0.5 }, captive: null },
};

export const UFOS = {
  scout: { name: 'Späher', hp: 160, dmg: 14, speed: 0.0035, crew: [2, 3], roster: ['vael'], radius: 3, score: 40, detect: 0.6 },
  fighter: { name: 'Jäger', hp: 420, dmg: 36, speed: 0.0045, crew: [4, 6], roster: ['vael', 'vael_s', 'drone'], radius: 4, score: 80, detect: 0.75 },
  freighter: { name: 'Frachter', hp: 950, dmg: 60, speed: 0.003, crew: [6, 9], roster: ['vael_s', 'krull', 'drone'], radius: 5, score: 150, detect: 0.9 },
  battleship: { name: 'Schlachtschiff', hp: 2600, dmg: 140, speed: 0.005, crew: [9, 12], roster: ['krull', 'krull', 'drone', 'vael_s'], radius: 6, score: 400, detect: 1 },
};

export const CRAFTS = {
  falcon: { name: 'Falke', hp: 220, dmg: 55, acc: 0.6, speed: 0.008, cost: 300000 },
  phantom: { name: 'Phantom', hp: 450, dmg: 140, acc: 0.75, speed: 0.012, cost: 650000, req: 'propulsion' },
};

// Verkaufspreise für gelagerte Alien-Artefakte (Credits pro Stück)
export const ARTIFACT_PRICES = {
  'Vael-Leichnam': 15000, 'Krull-Leichnam': 15000, 'Plasmawaffe': 40000, 'Alien-Legierung': 8000,
  'Zerium': 30000, 'UFO-Navigationsmodul': 60000, 'Drohnen-Wrack': 25000, 'Hive-Gewebe': 100000,
  'Gefangener Vael': 30000, 'Gefangener Krull': 45000, 'Gefangene Klauenbestie': 40000,
};

// Forschungsbaum. 'needs' = Artefakte, 'after' = vorher erforschte Projekte
export const RESEARCH = [
  { id: 'laser', name: 'Laserwaffen', cost: 160, desc: 'Gebündelte Lichtenergie – präziser und stärker als Projektilwaffen. Schaltet Laser-Gewehre und Laser-Pistolen frei.' },
  { id: 'autopsy_vael', name: 'Autopsie: Vael', cost: 80, needs: ['Vael-Leichnam'], desc: 'Die schmächtigen Vael sind Klone mit verkümmertem Verdauungstrakt. Ihre Gehirne zeigen Spuren eines kollektiven Bewusstseins. +5 % Trefferchance gegen Aliens.' },
  { id: 'alloys', name: 'Alien-Legierungen', cost: 140, needs: ['Alien-Legierung'], desc: 'Ultraleichte, extrem belastbare Hüllenmetalle. Schaltet Legierungs-Panzerung frei.' },
  { id: 'plasma', name: 'Plasmawaffen', cost: 260, needs: ['Plasmawaffe'], after: ['laser'], desc: 'Durch Zerium betriebene Plasmabeschleuniger. Schaltet Plasmagewehre, Plasmapistolen, Plasma-Zellen und Alien-Granaten frei.' },
  { id: 'autopsy_krull', name: 'Autopsie: Krull', cost: 120, needs: ['Krull-Leichnam'], desc: 'Gezüchtete Kriegerkaste mit gepanzerter Haut. +5 % Trefferchance gegen Aliens.' },
  { id: 'navigation', name: 'UFO-Navigation', cost: 220, needs: ['UFO-Navigationsmodul'], desc: 'Gravimetrische Ortung: Radarreichweite +60 %, UFOs werden zuverlässiger erkannt.' },
  { id: 'propulsion', name: 'Zerium-Antrieb', cost: 280, needs: ['Zerium'], after: ['alloys'], desc: 'Antigravitationsantrieb. Schaltet den Abfangjäger „Phantom“ frei.' },
  { id: 'hplasma', name: 'Schwerer Plasmawerfer', cost: 300, after: ['plasma'], desc: 'Großkalibrige Plasmawaffe für Trupp-Unterstützung.' },
  { id: 'powerarmor', name: 'Exo-Rüstung', cost: 380, after: ['alloys', 'propulsion'], desc: 'Motorisierte Vollpanzerung mit integrierten Schilden.' },
  { id: 'drone_tech', name: 'Analyse: Wächterdrohne', cost: 160, needs: ['Drohnen-Wrack'], desc: 'Die Drohnen empfangen Befehle über eine Hyperwellen-Trägerfrequenz …' },
  { id: 'proxmine', name: 'Sensorminen', cost: 80, desc: 'Bewegungssensor-Zünder für Wurfminen. Schaltet die Sensormine SM-4 frei.' },
  { id: 'scanner', name: 'Bewegungsortung', cost: 100, desc: 'Tragbarer Doppler-Scanner. Schaltet den Bewegungsscanner BS-2 frei.' },
  { id: 'hlaser', name: 'Schwerer Laser', cost: 220, after: ['laser'], desc: 'Gekoppelte Laserkammern brennen sich durch Panzerung. Schaltet den Schweren Laser L9 frei.' },
  { id: 'verhoer_vael', name: 'Verhör: Vael', cost: 120, needs: ['Gefangener Vael'], desc: 'Der Gefangene verrät Lagerorte von Zerium in den UFOs: +1 Zerium je geborgenem UFO. Voraussetzung für Schockwerfer.' },
  { id: 'verhoer_krull', name: 'Verhör: Krull', cost: 180, needs: ['Gefangener Krull'], desc: 'Die Kriegerkaste kennt die Sprengköpfe der Hive-Flotte: Bergungsprämien +20 %. Voraussetzung für Lenkwaffen.' },
  { id: 'stuntech', name: 'Schockwerfer', cost: 240, needs: ['Plasmawaffe'], after: ['plasma', 'verhoer_vael'], desc: 'Kompakter Werfer für Betäubungsbomben. Schaltet Schockwerfer SW-4 und Schockbomben frei.' },
  { id: 'guidance', name: 'Lenkwaffen', cost: 380, needs: ['Zerium'], after: ['navigation', 'verhoer_krull'], desc: 'Zerium-Sprengkopf mit Wegpunktsteuerung. Schaltet den Leitwerfer LW-9 und Lenkraketen frei.' },
  { id: 'hyperwave', name: 'Hyperwellen-Dekodierung', cost: 480, after: ['navigation', 'drone_tech'], desc: 'Wir können den Ursprung der Befehlssignale triangulieren: das Hive-Nest der Invasoren. Schaltet die finale Mission frei.' },
];

export const FACILITIES = {
  radar: { name: 'Radarphalanx', cost: 400000, days: 10, max: 2, desc: '+35 % Radarreichweite' },
  lab: { name: 'Forschungslabor', cost: 500000, days: 14, max: 3, desc: '+10 Wissenschaftler' },
  medbay: { name: 'Lazarett', cost: 300000, days: 8, max: 1, desc: 'Doppelte Heilgeschwindigkeit' },
  hangar: { name: 'Hangar', cost: 350000, days: 10, max: 2, desc: 'Platz für weiteren Abfangjäger' },
};

export const RANKS = ['Rekrut', 'Gefreiter', 'Sergeant', 'Leutnant', 'Hauptmann', 'Oberst'];
export const RANK_XP = [0, 2, 6, 12, 20, 32];

export const REGIONS = [
  { id: 'nw', name: 'Nordwest-Pakt' },
  { id: 'ne', name: 'Ostallianz' },
  { id: 'at', name: 'Atlantische Union' },
  { id: 'sw', name: 'Südkonföderation' },
  { id: 'se', name: 'Pazifikbund' },
  { id: 'po', name: 'Polarrat' },
];
export function regionOf(lat, lon) {
  if (Math.abs(lat) > 1.05) return 'po';
  const east = lon >= 0;
  const north = lat >= 0;
  if (Math.abs(lon) < 0.6) return 'at';
  if (north) return east ? 'ne' : 'nw';
  return east ? 'se' : 'sw';
}

export const CITY_NAMES = ['Neu-Valdor', 'Kastria', 'Port Meridian', 'Solvang', 'Aurelia', 'Brennholm', 'Cordessa', 'Ostravia', 'Telmar', 'Varnhal', 'Isenmark', 'Lumara', 'Deltaport', 'Sirocco', 'Hallgrim', 'Pelagia', 'Zentralia', 'Norrvik', 'Ambaros', 'Kyrenia', 'Halcyon', 'Morvane', 'Quintara', 'Estrella'];
