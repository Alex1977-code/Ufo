# AEGIS – Protokoll Erstkontakt

Ein taktisches Alien-Abwehr-Strategiespiel im Stil der Klassiker der 90er-Jahre (Weltkarte in Echtzeit + rundenbasierter Bodenkampf), komplett neu umgesetzt mit moderner Grafik. Läuft im Browser auf **PC, Handy, Tablet und TV**, ist als **App installierbar (PWA)** und funktioniert auch offline.

## Starten

Das Spiel besteht nur aus statischen Dateien und braucht keinen Build-Schritt:

```bash
python3 -m http.server 8080
# dann http://localhost:8080 öffnen
```

Oder einfach den Ordner auf einen beliebigen Webspace / GitHub Pages hochladen. Auf dem Handy im Browser öffnen und „Zum Startbildschirm hinzufügen“ wählen, um es als Vollbild-App zu installieren.

## Spielprinzip

* **Geoscape:** Prozedural erzeugter 3D-Planet mit Tag/Nacht-Zyklus, Wolken, Stadtlichtern und Atmosphäre. Errichte dein Hauptquartier, orte UFOs per Radar, fange sie mit Abfangjägern ab (Luftkampf) und schicke den Transporter „Kondor“ zu Absturz-, Lande- und Terror-Orten.
* **Bodenkampf:** Rundenbasiert mit Zeiteinheiten, Sichtlinien, Nebel des Krieges, Deckung, Knien, Reaktionsfeuer, Granaten und zerstörbarer Umgebung. Prozedurale Karten: Farmland, Wald, Wüste, Arktis, Stadt (Terror mit Zivilisten), UFO-Wracks und das Hive-Nest. Tag- und Nachteinsätze.
* **Strategie:** Forschung (Laser, Plasma, Legierungen, Exo-Rüstung, Zerium-Antrieb …), Beschaffung, Basisausbau, Soldaten mit Rängen und Beförderungen, Monatsberichte und Finanzierung durch sechs Regionen.
* **Ziel:** Hyperwellen-Dekodierung erforschen, das Hive-Nest finden und den Hive-Kommandanten besiegen.

## Grafik & „DLSS“

Echtes NVIDIA DLSS ist eine proprietäre Technik, die nur in nativen Windows-Spielen mit RTX-GPU läuft – im Browser und auf Handys ist sie nicht verfügbar. AEGIS bringt deshalb einen eigenen, plattformunabhängigen **Super-Resolution-Upscaler im DLSS-Stil** mit:

* Rendern in reduzierter interner Auflösung (Modi *Nativ/DLAA, Qualität, Ausgewogen, Leistung, Ultra-Leistung* – dieselben Skalierungsfaktoren wie DLSS/FSR)
* kantengerichtete Rekonstruktion + kontrastadaptives Nachschärfen (angelehnt an FSR 1 EASU/RCAS)
* **dynamische Auflösung**, die automatisch die Ziel-Bildrate (30/60/90/120 FPS) hält
* PBR-Materialien, Image-Based Lighting, weiche Schatten, HDR-Bloom, ACES-Tonemapping, Filmkorn/Vignette, Partikeleffekte

Alles ist unter *Grafik & Einstellungen* einstellbar; die Leistungsanzeige zeigt interne → Ausgabeauflösung.

## Steuerung

| | Maus/Tastatur | Touch | Controller |
|---|---|---|---|
| Kamera | Ziehen, Rechtsklick-Ziehen, WASD, Q/E, Mausrad | Wischen, Pinch, Drehen mit 2 Fingern | Rechter Stick, LT/RT |
| Bewegen | Feld anklicken | Feld zweimal antippen | Linker Stick + Ⓐ |
| Angreifen | Alien anklicken, nochmal = Feuer (oder F) | Alien antippen, nochmal = Feuer | Ⓐ auf Alien, nochmal Ⓐ |
| Schussmodus | 1–4 | Buttons | Ⓧ |
| Knien | K | Button | Ⓨ |
| Soldat wechseln | Tab | ◀ ▶ | LB / RB |
| Zug beenden | Enter | Button | Select/View |
| Menü | Esc | ☰ | Start/Menu |
| **Cheat-Menü** | **F10 oder ^** | Menü → Cheats | **L3 + R3** |

**Bluetooth-Controller** (Xbox, PlayStation DualShock/DualSense, Switch Pro, 8BitDo …) werden über die Gamepad-API automatisch erkannt – einfach in den Bluetooth-Einstellungen des Geräts koppeln. Tastenbeschriftungen passen sich dem Controller-Typ an, Rumble/Vibration wird unterstützt. Alle Menüs sind vollständig mit dem Controller bedienbar.

## Cheats

Gottmodus, unendliche Zeiteinheiten, 100 % Trefferchance, Ein-Treffer-Kills, Karte aufdecken, kein Reaktionsfeuer, alle UFOs orten, Sofort-Forschung/-Bau, alle Ausrüstung, Geld, Missionssieg, UFO/Terrorangriff erzeugen u. v. m.
Cheat-Codes: `GELDREGEN`, `UNSTERBLICH`, `ADLERAUGE`, `EINSTEIN`.

## TV-Streaming

* **Direkt streamen:** „Auf TV streamen“ nutzt die Presentation API (Chrome/Edge → Chromecast, Google TV, Cast-fähige Fernseher). Das Spiel läuft dann auf dem TV, das Handy/der PC wird zum Controller (virtuelles Gamepad); ein gekoppelter Bluetooth-Controller und die Tastatur werden automatisch an den TV weitergeleitet, der Spielstand wird synchronisiert.
* **Spiegeln:** AirPlay (iOS/macOS), „Bildschirm übertragen“ (Android), Win + K / Miracast (Windows) oder HDMI.
* **TV-Modus** in den Einstellungen vergrößert die gesamte Oberfläche für große Bildschirme.

## Technik

* Three.js r170 (lokal in `vendor/`, MIT-Lizenz), WebGL2, ES-Module, kein Build-Tool
* Alle Modelle, Texturen, Sounds und Musik werden prozedural erzeugt – keine externen Assets
* Spielstände in `localStorage`, Service Worker für Offline-Betrieb

```
index.html          Einstiegsseite
css/style.css       Oberfläche (responsive, TV-Modus)
js/main.js          Menüs, Einstellungen, Moduswechsel
js/engine.js        Renderer, Post-Processing, Super-Resolution, dynamische Auflösung
js/geoscape.js      Weltkarte, UFOs, Luftkampf, Basis, Forschung, Finanzen
js/tactical.js      Bodenkampf, KI, Effekte, Eingabe
js/tacmap.js        Prozedurale Kartengenerierung
js/models.js        Prozedurale 3D-Modelle & Materialien
js/input.js         Tastatur, Gamepad (Bluetooth), Menü-Navigation
js/cast.js          TV-Streaming (Presentation API)
js/cheats.js        Cheat-Menü
js/audio.js         Prozedurale Soundeffekte & Musik
js/game.js, data.js Kampagnenzustand & Spieldaten
```

## Asset-Viewer

`viewer.html` (eigenständige Seite, nicht im Hauptmenü verlinkt; z. B. `http://localhost:8080/viewer.html`) zeigt alle 3D-Assets mit derselben Licht- und Materialpipeline wie das Spiel: Hero-Autos (`js/herocar.js`, Typ, Lackfarbe, Schaden, Licht), Figuren (`js/characters.js`, jede Basis × Personal-/Power-Rüstung/zivil, Zustände und alle Animationsclips), Fluggeräte und UFOs (`js/craftmodels.js`, Stufe hoch/niedrig), alle GLBs und Textur-Sets aus `assets/manifest.json` sowie eine Auswahl prozeduraler Props aus `js/models.js`. Links Liste mit Suche und Kategorie-Filter, Mitte 3D-Ansicht (Orbit-Steuerung, Drehteller, Drahtgitter, Normalen- und UV-Checker-Ansicht), rechts einklappbare Panels: HDRI-Umgebung (`js/environment.js`), Tonemapping AgX/ACES/Neutral, Belichtung, Schatten, PBR-Boden (Asphalt/Beton/Gehwegplatten), Bloom; Statistik (Dreiecke, Vertices, Draw-Calls, Materialien mit Slot, Texturen mit Auflösung und geschätztem GPU-Speicher, LOD-Stufen mit Umschaltung, Bones, Clips, Maße in Metern) und Prüfungen mit ✓/⚠/✗ (G2-`validateVehicle` für Fahrzeuge, fehlende Normalen/UVs, NaN, Texturen ohne Zweierpotenz oder > 2048, unbenannte Materialien, > 30 000 Dreiecke ohne LOD, Maßstab Auto 3,5–6 m / Figur 1,5–2,1 m). „Alle prüfen“ lädt jedes Asset nacheinander und zeigt eine Ergebnistabelle (als Markdown kopierbar). Auf dem Handy sind Liste und Info-Panel ausklappbare Overlays. URL-Parameter: `?a=hero:sedan`, `?check=1`, `?view=uv`, `?env=dusk`, `?floor=concrete`; Skript-Zugriff über `window.__viewer`.

## Tests & Veröffentlichung

- Tests (Node 20+): `cd tests && npm install && npm test`. `npm run test:unit` prüft Kartengenerator (alle Biome × 200 Seeds), Kampagnenlogik, Ausrüstung und Spieldaten; `npm run test:e2e` startet Chromium (Playwright, headless, SwiftShader) gegen einen lokalen Server und spielt Menü → Weltkarte → Mission → Zug → Sieg → Weltkarte durch. Einmalig `npx playwright install chromium`.
- CI: `.github/workflows/ci.yml` läuft bei jedem Push/Pull Request (Syntaxcheck, Unit-, E2E-Tests; Screenshots bei Fehlern als Artefakt).
- Veröffentlichung: Actions → „Deploy (gh-pages)“ → Run workflow (Eingabe `ref`, Standard `claude/gallant-cray-8s8udi`). Nach grünen Tests wird der Spielinhalt (ohne `tests/`, `orchestrator/`, `.github/`) auf den Branch `gh-pages` gepusht; der Service-Worker-Cache wird dabei auf `aegis-<Commit>` gesetzt, damit Spieler Updates erhalten.
