// Kleine, DOM-freie Bodenkampf-Regeln (aus tactical.js ausgelagert, damit sie ohne Browser testbar sind).
import { WALLS } from './tacmap.js';

// T6-F11: Tod einer Einheit zählen – nach Missionsende (finish() hat Prämie/Beute/Wertung/XP schon berechnet) zählt nichts mehr,
// sonst widerspräche der Einsatzbericht (Kills je Soldat) der Abrechnung. Liefert true, wenn gezählt wurde.
export function recordKill(result, t, src, ended) {
  if (ended) return false;
  if (src && src !== t && t.team === 'alien' && src.team === 'player') src.kills = (src.kills || 0) + 1;
  if (t.team === 'alien') {
    result.kills[t.spec] = (result.kills[t.spec] || 0) + 1;
    result.corpses.push({ type: t.spec, x: t.x, y: t.y }); // E6: Teilbeute beim Rückzug
  } else if (t.team !== 'player') result.civKilled = (result.civKilled || 0) + 1;
  return true;
}

// T6-F14: Zerstörtes Feld eines langen Fahrzeugs (wall.vid). Solange das Wrackmodell über der Reihe steht, bleibt das Feld
// Schutt: nicht begehbar, halbe Deckung (WALLS.wreck), nicht weiter zerstörbar (rowWreck). Liefert { vid, last } –
// last = kein intaktes Feld der Reihe mehr übrig (dann verschwindet das Modell, danach clearRowWreck()).
export function wreckRowCell(map, x, y) {
  const c = map.at(x, y), w = c?.wall;
  if (!w || w.vid == null) return null;
  const vid = w.vid;
  c.wall = { type: 'wreck', hp: WALLS.wreck.hp, rowWreck: vid, rot: w.rot };
  const last = !map.cells.some((cc) => cc.wall?.vid === vid);
  return { vid, last };
}
// Wrackmodell entfernt → alle Schuttfelder der Reihe werden frei. Liefert die Anzahl freigegebener Felder.
export function clearRowWreck(map, vid) {
  let n = 0;
  for (const c of map.cells) if (c.wall?.rowWreck === vid) { c.wall = null; n++; }
  return n;
}
