// Gemeinsame Figuren-Wahl (Bodenkampf, Ausrüstungsvorschau, Einstellungen) – ohne three.js, DOM-frei.
// T6-F6/F7: eine Quelle für die Automatik „Figuren & Fahrzeuge“ und für Basis/Statur je Soldat.
import { WEAPONS, ARMORS } from './data.js';

// Basen: Soldaten ohne human_m_02 (wirkt jugendlich), human_f_02 gar nicht (wirkt füllig) – Nutzervorgabe „schön/kräftig“
// (die Statur PHYSIQUE[sex] hängt in characters.js an der Basis, also gilt dieselbe Wahl überall)
export const FIG_SOLDIER = { m: ['human_m_01', 'human_m_03'], f: ['human_f_01', 'human_f_03'] };
export const FIG_CIV = ['human_m_01', 'human_m_02', 'human_m_03', 'human_f_01', 'human_f_03'];
export const FIG_BASES = ['human_m_01', 'human_m_02', 'human_m_03', 'human_f_01', 'human_f_03'];
export const hashStr = (str) => { let h = 2166136261; for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

// Einstellung „Figuren“: engine.settings.figures 'real' | 'simple'; Standard: PC real, schwache Geräte simple
export function figuresMode(engine) {
  const v = engine?.settings?.figures;
  if (v === 'real' || v === 'simple') return v;
  try {
    const nav = globalThis.navigator || {};
    const weak = (nav.deviceMemory && nav.deviceMemory < 3) || (nav.hardwareConcurrency && nav.hardwareConcurrency <= 2) || (engine?.renderer?.capabilities?.maxTextureSize || 4096) < 4096;
    return weak ? 'simple' : 'real';
  } catch { return 'real'; }
}

// Optionen für makeCharacter() eines Soldaten – stabil je Soldaten-ID (gleiche Basis, Statur, Uniform im Einsatz und in der Vorschau)
export function soldierFigureOpts(s = {}, { weapon = s.weapon, quality = 'high', fallbackName = '' } = {}) {
  const h = hashStr(s.id || s.name || fallbackName);
  const sex = s.sex === 'f' || s.look?.sex === 'f' ? 'f' : s.sex === 'm' || s.look?.sex === 'm' ? 'm' : (h % 100) < 30 ? 'f' : 'm';
  const bases = FIG_SOLDIER[sex], armorId = ARMORS[s.armor] ? s.armor : 'none';
  const w = WEAPONS[weapon] || {};
  return {
    base: bases[(h >>> 8) % bases.length], role: 'soldier', seed: h, quality,
    armor: { type: armorId, color: ARMORS[armorId].color }, weapon: w.hands === 1 ? 'pistol' : 'rifle',
    weaponColor: w.fx === 'plasma' ? 0x24302a : w.fx === 'laser' ? 0x30323c : undefined,
  };
}
