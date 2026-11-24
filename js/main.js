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
  upscaler: 'temporal', upscale: mobile ? 'performance' : 'quality', dynamicRes: true, targetFps: 60, sharpness: 0.5,
  ao: mobile ? 'off' : 'high',
  // Energiesparen: Bildratenlimit (0 = aus) – Handy 30, sonst 60; Leerlauf-Drosselung an
  fpsLimit: Math.min(screen.width, screen.height) < 700 ? 30 : 60, idleSaver: true,
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
  pmrem.dispose();
  env.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
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

let geoStarting = false;
function startGeoscape(isNew) {
  if (geoStarting) return;
  geoStarting = true;
  closeAllModals();
  hideMainMenu();
  if (tac) { tac.dispose(); tac = null; }
  if (geo) { geo.dispose(); geo = null; }
  const done = loading('Erzeuge Planetenoberfläche …');
  setTimeout(() => {
    geoStarting = false;
    try {
      geo = new Geoscape(engine, hooks);
      engine.setMode(geo);
      geo.activate();
    } catch (e) {
      console.error(e);
      done();
      geo = null;
      toast('Weltkarte konnte nicht geladen werden: ' + e.message, 'bad', 8000);
      showMainMenu();
      return;
    }
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
        tac = null; Game.c.transport.status = 'return'; engine.setMode(geo); geo.activate();
      }
      done();
    }, 60);
  },
  endMission(site, result) {
    if (!tac || !geo) return;
    closeAllModals();
    tac.dispose(); tac = null;
    geo.missionDone(site, result);
    Game.save();
    if (site.kind === 'hive' && result.won) { Game.c.won = true; Game.save(); engine.setMode(geo); geo.activate(); victory(); return; }
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
  if (!document.documentElement.requestFullscreen) { toast('Vollbild: Auf dem iPhone über „Teilen → Zum Home-Bildschirm“ als App installieren.', 'warn', 6000); return; }
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
    ${opt('upscaler', 'Upscaler-Verfahren', [['temporal', 'Temporal (DLSS-artig)'], ['spatial', 'Räumlich (FSR1-artig)']])}
    <p class="muted">Temporal: Jedes Bild wird um Bruchteile eines Pixels versetzt gerendert und über mehrere Bilder in voller Ausgabeauflösung zusammengesetzt (Bewegungsausgleich über die Kamera, Schutz gegen Geisterbilder) – deutlich ruhigere Kanten und mehr Details. Räumlich: rekonstruiert nur aus dem aktuellen Bild, minimal schneller.${(settings.upscaler || 'temporal') === 'temporal' && engine.method !== 'temporal' ? ' <b>Temporal wird von diesem Gerät nicht unterstützt – räumlicher Fallback aktiv.</b>' : ''}</p>
    ${opt('upscale', 'Upscaling-Modus', Object.entries(UPSCALE_MODES).map(([k, m]) => [k, m.label]))}
    ${opt('dynamicRes', 'Dynamische Auflösung', [[true, 'An'], [false, 'Aus']])}
    ${opt('targetFps', 'Ziel-Bildrate', [[30, '30'], [60, '60'], [90, '90'], [120, '120']])}
    ${range('sharpness', 'Schärfe (RCAS)', 0, 1, 0.05)}
    <h4>Grafik</h4>
    ${opt('shadows', 'Schatten', [['off', 'Aus'], ['low', 'Niedrig'], ['med', 'Mittel'], ['high', 'Hoch']])}
    ${opt('ao', 'Umgebungsverdeckung (AO)', [['off', 'Aus'], ['low', 'Niedrig'], ['high', 'Hoch']])}
    <p class="muted">Umgebungsverdeckung (GTAO) dunkelt Ecken, Spalten und Kontaktstellen ab – im Bodenkampf. „Niedrig“ rechnet mit halber Auflösung.</p>
    ${opt('bloom', 'Bloom / Leuchten', [[true, 'An'], [false, 'Aus']])}
    ${opt('filmGrain', 'Filmkorn & Vignette', [[true, 'An'], [false, 'Aus']])}
    ${opt('maxDpr', 'Max. Pixeldichte', [[1, '1×'], [1.5, '1,5×'], [2, '2×'], [3, '3×']])}
    ${opt('showFps', 'Leistungsanzeige', [[true, 'An'], [false, 'Aus']])}
    <h4>Energie &amp; Akku</h4>
    ${opt('fpsLimit', 'Bildrate begrenzen', [[0, 'Aus'], [30, '30'], [60, '60']])}
    ${opt('idleSaver', 'Energiesparen im Leerlauf', [[true, 'An'], [false, 'Aus']])}
    <p class="muted">Das Bildratenlimit spart Strom und Wärme auf Handy und Laptop; die Ziel-Bildrate der dynamischen Auflösung liegt nie darüber. Energiesparen im Leerlauf: Ohne Eingabe für einige Sekunden und bei ruhiger Szene (pausierte Weltkarte, eigener Zug im Bodenkampf) wird die Bildrate stark gesenkt; ein ruhendes Bild wird noch scharf auskonvergiert und dann nicht mehr neu gezeichnet. Jede Eingabe stellt sofort die volle Bildrate wieder her.</p>
    <h4>Spiel</h4>
    ${opt('animSpeed', 'Animationstempo', [[1, 'Normal'], [1.5, 'Schnell'], [2.5, 'Sehr schnell']])}
    ${opt('confirmEnd', 'Zugende bestätigen', [[true, 'An'], [false, 'Aus']])}
    ${opt('tvMode', 'TV-Modus (große UI)', [[true, 'An'], [false, 'Aus']])}
    ${opt('vibration', 'Vibration / Rumble', [[true, 'An'], [false, 'Aus']])}
    <h4>Audio</h4>
    ${range('sfx', 'Effekte', 0, 1, 0.05)}
    ${range('music', 'Musik', 0, 1, 0.05)}
    <p class="muted">Hinweis: NVIDIA DLSS selbst ist nur in nativen Windows-Spielen mit RTX-Grafikkarte verfügbar. AEGIS nutzt eigene, plattformunabhängige Upscaler (temporal: Subpixel-Jitter + Bildhistorie mit Reprojektion; räumlich: Kantenrekonstruktion; jeweils mit kontrastadaptivem Schärfen und dynamischer Auflösung), die auf PC, Handy und TV laufen – ohne KI-Netz und ohne spezielle Grafikkarte. Schattenqualität wirkt ab dem nächsten Einsatz.</p>`;
  const h = modal({ title: '⚙ Einstellungen', wide: true, html: `<div id="set-body">${render()}</div>`, buttons: [{ label: 'Standard', close: false, action: () => { settings = Object.assign(settings, DEFAULTS); apply(); return false; } }, { label: 'Fertig', primary: true }] });
  const body = h.el.querySelector('#set-body');
  const apply = (focusSel) => {
    saveSettings();
    engine.applySettings();
    setVolumes(settings.sfx, settings.music);
    document.body.classList.toggle('tv', settings.tvMode || Cast.isReceiver || new URLSearchParams(location.search).has('tv'));
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
  const P = padLabel;
  const tbl = (rows, head = ['Aktion', 'Maus / Touch', 'Tastatur', 'Controller']) => `<div class="help-scroll"><table class="help-tbl"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${c}</td>` : `<th scope="row">${c}</th>`)).join('')}</tr>`).join('')}</tbody></table></div>`;
  const dl = (items) => `<dl class="help-gloss">${items.map(([t, d]) => `<dt>${t}</dt><dd>${d}</dd>`).join('')}</dl>`;
  const tabs = [
    ['Weltkarte', () => `<p class="muted">Die Weltkarte ist dein Lagezentrum: Hier läuft die Zeit, UFOs tauchen auf und du steuerst Basis, Forschung und Einkauf.</p>` + tbl([
      ['Globus drehen', 'Ziehen', 'WASD / Pfeiltasten', 'Linker / Rechter Stick'],
      ['Zoom', 'Mausrad · Zwei Finger (Pinch)', '+ / −', `${P('RT')} näher · ${P('LT')} weiter`],
      ['Marker wählen (UFO, Einsatz, Basis)', 'Anklicken / Antippen', '–', `${P('A')} (Fadenkreuz in der Mitte)`],
      ['Pause / Weiter', 'Button ⏸', 'Leertaste', P('SELECT')],
      ['Zeitstufe wählen', 'Zeit-Buttons oben', 'Tasten 1–6 (1 = Pause)', `${P('LB')} langsamer · ${P('RB')} schneller`],
      ['Abfangjäger', 'Button „Abfangen“', 'I', '▲ Steuerkreuz'],
      ['Basis (3D)', 'Button „Basis“', 'B', P('X')],
      ['Forschung', 'Button „Forschung“', 'R', P('Y')],
      ['Soldaten', 'Button „Soldaten“', '–', '▼ Steuerkreuz'],
      ['Beschaffung', 'Button „Beschaffung“', '–', '◀ Steuerkreuz'],
      ['Finanzen', 'Button „Finanzen“', 'F', '▶ Steuerkreuz'],
      ['Menü / Hilfe', 'Button ☰', 'Esc', P('START')],
    ])],
    ['Bodenkampf', () => `<p class="muted">Rundenbasiert: Du ziehst mit allen Soldaten, dann die Aliens. Jede Aktion kostet Zeiteinheiten (ZE).</p>` + tbl([
      ['Soldat wählen', 'Soldat anklicken · Buttons ◀ ▶', 'Tab / Shift+Tab', `${P('LB')} / ${P('RB')}`],
      ['Bewegen', 'Feld anklicken (Touch: zweimal tippen)', '–', `Linker Stick = Cursor, ${P('A')}`],
      ['Ziel wählen &amp; Feuer', 'Alien anklicken, erneut anklicken = Feuer · Button FEUER', 'T = nächstes Alien · F = Feuer', `◀ ▶ = Alien wählen, ${P('A')} = Feuer`],
      ['Schussmodus', 'Buttons Schnellschuss / Gezielt / Salve', '1 / 2 / 3', `${P('X')} schaltet durch (auch Gürtel)`],
      ['Gürtel-Ausrüstung', 'Button „Gürtel“ 1–3, dann Zielfeld', '4 / 5 / 6 · G = erster Wurfgegenstand', '▼ schaltet Plätze durch'],
      ['Knien / Aufstehen', 'Button „Knien“', 'K oder C', P('Y')],
      ['Auswahl abbrechen', 'Rechtsklick', 'Esc', P('B')],
      ['Kamera schwenken', 'Linke Maustaste ziehen · ein Finger', 'WASD / Pfeiltasten', 'Linker Stick (Cursor)'],
      ['Kamera drehen', 'Rechte Maustaste ziehen · zwei Finger drehen', 'Q / E', 'Rechter Stick'],
      ['Zoom', 'Mausrad · Pinch', 'R = näher · V = weiter', `${P('RT')} näher · ${P('LT')} weiter`],
      ['Auf Soldat zentrieren', '–', 'Leertaste', '▲ Steuerkreuz'],
      ['Zug beenden', 'Button „Zug beenden“', 'Enter', P('SELECT')],
      ['Rückzug', 'Button ⚑ · Menü', '–', `${P('START')} → Menü`],
      ['Menü', 'Button ☰', 'Esc (wenn nichts gewählt)', P('START')],
    ])],
    ['Abfangkampf & Basis', () => `<h4>3D-Abfangkampf (Jäger gegen UFO)</h4>` + tbl([
      ['Annähern', 'Button „Annähern“', '1 · ↑ · W', '▲ Steuerkreuz · Stick hoch'],
      ['Auf Distanz bleiben', 'Button „Distanz“', '2 · ↓ · S', '▼ Steuerkreuz · Stick runter'],
      ['Ausweichen (Feuer pausiert kurz)', 'Button „Ausweichen“', '3 · E · Shift links', `${P('X')} · ${P('LB')}`],
      ['Feuer frei (Raketensalve)', 'Button „Feuer frei“', '4 · Leertaste · F · Enter', `${P('A')} · ${P('RT')}`],
      ['Abbrechen (zweimal drücken)', 'Button „Abbrechen“', '5 · Rücktaste · Q', P('B')],
      ['Pause', '–', 'Esc · P', `${P('START')} (dann ${P('A')} weiter, ${P('B')} Rückzug)`],
    ]) + `<h4>Basis (3D)</h4>` + tbl([
      ['Ansicht drehen / neigen', 'Ziehen', 'WASD / Pfeiltasten', 'Rechter Stick'],
      ['Ansicht verschieben', 'Rechte Maustaste oder Shift + ziehen · zwei Finger', '–', '–'],
      ['Zoom', 'Mausrad · Pinch', '+ / − · Bild ↑ / ↓', `${P('RT')} näher · ${P('LT')} weiter`],
      ['Modul wählen', 'Anklicken / Antippen', 'Q / E', `Steuerkreuz / Linker Stick · ${P('LB')} / ${P('RB')}`],
      ['Info ein / aus', 'Modul antippen', 'Enter · Leertaste', P('A')],
      ['Bauen / Ausbauen', 'Button im Infofenster', 'B', P('X')],
      ['Ansicht zurücksetzen', '–', 'R', P('Y')],
      ['Zurück zur Weltkarte', 'Button zum Schließen', 'Esc', P('B')],
    ]) + `<h4>Ausrüstung &amp; Menüs</h4>` + tbl([
      ['Soldat wechseln', 'Buttons ◀ ▶ · Soldat in der Liste', 'Tab-Navigation', `${P('LB')} / ${P('RB')}`],
      ['Waffe, Rüstung, Gürtel ändern', 'Platz anklicken, Gegenstand wählen', 'Tab / Enter', `Steuerkreuz, ${P('A')}`],
      ['Schließen / Zurück', 'Button „Fertig“ · ✕', 'Esc', P('B')],
    ])],
    ['Begriffe', () => `<p class="muted">Werte stammen aus den aktuellen Spielregeln und können sich durch Balancing ändern.</p>` + dl([
      ['Zeiteinheiten (ZE)', 'Dein Aktionsbudget pro Zug. Gehen kostet 4 ZE je Feld (diagonal 6), Knien 4 ZE, Aufstehen 8 ZE. Schüsse und Gürtel-Gegenstände kosten einen Anteil deiner Maximal-ZE.'],
      ['Schnellschuss / Gezielt / Salve', 'Schnellschuss: billig (Gewehr 25 % der ZE), mittlere Treffsicherheit. Gezielt: teurer (50 %), aber deutlich genauer. Salve: 3 Schüsse (35 %), jeder einzelne ungenauer.'],
      ['Trefferchance', 'Treffsicherheit des Soldaten × Waffenwert. Besser durch: Knien (+15 %), Forschung „Autopsie“ (+5 % je Alienart). Schlechter durch: große Entfernung (ab 10 Feldern −2 % je Feld, außerhalb der Reichweite halbiert), Ziel in halber Deckung (−30 %), Ziel kniend (−8 %), Ziel im Rauch (−40 %). Immer zwischen 5 und 95 %. Jeder Treffer richtet mindestens 15 % des Waffenschadens an, auch gegen starke Panzerung. Bei Nacht sehen Soldaten nur 12 statt 20 Felder weit.'],
      ['Reaktionsfeuer', 'Bewegt sich eine Einheit in Sichtweite, kann der Gegner sofort einen Schnellschuss abgeben. Chance: Reaktionswert × Anteil verbliebener ZE × 0,85. Spare dir ZE auf, damit deine Soldaten selbst reagieren können.'],
      ['Deckung (halbe Deckung)', 'Zäune, Felsen, Autos zwischen Schütze und Ziel senken dessen Trefferchance um 30 %. Gilt nicht, wenn der Schütze direkt daneben steht.'],
      ['Knien', 'Kostet 4 ZE, Aufstehen kostet 8 ZE. Erhöht die eigene Genauigkeit um 15 %, macht dich aber nicht unverwundbar. Will ein kniender Soldat laufen, steht er zuerst auf und zahlt einmalig die 8 ZE; danach bleibt er stehen.'],
      ['Nebel des Krieges', 'Du siehst nur, was deine Soldaten sehen (20 Felder, nachts 10). Bereits erkundete Felder bleiben sichtbar, Aliens nur solange sie im Blick sind.'],
      ['Gürtel-Ausrüstung', 'Splittergranate (Schaden 55, Radius 2,6) und Alien-Granate (95, Radius 3,2) kosten 30 % der ZE. Nebelgranate (25 %): 3 Runden Rauch, Radius 2,5. Leuchtfackel (20 %): leuchtet nachts Radius 6 für 4 Runden aus. Medi-Kit (30 %): heilt 25 LP, 3 Anwendungen – auf sich selbst oder einen angrenzenden Soldaten. Granaten und Fehlschüsse zerstören Deckung.'],
      ['Landezone &amp; Rückzug', 'Die Landezone liegt beim Transporter. Beim Rückzug (⚑) werden nur Soldaten in der Landezone evakuiert – alle anderen gelten als vermisst.'],
      ['Forschung &amp; Artefakte', 'Aus abgeschossenen UFOs und gefallenen Aliens bergen deine Truppen Artefakte (z. B. Leichname). Manche Projekte brauchen bestimmte Artefakte. Wissenschaftler im Labor erforschen sie; neue Waffen, Rüstungen und Fähigkeiten folgen.'],
      ['Radar / Ortung', 'Deine Basis ortet UFOs nur innerhalb des Radarkreises. Weitere Radaranlagen vergrößern ihn um 35 %, die Forschung „Navigation“ um 60 %.'],
      ['Finanzierung &amp; Monatsbericht', 'Jeden Monat zahlen die Regionen je nach Erfolg: Bei guter Wertung steigt die Förderung (bis +25 %), bei schlechter sinkt sie (bis −30 %). Abgezogen werden Gehälter (Soldat 20.000 ¢, Wissenschaftler 25.000 ¢), Unterhalt (Anlage 40.000 ¢, Jäger 60.000 ¢). Zwei schlechte Monate in Folge beenden das Projekt.'],
      ['Zeitsteuerung', 'Die Weltkarte läuft in Echtzeit mit sechs Stufen (Pause, 1 Min., 5 Min., 30 Min., 2 Std., 12 Std. Spielzeit pro Sekunde). Fenster und Menüs halten die Zeit an. Bei UFO-Kontakt am besten auf kleine Stufen schalten.'],
    ])],
    ['Cheats', () => `<p class="muted">Die Cheat-Konsole ist für Tests und zum Ausprobieren gedacht.</p>` + tbl([
      ['Cheat-Konsole öffnen / schließen', 'Menü-Eintrag', 'F10 oder ^', `${P('L3')} + ${P('R3')} gleichzeitig (Stickklick)`],
    ]) + `<h4>Cheat-Codes (im Eingabefeld der Konsole)</h4>` + tbl([
      ['GELDREGEN', '+5.000.000 ¢'], ['UNSTERBLICH', 'Gottmodus an'], ['ADLERAUGE', 'Karte und alle UFOs aufdecken'], ['EINSTEIN', 'Gesamte Forschung abschließen'],
    ], ['Code', 'Wirkung']) + `<h4>Schalter &amp; Sofort-Aktionen</h4><p>Gottmodus, unendliche ZE, 100 % Trefferchance, Ein-Treffer-Kills, Karte aufdecken, kein Alien-Reaktionsfeuer, alle UFOs orten, Sofort-Forschung, Sofort-Bau, alle Ausrüstung. Dazu: Geld, Forschung, Heilen, UFO/Terrorangriff/Hive erzeugen, Aliens vernichten, Mission gewinnen.</p>`],
  ];
  let cur = 0;
  const h = modal({
    title: '🎮 Steuerung & Anleitung', wide: true, cls: 'help-modal',
    html: `<div class="help-tabs" role="tablist">${tabs.map((t, i) => `<button class="btn help-tab" role="tab" data-tab="${i}">${t[0]}</button>`).join('')}</div><div class="help-body" role="tabpanel"></div><p class="muted help-pad">Reiter wechseln mit ${P('LB')} / ${P('RB')} · Schließen mit ${P('B')} oder Esc</p>`,
    buttons: [{ label: 'OK', primary: true }],
  });
  const body = h.el.querySelector('.help-body');
  const show = (i) => {
    cur = (i + tabs.length) % tabs.length;
    body.innerHTML = tabs[cur][1]();
    h.el.querySelectorAll('.help-tab').forEach((b, k) => { b.classList.toggle('on', k === cur); b.setAttribute('aria-selected', k === cur); });
    h.el.querySelector('.modal-body').scrollTop = 0;
  };
  h.el.querySelectorAll('.help-tab').forEach((b) => b.addEventListener('click', () => { sfx('click'); show(+b.dataset.tab); }));
  h.el.addEventListener('navtab', (e) => { sfx('click'); show(cur + e.detail); });
  show(0);
}

function victory() {
  sfx('victory');
  modal({
    title: '🏆 SIEG!', closable: false, wide: true,
    html: `<h2 style="text-align:center">Das Hive-Nest ist zerstört.</h2><p>Ohne den Hive-Kommandanten bricht das kollektive Bewusstsein der Invasoren zusammen. Die verbliebenen UFOs ziehen sich zurück – die Erde ist gerettet.</p>
      <p>Gesamtwertung: <b>${Game.c.score}</b> · Missionen: ${Game.c.stats.won}/${Game.c.stats.missions} · UFOs abgeschossen: ${Game.c.stats.ufosDown} · Aliens eliminiert: ${Game.c.stats.kills} · Gefallene: ${Game.c.stats.lost}</p>`,
    buttons: [{ label: 'Weiterspielen' }, { label: 'Hauptmenü', primary: true, action: () => showMainMenu() }],
  });
}
function gameOver(text) {
  sfx('defeat');
  if (Game.c) Game.c.lost = true;
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
// Audio bei jeder Nutzerinteraktion (wieder) freischalten – nötig für iOS nach App-Wechsel
['pointerup', 'touchend', 'keydown'].forEach((ev) => window.addEventListener(ev, () => initAudio(), { passive: true }));
// TV-Empfänger: neuer Spielstand vom Handy → Weltkarte neu aufbauen
Cast.onRemoteSave = () => startGeoscape();
// Handy wird zum Controller: lokales Spiel anhalten; danach mit dem aktuellen Stand vom TV weiter
Cast.onControllerMode = (on) => {
  if (on) {
    closeAllModals(); cheats.close();
    currentMode()?.deactivate?.();
    setVolumes(0, 0);
  } else {
    setVolumes(settings.sfx, settings.music);
    if (geo || tac) { if (Game.load()) startGeoscape(); else showMainMenu(); }
  }
};

const fpsEl = document.getElementById('fps');
fpsEl.style.display = settings.showFps ? 'block' : 'none';
let fpsT = 0;
engine.onFrame = (dt) => {
  Input.update(dt);
  fpsT -= dt;
  if (fpsT <= 0 && settings.showFps) {
    fpsT = 0.5;
    fpsEl.innerHTML = `${Math.round(engine.fps)} FPS · ${engine.frameMs.toFixed(1)} ms<br>${engine.internalW}×${engine.internalH} → ${engine.outW}×${engine.outH}<br>${UPSCALE_MODES[settings.upscale].label} · ${engine.methodLabel}${settings.dynamicRes ? ` · DRS ${Math.round(engine.dynScale * 100)}%` : ''}`;
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
