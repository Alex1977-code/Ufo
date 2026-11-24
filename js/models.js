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
  for (const k of ['brick', 'wood', 'metal', 'rock', 'bark', 'concrete', 'hay', 'leaf', 'hive']) tex[k + 'D'] = dataTex(tex[k], k === 'metal' ? 0.4 : 0.7, 1);
  return tex;
}
// Alle zwischengespeicherten Texturen von der GPU nehmen (werden bei erneuter Nutzung automatisch neu hochgeladen)
export function releaseTextures() { for (const t of Object.values(tex)) t?.dispose?.(); }

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
export function patchFog(mat) {
  mat.onBeforeCompile = (sh) => {
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
  mat.customProgramCacheKey = () => 'fog' + mat.type;
  return mat;
}

const std = (o) => patchFog(new THREE.MeshStandardMaterial(o));

// ---------- Hindernis-Definitionen: Teile für InstancedMesh ----------
export function propParts() {
  const t = textures();
  const box = (w, h, d, y = 0) => new THREE.BoxGeometry(w, h, d).translate(0, y + h / 2, 0);
  const T = TILE;
  const M = {
    brick: std({ map: t.brick, roughness: 0.92 }),
    wood: std({ map: t.wood, roughness: 0.85 }),
    metal: std({ map: t.metal, color: 0x8892a0, metalness: 0.85, roughness: 0.32 }),
    metalGlow: std({ color: 0x0b1a1a, emissive: 0x30ffc8, emissiveIntensity: 2.6 }),
    hive: std({ map: t.hive, emissiveMap: t.hiveEmit, emissive: 0xc060ff, emissiveIntensity: 1.3, roughness: 0.55, metalness: 0.1 }),
    bark: std({ map: t.bark, roughness: 1 }),
    leaf: std({ map: t.leaf, roughness: 0.9, flatShading: true }),
    pineLeaf: std({ map: t.leaf, color: 0x7fa08a, roughness: 0.9, flatShading: true }),
    rock: std({ map: t.rock, roughness: 0.95, flatShading: true }),
    fenceWood: std({ map: t.wood, color: 0xb89a7a, roughness: 0.9 }),
    hedge: std({ map: t.leaf, color: 0x9ac08a, roughness: 1 }),
    crate: std({ map: t.wood, color: 0xc8a070, roughness: 0.8 }),
    hay: std({ map: t.hay, roughness: 1 }),
    carBody: std({ color: 0xffffff, metalness: 0.6, roughness: 0.28 }),
    glass: std({ color: 0x223344, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.55 }),
    tire: std({ color: 0x111111, roughness: 0.9 }),
    concrete: std({ map: t.concrete, roughness: 0.9 }),
    wreck: std({ map: t.metal, color: 0x3d3f44, metalness: 0.8, roughness: 0.5 }),
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
  return { parts: P, mats: M };
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

function gun(fx, scale = 1) {
  const g = new THREE.Group();
  const col = fx === 'plasma' ? 0x2a3a30 : fx === 'laser' ? 0x3a3a48 : 0x222222;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.9 * scale), um('gun' + col, { color: col, metalness: 0.8, roughness: 0.35 }));
  body.castShadow = true;
  g.add(body);
  if (fx === 'plasma' || fx === 'laser') {
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.6 * scale), um('glow' + fx, { color: 0, emissive: fx === 'plasma' ? 0x50ff80 : 0xff4040, emissiveIntensity: 3 }));
    glow.position.set(0.07, 0.03, 0); g.add(glow);
  }
  const muzzle = new THREE.Object3D(); muzzle.position.z = 0.48 * scale; g.add(muzzle); g.userData.muzzle = muzzle;
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

export function makeCivilian() {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(rand(), 0.5, 0.45), roughness: 0.8 });
  const pants = um('pants', { color: 0x2b3245, roughness: 0.9 });
  const dark = rand() < 0.5;
  const skin = um('civskin' + (dark ? 2 : 1), { color: dark ? 0x8d5524 : 0xe0ac69, roughness: 0.7 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.45, 4, 8), cloth); torso.position.y = 1.15; torso.castShadow = true; body.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), skin); head.position.y = 1.68; body.add(head);
  const legL = limb(0.55, 0.11, pants), legR = limb(0.55, 0.11, pants);
  legL.position.set(-0.13, 0.82, 0); legR.position.set(0.13, 0.82, 0); body.add(legL, legR);
  const armL = limb(0.42, 0.08, cloth), armR = limb(0.42, 0.08, cloth);
  armL.position.set(-0.33, 1.42, 0); armR.position.set(0.33, 1.42, 0); body.add(armL, armR);
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
