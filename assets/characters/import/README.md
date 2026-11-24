# Eigene Figuren importieren (MetaHuman / Character Creator 4)

Dieser Ordner nimmt **selbst exportierte** realistische Figuren auf. AEGIS kann MetaHuman- oder CC4-Figuren
nicht selbst erzeugen – du exportierst sie, das Skript `tools/import-character.mjs` macht sie spieltauglich.

> **Lizenz selbst prüfen!** MetaHuman-Figuren unterliegen der Epic-/MetaHuman-Lizenz (Nutzung außerhalb der
> Unreal Engine ist eingeschränkt), CC4-Figuren der Reallusion-Lizenz (Export-/Weitergabe-Rechte je nach Paket).
> Verwende **keine Abbilder echter Personen** (keine Scans/Fotos realer Menschen, keine Prominenten).
> Importierte Figuren werden im Manifest als `USER-PROVIDED` markiert und nicht automatisch ins Spiel eingebunden.

## 1. Exportweg

**MetaHuman → Unreal → FBX → GLB**
1. MetaHuman in Unreal Engine 5 öffnen; Körper (`*_Body`) und Kopf (`*_Face`) mit LOD 1–3 verwenden
   (LOD 0 ist für das Spiel zu schwer).
2. Skeletal Mesh rechtsklick → *Asset Actions → Export* → FBX (Skelett `metahuman_base_skel`, Haare als
   *Hair Cards* – keine Groom-/Strähnen-Haare, die lassen sich nicht exportieren).
3. In Blender (≥ 4.0) importieren, Kopf und Körper an dasselbe Skelett hängen, Texturen (Base Color, Normal,
   Roughness) zuweisen, *File → Export → glTF 2.0 (.glb)*: „+Y Up“, „Apply Modifiers“, Skinning an,
   Animationen nach Wunsch.

**Character Creator 4 → GLB**
1. CC4: *File → Export → FBX* (Ziel „Blender“, „Mesh + Motion“ oder nur Mesh, Hair Cards einschließen)
   oder direkt *Export → glTF/GLB*, sofern verfügbar.
2. FBX ggf. in Blender öffnen und wie oben als `.glb` exportieren.

Mixamo-Rigs und MakeHuman/MPFB2-Figuren werden ebenfalls erkannt.

## 2. Import

```bash
cd tools && npm install
node import-character.mjs ../assets/characters/import/meine_figur.glb --id meine_figur --sex f
```

Optionen: `--rig auto|metahuman|cc4|mixamo|makehuman`, `--lods 25000:2048,8000:1024` (Dreiecke:Texturgröße je LOD),
`--strip-animations`, `--scale auto|<faktor>` (cm-Exporte werden automatisch ×0,01 skaliert), `--out <ordner>`,
`--register` (trägt die Figur zusätzlich in `assets/manifest.json` ein).

Ergebnis in `assets/characters/import/out/`: `<id>_lod0.glb` (~25 k Δ, Texturen ≤ 2K WebP),
`<id>_lod1.glb` (~8 k Δ, ≤ 1K) und `<id>.manifest.json` (Rig, umbenannte Bones, fehlende Bones, Materialrollen).

## 3. Was das Skript macht

- **Bone-Mapping** auf das AEGIS-Rig (MakeHuman-Namen). Tabelle `BONE_MAPS` im Skript, z. B.:

  | AEGIS | MetaHuman | CC4 |
  |---|---|---|
  | root | pelvis | CC_Base_Hip |
  | spine05 / 04 / 03 / 02 / 01 | spine_01 … spine_05 | – / Waist / Spine01 / – / Spine02 |
  | neck01, head | neck_01, head | CC_Base_NeckTwist01, CC_Base_Head |
  | clavicle.L, upperarm01.L, lowerarm01.L, wrist.L | clavicle_l, upperarm_l, lowerarm_l, hand_l | CC_Base_L_Clavicle, _Upperarm, _Forearm, _Hand |
  | upperleg01.L, lowerleg01.L, foot.L, toe3-1.L | thigh_l, calf_l, foot_l, ball_l | CC_Base_L_Thigh, _Calf, _Foot, _ToeBase |
  | finger1..5-1..3.L | thumb/index/middle/ring/pinky_0x_l | CC_Base_L_Thumb/Index/Mid/Ring/Pinky1..3 |

  Fehlende Pflicht-Bones werden gemeldet (Exit-Code 2).
- **Materialrollen** `skin`, `hair`, `eyes`, `brows`, `clothes_top`, `clothes_bottom` (per Namensmuster);
  Haar-/Wimpern-Materialien BLEND → MASK (Hair Cards ohne Sortierfehler).
- **Vereinfachung** mit meshoptimizer (Augen/Wimpern werden geschont), **Texturen** → WebP, **LODs**, Meshopt-Kompression.

## 4. Im Spiel verwenden (Beispiel)

```js
import { loadCharacterLibrary, registerCharacterBase, makeCharacter } from './js/characters.js';
await loadCharacterLibrary();
const gltf = await loader.loadAsync('assets/characters/import/out/meine_figur_lod0.glb');
registerCharacterBase('meine_figur', gltf, { sex: 'f', animSource: 'human_f_01' }); // retargetet die CC0-Clips
const unit = makeCharacter({ base: 'meine_figur', role: 'soldier', armor: { type: 'personal' } });
```

Ohne eigene Clips überträgt `registerCharacterBase` die 21 CC0-Clips per Weltraum-Delta-Retargeting zur Laufzeit
(wie das V0-Offline-Retargeting). Sehr unterschiedliche Ruheposen (T- statt A-Pose) können leichte Armversätze ergeben –
dann die Figur in Blender in A-Pose exportieren.
