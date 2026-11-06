import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type Point = [number, number, number];
type Surface = THREE.Material;
export function createMaterials() {
  return {
    paint: new THREE.MeshPhysicalMaterial({ color: 0xd7dedf, roughness: .34, metalness: .16, clearcoat: .35, clearcoatRoughness: .32 }),
    cabinet: new THREE.MeshStandardMaterial({ color: 0xbac6c9, roughness: .48, metalness: .22 }),
    blue: new THREE.MeshPhysicalMaterial({ color: 0x426d7e, roughness: .3, metalness: .12, clearcoat: .45 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8b9aa5, roughness: .27, metalness: .88 }),
    aluminum: new THREE.MeshStandardMaterial({ color: 0xb1bdc5, roughness: .42, metalness: .78 }),
    black: new THREE.MeshStandardMaterial({ color: 0x202a31, roughness: .37, metalness: .32 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1d2226, roughness: .82, metalness: .02 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xb8d6d8, roughness: .08, metalness: .05, transparent: true, opacity: .18, depthWrite: false, side: THREE.DoubleSide }),
    teal: new THREE.MeshStandardMaterial({ color: 0x239d98, roughness: .32, metalness: .35 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xe2ad35, roughness: .42, metalness: .12 }),
    red: new THREE.MeshStandardMaterial({ color: 0xc74634, roughness: .4, metalness: .05 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x142e3c, roughness: .24, metalness: .15, emissive: 0x145477, emissiveIntensity: .3 }),
  };
}
export type Materials = ReturnType<typeof createMaterials>;

export function box(parent: THREE.Object3D, size: Point, position: Point, surface: Surface, radius = .025) {
  const geometry = radius > 0 ? new RoundedBoxGeometry(...size, 2, Math.min(radius, ...size.map((v) => v / 2.1))) : new THREE.BoxGeometry(...size);
  const mesh = new THREE.Mesh(geometry, surface);
  mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
  return mesh;
}
export function cylinder(parent: THREE.Object3D, radius: number, height: number, position: Point, surface: Surface, lowerRadius = radius) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, lowerRadius, height, 24), surface);
  mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
export function cable(parent: THREE.Object3D, points: Point[], radius: number, surface: Surface) {
  const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, radius, 6, false), surface);
  mesh.castShadow = true; parent.add(mesh); return mesh;
}
function graphic(text: string, background = '#182f3b', foreground = '#94d8de') {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = background; ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = foreground; ctx.font = '500 32px sans-serif'; ctx.fillText(text, 26, 52);
  ctx.globalAlpha = .55;
  for (let i = 0; i < 5; i++) ctx.fillRect(28, 84 + i * 25, i % 2 ? 220 : 340, 7);
  ctx.globalAlpha = 1; ctx.fillStyle = '#40bea7'; ctx.fillRect(390, 172, 88, 48);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: 0xffffff, emissiveIntensity: .2, roughness: .28 });
}
function plaque(parent: THREE.Object3D, text: string, width: number, height: number, position: Point) {
  return box(parent, [width, height, .006], position, graphic(text, '#d1dadd', '#294b5d'), .002);
}
function monitor(parent: THREE.Object3D, m: Materials, x: number, y: number, z: number, title = 'SAMPLE ANALYSIS') {
  box(parent, [.52, .035, .35], [x, y - .43, z], m.black);
  box(parent, [.045, .33, .045], [x, y - .25, z], m.aluminum);
  box(parent, [.65, .43, .055], [x, y, z], m.black, .025);
  box(parent, [.585, .355, .008], [x, y, z + .031], graphic(title), .006);
  cylinder(parent, .009, .008, [x + .26, y - .18, z + .036], m.teal).rotation.x = Math.PI / 2;
}
function vent(parent: THREE.Object3D, m: Materials, x: number, y: number, z: number, count = 9, width = .025, reverse = false) {
  const panel = new THREE.Group(); panel.position.set(x, y, z); if (reverse) panel.rotation.y = Math.PI; parent.add(panel);
  box(panel, [count * .047 + .05, .18, .012], [0, 0, 0], m.black, .008);
  for (let i = 0; i < count; i++) box(panel, [width, .135, .017], [(i - (count - 1) / 2) * .047, 0, .01], m.cabinet, .004);
}
function bolts(parent: THREE.Object3D, m: Materials, corners: Point[], radius = .014) {
  for (const point of corners) {
    const bolt = cylinder(parent, radius, .008, point, m.steel); bolt.rotation.x = Math.PI / 2;
    box(parent, [radius * 1.1, .003, .002], [point[0], point[1], point[2] + .006], m.black, 0);
  }
}
function rack(parent: THREE.Object3D, m: Materials, x: number, y: number, z: number, rows = 3, columns = 6) {
  box(parent, [columns * .11 + .08, .07, rows * .115 + .08], [x, y, z], m.blue, .015);
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const tx = x + (col - (columns - 1) / 2) * .11, tz = z + (row - (rows - 1) / 2) * .115;
    cylinder(parent, .031, .18, [tx, y + .105, tz], m.glass);
    cylinder(parent, .034, .075, [tx, y + .06, tz], row % 2 ? m.teal : m.yellow);
    cylinder(parent, .035, .027, [tx, y + .21, tz], col % 3 ? m.red : m.blue);
  }
}
function drawer(parent: THREE.Object3D, m: Materials, x: number, y: number, z: number, width: number, height = .26) {
  box(parent, [width, height, .04], [x, y, z], m.paint, .012);
  box(parent, [width * .48, .025, .055], [x, y + height * .22, z + .035], m.steel, .01);
}

/** 同材质的静态零件合并，保留关节、轮子与透明材料的独立层级。 */
export function consolidate(group: THREE.Group) {
  group.updateMatrixWorld(true);
  const inverse = group.matrixWorld.clone().invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const remove: THREE.Mesh[] = [];
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    let current: THREE.Object3D | null = object;
    while (current && current !== group) { if (current.userData.dynamic) return; current = current.parent; }
    const geometry = object.geometry.clone().applyMatrix4(inverse.clone().multiply(object.matrixWorld));
    const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
    if (nonIndexed !== geometry) geometry.dispose();
    const list = buckets.get(object.material) ?? []; list.push(nonIndexed); buckets.set(object.material, list); remove.push(object);
  });
  for (const mesh of remove) { mesh.removeFromParent(); mesh.geometry.dispose(); }
  for (const [surface, geometries] of buckets) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries), surface); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
    geometries.forEach((geometry) => geometry.dispose());
  }
}

export function buildRobot(group: THREE.Group, m: Materials, id: string) {
  box(group, [1.16, .16, .94], [0, .22, 0], m.rubber, .08);
  box(group, [1.18, .055, .97], [0, .33, 0], m.yellow, .07);
  box(group, [1.08, .52, .88], [0, .61, 0], m.paint, .085);
  box(group, [1.13, .045, .94], [0, .89, 0], m.aluminum, .045);
  box(group, [1.01, .012, .81], [0, .92, 0], m.steel, .03);
  const wheels: THREE.Group[] = [];
  for (const x of [-.5, .5]) for (const z of [-.29, .29]) {
    const wheel = new THREE.Group(); wheel.userData.dynamic = true; wheel.position.set(x, .17, z);
    const tire = cylinder(wheel, .15, .095, [0, 0, 0], m.rubber); tire.rotation.z = Math.PI / 2;
    const rim = cylinder(wheel, .095, .102, [0, 0, 0], m.aluminum); rim.rotation.z = Math.PI / 2;
    for (let i = 0; i < 6; i++) {
      const spoke = box(wheel, [.106, .022, .14], [0, 0, 0], m.black, .005); spoke.rotation.x = i * Math.PI / 3;
    }
    group.add(wheel); wheels.push(wheel);
  }
  vent(group, m, 0, .55, -.447, 10, .025, true);
  vent(group, m, -.22, .54, .447, 6);
  box(group, [.3, .105, .012], [.27, .59, .453], m.black, .015);
  box(group, [.24, .015, .017], [.27, .59, .462], m.teal, .007);
  cylinder(group, .095, .065, [0, .27, .48], m.black).rotation.x = Math.PI / 2;
  cylinder(group, .071, .068, [0, .27, .48], m.screen).rotation.x = Math.PI / 2;
  box(group, [.17, .11, .012], [-.36, .75, .442], graphic(id.toUpperCase()), .007);
  bolts(group, m, [[-.43, .79, .443], [.43, .79, .443], [-.43, .43, .443], [.43, .43, .443]]);
  cylinder(group, .056, .035, [-.43, .95, -.29], m.yellow);
  cylinder(group, .042, .04, [-.43, .98, -.29], m.red);
  for (const x of [-.45, .45]) for (const z of [-.34, .34]) cylinder(group, .015, .009, [x, .932, z], m.black);
  box(group, [.49, .025, .4], [-.25, .95, .12], m.black, .015);
  rack(group, m, -.25, .99, .12, 2, 3);
  cable(group, [[.31, .93, -.14], [.46, 1.03, -.22], [.5, 1.16, -.25], [.35, 1.25, -.2]], .017, m.black);
  const arm = new THREE.Group(); arm.position.set(.24, .94, -.17); arm.userData.dynamic = true; group.add(arm);
  cylinder(arm, .115, .08, [0, .04, 0], m.steel);
  const fallback = new THREE.Group(); fallback.name = 'loading-arm';
  cylinder(fallback, .075, .45, [0, .3, 0], m.paint);
  box(fallback, [.15, .36, .15], [.1, .6, 0], m.paint, .06); arm.add(fallback);
  consolidate(group);
  return { arm, wheels };
}

export function buildStation(group: THREE.Group, m: Materials, id: string, detail: THREE.Material) {
  if (id === 'station-prep') {
    box(group, [3.1, .09, 1.34], [0, 1.09, 0], m.blue, .035);
    box(group, [3.04, .04, 1.28], [0, 1.025, 0], m.black);
    for (const x of [-1.36, 1.36]) for (const z of [-.48, .48]) {
      box(group, [.07, .97, .07], [x, .51, z], m.aluminum);
      cylinder(group, .052, .035, [x, .035, z], m.black);
    }
    box(group, [.9, .85, 1.12], [.95, .55, -.01], m.cabinet);
    for (let i = 0; i < 3; i++) drawer(group, m, .95, .3 + i * .25, .57, .85, .22);
    for (let i = 0; i < 3; i++) box(group, [.79, .045, .45], [-1.07, 1.19 + i * .33, -.34], m.paint);
    for (const x of [-1.43, -.71]) box(group, [.033, 1, .033], [x, 1.61, -.55], m.steel);
    rack(group, m, -.3, 1.17, .17);
    rack(group, m, -1.07, 1.23, -.34, 2, 5);
    monitor(group, m, .9, 1.57, -.24, 'SAMPLE PREPARATION');
    box(group, [.4, .04, .25], [.9, 1.17, .35], m.black);
    plaque(group, 'PREPARATION / A01', .6, .09, [-.9, 1.06, .678]);
  } else if (id === 'station-analyzer') {
    box(group, [2.8, 1.06, 1.5], [0, .66, 0], m.cabinet, .035);
    box(group, [2.87, .09, 1.57], [0, 1.23, 0], m.black);
    for (const x of [-1.18, 1.18]) for (const z of [-.52, .52]) cylinder(group, .07, .12, [x, .08, z], m.black);
    for (const x of [-.93, 0, .93]) {
      drawer(group, m, x, .44, .765, .88, .54);
      vent(group, m, x, .94, .767, 10);
    }
    // 仪器为有真实开口、导轨、样品槽与玻璃门的三维结构。
    box(group, [2.73, .09, 1.46], [0, 2.57, 0], m.paint);
    box(group, [2.64, 1.25, .065], [0, 1.9, -.7], m.paint);
    for (const x of [-1.31, 1.31]) box(group, [.11, 1.3, 1.45], [x, 1.92, 0], m.paint);
    box(group, [2.5, .025, 1.23], [0, 1.3, 0], m.steel);
    for (const x of [-.92, -.24, .44]) rack(group, m, x, 1.36, .19, 3, 4);
    for (const x of [-1.05, 1.05]) box(group, [.035, .045, 1.12], [x, 1.47, -.05], m.aluminum);
    for (const z of [-.48, .28]) box(group, [2.15, .045, .055], [0, 2.2, z], m.steel);
    box(group, [.34, .31, .4], [.25, 2.09, -.08], m.paint);
    for (let i = 0; i < 6; i++) cylinder(group, .011, .3, [.1 + i * .06, 1.8, -.04], m.steel);
    cable(group, [[.3, 2.24, -.1], [.8, 2.34, -.42], [1.1, 2.2, -.57], [1.16, 1.65, -.58]], .018, m.black);
    box(group, [.46, .32, .015], [.87, 1.74, -.658], detail, .005);
    box(group, [2.47, 1.12, .018], [0, 1.91, .722], m.glass, .006);
    box(group, [.022, 1.1, .035], [.22, 1.92, .735], m.aluminum, .004);
    box(group, [.032, .37, .055], [.32, 1.89, .757], m.black, .012);
    box(group, [2.3, .024, .033], [0, 2.48, -.1], new THREE.MeshStandardMaterial({ color: 0xe8faff, emissive: 0xb6e9ff, emissiveIntensity: 1.5 }), .006);
    plaque(group, 'AUTOMATED ANALYSIS / A03', 1.1, .105, [-.5, 2.575, .738]);
    bolts(group, m, [[-1.31, 2.4, .735], [1.31, 2.4, .735], [-1.31, 1.4, .735], [1.31, 1.4, .735]]);
    monitor(group, m, -1.8, 1.65, .2);
    box(group, [.58, .035, .4], [-1.8, 1.23, .25], m.steel);
  } else if (id === 'station-hood') {
    box(group, [2.8, .95, 1.4], [0, .62, 0], m.cabinet);
    box(group, [2.88, .09, 1.47], [0, 1.15, 0], m.black);
    for (const x of [-1.3, 1.3]) box(group, [.14, 1.55, 1.36], [x, 1.94, 0], m.paint);
    box(group, [2.73, .35, 1.4], [0, 2.67, 0], m.paint);
    box(group, [2.5, 1.35, .06], [0, 1.89, -.64], m.paint);
    for (let i = 0; i < 11; i++) box(group, [.17, .08, .015], [-1.05 + i * .21, 2.21, -.6], m.black, .004);
    box(group, [2.45, .66, .018], [0, 2.12, .65], m.glass, .004);
    box(group, [2.47, .035, .055], [0, 1.79, .68], m.aluminum);
    box(group, [.49, .1, .02], [-.7, 2.66, .714], detail, .006);
    for (const x of [-.69, .69]) drawer(group, m, x, .58, .718, 1.31, .8);
    rack(group, m, -.22, 1.24, .1);
    for (let i = 0; i < 3; i++) {
      cylinder(group, .085, .3, [-.94 + i * .25, 1.35, -.36], m.glass);
      cylinder(group, .039, .06, [-.94 + i * .25, 1.53, -.36], m.blue);
    }
    for (const x of [.64, .9]) {
      cylinder(group, .035, .3, [x, 1.31, -.4], m.steel);
      cable(group, [[x, 1.44, -.4], [x, 1.55, -.4], [x, 1.55, -.22], [x, 1.47, -.2]], .025, m.steel);
    }
    plaque(group, 'VENTILATED WORKSTATION', 1.18, .1, [.23, 2.68, .714]);
  } else {
    box(group, [2.1, 2.35, 1.2], [0, 1.28, 0], m.cabinet, .035);
    box(group, [2.13, .1, 1.24], [0, 2.5, 0], m.paint);
    for (let i = 0; i < 4; i++) drawer(group, m, 0, .42 + i * .43, .626, 1.99, .39);
    box(group, [1.94, .38, .035], [0, 2.23, .63], m.black);
    box(group, [1.87, .31, .013], [0, 2.23, .654], m.glass);
    for (let i = 0; i < 10; i++) cylinder(group, .035, .2, [-.73 + i * .16, 2.22, .49], i % 2 ? m.teal : m.yellow);
    box(group, [.2, .11, .015], [.72, 1.95, .65], graphic('08 °C'), .008);
    vent(group, m, 0, .17, .623, 18);
    plaque(group, 'SAMPLE ARCHIVE / A04', 1.1, .1, [0, 2.5, .63]);
  }
  consolidate(group);
}
