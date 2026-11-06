import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// GLTFExporter 的二进制写出使用浏览器 FileReader；构建时以 Node Blob 实现同一接口。
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((result) => { this.result = result; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then((result) => { this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`; this.onloadend?.(); }); }
};
const cache = new URL('../node_modules/.cache/smart-lab-assets/', import.meta.url);
const output = new URL('../public/assets/physical/', import.meta.url);
const rig = JSON.parse(await readFile(new URL('panda-rig.json', cache), 'utf8'));
const loader = new OBJLoader();
const geometries = new Map();
const materials = {
  white: new THREE.MeshPhysicalMaterial({ color: 0xdfe3e5, metalness: 0.16, roughness: 0.3, clearcoat: 0.25 }),
  off_white: new THREE.MeshStandardMaterial({ color: 0xb7bec3, metalness: 0.55, roughness: 0.3 }),
  black: new THREE.MeshStandardMaterial({ color: 0x242b31, metalness: 0.25, roughness: 0.46 }),
  light_blue: new THREE.MeshStandardMaterial({ color: 0x479fb2, metalness: 0.3, roughness: 0.3 }),
  green: new THREE.MeshStandardMaterial({ color: 0x32b8a4, emissive: 0x159680, emissiveIntensity: 0.4 }),
};
const angles = [0, -0.48, 0, -2.05, 0, 1.65, 0.78];
let vertices = 0, triangles = 0, drawCalls = 0;
async function meshGeometry(file) {
  if (geometries.has(file)) return geometries.get(file);
  const parsed = loader.parse(await readFile(new URL(`panda/${file}`, cache), 'utf8'));
  const parts = [];
  parsed.traverse((object) => { if (object.isMesh) {
    const geometry = object.geometry.clone();
    geometry.deleteAttribute('uv'); geometry.deleteAttribute('color');
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    parts.push(geometry);
  } });
  const combined = mergeVertices(mergeGeometries(parts), 1e-5);
  parts.forEach((part) => part.dispose());
  geometries.set(file, combined);
  return combined;
}
async function build(body) {
  const frame = new THREE.Group(); frame.name = `${body.name}_frame`;
  frame.position.fromArray(body.position);
  const [w, x, y, z] = body.quaternion;
  frame.quaternion.set(x, y, z, w).normalize();
  const pivot = new THREE.Group(); pivot.name = body.joint?.name ?? body.name;
  if (body.joint) {
    pivot.userData.jointType = body.joint.slide ? 'prismatic' : 'revolute';
    if (body.joint.slide) pivot.position.y = 0.025;
    else pivot.rotation.z = angles[Number(body.joint.name.replace('joint', '')) - 1];
  }
  frame.add(pivot);
  const groups = new Map();
  for (const part of body.meshes) {
    const list = groups.get(part.material) ?? []; list.push(await meshGeometry(part.file)); groups.set(part.material, list);
  }
  for (const [material, parts] of groups) {
    const geometry = mergeGeometries(parts);
    const mesh = new THREE.Mesh(geometry, materials[material]); mesh.name = `${body.name}_${material}`;
    pivot.add(mesh); vertices += geometry.attributes.position.count; triangles += geometry.index.count / 3; drawCalls++;
  }
  for (const child of body.children) pivot.add(await build(child));
  return frame;
}
const scene = new THREE.Group(); scene.name = 'Franka_Panda_visual_reference';
scene.add(await build(rig));
const binary = await new GLTFExporter().parseAsync(scene, { binary: true });
const uncompressed = Buffer.from(binary);
const sourceFile = new URL('panda-uncompressed.glb', cache);
const outputFile = new URL('panda-arm.glb', output);
await writeFile(sourceFile, uncompressed);
execFileSync(process.execPath, [fileURLToPath(new URL('../node_modules/gltfpack/cli.js', import.meta.url)), '-i', fileURLToPath(sourceFile), '-o', fileURLToPath(outputFile), '-cc', '-ce', 'ext', '-kn', '-ke'], { stdio: 'inherit' });
const buffer = await readFile(outputFile);
const manifestPath = new URL('SOURCES.json', output);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.panda.output = { file: 'panda-arm.glb', bytes: buffer.length, uncompressedBytes: uncompressed.length, sourceVertices: vertices, sourceTriangles: triangles, drawCalls, sha256: createHash('sha256').update(buffer).digest('hex'), modifications: 'Merged and indexed visual submeshes by link/material; preserved seven revolute joints and two fingers; updated PBR materials and display pose. Quantized and meshopt-compressed via gltfpack, without triangle simplification. No collision or control dynamics exported.' };
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(manifest.panda.output);
