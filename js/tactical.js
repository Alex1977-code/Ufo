// Rundenbasierter Bodenkampf: Zeiteinheiten, Sichtlinien, Nebel des Krieges, Reaktionsfeuer,
// zerstörbare Umgebung, Alien-KI – steuerbar per Maus, Touch, Tastatur und Controller.
import * as THREE from 'three';
import { generateMap, WALLS } from './tacmap.js';
import { TILE, propParts, patchFog, fogUniforms, makeSoldier, makeAlien, makeCivilian, makeTransport, textures } from './models.js';
import { canvasTexture } from './engine.js';
import { WEAPONS, ARMORS, ALIENS, ITEMS, BELT_SLOTS, RANKS, UFOS } from './data.js';
import { Game } from './game.js';
import { Input, padLabel } from './input.js';
import { modal, toast, confirmBox, anyModalOpen, floatText, banner, bar, el } from './ui.js';
import { sfx, setMusicMood } from './audio.js';
import { clamp, rand, randInt, randRange, choice, shuffle, sleep, smooth, lerp, makeValueNoise2D, fbm2 } from './util.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const FX_COLORS = { bullet: 0xffd27a, laser: 0xff3030, plasma: 0x50ff7a, beam: 0xff40a0, melee: 0xffffff };
// ZE-Kosten der Gürtel-Gegenstände (Anteil der maximalen ZE) und Wurf-/Zonenfarben
const ITEM_TU = { grenade: 0.3, smoke: 0.25, flare: 0.2, medkit: 0.3 };
const ITEM_COLORS = { grenade: 0xff8030, smoke: 0xb8c0c8, flare: 0xffe070, medkit: 0x60ff90 };
const THROW_RANGE = 13;
const PATH_LABELS = 60;
const SMOKE_SPRITES = 96;

class Heap {
  constructor() { this.a = []; }
  push(i, p) { const a = this.a; a.push([p, i]); let k = a.length - 1; while (k > 0) { const pk = (k - 1) >> 1; if (a[pk][0] <= a[k][0]) break; [a[pk], a[k]] = [a[k], a[pk]]; k = pk; } }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) { a[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === k) break; [a[m], a[k]] = [a[k], a[m]]; k = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

// Instanzierte Hindernis-Gruppe (ein InstancedMesh pro Bauteil)
class PropSet {
  constructor(scene, parts, count, shadows) {
    this.meshes = parts.map((p) => {
      const m = new THREE.InstancedMesh(p.geo, p.mat, count);
      m.castShadow = shadows; m.receiveShadow = true;
      m.count = 0; m.frustumCulled = false;
      scene.add(m);
      return m;
    });
    this.base = [];
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
  }
  add(mtx, colors) {
    const i = this.base.length;
    this.base.push(mtx.clone());
    this.meshes.forEach((m, k) => {
      m.count = i + 1;
      m.setMatrixAt(i, this.zero);
      if (colors) m.setColorAt(i, colors[k] || new THREE.Color(1, 1, 1));
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
    return i;
  }
  show(i, on) { this.meshes.forEach((m) => { m.setMatrixAt(i, on ? this.base[i] : this.zero); m.instanceMatrix.needsUpdate = true; }); }
}

export class Tactical {
  constructor(engine, opts, hooks) {
    this.engine = engine;
    this.opts = opts;
    this.hooks = hooks;
    this.site = opts.site;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 600);
    this.units = [];
    this.turn = 1;
    this.phase = 'player';
    this.busy = false;
    this.mode = 'snap';
    this.selected = null;
    this.target = null;
    this.hover = null;
    this.pendingMove = null;
    this.cursor = { x: 0, y: 0 };
    this.padCursorAcc = { x: 0, y: 0 };
    this.cam = { x: 0, z: 0, yaw: 0.6, pitch: 0.95, dist: 30 };
    this.camT = { ...this.cam };
    this.shake = 0;
    this.pointers = new Map();
    this.unsub = [];
    this.fx = [];
    this.lightPool = [];
    this.result = { kills: {}, civSaved: 0, civKilled: 0, itemsUsed: {} };
    this.beltSlot = 0;
    this.smokes = []; this.flares = [];
    this.pathLabelData = []; this.plabCount = 0;
    this.ended = false;
    this._frameWaiters = [];
    this.build();
  }

  // ======================= Aufbau =======================
  build() {
    const o = this.opts;
    const kind = o.site.kind;
    this.map = generateMap({ biome: o.biome, ufoType: o.site.ufoType, kind, night: o.night && kind !== 'hive' });
    const m = this.map;
    this.W = m.W; this.H = m.H;
    this.N = m.W * m.H;
    this.occ = new Int32Array(this.N).fill(-1);
    this.vis = new Uint8Array(this.N);
    this.explored = new Uint8Array(this.N);
    this.fogCur = new Float32Array(this.N).fill(0.05);
    this.fogData = new Uint8Array(this.N);
    this.fogTex = new THREE.DataTexture(this.fogData, m.W, m.H, THREE.RedFormat);
    this.fogTex.magFilter = THREE.LinearFilter; this.fogTex.minFilter = THREE.LinearFilter;
    this.fogTex.needsUpdate = true;
    fogUniforms.fogMap.value = this.fogTex;
    fogUniforms.fogMapSize.value.set(m.W * TILE, m.H * TILE);
    fogUniforms.fogOutside.value = m.night ? 0.25 : 0.38;

    this.buildEnvironment();
    this.buildGround();
    this.buildProps();
    this.buildHelpers();
    this.spawnUnits();
    this.buildHud();
    this.bindInput();
    this.updateVisibility(true);
    const s = this.units.find((u) => u.team === 'player' && u.alive);
    this.select(s, true);
    const p = this.cellPos(s.x, s.y - 4);
    this.cam.x = this.camT.x = p.x; this.cam.z = this.camT.z = p.z;
  }

  buildEnvironment() {
    const night = this.map.night, hive = this.opts.biome === 'hive';
    const top = hive ? new THREE.Color(0x0a0410) : night ? new THREE.Color(0x02040b) : new THREE.Color(0x3f78c8);
    const hor = hive ? new THREE.Color(0x2a0d30) : night ? new THREE.Color(0x0d1730) : new THREE.Color(this.opts.biome === 'desert' ? 0xe8d2a8 : 0xbcd4ea);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: { top: { value: top }, hor: { value: hor }, night: { value: night || hive ? 1 : 0 } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform float night; varying vec3 vP;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
        void main(){ float t = smoothstep(-0.05, 0.6, vP.y); vec3 c = mix(hor, top, t);
          if (night > 0.5) { vec3 q = floor(vP * 300.0); float s = step(0.997, h(q)) * t; c += vec3(s); }
          gl_FragColor = vec4(c, 1.0); }`,
      side: THREE.BackSide, depthWrite: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat);
    this.scene.add(sky);
    // Umgebungsbeleuchtung (IBL) aus dem Himmel erzeugen
    const pmrem = new THREE.PMREMGenerator(this.engine.renderer);
    const envScene = new THREE.Scene(); envScene.add(sky.clone());
    const ground = new THREE.Mesh(new THREE.CircleGeometry(300, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: hor.clone().multiplyScalar(0.3) }));
    ground.position.y = -5; envScene.add(ground);
    this.envRT = pmrem.fromScene(envScene, 0.04);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = night ? 0.25 : hive ? 0.35 : 0.8;
    pmrem.dispose();
    this.scene.fog = new THREE.FogExp2(hor, night ? 0.012 : 0.0065);

    const S = this.engine.shadowSize;
    const sun = new THREE.DirectionalLight(night ? 0x8fa8ff : hive ? 0xc080ff : 0xfff0d8, night ? 0.6 : hive ? 0.7 : 3.2);
    const ext = this.W * TILE * 0.75;
    sun.position.set(ext * 0.6, ext * 1.1, ext * 0.35);
    sun.castShadow = this.engine.settings.shadows !== 'off';
    sun.shadow.mapSize.set(S, S);
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: ext * 4 });
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
    this.scene.add(sun, sun.target);
    this.sun = sun;
    this.scene.add(new THREE.HemisphereLight(night ? 0x223355 : 0xbdd8ff, night ? 0x080808 : 0x4a3a28, night ? 0.35 : 0.9));
    for (const l of this.map.lights) {
      const p = this.cellPos(l.x, l.y);
      const pl = new THREE.PointLight(l.color, l.intensity, 18, 1.6);
      pl.position.set(p.x, l.h, p.z);
      this.scene.add(pl);
      if (l.lamp) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.2, 8), patchFog(new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8, roughness: 0.4 })));
        pole.position.set(p.x + 0.8, 2.1, p.z); pole.castShadow = true; this.scene.add(pole);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshStandardMaterial({ color: 0, emissive: 0xffc27a, emissiveIntensity: 5 }));
        bulb.position.set(p.x + 0.8, 4.2, p.z); this.scene.add(bulb);
      }
    }
    // Lichtpool für Mündungsfeuer/Explosionen
    for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffaa55, 0, 14, 2); this.scene.add(l); this.lightPool.push(l); }
    this.unitLight = new THREE.PointLight(0xcfe6ff, night ? 22 : 0, 16, 1.6);
    this.scene.add(this.unitLight);
    this.engine.renderer.toneMappingExposure = night ? 1.25 : 1.0;
  }

  buildGround() {
    const m = this.map, P = 32;
    const noise = makeValueNoise2D(64);
    const cols = {
      grass: ['#4c6b2e', '#56782f', '#45632a'], field: ['#5a4630', '#4d6a2c'], field2: ['#b69a48', '#a58a3c'], dirt: ['#6e5638', '#7a6040'], sand: ['#c9ad7a', '#bfa16c'], snow: ['#dfe6ee', '#cfd9e4'],
      asphalt: ['#2d2f33', '#34363a'], sidewalk: ['#8a8882', '#7f7d78'], tile: ['#7d6f62', '#6f6357'], wood: ['#6b4a2e', '#5e4027'], metal: ['#3d434d', '#454c57'], burnt: ['#221d18', '#2c241c'], hive: ['#2a1530', '#341a3b'],
    };
    const natural = new Set(['grass', 'field', 'field2', 'dirt', 'sand', 'snow', 'burnt', 'hive']);
    const groundTex = canvasTexture(m.W * P, m.H * P, (c) => {
      c.filter = 'blur(5px)';
      for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
        const f = m.at(x, y).floor; if (!natural.has(f)) continue;
        const pal = cols[f];
        c.fillStyle = pal[(x * 7 + y * 13) % pal.length];
        c.fillRect(x * P - 6, y * P - 6, P + 12, P + 12);
      }
      c.filter = 'none';
      for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
        const f = m.at(x, y).floor; const X = x * P, Y = y * P;
        if (natural.has(f)) {
          if (f === 'field' || f === 'field2') { c.fillStyle = f === 'field' ? 'rgba(30,50,15,0.5)' : 'rgba(120,95,30,0.5)'; for (let k = 0; k < P; k += 6) c.fillRect(X, Y + k, P, 2); }
          continue;
        }
        const pal = cols[f] || cols.grass;
        c.fillStyle = pal[(x + y) % 2]; c.fillRect(X, Y, P, P);
        if (f === 'tile' || f === 'sidewalk') { c.strokeStyle = 'rgba(0,0,0,0.25)'; c.strokeRect(X + 0.5, Y + 0.5, P - 1, P - 1); }
        if (f === 'wood') { c.fillStyle = 'rgba(0,0,0,0.3)'; for (let k = 0; k < P; k += 8) c.fillRect(X, Y + k, P, 1); }
        if (f === 'metal') { c.strokeStyle = 'rgba(20,25,35,0.9)'; c.lineWidth = 2; c.strokeRect(X + 1, Y + 1, P - 2, P - 2); c.fillStyle = 'rgba(60,255,200,0.25)'; if ((x + y) % 3 === 0) c.fillRect(X + P / 2 - 1, Y + 4, 2, P - 8); }
      }
      // Rauschen/Detail
      const img = c.getImageData(0, 0, m.W * P, m.H * P); const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const px = (i / 4) % (m.W * P), py = Math.floor(i / 4 / (m.W * P));
        const n = (fbm2(noise, px / 24, py / 24, 3) - 0.5) * 38 + (Math.random() - 0.5) * 16;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
      }
      c.putImageData(img, 0, 0);
    }, { wrap: false });
    groundTex.wrapS = groundTex.wrapT = THREE.ClampToEdgeWrapping;
    this.groundCanvas = groundTex.image;
    this.groundTex = groundTex;
    const gw = m.W * TILE, gh = m.H * TILE;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh).rotateX(-Math.PI / 2), patchFog(new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 })));
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;
    // Umgebung außerhalb der Karte
    const baseCol = cols[m.at(0, 0).floor] || cols.grass;
    const outerTex = canvasTexture(256, 256, (c, w, h) => { c.fillStyle = baseCol[0]; c.fillRect(0, 0, w, h); for (let i = 0; i < 4000; i++) { c.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},0.07)`; c.fillRect(Math.random() * w, Math.random() * h, 3, 3); } });
    outerTex.repeat.set(30, 30);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(800, 800).rotateX(-Math.PI / 2), patchFog(new THREE.MeshStandardMaterial({ map: outerTex, roughness: 1 })));
    outer.position.y = -0.02; outer.receiveShadow = true;
    this.scene.add(outer);
    // Grasbüschel als Detail
    const tufts = [];
    for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) { const c = m.at(x, y); if ((c.floor === 'grass' || c.floor === 'field') && !c.wall) tufts.push([x, y]); }
    const per = 5, count = Math.min(7000, tufts.length * per);
    if (count) {
      const geo = new THREE.ConeGeometry(0.07, 0.45, 3).translate(0, 0.22, 0);
      const mat = patchFog(new THREE.MeshStandardMaterial({ color: 0x6d8f3a, roughness: 1 }));
      const inst = new THREE.InstancedMesh(geo, mat, count);
      const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), col = new THREE.Color();
      let k = 0;
      for (const [x, y] of tufts) for (let j = 0; j < per && k < count; j++, k++) {
        const p = this.cellPos(x, y);
        pos.set(p.x + randRange(-0.95, 0.95), 0, p.z + randRange(-0.95, 0.95));
        q.setFromEuler(new THREE.Euler(randRange(-0.3, 0.3), rand() * 6, randRange(-0.3, 0.3)));
        sc.set(1, randRange(0.6, 1.6), 1);
        inst.setMatrixAt(k, mtx.compose(pos, q, sc));
        inst.setColorAt(k, col.setHSL(0.22 + rand() * 0.06, 0.5, 0.25 + rand() * 0.15));
      }
      this.scene.add(inst);
    }
  }

  buildProps() {
    const m = this.map;
    const { parts } = propParts();
    const shadows = this.engine.settings.shadows !== 'off';
    const counts = {};
    m.cells.forEach((c) => { if (c.wall) counts[c.wall.type] = (counts[c.wall.type] || 0) + 1; });
    this.props = {};
    for (const [t, n] of Object.entries(counts)) this.props[t] = new PropSet(this.scene, parts[t], n, shadows);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3();
    const same = (x, y, t) => m.at(x, y)?.wall?.type === t;
    for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
      const c = m.at(x, y); if (!c.wall) continue;
      const t = c.wall.type;
      const p = this.cellPos(x, y);
      pos.set(p.x, 0, p.z);
      let rot = 0, scl = 1, colors = null;
      if (['tree', 'pine', 'rock', 'bigrock', 'hivewall', 'wreck', 'pod', 'crate'].includes(t)) { rot = rand() * Math.PI * 2; scl = randRange(0.85, 1.2); }
      if (t === 'crate') { scl = 1; rot = randInt(0, 3) * Math.PI / 2 + randRange(-0.2, 0.2); }
      if (['fence', 'hedge', 'barrier'].includes(t)) rot = (same(x, y - 1, t) || same(x, y + 1, t)) ? Math.PI / 2 : 0;
      if (t === 'window') rot = c.wall.vert ? Math.PI / 2 : 0;
      if (t === 'car') { rot = (randInt(0, 1) * Math.PI / 2) + randRange(-0.15, 0.15); colors = [new THREE.Color().setHSL(rand(), 0.6, 0.4)]; }
      if (t === 'tree' || t === 'pine') colors = [null, new THREE.Color().setHSL(0.25 + rand() * 0.08, 0.5, 0.6 + rand() * 0.3), new THREE.Color().setHSL(0.25 + rand() * 0.08, 0.5, 0.6 + rand() * 0.3), new THREE.Color(1, 1, 1)];
      if (t === 'tree' || t === 'pine') pos.x += randRange(-0.3, 0.3), pos.z += randRange(-0.3, 0.3);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      s.set(scl, t === 'tree' || t === 'pine' ? scl * randRange(0.9, 1.25) : scl, scl);
      mtx.compose(pos, q, s);
      c.wall.idx = this.props[t].add(mtx, colors);
    }
    // UFO-Kuppel-Deko (abgestürzt: geneigt) – nur Rand, damit das Innere sichtbar bleibt
    if (m.ufo) {
      const pc = this.cellPos(m.ufo.cx, m.ufo.cy);
      const R = (m.ufo.r + 0.5) * TILE;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.45, 10, 64), patchFog(new THREE.MeshStandardMaterial({ map: textures().metal, color: 0x9aa4b0, metalness: 0.9, roughness: 0.25 })));
      rim.rotation.x = Math.PI / 2; rim.position.set(pc.x, 2.9, pc.z); rim.castShadow = true;
      this.scene.add(rim);
      const lights = new THREE.Mesh(new THREE.TorusGeometry(R + 0.3, 0.12, 6, 64), patchFog(new THREE.MeshStandardMaterial({ color: 0, emissive: m.ufo.crashed ? 0xff5030 : 0x40ffd0, emissiveIntensity: 3 })));
      lights.rotation.x = Math.PI / 2; lights.position.set(pc.x, 2.9, pc.z);
      this.scene.add(lights);
      this.ufoRim = [rim, lights];
      rim.visible = lights.visible = false;
    }
    // Transporter am Kartenrand
    const tr = makeTransport();
    const lz = this.map.lz[0];
    const tp = this.cellPos(lz.x + 2, m.H - 1);
    tr.position.set(tp.x, 0, tp.z + 10.5);
    this.scene.add(tr);
  }

  buildHelpers() {
    const add = (o) => { this.scene.add(o); return o; };
    const ringMat = (c, o = 0.9) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.2), transparent: true, opacity: o, depthWrite: false, side: THREE.DoubleSide });
    this.selRing = add(new THREE.Mesh(new THREE.RingGeometry(0.75, 0.92, 32).rotateX(-Math.PI / 2), ringMat(0x30d0ff)));
    this.selRing.position.y = 0.05;
    this.tgtRing = add(new THREE.Mesh(new THREE.RingGeometry(0.8, 1.0, 4).rotateX(-Math.PI / 2).rotateY(Math.PI / 4), ringMat(0xff3040)));
    this.tgtRing.position.y = 0.06; this.tgtRing.visible = false;
    const sq = new THREE.EdgesGeometry(new THREE.BoxGeometry(TILE * 0.96, 0.02, TILE * 0.96));
    this.cursorMesh = add(new THREE.LineSegments(sq, new THREE.LineBasicMaterial({ color: new THREE.Color(2, 2, 2) })));
    this.cursorMesh.position.y = 0.06;
    this.cursorFill = add(new THREE.Mesh(new THREE.PlaneGeometry(TILE * 0.94, TILE * 0.94).rotateX(-Math.PI / 2), ringMat(0xffffff, 0.12)));
    this.cursorFill.position.y = 0.04;
    this.pathDots = add(new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), 80));
    this.pathDots.count = 0; this.pathDots.frustumCulled = false;
    this.rangeMesh = add(new THREE.InstancedMesh(new THREE.PlaneGeometry(TILE * 0.97, TILE * 0.97).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.8, 1.4), transparent: true, opacity: this.map.night || this.opts.biome === 'hive' ? 0.03 : 0.055, depthWrite: false }), this.N));
    this.rangeMesh.count = 0; this.rangeMesh.position.y = 0.03; this.rangeMesh.frustumCulled = false;
    this.grenadeArea = add(new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), ringMat(0xff8030, 0.18)));
    this.grenadeArea.visible = false; this.grenadeArea.position.y = 0.07;
    // Partikel
    const pt = canvasTexture(64, 64, (c) => { const g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 64, 64); }, { wrap: false });
    this.particleTex = pt;
    this.particles = [];
    for (let i = 0; i < 220; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: pt, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff }));
      sp.visible = false; this.scene.add(sp);
      this.particles.push({ sp, life: 0 });
    }
    this.tracerGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    // Rauchwolken (Nebelgranate): Sichtblockade pro Feld (verbleibende Runden) + wiederverwendete Rauch-Sprites
    this.smokeCells = new Uint8Array(this.N);
    this.smokeTex = canvasTexture(128, 128, (c) => {
      for (let i = 0; i < 9; i++) {
        const x = 64 + randRange(-22, 22), y = 64 + randRange(-22, 22), r = randRange(22, 40);
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.6, 'rgba(235,235,235,0.22)'); g.addColorStop(1, 'rgba(220,220,220,0)');
        c.fillStyle = g; c.fillRect(0, 0, 128, 128);
      }
    }, { wrap: false });
    const smokeCol = this.map.night || this.opts.biome === 'hive' ? 0x59606b : 0xb4b6b8;
    this.smokePool = [];
    for (let i = 0; i < SMOKE_SPRITES; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, color: smokeCol, transparent: true, opacity: 0, depthWrite: false, blending: THREE.NormalBlending }));
      sp.visible = false; sp.renderOrder = 2; sp.userData.used = false;
      this.scene.add(sp); this.smokePool.push(sp);
    }
    // vorab angelegte Fackel-Lichter (keine Shader-Neukompilierung zur Laufzeit)
    this.flareLights = [];
    for (let i = 0; i < 2; i++) { const l = new THREE.PointLight(0xffd6a0, 0, 24, 1.5); l.userData.busy = false; this.scene.add(l); this.flareLights.push(l); }
  }

  spawnUnits() {
    const m = this.map;
    // Soldaten
    const spawns = m.playerSpawns.slice();
    const stockLeft = { ...(Game.c.stock || {}) };
    this.beltShort = [];
    this.opts.squad.forEach((s, i) => {
      const sp = spawns[i]; if (!sp) return;
      const arm = ARMORS[s.armor];
      // Gürtel bestücken: jeder Gegenstand braucht ein Stück im Lager (Cheat „alle Ausrüstung“: unbegrenzt)
      const belt = [];
      for (let k = 0; k < BELT_SLOTS; k++) {
        const id = Array.isArray(s.items) ? s.items[k] : null;
        const it = id && ITEMS[id];
        if (!it) { belt.push(null); continue; }
        if (!Game.cheats.allGear) {
          if ((stockLeft[id] || 0) <= 0) { belt.push(null); this.beltShort.push(it.short); continue; }
          stockLeft[id]--;
        }
        belt.push({ id, uses: it.uses || 1 });
      }
      const u = this.addUnit({
        team: 'player', name: s.name, soldier: s, x: sp.x, y: sp.y, hp: s.hp + arm.hp, tu: s.tu, acc: s.acc, react: s.react, armor: arm.armor, weapon: s.weapon,
        belt, healed: 0, obj: makeSoldier(s, arm.color, WEAPONS[s.weapon].fx), sight: m.night ? 10 : 20, rank: s.rank,
      });
      u.obj.rotation.y = Math.PI;
    });
    // Aliens
    const site = this.opts.site;
    let roster, n;
    const monthIdx = Game.c.lastMonth || 0;
    if (site.kind === 'hive') { roster = ['krull', 'drone', 'vael_s', 'beast']; n = 11; }
    else if (site.kind === 'terror') { roster = ['vael', 'vael_s', 'beast', 'beast', monthIdx > 2 ? 'krull' : 'vael_s']; n = randInt(7, 10); }
    else { const us = UFOS[site.ufoType]; roster = us.roster; n = randInt(us.crew[0], us.crew[1]); if (site.kind === 'crash') n = Math.max(1, Math.round(n * 0.75)); }
    const inUfo = m.alienSpawns.filter((s) => s.inUfo), outUfo = m.alienSpawns.filter((s) => !s.inUfo);
    const used = new Set();
    if (site.kind === 'hive' && m.boss) { this.addAlien('hive', m.boss.x, m.boss.y, true); used.add(m.boss.y * m.W + m.boss.x); }
    const pick = (list) => { for (const s of list) { const k = s.y * m.W + s.x; if (!used.has(k) && !m.at(s.x, s.y).wall) { used.add(k); return s; } } return null; };
    for (let i = 0; i < n; i++) {
      const type = choice(roster);
      const sp = (m.ufo && rand() < (m.alienSpawnMix || 0.6) ? pick(inUfo) : pick(outUfo)) || pick(m.alienSpawns) || pick(inUfo);
      if (!sp) break;
      this.addAlien(type, sp.x, sp.y, !!sp.inUfo);
    }
    // Zivilisten
    if (site.kind === 'terror') {
      for (let i = 0; i < 8; i++) {
        const sp = pick(shuffle(m.civSpawns.slice())); if (!sp) break;
        this.addUnit({ team: 'civ', name: 'Zivilist', x: sp.x, y: sp.y, hp: 20, tu: 50, acc: 0, react: 0, armor: 0, weapon: null, obj: makeCivilian(), sight: 12 });
      }
    }
  }

  addAlien(type, x, y, guard) {
    const a = ALIENS[type];
    const scale = 1 + Math.min(0.5, (Game.c.lastMonth || 0) * 0.06);
    return this.addUnit({
      team: 'alien', name: a.name, spec: type, x, y, hp: Math.round(a.hp * scale), tu: a.tu, acc: a.acc, react: a.react, armor: a.armor, weapon: a.weapon,
      grenades: type === 'krull' || type === 'vael_s' ? (rand() < 0.4 ? 1 : 0) : 0, grenadeKind: 'alien', obj: makeAlien(a.model), sight: this.map.night ? Math.round(a.sight * 0.7) : a.sight, flying: !!a.flying, guard, boss: !!a.boss,
    });
  }

  addUnit(o) {
    const u = { id: this.units.length, alive: true, kneel: false, kills: 0, dmgTaken: 0, maxHp: o.hp, maxTu: o.tu, ...o };
    u.tu = u.maxTu;
    const p = this.cellPos(u.x, u.y);
    u.obj.position.set(p.x, 0, p.z);
    u.obj.rotation.y = rand() * Math.PI * 2;
    u.obj.traverse((c) => { if (c.isMesh) { c.castShadow = true; } });
    u.anim = { walk: 0, t: rand() * 10 };
    this.scene.add(u.obj);
    this.occ[u.y * this.W + u.x] = u.id;
    this.units.push(u);
    return u;
  }

  // ======================= Raster-Helfer =======================
  cellPos(x, y) { return { x: (x - this.W / 2 + 0.5) * TILE, z: (y - this.H / 2 + 0.5) * TILE }; }
  posCell(px, pz) { return { x: Math.floor(px / TILE + this.W / 2), y: Math.floor(pz / TILE + this.H / 2) }; }
  inb(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  wallAt(x, y) { return this.map.at(x, y)?.wall; }
  blocksMove(x, y, u) {
    const w = this.wallAt(x, y);
    if (w) { const d = WALLS[w.type]; if (d.move && !(u?.flying && !d.full)) return true; }
    return false;
  }
  blocksSight(x, y) {
    // Rauch blockiert die Sicht (nicht die Bewegung) – für alle Parteien
    if (x >= 0 && y >= 0 && x < this.W && y < this.H && this.smokeCells[y * this.W + x]) return true;
    const w = this.wallAt(x, y); return !!(w && WALLS[w.type].full);
  }
  inSmoke(x, y) { return !!(this.inb(x, y) && this.smokeCells[y * this.W + x]); }
  litByFlare(x, y) { return this.flares.some((f) => f.turns > 0 && Math.hypot(f.x - x, f.y - y) <= f.r); }
  unitAt(x, y) { const i = this.occ[y * this.W + x]; return i >= 0 ? this.units[i] : null; }
  dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  los(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2.5);
    let px = x0, py = y0;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const cx = Math.round(x0 + dx * t), cy = Math.round(y0 + dy * t);
      // diagonaler Übergang zwischen zwei sich berührenden Wänden blockiert die Sicht
      if (cx !== px && cy !== py && this.blocksSight(px, cy) && this.blocksSight(cx, py)) return false;
      px = cx; py = cy;
      if ((cx === x1 && cy === y1) || (cx === x0 && cy === y0)) continue;
      if (this.blocksSight(cx, cy)) return false;
    }
    return true;
  }
  canSee(u, x, y) {
    let range = u.sight;
    if (u.team === 'player' && this.map.night) {
      // beleuchtete Bereiche sind auch nachts weiter sichtbar
      if (this.map.lights.some((l) => Math.hypot(l.x - x, l.y - y) < 4)) range = 20;
      const t = this.unitAt(x, y); if (t && t.team === 'alien' && t.revealed) range = 20;
    }
    // Leuchtfackeln heben die Nacht-Sichtbeschränkung im Radius auf (wirkt für beide Seiten)
    if (this.map.night && range < 20 && this.flares.length && this.litByFlare(x, y)) range = 20;
    if (Math.hypot(u.x - x, u.y - y) > range) return false;
    return this.los(u.x, u.y, x, y);
  }

  dijkstra(u, maxCost = Infinity, ignoreUnits = false) {
    const N = this.N, W = this.W;
    const dist = new Float32Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const s = u.y * W + u.x;
    dist[s] = 0;
    const h = new Heap(); h.push(s, 0);
    while (h.size) {
      const [d, i] = h.pop();
      if (d > dist[i]) continue;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!this.inb(nx, ny)) continue;
        if (this.blocksMove(nx, ny, u)) continue;
        if (dx && dy && (this.blocksMove(x + dx, y, u) || this.blocksMove(x, y + dy, u))) continue;
        const j = ny * W + nx;
        if (!ignoreUnits && this.occ[j] >= 0 && this.occ[j] !== u.id && this.knownBlocker(u, this.units[this.occ[j]])) continue;
        const nd = d + (dx && dy ? 6 : 4);
        if (nd > maxCost || nd >= dist[j]) continue;
        dist[j] = nd; prev[j] = i; h.push(j, nd);
      }
    }
    return { dist, prev };
  }
  // Für die Wegplanung des Spielers zählen nur Einheiten, die er sehen kann
  knownBlocker(u, o) {
    if (u.team !== 'player') return true;
    if (o.team === 'player') return true;
    if (o.team === 'alien') return this.isVisibleAlien(o);
    return !!this.vis[o.y * this.W + o.x];
  }
  buildPath(prev, tx, ty) {
    const path = []; let i = ty * this.W + tx;
    while (prev[i] >= 0) { path.push({ x: i % this.W, y: (i / this.W) | 0 }); i = prev[i]; }
    return path.reverse();
  }

  // ======================= Sichtbarkeit =======================
  updateVisibility(initial = false) {
    const W = this.W;
    const before = new Set(this.units.filter((u) => u.team === 'alien' && u.alive && this.isVisibleAlien(u)).map((u) => u.id));
    this.vis.fill(0);
    const reveal = Game.cheats.revealMap;
    for (const u of this.units) {
      if (!u.alive || u.team !== 'player' || u.evac) continue;
      const r = Math.ceil(u.sight >= 20 ? 20 : 20);
      for (let y = Math.max(0, u.y - r); y <= Math.min(this.H - 1, u.y + r); y++) for (let x = Math.max(0, u.x - r); x <= Math.min(W - 1, u.x + r); x++) {
        const i = y * W + x;
        if (this.vis[i]) continue;
        if (this.canSee(u, x, y)) this.vis[i] = 1;
      }
      this.vis[u.y * W + u.x] = 1;
    }
    if (reveal) this.vis.fill(1);
    let changed = false;
    for (let i = 0; i < this.N; i++) {
      if (this.vis[i] && !this.explored[i]) {
        this.explored[i] = 1; changed = true;
        const c = this.map.cells[i];
        if (c.wall && c.wall.idx != null) this.props[c.wall.type].show(c.wall.idx, true);
        // angrenzende Wände mit aufdecken, damit Gebäudekanten sichtbar sind
      }
    }
    // Wände direkt neben sichtbaren Feldern aufdecken (man sieht die Wandfläche)
    for (let i = 0; i < this.N; i++) {
      if (!this.vis[i]) continue;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy; if (!this.inb(nx, ny)) continue;
        const j = ny * W + nx; const c = this.map.cells[j];
        if (!this.explored[j] && c.wall) { this.explored[j] = 1; if (c.wall.idx != null) this.props[c.wall.type].show(c.wall.idx, true); }
      }
    }
    if (this.ufoRim && !this.ufoRim[0].visible) {
      const u = this.map.ufo;
      if (this.explored[u.cy * W + u.cx] || [[u.r, 0], [-u.r, 0], [0, u.r], [0, -u.r]].some(([dx, dy]) => this.explored[(u.cy + dy) * W + u.cx + dx])) this.ufoRim.forEach((o) => (o.visible = true));
    }
    // Aliens ein-/ausblenden
    const spotted = [];
    for (const u of this.units) {
      if (!u.alive) continue;
      if (u.team === 'alien') {
        const v = this.isVisibleAlien(u);
        u.obj.visible = v || u.dying;
        if (v && !before.has(u.id) && !initial) spotted.push(u);
      } else if (u.team === 'civ') u.obj.visible = !!this.vis[u.y * W + u.x];
    }
    this.updateAlienBadges();
    return spotted;
  }
  isVisibleAlien(u) { return !!(this.vis[u.y * this.W + u.x] || u.revealed || Game.cheats.revealMap); }

  updateFog(dt) {
    const night = this.map.night;
    let dirty = false;
    for (let i = 0; i < this.N; i++) {
      const target = this.vis[i] ? 1 : this.explored[i] ? (night ? 0.42 : 0.55) : 0.05;
      const c = this.fogCur[i];
      if (Math.abs(c - target) > 0.004) { this.fogCur[i] = c + (target - c) * Math.min(1, dt * 6); dirty = true; }
      const b = Math.round(this.fogCur[i] * 255);
      if (b !== this.fogData[i]) { this.fogData[i] = b; dirty = true; }
    }
    if (dirty) this.fogTex.needsUpdate = true;
  }

  // ======================= Kampfregeln =======================
  modeCost(u, mode) {
    if (mode === 'grenade') return Math.round(u.maxTu * 0.3);
    const w = WEAPONS[u.weapon]; const m = w?.[mode];
    if (!m) return Infinity;
    return Math.round(u.maxTu * m.tu);
  }
  itemCost(u, id) { return Math.round(u.maxTu * (ITEM_TU[ITEMS[id]?.kind] ?? 0.3)); }
  beltEntry(u, slot = this.beltSlot) { const b = u?.belt?.[slot]; return b && ITEMS[b.id] ? b : null; }
  beltSlots(u) { const r = []; (u?.belt || []).forEach((b, k) => { if (b && ITEMS[b.id]) r.push(k); }); return r; }
  hasTu(u, cost) { return (u.team === 'player' && Game.cheats.infTU) || u.tu >= cost; }
  spendTu(u, cost) { if (!(u.team === 'player' && Game.cheats.infTU)) u.tu = Math.max(0, u.tu - cost); }

  coverBetween(shooter, t) {
    if (t.flying) return false;
    const dx = Math.sign(shooter.x - t.x), dy = Math.sign(shooter.y - t.y);
    const cands = [[t.x + dx, t.y + dy]];
    if (dx && dy) cands.push([t.x + dx, t.y], [t.x, t.y + dy]);
    else if (dx) cands.push([t.x + dx, t.y + 1], [t.x + dx, t.y - 1]);
    else cands.push([t.x + 1, t.y + dy], [t.x - 1, t.y + dy]);
    if (Math.hypot(shooter.x - t.x, shooter.y - t.y) < 1.6) return false;
    return cands.slice(0, dx && dy ? 3 : 1).some(([x, y]) => { const w = this.wallAt(x, y); return w && WALLS[w.type].cover === 1; });
  }

  hitChance(u, t, mode) {
    if (u.team === 'player' && Game.cheats.aimbot) return 1;
    const w = WEAPONS[u.weapon]; const m = w?.[mode]; if (!m) return 0;
    if (w.melee) return this.dist(u, t) < 1.6 ? m.acc : 0;
    let c = (u.acc / 100) * m.acc;
    if (u.kneel) c *= 1.15;
    const d = this.dist(u, t);
    if (d > 12) c -= (d - 12) * 0.015;
    if (w.falloff) c -= Math.max(0, d - 3) * w.falloff;
    if (d > w.range) c *= 0.5;
    if (this.coverBetween(u, t)) c *= 0.7;
    if (t.kneel) c *= 0.92;
    if (this.inSmoke(t.x, t.y)) c *= 0.6; // Ziel im Rauch
    if (u.team === 'player' && t.team === 'alien') c += (Game.has('autopsy_vael') ? 0.05 : 0) + (Game.has('autopsy_krull') ? 0.05 : 0);
    return clamp(c, 0.05, 0.95);
  }

  // ======================= Aktionen =======================
  async moveUnit(u, path, opts = {}) {
    if (!path.length) return;
    this.busy = true;
    u.kneel = false;
    if (u.team === 'player') this.refreshUi();
    const spd = this.engine.settings.animSpeed || 1;
    for (const step of path) {
      if (!u.alive || this.ended) break;
      const diag = step.x !== u.x && step.y !== u.y;
      const cost = diag ? 6 : 4;
      if (!this.hasTu(u, cost)) break;
      if (this.unitAt(step.x, step.y)) { if (u.team === 'player') toast('Weg blockiert – unbekannter Kontakt!', 'warn', 1800); this.updateVisibility(); break; }
      this.spendTu(u, cost);
      this.occ[u.y * this.W + u.x] = -1;
      const from = this.cellPos(u.x, u.y), to = this.cellPos(step.x, step.y);
      u.obj.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
      u.x = step.x; u.y = step.y;
      this.occ[u.y * this.W + u.x] = u.id;
      const visible = u.team === 'player' || this.isVisibleAlien(u) || (u.team === 'civ' && this.vis[u.y * this.W + u.x]);
      const dur = (visible ? 0.24 : 0.02) / spd;
      if (visible && u.team !== 'civ') { this.camT.x = to.x; this.camT.z = to.z; }
      let t = 0;
      while (t < dur) {
        const dt = await this.frame();
        t += dt;
        const k = Math.min(1, t / dur);
        u.obj.position.x = lerp(from.x, to.x, k); u.obj.position.z = lerp(from.z, to.z, k);
        u.anim.walk += dt * 11 * spd;
      }
      u.obj.position.x = to.x; u.obj.position.z = to.z;
      if (visible) sfx('step');
      if (u.team === 'player') {
        const spotted = this.updateVisibility();
        if (spotted.length && !opts.noStop) {
          this.camT.x = spotted[0].obj.position.x; this.camT.z = spotted[0].obj.position.z;
          toast(`⚠ Feind gesichtet: ${spotted.map((s) => s.name).join(', ')}`, 'bad', 2200);
          sfx('alert');
          await this.reactionFire(u);
          break;
        }
      } else if (u.team === 'alien') {
        const wasVis = u.obj.visible;
        u.obj.visible = this.isVisibleAlien(u);
        if (u.obj.visible && !wasVis) { this.camT.x = to.x; this.camT.z = to.z; this.updateAlienBadges(); }
      }
      if (u.team !== 'civ') await this.reactionFire(u);
    }
    u.anim.walk = 0;
    this.busy = !!this.ended;
    if (u.team === 'player' && !this.ended) { this.updateVisibility(); this.refreshUi(); }
  }

  async reactionFire(mover) {
    if (!mover.alive) return;
    const enemies = this.units.filter((o) => o.alive && !o.evac && o.team !== mover.team && o.team !== 'civ' && o.weapon);
    shuffle(enemies);
    for (const o of enemies) {
      if (!mover.alive) return;
      if (o.team === 'alien' && mover.team === 'player' && Game.cheats.noReaction) continue;
      if (o.team === 'player' && !this.isVisibleAlien(mover)) continue;
      const w = WEAPONS[o.weapon];
      const cost = this.modeCost(o, 'snap');
      if (!this.hasTu(o, cost)) continue;
      if (w.melee && this.dist(o, mover) > 1.6) continue;
      if (!this.canSee(o, mover.x, mover.y)) continue;
      const chance = (o.react / 100) * (o.tu / o.maxTu) * 0.85;
      if (rand() < chance) {
        if (o.team === 'player') toast(`${o.name}: Reaktionsfeuer!`, 'good', 1500);
        else toast(`${o.name} eröffnet Reaktionsfeuer!`, 'bad', 1500);
        await this.fire(o, mover, 'snap', true);
        break;
      }
    }
  }

  frame() { return new Promise((r) => { this._frameWaiters.push(r); }); }

  faceTo(u, x, y) { const a = this.cellPos(u.x, u.y), b = this.cellPos(x, y); u.obj.rotation.y = Math.atan2(b.x - a.x, b.z - a.z); }

  muzzleWorld(u) {
    const m = u.obj.userData.gun?.userData.muzzle;
    const v = new THREE.Vector3();
    if (m) { u.obj.updateMatrixWorld(true); m.getWorldPosition(v); } else { v.copy(u.obj.position); v.y = 1.3; }
    return v;
  }
  bodyPoint(u) { return new THREE.Vector3(u.obj.position.x, u.kneel ? 0.9 : u.obj.userData.hover ? 1.5 : 1.2, u.obj.position.z); }

  async fire(u, t, mode, reaction = false) {
    const w = WEAPONS[u.weapon];
    const m = w[mode];
    if (!m) return false;
    const cost = this.modeCost(u, mode);
    if (this.ended || !u.alive) return false;
    if (!this.hasTu(u, cost)) { if (u.team === 'player') { toast('Nicht genügend Zeiteinheiten.', 'warn'); sfx('deny'); } return false; }
    const wasBusy = this.busy; this.busy = true;
    this.spendTu(u, cost);
    this.faceTo(u, t.x, t.y);
    const showShot = u.team === 'player' || t.team === 'player' || (u.team === 'alien' && this.isVisibleAlien(u)) || !!this.vis[t.y * this.W + t.x];
    if (u.team === 'alien' && showShot) { u.revealed = true; u.obj.visible = true; this.updateAlienBadges(); }
    if (showShot) { this.camT.x = (u.obj.position.x + t.obj.position.x) / 2; this.camT.z = (u.obj.position.z + t.obj.position.z) / 2; await sleep(160 / (this.engine.settings.animSpeed || 1)); }
    const shots = m.shots || 1;
    for (let s = 0; s < shots; s++) {
      if (!u.alive || this.ended) break;
      const chance = this.hitChance(u, t, mode);
      const hit = t.alive && rand() < chance;
      await this.shoot(u, t, hit, w, showShot);
      if (s < shots - 1) await sleep(90);
    }
    this.busy = this.ended ? true : wasBusy;
    if (u.team === 'player' && !this.ended) this.refreshUi();
    return true;
  }

  async shoot(u, t, hit, w, show) {
    const from = this.muzzleWorld(u);
    let to, impact = null;
    if (w.melee) {
      sfx('melee');
      u.obj.userData.body.position.z = 0.4; setTimeout(() => { u.obj.userData.body.position.z = 0; }, 200);
      await sleep(150);
      if (hit) this.damage(t, w.dmg, u); else this.floatAt(t, 'Verfehlt', '#aaa');
      return;
    }
    if (hit) to = this.bodyPoint(t).add(new THREE.Vector3(randRange(-0.15, 0.15), randRange(-0.2, 0.2), randRange(-0.15, 0.15)));
    else {
      // Fehlschuss: abweichende Flugbahn verfolgen
      const dx = t.x - u.x, dy = t.y - u.y, len = Math.hypot(dx, dy) || 1;
      const ang = Math.atan2(dy, dx) + randRange(-0.12, 0.12) * (1 + 3 / len);
      const range = Math.max(len + 6, 14);
      let end = null;
      const steps = Math.ceil(range * 4);
      for (let i = 2; i <= steps; i++) {
        const fx = u.x + Math.cos(ang) * (i / 4), fy = u.y + Math.sin(ang) * (i / 4);
        const cx = Math.round(fx), cy = Math.round(fy);
        if (!this.inb(cx, cy)) { end = { fx, fy, ground: true }; break; }
        if (cx === u.x && cy === u.y) continue;
        const wl = this.wallAt(cx, cy);
        if (wl && (WALLS[wl.type].full || (WALLS[wl.type].cover && (Math.hypot(cx - t.x, cy - t.y) < 1.6 || rand() < 0.3)))) { end = { fx, fy, wall: { x: cx, y: cy } }; break; }
        const other = this.unitAt(cx, cy);
        if (other && other !== u && other !== t && other.alive && rand() < 0.4) { end = { fx, fy, unit: other }; break; }
      }
      if (!end) end = { fx: u.x + Math.cos(ang) * range, fy: u.y + Math.sin(ang) * range, ground: true };
      const p = this.cellPos(0, 0);
      to = new THREE.Vector3(p.x + end.fx * TILE, end.unit ? 1.1 : end.wall ? randRange(0.6, 1.8) : 0.05, p.z + end.fy * TILE);
      impact = end;
    }
    await this.projectile(from, to, w.fx, show);
    if (hit) this.damage(t, w.dmg, u);
    else {
      if (show && t.team) this.floatAt(t, 'Verfehlt', '#9aa');
      if (impact?.wall) this.damageWall(impact.wall.x, impact.wall.y, w.dmg * randRange(0.5, 1.5));
      if (impact?.unit) this.damage(impact.unit, w.dmg, u);
      if (this.losDirty) { this.losDirty = false; this.updateVisibility(); }
      this.spark(to, FX_COLORS[w.fx], 10);
    }
  }

  async projectile(from, to, fx, show) {
    const spd = this.engine.settings.animSpeed || 1;
    if (!show) return;
    sfx(fx === 'bullet' ? 'bullet' : fx);
    this.flash(from, FX_COLORS[fx], 8);
    const col = new THREE.Color(FX_COLORS[fx]).multiplyScalar(fx === 'bullet' ? 3 : 5);
    const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(this.tracerGeo, mat);
    const len = from.distanceTo(to);
    mesh.position.copy(from); mesh.lookAt(to);
    this.scene.add(mesh);
    if (fx === 'laser' || fx === 'beam') {
      mesh.scale.set(fx === 'beam' ? 2.5 : 1.6, fx === 'beam' ? 2.5 : 1.6, len);
      let t = 0; while (t < 0.18 / spd) { const dt = await this.frame(); t += dt; mat.opacity = 1 - t / (0.18 / spd); }
    } else {
      const speed = (fx === 'plasma' ? 40 : 110) * spd;
      const tl = fx === 'plasma' ? 1.6 : 2.4;
      const w = fx === 'plasma' ? 3.5 : 1;
      let d = 0;
      while (d < len) {
        const dt = await this.frame();
        d += speed * dt;
        const head = Math.min(d, len), tail = Math.max(0, head - tl);
        mesh.position.copy(from).lerp(to, tail / len);
        mesh.scale.set(w, w, Math.max(0.05, head - tail));
        if (fx === 'plasma') this.emit(mesh.position.clone().lerp(to, 0.0), col, 1, 0.25, 0.4);
      }
    }
    this.scene.remove(mesh); mat.dispose();
    this.flash(to, FX_COLORS[fx], 5);
  }

  damage(t, raw, src) {
    if (!t.alive || this.disposed) return;
    let dmg = Math.max(0, Math.round(raw * randRange(0.5, 1.5) - t.armor));
    if (src?.team === 'player' && Game.cheats.oneHit && t.team !== 'player') dmg = 9999;
    if (t.team === 'player' && Game.cheats.god) dmg = 0;
    t.hp -= dmg; t.dmgTaken += dmg;
    this.spark(this.bodyPoint(t), t.team === 'alien' ? 0x80ff60 : 0xff3030, 14);
    sfx('hit');
    this.floatAt(t, dmg > 0 ? `−${dmg}` : 'Abgeprallt', dmg > 0 ? (t.team === 'player' ? '#ff5a5a' : '#ffe680') : '#9ab', dmg > 30);
    if (t.team === 'player' && dmg > 0) Input.rumble(0.8, 0.5, 220);
    if (t.team === 'player' && t === this.selected) this.refreshUi();
    if (t.hp <= 0) this.kill(t, src);
  }

  kill(t, src) {
    t.alive = false; t.dying = true;
    this.occ[t.y * this.W + t.x] = -1;
    if (src && src !== t && t.team === 'alien' && src.team === 'player') src.kills++;
    sfx(t.team === 'alien' ? 'alienDeath' : 'death');
    if (t.team === 'alien') {
      this.result.kills[t.spec] = (this.result.kills[t.spec] || 0) + 1;
      this.floatAt(t, '✖ ELIMINIERT', '#ffd080', true);
    } else if (t.team === 'player') {
      toast(`☠ ${t.name} ist gefallen.`, 'bad', 3500);
      Input.rumble(1, 1, 500);
    } else {
      this.result.civKilled++;
    }
    const obj = t.obj; const startY = obj.rotation.x;
    let k = 0;
    const anim = (dt) => {
      k += dt * 2.2;
      obj.rotation.x = startY - Math.min(1, k) * (Math.PI / 2) * (t.spec === 'drone' ? 0 : 1);
      if (t.spec === 'drone') obj.position.y = Math.max(-1.1, -k * 1.2);
      if (k > 1) { obj.position.y = Math.max(-0.4, obj.position.y - dt * 0.15); }
      if (k > 2.5) { t.dying = false; if (t.team === 'alien') obj.visible = this.vis[t.y * this.W + t.x] === 1; return false; }
      return true;
    };
    this.fx.push(anim);
    if (this.target === t) { this.target = null; }
    this.updateAlienBadges();
    this.checkEnd();
    if (t === this.selected && !this.ended) { this.selected = null; if (this.phase === 'player') this.cycleUnit(1); }
  }

  damageWall(x, y, amount) {
    const c = this.map.at(x, y); if (!c?.wall) return;
    c.wall.hp -= amount;
    if (c.wall.hp <= 0) {
      const t = c.wall.type;
      if (c.wall.idx != null) this.props[t].show(c.wall.idx, false);
      this.props[t].base[c.wall.idx] = this.props[t].zero;
      c.wall = null;
      const p = this.cellPos(x, y);
      const pos = new THREE.Vector3(p.x, 1, p.z);
      for (let i = 0; i < 14; i++) this.emit(pos, new THREE.Color(0.5, 0.45, 0.4), 0, 1.6, 1.2, false, true);
      this.scorch(x, y, 0.5);
      this.losDirty = true;
    }
  }

  scorch(x, y, r) {
    const c = this.groundCanvas.getContext('2d');
    const P = this.groundCanvas.width / this.W;
    const g = c.createRadialGradient((x + 0.5) * P, (y + 0.5) * P, 0, (x + 0.5) * P, (y + 0.5) * P, P * (r + 0.6));
    g.addColorStop(0, 'rgba(10,8,6,0.85)'); g.addColorStop(1, 'rgba(10,8,6,0)');
    c.fillStyle = g; c.beginPath(); c.arc((x + 0.5) * P, (y + 0.5) * P, P * (r + 0.6), 0, 7); c.fill();
    this.groundTex.needsUpdate = true;
  }

  // Wurfbahn eines Gegenstands (Granate, Nebel, Fackel); liefert das tatsächliche Aufschlagfeld
  async lobObject(u, tx, ty, id) {
    this.faceTo(u, tx, ty);
    const acc = u.team === 'player' && Game.cheats.aimbot ? 1 : clamp(u.acc / 100 + 0.2, 0.3, 0.95);
    if (rand() > acc) { tx = clamp(tx + randInt(-2, 2), 0, this.W - 1); ty = clamp(ty + randInt(-2, 2), 0, this.H - 1); }
    const kind = ITEMS[id]?.kind || 'grenade';
    const glow = id === 'alien' ? 0x50ff80 : kind === 'smoke' ? 0x9aa0a8 : kind === 'flare' ? 0xffd080 : 0xff6020;
    const from = this.muzzleWorld(u);
    const tp = this.cellPos(tx, ty);
    const to = new THREE.Vector3(tp.x, 0.2, tp.z);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshStandardMaterial({ color: 0x334422, emissive: glow, emissiveIntensity: 2 }));
    this.scene.add(ball);
    const dist = from.distanceTo(to), dur = 0.35 + dist * 0.02;
    this.camT.x = (from.x + to.x) / 2; this.camT.z = (from.z + to.z) / 2;
    let t = 0;
    while (t < dur) { const dt = await this.frame(); t += dt; const k = Math.min(1, t / dur); ball.position.lerpVectors(from, to, k); ball.position.y += Math.sin(k * Math.PI) * (2 + dist * 0.15); }
    this.scene.remove(ball); ball.geometry.dispose(); ball.material.dispose();
    return { x: tx, y: ty };
  }

  // Alien-Granaten (Aliens behalten das einfache Zählsystem u.grenades)
  async throwGrenade(u, tx, ty) {
    const it = ITEMS[u.grenadeKind || 'alien'];
    const cost = this.modeCost(u, 'grenade');
    if (!(u.grenades > 0) || !this.hasTu(u, cost) || Math.hypot(tx - u.x, ty - u.y) > THROW_RANGE) return false;
    this.busy = true;
    this.spendTu(u, cost);
    u.grenades--;
    const p = await this.lobObject(u, tx, ty, u.grenadeKind || 'alien');
    await this.explode(p.x, p.y, it.dmg, it.radius, u);
    this.busy = !!this.ended;
    return true;
  }

  // Gürtel-Gegenstand eines Soldaten benutzen (Wurf oder Medi-Kit)
  async useBelt(u, slot, tx, ty) {
    const b = this.beltEntry(u, slot), it = b && ITEMS[b.id];
    const deny = (msg, type = 'warn') => { toast(msg, type); sfx('deny'); return false; };
    if (!it) return deny('Gürtelplatz leer.');
    const cost = this.itemCost(u, b.id);
    if (!this.hasTu(u, cost)) return deny('Nicht genügend Zeiteinheiten.');
    if (it.kind === 'medkit') {
      const t = this.unitAt(tx, ty);
      if (!t || t.team !== 'player' || !t.alive) return deny('Medi-Kit: eigenen Soldaten (selbst oder angrenzend) wählen.');
      if (Math.max(Math.abs(t.x - u.x), Math.abs(t.y - u.y)) > 1) return deny('Zu weit entfernt – nur angrenzende Felder.');
      if (t.hp >= t.maxHp) return deny(`${t.name} ist unverletzt.`, 'info');
      this.spendTu(u, cost);
      const heal = Math.min(it.heal, t.maxHp - t.hp);
      t.hp += heal; t.healed = (t.healed || 0) + heal;
      this.consumeBelt(u, slot);
      if (t !== u) this.faceTo(u, t.x, t.y);
      this.floatAt(t, `+${heal} LP`, '#7dffa0', true);
      this.spark(this.bodyPoint(t), 0x60ff90, 12);
      sfx('select');
      return true;
    }
    if (Math.hypot(tx - u.x, ty - u.y) > THROW_RANGE) return deny(`Zu weit entfernt (max. ${THROW_RANGE} Felder).`);
    this.busy = true;
    this.spendTu(u, cost);
    this.consumeBelt(u, slot);
    const p = await this.lobObject(u, tx, ty, b.id);
    if (it.kind === 'grenade') await this.explode(p.x, p.y, it.dmg, it.radius, u);
    else if (it.kind === 'smoke') this.addSmoke(p.x, p.y, it);
    else if (it.kind === 'flare') this.addFlare(p.x, p.y, it);
    if (it.kind !== 'grenade' && !this.ended) this.updateVisibility();
    this.busy = !!this.ended;
    if (!this.ended) this.refreshUi();
    return true;
  }
  // Verbrauch zählen (nicht mit Cheat „alle Ausrüstung“); Medi-Kit zählt erst, wenn alle Ladungen weg sind
  consumeBelt(u, slot) {
    if (Game.cheats.allGear) return;
    const b = u.belt?.[slot]; if (!b) return;
    b.uses--;
    if (b.uses <= 0) { u.belt[slot] = null; this.result.itemsUsed[b.id] = (this.result.itemsUsed[b.id] || 0) + 1; }
  }

  // ---- Nebelgranate: Rauchwolke für it.turns Runden ----
  addSmoke(cx, cy, it) {
    const cloud = { x: cx, y: cy, r: it.radius, turns: it.turns, max: it.turns, alpha: 0, k: 0.4, puffs: [] };
    const p0 = this.cellPos(cx, cy);
    const R = it.radius * TILE;
    const want = Math.round(14 + it.radius * 6);
    for (let i = 0; i < want; i++) {
      const sp = this.smokePool.find((s) => !s.userData.used); if (!sp) break;
      sp.userData.used = true; sp.visible = true; sp.material.opacity = 0;
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * R * 0.95;
      const s = randRange(2.6, 4.4);
      sp.scale.setScalar(s); sp.material.rotation = rand() * 6;
      cloud.puffs.push({ sp, bx: Math.cos(a) * d, bz: Math.sin(a) * d, by: randRange(0.5, 2.6) * (1 - d / R * 0.4), s, ph: rand() * 6, rs: randRange(-0.25, 0.25), o: randRange(0.55, 1) });
    }
    cloud.px = p0.x; cloud.pz = p0.z;
    this.smokes.push(cloud);
    this.rebuildSmoke();
    sfx('hit');
    for (let i = 0; i < 12; i++) this.emit(new THREE.Vector3(p0.x, 0.4, p0.z), new THREE.Color(0.55, 0.56, 0.58), 0, 2.2, 1.2 + rand(), false, true);
  }
  rebuildSmoke() {
    this.smokeCells.fill(0);
    for (const c of this.smokes) {
      if (c.turns <= 0) continue;
      const r = c.r * (0.55 + 0.45 * c.turns / c.max), R = Math.ceil(r);
      for (let y = c.y - R; y <= c.y + R; y++) for (let x = c.x - R; x <= c.x + R; x++) {
        if (!this.inb(x, y) || Math.hypot(x - c.x, y - c.y) > r + 0.01) continue;
        const i = y * this.W + x; this.smokeCells[i] = Math.max(this.smokeCells[i], c.turns);
      }
    }
  }

  // ---- Leuchtfackel: Licht + glühendes Objekt für it.turns Runden ----
  addFlare(cx, cy, it) {
    const p = this.cellPos(cx, cy);
    const obj = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.55, 8).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xa02020, roughness: 0.6 }));
    stick.position.y = 0.07;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 4.2, 2.4) }));
    tip.position.set(0.28, 0.08, 0);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.particleTex, color: new THREE.Color(2.2, 1.5, 0.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.position.set(0.28, 0.25, 0); halo.scale.setScalar(2.4);
    obj.add(stick, tip, halo);
    obj.rotation.y = rand() * Math.PI * 2;
    obj.position.set(p.x, 0, p.z);
    this.scene.add(obj);
    const light = this.flareLights.find((l) => !l.userData.busy) || null;
    if (light) { light.userData.busy = true; light.position.set(p.x, 1.4, p.z); light.distance = it.radius * TILE * 1.7; }
    this.flares.push({ x: cx, y: cy, r: it.radius, turns: it.turns, max: it.turns, obj, halo, light, alpha: 0, t: rand() * 10 });
    sfx('click');
  }
  removeFlare(f) {
    this.scene.remove(f.obj);
    f.obj.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    if (f.light) { f.light.intensity = 0; f.light.userData.busy = false; }
  }
  // Rauch und Fackeln nehmen bei jedem Rundenwechsel ab
  decayEffects() {
    for (const c of this.smokes) if (c.turns > 0) c.turns--;
    for (const f of this.flares) if (f.turns > 0) f.turns--;
    this.rebuildSmoke();
  }
  updateEffects(dt, time) {
    for (const c of this.smokes) {
      const target = c.turns > 0 ? 0.45 + 0.4 * Math.sqrt(c.turns / c.max) : 0;
      c.alpha = smooth(c.alpha, target, c.turns > 0 ? 2.5 : 0.9, dt);
      c.k = smooth(c.k, c.turns > 0 ? 0.6 + 0.4 * c.turns / c.max : 1.15, 1.2, dt);
      for (const p of c.puffs) {
        const sw = Math.sin(time * 0.35 + p.ph);
        p.sp.position.set(c.px + p.bx * c.k + sw * 0.35, p.by + Math.sin(time * 0.5 + p.ph * 2) * 0.15, c.pz + p.bz * c.k + Math.cos(time * 0.3 + p.ph) * 0.35);
        p.sp.material.rotation += p.rs * dt;
        p.sp.material.opacity = c.alpha * p.o;
        p.sp.scale.setScalar(p.s * (0.85 + 0.25 * c.k));
      }
      if (c.turns <= 0 && c.alpha < 0.01) { for (const p of c.puffs) { p.sp.visible = false; p.sp.userData.used = false; } c.dead = true; }
    }
    if (this.smokes.some((c) => c.dead)) this.smokes = this.smokes.filter((c) => !c.dead);
    for (const f of this.flares) {
      f.t += dt;
      f.alpha = smooth(f.alpha, f.turns > 0 ? 1 : 0, f.turns > 0 ? 4 : 1.5, dt);
      const fl = 0.82 + 0.1 * Math.sin(f.t * 23) + 0.08 * Math.sin(f.t * 37 + 1.3);
      if (f.light) f.light.intensity = (this.map.night ? 70 : 30) * f.alpha * fl;
      f.halo.material.opacity = f.alpha * fl;
      f.halo.scale.setScalar(2.2 + fl * 0.6);
      if (f.turns > 0 && rand() < dt * 10) this.emit(f.halo.getWorldPosition(new THREE.Vector3()), new THREE.Color(3, 1.6, 0.5), 0.6, 0.35, 0.35);
      if (f.turns <= 0 && f.alpha < 0.02) { this.removeFlare(f); f.dead = true; }
    }
    if (this.flares.some((f) => f.dead)) this.flares = this.flares.filter((f) => !f.dead);
  }

  async explode(cx, cy, dmg, radius, src) {
    const p = this.cellPos(cx, cy);
    const pos = new THREE.Vector3(p.x, 0.6, p.z);
    sfx('explosion'); Input.rumble(1, 0.8, 450);
    this.shake = 0.9;
    this.flash(pos, 0xff9040, 60, 0.5);
    for (let i = 0; i < 40; i++) this.emit(pos, new THREE.Color(3, 1.4 + rand(), 0.3), 0, 4 + rand() * 4, 0.7 + rand() * 0.4);
    for (let i = 0; i < 25; i++) this.emit(pos, new THREE.Color(0.25, 0.23, 0.22), 0, 2 + rand() * 2, 2 + rand(), false, true);
    this.scorch(cx, cy, radius * 0.8);
    const R = Math.ceil(radius);
    for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {
      if (!this.inb(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy); if (d > radius) continue;
      const k = 1 - d / (radius + 0.5);
      const u = this.unitAt(x, y);
      if (u) this.damage(u, dmg * k + u.armor * 0.4, src);
      const w = this.wallAt(x, y);
      if (w) this.damageWall(x, y, dmg * k * 1.4 * randRange(0.7, 1.3));
    }
    await sleep(500);
    if (this.losDirty) { this.losDirty = false; this.updateVisibility(); }
  }

  // ======================= Effekte =======================
  emit(pos, color, vy = 0, spread = 1, life = 0.5, additive = true, smoke = false) {
    const p = this.particles.find((x) => x.life <= 0); if (!p) return;
    p.sp.visible = true;
    p.sp.position.copy(pos);
    p.sp.material.color.copy(color instanceof THREE.Color ? color : new THREE.Color(color));
    p.sp.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    p.sp.material.opacity = smoke ? 0.7 : 1;
    p.vel = new THREE.Vector3(randRange(-1, 1) * spread, vy + randRange(0.3, 1.2) * spread * (smoke ? 0.4 : 1), randRange(-1, 1) * spread);
    p.life = p.max = life;
    p.size0 = smoke ? 0.8 : 0.55; p.grow = smoke ? 2.4 : -0.3;
    p.smoke = smoke;
  }
  spark(pos, color, n) { for (let i = 0; i < n; i++) this.emit(pos, new THREE.Color(color).multiplyScalar(3), 0, 2.2, 0.3 + rand() * 0.2); }
  flash(pos, color, intensity, dur = 0.12) {
    const l = this.lightPool.find((x) => !x.userData.busy) || this.lightPool[0];
    l.position.copy(pos); l.position.y += 0.5; l.color.set(color); l.intensity = intensity; l.userData.busy = true;
    let t = 0;
    this.fx.push((dt) => { t += dt; l.intensity = intensity * Math.max(0, 1 - t / dur); if (t >= dur) { l.userData.busy = false; l.intensity = 0; return false; } return true; });
  }
  floatAt(u, text, color, big) {
    const p = (u.obj ? u.obj.position.clone() : new THREE.Vector3()).setY(2.4);
    const s = this.toScreen(p);
    if (s) floatText(s.x, s.y, text, color, big);
  }
  toScreen(v) {
    const p = v.clone().project(this.camera);
    if (p.z > 1) return null;
    const r = this.engine.canvas.getBoundingClientRect();
    return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height };
  }

  // ======================= Rundenablauf =======================
  async endTurn() {
    if (this.busy || this.phase !== 'player' || this.ended) return;
    this.phase = 'alien';
    this.clearTarget();
    this.rangeMesh.count = 0;
    this.updateHover();
    this.refreshUi();
    banner('ALIEN-AKTIVITÄT', `Runde ${this.turn}`, 'alien');
    sfx('alienTurn');
    setMusicMood('tac');
    await sleep(900);
    if (this.ended) return;
    for (const u of this.units) { u.revealed = false; if (u.alive && u.team === 'alien') u.tu = u.maxTu; }
    await this.alienTurn();
    if (this.ended) return;
    await this.civilianTurn();
    if (this.ended) return;
    this.turn++;
    this.decayEffects();
    for (const u of this.units) if (u.alive && u.team !== 'alien') u.tu = u.maxTu;
    this.phase = 'player';
    this.updateVisibility();
    banner('DEIN ZUG', `Runde ${this.turn}`);
    sfx('turn');
    if (!this.selected?.alive) this.cycleUnit(1);
    else this.select(this.selected, true);
    this.updateHover();
    this.refreshUi();
  }

  async alienTurn() {
    this.busy = true;
    const aliens = this.units.filter((u) => u.team === 'alien' && u.alive);
    for (const a of aliens) {
      if (this.ended) break;
      if (!a.alive) continue;
      await this.alienAct(a);
      if (this.ended) break;
      await sleep(a.obj.visible ? 250 : 10);
    }
    this.busy = !!this.ended;
  }

  alienTargets(a) {
    return this.units.filter((t) => t.alive && !t.evac && (t.team === 'player' || (t.team === 'civ' && this.opts.site.kind === 'terror')) && this.canSee(a, t.x, t.y));
  }

  async alienAct(a) {
    const w = WEAPONS[a.weapon];
    let guard = 0, shots = 0;
    const maxShots = a.boss ? 3 : this.turn === 1 ? 1 : 2;
    while (a.alive && !this.ended && guard++ < 8 && shots < maxShots) {
      let targets = this.alienTargets(a);
      const soldiersSeen = targets.filter((t) => t.team === 'player');
      if (soldiersSeen.length) targets = soldiersSeen;
      if (targets.length) {
        if (w.melee) {
          const t = targets.sort((p, q) => this.dist(a, p) - this.dist(a, q))[0];
          if (this.dist(a, t) < 1.6) {
            if (!this.hasTu(a, this.modeCost(a, 'snap'))) return;
            await this.fire(a, t, 'snap'); shots++;
            continue;
          }
          const moved = await this.moveToward(a, t, 0);
          if (!moved) return;
          continue;
        }
        // Granate gegen Gruppen
        if (a.grenades > 0 && this.hasTu(a, this.modeCost(a, 'grenade'))) {
          const gr = ITEMS[a.grenadeKind || 'alien'].radius + 0.6;
          const t = targets.find((tt) => this.units.filter((o) => o.alive && o.team === 'player' && this.dist(o, tt) < 2.5).length >= 2 && this.dist(a, tt) < 12
            && !this.units.some((o) => o.alive && o.team === 'alien' && this.dist(o, tt) < gr));
          if (t && rand() < 0.6) { await this.throwGrenade(a, t.x, t.y); shots++; continue; }
        }
        let best = null, bs = -1, bm = 'snap';
        for (const t of targets) for (const mode of ['aimed', 'snap', 'auto']) {
          if (!w[mode] || !this.hasTu(a, this.modeCost(a, mode))) continue;
          const c = this.hitChance(a, t, mode) * (w[mode].shots || 1) * (mode === 'aimed' ? 0.95 : 1);
          const score = c * (1.4 - t.hp / t.maxHp) * (t.team === 'player' ? 1.5 : 1);
          if (score > bs) { bs = score; best = t; bm = mode; }
        }
        if (!best) {
          return; // keine Zeiteinheiten mehr für Schüsse
        }
        if (this.hitChance(a, best, bm) < 0.3 && a.tu > this.modeCost(a, 'snap') + 12) {
          const moved = await this.repositionToShoot(a, best);
          if (moved) continue;
        }
        await this.fire(a, best, bm); shots++;
        continue;
      }
      // Kein Ziel sichtbar: suchen / patrouillieren
      const known = this.units.filter((t) => t.alive && !t.evac && t.team === 'player');
      const hunt = this.turn >= 4 || a.spec === 'beast' || a.boss === false && rand() < 0.15 * this.turn;
      if (a.guard && this.turn < 3 && rand() < 0.75) return;
      if (a.boss && this.turn < 6) return;
      const budget = Math.max(0, a.tu - this.modeCost(a, 'snap'));
      if (budget < 4) return;
      if (hunt && known.length) {
        const t = known.sort((p, q) => this.dist(a, p) - this.dist(a, q))[0];
        const moved = await this.moveToward(a, t, w.melee ? 0 : this.modeCost(a, 'snap'));
        if (!moved) return;
      } else {
        const { dist } = this.dijkstra(a, budget);
        const opts = [];
        for (let i = 0; i < this.N; i++) if (dist[i] < Infinity && dist[i] > 6) opts.push(i);
        if (!opts.length) return;
        const i = choice(opts);
        const { prev } = this.dijkstra(a, budget);
        await this.moveUnit(a, this.buildPath(prev, i % this.W, (i / this.W) | 0), { noStop: true });
      }
      if (!this.alienTargets(a).length) return;
    }
  }

  async moveToward(a, t, keepTu) {
    const budget = a.tu - keepTu;
    if (budget < 4) return false;
    const full = this.dijkstra(a, Infinity, false);
    // nächstes freies Nachbarfeld des Ziels
    let best = null, bd = Infinity;
    for (const [dx, dy] of DIRS) {
      const x = t.x + dx, y = t.y + dy;
      if (!this.inb(x, y)) continue;
      const d = full.dist[y * this.W + x];
      if (d < bd) { bd = d; best = { x, y }; }
    }
    if (!best) return false;
    let path = this.buildPath(full.prev, best.x, best.y);
    // nur so weit gehen, wie das Budget reicht
    let acc = 0, cut = [];
    let px = a.x, py = a.y;
    for (const s of path) { const c = s.x !== px && s.y !== py ? 6 : 4; if (acc + c > budget) break; acc += c; cut.push(s); px = s.x; py = s.y; }
    if (!cut.length) return false;
    await this.moveUnit(a, cut, { noStop: true });
    return true;
  }

  async repositionToShoot(a, t) {
    const budget = a.tu - this.modeCost(a, 'snap');
    const { dist, prev } = this.dijkstra(a, budget);
    let best = null, bs = this.hitChance(a, t, 'snap') + 0.05;
    for (let i = 0; i < this.N; i++) {
      if (dist[i] === Infinity || dist[i] === 0) continue;
      const x = i % this.W, y = (i / this.W) | 0;
      if (Math.hypot(x - t.x, y - t.y) > 14 || !this.los(x, y, t.x, t.y)) continue;
      const ox = a.x, oy = a.y; a.x = x; a.y = y;
      let s = this.hitChance(a, t, 'snap');
      const covered = this.coverBetween(t, a);
      a.x = ox; a.y = oy;
      if (covered) s += 0.12;
      s -= dist[i] * 0.004;
      if (s > bs) { bs = s; best = { x, y }; }
    }
    if (!best) return false;
    await this.moveUnit(a, this.buildPath(prev, best.x, best.y), { noStop: true });
    return true;
  }

  async civilianTurn() {
    const civs = this.units.filter((u) => u.team === 'civ' && u.alive);
    for (const c of civs) {
      const threat = this.units.find((a) => a.team === 'alien' && a.alive && this.dist(a, c) < 10);
      if (!threat) continue;
      const { dist, prev } = this.dijkstra(c, 24);
      let best = null, bd = this.dist(c, threat);
      for (let i = 0; i < this.N; i++) {
        if (dist[i] === Infinity) continue;
        const x = i % this.W, y = (i / this.W) | 0;
        const d = Math.hypot(x - threat.x, y - threat.y) + rand() * 2;
        if (d > bd) { bd = d; best = { x, y }; }
      }
      if (best) await this.moveUnit(c, this.buildPath(prev, best.x, best.y), { noStop: true });
    }
  }

  checkEnd() {
    if (this.ended || this.disposed) return;
    const aliens = this.units.filter((u) => u.team === 'alien' && u.alive);
    const soldiers = this.units.filter((u) => u.team === 'player' && u.alive && !u.evac);
    const boss = this.units.find((u) => u.boss);
    if (!aliens.length || (boss && !boss.alive)) this.finish(true);
    else if (!soldiers.length) this.finish(false);
  }

  async abort() {
    if (this.ended || this.busy || this.phase !== 'player') { toast('Rückzug nur während deines Zuges möglich.', 'warn'); return; }
    const lzNow = () => this.units.filter((u) => u.team === 'player' && u.alive && this.map.lz.some((p) => p.x === u.x && p.y === u.y));
    const pre = lzNow();
    const total = this.units.filter((u) => u.team === 'player' && u.alive).length;
    const ok = await confirmBox(`Mission abbrechen?<br><br>${pre.length} von ${total} Soldaten befinden sich in der Landezone und werden evakuiert.${pre.length < total ? '<br><b class="bad">Alle anderen gelten als vermisst!</b>' : ''}`, 'Abbrechen & Rückzug');
    if (!ok || this.ended) return;
    const onLz = lzNow();
    for (const u of this.units) {
      if (u.team !== 'player' || !u.alive) continue;
      if (onLz.includes(u)) u.evac = true; else { u.alive = false; u.mia = true; }
    }
    this.finish(false, true);
  }

  finish(won, aborted = false) {
    if (this.ended) return;
    this.ended = true;
    this.busy = true;
    const c = Game.c;
    const site = this.opts.site;
    const r = this.result;
    r.won = won;
    let score = 0;
    const lines = [];
    // Aliens & Artefakte
    const totalKills = Object.values(r.kills).reduce((a, b) => a + b, 0);
    const artifacts = {};
    const addA = (k, n) => { if (n > 0) artifacts[k] = (artifacts[k] || 0) + n; };
    for (const [type, n] of Object.entries(r.kills)) {
      score += ALIENS[type].score * n;
      if (won) {
        addA(ALIENS[type].corpse, n);
        const wk = ALIENS[type].weapon;
        if (wk === 'a_rifle' || wk === 'a_pistol' || wk === 'a_heavy') addA('Plasmawaffe', n);
      }
    }
    if (won) {
      const stunnedAll = this.units.filter((u) => u.team === 'alien' && u.alive);
      stunnedAll.forEach(() => {}); // alle Aliens erledigt
      if (site.ufoType) {
        const R = UFOS[site.ufoType].radius;
        addA('Alien-Legierung', R * (site.kind === 'crash' ? 2 : 3));
        addA('Zerium', site.kind === 'crash' ? randInt(1, 3) : randInt(3, 6));
        if (site.ufoType !== 'scout') addA('UFO-Navigationsmodul', 1);
        score += UFOS[site.ufoType].score;
      }
      score += site.kind === 'terror' ? 100 : 50;
    } else score -= site.kind === 'terror' ? 150 : 40;
    // Zivilisten
    if (site.kind === 'terror') {
      r.civSaved = won ? this.units.filter((u) => u.team === 'civ' && u.alive).length : 0;
      score += r.civSaved * 10 - r.civKilled * 15;
    }
    // Soldaten
    const dead = [], survivors = [];
    for (const u of this.units.filter((x) => x.team === 'player')) {
      const s = u.soldier;
      if (!u.alive) { dead.push(u); score -= 25; c.soldiers = c.soldiers.filter((x) => x.id !== s.id); c.stats.lost++; continue; }
      const promoted = Game.awardXp(s, u.kills, true);
      s.wound = Math.ceil(Math.max(0, u.dmgTaken - (u.healed || 0)) / 4);
      survivors.push({ u, promoted });
    }
    // Lager
    for (const [k, n] of Object.entries(artifacts)) c.artifacts[k] = (c.artifacts[k] || 0) + n;
    // gefallene/vermisste Soldaten verlieren ihre mitgeführten Gürtel-Gegenstände (Medi-Kit = 1 Stück)
    if (!Game.cheats.allGear) for (const u of dead) for (const b of u.belt || []) if (b && ITEMS[b.id]) r.itemsUsed[b.id] = (r.itemsUsed[b.id] || 0) + 1;
    c.stock ||= {};
    for (const [k, n] of Object.entries(r.itemsUsed)) c.stock[k] = Math.max(0, (c.stock[k] || 0) - n);
    const usedTxt = Object.entries(r.itemsUsed).filter(([k, n]) => n > 0 && ITEMS[k]).map(([k, n]) => `${ITEMS[k].icon} ${ITEMS[k].name} ×${n}`).join('<br>');
    // tote Soldaten verlieren ihre Ausrüstung
    for (const u of dead) { const s = u.soldier; if (s.weapon !== 'rifle') c.stock[s.weapon] = Math.max(0, (c.stock[s.weapon] || 0) - 1); if (s.armor !== 'none') c.stock[s.armor] = Math.max(0, (c.stock[s.armor] || 0) - 1); }
    const bounty = won ? totalKills * 15000 + (site.ufoType ? UFOS[site.ufoType].radius * 40000 : 0) : 0;
    c.credits += bounty;
    c.stats.missions++; if (won) c.stats.won++;
    c.stats.kills += totalKills;
    Game.addScore(score, site.region);
    r.score = score;

    setTimeout(() => {
      sfx(won ? 'victory' : 'defeat');
      banner(won ? 'MISSION ERFOLGREICH' : aborted ? 'RÜCKZUG' : 'MISSION GESCHEITERT', '', won ? '' : 'alien');
      setTimeout(() => {
        modal({
          title: won ? '✔ Einsatzbericht – Erfolg' : '✖ Einsatzbericht – Fehlschlag', closable: false, wide: true,
          html: `<div class="grid2"><div>
            <h4>Ergebnis</h4>
            <p>Eliminierte Aliens: <b>${totalKills}</b></p>
            ${site.kind === 'terror' ? `<p>Gerettete Zivilisten: <b class="good">${r.civSaved}</b> · Opfer: <b class="bad">${r.civKilled}</b></p>` : ''}
            <p>Wertung: <b class="${score >= 0 ? 'good' : 'bad'}">${score >= 0 ? '+' : ''}${score}</b></p>
            ${bounty ? `<p>Bergungsprämie: <b class="good">${bounty.toLocaleString('de-DE')} ¢</b></p>` : ''}
            <h4>Geborgene Artefakte</h4><p class="muted">${Object.entries(artifacts).map(([k, n]) => `${k} ×${n}`).join('<br>') || 'Keine'}</p>
            <h4>Verbrauchte Ausrüstung</h4><p class="muted">${usedTxt || 'Keine'}</p></div>
            <div><h4>Trupp</h4>
            ${survivors.map(({ u, promoted }) => `<div class="res-sol">✔ ${u.name} <small>${RANKS[u.soldier.rank]} · ${u.kills} Kills${u.soldier.wound ? ` · verwundet ${u.soldier.wound} T` : ''}</small>${promoted ? ' <b class="good">Beförderung!</b>' : ''}</div>`).join('')}
            ${dead.map((u) => `<div class="res-sol bad">☠ ${u.name} <small>${u.mia ? 'vermisst' : 'gefallen'}</small></div>`).join('')}
            </div></div>`,
          buttons: [{ label: 'Zurück zum Hauptquartier', primary: true, action: () => this.hooks.endMission(site, r) }],
        });
      }, 1400);
    }, 600);
  }

  // ======================= Spieler-Interaktion =======================
  select(u, quiet) {
    if (!u || !u.alive || u.team !== 'player' || u.evac) return;
    const prev = this.selected;
    this.selected = u;
    this.clearTarget();
    if (!quiet) sfx('select');
    this.camT.x = u.obj.position.x; this.camT.z = u.obj.position.z;
    this.cursor = { x: u.x, y: u.y };
    if (this.mode === 'belt' ? (u !== prev || !this.beltEntry(u)) : WEAPONS[u.weapon][this.mode] == null) this.mode = 'snap';
    this.computeRange();
    this.updateHover();
    this.refreshUi();
  }
  cycleUnit(dir) {
    if (this.busy && this.phase === 'player') return;
    const list = this.units.filter((u) => u.team === 'player' && u.alive && !u.evac);
    if (!list.length) return;
    const i = list.indexOf(this.selected);
    this.select(list[i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length]);
  }
  recenter() { const u = this.selected; if (u) { this.camT.x = u.obj.position.x; this.camT.z = u.obj.position.z; } }
  computeRange() {
    const u = this.selected;
    if (!u || this.phase !== 'player') { this.rangeMesh.count = 0; this.reach = null; return; }
    const budget = Game.cheats.infTU ? 80 : u.tu;
    this.reach = this.dijkstra(u, budget);
    const mtx = new THREE.Matrix4();
    let k = 0;
    for (let i = 0; i < this.N; i++) {
      if (this.reach.dist[i] === Infinity || this.reach.dist[i] === 0 || !this.explored[i]) continue;
      const p = this.cellPos(i % this.W, (i / this.W) | 0);
      mtx.makeTranslation(p.x, 0, p.z);
      this.rangeMesh.setMatrixAt(k++, mtx);
    }
    this.rangeMesh.count = k;
    this.rangeMesh.instanceMatrix.needsUpdate = true;
  }
  clearTarget() { this.target = null; this.grenadeTarget = null; this.pendingMove = null; this.tgtRing.visible = false; }
  setMode(m) {
    const u = this.selected; if (!u || this.busy || this.phase !== 'player') return;
    if (m === 'grenade' || m === 'belt') { // Kompatibilität: erster Wurfgegenstand
      const k = this.beltSlots(u).find((i) => ITEMS[u.belt[i].id].kind !== 'medkit');
      if (k == null) { toast('Keine Wurfgegenstände im Gürtel.', 'warn'); sfx('deny'); return; }
      this.setBelt(k); return;
    }
    if (!WEAPONS[u.weapon][m]) { sfx('deny'); return; }
    this.mode = m; this.grenadeTarget = null; sfx('click');
    this.updateHover(); this.refreshUi();
  }
  // Gürtelplatz wählen (erneut wählen = zurück zum Schnappschuss)
  setBelt(slot) {
    const u = this.selected; if (!u || this.busy || this.phase !== 'player') return;
    if (this.mode === 'belt' && this.beltSlot === slot) { this.setMode('snap'); return; }
    const b = this.beltEntry(u, slot);
    if (!b) { toast('Gürtelplatz leer.', 'warn'); sfx('deny'); return; }
    this.mode = 'belt'; this.beltSlot = slot; this.grenadeTarget = null; this.pendingMove = null;
    if (ITEMS[b.id].kind === 'medkit') { this.target = null; this.tgtRing.visible = false; }
    sfx('click');
    this.updateHover(); this.refreshUi();
  }
  // Controller ▼: Gürtelplätze nacheinander durchschalten, danach zurück zur Waffe
  cycleBelt() {
    const u = this.selected; if (!u) return;
    const slots = this.beltSlots(u);
    if (!slots.length) { toast('Gürtel leer.', 'warn'); sfx('deny'); return; }
    if (this.mode !== 'belt') { this.setBelt(slots[0]); return; }
    const i = slots.indexOf(this.beltSlot);
    if (i < 0 || i === slots.length - 1) this.setMode('snap'); else this.setBelt(slots[i + 1]);
  }
  cycleMode() {
    const u = this.selected; if (!u) return;
    const opts = ['snap', 'aimed', 'auto'].filter((m) => WEAPONS[u.weapon][m]).map((m) => ({ m }));
    this.beltSlots(u).forEach((k) => opts.push({ m: 'belt', k }));
    const i = opts.findIndex((o) => o.m === this.mode && (o.m !== 'belt' || o.k === this.beltSlot));
    const n = opts[(i + 1) % opts.length];
    if (n.m === 'belt') { if (this.mode === 'belt' && this.beltSlot === n.k) return; this.setBelt(n.k); } else this.setMode(n.m);
  }
  toggleKneel() {
    const u = this.selected; if (!u || !u.alive || this.busy || this.ended || this.phase !== 'player') return;
    const cost = u.kneel ? 6 : 4;
    if (!this.hasTu(u, cost)) { toast('Nicht genügend Zeiteinheiten.', 'warn'); return; }
    this.spendTu(u, cost); u.kneel = !u.kneel; sfx('click'); this.computeRange(); this.updateHover(); this.refreshUi();
  }

  // Klick/Tipp/Ⓐ auf ein Feld
  async actAt(x, y, confirmTwice) {
    if (this.busy || this.phase !== 'player' || this.ended || !this.inb(x, y)) return;
    if (this.selected && !this.selected.alive) { this.selected = null; this.cycleUnit(1); }
    const u = this.selected;
    let other = this.unitAt(x, y);
    if (other && u && !this.knownBlocker(u, other)) other = null; // unsichtbare Einheiten nicht verraten
    const item = u && this.mode === 'belt' ? this.beltEntry(u) : null;
    if (u && this.mode === 'belt' && !item) { this.mode = 'snap'; this.refreshUi(); }
    // Medi-Kit: Klick auf eigenen Soldaten heilt statt auszuwählen
    if (item && ITEMS[item.id].kind === 'medkit' && other && other.team === 'player') {
      const ok = await this.useBelt(u, this.beltSlot, x, y);
      if (ok && !this.beltEntry(u)) this.mode = 'snap';
      this.afterAction(); return;
    }
    if (other && other.team === 'player' && other !== u) { this.select(other); return; }
    if (!u) return;
    if (item && ITEMS[item.id].kind === 'medkit') { toast('Medi-Kit: eigenen Soldaten (selbst oder angrenzend) wählen.', 'warn'); sfx('deny'); return; }
    if (item) {
      if (this.grenadeTarget && this.grenadeTarget.x === x && this.grenadeTarget.y === y) {
        this.grenadeArea.visible = false; this.clearPath();
        await this.useBelt(u, this.beltSlot, x, y);
        this.grenadeTarget = null; this.mode = 'snap'; this.afterAction(); return;
      }
      this.grenadeTarget = { x, y }; sfx('click'); this.updateHover(); this.refreshUi(); return;
    }
    if (other && other.team !== 'player' && (other.team === 'civ' ? false : this.isVisibleAlien(other))) {
      if (this.target === other) { await this.fireAtTarget(); return; }
      this.target = other; sfx('select');
      this.tgtRing.visible = true;
      this.refreshUi();
      return;
    }
    if (other) return;
    // Bewegung
    if (!this.reach) this.computeRange();
    const d = this.reach.dist[y * this.W + x];
    if (d === Infinity || d === 0) { if (this.explored[y * this.W + x]) { sfx('deny'); } return; }
    if (confirmTwice && !(this.pendingMove && this.pendingMove.x === x && this.pendingMove.y === y)) { this.pendingMove = { x, y }; this.cursor = { x, y }; this.updateHover(); sfx('click'); return; }
    this.pendingMove = null;
    this.clearTarget();
    this.clearPath(); this.rangeMesh.count = 0;
    await this.moveUnit(u, this.buildPath(this.reach.prev, x, y));
    this.afterAction();
  }
  async fireAtTarget() {
    const u = this.selected, t = this.target;
    if (!u || !u.alive || !t || !t.alive || this.busy || this.ended || this.phase !== 'player') return;
    if (this.mode === 'belt') return;
    if (!this.canSee(u, t.x, t.y) && !(WEAPONS[u.weapon].melee)) { toast('Keine Sichtlinie zum Ziel.', 'warn'); sfx('deny'); return; }
    this.rangeMesh.count = 0; this.clearPath();
    await this.fire(u, t, this.mode);
    this.afterAction();
  }
  afterAction() {
    if (this.ended) return;
    if (this.selected && !this.selected.alive) { this.selected = null; this.cycleUnit(1); }
    if (this.target && !this.target.alive) this.clearTarget();
    this.computeRange(); this.updateHover(); this.refreshUi();
  }

  // Pfadpunkte und ZE-Zählspur ausblenden
  clearPath() {
    this.pathDots.count = 0;
    this.pathLabelData.length = 0;
    this.syncPathLabels();
  }
  // DOM-Labels der ZE-Zählspur aktualisieren (Text/Farbe nur bei Pfadwechsel; Positionen pro Frame)
  syncPathLabels() {
    const els = this.plabEls; if (!els) return;
    const data = this.pathLabelData, n = Math.min(PATH_LABELS, data.length);
    for (let i = 0; i < n; i++) {
      const d = data[i], e = els[i];
      const txt = String(d.v), cls = `plab ${d.cls}${i === n - 1 ? ' end' : ''}`;
      if (e._t !== txt) { e.textContent = txt; e._t = txt; }
      if (e.className !== cls) e.className = cls;
      if (e._on !== true) { e.style.display = ''; e._on = true; }
    }
    for (let i = n; i < this.plabCount; i++) { els[i].style.display = 'none'; els[i]._on = false; }
    this.plabCount = n;
    if (n) this.placePathLabels();
  }
  placePathLabels() {
    const n = this.plabCount; if (!n) return;
    const els = this.plabEls;
    if (!this.active || this.ended || this.busy || this.phase !== 'player') { for (let i = 0; i < n; i++) els[i].style.visibility = 'hidden'; return; }
    this.camera.updateMatrixWorld();
    const r = this.engine.canvas.getBoundingClientRect();
    const v = this._plabV || (this._plabV = new THREE.Vector3());
    for (let i = 0; i < n; i++) {
      const d = this.pathLabelData[i], p = this.cellPos(d.x, d.y), e = els[i];
      v.set(p.x, 0.25, p.z).project(this.camera);
      if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) { e.style.visibility = 'hidden'; continue; }
      e.style.visibility = '';
      e.style.transform = `translate(${(r.left + (v.x * 0.5 + 0.5) * r.width).toFixed(1)}px,${(r.top + (-v.y * 0.5 + 0.5) * r.height).toFixed(1)}px)`;
    }
  }

  updateHover() {
    const { x, y } = this.cursor;
    if (this.phase !== 'player') { this.cursorMesh.visible = this.cursorFill.visible = false; this.clearPath(); this.grenadeArea.visible = false; const h = document.getElementById('t-hover'); if (h) h.textContent = ''; return; }
    const inb = this.inb(x, y);
    this.cursorMesh.visible = this.cursorFill.visible = inb && this.phase === 'player';
    this.pathDots.count = 0; this.grenadeArea.visible = false;
    this.pathLabelData.length = 0;
    this.hoverInfo = '';
    if (!inb) { this.syncPathLabels(); return; }
    const p = this.cellPos(x, y);
    this.cursorMesh.position.set(p.x, 0.06, p.z); this.cursorFill.position.set(p.x, 0.04, p.z);
    const u = this.selected;
    const other = this.unitAt(x, y);
    let col = new THREE.Color(2, 2, 2);
    const item = u && this.mode === 'belt' ? this.beltEntry(u) : null;
    const it = item && ITEMS[item.id];
    if (u && this.phase === 'player' && !this.busy) {
      if (it && it.kind === 'medkit') {
        const near = other && other.team === 'player' && other.alive && Math.max(Math.abs(other.x - u.x), Math.abs(other.y - u.y)) <= 1;
        const left = Game.cheats.allGear ? '∞' : item.uses;
        if (!near) { this.hoverInfo = `Medi-Kit (${left} Ladung${item.uses === 1 ? '' : 'en'}): eigenen Soldaten – selbst oder angrenzend – wählen`; col = new THREE.Color(2, 0.6, 0.3); }
        else if (other.hp >= other.maxHp) { this.hoverInfo = `${other.name}: unverletzt (${other.hp}/${other.maxHp} LP)`; col = new THREE.Color(1.5, 1.5, 1.5); }
        else { this.hoverInfo = `Medi-Kit: ${other === u ? 'selbst' : other.name} heilen (+${Math.min(it.heal, other.maxHp - other.hp)} LP) – ${this.itemCost(u, item.id)} ZE · ${left} Ladung${item.uses === 1 ? '' : 'en'}`; col = new THREE.Color(0.5, 2.8, 1.2); }
      } else if (it) {
        this.grenadeArea.visible = true; this.grenadeArea.position.set(p.x, 0.07, p.z); this.grenadeArea.scale.setScalar(it.radius * TILE);
        this.grenadeArea.material.color.set(ITEM_COLORS[it.kind] || ITEM_COLORS.grenade).multiplyScalar(2.2);
        this.grenadeArea.material.opacity = it.kind === 'flare' ? 0.1 : 0.18;
        const d = Math.hypot(x - u.x, y - u.y);
        this.hoverInfo = d > THROW_RANGE ? 'Außer Reichweite' : `${it.name} werfen – ${this.itemCost(u, item.id)} ZE${this.grenadeTarget ? ' · erneut bestätigen' : ''}`;
        col = d > THROW_RANGE ? new THREE.Color(2, 0.6, 0.3) : new THREE.Color(2.5, 1.2, 0.3);
      } else if (other && other.team === 'alien' && this.isVisibleAlien(other)) {
        const c = this.hitChance(u, other, this.mode);
        this.hoverInfo = `${other.name} · Treffer ${Math.round(c * 100)} % · ${this.modeCost(u, this.mode)} ZE${this.coverBetween(u, other) ? ' · in Deckung' : ''}${this.inSmoke(other.x, other.y) ? ' · im Rauch' : ''}`;
        col = new THREE.Color(3, 0.4, 0.4);
      } else if (!other && this.reach) {
        const d = this.reach.dist[y * this.W + x];
        if (d < Infinity && d > 0) {
          const path = this.buildPath(this.reach.prev, x, y);
          const mtx = new THREE.Matrix4(), c = new THREE.Color();
          const inf = Game.cheats.infTU, snap = this.modeCost(u, 'snap');
          const left = u.tu - d;
          const n = Math.min(80, path.length);
          // ZE-Zählspur: verbleibende ZE nach jedem Schritt (grün = Schnappschuss noch möglich, gelb = nur Bewegung)
          for (let i = 0; i < n; i++) {
            const s = path[i], pp = this.cellPos(s.x, s.y);
            const rem = inf ? u.tu : u.tu - this.reach.dist[s.y * this.W + s.x];
            const ok = inf || rem >= snap;
            mtx.makeTranslation(pp.x, 0.2, pp.z); this.pathDots.setMatrixAt(i, mtx);
            this.pathDots.setColorAt(i, ok ? c.setRGB(0.4, 2.5, 1.2) : rem >= 0 ? c.setRGB(2.5, 1.8, 0.3) : c.setRGB(2.5, 0.4, 0.3));
          }
          const first = Math.max(0, path.length - PATH_LABELS);
          for (let i = first; i < path.length; i++) {
            const s = path[i];
            const rem = inf ? u.tu : u.tu - this.reach.dist[s.y * this.W + s.x];
            this.pathLabelData.push({ x: s.x, y: s.y, v: Math.max(0, rem), cls: inf || rem >= snap ? 'ok' : rem >= 0 ? 'mv' : 'no' });
          }
          this.pathDots.count = n;
          this.pathDots.instanceMatrix.needsUpdate = true; if (this.pathDots.instanceColor) this.pathDots.instanceColor.needsUpdate = true;
          this.hoverInfo = `Bewegen: ${d} ZE (Rest ${Math.max(0, left)})${this.pendingMove ? ' · erneut tippen zum Bestätigen' : ''}`;
          col = new THREE.Color(0.5, 2.5, 1.5);
        } else if (this.explored[y * this.W + x]) { this.hoverInfo = 'Nicht erreichbar'; col = new THREE.Color(2, 0.6, 0.3); }
      }
    }
    this.syncPathLabels();
    this.cursorMesh.material.color.copy(col);
    const hi = document.getElementById('t-hover'); if (hi) hi.textContent = this.hoverInfo;
  }

  // ======================= HUD =======================
  buildHud() {
    const hud = document.getElementById('hud');
    hud.innerHTML = `
      <div class="tac-plabels" id="t-plab"></div>
      <div class="tac-top">
        <div class="panel tac-turn"><b id="t-turn">Runde 1</b><span id="t-phase">Dein Zug</span></div>
        <div class="tac-aliens" id="t-aliens"></div>
        <button class="btn icon" id="t-menu" title="Menü">☰</button>
      </div>
      <div class="tac-hover" id="t-hover"></div>
      <div class="tac-bottom">
        <div class="panel unit-card" id="t-unit"></div>
        <div class="tac-actions" id="t-actions">
          <button class="btn act" data-mode="snap"><b>Schnapp</b><small id="m-snap"></small></button>
          <button class="btn act" data-mode="aimed"><b>Gezielt</b><small id="m-aimed"></small></button>
          <button class="btn act" data-mode="auto"><b>Salve</b><small id="m-auto"></small></button>
          ${Array.from({ length: BELT_SLOTS }, (_, k) => `<button class="btn act belt" data-belt="${k}" title="Gürtelplatz ${k + 1} (Taste ${k + 4})"><b>Gürtel</b><small>leer</small></button>`).join('')}
          <button class="btn act fire" data-a="fire"><b>FEUER</b><small id="m-fire"></small></button>
          <button class="btn act" data-a="kneel"><b>Knien</b><small>4 ZE</small></button>
          <button class="btn act" data-a="prev"><b>◀</b><small>Soldat</small></button>
          <button class="btn act" data-a="next"><b>▶</b><small>Soldat</small></button>
          <button class="btn act end" data-a="end"><b>Zug beenden</b><small id="m-end"></small></button>
          <button class="btn act danger" data-a="abort"><b>⚑</b><small>Rückzug</small></button>
        </div>
      </div>
      <div class="pad-hints" id="t-padhint"></div>`;
    // HUD-Buttons behalten keinen Fokus, damit Leertaste/Enter weiter als Tastenkürzel wirken
    hud.querySelectorAll('.tac-actions .btn, #t-menu').forEach((b) => b.addEventListener('pointerdown', (e) => e.preventDefault()));
    hud.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { b.blur(); this.setMode(b.dataset.mode); }));
    hud.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => { b.blur(); this.btnAction(b.dataset.a); }));
    hud.querySelectorAll('[data-belt]').forEach((b) => b.addEventListener('click', () => { b.blur(); this.setBelt(+b.dataset.belt); }));
    // Pool für die ZE-Zählspur (wird wiederverwendet, nie pro Frame neu angelegt)
    const plab = hud.querySelector('#t-plab');
    this.plabEls = Array.from({ length: PATH_LABELS }, () => { const e = document.createElement('span'); e.className = 'plab'; e.style.display = 'none'; plab.appendChild(e); return e; });
    this.plabCount = 0;
    hud.querySelector('#t-menu').addEventListener('click', () => this.hooks.openMenu());
    this.updatePadHints();
  }
  btnAction(a) {
    if (a === 'fire') { if (this.mode === 'belt' && this.grenadeTarget) this.actAt(this.grenadeTarget.x, this.grenadeTarget.y, false); else this.fireAtTarget(); }
    if (a === 'kneel') this.toggleKneel();
    if (a === 'prev') this.cycleUnit(-1);
    if (a === 'next') this.cycleUnit(1);
    if (a === 'end') this.confirmEndTurn();
    if (a === 'abort') this.abort();
  }
  async confirmEndTurn() {
    if (this.busy || this.phase !== 'player') return;
    const idle = this.units.filter((u) => u.team === 'player' && u.alive && !u.evac && u.tu === u.maxTu).length;
    if (idle >= 2 && !Game.cheats.infTU && this.engine.settings.confirmEnd !== false) {
      if (!(await confirmBox(`${idle} Soldaten haben noch nicht gehandelt. Zug wirklich beenden?`, 'Zug beenden'))) return;
    }
    this.endTurn();
  }
  updatePadHints() {
    const h = document.getElementById('t-padhint'); if (!h) return;
    h.innerHTML = `<span>${padLabel('A')} Aktion</span><span>${padLabel('X')} Modus</span><span>${padLabel('Y')} Knien</span><span>${padLabel('B')} Abbruch</span><span>${padLabel('LB')}/${padLabel('RB')} Soldat</span><span>✚◀▶ Ziel</span><span>✚▼ Gürtel</span><span>${padLabel('SELECT')} Zug beenden</span><span>${padLabel('START')} Menü</span>`;
  }
  updateAlienBadges() {
    const box = document.getElementById('t-aliens'); if (!box) return;
    const seen = this.units.filter((u) => u.team === 'alien' && u.alive && this.isVisibleAlien(u));
    box.innerHTML = seen.map((u, i) => `<button class="alien-badge ${this.target === u ? 'on' : ''}" data-alien="${u.id}" title="${u.name}">${i + 1}</button>`).join('');
    box.querySelectorAll('[data-alien]').forEach((b) => b.addEventListener('click', () => { const a = this.units[+b.dataset.alien]; this.focusAlien(a); }));
  }
  focusAlien(a) {
    if (!a || this.busy || this.phase !== 'player') return;
    this.cursor = { x: a.x, y: a.y };
    this.camT.x = a.obj.position.x; this.camT.z = a.obj.position.z;
    if (this.mode === 'belt') this.mode = 'snap';
    this.target = a; this.tgtRing.visible = true; sfx('select');
    this.updateHover(); this.refreshUi();
  }
  cycleAlien(dir) {
    const seen = this.units.filter((u) => u.team === 'alien' && u.alive && this.isVisibleAlien(u));
    if (!seen.length) { sfx('deny'); return; }
    const i = seen.indexOf(this.target);
    this.focusAlien(seen[i < 0 ? (dir > 0 ? 0 : seen.length - 1) : (i + dir + seen.length) % seen.length]);
  }
  refreshUi() {
    const u = this.selected;
    const t = document.getElementById('t-turn'); if (!t) return;
    t.textContent = `Runde ${this.turn}`;
    document.getElementById('t-phase').textContent = this.phase === 'player' ? 'Dein Zug' : 'Alien-Aktivität …';
    document.body.classList.toggle('alien-phase', this.phase !== 'player');
    const card = document.getElementById('t-unit');
    if (u) {
      card.innerHTML = `<div class="uc-head"><span class="rank r${u.rank}">${'★'.repeat(u.rank) || '•'}</span><b>${u.name}</b><small>${RANKS[u.rank]} · ${WEAPONS[u.weapon].name}${u.kneel ? ' · kniend' : ''}</small></div>
        <div class="uc-bars"><label>ZE</label>${bar(Game.cheats.infTU ? u.maxTu : u.tu, u.maxTu, 'tu')}<label>LP</label>${bar(u.hp, u.maxHp, u.hp < u.maxHp * 0.4 ? 'bad' : 'good')}</div>
        <div class="uc-extra uc-belt">Gürtel: ${(u.belt || []).filter((b) => b && ITEMS[b.id]).map((b) => `<span>${ITEMS[b.id].icon} ${ITEMS[b.id].short}${ITEMS[b.id].kind === 'medkit' ? ` (${Game.cheats.allGear ? '∞' : b.uses})` : ''}</span>`).join(' · ') || 'leer'}</div>
        <div class="uc-extra">Kills: ${u.kills} · Treff: ${u.acc}${this.inSmoke(u.x, u.y) ? ' · im Rauch' : ''}</div>`;
      const w = WEAPONS[u.weapon];
      for (const m of ['snap', 'aimed', 'auto']) {
        const b = document.querySelector(`[data-mode="${m}"]`);
        const ok = !!w[m];
        b.disabled = !ok || this.phase !== 'player';
        b.classList.toggle('active', this.mode === m);
        const chance = this.target && ok ? ` · ${Math.round(this.hitChance(u, this.target, m) * 100)}%` : '';
        document.getElementById('m-' + m).textContent = ok ? `${this.modeCost(u, m)} ZE${chance}` : '—';
      }
      // Gürtel: bis zu BELT_SLOTS Buttons (leere Plätze ausgeblendet)
      const slots = this.beltSlots(u);
      for (let k = 0; k < BELT_SLOTS; k++) {
        const bt = document.querySelector(`[data-belt="${k}"]`); if (!bt) continue;
        const b = this.beltEntry(u, k), it = b && ITEMS[b.id];
        bt.style.display = it || (!slots.length && k === 0) ? '' : 'none';
        const html = it ? `<b><span class="bi">${it.icon}</span>${it.short}</b><small>${this.itemCost(u, b.id)} ZE${it.kind === 'medkit' ? ` · ${Game.cheats.allGear ? '∞' : b.uses}×` : ''}</small>` : '<b>Gürtel</b><small>leer</small>';
        if (bt._h !== html) { bt.innerHTML = html; bt._h = html; }
        bt.title = it ? `${it.name} (Taste ${k + 4})` : 'Gürtel leer';
        bt.disabled = !it || this.phase !== 'player' || this.busy;
        bt.classList.toggle('active', this.mode === 'belt' && this.beltSlot === k && !!it);
      }
      const bi = this.mode === 'belt' ? this.beltEntry(u) : null;
      const fb = document.querySelector('[data-a="fire"]');
      fb.disabled = this.phase !== 'player' || !((this.target && this.mode !== 'belt') || (bi && this.grenadeTarget));
      document.getElementById('m-fire').textContent = this.target && this.mode !== 'belt' ? `${Math.round(this.hitChance(u, this.target, this.mode) * 100)} %` : bi && this.grenadeTarget ? 'werfen' : bi && ITEMS[bi.id].kind === 'medkit' ? 'Soldat wählen' : 'Ziel wählen';
    }
    document.querySelectorAll('.tac-actions .btn').forEach((b) => { if (!b.dataset.mode && b.dataset.belt == null && b.dataset.a !== 'fire') b.disabled = this.phase !== 'player' || this.busy && b.dataset.a !== 'abort'; });
    document.getElementById('m-end').textContent = this.phase === 'player' ? `Runde ${this.turn}` : '…';
    this.updateAlienBadges();
  }

  // ======================= Eingabe =======================
  bindInput() {
    const cv = this.engine.canvas;
    const ray = new THREE.Raycaster();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pick = (cx, cy) => {
      const r = cv.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), this.camera);
      // Einheiten bevorzugen
      let best = null, bd = 0.9;
      for (const u of this.units) {
        if (!u.alive || !u.obj.visible) continue;
        const c = new THREE.Vector3(u.obj.position.x, 1.1, u.obj.position.z);
        const d = ray.ray.distanceToPoint(c);
        if (d < bd) { bd = d; best = u; }
      }
      if (best) return { x: best.x, y: best.y };
      const hit = new THREE.Vector3();
      if (!ray.ray.intersectPlane(groundPlane, hit)) return null;
      return this.posCell(hit.x, hit.z);
    };
    const down = (e) => {
      if (!this.active) return;
      if (e.pointerType === 'touch') Input.setDevice('touch');
      cv.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), btn: e.button, type: e.pointerType });
      if (this.pointers.size >= 2) for (const p of this.pointers.values()) p.moved = true; // Geste, kein Tipp
    };
    const move = (e) => {
      if (!this.active) return;
      const p = this.pointers.get(e.pointerId);
      if (!p) {
        if (e.pointerType === 'mouse') { const c = pick(e.clientX, e.clientY); if (c && (c.x !== this.cursor.x || c.y !== this.cursor.y)) { this.cursor = c; this.updateHover(); } }
        return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d0 = Math.hypot(a.x - b.x, a.y - b.y), ang0 = Math.atan2(b.y - a.y, b.x - a.x);
        p.x = e.clientX; p.y = e.clientY;
        const d1 = Math.hypot(a.x - b.x, a.y - b.y), ang1 = Math.atan2(b.y - a.y, b.x - a.x);
        this.camT.dist = clamp(this.camT.dist * (d0 / d1), 12, 70);
        let dAng = ang1 - ang0;
        if (dAng > Math.PI) dAng -= Math.PI * 2; else if (dAng < -Math.PI) dAng += Math.PI * 2;
        this.camT.yaw += dAng;
        this.pan(dx * 0.5, dy * 0.5);
        p.moved = true;
        return;
      }
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 6) p.moved = true;
      if (!p.moved) return;
      if (p.btn === 2 || p.btn === 1) { this.camT.yaw -= dx * 0.006; this.camT.pitch = clamp(this.camT.pitch + dy * 0.004, 0.45, 1.35); }
      else this.pan(dx, dy);
    };
    const up = (e) => {
      if (!this.active) return;
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (!p || p.moved || this.pointers.size) return;
      if (performance.now() - p.t > 700) return;
      if (p.btn === 2) { this.clearTarget(); this.updateHover(); this.refreshUi(); return; }
      if (p.btn > 0) return;
      const c = pick(e.clientX, e.clientY);
      if (!c) return;
      this.cursor = c;
      this.updateHover();
      this.actAt(c.x, c.y, p.type === 'touch');
    };
    const wheel = (e) => { if (!this.active) return; e.preventDefault(); this.camT.dist = clamp(this.camT.dist * (1 + Math.sign(e.deltaY) * 0.1), 12, 70); };
    const ctx = (e) => e.preventDefault();
    cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up);
    const cancel = (e) => this.pointers.delete(e.pointerId);
    cv.addEventListener('pointercancel', cancel);
    cv.addEventListener('wheel', wheel, { passive: false }); cv.addEventListener('contextmenu', ctx);
    this.unsub.push(() => { cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', cancel); cv.removeEventListener('wheel', wheel); cv.removeEventListener('contextmenu', ctx); });

    this.unsub.push(Input.on('pad', (b) => {
      if (!this.active || anyModalOpen()) return;
      if (b === 'START') return this.hooks.openMenu();
      if (this.phase !== 'player' || this.busy) return;
      const map = {
        A: () => this.actAt(this.cursor.x, this.cursor.y, false),
        B: () => { this.clearTarget(); this.mode = this.mode === 'belt' ? 'snap' : this.mode; this.updateHover(); this.refreshUi(); },
        X: () => this.cycleMode(), Y: () => this.toggleKneel(),
        LB: () => this.cycleUnit(-1), RB: () => this.cycleUnit(1),
        LEFT: () => this.cycleAlien(-1), RIGHT: () => this.cycleAlien(1),
        UP: () => this.recenter(),
        DOWN: () => this.cycleBelt(),
        SELECT: () => this.confirmEndTurn(),
      };
      map[b]?.();
    }));
    this.unsub.push(Input.on('keydown', (code, e) => {
      if (code === 'Tab' && this.active) e?.preventDefault();
      if (!this.active || anyModalOpen()) return;
      if (code === 'Escape') { if (this.target || this.mode === 'belt') { this.clearTarget(); this.mode = 'snap'; this.updateHover(); this.refreshUi(); } else this.hooks.openMenu(); return; }
      if (this.phase !== 'player' || this.busy) return;
      const map = {
        Tab: () => { e?.preventDefault(); this.cycleUnit(e?.shiftKey ? -1 : 1); },
        Digit1: () => this.setMode('snap'), Digit2: () => this.setMode('aimed'), Digit3: () => this.setMode('auto'), Digit4: () => this.setBelt(0), Digit5: () => this.setBelt(1), Digit6: () => this.setBelt(2), KeyG: () => this.setMode('belt'),
        KeyF: () => this.btnAction('fire'), KeyK: () => this.toggleKneel(), KeyC: () => this.toggleKneel(), Enter: () => this.confirmEndTurn(),
        Space: () => this.recenter(), KeyT: () => this.cycleAlien(1),
      };
      map[code]?.();
    }));
    this.unsub.push(Input.on('device', () => this.updatePadHints()));
  }

  pan(dx, dy) {
    const k = this.camT.dist * 0.0018;
    const s = Math.sin(this.camT.yaw), c = Math.cos(this.camT.yaw);
    this.camT.x -= (dx * c + dy * s) * k * 1.0;
    this.camT.z -= (-dx * s + dy * c) * k * 1.0;
    this.clampCam();
  }
  clampCam() {
    const ex = this.W * TILE / 2 + 4, ez = this.H * TILE / 2 + 8;
    this.camT.x = clamp(this.camT.x, -ex, ex); this.camT.z = clamp(this.camT.z, -ex, ez);
  }

  // ======================= Frame-Update =======================
  update(dt) {
    if (!this.active) return;
    // Frame-Promises auflösen (für Animationen)
    const waiters = this._frameWaiters; this._frameWaiters = [];
    waiters.forEach((r) => r(dt));
    // Kamera-Eingabe
    if (!anyModalOpen()) {
      const kk = dt * this.camT.dist * 1.1;
      const s = Math.sin(this.camT.yaw), c = Math.cos(this.camT.yaw);
      let mx = 0, mz = 0;
      if (Input.isDown('KeyW') || Input.isDown('ArrowUp')) mz -= 1;
      if (Input.isDown('KeyS') || Input.isDown('ArrowDown')) mz += 1;
      if (Input.isDown('KeyA') || Input.isDown('ArrowLeft')) mx -= 1;
      if (Input.isDown('KeyD') || Input.isDown('ArrowRight')) mx += 1;
      if (mx || mz) { this.camT.x += (mx * c + mz * s) * kk; this.camT.z += (-mx * s + mz * c) * kk; this.clampCam(); }
      if (Input.isDown('KeyQ')) this.camT.yaw += dt * 1.8;
      if (Input.isDown('KeyE')) this.camT.yaw -= dt * 1.8;
      if (Input.isDown('KeyR')) this.camT.dist = clamp(this.camT.dist - dt * 25, 12, 70);
      if (Input.isDown('KeyV')) this.camT.dist = clamp(this.camT.dist + dt * 25, 12, 70);
      // Controller: Cursor mit linkem Stick, Kamera mit rechtem Stick
      const lx = Input.axis(0), ly = Input.axis(1);
      if (lx || ly) {
        const sp = 9 * dt;
        this.padCursorAcc.x += (lx * c + ly * s) * sp;
        this.padCursorAcc.y += (-lx * s + ly * c) * sp;
        let moved = false;
        while (Math.abs(this.padCursorAcc.x) >= 1) { this.cursor.x = clamp(this.cursor.x + Math.sign(this.padCursorAcc.x), 0, this.W - 1); this.padCursorAcc.x -= Math.sign(this.padCursorAcc.x); moved = true; }
        while (Math.abs(this.padCursorAcc.y) >= 1) { this.cursor.y = clamp(this.cursor.y + Math.sign(this.padCursorAcc.y), 0, this.H - 1); this.padCursorAcc.y -= Math.sign(this.padCursorAcc.y); moved = true; }
        if (moved) { this.updateHover(); const p = this.cellPos(this.cursor.x, this.cursor.y); this.camT.x = lerp(this.camT.x, p.x, 0.25); this.camT.z = lerp(this.camT.z, p.z, 0.25); }
      } else { this.padCursorAcc.x *= 0.8; this.padCursorAcc.y *= 0.8; }
      const rx = Input.axis(2), ry = Input.axis(3);
      if (rx) this.camT.yaw -= rx * dt * 2.2;
      if (ry) this.camT.pitch = clamp(this.camT.pitch + ry * dt * 1.2, 0.45, 1.35);
      const z = Input.trigger('RT') - Input.trigger('LT');
      if (Math.abs(z) > 0.05) this.camT.dist = clamp(this.camT.dist * (1 - z * dt * 1.5), 12, 70);
    }
    for (const k of ['x', 'z', 'yaw', 'pitch', 'dist']) this.cam[k] = smooth(this.cam[k], this.camT[k], k === 'x' || k === 'z' ? 7 : 9, dt);
    this.shake = Math.max(0, this.shake - dt * 2);
    const sh = this.shake * this.shake * 0.6;
    const { x, z, yaw, pitch, dist } = this.cam;
    this.camera.position.set(x + Math.sin(yaw) * Math.cos(pitch) * dist + randRange(-sh, sh), Math.sin(pitch) * dist + randRange(-sh, sh), z + Math.cos(yaw) * Math.cos(pitch) * dist);
    this.camera.lookAt(x, 0.5, z);

    // Einheiten animieren
    const time = this.engine.time;
    for (const u of this.units) {
      const ud = u.obj.userData; if (!ud.body) continue;
      if (!u.alive && !u.dying) continue;
      u.anim.t += dt;
      const walking = u.anim.walk > 0;
      const sw = walking ? Math.sin(u.anim.walk) * 0.6 : 0;
      if (ud.legL) { ud.legL.rotation.x = sw; ud.legR.rotation.x = -sw; }
      if (ud.legL2) { ud.legL2.rotation.x = -sw; ud.legR2.rotation.x = sw; }
      if (u.team === 'civ' && ud.armL) { ud.armL.rotation.x = -sw * 0.8; ud.armR.rotation.x = sw * 0.8; }
      if (ud.hover) ud.body.position.y = 0.2 + Math.sin(u.anim.t * 2.5) * 0.12;
      else if (u.alive) {
        const kneelY = u.kneel ? -0.38 : 0;
        ud.body.position.y = smooth(ud.body.position.y, kneelY + (walking ? Math.abs(Math.sin(u.anim.walk)) * 0.06 : Math.sin(u.anim.t * 1.6) * 0.01), 12, dt);
        if (ud.legL && u.kneel && !walking) { ud.legL.rotation.x = -1.3; ud.legR.rotation.x = 0.3; }
      }
    }
    // Auswahlringe
    const sel = this.selected;
    if (sel && sel.alive) {
      this.selRing.visible = this.phase === 'player';
      this.selRing.position.x = sel.obj.position.x; this.selRing.position.z = sel.obj.position.z;
      this.selRing.scale.setScalar(1 + Math.sin(time * 4) * 0.06);
      this.unitLight.position.set(sel.obj.position.x, 3.5, sel.obj.position.z);
    } else this.selRing.visible = false;
    if (this.target && this.target.alive) { this.tgtRing.visible = true; this.tgtRing.position.x = this.target.obj.position.x; this.tgtRing.position.z = this.target.obj.position.z; this.tgtRing.rotation.y += dt * 2; } else this.tgtRing.visible = false;
    // Partikel
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.sp.visible = false; continue; }
      const k = 1 - p.life / p.max;
      p.sp.position.addScaledVector(p.vel, dt);
      if (!p.smoke) p.vel.y -= 4 * dt; else p.vel.multiplyScalar(1 - dt * 1.5);
      p.sp.scale.setScalar(Math.max(0.05, p.size0 + p.grow * k));
      p.sp.material.opacity = (p.smoke ? 0.6 : 1) * (1 - k);
    }
    this.fx = this.fx.filter((f) => f(dt));
    if (this.smokes.length || this.flares.length) this.updateEffects(dt, time);
    this.placePathLabels();
    this.updateFog(dt);
  }

  // ======================= Lebenszyklus =======================
  activate() {
    this.active = true;
    document.body.dataset.mode = 'tac';
    setMusicMood('tac');
    banner(this.opts.site.kind === 'hive' ? 'FINALE MISSION' : 'EINSATZ BEGINNT', `${this.opts.site.name}${this.map.night ? ' · Nacht' : ''}`);
    this.updateHover(); this.refreshUi();
    if (this.beltShort?.length) { toast(`Lagerbestand reicht nicht – nicht mitgeführt: ${this.beltShort.join(', ')}`, 'warn', 4200); this.beltShort = null; }
  }
  deactivate() { this.active = false; document.body.classList.remove('alien-phase'); if (this.pathLabelData) this.clearPath(); }
  // Cheat-Schnittstellen
  cheatKillAll() { for (const u of this.units) if (u.team === 'alien' && u.alive) this.kill(u, this.selected); }
  cheatReveal() { this.updateVisibility(); }
  cheatHeal() { for (const u of this.units) if (u.team === 'player' && u.alive) { u.hp = u.maxHp; u.tu = u.maxTu; } this.refreshUi(); }
  cheatWin() { this.cheatKillAll(); if (!this.units.some((u) => u.team === 'alien')) this.finish(true); }
  dispose() {
    this.disposed = true; this.ended = true;
    this.deactivate();
    this.unsub.forEach((f) => f());
    this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.envRT?.dispose(); this.fogTex.dispose(); this.groundTex.dispose(); this.particleTex?.dispose(); this.smokeTex?.dispose();
    this.smokePool?.forEach((s) => s.material.dispose());
    this.sun?.dispose?.();
    this.scene.traverse((o) => { if (o.isInstancedMesh) o.dispose(); if (o.material && !o.isSprite) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (!m.userData.shared) m.dispose(); }); });
    document.getElementById('hud').innerHTML = '';
    this.engine.renderer.toneMappingExposure = 1.0;
  }
}
