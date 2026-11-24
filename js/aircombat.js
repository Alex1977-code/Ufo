// Luftkampf (Abfangsequenz) als eigene 3D-Szene mit DOM-HUD.
// Vertrag: runAirCombat({ engine, geo, craft, ufo, craftSpec, ufoSpec, overLand, onEnd }) → onEnd({ result: 'win'|'lost'|'flee'|'escaped' })
import * as THREE from 'three';
import { Game } from './game.js';
import { Input, padLabel } from './input.js';
import { sfx, setMusicMood } from './audio.js';
import { clamp, lerp, rand, randRange, smooth } from './util.js';

// ---------- Kampfregeln ----------
const ESCAPE_KM = 22; // ab dieser Entfernung entkommt das UFO
const START_KM = 15;
const MIN_KM = 1.2;
const FUEL_S = 100; // Einsatzzeit in Sekunden, danach Rückkehr (UFO entkommt)
const WORLD_SPEED = 140; // scheinbare Fluggeschwindigkeit (Wolken/Boden)

// Bewaffnung der Jäger (Rakete je Salve, Nachladezeit, Reichweite in km)
const CRAFT_WEAPON = {
  falcon: { name: 'Raketen „Speer“', range: 8, ammo: 18, salvo: 2, reload: 2.4 },
  phantom: { name: 'Raketen „Lanze“', range: 12, ammo: 24, salvo: 2, reload: 1.8 },
};
// UFO-Bewaffnung und Verhalten
const UFO_WEAPON = {
  scout: { range: 4, reload: 2.0, kind: 'plasma', aggressive: false, R: 3, accent: [0.3, 3.0, 1.5] },
  fighter: { range: 6, reload: 1.5, kind: 'plasma', aggressive: true, R: 4, accent: [3.4, 1.0, 0.25] },
  freighter: { range: 7, reload: 2.2, kind: 'beam', aggressive: false, R: 6.5, accent: [0.35, 2.2, 3.4] },
  battleship: { range: 11, reload: 1.4, kind: 'beam', aggressive: true, R: 11, accent: [2.8, 0.45, 3.4] },
};

const km = (v) => v.toFixed(1).replace('.', ',');

// ---------- Texturen ----------
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}
const glowTex = () => canvasTex(128, 128, (g, w) => {
  const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, w);
});
const smokeTex = () => canvasTex(128, 128, (g, w) => {
  for (let i = 0; i < 14; i++) {
    const x = w / 2 + (Math.random() - 0.5) * w * 0.35, y = w / 2 + (Math.random() - 0.5) * w * 0.35, r = w * (0.18 + Math.random() * 0.2);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  }
});
const cloudTex = () => canvasTex(256, 256, (g, w) => {
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2, d = Math.random() * w * 0.22;
    const x = w / 2 + Math.cos(a) * d * 1.3, y = w / 2 + Math.sin(a) * d * 0.6 + 10, r = w * (0.12 + Math.random() * 0.16);
    const gr = g.createRadialGradient(x, y - r * 0.2, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.6, 'rgba(235,240,248,0.3)'); gr.addColorStop(1, 'rgba(220,228,240,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  }
});
const flameTex = () => canvasTex(32, 128, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h); // oben = Flammenspitze (transparent), unten = Düse
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
// Panellinien + Fenster für Rumpf-Details
function panelTex(base, line, windows) {
  return canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 220; i++) {
      const x = Math.random() * w, y = Math.random() * h, s = 10 + Math.random() * 40;
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${0.03 + Math.random() * 0.05})`;
      g.fillRect(x, y, s, s * 0.5);
    }
    g.strokeStyle = line; g.lineWidth = 1.2;
    for (let y = 0; y < h; y += 22 + Math.random() * 18) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    for (let x = 0; x < w; x += 24 + Math.random() * 30) { const y0 = Math.random() * h; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + 30 + Math.random() * 60); g.stroke(); }
    if (windows) {
      g.fillStyle = windows;
      for (let x = 4; x < w; x += 14) g.fillRect(x, h * 0.52, 6, 4);
    }
  });
}
function windowEmissive(col) {
  return canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.fillStyle = col;
    for (let x = 4; x < w; x += 14) g.fillRect(x, h * 0.52, 6, 4);
    for (let i = 0; i < 30; i++) g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
  });
}

// ---------- GLSL ----------
const VNOISE = /* glsl */ `
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.07 + vec2(17.1, 9.7); a *= 0.5; } return s / 0.9375; }
`;
const WORLD_VS = /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

// Himmels-Presets
const SKIES = [
  { zenith: [0.035, 0.12, 0.38], horizon: [0.36, 0.48, 0.64], sun: [1.0, 0.9, 0.75], sunDir: [-0.5, 0.3, -0.8], cloud: [0.92, 0.93, 0.95] },
  { zenith: [0.04, 0.06, 0.18], horizon: [0.68, 0.36, 0.2], sun: [1.0, 0.55, 0.3], sunDir: [-0.45, 0.12, -0.88], cloud: [0.95, 0.72, 0.6] },
];

// ---------- Partikelsystem (Rauch, Feuer, Funken) ----------
class Particles {
  constructor(max, tex, additive) {
    this.max = max; this.n = 0;
    this.d = { p: new Float32Array(max * 3), v: new Float32Array(max * 3), c0: new Float32Array(max * 3), c1: new Float32Array(max * 3), life: new Float32Array(max), maxLife: new Float32Array(max), s0: new Float32Array(max), s1: new Float32Array(max), a0: new Float32Array(max), drag: new Float32Array(max), grav: new Float32Array(max) };
    this.geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.aPos); this.geo.setAttribute('aColor', this.aCol);
    this.geo.setAttribute('aSize', this.aSize); this.geo.setAttribute('aAlpha', this.aAlpha);
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uScale: { value: 400 } },
      vertexShader: /* glsl */ `attribute float aSize; attribute float aAlpha; attribute vec3 aColor; uniform float uScale;
        varying float vA; varying vec3 vC;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.1), 1.0, 512.0);
          vA = aAlpha * (1.0 - smoothstep(700.0, 2200.0, -mv.z)); vC = aColor; }`,
      fragmentShader: /* glsl */ `uniform sampler2D map; varying float vA; varying vec3 vC;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.rgb, t.a * vA); if (gl_FragColor.a < 0.004) discard; }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
  }
  spawn(x, y, z, vx, vy, vz, life, s0, s1, a0, c0, c1 = c0, drag = 0, grav = 0) {
    if (this.n >= this.max) return;
    const i = this.n++, d = this.d, i3 = i * 3;
    d.p[i3] = x; d.p[i3 + 1] = y; d.p[i3 + 2] = z;
    d.v[i3] = vx; d.v[i3 + 1] = vy; d.v[i3 + 2] = vz;
    d.c0[i3] = c0[0]; d.c0[i3 + 1] = c0[1]; d.c0[i3 + 2] = c0[2];
    d.c1[i3] = c1[0]; d.c1[i3 + 1] = c1[1]; d.c1[i3 + 2] = c1[2];
    d.life[i] = 0; d.maxLife[i] = life; d.s0[i] = s0; d.s1[i] = s1; d.a0[i] = a0; d.drag[i] = drag; d.grav[i] = grav;
  }
  update(dt, windZ) {
    const d = this.d, P = this.aPos.array, C = this.aCol.array, S = this.aSize.array, A = this.aAlpha.array;
    let j = 0;
    for (let i = 0; i < this.n; i++) {
      const life = d.life[i] + dt;
      if (life >= d.maxLife[i]) continue;
      const i3 = i * 3, j3 = j * 3;
      const k = Math.max(0, 1 - d.drag[i] * dt);
      const vx = d.v[i3] * k, vy = d.v[i3 + 1] * k - d.grav[i] * dt, vz = d.v[i3 + 2] * k;
      const px = d.p[i3] + vx * dt, py = d.p[i3 + 1] + vy * dt, pz = d.p[i3 + 2] + (vz + windZ) * dt;
      if (j !== i) {
        d.c0[j3] = d.c0[i3]; d.c0[j3 + 1] = d.c0[i3 + 1]; d.c0[j3 + 2] = d.c0[i3 + 2];
        d.c1[j3] = d.c1[i3]; d.c1[j3 + 1] = d.c1[i3 + 1]; d.c1[j3 + 2] = d.c1[i3 + 2];
        d.maxLife[j] = d.maxLife[i]; d.s0[j] = d.s0[i]; d.s1[j] = d.s1[i]; d.a0[j] = d.a0[i]; d.drag[j] = d.drag[i]; d.grav[j] = d.grav[i];
      }
      d.life[j] = life;
      d.p[j3] = px; d.p[j3 + 1] = py; d.p[j3 + 2] = pz;
      d.v[j3] = vx; d.v[j3 + 1] = vy; d.v[j3 + 2] = vz;
      const f = life / d.maxLife[j];
      P[j3] = px; P[j3 + 1] = py; P[j3 + 2] = pz;
      C[j3] = lerp(d.c0[j3], d.c1[j3], f); C[j3 + 1] = lerp(d.c0[j3 + 1], d.c1[j3 + 1], f); C[j3 + 2] = lerp(d.c0[j3 + 2], d.c1[j3 + 2], f);
      S[j] = lerp(d.s0[j], d.s1[j], Math.sqrt(f));
      A[j] = d.a0[j] * (f < 0.1 ? f * 10 : 1 - (f - 0.1) / 0.9);
      j++;
    }
    this.n = j;
    this.geo.setDrawRange(0, j);
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = true;
  }
}

// ---------- Modelle ----------
function makeJet(type, textures) {
  const phantom = type === 'phantom';
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hullTex = panelTex(phantom ? '#3a424c' : '#9aa8b6', phantom ? 'rgba(0,0,0,0.5)' : 'rgba(30,40,50,0.45)');
  textures.push(hullTex);
  const hull = new THREE.MeshStandardMaterial({ color: 0xffffff, map: hullTex, metalness: phantom ? 0.7 : 0.55, roughness: phantom ? 0.32 : 0.42 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14181d, metalness: 0.6, roughness: 0.5 });
  const accentCol = phantom ? new THREE.Color(0.2, 1.6, 2.2) : new THREE.Color(2.4, 0.9, 0.2);
  const accent = new THREE.MeshStandardMaterial({ color: phantom ? 0x1c5a6a : 0xc65a16, emissive: accentCol, emissiveIntensity: 0.35, metalness: 0.4, roughness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0b1d2c, metalness: 1, roughness: 0.06, emissive: new THREE.Color(0.02, 0.08, 0.12) });
  const L = phantom ? 8.4 : 7;
  // Rumpf (Drehkörper, Nase zeigt nach −Z)
  const prof = phantom
    ? [[0.5, 0], [0.62, 0.5], [0.7, 2.6], [0.66, 4.8], [0.52, 6.2], [0.3, 7.5], [0.0, 8.4]]
    : [[0.36, 0], [0.48, 0.5], [0.54, 2.4], [0.5, 4.2], [0.38, 5.4], [0.2, 6.4], [0.0, 7.0]];
  const fus = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 24);
  fus.rotateX(-Math.PI / 2); fus.translate(0, 0, L / 2); fus.scale(phantom ? 1.35 : 1, 0.82, 1);
  body.add(new THREE.Mesh(fus, hull));
  // Cockpithaube
  const can = new THREE.Mesh(new THREE.SphereGeometry(0.36, 18, 12), glass);
  can.scale.set(phantom ? 1.05 : 0.95, 0.75, 2.6); can.position.set(0, 0.36, -L * 0.24);
  body.add(can);
  // Flügel
  const wing = (pts, y, mat = hull, depth = 0.09) => {
    for (const m of [1, -1]) {
      const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x * m, z)));
      const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.03, bevelSegments: 1 });
      g.rotateX(Math.PI / 2); g.translate(0, y + depth / 2, 0);
      body.add(new THREE.Mesh(g, mat));
    }
  };
  if (phantom) {
    wing([[0.6, -2.6], [1.0, -1.0], [4.2, 1.6], [4.3, 2.5], [0.6, 3.0]], -0.05);
    wing([[2.6, 2.6], [1.4, 3.3], [0.9, 4.2], [2.9, 4.3]], 0.02); // Höhenleitwerk
    // Streifen an der Flügelvorderkante
    wing([[1.0, -1.0], [4.2, 1.6], [4.2, 1.82], [0.98, -0.75]], 0.0, accent, 0.03);
  } else {
    wing([[0.45, -1.2], [3.3, 1.5], [3.5, 2.2], [0.45, 2.5]], -0.12);
    wing([[0.4, 2.5], [1.7, 3.3], [1.75, 3.65], [0.4, 3.6]], 0.0);
    wing([[3.3, 1.5], [3.5, 2.2], [3.38, 2.2], [3.18, 1.55]], -0.11, accent, 0.11);
  }
  // Seitenleitwerk(e)
  const fin = (x, rotZ, pts) => {
    const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: false });
    g.rotateY(-Math.PI / 2); g.translate(0.035, 0, 0);
    const m = new THREE.Mesh(g, hull);
    m.position.set(x, 0.25, 0); m.rotation.z = rotZ;
    body.add(m);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.5), accent);
    tip.position.set(0, pts[2][1] - 0.05, pts[2][0] + 0.2); m.add(tip);
  };
  if (phantom) { fin(0.75, -0.35, [[1.6, 0], [2.6, 1.7], [3.1, 1.75], [3.9, 0]]); fin(-0.75, 0.35, [[1.6, 0], [2.6, 1.7], [3.1, 1.75], [3.9, 0]]); }
  else fin(0, 0, [[1.4, 0], [2.6, 1.9], [3.1, 1.95], [3.6, 0]]);
  // Lufteinlässe
  for (const m of [1, -1]) {
    const it = new THREE.Mesh(new THREE.BoxGeometry(phantom ? 0.55 : 0.36, 0.42, 2.6), dark);
    it.position.set(m * (phantom ? 0.95 : 0.62), -0.12, phantom ? -0.2 : 0.3);
    body.add(it);
  }
  // Triebwerke + Flammen
  const flames = [];
  const fTex = textures.flame;
  const nozX = phantom ? [-0.5, 0.5] : [0];
  const flameCol = phantom ? new THREE.Color(0.35, 0.8, 1.9) : new THREE.Color(1.9, 0.85, 0.28);
  for (const x of nozX) {
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.7, 18, 1, true), dark);
    noz.rotation.x = Math.PI / 2; noz.position.set(x, 0, L / 2 + 0.2);
    body.add(noz);
    const core = new THREE.Mesh(new THREE.CircleGeometry(0.33, 18), new THREE.MeshBasicMaterial({ color: flameCol.clone().multiplyScalar(0.9) }));
    core.position.set(x, 0, L / 2 + 0.1); body.add(core);
    for (const [r, len, mul] of [[0.3, 2.6, 0.45], [0.16, 1.5, 0.9]]) {
      const g = new THREE.ConeGeometry(r, len, 14, 1, true);
      g.translate(0, len / 2, 0); g.rotateX(Math.PI / 2);
      const f = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: fTex, color: flameCol.clone().multiplyScalar(mul), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      f.position.set(x, 0, L / 2 + 0.45);
      body.add(f); flames.push(f);
    }
  }
  // Raketen an Aufhängungen
  const missiles = [];
  const mBody = new THREE.MeshStandardMaterial({ color: 0xe8ecef, metalness: 0.3, roughness: 0.5 });
  const pylons = phantom ? [1.3, 2.0, 2.7] : [1.35, 2.25];
  for (const px of pylons) for (const m of [-1, 1]) {
    const mg = makeMissileMesh(mBody, accent);
    mg.position.set(m * px, -0.28, phantom ? 1.0 + px * 0.15 : 0.9 + px * 0.2);
    body.add(mg); missiles.push(mg);
  }
  // Positionslichter
  const navs = [];
  const tipX = phantom ? 4.25 : 3.4;
  for (const [x, c] of [[-tipX, [3, 0.15, 0.1]], [tipX, [0.15, 3, 0.4]]]) {
    const n = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(...c) }));
    n.position.set(x, -0.04, phantom ? 2.0 : 1.85); body.add(n); navs.push(n);
  }
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 4) }));
  strobe.position.set(0, phantom ? 0.3 : 2.1, L / 2 - 0.3); body.add(strobe);
  root.userData = { body, flames, missiles, strobe, L, nozzles: nozX.map((x) => new THREE.Vector3(x, 0, L / 2 + 0.5)) };
  return root;
}

function makeMissileMesh(mBody, accent) {
  const g = new THREE.Group();
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 1.1, 10), mBody);
  cyl.rotation.x = Math.PI / 2; g.add(cyl);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.28, 10), accent);
  nose.rotation.x = -Math.PI / 2; nose.position.z = -0.69; g.add(nose);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.22, 0.2), mBody);
    f.position.z = 0.45; f.rotation.z = (i * Math.PI) / 2; f.position.x = Math.sin((i * Math.PI) / 2) * 0.1; f.position.y = Math.cos((i * Math.PI) / 2) * 0.1;
    g.add(f);
  }
  return g;
}

function makeUfo(type, R, accentArr, textures) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const acc = new THREE.Color(...accentArr);
  const accHex = '#' + new THREE.Color(accentArr[0] / 3.5, accentArr[1] / 3.5, accentArr[2] / 3.5).getHexString();
  const tex = panelTex('#4a4f5c', 'rgba(0,0,0,0.55)');
  const emi = windowEmissive(accHex);
  textures.push(tex, emi);
  tex.wrapS = emi.wrapS = THREE.RepeatWrapping; tex.repeat.x = emi.repeat.x = Math.max(1, Math.round(R / 2));
  const hull = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, emissiveMap: emi, emissive: acc.clone().multiplyScalar(0.8), metalness: 0.88, roughness: 0.27 });
  const darkHull = new THREE.MeshStandardMaterial({ color: 0x1e2128, metalness: 0.8, roughness: 0.35 });
  const glow = new THREE.MeshBasicMaterial({ color: acc });
  const dome = new THREE.MeshStandardMaterial({ color: 0x101820, metalness: 1, roughness: 0.05, emissive: acc.clone().multiplyScalar(0.15) });
  const lathe = (pts, mat, seg = 48) => {
    const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r * R, y * R)), seg);
    const m = new THREE.Mesh(g, mat); body.add(m); return m;
  };
  const ring = (rad, y, tube) => { const m = new THREE.Mesh(new THREE.TorusGeometry(rad * R, tube * R, 8, 64), glow); m.rotation.x = Math.PI / 2; m.position.y = y * R; body.add(m); return m; };
  // Grundscheibe
  const thick = type === 'freighter' ? 1.5 : type === 'battleship' ? 1.15 : type === 'fighter' ? 0.8 : 1;
  lathe([[0.001, -0.18 * thick], [0.4, -0.17 * thick], [0.8, -0.09 * thick], [1.0, 0], [0.84, 0.08 * thick], [0.47, 0.15 * thick], [0.3, 0.17 * thick], [0.001, 0.175 * thick]], hull);
  ring(0.985, 0, 0.018);
  const lights = new THREE.Group(); body.add(lights);
  const nL = type === 'battleship' ? 28 : type === 'freighter' ? 20 : 14;
  const lg = new THREE.SphereGeometry(0.035 * R, 8, 6);
  for (let i = 0; i < nL; i++) {
    const a = (i / nL) * Math.PI * 2;
    const m = new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ color: acc.clone() }));
    m.position.set(Math.cos(a) * 0.9 * R, -0.07 * R * thick, Math.sin(a) * 0.9 * R);
    lights.add(m);
  }
  // Kuppel
  const dm = new THREE.Mesh(new THREE.SphereGeometry(0.3 * R, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), dome);
  dm.position.y = 0.15 * R * thick; dm.scale.y = type === 'fighter' ? 0.55 : 0.8; body.add(dm);
  // Unterseite: Antriebsfeld
  const emitter = new THREE.Mesh(new THREE.CircleGeometry(0.32 * R, 32), new THREE.MeshBasicMaterial({ map: textures.glow, color: acc.clone().multiplyScalar(1.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  emitter.rotation.x = Math.PI / 2; emitter.position.y = -0.185 * R * thick; body.add(emitter);
  ring(0.32, -0.18 * thick, 0.012);
  if (type === 'fighter') {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
      const s = new THREE.Shape([new THREE.Vector2(0, -0.12 * R), new THREE.Vector2(0.55 * R, 0), new THREE.Vector2(0, 0.12 * R)]);
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.03 * R, bevelEnabled: false });
      g.translate(0, 0, -0.015 * R); g.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(g, darkHull); m.position.set(Math.cos(a) * 0.82 * R, 0, Math.sin(a) * 0.82 * R); m.rotation.y = -a;
      body.add(m);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.03 * R, 8, 6), glow); tip.position.set(Math.cos(a) * 1.36 * R, 0, Math.sin(a) * 1.36 * R); body.add(tip);
    }
  }
  if (type === 'freighter') {
    ring(0.62, -0.2, 0.014);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.09 * R, 0.32 * R, 6, 12), darkHull);
      pod.rotation.z = Math.PI / 2; pod.rotation.y = -a; pod.position.set(Math.cos(a) * 0.6 * R, -0.25 * R, Math.sin(a) * 0.6 * R);
      body.add(pod);
    }
  }
  if (type === 'battleship') {
    lathe([[0.001, 0.15], [0.52, 0.17], [0.5, 0.26], [0.36, 0.33], [0.2, 0.36], [0.001, 0.37]], hull);
    ring(0.5, 0.2, 0.012); ring(0.7, -0.15, 0.012);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.05 * R, 0.4 * R, 8), darkHull);
      sp.position.set(Math.cos(a) * 1.12 * R, 0, Math.sin(a) * 1.12 * R); sp.rotation.z = -Math.PI / 2; sp.rotation.y = -a;
      body.add(sp);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.025 * R, 8, 6), glow); tip.position.set(Math.cos(a) * 1.32 * R, 0, Math.sin(a) * 1.32 * R); body.add(tip);
    }
    dm.position.y = 0.36 * R; dm.scale.setScalar(0.6);
  }
  // Waffen-Ladeleuchten (Vorderseite, zum Jäger hin)
  const charge = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.glow, color: acc.clone().multiplyScalar(1.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  charge.position.set(0, -0.05 * R, 1.02 * R); charge.scale.setScalar(0.01); root.add(charge);
  root.userData = { body, lights, charge, emitter, acc, R };
  return root;
}

// ---------- Hauptfunktion ----------
export function runAirCombat({ engine, geo, craft, ufo, craftSpec, ufoSpec, overLand, onEnd }) {
  const hud = document.getElementById('hud');
  const W = CRAFT_WEAPON[craft.type] || { name: 'Raketen', range: 6 + craftSpec.acc * 4, ammo: 16, salvo: 2, reload: 2.2 };
  const U = UFO_WEAPON[ufo.type] || { range: 6, reload: 1.6, kind: 'plasma', aggressive: false, R: (ufoSpec.radius || 4) * 1.4, accent: [0.4, 3, 1.6] };
  const R = U.R;
  const closing = 260 * (craftSpec.speed || 0.008); // km/s beim Annähern
  const ufoDrift = 110 * (ufoSpec.speed || 0.004); // km/s Fluchtdrift des UFOs
  const safeStandoff = W.range > U.range + 0.6;
  const standoffKm = safeStandoff ? Math.min(W.range - 0.4, U.range + 1.0) : W.range - 0.3;
  const cheats = Game.cheats || {};

  const unsubs = [];
  const textures = [];
  let ended = false, finished = false;
  let overlay = null;
  let pmremRT = null;
  const view = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(55, 1, 0.1, 6000), update: null, onResize: null };
  const { scene, camera } = view;

  // Zustand
  const S = {
    state: 'intro', t: 0, introT: 9, paused: false, d: START_KM, visD: START_KM + 6,
    maneuver: 'approach', evadeT: 0, evadeCd: 0, abortArm: 0, ammo: W.ammo, reload: 0, queued: false,
    fuel: FUEL_S, ufoCd: U.reload * 1.5, chargeT: 0, endT: 0, result: null, endReason: '', shake: 0,
    noAmmoT: 0, travel: 0, timeScale: 1, tipHover: null, lastHint: '', craftHp0: craftSpec.hp, ufoHp0: ufoSpec.hp,
  };
  const missiles = [], bolts = [], beams = [], flashes = [];

  const restore = () => {
    if (finished) return; finished = true;
    unsubs.forEach((f) => { try { f(); } catch { /* */ } });
    overlay?.remove();
    try {
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach((m) => m.dispose());
      });
      textures.forEach((t) => t?.dispose?.());
      pmremRT?.dispose();
    } catch (e) { console.warn(e); }
    hud.style.display = '';
    if (engine.active === view) { engine.setMode(geo); geo.active = true; }
    engine.resetHistory?.();
    setMusicMood('geo');
  };

  // ================= Szene =================
  let sky, ground, cloudLow, cloudHigh, jet, ufoObj, smoke, fire, puffs, flashLight, sunLight, preset;
  function buildScene() {
    preset = SKIES[globalThis.__acSky ?? (rand() < 0.7 ? 0 : 1)];
    const sunDir = new THREE.Vector3(...preset.sunDir).normalize();
    const zen = new THREE.Color(...preset.zenith), hor = new THREE.Color(...preset.horizon), sunC = new THREE.Color(...preset.sun);
    textures.glow = glowTex(); textures.flame = flameTex(); textures.smoke = smokeTex(); textures.cloud = cloudTex();
    textures.push(textures.glow, textures.flame, textures.smoke, textures.cloud);
    scene.background = hor.clone();
    scene.fog = new THREE.Fog(hor.clone(), 500, 3200);

    // Himmel
    const skyMat = new THREE.ShaderMaterial({
      uniforms: { zen: { value: zen }, hor: { value: hor }, sunC: { value: sunC }, sunDir: { value: sunDir } },
      vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: /* glsl */ `uniform vec3 zen, hor, sunC, sunDir; varying vec3 vDir;
        void main(){ vec3 d = normalize(vDir); float h = d.y;
          vec3 col = mix(hor, zen, pow(clamp(h, 0.0, 1.0), 0.5));
          col = mix(col, hor * 0.85, smoothstep(0.0, -0.2, h));
          float s = max(dot(d, sunDir), 0.0);
          col += sunC * (pow(s, 900.0) * 24.0 + pow(s, 60.0) * 0.35 + pow(s, 6.0) * 0.1);
          gl_FragColor = vec4(col, 1.0); }`,
      side: THREE.BackSide, depthWrite: false,
    });
    sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), skyMat);
    sky.renderOrder = -10; sky.frustumCulled = false;
    scene.add(sky);
    // Umgebungsreflexionen für Metallflächen
    try {
      const envScene = new THREE.Scene();
      envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), skyMat));
      const low = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: overLand ? 0x1c2a14 : 0x0a1e2c }));
      low.rotation.x = -Math.PI / 2; low.position.y = -30; envScene.add(low);
      const pm = new THREE.PMREMGenerator(engine.renderer);
      pmremRT = pm.fromScene(envScene, 0.04, 0.1, 500);
      pm.dispose();
      low.geometry.dispose(); low.material.dispose(); envScene.children[0].geometry.dispose();
      scene.environment = pmremRT.texture;
      scene.environmentIntensity = 0.9;
    } catch (e) { console.warn('Env-Map nicht verfügbar', e); }

    // Licht
    sunLight = new THREE.DirectionalLight(sunC, 3.2);
    sunLight.position.copy(sunDir).multiplyScalar(100);
    scene.add(sunLight);
    const fill = new THREE.DirectionalLight(new THREE.Color(0.6, 0.75, 1.0), 0.9);
    fill.position.set(0.4, 0.6, 1); scene.add(fill);
    scene.add(new THREE.HemisphereLight(zen.clone().lerp(new THREE.Color(1, 1, 1), 0.4), overLand ? 0x2a3020 : 0x0c2030, 1.1));
    flashLight = new THREE.PointLight(0xffaa55, 0, 160, 1.6);
    scene.add(flashLight);

    // Boden: Ozean oder Land
    const groundMat = new THREE.ShaderMaterial({
      uniforms: { uLand: { value: overLand ? 1 : 0 }, uOff: { value: new THREE.Vector2() }, uSun: { value: sunDir }, uFog: { value: hor }, uSky: { value: zen.clone().lerp(hor, 0.6) }, uSunC: { value: sunC }, uTime: { value: 0 } },
      vertexShader: WORLD_VS,
      fragmentShader: /* glsl */ `uniform float uLand, uTime; uniform vec2 uOff; uniform vec3 uSun, uFog, uSky, uSunC; varying vec3 vW;
        ${VNOISE}
        void main(){
          vec2 p = vW.xz + uOff;
          float dist = length(vW - cameraPosition);
          vec3 V = normalize(cameraPosition - vW);
          vec3 col;
          if (uLand > 0.5) {
            float n = fbm(p * 0.0011), m = fbm(p * 0.006 + 3.0);
            col = mix(vec3(0.05, 0.12, 0.035), vec3(0.16, 0.19, 0.07), smoothstep(0.35, 0.65, m));
            col = mix(col, vec3(0.24, 0.19, 0.11), smoothstep(0.58, 0.78, n));
            col *= 0.75 + 0.5 * hash(floor(p * 0.012));
            col = mix(col, vec3(0.03, 0.07, 0.11), smoothstep(0.31, 0.27, n));
            float cs = smoothstep(0.52, 0.72, fbm((p + vec2(uTime * 9.0, 0.0)) * 0.0016));
            col *= (0.7 + 0.6 * max(uSun.y, 0.1)) * (1.0 - 0.4 * cs) * 1.4;
          } else {
            vec2 q = p * 0.03 + vec2(uTime * 0.12, uTime * 0.07);
            float h0 = fbm(q), hx = fbm(q + vec2(0.07, 0.0)), hz = fbm(q + vec2(0.0, 0.07));
            vec3 N = normalize(vec3((h0 - hx) * 4.0, 1.0, (h0 - hz) * 4.0));
            float fres = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
            col = mix(vec3(0.006, 0.035, 0.07), vec3(0.015, 0.1, 0.13), h0);
            col = mix(col, uSky, fres);
            vec3 H = normalize(uSun + V);
            col += uSunC * pow(max(dot(N, H), 0.0), 220.0) * 3.0;
          }
          float fog = 1.0 - exp(-dist * 0.00085);
          gl_FragColor = vec4(mix(col, uFog, clamp(fog, 0.0, 1.0)), 1.0);
        }`,
    });
    ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), groundMat);
    ground.rotation.x = -Math.PI / 2; ground.position.y = -170; ground.frustumCulled = false;
    scene.add(ground);

    // Wolkenschichten (Shader)
    const cloudMat = (y, scale, cover, alpha) => new THREE.ShaderMaterial({
      uniforms: { uOff: { value: new THREE.Vector2() }, uFog: { value: hor }, uSunC: { value: sunC }, uCloud: { value: new THREE.Color(...preset.cloud) }, uScale: { value: scale }, uCover: { value: cover }, uAlpha: { value: alpha }, uSun: { value: sunDir } },
      vertexShader: WORLD_VS,
      fragmentShader: /* glsl */ `uniform vec2 uOff; uniform vec3 uFog, uSunC, uCloud, uSun; uniform float uScale, uCover, uAlpha; varying vec3 vW;
        ${VNOISE}
        void main(){
          vec2 p = (vW.xz + uOff) * uScale;
          float n = fbm(p);
          float c = smoothstep(uCover, uCover + 0.22, n);
          float dist = length(vW - cameraPosition);
          float shade = mix(0.68, 1.08, smoothstep(uCover, uCover + 0.35, fbm(p + vec2(0.04, 0.06) * uSun.xz)));
          vec3 col = uCloud * shade * (0.75 + 0.35 * max(uSun.y, 0.0));
          float fog = clamp(1.0 - exp(-dist * 0.0007), 0.0, 1.0);
          col = mix(col, uFog, fog * 0.85);
          gl_FragColor = vec4(col, c * uAlpha * (1.0 - smoothstep(2600.0, 4200.0, dist)));
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    cloudLow = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), cloudMat(-70, 0.0018, 0.5, 0.95));
    cloudLow.rotation.x = -Math.PI / 2; cloudLow.position.y = -70; cloudLow.frustumCulled = false; cloudLow.renderOrder = -2;
    scene.add(cloudLow);
    cloudHigh = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), cloudMat(260, 0.0009, 0.55, 0.55));
    cloudHigh.rotation.x = Math.PI / 2; cloudHigh.position.y = 260; cloudHigh.frustumCulled = false; cloudHigh.renderOrder = -3;
    scene.add(cloudHigh);
    // vorbeiziehende Wolkenballen (Geschwindigkeitsgefühl)
    puffs = [];
    const puffMat = new THREE.SpriteMaterial({ map: textures.cloud, color: new THREE.Color(...preset.cloud), transparent: true, depthWrite: false, fog: true, opacity: 0.5 });
    for (let i = 0; i < 34; i++) {
      const s = new THREE.Sprite(puffMat);
      placePuff(s, randRange(-1500, 60));
      scene.add(s); puffs.push(s);
    }

    // Partikel
    smoke = new Particles(1800, textures.smoke, false);
    fire = new Particles(1400, textures.glow, true);
    scene.add(smoke.points, fire.points);

    // Jäger und UFO
    jet = makeJet(craft.type, textures);
    scene.add(jet);
    ufoObj = makeUfo(ufo.type, R, U.accent, textures);
    scene.add(ufoObj);
    jet.position.set(0, 0, 0);
    ufoObj.position.set(0, 3, -visDist(S.visD));
    syncPylons();
    camera.position.set(0, 3, 12);
    camera.lookAt(0, 1, -40);
  }
  function placePuff(s, z) {
    let x = randRange(-800, 800), y = randRange(-60, 90);
    if (Math.abs(x) < 120) x = Math.sign(x || 1) * randRange(120, 260);
    s.position.set(x, y, z);
    const sc = randRange(60, 150);
    s.scale.set(sc * 1.8, sc, 1);
  }
  function visDist(d) { return 12 + R * 1.25 + d * 6; }
  function syncPylons() {
    const ms = jet.userData.missiles;
    const vis = Math.ceil((S.ammo / W.ammo) * ms.length);
    ms.forEach((m, i) => { m.visible = i < vis; });
  }

  // ================= HUD =================
  let $ = {};
  const keyOf = { approach: ['1', 'UP'], standoff: ['2', 'DOWN'], evade: ['3', 'X'], fire: ['Leertaste', 'A'], abort: ['5', 'B'] };
  const hint = (cmd) => {
    const dv = Input.lastDevice;
    const k = keyOf[cmd]; if (!k) return '';
    if (dv === 'touch') return '';
    if (dv === 'pad') return k[1] === 'UP' ? '▲' : k[1] === 'DOWN' ? '▼' : padLabel(k[1]);
    return k[0];
  };
  const tipText = (cmd) => ({
    approach: `<b>Annähern:</b> Entfernung verringern – bessere Trefferchance, aber in der roten Zone schießt das UFO zurück.`,
    standoff: safeStandoff
      ? `<b>Auf Distanz bleiben:</b> hält ${km(standoffKm)} km – in deiner Raketenreichweite, aber außerhalb der UFO-Waffe (${km(U.range)} km).`
      : `<b>Auf Distanz bleiben:</b> hält deine maximale Reichweite (${km(standoffKm)} km). Achtung: Die UFO-Waffe reicht weiter (${km(U.range)} km)!`,
    evade: `<b>Ausweichen:</b> ca. 2 s lang kaum zu treffen, eigenes Feuer pausiert. Ideal, wenn das UFO seine Waffe lädt (⚠).`,
    fire: `<b>Feuer frei:</b> Salve aus ${W.salvo} Raketen. Nur in Reichweite (blaue Zone) und wenn nachgeladen – sonst wird sie vorgemerkt.`,
    abort: `<b>Abbrechen:</b> Gefecht beenden und zur Basis zurückkehren. Das UFO bleibt beschädigt in der Luft.`,
  })[cmd] || '';

  function buildHud() {
    overlay = document.createElement('div');
    overlay.className = 'ac-root';
    overlay.id = 'aircombat';
    const pct = (v) => `${clamp((v / ESCAPE_KM) * 100, 0, 100)}%`;
    const cmdBtn = (cmd, icon, label) => `<button class="btn ac-cmd" data-cmd="${cmd}" tabindex="-1"><span class="ac-ico">${icon}</span><span class="ac-lbl">${label}</span><span class="ac-key" data-key="${cmd}"></span><i class="ac-cd"></i></button>`;
    overlay.innerHTML = `
      <div class="ac-top">
        <div class="ac-hull own"><div class="ac-nm">✈ ${craft.name} <small>${craftSpec.name}</small></div><div class="ac-bar good"><i></i><span></span></div></div>
        <div class="ac-mid"><div class="ac-fuel"><small>Treibstoff</small><b></b><div class="ac-fbar"><i></i></div></div><button class="btn ac-pausebtn" tabindex="-1" aria-label="Pause">❚❚</button></div>
        <div class="ac-hull ufo"><div class="ac-nm">⬣ ${ufo.name} <small>${ufoSpec.name}</small></div><div class="ac-bar bad"><i></i><span></span></div></div>
      </div>
      <div class="ac-gauge">
        <div class="ac-track">
          <div class="ac-zone own" style="width:${pct(W.range)}"></div>
          <div class="ac-zone ufo" style="width:${pct(U.range)}"></div>
          <div class="ac-zone esc" style="left:${pct(ESCAPE_KM - 2.5)}"></div>
          <div class="ac-tick" style="left:${pct(standoffKm)}"></div>
          <div class="ac-marker"><span></span></div>
        </div>
        <div class="ac-legend"><span class="own">▬ Deine Raketen ${km(W.range)} km</span><span class="ufo">▬ UFO-Waffe ${km(U.range)} km</span><span class="esc">▬ UFO entkommt ab ${ESCAPE_KM} km</span></div>
        <div class="ac-chance"></div>
      </div>
      <div class="ac-log"></div>
      <div class="ac-bracket"><i></i><i></i><i></i><i></i><span></span></div>
      <div class="ac-floats"></div>
      <div class="ac-warn">⚠ UFO lädt Waffe – <span data-hint="evade"></span> Ausweichen!</div>
      <div class="ac-bottom">
        <div class="ac-status">
          <div class="ac-weapon"><div class="ac-wtitle">${W.name} <b class="ac-ammo"></b></div><div class="ac-pips"></div><div class="ac-reload"><i></i><span></span></div></div>
          <div class="ac-man">Manöver: <b></b></div>
        </div>
        <div class="ac-tip"></div>
        <div class="ac-cmds">
          ${cmdBtn('approach', '⏩', 'Annähern')}${cmdBtn('standoff', '↔', 'Distanz')}${cmdBtn('evade', '↯', 'Ausweichen')}${cmdBtn('fire', '✸', 'Feuer frei')}${cmdBtn('abort', '⮌', 'Abbrechen')}
        </div>
      </div>
      <div class="ac-intro panel">
        <h3>Abfangeinsatz: ${craft.name} gegen ${ufo.name}</h3>
        <p class="ac-goal"><b>Ziel:</b> UFO-Hülle auf 0 bringen, bevor dein Jäger zerstört wird oder das UFO entkommt.</p>
        <ul>
          <li><b>Blaue Zone</b> = Reichweite deiner Raketen (${km(W.range)} km), <b class="bad">rote Zone</b> = Reichweite der UFO-Waffe (${km(U.range)} km).</li>
          <li>${safeStandoff ? 'Du hast die größere Reichweite: Mit <b>„Auf Distanz bleiben“</b> feuerst du aus sicherer Entfernung.' : 'Das UFO schießt weiter als du: Nähere dich und nutze <b>„Ausweichen“</b>, sobald es seine Waffe lädt (⚠).'}</li>
          <li><b>„Feuer frei“</b> schießt eine Salve. ${W.ammo} Raketen an Bord, Nachladen ${km(W.reload)} s.</li>
          <li>Über ${ESCAPE_KM} km Abstand oder ohne Treibstoff entkommt das UFO.</li>
        </ul>
        <p class="ac-keys"><span class="kb">Tastatur: <kbd>1</kbd>–<kbd>5</kbd>, <kbd>Leertaste</kbd> Feuer, <kbd>Esc</kbd> Pause</span><span class="gp">Controller: ${padLabel('A')} Feuer · ${padLabel('X')} Ausweichen · ▲/▼ Annähern/Distanz · ${padLabel('B')} Abbrechen · ${padLabel('START')} Pause</span></p>
        <button class="btn primary ac-go" tabindex="-1">Los! <span></span></button>
      </div>
      <div class="ac-pause panel" hidden>
        <h3>Pause</h3>
        <p class="muted">Der Luftkampf ist angehalten.</p>
        <div class="ac-pbtns"><button class="btn primary" data-p="resume" tabindex="-1">▶ Weiter <small>(Esc / ${padLabel('A')})</small></button><button class="btn danger" data-p="flee" tabindex="-1">⮌ Rückzug <small>(${padLabel('B')})</small></button></div>
      </div>
      <div class="ac-banner"></div>`;
    document.body.appendChild(overlay);
    const q = (s) => overlay.querySelector(s);
    $ = {
      ownBar: q('.ac-hull.own .ac-bar i'), ownTxt: q('.ac-hull.own .ac-bar span'), ufoBar: q('.ac-hull.ufo .ac-bar i'), ufoTxt: q('.ac-hull.ufo .ac-bar span'),
      ownHull: q('.ac-hull.own'), ufoHull: q('.ac-hull.ufo'),
      fuel: q('.ac-fuel b'), fuelBar: q('.ac-fbar i'), marker: q('.ac-marker'), markerTxt: q('.ac-marker span'), chance: q('.ac-chance'),
      log: q('.ac-log'), bracket: q('.ac-bracket'), bracketTxt: q('.ac-bracket span'), floats: q('.ac-floats'), warn: q('.ac-warn'),
      ammo: q('.ac-ammo'), pips: q('.ac-pips'), reloadBar: q('.ac-reload i'), reloadTxt: q('.ac-reload span'), man: q('.ac-man b'),
      tip: q('.ac-tip'), intro: q('.ac-intro'), go: q('.ac-go span'), pause: q('.ac-pause'), banner: q('.ac-banner'),
      cmds: [...overlay.querySelectorAll('.ac-cmd')],
    };
    $.pips.innerHTML = Array.from({ length: W.ammo }, () => '<i></i>').join('');
    $.pipEls = [...$.pips.children];
    for (const b of $.cmds) {
      b.addEventListener('click', (e) => { e.preventDefault(); b.blur(); command(b.dataset.cmd); });
      b.addEventListener('pointerenter', () => { S.tipHover = b.dataset.cmd; });
      b.addEventListener('pointerleave', () => { if (S.tipHover === b.dataset.cmd) S.tipHover = null; });
    }
    q('.ac-pausebtn').addEventListener('click', (e) => { e.currentTarget.blur(); togglePause(); });
    q('.ac-go').addEventListener('click', (e) => { e.currentTarget.blur(); startFight(); });
    q('[data-p="resume"]').addEventListener('click', () => togglePause(false));
    q('[data-p="flee"]').addEventListener('click', () => { togglePause(false); endCombat('flee', 'Rückzug befohlen.'); });
    refreshKeyHints();
    addLog(`Feindkontakt! ${ufoSpec.name} „${ufo.name}“ voraus.`, 'warn');
  }
  function refreshKeyHints() {
    if (!overlay) return;
    overlay.querySelectorAll('[data-key]').forEach((s) => { let h = hint(s.dataset.key); if (h === 'Leertaste') h = '␣'; s.textContent = h; s.style.display = h ? '' : 'none'; });
    overlay.querySelectorAll('[data-hint]').forEach((s) => { const h = hint(s.dataset.hint); s.textContent = h ? `${h} =` : ''; });
    overlay.dataset.device = Input.lastDevice;
  }
  function addLog(text, cls = '') {
    if (!$.log) return;
    const d = document.createElement('div');
    d.className = 'ac-ln ' + cls; d.innerHTML = text;
    $.log.prepend(d);
    while ($.log.children.length > 5) $.log.lastChild.remove();
    setTimeout(() => d.classList.add('old'), 6000);
  }
  function floatText(text, cls) {
    const r = $.bracket.getBoundingClientRect();
    const f = document.createElement('div');
    f.className = 'ac-float ' + cls; f.textContent = text;
    f.style.left = `${r.left + r.width / 2 + randRange(-20, 20)}px`; f.style.top = `${r.top - 8}px`;
    $.floats.appendChild(f);
    setTimeout(() => f.remove(), 1300);
  }
  function ownFloat(text) {
    const v = jet.position.clone().add(new THREE.Vector3(0, 1.5, 0)).project(camera);
    const f = document.createElement('div');
    f.className = 'ac-float bad'; f.textContent = text;
    f.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`; f.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
    $.floats.appendChild(f);
    setTimeout(() => f.remove(), 1300);
  }
  function showBanner(text, cls) { $.banner.innerHTML = text; $.banner.className = 'ac-banner show ' + cls; }

  // ================= Eingabe =================
  function bindInput() {
    unsubs.push(Input.on('keydown', (code) => {
      if (finished || ended) return;
      if (code === 'Escape' || code === 'KeyP') { togglePause(); return; }
      if (S.paused) { if (code === 'Enter' || code === 'Space') togglePause(false); return; }
      const map = {
        Digit1: 'approach', Numpad1: 'approach', ArrowUp: 'approach', KeyW: 'approach',
        Digit2: 'standoff', Numpad2: 'standoff', ArrowDown: 'standoff', KeyS: 'standoff',
        Digit3: 'evade', Numpad3: 'evade', KeyE: 'evade', ShiftLeft: 'evade',
        Digit4: 'fire', Numpad4: 'fire', Space: 'fire', KeyF: 'fire', Enter: 'fire',
        Digit5: 'abort', Numpad5: 'abort', Backspace: 'abort', KeyQ: 'abort',
      };
      if (map[code]) command(map[code]);
    }));
    unsubs.push(Input.on('pad', (b) => {
      if (finished || ended) return;
      if (b === 'START') { togglePause(); return; }
      if (S.paused) { if (b === 'A') togglePause(false); else if (b === 'B') { togglePause(false); endCombat('flee', 'Rückzug befohlen.'); } return; }
      const map = { A: 'fire', RT: 'fire', X: 'evade', LB: 'evade', UP: 'approach', DOWN: 'standoff', B: 'abort' };
      if (map[b]) command(map[b]);
    }));
    unsubs.push(Input.on('device', refreshKeyHints));
  }
  let stickPrev = 0;
  function pollStick() {
    const y = Input.axis?.(1) || 0;
    const dir = y < -0.6 ? -1 : y > 0.6 ? 1 : 0;
    if (dir !== stickPrev && dir) command(dir < 0 ? 'approach' : 'standoff');
    stickPrev = dir;
  }

  function togglePause(force) {
    if (ended) return;
    S.paused = force === undefined ? !S.paused : force;
    $.pause.hidden = !S.paused;
    overlay.classList.toggle('paused', S.paused);
    sfx('click');
  }
  function startFight() {
    if (S.state !== 'intro') return;
    S.state = 'fight';
    $.intro.classList.add('out');
    setTimeout(() => $.intro?.remove(), 400);
    addLog('Gefecht beginnt – Abfangkurs!', '');
  }

  function command(cmd) {
    if (ended || S.paused) return;
    if (S.state === 'intro') { startFight(); if (cmd === 'abort' || cmd === 'evade') return; }
    if (cmd !== 'abort') S.abortArm = 0;
    switch (cmd) {
      case 'approach': case 'standoff':
        if (S.maneuver !== cmd) { S.maneuver = cmd; sfx('select'); addLog(cmd === 'approach' ? 'Manöver: Annähern.' : `Manöver: Auf Distanz bleiben (${km(standoffKm)} km).`); }
        break;
      case 'evade':
        if (S.evadeT > 0) break;
        if (S.evadeCd > 0) { sfx('deny'); addLog(`Ausweichen erst in ${km(S.evadeCd)} s wieder möglich.`); break; }
        S.evadeT = 2.2; S.evadeCd = 5.5; sfx('select'); addLog('Ausweichmanöver! Feuer pausiert.', 'warn');
        break;
      case 'fire': tryFire(true); break;
      case 'abort':
        if (S.abortArm > 0) { endCombat('flee', 'Rückzug befohlen.'); }
        else { S.abortArm = 2.5; sfx('deny'); addLog(`Wirklich abbrechen? Erneut <b>Abbrechen</b>${hint('abort') ? ` (${hint('abort')})` : ''} drücken.`, 'warn'); }
        break;
    }
  }

  function hitChanceOwn(d) { return clamp((craftSpec.acc || 0.6) * (1.25 - 0.5 * d / W.range), 0.1, 0.95); }
  function hitChanceUfo(d) { return clamp(0.62 * (1.2 - 0.5 * d / U.range), 0.08, 0.9) * (S.evadeT > 0 ? 0.22 : 1); }

  function tryFire(manual) {
    if (S.state !== 'fight') return;
    if (S.ammo <= 0) { if (manual) { sfx('deny'); addLog('Keine Raketen mehr!', 'bad'); } return; }
    const inRange = S.d <= W.range;
    if (S.evadeT > 0 || S.reload > 0 || !inRange) {
      if (manual) {
        if (!S.queued) addLog(!inRange ? 'Außer Reichweite – Salve vorgemerkt, nähere dich an!' : S.evadeT > 0 ? 'Ausweichmanöver – Salve folgt danach.' : 'Lade nach – Salve vorgemerkt.', !inRange ? 'warn' : '');
        S.queued = true;
      }
      return;
    }
    S.queued = false;
    const n = Math.min(W.salvo, S.ammo);
    S.ammo -= n; S.reload = W.reload;
    for (let i = 0; i < n; i++) setTimeout(() => { if (!finished) launchMissile(i); }, i * 160);
    syncPylons();
    addLog(`Salve abgefeuert (${n} Raketen) – Trefferchance ${Math.round(hitChanceOwn(S.d) * 100)} %.`);
    Input.rumble(0.2, 0.4, 90);
  }

  // ================= Waffen & Effekte =================
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
  function launchMissile(i) {
    if (!jet) return;
    const side = i % 2 ? 1 : -1;
    const start = jet.localToWorld(new THREE.Vector3(side * 1.8, -0.4, 0.8));
    const hit = cheats.oneHit || rand() < hitChanceOwn(S.d);
    const dmg = cheats.oneHit ? 99999 : Math.round((craftSpec.dmg || 50) * randRange(0.75, 1.25));
    const mesh = makeMissileMesh(new THREE.MeshStandardMaterial({ color: 0xe8ecef, metalness: 0.3, roughness: 0.5 }), new THREE.MeshStandardMaterial({ color: 0xaa2200, emissive: new THREE.Color(1, 0.2, 0) }));
    const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.glow, color: new THREE.Color(2.2, 1.2, 0.45), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    fl.scale.setScalar(1.4); fl.position.z = 0.7; mesh.add(fl);
    mesh.position.copy(start);
    scene.add(mesh);
    const off = hit
      ? new THREE.Vector3(randRange(-0.5, 0.5) * R, randRange(-0.1, 0.12) * R, R * 0.6)
      : new THREE.Vector3((rand() < 0.5 ? -1 : 1) * R * randRange(1.6, 2.6), randRange(-0.8, 0.8) * R, randRange(-R, R));
    const ctrl = new THREE.Vector3(side * randRange(3, 6), randRange(-2.5, 1), -randRange(10, 16));
    const dist = start.distanceTo(ufoObj.position);
    missiles.push({ mesh, start, ctrl, off, hit, dmg, t: 0, dur: 0.55 + dist / 85, last: start.clone(), over: 0 });
    sfx('plasma');
  }
  function bez(p0, p1, p2, t, out) {
    const u = 1 - t;
    return out.set(u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y, u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z);
  }
  function trail(from, to, spacing, emit) {
    const len = from.distanceTo(to);
    const n = Math.min(12, Math.ceil(len / spacing));
    for (let k = 0; k < n; k++) { _v2.lerpVectors(from, to, (k + rand()) / n); emit(_v2); }
  }
  function updateMissiles(dt) {
    for (let i = missiles.length - 1; i >= 0; i--) {
      const m = missiles[i];
      const target = _v.copy(ufoObj.position).add(m.off);
      const p = new THREE.Vector3();
      if (m.over <= 0) {
        m.t += dt / m.dur;
        const s = Math.min(1, m.t);
        const e = s * s * (1.6 - 0.6 * s);
        bez(m.start, _v2.copy(m.start).add(m.ctrl), target, e, p);
      } else {
        p.copy(m.mesh.position).addScaledVector(m.dir, dt * 120);
        m.over += dt;
      }
      m.mesh.lookAt(m.mesh.position.x * 2 - p.x, m.mesh.position.y * 2 - p.y, m.mesh.position.z * 2 - p.z); // +Z nach hinten, Nase (−Z) voraus
      m.mesh.position.copy(p);
      trail(m.last, p, 0.7, (q) => smoke.spawn(q.x, q.y, q.z, randRange(-0.6, 0.6), randRange(-0.3, 0.6), randRange(-0.6, 0.6), randRange(1.2, 1.8), 0.7, 3.4, 0.55, [0.86, 0.86, 0.88], [0.6, 0.6, 0.64], 0.8));
      fire.spawn(p.x, p.y, p.z, 0, 0, 0, 0.12, 0.8, 0.3, 0.9, [2, 1.1, 0.4]);
      m.last.copy(p);
      if (m.over <= 0 && m.t >= 1) {
        if (m.hit && S.result !== 'lost') {
          impact(p, 1.2);
          scene.remove(m.mesh); disposeObj(m.mesh); missiles.splice(i, 1);
          applyUfoDamage(m.dmg);
        } else {
          m.dir = _v2.copy(p).sub(m.start).normalize().clone(); m.over = 0.001;
          if (!m.reported) { m.reported = true; if (!ended) { addLog('Rakete verfehlt das Ziel.'); floatText('DANEBEN', 'miss'); } }
        }
      } else if (m.over > 0.9) {
        explosion(p, 0.5, false);
        scene.remove(m.mesh); disposeObj(m.mesh); missiles.splice(i, 1);
      }
    }
  }
  function disposeObj(o) {
    o.traverse((c) => { c.geometry?.dispose?.(); c.material?.dispose?.(); }); // geteilte Texturen bleiben erhalten
  }
  function applyUfoDamage(dmg) {
    if (ended && S.result !== 'win') return; // nach Rückzug/Flucht zählt kein Schaden mehr
    ufo.hp -= dmg;
    sfx('hit');
    S.ufoFlash = 0.25;
    if (!ended) {
      addLog(`<b>Treffer!</b> ${dmg >= 99999 ? 'Volltreffer' : dmg + ' Schaden'} am UFO.`, 'good');
      floatText(dmg >= 99999 ? 'VOLLTREFFER' : `−${dmg}`, 'hit');
    }
    if (ufo.hp <= 0 && !ended) { ufo.hp = 0; endCombat('win', `${ufo.name} abgeschossen!`); }
  }

  function ufoFire() {
    const hit = rand() < hitChanceUfo(S.d);
    const dmg = cheats.god ? 0 : Math.round((ufoSpec.dmg || 30) * randRange(0.6, 1.3));
    const from = ufoObj.localToWorld(new THREE.Vector3(0, -0.05 * R, 1.02 * R));
    const aimOff = hit ? new THREE.Vector3(randRange(-0.6, 0.6), randRange(-0.2, 0.3), randRange(-1, 1)) : new THREE.Vector3((rand() < 0.5 ? -1 : 1) * randRange(3, 6), randRange(-2, 2.5), randRange(-2, 4));
    if (U.kind === 'beam') {
      const to = jet.position.clone().add(aimOff);
      if (!hit) to.addScaledVector(to.clone().sub(from).normalize(), 60);
      makeBeam(from, to);
      sfx('beam');
      if (hit) onCraftHit(dmg, jet.position.clone().add(aimOff));
      else if (!ended) addLog('UFO-Strahl verfehlt dich knapp.');
    } else {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.glow, color: ufoObj.userData.acc.clone().multiplyScalar(1.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      spr.scale.setScalar(2.4 + R * 0.15);
      spr.position.copy(from);
      scene.add(spr);
      bolts.push({ spr, from, off: aimOff, hit, dmg, t: 0, dur: 0.38 + S.d * 0.03, last: from.clone() });
      sfx('laser');
    }
  }
  function makeBeam(from, to) {
    const len = from.distanceTo(to);
    const grp = new THREE.Group();
    const col = ufoObj.userData.acc;
    for (const [r, mul, op] of [[0.1, 2.6, 1], [0.38, 1.1, 0.55], [0.95, 0.55, 0.3]]) {
      const g = new THREE.CylinderGeometry(r, r, len, 10, 1, true);
      g.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(mul), transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.userData.op = op;
      grp.add(m);
    }
    grp.position.copy(from).lerp(to, 0.5);
    grp.lookAt(to);
    scene.add(grp);
    beams.push({ grp, t: 0, dur: 0.35 });
    flash(from, 4 + R * 0.4, col, 0.2); // Mündungsblitz
  }
  function updateBolts(dt) {
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      b.t += dt / b.dur;
      const target = _v.copy(jet.position).add(b.off);
      const p = new THREE.Vector3().lerpVectors(b.from, target, Math.min(b.t, 1.6));
      b.spr.position.copy(p);
      const c = ufoObj.userData.acc;
      trail(b.last, p, 1.2, (q) => fire.spawn(q.x, q.y, q.z, randRange(-1, 1), randRange(-1, 1), randRange(-1, 1), 0.35, 1.4, 0.2, 0.8, [c.r, c.g, c.b], [c.r * 0.3, c.g * 0.3, c.b * 0.3]));
      b.last.copy(p);
      if (b.t >= 1 && !b.done) {
        b.done = true;
        if (b.hit) { onCraftHit(b.dmg, p.clone()); scene.remove(b.spr); b.spr.material.dispose(); bolts.splice(i, 1); continue; }
        if (!ended) addLog('Plasmageschoss verfehlt dich.');
      }
      if (b.t >= 1.6) { scene.remove(b.spr); b.spr.material.dispose(); bolts.splice(i, 1); }
    }
    for (let i = beams.length - 1; i >= 0; i--) {
      const bm = beams[i];
      bm.t += dt / bm.dur;
      const a = Math.max(0, 1 - bm.t);
      bm.grp.children.forEach((c) => { c.material.opacity = a * c.userData.op; });
      bm.grp.scale.set(a * 1.2 + 0.2, a * 1.2 + 0.2, 1);
      if (bm.t >= 1) { scene.remove(bm.grp); bm.grp.traverse((c) => { c.geometry?.dispose(); c.material?.dispose(); }); beams.splice(i, 1); }
    }
  }
  function onCraftHit(dmg, at) {
    if (S.result === 'win' || S.result === 'flee' || S.result === 'escaped') { impact(at, 0.8); return; }
    impact(at, 1.0);
    S.shake = Math.max(S.shake, 0.9);
    Input.rumble(0.7, 0.4, 200);
    sfx('hit');
    if (cheats.god || dmg <= 0) { if (!ended) addLog('Treffer abgefangen (Schild unverwundbar).', 'good'); return; }
    craft.hp -= dmg;
    S.ownFlash = 0.3;
    if (!ended) { addLog(`${craft.name} getroffen: −${dmg} Hülle.`, 'bad'); ownFloat(`−${dmg}`); }
    if (craft.hp <= 0 && !ended) { craft.hp = 0; endCombat('lost', `${craft.name} wurde zerstört!`); }
  }

  function impact(p, s) {
    for (let k = 0; k < 18 * s; k++) {
      const v = new THREE.Vector3(randRange(-1, 1), randRange(-1, 1), randRange(-1, 1)).normalize().multiplyScalar(randRange(10, 30));
      fire.spawn(p.x, p.y, p.z, v.x, v.y, v.z, randRange(0.25, 0.6), 0.45, 0.1, 1, [2.6, 2, 1.1], [1.4, 0.4, 0.08], 3, 8);
    }
    for (let k = 0; k < 5 * s; k++) smoke.spawn(p.x, p.y, p.z, randRange(-2, 2), randRange(-1, 3), randRange(-2, 2), randRange(1, 1.8), 1.5 * s, 6 * s, 0.6, [0.3, 0.3, 0.32], [0.5, 0.5, 0.52], 1);
    flash(p, 4 * s, new THREE.Color(1.8, 1.3, 0.7), 0.18);
    flashLight.position.copy(p); flashLight.intensity = Math.max(flashLight.intensity, 400 * s);
  }
  function explosion(p, s, big) {
    for (let k = 0; k < Math.min(60, 32 * s); k++) {
      const v = new THREE.Vector3(randRange(-1, 1), randRange(-1, 1), randRange(-1, 1)).normalize().multiplyScalar(randRange(3, 16) * s);
      fire.spawn(p.x, p.y, p.z, v.x, v.y, v.z, randRange(0.5, 1.2), randRange(1.5, 3) * s, randRange(4, 7) * s, 0.8, [1.8, 0.85, 0.25], [0.25, 0.06, 0.01], 2.2, -1);
    }
    for (let k = 0; k < 30 * s; k++) {
      const v = new THREE.Vector3(randRange(-1, 1), randRange(-1, 1), randRange(-1, 1)).normalize().multiplyScalar(randRange(25, 60) * Math.sqrt(s));
      fire.spawn(p.x, p.y, p.z, v.x, v.y, v.z, randRange(0.4, 1.0), 0.5, 0.12, 1, [2.6, 1.8, 0.8], [1.2, 0.3, 0.04], 1.5, 15);
    }
    for (let k = 0; k < Math.min(40, 22 * s); k++) {
      const v = new THREE.Vector3(randRange(-1, 1), randRange(-0.5, 1), randRange(-1, 1)).normalize().multiplyScalar(randRange(2, 9) * s);
      smoke.spawn(p.x, p.y, p.z, v.x, v.y, v.z, randRange(2, 3.5), 3 * s, 14 * s, 0.75, [0.18, 0.16, 0.15], [0.42, 0.42, 0.44], 0.8, -0.6);
    }
    flash(p, 9 * s, new THREE.Color(1.8, 1.2, 0.6), 0.3);
    flashLight.position.copy(p); flashLight.intensity = Math.max(flashLight.intensity, (big ? 1500 : 500) * s);
    if (big) { S.shake = Math.max(S.shake, 1.4); Input.rumble(1, 1, 400); }
    sfx('explosion');
  }
  function flash(p, size, col, dur) {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.glow, color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    spr.position.copy(p); spr.scale.setScalar(size * 0.3);
    scene.add(spr);
    flashes.push({ spr, size, t: 0, dur });
  }
  function updateFlashes(dt) {
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.t += dt / f.dur;
      f.spr.scale.setScalar(f.size * (0.3 + 0.7 * Math.min(1, f.t * 2)));
      f.spr.material.opacity = Math.max(0, 1 - f.t);
      if (f.t >= 1) { scene.remove(f.spr); f.spr.material.dispose(); flashes.splice(i, 1); }
    }
    flashLight.intensity *= Math.exp(-dt * 9);
  }

  // ================= Kampfende =================
  function endCombat(result, text) {
    if (ended) return;
    ended = true;
    S.result = result; S.state = 'ending'; S.endT = 0; S.queued = false;
    S.paused = false; if ($.pause) $.pause.hidden = true;
    $.warn?.classList.remove('show');
    overlay?.classList.add('ending');
    const titles = {
      win: ['ABSCHUSS!', 'win'], lost: ['JÄGER ZERSTÖRT', 'lost'], flee: ['RÜCKZUG', 'flee'], escaped: ['UFO ENTKOMMEN', 'flee'],
    };
    const [t, cls] = titles[result];
    showBanner(`${t}<small>${text || ''}</small>`, cls);
    addLog(text, result === 'win' ? 'good' : result === 'lost' ? 'bad' : 'warn');
    if (result === 'win') {
      S.timeScale = 0.35;
      explosion(ufoObj.position.clone().add(new THREE.Vector3(R * 0.4, 0, R * 0.3)), Math.max(1, R / 4), true);
      S.fall = { vy: 0, rx: randRange(-0.6, 0.6), rz: randRange(0.4, 0.9) * (rand() < 0.5 ? -1 : 1), nextBoom: 0.4 };
      S.camCut = 'ufo';
      sfx('victory');
    } else if (result === 'lost') {
      explosion(jet.position.clone(), 1.6, true);
      jet.visible = false;
      S.camCut = 'wreck';
      S.camFixed = jet.position.clone().add(new THREE.Vector3(9, 4, -6));
      sfx('defeat');
    } else if (result === 'flee') {
      S.camCut = 'flee';
      S.camFixed = camera.position.clone();
    } else {
      S.camCut = 'escape';
      sfx('alert');
    }
  }
  function finish() {
    if (finished) return;
    restore();
    try { onEnd?.({ result: S.result }); } catch (e) { console.error(e); }
  }

  // ================= Update-Schleife =================
  function onResize(w, h) {
    camera.fov = w / h < 0.8 ? 72 : w / h < 1.2 ? 64 : 55;
    camera.updateProjectionMatrix();
  }

  function update(rawDt) {
    if (finished) return;
    pollStick();
    if (S.paused) { updateHud(0); return; }
    const dt = rawDt * S.timeScale;
    S.t += dt;
    if (S.state === 'intro') {
      S.introT -= rawDt;
      if ($.go) $.go.textContent = `(${Math.max(0, Math.ceil(S.introT))})`;
      // während der Einweisung nähern sich beide langsam an
      S.d = Math.max(START_KM - 1, S.d - dt * 0.15);
      if (S.introT <= 0) startFight();
    } else if (S.state === 'fight') simulate(dt);
    else if (S.state === 'ending') {
      S.endT += rawDt;
      S.timeScale = Math.min(1, S.timeScale + rawDt * 0.6);
      const dur = { win: 3.6, lost: 2.8, flee: 1.8, escaped: 2.2 }[S.result];
      if (S.endT >= dur) { finish(); return; }
    }
    animate(dt, rawDt);
    updateHud(dt);
  }

  function simulate(dt) {
    S.fuel -= dt;
    S.evadeT = Math.max(0, S.evadeT - dt);
    S.evadeCd = Math.max(0, S.evadeCd - dt);
    S.abortArm = Math.max(0, S.abortArm - dt);
    S.reload = Math.max(0, S.reload - dt);
    // Entfernung: UFO-Verhalten + eigenes Manöver
    const hpFrac = ufo.hp / ufoSpec.hp;
    let vU;
    if (hpFrac < 0.35) vU = ufoDrift * 1.8; // schwer beschädigt: Flucht
    else if (U.aggressive && S.d > U.range * 0.8) vU = -ufoDrift; // greift an
    else if (U.aggressive) vU = 0;
    else vU = ufoDrift;
    let vC;
    if (S.evadeT > 0) vC = 0.6;
    else if (S.maneuver === 'approach') vC = -closing;
    else vC = clamp((standoffKm - S.d) * 1.5, -closing, closing);
    if (S.maneuver === 'standoff' && S.evadeT <= 0) vC = clamp(vC - vU, -closing, closing); // UFO-Drift ausgleichen
    S.d = clamp(S.d + (vU + vC) * dt, MIN_KM, 99);
    if (S.d >= ESCAPE_KM) { endCombat('escaped', `${ufo.name} hat sich abgesetzt – zu große Entfernung.`); return; }
    if (S.fuel <= 0) { S.fuel = 0; endCombat('escaped', 'Treibstoff knapp – Rückkehr zur Basis. Das UFO entkommt.'); return; }
    // eigenes Feuer
    if (S.queued) tryFire(false);
    if (S.ammo <= 0 && !missiles.length) {
      S.noAmmoT += dt;
      if (S.noAmmoT > 2) { endCombat('flee', 'Raketen verschossen – Rückkehr zur Basis.'); return; }
    }
    // UFO-Feuer mit Vorwarnung (Ladephase)
    if (S.chargeT > 0) {
      S.chargeT -= dt;
      if (S.chargeT <= 0) {
        if (S.d <= U.range) ufoFire();
        else addLog('UFO-Schuss ins Leere – außer Reichweite.', 'good');
        S.ufoCd = U.reload * randRange(0.85, 1.2);
      }
    } else {
      S.ufoCd -= dt;
      if (S.ufoCd <= 0 && S.d <= U.range + 0.3) { S.chargeT = 0.75; }
    }
    // Pilot bricht bei schweren Schäden ab
    if (craft.hp < craftSpec.hp * 0.15 && craft.hp > 0 && !cheats.god) endCombat('flee', `${craft.name} schwer beschädigt – Pilot bricht ab!`);
  }

  const tmpLook = new THREE.Vector3();
  function animate(dt, rawDt) {
    const t = S.t;
    S.travel += WORLD_SPEED * dt;
    S.visD = smooth(S.visD, S.d, 3, dt);
    // Boden/Wolken scrollen
    ground.material.uniforms.uOff.value.set(0, -S.travel);
    ground.material.uniforms.uTime.value = t;
    cloudLow.material.uniforms.uOff.value.set(t * 4, -S.travel);
    cloudHigh.material.uniforms.uOff.value.set(t * 2, -S.travel * 0.6);
    for (const p of puffs) { p.position.z += WORLD_SPEED * 1.4 * dt; if (p.position.z > 80) placePuff(p, -1500 + randRange(-100, 0)); }

    // Jäger
    const ud = jet.userData;
    if (jet.visible) {
      if (S.result === 'flee' || S.result === 'escaped') {
        // abdrehen und wegfliegen
        const k = S.endT;
        jet.position.x += dt * (14 + k * 30);
        jet.position.y += dt * (4 + k * 10);
        jet.position.z += dt * k * 25;
        ud.body.rotation.z = smooth(ud.body.rotation.z, -1.1, 3, dt);
        jet.rotation.y = smooth(jet.rotation.y, -0.9, 2, dt);
      } else {
        const evade = S.evadeT > 0 ? 1 - S.evadeT / 2.2 : 0;
        const tx = Math.sin(t * 0.6) * 1.8 + Math.sin(evade * Math.PI) * 6;
        const ty = Math.sin(t * 0.83) * 0.8 + Math.sin(evade * Math.PI) * 1.5;
        const vx = (tx - jet.position.x) / Math.max(dt, 1e-3);
        jet.position.x = smooth(jet.position.x, tx, 6, dt);
        jet.position.y = smooth(jet.position.y, ty, 6, dt);
        const roll = S.evadeT > 0 ? -evade * Math.PI * 2 : clamp(-vx * 0.02, -0.6, 0.6);
        ud.body.rotation.z = S.evadeT > 0 ? roll : smooth(ud.body.rotation.z % (Math.PI * 2), roll, 4, dt);
        ud.body.rotation.x = smooth(ud.body.rotation.x, S.maneuver === 'approach' ? -0.05 : 0.08, 2, dt);
        // Zielrichtung leicht zum UFO
        tmpLook.copy(ufoObj.position).sub(jet.position);
        jet.rotation.y = smooth(jet.rotation.y, Math.atan2(-tmpLook.x, -tmpLook.z) * 0.5, 2, dt);
      }
      const boost = S.maneuver === 'approach' && !ended ? 1.35 : 1;
      ud.flames.forEach((f, i) => { f.scale.set(1, 1, (boost + Math.sin(t * 40 + i) * 0.12) * (i % 2 ? 1.1 : 1)); });
      ud.strobe.visible = (t % 1.2) < 0.08;
      // Rauch bei Schäden
      const cf = craft.hp / craftSpec.hp;
      if (cf < 0.5 && rand() < (0.6 - cf) * 2 * dt * 30) {
        const p = jet.localToWorld(_v.set(randRange(-0.8, 0.8), 0.2, 2));
        smoke.spawn(p.x, p.y, p.z, 0, 0.5, 6, 1.6, 0.8, 3.5, 0.6, [0.15, 0.15, 0.16], [0.35, 0.35, 0.37], 0.5);
        if (cf < 0.3) fire.spawn(p.x, p.y, p.z, 0, 0, 5, 0.3, 0.9, 0.3, 1, [3.5, 1.5, 0.4]);
      }
    }

    // UFO
    const uu = ufoObj.userData;
    uu.lights.rotation.y += dt * 1.6;
    uu.lights.children.forEach((l, i) => { const k = 0.5 + 0.5 * Math.sin(t * 6 - i * 0.7); l.material.color.copy(uu.acc).multiplyScalar(0.3 + k * 1.2); });
    uu.emitter.material.opacity = 0.7 + Math.sin(t * 9) * 0.2;
    if (S.result === 'win') {
      const f = S.fall;
      f.vy -= dt * 22;
      ufoObj.position.y += f.vy * dt;
      ufoObj.position.z += dt * 10;
      uu.body.rotation.x += f.rx * dt; uu.body.rotation.z += f.rz * dt;
      f.nextBoom -= dt;
      if (f.nextBoom <= 0) { f.nextBoom = randRange(0.35, 0.7); explosion(ufoObj.position.clone().add(new THREE.Vector3(randRange(-R, R) * 0.6, 0, randRange(-R, R) * 0.6)), Math.max(0.6, R / 7), false); }
      for (let k = 0; k < 3; k++) {
        const p = ufoObj.position;
        smoke.spawn(p.x + randRange(-R, R) * 0.4, p.y, p.z + randRange(-R, R) * 0.4, randRange(-1, 1), randRange(2, 5), randRange(1, 4), randRange(2.5, 4), R * 0.5, R * 2.2, 0.8, [0.1, 0.09, 0.09], [0.32, 0.32, 0.34], 0.4);
        fire.spawn(p.x + randRange(-R, R) * 0.3, p.y, p.z + randRange(-R, R) * 0.3, randRange(-2, 2), randRange(1, 4), randRange(-2, 2), 0.5, R * 0.5, R * 0.15, 1, [4, 1.8, 0.4], [1, 0.2, 0.02]);
      }
    } else if (S.result === 'escaped') {
      const k = S.endT;
      ufoObj.position.z -= dt * (40 + k * k * 260);
      ufoObj.position.y += dt * (6 + k * 40);
      uu.body.rotation.y += dt * 4;
    } else {
      const tz = -visDist(S.visD);
      ufoObj.position.x = smooth(ufoObj.position.x, Math.sin(t * 0.37) * 4 + Math.sin(t * 1.3) * 1.2, 2, dt);
      ufoObj.position.y = smooth(ufoObj.position.y, 2.5 + Math.sin(t * 0.5) * 1.6, 2, dt);
      ufoObj.position.z = smooth(ufoObj.position.z, tz, 5, dt);
      uu.body.rotation.y += dt * 0.5;
      uu.body.rotation.z = Math.sin(t * 0.7) * 0.08;
      uu.body.rotation.x = 0.12 + Math.sin(t * 0.55) * 0.05;
      // Ladeglühen
      const ch = S.chargeT > 0 ? 1 - S.chargeT / 0.75 : 0;
      uu.charge.scale.setScalar(0.01 + ch * (3 + R * 0.5) * (0.85 + Math.sin(t * 50) * 0.15));
      // Rauch bei Schäden
      const uf = ufo.hp / ufoSpec.hp;
      if (uf < 0.6 && rand() < (0.7 - uf) * dt * 40) {
        const p = ufoObj.position;
        smoke.spawn(p.x + randRange(-R, R) * 0.5, p.y, p.z + randRange(-R, R) * 0.3, 0, randRange(1, 3), 8, 2, R * 0.3, R * 1.4, 0.55, [0.12, 0.12, 0.13], [0.35, 0.35, 0.37], 0.3);
        if (uf < 0.3) fire.spawn(p.x + randRange(-R, R) * 0.4, p.y, p.z, 0, 2, 6, 0.4, R * 0.35, R * 0.1, 1, [3.5, 1.4, 0.3]);
      }
    }
    if (S.ufoFlash > 0) S.ufoFlash -= rawDt;

    updateMissiles(dt);
    updateBolts(dt);
    updateFlashes(dt);
    const windZ = WORLD_SPEED * 0.18;
    smoke.update(dt, windZ); fire.update(dt, windZ * 0.5);
    const scale = (engine.internalH || innerHeight) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    smoke.mat.uniforms.uScale.value = fire.mat.uniforms.uScale.value = scale;

    updateCamera(dt, rawDt);
  }

  const camPos = new THREE.Vector3(0, 3.4, 13), camLook = new THREE.Vector3(0, 1, -40);
  function updateCamera(dt, rawDt) {
    const tp = new THREE.Vector3(), tl = new THREE.Vector3();
    let rate = 4;
    if (S.camCut === 'ufo') {
      // Zwischenschnitt: seitliche Ansicht des abstürzenden UFOs
      if (!S.camFixed) S.camFixed = ufoObj.position.clone().add(new THREE.Vector3(R * 4 + 16, R * 1.2 + 5, R * 3 + 14));
      tp.copy(S.camFixed); tl.copy(ufoObj.position);
      camPos.copy(tp); rate = 12;
      camera.fov = smooth(camera.fov, 42, 2, rawDt); camera.updateProjectionMatrix();
    } else if (S.camCut === 'wreck') {
      tp.copy(S.camFixed); tl.copy(jet.position); camPos.copy(tp);
    } else if (S.camCut === 'flee') {
      tp.copy(S.camFixed); tl.copy(jet.position); rate = 3;
    } else {
      const back = 13 + (craft.type === 'phantom' ? 1.5 : 0);
      tp.set(jet.position.x * 0.6, jet.position.y + 3.4, jet.position.z + back);
      tl.copy(jet.position).lerp(ufoObj.position, 0.45); tl.y += 1;
      if (S.camCut === 'escape') rate = 2;
    }
    camPos.x = smooth(camPos.x, tp.x, rate, rawDt);
    camPos.y = smooth(camPos.y, tp.y, rate, rawDt);
    camPos.z = smooth(camPos.z, tp.z, rate, rawDt);
    camLook.x = smooth(camLook.x, tl.x, rate * 1.5, rawDt);
    camLook.y = smooth(camLook.y, tl.y, rate * 1.5, rawDt);
    camLook.z = smooth(camLook.z, tl.z, rate * 1.5, rawDt);
    S.shake = Math.max(0, S.shake - rawDt * 2.2);
    const sh = S.shake * S.shake * 0.35;
    camera.position.set(camPos.x + randRange(-sh, sh), camPos.y + randRange(-sh, sh), camPos.z);
    camera.lookAt(camLook);
    sky.position.copy(camera.position);
  }

  // ================= HUD-Aktualisierung =================
  function updateHud() {
    if (!$.ownBar) return;
    const ch = Math.max(0, craft.hp), uh = Math.max(0, ufo.hp);
    $.ownBar.style.width = `${clamp((ch / craftSpec.hp) * 100, 0, 100)}%`;
    $.ownTxt.textContent = `${Math.round(ch)} / ${craftSpec.hp}`;
    $.ufoBar.style.width = `${clamp((uh / ufoSpec.hp) * 100, 0, 100)}%`;
    $.ufoTxt.textContent = `${Math.round(uh)} / ${ufoSpec.hp}`;
    $.ownHull.classList.toggle('flash', S.ownFlash > 0); if (S.ownFlash > 0) S.ownFlash -= 1 / 60;
    $.ufoHull.classList.toggle('flash', S.ufoFlash > 0);
    $.fuel.textContent = `${Math.ceil(S.fuel)} s`;
    $.fuelBar.style.width = `${(S.fuel / FUEL_S) * 100}%`;
    $.fuelBar.parentElement.classList.toggle('low', S.fuel < 20);
    // Entfernungsanzeige
    const d = S.d;
    $.marker.style.left = `${clamp((d / ESCAPE_KM) * 100, 0, 100)}%`;
    $.markerTxt.textContent = `${km(d)} km`;
    const inOwn = d <= W.range, inUfo = d <= U.range;
    $.marker.className = 'ac-marker' + (inUfo ? ' danger' : inOwn ? ' ok' : '');
    $.chance.innerHTML = `Deine Trefferchance: <b class="${inOwn ? 'good' : 'muted'}">${inOwn ? Math.round(hitChanceOwn(d) * 100) + ' %' : 'außer Reichweite'}</b> · Gefahr durch UFO: <b class="${inUfo ? 'bad' : 'good'}">${inUfo ? Math.round(hitChanceUfo(d) * 100) + ' %' : 'sicher'}</b>`;
    // Waffe
    $.ammo.textContent = `${S.ammo}/${W.ammo}`;
    $.pipEls.forEach((p, i) => p.classList.toggle('used', i >= S.ammo));
    let rs, rcls;
    if (S.ammo <= 0) { rs = 'LEER'; rcls = 'empty'; }
    else if (S.reload > 0) { rs = `LÄDT ${km(S.reload)} s${S.queued ? ' · vorgemerkt' : ''}`; rcls = 'load'; }
    else if (S.evadeT > 0) { rs = 'PAUSIERT (Ausweichen)'; rcls = 'load'; }
    else if (!inOwn) { rs = `BEREIT – außer Reichweite${S.queued ? ' · vorgemerkt' : ''}`; rcls = 'out'; }
    else { rs = 'BEREIT – FEUER FREI'; rcls = 'ready'; }
    $.reloadBar.style.width = `${S.ammo <= 0 ? 0 : (1 - S.reload / W.reload) * 100}%`;
    $.reloadTxt.textContent = rs;
    $.reloadBar.parentElement.className = 'ac-reload ' + rcls;
    $.man.textContent = S.evadeT > 0 ? 'Ausweichen!' : S.maneuver === 'approach' ? 'Annähern' : `Auf Distanz (${km(standoffKm)} km)`;
    // Buttons
    for (const b of $.cmds) {
      const c = b.dataset.cmd;
      b.classList.toggle('active', (c === S.maneuver && S.evadeT <= 0) || (c === 'evade' && S.evadeT > 0) || (c === 'fire' && S.queued));
      const cd = b.querySelector('.ac-cd');
      if (c === 'evade') { b.classList.toggle('cool', S.evadeCd > 0 && S.evadeT <= 0); cd.style.width = `${(S.evadeCd / 5.5) * 100}%`; }
      if (c === 'fire') { b.classList.toggle('ready', rcls === 'ready'); cd.style.width = `${S.ammo > 0 ? (S.reload / W.reload) * 100 : 100}%`; }
      if (c === 'abort') { b.classList.toggle('armed', S.abortArm > 0); b.querySelector('.ac-lbl').textContent = S.abortArm > 0 ? 'Sicher?' : 'Abbrechen'; }
    }
    // Warnung + Hinweis
    const charging = S.chargeT > 0 && S.state === 'fight';
    $.warn.classList.toggle('show', charging && S.evadeT <= 0);
    let tip;
    if (S.tipHover) tip = tipText(S.tipHover);
    else if (S.state !== 'fight') tip = '';
    else if (charging && S.evadeT <= 0) tip = tipText('evade');
    else if (S.ammo > 0 && !inOwn) tip = `Außer Raketenreichweite – <b>„Annähern“</b>${hint('approach') ? ` (${hint('approach')})` : ''}, um in die blaue Zone zu kommen.`;
    else if (rcls === 'ready' && !S.queued) tip = `Raketen bereit – <b>„Feuer frei“</b>${hint('fire') ? ` (${hint('fire')})` : ''}!`;
    else if (safeStandoff && inUfo && S.maneuver === 'approach') tip = `Du bist in der UFO-Reichweite. <b>„Auf Distanz bleiben“</b>${hint('standoff') ? ` (${hint('standoff')})` : ''} hält dich außer Gefahr.`;
    else tip = tipText(S.maneuver);
    if (tip !== S.lastHint) { $.tip.innerHTML = tip; S.lastHint = tip; }
    // Zielmarkierung am UFO
    if (ended && S.result !== 'escaped' && S.result !== 'flee') { $.bracket.style.display = 'none'; return; }
    const v = _v.copy(ufoObj.position).project(camera);
    if (v.z > 1) { $.bracket.style.display = 'none'; return; }
    const sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight;
    const dist = camera.position.distanceTo(ufoObj.position);
    const size = clamp((R * 2.4 / dist) * (innerHeight / (2 * Math.tan((camera.fov * Math.PI) / 360))), 44, 420);
    $.bracket.style.display = '';
    $.bracket.style.transform = `translate(${sx - size / 2}px, ${sy - size * 0.35}px)`;
    $.bracket.style.width = `${size}px`; $.bracket.style.height = `${size * 0.7}px`;
    $.bracket.className = 'ac-bracket' + (inOwn ? ' lock' : '') + (inUfo ? ' danger' : '');
    $.bracketTxt.textContent = `${km(d)} km${inOwn ? ' · IM ZIEL' : ''}`;
  }

  // ================= Start (nach allen Deklarationen) =================
  try {
    geo.deactivate();
    hud.style.display = 'none';
    buildScene();
    buildHud();
    bindInput();
    view.update = update;
    view.onResize = onResize;
    engine.setMode(view);
    engine.resetHistory?.();
    setMusicMood('tac');
    sfx('launch');
  } catch (e) {
    restore();
    geo.active = true;
    throw e;
  }

  // Wächter: wird der Modus von außen ersetzt (z. B. neuer Spielstand), Kampf still beenden
  const watchdog = setInterval(() => {
    if (finished) { clearInterval(watchdog); return; }
    if (engine.active !== view) { clearInterval(watchdog); restore(); onEnd?.({ result: 'flee' }); }
  }, 600);
  unsubs.push(() => clearInterval(watchdog));

  return { end: (r = 'flee') => endCombat(r, 'Gefecht beendet.'), get state() { return S; } };
}
