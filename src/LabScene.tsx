import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildRobot, buildStation, createMaterials, box } from './scene/models';
import { buildEnvironment } from './scene/environment';
import type { LabDevice, LabTask } from '../shared/types';
import type { TwinModel } from './twinProjection';
import type { WorkstationDisplay } from './scene/workstation';

export type SceneView = 'overview' | 'robot' | 'analyzer' | 'computer' | 'computer-back';

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
  view?: SceneView;
}

interface DeviceModel {
  group: THREE.Group;
  ring: THREE.Mesh;
  light: THREE.Mesh;
  arm?: THREE.Group;
  wheels?: THREE.Group[];
  joints?: THREE.Object3D[];
  fingers?: THREE.Object3D[];
  displays?: WorkstationDisplay[];
  label: THREE.Sprite;
  history: THREE.Vector3[];
  historyLine?: THREE.Line;
  targetLine?: THREE.Line;
}

function label(text: string) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 80;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#142b37dd'; ctx.beginPath(); ctx.roundRect(0, 0, 512, 80, 12); ctx.fill();
  ctx.strokeStyle = '#86b8bc88'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#d8ebec'; ctx.font = '500 30px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 40);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true }));
  sprite.scale.set(1.8, .28, 1); return sprite;
}

export default function LabScene({ devices, selectedId, onSelect, resetToken, paused, model = 'flare', routes = true, labels = true, tasks = [], view = 'overview' }: Props) {
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
  const changeView = useRef<(view: string) => void>(() => {});
  const latestView = useRef(view); latestView.current = view;
  const [error, setError] = useState('');
  const [assetState, setAssetState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [reloadToken, setReloadToken] = useState(0);
  latestDevices.current = devices;
  latestSelected.current = selectedId;
  latestPaused.current = paused;
  latestRoutes.current = routes;
  latestLabels.current = labels;
  latestTasks.current = tasks;
  select.current = onSelect;

  useEffect(() => { resetView.current(); }, [resetToken]);
  useEffect(() => { changeView.current(view); }, [view]);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let alive = true;
    setError('');
    setAssetState('loading');
    Object.assign(container.dataset, { textures: '0', hdr: 'loading', robotAsset: 'loading' });
    delete container.dataset.assetError;
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
    renderer.toneMappingExposure = 1.12;
    container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', '交互式三维实验室，拖动旋转，滚轮缩放，点击设备查看详情');
    const environment = new THREE.PMREMGenerator(renderer);
    const environmentRoom = new RoomEnvironment();
    const environmentMap = environment.fromScene(environmentRoom, 0.04);
    environmentRoom.dispose();
    const scene = new THREE.Scene();
    scene.environment = environmentMap.texture;
    scene.background = new THREE.Color(0x526973);
    scene.fog = new THREE.Fog(0x526973, 38, 75);
    scene.environmentIntensity = .75;
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(12, 9.5, 15);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.maxPolarAngle = Math.PI * 0.46;
    controls.minDistance = .7;
    controls.maxDistance = 42;
    let cameraTarget: { eye: THREE.Vector3; target: THREE.Vector3 } | undefined;
    changeView.current = (name) => {
      const robot = latestDevices.current.find((device) => device.id === latestSelected.current && device.kind === 'robot') ?? latestDevices.current[0];
      if (name === 'robot') {
        const origin = new THREE.Vector3(robot.position[0], 0, robot.position[1]);
        const target = origin.clone().add(new THREE.Vector3(0, 1.15, 0));
        const candidates = [[-2.6, -3.2], [2.6, -3.2], [-2.6, 3.2], [2.6, 3.2]];
        const probe = new THREE.Raycaster();
        const obstacles: THREE.Mesh[] = [];
        for (const [id, entry] of models.current) if (id !== robot.id) entry.group.traverse((object) => {
          if (object instanceof THREE.Mesh && !Array.isArray(object.material) && !object.material.transparent) obstacles.push(object);
        });
        const eyes = candidates.map(([x, z]) => origin.clone().add(new THREE.Vector3(x, 2.2, z)));
        const eye = eyes.find((candidate) => {
          const direction = candidate.clone().sub(target); probe.set(target, direction.clone().normalize()); probe.far = direction.length();
          return probe.intersectObjects(obstacles, false).length === 0;
        }) ?? eyes[0];
        cameraTarget = { eye, target };
      } else if (name === 'analyzer') cameraTarget = { eye: new THREE.Vector3(7.5, 2.8, 1.8), target: new THREE.Vector3(3.65, 1.45, -3) };
      else if (name === 'computer') cameraTarget = { eye: new THREE.Vector3(1.4, 1.95, -1.1), target: new THREE.Vector3(2.02, 1.39, -2.9) };
      else if (name === 'computer-back') cameraTarget = { eye: new THREE.Vector3(1.05, 1.87, -4.7), target: new THREE.Vector3(2.02, 1.4, -2.99) };
      else cameraTarget = { eye: new THREE.Vector3(12, 9.5, 15), target: new THREE.Vector3(0, 1, 0) };
      container.dataset.view = name;
    };
    controls.addEventListener('start', () => { cameraTarget = undefined; });
    resetView.current = () => {
      cameraTarget = undefined;
      camera.position.set(12, 9.5, 15);
      controls.target.set(0, 1, 0);
      controls.update();
    };
    scene.add(new THREE.HemisphereLight(0xe5f4ff, 0x546168, .4));
    const sun = new THREE.DirectionalLight(0xfff1dc, 3.1);
    sun.position.set(-3, 11, 4); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 10, bottom: -10, near: .5, far: 35 });
    sun.shadow.bias = -.0003; sun.shadow.normalBias = .025; sun.shadow.radius = 4;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xc8e7ff, .65); fill.position.set(9, 7, -4); scene.add(fill);
    const loader = new THREE.TextureLoader();
    let loadedTextures = 0;
    const loaded = () => { loadedTextures++; container.dataset.textures = String(loadedTextures); };
    const textures = new Set<THREE.Texture>();
    const texture = (path: string, color = true, repeat?: [number, number]) => {
      const value = loader.load(path, (map) => { if (!alive) { map.dispose(); return; } loaded(); }, undefined, () => { container.dataset.assetError = path; });
      value.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      value.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      if (repeat) { value.wrapS = value.wrapT = THREE.RepeatWrapping; value.repeat.set(...repeat); }
      textures.add(value); return value;
    };
    const m = createMaterials();
    buildEnvironment(scene, m, texture);
    let photographicEnvironment: THREE.WebGLRenderTarget | undefined;
    new RGBELoader().load('/assets/physical/studio_small_09-hdri.hdr', (hdr) => {
      if (!alive) { hdr.dispose(); return; }
      photographicEnvironment = environment.fromEquirectangular(hdr); hdr.dispose();
      scene.environment = photographicEnvironment.texture; container.dataset.hdr = 'ready';
    }, undefined, () => { container.dataset.hdr = 'fallback'; });
    const surfaces = new Map<string, THREE.MeshStandardMaterial>();
    for (const name of ['hood', 'analyzer', 'storage', 'robot-front']) surfaces.set(name, new THREE.MeshStandardMaterial({ map: texture(`/assets/twin/textures/${model}-${name}.jpg`), roughness: .48, metalness: .12 }));
    const renderTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(renderer, renderTarget);
    composer.addPass(new RenderPass(scene, camera));
    const ao = new GTAOPass(scene, camera, 1, 1);
    ao.updateGtaoMaterial({ radius: .32, thickness: .6, distanceExponent: 1.5, samples: 8 });
    ao.blendIntensity = .65; composer.addPass(ao); composer.addPass(new OutputPass());

    for (const device of latestDevices.current) {
      const group = new THREE.Group();
      group.position.set(device.position[0], 0, device.position[1]);
      group.userData.deviceId = device.id;
      let arm: THREE.Group | undefined;
      let wheels: THREE.Group[] | undefined;
      let displays: WorkstationDisplay[] | undefined;
      if (device.kind === 'robot') {
        const rig = buildRobot(group, m, device.id); arm = rig.arm; wheels = rig.wheels;
        box(group, [.21, .11, .006], [.28, .73, .445], surfaces.get('robot-front')!, .004);
      } else displays = buildStation(group, m, device.id, surfaces.get(device.id === 'station-hood' ? 'hood' : device.id === 'station-storage' ? 'storage' : 'analyzer')!);
      const ring = new THREE.Mesh(new THREE.RingGeometry(device.kind === 'robot' ? 0.86 : 1.65, device.kind === 'robot' ? 0.91 : 1.71, 64), new THREE.MeshBasicMaterial({ color: 0x2eaa9d, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.025;
      group.add(ring);
      const statusLight = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshBasicMaterial({ color: 0x2eaa9d }));
      statusLight.position.set(device.kind === 'robot' ? 0.48 : 0.9, device.kind === 'robot' ? 0.9 : 1.4, device.kind === 'robot' ? 0.47 : 0.72);
      group.add(statusLight);
      const sprite = label(device.kind === 'robot' ? device.id.toUpperCase().replace('ROBOT', 'AMR') : device.name);
      sprite.position.set(0, device.kind === 'robot' ? 2.25 : 3.1, 0);
      group.add(sprite);
      const modelEntry: DeviceModel = { group, ring, light: statusLight, arm, wheels, displays, label: sprite, history: [] };
      if (device.kind === 'robot') {
        const color = device.id === 'robot-01' ? 0x16b492 : 0x438bd3;
        const historyLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 }));
        const targetLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color, dashSize: 0.22, gapSize: 0.13, transparent: true, opacity: 0.75 }));
        scene.add(historyLine, targetLine); modelEntry.historyLine = historyLine; modelEntry.targetLine = targetLine;
      }
      models.current.set(device.id, modelEntry);
      scene.add(group);
    }

    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load('/assets/physical/panda-arm.glb', (gltf) => {
      if (!alive) { gltf.scene.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); }); return; }
      for (const entry of models.current.values()) {
        if (!entry.arm) continue;
        const placeholder = entry.arm.getObjectByName('loading-arm');
        placeholder?.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
        placeholder?.removeFromParent();
        const armModel = cloneSkeleton(gltf.scene);
        armModel.rotation.x = -Math.PI / 2;
        armModel.scale.setScalar(1.18); entry.arm.add(armModel);
        entry.joints = Array.from({ length: 7 }, (_, index) => armModel.getObjectByName(`joint${index + 1}`)!);
        entry.fingers = ['finger_joint1', 'finger_joint2'].map((name) => armModel.getObjectByName(name)!);
        armModel.traverse((object) => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; } });
      }
      container.dataset.robotAsset = 'panda-glb';
      setAssetState('ready');
    }, undefined, () => { if (!alive) return; container.dataset.robotAsset = 'fallback'; setAssetState('failed'); });
    changeView.current(latestView.current);

    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      composer.setSize(width, height);
      ao.enabled = width > 500;
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
    let frame = 0;
    let disposed = false;
    const animate = () => {
      if (disposed) return;
      frame = requestAnimationFrame(animate);
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
        const labelDistance = model.label.getWorldPosition(new THREE.Vector3()).distanceTo(camera.position);
        model.label.visible = latestLabels.current && latestView.current === 'overview' && labelDistance > 6;
        const labelScale = Math.min(1, labelDistance / 20);
        model.label.scale.set(1.8 * labelScale, .28 * labelScale, 1);
        const task = latestTasks.current.find((item) => item.id === device.activeTaskId);
        const step = task?.steps[task.currentStepIndex];
        model.displays?.forEach((display) => display.update(device, latestTasks.current, latestPaused.current));
        if (model.wheels && !latestPaused.current) {
          const speed = Math.min(.2, Math.hypot(dx, dz) * .3);
          model.wheels.forEach((wheel) => { wheel.rotation.x += speed; });
        }
        if (model.joints && model.fingers) {
          const working = device.status === 'busy' && (step?.action === 'pick' || step?.action === 'place');
          const phase = working ? Math.sin((step?.progress ?? 0) * Math.PI) : 0;
          const pose = [0, -.48 + phase * .28, 0, -2.05 + phase * .34, 0, 1.65 - phase * .3, .78];
          model.joints.forEach((joint, index) => { joint.rotation.z = pose[index]; });
          model.fingers.forEach((finger) => { finger.position.y = .025 - phase * .019; });
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
      if (cameraTarget) {
        camera.position.lerp(cameraTarget.eye, .09); controls.target.lerp(cameraTarget.target, .09);
        if (camera.position.distanceTo(cameraTarget.eye) < .01) cameraTarget = undefined;
      }
      controls.update();
      container.dataset.camera = camera.position.toArray().map((value) => value.toFixed(2)).join(',');
      const screens = JSON.stringify([...models.current.values()].flatMap((entry) => entry.displays?.map((display) => display.snapshot) ?? []));
      if (container.dataset.screens !== screens) container.dataset.screens = screens;
      composer.render();
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
      composer.passes.forEach((pass) => pass.dispose()); composer.dispose();
      textures.forEach((value) => value.dispose());
      photographicEnvironment?.dispose();
      renderer.dispose();
      environmentMap.dispose(); environment.dispose();
      renderer.domElement.remove();
    };
  }, [model, reloadToken]);

  return <div ref={host} className="lab-canvas" data-testid="lab-scene" data-mode="fused" data-model={model} data-generation="physical-v2">{error ? <div className="webgl-fallback"><span>3D 视图暂不可用</span><p>{error}</p></div> : assetState !== 'ready' && <div className="scene-asset-notice" role="status">{assetState === 'loading' ? '正在加载精细设备模型…' : <><span>设备模型加载失败，暂时显示简化模型</span><button onClick={() => setReloadToken((token) => token + 1)}>重新加载</button></>}</div>}</div>;
}
