// Galerie: Screenshots je 2 Seeds pro Biom + 4 Absturzvarianten. Nicht Teil der CI-Suite.
// Aufruf: npm run test:gallery   (Ausgabe: GALLERY_DIR oder tests/screenshots/gallery)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = process.env.GALLERY_DIR || path.resolve(ROOT, 'tests/screenshots/gallery');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  let f = p; try { if (fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); } catch { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/index.html`;
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(URL_);
await page.click('text=Neues Spiel');
await page.waitForTimeout(4000);

const jobs = [];
for (const b of ['farm', 'forest', 'desert', 'arctic']) for (const n of [1, 2]) jobs.push({ name: `${b}-${n}`, biome: b, kind: 'landed', ufoType: 'scout', seed: n * 977 });
for (const n of [1, 2]) jobs.push({ name: `urban-${n}`, biome: 'urban', kind: 'terror', ufoType: null, seed: n * 977 });
for (const n of [1, 2]) jobs.push({ name: `hive-${n}`, biome: 'hive', kind: 'hive', ufoType: null, seed: n * 977 });
// Absturzvarianten gezielt per Seed suchen (plow/pond/debris/crater)
const sites = await page.evaluate(async () => {
  const { setSeed } = await import('/js/util.js'); const { generateMap } = await import('/js/tacmap.js');
  const out = {}; for (let s = 1; s < 400 && Object.keys(out).length < 4; s++) { setSeed(s); const m = generateMap({ biome: 'farm', kind: 'crash', ufoType: 'fighter', night: false }); if (!out[m.ufo.site] && ['plow', 'pond', 'debris', 'crater'].includes(m.ufo.site)) out[m.ufo.site] = s; }
  return out;
});
for (const [site, seed] of Object.entries(sites)) jobs.push({ name: `crash-${site}`, biome: 'farm', kind: 'crash', ufoType: 'fighter', seed });

for (const j of jobs) {
  try {
    await page.evaluate(async (j) => {
      const { setSeed } = await import('/js/util.js');
      const A = window.__aegis, G = A.Game, g = A.geo;
      if (A.tac?.active && A.tac.end) try { A.tac.end(); } catch {}
      setSeed(j.seed);
      const ll = g.randomLand(0.02, 0.2); G.c.base = { lat: ll.lat, lon: ll.lon, name: 'A', region: 'nw' }; g.buildBaseMarker();
      G.cheats.revealMap = true;
      g.hooks.startMission({ site: { id: 'x', kind: j.kind, name: 'T', ufoType: j.ufoType, region: 'nw' }, squad: G.c.soldiers.slice(0, 6), night: false, biome: j.biome });
    }, j);
    await page.waitForTimeout(2500);
    await page.evaluate(() => { const t = window.__aegis.tac; t.cheatReveal?.(); if (t.camT) t.camT.dist = 60; });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, `M3-${j.name}.png`) });
    console.log('ok', j.name);
  } catch (e) { errors.push(`${j.name}: ${e.message}`); console.log('FAIL', j.name, e.message); }
}
console.log('Fehler:', errors.length); errors.slice(0, 40).forEach((e) => console.log(' ', e));
await browser.close(); server.close();
process.exitCode = errors.length ? 1 : 0;
