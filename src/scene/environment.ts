import * as THREE from 'three';
import { box, cylinder, cable, consolidate, type Materials } from './models';

type TextureLoader = (path: string, color?: boolean, repeat?: [number, number]) => THREE.Texture;

export function buildEnvironment(scene: THREE.Scene, m: Materials, texture: TextureLoader) {
  const room = new THREE.Group(); room.name = 'laboratory-architecture';
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0xbacbd1,
    map: texture('/assets/physical/lab-floor-albedo.jpg', true, [4.5, 3.25]),
    normalMap: texture('/assets/physical/concrete_floor_02-nor_gl.jpg', false, [4.5, 3.25]),
    roughnessMap: texture('/assets/physical/concrete_floor_02-rough.jpg', false, [4.5, 3.25]),
    normalScale: new THREE.Vector2(.045, .045), roughness: .43, metalness: .08,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(18, 13), floorMaterial);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; room.add(floor);
  box(room, [18.2, .16, 13.2], [0, -.105, 0], m.black, .03);
  const wall = new THREE.MeshStandardMaterial({ color: 0xaebfc4, roughness: .74 });
  const wallPanel = new THREE.MeshStandardMaterial({ color: 0x859da8, roughness: .5, metalness: .18 });
  box(room, [18, 3.8, .16], [0, 1.9, -6.45], wall, .015);
  box(room, [.16, 3.8, 12.9], [-8.95, 1.9, 0], wall, .015);
  box(room, [17.9, .13, .065], [0, .12, -6.33], m.aluminum, .008);
  box(room, [.065, .13, 12.7], [-8.84, .12, 0], m.aluminum, .008);
  for (let x = -8; x < 9; x += 2.2) box(room, [.012, 3.7, .017], [x, 1.9, -6.353], wallPanel, 0);
  for (let i = 0; i < 3; i++) {
    const x = -.8 + i * 2.65;
    box(room, [2.4, 1.72, .1], [x, 2.42, -6.31], m.aluminum, .018);
    box(room, [2.27, 1.57, .025], [x, 2.42, -6.248], new THREE.MeshStandardMaterial({ color: 0xc0d9e1, emissive: 0x6d9db5, emissiveIntensity: .22, roughness: .35 }), .004);
    box(room, [.055, 1.6, .065], [x, 2.42, -6.218], m.aluminum, .005);
    box(room, [2.3, .045, .065], [x, 2.47, -6.218], m.aluminum, .005);
    for (let row = 0; row < 5; row++) box(room, [2.28, .035, .02], [x, 3.09 - row * .1, -6.198], wallPanel, .003);
  }
  for (let i = 0; i < 4; i++) {
    const x = -.9 + i * 1.43;
    box(room, [1.4, .95, 1], [x, .55, -5.67], m.cabinet);
    box(room, [1.43, .06, 1.06], [x, 1.06, -5.67], m.black);
    for (const offset of [-.35, .35]) {
      box(room, [.675, .8, .035], [x + offset, .58, -5.148], m.paint, .01);
      box(room, [.024, .19, .04], [x + offset + (offset > 0 ? -.23 : .23), .68, -5.114], m.steel, .01);
    }
    box(room, [.25, .1, .04], [x, 1.3, -6.31], m.paint, .012);
    for (const offset of [-.065, .065]) for (const hole of [-.015, .015]) box(room, [.008, .027, .003], [x + offset + hole, 1.3, -6.287], m.black, 0);
  }
  box(room, [8.4, .09, .07], [1.4, 1.47, -6.31], m.paint);
  cable(room, [[5.7, 1.42, -6.24], [5.8, 1.25, -6.2], [5.9, .6, -6.05], [5.6, .2, -5.7]], .017, m.black);
  for (const z of [-4.5, -.5, 3.5]) {
    box(room, [.08, 1.4, 2.65], [-8.82, 2.3, z], m.paint);
    box(room, [.02, 1.24, 2.48], [-8.765, 2.3, z], wallPanel, .005);
    box(room, [.05, 1.24, .035], [-8.74, 2.3, z], m.aluminum, .004);
  }
  const marking = new THREE.MeshStandardMaterial({ color: 0xb7c8c8, roughness: .8 });
  for (const x of [-6.7, 7.6]) box(room, [.045, .003, 10.8], [x, .006, -.2], marking, 0);
  for (const z of [-4.7, 4.7]) box(room, [14.3, .003, .045], [.45, .006, z], marking, 0);
  for (const [x, z] of [[-5, -1.35], [4, -1.35], [-5, 1.35], [6, 1.35]]) {
    for (const sign of [-1, 1]) {
      box(room, [.24, .004, .035], [x + sign * .47, .008, z + .4], m.yellow, 0);
      box(room, [.035, .004, .25], [x + sign * .58, .008, z + .29], m.yellow, 0);
    }
  }
  cylinder(room, .115, .55, [-8.65, .53, -5.2], m.red);
  box(room, [.15, .08, .12], [-8.65, .86, -5.2], m.black);
  const duct = cylinder(room, .18, 3, [-5, 3.35, -5.8], m.aluminum); duct.rotation.z = Math.PI / 2;
  consolidate(room); scene.add(room);
}
