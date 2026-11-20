// TV-Streaming: Presentation API (Chromecast / Google Cast / Miracast-fähige Empfänger).
// Das Spiel läuft auf dem TV, das Handy/der PC wird zum Controller und leitet Bluetooth-Controller weiter.
import { Input, BTN } from './input.js';
import { Game } from './game.js';
import { modal, toast, el } from './ui.js';
import { sfx } from './audio.js';

export const Cast = {
  isReceiver: !!(navigator.presentation && navigator.presentation.receiver),
  conn: null,
  supported: typeof window.PresentationRequest !== 'undefined',
  engine: null,

  init(engine) {
    this.engine = engine;
    const tvParam = new URLSearchParams(location.search).has('tv');
    if (this.isReceiver || tvParam) document.body.classList.add('tv');
    if (this.isReceiver) this.initReceiver();
  },

  // ---------- Empfänger (TV) ----------
  initReceiver() {
    const addConn = (c) => {
      this.conn = c;
      c.onmessage = (e) => {
        let msg; try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.t === 'pad') Input.remotePad = { buttons: msg.b, axes: msg.a };
        else if (msg.t === 'key') Input.injectKey(msg.code, msg.down);
        else if (msg.t === 'save' && msg.data) { Game.load(msg.data); this.onRemoteSave?.(); }
      };
      Game.on('saved', (data) => { try { c.send(JSON.stringify({ t: 'save', data: JSON.stringify(data) })); } catch { /* Verbindung beendet */ } });
    };
    navigator.presentation.receiver.connectionList.then((list) => {
      list.connections.forEach(addConn);
      list.onconnectionavailable = (e) => addConn(e.connection);
    });
  },

  // ---------- Sender (Handy/PC) ----------
  async start() {
    if (!this.supported) { this.showHelp(); return; }
    try {
      const url = location.href.split('?')[0].split('#')[0] + '?tv=1';
      const req = new PresentationRequest([url]);
      const conn = await req.start();
      this.attachSender(conn);
    } catch (err) {
      if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') return;
      this.showHelp(err?.name === 'NotFoundError' ? 'Kein kompatibler Bildschirm gefunden.' : 'Streaming konnte nicht gestartet werden.');
    }
  },

  attachSender(conn) {
    this.conn = conn;
    const onConnect = () => {
      toast('📺 Verbunden – das Spiel läuft jetzt auf dem TV.', 'good');
      if (Game.c) { Game.save(); conn.send(JSON.stringify({ t: 'save', data: Game.exportSave() })); }
      this.controllerMode(true);
    };
    if (conn.state === 'connected') onConnect(); else conn.onconnect = onConnect;
    conn.onmessage = (e) => { try { const m = JSON.parse(e.data); if (m.t === 'save') { Game.load(m.data); Game.save(); } } catch { /* */ } };
    conn.onclose = conn.onterminate = () => { this.controllerMode(false); this.conn = null; toast('TV-Verbindung beendet.', 'warn'); };
  },

  send(obj) { try { if (this.conn?.state === 'connected') this.conn.send(JSON.stringify(obj)); } catch { /* */ } },

  controllerMode(on) {
    let ov = document.getElementById('remote-ctrl');
    if (!on) { ov?.remove(); this.engine.paused = false; clearInterval(this._padTimer); this._unkey?.(); return; }
    this.engine.paused = true;
    ov = el('div', 'remote-ctrl');
    ov.id = 'remote-ctrl';
    ov.innerHTML = `
      <div class="rc-top"><b>📺 TV-Controller</b><span>Das Spiel läuft auf dem Fernseher. Ein gekoppelter Bluetooth-Controller wird automatisch weitergeleitet.</span><button class="btn danger" id="rc-stop">Trennen</button></div>
      <div class="rc-pad">
        <div class="rc-left"><div class="rc-stick" id="rc-stick"><i></i></div>
          <div class="rc-dpad">${['UP', 'LEFT', 'RIGHT', 'DOWN'].map((b) => `<button data-b="${b}">${{ UP: '▲', DOWN: '▼', LEFT: '◀', RIGHT: '▶' }[b]}</button>`).join('')}</div></div>
        <div class="rc-mid"><button data-b="LB">LB</button><button data-b="RB">RB</button><button data-b="LT">LT</button><button data-b="RT">RT</button><button data-b="SELECT">⧉ Zug</button><button data-b="START">☰ Menü</button></div>
        <div class="rc-right">${['Y', 'X', 'B', 'A'].map((b) => `<button class="face f${b}" data-b="${b}">${b}</button>`).join('')}</div>
      </div>`;
    document.body.appendChild(ov);
    const vb = new Array(17).fill(0), va = [0, 0, 0, 0];
    ov.querySelectorAll('[data-b]').forEach((b) => {
      const i = BTN.indexOf(b.dataset.b);
      const set = (v) => (e) => { e.preventDefault(); vb[i] = v; b.classList.toggle('down', !!v); if (v) navigator.vibrate?.(15); };
      b.addEventListener('pointerdown', set(1)); b.addEventListener('pointerup', set(0)); b.addEventListener('pointerleave', set(0)); b.addEventListener('pointercancel', set(0));
    });
    const stick = ov.querySelector('#rc-stick'), knob = stick.querySelector('i');
    const sm = (e) => {
      const r = stick.getBoundingClientRect();
      let x = (e.clientX - r.left) / r.width * 2 - 1, y = (e.clientY - r.top) / r.height * 2 - 1;
      const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
      va[0] = x; va[1] = y; knob.style.transform = `translate(${x * 40}px, ${y * 40}px)`;
    };
    stick.addEventListener('pointerdown', (e) => { stick.setPointerCapture(e.pointerId); sm(e); });
    stick.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') sm(e); });
    stick.addEventListener('pointerup', () => { va[0] = va[1] = 0; knob.style.transform = ''; });
    ov.querySelector('#rc-stop').onclick = () => { sfx('click'); try { this.conn?.terminate(); } catch { /* */ } this.controllerMode(false); };
    // Physischen Controller + virtuelle Tasten zusammenführen und senden
    this._padTimer = setInterval(() => {
      const gp = [...(navigator.getGamepads?.() || [])].find((g) => g && g.connected);
      const b = vb.slice(), a = va.slice();
      if (gp) { gp.buttons.forEach((bt, i) => { if (i < 17) b[i] = Math.max(b[i], bt.value || (bt.pressed ? 1 : 0)); }); gp.axes.forEach((v, i) => { if (i < 4 && Math.abs(v) > Math.abs(a[i])) a[i] = v; }); }
      this.send({ t: 'pad', b: b.map((v) => Math.round(v * 100) / 100), a: a.map((v) => Math.round(v * 100) / 100) });
    }, 33);
    const kd = (e) => { this.send({ t: 'key', code: e.code, down: true }); };
    const ku = (e) => { this.send({ t: 'key', code: e.code, down: false }); };
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    this._unkey = () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  },

  showHelp(reason) {
    modal({
      title: '📺 Auf TV streamen', wide: true,
      html: `${reason ? `<p class="warn">${reason}</p>` : ''}
        <p>AEGIS unterstützt zwei Wege auf den Fernseher:</p>
        <h4>1. Direktes Streaming (empfohlen)</h4>
        <p>In Chrome/Edge (Android, Windows, macOS, ChromeOS) startet „Auf TV streamen“ das Spiel direkt auf einem Chromecast / Google-TV / Cast-fähigen Fernseher. Dein Gerät wird dann zum Controller; ein per Bluetooth gekoppelter Controller wird automatisch weitergeleitet.</p>
        <h4>2. Bildschirm spiegeln</h4>
        <ul>
          <li><b>Android:</b> Schnelleinstellungen → „Bildschirm übertragen“ / „Smart View“</li>
          <li><b>iPhone/iPad:</b> Kontrollzentrum → „Bildschirmsynchronisierung“ (AirPlay)</li>
          <li><b>Windows:</b> <kbd>Win</kbd> + <kbd>K</kbd> (Miracast) oder Chrome-Menü → „Streamen…“</li>
          <li><b>macOS:</b> Kontrollzentrum → Bildschirmsynchronisierung (AirPlay)</li>
          <li><b>HDMI:</b> Kabel anschließen und Vollbild aktivieren</li>
        </ul>
        <p class="muted">Tipp: Aktiviere in den Einstellungen den <b>TV-Modus</b> für größere Schrift und Bedienelemente. Bluetooth-Controller (Xbox, PlayStation, Switch Pro, 8BitDo …) koppelst du in den Bluetooth-Einstellungen deines Geräts – sie werden automatisch erkannt.</p>`,
      buttons: [
        { label: 'Vollbild', action: () => { document.documentElement.requestFullscreen?.().catch(() => {}); } },
        { label: 'OK', primary: true },
      ],
    });
  },
};
