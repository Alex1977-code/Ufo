// Einheitliche Eingabe: Tastatur, Bluetooth-/USB-Controller (Gamepad API), Fern-Eingabe vom TV-Sender
import { Emitter } from './util.js';

export const BTN = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'SELECT', 'START', 'L3', 'R3', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'HOME'];

class InputSystem extends Emitter {
  constructor() {
    super();
    this.keys = new Set();
    this.pad = { connected: false, id: '', buttons: new Array(17).fill(0), axes: [0, 0, 0, 0], type: 'xbox' };
    this.prev = new Array(17).fill(0);
    this.remotePad = null; // vom Smartphone/PC weitergeleiteter Controllerzustand (TV-Modus)
    this.navRepeat = 0;
    this.navDir = null;
    this.lastDevice = 'mouse';
    this.uiScope = () => null; // wird von ui.js gesetzt
    window.addEventListener('keydown', (e) => this._key(e.code, true, e));
    window.addEventListener('keyup', (e) => this._key(e.code, false, e));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', (e) => {
      this.pad.connected = true; this.pad.id = e.gamepad.id; this.pad.type = this._padType(e.gamepad.id);
      this.emit('padconnect', e.gamepad);
    });
    window.addEventListener('gamepaddisconnected', () => {
      const any = [...(navigator.getGamepads?.() || [])].some((g) => g && g.connected);
      if (!any) { this.pad.connected = false; this.emit('paddisconnect'); }
    });
    window.addEventListener('pointerdown', () => { this.setDevice('mouse'); }, true);
  }

  _padType(id) {
    const s = id.toLowerCase();
    if (s.includes('054c') || s.includes('playstation') || s.includes('dualsense') || s.includes('dualshock')) return 'ps';
    if (s.includes('057e') || s.includes('nintendo') || s.includes('pro controller')) return 'nintendo';
    return 'xbox';
  }

  setDevice(d) {
    if (this.lastDevice !== d) { this.lastDevice = d; document.body.dataset.device = d; this.emit('device', d); }
  }

  _key(code, down, e) {
    if (e && (e.target?.tagName === 'INPUT' || e.target?.tagName === 'SELECT')) return;
    if (down) {
      const repeat = this.keys.has(code);
      this.keys.add(code);
      this.setDevice('keyboard');
      if (!repeat) this.emit('keydown', code, e);
    } else {
      this.keys.delete(code);
      this.emit('keyup', code, e);
    }
  }
  injectKey(code, down) { this._key(code, down, null); }
  isDown(code) { return this.keys.has(code); }

  btn(name) { return this.pad.buttons[BTN.indexOf(name)] > 0.5; }
  axis(i) {
    const v = this.pad.axes[i] || 0;
    return Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82;
  }
  trigger(name) { return this.pad.buttons[BTN.indexOf(name)] || 0; }

  rumble(strong = 0.5, weak = 0.5, ms = 150) {
    if (!this.settings?.vibration) return;
    const gps = navigator.getGamepads?.() || [];
    for (const g of gps) {
      try { g?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }); } catch { /* nicht unterstützt */ }
    }
    if (this.lastDevice === 'touch' || this.lastDevice === 'mouse') { try { navigator.vibrate?.(Math.min(ms, 120)); } catch { /* */ } }
  }

  update(dt) {
    const gps = navigator.getGamepads?.() || [];
    let gp = null;
    for (const g of gps) if (g && g.connected) { gp = g; break; }
    const b = this.pad.buttons, a = this.pad.axes;
    b.fill(0); a.fill(0);
    if (gp) {
      this.pad.connected = true;
      gp.buttons.forEach((bt, i) => { if (i < 17) b[i] = bt.value || (bt.pressed ? 1 : 0); });
      for (let i = 0; i < 4; i++) a[i] = gp.axes[i] || 0;
    }
    if (this.remotePad) {
      this.remotePad.buttons?.forEach((v, i) => { if (i < 17) b[i] = Math.max(b[i], v); });
      this.remotePad.axes?.forEach((v, i) => { if (i < 4 && Math.abs(v) > Math.abs(a[i])) a[i] = v; });
    }
    let anyActive = false;
    for (let i = 0; i < 17; i++) {
      const now = b[i] > 0.5, was = this.prev[i] > 0.5;
      if (now && !was) { this._padPress(BTN[i]); anyActive = true; }
      if (!now && was) this.emit('padup', BTN[i]);
      this.prev[i] = b[i];
    }
    if (a.some((v) => Math.abs(v) > 0.4)) anyActive = true;
    if (anyActive) this.setDevice('pad');
    this._stickNav(dt);
  }

  _padPress(name) {
    // Cheat-Kombination: L3 + R3
    if ((name === 'L3' && this.btn('R3')) || (name === 'R3' && this.btn('L3'))) { this.emit('cheatcombo'); return; }
    const scope = this.uiScope();
    if (scope) {
      if (['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(name)) { this.navigate(scope, name); return; }
      if (name === 'A') { const el = document.activeElement; if (el && scope.contains(el)) { el.click(); } else this.navigate(scope, 'DOWN'); return; }
      if (name === 'B') { scope.dispatchEvent(new CustomEvent('navback')); return; }
      if (name === 'LB' || name === 'RB') { scope.dispatchEvent(new CustomEvent('navtab', { detail: name === 'RB' ? 1 : -1 })); return; }
    }
    this.emit('pad', name);
  }

  _stickNav(dt) {
    const scope = this.uiScope();
    if (!scope) { this.navDir = null; return; }
    const x = this.pad.axes[0], y = this.pad.axes[1];
    let dir = null;
    if (Math.abs(x) > 0.6 || Math.abs(y) > 0.6) dir = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'RIGHT' : 'LEFT') : (y > 0 ? 'DOWN' : 'UP');
    if (!dir) { this.navDir = null; return; }
    if (dir !== this.navDir) { this.navDir = dir; this.navRepeat = 0.4; this.navigate(scope, dir); return; }
    this.navRepeat -= dt;
    if (this.navRepeat <= 0) { this.navRepeat = 0.14; this.navigate(scope, dir); }
  }

  // Räumliche Fokus-Navigation für Menüs
  navigate(scope, dir) {
    const items = [...scope.querySelectorAll('button:not([disabled]), [data-nav], input[type=range], select')].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const cur = document.activeElement;
    if (!cur || !scope.contains(cur) || !items.includes(cur)) { items[0].focus(); items[0].scrollIntoView?.({ block: 'nearest' }); return; }
    if (cur.type === 'range' && (dir === 'LEFT' || dir === 'RIGHT')) {
      const step = parseFloat(cur.step || '1') || 1;
      cur.value = String(parseFloat(cur.value) + (dir === 'RIGHT' ? step : -step));
      cur.dispatchEvent(new Event('input', { bubbles: true }));
      cur.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const r0 = cur.getBoundingClientRect();
    const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of items) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const dx = x - cx, dy = y - cy;
      let primary, secondary;
      if (dir === 'UP') { if (dy >= -2) continue; primary = -dy; secondary = Math.abs(dx); }
      else if (dir === 'DOWN') { if (dy <= 2) continue; primary = dy; secondary = Math.abs(dx); }
      else if (dir === 'LEFT') { if (dx >= -2) continue; primary = -dx; secondary = Math.abs(dy); }
      else { if (dx <= 2) continue; primary = dx; secondary = Math.abs(dy); }
      const score = primary + secondary * 2.2;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) { best.focus(); best.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }
  }
}

export const Input = new InputSystem();

// Controller-Beschriftung je nach Hersteller
export function padLabel(btn) {
  const t = Input.pad.type;
  const maps = {
    xbox: { A: 'Ⓐ', B: 'Ⓑ', X: 'Ⓧ', Y: 'Ⓨ', LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT', SELECT: '⧉', START: '☰' },
    ps: { A: '✕', B: '○', X: '□', Y: '△', LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2', SELECT: 'Share', START: 'Options' },
    nintendo: { A: 'B', B: 'A', X: 'Y', Y: 'X', LB: 'L', RB: 'R', LT: 'ZL', RT: 'ZR', SELECT: '−', START: '+' },
  };
  return maps[t]?.[btn] || btn;
}
