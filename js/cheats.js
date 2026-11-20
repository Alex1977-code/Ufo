// Cheat-Menü: öffnen mit F10, ^ (Zirkumflex/Backquote), Controller L3+R3 oder über das Menü
import { Game } from './game.js';
import { RESEARCH } from './data.js';
import { toast } from './ui.js';
import { sfx } from './audio.js';
import { Input, padLabel } from './input.js';

const TOGGLES = [
  ['god', 'Gottmodus', 'Kein Schaden für Soldaten & Jäger, kein Game Over'],
  ['infTU', 'Unendliche Zeiteinheiten', 'Soldaten können beliebig oft handeln'],
  ['aimbot', '100 % Trefferchance', 'Jeder Schuss und Wurf trifft'],
  ['oneHit', 'Ein-Treffer-Kills', 'Jeder Treffer vernichtet den Gegner (auch in der Luft)'],
  ['revealMap', 'Karte aufdecken', 'Kein Nebel des Krieges im Bodenkampf'],
  ['noReaction', 'Kein Alien-Reaktionsfeuer', 'Aliens schießen nicht während deines Zuges'],
  ['revealUfos', 'Alle UFOs orten', 'Weltweite Radarabdeckung'],
  ['instantResearch', 'Sofort-Forschung', 'Projekte werden am nächsten Tag fertig'],
  ['instantBuild', 'Sofort-Bau', 'Anlagen sind am nächsten Tag fertig'],
  ['allGear', 'Alle Ausrüstung', 'Alle Waffen/Rüstungen frei & unbegrenzt'],
  ['allResearch', 'Forschung ohne Artefakte', 'Alle Projekte sofort verfügbar'],
];

const CODES = {
  GELDREGEN: () => { if (!Game.c) return null; Game.addCredits(5000000); return '+5.000.000 ¢'; },
  UNSTERBLICH: () => { Game.cheats.god = true; return 'Gottmodus aktiv'; },
  ADLERAUGE: () => { Game.cheats.revealMap = true; Game.cheats.revealUfos = true; return 'Alles aufgedeckt'; },
  EINSTEIN: () => { if (!Game.c) return null; RESEARCH.forEach((r) => Game.completeResearch(r.id)); return 'Gesamte Forschung abgeschlossen'; },
};

export class Cheats {
  constructor(getMode) {
    this.getMode = getMode;
    this.panel = document.getElementById('cheat-panel');
    this.render();
    this.panel.addEventListener('navback', () => this.close());
    Input.on('cheatcombo', () => this.toggle());
    Input.on('keydown', (code) => { if (code === 'F10' || code === 'Backquote' || code === 'IntlBackslash') this.toggle(); });
  }
  render() {
    const c = Game.cheats;
    const geo = !!this.getMode()?.ufos;
    const tac = !!this.getMode()?.units;
    this.panel.innerHTML = `
      <div class="cheat-head"><b>☣ CHEAT-KONSOLE</b><button class="btn x" data-close>✕</button></div>
      <div class="cheat-body">
        <div class="cheat-grid">${TOGGLES.map(([k, n, d]) => `<button class="btn cheat-tog ${c[k] ? 'on' : ''}" data-tog="${k}"><b>${c[k] ? '◉' : '○'} ${n}</b><small>${d}</small></button>`).join('')}</div>
        <h4>Sofort-Aktionen</h4>
        <div class="cheat-grid">
          <button class="btn" data-act="money">+1.000.000 ¢</button>
          <button class="btn" data-act="research">Gesamte Forschung abschließen</button>
          <button class="btn" data-act="heal" ${!Game.c ? 'disabled' : ''}>Alle Soldaten heilen</button>
          <button class="btn" data-act="ufo" ${!geo ? 'disabled' : ''}>UFO erscheinen lassen</button>
          <button class="btn" data-act="terror" ${!geo ? 'disabled' : ''}>Terrorangriff auslösen</button>
          <button class="btn" data-act="hive" ${!geo ? 'disabled' : ''}>Hive-Nest aufdecken</button>
          <button class="btn" data-act="killall" ${!tac ? 'disabled' : ''}>Alle Aliens vernichten</button>
          <button class="btn" data-act="win" ${!tac ? 'disabled' : ''}>Mission sofort gewinnen</button>
        </div>
        <h4>Cheat-Code</h4>
        <div class="cheat-code"><input id="cheat-input" placeholder="Code eingeben …" autocomplete="off" spellcheck="false"><button class="btn" data-act="code">OK</button></div>
        <p class="muted">Öffnen/Schließen: F10 oder ^ · Controller: ${padLabel('L3') || 'L3'} + R3 gleichzeitig drücken</p>
      </div>`;
    this.panel.querySelector('[data-close]').onclick = () => this.close();
    this.panel.querySelectorAll('[data-tog]').forEach((b) => (b.onclick = () => {
      const k = b.dataset.tog; c[k] = !c[k]; sfx('click');
      if (k === 'revealMap') this.getMode()?.cheatReveal?.();
      this.refresh(b.dataset.tog);
    }));
    this.panel.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => this.action(b.dataset.act)));
    this.panel.querySelector('#cheat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.action('code'); e.stopPropagation(); });
    document.body.classList.toggle('cheats-on', Object.values(c).some(Boolean));
  }
  refresh(focusKey) {
    this.render();
    if (focusKey) this.panel.querySelector(`[data-tog="${focusKey}"]`)?.focus();
  }
  action(a) {
    const m = this.getMode();
    const focusAct = document.activeElement?.dataset?.act;
    if ((!Game.c || !m) && a !== 'code') { toast('Starte oder lade zuerst ein Spiel.', 'warn'); return; }
    sfx('select');
    switch (a) {
      case 'money': Game.addCredits(1000000); toast('+1.000.000 ¢', 'good'); break;
      case 'research': RESEARCH.forEach((r) => Game.completeResearch(r.id)); toast('Gesamte Forschung abgeschlossen.', 'good'); break;
      case 'heal': Game.c.soldiers.forEach((s) => (s.wound = 0)); m?.cheatHeal?.(); toast('Alle Soldaten geheilt.', 'good'); break;
      case 'ufo': m?.spawnUfo?.(3); Game.cheats.revealUfos = true; toast('UFO erzeugt (Ortung aktiviert).', 'good'); break;
      case 'terror': m?.spawnUfo?.(3, 'terror'); Game.cheats.revealUfos = true; toast('Terror-UFO unterwegs!', 'warn'); break;
      case 'hive': Game.completeResearch('hyperwave'); m?.spawnHive?.(); if (!m?.spawnHive) toast('Das Hive-Nest erscheint auf der Weltkarte.', 'good'); break;
      case 'killall': this.close(); m?.cheatKillAll?.(); break;
      case 'win': this.close(); m?.cheatWin?.(); break;
      case 'code': {
        const inp = this.panel.querySelector('#cheat-input');
        const fn = CODES[inp.value.trim().toUpperCase()];
        const res = fn ? fn() : undefined;
        if (res) toast('Code akzeptiert: ' + res, 'good');
        else if (fn) { toast('Dieser Code wirkt erst in einem laufenden Spiel.', 'warn'); sfx('deny'); }
        else { toast('Unbekannter Code.', 'warn'); sfx('deny'); }
        inp.value = '';
        break;
      }
    }
    m?.updateHud?.(true);
    m?.refreshUi?.();
    if (this.panel.classList.contains('open')) { this.refresh(); if (focusAct) this.panel.querySelector(`[data-act="${focusAct}"]`)?.focus(); }
  }
  open() { this.render(); this.panel.classList.add('open'); sfx('select'); setTimeout(() => this.panel.querySelector('[data-tog]')?.focus(), 30); }
  close() { this.panel.classList.remove('open'); document.activeElement?.blur?.(); }
  toggle() { if (this.panel.classList.contains('open')) this.close(); else this.open(); }
}
