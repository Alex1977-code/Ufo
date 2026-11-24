// Spieldaten: Waffen, Rüstungen, Aliens, UFOs, Forschung, Anlagen
export const WEAPONS = {
  rifle: { name: 'Sturmgewehr M7', short: 'Gewehr', dmg: 30, fx: 'bullet', snap: { tu: 0.25, acc: 0.6 }, aimed: { tu: 0.5, acc: 1.1 }, auto: { tu: 0.35, acc: 0.35, shots: 3 }, range: 22, cost: 0, avail: true },
  sniper: { name: 'Präzisionsgewehr S2', short: 'Sniper', dmg: 40, fx: 'bullet', snap: { tu: 0.35, acc: 0.5 }, aimed: { tu: 0.6, acc: 1.35 }, range: 30, cost: 18000, avail: true },
  shotgun: { name: 'Schrotflinte K12', short: 'Schrot', dmg: 46, fx: 'bullet', snap: { tu: 0.25, acc: 0.75 }, aimed: { tu: 0.45, acc: 0.95 }, range: 9, falloff: 0.09, cost: 12000, avail: true },
  laser: { name: 'Laser-Gewehr L4', short: 'Laser', dmg: 52, fx: 'laser', snap: { tu: 0.25, acc: 0.68 }, aimed: { tu: 0.5, acc: 1.2 }, auto: { tu: 0.33, acc: 0.48, shots: 3 }, range: 26, cost: 42000, req: 'laser' },
  plasma: { name: 'Plasmagewehr', short: 'Plasma', dmg: 82, fx: 'plasma', snap: { tu: 0.3, acc: 0.75 }, aimed: { tu: 0.6, acc: 1.25 }, auto: { tu: 0.36, acc: 0.55, shots: 3 }, range: 28, cost: 90000, req: 'plasma' },
  hplasma: { name: 'Schwerer Plasmawerfer', short: 'S-Plasma', dmg: 118, fx: 'plasma', snap: { tu: 0.33, acc: 0.65 }, aimed: { tu: 0.6, acc: 1.1 }, auto: { tu: 0.4, acc: 0.5, shots: 3 }, range: 28, cost: 160000, req: 'hplasma' },
  // Alien-Waffen
  a_pistol: { name: 'Plasmapistole', dmg: 38, fx: 'plasma', snap: { tu: 0.3, acc: 0.65 }, aimed: { tu: 0.55, acc: 0.85 }, range: 20 },
  a_rifle: { name: 'Plasmagewehr', dmg: 56, fx: 'plasma', snap: { tu: 0.3, acc: 0.7 }, aimed: { tu: 0.6, acc: 1.0 }, auto: { tu: 0.36, acc: 0.5, shots: 3 }, range: 24 },
  a_beam: { name: 'Strahlemitter', dmg: 48, fx: 'beam', snap: { tu: 0.3, acc: 0.8 }, aimed: { tu: 0.5, acc: 1.0 }, range: 22 },
  a_heavy: { name: 'Hive-Kanone', dmg: 95, fx: 'plasma', snap: { tu: 0.3, acc: 0.7 }, aimed: { tu: 0.5, acc: 1.0 }, auto: { tu: 0.4, acc: 0.55, shots: 3 }, range: 26 },
  a_claw: { name: 'Klauen', dmg: 58, fx: 'melee', melee: true, snap: { tu: 0.25, acc: 0.85 }, range: 1.5 },
};

// Gürtel-Ausrüstung: jeder Soldat hat BELT_SLOTS Plätze (soldier.items = ['frag', 'smoke', null]).
// Lagerbestand liegt in Game.c.stock[<id>] (Verbrauchsgüter werden bei Benutzung abgezogen).
export const BELT_SLOTS = 3;
export const ITEMS = {
  frag: { name: 'Splittergranate', short: 'Splitter', kind: 'grenade', dmg: 55, radius: 2.6, cost: 1500, icon: '💣' },
  alien: { name: 'Alien-Granate', short: 'Alien-Gr.', kind: 'grenade', dmg: 95, radius: 3.2, cost: 9000, req: 'plasma', icon: '☢' },
  smoke: { name: 'Nebelgranate', short: 'Nebel', kind: 'smoke', radius: 2.5, turns: 3, cost: 800, icon: '☁' },
  flare: { name: 'Leuchtfackel', short: 'Fackel', kind: 'flare', radius: 6, turns: 4, cost: 500, icon: '✦' },
  medkit: { name: 'Medi-Kit', short: 'Medi-Kit', kind: 'medkit', heal: 25, uses: 3, cost: 6000, icon: '✚' },
};

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
  vael: { name: 'Vael', hp: 30, armor: 4, tu: 54, acc: 46, react: 55, sight: 20, weapon: 'a_pistol', corpse: 'Vael-Leichnam', score: 10, model: 'vael' },
  vael_s: { name: 'Vael-Soldat', hp: 40, armor: 8, tu: 56, acc: 52, react: 60, sight: 20, weapon: 'a_rifle', corpse: 'Vael-Leichnam', score: 15, model: 'vael' },
  krull: { name: 'Krull', hp: 70, armor: 20, tu: 52, acc: 50, react: 50, sight: 20, weapon: 'a_rifle', corpse: 'Krull-Leichnam', score: 25, model: 'krull' },
  drone: { name: 'Wächterdrohne', hp: 55, armor: 28, tu: 60, acc: 56, react: 70, sight: 22, weapon: 'a_beam', corpse: 'Drohnen-Wrack', score: 25, model: 'drone', flying: true },
  beast: { name: 'Klauenbestie', hp: 90, armor: 12, tu: 78, acc: 75, react: 40, sight: 18, weapon: 'a_claw', corpse: 'Bestien-Kadaver', score: 20, model: 'beast' },
  hive: { name: 'Hive-Kommandant', hp: 240, armor: 40, tu: 60, acc: 62, react: 70, sight: 24, weapon: 'a_heavy', corpse: 'Hive-Gewebe', score: 200, model: 'hive', boss: true },
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

// Forschungsbaum. 'needs' = Artefakte, 'after' = vorher erforschte Projekte
export const RESEARCH = [
  { id: 'laser', name: 'Laserwaffen', cost: 160, desc: 'Gebündelte Lichtenergie – präziser und stärker als Projektilwaffen. Schaltet Laser-Gewehre frei.' },
  { id: 'autopsy_vael', name: 'Autopsie: Vael', cost: 80, needs: ['Vael-Leichnam'], desc: 'Die schmächtigen Vael sind Klone mit verkümmertem Verdauungstrakt. Ihre Gehirne zeigen Spuren eines kollektiven Bewusstseins. +5 % Trefferchance gegen Aliens.' },
  { id: 'alloys', name: 'Alien-Legierungen', cost: 140, needs: ['Alien-Legierung'], desc: 'Ultraleichte, extrem belastbare Hüllenmetalle. Schaltet Legierungs-Panzerung frei.' },
  { id: 'plasma', name: 'Plasmawaffen', cost: 260, needs: ['Plasmawaffe'], after: ['laser'], desc: 'Durch Zerium betriebene Plasmabeschleuniger. Schaltet Plasmagewehre und Alien-Granaten frei.' },
  { id: 'autopsy_krull', name: 'Autopsie: Krull', cost: 120, needs: ['Krull-Leichnam'], desc: 'Gezüchtete Kriegerkaste mit gepanzerter Haut. +5 % Trefferchance gegen Aliens.' },
  { id: 'navigation', name: 'UFO-Navigation', cost: 220, needs: ['UFO-Navigationsmodul'], desc: 'Gravimetrische Ortung: Radarreichweite +60 %, UFOs werden zuverlässiger erkannt.' },
  { id: 'propulsion', name: 'Zerium-Antrieb', cost: 280, needs: ['Zerium'], after: ['alloys'], desc: 'Antigravitationsantrieb. Schaltet den Abfangjäger „Phantom“ frei.' },
  { id: 'hplasma', name: 'Schwerer Plasmawerfer', cost: 300, after: ['plasma'], desc: 'Großkalibrige Plasmawaffe für Trupp-Unterstützung.' },
  { id: 'powerarmor', name: 'Exo-Rüstung', cost: 380, after: ['alloys', 'propulsion'], desc: 'Motorisierte Vollpanzerung mit integrierten Schilden.' },
  { id: 'drone_tech', name: 'Analyse: Wächterdrohne', cost: 160, needs: ['Drohnen-Wrack'], desc: 'Die Drohnen empfangen Befehle über eine Hyperwellen-Trägerfrequenz …' },
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
