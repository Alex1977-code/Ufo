import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHOTS = path.resolve(ROOT, 'tests/screenshots');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('playwright')); }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  let f = p; try { if (fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); } catch { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/index.html`;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const shot = async (n) => { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, n + '.png') }).catch(() => {}); };
const noErrors = async (step) => { if (errors.length) await shot('fail-' + step); assert.deepEqual(errors, [], `Fehler nach Schritt "${step}"`); };

test.after(async () => { await browser.close(); server.close(); });

test('Hauptmenü lädt ohne pageerror', async () => {
  await page.goto(URL_);
  await page.waitForSelector('text=Neues Spiel', { timeout: 30000 });
  await noErrors('menu');
});

test('Neues Spiel -> Weltkarte', async () => {
  await page.click('text=Neues Spiel');
  await page.waitForFunction(() => window.__aegis?.geo && window.__aegis.Game.c, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await noErrors('geo');
});

test('Mission starten, Zug beenden, Cheat-Sieg, zurück zur Weltkarte', async () => {
  await page.evaluate(() => {
    document.querySelectorAll('.modal-backdrop [data-close]').forEach((b) => b.click());
    document.querySelector('.modal-foot .btn')?.click();
    const g = window.__aegis.geo, G = window.__aegis.Game, ll = g.randomLand(0.02, 0.2);
    G.c.base = { lat: ll.lat, lon: ll.lon, name: 'A', region: 'nw' };
    g.buildBaseMarker();
    g.hooks.startMission({ site: { id: 'x', kind: 'crash', name: 'T', ufoType: 'scout', region: 'nw' }, squad: G.c.soldiers.slice(0, 6), night: false, biome: 'farm' });
  });
  const t0 = Date.now();
  await page.waitForFunction(() => window.__aegis.tac?.units?.length > 0, null, { timeout: 360000 });
  console.log(`# Missionsaufbau: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.waitForTimeout(2000);
  await noErrors('mission-start');

  await page.evaluate(() => window.__aegis.tac.endTurn());
  await page.waitForTimeout(6000);
  await noErrors('end-turn');

  await page.evaluate(() => window.__aegis.tac.cheatWin());
  const back = page.locator('button:has-text("Zurück zum Hauptquartier")');
  await back.waitFor({ timeout: 60000 });
  await shot('result');
  await back.click();
  await back.waitFor({ state: 'detached', timeout: 30000 });
  await page.waitForTimeout(3000);
  await noErrors('back-to-geo');
});
