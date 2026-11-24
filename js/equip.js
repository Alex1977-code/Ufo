// Ausrüstungsdialog: Waffe, Rüstung und Gürtelplätze je Soldat. Regel-Logik oben ist DOM-frei und exportiert.
import { WEAPONS, ARMORS, ITEMS, BELT_SLOTS, RANKS } from './data.js';

// ---------- Reine Logik ----------
const UNLIMITED = { weapon: 'rifle', armor: 'none' };

// Wie viele Stück von `id` sind noch frei, wenn `current` (bzw. dessen Gürtelplatz `slot`) selbst nicht mitzählt?
// field: 'weapon' | 'armor' | 'items'. soldiers: Pool, über den gezählt wird (Waffen/Rüstungen: alle Soldaten, Gürtel: Trupp).
// Gibt Infinity zurück bei unbegrenzten Optionen (Gewehr, Kampfanzug) oder Cheat allGear.
export function availableCount(id, soldiers, current, stock, field = 'weapon', slot = -1, allGear = false) {
  if (allGear || id == null || UNLIMITED[field] === id) return Infinity;
  let used = 0;
  for (const s of soldiers) {
    if (field === 'items') {
      (s.items || []).forEach((it, i) => { if (it === id && !(s === current && i === slot)) used++; });
    } else if (s !== current && s[field] === id) used++;
  }
  return Math.max(0, (stock[id] || 0) - used);
}

// Kann `id` in dieses Feld/diesen Platz gesetzt werden (Bestand ungeachtet der Erforschung)?
export function canEquip(id, soldiers, current, stock, field, slot = -1, allGear = false) {
  return availableCount(id, soldiers, current, stock, field, slot, allGear) > 0;
}

// Setzt Waffe/Rüstung/Gürtel eines Soldaten, sofern Bestand reicht. Gibt true bei Erfolg zurück.
export function setEquip(soldier, field, id, soldiers, stock, slot = -1, allGear = false) {
  if (id != null && !canEquip(id, soldiers, soldier, stock, field, slot, allGear)) return false;
  if (field === 'items') { soldier.items ||= Array(BELT_SLOTS).fill(null); soldier.items[slot] = id; }
  else soldier[field] = id;
  return true;
}

// Überträgt die Ausrüstung von `src` auf alle anderen Soldaten in `targets`, soweit der Bestand reicht
// (Rest: Gewehr / Kampfanzug / leerer Gürtelplatz). poolAll: alle Kampagnen-Soldaten für Waffen/Rüstungen.
export function applyTemplate(src, targets, poolAll, stock, allGear = false) {
  const belt = targets;
  for (const t of targets) {
    if (t === src) continue;
    if (!setEquip(t, 'weapon', src.weapon, poolAll, stock, -1, allGear)) setEquip(t, 'weapon', 'rifle', poolAll, stock, -1, allGear);
    if (!setEquip(t, 'armor', src.armor, poolAll, stock, -1, allGear)) setEquip(t, 'armor', 'none', poolAll, stock, -1, allGear);
    t.items = Array(BELT_SLOTS).fill(null);
    for (let i = 0; i < BELT_SLOTS; i++) setEquip(t, 'items', (src.items || [])[i] ?? null, belt, stock, i, allGear);
  }
}

// Gesamtverbrauch an Gürtelgegenständen: { id: Anzahl }
export function beltTotals(soldiers) {
  const r = {};
  for (const s of soldiers) for (const it of s.items || []) if (it) r[it] = (r[it] || 0) + 1;
  return r;
}

// Kürzt Gürtel, falls Bestand überschritten (Sicherheitsnetz, z. B. nach Cheat-Wechsel)
export function clampBelts(soldiers, stock, allGear = false) {
  if (allGear) return;
  const used = {};
  for (const s of soldiers) {
    s.items = (s.items || []).slice(0, BELT_SLOTS);
    while (s.items.length < BELT_SLOTS) s.items.push(null);
    s.items = s.items.map((it) => { if (!it) return null; used[it] = (used[it] || 0) + 1; return used[it] > (stock[it] || 0) ? null : it; });
  }
}

export function itemEffect(it) {
  if (it.kind === 'grenade') return `Schaden ${it.dmg}, Radius ${it.radius}`;
  if (it.kind === 'smoke') return `Sichtschutz, Radius ${it.radius}, ${it.turns} Runden`;
  if (it.kind === 'flare') return `Beleuchtung, Radius ${it.radius}, ${it.turns} Runden`;
  if (it.kind === 'medkit') return `Heilt ${it.heal} LP, ${it.uses} Anwendungen`;
  return '';
}

// ---------- Dialog ----------
export async function openEquipment({ soldiers, onDone }) {
  const [{ Game }, { modal, toast }, { sfx }, three3d] = await Promise.all([import('./game.js'), import('./ui.js'), import('./audio.js'),
    Promise.all([import('three'), import('./models.js')]).catch(() => null)]);
  const c = Game.c, stock = c.stock, gear = !!Game.cheats.allGear;
  const all = c.soldiers;
  let sel = 0, focusKey = null;
  clampBelts(soldiers, stock, gear);
  const cur = () => soldiers[sel];
  const slotBtn = (key, label, icon, name, sub) => `<button class="btn eq-slot" data-slot="${key}"><small>${label}</small><b>${icon ? icon + ' ' : ''}${name}</b>${sub ? `<em>${sub}</em>` : ''}</button>`;
  const wDesc = (w) => `Schaden ${w.dmg} · Reichweite ${w.range}${w.snap ? ` · Schnell ${Math.round(w.snap.acc * 100)}%` : ''}${w.aimed ? ` · Gezielt ${Math.round(w.aimed.acc * 100)}%` : ''}${w.auto ? ' · Salve' : ''}`;
  const aDesc = (a) => `Panzerung ${a.armor}${a.hp ? ` · +${a.hp} LP` : ''}`;

  const html = () => {
    const s = cur(), w = WEAPONS[s.weapon], a = ARMORS[s.armor];
    const list = soldiers.map((x, i) => `<button class="btn eq-sold ${i === sel ? 'on' : ''} ${x.wound > 0 ? 'hurt' : ''}" data-sold="${i}"><b>${x.name}</b><small>${RANKS[x.rank]} · ZE ${x.tu} · LP ${x.hp + ARMORS[x.armor].hp} · Treff ${x.acc}${x.wound > 0 ? ' · verwundet' : ''}</small></button>`).join('');
    const belt = Array.from({ length: BELT_SLOTS }, (_, i) => { const it = ITEMS[s.items?.[i]]; return slotBtn('i' + i, `Gürtel ${i + 1}`, it ? it.icon : '', it ? it.name : '– leer –', it ? itemEffect(it) : ''); }).join('');
    return `<div class="eq">
      <div class="eq-list">${list}</div>
      <div class="eq-detail">
        <div class="eq-head"><button class="btn" data-nav="-1" aria-label="Vorheriger Soldat">◀</button><div><b>${s.name}</b><small>${RANKS[s.rank]} · ${sel + 1}/${soldiers.length}</small></div><button class="btn" data-nav="1" aria-label="Nächster Soldat">▶</button></div>
        <div class="eq-stats">ZE ${s.tu} · LP ${s.hp + a.hp} · Treff ${s.acc} · Reakt ${s.react} · Panzerung ${a.armor}</div>
        <div class="eq-main"><div class="eq-view-slot"></div><div class="eq-slots">${slotBtn('weapon', 'Waffe', '', w.name, wDesc(w))}${slotBtn('armor', 'Rüstung', '', a.name, aDesc(a))}${belt}</div></div>
      </div></div>`;
  };

  let view = null; // 3D-Vorschau (createSoldierViewer)
  const h = modal({
    title: '⚙ Ausrüstung', wide: true, cls: 'eq-modal', html: html(),
    buttons: [{ label: 'Vorlage auf alle anwenden', close: false, action: () => {
      applyTemplate(cur(), soldiers, all, stock, gear); toast('Ausrüstung übertragen (soweit Bestand reicht).'); redraw(); view?.play('approve');
    } }, { label: 'Fertig', primary: true }],
    // Jeder Schließweg (Fertig, ✕, Ⓑ/Esc, Klick daneben) landet hier → 3D-Vorschau samt WebGL-Kontext freigeben
    onClose: () => { view?.dispose(); view = null; onDone?.(); },
  });
  const body = h.el.querySelector('.modal-body');
  if (three3d) { try { view = createSoldierViewer(three3d[0], three3d[1].makeSoldier); } catch (e) { console.warn('3D-Vorschau nicht verfügbar', e); view = null; } }
  let shownSel = sel;
  function redraw() {
    body.innerHTML = html();
    if (view) { body.querySelector('.eq-view-slot')?.appendChild(view.el); view.show(cur(), { formup: shownSel !== sel }); shownSel = sel; }
    if (focusKey) body.querySelector(focusKey)?.focus();
  }
  redraw();
  for (const ev of ['pointerdown', 'keydown', 'focusin', 'wheel']) h.el.addEventListener(ev, () => view?.poke(), { passive: true });
  const go = (d) => { sel = (sel + d + soldiers.length) % soldiers.length; focusKey = null; redraw(); };
  h.el.addEventListener('navtab', (e) => { sfx('click'); go(e.detail); });

  function pick(key) {
    const s = cur();
    const field = key === 'weapon' ? 'weapon' : key === 'armor' ? 'armor' : 'items';
    const slot = field === 'items' ? +key.slice(1) : -1;
    const pool = field === 'items' ? soldiers : all;
    const curId = field === 'items' ? s.items?.[slot] : s[field];
    let opts;
    if (field === 'weapon') opts = Object.entries(WEAPONS).filter(([k, w]) => w.cost > 0 || k === 'rifle').map(([k, w]) => ({ id: k, icon: '', name: w.name, desc: wDesc(w), ok: Game.weaponAvailable(k), cost: w.cost }));
    else if (field === 'armor') opts = Object.entries(ARMORS).map(([k, a]) => ({ id: k, icon: '', name: a.name, desc: aDesc(a), ok: Game.armorAvailable(k), cost: a.cost }));
    else opts = Object.entries(ITEMS).map(([k, it]) => ({ id: k, icon: it.icon, name: it.name, desc: itemEffect(it), ok: Game.itemAvailable(k), cost: it.cost }));
    const rows = opts.map((o) => {
      const free = availableCount(o.id, pool, s, stock, field, slot, gear);
      let reason = '';
      if (!o.ok) reason = 'Nicht erforscht';
      else if (free <= 0) reason = 'Kein Bestand frei';
      const unl = free === Infinity;
      const stk = unl ? 'unbegrenzt' : `Lager: ${free} frei`;
      // Fehlender Bestand: anwählbar (→ Figur schüttelt den Kopf), aber als gesperrt markiert; nicht erforscht: deaktiviert
      const dis = !o.ok ? 'disabled' : free <= 0 ? 'aria-disabled="true"' : '';
      return `<button class="btn eq-opt ${o.id === curId ? 'on' : ''} ${o.ok && free <= 0 ? 'dis' : ''}" data-opt="${o.id}" ${dis}><span class="eq-ico">${o.icon || ''}</span><span class="eq-txt"><b>${o.name}</b><small>${o.desc}</small></span><span class="eq-stk ${reason ? 'bad' : ''}">${reason || stk}</span></button>`;
    }).join('');
    const clear = field === 'items' ? `<button class="btn eq-opt" data-opt="">✕ Platz leeren</button>` : '';
    const label = field === 'weapon' ? 'Waffe wählen' : field === 'armor' ? 'Rüstung wählen' : `Gürtel ${slot + 1}`;
    // Abgelehnte Auswahl: Kopfschütteln, sobald die (die Figur verdeckende) Auswahlliste wieder zu ist
    let denied = false, done = false;
    const ph = modal({ title: `${label} – ${s.name}`, html: `<div class="eq-opts">${rows}${clear}</div>`, buttons: [{ label: 'Zurück' }], onClose: () => { if (denied && !done) view?.play('deny'); } });
    ph.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-opt]'); if (!b || b.disabled) return;
      const id = b.dataset.opt || null;
      const before = field === 'items' ? s.items?.[slot] ?? null : s[field];
      if (!b.classList.contains('dis') && setEquip(s, field, id, pool, stock, slot, gear)) {
        sfx('select'); focusKey = `[data-slot="${key}"]`; done = true; ph.close(); redraw();
        if (id !== before) view?.play(field === 'weapon' ? 'aim' : 'approve');
      } else { sfx('deny'); toast(b.classList.contains('dis') ? 'Kein Bestand frei.' : 'Nicht verfügbar.', 'warn'); denied = true; view?.play('deny'); }
    });
    setTimeout(() => ph.el.querySelector('.eq-opt.on, .eq-opt:not(:disabled):not(.dis)')?.focus(), 40);
  }

  h.el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.sold != null) { sfx('click'); sel = +b.dataset.sold; focusKey = `[data-sold="${sel}"]`; redraw(); }
    else if (b.dataset.nav) { sfx('click'); go(+b.dataset.nav); body.querySelector(`[data-nav="${b.dataset.nav}"]`)?.focus(); }
    else if (b.dataset.slot) { sfx('click'); pick(b.dataset.slot); }
    else if (b.dataset.pose) { sfx('click'); view?.play(b.dataset.pose, true); }
  });
  return h;
}

// ---------- 3D-Vorschau: animierte Soldatenfigur ----------
// Zähler für WebGL-Kontexte der Vorschau (Leck-Kontrolle: active muss nach dem Schließen wieder 0 sein)
export const viewerStats = { created: 0, disposed: 0, get active() { return this.created - this.disposed; } };

const TAU = Math.PI * 2;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// Animationskanäle: Körper (Position/Rotation/Atmung), Kopf, Arme, Beine, Waffe
const CH = ['bx', 'by', 'bz', 'brx', 'bry', 'brz', 'bs', 'hx', 'hy', 'hz', 'alx', 'aly', 'alz', 'arx', 'ary', 'arz', 'llx', 'llz', 'lrx', 'lrz', 'gpx', 'gpy', 'gpz', 'grx', 'gry', 'grz'];

// Grundhaltung: aufrecht, Waffe gesenkt („low ready“)
function neutral(o) {
  o.bx = 0; o.by = 0; o.bz = 0; o.brx = 0; o.bry = 0; o.brz = 0; o.bs = 1;
  o.hx = 0; o.hy = 0; o.hz = 0;
  o.alx = -0.55; o.aly = 0; o.alz = 0.62; o.arx = -0.42; o.ary = 0; o.arz = -0.12;
  o.llx = 0; o.llz = 0; o.lrx = 0; o.lrz = 0;
  o.gpx = 0.12; o.gpy = 0.98; o.gpz = 0.34; o.grx = 0.6; o.gry = -0.3; o.grz = 0;
}
const slung = (o) => { o.gpx = 0.02; o.gpy = 1.22; o.gpz = -0.46; o.grx = 0; o.gry = Math.PI / 2; o.grz = 0.75; };

// Basis-Zustände (laufen dauerhaft); v = Viewer-Zustand (Blickziel usw.), k = Bewegungsstärke
const BASE = {
  idle(o, t, v, k) {
    neutral(o);
    const br = Math.sin(t * 1.7);
    o.bs = 1 + br * 0.006 * k; o.alx += br * 0.03 * k; o.arx += br * 0.02 * k;
    const sh = Math.sin(t * 0.42) * k;
    o.brz = sh * 0.035; o.bx = -sh * 0.03; o.llz = o.lrz = -o.brz; o.lrx = Math.max(0, sh) * 0.06; o.llx = Math.max(0, -sh) * 0.06;
    o.hy = v.lookY * k; o.hx = v.lookX * k + br * 0.015 * k; o.hz = -sh * 0.04;
  },
  wounded(o, t, v, k) {
    neutral(o);
    const ph = t * 1.6, lp = Math.abs(Math.sin(ph)) * k;
    o.brx = 0.2; o.brz = -0.09 + Math.sin(ph) * 0.05 * k; o.by = -0.05 - lp * 0.035; o.bs = 1 + Math.sin(t * 2.6) * 0.01 * k;
    o.hx = 0.32 + Math.sin(t * 2.6) * 0.03 * k; o.hz = 0.1; o.hy = v.lookY * 0.3 * k;
    o.alx = -0.95; o.alz = 1.0; o.arx = -0.15; o.arz = -0.05;
    o.llx = -0.12; o.lrx = 0.2 + lp * 0.08; o.llz = -o.brz * 0.5; o.lrz = -o.brz * 0.5;
    o.gpx = 0.36; o.gpy = 0.74; o.gpz = 0.16; o.grx = 1.2; o.gry = 0; o.grz = 0.05;
  },
};

// Einmal-Posen: dur = Dauer, fi/fo = Ein-/Ausblendzeit (weiche Übergänge), amb = Leerlauf-Pose (Figur dreht sich weiter)
const POSES = {
  approve: { dur: 2.6, fi: 0.45, fo: 0.55, fn(o, t) { // Nicken + Salut, Waffe präsentiert in der linken Hand
    neutral(o);
    o.arx = -2.35; o.arz = -0.62; o.ary = 0.15;
    o.alx = -0.35; o.alz = 0.05; o.gpx = -0.36; o.gpy = 1.05; o.gpz = 0.2; o.grx = -1.5; o.gry = 0; o.grz = 0.04;
    o.hx = t < 1.3 ? Math.max(0, Math.sin(t * 9.5)) * 0.28 : 0; o.by = 0.01;
  } },
  aim: { dur: 3.0, fi: 0.5, fo: 0.6, fn(o, t) { // Waffencheck: anlegen, anvisieren, leichtes Schwenken
    neutral(o);
    const sw = Math.sin(t * 1.4) * 0.12 * sstep(0.6, 1.2, t);
    o.bry = -0.28 + sw; o.llx = -0.22; o.lrx = 0.16; o.llz = 0.05; o.lrz = -0.06; o.by = -0.03;
    o.arx = -1.45; o.arz = -0.32; o.alx = -1.5; o.alz = 0.95;
    o.gpx = 0.2; o.gpy = 1.47; o.gpz = 0.36; o.grx = Math.sin(t * 3.1) * 0.012; o.gry = 0.28; o.grz = 0;
    o.hx = 0.12; o.hz = 0.16; o.hy = 0.12;
  } },
  deny: { dur: 1.4, fi: 0.2, fo: 0.35, fn(o, t) { // Kopfschütteln
    neutral(o);
    o.hy = Math.sin(t * 15) * 0.5 * (1 - t / 1.4); o.hx = 0.08;
    o.brz = Math.sin(t * 15) * 0.02; o.alz = 0.85; o.arz = -0.35; o.by = -0.01;
  } },
  impatient: { dur: 6.5, fi: 0.7, fo: 0.8, amb: true, fn(o, t) { // Arme verschränkt, Fuß tippt
    neutral(o); slung(o);
    o.alx = -1.38; o.alz = 1.02; o.arx = -1.25; o.arz = -1.0;
    o.brz = 0.04; o.llz = -0.04; o.lrz = -0.04; o.bx = -0.03;
    o.lrx = -Math.max(0, Math.sin(t * 9)) * 0.2;
    o.hz = Math.sin(t * 0.9) * 0.1; o.hy = Math.sin(t * 0.5) * 0.35; o.hx = -0.05; o.bs = 1 + Math.sin(t * 1.3) * 0.008;
  } },
  stretch: { dur: 3.2, fi: 0.8, fo: 0.9, amb: true, fn(o, t) { // Dehnen
    neutral(o); slung(o);
    o.alx = -2.95; o.alz = 0.28; o.arx = -2.95; o.arz = -0.28; o.brx = -0.1; o.hx = -0.3; o.bs = 1.012;
    o.brz = Math.sin(t * 1.6) * 0.06;
  } },
  shoulder: { dur: 4.5, fi: 0.8, fo: 0.9, amb: true, fn(o, t) { // Waffe schultern
    neutral(o);
    o.gpx = 0.3; o.gpy = 1.58; o.gpz = 0.02; o.grx = -2.35; o.gry = 0.08; o.grz = 0;
    o.arx = -1.95; o.arz = -0.22; o.alx = -0.08; o.alz = 0.14;
    o.hy = Math.sin(t * 0.8) * 0.3; o.brz = 0.03;
  } },
  formup: { dur: 1.6, fi: 0, fo: 0.45, fn(o, t) { // Antreten: von hinten heranmarschieren, Hacken zusammen
    neutral(o);
    const p = Math.min(1, t / 1.05), walk = 1 - sstep(0.8, 1.05, t), s = Math.sin(t * 11);
    o.bz = -1.7 * (1 - p) * (1 - p); o.by = Math.abs(s) * 0.04 * walk;
    o.llx = s * 0.5 * walk; o.lrx = -s * 0.5 * walk;
    o.alx = -0.55 - s * 0.3 * walk; o.arx = -0.42 + s * 0.2 * walk;
    if (t > 1.05) { o.alx = -0.12; o.alz = 0.15; o.arx = -0.05; o.arz = -0.1; o.gpx = 0.36; o.gpy = 0.9; o.gpz = 0.12; o.grx = -1.5; o.gry = 0; o.hx = -0.06; }
  } },
};

// Gürtel-Gegenstände als kleine Meshes (Granate rund, Nebel grauer Zylinder, Fackel rot, Medi-Kit weiße Box mit Kreuz)
function beltMesh(THREE, kind, id, mat) {
  const g = new THREE.Group();
  if (kind === 'grenade') {
    const alien = id === 'alien';
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), mat(alien ? 'gAlien' : 'gFrag', alien ? { color: 0x3a2050, emissive: 0xb050ff, emissiveIntensity: 1.2, roughness: 0.35, metalness: 0.4 } : { color: 0x3f5a2a, roughness: 0.6, metalness: 0.2 }));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.04, 8), mat('gCap', { color: 0x8a8f96, metalness: 0.8, roughness: 0.3 }));
    cap.position.y = 0.065; g.add(b, cap);
  } else if (kind === 'smoke') {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.13, 12), mat('smoke', { color: 0x8c939b, roughness: 0.5, metalness: 0.3 }));
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.025, 12), mat('smokeBand', { color: 0xe8e8e8, roughness: 0.6 }));
    band.position.y = 0.03; g.add(b, band);
  } else if (kind === 'flare') {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.17, 10), mat('flare', { color: 0xc0202a, roughness: 0.5 }));
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.03, 10), mat('flareTip', { color: 0x200000, emissive: 0xff5030, emissiveIntensity: 1.6 }));
    tip.position.y = 0.09; g.add(b, tip);
  } else if (kind === 'medkit') {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.11, 0.06), mat('medkit', { color: 0xf2f2f2, roughness: 0.55 }));
    const red = mat('medCross', { color: 0xd01020, roughness: 0.5, emissive: 0x400000 });
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.022, 0.008), red), c2 = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.075, 0.008), red);
    c1.position.z = c2.position.z = 0.032; g.add(b, c1, c2);
  }
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return g;
}

function canvasTex(THREE, w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// Erzeugt die Vorschau. Gibt { el, show(soldier, {formup}), play(name, manual), poke(), dispose() } zurück.
function createSoldierViewer(THREE, makeSoldier) {
  const el = document.createElement('div');
  el.className = 'eq-viewer';
  el.innerHTML = `<div class="eq-stage"><canvas class="eq-cv" role="img" aria-label="3D-Ansicht des Soldaten – ziehen zum Drehen"></canvas><span class="eq-hint">⟲ ziehen</span></div>
    <div class="eq-poses"><small>Pose:</small><button class="btn eq-pose" data-pose="idle">Warten</button><button class="btn eq-pose" data-pose="approve">Salut</button><button class="btn eq-pose" data-pose="aim">Zielen</button></div>`;
  const canvas = el.querySelector('canvas'), stage = el.querySelector('.eq-stage');
  const stub = { el, show() {}, play() {}, poke() {}, dispose() { el.remove(); } };
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
  } catch (e) { el.classList.add('nogl'); return stub; }
  viewerStats.created++;
  const mq = (q) => { try { return matchMedia(q).matches; } catch { return false; } };
  const reduced = mq('(prefers-reduced-motion: reduce)');
  const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4 || mq('(pointer: coarse)');
  let frameMin = weak ? 1 / 31 : 0; // schwache Geräte: 30 fps
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, weak ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = !weak; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x070b10, 1);

  const own = new Set(), texs = [];
  const mats = {};
  const mat = (key, o) => { if (!mats[key]) { mats[key] = new THREE.MeshStandardMaterial(o); own.add(mats[key]); } return mats[key]; };
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x070b10, 5.5, 10);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
  camera.position.set(0, 1.2, 4.4); camera.lookAt(0, 0.97, 0);

  // Umgebungslicht (PBR) aus einer kleinen Hangar-Lichtszene
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(); envScene.background = new THREE.Color(0x0a1018);
  const lampGeo = new THREE.SphereGeometry(1, 8, 6);
  for (const [x, y, z, c] of [[4, 6, 5, [3.2, 3.0, 2.8]], [-6, 2, -4, [0.3, 1.2, 2.2]], [6, 1, -5, [1.6, 0.8, 0.4]], [0, -8, 0, [0.15, 0.2, 0.3]]]) {
    const m = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(...c) })); m.position.set(x, y, z); m.scale.setScalar(2.5); envScene.add(m);
  }
  const envRT = pmrem.fromScene(envScene, 0.04);
  scene.environment = envRT.texture; scene.environmentIntensity = 0.5;
  pmrem.dispose();
  envScene.traverse((o) => o.material?.dispose()); lampGeo.dispose();

  // Kulisse: Bodenplatte mit Raster, Antretmarkierung, Spinde
  const floorTex = canvasTex(THREE, 256, 256, (c, w, h) => {
    c.fillStyle = '#2b333c'; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(i * 64, 0); c.lineTo(i * 64, h); c.stroke(); c.beginPath(); c.moveTo(0, i * 64); c.lineTo(w, i * 64); c.stroke(); }
    c.fillStyle = 'rgba(255,255,255,0.05)'; for (let i = 0; i < 900; i++) c.fillRect(Math.random() * w, Math.random() * h, 1, 1);
    c.fillStyle = 'rgba(0,0,0,0.35)'; for (let x = 32; x < w; x += 64) for (let y = 32; y < h; y += 64) { c.beginPath(); c.arc(x, y, 3, 0, TAU); c.fill(); }
  });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(3, 3); texs.push(floorTex);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(3.4, 48).rotateX(-Math.PI / 2), mat('floor', { map: floorTex, color: 0x9aa6b2, metalness: 0.55, roughness: 0.5 }));
  floor.receiveShadow = true; scene.add(floor);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.78, 0.82, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x30c8ff, transparent: true, opacity: 0.45, depthWrite: false }));
  own.add(ring.material); ring.position.y = 0.006; scene.add(ring);
  const shTex = canvasTex(THREE, 128, 128, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(0.45, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }); texs.push(shTex);
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false }));
  own.add(contact.material); contact.position.y = 0.01; contact.renderOrder = 1; scene.add(contact);
  const lockerTex = canvasTex(THREE, 128, 256, (c, w, h) => {
    c.fillStyle = '#3a4653'; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 4; c.strokeRect(4, 4, w - 8, h - 8);
    c.fillStyle = 'rgba(0,0,0,0.55)'; for (let i = 0; i < 6; i++) c.fillRect(24, 22 + i * 10, w - 48, 4);
    for (let i = 0; i < 6; i++) c.fillRect(24, h - 84 + i * 10, w - 48, 4);
    c.fillStyle = '#9aa4ae'; c.fillRect(w - 30, h / 2 - 22, 8, 44);
    c.fillStyle = 'rgba(255,210,80,0.7)'; c.fillRect(20, h / 2 - 20, 40, 16);
  }); texs.push(lockerTex);
  const lockerGeo = new THREE.BoxGeometry(0.9, 2.5, 0.5).translate(0, 1.25, 0);
  const lockerMat = mat('locker', { map: lockerTex, metalness: 0.6, roughness: 0.45 });
  const stripMat = mat('strip', { color: 0, emissive: 0x30c8ff, emissiveIntensity: 1.6 });
  const stripGeo = new THREE.BoxGeometry(0.04, 2.3, 0.04).translate(0, 1.2, 0);
  for (let i = -3; i <= 3; i++) {
    const l = new THREE.Mesh(lockerGeo, lockerMat); l.position.set(i * 0.96, 0, -2.4); l.receiveShadow = true; scene.add(l);
    if (i < 3 && (i + 3) % 2 === 0) { const s = new THREE.Mesh(stripGeo, stripMat); s.position.set(i * 0.96 + 0.48, 0, -2.12); scene.add(s); }
  }
  // Licht: Spot (Schlüssellicht), Rim-Lights, Füllung
  scene.add(new THREE.HemisphereLight(0x8fb4d8, 0x12161c, 0.45));
  const spot = new THREE.SpotLight(0xfff0dc, 95, 14, 0.5, 0.65, 1.6);
  spot.position.set(2.0, 4.6, 3.4); spot.target.position.set(0, 0.9, 0); scene.add(spot, spot.target);
  if (!weak) { spot.castShadow = true; spot.shadow.mapSize.set(512, 512); spot.shadow.bias = -0.0006; spot.shadow.normalBias = 0.02; spot.shadow.camera.near = 2; spot.shadow.camera.far = 10; }
  const rim = new THREE.DirectionalLight(0x4fd2ff, 3.2); rim.position.set(-2.6, 2.6, -3); scene.add(rim);
  const rim2 = new THREE.DirectionalLight(0xffa060, 1.3); rim2.position.set(2.8, 1.6, -2.6); scene.add(rim2);
  const fill = new THREE.DirectionalLight(0x9fb8ff, 0.45); fill.position.set(-3, 1.5, 3); scene.add(fill);

  // Figur
  const turntable = new THREE.Group(); scene.add(turntable);
  let fig = null, ud = null, headPivot = null, sig = '', curSoldier = null;
  const cur = {}, tgt = {}, tmp = {};
  neutral(cur);
  const v = { lookX: 0, lookY: 0, nextLook: 2, nextExtra: 14 + Math.random() * 8, lastInput: performance.now() };
  let pose = null, poseT = 0, base = 'idle', time = 0;
  let yaw = 0.35, dragging = false, dragX = 0, lastTouch = -1e9;

  function disposeFig() {
    if (!fig) return;
    turntable.remove(fig);
    fig.traverse((o) => { if (o.isMesh) o.geometry?.dispose(); }); // Materialien: makeSoldier-Cache (geteilt) bzw. eigene bis dispose()
    fig = ud = headPivot = null;
  }
  function build(s) {
    disposeFig();
    const w = WEAPONS[s.weapon] || WEAPONS.rifle, a = ARMORS[s.armor] || ARMORS.none;
    fig = makeSoldier(s, a.color, w.fx);
    ud = fig.userData;
    const body = ud.body;
    // Kopf-Gelenk: Kopf, Helm und Visier gemeinsam drehbar machen
    headPivot = new THREE.Group(); headPivot.position.set(0, 1.6, 0); body.add(headPivot);
    for (const m of [...body.children]) if (m.isMesh && m.position.y >= 1.6) { body.remove(m); m.position.y -= 1.6; headPivot.add(m); }
    // Waffen-Details je Typ (Zielfernrohr, Pumpe, schwerer Lauf)
    const gun = ud.gun; gun.rotation.order = 'ZYX';
    if (s.weapon === 'sniper') { const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.32, 10).rotateX(Math.PI / 2), mat('scope', { color: 0x111418, metalness: 0.8, roughness: 0.3 })); sc.position.set(0, 0.13, -0.02); gun.add(sc); }
    if (s.weapon === 'shotgun') { gun.scale.z = 0.8; const pm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 10).rotateX(Math.PI / 2), mat('pump', { color: 0x5a3a22, roughness: 0.7 })); pm.position.set(0, -0.08, 0.2); gun.add(pm); }
    if (s.weapon === 'hplasma') gun.scale.set(1.35, 1.35, 1.2);
    // Gürtel + Gegenstände
    const beltY = 0.93;
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.335, 0.335, 0.07, 24, 1, true), mat('belt', { color: 0x3a2e22, roughness: 0.8, side: THREE.DoubleSide }));
    belt.position.y = beltY; body.add(belt);
    const angles = [-0.75, 0.75, -1.75];
    (s.items || []).forEach((id, i) => {
      const it = ITEMS[id]; if (!it) return;
      const m = beltMesh(THREE, it.kind, id, mat), th = angles[i] ?? 0;
      m.position.set(Math.sin(th) * 0.38, beltY - 0.04, Math.cos(th) * 0.38); m.rotation.y = th;
      body.add(m);
    });
    turntable.add(fig);
    base = s.wound > 0 ? 'wounded' : 'idle';
  }
  const sigOf = (s) => `${s.weapon}|${s.armor}|${(s.items || []).join(',')}|${s.wound > 0 ? 1 : 0}`;

  function evalPose(o, dt) {
    BASE[base](o, time, v, reduced ? 0.5 : 1);
    if (!pose) return;
    const P = POSES[pose];
    neutral(tmp); P.fn(tmp, poseT);
    const env = (P.fi > 0 ? sstep(0, P.fi, poseT) : 1) * (1 - sstep(P.dur - P.fo, P.dur, poseT));
    for (const k of CH) o[k] += (tmp[k] - o[k]) * env;
  }
  function apply() {
    if (!ud) return;
    const b = ud.body;
    b.position.set(cur.bx, cur.by, cur.bz); b.rotation.set(cur.brx, cur.bry, cur.brz); b.scale.y = cur.bs;
    headPivot.rotation.set(cur.hx, cur.hy, cur.hz);
    ud.armL.rotation.set(cur.alx, cur.aly, cur.alz); ud.armR.rotation.set(cur.arx, cur.ary, cur.arz);
    ud.legL.rotation.set(cur.llx, 0, cur.llz); ud.legR.rotation.set(cur.lrx, 0, cur.lrz);
    ud.gun.position.set(cur.gpx, cur.gpy, cur.gpz); ud.gun.rotation.set(cur.grx, cur.gry, cur.grz);
    contact.position.set(Math.sin(yaw) * cur.bz + cur.bx, 0.01, Math.cos(yaw) * cur.bz);
    const sc = 1 - Math.min(0.4, Math.abs(cur.by) * 3); contact.scale.set(sc, 1, sc);
  }

  function play(name, manual = false) {
    if (name === 'idle') { pose = null; v.lookY = 0; v.lastInput = performance.now(); return; }
    if (!POSES[name]) return;
    if (reduced && !manual) return; // reduzierte Bewegung: nur sanftes Leerlauf
    pose = name; poseT = 0;
  }
  function show(s, { formup = false } = {}) {
    const same = s === curSoldier;
    curSoldier = s;
    const sg = sigOf(s);
    if (same && sg === sig && fig) return;
    sig = sg; build(s);
    if (formup && !reduced) { pose = 'formup'; poseT = 0; yaw = 0.25; }
    else if (pose === 'formup') pose = null;
    // Zustand sofort auf die neue Haltung setzen (kein Springen beim Neuaufbau)
    evalPose(cur, 0); apply();
  }
  const poke = () => { v.lastInput = performance.now(); };

  // Drehen per Maus/Touch (horizontal ziehen)
  const onDown = (e) => { dragging = true; dragX = e.clientX; lastTouch = performance.now(); poke(); try { canvas.setPointerCapture(e.pointerId); } catch { /* egal */ } };
  const onMove = (e) => { if (!dragging) return; yaw += (e.clientX - dragX) * 0.012; dragX = e.clientX; lastTouch = performance.now(); };
  const onUp = () => { dragging = false; lastTouch = performance.now(); };
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp);

  // Größe & Sichtbarkeit
  let inView = true, W = 0, H = 0;
  const resize = () => {
    const w = Math.max(1, stage.clientWidth | 0), h = Math.max(1, stage.clientHeight | 0);
    if (w === W && h === H) return; W = w; H = h;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    camera.fov = w / h < 0.75 ? 34 : 30; camera.updateProjectionMatrix();
  };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null; ro?.observe(stage);
  const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((en) => { inView = en.some((x) => x.isIntersecting); }) : null; io?.observe(canvas);
  let last = performance.now(), acc = 0, slowFrames = 0, raf = 0, dead = false;
  const onVis = () => { last = performance.now(); };
  document.addEventListener('visibilitychange', onVis);

  function frame(now) {
    if (dead) return;
    raf = requestAnimationFrame(frame);
    if (document.hidden || !inView || !canvas.isConnected || !canvas.offsetParent) { last = now; return; }
    const dtRaw = Math.min(0.1, (now - last) / 1000);
    acc += dtRaw; last = now;
    if (acc < frameMin) return;
    const dt = Math.min(0.1, acc); acc = 0;
    // Adaptiv: dauerhaft langsame Frames → 30-fps-Deckel
    if (!frameMin) { slowFrames = dt > 0.04 ? slowFrames + 1 : Math.max(0, slowFrames - 1); if (slowFrames > 45) frameMin = 1 / 31; }
    resize();
    time += dt;
    // Leerlauf-Logik: Umschauen, Ungeduld, gelegentliches Dehnen/Schultern
    if (time > v.nextLook) { v.lookY = [-0.55, -0.25, 0, 0, 0.3, 0.6][(Math.random() * 6) | 0]; v.lookX = (Math.random() - 0.6) * 0.18; v.nextLook = time + 2.5 + Math.random() * 3.5; }
    if (pose) { poseT += dt; if (poseT >= POSES[pose].dur) { pose = null; if (base === 'idle') v.lastInput = Math.max(v.lastInput, now - 4000); } }
    if (!pose && !reduced && base === 'idle') {
      if (now - v.lastInput > 12000) play('impatient');
      else if (time > v.nextExtra) { play(Math.random() < 0.5 ? 'stretch' : 'shoulder'); v.nextExtra = time + 18 + Math.random() * 14; }
    }
    evalPose(tgt, dt);
    const kf = 1 - Math.exp(-dt * 10);
    for (const k of CH) cur[k] += (tgt[k] - cur[k]) * kf;
    // Drehung: selbsttätig langsam, bei Präsentations-Posen nach vorn schwenken
    const touched = dragging || now - lastTouch < 2500;
    if (!touched) {
      if (pose && !POSES[pose].amb) { const f = Math.round((yaw - 0.3) / TAU) * TAU + 0.3; yaw += (f - yaw) * (1 - Math.exp(-dt * 3)); }
      else if (!reduced) yaw += dt * 0.28;
    }
    turntable.rotation.y = yaw;
    apply();
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  function dispose() {
    if (dead) return; dead = true;
    cancelAnimationFrame(raf);
    document.removeEventListener('visibilitychange', onVis);
    ro?.disconnect(); io?.disconnect();
    canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp);
    disposeFig();
    // Nur eigene Materialien freigeben – makeSoldier-Materialien sind global geteilt (Bodenkampf)
    scene.traverse((o) => { if (o.isMesh) o.geometry?.dispose(); });
    lockerGeo.dispose(); stripGeo.dispose();
    for (const m of own) m.dispose();
    for (const t of texs) t.dispose();
    envRT.dispose(); spot.shadow?.map?.dispose();
    renderer.renderLists.dispose();
    renderer.dispose(); renderer.forceContextLoss();
    viewerStats.disposed++;
    el.remove();
  }
  return { el, show, play, poke, dispose };
}
