// Kopiert die Spieldateien (ohne Tests, Berichte, Werkzeuge) nach desktop/app für die Electron-Hülle.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(HERE, 'app');
const INCLUDE = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'fonts', 'icons', 'vendor', 'assets'];
fs.rmSync(OUT, { recursive: true, force: true });
for (const name of INCLUDE) {
  const src = path.join(ROOT, name);
  if (!fs.existsSync(src)) continue;
  fs.cpSync(src, path.join(OUT, name), { recursive: true, filter: (p) => !/(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(p) && !p.endsWith('.md') });
}
let n = 0, bytes = 0;
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { n++; bytes += fs.statSync(p).size; } } })(OUT);
console.log(`desktop/app: ${n} Dateien, ${(bytes / 1048576).toFixed(1)} MB`);
