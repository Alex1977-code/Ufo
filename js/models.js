// Prozedurale 3D-Modelle und PBR-Materialien (keine externen Assets)
import * as THREE from 'three';
import { canvasTexture } from './engine.js';
import { rand } from './util.js';

export const TILE = 2;

// ---------- Prozedurale Texturen ----------
function speckle(ctx, w, h, n, colors, size = 2) {
  for (let i = 0; i < n; i++) { ctx.fillStyle = colors[(Math.random() * colors.length) | 0]; ctx.fillRect(Math.random() * w, Math.random() * h, size, size); }
}
const tex = {};
export function textures() {
  if (tex.brick) return tex;
  tex.brick = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#5b5550'; c.fillRect(0, 0, w, h);
    const bh = 32, bw = 64;
    for (let y = 0; y < h; y += bh) for (let x = -bw; x < w; x += bw) {
      const off = (y / bh) % 2 ? bw / 2 : 0;
      const v = 110 + Math.random() * 50;
      c.fillStyle = `rgb(${v + 30},${v * 0.6},${v * 0.45})`;
      c.fillRect(x + off + 2, y + 2, bw - 4, bh - 4);
    }
    speckle(c, w, h, 3000, ['rgba(0,0,0,0.15)', 'rgba(255,255,255,0.06)']);
  });
  tex.wood = canvasTexture(256, 256, (c, w, h) => {
    for (let x = 0; x < w; x += 32) {
      const v = 90 + Math.random() * 40; c.fillStyle = `rgb(${v + 20},${v * 0.7},${v * 0.4})`; c.fillRect(x, 0, 31, h);
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(x + 31, 0, 1, h);
      for (let k = 0; k < 20; k++) { c.fillStyle = 'rgba(40,20,5,0.15)'; c.fillRect(x + Math.random() * 30, 0, 1, h); }
    }
  });
  tex.metal = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#6a7380'; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(10,15,25,0.6)'; c.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(0, i * 64); c.lineTo(w, i * 64); c.stroke(); c.beginPath(); c.moveTo(i * 64 + (i % 2) * 20, 0); c.lineTo(i * 64 + (i % 2) * 20, h); c.stroke(); }
    speckle(c, w, h, 1500, ['rgba(255,255,255,0.05)', 'rgba(0,0,0,0.1)'], 1);
    for (let i = 0; i < 30; i++) { c.fillStyle = 'rgba(20,25,35,0.6)'; c.beginPath(); c.arc(Math.random() * w, Math.random() * h, 2, 0, 7); c.fill(); }
  });
  tex.hive = canvasTexture(256, 256, (c, w, h) => {
    const g = c.createRadialGradient(128, 128, 10, 128, 128, 180); g.addColorStop(0, '#3a1f3d'); g.addColorStop(1, '#1a0d1c');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(190,80,255,0.35)'; c.lineWidth = 2;
    for (let i = 0; i < 14; i++) { c.beginPath(); let x = Math.random() * w, y = Math.random() * h; c.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (Math.random() - 0.5) * 60; y += (Math.random() - 0.5) * 60; c.lineTo(x, y); } c.stroke(); }
    speckle(c, w, h, 2000, ['rgba(0,0,0,0.25)', 'rgba(120,60,140,0.2)'], 3);
  });
  tex.hiveEmit = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(200,90,255,0.9)'; c.lineWidth = 1.5;
    for (let i = 0; i < 10; i++) { c.beginPath(); let x = Math.random() * w, y = Math.random() * h; c.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (Math.random() - 0.5) * 60; y += (Math.random() - 0.5) * 60; c.lineTo(x, y); } c.stroke(); }
  });
  tex.leaf = canvasTexture(128, 128, (c, w, h) => { c.fillStyle = '#3f6b2a'; c.fillRect(0, 0, w, h); speckle(c, w, h, 2500, ['#2c5220', '#5a8a3a', '#1f3d18', '#6f9e48'], 3); });
  tex.bark = canvasTexture(64, 128, (c, w, h) => { c.fillStyle = '#4a3423'; c.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 4) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.4})`; c.fillRect(x, 0, 2, h); } });
  tex.rock = canvasTexture(128, 128, (c, w, h) => { c.fillStyle = '#7a7670'; c.fillRect(0, 0, w, h); speckle(c, w, h, 3000, ['#5f5b56', '#8f8a83', '#4b4844', '#a29d95'], 3); });
  tex.hay = canvasTexture(128, 128, (c, w, h) => { c.fillStyle = '#c9a54a'; c.fillRect(0, 0, w, h); for (let i = 0; i < 400; i++) { c.strokeStyle = Math.random() < 0.5 ? '#e0c46a' : '#9b7a2c'; c.beginPath(); const x = Math.random() * w, y = Math.random() * h; c.moveTo(x, y); c.lineTo(x + (Math.random() - 0.5) * 20, y + (Math.random() - 0.5) * 6); c.stroke(); } });
  tex.concrete = canvasTexture(128, 128, (c, w, h) => { c.fillStyle = '#8d8b86'; c.fillRect(0, 0, w, h); speckle(c, w, h, 2500, ['#7b7974', '#a09e98', '#6e6c68'], 2); });
  // Fassaden-Atlas 4×2 Kacheln (je Kachel = eine Wandseite 2 m × 2,8 m), helle Grundtöne werden per Instanzfarbe getönt
  const glass = [];
  tex.facade = canvasTexture(1024, 512, (c) => {
    for (let i = 0; i < 8; i++) { c.save(); c.translate((i % 4) * 256, (i >> 2) * 256); c.beginPath(); c.rect(0, 0, 256, 256); c.clip(); drawFacade(c, i, glass, (i % 4) * 256, (i >> 2) * 256); c.restore(); }
  });
  tex.facadeD = dataTex(tex.facade, 0.55, 1, glass);
  tex.plain = canvasTexture(128, 128, (c, w, h) => { c.fillStyle = '#e6e2da'; c.fillRect(0, 0, w, h); speckle(c, w, h, 2200, ['rgba(0,0,0,0.06)', 'rgba(255,255,255,0.08)', 'rgba(90,80,70,0.08)'], 2); });
  tex.roofTiles = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#6d6a66'; c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 21) for (let x = -32; x < w; x += 32) {
      const off = (y / 21) % 2 ? 16 : 0, v = 190 + Math.random() * 50;
      const g = c.createLinearGradient(0, y, 0, y + 21); g.addColorStop(0, `rgb(${v},${v},${v})`); g.addColorStop(1, `rgb(${v * 0.62},${v * 0.62},${v * 0.62})`);
      c.fillStyle = g; c.beginPath(); if (c.roundRect) c.roundRect(x + off + 1, y, 30, 20, [0, 0, 9, 9]); else c.rect(x + off + 1, y, 30, 20); c.fill();
    }
    speckle(c, w, h, 2500, ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.07)'], 2);
  });
  tex.roofTilesD = dataTex(tex.roofTiles, 0.6, 1);
  tex.roofFlat = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#8a8884'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 9000, ['#77746f', '#9b9893', '#6a6762', '#aaa69f'], 2);
    c.strokeStyle = 'rgba(30,30,30,0.35)'; c.lineWidth = 2; for (let x = 0; x <= w; x += 128) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
    for (let i = 0; i < 6; i++) { c.fillStyle = 'rgba(40,40,40,0.12)'; c.beginPath(); c.ellipse(Math.random() * w, Math.random() * h, 20 + Math.random() * 40, 10 + Math.random() * 20, Math.random() * 3, 0, 7); c.fill(); }
  });
  tex.roofFlatD = dataTex(tex.roofFlat, 0.75, 1);
  tex.fabric = canvasTexture(64, 64, (c, w, h) => { c.fillStyle = '#d8d8d8'; c.fillRect(0, 0, w, h); for (let i = 0; i < w; i += 2) { c.fillStyle = 'rgba(0,0,0,0.07)'; c.fillRect(i, 0, 1, h); c.fillRect(0, i, w, 1); } speckle(c, w, h, 300, ['rgba(255,255,255,0.15)', 'rgba(0,0,0,0.08)'], 1); });
  // Höhen-/Rauheitsdaten für vorhandene Materialtexturen (R = Relief, G = Rauheit)
  tex.woodLight = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#e6ddd0'; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) { c.fillStyle = `rgba(120,90,60,${0.05 + Math.random() * 0.08})`; c.fillRect(x, 0, 31, h); c.fillStyle = 'rgba(60,40,20,0.3)'; c.fillRect(x + 31, 0, 1, h); for (let k = 0; k < 16; k++) { c.fillStyle = 'rgba(90,60,30,0.12)'; c.fillRect(x + Math.random() * 30, 0, 1, h); } }
  });
  for (const k of ['brick', 'wood', 'metal', 'rock', 'bark', 'concrete', 'hay', 'leaf', 'hive', 'plain']) tex[k + 'D'] = dataTex(tex[k], k === 'metal' ? 0.4 : 0.7, 1);
  return tex;
}
// Alle zwischengespeicherten Texturen von der GPU nehmen (werden bei erneuter Nutzung automatisch neu hochgeladen)
export function releaseTextures() { for (const t of Object.values(tex)) t?.dispose?.(); }

// ---------- Bei Bedarf erzeugte Texturen der Karten-Hindernisse (nur was auf der Karte vorkommt, kostet Zeit/Speicher) ----------
const rnd = Math.random;
const rrect = (c, x, y, w, h, r) => { c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h); };
// Verästelter Riss (Putz, Eis, Beton)
function crack(c, x, y, len, ang, width = 1, col = 'rgba(40,34,28,0.55)', depth = 0) {
  c.strokeStyle = col; c.lineWidth = width; c.beginPath(); c.moveTo(x, y);
  for (let i = 0; i < len; i++) {
    ang += (rnd() - 0.5) * 0.9; x += Math.cos(ang) * 5; y += Math.sin(ang) * 5; c.lineTo(x, y);
    if (depth < 2 && rnd() < 0.08) { c.stroke(); crack(c, x, y, len * 0.4, ang + (rnd() < 0.5 ? 0.8 : -0.8), width * 0.7, col, depth + 1); c.strokeStyle = col; c.lineWidth = width; c.beginPath(); c.moveTo(x, y); }
  }
  c.stroke();
}
// Rostfahnen/Laufspuren
function streaks(c, w, h, n, col, y0 = 0, len = 0.5) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, y = y0 + rnd() * h * 0.2, l = h * len * (0.3 + rnd()), sw = 2 + rnd() * 6;
    const g = c.createLinearGradient(0, y, 0, y + l); g.addColorStop(0, col); g.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
    c.fillStyle = g; c.fillRect(x, y, sw, l);
  }
}
function blotch(c, x, y, r, col) { const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col); g.addColorStop(1, col.replace(/[\d.]+\)$/, '0)')); c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); }
// Text auf Breite einpassen
function fitText(c, s, x, y, maxW, font, col) { c.font = font; c.fillStyle = col; const m = c.measureText(s).width; c.save(); c.translate(x, y); if (m > maxW) c.scale(maxW / m, 1); c.fillText(s, 0, 0); c.restore(); }
// Laufband vertikaler Wellen (Trapez-/Wellblech) in einem Bereich
function corrugate(c, x0, y0, w, h, period, lo = 'rgba(0,0,0,0.28)', hi = 'rgba(255,255,255,0.22)', vertical = true) {
  for (let p = 0; p < (vertical ? w : h); p += period) {
    const g = vertical ? c.createLinearGradient(x0 + p, 0, x0 + p + period, 0) : c.createLinearGradient(0, y0 + p, 0, y0 + p + period);
    g.addColorStop(0, lo); g.addColorStop(0.35, hi); g.addColorStop(0.55, 'rgba(255,255,255,0.05)'); g.addColorStop(1, lo);
    c.fillStyle = g; if (vertical) c.fillRect(x0 + p, y0, Math.min(period, w - p), h); else c.fillRect(x0, y0 + p, w, Math.min(period, h - p));
  }
}
// Pixelrechteck einer Atlas-Textur (S×S) als UV-Bereich [u0, v0, u1, v1]
export const pxRect = (x0, y0, x1, y1, S = 256, SV = S) => [x0 / S, 1 - y1 / SV, x1 / S, 1 - y0 / SV];
const TEXGEN = {
  // Naturstein-Bruchsteinmauerwerk; Kachel = Wandseite 2 m × 2,8 m
  stoneWall: () => canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#6b655c'; c.fillRect(0, 0, w, h); speckle(c, w, h, 3000, ['#5a554d', '#7d776d', '#4d4943'], 2);
    let y = -6;
    while (y < h) {
      const rh = 16 + rnd() * 18; let x = -rnd() * 50;
      while (x < w) {
        const rw = 28 + rnd() * 52, v = 118 + rnd() * 55, k = [[1, 0.95, 0.88], [1, 0.9, 0.78], [0.95, 0.95, 0.94], [1, 0.92, 0.8]][(rnd() * 4) | 0];
        for (const ox of [0, -w, w]) {
          const sx = x + ox + 1.5 + rnd() * 2, sy = y + 1.5 + rnd() * 2, sw = rw - 3 - rnd() * 3, sh = rh - 3 - rnd() * 3;
          if (sx > w || sx + sw < 0) continue;
          c.fillStyle = `rgb(${v * k[0]},${v * k[1]},${v * k[2]})`; rrect(c, sx, sy, sw, sh, 3 + rnd() * 5); c.fill();
          const g = c.createLinearGradient(sx, sy, sx + sw * 0.3, sy + sh); g.addColorStop(0, 'rgba(255,255,255,0.1)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.18)');
          c.fillStyle = g; rrect(c, sx, sy, sw, sh, 4); c.fill();
        }
        x += rw;
      }
      y += rh;
    }
    speckle(c, w, h, 5000, ['rgba(0,0,0,0.16)', 'rgba(255,255,255,0.08)', 'rgba(60,50,40,0.12)'], 2);
    for (let i = 0; i < 9; i++) blotch(c, rnd() * w, rnd() * h, 6 + rnd() * 14, rnd() < 0.5 ? 'rgba(150,160,70,0.28)' : 'rgba(60,70,40,0.25)');
    const g = c.createLinearGradient(0, h * 0.78, 0, h); g.addColorStop(0, 'rgba(40,36,28,0)'); g.addColorStop(1, 'rgba(40,36,28,0.4)'); c.fillStyle = g; c.fillRect(0, 0, w, h);
  }),
  // Sichtbeton mit Schalungsfugen, Ankerlöchern und Wasserfahnen
  formConcrete: () => canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#b9b7b1'; c.fillRect(0, 0, w, h);
    for (let py = 0; py < 4; py++) for (let px = 0; px < 2; px++) { const v = 172 + rnd() * 26; c.fillStyle = `rgba(${v},${v - 2},${v - 6},0.55)`; c.fillRect(px * 128, py * 64, 128, 64); }
    for (let y = 0; y < h; y += 8) { c.fillStyle = `rgba(0,0,0,${0.02 + rnd() * 0.04})`; c.fillRect(0, y, w, 1); }
    speckle(c, w, h, 4000, ['rgba(0,0,0,0.1)', 'rgba(255,255,255,0.1)'], 1.5);
    speckle(c, w, h, 260, ['rgba(30,30,30,0.45)'], 2);
    c.fillStyle = 'rgba(50,50,48,0.55)'; for (let y = 64; y < h; y += 64) c.fillRect(0, y - 1, w, 2); c.fillRect(127, 0, 2, h);
    for (let py = 0; py < 4; py++) for (const px of [32, 96, 160, 224]) { const x = px, y = py * 64 + 32; c.fillStyle = 'rgba(210,208,200,0.9)'; c.beginPath(); c.arc(x, y, 5, 0, 7); c.fill(); c.fillStyle = 'rgba(40,40,40,0.8)'; c.beginPath(); c.arc(x, y, 3, 0, 7); c.fill(); }
    streaks(c, w, h, 16, 'rgba(60,60,58,0.16)', 0, 0.6);
    const g = c.createLinearGradient(0, h * 0.8, 0, h); g.addColorStop(0, 'rgba(50,46,40,0)'); g.addColorStop(1, 'rgba(50,46,40,0.35)'); c.fillStyle = g; c.fillRect(0, 0, w, h);
  }),
  // Wellblech (hell, per Instanzfarbe tönbar) mit Schraubenreihen, Rost und Schmutz
  corrugated: () => canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#cfd3d6'; c.fillRect(0, 0, w, h);
    corrugate(c, 0, 0, w, h, 16, 'rgba(40,45,50,0.4)', 'rgba(255,255,255,0.35)');
    speckle(c, w, h, 2500, ['rgba(0,0,0,0.06)', 'rgba(255,255,255,0.08)'], 1.5);
    for (const y of [14, 120, 240]) for (let x = 8; x < w; x += 16) { c.fillStyle = 'rgba(30,30,30,0.7)'; c.beginPath(); c.arc(x, y, 1.6, 0, 7); c.fill(); }
    for (let i = 0; i < 10; i++) blotch(c, rnd() * w, rnd() * h, 6 + rnd() * 22, 'rgba(140,70,30,0.45)');
    streaks(c, w, h, 24, 'rgba(130,64,26,0.35)', 10, 0.5); streaks(c, w, h, 10, 'rgba(130,64,26,0.3)', 120, 0.4);
    const g = c.createLinearGradient(0, h * 0.75, 0, h); g.addColorStop(0, 'rgba(70,55,35,0)'); g.addColorStop(1, 'rgba(70,55,35,0.5)'); c.fillStyle = g; c.fillRect(0, 0, w, h);
  }),
  // Putz mit Rissen, Abplatzungen (Mauerwerk sichtbar) und feuchtem Sockel
  plasterCrack: () => canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#ece7dc'; c.fillRect(0, 0, w, h);
    for (let k = 0; k < 50; k++) blotch(c, rnd() * w, rnd() * h, 10 + rnd() * 30, rnd() < 0.5 ? 'rgba(120,110,95,0.07)' : 'rgba(255,255,255,0.1)');
    speckle(c, w, h, 4000, ['rgba(0,0,0,0.07)', 'rgba(255,255,255,0.12)'], 2);
    for (let k = 0; k < 1; k++) {
      const x = 20 + rnd() * 200, y = 40 + rnd() * 150, pw = 12 + rnd() * 12, ph = 9 + rnd() * 8;
      c.save(); c.beginPath(); c.moveTo(x, y); for (let a = 0; a < 6.28; a += 0.6) c.lineTo(x + Math.cos(a) * pw * (0.6 + rnd() * 0.5), y + Math.sin(a) * ph * (0.6 + rnd() * 0.5)); c.closePath();
      c.fillStyle = 'rgba(70,60,50,0.6)'; c.fill(); c.clip();
      for (let by = y - 40; by < y + 40; by += 9) for (let bx = x - 60 + ((by / 9) % 2) * 9; bx < x + 60; bx += 18) { const v = 120 + rnd() * 30; c.fillStyle = `rgb(${v},${v * 0.7},${v * 0.6})`; c.fillRect(bx, by, 16, 7); }
      c.restore();
    }
    for (let k = 0; k < 5; k++) crack(c, rnd() * w, rnd() * h * 0.7, 12 + rnd() * 16, 1.2 + (rnd() - 0.5) * 1.5, 1.2);
    crack(c, 0, rnd() * 60, 18, 0.7, 1.4);
    streaks(c, w, h, 8, 'rgba(90,85,75,0.14)', 0, 0.5);
    const g = c.createLinearGradient(0, h * 0.72, 0, h); g.addColorStop(0, 'rgba(70,75,60,0)'); g.addColorStop(1, 'rgba(70,75,60,0.45)'); c.fillStyle = g; c.fillRect(0, 0, w, h);
  }),
  // Jute-Sackgewebe
  burlap: () => canvasTexture(128, 128, (c, w, h) => {
    c.fillStyle = '#c4b28a'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < w; i += 3) { c.fillStyle = `rgba(80,60,30,${0.12 + rnd() * 0.1})`; c.fillRect(i, 0, 1, h); c.fillStyle = `rgba(80,60,30,${0.1 + rnd() * 0.1})`; c.fillRect(0, i, w, 1); }
    speckle(c, w, h, 900, ['rgba(255,255,255,0.12)', 'rgba(0,0,0,0.12)'], 1);
    for (let i = 0; i < 4; i++) blotch(c, rnd() * w, rnd() * h, 8 + rnd() * 16, 'rgba(60,45,25,0.2)');
  }),
  // Birkenrinde: weiß mit Lentizellen, unten dunkle Borke
  birchBark: () => canvasTexture(64, 256, (c, w, h) => {
    c.fillStyle = '#e9e6de'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 600, ['rgba(160,150,130,0.25)', 'rgba(255,255,255,0.3)'], 2);
    for (let i = 0; i < 70; i++) { c.fillStyle = `rgba(25,22,20,${0.5 + rnd() * 0.4})`; const y = rnd() * h; c.fillRect(rnd() * w - 4, y, 5 + rnd() * 18, 1 + rnd() * 2.5); }
    for (let i = 0; i < 10; i++) { c.fillStyle = 'rgba(30,28,26,0.7)'; c.beginPath(); c.ellipse(rnd() * w, rnd() * h * 0.85, 3 + rnd() * 5, 2 + rnd() * 4, 0, 0, 7); c.fill(); }
    const g = c.createLinearGradient(0, h * 0.78, 0, h); g.addColorStop(0, 'rgba(40,36,32,0)'); g.addColorStop(0.4, 'rgba(40,36,32,0.6)'); g.addColorStop(1, 'rgba(30,26,22,0.95)'); c.fillStyle = g; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 5) { c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(x + rnd() * 2, h * 0.86, 1.5, h * 0.14); }
  }),
  // Palmenstamm: Blattnarben-Ringe mit Rautenmuster
  palmBark: () => canvasTexture(64, 128, (c, w, h) => {
    c.fillStyle = '#7a6a52'; c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) for (let x = -8; x < w + 8; x += 16) {
      const o = (y / 16) % 2 ? 8 : 0, g = c.createLinearGradient(0, y, 0, y + 16); g.addColorStop(0, '#9a8a6c'); g.addColorStop(0.7, '#6d5d46'); g.addColorStop(1, '#3e3428');
      c.fillStyle = g; c.beginPath(); c.moveTo(x + o, y); c.lineTo(x + o + 8, y + 8); c.lineTo(x + o, y + 16); c.lineTo(x + o - 8, y + 8); c.fill();
    }
    speckle(c, w, h, 500, ['rgba(0,0,0,0.2)', 'rgba(255,240,200,0.1)'], 1.5);
  }),
  // Palmwedel: Mittelrippe + Fiederblättchen, Alpha-Ausschnitt
  frond: () => canvasTexture(128, 256, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    for (let y = h - 14; y > 4; y -= 3.2) {
      const s = 1 - y / h, L = 60 * Math.sin(Math.PI * Math.min(1, s * 1.05)) + 6;
      for (const d of [-1, 1]) {
        const v = 0.75 + rnd() * 0.35; c.strokeStyle = `rgb(${120 * v},${160 * v},${70 * v})`; c.lineWidth = 2.6;
        c.beginPath(); c.moveTo(64, y); c.quadraticCurveTo(64 + d * L * 0.5, y - 6, 64 + d * L, y - 16 - rnd() * 6); c.stroke();
      }
    }
    c.fillStyle = '#d8d0a0'; c.fillRect(61, 0, 6, h);
  }, { wrap: false }),
  // Hirnholz mit Jahresringen (Stirnseiten, Baumstumpf)
  endGrain: () => canvasTexture(128, 128, (c, w, h) => {
    c.fillStyle = '#c8a26c'; c.fillRect(0, 0, w, h);
    for (let r = 4; r < 62; r += 2.5 + rnd() * 2.5) { c.strokeStyle = `rgba(110,70,35,${0.25 + rnd() * 0.3})`; c.lineWidth = 1 + rnd(); c.beginPath(); c.ellipse(64 + rnd() * 2, 64 + rnd() * 2, r, r * (0.95 + rnd() * 0.08), 0, 0, 7); c.stroke(); }
    for (let i = 0; i < 5; i++) { const a = rnd() * 6.28; c.strokeStyle = 'rgba(60,35,15,0.6)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(64 + Math.cos(a) * 8, 64 + Math.sin(a) * 8); c.lineTo(64 + Math.cos(a) * (30 + rnd() * 30), 64 + Math.sin(a) * (30 + rnd() * 30)); c.stroke(); }
    c.strokeStyle = '#4a3423'; c.lineWidth = 6; c.beginPath(); c.arc(64, 64, 61, 0, 7); c.stroke();
    speckle(c, w, h, 600, ['rgba(0,0,0,0.1)', 'rgba(255,255,255,0.08)'], 1);
  }),
  // 200-l-Stahlfass: heller Lack (tönbar), Sicken, Kratzer, Rost
  drum: () => canvasTexture(256, 128, (c, w, h) => {
    c.fillStyle = '#d6d6d4'; c.fillRect(0, 0, w, h); drumWear(c, w, h);
  }),
  // Treibstofffass: rot mit Gefahrzettel Klasse 3
  fuelDrum: () => canvasTexture(256, 128, (c, w, h) => {
    c.fillStyle = '#b3261e'; c.fillRect(0, 0, w, h); drumWear(c, w, h);
    for (const lx of [40, 168]) {
      c.fillStyle = '#efe9dc'; c.fillRect(lx, 34, 58, 58);
      c.save(); c.translate(lx + 29, 63); c.rotate(Math.PI / 4); c.fillStyle = '#d42a1e'; c.fillRect(-17, -17, 34, 34); c.strokeStyle = '#111'; c.lineWidth = 1.5; c.strokeRect(-15, -15, 30, 30); c.restore();
      c.fillStyle = '#111'; c.beginPath(); c.moveTo(lx + 29, 46); c.bezierCurveTo(lx + 38, 56, lx + 37, 66, lx + 29, 71); c.bezierCurveTo(lx + 21, 66, lx + 21, 58, lx + 26, 54); c.bezierCurveTo(lx + 26, 60, lx + 30, 60, lx + 29, 46); c.fill();
      fitText(c, '3', lx + 26, 86, 8, 'bold 9px sans-serif', '#111');
      fitText(c, 'DIESEL', lx + 6, 30, 46, 'bold 10px sans-serif', '#f4f0e6');
      fitText(c, 'UN 1202', lx + 8, 104, 42, 'bold 9px sans-serif', '#f4f0e6');
    }
  }),
  // Zapfsäulen-Front (links) + Lackfläche (rechts)
  pump: () => canvasTexture(256, 256, (c) => pumpFace(c, false)),
  pumpEmit: () => canvasTexture(256, 256, (c) => pumpFace(c, true)),
  // Fahrzeug-Detailatlas (Glas, Reifen, Kunststoff, Chrom, Leuchten, Gitter, Felge, Zielanzeige, Kennzeichen, Busfenster)
  veh: () => canvasTexture(256, 256, (c) => vehAtlas(c, false)),
  vehR: () => { const t = canvasTexture(256, 256, (c) => vehAtlas(c, true), { srgb: false }); return t; },
  // Schiffscontainer-Atlas: 4 Farben (Spalten) × [Seiten | Tür/Stirn/Lack]
  container: () => canvasTexture(1024, 512, (c) => containerAtlas(c)),
  // Militärkisten: Schablonenschrift (oben), Stirnseite, Lackfläche (unten)
  milcrate: () => canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#4e5528'; c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) { c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(0, y, w, 1.5); c.fillStyle = 'rgba(255,255,255,0.05)'; c.fillRect(0, y + 2, w, 2); }
    speckle(c, w, h, 3000, ['rgba(0,0,0,0.12)', 'rgba(255,255,230,0.07)'], 2);
    c.strokeStyle = 'rgba(30,30,15,0.6)'; c.lineWidth = 3; c.strokeRect(3, 3, 122, 122); c.strokeRect(131, 3, 122, 122);
    fitText(c, 'AEGIS', 14, 44, 100, 'bold 30px monospace', 'rgba(235,220,140,0.85)');
    fitText(c, '7,62 MM  NATO', 14, 70, 100, 'bold 14px monospace', 'rgba(235,220,140,0.85)');
    fitText(c, 'LOS 4471-B   32 KG', 14, 92, 100, 'bold 11px monospace', 'rgba(235,220,140,0.8)');
    c.fillStyle = 'rgba(235,220,140,0.8)'; for (let i = 0; i < 6; i++) c.fillRect(14 + i * 17, 104, 10, 6);
    c.fillStyle = '#2b2a20'; rrect(c, 156, 50, 72, 26, 8); c.fill(); c.fillStyle = '#6a6a5a'; c.fillRect(152, 58, 8, 10); c.fillRect(224, 58, 8, 10);
    fitText(c, '↑ OBEN', 160, 108, 64, 'bold 13px monospace', 'rgba(235,220,140,0.85)');
    for (let i = 0; i < 40; i++) { c.fillStyle = 'rgba(150,140,110,0.35)'; c.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 10, 1); }
    c.fillStyle = 'rgba(0,0,0,0.15)'; c.fillRect(0, 128, w, 128); speckle(c, w, 128, 1500, ['rgba(255,255,230,0.08)'], 2);
  }),
  // Grabstein: polierter Granit (hell, tönbar) mit gravierter Inschrift (links) + Fläche (rechts)
  grave: () => canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#cfcfcc'; c.fillRect(0, 0, w, h); speckle(c, w, h, 9000, ['#b0b0ad', '#e6e6e3', '#8f8f8c', '#f4f4f2'], 1.5);
    c.fillStyle = 'rgba(50,50,50,0.75)'; c.fillRect(58, 30, 12, 46); c.fillRect(46, 42, 36, 10);
    for (const [y, lw] of [[100, 90], [124, 70], [150, 50], [168, 60], [192, 80]]) for (let x = 64 - lw / 2; x < 64 + lw / 2; x += 6 + rnd() * 4) c.fillRect(x, y, 3 + rnd() * 3, y < 140 ? 9 : 6);
  }),
  // Lackierter Stahltank (Wasserturm): Nahtreihen mit Nieten, Rostfahnen
  tankPaint: () => canvasTexture(256, 128, (c, w, h) => {
    c.fillStyle = '#dedede'; c.fillRect(0, 0, w, h); speckle(c, w, h, 2000, ['rgba(0,0,0,0.06)', 'rgba(255,255,255,0.1)'], 1.5);
    for (const y of [4, 44, 84, 124]) { c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(0, y, w, 2); for (let x = 2; x < w; x += 6) { c.fillStyle = 'rgba(40,40,40,0.6)'; c.fillRect(x, y - 2, 2, 2); } }
    for (let x = 0; x < w; x += 64) { c.fillStyle = 'rgba(0,0,0,0.2)'; c.fillRect(x, 0, 2, h); }
    streaks(c, w, h, 18, 'rgba(130,64,26,0.4)', 4, 0.6); streaks(c, w, h, 10, 'rgba(130,64,26,0.3)', 44, 0.5);
  }),
  // Silo: verzinktes, horizontal gewelltes Blech mit Schraubennähten
  silo: () => canvasTexture(128, 128, (c, w, h) => {
    c.fillStyle = '#c3c8cc'; c.fillRect(0, 0, w, h);
    corrugate(c, 0, 0, w, h, 8, 'rgba(40,45,50,0.35)', 'rgba(255,255,255,0.4)', false);
    for (let x = 0; x < w; x += 64) for (let y = 2; y < h; y += 4) { c.fillStyle = 'rgba(30,30,30,0.5)'; c.fillRect(x, y, 1.5, 1.5); }
    for (let i = 0; i < 8; i++) blotch(c, rnd() * w, rnd() * h, 4 + rnd() * 10, 'rgba(255,255,255,0.15)');
    streaks(c, w, h, 6, 'rgba(110,80,50,0.18)', 0, 0.8);
  }),
  // Maschendraht (RGBA, kachelbar)
  chain: () => canvasTexture(64, 64, (c, w, h) => {
    c.clearRect(0, 0, w, h); c.lineCap = 'round';
    for (const [col, lw] of [['rgba(40,44,48,0.9)', 3.2], ['rgba(185,192,198,1)', 1.8]]) {
      c.strokeStyle = col; c.lineWidth = lw;
      for (const o of [-64, 0, 64]) { c.beginPath(); c.moveTo(o, 0); c.lineTo(o + 32, 32); c.lineTo(o, 64); c.stroke(); c.beginPath(); c.moveTo(o + 64, 0); c.lineTo(o + 32, 32); c.lineTo(o + 64, 64); c.stroke(); }
    }
  }),
  // Wellen-Normalmap (kachelbar, Summe ganzzahliger Sinuswellen)
  waterN: () => {
    const N = 128, cv = document.createElement('canvas'); cv.width = cv.height = N;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(N, N), d = img.data;
    const waves = Array.from({ length: 14 }, (_, i) => ({ kx: ((rnd() * 13) | 0) - 6 || 2, ky: ((rnd() * 13) | 0) - 6 + (i % 2), a: 0.5 / (1 + i * 0.3), p: rnd() * 6.28 }));
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let dx = 0, dy = 0;
      for (const w of waves) { const ph = (2 * Math.PI * (w.kx * x + w.ky * y)) / N + w.p, cc = Math.cos(ph) * w.a; dx += cc * w.kx; dy += cc * w.ky; }
      const nx = -dx * 0.18, ny = -dy * 0.18, l = Math.hypot(nx, ny, 1), i = (y * N + x) * 4;
      d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; return t;
  },
};
function drumWear(c, w, h) {
  for (const y of [h / 3, (2 * h) / 3]) { const g = c.createLinearGradient(0, y - 5, 0, y + 5); g.addColorStop(0, 'rgba(0,0,0,0.3)'); g.addColorStop(0.5, 'rgba(255,255,255,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0.3)'); c.fillStyle = g; c.fillRect(0, y - 5, w, 10); }
  c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(0, 0, w, 4); c.fillRect(0, h - 4, w, 4);
  speckle(c, w, h, 1500, ['rgba(0,0,0,0.08)', 'rgba(255,255,255,0.1)'], 1.5);
  for (let i = 0; i < 30; i++) { c.strokeStyle = 'rgba(220,220,220,0.35)'; c.lineWidth = 0.8; c.beginPath(); const x = rnd() * w, y = rnd() * h; c.moveTo(x, y); c.lineTo(x + (rnd() - 0.5) * 30, y + (rnd() - 0.5) * 8); c.stroke(); }
  for (let i = 0; i < 7; i++) blotch(c, rnd() * w, rnd() * h, 4 + rnd() * 12, 'rgba(120,60,25,0.5)');
  streaks(c, w, h, 10, 'rgba(110,55,22,0.35)', 0, 0.4);
  const g = c.createLinearGradient(0, h * 0.75, 0, h); g.addColorStop(0, 'rgba(60,45,30,0)'); g.addColorStop(1, 'rgba(60,45,30,0.45)'); c.fillStyle = g; c.fillRect(0, 0, w, h);
}
function pumpFace(c, emit) {
  c.fillStyle = emit ? '#000' : '#eef0f0'; c.fillRect(0, 0, 256, 256);
  if (!emit) {
    c.fillStyle = '#1f5fa8'; c.fillRect(0, 0, 128, 34); c.fillStyle = '#e8b818'; c.fillRect(0, 34, 128, 6);
    fitText(c, 'TANKSTELLE', 10, 24, 108, 'bold 17px sans-serif', '#ffffff');
    c.fillStyle = '#2a2e33'; rrect(c, 12, 50, 104, 74, 5); c.fill();
    c.fillStyle = '#c8ccd0'; c.fillRect(12, 136, 104, 1);
    for (const [y, s, col] of [[144, 'SUPER 95', '#2e8a3a'], [170, 'SUPER E10', '#2e6aa8'], [196, 'DIESEL', '#222222']]) { c.fillStyle = col; rrect(c, 14, y, 100, 20, 3); c.fill(); fitText(c, s, 20, y + 15, 60, 'bold 12px sans-serif', '#fff'); c.fillStyle = '#d8d8d8'; c.fillRect(88, y + 4, 22, 12); }
    c.fillStyle = '#9aa0a6'; for (let y = 226; y < 252; y += 5) c.fillRect(16, y, 96, 2);
    speckle(c, 128, 256, 800, ['rgba(0,0,0,0.06)'], 1.5);
    // Lackfläche rechts (für Seiten, Insel, Dach)
    c.fillStyle = '#f2f2f0'; c.fillRect(128, 0, 128, 256); speckle(c, 128, 256, 1500, ['rgba(0,0,0,0.06)', 'rgba(255,255,255,0.1)'], 2);
    const g = c.createLinearGradient(0, 200, 0, 256); g.addColorStop(0, 'rgba(60,55,45,0)'); g.addColorStop(1, 'rgba(60,55,45,0.25)'); c.fillStyle = g; c.fillRect(128, 0, 128, 256);
  }
  c.font = 'bold 20px monospace'; c.fillStyle = emit ? '#9effc8' : '#6adca0';
  fitText(c, '48,27 €', 22, 76, 84, 'bold 22px monospace', emit ? '#9effc8' : '#6adca0');
  fitText(c, '26,24 L', 22, 100, 84, 'bold 18px monospace', emit ? '#9effc8' : '#6adca0');
  fitText(c, '1,839 €/L', 26, 118, 76, 'bold 12px monospace', emit ? '#ffd27a' : '#e0b860');
  for (const y of [148, 174, 200]) fitText(c, '1,8' + ((y / 2) % 10), 89, y + 12, 20, 'bold 10px monospace', emit ? '#ffd27a' : '#c89a40');
}
// Bereiche des Fahrzeug-Atlas (Pixel in 256×256)
export const VEH = { glass: [0, 0, 64, 64], tire: [64, 0, 128, 64], black: [128, 0, 192, 64], chrome: [192, 0, 256, 64], head: [0, 64, 64, 128], tail: [64, 64, 128, 128], grille: [128, 64, 192, 128], rim: [192, 64, 256, 128], sign: [0, 128, 192, 160], plate: [0, 160, 96, 192], win: [192, 128, 256, 256], plain: [0, 192, 64, 256], amber: [64, 192, 128, 256], door: [128, 192, 192, 256], vent: [96, 160, 192, 192] };
function vehAtlas(c, rough) {
  const R = (k, col) => { const [x0, y0, x1, y1] = VEH[k]; c.fillStyle = col; c.fillRect(x0, y0, x1 - x0, y1 - y0); return [x0, y0, x1 - x0, y1 - y0]; };
  if (rough) { // G = Rauheit, R = Relief
    for (const [k, r] of Object.entries({ glass: 0.06, tire: 0.95, black: 0.7, chrome: 0.15, head: 0.15, tail: 0.2, grille: 0.6, rim: 0.3, sign: 0.3, plate: 0.5, win: 0.08, plain: 0.6, amber: 0.2, door: 0.1, vent: 0.7 })) R(k, `rgb(128,${Math.round(r * 255)},0)`);
    let [x, y, w, h] = VEH.tire; for (let i = 0; i < w; i += 6) { c.fillStyle = 'rgb(40,250,0)'; c.fillRect(x + i, y, 3, h); }
    [x, y, w, h] = VEH.grille; for (let i = 0; i < h; i += 8) { c.fillStyle = 'rgb(30,160,0)'; c.fillRect(x, y + i, w, 4); }
    [x, y, w, h] = VEH.win; c.fillStyle = 'rgb(128,150,0)'; c.fillRect(x, y, 6, h); c.fillRect(x + w - 6, y, 6, h);
    return;
  }
  let [x, y, w, h] = R('glass', '#1a2733'); let g = c.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, 'rgba(150,180,200,0.5)'); g.addColorStop(0.4, 'rgba(40,60,75,0)'); g.addColorStop(0.55, 'rgba(120,150,170,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(x, y, w, h);
  [x, y, w, h] = R('tire', '#1b1b1b'); for (let i = 0; i < w; i += 6) { c.fillStyle = '#2c2c2c'; c.fillRect(x + i, y, 3, h); }
  [x, y, w, h] = R('black', '#222324'); speckle(c, 0, 0, 0, []);
  for (let i = 0; i < 300; i++) { c.fillStyle = rnd() < 0.5 ? '#2c2d2e' : '#1a1a1b'; c.fillRect(x + rnd() * w, y + rnd() * h, 2, 2); }
  [x, y, w, h] = R('chrome', '#b8bec4'); g = c.createLinearGradient(x, y, x, y + h); g.addColorStop(0, '#f4f6f8'); g.addColorStop(0.45, '#8a9096'); g.addColorStop(0.55, '#5a6066'); g.addColorStop(1, '#dce0e4'); c.fillStyle = g; c.fillRect(x, y, w, h);
  [x, y, w, h] = R('head', '#e8ecf0'); g = c.createRadialGradient(x + 32, y + 32, 2, x + 32, y + 32, 34); g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#d8e0e8'); g.addColorStop(1, '#8a949e'); c.fillStyle = g; c.fillRect(x, y, w, h);
  [x, y, w, h] = R('tail', '#a8140e'); for (let i = 0; i < h; i += 10) { c.fillStyle = 'rgba(255,90,70,0.35)'; c.fillRect(x, y + i, w, 4); } c.fillStyle = '#e8a020'; c.fillRect(x, y + h - 16, w, 16);
  [x, y, w, h] = R('grille', '#141414'); for (let i = 0; i < h; i += 8) { c.fillStyle = '#4a4d50'; c.fillRect(x, y + i, w, 4); }
  [x, y, w, h] = R('rim', '#7a7e84'); g = c.createRadialGradient(x + 32, y + 32, 3, x + 32, y + 32, 32); g.addColorStop(0, '#d8dce0'); g.addColorStop(0.3, '#9aa0a6'); g.addColorStop(0.75, '#c8ccd0'); g.addColorStop(1, '#3a3c40'); c.fillStyle = g; c.fillRect(x, y, w, h);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.28; c.fillStyle = '#2a2c30'; c.beginPath(); c.arc(x + 32 + Math.cos(a) * 16, y + 32 + Math.sin(a) * 16, 3, 0, 7); c.fill(); }
  [x, y, w, h] = R('sign', '#0c0c0c'); fitText(c, '42  SONDERFAHRT', x + 6, y + 24, w - 12, 'bold 22px monospace', '#ffa21e');
  [x, y, w, h] = R('plate', '#f2f2f0'); c.fillStyle = '#1f4aa8'; c.fillRect(x, y, 10, h); c.strokeStyle = '#111'; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, w - 2, h - 2); fitText(c, 'AE·G 1994', x + 14, y + 23, w - 20, 'bold 18px sans-serif', '#111');
  [x, y, w, h] = R('vent', '#2a2c2e'); for (let i = 0; i < w; i += 6) { c.fillStyle = '#101112'; c.fillRect(x + i, y + 3, 3, h - 6); }
  [x, y, w, h] = R('win', '#1c2a36'); g = c.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, 'rgba(160,190,210,0.45)'); g.addColorStop(0.35, 'rgba(30,50,65,0)'); g.addColorStop(0.6, 'rgba(110,140,160,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(x, y, w, h);
  c.fillStyle = '#18191a'; c.fillRect(x, y, 6, h); c.fillRect(x + w - 6, y, 6, h); c.fillRect(x, y, w, 4); c.fillRect(x, y + h - 4, w, 4);
  [x, y, w, h] = R('plain', '#e4e4e2'); for (let i = 0; i < 200; i++) { c.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)'; c.fillRect(x + rnd() * w, y + rnd() * h, 2, 2); }
  [x, y, w, h] = R('amber', '#f0a020'); g = c.createRadialGradient(x + 32, y + 32, 2, x + 32, y + 32, 34); g.addColorStop(0, '#ffe0a0'); g.addColorStop(1, '#c87010'); c.fillStyle = g; c.fillRect(x, y, w, h);
  [x, y, w, h] = R('door', '#1c2a36'); c.fillStyle = '#18191a'; c.fillRect(x, y, 5, h); c.fillRect(x + w - 5, y, 5, h); c.fillRect(x + w / 2 - 2, y, 4, h); c.fillRect(x, y + h * 0.55, w, 4);
  g = c.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, 'rgba(150,180,200,0.35)'); g.addColorStop(0.5, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(x, y, w, h);
}
// Container-Atlas: Spalte = Farbe (Name), oben Seiten (A mit Reedereiname, B mit Kennung), unten Tür (links), Stirnwand + Lack (rechts)
export const CONTAINER_COLS = ['#a8432f', '#2c5a88', '#3e6e3c', '#cfcbc0'];
const CONTAINER_NAMES = [['HELIX', 'HLXU 482913 7'], ['NORVAL', 'NRVU 220756 1'], ['TRITON', 'TRTU 913042 5'], ['KESTREL', 'KSTU 640318 2']];
function containerAtlas(c) {
  for (let i = 0; i < 4; i++) {
    const X = i * 256, col = CONTAINER_COLS[i], [name, code] = CONTAINER_NAMES[i], txt = i === 3 ? '#2a2a2a' : '#f2f2ee';
    c.fillStyle = col; c.fillRect(X, 0, 256, 512);
    corrugate(c, X, 0, 256, 448, 18, 'rgba(0,0,0,0.32)', 'rgba(255,255,255,0.2)');
    speckle(c, 0, 0, 0, []);
    for (let k = 0; k < 1800; k++) { c.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.07)'; c.fillRect(X + rnd() * 256, rnd() * 512, 2, 2); }
    // Seite A: Name groß, Seite B: Kennung
    fitText(c, name, X + 10, 96, 108, 'bold 52px sans-serif', txt);
    fitText(c, name, X + 140, 70, 104, 'bold 26px sans-serif', txt);
    fitText(c, code, X + 140, 26, 104, 'bold 15px sans-serif', txt);
    fitText(c, '22G1', X + 140, 44, 40, 'bold 12px sans-serif', txt);
    fitText(c, 'MAX. GROSS 30.480 KG', X + 140, 224, 100, 'bold 9px sans-serif', txt);
    fitText(c, 'TARE 2.200 KG', X + 140, 236, 70, 'bold 9px sans-serif', txt);
    // Tür (links unten): zwei Flügel, Verschlussstangen, Scharniere, Schilder
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(X + 63, 256, 3, 256); c.fillRect(X, 256, 128, 4); c.fillRect(X, 508, 128, 4); c.fillRect(X, 256, 4, 256); c.fillRect(X + 124, 256, 4, 256);
    for (const rx of [18, 46, 82, 110]) { c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(X + rx + 2, 262, 4, 244); c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(X + rx, 262, 3, 244); c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(X + rx - 3, 420, 10, 6); }
    for (const hy of [276, 340, 420, 490]) { c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(X + 2, hy, 8, 10); c.fillRect(X + 118, hy, 8, 10); }
    c.fillStyle = '#e8e4d8'; c.fillRect(X + 70, 300, 22, 14); c.fillStyle = '#d8b030'; c.fillRect(X + 96, 300, 16, 14);
    fitText(c, code, X + 68, 290, 56, 'bold 8px sans-serif', txt);
    // Lackfläche (rechts unten) ohne Wellen
    c.fillStyle = col; c.fillRect(X + 128, 448, 128, 64); for (let k = 0; k < 300; k++) { c.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)'; c.fillRect(X + 128 + rnd() * 128, 448 + rnd() * 64, 2, 2); }
    // Abnutzung: Rost an Kanten und Laufspuren
    for (let k = 0; k < 14; k++) blotch(c, X + rnd() * 256, rnd() * 448, 3 + rnd() * 9, 'rgba(110,50,20,0.55)');
    for (let k = 0; k < 16; k++) { const x = X + rnd() * 256, y = rnd() * 60, l = 60 + rnd() * 150, g = c.createLinearGradient(0, y, 0, y + l); g.addColorStop(0, 'rgba(90,45,20,0.3)'); g.addColorStop(1, 'rgba(90,45,20,0)'); c.fillStyle = g; c.fillRect(x, y, 2 + rnd() * 3, l); }
  }
}
// Textur bei Bedarf erzeugen; Schlüssel mit Endung D = Relief/Rauheit (R/G) aus der Helligkeit
export function tx(k) {
  if (tex[k]) return tex[k];
  if (k.endsWith('D') && TEXGEN[k.slice(0, -1)]) { const src = tx(k.slice(0, -1)); return (tex[k] = dataTex(src, ...(DPARAM[k] || [0.7, 1]))); }
  return (tex[k] = TEXGEN[k]());
}
const DPARAM = { corrugatedD: [0.35, 0.75], drumD: [0.4, 0.75], fuelDrumD: [0.4, 0.75], containerD: [0.45, 0.8], graveD: [0.25, 0.45], tankPaintD: [0.4, 0.7], siloD: [0.3, 0.6], pumpD: [0.35, 0.6] };

// Relief-/Rauheitskarte aus der Helligkeit einer Farbtextur; Glasflächen glatt und eben
function dataTex(src, r0, r1, flat = []) {
  const s = src.image, w = s.width, h = s.height;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'); ctx.drawImage(s, 0, 0);
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  let mn = 255, mx = 0;
  for (let i = 0; i < d.length; i += 4) { const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; if (l < mn) mn = l; if (l > mx) mx = l; }
  const k = 1 / Math.max(1, mx - mn);
  for (let i = 0; i < d.length; i += 4) {
    const n = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11 - mn) * k;
    d[i] = n * 255; d[i + 1] = (r0 + (r1 - r0) * (1 - n * 0.6)) * 255; d[i + 2] = 0; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = 'rgb(128,30,0)';
  for (const [x, y, rw, rh] of flat) ctx.fillRect(x, y, rw, rh);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace; t.wrapS = src.wrapS; t.wrapT = src.wrapT; t.anisotropy = 4;
  return t;
}

// Eine Fassadenkachel (256×256) zeichnen; Glasflächen in glass (Atlas-Pixelkoordinaten) eintragen
function drawFacade(c, i, glass, ox, oy) {
  const S = 256;
  const bricks = (base = '#9c958c') => {
    c.fillStyle = base; c.fillRect(0, 0, S, S);
    for (let y = 0, r = 0; y < S; y += 16, r++) for (let x = -32; x < S; x += 48) {
      const v = 150 + Math.random() * 55, off = r % 2 ? 24 : 0;
      c.fillStyle = `rgb(${v},${v * 0.55},${v * 0.42})`; c.fillRect(x + off + 1.5, y + 1.5, 45, 13);
    }
    speckle(c, S, S, 2500, ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.06)'], 2);
  };
  const plaster = () => {
    c.fillStyle = '#ebe6dc'; c.fillRect(0, 0, S, S);
    for (let k = 0; k < 40; k++) { c.fillStyle = `rgba(${Math.random() < 0.5 ? '120,110,95' : '255,255,255'},0.05)`; c.beginPath(); c.arc(Math.random() * S, Math.random() * S, 8 + Math.random() * 30, 0, 7); c.fill(); }
    speckle(c, S, S, 3000, ['rgba(0,0,0,0.06)', 'rgba(255,255,255,0.1)'], 2);
    c.strokeStyle = 'rgba(70,60,50,0.25)'; c.lineWidth = 1;
    for (let k = 0; k < 3; k++) { c.beginPath(); let x = Math.random() * S, y = Math.random() * S; c.moveTo(x, y); for (let j = 0; j < 6; j++) { x += (Math.random() - 0.5) * 30; y += Math.random() * 20; c.lineTo(x, y); } c.stroke(); }
    const g = c.createLinearGradient(0, S * 0.75, 0, S); g.addColorStop(0, 'rgba(60,50,40,0)'); g.addColorStop(1, 'rgba(60,50,40,0.25)'); c.fillStyle = g; c.fillRect(0, 0, S, S);
  };
  const concrete = () => {
    c.fillStyle = '#c2c1bd'; c.fillRect(0, 0, S, S);
    speckle(c, S, S, 5000, ['rgba(0,0,0,0.07)', 'rgba(255,255,255,0.08)'], 2);
    for (let k = 0; k < 14; k++) { const x = Math.random() * S; const g = c.createLinearGradient(0, 0, 0, S); g.addColorStop(0, 'rgba(50,50,50,0.12)'); g.addColorStop(1, 'rgba(50,50,50,0)'); c.fillStyle = g; c.fillRect(x, 0, 2 + Math.random() * 5, S * (0.3 + Math.random() * 0.6)); }
    c.fillStyle = 'rgba(40,40,40,0.5)'; c.fillRect(0, 126, S, 3); c.fillRect(126, 0, 3, S);
    c.fillStyle = 'rgba(30,30,30,0.35)'; for (const [x, y] of [[20, 20], [236, 20], [20, 236], [236, 236], [20, 108], [236, 148]]) { c.beginPath(); c.arc(x, y, 3, 0, 7); c.fill(); }
  };
  const win = (x, y, w, h, frame = '#f2f0ea', shutters = false) => {
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(x - 6, y - 6, w + 12, h + 14);
    c.fillStyle = frame; c.fillRect(x - 5, y - 5, w + 10, h + 10);
    const g = c.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, '#5f7f98'); g.addColorStop(0.45, '#22313f'); g.addColorStop(0.55, '#38506a'); g.addColorStop(1, '#16202b');
    c.fillStyle = g; c.fillRect(x, y, w, h);
    glass.push([ox + x, oy + y, w, h]);
    c.fillStyle = frame; c.fillRect(x + w / 2 - 3, y, 6, h); c.fillRect(x, y + h * 0.35 - 3, w, 5);
    c.fillStyle = '#d8d2c6'; c.fillRect(x - 10, y + h + 4, w + 20, 8); c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(x - 10, y + h + 12, w + 20, 3);
    if (shutters) { c.fillStyle = '#6d7a72'; for (const sx of [x - 5 - w / 2, x + w + 5]) { c.fillRect(sx, y - 5, w / 2, h + 10); c.fillStyle = 'rgba(0,0,0,0.25)'; for (let yy = y; yy < y + h; yy += 8) c.fillRect(sx + 3, yy, w / 2 - 6, 2); c.fillStyle = '#6d7a72'; } }
  };
  const band = (col = '#d6d0c4') => { c.fillStyle = col; c.fillRect(0, S - 14, S, 14); c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(0, S - 15, S, 2); };
  if (i === 0) bricks();
  else if (i === 1) { // Holzverschalung (Stülpschalung), hell zum Tönen
    c.fillStyle = '#d9d4ca'; c.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 18) {
      const g = c.createLinearGradient(0, y, 0, y + 18); g.addColorStop(0, '#f1ede6'); g.addColorStop(1, '#bdb7ad'); c.fillStyle = g; c.fillRect(0, y, S, 17);
      c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(0, y + 17, S, 1.5);
      for (let k = 0; k < 6; k++) { c.fillStyle = 'rgba(90,70,50,0.12)'; c.fillRect(Math.random() * S, y + 2 + Math.random() * 12, 20 + Math.random() * 60, 1); }
    }
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(Math.random() * 200 + 20, 0, 2, S);
  } else if (i === 2) plaster();
  else if (i === 3) concrete();
  else if (i === 4) { bricks(); win(78, 40, 100, 150); band(); }
  else if (i === 5) { // Beton-Glas-Fensterband
    concrete();
    const y = 46, h = 150; c.fillStyle = '#2a2f35'; c.fillRect(0, y - 6, S, h + 12);
    const g = c.createLinearGradient(0, y, S, y + h); g.addColorStop(0, '#6c8aa3'); g.addColorStop(0.5, '#253645'); g.addColorStop(1, '#4b6680');
    c.fillStyle = g; c.fillRect(0, y, S, h); glass.push([ox, oy + y, S, h]);
    c.fillStyle = '#3a4048'; for (let x = 0; x <= S; x += 64) c.fillRect(x - 3, y, 6, h); c.fillRect(0, y + h * 0.7, S, 4);
    c.fillStyle = 'rgba(255,255,255,0.12)'; c.beginPath(); c.moveTo(20, y); c.lineTo(80, y); c.lineTo(30, y + h); c.lineTo(-30, y + h); c.fill();
    band('#a9a9a6');
  } else if (i === 6) { plaster(); win(88, 46, 80, 140, '#f6f4ee', true); band('#e6e0d4'); }
  else if (i === 7) { // Trapezblech
    c.fillStyle = '#cfd2d4'; c.fillRect(0, 0, S, S);
    for (let x = 0; x < S; x += 16) { const g = c.createLinearGradient(x, 0, x + 16, 0); g.addColorStop(0, '#9da2a6'); g.addColorStop(0.3, '#eef0f1'); g.addColorStop(0.6, '#c3c7ca'); g.addColorStop(1, '#8c9196'); c.fillStyle = g; c.fillRect(x, 0, 16, S); }
    for (let k = 0; k < 10; k++) { c.fillStyle = 'rgba(120,70,40,0.12)'; c.fillRect(Math.random() * S, Math.random() * S, 3 + Math.random() * 10, 20 + Math.random() * 60); }
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(0, 127, S, 2);
  }
}

// ---------- Nebel-des-Krieges-Shaderpatch für statische Geometrie ----------
export const fogUniforms = {
  fogMap: { value: null },
  fogMapSize: { value: new THREE.Vector2(1, 1) },
  fogOutside: { value: 0.32 },
};
// Nebel des Krieges in ein Material einbauen. Idempotent; ein vorhandenes onBeforeCompile (z. B. Haut-Shader der
// Figuren, PBR-Boden) und dessen Programm-Schlüssel bleiben erhalten und laufen vorher.
export function patchFog(mat) {
  if (!mat || mat.userData.fogPatched) return mat;
  mat.userData.fogPatched = true;
  const prev = Object.prototype.hasOwnProperty.call(mat, 'onBeforeCompile') ? mat.onBeforeCompile : null;
  const prevKey = Object.prototype.hasOwnProperty.call(mat, 'customProgramCacheKey') ? mat.customProgramCacheKey : null;
  mat.onBeforeCompile = function (sh, r) {
    if (prev) prev.call(this, sh, r);
    Object.assign(sh.uniforms, fogUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFogW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 fwp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fwp = instanceMatrix * fwp;
        #endif
        fwp = modelMatrix * fwp; vFogW = fwp.xz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFogW; uniform sampler2D fogMap; uniform vec2 fogMapSize; uniform float fogOutside;')
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        { vec2 fuv = vFogW / fogMapSize + 0.5;
          float fv = (fuv.x < 0.0 || fuv.y < 0.0 || fuv.x > 1.0 || fuv.y > 1.0) ? fogOutside : texture2D(fogMap, fuv).r;
          gl_FragColor.rgb *= fv; }`);
  };
  mat.customProgramCacheKey = prevKey ? function () { return 'fog' + mat.type + '|' + prevKey.call(this); } : () => 'fog' + mat.type;
  return mat;
}

const std = (o) => patchFog(new THREE.MeshStandardMaterial(o));
// Material mit Relief-/Rauheitskarte (Datentextur: R = Höhe, G = Rauheit)
const rough = (o, d, bumpScale = 1) => std({ ...o, bumpMap: d, bumpScale, roughnessMap: d });
// Unbeleuchtetes Material mit Vertexfarben (> 1 = Glühen) für Scheinwerfer, Ampeln, Lampen
const glowVC = () => patchFog(new THREE.MeshBasicMaterial({ vertexColors: true }));

// ---------- Geometrie-Helfer ----------
const bx = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
const cyl = (rt, rb, h, seg, x = 0, y = 0, z = 0) => new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y + h / 2, z);
const ball = (r, x = 0, y = 0, z = 0, ws = 10, hs = 8) => new THREE.SphereGeometry(r, ws, hs).translate(x, y, z);
// Stab zwischen zwei Punkten in der y-z-Ebene (Fahrzeugsäulen u. ä.)
function strut(z0, y0, z1, y1, x, th = 0.07) {
  const len = Math.hypot(z1 - z0, y1 - y0);
  return new THREE.BoxGeometry(th, th, len).rotateX(-Math.atan2(y1 - y0, z1 - z0)).translate(x, (y0 + y1) / 2, (z0 + z1) / 2);
}
// Planare UVs: eine Atlas-Kachel entspricht einer Wandseite (TILE breit, H hoch ab y0)
function planarUV(g, H = 2.8, y0 = 0) {
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  const cl = (v) => Math.min(0.996, Math.max(0.004, v));
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (Math.abs(n.getY(i)) > 0.5) uv.setXY(i, cl(x / TILE + 0.5), cl(z / TILE + 0.5));
    else if (Math.abs(n.getX(i)) > 0.5) uv.setXY(i, cl(z / TILE + 0.5), cl((y - y0) / H));
    else uv.setXY(i, cl(x / TILE + 0.5), cl((y - y0) / H));
  }
  return g;
}
const scaleUV = (g, su, sv) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); return g; };
// Geometrien zu einer zusammenführen, optional mit Vertexfarbe je Teil (Hex = sRGB, Array = linear, z. B. Glühwerte > 1)
export function mergeGeos(list) {
  const items = list.map((e) => (Array.isArray(e) ? e : [e])).map(([g, col]) => [g.index ? g.toNonIndexed() : g, col]);
  let n = 0; for (const [g] of items) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
  const c = new THREE.Color();
  let o = 0;
  for (const [g, cc] of items) {
    const k = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    if (cc == null) c.setRGB(1, 1, 1); else if (Array.isArray(cc)) c.setRGB(cc[0], cc[1], cc[2]); else c.set(cc);
    for (let i = 0; i < k; i++) { col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b; }
    o += k;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
// ---- Helfer für die Karten-Hindernisse ----
// UV einer Geometrie (0..1) in einen Atlas-Bereich [u0, v0, u1, v1] abbilden
const uvRect = (g, r) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1])); return g; };
const uvConst = (g, r) => { const uv = g.attributes.uv, u = (r[0] + r[2]) / 2, v = (r[1] + r[3]) / 2; for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v); return g; };
// Quader (Unterkante y) mit Atlas-Bereich je Seite: Reihenfolge +x, -x, +y, -y, +z, -z; fehlende Seiten → def
function boxUV(w, h, d, x, y, z, rects, def) {
  const g = new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), uv = g.attributes.uv;
  for (let f = 0; f < 6; f++) { const r = rects[f] || def; if (!r) continue; for (let i = f * 4; i < f * 4 + 4; i++) uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1])); }
  return g;
}
const _v0 = new THREE.Vector3(), _q0 = new THREE.Quaternion();
// Vierkantbalken zwischen zwei Punkten
function beam(a, b, tw, th = tw) {
  _v0.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const len = _v0.length();
  return new THREE.BoxGeometry(tw, th, len).applyQuaternion(_q0.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _v0.normalize())).translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}
// Rundstab (konisch) zwischen zwei Punkten, r0 bei a, r1 bei b
function rod(a, b, r0, r1 = r0, seg = 6, open = false) {
  _v0.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const len = _v0.length();
  return new THREE.CylinderGeometry(r1, r0, len, seg, 1, open).applyQuaternion(_q0.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _v0.normalize())).translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}
// Glatter Raumrausch-Ersatz (gleiche Position → gleicher Wert, daher rissfrei)
const nz3 = (x, y, z, s) => Math.sin(x * 3.1 + s) * Math.sin(y * 2.7 + s * 1.7) * Math.sin(z * 3.3 + s * 0.6) + 0.5 * Math.sin(x * 7.3 + y * 5.1 + s * 2.3) * Math.sin(z * 6.7 - y * 4.1 + s);
// Unregelmäßiger Laub-/Strauchballen mit weichen radialen Normalen
function blob(r, x, y, z, sx = 1, sy = 1, sz = 1, amp = 0.2, detail = r >= 0.8 ? 2 : 1, seed = rnd() * 50) {
  const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position, n = g.attributes.normal, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const k = r * (1 + amp * nz3(v.x, v.y, v.z, seed));
    p.setXYZ(i, x + v.x * k * sx, y + v.y * k * sy, z + v.z * k * sz);
    const nx = v.x / sx, ny = v.y / sy, nzv = v.z / sz, l = Math.hypot(nx, ny, nzv); n.setXYZ(i, nx / l, ny / l, nzv / l);
  }
  return g;
}
// Kantiger Stein (flach schattiert)
function stoneGeo(r, x, y, z, sx = 1, sy = 1, sz = 1, seed = rnd() * 50) {
  const g = new THREE.DodecahedronGeometry(1, 0), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const k = r * (1 + 0.22 * nz3(v.x * 1.7, v.y * 1.7, v.z * 1.7, seed)); p.setXYZ(i, x + v.x * k * sx, y + v.y * k * sy, z + v.z * k * sz); }
  g.computeVertexNormals();
  return g;
}
// Positionsabhängige Verformung (rissfrei) für unterteilte Quader
function warp(g, amp, f = 1, seed = 3) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); p.setXYZ(i, x + amp * nz3(x * f, y * f, z * f, seed), y + amp * 0.6 * nz3(z * f, x * f, y * f, seed + 1), z + amp * nz3(y * f, z * f, x * f, seed + 2)); }
  g.computeVertexNormals();
  return g;
}
// Vertexfarben nach Höhe abdunkeln (Innenschatten von Hecken/Kronen)
function shadeY(g, y0, y1, k0 = 0.55) { const p = g.attributes.position, c = g.attributes.color; for (let i = 0; i < p.count; i++) { const t = Math.min(1, Math.max(0, (p.getY(i) - y0) / (y1 - y0))), k = k0 + (1 - k0) * t; c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k); } return g; }
// Seitenprofil (Punkte [z, y], vorne = +z) über die Breite extrudieren
function sideProfile(pts, width, bevel = 0.05) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  const d = Math.max(0.01, width - bevel * 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -d / 2); g.rotateY(-Math.PI / 2);
  return g;
}
// Unterkante einer Karosserie mit Radläufen (von vorne nach hinten)
function archLine(zF, zR, yb, wheels, ra) {
  const pts = [[zF, yb]];
  for (const wz of wheels) { for (let k = 0; k <= 8; k++) { const a = (k / 8) * Math.PI; pts.push([wz + Math.cos(a) * ra, yb + Math.sin(a) * ra]); } }
  pts.push([zR, yb]);
  return pts;
}
// Atlas-Fassaden: Kachel je Instanz über das Attribut aTile (UV-Versatz), Atlas mit 4×2 Kacheln
function atlasify(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aTile;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        #ifdef USE_MAP
          vMapUv = vMapUv * vec2(0.25, 0.5) + aTile;
        #endif
        #ifdef USE_BUMPMAP
          vBumpMapUv = vBumpMapUv * vec2(0.25, 0.5) + aTile;
        #endif
        #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv = vRoughnessMapUv * vec2(0.25, 0.5) + aTile;
        #endif`);
  };
  mat.customProgramCacheKey = () => 'fogAtlas' + mat.type;
  return mat;
}
export const atlasTile = (i) => [(i % 4) * 0.25, 0.5 - (i >> 2) * 0.5];

// Fassadenstile: Atlas-Kachel Erdgeschoss/Obergeschoss, Tönungen, Zierteile, Dach
export const FACADES = {
  brick: { tile: 0, up: 4, tint: ['#ffffff', '#f0e2d8', '#e8d6cc', '#fff4ec'], trim: '#ece6da', roof: ['#9a4a32', '#7d3d2c', '#5a5452'] },
  wood: { tile: 1, up: 1, tint: ['#a8382a', '#9c3326', '#ece8de', '#8a9cab', '#d6c08a'], trim: '#f4f1ea', roof: ['#4a4a4e', '#5d3a2a', '#6e6a64'] },
  log: { tile: 1, up: 1, tint: ['#7a5634', '#6b4a2e', '#8a6440'], trim: '#3d2a1a', roof: ['#3e4a3a', '#4a3a2e', '#55524c'] },
  plaster: { tile: 2, up: 6, tint: ['#f3ecdf', '#ecd8b4', '#dbe4d4', '#efcfbf', '#d6dfe8'], trim: '#ffffff', roof: ['#8a4632', '#6e6a64'] },
  concrete: { tile: 3, up: 5, tint: ['#e2e2de', '#d2d5d9', '#e6e0d4'], trim: '#c2c6ca', roof: ['#6a6a6a'] },
  adobe: { tile: 2, up: 6, tint: ['#dca878', '#cd9a68', '#e4bc8e'], trim: '#6a4a2e', roof: ['#b08a60'] },
  prefab: { tile: 7, up: 7, tint: ['#c0452f', '#e0dccf', '#4a7a98', '#d1922e'], trim: '#9aa0a6', roof: ['#eef3f6', '#e4ebf0'] },
  // Stile der Kartenmodule (Wände meist aus stone/plaster/concrete/metalsheet/glass → Tönung dieser Module)
  farmhouse: { tile: 2, up: 6, tint: ['#f6f0e4', '#efe2c8', '#e8e4dc', '#f2e6d8'], trim: '#ffffff', roof: ['#8a4632', '#6e3a2a', '#5a5452'] },
  barn: { tile: 1, up: 1, tint: ['#a8382a', '#8a2e22', '#d8d4cc', '#7a5634'], trim: '#f4f1ea', roof: ['#4a4a4e', '#6e6a64', '#5d3a2a'] },
  warehouse: { tile: 7, up: 7, tint: ['#e8ecef', '#c8d4dc', '#e0dcd0', '#d0dcd0'], trim: '#9aa0a6', roof: ['#8a8e92', '#6a6e72'] },
  church: { tile: 2, up: 6, tint: ['#f4eee4', '#e8e0d2', '#ffffff'], trim: '#f0ece4', roof: ['#4a4e56', '#5a5452'] },
  gasstation: { tile: 3, up: 5, tint: ['#f4f4f2', '#e8ecf0'], trim: '#e4e6e8', roof: ['#d8dadc', '#c8ccd0'] },
  bunker: { tile: 3, up: 3, tint: ['#d8d8d4', '#c4c4be', '#cfd2c8'], trim: '#a8a8a2', roof: ['#6a6a6a', '#5f625a'] },
  cabin: { tile: 1, up: 1, tint: ['#7a5634', '#6b4a2e', '#8a6440'], trim: '#3d2a1a', roof: ['#3e4a3a', '#4a3a2e', '#55524c'] },
  ruin: { tile: 2, up: 6, tint: ['#e0d8c8', '#d0c8b8'], trim: '#c8c0b0', roof: ['#5a5452'] },
  greenhouse: { tile: 7, up: 7, tint: ['#ffffff'], trim: '#e8eae6', roof: ['#e4ecee', '#d8e4e8'] },
  motel: { tile: 2, up: 6, tint: ['#f2d4c4', '#efe0b8', '#d8e4ec', '#e4efd8'], trim: '#ffffff', roof: ['#6e6a64', '#8a8e92'] },
};

// ---------- Hindernis-Definitionen: Teile für InstancedMesh ----------
export function propParts() {
  const t = textures();
  const box = (w, h, d, y = 0) => new THREE.BoxGeometry(w, h, d).translate(0, y + h / 2, 0);
  const T = TILE;
  const M = {
    brick: rough({ map: t.brick, roughness: 0.92 }, t.brickD, 1.2),
    wood: rough({ map: t.wood, roughness: 0.85 }, t.woodD, 0.8),
    metal: rough({ map: t.metal, color: 0x8892a0, metalness: 0.85, roughness: 0.4 }, t.metalD, 1),
    metalGlow: std({ color: 0x0b1a1a, emissive: 0x30ffc8, emissiveIntensity: 2.6 }),
    hive: rough({ map: t.hive, emissiveMap: t.hiveEmit, emissive: 0xc060ff, emissiveIntensity: 1.3, roughness: 0.6, metalness: 0.1 }, t.hiveD, 1.5),
    bark: rough({ map: t.bark, roughness: 1 }, t.barkD, 1.5),
    leaf: rough({ map: t.leaf, roughness: 0.9, flatShading: true }, t.leafD, 1),
    pineLeaf: std({ map: t.leaf, color: 0x7fa08a, roughness: 0.9, flatShading: true }),
    rock: rough({ map: t.rock, roughness: 0.95, flatShading: true }, t.rockD, 1.5),
    fenceWood: rough({ map: t.wood, color: 0xb89a7a, roughness: 0.9 }, t.woodD, 0.8),
    hedge: rough({ map: t.leaf, color: 0x9ac08a, roughness: 1 }, t.leafD, 1.5),
    crate: rough({ map: t.wood, color: 0xc8a070, roughness: 0.8 }, t.woodD, 1),
    hay: rough({ map: t.hay, roughness: 1 }, t.hayD, 1.5),
    carBody: std({ color: 0xffffff, metalness: 0.6, roughness: 0.28 }),
    glass: std({ color: 0x223344, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.55 }),
    tire: std({ color: 0x111111, roughness: 0.9 }),
    concrete: rough({ map: t.concrete, roughness: 0.9 }, t.concreteD, 1),
    wreck: rough({ map: t.metal, color: 0x3d3f44, metalness: 0.8, roughness: 0.55 }, t.metalD, 1.5),
    console: std({ color: 0x2a3340, metalness: 0.7, roughness: 0.35 }),
    screen: std({ color: 0x000000, emissive: 0x40ffd0, emissiveIntensity: 2.2 }),
    reactor: std({ color: 0x103020, emissive: 0x5affb0, emissiveIntensity: 4 }),
    pod: std({ color: 0x40204a, emissive: 0xb050ff, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.2 }),
  };
  const P = {
    brick: [{ geo: box(T, 2.8, T), mat: M.brick }],
    wood: [{ geo: box(T, 2.6, T), mat: M.wood }],
    window: [{ geo: box(T, 1.0, T), mat: M.brick }, { geo: box(T, 0.3, T, 2.5), mat: M.brick }, { geo: box(T * 0.96, 1.5, 0.08, 1.0), mat: M.glass }],
    metal: [{ geo: box(T, 2.8, T), mat: M.metal }, { geo: box(T * 1.01, 0.12, T * 1.01, 2.2), mat: M.metalGlow }],
    hivewall: [{ geo: new THREE.CylinderGeometry(T * 0.62, T * 0.78, 3.4, 7, 3).translate(0, 1.7, 0), mat: M.hive }],
    tree: [{ geo: new THREE.CylinderGeometry(0.18, 0.28, 2.2, 7).translate(0, 1.1, 0), mat: M.bark }, { geo: new THREE.IcosahedronGeometry(1.3, 1).translate(0, 2.9, 0), mat: M.leaf }, { geo: new THREE.IcosahedronGeometry(0.95, 1).translate(0.35, 3.9, 0.2), mat: M.leaf }],
    pine: [{ geo: new THREE.CylinderGeometry(0.15, 0.25, 1.4, 6).translate(0, 0.7, 0), mat: M.bark }, { geo: new THREE.ConeGeometry(1.25, 2.4, 8).translate(0, 2.4, 0), mat: M.pineLeaf }, { geo: new THREE.ConeGeometry(0.95, 2.0, 8).translate(0, 3.6, 0), mat: M.pineLeaf }, { geo: new THREE.ConeGeometry(0.6, 1.5, 8).translate(0, 4.7, 0), mat: M.pineLeaf }],
    bigrock: [{ geo: new THREE.DodecahedronGeometry(1.2, 1).scale(1, 1.15, 1).translate(0, 1.05, 0), mat: M.rock }],
    rock: [{ geo: new THREE.DodecahedronGeometry(0.8, 1).scale(1.1, 0.75, 1).translate(0, 0.45, 0), mat: M.rock }],
    fence: [{ geo: box(0.12, 1.1, 0.12, 0).translate(-0.9, 0, 0), mat: M.fenceWood }, { geo: box(0.12, 1.1, 0.12, 0).translate(0.9, 0, 0), mat: M.fenceWood }, { geo: box(T, 0.12, 0.08, 0.45), mat: M.fenceWood }, { geo: box(T, 0.12, 0.08, 0.85), mat: M.fenceWood }],
    hedge: [{ geo: new THREE.BoxGeometry(T, 1.3, 0.9, 3, 2, 2).translate(0, 0.65, 0), mat: M.hedge }],
    crate: [{ geo: box(1.2, 1.15, 1.2), mat: M.crate }],
    hay: [{ geo: new THREE.CylinderGeometry(0.65, 0.65, 1.3, 14).rotateZ(Math.PI / 2).translate(0, 0.65, 0), mat: M.hay }],
    car: [{ geo: box(1.7, 0.6, 3.4, 0.3), mat: M.carBody }, { geo: box(1.5, 0.5, 1.8, 0.9).translate(0, 0, -0.2), mat: M.glass }, ...[[-0.8, 1.1], [0.8, 1.1], [-0.8, -1.1], [0.8, -1.1]].map(([x, z]) => ({ geo: new THREE.CylinderGeometry(0.33, 0.33, 0.25, 12).rotateZ(Math.PI / 2).translate(x, 0.33, z), mat: M.tire }))],
    barrier: [{ geo: new THREE.CylinderGeometry(0.25, 0.5, 1.0, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 3.2).translate(0, 0.5, 0), mat: M.concrete }],
    wreck: [{ geo: new THREE.TetrahedronGeometry(0.9).translate(0, 0.5, 0), mat: M.wreck }, { geo: new THREE.BoxGeometry(1.4, 0.15, 0.7).rotateZ(0.4).translate(0.3, 0.4, 0.4), mat: M.wreck }],
    console: [{ geo: box(1.2, 1.0, 0.8), mat: M.console }, { geo: new THREE.BoxGeometry(1.0, 0.5, 0.05).rotateX(-0.5).translate(0, 1.15, 0.1), mat: M.screen }],
    reactor: [{ geo: new THREE.CylinderGeometry(0.9, 1.0, 0.4, 16).translate(0, 0.2, 0), mat: M.console }, { geo: new THREE.CylinderGeometry(0.35, 0.35, 1.4, 16).translate(0, 1.0, 0), mat: M.reactor }, { geo: new THREE.TorusGeometry(0.6, 0.06, 8, 24).rotateX(Math.PI / 2).translate(0, 1.2, 0), mat: M.metalGlow }],
    pod: [{ geo: new THREE.SphereGeometry(0.6, 16, 12).scale(1, 1.4, 1).translate(0, 0.8, 0), mat: M.pod }],
  };
  // ---- zusätzliche Materialien (Gebäude, Fahrzeuge, Möbel, Deko) ----
  Object.assign(M, {
    facade: atlasify(rough({ map: t.facade, roughness: 0.9 }, t.facadeD, 1.2)),
    trim: rough({ map: t.plain, vertexColors: true, roughness: 0.75 }, t.plainD, 0.6),
    winGlass: std({ color: 0x7d9db4, metalness: 0.15, roughness: 0.04, transparent: true, opacity: 0.42, envMapIntensity: 1.6 }),
    furnWood: rough({ map: t.woodLight, vertexColors: true, roughness: 0.7 }, t.woodD, 0.5),
    furnSoft: rough({ map: t.fabric, vertexColors: true, roughness: 0.95 }, t.plainD, 0.4),
    paint: std({ color: 0xffffff, metalness: 0.3, roughness: 0.3, envMapIntensity: 1.2 }),
    carDark: std({ vertexColors: true, metalness: 0.35, roughness: 0.6 }),
    carGlass: std({ color: 0x1a2530, metalness: 0.4, roughness: 0.05, envMapIntensity: 1.8 }),
    glow: glowVC(),
    burnt: rough({ map: t.metal, vertexColors: true, metalness: 0.45, roughness: 0.9 }, t.metalD, 1.5),
    decoVC: rough({ map: t.plain, vertexColors: true, roughness: 0.6, metalness: 0.15 }, t.plainD, 0.4),
    leafVC: rough({ map: t.leaf, vertexColors: true, roughness: 0.9 }, t.leafD, 0.8),
    cactus: std({ map: t.plain, vertexColors: true, roughness: 0.75, flatShading: true }),
    snow: rough({ map: t.plain, color: 0xf6f9fc, roughness: 0.85 }, t.plainD, 0.6),
    ice: std({ color: 0xbfe2f2, roughness: 0.12, metalness: 0.05, flatShading: true, envMapIntensity: 1.6 }),
    roofTile: rough({ map: t.roofTiles, vertexColors: true, roughness: 0.8 }, t.roofTilesD, 1.2),
    roofFlat: rough({ map: t.roofFlat, vertexColors: true, roughness: 0.95 }, t.roofFlatD, 0.8),
    plainVC: rough({ map: t.plain, vertexColors: true, roughness: 0.85 }, t.plainD, 0.5),
  });
  const H = 2.8, F = (g, y0 = 0) => planarUV(g, H, y0);
  const up1 = () => ({ geo: F(bx(T, H, T, 0, H), H), mat: M.facade, atlas: true, bit: 1 });
  const up2 = () => ({ geo: F(bx(T, H, T, 0, 2 * H), 2 * H), mat: M.facade, atlas: true, bit: 2 });
  const cornice = (w = T) => [[bx(w + 0.1, 0.1, w + 0.1, 0, H - 0.22), '#ffffff'], [bx(w + 0.16, 0.16, w + 0.16, 0, H - 0.12), '#ffffff']];
  const PL = '#6f6a64', FR = '#f4f2ec';
  const both = (f) => [f(1), f(-1)];
  const wheel = (x, z, r, w, rim = '#b8bcc0') => [[new THREE.CylinderGeometry(r, r, w, 16).rotateZ(Math.PI / 2).translate(x, r, z), '#141414'], [new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.02, 12).rotateZ(Math.PI / 2).translate(x, r, z), rim], [new THREE.CylinderGeometry(r * 0.2, r * 0.2, w + 0.04, 8).rotateZ(Math.PI / 2).translate(x, r, z), '#3a3a3a']];
  // Pkw-Baukasten: Profil der Karosserie, Fahrgastzelle (Glas), Dach + Säulen (Lack), Anbauteile (dunkel), Leuchten
  function car(o) {
    const W = o.w, hw = W / 2, r = o.r, yb = o.yb;
    const body = [...archLine(o.zF, o.zR, yb, o.wheels, r + 0.06), ...o.top];
    const paint = [sideProfile(body, W, 0.06)];
    if (o.roof) paint.push(sideProfile(o.roof, W - 0.1, 0.03));
    for (const p of o.pillars || []) for (const s of [-1, 1]) paint.push(strut(p[0], p[1], p[2], p[3], s * (hw - 0.1)));
    if (o.extraPaint) paint.push(...o.extraPaint);
    const dark = [];
    for (const wz of o.wheels) for (const s of [-1, 1]) dark.push(...wheel(s * (hw - 0.14), wz, r, 0.26, o.rim));
    const zf = o.zF + 0.04, zr = o.zR - 0.04;
    dark.push([bx(W - 0.3, 0.2, Math.abs(o.zF - o.zR) - 0.6, 0, 0.16, (o.zF + o.zR) / 2), '#161616']);
    dark.push([bx(W + 0.04, 0.17, 0.16, 0, yb - 0.02, zf), '#262626'], [bx(W + 0.04, 0.17, 0.16, 0, yb - 0.02, zr), '#262626']);
    dark.push([bx(W * 0.5, 0.14, 0.05, 0, yb + 0.22, zf + 0.04), '#0e0e0e'], [bx(0.48, 0.11, 0.03, 0, yb + 0.02, zf + 0.09), '#e8e8e2'], [bx(0.48, 0.11, 0.03, 0, yb + 0.04, zr - 0.09), '#e8e8e2']);
    if (o.mirrorZ != null) for (const s of [-1, 1]) dark.push([bx(0.14, 0.09, 0.07, s * (hw + 0.06), o.mirrorY, o.mirrorZ), '#222222']);
    for (const dz of o.doors || []) for (const s of [-1, 1]) dark.push([bx(0.012, o.doorH, 0.016, s * (hw + 0.012), yb + 0.08, dz), '#202020']);
    if (o.extraDark) dark.push(...o.extraDark);
    const lights = [];
    for (const s of [-1, 1]) {
      lights.push([bx(0.34, 0.11, 0.05, s * (hw - 0.3), o.headY, zf + 0.02), [2.4, 2.3, 1.9]]);
      lights.push([bx(0.3, 0.12, 0.05, s * (hw - 0.24), o.tailY, zr - 0.02), [2.0, 0.12, 0.08]]);
    }
    const out = [{ geo: mergeGeos(paint), mat: o.burnt ? M.burnt : M.paint, paint: !o.burnt }, { geo: mergeGeos(dark), mat: M.carDark, shadow: false }];
    if (o.glass && !o.burnt) out.push({ geo: mergeGeos(o.glass.map((g) => (g.isBufferGeometry ? g : sideProfile(g, W - 0.16, 0.03)))), mat: M.carGlass });
    if (!o.burnt) out.push({ geo: mergeGeos(lights), mat: M.glow, shadow: false });
    if (o.burnt) out[0].geo = mergeGeos([[out[0].geo, '#4a3c34']]);
    return out;
  }
  const sedan = (burnt = false) => car({
    w: 1.76, r: 0.33, yb: 0.3, zF: 1.92, zR: -1.92, wheels: [1.22, -1.2],
    top: [[-1.95, 0.55], [-1.92, 0.86], [-1.22, 0.92], [1.0, 0.9], [1.82, 0.78], [1.96, 0.6]],
    glass: burnt ? null : [[[-1.2, 0.9], [-0.72, 1.36], [0.42, 1.38], [1.02, 0.9]]],
    roof: [[-0.8, 1.32], [-0.72, 1.42], [0.42, 1.44], [0.52, 1.34]],
    pillars: [[1.0, 0.9, 0.44, 1.38], [-1.18, 0.9, -0.73, 1.36], [-0.14, 0.9, -0.14, 1.38]],
    mirrorZ: 0.8, mirrorY: 0.98, doors: [0.78, -0.14, -1.05], doorH: 0.52, headY: 0.62, tailY: 0.7, burnt,
    extraPaint: burnt ? [sideProfile([[-1.2, 0.9], [-0.72, 1.36], [0.42, 1.38], [1.02, 0.9]], 1.5, 0.02)] : null,
  });
  const defs = {
    // --- Gebäude: Außenwand (mit optionalen Obergeschossen), Fenster, Innenwand, Türrahmen ---
    wallOut: () => [
      { geo: F(bx(T, H, T)), mat: M.facade, atlas: true },
      { geo: mergeGeos([[bx(T + 0.06, 0.32, T + 0.06), PL], ...cornice()]), mat: M.trim, shadow: false },
      up1(), up2(),
    ],
    window: () => [
      { geo: mergeGeos([F(bx(T, 0.95, T)), F(bx(T, 0.6, T, 0, 2.2)), F(bx(0.32, 1.25, T, -0.84, 0.95)), F(bx(0.32, 1.25, T, 0.84, 0.95))]), mat: M.facade, atlas: true },
      { geo: mergeGeos([[bx(T + 0.06, 0.32, T + 0.06), PL], ...cornice(), ...both((s) => [bx(1.56, 0.07, 0.22, 0, 0.9, s * (T / 2 + 0.06)), '#e2ddd2']),
        ...[1, -1].flatMap((s) => { const z = s * (T / 2 - 0.05); return [[bx(0.07, 1.25, 0.08, -0.645, 0.95, z), FR], [bx(0.07, 1.25, 0.08, 0.645, 0.95, z), FR], [bx(1.36, 0.07, 0.08, 0, 2.13, z), FR], [bx(1.36, 0.06, 0.08, 0, 0.95, z), FR], [bx(0.05, 1.2, 0.06, 0, 0.97, z), FR], [bx(1.3, 0.05, 0.06, 0, 1.72, z), FR]]; })]), mat: M.trim, shadow: false },
      { geo: mergeGeos(both((s) => bx(1.3, 1.22, 0.02, 0, 0.96, s * (T / 2 - 0.06)))), mat: M.winGlass, shadow: false },
      up1(), up2(),
    ],
    wallIn: () => [
      { geo: F(bx(T, H, T)), mat: M.facade, atlas: true },
      { geo: mergeGeos([[bx(T + 0.04, 0.14, T + 0.04), '#5a4632'], [bx(T + 0.04, 0.1, T + 0.04, 0, H - 0.07), '#f0ece4']]), mat: M.trim, shadow: false },
    ],
    door: () => [
      { geo: mergeGeos([F(bx(T, 0.6, T, 0, 2.2)), F(bx(0.36, 2.2, T, -0.82)), F(bx(0.36, 2.2, T, 0.82))]), mat: M.facade, atlas: true },
      { geo: mergeGeos([[bx(0.4, 0.32, T + 0.06, -0.82), PL], [bx(0.4, 0.32, T + 0.06, 0.82), PL], ...cornice(), [bx(1.28, 0.04, T, 0, 0), '#8a8580'],
        ...[1, -1].flatMap((s) => { const z = s * (T / 2 - 0.05); return [[bx(0.08, 2.2, 0.1, -0.62, 0, z), FR], [bx(0.08, 2.2, 0.1, 0.62, 0, z), FR], [bx(1.32, 0.1, 0.1, 0, 2.12, z), FR]]; }),
        [bx(0.05, 2.06, 0.92, 0.585, 0.03, T / 2 - 0.52), '#7a4a2a'], [bx(0.04, 0.04, 0.12, 0.55, 1.0, T / 2 - 0.9), '#c8c8c8']]), mat: M.trim, shadow: false },
      up1(), up2(),
    ],
    // --- Möbel (Deckung wie Kisten), Rückseite an der Wand (-z) ---
    'furn:table': () => [{ geo: mergeGeos([[bx(1.3, 0.06, 0.85, 0, 0.72, 0.1), '#b88a5c'], ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => [bx(0.07, 0.72, 0.07, a * 0.57, 0, 0.1 + b * 0.35), '#8a6440']),
      ...[-1, 1].flatMap((s) => { const z = 0.1 + s * 0.66; return [[bx(0.44, 0.05, 0.42, 0, 0.44, z), '#7a5634'], [bx(0.44, 0.5, 0.04, 0, 0.49, z + s * 0.2), '#7a5634'], ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => [bx(0.04, 0.44, 0.04, a * 0.18, 0, z + b * 0.17), '#5e4027'])]; }),
      [new THREE.CylinderGeometry(0.07, 0.05, 0.18, 8).translate(0.2, 0.87, 0.1), '#e8e4dc']]), mat: M.furnWood, shadow: false }],
    'furn:bed': () => [
      { geo: mergeGeos([[bx(1.1, 0.26, 1.96, 0, 0.1, 0), '#8a6440'], [bx(1.12, 0.9, 0.08, 0, 0, -0.98), '#7a5634'], ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => [bx(0.07, 0.12, 0.07, a * 0.5, 0, b * 0.9), '#5e4027'])]), mat: M.furnWood, shadow: false },
      { geo: mergeGeos([[bx(1.02, 0.16, 1.86, 0, 0.36, 0.02), '#f0f0ee'], [bx(1.08, 0.08, 1.2, 0, 0.47, 0.36), '#ffffff'], [bx(0.72, 0.12, 0.34, 0, 0.52, -0.7), '#f8f8f8']]), mat: M.furnSoft, tint: true, shadow: false },
    ],
    'furn:shelf': () => {
      const g = [[bx(0.05, 1.9, 0.4, -0.74, 0, -0.75), '#7a5634'], [bx(0.05, 1.9, 0.4, 0.74, 0, -0.75), '#7a5634'], [bx(1.5, 1.9, 0.03, 0, 0, -0.94), '#5e4027']];
      for (const y of [0.04, 0.44, 0.84, 1.24, 1.64, 1.88]) g.push([bx(1.46, 0.04, 0.38, 0, y, -0.75), '#8a6440']);
      const pal = ['#8a2a2a', '#2a4a7a', '#2e6a3a', '#c8a040', '#5a3a6a', '#d8d0c0', '#3a3a3a'];
      for (const y of [0.08, 0.48, 0.88, 1.28]) for (let x = -0.68; x < 0.62;) { const w = 0.04 + Math.random() * 0.05, h = 0.22 + Math.random() * 0.12; if (Math.random() < 0.85) g.push([bx(w, h, 0.28, x + w / 2, y, -0.78), pal[(Math.random() * pal.length) | 0]]); x += w + 0.005; }
      return [{ geo: mergeGeos(g), mat: M.furnWood, shadow: false }];
    },
    'furn:cabinet': () => [{ geo: mergeGeos([[bx(1.3, 1.95, 0.62, 0, 0, -0.66), '#a07a54'], [bx(1.36, 0.06, 0.66, 0, 1.95, -0.66), '#8a6440'], [bx(0.02, 1.8, 0.02, 0, 0.08, -0.34), '#3a2a1a'], [bx(0.03, 0.22, 0.03, -0.07, 0.95, -0.33), '#cfcfcf'], [bx(0.03, 0.22, 0.03, 0.07, 0.95, -0.33), '#cfcfcf'], [bx(1.3, 0.08, 0.6, 0, 0, -0.66), '#5e4027']]), mat: M.furnWood, shadow: false }],
    'furn:sofa': () => [{ geo: mergeGeos([[bx(1.7, 0.34, 0.85, 0, 0.1, -0.45), '#d0d0d0'], [bx(1.7, 0.52, 0.22, 0, 0.4, -0.78), '#d8d8d8'], [bx(0.2, 0.26, 0.85, -0.85, 0.42, -0.45), '#c8c8c8'], [bx(0.2, 0.26, 0.85, 0.85, 0.42, -0.45), '#c8c8c8'], [bx(0.76, 0.12, 0.62, -0.38, 0.44, -0.36), '#ececec'], [bx(0.76, 0.12, 0.62, 0.38, 0.44, -0.36), '#ececec'], ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => [bx(0.06, 0.1, 0.06, a * 0.78, 0, -0.45 + b * 0.36), '#2a2018'])]), mat: M.furnSoft, tint: true, shadow: false }],
    'furn:counter': () => [{ geo: mergeGeos([[bx(1.9, 0.82, 0.62, 0, 0.04, -0.68), '#f2efe8'], [bx(1.86, 0.06, 0.6, 0, 0, -0.68), '#3a3a3a'], [bx(1.96, 0.05, 0.68, 0, 0.86, -0.68), '#5a5a5c'], [bx(0.5, 0.012, 0.36, -0.45, 0.91, -0.66), '#9aa0a6'], ...[-1, 1].flatMap((s) => [[new THREE.CylinderGeometry(0.1, 0.1, 0.012, 14).translate(0.35 + s * 0.13, 0.917, -0.6), '#1a1a1a']]), [bx(0.02, 0.7, 0.01, -0.32, 0.1, -0.37), '#c8c4bc'], [bx(0.02, 0.7, 0.01, 0.32, 0.1, -0.37), '#c8c4bc']]), mat: M.furnWood, shadow: false }],
    // --- Heuballen-Stapel, Baumstamm ---
    'hay:stack': () => [{ geo: mergeGeos([bx(1.1, 0.5, 0.56, 0, 0, -0.29), bx(1.1, 0.5, 0.56, 0, 0, 0.29), bx(1.1, 0.5, 0.56, 0.05, 0.5, 0).rotateY(0.12)]), mat: M.hay }],
    log: () => [
      { geo: mergeGeos([new THREE.CylinderGeometry(0.3, 0.34, 2.5, 12).rotateZ(Math.PI / 2).translate(0, 0.32, 0), new THREE.CylinderGeometry(0.05, 0.08, 0.4, 6).rotateZ(0.9).translate(0.4, 0.62, 0.05), new THREE.CylinderGeometry(0.04, 0.07, 0.35, 6).rotateX(1.1).translate(-0.5, 0.45, 0.32), new THREE.CylinderGeometry(0.12, 0.2, 0.25, 8).rotateZ(Math.PI / 2).translate(1.3, 0.3, 0)]), mat: M.bark },
      { geo: mergeGeos([new THREE.CylinderGeometry(0.29, 0.29, 0.02, 12).rotateZ(Math.PI / 2).translate(-1.255, 0.32, 0)]), mat: M.crate },
    ],
    // --- Fahrzeuge ---
    'car:sedan': () => sedan(),
    'car:burnt': () => sedan(true).map((p) => ({ ...p, geo: p.geo.translate(0, -0.1, 0) })),
    'car:kombi': () => car({
      w: 1.78, r: 0.33, yb: 0.3, zF: 1.95, zR: -1.95, wheels: [1.25, -1.22],
      top: [[-1.98, 0.6], [-1.96, 0.9], [-1.9, 0.92], [1.0, 0.9], [1.84, 0.78], [1.98, 0.6]],
      glass: [[[-1.9, 0.9], [-1.82, 1.38], [0.42, 1.4], [1.02, 0.9]]],
      roof: [[-1.88, 1.34], [-1.84, 1.44], [0.42, 1.46], [0.52, 1.36]],
      pillars: [[1.0, 0.9, 0.44, 1.4], [-1.9, 0.9, -1.82, 1.38], [-0.14, 0.9, -0.14, 1.4], [-1.05, 0.9, -1.05, 1.39]],
      mirrorZ: 0.8, mirrorY: 0.98, doors: [0.78, -0.14, -1.05], doorH: 0.52, headY: 0.62, tailY: 0.78,
      extraDark: [[bx(0.04, 0.04, 2.1, -0.75, 1.46, -0.7), '#2a2a2a'], [bx(0.04, 0.04, 2.1, 0.75, 1.46, -0.7), '#2a2a2a']],
    }),
    'car:suv': () => car({
      w: 1.88, r: 0.4, yb: 0.4, zF: 2.0, zR: -2.0, wheels: [1.3, -1.28], rim: '#5a5e64',
      top: [[-2.03, 0.8], [-2.0, 1.04], [-1.95, 1.06], [1.2, 1.05], [1.92, 0.98], [2.03, 0.78]],
      glass: [[[-1.94, 1.04], [-1.86, 1.68], [0.55, 1.7], [1.18, 1.04]]],
      roof: [[-1.9, 1.64], [-1.86, 1.76], [0.55, 1.78], [0.64, 1.68]],
      pillars: [[1.16, 1.04, 0.56, 1.7], [-1.94, 1.04, -1.86, 1.68], [-0.2, 1.04, -0.2, 1.7], [-1.15, 1.04, -1.15, 1.69]],
      mirrorZ: 0.95, mirrorY: 1.15, doors: [0.95, -0.2, -1.15], doorH: 0.6, headY: 0.82, tailY: 0.92,
      extraDark: [[bx(0.05, 0.05, 2.2, -0.8, 1.78, -0.6), '#1e1e1e'], [bx(0.05, 0.05, 2.2, 0.8, 1.78, -0.6), '#1e1e1e'], [new THREE.CylinderGeometry(0.36, 0.36, 0.2, 14).rotateX(Math.PI / 2).translate(0, 0.95, -2.12), '#141414']],
    }),
    'car:van': () => car({
      w: 1.96, r: 0.36, yb: 0.36, zF: 2.1, zR: -2.1, wheels: [1.38, -1.35],
      top: [[-2.14, 0.6], [-2.12, 2.05], [-2.05, 2.14], [0.9, 2.14], [1.25, 1.82], [1.74, 1.06], [2.08, 0.96], [2.14, 0.6]],
      glass: [[[1.2, 1.8], [1.7, 1.07], [1.79, 1.1], [1.29, 1.84]], bx(0.02, 0.5, 0.62, -1.0, 1.18, 1.05), bx(0.02, 0.5, 0.62, 1.0, 1.18, 1.05)],
      mirrorZ: 1.55, mirrorY: 1.3, doors: [0.7, -0.6], doorH: 1.5, headY: 0.82, tailY: 0.9,
      extraDark: [[bx(0.012, 1.6, 0.016, 0, 0.42, -2.13), '#202020'], [bx(2.0, 0.1, 0.02, 0, 1.45, -1.0), '#3a3a3a']],
    }),
    'car:pickup': () => car({
      w: 1.86, r: 0.38, yb: 0.4, zF: 2.05, zR: -2.05, wheels: [1.35, -1.3], rim: '#c8ccd0',
      top: [[-2.08, 0.78], [-2.06, 0.98], [-0.42, 0.98], [-0.42, 1.06], [1.15, 1.05], [1.94, 0.98], [2.06, 0.76]],
      glass: [[[-0.4, 1.04], [-0.34, 1.66], [0.55, 1.68], [1.14, 1.04]]],
      roof: [[-0.42, 1.62], [-0.38, 1.74], [0.55, 1.76], [0.64, 1.66]],
      pillars: [[1.12, 1.04, 0.56, 1.68], [-0.4, 1.04, -0.36, 1.66], [0.3, 1.04, 0.3, 1.66]],
      mirrorZ: 0.95, mirrorY: 1.15, doors: [0.3], doorH: 0.56, headY: 0.8, tailY: 0.82,
      extraPaint: [bx(0.08, 0.34, 1.62, -0.89, 0.98, -1.22), bx(0.08, 0.34, 1.62, 0.89, 0.98, -1.22), bx(1.86, 0.34, 0.08, 0, 0.98, -2.04)],
      extraDark: [[bx(1.7, 0.03, 1.6, 0, 0.98, -1.22), '#202020']],
    }),
    'car:tractor': () => {
      const paint = [bx(0.78, 0.7, 1.5, 0, 0.75, 0.75), bx(0.9, 0.45, 1.0, 0, 0.7, -0.5), ...[-1, 1].map((s) => new THREE.CylinderGeometry(0.86, 0.86, 0.5, 14, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).translate(s * 0.82, 0.8, -0.55)),
        bx(1.4, 0.08, 1.3, 0, 2.3, -0.5), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => bx(0.06, 1.2, 0.06, a * 0.62, 1.1, -0.5 + b * 0.55))];
      const dark = [...wheel(-0.82, -0.55, 0.78, 0.45, '#d8b020'), ...wheel(0.82, -0.55, 0.78, 0.45, '#d8b020'), ...wheel(-0.62, 1.05, 0.42, 0.28, '#d8b020'), ...wheel(0.62, 1.05, 0.42, 0.28, '#d8b020'),
        [bx(0.6, 0.4, 0.06, 0, 0.9, 1.52), '#1a1a1a'], [new THREE.CylinderGeometry(0.05, 0.05, 1.1, 8).translate(0.25, 1.9, 1.1), '#2a2a2a'], [bx(0.45, 0.12, 0.4, 0, 1.15, -0.45), '#1e1e1e'], [bx(0.45, 0.4, 0.08, 0, 1.15, -0.68), '#1e1e1e'], [bx(0.3, 0.06, 0.3, 0, 1.35, 0.3), '#222222']];
      return [{ geo: mergeGeos(paint), mat: M.paint, paint: true }, { geo: mergeGeos(dark), mat: M.carDark, shadow: false },
        { geo: mergeGeos([bx(1.2, 0.9, 0.02, 0, 1.3, 0.04)]), mat: M.winGlass, shadow: false },
        { geo: mergeGeos([[bx(0.16, 0.1, 0.04, -0.25, 1.25, 1.51), [2.4, 2.3, 1.9]], [bx(0.16, 0.1, 0.04, 0.25, 1.25, 1.51), [2.4, 2.3, 1.9]]]), mat: M.glow, shadow: false }];
    },
    // --- Deko (ohne Kollision) ---
    'deco:bench': () => [{ geo: mergeGeos([...[-0.1, 0.03, 0.16].map((z) => [bx(1.6, 0.04, 0.11, 0, 0.44, z), '#a87444']), [bx(1.6, 0.09, 0.03, 0, 0.56, -0.2), '#a87444'], [bx(1.6, 0.09, 0.03, 0, 0.7, -0.2), '#a87444'], ...[-0.7, 0.7].flatMap((x) => [[bx(0.05, 0.44, 0.42, x, 0, 0.02), '#2a2d30'], [bx(0.05, 0.42, 0.04, x, 0.44, -0.2), '#2a2d30']])]), mat: M.furnWood, shadow: false }],
    'deco:bin': () => [{ geo: mergeGeos([[cyl(0.24, 0.2, 0.8, 12), '#2e5a3a'], [cyl(0.26, 0.26, 0.05, 12, 0, 0.8), '#1e2a22'], [new THREE.SphereGeometry(0.24, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.4, 1).translate(0, 0.85, 0), '#2e5a3a']]), mat: M.decoVC, shadow: false }],
    'deco:hydrant': () => [{ geo: mergeGeos([[cyl(0.17, 0.17, 0.06, 10), '#8a1414'], [cyl(0.11, 0.13, 0.5, 10), '#c42020'], [cyl(0.15, 0.15, 0.06, 10, 0, 0.46), '#c42020'], [new THREE.SphereGeometry(0.12, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.52, 0), '#c42020'], [new THREE.CylinderGeometry(0.05, 0.05, 0.34, 8).rotateZ(Math.PI / 2).translate(0, 0.33, 0), '#d8c8b0'], [cyl(0.03, 0.03, 0.06, 6, 0, 0.62), '#d8c8b0']]), mat: M.decoVC, shadow: false }],
    'deco:sign': () => [{ geo: mergeGeos([[cyl(0.035, 0.035, 2.35, 6), '#8a8d90'], [new THREE.CylinderGeometry(0.32, 0.32, 0.03, 20).rotateX(Math.PI / 2).translate(0, 2.05, 0.05), '#c01818'], [bx(0.42, 0.1, 0.04, 0, 2.0, 0.055), '#f4f4f4']]), mat: M.decoVC, shadow: false }],
    'deco:tlight': () => [
      { geo: mergeGeos([[cyl(0.06, 0.07, 3.2, 8), '#2b2f33'], [bx(0.3, 0.92, 0.24, 0, 2.3, 0.16), '#1c1f22'], ...[2.98, 2.73, 2.48].map((y) => [bx(0.26, 0.04, 0.12, 0, y + 0.1, 0.32), '#141618'])]), mat: M.decoVC },
      { geo: mergeGeos([[new THREE.CylinderGeometry(0.085, 0.085, 0.03, 12).rotateX(Math.PI / 2).translate(0, 3.0, 0.29), [2.6, 0.15, 0.1]], [new THREE.CylinderGeometry(0.085, 0.085, 0.03, 12).rotateX(Math.PI / 2).translate(0, 2.75, 0.29), [0.35, 0.25, 0.03]], [new THREE.CylinderGeometry(0.085, 0.085, 0.03, 12).rotateX(Math.PI / 2).translate(0, 2.5, 0.29), [0.03, 0.3, 0.1]]]), mat: M.glow, shadow: false },
    ],
    'deco:lamp': () => [
      { geo: mergeGeos([[cyl(0.07, 0.1, 4.4, 8), '#3a3d40'], [cyl(0.14, 0.16, 0.3, 8), '#2a2c2e'], [bx(0.06, 0.06, 1.0, 0, 4.3, 0.45), '#3a3d40'], [bx(0.36, 0.12, 0.62, 0, 4.2, 0.92), '#2a2c2e']]), mat: M.decoVC },
      { geo: mergeGeos([[bx(0.3, 0.03, 0.52, 0, 4.17, 0.92), [3.2, 2.5, 1.5]]]), mat: M.glow, shadow: false },
    ],
    'deco:flowers': () => {
      const leaves = [], blooms = [];
      for (let i = 0; i < 9; i++) { const a = Math.random() * 6.28, r = Math.random() * 0.35, x = Math.cos(a) * r, z = Math.sin(a) * r, h = 0.18 + Math.random() * 0.2; leaves.push([new THREE.ConeGeometry(0.05, h, 4).translate(x, h / 2, z), '#bfe0a0']); blooms.push(new THREE.IcosahedronGeometry(0.055, 0).translate(x, h + 0.02, z)); }
      return [{ geo: mergeGeos(leaves), mat: M.leafVC, shadow: false }, { geo: mergeGeos(blooms), mat: M.decoVC, tint: true, shadow: false }];
    },
    'deco:mailbox': () => [{ geo: mergeGeos([[bx(0.08, 1.0, 0.08), '#6b4a2a'], [bx(0.24, 0.24, 0.44, 0, 1.0, 0), '#3a5a8a'], [new THREE.CylinderGeometry(0.12, 0.12, 0.44, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(0, 1.24, 0), '#3a5a8a'], [bx(0.02, 0.16, 0.05, 0.13, 1.12, 0.12), '#c42020']]), mat: M.decoVC, shadow: false }],
    'deco:bush': () => [{ geo: mergeGeos([[new THREE.IcosahedronGeometry(0.5, 1).scale(1, 0.75, 1).translate(0, 0.32, 0), '#d8f0c0'], [new THREE.IcosahedronGeometry(0.38, 1).scale(1, 0.8, 1).translate(0.38, 0.26, 0.12), '#c8e4b0'], [new THREE.IcosahedronGeometry(0.32, 1).translate(-0.3, 0.24, -0.2), '#e0f4cc']]), mat: M.leafVC, tint: true }],
    'deco:fern': () => [{ geo: mergeGeos(Array.from({ length: 8 }, (_, i) => [new THREE.BoxGeometry(0.16, 0.015, 0.62).translate(0, 0, 0.31).rotateX(-0.55 - (i % 2) * 0.2).rotateY((i / 8) * Math.PI * 2 + Math.random() * 0.3).translate(0, 0.06, 0), i % 2 ? '#b8e09a' : '#a0d088'])), mat: M.leafVC, shadow: false }],
    'deco:mushroom': () => [{ geo: mergeGeos([[0, 0, 1], [0.14, 0.08, 0.7], [-0.1, 0.12, 0.8]].flatMap(([x, z, s]) => [[cyl(0.025 * s, 0.035 * s, 0.13 * s, 6, x, 0, z), '#efe8dc'], [new THREE.SphereGeometry(0.075 * s, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1).translate(x, 0.12 * s, z), s > 0.9 ? '#b8281a' : '#8a5a34']])), mat: M.decoVC, shadow: false }],
    'deco:stump': () => [{ geo: mergeGeos([[cyl(0.26, 0.34, 0.42, 10), '#4a3423'], [cyl(0.25, 0.25, 0.02, 10, 0, 0.42), '#c8a070'], ...[0, 2.1, 4.2].map((a) => [new THREE.BoxGeometry(0.12, 0.1, 0.4).translate(0, 0.05, 0.38).rotateY(a), '#4a3423'])]), mat: M.furnWood, shadow: false }],
    'deco:cactus': () => [{ geo: mergeGeos([[cyl(0.16, 0.19, 1.6, 10), '#5f8f44'], [ball(0.16, 0, 1.6, 0, 10, 6), '#5f8f44'], [new THREE.CylinderGeometry(0.09, 0.09, 0.34, 8).rotateZ(Math.PI / 2).translate(-0.28, 0.75, 0), '#5a8a40'], [cyl(0.09, 0.1, 0.55, 8, -0.42, 0.72, 0), '#5a8a40'], [ball(0.09, -0.42, 1.27, 0, 8, 6), '#5a8a40'], [new THREE.CylinderGeometry(0.08, 0.08, 0.26, 8).rotateZ(Math.PI / 2).translate(0.24, 1.0, 0), '#5a8a40'], [cyl(0.08, 0.09, 0.38, 8, 0.36, 0.97, 0), '#5a8a40'], [ball(0.08, 0.36, 1.35, 0, 8, 6), '#5a8a40']]), mat: M.cactus }],
    'deco:drybush': () => [{ geo: mergeGeos(Array.from({ length: 14 }, () => [new THREE.CylinderGeometry(0.01, 0.022, 0.55, 4).translate(0, 0.27, 0).rotateZ(0.3 + Math.random() * 0.9).rotateY(Math.random() * 6.28), '#9a7a4c'])), mat: M.furnWood, shadow: false }],
    'deco:pebbles': () => [{ geo: mergeGeos([new THREE.DodecahedronGeometry(0.2, 0).scale(1, 0.6, 1).translate(0, 0.08, 0), new THREE.DodecahedronGeometry(0.14, 0).translate(0.3, 0.06, 0.1), new THREE.DodecahedronGeometry(0.1, 0).translate(-0.2, 0.04, 0.25)]), mat: M.rock, shadow: false }],
    'deco:drift': () => [{ geo: new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.3, 0.34, 0.85), mat: M.snow, shadow: false }],
    'deco:ice': () => [{ geo: mergeGeos([new THREE.DodecahedronGeometry(0.38, 0).scale(1, 0.8, 1).translate(0, 0.2, 0), new THREE.DodecahedronGeometry(0.24, 0).translate(0.38, 0.12, 0.15), new THREE.OctahedronGeometry(0.2, 0).translate(-0.28, 0.12, -0.25)]), mat: M.ice }],
    'deco:rug': () => [{ geo: mergeGeos([[bx(1.5, 0.012, 1.0), '#ffffff'], [bx(1.3, 0.014, 0.8), '#d8d0c4']]), mat: M.furnSoft, tint: true, shadow: false }],
  };
  Object.assign(defs, mapDefs(M, P));
  for (const [k, f] of Object.entries(defs)) { let v = null; Object.defineProperty(P, k, { get: () => (v ||= f()), enumerable: true, configurable: true }); }
  return { parts: P, mats: M };
}

// ---------- Karten-Hindernisse (Vertrag orchestrator/karten): Wandmodule, Deckung, Vegetation, Fahrzeuge, Bauwerke ----------
// Lokales Koordinatensystem: Feld = x/z ∈ [-1, 1], Boden y = 0; lineare Objekte entlang x; Fahrzeuge/Container: vorne = +z.
// Materialien werden erst erzeugt, wenn ein Typ auf der Karte vorkommt (Teile sind Lazy-Getter).
function mapDefs(M, P) {
  const T = TILE, L = {}, t0 = textures();
  const mk = (k, f) => L[k] ||= f();
  const W = {
    stone: () => mk('stone', () => rough({ map: tx('stoneWall'), roughness: 0.95 }, tx('stoneWallD'), 0.9)),
    concrete: () => mk('concrete', () => rough({ map: tx('formConcrete'), roughness: 0.9 }, tx('formConcreteD'), 0.8)),
    corr: () => mk('corr', () => rough({ map: tx('corrugated'), metalness: 0.55, roughness: 0.55 }, tx('corrugatedD'), 1.6)),
    plaster: () => mk('plaster', () => rough({ map: tx('plasterCrack'), roughness: 0.92 }, tx('plasterCrackD'), 1)),
    glass: () => mk('glass', () => std({ color: 0xa8c8d4, metalness: 0.1, roughness: 0.04, transparent: true, opacity: 0.3, envMapIntensity: 1.8, depthWrite: false })),
    burlap: () => mk('burlap', () => rough({ map: tx('burlap'), vertexColors: true, roughness: 1 }, tx('burlapD'), 1.4)),
    endGrain: () => mk('endGrain', () => rough({ map: tx('endGrain'), vertexColors: true, roughness: 0.9 }, tx('endGrainD'), 1)),
    barkVC: () => mk('barkVC', () => rough({ map: t0.bark, vertexColors: true, roughness: 1 }, t0.barkD, 1.5)),
    birch: () => mk('birch', () => rough({ map: tx('birchBark'), roughness: 0.85 }, tx('birchBarkD'), 0.8)),
    palm: () => mk('palm', () => rough({ map: tx('palmBark'), roughness: 0.95 }, tx('palmBarkD'), 1.8)),
    frond: () => mk('frond', () => std({ map: tx('frond'), vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8 })),
    rockVC: () => mk('rockVC', () => rough({ map: t0.rock, vertexColors: true, roughness: 0.95, flatShading: true }, t0.rockD, 0.4)),
    wreck: () => mk('wreck', () => rough({ map: t0.concrete, vertexColors: true, metalness: 0.35, roughness: 0.85 }, t0.concreteD, 0.8)),
    container: () => mk('container', () => atlasify(rough({ map: tx('container'), metalness: 0.45, roughness: 0.7 }, tx('containerD'), 1.4))),
    drum: () => mk('drum', () => rough({ map: tx('drum'), vertexColors: true, metalness: 0.5, roughness: 0.7 }, tx('drumD'), 0.6)),
    fuelDrum: () => mk('fuelDrum', () => rough({ map: tx('fuelDrum'), vertexColors: true, metalness: 0.45, roughness: 0.7 }, tx('fuelDrumD'), 0.6)),
    pump: () => mk('pump', () => rough({ map: tx('pump'), emissiveMap: tx('pumpEmit'), emissive: 0xffffff, emissiveIntensity: 1.4, vertexColors: true, metalness: 0.15, roughness: 0.6 }, tx('pumpD'), 0.3)),
    veh: () => mk('veh', () => std({ map: tx('veh'), roughnessMap: tx('vehR'), vertexColors: true, metalness: 0.3, roughness: 1, envMapIntensity: 1.3 })),
    vehPaint: () => mk('vehPaint', () => std({ vertexColors: true, metalness: 0.4, roughness: 0.38, envMapIntensity: 1.2 })),
    ashlar: () => mk('ashlar', () => rough({ map: t0.concrete, color: 0xe2d4b6, vertexColors: true, roughness: 0.85 }, t0.concreteD, 0.9)),
    pool: () => mk('pool', () => std({ color: 0x3f7f8c, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.78, envMapIntensity: 1.8 })),
    grave: () => mk('grave', () => rough({ map: tx('grave'), vertexColors: true, roughness: 0.5 }, tx('graveD'), 0.5)),
    bronze: () => mk('bronze', () => rough({ map: t0.concrete, color: 0x6f9a86, metalness: 0.55, roughness: 0.55 }, t0.concreteD, 0.7)),
    steel: () => mk('steel', () => rough({ map: t0.plain, vertexColors: true, metalness: 0.65, roughness: 0.5 }, t0.plainD, 0.3)),
    tank: () => mk('tank', () => rough({ map: tx('tankPaint'), metalness: 0.4, roughness: 0.6 }, tx('tankPaintD'), 0.6)),
    silo: () => mk('silo', () => rough({ map: tx('silo'), metalness: 0.6, roughness: 0.45 }, tx('siloD'), 1.2)),
    tent: () => mk('tent', () => rough({ map: t0.fabric, vertexColors: true, roughness: 0.85 }, t0.plainD, 0.4)),
    mil: () => mk('mil', () => rough({ map: tx('milcrate'), vertexColors: true, roughness: 0.85 }, tx('milcrateD'), 0.8)),
    chain: () => mk('chain', () => std({ map: tx('chain'), transparent: true, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.45, depthWrite: false })),
  };
  const H = 2.8, F = (g, h = H) => planarUV(g, h, 0);
  const hsl = (h, s, l) => new THREE.Color().setHSL(h, s, l);
  const v2 = (a) => a.map(([x, y]) => new THREE.Vector2(x, y));
  // UV-v nach Höhe (durchgehende Rinde über mehrere Stammstücke)
  const uvH = (g, h) => { const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setY(i, p.getY(i) / h); return g; };
  // Projektion (x, y) → Atlas-Bereich; Vorderseite (+z) erhält rect, alle anderen Flächen def
  const projUV = (g, x0, x1, y0, y1, rect, def) => {
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { const r = n.getZ(i) > 0.7 ? rect : def, u = (p.getX(i) - x0) / (x1 - x0), v = (p.getY(i) - y0) / (y1 - y0); uv.setXY(i, r[0] + u * (r[2] - r[0]), r[1] + v * (r[3] - r[1])); }
    return g;
  };
  const D = {};

  // ===== Wandmodule (volles Feld, wie Gebäudewände) =====
  D.stone = () => [{ geo: mergeGeos([F(bx(T, H, T)), F(bx(T + 0.1, 0.5, T + 0.1)), F(bx(T + 0.08, 0.16, T + 0.08, 0, H - 0.16))]), mat: W.stone() }];
  D.concrete = () => [{ geo: mergeGeos([F(bx(T, H, T)), F(bx(T + 0.06, 0.3, T + 0.06)), F(bx(T + 0.12, 0.12, T + 0.12, 0, H - 0.12))]), mat: W.concrete() }];
  D.metalsheet = () => [
    { geo: F(bx(T, 3.2, T), 3.2), mat: W.corr() },
    { geo: mergeGeos([[bx(T + 0.05, 0.3, T + 0.05), '#8d8b86'], [bx(T + 0.1, 0.08, T + 0.1, 0, 3.18), '#b8bcc0'], [bx(T + 0.05, 0.05, T + 0.05, 0, 1.6), '#9aa0a4']]), mat: M.trim, shadow: false },
  ];
  D.plaster = () => [
    { geo: F(bx(T, H, T)), mat: W.plaster() },
    { geo: mergeGeos([[bx(T + 0.05, 0.4, T + 0.05), '#7a756e'], [bx(T + 0.1, 0.1, T + 0.1, 0, H - 0.22), '#ffffff'], [bx(T + 0.16, 0.14, T + 0.16, 0, H - 0.12), '#ffffff']]), mat: M.trim, shadow: false },
  ];
  // ===== Gebäude-Wandmodule aus neuen Materialien: Außenwand / Fenster / Türrahmen, je mit Obergeschossen (bit 1/2), Höhe 2,8 m =====
  const BM = { stone: W.stone, concrete: W.concrete, metalsheet: W.corr, plaster: W.plaster };
  for (const [k, mf] of Object.entries(BM)) {
    const up = (n) => ({ geo: planarUV(bx(T, H, T, 0, n * H), H, n * H), mat: mf(), bit: n });
    D[k + ':out'] = () => [{ geo: F(bx(T, H, T)), mat: mf() }, { geo: mergeGeos([[bx(T + 0.06, 0.32, T + 0.06), '#6f6a64'], [bx(T + 0.1, 0.1, T + 0.1, 0, H - 0.22), '#ffffff'], [bx(T + 0.16, 0.16, T + 0.16, 0, H - 0.12), '#ffffff']]), mat: M.trim, shadow: false }, up(1), up(2)];
    D[k + ':win'] = () => { const w = P.window; return [{ geo: mergeGeos([F(bx(T, 0.95, T)), F(bx(T, 0.6, T, 0, 2.2)), F(bx(0.32, 1.25, T, -0.84, 0.95)), F(bx(0.32, 1.25, T, 0.84, 0.95))]), mat: mf() }, w[1], w[2], up(1), up(2)]; };
    D[k + ':door'] = () => { const d = P.door; return [{ geo: mergeGeos([F(bx(T, 0.6, T, 0, 2.2)), F(bx(0.36, 2.2, T, -0.82)), F(bx(0.36, 2.2, T, 0.82))]), mat: mf() }, d[1], up(1), up(2)]; };
  }
  // ===== Glaswand: Sockel, Sprossen, zwei Scheiben =====
  D.glass = () => {
    const fr = '#e9ebe8';
    const f = [[bx(T, 0.4, 0.24), '#9b988f'], [bx(T, 0.06, 0.1, 0, 0.4), fr], [bx(T, 0.08, 0.12, 0, 2.5), fr], [bx(T, 0.05, 0.08, 0, 1.45), fr], [bx(T, 0.04, 0.16, 0, 2.58), '#b9bec2']];
    for (const x of [-0.97, 0, 0.97]) f.push([bx(0.06, 2.1, 0.09, x, 0.4), fr]);
    return [{ geo: mergeGeos(f), mat: M.decoVC }, { geo: mergeGeos([bx(0.9, 2.04, 0.015, -0.485, 0.46), bx(0.9, 2.04, 0.015, 0.485, 0.46)]), mat: W.glass(), shadow: false }];
  };
  // ===== Niedrige Feldsteinmauer: verjüngter, unregelmäßiger Kern + Decksteine =====
  D.stonewall = () => {
    const body = new THREE.BoxGeometry(T, 0.78, 0.64, 10, 4, 3).translate(0, 0.39, 0), p = body.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) * (1 - 0.3 * p.getY(i) / 0.78));
    warp(body, 0.035, 2.2); planarUV(body, 2.8);
    const caps = Array.from({ length: 7 }, (_, i) => stoneGeo(0.16 + rnd() * 0.04, -0.9 + i * 0.3 + (rnd() - 0.5) * 0.06, 0.84, (rnd() - 0.5) * 0.08, 1.15, 0.5, 1.15));
    return [{ geo: mergeGeos([body, ...caps]), mat: W.stone() }];
  };
  // ===== Sandsackstellung: 6 Lagen im Verband, unten zweireihig =====
  D.sandbag = () => {
    const cols = ['#cdb98f', '#bca97c', '#a99a70', '#8f8c62', '#c4b088'], out = [];
    const bag = (x, y, z, len, ry) => {
      const g = new THREE.SphereGeometry(0.5, 7, 5), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, Math.max(-0.36, Math.min(0.36, p.getY(i))));
      return [g.scale(len, 0.2, 0.36).rotateZ((rnd() - 0.5) * 0.08).rotateY(ry).translate(x, y + 0.072, z), cols[(rnd() * cols.length) | 0]];
    };
    for (let k = 0; k < 6; k++) {
      const xs = k % 2 ? [[-0.86, 0.42], [-0.33, 0.62], [0.33, 0.62], [0.86, 0.42]] : [[-0.66, 0.64], [0, 0.64], [0.66, 0.64]];
      for (const z of k < 3 ? [-0.18, 0.18] : [0.02]) for (const [x, len] of xs) out.push(bag(x + (rnd() - 0.5) * 0.04, k * 0.152, z + (rnd() - 0.5) * 0.04, len, (rnd() - 0.5) * 0.1));
    }
    return [{ geo: mergeGeos(out), mat: W.burlap() }];
  };
  // ===== Holzstapel: Rundhölzer in Lagen, Stirnseiten mit Jahresringen, Stützpfosten =====
  D.woodpile = () => {
    const sides = [], ends = [];
    for (let r = 0; r < 5; r++) {
      const n = r % 2 ? 7 : 8;
      for (let i = 0; i < n; i++) {
        const rad = 0.075 + rnd() * 0.03, len = 0.9 + rnd() * 0.12, dz = (rnd() - 0.5) * 0.08, cx = -0.7 + i * 0.2 + (r % 2 ? 0.1 : 0) + (rnd() - 0.5) * 0.02, cy = 0.19 + r * 0.173 + (rnd() - 0.5) * 0.015, sh = 0.72 + rnd() * 0.4;
        sides.push([new THREE.CylinderGeometry(rad, rad, len, 7, 1, true).rotateY(rnd() * 3).rotateX(Math.PI / 2).translate(cx, cy, dz), [sh, sh * 0.95, sh * 0.9]]);
        for (const s of [-1, 1]) ends.push([new THREE.CircleGeometry(rad, 7).rotateY(s < 0 ? Math.PI : 0).translate(cx, cy, dz + (s * len) / 2), [0.8 + rnd() * 0.25, 0.75 + rnd() * 0.2, 0.7 + rnd() * 0.2]]);
      }
    }
    for (const z of [-0.3, 0.3]) sides.push([bx(1.9, 0.1, 0.1, 0, 0, z), '#9a8a7a']);
    for (const x of [-0.93, 0.93]) for (const z of [-0.32, 0.32]) sides.push([rod([x, 0, z], [x * 1.02, 1.12, z], 0.045, 0.04, 6), '#b0a090']);
    return [{ geo: mergeGeos(sides), mat: W.barkVC() }, { geo: mergeGeos(ends), mat: W.endGrain(), shadow: false }];
  };
  // ===== Busch: Laubballen mit Innenschatten =====
  D.bush = () => {
    const l = [[blob(0.55, 0, 0.5, 0, 1.15, 0.85, 1.1, 0.25), '#ffffff']];
    for (let i = 0; i < 6; i++) { const a = i * 1.05 + rnd() * 0.5, r = 0.35 + rnd() * 0.2; l.push([blob(0.28 + rnd() * 0.14, Math.cos(a) * r * 1.1, 0.3 + rnd() * 0.45, Math.sin(a) * r, 1, 0.85, 1, 0.3), hsl(0.24 + rnd() * 0.05, 0.35, 0.55 + rnd() * 0.3)]); }
    return [{ geo: shadeY(mergeGeos(l), 0, 1.0, 0.45), mat: M.leafVC }];
  };
  // ===== Hohe Hecke: verformter Quader + Ausreißer oben/seitlich =====
  D.tallhedge = () => {
    const g = warp(new THREE.BoxGeometry(T, 2.05, 1.0, 8, 8, 4).translate(0, 1.025, 0), 0.07, 2.5);
    scaleUV(g, 2, 2);
    const l = [[g, '#ffffff']];
    for (let i = 0; i < 7; i++) l.push([blob(0.22 + rnd() * 0.12, -0.85 + i * 0.28, 1.95 + rnd() * 0.15, (rnd() - 0.5) * 0.6, 1.2, 0.8, 1, 0.3), hsl(0.25, 0.3, 0.6 + rnd() * 0.25)]);
    return [{ geo: shadeY(mergeGeos(l), 0, 2.1, 0.4), mat: M.leafVC }];
  };
  // ===== Birke: weißer, leicht gebogener Stamm, lockere hohe Krone =====
  D.birch = () => {
    const pts = [[0, 0, 0], [0.04, 1.6, 0.02], [0.12, 3.2, -0.04], [0.08, 4.6, 0.03], [0.02, 5.6, 0]], rads = [0.17, 0.13, 0.1, 0.07, 0.035];
    const wood = []; for (let i = 0; i < 4; i++) wood.push(rod(pts[i], pts[i + 1], rads[i], rads[i + 1], 8));
    for (let i = 0; i < 7; i++) { const y = 2.4 + i * 0.45, a = i * 2.4 + rnd(), l = 0.6 + rnd() * 0.7, p0 = [0.1, y, 0]; wood.push(rod(p0, [p0[0] + Math.cos(a) * l, y + 0.4 + rnd() * 0.4, Math.sin(a) * l], 0.04, 0.015, 5)); }
    wood.forEach((g) => uvH(g, 5.8));
    const crown = [];
    for (let i = 0; i < 10; i++) { const y = 3.0 + rnd() * 2.7, rr = (1 - (y - 3) / 3.4) * 0.95 + 0.25, a = rnd() * 6.28; crown.push([blob(0.42 + rnd() * 0.32, Math.cos(a) * rr * 0.8 + 0.08, y, Math.sin(a) * rr * 0.8, 1, 1.3, 1, 0.32), hsl(0.2 + rnd() * 0.05, 0.4, 0.62 + rnd() * 0.25)]); }
    return [{ geo: mergeGeos(wood), mat: W.birch() }, { geo: shadeY(mergeGeos(crown), 2.6, 6.2, 0.55), mat: M.leafVC }];
  };
  // ===== Eiche: kräftiger Stamm mit Wurzelanläufen, ausladende Äste, breite unregelmäßige Krone =====
  D.oak = () => {
    const wood = [[rod([0, 0, 0], [0.05, 2.4, 0], 0.46, 0.34, 10), '#ffffff']];
    for (let i = 0; i < 5; i++) { const a = i * 1.26 + rnd() * 0.4; wood.push([rod([Math.cos(a) * 0.28, 0.32, Math.sin(a) * 0.28], [Math.cos(a) * 0.72, 0, Math.sin(a) * 0.72], 0.2, 0.05, 6), '#e8e0d8']); }
    const limbs = [];
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26 + rnd() * 0.5, r = 1.0 + rnd() * 0.5, y = 3.4 + rnd() * 0.9, e = [Math.cos(a) * r, y, Math.sin(a) * r];
      wood.push([rod([0.05, 2.2, 0], e, 0.22, 0.1, 7), '#ffffff']); limbs.push(e);
      for (let k = 0; k < 2; k++) { const b = a + (rnd() - 0.5) * 1.4; wood.push([rod(e, [e[0] + Math.cos(b) * 0.7, e[1] + 0.6 + rnd() * 0.5, e[2] + Math.sin(b) * 0.7], 0.09, 0.03, 5), '#ffffff']); }
    }
    const crown = [[blob(1.35, 0, 5.4, 0, 1.25, 0.72, 1.25, 0.3), hsl(0.27, 0.35, 0.55)]];
    for (const e of limbs) {
      crown.push([blob(0.9 + rnd() * 0.35, e[0] * 1.15, e[1] + 1.0 + rnd() * 0.4, e[2] * 1.15, 1.2, 0.78, 1.2, 0.34), hsl(0.24 + rnd() * 0.06, 0.4, 0.5 + rnd() * 0.3)]);
      crown.push([blob(0.5 + rnd() * 0.25, e[0] * 1.5, e[1] + 0.5, e[2] * 1.5, 1.1, 0.8, 1.1, 0.35), hsl(0.25 + rnd() * 0.05, 0.4, 0.45 + rnd() * 0.25)]);
    }
    return [{ geo: mergeGeos(wood), mat: W.barkVC() }, { geo: shadeY(mergeGeos(crown), 3.2, 7, 0.5), mat: M.leafVC }];
  };
  // ===== Palme: gebogener Ringstamm, hängende Fiederwedel, Kokosnüsse, trockene Wedel =====
  D.palm = () => {
    const P = (t) => [0.9 * t * t, 5.5 * t, 0.15 * t * t], n = 9, trunk = [];
    for (let i = 0; i < n; i++) trunk.push(rod(P(i / n), P((i + 1) / n), i === 0 ? 0.3 : 0.2 - (0.07 * i) / n, 0.2 - (0.07 * (i + 1)) / n, 10));
    const C = P(1), fr = [];
    const frond = (az, len, lift, col, w0 = 0.55) => {
      const N = 8, pos = [], uv = [], idx = [], dx = Math.cos(az), dz = Math.sin(az), px = -dz, pz = dx;
      for (let i = 0; i <= N; i++) {
        const s = i / N, d = len * s, y = C[1] + len * (lift * s - 0.9 * s * s), w = w0 * Math.sin(Math.PI * Math.min(1, 0.12 + s * 0.95)), cx = C[0] + dx * d, cz = C[2] + dz * d;
        pos.push(cx + (px * w) / 2, y - w * 0.14, cz + (pz * w) / 2, cx, y + w * 0.06, cz, cx - (px * w) / 2, y - w * 0.14, cz - (pz * w) / 2);
        uv.push(0, s, 0.5, s, 1, s);
        if (i) { const a = (i - 1) * 3; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      fr.push([g, col]);
    };
    for (let i = 0; i < 11; i++) frond((i / 11) * 6.28 + rnd() * 0.3, 2.3 + rnd() * 0.5, 0.35 + rnd() * 0.3, hsl(0.22 + rnd() * 0.05, 0.3, 0.75 + rnd() * 0.2));
    for (let i = 0; i < 3; i++) frond(rnd() * 6.28, 1.5, 1.25, '#ffffff', 0.4);
    for (let i = 0; i < 3; i++) frond(rnd() * 6.28, 1.6, -0.5, '#9a7a48', 0.4);
    for (let i = 0; i < 4; i++) { const a = i * 1.6 + rnd(); fr.push([uvConst(ball(0.1, C[0] + Math.cos(a) * 0.16, C[1] - 0.12, C[2] + Math.sin(a) * 0.16, 8, 6), [0.49, 0.5, 0.51, 0.5]), '#6a4422']); }
    return [{ geo: mergeGeos(trunk), mat: W.palm() }, { geo: mergeGeos(fr), mat: W.frond() }];
  };
  // ===== Abgestorbener Baum: verwitterter, verzweigter Stamm =====
  D.deadtree = () => {
    const l = [];
    const branch = (a, dir, len, r, depth) => {
      const b = [a[0] + dir[0] * len, a[1] + dir[1] * len, a[2] + dir[2] * len];
      l.push([rod(a, b, r, r * 0.62, depth === 0 ? 8 : 5), depth === 0 ? '#a29a8e' : '#b0a89c']);
      if (depth >= 3) return;
      for (let i = 0, k = depth === 0 ? 3 : 2; i < k; i++) {
        const az = rnd() * 6.28, el = 0.3 + rnd() * 0.7, v = [dir[0] * 0.55 + Math.cos(el) * Math.cos(az), dir[1] * 0.55 + Math.sin(el), dir[2] * 0.55 + Math.cos(el) * Math.sin(az)], m = Math.hypot(...v);
        if (depth === 2 && rnd() < 0.3) continue; // abgebrochen
        branch(b, v.map((q) => q / m), len * (0.5 + rnd() * 0.2), r * 0.6, depth + 1);
      }
    };
    branch([0, 0, 0], [0.04, 1, 0.02], 1.9, 0.26, 0);
    for (let i = 0; i < 4; i++) { const a = i * 1.57 + rnd() * 0.5; l.push([rod([Math.cos(a) * 0.12, 0.25, Math.sin(a) * 0.12], [Math.cos(a) * 0.55, -0.02, Math.sin(a) * 0.55], 0.1, 0.03, 5), '#8f877c']); }
    return [{ geo: mergeGeos(l), mat: M.furnWood }];
  };
  // ===== Baumstumpf: Rinde mit Wurzelanläufen, Schnittfläche mit Jahresringen =====
  D.stump = () => {
    const bark = [[new THREE.CylinderGeometry(0.34, 0.42, 0.5, 11, 1, true).translate(0, 0.25, 0), '#ffffff'], [new THREE.TorusGeometry(0.335, 0.03, 5, 11).rotateX(Math.PI / 2).translate(0, 0.5, 0), '#c8b8a0']];
    for (let i = 0; i < 5; i++) { const a = i * 1.26 + rnd() * 0.4; bark.push([rod([Math.cos(a) * 0.25, 0.24, Math.sin(a) * 0.25], [Math.cos(a) * 0.8, -0.02, Math.sin(a) * 0.8], 0.16, 0.04, 6), '#e0d8d0']); }
    return [{ geo: mergeGeos(bark), mat: W.barkVC() }, { geo: mergeGeos([new THREE.CircleGeometry(0.34, 11).rotateX(-Math.PI / 2).translate(0, 0.5, 0)]), mat: W.endGrain(), shadow: false }];
  };
  // ===== Geröllhaufen: kantige Steine, große unten =====
  D.rockpile = () => {
    const l = [], add = (r, x, y, z) => l.push([stoneGeo(r, x, y, z, 1 + rnd() * 0.4, 0.6 + rnd() * 0.3, 1 + rnd() * 0.3), hsl(0.08, 0.06 + rnd() * 0.08, 0.5 + rnd() * 0.35)]);
    add(0.5, 0, 0.3, 0); add(0.42, 0.48, 0.24, -0.3); add(0.4, -0.5, 0.22, 0.28); add(0.36, 0.1, 0.6, 0.08); add(0.3, -0.3, 0.3, -0.45);
    for (let i = 0; i < 10; i++) { const a = rnd() * 6.28, r = 0.6 + rnd() * 0.35; add(0.1 + rnd() * 0.16, Math.cos(a) * r, 0.07, Math.sin(a) * r); }
    return [{ geo: mergeGeos(l), mat: W.rockVC() }];
  };
  // ===== Schiffscontainer als 2-m-Segmente (vorne / Mitte / hinten mit Türen / einzeln) – Farbe = Atlasspalte je Instanz =====
  const cont = (role) => {
    const Wc = 1.96, hw = Wc / 2, Hc = 2.59, C = (x0, y0, x1, y1) => pxRect(x0, y0, x1, y1);
    const A = C(2, 2, 126, 254), B = C(130, 2, 254, 254), Dr = C(4, 260, 124, 508), Fw = C(132, 260, 252, 444), P = C(136, 452, 248, 508);
    const front = role === 'front' || role === 'single', rear = role === 'rear' || role === 'single', side = role === 'rear' || role === 'front' ? B : A;
    const g = [boxUV(Wc, Hc - 0.02, 2.0, 0, 0.01, 0, [side, side, P, P, front ? Fw : P, rear ? Dr : P])];
    for (const s of [-1, 1]) g.push(boxUV(0.07, 0.16, 2.0, s * (hw + 0.02), 0, 0, [], P), boxUV(0.07, 0.1, 2.0, s * (hw + 0.02), Hc - 0.1, 0, [], P));
    const ends = [...(front ? [1] : []), ...(rear ? [-1] : [])];
    for (const e of ends) {
      const zc = e * (1 - 0.075);
      for (const s of [-1, 1]) { g.push(boxUV(0.16, Hc, 0.17, s * (hw - 0.06), 0, zc, [], P)); for (const y of [0, Hc - 0.13]) g.push(boxUV(0.2, 0.13, 0.2, s * (hw - 0.06), y, zc, [], P)); }
      g.push(boxUV(Wc + 0.04, 0.2, 0.17, 0, 0, zc, [], P), boxUV(Wc + 0.04, 0.16, 0.17, 0, Hc - 0.16, zc, [], P));
    }
    if (rear) for (const x of [-0.71, -0.27, 0.27, 0.71]) {
      g.push(uvConst(rod([x, 0.12, -1.035], [x, 2.45, -1.035], 0.022, 0.022, 6), P), uvConst(bx(0.06, 0.05, 0.05, x, 0.06, -1.03), P), uvConst(bx(0.06, 0.05, 0.05, x, 2.48, -1.03), P));
      g.push(uvConst(bx(0.05, 0.04, 0.24, x + 0.04, 1.2, -1.12), P));
    }
    return [{ geo: mergeGeos(g), mat: W.container(), atlas: true }];
  };
  for (const r of ['front', 'mid', 'rear', 'single']) D['container:' + r] = () => cont(r);
  // ===== Palettenstapel (Europaletten), optional mit Ladung =====
  const eur = (x, y, z, ry, col) => {
    const g = [], c = new THREE.Color(col), sh = () => c.clone().multiplyScalar(0.85 + rnd() * 0.25);
    for (const [zz, w] of [[-0.3275, 0.145], [-0.165, 0.1], [0, 0.145], [0.165, 0.1], [0.3275, 0.145]]) g.push([bx(1.2, 0.022, w, 0, 0.122, zz), sh()]);
    for (const xx of [-0.5275, 0, 0.5275]) g.push([bx(0.145, 0.022, 0.8, xx, 0.1, 0), sh()]);
    for (const zz of [-0.3275, 0, 0.3275]) { g.push([bx(1.2, 0.022, 0.145, 0, 0, zz), sh()]); for (const xx of [-0.5275, 0, 0.5275]) g.push([bx(0.145, 0.078, 0.145, xx, 0.022, zz), sh().multiplyScalar(0.85)]); }
    return g.map(([q, cc]) => [q.rotateY(ry).translate(x, y, z), cc]);
  };
  const stack = (n, z, out) => { for (let k = 0; k < n; k++) out.push(...eur((rnd() - 0.5) * 0.06, k * 0.144, z + (rnd() - 0.5) * 0.05, (rnd() - 0.5) * 0.06, rnd() < 0.6 ? '#dcc69a' : '#a89f8c')); };
  D.pallet = () => { const o = []; stack(6, -0.44, o); stack(4, 0.44, o); return [{ geo: mergeGeos(o), mat: M.furnWood }]; };
  D['pallet:load'] = () => {
    const o = [], load = []; stack(1, -0.44, o); stack(1, 0.44, o);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 3; k++) load.push([bx(0.57, 0.24, 0.38, -0.29 + i * 0.58, 0.145 + k * 0.245, -0.63 + j * 0.39), new THREE.Color('#b8925e').multiplyScalar(0.85 + rnd() * 0.25)]);
    for (const x of [-0.3, 0.3]) load.push([bx(0.03, 0.75, 0.8, x, 0.14, -0.44), '#3a3a3a'], [bx(0.03, 0.02, 0.8, x, 0.89, -0.44), '#3a3a3a']);
    load.push([bx(1.16, 0.02, 0.78, 0, 0.88, -0.44), '#d8d4c8']);
    for (let k = 0; k < 4; k++) for (let i = 0; i < 2; i++) { const g = new THREE.SphereGeometry(0.5, 8, 5), p = g.attributes.position; for (let q = 0; q < p.count; q++) p.setY(q, Math.max(-0.35, Math.min(0.35, p.getY(q)))); load.push([g.scale(0.58, 0.18, 0.4).rotateY(k % 2 ? Math.PI / 2 : 0).translate(k % 2 ? -0.22 + i * 0.44 : 0, 0.205 + k * 0.125, 0.44 + (k % 2 ? 0 : -0.2 + i * 0.4)), new THREE.Color('#cfccc2').multiplyScalar(0.9 + rnd() * 0.12)]); }
    return [{ geo: mergeGeos(o), mat: M.furnWood }, { geo: mergeGeos(load), mat: M.decoVC }];
  };
  // ===== Fässer (200 l): Mantel, Rollsicken, Falz, Deckel mit Spunden =====
  const drum = (x, z, ry, sh, lying = false) => {
    const band = (y0) => [0, y0, 1, y0 + 0.02];
    const l = [new THREE.CylinderGeometry(0.29, 0.29, 0.86, 16, 1, true).translate(0, 0.44, 0)];
    for (const y of [0.29, 0.59]) l.push(uvRect(new THREE.CylinderGeometry(0.297, 0.297, 0.035, 16, 1, true).translate(0, y, 0), band(0.32)));
    l.push(uvRect(new THREE.CylinderGeometry(0.296, 0.29, 0.03, 16, 1, true).translate(0, 0.86, 0), band(0.95)), uvRect(new THREE.CylinderGeometry(0.29, 0.296, 0.03, 16, 1, true), band(0.02)));
    l.push(uvRect(new THREE.CircleGeometry(0.288, 16).rotateX(-Math.PI / 2).translate(0, 0.875, 0), [0.9, 0.45, 0.98, 0.55]), uvRect(new THREE.CircleGeometry(0.288, 16).rotateX(Math.PI / 2).translate(0, 0.01, 0), [0.9, 0.45, 0.98, 0.55]));
    l.push(uvRect(cyl(0.035, 0.035, 0.02, 8, 0.15, 0.87, 0.05), band(0.5)), uvRect(cyl(0.025, 0.025, 0.02, 8, -0.16, 0.87, -0.04), band(0.5)));
    return l.map((g) => { g.rotateY(ry); if (lying) g.rotateZ(Math.PI / 2).translate(0.44, 0.29, 0); return [g.translate(x, 0, z), [sh, sh, sh]]; });
  };
  D.barrel = () => [{ geo: mergeGeos([...drum(-0.36, -0.3, rnd() * 6, 1), ...drum(0.3, -0.38, rnd() * 6, 0.85), ...drum(-0.05, 0.27, rnd() * 6, 0.95), ...drum(0.0, 0.62, 0.3, 0.8, true)]), mat: W.drum() }];
  D.fuelbarrel = () => [{ geo: mergeGeos([...drum(-0.33, -0.25, 1.2, 1), ...drum(0.33, -0.2, 2.6, 0.9), ...drum(0, 0.36, 4.4, 0.95)]), mat: W.fuelDrum() }];
  // ===== Zapfsäule auf Tankinsel: Gehäuse mit Anzeige (leuchtend), Schläuche, Rammschutz =====
  D.fuelpump = () => {
    const Fp = pxRect(4, 0, 124, 256), Pp = pxRect(140, 10, 250, 180);
    const body = [[uvRect(bx(1.9, 0.16, 0.95), Pp), '#c8c6c0'], [uvRect(bx(0.25, 0.17, 0.97, -0.84), Pp), '#e0b020'], [uvRect(bx(0.25, 0.17, 0.97, 0.84), Pp), '#e0b020'],
      [boxUV(0.9, 1.4, 0.46, 0, 0.18, 0, [null, null, null, null, Fp, Fp], Pp), '#ffffff'], [uvRect(bx(0.94, 0.06, 0.5, 0, 0.16), Pp), '#5a5a5a'], [uvRect(bx(0.98, 0.1, 0.54, 0, 1.58), Pp), '#c42a1e'], [uvRect(bx(0.1, 1.3, 0.3, 0, 0.25, 0), Pp), '#d8d8d8']];
    const dark = [];
    for (const s of [-1, 1]) {
      const c = new THREE.CatmullRomCurve3([[0.43, 1.3, 0.12], [0.6, 1.0, 0.2], [0.66, 0.5, 0.26], [0.58, 0.32, 0.12], [0.5, 0.86, 0.07]].map(([x, y, z]) => new THREE.Vector3(s * x, y, z)));
      dark.push([new THREE.TubeGeometry(c, 20, 0.022, 5), '#161616'], [bx(0.06, 0.26, 0.16, s * 0.475, 0.78, 0.05), '#3a3a3a'], [bx(0.06, 0.2, 0.11, s * 0.5, 0.86, 0.06), s > 0 ? '#2a8a3a' : '#1c1c1c']);
      dark.push([cyl(0.07, 0.07, 0.95, 10, s * 0.84, 0.16, 0), '#d8b020'], [cyl(0.073, 0.073, 0.1, 10, s * 0.84, 0.66, 0), '#141414'], [cyl(0.073, 0.073, 0.1, 10, s * 0.84, 0.86, 0), '#141414']);
    }
    return [{ geo: mergeGeos(body), mat: W.pump() }, { geo: mergeGeos(dark), mat: M.carDark, shadow: false }];
  };
  // ===== Fahrzeug-Baukasten (Bus, Lkw): Lack (Instanzfarbe) + Detailatlas =====
  const VR = (k) => pxRect(...VEH[k]);
  const vb = (k, w, h, d, x, y, z, col = '#ffffff') => [uvRect(bx(w, h, d, x, y, z), VR(k)), col];
  const vWheel = (x, z, r, w) => [[uvRect(new THREE.CylinderGeometry(r, r, w, 16).rotateZ(Math.PI / 2).translate(x, r, z), VR('tire')), '#ffffff'], [uvRect(new THREE.CylinderGeometry(r * 0.58, r * 0.58, w + 0.02, 14).rotateZ(Math.PI / 2).translate(x, r, z), VR('rim')), '#ffffff']];
  const shift = (parts, dz) => parts.map(([g, c]) => [g.clone().translate(0, 0, dz), c]);
  const vehOut = (paint, det) => [{ geo: mergeGeos(paint), mat: W.vehPaint(), paint: true }, { geo: mergeGeos(det), mat: W.veh() }];
  // Bus (Reise-/Linienbus), Segment 2 m: vorne mit Frontscheibe/Tür/Vorderachse, Mitte, hinten mit Motor/Heckachse
  const busSeg = (role) => {
    const Wb = 2.4, hw = Wb / 2, yb = 0.32, belt = 1.12, wt = 2.48, roof = 2.98, r = 0.48;
    const zF = role === 'front' ? 0.98 : 1.0, zR = role === 'rear' ? -0.98 : -1.0, wheels = role === 'front' ? [-0.35] : role === 'rear' ? [0.25] : [];
    const paint = [[sideProfile([...archLine(zF, zR, yb, wheels, r + 0.07), [zR, belt], [zF, belt]], Wb, 0.03), '#ffffff'], [bx(Wb, roof - wt - 0.07, zF - zR, 0, wt, (zF + zR) / 2), '#ffffff'], [bx(Wb - 0.16, 0.07, zF - zR, 0, roof - 0.07, (zF + zR) / 2), '#ffffff']];
    const det = [];
    for (const z0 of [zR, (zF + zR) / 2]) det.push(vb('win', Wb - 0.04, wt - belt, (zF - zR) / 2, 0, belt, z0 + (zF - zR) / 4));
    det.push(vb('plain', Wb + 0.012, 0.1, zF - zR, 0, 0.95, (zF + zR) / 2, '#f4f4f2'), vb('black', Wb + 0.01, 0.1, zF - zR, 0, yb, (zF + zR) / 2));
    for (const wz of wheels) for (const s of [-1, 1]) det.push(...vWheel(s * (hw - 0.2), wz, r, 0.32));
    if (role === 'front') {
      det.push(vb('glass', Wb - 0.12, wt - belt + 0.3, 0.04, 0, belt - 0.2, 0.975), vb('sign', Wb - 0.4, 0.26, 0.03, 0, 2.6, 0.99), vb('black', Wb + 0.04, 0.26, 0.14, 0, 0.28, 0.97));
      for (const s of [-1, 1]) det.push(vb('head', 0.34, 0.16, 0.03, s * 0.82, 0.62, 0.99), vb('amber', 0.12, 0.12, 0.03, s * 1.08, 0.64, 0.99), vb('black', 0.05, 0.05, 0.4, s * 1.22, 2.2, 1.1), vb('black', 0.08, 0.34, 0.14, s * 1.42, 1.85, 1.28), [beam([s * 1.2, 2.25, 0.95], [s * 1.42, 2.15, 1.28], 0.04), '#202020']);
      det.push(vb('grille', 0.9, 0.18, 0.03, 0, 0.42, 0.99), vb('plate', 0.52, 0.12, 0.02, 0, 0.32, 1.05), vb('door', 0.02, wt - 0.4, 0.86, -(hw + 0.012), 0.4, 0.45));
      det.push(vb('black', Wb - 0.1, 0.04, 0.05, 0, belt - 0.22, 0.99));
    }
    if (role === 'rear') {
      det.push(vb('glass', Wb - 0.3, 0.9, 0.03, 0, 1.5, -0.985), vb('vent', Wb - 0.5, 0.6, 0.03, 0, 0.55, -0.99), vb('black', Wb + 0.04, 0.24, 0.12, 0, 0.26, -0.98), vb('plate', 0.52, 0.12, 0.02, 0, 0.3, -1.05));
      for (const s of [-1, 1]) det.push(vb('tail', 0.14, 0.7, 0.03, s * 1.08, 0.6, -0.99));
    }
    if (role === 'mid') det.push(vb('plain', 1.1, 0.22, 1.2, 0, roof, 0, '#c8cacc'));
    return [paint, det];
  };
  // Lkw/Sattelzug, Segment 2 m: Fahrerhaus (vorne), Auflieger-Mitte, Auflieger-Heck mit Türen und Doppelachse
  const truckSeg = (role) => {
    const Wt = 2.45, hw = Wt / 2, r = 0.5, paint = [], det = [];
    det.push(vb('black', 0.14, 0.24, 2.0, -0.45, 0.6, 0), vb('black', 0.14, 0.24, 2.0, 0.45, 0.6, 0));
    if (role === 'front') {
      paint.push([sideProfile([...archLine(0.98, -0.3, 0.72, [0.32], r + 0.07), [-0.3, 3.08], [0.62, 3.08], [0.86, 2.95], [0.95, 2.2], [0.98, 1.0]], Wt - 0.05, 0.05), '#ffffff']);
      det.push(vb('glass', Wt - 0.3, 0.9, 0.04, 0, 1.85, 0.965), vb('grille', 1.5, 0.62, 0.03, 0, 1.05, 0.99), vb('black', Wt + 0.04, 0.4, 0.16, 0, 0.4, 0.96), vb('plate', 0.52, 0.12, 0.02, 0, 0.55, 1.05));
      for (const s of [-1, 1]) {
        det.push(vb('glass', 0.02, 0.75, 0.55, s * (hw - 0.01), 1.95, 0.5), vb('head', 0.36, 0.16, 0.03, s * 0.86, 0.6, 1.05), vb('amber', 0.12, 0.12, 0.03, s * 1.12, 0.6, 1.05), vb('black', 0.4, 0.05, 0.35, s * (hw - 0.15), 0.55, 0.5), vb('black', 0.4, 0.05, 0.35, s * (hw - 0.15), 0.85, 0.5));
        det.push(vb('black', 0.08, 0.36, 0.14, s * 1.45, 1.95, 0.95), [beam([s * 1.2, 2.3, 0.8], [s * 1.45, 2.2, 0.95], 0.04), '#202020'], vb('chrome', 0.03, 0.03, 0.2, s * (hw + 0.01), 1.6, 0.0));
        det.push(...vWheel(s * (hw - 0.22), 0.32, r, 0.32), ...vWheel(s * (hw - 0.3), -0.65, r, 0.5), [new THREE.CylinderGeometry(r + 0.08, r + 0.08, 0.55, 10, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI / 2).translate(s * (hw - 0.3), r, -0.65), '#202020']);
      }
      det.push(vb('black', 1.2, 0.1, 0.9, 0, 0.82, -0.65), [rod([hw - 0.18, 0.9, -0.38], [hw - 0.18, 3.25, -0.38], 0.06, 0.06, 8), '#c8ccd0'], vb('chrome', Wt - 0.2, 0.06, 0.06, 0, 2.86, 0.88));
      det.forEach((d) => { if (d[0].attributes.uv && d[1] === '#c8ccd0') uvRect(d[0], VR('chrome')); });
    } else {
      const z0 = role === 'rear' ? -0.98 : -1.0, len = 1.0 - z0;
      paint.push([bx(Wt, 2.0, len, 0, 1.2, (1.0 + z0) / 2), '#ffffff']);
      det.push(vb('black', Wt - 0.2, 0.25, len, 0, 0.95, (1.0 + z0) / 2));
      for (const s of [-1, 1]) det.push(vb('plain', 0.04, 0.12, len, s * (hw + 0.01), 1.2, (1.0 + z0) / 2, '#9aa0a6'), vb('plain', 0.04, 0.1, len, s * (hw + 0.01), 3.1, (1.0 + z0) / 2, '#9aa0a6'));
      for (let z = z0 + 0.25; z < 1; z += 0.5) for (const s of [-1, 1]) det.push(vb('plain', 0.02, 1.9, 0.05, s * (hw + 0.01), 1.25, z, '#b8bcc0'));
      if (role === 'mid') for (const s of [-1, 1]) det.push(vb('plain', 0.04, 0.07, len, s * (hw - 0.05), 0.55, (1.0 + z0) / 2, '#8a8e92'), vb('plain', 0.04, 0.07, len, s * (hw - 0.05), 0.8, (1.0 + z0) / 2, '#8a8e92'));
      if (role === 'rear') {
        for (const s of [-1, 1]) { for (const wz of [0.3, -0.38]) det.push(...vWheel(s * (hw - 0.3), wz, r, 0.5)); det.push(vb('tail', 0.3, 0.16, 0.03, s * 0.95, 0.78, -1.0), vb('black', 0.4, 0.4, 0.02, s * (hw - 0.3), 0.15, -0.72)); }
        det.push(vb('black', 0.02, 1.9, 0.03, 0, 1.25, -0.995), vb('black', Wt - 0.4, 0.14, 0.1, 0, 0.42, -0.98), vb('plate', 0.52, 0.12, 0.02, 0, 0.62, -1.0));
        for (const x of [-0.85, -0.3, 0.3, 0.85]) det.push(vb('chrome', 0.04, 1.85, 0.04, x, 1.27, -1.0));
      }
    }
    return [paint, det];
  };
  for (const [name, seg] of [['bus', busSeg], ['truck', truckSeg]]) {
    for (const r of ['front', 'mid', 'rear']) D[name + ':' + r] = () => vehOut(...seg(r));
    D[name + ':single'] = () => { const [p1, d1] = seg('front'), [p2, d2] = seg('rear'); return vehOut([...shift(p1, 1), ...shift(p2, -1)], [...shift(d1, 1), ...shift(d2, -1)]); };
  }
  // ===== Ausgebranntes Militärfahrzeug (Schützenpanzer): Wanne, Laufwerk, verdrehter Turm, hängendes Rohr, Trümmer =====
  D.milwreck = () => {
    const rust = '#9a5230', soot = '#3a322c', ash = '#8a8278', olive = '#6e6c52', l = [];
    l.push([sideProfile([[2.05, 0.55], [2.1, 1.0], [1.3, 1.58], [-1.9, 1.6], [-2.05, 1.4], [-2.05, 0.55]], 2.1, 0.04), olive]);
    for (const s of [-1, 1]) {
      l.push([bx(0.48, 0.06, 3.6, s * 1.08, 0.86, 0), soot], [bx(0.48, 0.06, 3.3, s * 1.08, 0.0, 0.0), soot]);
      for (const z of [-1.4, -0.7, 0, 0.7, 1.4]) l.push([new THREE.CylinderGeometry(0.33, 0.33, 0.4, 12).rotateZ(Math.PI / 2).translate(s * 1.08, 0.38, z), z === 0 && s > 0 ? rust : soot]);
      for (const z of [-1.82, 1.82]) l.push([new THREE.CylinderGeometry(0.27, 0.27, 0.42, 10).rotateZ(Math.PI / 2).translate(s * 1.08, 0.56, z), soot]);
    }
    l.push([bx(0.05, 0.42, 2.2, 1.34, 0.6, -0.6), rust], [bx(0.05, 0.42, 1.2, -1.34, 0.62, 0.5).rotateX(0.12), ash]);
    const tur = sideProfile([[0.85, 0], [0.92, 0.28], [0.6, 0.52], [-0.8, 0.52], [-0.9, 0.24], [-0.85, 0]], 1.4, 0.03).rotateY(0.45).translate(0, 1.6, -0.25);
    l.push([tur, ash], [rod([0.3, 1.95, 0.45], [0.95, 1.5, 2.25], 0.085, 0.065, 8), soot], [bx(0.55, 0.04, 0.5, 0, 0, 0).rotateZ(-1.1).translate(-0.35, 2.32, -0.4), rust]);
    for (const [x, y, z, w, h, d] of [[1.06, 1.0, 0.6, 0.02, 0.35, 0.5], [-1.06, 1.1, -0.8, 0.02, 0.3, 0.6], [0.2, 1.61, 0.4, 0.6, 0.01, 0.5]]) l.push([bx(w, h, d, x, y, z), '#0a0807']);
    l.push([bx(0.45, 0.05, 1.5, 0, 0, 0).rotateY(0.3).translate(-1.6, 0.02, 1.7), soot]);
    for (let i = 0; i < 7; i++) { const a = rnd() * 6.28, r = 2.0 + rnd() * 0.6; l.push([bx(0.2 + rnd() * 0.4, 0.03, 0.15 + rnd() * 0.3).rotateY(rnd() * 3).rotateX((rnd() - 0.5) * 0.5).translate(Math.cos(a) * r * 0.6, 0.02, Math.sin(a) * r), rnd() < 0.5 ? rust : soot]); }
    return [{ geo: mergeGeos(l), mat: W.wreck() }];
  };
  // ===== Ziehbrunnen: Steinkranz, Holzgestell mit Dach, Haspel, Seil, Eimer, Wasserspiegel =====
  D.well = () => {
    const ring = scaleUV(new THREE.LatheGeometry(v2([[0.82, 0], [0.82, 0.8], [0.8, 0.86], [0.6, 0.86], [0.56, 0.8], [0.56, 0.2]]), 16), 3, 0.35);
    const w = '#7a5634', l = [[new THREE.CircleGeometry(0.57, 16).rotateX(-Math.PI / 2).translate(0, 0.32, 0), '#0f1c22']];
    for (const s of [-1, 1]) l.push([bx(0.1, 1.55, 0.1, s * 0.69, 0.8, 0), '#6b4a2e'], [bx(0.08, 0.08, 0.6, s * 0.69, 2.2, 0), '#6b4a2e']);
    l.push([rod([-0.75, 1.55, 0], [0.75, 1.55, 0], 0.055, 0.055, 8), w], [rod([-0.12, 1.55, 0], [0.18, 1.55, 0], 0.085, 0.085, 8), '#b8a070'], [rod([0.75, 1.55, 0], [0.9, 1.55, 0], 0.02), '#3a3a3a'], [rod([0.9, 1.55, 0], [0.9, 1.33, 0], 0.02), '#3a3a3a'], [rod([0.9, 1.33, 0], [0.9, 1.33, 0.15], 0.025), w]);
    l.push([rod([0.05, 1.5, 0], [0.05, 1.1, 0], 0.012, 0.012, 4), '#b8a070'], [cyl(0.12, 0.095, 0.2, 10, 0.05, 0.9, 0), '#80858a'], [new THREE.TorusGeometry(0.1, 0.008, 4, 10, Math.PI).translate(0.05, 1.1, 0), '#3a3a3a']);
    for (const s of [-1, 1]) l.push([bx(1.85, 0.04, 0.78).rotateX(s * 0.62).translate(0, 2.25, s * 0.3), '#5a3a26']);
    l.push([bx(1.9, 0.08, 0.08, 0, 2.47, 0), '#4a3020']);
    return [{ geo: mergeGeos([ring]), mat: W.stone() }, { geo: mergeGeos(l), mat: M.furnWood }];
  };
  // ===== Springbrunnen: achteckiges Becken, Säule mit Schale, Wasserspiegel und Strahlen =====
  D.fountain = () => {
    const basin = new THREE.LatheGeometry(v2([[0.001, 0.2], [0.8, 0.2], [0.8, 0.5], [0.83, 0.56], [0.98, 0.56], [1.0, 0.5], [0.97, 0.06], [1.02, 0]]), 8).rotateY(Math.PI / 8);
    const col = new THREE.LatheGeometry(v2([[0.001, 0.2], [0.24, 0.2], [0.24, 0.3], [0.17, 0.36], [0.13, 0.85], [0.18, 0.92], [0.46, 0.98], [0.48, 1.04], [0.4, 1.06], [0.12, 1.02], [0.09, 1.2], [0.12, 1.24], [0.06, 1.3], [0.08, 1.38], [0.001, 1.46]]), 16);
    const water = [new THREE.CircleGeometry(0.8, 8).rotateX(-Math.PI / 2).rotateY(Math.PI / 8).translate(0, 0.45, 0), new THREE.CircleGeometry(0.4, 16).rotateX(-Math.PI / 2).translate(0, 1.03, 0), rod([0, 1.44, 0], [0, 1.7, 0], 0.025, 0.01, 6)];
    for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.28, c = Math.cos(a), s = Math.sin(a); water.push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0.46 * c, 1.04, 0.46 * s), new THREE.Vector3(0.6 * c, 1.08, 0.6 * s), new THREE.Vector3(0.68 * c, 0.46, 0.68 * s)), 8, 0.018, 4)); }
    return [{ geo: mergeGeos([basin, col]), mat: W.ashlar() }, { geo: mergeGeos(water), mat: W.pool(), shadow: false }];
  };
  // ===== Grabsteine (Variante = Form): 0 Rundbogen-Stein, 1 Kreuz, 2 liegende Platte, 3 alter schiefer Stein =====
  const GI = pxRect(4, 4, 124, 252), GP = pxRect(150, 20, 240, 240);
  const plot = () => [[uvRect(bx(0.08, 0.1, 1.75, -0.44, 0, 0.1), GP), '#cfcfca'], [uvRect(bx(0.08, 0.1, 1.75, 0.44, 0, 0.1), GP), '#cfcfca'], [uvRect(bx(0.96, 0.1, 0.08, 0, 0, 0.94), GP), '#cfcfca'], [uvRect(bx(0.8, 0.05, 1.6, 0, 0, 0.12), GP), '#4a3a2a'], [uvRect(bx(0.09, 0.17, 0.09, 0.25, 0.05, 0.75), GP), '#8a1a14']];
  D['gravestone:0'] = () => {
    const s = new THREE.Shape(); s.moveTo(-0.3, 0); s.lineTo(0.3, 0); s.lineTo(0.3, 0.6); s.absarc(0, 0.6, 0.3, 0, Math.PI, false); s.lineTo(-0.3, 0);
    const g = projUV(new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 1, curveSegments: 10 }).translate(0, 0.15, -0.8), -0.3, 0.3, 0.15, 1.05, GI, GP);
    return [{ geo: mergeGeos([[g, '#ffffff'], [uvRect(bx(0.75, 0.15, 0.32, 0, 0, -0.74), GP), '#e8e8e4'], ...plot()]), mat: W.grave() }];
  };
  D['gravestone:1'] = () => [{ geo: mergeGeos([[uvRect(bx(0.5, 0.12, 0.3, 0, 0, -0.74), GP), '#e8e8e4'], [uvRect(bx(0.36, 0.1, 0.22, 0, 0.12, -0.74), GP), '#f0f0ec'], [uvRect(bx(0.11, 0.85, 0.1, 0, 0.22, -0.74), GP), '#ffffff'], [uvRect(bx(0.5, 0.1, 0.1, 0, 0.78, -0.74), GP), '#ffffff'], ...plot()]), mat: W.grave() }];
  D['gravestone:2'] = () => {
    const slab = boxUV(0.78, 0.1, 1.5, 0, 0.05, 0.12, [null, null, pxRect(4, 60, 124, 200)], GP);
    return [{ geo: mergeGeos([[slab, '#ffffff'], [projUV(bx(0.6, 0.45, 0.14, 0, 0, -0.78), -0.3, 0.3, 0, 0.45, pxRect(4, 4, 124, 120), GP), '#f4f4f0'], ...plot().slice(0, 3)]), mat: W.grave() }];
  };
  D['gravestone:3'] = () => {
    const s = new THREE.Shape(); s.moveTo(-0.24, 0); s.lineTo(0.24, 0); s.lineTo(0.24, 0.62); s.lineTo(0, 0.82); s.lineTo(-0.24, 0.62); s.lineTo(-0.24, 0);
    const g = projUV(new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: false }), -0.24, 0.24, 0, 0.82, GI, GP).rotateX(-0.2).rotateZ(0.08).translate(0, 0, -0.7);
    return [{ geo: mergeGeos([[g, '#a8b09a'], [uvRect(blob(0.5, 0, 0, 0.1, 0.9, 0.22, 1.5, 0.15), GP), '#5a7040']]), mat: W.grave() }];
  };
  // ===== Denkmal: Stufensockel aus Sandstein, Bronzefigur mit erhobenem Arm, Tafel =====
  D.statue = () => {
    const ped = [bx(1.8, 0.22, 1.8), bx(1.5, 0.22, 1.5, 0, 0.22), bx(1.05, 1.0, 1.05, 0, 0.44), bx(1.2, 0.14, 1.2, 0, 1.44), bx(1.12, 0.06, 1.12, 0, 1.58)].map((g) => [g, '#ffffff']);
    const y = 1.64, b = [bx(0.7, 0.08, 0.6, 0, y), bx(0.5, 0.3, 0.02, 0, 0.75, 0.53)];
    b.push(rod([-0.12, y + 0.08, -0.05], [-0.11, y + 0.95, 0], 0.085, 0.1, 8), rod([0.12, y + 0.08, 0.12], [0.11, y + 0.95, 0], 0.085, 0.1, 8));
    b.push(bx(0.14, 0.08, 0.26, -0.12, y + 0.08, 0.0), bx(0.14, 0.08, 0.26, 0.12, y + 0.08, 0.17));
    b.push(new THREE.LatheGeometry(v2([[0.36, 0], [0.31, 0.4], [0.25, 0.85], [0.001, 0.86]]), 14).scale(1, 1, 0.75).translate(0, y + 0.45, 0));
    b.push(new THREE.CylinderGeometry(0.21, 0.25, 0.5, 12).scale(1, 1, 0.75).translate(0, y + 1.32, 0), ball(0.3, 0, y + 1.6, 0, 12, 8).scale(1, 0.4, 0.58).translate(0, (y + 1.6) * 0.6, 0));
    b.push(cyl(0.06, 0.07, 0.12, 8, 0, y + 1.66, 0), ball(0.12, 0, y + 1.86, 0.01, 12, 10), cyl(0.125, 0.13, 0.06, 12, 0, y + 1.9, 0));
    b.push(rod([0.27, y + 1.58, 0], [0.38, y + 1.75, 0.3], 0.065, 0.055, 8), rod([0.38, y + 1.75, 0.3], [0.43, y + 2.02, 0.6], 0.055, 0.045, 8), ball(0.055, 0.44, y + 2.06, 0.63, 8, 6));
    b.push(rod([-0.27, y + 1.58, 0], [-0.32, y + 1.22, 0.06], 0.065, 0.055, 8), rod([-0.32, y + 1.22, 0.06], [-0.3, y + 0.98, 0.18], 0.055, 0.045, 8), bx(0.2, 0.26, 0.05, -0.3, y + 0.88, 0.22));
    b.push(new THREE.CylinderGeometry(0.3, 0.44, 1.15, 12, 1, true, Math.PI * 0.55, Math.PI * 0.9).translate(0, y + 1.1, -0.04));
    return [{ geo: mergeGeos(ped), mat: W.ashlar() }, { geo: mergeGeos(b), mat: W.bronze() }];
  };
  // ===== Strommast: Gitterturm mit Eckstielen, Riegeln, Kreuzverbänden, Traverse, Isolatoren, Fundamenten =====
  D.pylon = () => {
    const S = [], st = '#a9afb3', lv = [0, 0.4, 1.9, 3.3, 4.6, 5.8, 7.0], wd = (h) => 0.85 - (0.53 * h) / 7.0, cn = (sx, sz, h) => [sx * wd(h), h, sz * wd(h)];
    const cs = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
    for (const [sx, sz] of cs) { for (let i = 0; i < lv.length - 1; i++) S.push([beam(cn(sx, sz, lv[i]), cn(sx, sz, lv[i + 1]), 0.09), st]); S.push([bx(0.55, 0.35, 0.55, sx * 0.85, -0.12, sz * 0.85), '#9a9890'], [beam(cn(sx, sz, 7.0), [0, 8.2, 0], 0.06), st]); }
    for (let f = 0; f < 4; f++) {
      const a = cs[f], b2 = cs[(f + 1) % 4];
      for (let i = 1; i < lv.length; i++) { S.push([beam(cn(...a, lv[i]), cn(...b2, lv[i]), 0.06), st], [beam(cn(...a, lv[i - 1]), cn(...b2, lv[i]), 0.045), st], [beam(cn(...b2, lv[i - 1]), cn(...a, lv[i]), 0.045), st]); }
    }
    for (const s of [-1, 1]) {
      S.push([beam([s * 0.32, 6.7, 0.25], [s * 2.4, 6.75, 0], 0.07), st], [beam([s * 0.32, 6.7, -0.25], [s * 2.4, 6.75, 0], 0.07), st], [beam([s * 0.32, 7.0, 0], [s * 2.4, 6.8, 0], 0.07), st]);
      for (let k = 0; k < 7; k++) S.push([cyl(0.11, 0.11, 0.045, 10, s * 2.25, 6.0 + k * 0.1, 0), '#6a4a3a']);
      S.push([rod([s * 2.25, 6.0, 0], [s * 2.25, 6.72, 0], 0.015), '#888888'], [rod([s * 2.25, 5.95, -0.7], [s * 2.25, 5.95, 0.7], 0.022), '#3a3a3a']);
    }
    S.push([bx(0.32, 0.28, 0.012, 0, 1.55, wd(1.6) + 0.02), '#e8c020'], [bx(0.16, 0.14, 0.014, 0, 1.6, wd(1.6) + 0.025), '#111111']);
    return [{ geo: mergeGeos(S), mat: W.steel() }];
  };
  // ===== Wasserturm/Tank auf Stelzen: Beine mit Kreuzverband, Umgang mit Geländer, Leiter, Tank mit Kegeldach =====
  D.watertank = () => {
    const S = [], st = '#8a9096', top = 2.25, legs = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
    for (const [sx, sz] of legs) S.push([rod([sx * 0.85, 0, sz * 0.85], [sx * 0.62, top, sz * 0.62], 0.07, 0.06, 8), st], [bx(0.3, 0.12, 0.3, sx * 0.85, 0, sz * 0.85), '#9a9890']);
    for (let f = 0; f < 4; f++) {
      const [ax, az] = legs[f], [bx2, bz] = legs[(f + 1) % 4], P = (sx, sz, h) => [sx * (0.85 - 0.23 * (h / top)), h, sz * (0.85 - 0.23 * (h / top))];
      S.push([rod(P(ax, az, 0.2), P(bx2, bz, 1.2), 0.02), st], [rod(P(bx2, bz, 0.2), P(ax, az, 1.2), 0.02), st], [rod(P(ax, az, 1.2), P(bx2, bz, 2.2), 0.02), st], [rod(P(bx2, bz, 1.2), P(ax, az, 2.2), 0.02), st], [rod(P(ax, az, 1.2), P(bx2, bz, 1.2), 0.025), st]);
    }
    S.push([cyl(1.18, 1.18, 0.06, 24, 0, top), '#6a6e72'], [new THREE.TorusGeometry(1.15, 0.02, 4, 28).rotateX(Math.PI / 2).translate(0, top + 0.95, 0), st]);
    for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.28; S.push([rod([Math.cos(a) * 1.15, top, Math.sin(a) * 1.15], [Math.cos(a) * 1.15, top + 0.95, Math.sin(a) * 1.15], 0.015, 0.015, 4), st]); }
    for (const x of [-0.2, 0.2]) S.push([rod([x, 0, 1.2], [x, top + 0.95, 1.2], 0.02, 0.02, 5), st]);
    for (let y = 0.3; y < top + 0.9; y += 0.3) S.push([rod([-0.2, y, 1.2], [0.2, y, 1.2], 0.012, 0.012, 4), st]);
    const tank = [scaleUV(new THREE.CylinderGeometry(0.98, 0.98, 1.5, 24, 1, true).translate(0, top + 0.06 + 0.75, 0), 3, 1), uvRect(new THREE.ConeGeometry(1.03, 0.45, 24, 1, true).translate(0, top + 1.56 + 0.225, 0), [0, 0.05, 3, 0.3]), new THREE.TorusGeometry(0.99, 0.03, 4, 24).rotateX(Math.PI / 2).translate(0, top + 1.56, 0), cyl(0.06, 0.06, 0.15, 8, 0, top + 1.98), ball(0.08, 0, top + 2.16, 0, 8, 6)];
    return [{ geo: mergeGeos(tank), mat: W.tank() }, { geo: mergeGeos(S), mat: W.steel() }];
  };
  // ===== Getreidesilo: gewellter Zylinder mit Versteifungsringen, Kegeldach mit Lüfter, Leiter mit Rückenschutz =====
  D.silo = () => {
    const body = [scaleUV(new THREE.CylinderGeometry(0.97, 0.97, 6.4, 24, 1, true).translate(0, 3.55, 0), 4, 5), scaleUV(new THREE.ConeGeometry(1.01, 1.2, 24, 1, true).translate(0, 7.35, 0), 4, 1), new THREE.TorusGeometry(0.99, 0.04, 4, 24).rotateX(Math.PI / 2).translate(0, 6.75, 0)];
    for (const y of [1.6, 3.2, 4.8]) body.push(new THREE.TorusGeometry(0.98, 0.025, 4, 24).rotateX(Math.PI / 2).translate(0, y, 0));
    body.push(cyl(0.16, 0.16, 0.25, 10, 0, 7.7), new THREE.ConeGeometry(0.25, 0.16, 10).translate(0, 8.03, 0));
    const S = [[cyl(1.05, 1.08, 0.35, 24), '#9a9890'], [bx(0.55, 0.6, 0.06, 0, 0.35, 0.97), '#7a7e82']], st = '#9aa0a6';
    for (const x of [-0.2, 0.2]) S.push([rod([x, 0.35, 1.04], [x, 7.0, 1.04], 0.02, 0.02, 5), st]);
    for (let y = 0.6; y < 7; y += 0.3) S.push([rod([-0.2, y, 1.04], [0.2, y, 1.04], 0.012, 0.012, 4), st]);
    for (let y = 2.4; y < 7; y += 0.75) S.push([new THREE.TorusGeometry(0.36, 0.015, 4, 12, Math.PI).rotateX(Math.PI / 2).translate(0, y, 1.04), st]);
    for (const a of [0.15, 0.85, 1.57, 2.29, 3.0]) S.push([rod([Math.cos(a) * 0.36, 2.4, 1.04 + Math.sin(a) * 0.36], [Math.cos(a) * 0.36, 6.9, 1.04 + Math.sin(a) * 0.36], 0.012, 0.012, 4), st]);
    return [{ geo: mergeGeos(body), mat: W.silo() }, { geo: mergeGeos(S), mat: W.steel(), shadow: false }];
  };
  // ===== Baugerüst (ein Feld, entlang x): Ständer, Riegel, Diagonale, Bohlenbeläge, Bordbretter =====
  D.scaffold = () => {
    const st = '#aeb4b8', S = [], P = [], tube = (a, b) => S.push([rod(a, b, 0.024, 0.024, 6, true), st]);
    for (const x of [-0.97, 0.97]) for (const z of [-0.38, 0.38]) { tube([x, 0.04, z], [x, 3.25, z]); S.push([bx(0.15, 0.04, 0.15, x, 0, z), '#5a5e62']); }
    for (const y of [0.2, 1.0, 2.0, 3.0]) { for (const z of [-0.38, 0.38]) tube([-1.0, y, z], [1.0, y, z]); for (const x of [-0.97, 0.97]) tube([x, y, -0.44], [x, y, 0.44]); }
    for (const y of [1.5, 2.5, 3.5]) tube([-1.0, y, 0.4], [1.0, y, 0.4]);
    for (const x of [-0.97, 0.97]) tube([x, 3.0, 0.38], [x, 3.55, 0.38]);
    tube([-0.97, 0.2, 0.43], [0.97, 2.0, 0.43]); tube([0.97, 2.0, 0.43], [-0.97, 3.0, 0.43]);
    for (const y of [1.0, 2.0, 3.0]) { for (let i = 0; i < 4; i++) P.push([bx(2.0, 0.04, 0.18, (rnd() - 0.5) * 0.06, y + 0.025, -0.28 + i * 0.19), ['#c4a878', '#a8895a', '#b89a6a'][(rnd() * 3) | 0]]); P.push([bx(2.0, 0.15, 0.03, 0, y + 0.065, 0.415), '#9a7a48']); }
    return [{ geo: mergeGeos(S), mat: W.steel() }, { geo: mergeGeos(P), mat: M.furnWood }];
  };
  // ===== Zelte (Variante = Form): Kuppelzelt mit Gestänge/Apsis, Firstzelt =====
  D['tent:dome'] = () => {
    const sh = new THREE.SphereGeometry(1, 18, 7, 0, Math.PI * 2, 0, Math.PI / 2), p = sh.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), f = 1 - 0.07 * (0.5 - 0.5 * Math.cos(4 * (Math.atan2(z, x) - Math.PI / 4))); p.setXYZ(i, x * f, p.getY(i) * (0.97 + 0.03 * f), z * f); }
    sh.computeVertexNormals(); sh.scale(1.05, 1.25, 0.8);
    const l = [[sh, '#ffffff'], [new THREE.SphereGeometry(0.6, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.9, 1.45, 0.75).translate(0, 0, 0.6), '#e8e8e8']];
    l.push([new THREE.CircleGeometry(0.32, 12, 0, Math.PI).scale(1, 1.7, 1).rotateX(-0.42).translate(0, 0.02, 1.02), '#3a3a3a']);
    for (const s of [-1, 1]) l.push([new THREE.TorusGeometry(1.0, 0.016, 4, 22, Math.PI).rotateY((s * Math.PI) / 4).scale(1.06, 1.27, 0.82), '#2a2a2a']);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) l.push([rod([sx * 0.66, 0.95, sz * 0.5], [sx * 1.35, 0, sz * 1.0], 0.006, 0.006, 3), '#e0e0e0'], [cyl(0.015, 0.015, 0.1, 4, sx * 1.35, 0, sz * 1.0), '#555555']);
    return [{ geo: shadeY(mergeGeos(l), 0, 1.25, 0.65), mat: W.tent() }];
  };
  D['tent:ridge'] = () => {
    const Lr = 2.1, hf = 0.85, ht = 1.3, sl = Math.atan2(ht, hf), len = Math.hypot(ht, hf), l = [];
    for (const s of [-1, 1]) l.push([new THREE.BoxGeometry(len, 0.02, Lr).rotateZ(s > 0 ? -sl : sl).translate((s * hf) / 2, ht / 2, 0), '#ffffff']);
    const tri = (w, h) => { const sp = new THREE.Shape(); sp.moveTo(-w, 0); sp.lineTo(w, 0); sp.lineTo(0, h); sp.lineTo(-w, 0); return new THREE.ShapeGeometry(sp); };
    l.push([tri(hf, ht).translate(0, 0, Lr / 2 - 0.02), '#e8e8e8'], [tri(hf, ht).rotateY(Math.PI).translate(0, 0, -Lr / 2 + 0.02), '#e8e8e8'], [tri(0.32, 0.95).translate(0, 0, Lr / 2 - 0.01), '#2a2a2a']);
    for (const e of [-1, 1]) l.push([rod([0, 0, e * (Lr / 2 + 0.04)], [0, ht + 0.1, e * (Lr / 2 + 0.04)], 0.014, 0.014, 4), '#3a3a3a'], [rod([0, ht + 0.06, e * (Lr / 2 + 0.04)], [0, 0, e * (Lr / 2 + 0.9)], 0.006, 0.006, 3), '#e0e0e0']);
    for (const s of [-1, 1]) for (const z of [-0.7, 0.7]) l.push([rod([s * hf * 0.45, ht * 0.55, z], [s * 1.35, 0, z], 0.006, 0.006, 3), '#e0e0e0']);
    return [{ geo: shadeY(mergeGeos(l), 0, 1.3, 0.7), mat: W.tent() }];
  };
  // ===== Militärkisten: zwei lange Kisten, eine quer oben, Munitionsdosen, Griffe =====
  D.milcrate = () => {
    const Sx = pxRect(2, 2, 126, 126), Ex = pxRect(130, 2, 254, 126), Pl = pxRect(10, 140, 246, 246);
    const crate = (w, h, d, x, y, z, ry) => boxUV(w, h, d, 0, 0, 0, [Ex, Ex, Pl, Pl, Sx, Sx], Pl).rotateY(ry).translate(x, y, z);
    const l = [[crate(1.3, 0.5, 0.58, -0.05, 0, -0.33, 0.03), '#ffffff'], [crate(1.3, 0.5, 0.58, 0.04, 0, 0.32, -0.04), '#eeeee6'], [crate(1.0, 0.42, 0.5, 0.05, 0.5, 0.0, 0.18), '#e6eadc']];
    for (const [x, z] of [[0.86, -0.55], [0.86, -0.22], [0.78, 0.72]]) l.push([uvRect(bx(0.3, 0.19, 0.15, x, 0, z), Pl), '#a6a680'], [uvRect(bx(0.05, 0.02, 0.1, x, 0.19, z), Pl), '#2a2a22']);
    for (const z of [-0.33, 0.32]) for (const s of [-1, 1]) l.push([uvRect(bx(0.03, 0.06, 0.22, s * 0.67, 0.26, z), Pl), '#2a2a22']);
    return [{ geo: mergeGeos(l), mat: W.mil() }];
  };
  // ===== Maschendrahtzaun: Pfosten mittig, Oberrohr, Spanndraht, Drahtgeflecht (Alpha) =====
  D.chainlink = () => {
    const st = '#b4bac0', S = [[rod([0, -0.05, 0], [0, 2.05, 0], 0.035, 0.035, 8), st], [cyl(0.045, 0.045, 0.05, 8, 0, 2.04, 0), '#8a9096'], [rod([-1, 1.98, 0], [1, 1.98, 0], 0.021, 0.021, 6, true), st], [rod([-1, 0.06, 0], [1, 0.06, 0], 0.006, 0.006, 4), '#8a9096'], [bx(0.2, 0.06, 0.2, 0, -0.02, 0), '#9a9890']];
    return [{ geo: mergeGeos(S), mat: W.steel() }, { geo: scaleUV(new THREE.PlaneGeometry(2.0, 1.94).translate(0, 1.0, 0), 16, 16), mat: W.chain(), shadow: false }];
  };
  return D;
}

// ---------- Animierte Wasserfläche (Fluss/Teich): Normalmap-Wellen über Zeit, Ufer-Ausblendung per Maske, Nebel des Krieges ----------
// mask: DataTexture W×H (R = 1 im Wasser), gleiche Abbildung wie die Nebelkarte
export function makeWater(mask, sky = null) {
  const time = { value: 0 }, wSky = { value: new THREE.Color(sky || 0xa8c4dc) };
  const n = tx('waterN');
  const mat = patchFog(new THREE.MeshStandardMaterial({ color: 0x1d5068, roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.8, normalMap: n, normalScale: new THREE.Vector2(0.3, 0.3), envMapIntensity: 2.2, depthWrite: false }));
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    base(sh, r);
    sh.uniforms.wTime = time; sh.uniforms.wMask = { value: mask }; sh.uniforms.wSky = wSky;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float wTime; uniform sampler2D wMask; uniform vec3 wSky;')
      .replace('#include <opaque_fragment>', `{ float fr = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 3.0);
          outgoingLight = mix(outgoingLight, wSky * 0.85, clamp(0.1 + fr * 0.7, 0.0, 0.6)); diffuseColor.a = clamp(diffuseColor.a * (1.0 + fr * 0.5), 0.0, 1.0); }
        #include <opaque_fragment>`)
      .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', 'vec3 mapN = texture2D( normalMap, vNormalMapUv + vec2(wTime * 0.021, wTime * 0.013) ).xyz + texture2D( normalMap, vNormalMapUv * 1.63 + vec2(-wTime * 0.017, wTime * 0.024) ).xyz - 1.0;')
      .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
        { float wm = texture2D(wMask, vFogW / fogMapSize + 0.5).r;
          float foam = smoothstep(0.34, 0.5, wm) * (1.0 - smoothstep(0.5, 0.72, wm));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.68, 0.66), foam * 0.45);
          diffuseColor.a *= smoothstep(0.3, 0.55, wm); }`);
  };
  mat.customProgramCacheKey = () => 'fogWater';
  return { mat, time };
}

// ---------- Einheiten ----------
const unitMats = {};
function um(key, o) { return (unitMats[key] ||= new THREE.MeshStandardMaterial(o)); }

function limb(len, rad, mat) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(rad, len, 4, 8).translate(0, -len / 2 - rad * 0.5, 0), mat);
  m.castShadow = true; g.add(m);
  return g;
}

// fx: 'bullet' | 'laser' | 'plasma' | 'rocket' | 'stun', optional mit Variante 'fx:pistol|tube|heavy|rifle' (W2)
function gun(fx = 'bullet', scale = 1) {
  const [kind, v0] = String(fx).split(':');
  const variant = v0 || (kind === 'rocket' || kind === 'stun' ? 'tube' : 'rifle');
  const g = new THREE.Group();
  const col = kind === 'plasma' ? 0x2a3a30 : kind === 'laser' ? 0x3a3a48 : kind === 'stun' ? 0x2a3242 : variant === 'tube' ? 0x3a4430 : 0x222222;
  const mat = um('gun' + col, { color: col, metalness: 0.8, roughness: 0.35 });
  const glowC = kind === 'plasma' ? 0x50ff80 : kind === 'laser' ? 0xff4040 : kind === 'stun' ? 0x60a0ff : 0;
  let len;
  if (variant === 'pistol') { // einhändig: kurzer Lauf + Griff
    len = 0.42 * scale;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, len), mat); body.castShadow = true; g.add(body);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.1), mat); grip.position.set(0, -0.13, -0.1 * scale); grip.rotation.x = 0.25; g.add(grip);
  } else if (variant === 'tube') { // Werfer: Rohr auf der Schulter
    len = 1.1 * scale;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, len, 12).rotateX(Math.PI / 2), mat); tube.castShadow = true; tube.position.y = 0.06; g.add(tube);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.1, 12).rotateX(Math.PI / 2), um('gunring', { color: 0x1a1a1a, metalness: 0.6, roughness: 0.5 }));
    ring.position.set(0, 0.06, len / 2 - 0.05); g.add(ring);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.18, 0.08), mat); grip.position.set(0, -0.1, -0.05); g.add(grip);
    if (kind === 'stun') { const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), um('glowstun', { color: 0, emissive: 0x60a0ff, emissiveIntensity: 3 })); tip.position.set(0, 0.06, len / 2); g.add(tip); }
  } else if (variant === 'heavy') { // schwer: dicker, länger, Zweibein-Stummel
    len = 0.9 * scale * 1.25;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.2, len), mat); body.castShadow = true; g.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4 * scale, 8).rotateX(Math.PI / 2), mat); barrel.position.set(0, 0.02, len / 2 + 0.15 * scale); g.add(barrel);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.2), um('gunmag', { color: 0x30342a, roughness: 0.6 })); box.position.set(0, -0.16, 0); g.add(box);
    len += 0.3 * scale;
  } else {
    len = 0.9 * scale;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, len), mat); body.castShadow = true; g.add(body);
  }
  if (glowC && variant !== 'tube') {
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, len * 0.66), um('glow' + kind, { color: 0, emissive: glowC, emissiveIntensity: 3 }));
    glow.position.set(variant === 'heavy' ? 0.095 : 0.07, 0.03, 0); g.add(glow);
  }
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, variant === 'tube' ? 0.06 : 0, len / 2 + 0.03); g.add(muzzle); g.userData.muzzle = muzzle;
  return g;
}

export function makeSoldier(s, armorColor, weaponFx) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const suit = um('suit' + armorColor, { color: armorColor, roughness: 0.65, metalness: armorColor === 0xb8c0cc ? 0.7 : 0.15 });
  const dark = um('dark', { color: 0x1d2126, roughness: 0.8 });
  const skin = um('skin' + s.look.skin, { color: s.look.skin, roughness: 0.7 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.5, 4, 10), suit); torso.position.y = 1.15; torso.castShadow = true; body.add(torso);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.48), dark); vest.position.y = 1.2; vest.castShadow = true; body.add(vest);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.22), dark); pack.position.set(0, 1.2, -0.3); body.add(pack);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), skin); head.position.y = 1.72; body.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.235, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), suit); helmet.position.y = 1.76; helmet.castShadow = true; body.add(helmet);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.08), um('visor', { color: 0, emissive: 0x40d8ff, emissiveIntensity: 2.2 })); visor.position.set(0, 1.74, 0.19); body.add(visor);
  const legL = limb(0.55, 0.12, suit), legR = limb(0.55, 0.12, suit);
  legL.position.set(-0.15, 0.82, 0); legR.position.set(0.15, 0.82, 0); body.add(legL, legR);
  const armL = limb(0.42, 0.09, suit), armR = limb(0.42, 0.09, suit);
  armL.position.set(-0.38, 1.45, 0); armR.position.set(0.38, 1.45, 0); body.add(armL, armR);
  armL.rotation.x = -1.1; armR.rotation.x = -1.2; armL.rotation.z = 0.5;
  const g = gun(weaponFx); g.position.set(0.18, 1.2, 0.45); body.add(g);
  root.userData = { body, legL, legR, armL, armR, gun: g, head, kind: 'soldier' };
  return root;
}

export function makeAlien(model) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const ud = { body, kind: model };
  if (model === 'vael') {
    const skin = um('vael', { color: 0x9aa39a, roughness: 0.45, metalness: 0.05 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.45, 4, 10), skin); torso.position.y = 0.95; torso.castShadow = true; body.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.33, 18, 14), skin); head.scale.set(1, 1.15, 1.05); head.position.y = 1.55; head.castShadow = true; body.add(head);
    const eyeM = um('vaelEye', { color: 0x050505, emissive: 0x18ff80, emissiveIntensity: 0.9, roughness: 0.05, metalness: 0.5 });
    for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), eyeM); e.scale.set(1, 0.6, 0.5); e.position.set(0.13 * sx, 1.55, 0.27); e.rotation.z = 0.4 * sx; body.add(e); }
    ud.legL = limb(0.4, 0.07, skin); ud.legR = limb(0.4, 0.07, skin);
    ud.legL.position.set(-0.11, 0.62, 0); ud.legR.position.set(0.11, 0.62, 0); body.add(ud.legL, ud.legR);
    ud.armL = limb(0.4, 0.05, skin); ud.armR = limb(0.4, 0.05, skin);
    ud.armL.position.set(-0.24, 1.2, 0); ud.armR.position.set(0.24, 1.2, 0); ud.armR.rotation.x = -1.2; body.add(ud.armL, ud.armR);
    const g = gun('plasma', 0.6); g.position.set(0.24, 1.0, 0.4); body.add(g); ud.gun = g;
  } else if (model === 'krull') {
    const skin = um('krull', { color: 0x5d6b3a, roughness: 0.55 });
    const plate = um('krullArmor', { color: 0x3b2a2a, metalness: 0.6, roughness: 0.4 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.55, 4, 10), skin); torso.position.set(0, 1.25, 0.05); torso.rotation.x = 0.25; torso.castShadow = true; body.add(torso);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.6), plate); chest.position.set(0, 1.35, 0.1); chest.rotation.x = 0.25; chest.castShadow = true; body.add(chest);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), skin); head.scale.set(1, 0.85, 1.3); head.position.set(0, 1.85, 0.35); body.add(head);
    const eyeM = um('krullEye', { color: 0, emissive: 0xff3010, emissiveIntensity: 3 });
    for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), eyeM); e.position.set(0.11 * sx, 1.9, 0.62); body.add(e); }
    ud.legL = limb(0.55, 0.16, skin); ud.legR = limb(0.55, 0.16, skin);
    ud.legL.position.set(-0.25, 0.85, 0); ud.legR.position.set(0.25, 0.85, 0); body.add(ud.legL, ud.legR);
    ud.armL = limb(0.5, 0.13, skin); ud.armR = limb(0.5, 0.13, skin);
    ud.armL.position.set(-0.55, 1.6, 0.1); ud.armR.position.set(0.55, 1.6, 0.1); ud.armL.rotation.x = -1; ud.armR.rotation.x = -1.2; body.add(ud.armL, ud.armR);
    const g = gun('plasma', 1.1); g.position.set(0.3, 1.3, 0.65); body.add(g); ud.gun = g;
  } else if (model === 'drone') {
    const shell = um('drone', { color: 0x4a4f5a, metalness: 0.9, roughness: 0.25 });
    const disc = new THREE.Mesh(new THREE.SphereGeometry(0.6, 20, 12), shell); disc.scale.set(1, 0.45, 1); disc.position.y = 1.5; disc.castShadow = true; body.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 8, 32), um('droneGlow', { color: 0, emissive: 0xff2050, emissiveIntensity: 3 })); ring.rotation.x = Math.PI / 2; ring.position.y = 1.5; body.add(ring);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), um('droneEye', { color: 0, emissive: 0xff4060, emissiveIntensity: 4 })); eye.position.set(0, 1.45, 0.5); body.add(eye);
    const g = new THREE.Group(); const muzzle = new THREE.Object3D(); muzzle.position.set(0, 1.45, 0.65); g.add(muzzle); g.userData.muzzle = muzzle; body.add(g); ud.gun = g;
    ud.hover = true;
  } else if (model === 'beast') {
    const skin = um('beast', { color: 0x4a2d52, roughness: 0.5, metalness: 0.1 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.0, 4, 10), skin); torso.rotation.x = Math.PI / 2; torso.position.y = 0.95; torso.castShadow = true; body.add(torso);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.8, 8), skin); head.rotation.x = Math.PI / 2; head.position.set(0, 1.1, 1.0); body.add(head);
    const eyeM = um('beastEye', { color: 0, emissive: 0xffd020, emissiveIntensity: 3 });
    for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), eyeM); e.position.set(0.17 * sx, 1.25, 0.95); body.add(e); }
    for (let i = 0; i < 4; i++) {
      const l = limb(0.55, 0.11, skin); l.position.set(i % 2 ? 0.3 : -0.3, 0.85, i < 2 ? 0.5 : -0.5); body.add(l);
      if (i === 0) ud.legL = l; if (i === 1) ud.legR = l; if (i === 2) ud.legL2 = l; if (i === 3) ud.legR2 = l;
    }
    const g = new THREE.Group(); const muzzle = new THREE.Object3D(); muzzle.position.set(0, 1.0, 1.3); g.add(muzzle); g.userData.muzzle = muzzle; body.add(g); ud.gun = g;
  } else if (model === 'hive') {
    const skin = um('hiveBoss', { color: 0x2a1530, roughness: 0.35, metalness: 0.3, emissive: 0x401050, emissiveIntensity: 0.6 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.6, 1.0, 4, 12), skin); torso.position.y = 1.6; torso.castShadow = true; body.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), skin); head.scale.set(1, 1.3, 1.1); head.position.y = 2.65; body.add(head);
    const crest = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.0, 6), um('crest', { color: 0, emissive: 0xd060ff, emissiveIntensity: 3 })); crest.position.set(0, 3.2, -0.2); crest.rotation.x = -0.5; body.add(crest);
    const eyeM = um('hiveEye', { color: 0, emissive: 0xe080ff, emissiveIntensity: 4 });
    for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), eyeM); e.position.set(0.2 * sx, 2.7, 0.45); body.add(e); }
    ud.legL = limb(0.7, 0.2, skin); ud.legR = limb(0.7, 0.2, skin);
    ud.legL.position.set(-0.3, 1.1, 0); ud.legR.position.set(0.3, 1.1, 0); body.add(ud.legL, ud.legR);
    const g = gun('plasma', 1.5); g.position.set(0.6, 1.7, 0.7); body.add(g); ud.gun = g;
    root.scale.setScalar(1.15);
  }
  root.userData = ud;
  return root;
}

// ---------- Dächer (je Gebäude ein Objekt, wird ausgeblendet, wenn man hineinsehen muss) ----------
// o: { sx, sz (Außenmaß in Welteinheiten), H (Traufhöhe), kind: 'gable'|'flat', roof, wall, trim (Farben), tall }
export function makeRoof(o, M) {
  const g = new THREE.Group();
  const { sx, sz, H } = o;
  const roofCol = new THREE.Color(o.roof), wallCol = new THREE.Color(o.wall), trimCol = new THREE.Color(o.trim);
  if (o.kind === 'gable') {
    const long = sx >= sz, L = long ? sx : sz, S = long ? sz : sx;
    const oh = 0.35, rh = Math.min(S * 0.3, 2.8), ang = Math.atan2(rh, S / 2), tn = Math.tan(ang);
    const slope = (S / 2 + oh) / Math.cos(ang);
    const planes = [];
    for (const sg of [-1, 1]) {
      const p = scaleUV(new THREE.BoxGeometry(L + 2 * oh, 0.14, slope), (L + 2 * oh) / 2.4, slope / 2.4);
      p.rotateX(sg * ang).translate(0, (H + rh + H - oh * tn) / 2 + 0.07, sg * (S / 2 + oh) / 2);
      planes.push([p, roofCol]);
    }
    planes.push([new THREE.BoxGeometry(L + 2 * oh + 0.04, 0.12, 0.26).translate(0, H + rh + 0.12, 0), roofCol.clone().multiplyScalar(0.7)]);
    const ends = [];
    for (const sg of [-1, 1]) ends.push([sideProfile([[-S / 2, H], [S / 2, H], [0, H + rh]], 0.16, 0).translate(sg * (L / 2 - 0.08), 0, 0), wallCol]);
    ends.push([bx(0.55, rh * 0.7 + 0.8, 0.55, L * 0.22, H + rh * 0.5, S * 0.18), '#7a4436'], [bx(0.65, 0.08, 0.65, L * 0.22, H + rh * 1.2 + 0.8, S * 0.18), '#5a5450']);
    for (const sg of [-1, 1]) ends.push([bx(L + 2 * oh, 0.18, 0.06, 0, H - 0.14 - oh * tn, sg * (S / 2 + oh)), trimCol]);
    const roofGeo = mergeGeos(planes), endGeo = mergeGeos(ends);
    if (!long) { roofGeo.rotateY(Math.PI / 2); endGeo.rotateY(Math.PI / 2); }
    g.add(new THREE.Mesh(roofGeo, M.roofTile), new THREE.Mesh(endGeo, M.plainVC));
  } else {
    const slab = scaleUV(bx(sx + 0.06, 0.16, sz + 0.06, 0, H, 0), sx / 4, sz / 4);
    const par = [], ph = 0.5, th = 0.28, top = H + 0.16;
    for (const sg of [-1, 1]) {
      par.push([bx(sx + 0.1, ph, th, 0, top, sg * (sz / 2 - th / 2 + 0.05)), wallCol], [bx(th, ph, sz + 0.1, sg * (sx / 2 - th / 2 + 0.05), top, 0), wallCol]);
      par.push([bx(sx + 0.2, 0.07, th + 0.12, 0, top + ph, sg * (sz / 2 - th / 2 + 0.05)), trimCol], [bx(th + 0.12, 0.07, sz + 0.2, sg * (sx / 2 - th / 2 + 0.05), top + ph, 0), trimCol]);
    }
    // Dachaufbauten: Klimageräte, Lüfter, Treppenhaus/Wassertank
    const n = Math.max(1, Math.round(sx * sz / 40));
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * (sx - 3), z = (Math.random() - 0.5) * (sz - 3);
      par.push([bx(1.0, 0.6, 0.8, x, top, z), '#9aa0a4'], [new THREE.CylinderGeometry(0.28, 0.28, 0.05, 12).translate(x, top + 0.63, z), '#4a4e52']);
    }
    if (o.tall && sx > 6 && sz > 6) par.push([bx(2.0, 1.5, 2.0, sx / 2 - 1.8, top, -sz / 2 + 1.8), wallCol], [bx(2.1, 0.08, 2.1, sx / 2 - 1.8, top + 1.5, -sz / 2 + 1.8), trimCol]);
    else if (o.tank) par.push([cyl(0.6, 0.6, 1.0, 14, -sx / 2 + 1.4, top + 0.4, sz / 2 - 1.4), '#c8c4bc'], ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => [bx(0.06, 0.4, 0.06, -sx / 2 + 1.4 + a * 0.4, top, sz / 2 - 1.4 + b * 0.4), '#5a5450']));
    g.add(new THREE.Mesh(mergeGeos([[slab, '#ffffff']]), M.roofFlat), new THREE.Mesh(mergeGeos(par), M.plainVC));
  }
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return g;
}

// ---------- Zivilisten: abwechslungsreiche Kleidung, Frisuren, Hautfarben; Teile je Gliedmaße zusammengefasst ----------
const SKIN = ['#f3d2b3', '#eac09a', '#e0ac69', '#c68642', '#a0663a', '#8d5524', '#6b4226', '#4e2f1c'];
const HAIR = ['#14110f', '#231a14', '#3b2a1e', '#5a3d26', '#7a5532', '#a87b4a', '#d1b277', '#8e3b1e', '#1c1c24'];
const TOPS = ['#c23b32', '#2f5d8a', '#3f7a4a', '#e0c24a', '#e8e6e0', '#6a4a8a', '#d9822b', '#2a2d33', '#8aa4b8', '#b0506a', '#5a6e3a', '#f0a8a0', '#1e3a5a', '#9a8a70'];
const PANTS = ['#2b3a55', '#1f2a40', '#3a3a3a', '#6b5a44', '#202020', '#53606e', '#8a7a5a', '#4a3a2e'];
export function makeCivilian() {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const pick = (a) => a[(rand() * a.length) | 0];
  const fem = rand() < 0.5, old = rand() < 0.18;
  const skin = pick(SKIN), hair = old ? pick(['#b8b4ae', '#dedad2', '#8a8580']) : pick(HAIR);
  const top = pick(TOPS), pants = pick(PANTS), shoe = pick(['#1a1a1a', '#3a2a1e', '#e8e8e8', '#5a4030', '#7a2a2a']);
  const style = fem ? pick(['dress', 'blouse', 'jacket', 'shirt', 'coat']) : pick(['shirt', 'tshirt', 'jacket', 'hoodie', 'suit', 'coat']);
  const jacket = style === 'suit' ? pick(['#22252b', '#3a3e46', '#4a3a30']) : style === 'jacket' || style === 'coat' ? pick(['#5a4a3a', '#2e3a4a', '#6a2e2e', '#3a4a3a', '#8a7a62', '#1e1e22']) : top;
  const shortSleeve = style === 'tshirt' || (style === 'blouse' && rand() < 0.5) || (style === 'dress' && rand() < 0.6);
  const legCol = style === 'dress' ? (rand() < 0.5 ? skin : '#2a2626') : style === 'suit' ? jacket : pants;
  const B = [];
  // Rumpf (vorn-hinten abgeflacht), Hüfte, Hals, Kopf
  const torso = new THREE.CapsuleGeometry(0.24, 0.4, 4, 10).scale(fem ? 0.92 : 1, 1, 0.72).translate(0, 1.17, 0);
  B.push([torso, jacket]);
  if (style === 'jacket' || style === 'suit' || style === 'coat') {
    B.push([bx(0.15, 0.46, 0.03, 0, 1.02, 0.165), style === 'suit' ? '#f2f2f0' : top]);
    if (style === 'suit') B.push([bx(0.05, 0.36, 0.035, 0, 1.08, 0.175), pick(['#8a1a1a', '#1a3a6a', '#2a2a2a'])]);
    B.push([new THREE.TorusGeometry(0.11, 0.03, 6, 12).rotateX(Math.PI / 2).translate(0, 1.47, 0), jacket]);
  }
  if (style === 'hoodie') B.push([new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-1.9).translate(0, 1.5, -0.12), jacket], [bx(0.24, 0.12, 0.03, 0, 0.98, 0.17), jacket]);
  if (style === 'dress') B.push([cyl(0.22, 0.34, 0.6, 14, 0, 0.42, 0), top]);
  else if (style === 'coat') B.push([cyl(0.25, 0.32, 0.55, 12, 0, 0.5, 0).scale(1, 1, 0.8), jacket]);
  else B.push([cyl(0.2, 0.21, 0.22, 10, 0, 0.8, 0).scale(1, 1, 0.75), legCol === skin ? pants : legCol]);
  B.push([cyl(0.065, 0.075, 0.14, 8, 0, 1.46, 0), skin]);
  B.push([ball(0.16, 0, 1.66, 0, 14, 10).scale(1, 1, 1), skin]);
  B.push([bx(0.04, 0.06, 0.05, 0, 1.62, 0.155), skin]);
  for (const s of [-1, 1]) B.push([ball(0.022, s * 0.055, 1.685, 0.142, 6, 4), '#1a1410']);
  if (rand() < 0.15) B.push([bx(0.22, 0.035, 0.03, 0, 1.67, 0.165), '#1a1a1a']); // Brille
  // Frisur
  const hs = old && !fem && rand() < 0.4 ? 'bald' : fem ? pick(['long', 'bun', 'pony', 'bob', 'short']) : pick(['short', 'short', 'curly', 'side', 'buzz']);
  const cap = (r = 0.172, th = 0.55) => new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI * th).rotateX(-0.35).translate(0, 1.67, -0.01);
  if (hs === 'bald') B.push([new THREE.TorusGeometry(0.15, 0.03, 6, 14, Math.PI).rotateX(Math.PI / 2).rotateY(Math.PI).translate(0, 1.64, 0), hair]);
  else if (hs === 'buzz') B.push([cap(0.166, 0.5), hair]);
  else if (hs === 'curly') B.push([new THREE.IcosahedronGeometry(0.2, 1).scale(1, 0.8, 1).translate(0, 1.74, -0.03), hair]);
  else B.push([cap(), hair]);
  if (hs === 'long') B.push([bx(0.3, 0.42, 0.1, 0, 1.34, -0.1), hair], [bx(0.06, 0.3, 0.08, -0.15, 1.42, 0.0), hair], [bx(0.06, 0.3, 0.08, 0.15, 1.42, 0.0), hair]);
  if (hs === 'bob') B.push([new THREE.CylinderGeometry(0.18, 0.2, 0.22, 14, 1, true).translate(0, 1.6, -0.02), hair]);
  if (hs === 'bun') B.push([ball(0.08, 0, 1.8, -0.12, 8, 6), hair]);
  if (hs === 'pony') B.push([new THREE.CapsuleGeometry(0.045, 0.22, 3, 6).rotateX(0.3).translate(0, 1.55, -0.2), hair]);
  if (hs === 'side') B.push([bx(0.24, 0.06, 0.12, 0.03, 1.78, 0.06).rotateZ(-0.12), hair]);
  if (!fem && !old && rand() < 0.22) B.push([new THREE.SphereGeometry(0.155, 10, 6, Math.PI / 2 - 0.9, 1.8, Math.PI * 0.55, Math.PI * 0.35).translate(0, 1.65, 0.01), hair]); // Bart
  // Hut / Mütze
  const hat = rand();
  if (hat < 0.1) B.push([new THREE.SphereGeometry(0.178, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.7, 0), pick(['#c23b32', '#1e3a5a', '#2a2a2a'])], [bx(0.2, 0.025, 0.16, 0, 1.7, 0.18), '#1a1a1a']);
  else if (hat < 0.17) B.push([cyl(0.13, 0.14, 0.14, 12, 0, 1.76, 0), '#3a3028'], [cyl(0.25, 0.25, 0.02, 16, 0, 1.76, 0), '#3a3028']);
  // Taschen
  const bag = rand();
  if (bag < 0.15) B.push([bx(0.3, 0.38, 0.14, 0, 1.02, -0.24), pick(['#2a3a5a', '#3a3a3a', '#8a2a2a', '#3a5a3a'])]);
  else if (bag < 0.3) B.push([bx(0.06, 0.26, 0.22, fem ? 0.29 : -0.29, 0.78, 0), pick(['#5a3a24', '#1a1a1a', '#8a5a3a'])], [bx(0.03, 0.62, 0.03, 0, 1.06, 0.12).rotateZ(fem ? 0.75 : -0.75).translate(0, 0, 0), '#3a2a1a']);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 });
  const mesh = (list) => { const m = new THREE.Mesh(mergeGeos(list), mat); m.castShadow = true; return m; };
  body.add(mesh(B));
  // Beine (Gruppe mit Drehpunkt an der Hüfte) und Arme (Drehpunkt an der Schulter)
  const leg = (x) => {
    const gp = new THREE.Group(); gp.position.set(x, 0.86, 0);
    const L = [[new THREE.CapsuleGeometry(0.095, 0.6, 4, 8).translate(0, -0.42, 0), legCol]];
    if (style === 'tshirt' && rand() < 0.3) L[0][0] = new THREE.CapsuleGeometry(0.095, 0.24, 4, 8).translate(0, -0.22, 0), L.push([new THREE.CapsuleGeometry(0.08, 0.34, 4, 8).translate(0, -0.6, 0), skin]);
    L.push([bx(0.13, 0.1, 0.27, 0, -0.86, 0.04), shoe]);
    gp.add(mesh(L)); return gp;
  };
  const arm = (x, s) => {
    const gp = new THREE.Group(); gp.position.set(x, 1.42, 0);
    const sleeve = style === 'dress' || style === 'blouse' ? top : jacket;
    const A = [[new THREE.CapsuleGeometry(0.072, 0.24, 4, 8).translate(0, -0.15, 0), shortSleeve ? sleeve : sleeve], [new THREE.CapsuleGeometry(0.062, 0.24, 4, 8).translate(0, -0.42, 0), shortSleeve ? skin : sleeve], [ball(0.062, 0, -0.62, 0.01, 8, 6), skin]];
    if (shortSleeve) A[0][0] = new THREE.CapsuleGeometry(0.075, 0.1, 4, 8).translate(0, -0.08, 0), A.push([new THREE.CapsuleGeometry(0.064, 0.14, 4, 8).translate(0, -0.22, 0), skin]);
    if (bag >= 0.3 && bag < 0.4 && s > 0) A.push([bx(0.24, 0.2, 0.08, 0, -0.84, 0.02), pick(['#8a2a3a', '#5a3a24', '#1a1a1a'])], [bx(0.02, 0.18, 0.02, 0, -0.68, 0.02), '#2a1a14']);
    gp.add(mesh(A)); return gp;
  };
  const legL = leg(-0.12), legR = leg(0.12);
  const armL = arm(fem ? -0.29 : -0.31, -1), armR = arm(fem ? 0.29 : 0.31, 1);
  body.add(legL, legR, armL, armR);
  const sc = (fem ? 0.95 : 1) * (0.94 + rand() * 0.12) * (old ? 0.97 : 1);
  body.scale.set(sc * (0.92 + rand() * 0.16), sc, sc);
  if (old) body.rotation.x = 0.08;
  root.userData = { body, legL, legR, armL, armR, kind: 'civ' };
  return root;
}

export function makeTransport() {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0x4b5560, metalness: 0.75, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b2026, metalness: 0.6, roughness: 0.5 });
  const glow = new THREE.MeshStandardMaterial({ color: 0, emissive: 0xffa040, emissiveIntensity: 4 });
  const fus = new THREE.Mesh(new THREE.CapsuleGeometry(2.2, 9, 6, 16), hull); fus.rotation.x = Math.PI / 2; fus.position.y = 2.6; fus.scale.set(1, 1, 0.75); g.add(fus);
  const cock = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x102030, metalness: 0.3, roughness: 0.05 })); cock.position.set(0, 3.6, -5.2); cock.scale.set(1, 0.6, 1.4); g.add(cock);
  for (const sx of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(7, 0.3, 3.5), hull); wing.position.set(sx * 4.5, 2.6, 1); wing.rotation.z = sx * -0.08; g.add(wing);
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 3.2, 16), dark); eng.rotation.x = Math.PI / 2; eng.position.set(sx * 7.5, 2.5, 1.5); g.add(eng);
    const nozzle = new THREE.Mesh(new THREE.CircleGeometry(0.8, 16), glow); nozzle.position.set(sx * 7.5, 2.5, 3.15); g.add(nozzle);
  }
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 2.5), hull); fin.position.set(0, 5, 5); g.add(fin);
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 4), dark); ramp.position.set(0, 0.9, -7.4); ramp.rotation.x = -0.38; g.add(ramp);
  const light = new THREE.PointLight(0xffb070, 25, 14, 2); light.position.set(0, 2, -6); g.add(light);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
