import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { LabDevice, LabTask } from '../shared/types';
import type { TwinModel } from './twinProjection';

interface Props {
  devices: LabDevice[];
  selectedId: string;
  onSelect: (id: string) => void;
  resetToken: number;
  paused: boolean;
  model?: TwinModel;
  routes?: boolean;
  labels?: boolean;
  tasks?: LabTask[];
}

interface DeviceModel {
  group: THREE.Group;
  ring: THREE.Mesh;
  light: THREE.Mesh;
  arm?: THREE.Group;
  label: THREE.Sprite;
  history: THREE.Vector3[];
  historyLine?: THREE.Line;
  targetLine?: THREE.Line;
}

const C = { white: 0xf7f9fa, edge: 0xc8d4d7, metal: 0x9caaaf, dark: 0x33454d, blue: 0xb4e3f0, teal: 0x18a789, green: 0x54bd8d, yellow: 0xecc663 };

function material(color: number, roughness = 0.55, metalness = 0.08) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function box(parent: THREE.Object3D, size: [number, number, number], pos: [number, number, number], color: number, roughness = 0.55) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material(color, roughness));
  mesh.position.set(...pos);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function cylinder(parent: THREE.Object3D, radius: number, height: number, pos: [number, number, number], color: number, radiusBottom = radius) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radiusBottom, height, 20), material(color));
  mesh.position.set(...pos);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function tubeRack(parent: THREE.Object3D, x: number, y: number, z: number, rows = 3, columns = 6) {
  box(parent, [columns * 0.125 + 0.08, 0.07, rows * 0.14 + 0.08], [x, y, z], 0xe1ebed);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const tx = x + (col - (columns - 1) / 2) * 0.125;
      const tz = z + (row - (rows - 1) / 2) * 0.14;
      cylinder(parent, 0.033, 0.21, [tx, y + 0.13, tz], 0xc8e6eb);
      cylinder(parent, 0.041, 0.035, [tx, y + 0.25, tz], 0xdf7068);
    }
  }
}

function label(text: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(255,255,255,.94)';
  ctx.beginPath();
  ctx.roundRect(1, 1, 510, 94, 20);
  ctx.fill();
  ctx.strokeStyle = '#d1dedb';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#344e48';
  ctx.font = '600 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 48);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.scale.set(2.5, 0.47, 1);
  sprite.renderOrder = 20;
  return sprite;
}

function monitor(parent: THREE.Object3D, x: number, y: number, z: number, pedestal = false) {
  if (pedestal) {
    box(parent, [0.42, 0.05, 0.4], [x, 0.03, z], C.metal);
    box(parent, [0.09, y - 0.25, 0.09], [x, (y - 0.25) / 2, z], C.metal);
  }
  box(parent, [0.53, 0.38, 0.07], [x, y, z], C.white);
  box(parent, [0.45, 0.3, 0.012], [x, y, z + 0.042], 0xd9f1ea);
  box(parent, [0.13, 0.15, 0.014], [x - 0.11, y + 0.03, z + 0.051], 0x37ad8d);
  for (let i = 0; i < 3; i++) box(parent, [0.15, 0.018, 0.014], [x + 0.1, y + 0.08 - i * 0.06, z + 0.051], 0x7c9d95);
}

function joint(parent: THREE.Object3D, radius: number, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 14), material(C.white));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function segment(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, radius: number) {
  const delta = b.clone().sub(a);
  const mesh = cylinder(parent, radius, delta.length(), [0, 0, 0], C.white);
  mesh.position.copy(a.clone().add(b).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  return mesh;
}

function robot(parent: THREE.Group) {
  box(parent, [1.17, 0.18, 0.96], [0, 0.22, 0], C.edge);
  box(parent, [1.14, 0.055, 0.95], [0, 0.34, 0], C.yellow);
  box(parent, [1.1, 0.57, 0.91], [0, 0.66, 0], C.white);
  box(parent, [1.15, 0.065, 0.97], [0, 0.97, 0], C.edge);
  box(parent, [0.45, 0.025, 0.39], [-0.25, 1.02, 0.08], C.dark);
  tubeRack(parent, -0.25, 1.06, 0.08, 2, 3);
  for (let i = 0; i < 8; i++) box(parent, [0.027, 0.13, 0.015], [(i - 3.5) * 0.06, 0.58, 0.463], C.metal);
  box(parent, [0.24, 0.04, 0.025], [0, 0.26, 0.49], C.teal);
  for (const x of [-0.47, 0.47]) for (const z of [-0.35, 0.35]) {
    const wheel = cylinder(parent, 0.14, 0.11, [x, 0.15, z], C.dark);
    wheel.rotation.z = Math.PI / 2;
  }
  const arm = new THREE.Group();
  arm.position.set(0.25, 1.01, -0.12);
  parent.add(arm);
  cylinder(arm, 0.19, 0.08, [0, 0.04, 0], C.metal);
  cylinder(arm, 0.11, 0.28, [0, 0.22, 0], C.white);
  const shoulder = new THREE.Group(); shoulder.position.y = 0.36; shoulder.rotation.z = 0.25; arm.add(shoulder);
  joint(shoulder, 0.12, 0, 0, 0); cylinder(shoulder, 0.075, 0.58, [0, 0.3, 0], C.white);
  const elbow = new THREE.Group(); elbow.position.y = 0.6; elbow.rotation.z = 1.3; shoulder.add(elbow);
  joint(elbow, 0.105, 0, 0, 0); cylinder(elbow, 0.062, 0.52, [0, 0.26, 0], C.white);
  const wrist = new THREE.Group(); wrist.position.y = 0.53; wrist.rotation.z = 1.2; elbow.add(wrist);
  joint(wrist, 0.078, 0, 0, 0); cylinder(wrist, 0.042, 0.2, [0, 0.1, 0], C.white);
  box(wrist, [0.14, 0.08, 0.11], [0, 0.23, 0], C.dark);
  const fingers = [-0.055, 0.055].map((x) => box(wrist, [0.025, 0.12, 0.04], [x, 0.31, 0], C.metal));
  arm.userData.joints = { shoulder, elbow, wrist, fingers };
  return arm;
}

function station(group: THREE.Group, id: string) {
  if (id === 'station-prep') {
    box(group, [3.1, 0.13, 1.3], [0, 1.1, 0], C.blue);
    for (const x of [-1.35, 1.35]) for (const z of [-0.45, 0.45]) box(group, [0.07, 1.05, 0.07], [x, 0.52, z], C.metal);
    box(group, [0.9, 0.92, 1.12], [0.9, 0.56, 0], C.white);
    for (let i = 0; i < 4; i++) {
      box(group, [0.82, 0.012, 0.012], [0.9, 0.3 + i * 0.2, 0.567], C.edge);
      box(group, [0.3, 0.035, 0.035], [0.9, 0.36 + i * 0.2, 0.58], C.metal);
    }
    for (let i = 0; i < 3; i++) box(group, [0.85, 0.055, 0.75], [-1.13, 1.25 + i * 0.39, -0.2], C.blue);
    for (const x of [-1.52, -0.73]) box(group, [0.04, 1.2, 0.04], [x, 1.7, -0.51], C.metal);
    tubeRack(group, -0.25, 1.2, 0.1);
    tubeRack(group, -1.13, 1.29, -0.2, 3, 5);
    for (let i = 0; i < 4; i++) cylinder(group, 0.06, 0.2, [-1.4 + i * 0.18, 1.78, -0.2], 0xbddfe7, 0.09);
    box(group, [0.34, 0.47, 0.35], [0.45, 1.39, -0.16], C.white);
  } else if (id === 'station-hood') {
    box(group, [2.8, 1, 1.4], [0, 0.6, 0], C.white);
    box(group, [2.88, 0.1, 1.47], [0, 1.15, 0], C.dark);
    box(group, [2.75, 0.6, 0.13], [0, 1.48, -0.6], C.edge);
    for (const x of [-1.3, 1.3]) box(group, [0.14, 1.4, 1.36], [x, 1.8, 0], C.white);
    box(group, [2.78, 0.55, 1.4], [0, 2.48, 0], C.white);
    const glass = box(group, [2.42, 0.62, 0.035], [0, 1.94, 0.51], 0xc0e0e8);
    glass.material = new THREE.MeshPhysicalMaterial({ color: 0xb8dce4, transparent: true, opacity: 0.28, roughness: 0.12, side: THREE.DoubleSide });
    box(group, [2.4, 0.025, 0.04], [0, 1.63, 0.53], C.metal);
    box(group, [0.32, 0.055, 0.03], [-0.9, 2.4, 0.72], C.dark);
    tubeRack(group, -0.25, 1.24, 0.07);
    monitor(group, 1.14, 1.43, 0.75);
    for (const x of [-0.68, 0.68]) {
      box(group, [0.018, 0.83, 0.018], [x, 0.61, 0.716], C.edge);
      box(group, [0.05, 0.2, 0.05], [x + 0.1, 0.63, 0.74], C.metal);
    }
  } else if (id === 'station-analyzer') {
    box(group, [2.8, 1.35, 1.5], [0, 0.75, 0], C.white);
    box(group, [2.3, 0.43, 0.08], [0, 1.08, 0.77], C.dark);
    box(group, [2.1, 0.3, 0.05], [0, 1.08, 0.83], 0x8da1a8);
    for (let i = 0; i < 9; i++) box(group, [0.16, 0.2, 0.025], [-0.88 + i * 0.22, 1.05, 0.87], 0xb0bfc2);
    box(group, [2.2, 0.12, 1.05], [0.1, 1.49, -0.1], C.dark);
    box(group, [2.75, 0.1, 0.2], [0, 1.5, 0.65], C.edge);
    box(group, [2.8, 0.12, 1.5], [0, 2.45, 0], C.white);
    for (const x of [-1.34, 1.34]) box(group, [0.12, 1, 1.45], [x, 1.93, 0], C.edge);
    box(group, [2.6, 0.91, 0.06], [0, 1.94, -0.72], C.dark);
    monitor(group, -1.7, 1.6, 0.5, true);
    box(group, [0.5, 0.04, 0.32], [-1.7, 1.31, 0.65], C.white);
  } else {
    box(group, [2.1, 1.4, 1.2], [0, 0.75, 0], C.white);
    box(group, [2.16, 0.12, 1.25], [0, 1.5, 0], C.edge);
    box(group, [2.1, 0.85, 1.2], [0, 1.95, 0], C.white);
    for (let i = 0; i < 3; i++) {
      box(group, [1.83, 0.32, 0.07], [0, 0.39 + i * 0.39, 0.64], 0xd4e0e1);
      box(group, [0.55, 0.035, 0.045], [0, 0.43 + i * 0.39, 0.7], C.metal);
    }
    tubeRack(group, 0.1, 1.61, 0);
    monitor(group, -0.65, 1.85, 0.15);
  }
}

function addBackground(scene: THREE.Scene) {
  const floor = box(scene, [18, 0.1, 13.5], [0, -0.08, 0], 0xdce5e4, 0.3);
  floor.receiveShadow = true;
  const grid = new THREE.GridHelper(18, 36, 0xc6d4d1, 0xd1dcda);
  grid.position.y = -0.02;
  scene.add(grid);
  box(scene, [18, 0.35, 0.15], [0, 0.1, -6.4], 0xc4d2d0);
  box(scene, [0.15, 0.35, 12.7], [-8.9, 0.1, 0], 0xc4d2d0);
  const strip = box(scene, [18, 0.035, 0.08], [0, 0.28, -6.3], 0x8ab5a8);
  strip.castShadow = false;
  for (let i = 0; i < 4; i++) {
    const cabinet = new THREE.Group();
    cabinet.position.set(-1.2 + i * 1.45, 0, -5.1);
    box(cabinet, [1.38, 0.95, 1.1], [0, 0.54, 0], C.white);
    box(cabinet, [1.43, 0.1, 1.18], [0, 1.06, 0], C.dark);
    box(cabinet, [0.025, 0.75, 0.025], [0, 0.55, 0.56], C.edge);
    for (const x of [-0.13, 0.13]) box(cabinet, [0.04, 0.17, 0.04], [x, 0.7, 0.58], C.metal);
    scene.add(cabinet);
  }
  const axis = new THREE.AxesHelper(1.1);
  axis.position.set(-7.7, 0.04, 5.2);
  scene.add(axis);
}

export default function LabScene({ devices, selectedId, onSelect, resetToken, paused, model = 'flare', routes = true, labels = true, tasks = [] }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const models = useRef(new Map<string, DeviceModel>());
  const latestDevices = useRef(devices);
  const latestSelected = useRef(selectedId);
  const latestPaused = useRef(paused);
  const latestRoutes = useRef(routes);
  const latestLabels = useRef(labels);
  const latestTasks = useRef(tasks);
  const select = useRef(onSelect);
  const resetView = useRef<() => void>(() => {});
  const [error, setError] = useState('');
  latestDevices.current = devices;
  latestSelected.current = selectedId;
  latestPaused.current = paused;
  latestRoutes.current = routes;
  latestLabels.current = labels;
  latestTasks.current = tasks;
  select.current = onSelect;

  useEffect(() => { resetView.current(); }, [resetToken]);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let alive = true;
    setError('');
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      setError('当前浏览器无法创建 WebGL 场景。请开启硬件加速或使用支持 WebGL 的浏览器；设备与任务控制仍可正常使用。');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', '交互式三维实验室，拖动旋转，滚轮缩放，点击设备查看详情');
    const environment = new THREE.PMREMGenerator(renderer);
    const environmentRoom = new RoomEnvironment();
    const environmentMap = environment.fromScene(environmentRoom, 0.04);
    environmentRoom.dispose();
    const scene = new THREE.Scene();
    scene.environment = environmentMap.texture;
    scene.background = new THREE.Color(0xe9efed);
    scene.fog = new THREE.Fog(0xe9efed, 35, 65);
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(13, 14, 16);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.4, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.maxPolarAngle = Math.PI * 0.46;
    controls.minDistance = 12;
    controls.maxDistance = 42;
    resetView.current = () => {
      camera.position.set(13, 14, 16);
      controls.target.set(0, 0.4, 0);
      controls.update();
    };
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb0c6c0, 2.5));
    const sun = new THREE.DirectionalLight(0xfff9eb, 3.4);
    sun.position.set(-6, 17, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 12, bottom: -12, near: 0.5, far: 45 });
    sun.shadow.bias = -0.001;
    sun.shadow.normalBias = 0.025;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xd5e8ff, 1.1);
    fill.position.set(10, 8, -7);
    scene.add(fill);
    addBackground(scene);
    const loader = new THREE.TextureLoader();
    let loadedTextures = 0;
    const loadSurface = (group: THREE.Group, filename: string, width: number, height: number, position: [number, number, number], rotateX = 0) => {
      const surfaceMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.58, metalness: 0.08, polygonOffset: true, polygonOffsetFactor: -1 });
      const surface = new THREE.Mesh(new THREE.PlaneGeometry(width, height), surfaceMaterial);
      surface.position.set(...position); surface.rotation.x = rotateX; surface.visible = false; surface.receiveShadow = true; group.add(surface);
      loader.load(`/assets/twin/textures/${model}-${filename}.jpg`, (texture) => {
        if (!alive) { texture.dispose(); return; }
        texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        surfaceMaterial.map = texture; surfaceMaterial.needsUpdate = true; surface.visible = true;
        loadedTextures++; container.dataset.textures = String(loadedTextures);
      }, undefined, () => { /* 纹理缺失时保留可交互的原生几何。 */ });
    };

    for (const device of latestDevices.current) {
      const group = new THREE.Group();
      group.position.set(device.position[0], 0, device.position[1]);
      group.userData.deviceId = device.id;
      let arm: THREE.Group | undefined;
      if (device.kind === 'robot') arm = robot(group);
      else station(group, device.id);
      if (device.kind === 'robot') loadSurface(group, 'robot-front', 0.98, 0.54, [0, 0.66, 0.472]);
      else if (device.id === 'station-hood') loadSurface(group, 'hood', 2.65, 2.5, [0, 1.4, 0.73]);
      else if (device.id === 'station-analyzer') loadSurface(group, 'analyzer', 2.68, 2.28, [0, 1.29, 0.905]);
      else if (device.id === 'station-storage') loadSurface(group, 'storage', 1.98, 2.3, [0, 1.25, 0.725]);
      const ring = new THREE.Mesh(new THREE.RingGeometry(device.kind === 'robot' ? 0.86 : 1.65, device.kind === 'robot' ? 0.91 : 1.71, 64), new THREE.MeshBasicMaterial({ color: C.teal, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.025;
      group.add(ring);
      const statusLight = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshBasicMaterial({ color: C.teal }));
      statusLight.position.set(device.kind === 'robot' ? 0.48 : 0.9, device.kind === 'robot' ? 0.9 : 1.4, device.kind === 'robot' ? 0.47 : 0.72);
      group.add(statusLight);
      const sprite = label(device.kind === 'robot' ? device.id.toUpperCase().replace('ROBOT', 'AMR') : device.name);
      sprite.position.set(0, device.kind === 'robot' ? 2.4 : (device.id === 'station-hood' ? 3.15 : 2.6), 0);
      group.add(sprite);
      const modelEntry: DeviceModel = { group, ring, light: statusLight, arm, label: sprite, history: [] };
      if (device.kind === 'robot') {
        const color = device.id === 'robot-01' ? 0x16b492 : 0x438bd3;
        const historyLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 }));
        const targetLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color, dashSize: 0.22, gapSize: 0.13, transparent: true, opacity: 0.75 }));
        scene.add(historyLine, targetLine); modelEntry.historyLine = historyLine; modelEntry.targetLine = targetLine;
      }
      models.current.set(device.id, modelEntry);
      scene.add(group);
    }

    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    const pointer = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    let start = { x: 0, y: 0 };
    const pointerDown = (event: PointerEvent) => { start = { x: event.clientX, y: event.clientY }; };
    const pointerUp = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects([...models.current.values()].map((model) => model.group), true);
      for (const hit of hits) {
        let obj: THREE.Object3D | null = hit.object;
        while (obj && !obj.userData.deviceId) obj = obj.parent;
        if (obj?.userData.deviceId) { select.current(String(obj.userData.deviceId)); break; }
      }
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    const clock = new THREE.Clock();
    let frame = 0;
    let disposed = false;
    const animate = () => {
      if (disposed) return;
      frame = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      for (const device of latestDevices.current) {
        const model = models.current.get(device.id);
        if (!model) continue;
        const dx = device.position[0] - model.group.position.x;
        const dz = device.position[1] - model.group.position.z;
        model.group.position.x += dx * 0.12;
        model.group.position.z += dz * 0.12;
        if (device.kind === 'robot' && Math.hypot(dx, dz) > 0.025) {
          const heading = Math.atan2(dx, dz);
          const angle = Math.atan2(Math.sin(heading - model.group.rotation.y), Math.cos(heading - model.group.rotation.y));
          model.group.rotation.y += angle * 0.08;
        }
        model.ring.visible = device.id === latestSelected.current;
        const color = device.status === 'busy' ? 0x18a789 : device.status === 'fault' ? 0xe87567 : device.status === 'offline' ? 0x9aabaa : 0x68b68c;
        (model.light.material as THREE.MeshBasicMaterial).color.setHex(color);
        model.label.material.opacity = device.status === 'offline' ? 0.55 : 0.95;
        model.label.visible = latestLabels.current;
        const task = latestTasks.current.find((item) => item.id === device.activeTaskId);
        const step = task?.steps[task.currentStepIndex];
        if (model.arm) {
          const working = device.status === 'busy' && (step?.action === 'pick' || step?.action === 'place');
          const phase = working ? Math.sin((step?.progress ?? 0) * Math.PI) : 0;
          const { shoulder, elbow, wrist, fingers } = model.arm.userData.joints as { shoulder: THREE.Group; elbow: THREE.Group; wrist: THREE.Group; fingers: THREE.Mesh[] };
          shoulder.rotation.z = 0.25 + phase * 0.48; elbow.rotation.z = 1.3 - phase * 0.52; wrist.rotation.z = 1.2 + phase * 0.25;
          fingers.forEach((finger, index) => { finger.position.x = (index ? 1 : -1) * (0.055 - phase * 0.025); });
          model.arm.rotation.y = working && !latestPaused.current ? Math.sin(t * 0.5) * 0.12 : 0;
        }
        if (model.historyLine && model.targetLine) {
          const last = model.history.at(-1);
          const point = new THREE.Vector3(device.position[0], 0.045, device.position[1]);
          if (!last || last.distanceTo(point) > 0.065) {
            model.history.push(point); if (model.history.length > 180) model.history.shift();
            model.historyLine.geometry.dispose(); model.historyLine.geometry = new THREE.BufferGeometry().setFromPoints(model.history);
          }
          model.historyLine.visible = latestRoutes.current;
          const targetDevice = latestDevices.current.find((item) => item.id === step?.stationId);
          model.targetLine.visible = latestRoutes.current && step?.action === 'move' && !!targetDevice;
          if (model.targetLine.visible && targetDevice) {
            const [tx, tz] = targetDevice.position;
            const target = new THREE.Vector3(tx, 0.05, tz < 0 ? tz + 1.65 : tz - 1.65);
            const key = `${point.x.toFixed(2)},${point.z.toFixed(2)},${tx},${tz}`;
            if (model.targetLine.userData.key !== key) {
              model.targetLine.geometry.dispose(); model.targetLine.geometry = new THREE.BufferGeometry().setFromPoints([point, target]); model.targetLine.computeLineDistances(); model.targetLine.userData.key = key;
            }
          }
        }
      }
      controls.update();
      container.dataset.camera = camera.position.toArray().map((value) => value.toFixed(2)).join(',');
      renderer.render(scene, camera);
    };
    animate();
    return () => {
      alive = false;
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Sprite) {
          if ('geometry' in object) object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((mat) => { if ('map' in mat && mat.map instanceof THREE.Texture) mat.map.dispose(); mat.dispose(); });
        }
      });
      models.current.clear();
      renderer.dispose();
      environmentMap.dispose(); environment.dispose();
      renderer.domElement.remove();
    };
  }, [model]);

  return <div ref={host} className="lab-canvas" data-testid="lab-scene" data-mode="fused" data-model={model}>{error && <div className="webgl-fallback"><span>3D 视图暂不可用</span><p>{error}</p></div>}</div>;
}
