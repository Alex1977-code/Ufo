// Electron-Hülle für AEGIS: lädt das Spiel über ein eigenes Protokoll (aegis://game/…),
// damit ES-Module, Importmap, fetch() und localStorage wie im Browser funktionieren.
const { app, BrowserWindow, protocol, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const ROOT = path.join(__dirname, 'app');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.hdr': 'application/octet-stream', '.bin': 'application/octet-stream', '.wasm': 'application/wasm', '.ktx2': 'image/ktx2',
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'aegis', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);
// Ältere oder als unsicher eingestufte Grafiktreiber nicht ausschließen (WebGL2 ist Pflicht)
app.commandLine.appendSwitch('ignore-gpu-blocklist');

async function serve(request) {
  const url = new URL(request.url);
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) return new Response('Forbidden', { status: 403 });
  try {
    const data = await fs.readFile(file);
    return new Response(data, { status: 200, headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 960, minHeight: 540,
    backgroundColor: '#05080d', title: 'AEGIS – Protokoll Erstkontakt',
    icon: path.join(__dirname, 'icon.png'), show: false, autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => win.show());
  // F11 = Vollbild, Strg+Umschalt+I = Entwicklerwerkzeuge (Fehlersuche)
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.control && input.shift && input.key.toLowerCase() === 'i') { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  // Externe Links im normalen Browser öffnen
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('aegis://')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.loadURL('aegis://game/index.html');
  // Selbsttest für die Build-Pipeline: AEGIS_SMOKE=<png-Pfad> lädt das Spiel, startet ein neues Spiel,
  // speichert ein Bildschirmfoto und beendet sich mit Code 0 (ok) bzw. 1 (Fehler).
  if (process.env.AEGIS_SMOKE) {
    const errors = [];
    win.webContents.on('console-message', (e) => { if (e.level === 'error') errors.push(e.message); });
    win.webContents.on('render-process-gone', (_e, d) => { errors.push('renderer: ' + d.reason); });
    const js = (code) => win.webContents.executeJavaScript(code, true);
    const wait = async (code, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(code).catch(() => false)) return true; await new Promise((r) => setTimeout(r, 500)); } return false; };
    win.webContents.once('did-finish-load', async () => {
      let ok = await wait("[...document.querySelectorAll('button')].some((b) => /Neues Spiel/.test(b.textContent))", 60000);
      if (ok) { await js("[...document.querySelectorAll('button')].find((b) => /Neues Spiel/.test(b.textContent)).click()"); ok = await wait('!!(window.__aegis && window.__aegis.geo && window.__aegis.Game.c)', 60000); }
      await new Promise((r) => setTimeout(r, 3000));
      const img = await win.webContents.capturePage();
      await fs.writeFile(process.env.AEGIS_SMOKE, img.toPNG());
      console.log(JSON.stringify({ ok, errors }));
      app.exit(ok && !errors.length ? 0 : 1);
    });
  }
  return win;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.whenReady().then(() => {
    protocol.handle('aegis', serve);
    Menu.setApplicationMenu(null);
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
