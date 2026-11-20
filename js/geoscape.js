// Geoscape: 3D-Erdkugel in Echtzeit – Radar, UFO-Abfang, Einsätze, Basis, Forschung, Finanzen
import * as THREE from 'three';
import { NOISE_GLSL } from './shaders.js';
import { Game, newSoldier } from './game.js';
import { UFOS, CRAFTS, RESEARCH, FACILITIES, WEAPONS, ARMORS, GRENADES, RANKS, REGIONS, regionOf, CITY_NAMES } from './data.js';
import { Input, padLabel } from './input.js';
import { modal, toast, confirmBox, alertBox, anyModalOpen, el, bar, banner } from './ui.js';
import { sfx, setMusicMood } from './audio.js';
import { clamp, rand, randRange, randInt, choice, latLonToVec, vecToLatLon, angleBetween, slerpStep, fmtDate, fmtMoney, smooth, DEG } from './util.js';

// Spielminuten pro Echtzeitsekunde
const SPEEDS = [
  { label: '⏸', mps: 0 },
  { label: '1m', mps: 1 },
  { label: '5m', mps: 5 },
  { label: '30m', mps: 30 },
  { label: '2h', mps: 120 },
  { label: '12h', mps: 720 },
];
const HM_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export class Geoscape {
  constructor(engine, hooks) {
    this.engine = engine;
    this.hooks = hooks;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200);
    this.camLat = 0.5; this.camLon = 0.3; this.dist = 3.2;
    this.tLat = this.camLat; this.tLon = this.camLon; this.tDist = this.dist;
    this.speed = 1;
    this.ufos = [];
    this.sites = [];
    this.events = [];
    this.markers = new Map();
    this.labels = new Map();
    this.touchedMarkers = new Set();
    this.selectMode = null;
    this.nextUfo = randRange(240, 600);
    this.nextTerror = randRange(5000, 9000);
    this.lastDay = 0;
    this.pointers = new Map();
    this.unsub = [];
    this.build();
  }

  // ---------- Welt erzeugen ----------
  build() {
    const c = Game.c;
    if (!c.worldSeed) c.worldSeed = [rand() * 100, rand() * 100, rand() * 100];
    const mobile = Math.min(screen.width, screen.height) < 700;
    this.hmW = mobile ? 1024 : 2048; this.hmH = this.hmW / 2;
    this.hmRT = this.bakeMap(this.hmW, this.hmH, /* glsl */ `
      vec3 p = dir * 1.55 + seed;
      vec3 w = vec3(fbm(p + vec3(5.2), 4), fbm(p + vec3(1.3, 7.1, 2.2), 4), fbm(p + vec3(8.3, 2.8, 4.1), 4));
      float h = fbm(p + w * 0.75, 7) * 1.25 - 0.04;
      h -= smoothstep(1.25, 1.5, abs(lat)) * 0.05;
      float moist = fbm(dir * 2.4 + seed.zxy + 11.0, 4) * 0.5 + 0.5;
      float town = smoothstep(0.62, 0.9, snoise(dir * 38.0 + seed) * 0.5 + 0.5) * smoothstep(0.0, 0.04, h) * smoothstep(0.35, 0.05, h) * smoothstep(0.45, 0.7, fbm(dir * 5.0 + seed.yzx, 3) * 0.5 + 0.5);
      float t = clamp(h * 0.5 + 0.5, 0.0, 0.9999);
      float hi = floor(t * 255.0) / 255.0;
      gl_FragColor = vec4(hi, fract(t * 255.0), moist, town);`, c.worldSeed);
    this.cloudRT = this.bakeMap(1024, 512, /* glsl */ `
      vec3 q = vec3(dir.x, dir.y * 1.9, dir.z) * 2.2 + seed * 0.37;
      float n = fbm(q + fbm(q * 1.7, 3) * 0.8, 6);
      float band = 0.65 + 0.35 * cos(lat * 6.0);
      float cl = smoothstep(0.12, 0.6, n * band + 0.06) * 0.9;
      gl_FragColor = vec4(cl, cl, cl, 1.0);`, c.worldSeed);
    // Höhenkarte für Spiellogik (Land/Wasser) auslesen
    this.hmData = new Uint8Array(this.hmW * this.hmH * 4);
    this.engine.renderer.readRenderTargetPixels(this.hmRT, 0, 0, this.hmW, this.hmH, this.hmData);

    // Sterne
    const sg = new THREE.BufferGeometry();
    const N = 5000, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const v = latLonToVec(Math.asin(rand() * 2 - 1), rand() * Math.PI * 2);
      const r = 60 + rand() * 30;
      pos.set([v.x * r, v.y * r, v.z * r], i * 3);
      const k = 0.4 + rand() * 0.9, tint = rand();
      col.set([k * (tint > 0.8 ? 1 : 0.8), k * 0.85, k * (tint < 0.3 ? 1.2 : 0.9)], i * 3);
    }
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false })));

    this.sunDir = new THREE.Vector3(1, 0.2, 0.3).normalize();
    this.sun = new THREE.DirectionalLight(0xfff3e0, 2.6);
    this.scene.add(this.sun);
    this.scene.add(new THREE.AmbientLight(0x334466, 0.6));

    // Planet
    this.planetMat = new THREE.ShaderMaterial({
      uniforms: { hMap: { value: this.hmRT.texture }, sunDir: { value: this.sunDir }, texel: { value: new THREE.Vector2(1 / this.hmW, 1 / this.hmH) }, camPos: { value: new THREE.Vector3() }, time: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vP; varying vec3 vObj;
        void main(){ vObj = position; vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D hMap; uniform vec3 sunDir; uniform vec3 camPos; uniform float time;
        varying vec3 vN; varying vec3 vP; varying vec3 vObj;
        const float PI = 3.14159265;
        vec2 dirUv(vec3 d){ return vec2(atan(-d.z, d.x) / (2.0 * PI) + 0.5, asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5); }
        vec4 sampleM(vec3 d){ return texture2D(hMap, dirUv(d)); }
        float hgt(vec4 s){ return (s.r + s.g / 255.0) * 2.0 - 1.0; }
        void main(){
          vec3 d = normalize(vObj);
          vec4 m = sampleM(d);
          float h = hgt(m);
          float lat = asin(d.y);
          vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), d) + vec3(1e-5));
          vec3 north = cross(d, east);
          float e = 0.0025;
          float hx = hgt(sampleM(normalize(d + east * e))) - hgt(sampleM(normalize(d - east * e)));
          float hy = hgt(sampleM(normalize(d + north * e))) - hgt(sampleM(normalize(d - north * e)));
          float land = smoothstep(-0.004, 0.006, h);
          vec3 n = normalize(d - (east * hx + north * hy) * 5.5 * land);
          vec3 V = normalize(camPos - vP);
          // Farbpalette
          vec3 deep = vec3(0.002, 0.012, 0.05), shallow = vec3(0.01, 0.09, 0.14);
          vec3 water = mix(deep, shallow, smoothstep(-0.25, 0.0, h));
          float moist = m.b;
          float heat = 1.0 - abs(lat) / 1.4;
          vec3 desert = vec3(0.42, 0.31, 0.16), grass = vec3(0.09, 0.2, 0.04), forest = vec3(0.025, 0.09, 0.025), tundra = vec3(0.22, 0.2, 0.15);
          vec3 lc = mix(desert, grass, smoothstep(0.35, 0.55, moist));
          lc = mix(lc, forest, smoothstep(0.55, 0.75, moist) * heat);
          lc = mix(lc, tundra, smoothstep(0.55, 0.8, abs(lat) / 1.4));
          lc = mix(lc, vec3(0.2, 0.18, 0.16), smoothstep(0.22, 0.4, h));
          float snow = max(smoothstep(0.42, 0.55, h), smoothstep(1.12, 1.3, abs(lat)));
          lc = mix(lc, vec3(0.8, 0.85, 0.9), snow);
          vec3 base = mix(water, lc, land);
          float ice = smoothstep(1.3, 1.42, abs(lat)) * (1.0 - land);
          base = mix(base, vec3(0.7, 0.78, 0.85), ice);
          // Beleuchtung
          float ndl = dot(n, sunDir);
          float diff = max(ndl, 0.0);
          float wrap = smoothstep(-0.15, 0.3, dot(d, sunDir));
          vec3 col = base * (diff * 2.2 + 0.012) * vec3(1.0, 0.97, 0.92);
          // Dämmerungsfarbe
          float twi = smoothstep(-0.2, 0.0, dot(d, sunDir)) * smoothstep(0.25, 0.0, dot(d, sunDir));
          col += base * twi * vec3(0.6, 0.25, 0.08) * 0.6;
          // Meeresglanz
          vec3 H = normalize(sunDir + V);
          float spec = pow(max(dot(d, H), 0.0), 90.0) * (1.0 - land) * (1.0 - ice) * wrap;
          col += vec3(1.0, 0.9, 0.7) * spec * 2.5;
          // Stadtlichter auf der Nachtseite
          float night = smoothstep(0.08, -0.18, dot(d, sunDir));
          float flick = 0.85 + 0.15 * sin(time * 2.0 + m.a * 40.0);
          col += vec3(1.0, 0.62, 0.28) * m.a * night * 2.2 * flick;
          // Atmosphärischer Randschein
          float fres = pow(1.0 - max(dot(d, V), 0.0), 3.0);
          col += vec3(0.25, 0.55, 1.0) * fres * (wrap * 0.9 + 0.05);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.planet = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 100), this.planetMat);
    this.scene.add(this.planet);

    // Wolken
    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: { cMap: { value: this.cloudRT.texture }, sunDir: { value: this.sunDir }, rot: { value: 0 } },
      vertexShader: 'varying vec3 vObj; void main(){ vObj = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D cMap; uniform vec3 sunDir; uniform float rot; varying vec3 vObj;
        const float PI = 3.14159265;
        void main(){
          vec3 d = normalize(vObj);
          vec2 uv = vec2(atan(-d.z, d.x) / (2.0 * PI) + 0.5 + rot, asin(d.y) / PI + 0.5);
          float a = texture2D(cMap, uv).r;
          float l = smoothstep(-0.25, 0.4, dot(d, sunDir));
          vec3 c = vec3(1.0) * (l * 1.6 + 0.01);
          c = mix(c, c * vec3(1.0, 0.6, 0.4), smoothstep(0.3, 0.0, dot(d, sunDir)) * l);
          gl_FragColor = vec4(c, a * 0.7);
        }`,
      transparent: true, depthWrite: false,
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(1.012, 128, 80), this.cloudMat);
    this.scene.add(this.clouds);

    // Atmosphäre
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.07, 96, 64), new THREE.ShaderMaterial({
      uniforms: { sunDir: { value: this.sunDir }, camPos: { value: new THREE.Vector3() } },
      vertexShader: 'varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position,1.0); vP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
      fragmentShader: /* glsl */ `
        uniform vec3 sunDir; uniform vec3 camPos; varying vec3 vN; varying vec3 vP;
        void main(){
          vec3 V = normalize(vP - camPos);
          float rim = pow(clamp(1.0 - abs(dot(vN, V)), 0.0, 1.0), 2.0);
          float inner = smoothstep(0.0, 0.35, dot(-vN, V));
          float lit = smoothstep(-0.3, 0.6, dot(vN, sunDir));
          vec3 c = mix(vec3(0.15, 0.4, 1.0), vec3(0.9, 0.5, 0.25), smoothstep(0.25, -0.1, dot(vN, sunDir)) * lit);
          gl_FragColor = vec4(c * rim * lit * 2.2 * inner, rim * lit * inner);
        }`,
      side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.atmo = atmo;
    this.scene.add(atmo);

    this.markerGroup = new THREE.Group();
    this.scene.add(this.markerGroup);
    this.makeMarkerAssets();

    if (!c.cities) this.genCities();
    this.buildCities();
    this.buildHud();
    this.bindInput();
    if (c.base) this.buildBaseMarker();
    this.sites = c.sites || [];
    this.ufos = c.ufos || [];
    c.sites = this.sites; c.ufos = this.ufos;
    if (!c.transport) c.transport = { status: 'ready', pos: null, target: null, squad: [] };
    if (c.transport.status === 'arrived') c.transport.status = 'out'; // erneut ankommen lassen (z. B. nach Neuladen)
    if (!c.researchProgress) c.researchProgress = {};
    this.events = c.events || [];
    c.events = this.events;
    if (c.geo) Object.assign(this, { nextUfo: c.geo.nextUfo, nextTerror: c.geo.nextTerror });
    if (c.base) { const b = c.base; this.tLat = this.camLat = b.lat; this.tLon = this.camLon = b.lon + 0.25; }
  }

  bakeMap(w, h, body, seed) {
    const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, wrapS: THREE.RepeatWrapping, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    rt.texture.wrapS = THREE.RepeatWrapping;
    const mat = new THREE.ShaderMaterial({
      uniforms: { seed: { value: new THREE.Vector3(...seed) } },
      vertexShader: HM_VERT,
      fragmentShader: `precision highp float; uniform vec3 seed; varying vec2 vUv; ${NOISE_GLSL}
        void main(){ float lon = (vUv.x - 0.5) * 6.2831853; float lat = (vUv.y - 0.5) * 3.14159265;
        vec3 dir = vec3(cos(lat) * cos(lon), sin(lat), -cos(lat) * sin(lon)); ${body} }`,
      depthTest: false, depthWrite: false,
    });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    const sc = new THREE.Scene(); sc.add(q);
    const cam = new THREE.Camera();
    const r = this.engine.renderer;
    const prevTM = r.toneMapping;
    r.toneMapping = THREE.NoToneMapping;
    r.setRenderTarget(rt); r.render(sc, cam); r.setRenderTarget(null);
    r.toneMapping = prevTM;
    mat.dispose(); q.geometry.dispose();
    return rt;
  }

  heightAt(lat, lon) {
    const u = lon / (Math.PI * 2) + 0.5, v = lat / Math.PI + 0.5;
    const x = clamp(Math.floor(u * this.hmW), 0, this.hmW - 1), y = clamp(Math.floor(v * this.hmH), 0, this.hmH - 1);
    const i = (y * this.hmW + x) * 4;
    return ((this.hmData[i] + this.hmData[i + 1] / 255) / 255) * 2 - 1;
  }
  isLand(lat, lon) { return this.heightAt(lat, lon) > 0.004; }
  biomeAt(lat, lon) {
    const u = lon / (Math.PI * 2) + 0.5, v = lat / Math.PI + 0.5;
    const i = (clamp(Math.floor(v * this.hmH), 0, this.hmH - 1) * this.hmW + clamp(Math.floor(u * this.hmW), 0, this.hmW - 1)) * 4;
    const moist = this.hmData[i + 2] / 255, h = this.heightAt(lat, lon);
    if (Math.abs(lat) > 1.1 || h > 0.42) return 'arctic';
    if (moist < 0.42) return 'desert';
    if (moist > 0.6) return 'forest';
    return 'farm';
  }
  randomLand(minH = 0.01, maxH = 0.3) {
    for (let i = 0; i < 4000; i++) {
      const lat = Math.asin(rand() * 2 - 1) * 0.85, lon = (rand() * 2 - 1) * Math.PI;
      const h = this.heightAt(lat, lon);
      if (h > minH && h < maxH) return { lat, lon };
    }
    return { lat: 0, lon: 0 };
  }

  genCities() {
    const cities = [];
    for (const name of CITY_NAMES) {
      for (let k = 0; k < 300; k++) {
        const p = this.randomLand(0.015, 0.2);
        const v = latLonToVec(p.lat, p.lon);
        if (cities.every((c) => angleBetween(latLonToVec(c.lat, c.lon), v) > 0.3)) { cities.push({ name, ...p, region: regionOf(p.lat, p.lon) }); break; }
      }
    }
    Game.c.cities = cities;
  }

  // ---------- Marker ----------
  makeMarkerAssets() {
    const prof = [[0, 0.06], [0.5, 0.05], [1, 0.02], [0.9, -0.005], [0.35, -0.03], [0, -0.03]].map(([r, y]) => new THREE.Vector2(r, y));
    this.geo = {
      ufo: new THREE.LatheGeometry(prof, 24),
      craft: new THREE.ConeGeometry(0.35, 1.2, 4).rotateX(Math.PI / 2),
      beam: new THREE.CylinderGeometry(0.15, 0.4, 1, 16, 1, true).translate(0, 0.5, 0),
      ring: new THREE.RingGeometry(0.7, 1, 40),
      dot: new THREE.SphereGeometry(0.4, 12, 8),
      base: new THREE.CylinderGeometry(0.6, 0.8, 0.5, 6).translate(0, 0.25, 0),
    };
    this.mats = {
      ufo: new THREE.MeshStandardMaterial({ color: 0x777788, metalness: 0.9, roughness: 0.25, emissive: 0xff2244, emissiveIntensity: 1.2 }),
      craft: new THREE.MeshStandardMaterial({ color: 0x9fd8ff, emissive: 0x33c8ff, emissiveIntensity: 2 }),
      transport: new THREE.MeshStandardMaterial({ color: 0xffe38a, emissive: 0xffb020, emissiveIntensity: 2 }),
      base: new THREE.MeshStandardMaterial({ color: 0x55ffcc, emissive: 0x22ffaa, emissiveIntensity: 2.5 }),
      city: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.7, 0.8) }),
    };
  }

  beamMat(color) {
    return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  }

  orientOnSurface(obj, v, alt = 1.0) {
    const n = new THREE.Vector3(v.x, v.y, v.z).normalize();
    obj.position.copy(n).multiplyScalar(alt);
    obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
  }

  marker(key, kind, v, label, extra) {
    this.touchedMarkers.add(key);
    let m = this.markers.get(key);
    if (!m) {
      m = new THREE.Group();
      m.userData.kind = kind;
      if (kind === 'ufo') {
        const s = new THREE.Mesh(this.geo.ufo, this.mats.ufo); s.scale.setScalar(1); m.add(s);
        const r = new THREE.Mesh(this.geo.ring, this.beamMat(0xff3355)); r.rotation.x = -Math.PI / 2; m.add(r); m.userData.ring = r;
      } else if (kind === 'craft' || kind === 'transport') {
        m.add(new THREE.Mesh(this.geo.craft, kind === 'craft' ? this.mats.craft : this.mats.transport));
      } else if (kind === 'site') {
        const b = new THREE.Mesh(this.geo.beam, this.beamMat(extra?.color || 0xff4040)); b.scale.set(0.35, 7, 0.35); m.add(b);
        const r = new THREE.Mesh(this.geo.ring, this.beamMat(extra?.color || 0xff4040)); r.rotation.x = -Math.PI / 2; m.add(r); m.userData.ring = r;
      }
      this.markerGroup.add(m);
      this.markers.set(key, m);
      if (label) {
        const l = el('div', `geo-label ${kind}`, label);
        document.getElementById('geo-labels').appendChild(l);
        this.labels.set(key, l);
      }
    }
    m.userData.v = v;
    if (kind === 'craft' || kind === 'transport') {
      const n = new THREE.Vector3(v.x, v.y, v.z).normalize();
      m.position.copy(n).multiplyScalar(1.03);
      if (extra?.target) {
        const t = new THREE.Vector3(extra.target.x, extra.target.y, extra.target.z).normalize();
        const fwd = t.clone().sub(n.clone().multiplyScalar(t.dot(n))).normalize();
        if (fwd.lengthSq() > 0.1) { m.up.copy(n); m.lookAt(m.position.clone().add(fwd)); }
      }
    } else {
      this.orientOnSurface(m, v, kind === 'ufo' ? 1.035 : 1.001);
    }
    if (label && this.labels.get(key)) this.labels.get(key).innerHTML = label;
    return m;
  }

  sweepMarkers() {
    for (const [k, m] of this.markers) {
      if (k.startsWith('static:')) continue;
      if (!this.touchedMarkers.has(k)) {
        this.markerGroup.remove(m);
        this.markers.delete(k);
        this.labels.get(k)?.remove();
        this.labels.delete(k);
      }
    }
    this.touchedMarkers.clear();
  }

  buildCities() {
    const inst = new THREE.InstancedMesh(this.geo.dot, this.mats.city, Game.c.cities.length);
    const mtx = new THREE.Matrix4();
    Game.c.cities.forEach((c, i) => {
      const v = latLonToVec(c.lat, c.lon);
      mtx.makeScale(0.006, 0.006, 0.006).setPosition(v.x * 1.002, v.y * 1.002, v.z * 1.002);
      inst.setMatrixAt(i, mtx);
    });
    this.cityMesh = inst;
    this.scene.add(inst);
  }

  buildBaseMarker() {
    const b = Game.c.base;
    this.baseVec = latLonToVec(b.lat, b.lon);
    if (this.baseObj) this.scene.remove(this.baseObj);
    const g = new THREE.Group();
    const hex = new THREE.Mesh(this.geo.base, this.mats.base); hex.scale.setScalar(0.018); g.add(hex);
    // Radarabdeckung als Kugelkappe
    const capGeo = new THREE.SphereGeometry(1.003, 64, 8, 0, Math.PI * 2, 0, this.radarRangeVis());
    const cap = new THREE.Mesh(capGeo, new THREE.MeshBasicMaterial({ color: 0x22ffaa, transparent: true, opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending }));
    g.add(cap);
    const ringPts = [];
    const R = this.radarRangeVis();
    for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 2; ringPts.push(new THREE.Vector3(Math.sin(R) * Math.cos(a), Math.cos(R), Math.sin(R) * Math.sin(a)).multiplyScalar(1.004)); }
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), new THREE.LineBasicMaterial({ color: 0x55ffcc, transparent: true, opacity: 0.6 })));
    const sweep = new THREE.Mesh(new THREE.SphereGeometry(1.004, 32, 4, 0, 0.5, 0, R), new THREE.MeshBasicMaterial({ color: 0x55ffcc, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }));
    g.add(sweep); this.radarSweep = sweep;
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(this.baseVec.x, this.baseVec.y, this.baseVec.z));
    hex.position.set(0, 1.0, 0);
    this.baseObj = g;
    this.scene.add(g);
    if (!this.labels.has('static:base')) {
      const l = el('div', 'geo-label base', '◆ ' + b.name);
      document.getElementById('geo-labels').appendChild(l);
      this.labels.set('static:base', l);
      this.markers.set('static:base', { userData: { v: this.baseVec, kind: 'base' } });
    }
  }
  radarRangeVis() { return Game.radarRange; }

  // ---------- HUD ----------
  buildHud() {
    const hud = document.getElementById('hud');
    hud.innerHTML = `
      <div id="geo-labels"></div>
      <div class="geo-top panel">
        <div class="geo-clock"><div id="g-date">–</div><div id="g-time">–</div></div>
        <div class="speeds" id="g-speeds">${SPEEDS.map((s, i) => `<button class="btn sp" data-sp="${i}">${s.label}</button>`).join('')}</div>
        <div class="geo-cred"><span class="lbl">Budget</span><span id="g-cred">–</span></div>
      </div>
      <div class="geo-events panel" id="g-events"></div>
      <div class="reticle" id="g-reticle">＋</div>
      <div class="geo-bottom">
        <button class="btn big" data-act="intercept"><b>✈</b><span>Abfangen</span></button>
        <button class="btn big" data-act="base"><b>⬢</b><span>Basis</span></button>
        <button class="btn big" data-act="research"><b>⚗</b><span>Forschung</span></button>
        <button class="btn big" data-act="soldiers"><b>☗</b><span>Soldaten</span></button>
        <button class="btn big" data-act="shop"><b>⚙</b><span>Beschaffung</span></button>
        <button class="btn big" data-act="finance"><b>¢</b><span>Finanzen</span></button>
        <button class="btn big" data-act="menu"><b>☰</b><span>Menü</span></button>
      </div>
      <div class="pad-hints" id="g-padhint"></div>`;
    hud.querySelectorAll('[data-sp]').forEach((b) => b.addEventListener('click', () => { sfx('click'); this.setSpeed(+b.dataset.sp); }));
    hud.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => { sfx('click'); this.action(b.dataset.act); }));
    this.hud = hud;
    this.updateHud(true);
    this.updatePadHints();
  }

  updatePadHints() {
    const h = document.getElementById('g-padhint');
    if (!h) return;
    h.innerHTML = `<span>${padLabel('A')} Auswählen</span><span>${padLabel('LB')}/${padLabel('RB')} Tempo</span><span>${padLabel('X')} Basis</span><span>${padLabel('Y')} Forschung</span><span>${padLabel('LT')}/${padLabel('RT')} Zoom</span><span>${padLabel('START')} Menü</span><span>L3+R3 Cheats</span>`;
  }

  setSpeed(i) {
    if (!Game.c.base) i = 0;
    this.speed = clamp(i, 0, SPEEDS.length - 1);
    this.hud.querySelectorAll('[data-sp]').forEach((b) => b.classList.toggle('active', +b.dataset.sp === this.speed));
  }

  log(msg, type = 'info') {
    const d = fmtDate(Game.c.time);
    this.events.unshift({ t: `${d.day}.${d.month + 1}. ${d.time}`, msg, type });
    this.events.length = Math.min(this.events.length, 6);
    this.renderEvents();
  }
  renderEvents() {
    const e = document.getElementById('g-events');
    if (e) e.innerHTML = this.events.map((x) => `<div class="ev ${x.type}"><i>${x.t}</i> ${x.msg}</div>`).join('');
  }

  updateHud(force) {
    const c = Game.c;
    const d = fmtDate(c.time);
    const dEl = document.getElementById('g-date');
    if (!dEl) return;
    dEl.textContent = d.text;
    document.getElementById('g-time').textContent = d.time;
    document.getElementById('g-cred').textContent = fmtMoney(c.credits);
    if (force) { this.setSpeed(this.speed); this.renderEvents(); }
  }

  // ---------- Eingabe ----------
  bindInput() {
    const cv = this.engine.canvas;
    const down = (e) => {
      if (!this.active) return;
      cv.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
      if (e.pointerType === 'touch') Input.setDevice('touch');
    };
    const move = (e) => {
      if (!this.active) return;
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d0 = Math.hypot(a.x - b.x, a.y - b.y);
        p.x = e.clientX; p.y = e.clientY;
        const d1 = Math.hypot(a.x - b.x, a.y - b.y);
        if (d0 > 0) this.tDist = clamp(this.tDist * (d0 / d1), 1.25, 6);
        return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      const k = 0.0042 * (this.tDist - 1) / 1.2;
      this.tLon -= dx * k; this.tLat = clamp(this.tLat + dy * k, -1.35, 1.35);
    };
    const up = (e) => {
      if (!this.active) return;
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (!p) return;
      const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
      if (moved < 8 && performance.now() - p.t < 600 && this.pointers.size === 0) this.click(e.clientX, e.clientY);
    };
    const wheel = (e) => { if (!this.active) return; e.preventDefault(); this.tDist = clamp(this.tDist * (1 + Math.sign(e.deltaY) * 0.12), 1.25, 6); };
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    const cancel = (e) => this.pointers.delete(e.pointerId);
    cv.addEventListener('pointercancel', cancel);
    cv.addEventListener('wheel', wheel, { passive: false });
    this.unsub.push(() => { cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', cancel); cv.removeEventListener('wheel', wheel); });
    this.unsub.push(Game.on('research', (id) => {
      if (id === 'hyperwave' && this.active) this.spawnHive();
      if (id === 'navigation' && this.baseObj) this.buildBaseMarker();
    }));
    this.unsub.push(Game.on('built', (type) => {
      toast(`Bau abgeschlossen: ${FACILITIES[type].name}`, 'good');
      this.log(`${FACILITIES[type].name} fertiggestellt.`, 'good');
      if (type === 'radar' && this.baseObj) this.buildBaseMarker();
    }));
    this.unsub.push(Input.on('pad', (b) => {
      if (!this.active || anyModalOpen()) return;
      if (b === 'A') { const r = this.engine.canvas.getBoundingClientRect(); this.click(r.left + r.width / 2, r.top + r.height / 2); }
      else if (b === 'LB') this.setSpeed(this.speed - 1);
      else if (b === 'RB') this.setSpeed(this.speed + 1);
      else if (b === 'X') this.action('base');
      else if (b === 'Y') this.action('research');
      else if (b === 'START') this.action('menu');
      else if (b === 'SELECT') this.setSpeed(this.speed ? 0 : 1);
      else if (b === 'UP') this.action('intercept');
      else if (b === 'DOWN') this.action('soldiers');
      else if (b === 'LEFT') this.action('shop');
      else if (b === 'RIGHT') this.action('finance');
    }));
    this.unsub.push(Input.on('keydown', (code) => {
      if (!this.active || anyModalOpen()) return;
      const map = { Space: () => this.setSpeed(this.speed ? 0 : 1), KeyB: () => this.action('base'), KeyR: () => this.action('research'), KeyI: () => this.action('intercept'), KeyS: null, KeyF: () => this.action('finance'), Escape: () => this.action('menu') };
      if (/^Digit[1-6]$/.test(code)) this.setSpeed(+code.slice(5) - 1);
      map[code]?.();
    }));
    this.unsub.push(Input.on('device', () => this.updatePadHints()));
    this.unsub.push(Input.on('padconnect', () => this.updatePadHints()));
  }

  screenPos(v, alt = 1.0) {
    const p = new THREE.Vector3(v.x * alt, v.y * alt, v.z * alt).project(this.camera);
    const r = this.engine.canvas.getBoundingClientRect();
    return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height, z: p.z };
  }
  facing(v) {
    const cp = this.camera.position.clone().normalize();
    return cp.x * v.x + cp.y * v.y + cp.z * v.z > 0.18;
  }

  click(x, y) {
    if (anyModalOpen()) return;
    // Marker in der Nähe?
    let best = null, bd = 34;
    for (const [k, m] of this.markers) {
      const v = m.userData.v; if (!v || !this.facing(v)) continue;
      const s = this.screenPos(v, 1.02);
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bd) { bd = d; best = k; }
    }
    if (best && Game.c.base) { sfx('select'); this.selectMarker(best); return; }
    // Klick auf Globus
    const r = this.engine.canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), this.camera);
    const hit = ray.intersectObject(this.planet)[0];
    if (!hit) return;
    const ll = vecToLatLon(hit.point);
    if (!Game.c.base) this.placeBase(ll);
    else this.tLat = clamp(ll.lat, -1.35, 1.35), this.tLon = ll.lon;
  }

  async placeBase(ll) {
    if (!this.isLand(ll.lat, ll.lon)) { sfx('deny'); toast('Die Basis muss an Land errichtet werden.', 'warn'); return; }
    const region = REGIONS.find((r) => r.id === regionOf(ll.lat, ll.lon));
    const ok = await confirmBox(`Hauptquartier hier errichten?<br><br>Region: <b>${region.name}</b><br>Breite ${(ll.lat / DEG).toFixed(1)}°, Länge ${(ll.lon / DEG).toFixed(1)}°`, 'Errichten');
    if (!ok) return;
    Game.c.base = { lat: ll.lat, lon: ll.lon, name: 'AEGIS Kommando', region: region.id };
    this.buildBaseMarker();
    document.getElementById('base-hint')?.remove();
    banner('HAUPTQUARTIER EINSATZBEREIT', 'Radar aktiv – halte Ausschau nach UFOs');
    sfx('research');
    this.setSpeed(3);
    Game.save();
  }

  selectMarker(key) {
    const [kind, id] = key.split(':');
    if (key === 'static:base') return this.action('base');
    if (kind === 'ufo') return this.ufoMenu(this.ufos.find((u) => u.id === id));
    if (kind === 'site') return this.siteMenu(this.sites.find((s) => s.id === id));
    if (kind === 'craft') return this.action('intercept');
    if (kind === 'transport') return this.transportInfo();
  }

  // ---------- Simulation ----------
  update(dt) {
    if (!this.active) return;
    const c = Game.c;
    // Kamera
    if (!anyModalOpen()) {
      const lx = Input.axis(0), ly = Input.axis(1), rx = Input.axis(2), ry = Input.axis(3);
      const k = 1.6 * dt * (this.tDist - 1) / 1.5;
      this.tLon += (lx + rx) * k; this.tLat = clamp(this.tLat - (ly + ry) * k, -1.35, 1.35);
      const zoom = Input.trigger('RT') - Input.trigger('LT');
      if (Math.abs(zoom) > 0.05) this.tDist = clamp(this.tDist * (1 - zoom * dt * 1.4), 1.25, 6);
      const kk = 1.2 * dt;
      if (Input.isDown('ArrowLeft') || Input.isDown('KeyA')) this.tLon -= kk;
      if (Input.isDown('ArrowRight') || Input.isDown('KeyD')) this.tLon += kk;
      if (Input.isDown('ArrowUp') || Input.isDown('KeyW')) this.tLat = clamp(this.tLat + kk, -1.35, 1.35);
      if (Input.isDown('ArrowDown') || Input.isDown('KeyS')) this.tLat = clamp(this.tLat - kk, -1.35, 1.35);
      if (Input.isDown('Equal') || Input.isDown('NumpadAdd')) this.tDist = clamp(this.tDist * (1 - dt), 1.25, 6);
      if (Input.isDown('Minus') || Input.isDown('NumpadSubtract')) this.tDist = clamp(this.tDist * (1 + dt), 1.25, 6);
    }
    this.camLat = smooth(this.camLat, this.tLat, 8, dt);
    this.camLon = smooth(this.camLon, this.tLon, 8, dt);
    this.dist = smooth(this.dist, this.tDist, 6, dt);
    const cv = latLonToVec(this.camLat, this.camLon);
    this.camera.position.set(cv.x * this.dist, cv.y * this.dist, cv.z * this.dist);
    this.camera.lookAt(0, 0, 0);
    document.getElementById('g-reticle')?.classList.toggle('show', Input.lastDevice === 'pad');

    // Zeit
    let minutes = anyModalOpen() || !c.base ? 0 : SPEEDS[this.speed].mps * dt;
    while (minutes > 0 && this.active) {
      const step = Math.min(minutes, 10);
      minutes -= step;
      this.simulate(step);
      if (this.speed === 0 || anyModalOpen()) break;
    }
    // Sonne nach Tageszeit
    const minOfDay = c.time % 1440;
    const season = Math.sin(((c.time / 1440) % 365) / 365 * Math.PI * 2 - 1.4) * 0.41;
    const s = latLonToVec(season, Math.PI - (minOfDay / 1440) * Math.PI * 2);
    this.sunDir.set(s.x, s.y, s.z);
    this.sun.position.copy(this.sunDir).multiplyScalar(10);
    this.planetMat.uniforms.camPos.value.copy(this.camera.position);
    this.planetMat.uniforms.time.value += dt;
    this.atmo.material.uniforms.camPos.value.copy(this.camera.position);
    this.cloudMat.uniforms.rot.value = (c.time / 1440) * 0.08 + this.engine.time * 0.0015;
    if (this.radarSweep) this.radarSweep.rotation.y -= dt * 1.5;

    this.renderMarkers();
    if (this._hudTimer === undefined || (this._hudTimer -= dt) <= 0) { this._hudTimer = 0.2; this.updateHud(); }
  }

  simulate(min) {
    const c = Game.c;
    c.time += min;
    // Tageswechsel
    const day = Math.floor(c.time / 1440);
    if (day !== this.lastDay) {
      const days = day - this.lastDay;
      this.lastDay = day;
      const hadResearch = c.research?.id;
      Game.tickDays(days);
      if (hadResearch && !c.research) this.researchDone(hadResearch);
      if (day % 5 === 0) Game.save();
    }
    // Monatswechsel
    const d = fmtDate(c.time);
    const monthIdx = (d.year - 2031) * 12 + d.month;
    if (monthIdx !== c.lastMonth) { c.lastMonth = monthIdx; this.monthEnd(); }

    // UFO-Erzeugung
    this.nextUfo -= min;
    if (this.nextUfo <= 0) {
      const diff = 1 + monthIdx * 0.35;
      this.nextUfo = randRange(360, 1500) / Math.min(diff, 3);
      this.spawnUfo(diff);
    }
    this.nextTerror -= min;
    if (this.nextTerror <= 0) { this.nextTerror = randRange(9000, 16000); this.spawnUfo(2 + monthIdx * 0.35, 'terror'); }
    c.geo = { nextUfo: this.nextUfo, nextTerror: this.nextTerror };

    // UFOs bewegen
    for (const u of [...this.ufos]) this.updateUfo(u, min);
    // Abfangjäger
    for (const cr of c.crafts) this.updateCraft(cr, min);
    // Einsatzorte verfallen (nicht, solange der Kondor dort gelandet ist)
    const tr = c.transport;
    for (const s of [...this.sites]) {
      if (tr.status === 'arrived' && tr.target === s.id) continue;
      if (s.expires != null) {
        s.expires -= min;
        if (s.expires <= 0) {
          this.sites.splice(this.sites.indexOf(s), 1);
          if (s.kind === 'terror') { Game.addScore(-120, s.region); this.log(`Terrorangriff auf ${s.name} nicht abgewehrt!`, 'bad'); toast(`Terrorangriff auf ${s.name} – keine Reaktion. Die Region ist empört.`, 'bad'); }
          else this.log(`Einsatzort ${s.name} aufgegeben.`, 'warn');
        }
      }
    }
    // Transporter
    this.updateTransport(min);
  }

  spawnUfo(diff, mission = 'recon') {
    const weights = { scout: Math.max(0.2, 3 - diff), fighter: 1 + diff * 0.3, freighter: Math.max(0, diff - 1.3), battleship: Math.max(0, diff - 2.8) * 0.6 };
    if (mission === 'terror') { weights.scout = 0; weights.fighter = 1; }
    let r = rand() * Object.values(weights).reduce((a, b) => a + b, 0), type = 'scout';
    for (const [k, w] of Object.entries(weights)) { r -= w; if (r <= 0) { type = k; break; } }
    const start = latLonToVec(Math.asin(rand() * 1.6 - 0.8), rand() * Math.PI * 2);
    const u = {
      id: 'u' + Math.floor(rand() * 1e9).toString(36), type, mission,
      pos: { ...start }, target: null, wp: randInt(2, 5), state: 'fly', detected: false, hp: UFOS[type].hp, landTimer: 0,
      name: `UFO-${randInt(100, 999)}`,
    };
    if (mission === 'terror') { const city = choice(Game.c.cities); u.city = city.name; u.target = latLonToVec(city.lat, city.lon); u.wp = 1; }
    else u.target = this.pickWaypoint();
    this.ufos.push(u);
  }
  pickWaypoint() { const p = rand() < 0.6 ? this.randomLand(0.01, 0.35) : { lat: Math.asin(rand() * 1.6 - 0.8), lon: rand() * 6.28 }; return latLonToVec(p.lat, p.lon); }

  updateUfo(u, min) {
    const spec = UFOS[u.type];
    let ll = vecToLatLon(u.pos);
    if (u.state === 'landed') {
      u.landTimer -= min;
      if (u.landTimer <= 0) {
        u.state = 'fly'; u.target = this.pickWaypoint();
        const site = this.sites.find((s) => s.ufoId === u.id);
        if (site) { this.sites.splice(this.sites.indexOf(site), 1); if (u.detected) this.log(`${u.name} ist wieder gestartet.`, 'warn'); }
      }
    } else {
      const r = slerpStep(u.pos, u.target, spec.speed * min * (u.state === 'leave' ? 2 : 1));
      u.pos = { x: r.x, y: r.y, z: r.z };
      ll = vecToLatLon(u.pos);
      if (r.arrived) {
        if (u.state === 'leave') { this.removeUfo(u); if (u.detected) this.log(`${u.name} hat die Atmosphäre verlassen.`); else Game.addScore(-15, regionOf(ll.lat, ll.lon)); return; }
        if (u.mission === 'terror') {
          const city = Game.c.cities.find((x) => x.name === u.city);
          this.addSite({ kind: 'terror', name: city.name, lat: city.lat, lon: city.lon, ufoType: u.type, expires: 18 * 60, region: city.region });
          this.log(`TERRORANGRIFF in ${city.name}!`, 'bad');
          toast(`⚠ Terrorangriff in ${city.name}! Sende sofort ein Einsatzteam.`, 'bad', 6000);
          sfx('alert'); this.setSpeed(0); this.focusOn(city.lat, city.lon);
          u.state = 'leave'; u.target = latLonToVec(Math.asin(rand() * 1.6 - 0.8), rand() * 6.28);
          return;
        }
        u.wp--;
        if (u.wp <= 0) { u.state = 'leave'; u.target = latLonToVec(Math.asin(rand() * 1.6 - 0.8), rand() * 6.28); }
        else if (u.type !== 'battleship' && this.isLand(ll.lat, ll.lon) && rand() < 0.45) {
          u.state = 'landed'; u.landTimer = randRange(180, 540);
          if (u.detected) {
            this.addSite({ kind: 'landed', name: `${u.name} (gelandet)`, lat: ll.lat, lon: ll.lon, ufoType: u.type, ufoId: u.id, region: regionOf(ll.lat, ll.lon) });
            this.log(`${u.name} ist gelandet.`, 'warn'); toast(`${u.name} (${UFOS[u.type].name}) ist gelandet – Bodeneinsatz möglich!`, 'warn'); sfx('alert'); this.setSpeed(0);
          }
        } else u.target = this.pickWaypoint();
      }
    }
    // Radar
    const ang = Game.c.base ? angleBetween(u.pos, this.baseVec) : 9;
    const inRange = ang < Game.radarRange;
    const chased = Game.c.crafts.some((cr) => cr.status === 'out' && cr.target === u.id);
    if (!u.detected && (inRange || Game.cheats.revealUfos)) {
      if (Game.cheats.revealUfos || rand() < spec.detect * (Game.has('navigation') ? 1 : 0.5) * (min / 10)) {
        u.detected = true;
        const first = !u.reported; u.reported = true;
        this.log(`${u.name} ${first ? 'geortet' : 'erneut geortet'}: ${spec.name}`, 'warn');
        if (first) { toast(`📡 UFO geortet: ${spec.name} – ${u.mission === 'terror' ? 'Kurs auf ' + u.city : 'Kurs unbekannt'}`, 'warn'); sfx('alert'); this.setSpeed(0); }
        if (Input.lastDevice === 'pad') this.focusOn(ll.lat, ll.lon);
        if (u.state === 'landed' && !this.sites.find((s) => s.ufoId === u.id)) this.addSite({ kind: 'landed', name: `${u.name} (gelandet)`, lat: ll.lat, lon: ll.lon, ufoType: u.type, ufoId: u.id, region: regionOf(ll.lat, ll.lon) });
      }
    } else if (u.detected && ang > Game.radarRange * 1.12 && !chased && !Game.cheats.revealUfos && u.state !== 'landed') {
      u.detected = false; this.log(`Radarkontakt zu ${u.name} verloren.`);
    }
  }
  removeUfo(u) { const i = this.ufos.indexOf(u); if (i >= 0) this.ufos.splice(i, 1); }
  focusOn(lat, lon) { this.tLat = clamp(lat, -1.35, 1.35); this.tLon = lon; }

  addSite(s) {
    s.id = 's' + Math.floor(rand() * 1e9).toString(36);
    if (s.expires == null && s.kind === 'crash') s.expires = 48 * 60;
    this.sites.push(s);
    return s;
  }

  updateCraft(cr, min) {
    const spec = CRAFTS[cr.type];
    if (cr.status === 'out') {
      const u = this.ufos.find((x) => x.id === cr.target);
      if (!u || !u.detected) { cr.status = 'return'; this.log(`${cr.name}: Ziel verloren, Rückkehr zur Basis.`); return; }
      const r = slerpStep(cr.pos, u.pos, spec.speed * min);
      cr.pos = { x: r.x, y: r.y, z: r.z };
      if (angleBetween(cr.pos, u.pos) < 0.015) {
        if (u.state === 'landed') { cr.status = 'return'; toast(`${u.name} ist gelandet – Luftangriff nicht möglich. Sende einen Bodentrupp!`, 'warn'); return; }
        if (u.engaged) return; // anderer Jäger kämpft bereits – folgt dem UFO weiter
        this.airCombat(cr, u);
      }
    } else if (cr.status === 'return') {
      const r = slerpStep(cr.pos, this.baseVec, spec.speed * min);
      cr.pos = { x: r.x, y: r.y, z: r.z };
      if (r.arrived) { cr.status = cr.hp < spec.hp ? 'repair' : 'ready'; cr.pos = null; this.log(`${cr.name} ist in der Basis gelandet.`); }
    }
  }

  updateTransport(min) {
    const t = Game.c.transport;
    if (t.status === 'out') {
      const site = this.sites.find((s) => s.id === t.target);
      if (!site) { t.status = 'return'; toast('Einsatzort existiert nicht mehr – Kondor kehrt zurück.', 'warn'); return; }
      const dest = latLonToVec(site.lat, site.lon);
      const r = slerpStep(t.pos, dest, 0.0065 * min);
      t.pos = { x: r.x, y: r.y, z: r.z };
      if (r.arrived) { t.status = 'arrived'; this.arrival(site); }
    } else if (t.status === 'return') {
      const r = slerpStep(t.pos, this.baseVec, 0.0065 * min);
      t.pos = { x: r.x, y: r.y, z: r.z };
      if (r.arrived) { t.status = 'ready'; t.pos = null; t.squad = []; this.log('Kondor ist zur Basis zurückgekehrt.'); }
    }
  }

  renderMarkers() {
    const c = Game.c;
    const sc = this.dist * 0.011;
    const pulse = 1 + Math.sin(this.engine.time * 5) * 0.25;
    for (const u of this.ufos) {
      if (!u.detected && !Game.cheats.revealUfos) continue;
      const m = this.marker('ufo:' + u.id, 'ufo', u.pos, `${u.name}<small>${UFOS[u.type].name}${u.state === 'landed' ? ' · gelandet' : ''}</small>`);
      m.scale.setScalar(sc);
      m.children[0].rotation.y += 0.05;
      m.userData.ring.scale.setScalar(pulse * 1.6);
    }
    for (const cr of c.crafts) if (cr.pos) {
      const u = this.ufos.find((x) => x.id === cr.target);
      const m = this.marker('craft:' + cr.id, 'craft', cr.pos, cr.name, { target: cr.status === 'out' && u ? u.pos : this.baseVec });
      m.scale.setScalar(sc * 0.9);
    }
    const t = c.transport;
    if (t.pos) {
      const site = this.sites.find((s) => s.id === t.target);
      const m = this.marker('transport:k', 'transport', t.pos, 'Kondor', { target: t.status === 'out' && site ? latLonToVec(site.lat, site.lon) : this.baseVec });
      m.scale.setScalar(sc * 1.1);
    }
    const colors = { crash: 0xff3030, landed: 0xffcc22, terror: 0xff7a00, hive: 0xc04dff };
    const kindName = { crash: 'Absturzstelle', landed: 'Landestelle', terror: 'Terrorangriff', hive: 'Hive-Nest' };
    for (const s of this.sites) {
      const v = latLonToVec(s.lat, s.lon);
      const m = this.marker('site:' + s.id, 'site', v, `${s.name}<small>${kindName[s.kind]}${s.expires ? ' · ' + Math.ceil(s.expires / 60) + ' h' : ''}</small>`, { color: colors[s.kind] });
      m.scale.setScalar(sc * 1.2);
      m.userData.ring.scale.setScalar(pulse * 1.2);
    }
    this.sweepMarkers();
    // Beschriftungen positionieren
    for (const [k, l] of this.labels) {
      const m = this.markers.get(k);
      const v = m?.userData.v;
      if (!v || !this.facing(v)) { l.style.display = 'none'; continue; }
      const s = this.screenPos(v, 1.03);
      l.style.display = 'block';
      l.style.transform = `translate(${s.x}px, ${s.y}px)`;
    }
  }

  // ---------- Luftkampf ----------
  airCombat(cr, u) {
    this.setSpeed(0);
    sfx('alert');
    const spec = CRAFTS[cr.type], us = UFOS[u.type];
    let mode = 'std', timer = null, done = false;
    u.engaged = true;
    const camp = Game.c;
    const h = modal({
      title: `Luftkampf: ${cr.name} vs. ${u.name}`, closable: false, wide: true,
      html: `<div class="dogfight">
        <div class="df-side"><b>${cr.name}</b><small>${spec.name}</small><div id="df-cr"></div></div>
        <div class="df-view"><div class="df-craft">▲</div><div class="df-ufo">⬬</div><div id="df-shots"></div></div>
        <div class="df-side"><b>${u.name}</b><small>${us.name}</small><div id="df-ufo"></div></div>
      </div><div class="df-log" id="df-log"></div>`,
      buttons: [
        { label: 'Vorsichtig', close: false, action: () => setMode('safe') },
        { label: 'Standard', close: false, primary: true, action: () => setMode('std') },
        { label: 'Aggressiv', close: false, action: () => setMode('aggr') },
        { label: 'Abbrechen', danger: true, close: false, action: () => finish('flee') },
      ],
      onClose: () => { if (!done) finish('flee'); clearInterval(timer); },
    });
    const logEl = h.el.querySelector('#df-log');
    const log = (t, cls = '') => { logEl.insertAdjacentHTML('afterbegin', `<div class="${cls}">${t}</div>`); };
    const draw = () => {
      h.el.querySelector('#df-cr').innerHTML = bar(cr.hp, spec.hp, 'good');
      h.el.querySelector('#df-ufo').innerHTML = bar(u.hp, us.hp, 'bad');
      h.el.querySelectorAll('.modal-foot .btn').forEach((b, i) => b.classList.toggle('active', ['safe', 'std', 'aggr'][i] === mode));
    };
    const setMode = (m) => { mode = m; draw(); return false; };
    const shot = (from) => {
      const s = el('i', 'df-shot ' + from); h.el.querySelector('#df-shots').appendChild(s); setTimeout(() => s.remove(), 500);
    };
    const finish = (res) => {
      if (done) return false; done = true;
      clearInterval(timer);
      u.engaged = false;
      if (Game.c !== camp) return false; // Kampagne wurde inzwischen gewechselt
      if (res === 'win' && !this.ufos.includes(u)) res = 'flee';
      u.hp = Math.max(0, u.hp); cr.hp = Math.max(0, cr.hp); draw();
      const ll = vecToLatLon(u.pos);
      const region = regionOf(ll.lat, ll.lon);
      if (res === 'win') {
        this.removeUfo(u);
        Game.c.stats.ufosDown++;
        Game.addScore(us.score, region);
        if (this.isLand(ll.lat, ll.lon)) {
          this.addSite({ kind: 'crash', name: `Absturz ${u.name}`, lat: ll.lat, lon: ll.lon, ufoType: u.type, region, crashed: true });
          log(`<b>${u.name} abgeschossen!</b> Absturzstelle markiert.`, 'good');
          this.log(`${u.name} abgeschossen – Absturzstelle an Land!`, 'good');
        } else { log(`<b>${u.name} abgeschossen!</b> Das Wrack versinkt im Ozean.`, 'good'); this.log(`${u.name} ins Meer gestürzt.`, 'good'); }
        sfx('explosion'); Input.rumble(1, 1, 400);
      } else if (res === 'lost') {
        const ci = Game.c.crafts.indexOf(cr); if (ci >= 0) Game.c.crafts.splice(ci, 1);
        log(`<b>${cr.name} wurde zerstört!</b>`, 'bad'); this.log(`${cr.name} abgeschossen.`, 'bad'); sfx('explosion');
        Game.addScore(-40, region);
      } else { log('Gefecht abgebrochen.'); }
      if (res !== 'lost') cr.status = 'return';
      const foot = h.el.querySelector('.modal-foot');
      foot.innerHTML = '';
      const b = el('button', 'btn primary', 'Weiter'); b.onclick = () => h.close(); foot.appendChild(b);
      setTimeout(() => b.focus(), 50);
      return false;
    };
    draw();
    log(`Feindkontakt! ${us.name} auf Abfangkurs.`);
    timer = setInterval(() => {
      if (done) return;
      if (!h.el.isConnected || !this.active) return finish('flee');
      const acc = spec.acc + (mode === 'aggr' ? 0.15 : mode === 'safe' ? -0.12 : 0);
      const dmgMul = mode === 'aggr' ? 1.15 : 1;
      if (rand() < acc || Game.cheats.oneHit) {
        const dmg = Game.cheats.oneHit ? 99999 : Math.round(spec.dmg * dmgMul * randRange(0.7, 1.3));
        u.hp -= dmg; log(`Treffer! ${dmg} Schaden am UFO.`, 'good'); shot('up');
      } else { log('Daneben.'); shot('up miss'); }
      if (u.hp <= 0) return finish('win');
      const ehit = mode === 'aggr' ? 0.62 : mode === 'safe' ? 0.3 : 0.48;
      if (rand() < ehit) {
        const dmg = Game.cheats.god ? 0 : Math.round(us.dmg * randRange(0.6, 1.3));
        cr.hp -= dmg; log(`${cr.name} getroffen: −${dmg}`, 'bad'); shot('down'); Input.rumble(0.6, 0.3, 160); sfx('hit');
      } else shot('down miss');
      draw();
      if (cr.hp <= 0) return finish('lost');
      if (cr.hp < spec.hp * 0.15 && mode !== 'aggr') { log(`${cr.name} schwer beschädigt – Pilot bricht ab!`, 'bad'); finish('flee'); }
    }, 750);
  }

  // ---------- Menüs ----------
  ufoMenu(u) {
    if (!u) return;
    const spec = UFOS[u.type];
    const ready = Game.c.crafts.filter((cr) => cr.status === 'ready');
    modal({
      title: `${u.name} – ${spec.name}`,
      html: `<p>Status: <b>${u.state === 'landed' ? 'Gelandet' : u.state === 'leave' ? 'Verlässt Atmosphäre' : 'Im Flug'}</b>${u.mission === 'terror' ? `<br>Vermutetes Ziel: <b>${u.city}</b>` : ''}</p>
        <p class="muted">Geschätzte Besatzung: ${spec.crew[0]}–${spec.crew[1]} · Hüllenstärke ${spec.hp}</p>
        <h4>Verfügbare Abfangjäger</h4>
        ${ready.length ? ready.map((cr) => `<button class="btn wide" data-craft="${cr.id}">✈ ${cr.name} (${CRAFTS[cr.type].name}) – Abfangen</button>`).join('') : '<p class="muted">Keine einsatzbereiten Abfangjäger.</p>'}
        ${u.state === 'landed' ? '<p>Das UFO ist gelandet. Wähle die Landestelle, um einen Bodentrupp zu entsenden.</p>' : ''}`,
      buttons: [{ label: 'Schließen' }],
    }).el.querySelectorAll('[data-craft]').forEach((b) => b.addEventListener('click', () => {
      const cr = Game.c.crafts.find((x) => x.id === b.dataset.craft);
      cr.status = 'out'; cr.target = u.id; cr.pos = cr.pos || { ...this.baseVec };
      sfx('launch'); toast(`${cr.name} gestartet – Abfangkurs auf ${u.name}.`);
      this.log(`${cr.name} startet zum Abfangen.`);
      b.closest('.modal-backdrop').querySelector('[data-close]')?.click();
      if (this.speed === 0) this.setSpeed(2);
    }));
  }

  siteMenu(s) {
    if (!s) return;
    const t = Game.c.transport;
    const desc = { crash: 'Ein abgeschossenes UFO. Überlebende Aliens verteidigen das Wrack.', landed: 'Ein intaktes, gelandetes UFO. Die volle Besatzung ist anwesend.', terror: 'Aliens terrorisieren die Zivilbevölkerung. Schnelles Handeln rettet Leben!', hive: 'Das Hive-Nest der Invasoren. Vernichte den Hive-Kommandanten, um den Krieg zu beenden.' };
    modal({
      title: s.name,
      html: `<p>${desc[s.kind]}</p>${s.ufoType ? `<p class="muted">UFO-Klasse: ${UFOS[s.ufoType].name}</p>` : ''}${s.expires ? `<p class="muted">Verbleibende Zeit: ${Math.ceil(s.expires / 60)} h</p>` : ''}
        <p>Transporter Kondor: <b>${t.status === 'ready' ? 'Einsatzbereit' : 'Im Einsatz'}</b></p>`,
      buttons: [{ label: 'Schließen' }, { label: 'Einsatztrupp entsenden', primary: true, disabled: t.status !== 'ready', action: () => { this.squadSelect(s); } }],
    });
  }

  squadSelect(site) {
    const sold = Game.c.soldiers.filter((s) => s.wound <= 0);
    if (!sold.length) { alertBox('Kein Personal', 'Keine einsatzfähigen Soldaten verfügbar. Rekrutiere neue Soldaten in der Basis.'); return; }
    const chosen = new Set(sold.slice(0, 8).map((s) => s.id));
    const render = () => sold.map((s) => `
      <div class="sq-row ${chosen.has(s.id) ? 'on' : ''}">
        <button class="btn sq-tog" data-tog="${s.id}">${chosen.has(s.id) ? '☑' : '☐'}</button>
        <div class="sq-name"><b>${s.name}</b><small>${RANKS[s.rank]} · Treff ${s.acc} · ZE ${s.tu} · LP ${s.hp + ARMORS[s.armor].hp}</small></div>
        <button class="btn sq-eq" data-w="${s.id}">◀ ${WEAPONS[s.weapon].short} ▶</button>
        <button class="btn sq-eq" data-a="${s.id}">${ARMORS[s.armor].name}</button>
        <button class="btn sq-eq" data-g="${s.id}">💣×${s.grenades}</button>
      </div>`).join('');
    const h = modal({
      title: `Einsatztrupp – ${site.name}`, wide: true,
      html: `<p class="muted">Bis zu 8 Soldaten. Tippe auf Waffe/Rüstung/Granaten, um die Ausrüstung zu wechseln.</p><div id="sq-list" class="sq-list">${render()}</div><p id="sq-info" class="muted"></p>`,
      buttons: [{ label: 'Abbrechen' }, { label: 'Start!', primary: true, action: () => {
        if (!chosen.size) { toast('Wähle mindestens einen Soldaten.', 'warn'); return false; }
        const t = Game.c.transport;
        t.status = 'out'; t.target = site.id; t.pos = { ...this.baseVec }; t.squad = [...chosen];
        sfx('launch'); this.log(`Kondor startet nach ${site.name}.`); if (this.speed === 0) this.setSpeed(3);
      } }],
    });
    const list = h.el.querySelector('#sq-list');
    const grenadeStock = () => (Game.c.stock.frag || 0) + (Game.grenadeAvailable('alien') ? Game.c.stock.alien || 0 : 0);
    const info = () => {
      const g = [...chosen].reduce((a, id) => a + Game.c.soldiers.find((x) => x.id === id).grenades, 0);
      h.el.querySelector('#sq-info').textContent = `Granaten im Trupp: ${g} / Lager: ${grenadeStock()}${Game.cheats.allGear ? ' (Cheat: unbegrenzt)' : g > grenadeStock() ? ' – nicht genug, wird gekürzt' : ''}`;
    };
    const cycle = (arr, cur) => arr[(arr.indexOf(cur) + 1) % arr.length];
    const owned = (id, field) => Game.c.soldiers.filter((x) => x[field] === id).length;
    list.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      sfx('click');
      const focusKey = Object.keys(b.dataset)[0], focusVal = b.dataset[focusKey];
      const s = (id) => Game.c.soldiers.find((x) => x.id === id);
      if (b.dataset.tog) { const id = b.dataset.tog; if (chosen.has(id)) chosen.delete(id); else if (chosen.size < 8) chosen.add(id); }
      if (b.dataset.w) {
        const so = s(b.dataset.w);
        const opts = Object.keys(WEAPONS).filter((w) => Game.weaponAvailable(w) && (w === 'rifle' || w === so.weapon || owned(w, 'weapon') < (Game.c.stock[w] || 0) || Game.cheats.allGear));
        so.weapon = cycle(opts, so.weapon);
      }
      if (b.dataset.a) {
        const so = s(b.dataset.a);
        const opts = Object.keys(ARMORS).filter((a) => Game.armorAvailable(a) && (a === 'none' || a === so.armor || owned(a, 'armor') < (Game.c.stock[a] || 0) || Game.cheats.allGear));
        so.armor = cycle(opts, so.armor);
      }
      if (b.dataset.g) {
        const so = s(b.dataset.g);
        const others = [...chosen].filter((id) => id !== so.id).reduce((a, id) => a + s(id).grenades, 0);
        const room = Game.cheats.allGear ? 3 : Math.max(0, Math.min(3, grenadeStock() - others));
        so.grenades = so.grenades >= room ? 0 : so.grenades + 1;
      }
      list.innerHTML = render();
      list.querySelector(`[data-${focusKey}="${focusVal}"]`)?.focus();
      info();
    });
    info();
  }

  transportInfo() {
    const t = Game.c.transport;
    modal({ title: 'Transporter Kondor', html: `<p>Status: ${({ ready: 'Bereit', out: 'Unterwegs zum Einsatzort', return: 'Rückflug', arrived: 'Am Einsatzort' })[t.status]}</p><p>An Bord: ${t.squad.length} Soldaten</p>`, buttons: [{ label: 'Zurückrufen', disabled: t.status !== 'out', action: () => { t.status = 'return'; } }, { label: 'OK', primary: true }] });
  }

  arrival(site) {
    this.setSpeed(0);
    sfx('alert');
    const t = Game.c.transport;
    modal({
      title: 'Kondor am Einsatzort', closable: false,
      html: `<p>Der Transporter hat <b>${site.name}</b> erreicht.</p><p>${t.squad.length} Soldaten bereit zum Absetzen.</p>${site.kind !== 'terror' && site.kind !== 'hive' ? '<p class="muted">Tageszeit vor Ort: ' + (this.isNight(site) ? 'Nacht – eingeschränkte Sicht!' : 'Tag') + '</p>' : ''}`,
      buttons: [
        { label: 'Rückflug', action: () => { t.status = 'return'; } },
        { label: 'Mission starten', primary: true, action: () => {
          const squad = t.squad.map((id) => Game.c.soldiers.find((s) => s.id === id)).filter(Boolean);
          this.hooks.startMission({ site, squad, night: this.isNight(site), biome: site.kind === 'terror' ? 'urban' : site.kind === 'hive' ? 'hive' : this.biomeAt(site.lat, site.lon) });
        } },
      ],
    });
  }
  isNight(site) { const v = latLonToVec(site.lat, site.lon); return v.x * this.sunDir.x + v.y * this.sunDir.y + v.z * this.sunDir.z < -0.05; }

  // Rückkehr aus dem Bodenkampf
  missionDone(site, result) {
    const i = this.sites.findIndex((s) => s.id === site.id);
    if (i >= 0 && (result.won || site.kind === 'terror')) this.sites.splice(i, 1);
    if (result.won && site.ufoId) { const u = this.ufos.find((x) => x.id === site.ufoId); if (u) this.removeUfo(u); }
    const t = Game.c.transport;
    t.status = 'return';
    this.log(result.won ? `Mission ${site.name}: Erfolg!` : `Mission ${site.name}: Fehlschlag.`, result.won ? 'good' : 'bad');
    this.updateHud(true);
  }

  researchDone(id) {
    const r = RESEARCH.find((x) => x.id === id);
    sfx('research'); this.setSpeed(0);
    this.log(`Forschung abgeschlossen: ${r.name}`, 'good');
    modal({ title: '⚗ Forschung abgeschlossen', html: `<h3>${r.name}</h3><p>${r.desc}</p>`, buttons: [{ label: 'Neues Projekt', action: () => setTimeout(() => this.action('research'), 200) }, { label: 'OK', primary: true }] });
  }
  spawnHive() {
    if (this.sites.some((s) => s.kind === 'hive')) return;
    const p = this.randomLand(0.15, 0.5);
    this.addSite({ kind: 'hive', name: 'Hive-Nest', lat: p.lat, lon: p.lon, region: regionOf(p.lat, p.lon) });
    toast('Das Hive-Nest wurde lokalisiert! Starte den finalen Angriff.', 'good', 7000);
    this.focusOn(p.lat, p.lon);
  }

  monthEnd() {
    const rep = Game.monthlyReport();
    sfx('alert'); this.setSpeed(0);
    const d = fmtDate(Game.c.time - 1440);
    const over = rep.gameOver && !Game.cheats.god;
    if (over) Game.c.lost = true;
    modal({
      title: `Monatsbericht – ${d.text.split(' ').slice(1).join(' ')}`, wide: true, closable: !over,
      html: `<table class="tbl"><tr><th>Region</th><th>Bewertung</th><th>Finanzierung</th><th>Änderung</th></tr>
        ${rep.lines.map((l) => `<tr><td>${l.name}</td><td class="${l.score >= 0 ? 'good' : 'bad'}">${l.score}</td><td>${fmtMoney(l.funding)}</td><td class="${l.delta >= 0 ? 'good' : 'bad'}">${l.delta >= 0 ? '+' : ''}${fmtMoney(l.delta)}</td></tr>`).join('')}</table>
        <p>Einnahmen: <b class="good">${fmtMoney(rep.fundingTotal)}</b> · Gehälter: <b class="bad">−${fmtMoney(rep.salaries)}</b> · Unterhalt: <b class="bad">−${fmtMoney(rep.upkeep)}</b></p>
        <p>Bilanz: <b class="${rep.net >= 0 ? 'good' : 'bad'}">${fmtMoney(rep.net)}</b> · Monatswertung: <b>${rep.monthScore}</b></p>
        ${Game.c.negMonths ? '<p class="bad">⚠ Der Rat ist unzufrieden. Ein weiterer schlechter Monat beendet das Projekt AEGIS!</p>' : ''}`,
      buttons: [{ label: 'Weiter', primary: true, action: () => { if (over) this.hooks.gameOver('Der Rat hat das Projekt AEGIS wegen anhaltender Misserfolge eingestellt.'); } }],
    });
    if (!over) Game.save();
  }

  action(a) {
    const c = Game.c;
    if (!c.base && a !== 'menu') { toast('Errichte zuerst dein Hauptquartier.', 'warn'); return; }
    if (a === 'menu') return this.hooks.openMenu();
    if (a === 'intercept') {
      const det = this.ufos.filter((u) => u.detected);
      modal({
        title: '✈ Abfangjäger', wide: true,
        html: `<table class="tbl"><tr><th>Name</th><th>Typ</th><th>Hülle</th><th>Status</th></tr>${c.crafts.map((cr) => `<tr><td>${cr.name}</td><td>${CRAFTS[cr.type].name}</td><td>${Math.round(cr.hp)}/${CRAFTS[cr.type].hp}</td><td>${({ ready: 'Bereit', out: 'Im Einsatz', return: 'Rückflug', repair: 'Reparatur' })[cr.status]}</td></tr>`).join('')}</table>
          <h4>Geortete UFOs</h4>${det.length ? det.map((u) => `<button class="btn wide" data-ufo="${u.id}">${u.name} – ${UFOS[u.type].name}${u.state === 'landed' ? ' (gelandet)' : ''}</button>`).join('') : '<p class="muted">Kein Radarkontakt.</p>'}
          <h4>Einsatzorte</h4>${this.sites.length ? this.sites.map((s) => `<button class="btn wide" data-site="${s.id}">${s.name}</button>`).join('') : '<p class="muted">Keine.</p>'}`,
        buttons: [{ label: 'Schließen', primary: true }],
      }).el.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.ufo) { const u = this.ufos.find((x) => x.id === b.dataset.ufo); b.closest('.modal-backdrop').querySelector('[data-close]').click(); const ll = vecToLatLon(u.pos); this.focusOn(ll.lat, ll.lon); setTimeout(() => this.ufoMenu(u), 200); }
        if (b.dataset.site) { const s = this.sites.find((x) => x.id === b.dataset.site); b.closest('.modal-backdrop').querySelector('[data-close]').click(); this.focusOn(s.lat, s.lon); setTimeout(() => this.siteMenu(s), 200); }
      });
    }
    if (a === 'base') this.baseMenu();
    if (a === 'research') this.researchMenu();
    if (a === 'soldiers') this.soldierMenu();
    if (a === 'shop') this.shopMenu();
    if (a === 'finance') this.financeMenu();
  }

  baseMenu() {
    const c = Game.c;
    const h = modal({
      title: `⬢ ${c.base.name}`, wide: true,
      html: `<div class="grid2">
        <div><h4>Anlagen</h4>${Object.entries(FACILITIES).map(([k, f]) => `<div class="fac"><b>${f.name}</b> × ${c.facilities[k] || 0}<small>${f.desc}</small>
          <button class="btn" data-build="${k}" ${(c.facilities[k] || 0) + c.building.filter((b) => b.type === k).length >= f.max + (k === 'medbay' ? 0 : 1) ? 'disabled' : ''}>Bauen ${fmtMoney(f.cost)} · ${f.days} T</button></div>`).join('')}
          ${c.building.length ? `<h4>Im Bau</h4>${c.building.map((b) => `<div>${FACILITIES[b.type].name}: noch ${Math.ceil(b.daysLeft)} Tage</div>`).join('')}` : ''}</div>
        <div><h4>Personal</h4><p>Soldaten: <b>${c.soldiers.length}</b> (${c.soldiers.filter((s) => s.wound > 0).length} verwundet)</p>
          <p>Wissenschaftler: <b>${c.scientists}</b> / ${Game.labCapacity}</p>
          <button class="btn wide" data-hire="soldier">Soldat rekrutieren – ${fmtMoney(60000)}</button>
          <button class="btn wide" data-hire="sci" ${c.scientists >= Game.labCapacity ? 'disabled' : ''}>${Math.max(1, Math.min(5, Game.labCapacity - c.scientists))} Wissenschaftler einstellen – ${fmtMoney(Math.max(1, Math.min(5, Game.labCapacity - c.scientists)) * 30000)}</button>
          <h4>Radar</h4><p>Reichweite: ${Math.round(Game.radarRange / DEG * 111)} km</p></div></div>`,
      buttons: [{ label: 'Schließen', primary: true }],
    });
    h.el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.build) {
        const f = FACILITIES[b.dataset.build];
        if (c.credits < f.cost) { sfx('deny'); toast('Nicht genug Budget.', 'warn'); return; }
        c.credits -= f.cost; c.building.push({ type: b.dataset.build, daysLeft: f.days }); sfx('select');
        toast(`${f.name} wird gebaut.`); h.close(); this.baseMenu();
      }
      if (b.dataset.hire === 'soldier') { if (c.credits < 60000) { sfx('deny'); return; } c.credits -= 60000; const s = newSoldier(); c.soldiers.push(s); toast(`${s.name} rekrutiert.`); h.close(); this.baseMenu(); }
      if (b.dataset.hire === 'sci') { const n = Math.min(5, Game.labCapacity - c.scientists); const cost = n * 30000; if (n <= 0 || c.credits < cost) { sfx('deny'); return; } c.credits -= cost; c.scientists += n; h.close(); this.baseMenu(); }
      this.updateHud();
    });
  }

  researchMenu() {
    const c = Game.c;
    const avail = Game.researchAvailable();
    const cur = c.research ? RESEARCH.find((r) => r.id === c.research.id) : null;
    const h = modal({
      title: '⚗ Forschung', wide: true,
      html: `${cur ? `<div class="cur-research"><b>${cur.name}</b>${bar(c.research.progress, cur.cost, 'good')}<small>ca. ${Math.ceil((cur.cost - c.research.progress) / c.scientists)} Tage · ${c.scientists} Wissenschaftler</small></div>` : '<p class="warn">Kein laufendes Projekt!</p>'}
        <h4>Verfügbare Projekte</h4>${avail.filter((r) => r.id !== cur?.id).map((r) => `<button class="btn wide research-item" data-r="${r.id}"><b>${r.name}</b><small>${r.desc}</small><i>${r.cost} WT</i></button>`).join('') || '<p class="muted">Keine – birg Alien-Artefakte, um neue Projekte freizuschalten.</p>'}
        <h4>Artefakte im Lager</h4><p class="muted">${Object.entries(c.artifacts).filter(([, n]) => n > 0).map(([k, n]) => `${k} ×${n}`).join(' · ') || 'Keine'}</p>
        <h4>Abgeschlossen</h4><p class="muted">${c.researched.map((id) => RESEARCH.find((r) => r.id === id).name).join(' · ') || '—'}</p>`,
      buttons: [{ label: 'Schließen', primary: true }],
    });
    h.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]'); if (!b) return;
      if (c.research) c.researchProgress[c.research.id] = c.research.progress;
      c.research = { id: b.dataset.r, progress: c.researchProgress[b.dataset.r] || 0 };
      sfx('select'); toast(`Forschung gestartet: ${RESEARCH.find((r) => r.id === b.dataset.r).name}`);
      h.close();
    });
  }

  soldierMenu() {
    const c = Game.c;
    modal({
      title: '☗ Soldaten', wide: true,
      html: `<table class="tbl sold"><tr><th>Name</th><th>Rang</th><th>ZE</th><th>LP</th><th>Treff</th><th>Reakt</th><th>Kills</th><th>Status</th></tr>
        ${c.soldiers.map((s) => `<tr><td>${s.name}</td><td>${RANKS[s.rank]}</td><td>${s.tu}</td><td>${s.hp}</td><td>${s.acc}</td><td>${s.react}</td><td>${s.kills}</td><td>${s.wound > 0 ? `<span class="bad">verwundet (${Math.ceil(s.wound)} T)</span>` : '<span class="good">bereit</span>'}</td></tr>`).join('')}</table>`,
      buttons: [{ label: 'Schließen', primary: true }],
    });
  }

  shopMenu() {
    const c = Game.c;
    const items = [
      ...Object.entries(WEAPONS).filter(([k, w]) => w.cost && Game.weaponAvailable(k)).map(([k, w]) => ({ k, name: w.name, cost: w.cost, info: `Schaden ${w.dmg}` })),
      ...Object.entries(ARMORS).filter(([k, a]) => a.cost && Game.armorAvailable(k)).map(([k, a]) => ({ k, name: a.name, cost: a.cost, info: `Panzerung ${a.armor}` })),
      ...Object.entries(GRENADES).filter(([k]) => Game.grenadeAvailable(k)).map(([k, g]) => ({ k, name: g.name, cost: g.cost, info: `Schaden ${g.dmg}` })),
    ];
    const crafts = Object.entries(CRAFTS).filter(([, cr]) => !cr.req || Game.has(cr.req));
    const h = modal({
      title: '⚙ Beschaffung', wide: true,
      html: `<p>Budget: <b>${fmtMoney(c.credits)}</b></p><div class="shop">${items.map((i) => `<button class="btn shop-item" data-buy="${i.k}"><b>${i.name}</b><small>${i.info} · Lager: ${c.stock[i.k] || 0}</small><i>${fmtMoney(i.cost)}</i></button>`).join('')}</div>
        <h4>Abfangjäger</h4><div class="shop">${crafts.map(([k, cr]) => `<button class="btn shop-item" data-craft="${k}" ${c.crafts.length >= c.facilities.hangar + 1 ? 'disabled' : ''}><b>${cr.name}</b><small>Hülle ${cr.hp} · Schaden ${cr.dmg}</small><i>${fmtMoney(cr.cost)}</i></button>`).join('')}</div>
        <p class="muted">Hangarplätze: ${c.crafts.length}/${c.facilities.hangar + 1}</p>`,
      buttons: [{ label: 'Schließen', primary: true }],
    });
    h.el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const k = b.dataset.buy || b.dataset.craft; if (!k) return;
      const cost = b.dataset.buy ? items.find((i) => i.k === k).cost : CRAFTS[k].cost;
      if (c.credits < cost) { sfx('deny'); toast('Nicht genug Budget.', 'warn'); return; }
      c.credits -= cost; sfx('select');
      if (b.dataset.buy) c.stock[k] = (c.stock[k] || 0) + 1;
      else { const n = c.crafts.filter((x) => x.type === k).length + 1; c.crafts.push({ id: 'c' + Math.floor(rand() * 1e9).toString(36), type: k, name: `${CRAFTS[k].name}-${n}`, hp: CRAFTS[k].hp, status: 'ready' }); }
      h.close(); this.shopMenu(); this.updateHud();
    });
  }

  financeMenu() {
    const c = Game.c;
    modal({
      title: '¢ Finanzen & Wertung', wide: true,
      html: `<table class="tbl"><tr><th>Region</th><th>Finanzierung/Monat</th><th>Wertung (Monat)</th></tr>${REGIONS.map((r) => `<tr><td>${r.name}</td><td>${fmtMoney(c.funding[r.id])}</td><td class="${(c.regionScore[r.id] || 0) >= 0 ? 'good' : 'bad'}">${c.regionScore[r.id] || 0}</td></tr>`).join('')}</table>
        <p>Gesamtwertung: <b>${c.score}</b> · Missionen: ${c.stats.won}/${c.stats.missions} · UFOs abgeschossen: ${c.stats.ufosDown} · Aliens eliminiert: ${c.stats.kills} · Verluste: ${c.stats.lost}</p>`,
      buttons: [{ label: 'Schließen', primary: true }],
    });
  }

  // ---------- Lebenszyklus ----------
  activate() {
    this.active = true;
    document.body.dataset.mode = 'geo';
    setMusicMood('geo');
    if (!document.getElementById('g-date')) { this.labels.forEach((l) => l.remove()); this.labels.clear(); this.markers.forEach((m, k) => { if (!k.startsWith('static:')) this.markerGroup.remove(m); }); this.markers.clear(); this.buildHud(); if (Game.c.base) { this.markers.delete('static:base'); this.buildBaseMarker(); } }
    this.lastDay = Math.floor(Game.c.time / 1440);
    if (Game.c.base && Game.has('hyperwave') && !Game.c.won) this.spawnHive();
    if (!Game.c.base) {
      this.setSpeed(0);
      const hint = el('div', 'base-hint panel', '<b>Wähle den Standort deines Hauptquartiers</b><br>Tippe/klicke auf eine Landmasse (Controller: Fadenkreuz + Ⓐ)');
      hint.id = 'base-hint';
      document.getElementById('hud').appendChild(hint);
    }
  }
  deactivate() { this.active = false; this.pointers.clear(); }
  dispose() {
    this.deactivate();
    this.unsub.forEach((f) => f());
    this.hmRT.dispose(); this.cloudRT.dispose();
    this.scene.traverse((o) => { o.geometry?.dispose?.(); });
    document.getElementById('hud').innerHTML = '';
  }
}
