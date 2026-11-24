// Service Worker: Offline-Cache für die installierbare App (PWA)
const CACHE = 'aegis-v3';
const ASSETS = [
  './', './index.html', './css/style.css', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
  './js/main.js', './js/engine.js', './js/util.js', './js/data.js', './js/input.js', './js/ui.js', './js/audio.js', './js/game.js',
  './js/geoscape.js', './js/aircombat.js', './js/shaders.js', './js/tacmap.js', './js/tactical.js', './js/models.js', './js/cheats.js', './js/equip.js', './js/cast.js', './js/basescape.js', './js/craftmodels.js', './js/characters.js', './js/herocar.js', './js/heavyvehicles.js',
  './vendor/three/three.module.min.js',
  './fonts/orbitron-latin.woff2', './fonts/rajdhani-500-latin.woff2', './fonts/rajdhani-500-latin-ext.woff2', './fonts/rajdhani-600-latin.woff2', './fonts/rajdhani-600-latin-ext.woff2', './fonts/rajdhani-700-latin.woff2', './fonts/rajdhani-700-latin-ext.woff2',
  './vendor/three/addons/postprocessing/EffectComposer.js', './vendor/three/addons/postprocessing/RenderPass.js',
  './vendor/three/addons/postprocessing/ShaderPass.js', './vendor/three/addons/postprocessing/UnrealBloomPass.js',
  './vendor/three/addons/postprocessing/OutputPass.js', './vendor/three/addons/postprocessing/Pass.js', './vendor/three/addons/postprocessing/MaskPass.js',
  './vendor/three/addons/shaders/CopyShader.js', './vendor/three/addons/shaders/LuminosityHighPassShader.js', './vendor/three/addons/shaders/OutputShader.js',
  './vendor/three/addons/postprocessing/GTAOPass.js', './vendor/three/addons/shaders/GTAOShader.js', './vendor/three/addons/shaders/PoissonDenoiseShader.js',
  './vendor/three/addons/math/SimplexNoise.js',
  // Realistisches Rendering (G1): Umgebungslicht, Schatten, Spiegelungen; HDRIs in 1K (2K wird bei Bedarf nachgeladen und gecacht)
  './js/environment.js', './vendor/three/addons/loaders/RGBELoader.js', './vendor/three/addons/csm/CSM.js', './vendor/three/addons/csm/CSMShader.js', './vendor/three/addons/csm/CSMFrustum.js',
  './vendor/three/addons/postprocessing/SSRPass.js', './vendor/three/addons/shaders/SSRShader.js', './assets/hdri/hdri.json',
  './assets/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr', './assets/hdri/kloofendal_overcast_puresky_1k.hdr', './assets/hdri/qwantani_dusk_2_puresky_1k.hdr',
  './assets/hdri/shanghai_bund_1k.hdr', './assets/hdri/small_hangar_01_1k.hdr',
  // Asset-Viewer (G3): eigenständige Seite viewer.html
  './viewer.html', './js/viewer.js', './css/viewer.css', './js/vehiclematerials.js',
];
// Einzeln cachen: eine fehlende Datei lässt die Installation nicht scheitern
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(ASSETS.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
// vendor/ und fonts/ ändern sich nie: Cache zuerst. Rest: Netzwerk zuerst (3 s Timeout), dann Cache.
const NET_TIMEOUT = 3000;
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const store = (res) => { if (res && res.ok) { const copy = res.clone(); e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})); } return res; };
  if (/\/(vendor|fonts)\//.test(url.pathname)) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then(store)));
    return;
  }
  e.respondWith(new Promise((resolve) => {
    let done = false;
    const fromCache = () => caches.match(req, { ignoreSearch: true });
    const timer = setTimeout(() => { fromCache().then((hit) => { if (hit && !done) { done = true; resolve(hit); } }); }, NET_TIMEOUT);
    fetch(req).then(store).then((res) => { clearTimeout(timer); if (!done) { done = true; resolve(res); } })
      .catch(() => { clearTimeout(timer); fromCache().then((hit) => { if (!done) { done = true; resolve(hit || Response.error()); } }); });
  }));
});
