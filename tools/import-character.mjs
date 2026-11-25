#!/usr/bin/env node
// AEGIS – Import eigener Figuren (MetaHuman / Character Creator 4 / Mixamo / MakeHuman) für js/characters.js
//
//   cd tools && npm install
//   node import-character.mjs <figur.glb|.gltf> --id meine_figur [--sex m|f] [--rig auto|metahuman|cc4|mixamo|makehuman]
//        [--out ../assets/characters/import/out] [--lods 25000:2048,8000:1024] [--strip-animations] [--register]
//
// Schritte: lesen → (cm→m) → Skelett-Bones auf das AEGIS/MakeHuman-Rig umbenennen → Materialrollen setzen →
// je LOD: Geometrie vereinfachen (meshopt simplify) + Texturen verkleinern (WebP) → GLB (EXT_meshopt_compression)
// → Manifest-Eintrag <id>.manifest.json (mit --register zusätzlich in assets/manifest.json).
// Clips: vorhandene bleiben (Bones umbenannt); ohne Clips retargetet js/characters.js die CC0-Clips zur Laufzeit
// (registerCharacterBase(id, gltf, { animSource: 'human_m_01' })).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { weld, dedup, prune, textureCompress, simplifyPrimitive, getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// ------------------------------------------------------------------------------------------------
// Bone-Mapping-Tabellen  (Quelle → AEGIS/MakeHuman-Name). Seiten: %l = l/r, %L = L/R, %S = Left/Right, %s = .L/.R
// ------------------------------------------------------------------------------------------------
const SIDED = (pairs) => pairs.flatMap(([src, dst]) => ['L', 'R'].map((S) => [
  src.replace(/%l/g, S.toLowerCase()).replace(/%L/g, S).replace(/%S/g, S === 'L' ? 'Left' : 'Right'), dst.replace(/%s/g, '.' + S)]));
const FINGERS = (fmt, names) => names.flatMap((n, k) => [1, 2, 3].map((j) => [fmt(n, j), `finger${k + 1}-${j}%s`]));
export const BONE_MAPS = {
  // Unreal Engine 5 / MetaHuman „body“-Skelett (Export: Unreal → FBX → Blender → glTF)
  metahuman: [
    ['pelvis', 'root'], ['spine_01', 'spine05'], ['spine_02', 'spine04'], ['spine_03', 'spine03'], ['spine_04', 'spine02'], ['spine_05', 'spine01'],
    ['neck_01', 'neck01'], ['neck_02', 'neck02'], ['head', 'head'],
    ...SIDED([['clavicle_%l', 'clavicle%s'], ['upperarm_%l', 'upperarm01%s'], ['upperarm_twist_01_%l', 'upperarm02%s'], ['lowerarm_%l', 'lowerarm01%s'],
      ['lowerarm_twist_01_%l', 'lowerarm02%s'], ['hand_%l', 'wrist%s'], ['thigh_%l', 'upperleg01%s'], ['thigh_twist_01_%l', 'upperleg02%s'],
      ['calf_%l', 'lowerleg01%s'], ['calf_twist_01_%l', 'lowerleg02%s'], ['foot_%l', 'foot%s'], ['ball_%l', 'toe3-1%s'],
      ...FINGERS((n, j) => `${n}_0${j}_%l`, ['thumb', 'index', 'middle', 'ring', 'pinky'])]),
  ],
  // Character Creator 4 (Export: CC4 → FBX „Unity/Blender“ oder direkt glTF)
  cc4: [
    ['CC_Base_Hip', 'root'], ['CC_Base_Waist', 'spine04'], ['CC_Base_Spine01', 'spine03'], ['CC_Base_Spine02', 'spine01'],
    ['CC_Base_NeckTwist01', 'neck01'], ['CC_Base_NeckTwist02', 'neck02'], ['CC_Base_Head', 'head'],
    ...SIDED([['CC_Base_%L_Clavicle', 'clavicle%s'], ['CC_Base_%L_Upperarm', 'upperarm01%s'], ['CC_Base_%L_UpperarmTwist01', 'upperarm02%s'],
      ['CC_Base_%L_Forearm', 'lowerarm01%s'], ['CC_Base_%L_ForearmTwist01', 'lowerarm02%s'], ['CC_Base_%L_Hand', 'wrist%s'],
      ['CC_Base_%L_Thigh', 'upperleg01%s'], ['CC_Base_%L_ThighTwist01', 'upperleg02%s'], ['CC_Base_%L_Calf', 'lowerleg01%s'],
      ['CC_Base_%L_CalfTwist01', 'lowerleg02%s'], ['CC_Base_%L_Foot', 'foot%s'], ['CC_Base_%L_ToeBase', 'toe3-1%s'],
      ...FINGERS((n, j) => `CC_Base_%L_${n}${j}`, ['Thumb', 'Index', 'Mid', 'Ring', 'Pinky'])]),
  ],
  // Mixamo / viele Marktplatz-Rigs
  mixamo: [
    ['mixamorig:Hips', 'root'], ['mixamorig:Spine', 'spine04'], ['mixamorig:Spine1', 'spine03'], ['mixamorig:Spine2', 'spine01'],
    ['mixamorig:Neck', 'neck01'], ['mixamorig:Head', 'head'],
    ...SIDED([['mixamorig:%SShoulder', 'clavicle%s'], ['mixamorig:%SArm', 'upperarm01%s'], ['mixamorig:%SForeArm', 'lowerarm01%s'],
      ['mixamorig:%SHand', 'wrist%s'], ['mixamorig:%SUpLeg', 'upperleg01%s'], ['mixamorig:%SLeg', 'lowerleg01%s'], ['mixamorig:%SFoot', 'foot%s'],
      ['mixamorig:%SToeBase', 'toe3-1%s'], ...FINGERS((n, j) => `mixamorig:%SHand${n}${j}`, ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'])]),
  ],
  makehuman: [],
};
const REQUIRED = ['root', 'spine01', 'head', 'upperarm01.L', 'upperarm01.R', 'lowerarm01.L', 'lowerarm01.R', 'wrist.L', 'wrist.R',
  'upperleg01.L', 'upperleg01.R', 'lowerleg01.L', 'lowerleg01.R', 'foot.L', 'foot.R'];
const OPTIONAL = ['finger2-1.L', 'finger3-1.L', 'finger5-1.L', 'finger2-1.R', 'finger3-1.R', 'finger5-1.R', 'toe3-1.L', 'toe3-1.R', 'neck01'];

// Materialrollen (für js/characters.js: skin / hair / eyes / brows / clothes_top / clothes_bottom)
const ROLE_RULES = [
  ['eyes', /eye(?!brow|lash)|cornea|iris|sclera|occlusion/i], ['brows', /brow|lash/i], ['hair', /hair|scalp|beard|mustache|fuzz/i],
  ['skin', /skin|body|head|face|arm|leg|std_skin|teeth|tongue/i], ['clothes_bottom', /pant|trouser|jean|short|skirt|bottom|leg_wear/i],
  ['clothes_top', /shirt|top|jacket|hood|coat|vest|torso|upper/i],
];

// ------------------------------------------------------------------------------------------------
function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; o[k] = v; } else o._.push(a);
  }
  return o;
}
const A = args(process.argv.slice(2));
if (!A._[0] || A.help) {
  console.log('Aufruf: node import-character.mjs <figur.glb|.gltf> --id <id> [--sex m|f] [--rig auto|metahuman|cc4|mixamo|makehuman]\n' +
    '        [--out <ordner>] [--lods 25000:2048,8000:1024] [--strip-animations] [--register] [--scale auto|<faktor>]');
  process.exit(A.help ? 0 : 1);
}
const input = path.resolve(A._[0]);
const id = String(A.id || path.basename(input).replace(/\.(glb|gltf)$/i, '')).replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
const outDir = path.resolve(A.out || path.join(ROOT, 'assets/characters/import/out'));
const lodSpec = String(A.lods || '25000:2048,8000:1024').split(',').map((s) => { const [t, x] = s.split(':').map(Number); return { tris: t, tex: x || 1024 }; });
fs.mkdirSync(outDir, { recursive: true });

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const triCount = (doc) => { let t = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) t += (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3; return Math.round(t); };
const jointsOf = (doc) => [...new Set(doc.getRoot().listSkins().flatMap((s) => s.listJoints()))];
function detectRig(names) {
  const has = (re) => names.some((n) => re.test(n));
  if (has(/^CC_Base_/)) return 'cc4';
  if (has(/^mixamorig:?/)) return 'mixamo';
  if (has(/^spine_0[1-5]$/) && has(/^thigh_[lr]$/)) return 'metahuman';
  if (has(/^upperleg01\.?[LR]$/)) return 'makehuman';
  return 'unknown';
}

// Ein LOD aus frischer Kopie der Quelle bauen
async function buildLOD(lod, k, report) {
  const doc = await io.read(input);
  const root = doc.getRoot(), scene = root.getDefaultScene() || root.listScenes()[0];
  // 1) Einheiten: Höhe > 20 → Zentimeter (Unreal/CC4-FBX) → ×0.01
  const b0 = getBounds(scene), h0 = b0.max[1] - b0.min[1];
  const scale = A.scale && A.scale !== 'auto' ? Number(A.scale) : h0 > 20 ? 0.01 : 1;
  if (scale !== 1) for (const n of scene.listChildren()) n.setScale(n.getScale().map((v) => v * scale)).setTranslation(n.getTranslation().map((v) => v * scale));
  // 2) Bones umbenennen
  const joints = jointsOf(doc), names = joints.map((j) => j.getName());
  const rig = A.rig && A.rig !== 'auto' ? A.rig : detectRig(names);
  const map = new Map(BONE_MAPS[rig] || []);
  let renamed = 0;
  for (const j of joints) { const nn = map.get(j.getName()); if (nn) { j.setName(nn); renamed++; } }
  const now = new Set(jointsOf(doc).map((j) => j.getName()));
  // 3) Materialrollen
  const roles = {};
  for (const m of root.listMaterials()) {
    const nm = m.getName() || '';
    const role = (ROLE_RULES.find(([, re]) => re.test(nm)) || [null])[0];
    if (role) { m.setExtras({ ...(m.getExtras() || {}), aegisRole: role, sourceName: nm }); if (!root.listMaterials().some((x) => x !== m && x.getName() === role)) m.setName(role); }
    if (m.getAlphaMode() === 'BLEND' && /hair|brow|lash/i.test(nm)) m.setAlphaMode('MASK').setAlphaCutoff(0.35); // Hair Cards: MASK statt BLEND
    roles[nm] = role || 'unbekannt';
  }
  // 4) Animationen
  if (A['strip-animations']) for (const a of root.listAnimations()) a.dispose();
  // 5) Geometrie
  await doc.transform(weld({}), dedup({ keepUniqueNames: true }));
  const before = triCount(doc);
  if (before > lod.tris) {
    const ratioAll = lod.tris / before;
    for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial()?.getName() || '';
      const tris = (prim.getIndices() ? prim.getIndices().getCount() : 0) / 3; if (!tris) continue;
      // Augen/Wimpern kaum vereinfachen (kleine, sichtbare Details)
      const target = /eye|brow|lash/i.test(mat) ? Math.max(tris * Math.max(ratioAll, 0.6), 64) : Math.max(tris * ratioAll, 24);
      let ratio = target / tris, err = 0.002;
      for (let it = 0; it < 8 && prim.getIndices().getCount() / 3 > target * 1.08; it++) {
        simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error: err, lockBorder: false });
        err *= 2; ratio *= 0.85;
      }
    }
  }
  await doc.transform(prune({ keepAttributes: true }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [lod.tex, lod.tex], quality: 82 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [Math.max(256, lod.tex / 2), Math.max(256, lod.tex / 2)], quality: 82, pattern: /brow|lash|eye|rough|occlusion|_ao/i }));
  // 6) Schreiben (Meshopt-Kompression; vorhandene Quantisierung bleibt, kein erneutes quantize – mehrteilige Skins!)
  const ext = root.listExtensionsUsed().find((e) => e.extensionName === 'EXT_meshopt_compression') || doc.createExtension(EXTMeshoptCompression);
  ext.setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  const file = path.join(outDir, `${id}_lod${k}.glb`);
  await io.write(file, doc);
  const check = await io.read(file);
  const b = getBounds(check.getRoot().getDefaultScene() || check.getRoot().listScenes()[0]);
  const texSizes = check.getRoot().listTextures().map((t) => (t.getSize() || [0, 0]).join('x'));
  const lodInfo = { file: path.relative(ROOT, file).replace(/\\/g, '/'), triangles: triCount(check), trianglesSource: before, maxTexture: lod.tex,
    textures: texSizes.length, textureSizes: [...new Set(texSizes)], bytes: fs.statSync(file).size,
    height_m: +(b.max[1] - b.min[1]).toFixed(3), animations: check.getRoot().listAnimations().map((a) => a.getName()) };
  if (k === 0) Object.assign(report, { rig, renamed, scaleApplied: scale, joints: names.length, missingRequired: REQUIRED.filter((r) => !now.has(r)),
    missingOptional: OPTIONAL.filter((r) => !now.has(r)), materialRoles: roles });
  return lodInfo;
}

const report = {};
const lods = [];
for (let k = 0; k < lodSpec.length; k++) lods.push(await buildLOD(lodSpec[k], k, report));
const entry = {
  id, type: 'character', source: 'import', sex: A.sex || 'm', file: lods[0].file, lods,
  rig: report.rig, rig_target: "AEGIS/MakeHuman 'default' (Bones umbenannt)", bones_renamed: report.renamed, joints: report.joints,
  missing_required_bones: report.missingRequired, missing_optional_bones: report.missingOptional, material_roles: report.materialRoles,
  scale_applied: report.scaleApplied, animations: lods[0].animations,
  animation_note: lods[0].animations.length ? 'eigene Clips (Bones umbenannt)' : "keine Clips – js/characters.js: registerCharacterBase(id, gltf, { animSource: 'human_m_01' }) retargetet die CC0-Clips zur Laufzeit",
  license: 'USER-PROVIDED – Lizenz (MetaHuman/Epic bzw. Reallusion CC4) selbst prüfen; keine echten Personen',
  up_axis: '+Y', forward: '+Z', generated: new Date().toISOString().slice(0, 10),
};
fs.writeFileSync(path.join(outDir, `${id}.manifest.json`), JSON.stringify(entry, null, 2));
if (A.register) {
  const mf = path.join(ROOT, 'assets/manifest.json'), m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  m.assets = m.assets.filter((x) => x.id !== id).concat([{ ...entry, file: entry.file.replace(/^assets\//, '') }]);
  fs.writeFileSync(mf, JSON.stringify(m, null, 2));
  console.log('Manifest aktualisiert:', path.relative(ROOT, mf));
}
console.log(JSON.stringify({ id, rig: entry.rig, renamed: entry.bones_renamed, missing: entry.missing_required_bones, lods: lods.map((l) => ({ file: l.file, tris: l.triangles, tex: l.textureSizes, kb: Math.round(l.bytes / 1024) })) }, null, 1));
if (entry.missing_required_bones.length) { console.warn('WARNUNG: Pflicht-Bones fehlen – Mapping in BONE_MAPS ergänzen:', entry.missing_required_bones.join(', ')); process.exitCode = 2; }
