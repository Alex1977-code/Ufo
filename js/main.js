// Einstiegspunkt: Hauptmenü, Einstellungen, Moduswechsel Geoscape <-> Bodenkampf
import * as THREE from 'three';
import { Engine, UPSCALE_MODES } from './engine.js';
import { Input, padLabel } from './input.js';
import { Game } from './game.js';
import { Geoscape } from './geoscape.js';
import { Tactical } from './tactical.js';
import { Cheats } from './cheats.js';
import { Cast } from './cast.js';
import { modal, toast, confirmBox, closeAllModals, el, alertBox } from './ui.js';
import { initAudio, sfx, setVolumes, setMusicMood } from './audio.js';
import { isTouchDevice, rand } from './util.js';

const SETTINGS_KEY = 'aegis_settings_v1';
const mobile = isTouchDevice() && Math.min(screen.width, screen.height) < 900;
const DEFAULTS = {
  upscale: mobile ? 'performance' : 'quality', dynamicRes: true, targetFps: 60, sharpness: 0.5,
  bloom: true, filmGrain: !mobile, shadows: mobile ? 'med' : 'high', maxDpr: mobile ? 2 : 2,
  sfx: 0.7, music: 0.35, vibration: true, animSpeed: 1, tvMode: false, showFps: false, confirmEnd: true,
};
let settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch { /* */ }
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* */ } };

const engine = new Engine(document.getElementById('game'), settings);
Input.settings = settings;
Cast.init(engine);
setVolumes(settings.sfx, settings.music);
document.body.classList.toggle('tv', settings.tvMode || document.body.classList.contains('tv'));
document.body.dataset.device = isTouchDevice() ? 'touch' : 'mouse';
if (isTouchDevice()) Input.lastDevice = 'touch';

let geo = null, tac = null, menuScene = null;
const currentMode = () => tac || geo;
const cheats = new Cheats(currentMode);

// ---------- Hauptmenü-Hintergrund: schwebendes UFO über einem Planeten ----------
function buildMenuScene() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
  camera.position.set(0, 1.2, 9);
  const N = 3000, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(80 + rand() * 40); pos.set([v.x, v.y, v.z], i * 3); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: false, color: 0xaabbdd })));
  const planet = new THREE.Mesh(new THREE.SphereGeometry(30, 96, 64), new THREE.ShaderMaterial({
    uniforms: { t: { value: 0 } },
    vertexShader: 'varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vP = mv.xyz; gl_Position = projectionMatrix * mv; }',
    fragmentShader: `varying vec3 vN; varying vec3 vP; uniform float t;
      void main(){ vec3 V = normalize(-vP); float rim = pow(1.0 - max(dot(vN, V), 0.0), 4.0);
        vec3 L = normalize(vec3(0.6, 0.5, 0.3)); float d = max(dot(vN, L), 0.0);
        vec3 c = vec3(0.01, 0.025, 0.05) * (0.3 + d) + vec3(0.2, 0.5, 1.0) * rim * 0.9;
        float city = step(0.995, fract(sin(dot(floor(vN * 220.0), vec3(12.9, 78.2, 37.7))) * 43758.5)) * (1.0 - d);
        c += vec3(1.0, 0.6, 0.3) * city * 1.5;
        gl_FragColor = vec4(c, 1.0); }`,
  }));
  planet.position.set(0, -31.5, -6);
  scene.add(planet);
  const ufo = new THREE.Group();
  const prof = [[0, 0.55], [0.9, 0.45], [2.3, 0.08], [2.5, 0], [2.2, -0.15], [0.9, -0.35], [0, -0.38]].map(([r, y]) => new THREE.Vector2(r, y));
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xc4ccd6, metalness: 0.7, roughness: 0.28 });
  ufo.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 64), hullMat));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.85, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0a2030, metalness: 0.2, roughness: 0.05, emissive: 0x104040, emissiveIntensity: 0.6 }));
  dome.position.y = 0.4; ufo.add(dome);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.42, 0.06, 8, 96), new THREE.MeshStandardMaterial({ color: 0, emissive: 0x30ffd0, emissiveIntensity: 4 }));
  ring.rotation.x = Math.PI / 2; ufo.add(ring);
  for (let i = 0; i < 12; i++) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshStandardMaterial({ color: 0, emissive: i % 2 ? 0xff3050 : 0x40ffd0, emissiveIntensity: 5 }));
    const a = (i / 12) * Math.PI * 2; l.position.set(Math.cos(a) * 1.6, -0.25, Math.sin(a) * 1.6); ufo.add(l);
  }
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 2.2, 6, 32, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.6, 1.3), transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = -3.3; ufo.add(beam);
  ufo.position.set(2.2, 1.4, 0);
  scene.add(ufo);
  const pmrem = new THREE.PMREMGenerator(engine.renderer);
  const env = new THREE.Scene(); env.background = new THREE.Color(0x0a1220);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(5, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 4.5) })); lamp.position.set(20, 20, 10); env.add(lamp);
  const lamp2 = new THREE.Mesh(new THREE.SphereGeometry(8, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.6, 1.4) })); lamp2.position.set(0, -30, 0); env.add(lamp2);
  scene.environment = pmrem.fromScene(env, 0.02).texture;
  const key = new THREE.DirectionalLight(0xffffff, 3); key.position.set(5, 6, 4); scene.add(key);
  const rimL = new THREE.DirectionalLight(0x60c0ff, 2.5); rimL.position.set(-4, -2, -3); scene.add(rimL);
  scene.add(new THREE.AmbientLight(0x223344, 1));
  let t = 0;
  return {
    scene, camera,
    update(dt) {
      t += dt;
      ufo.rotation.y += dt * 0.6;
      ufo.position.y = 1.4 + Math.sin(t * 0.9) * 0.18;
      ufo.rotation.z = Math.sin(t * 0.7) * 0.06;
      planet.rotation.y += dt * 0.01;
      camera.position.x = Math.sin(t * 0.1) * 0.6;
      camera.lookAt(0.6, 0.3, 0);
      beam.material.opacity = 0.05 + Math.sin(t * 3) * 0.015;
    },
  };
}

// ---------- Bildschirme ----------
function showMainMenu() {
  closeAllModals();
  if (tac) { tac.dispose(); tac = null; }
  if (geo) { geo.dispose(); geo = null; }
  document.body.dataset.mode = 'menu';
  if (!menuScene) menuScene = buildMenuScene();
  engine.setMode(menuScene);
  setMusicMood('menu');
  const scr = document.getElementById('main-menu');
  scr.classList.add('active');
  const hasSave = Game.hasSave();
  scr.innerHTML = `
    <div class="mm-title"><h1>AEGIS</h1><h2>Protokoll Erstkontakt</h2><p>Taktische Alien-Abwehr · Strategie &amp; rundenbasierter Kampf</p></div>
    <div class="mm-buttons">
      ${hasSave ? '<button class="btn big-menu primary" data-m="continue">▶ Fortsetzen</button>' : ''}
      <button class="btn big-menu ${hasSave ? '' : 'primary'}" data-m="new">✦ Neues Spiel</button>
      <button class="btn big-menu" data-m="settings">⚙ Grafik &amp; Einstellungen</button>
      <button class="btn big-menu" data-m="cast">📺 Auf TV streamen</button>
      <button class="btn big-menu" data-m="help">🎮 Steuerung &amp; Anleitung</button>
      <button class="btn big-menu" data-m="cheats">☣ Cheats</button>
    </div>
    <div class="mm-foot"><span id="mm-pad">${Input.pad.connected ? '🎮 Controller verbunden' : 'Bluetooth-Controller koppeln, um mit Gamepad zu spielen'}</span><span>v1.0 · WebGL2 · Super-Resolution</span></div>`;
  scr.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => { initAudio(); sfx('click'); menuAction(b.dataset.m); }));
  setTimeout(() => { if (Input.lastDevice === 'pad' || Input.lastDevice === 'keyboard') scr.querySelector('.btn')?.focus(); }, 50);
}

async function menuAction(a) {
  if (a === 'continue') { if (Game.load()) startGeoscape(); else toast('Spielstand konnte nicht geladen werden.', 'bad'); }
  if (a === 'new') {
    if (Game.hasSave() && !(await confirmBox('Ein neues Spiel überschreibt den bisherigen Spielstand. Fortfahren?', 'Neues Spiel'))) return;
    Game.newGame();
    startGeoscape(true);
  }
  if (a === 'settings') openSettings();
  if (a === 'cast') Cast.start();
  if (a === 'help') openHelp();
  if (a === 'cheats') cheats.open();
}

function hideMainMenu() { document.getElementById('main-menu').classList.remove('active'); }

function loading(text) {
  const l = document.getElementById('loading');
  l.querySelector('span').textContent = text;
  l.classList.add('show');
  return () => l.classList.remove('show');
}

function startGeoscape(isNew) {
  hideMainMenu();
  const done = loading('Erzeuge Planetenoberfläche …');
  setTimeout(() => {
    geo = new Geoscape(engine, hooks);
    engine.setMode(geo);
    geo.activate();
    done();
    if (isNew) {
      modal({
        title: 'Lagebesprechung',
        html: `<p>Kommandant,</p><p>seit Wochen registrieren Observatorien unidentifizierte Flugobjekte. Gestern wurde eine ganze Siedlung ausgelöscht. Der Weltrat hat das Projekt <b>AEGIS</b> ins Leben gerufen – und Sie an die Spitze gestellt.</p>
          <p><b>Ihre Aufgaben:</b></p><ul><li>Errichten Sie Ihr Hauptquartier – das Radar ortet UFOs in seiner Reichweite.</li><li>Fangen Sie UFOs mit Abfangjägern ab und schicken Sie Ihren Trupp zu Absturz- und Landestellen.</li><li>Bergen Sie Alien-Technologie, erforschen Sie sie und rüsten Sie auf.</li><li>Halten Sie die Regionen zufrieden – sie finanzieren Sie monatlich.</li><li>Finden und zerstören Sie das Hive-Nest der Invasoren.</li></ul>`,
        buttons: [{ label: 'Verstanden', primary: true }],
      });
    }
  }, 60);
}

const hooks = {
  openMenu: () => openPauseMenu(),
  startMission(opts) {
    closeAllModals();
    geo.deactivate();
    const done = loading('Absetzen des Einsatztrupps …');
    setTimeout(() => {
      try {
        tac = new Tactical(engine, opts, hooks);
        engine.setMode(tac);
        tac.activate();
      } catch (e) {
        console.error(e);
        toast('Fehler beim Laden der Mission: ' + e.message, 'bad', 8000);
        tac = null; engine.setMode(geo); geo.activate();
      }
      done();
    }, 60);
  },
  endMission(site, result) {
    closeAllModals();
    tac.dispose(); tac = null;
    geo.missionDone(site, result);
    Game.save();
    if (site.kind === 'hive' && result.won) { Game.c.won = true; Game.save(); victory(); return; }
    if (!Game.c.soldiers.length) { toast('Keine Soldaten mehr! Rekrutiere neue Einheiten in der Basis.', 'warn', 6000); }
    engine.setMode(geo);
    geo.activate();
  },
  gameOver(text) { gameOver(text); },
};

function openPauseMenu() {
  const inTac = !!tac;
  modal({
    title: 'Menü',
    html: `<div class="pause-menu">
      <button class="btn wide" data-p="resume">▶ Fortsetzen</button>
      ${!inTac ? '<button class="btn wide" data-p="save">💾 Speichern</button>' : ''}
      <button class="btn wide" data-p="settings">⚙ Einstellungen</button>
      <button class="btn wide" data-p="cheats">☣ Cheats</button>
      <button class="btn wide" data-p="cast">📺 Auf TV streamen</button>
      <button class="btn wide" data-p="fullscreen">⛶ Vollbild</button>
      <button class="btn wide" data-p="help">🎮 Steuerung</button>
      ${inTac ? '<button class="btn wide danger" data-p="abort">⚑ Mission abbrechen (Rückzug)</button>' : ''}
      <button class="btn wide danger" data-p="quit">⏏ Hauptmenü</button></div>`,
  }).el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    sfx('click');
    const close = () => b.closest('.modal-backdrop').querySelector('[data-close]')?.click();
    const p = b.dataset.p;
    close();
    if (p === 'save') { Game.save(); toast('Spiel gespeichert.', 'good'); }
    if (p === 'settings') openSettings();
    if (p === 'cheats') cheats.open();
    if (p === 'cast') Cast.start();
    if (p === 'fullscreen') toggleFullscreen();
    if (p === 'help') openHelp();
    if (p === 'abort') tac?.abort();
    if (p === 'quit') {
      if (await confirmBox(inTac ? 'Zum Hauptmenü? Der Fortschritt dieser Mission geht verloren (letzter Spielstand bleibt erhalten).' : 'Zum Hauptmenü? Das Spiel wird vorher gespeichert.', 'Hauptmenü')) {
        if (!inTac) Game.save();
        showMainMenu();
      }
    }
  });
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => toast('Vollbild wird nicht unterstützt.', 'warn'));
}

function openSettings() {
  const opt = (key, label, values, fmt = (v) => v) => {
    const cur = settings[key];
    return `<div class="set-row"><label>${label}</label><div class="seg">${values.map(([v, l]) => `<button class="btn seg-b ${cur === v ? 'active' : ''}" data-k="${key}" data-v='${JSON.stringify(v)}'>${fmt(l)}</button>`).join('')}</div></div>`;
  };
  const range = (key, label, min, max, step) => `<div class="set-row"><label>${label}</label><input type="range" data-r="${key}" min="${min}" max="${max}" step="${step}" value="${settings[key]}"><output>${settings[key]}</output></div>`;
  const render = () => `
    <div class="set-tabs-info">Grafik-Pipeline: interne Auflösung <b id="s-res">${engine.internalW}×${engine.internalH}</b> → Ausgabe <b>${engine.outW}×${engine.outH}</b></div>
    <h4>Super-Resolution (DLSS-Stil)</h4>
    ${opt('upscale', 'Upscaling-Modus', Object.entries(UPSCALE_MODES).map(([k, m]) => [k, m.label]))}
    ${opt('dynamicRes', 'Dynamische Auflösung', [[true, 'An'], [false, 'Aus']])}
    ${opt('targetFps', 'Ziel-Bildrate', [[30, '30'], [60, '60'], [90, '90'], [120, '120']])}
    ${range('sharpness', 'Schärfe (RCAS)', 0, 1, 0.05)}
    <h4>Grafik</h4>
    ${opt('shadows', 'Schatten', [['off', 'Aus'], ['low', 'Niedrig'], ['med', 'Mittel'], ['high', 'Hoch']])}
    ${opt('bloom', 'Bloom / Leuchten', [[true, 'An'], [false, 'Aus']])}
    ${opt('filmGrain', 'Filmkorn & Vignette', [[true, 'An'], [false, 'Aus']])}
    ${opt('maxDpr', 'Max. Pixeldichte', [[1, '1×'], [1.5, '1,5×'], [2, '2×'], [3, '3×']])}
    ${opt('showFps', 'Leistungsanzeige', [[true, 'An'], [false, 'Aus']])}
    <h4>Spiel</h4>
    ${opt('animSpeed', 'Animationstempo', [[1, 'Normal'], [1.5, 'Schnell'], [2.5, 'Sehr schnell']])}
    ${opt('confirmEnd', 'Zugende bestätigen', [[true, 'An'], [false, 'Aus']])}
    ${opt('tvMode', 'TV-Modus (große UI)', [[true, 'An'], [false, 'Aus']])}
    ${opt('vibration', 'Vibration / Rumble', [[true, 'An'], [false, 'Aus']])}
    <h4>Audio</h4>
    ${range('sfx', 'Effekte', 0, 1, 0.05)}
    ${range('music', 'Musik', 0, 1, 0.05)}
    <p class="muted">Hinweis: NVIDIA DLSS selbst ist nur in nativen Windows-Spielen mit RTX-Grafikkarte verfügbar. AEGIS nutzt einen eigenen, plattformunabhängigen Upscaler (Kantenrekonstruktion + kontrastadaptives Schärfen + dynamische Auflösung), der auf PC, Handy und TV läuft. Schattenqualität wirkt ab dem nächsten Einsatz.</p>`;
  const h = modal({ title: '⚙ Einstellungen', wide: true, html: `<div id="set-body">${render()}</div>`, buttons: [{ label: 'Standard', close: false, action: () => { settings = Object.assign(settings, DEFAULTS); apply(); return false; } }, { label: 'Fertig', primary: true }] });
  const body = h.el.querySelector('#set-body');
  const apply = (focusSel) => {
    saveSettings();
    engine.applySettings();
    setVolumes(settings.sfx, settings.music);
    document.body.classList.toggle('tv', settings.tvMode || Cast.isReceiver);
    document.getElementById('fps').style.display = settings.showFps ? 'block' : 'none';
    body.innerHTML = render();
    if (focusSel) body.querySelector(focusSel)?.focus();
  };
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    settings[b.dataset.k] = JSON.parse(b.dataset.v); sfx('click');
    apply(`[data-k="${b.dataset.k}"][data-v='${b.dataset.v}']`);
  });
  body.addEventListener('input', (e) => {
    const r = e.target.closest('[data-r]'); if (!r) return;
    settings[r.dataset.r] = parseFloat(r.value);
    r.nextElementSibling.textContent = r.value;
    saveSettings(); engine.applySettings(); setVolumes(settings.sfx, settings.music);
  });
}

function openHelp() {
  modal({
    title: '🎮 Steuerung & Anleitung', wide: true,
    html: `<div class="grid2"><div>
      <h4>Geoscape (Weltkarte)</h4>
      <ul><li>Ziehen / Stick: Globus drehen · Mausrad / Pinch / LT-RT: Zoom</li><li>Marker antippen: UFOs abfangen, Einsätze starten</li><li>Zeit: Tasten 1–6, Leertaste = Pause · Controller ${padLabel('LB')}/${padLabel('RB')}</li><li>B Basis · R Forschung · I Abfangjäger</li></ul>
      <h4>Bodenkampf – Maus &amp; Touch</h4>
      <ul><li>Feld anklicken: Soldat bewegt sich (Touch: zweimal tippen)</li><li>Alien anklicken = Ziel wählen, erneut klicken = Feuer</li><li>Linke Maus ziehen: Kamera schwenken · Rechte Maus: drehen · Rad: Zoom</li><li>Zwei Finger: Zoom &amp; Drehen</li></ul>
      <h4>Bodenkampf – Tastatur</h4>
      <ul><li>WASD/Pfeile: Kamera · Q/E: drehen · R/V: Zoom</li><li>Tab: nächster Soldat · 1–4: Schussmodus/Granate · F: Feuer</li><li>K: Knien · T: nächstes Alien · Enter: Zug beenden · Esc: Menü</li></ul></div>
      <div><h4>Bodenkampf – Controller</h4>
      <ul><li>Linker Stick: Cursor · Rechter Stick: Kamera · ${padLabel('LT')}/${padLabel('RT')}: Zoom</li><li>${padLabel('A')}: Bewegen / Ziel / Feuer · ${padLabel('B')}: Abbrechen</li><li>${padLabel('X')}: Schussmodus · ${padLabel('Y')}: Knien</li><li>${padLabel('LB')}/${padLabel('RB')}: Soldat wechseln · Steuerkreuz ◀▶: Aliens durchschalten</li><li>Steuerkreuz ▼: Granate · ${padLabel('SELECT')}: Zug beenden · ${padLabel('START')}: Menü</li><li><b>L3 + R3: Cheat-Menü</b></li></ul>
      <h4>Regeln</h4>
      <ul><li>Jede Aktion kostet Zeiteinheiten (ZE). Gezielte Schüsse treffen besser, kosten aber mehr.</li><li>Halbe Deckung (Zäune, Felsen, Autos) senkt die Trefferchance des Gegners um 30 %.</li><li>Knien erhöht die Präzision. Unverbrauchte ZE ermöglichen Reaktionsfeuer.</li><li>Granaten und Fehlschüsse zerstören die Umgebung.</li><li>Rückzug: Soldaten in der Landezone (beim Transporter) werden evakuiert.</li></ul></div></div>`,
    buttons: [{ label: 'OK', primary: true }],
  });
}

function victory() {
  sfx('victory');
  modal({
    title: '🏆 SIEG!', closable: false, wide: true,
    html: `<h2 style="text-align:center">Das Hive-Nest ist zerstört.</h2><p>Ohne den Hive-Kommandanten bricht das kollektive Bewusstsein der Invasoren zusammen. Die verbliebenen UFOs ziehen sich zurück – die Erde ist gerettet.</p>
      <p>Gesamtwertung: <b>${Game.c.score}</b> · Missionen: ${Game.c.stats.won}/${Game.c.stats.missions} · UFOs abgeschossen: ${Game.c.stats.ufosDown} · Aliens eliminiert: ${Game.c.stats.kills} · Gefallene: ${Game.c.stats.lost}</p>`,
    buttons: [{ label: 'Weiterspielen', action: () => { engine.setMode(geo); geo.activate(); } }, { label: 'Hauptmenü', primary: true, action: () => showMainMenu() }],
  });
}
function gameOver(text) {
  sfx('defeat');
  try { localStorage.removeItem('aegis_save_v1'); } catch { /* */ }
  modal({ title: '✖ PROJEKT BEENDET', closable: false, html: `<p>${text}</p><p>Die Erde ist den Invasoren schutzlos ausgeliefert …</p>`, buttons: [{ label: 'Hauptmenü', primary: true, action: () => showMainMenu() }] });
}

// ---------- globale Ereignisse ----------
Input.on('padconnect', (gp) => {
  toast(`🎮 Controller verbunden: ${gp.id.replace(/\(.*?\)/g, '').trim().slice(0, 40)}`, 'good');
  const m = document.getElementById('mm-pad'); if (m) m.textContent = '🎮 Controller verbunden';
  initAudio();
});
Input.on('paddisconnect', () => toast('Controller getrennt.', 'warn'));
Input.on('keydown', (code) => { if (code === 'F11') { toggleFullscreen(); } });
['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => initAudio(), { once: true, passive: true }));
Cast.onRemoteSave = () => { if (!geo && !tac) startGeoscape(); };

const fpsEl = document.getElementById('fps');
fpsEl.style.display = settings.showFps ? 'block' : 'none';
let fpsT = 0;
engine.onFrame = (dt) => {
  Input.update(dt);
  fpsT -= dt;
  if (fpsT <= 0 && settings.showFps) {
    fpsT = 0.5;
    fpsEl.innerHTML = `${Math.round(engine.fps)} FPS · ${engine.frameMs.toFixed(1)} ms<br>${engine.internalW}×${engine.internalH} → ${engine.outW}×${engine.outH}<br>${UPSCALE_MODES[settings.upscale].label}${settings.dynamicRes ? ` · DRS ${Math.round(engine.dynScale * 100)}%` : ''}`;
  }
};

window.addEventListener('beforeunload', () => { if (geo && !tac) Game.save(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && geo && !tac) Game.save(); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

engine.start();
document.getElementById('boot')?.remove();
showMainMenu();
window.__aegis = { engine, Game, get geo() { return geo; }, get tac() { return tac; }, settings };
