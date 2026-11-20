// UI-System: Modale Fenster, Toasts, schwebende Texte – vollständig per Maus, Touch und Controller bedienbar
import { Input } from './input.js';
import { sfx } from './audio.js';

const root = () => document.getElementById('ui');
const stack = [];

Input.uiScope = () => {
  const cheat = document.querySelector('#cheat-panel.open');
  if (cheat) return cheat;
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i].el.isConnected) return stack[i].el;
  const scr = document.querySelector('.screen.active');
  return scr || null;
};

export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

export function modal({ title, html = '', buttons = [], onClose, cls = '', closable = true, wide = false }) {
  const backdrop = el('div', 'modal-backdrop');
  const box = el('div', `modal panel ${wide ? 'wide' : ''} ${cls}`);
  box.innerHTML = `${title ? `<div class="modal-title"><span>${title}</span>${closable ? '<button class="x" data-close aria-label="Schließen">✕</button>' : ''}</div>` : ''}<div class="modal-body">${html}</div>`;
  const foot = el('div', 'modal-foot');
  const handle = { el: box, backdrop, close };
  buttons.forEach((b) => {
    const btn = el('button', `btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}`, b.label);
    if (b.disabled) btn.disabled = true;
    btn.addEventListener('click', () => {
      sfx('click');
      const r = b.action?.(handle);
      if (b.close !== false && r !== false) close();
    });
    foot.appendChild(btn);
  });
  if (buttons.length) box.appendChild(foot);
  backdrop.appendChild(box);
  root().appendChild(backdrop);
  box.querySelector('[data-close]')?.addEventListener('click', () => { sfx('click'); close(); });
  if (closable) backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) close(); });
  box.addEventListener('navback', () => { if (closable) close(); });
  const entry = { el: box, close };
  stack.push(entry);
  let closed = false;
  function close() {
    if (closed) return; closed = true;
    const i = stack.indexOf(entry); if (i >= 0) stack.splice(i, 1);
    backdrop.classList.add('closing');
    setTimeout(() => backdrop.remove(), 160);
    onClose?.();
  }
  if (Input.lastDevice === 'pad' || Input.lastDevice === 'keyboard') {
    setTimeout(() => (box.querySelector('.modal-foot .primary') || box.querySelector('button:not([data-close])'))?.focus(), 30);
  }
  return handle;
}

export function confirmBox(text, yes = 'Ja', no = 'Abbrechen') {
  return new Promise((resolve) => {
    let val = false;
    modal({ title: 'Bestätigen', html: `<p>${text}</p>`, buttons: [{ label: no, action: () => { val = false; } }, { label: yes, primary: true, action: () => { val = true; } }], onClose: () => resolve(val) });
  });
}

export function alertBox(title, html, label = 'OK') {
  return new Promise((resolve) => modal({ title, html, buttons: [{ label, primary: true }], onClose: resolve }));
}

export function anyModalOpen() { return stack.length > 0; }
export function closeAllModals() { [...stack].forEach((m) => m.close()); }

let toastWrap = null;
export function toast(msg, type = 'info', ms = 3200) {
  if (!toastWrap) { toastWrap = el('div', 'toasts'); document.body.appendChild(toastWrap); }
  const t = el('div', `toast ${type}`, msg);
  toastWrap.appendChild(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

export function floatText(x, y, text, color = '#fff', big = false) {
  const t = el('div', `float-text ${big ? 'big' : ''}`, text);
  t.style.left = x + 'px'; t.style.top = y + 'px'; t.style.color = color;
  document.getElementById('ui').appendChild(t);
  setTimeout(() => t.remove(), 1400);
}

export function banner(text, sub = '', cls = '') {
  const b = el('div', `banner ${cls}`, `<div class="b-main">${text}</div>${sub ? `<div class="b-sub">${sub}</div>` : ''}`);
  document.getElementById('ui').appendChild(b);
  setTimeout(() => b.classList.add('out'), 1500);
  setTimeout(() => b.remove(), 2000);
}

export function bar(value, max, cls = '') {
  const p = Math.max(0, Math.min(100, (value / max) * 100));
  return `<div class="bar ${cls}"><i style="width:${p}%"></i><span>${Math.round(value)}/${Math.round(max)}</span></div>`;
}
