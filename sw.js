// Service Worker: Offline-Cache für die installierbare App (PWA)
const CACHE = 'aegis-v2';
const ASSETS = [
  './', './index.html', './css/style.css', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
  './js/main.js', './js/engine.js', './js/util.js', './js/data.js', './js/input.js', './js/ui.js', './js/audio.js', './js/game.js',
  './js/geoscape.js', './js/aircombat.js', './js/shaders.js', './js/tacmap.js', './js/tactical.js', './js/models.js', './js/cheats.js', './js/equip.js', './js/cast.js', './js/basescape.js',
  './vendor/three/three.module.min.js',
  './vendor/three/addons/postprocessing/EffectComposer.js', './vendor/three/addons/postprocessing/RenderPass.js',
  './vendor/three/addons/postprocessing/ShaderPass.js', './vendor/three/addons/postprocessing/UnrealBloomPass.js',
  './vendor/three/addons/postprocessing/OutputPass.js', './vendor/three/addons/postprocessing/Pass.js', './vendor/three/addons/postprocessing/MaskPass.js',
  './vendor/three/addons/shaders/CopyShader.js', './vendor/three/addons/shaders/LuminosityHighPassShader.js', './vendor/three/addons/shaders/OutputShader.js',
  './vendor/three/addons/postprocessing/GTAOPass.js', './vendor/three/addons/shaders/GTAOShader.js', './vendor/three/addons/shaders/PoissonDenoiseShader.js',
  './vendor/three/addons/math/SimplexNoise.js',
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
// Netzwerk zuerst (aktuelle Version), bei Offline aus dem Cache
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok && new URL(e.request.url).origin === location.origin) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
