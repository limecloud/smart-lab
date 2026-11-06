import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export type Point = [number, number, number];

export function box(parent: THREE.Object3D, size: Point, position: Point, surface: THREE.Material, radius = .025) {
  const geometry = radius > 0 ? new RoundedBoxGeometry(...size, 2, Math.min(radius, ...size.map((v) => v / 2.1))) : new THREE.BoxGeometry(...size);
  const mesh = new THREE.Mesh(geometry, surface);
  mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
  return mesh;
}

export function cylinder(parent: THREE.Object3D, radius: number, height: number, position: Point, surface: THREE.Material, lowerRadius = radius) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, lowerRadius, height, 24), surface);
  mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}

export function cable(parent: THREE.Object3D, points: Point[], radius: number, surface: THREE.Material) {
  const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, radius, 8, false), surface);
  mesh.castShadow = true; parent.add(mesh); return mesh;
}
