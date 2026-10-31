// Builds public/models/carrier-{f,m}.glb from Quaternius' "Universal Base Characters [Standard]"
// (CC0): strips unused vertex data, shrinks textures to WebP and meshopt-compresses the meshes.
//
//   npm i --no-save @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp
//   node scripts/build-carriers.mjs "<unzipped pack>/Base Characters/Godot - UE"
//
// The pack's glTFs name a few textures "*_png.png" that ship as "*.png"; those are aliased here.

import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, meshopt, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const src = process.argv[2];
if (!src) throw new Error('usage: node scripts/build-carriers.mjs <Godot - UE folder>');
const out = path.resolve(import.meta.dirname, '../public/models');
const KEEP = new Set(['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']);
const LIGHT = { f: 'T_Superhero_Female_Light_BaseColor.png', m: 'T_Superhero_Male_Ligh.png' };

for (const name of fs.readdirSync(src).filter((f) => f.endsWith('.png') && !f.endsWith('_png.png'))) {
  const alias = path.join(src, name.replace(/\.png$/, '_png.png'));
  if (!fs.existsSync(alias)) fs.copyFileSync(path.join(src, name), alias);
}

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder,
  'meshopt.decoder': MeshoptDecoder,
});

for (const [file, tag] of [['Superhero_Female_FullBody.gltf', 'f'], ['Superhero_Male_FullBody.gltf', 'm']]) {
  const doc = await io.read(path.join(src, file));
  const root = doc.getRoot();
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const sem of prim.listSemantics()) if (!KEEP.has(sem)) prim.setAttribute(sem, null);
    }
  }
  for (const mat of root.listMaterials()) {
    // the body is mostly covered by the stillsuit in game: roughness comes from the suit material,
    // and the small eyebrow and eye meshes don't need normal maps
    mat.setMetallicRoughnessTexture(null);
    if (!/Superhero/i.test(mat.getName())) { mat.setNormalTexture(null); continue; }
    // start from the light skin texture: the game tints it per carrier, and a tint can only darken
    const light = path.join(src, '../Textures', LIGHT[tag]);
    if (fs.existsSync(light)) mat.getBaseColorTexture().setImage(fs.readFileSync(light)).setMimeType('image/png');
  }
  await doc.transform(
    prune(),
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 82, resize: [1024, 1024] }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const dest = path.join(out, `carrier-${tag}.glb`);
  await io.write(dest, doc);
  console.log(dest, (fs.statSync(dest).size / 1024).toFixed(0), 'KB');
}
