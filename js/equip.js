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
  const [{ Game }, { modal, toast }, { sfx }] = await Promise.all([import('./game.js'), import('./ui.js'), import('./audio.js')]);
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
        <div class="eq-slots">${slotBtn('weapon', 'Waffe', '', w.name, wDesc(w))}${slotBtn('armor', 'Rüstung', '', a.name, aDesc(a))}${belt}</div>
      </div></div>`;
  };

  const h = modal({
    title: '⚙ Ausrüstung', wide: true, cls: 'eq-modal', html: html(),
    buttons: [{ label: 'Vorlage auf alle anwenden', close: false, action: () => {
      applyTemplate(cur(), soldiers, all, stock, gear); toast('Ausrüstung übertragen (soweit Bestand reicht).'); redraw();
    } }, { label: 'Fertig', primary: true }],
    onClose: () => onDone?.(),
  });
  const body = h.el.querySelector('.modal-body');
  function redraw() {
    body.innerHTML = html();
    if (focusKey) body.querySelector(focusKey)?.focus();
  }
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
      return `<button class="btn eq-opt ${o.id === curId ? 'on' : ''}" data-opt="${o.id}" ${reason ? 'disabled' : ''}><span class="eq-ico">${o.icon || ''}</span><span class="eq-txt"><b>${o.name}</b><small>${o.desc}</small></span><span class="eq-stk ${reason ? 'bad' : ''}">${reason || stk}</span></button>`;
    }).join('');
    const clear = field === 'items' ? `<button class="btn eq-opt" data-opt="">✕ Platz leeren</button>` : '';
    const label = field === 'weapon' ? 'Waffe wählen' : field === 'armor' ? 'Rüstung wählen' : `Gürtel ${slot + 1}`;
    const ph = modal({ title: `${label} – ${s.name}`, html: `<div class="eq-opts">${rows}${clear}</div>`, buttons: [{ label: 'Zurück' }] });
    ph.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-opt]'); if (!b || b.disabled) return;
      const id = b.dataset.opt || null;
      if (setEquip(s, field, id, pool, stock, slot, gear)) { sfx('select'); focusKey = `[data-slot="${key}"]`; ph.close(); redraw(); }
      else { sfx('deny'); toast('Nicht verfügbar.', 'warn'); }
    });
    setTimeout(() => ph.el.querySelector('.eq-opt.on, .eq-opt:not(:disabled)')?.focus(), 40);
  }

  h.el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.sold != null) { sfx('click'); sel = +b.dataset.sold; focusKey = `[data-sold="${sel}"]`; redraw(); }
    else if (b.dataset.nav) { sfx('click'); go(+b.dataset.nav); body.querySelector(`[data-nav="${b.dataset.nav}"]`)?.focus(); }
    else if (b.dataset.slot) { sfx('click'); pick(b.dataset.slot); }
  });
  return h;
}
