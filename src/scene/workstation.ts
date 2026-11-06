import * as THREE from 'three';
import { box, cable, cylinder, type Point } from './geometry';
import type { Materials } from './models';
import type { LabDevice, LabTask } from '../../shared/types';

export interface WorkstationDisplay {
  update: (device: LabDevice, tasks: LabTask[], paused: boolean) => void;
  snapshot: { deviceId: string; status: string; taskId: string; taskStatus: string; progress: number; step: string; paused: boolean };
}

function canvasTexture(canvas: HTMLCanvasElement) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  return texture;
}

/** 单面标识；文字不会被复制到侧面或背壳。 */
function decal(parent: THREE.Object3D, text: string, width: number, height: number, position: Point, background = '#dce1df', foreground = '#314047') {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = background; ctx.fillRect(0, 0, 1024, 256);
  ctx.fillStyle = foreground; ctx.font = '500 76px monospace'; ctx.textBaseline = 'middle'; ctx.fillText(text, 35, 128, 954);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map: canvasTexture(canvas), roughness: .75 }));
  mesh.position.set(...position); parent.add(mesh); return mesh;
}

function screw(parent: THREE.Object3D, m: Materials, position: Point) {
  cylinder(parent, .0038, .002, position, m.steel).rotation.x = Math.PI / 2;
  box(parent, [.004, .0008, .001], [position[0], position[1], position[2] - .0015], m.rubber, 0);
}

function port(parent: THREE.Object3D, m: Materials, x: number, y: number, z: number, width: number, height: number, reverse = false) {
  const face = new THREE.Group(); face.position.set(x, y, z); if (reverse) face.rotation.y = Math.PI; parent.add(face);
  box(face, [width + .002, height + .002, .003], [0, 0, 0], m.aluminum, .001);
  box(face, [width, height, .001], [0, 0, .002], m.rubber, .0005);
  box(face, [width * .74, height * .23, .001], [0, -.001, .003], m.blue, 0);
}

function keyboard(parent: THREE.Object3D, m: Materials) {
  const group = new THREE.Group(); group.position.set(-.055, .007, .22); parent.add(group);
  box(group, [.448, .015, .149], [0, .007, 0], m.rubber, .006);
  box(group, [.442, .008, .143], [0, .017, 0], m.black, .004);
  for (const x of [-.19, .19]) for (const z of [-.052, .052]) cylinder(group, .008, .004, [x, -.002, z], m.rubber);
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#32383c'; ctx.fillRect(0, 0, 1024, 512);
  const legends = new THREE.MeshStandardMaterial({ map: canvasTexture(canvas), roughness: .64, metalness: .02 });
  const caps = new THREE.MeshStandardMaterial({ color: 0x32383c, roughness: .62 });
  let index = 0;
  const key = (text: string, x: number, z: number, units = 1, rows = 1) => {
    const width = units * .0185 - .002, depth = rows * .0185 - .002;
    box(group, [width, .009, depth], [x + units * .0185 / 2, .026, z], caps, .0018);
    const col = index % 16, row = Math.floor(index / 16); index++;
    ctx.fillStyle = '#e3e7e7'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `${text.length > 2 ? 15 : 24}px sans-serif`;
    ctx.fillText(text, col * 64 + 32, row * 64 + 33, 58);
    const geometry = new THREE.PlaneGeometry(width * .83, depth * .8);
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (col + uv.getX(i)) / 16, 1 - (row + 1 - uv.getY(i)) / 8);
    const legend = new THREE.Mesh(geometry, legends); legend.rotation.x = -Math.PI / 2;
    legend.position.set(x + units * .0185 / 2, .0306, z); group.add(legend);
  };
  const row = (z: number, entries: (string | [string, number])[]) => {
    let x = -.216;
    for (const entry of entries) { const [text, width] = typeof entry === 'string' ? [entry, 1] : entry; key(text, x, z, width); x += width * .0185; }
  };
  row(-.036, ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', ['Backspace', 2]]);
  row(-.0175, [['Tab', 1.5], 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', ['\\', 1.5]]);
  row(.001, [['Caps', 1.75], 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", ['Enter', 2.25]]);
  row(.0195, [['Shift', 2.25], 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', ['Shift', 2.75]]);
  row(.038, [['Ctrl', 1.25], ['Win', 1.25], ['Alt', 1.25], [' ', 6.25], ['Alt', 1.25], ['Fn', 1.25], ['Menu', 1.25], ['Ctrl', 1.25]]);
  key('Esc', -.216, -.061);
  for (let i = 0; i < 12; i++) key(`F${i + 1}`, -.181 + i * .0185 + Math.floor(i / 4) * .007, -.061);
  for (const [r, names] of [['Ins', 'Home', 'PgUp'], ['Del', 'End', 'PgDn']].entries()) names.forEach((name, col) => key(name, .074 + col * .0185, -.036 + r * .0185));
  key('↑', .0925, .0195); ['←', '↓', '→'].forEach((name, col) => key(name, .074 + col * .0185, .038));
  const numberRows = [['Num', '/', '*', '-'], ['7', '8', '9', '+'], ['4', '5', '6'], ['1', '2', '3', 'Ent']];
  numberRows.forEach((names, r) => names.forEach((name, col) => key(name, .139 + col * .0185, -.036 + r * .0185)));
  key('0', .139, .038, 2); key('.', .176, .038); key('', .1945, .038);
  for (let i = 0; i < 3; i++) box(group, [.003, .001, .002], [.153 + i * .017, .022, -.062], i ? m.rubber : m.teal, 0);
  legends.map!.needsUpdate = true;
  cable(parent, [[-.06, .018, .146], [-.07, .012, .08], [-.2, .01, -.02], [-.29, .012, -.26]], .0021, m.rubber);
}

function mouse(parent: THREE.Object3D, m: Materials) {
  box(parent, [.145, .0025, .185], [.283, .003, .217], m.rubber, .008);
  const group = new THREE.Group(); group.position.set(.275, .005, .218); group.rotation.y = -.12; parent.add(group);
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), m.black);
  body.scale.set(.029, .021, .052); body.position.y = .019; body.castShadow = true; group.add(body);
  for (const x of [-.0125, .0125]) {
    const button = box(group, [.023, .007, .039], [x, .035, -.019], m.black, .006); button.rotation.x = -.16;
  }
  box(group, [.0012, .002, .034], [0, .040, -.024], m.rubber, 0);
  cylinder(group, .007, .007, [0, .039, -.02], m.rubber).rotation.z = Math.PI / 2;
  for (let i = 0; i < 5; i++) box(group, [.0065, .0007, .0008], [0, .045, -.024 + i * .002], m.aluminum, 0);
  cable(parent, [[.281, .025, .167], [.31, .013, .08], [.33, .012, -.11], [.22, .012, -.24], [-.29, .012, -.26]], .002, m.rubber);
}

function computer(parent: THREE.Object3D, m: Materials, underDesk: boolean) {
  const pc = new THREE.Group(); pc.position.set(underDesk ? .32 : .36, underDesk ? -.385 : .005, underDesk ? -.07 : -.21); parent.add(pc);
  const height = underDesk ? .34 : .23, width = underDesk ? .135 : .105, depth = .235;
  box(pc, [width, height, depth], [0, height / 2, 0], m.black, .008);
  box(pc, [width - .009, height - .012, .006], [0, height / 2, depth / 2 + .002], m.rubber, .004);
  cylinder(pc, .009, .003, [0, height - .03, .124], m.aluminum).rotation.x = Math.PI / 2;
  cylinder(pc, .002, .004, [.023, height - .03, .125], m.teal).rotation.x = Math.PI / 2;
  for (let i = 0; i < 2; i++) port(pc, m, -.023 + i * .032, height - .065, .124, .014, .006);
  for (let i = 0; i < 10; i++) box(pc, [width * .72, .003, .002], [0, .025 + i * .011, .123], m.black, .0005);
  decal(pc, 'LAB / IPC-02', width * .8, .018, [0, height - .095, .125]);
  box(pc, [width * .84, height * .74, .002], [0, height / 2, -.119], m.aluminum, .002);
  for (let i = 0; i < 7; i++) box(pc, [width * .6, .003, .003], [0, height - .035 - i * .009, -.121], m.rubber, .0005);
  for (let i = 0; i < 4; i++) port(pc, m, -.023 + i % 2 * .041, .053 + Math.floor(i / 2) * .025, -.124, .014, .007, true);
  port(pc, m, 0, .025, -.124, .016, .012, true);
  for (const x of [-width * .35, width * .35]) for (const z of [-.08, .08]) cylinder(pc, .009, .006, [x, -.002, z], m.rubber);
  if (underDesk) {
    box(parent, [.19, .025, .28], [.32, -.405, -.07], m.aluminum, .006);
    for (const x of [.245, .395]) box(parent, [.017, .39, .03], [x, -.21, -.16], m.aluminum, .003);
  }
  const data: Point = [pc.position.x - .023, pc.position.y + .053, pc.position.z - .13];
  const power: Point = [pc.position.x, pc.position.y + .025, pc.position.z - .13];
  box(parent, [.015, .009, .019], data, m.rubber, .002);
  box(parent, [.017, .014, .02], power, m.rubber, .003);
  cable(parent, underDesk ? [[-.29, .014, -.26], [-.29, -.11, -.27], [.15, -.14, -.31], data] : [[-.29, .014, -.26], [-.18, .012, -.38], [.1, .012, -.38], data], .003, m.rubber);
  cable(parent, underDesk ? [power, [.25, -.23, -.32], [.05, -.24, -.34], [-.15, -.067, -.30]] : [power, [.25, .016, -.40], [.05, .016, -.46], [-.15, .035, -.46]], .004, m.rubber);
}

function display(parent: THREE.Object3D, m: Materials, deviceId: string): WorkstationDisplay {
  const monitor = new THREE.Group(); monitor.position.set(0, .37, -.17); parent.add(monitor);
  // 24 英寸、16:9 面板；后壳、边框、发光层各自独立。
  box(monitor, [.558, .338, .024], [0, 0, -.003], m.rubber, .009);
  box(monitor, [.493, .286, .027], [0, -.002, -.024], m.black, .018);
  box(monitor, [.535, .304, .002], [0, .006, .010], m.black, .001);
  const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
  const ctx = canvas.getContext('2d')!;
  const texture = canvasTexture(canvas);
  const surface = new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: 0xffffff, emissiveIntensity: .32, roughness: .31, metalness: 0 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(.528, .297), surface);
  screen.position.set(0, .006, .0115); monitor.add(screen);
  decal(monitor, 'L I M E   /   L A B', .07, .006, [0, -.157, .010], '#1d2325', '#aeb5b6');
  cylinder(monitor, .0016, .002, [.252, -.157, .011], m.teal).rotation.x = Math.PI / 2;
  for (let i = 0; i < 23; i++) box(monitor, [.012, .0025, .002], [-.207 + i * .018, .115, -.038], m.rubber, .0005);
  box(monitor, [.115, .116, .009], [0, -.016, -.042], m.aluminum, .004);
  for (const x of [-.05, .05]) for (const y of [-.066, .034]) screw(monitor, m, [x, y, -.048]);
  for (const x of [-.235, .235]) for (const y of [-.124, .123]) screw(monitor, m, [x, y, -.034]);
  cylinder(monitor, .019, .12, [0, -.046, -.055], m.black).rotation.z = Math.PI / 2;
  box(parent, [.048, .25, .034], [0, .166, -.23], m.aluminum, .007);
  box(parent, [.038, .06, .035], [0, .294, -.23], m.black, .005);
  box(parent, [.028, .038, .008], [0, .12, -.251], m.rubber, .009);
  box(parent, [.234, .012, .167], [0, .012, -.155], m.black, .01);
  box(parent, [.223, .004, .156], [0, .020, -.155], m.aluminum, .009);
  for (const x of [-.09, .09]) for (const z of [-.21, -.10]) cylinder(parent, .008, .004, [x, .004, z], m.rubber);
  port(monitor, m, -.12, -.103, -.039, .018, .008, true);
  port(monitor, m, -.155, -.103, -.039, .015, .007, true);
  box(monitor, [.019, .013, .017], [-.12, -.103, -.05], m.rubber, .003);
  box(monitor, [.016, .011, .017], [-.155, -.103, -.05], m.rubber, .002);
  decal(monitor, 'DISPLAY 24  |  SN L240031', .143, .025, [.123, -.06, -.039]).rotation.y = Math.PI;
  decal(monitor, 'DP   HDMI   DC', .092, .009, [-.13, -.127, -.039]).rotation.y = Math.PI;
  cable(parent, [[-.12, .267, -.225], [-.14, .23, -.25], [-.03, .13, -.267], [-.02, .07, -.265], [-.29, .014, -.26]], .003, m.rubber);
  cable(parent, [[-.155, .267, -.225], [-.145, .235, -.26], [-.012, .16, -.269], [-.009, .07, -.269], [-.29, .014, -.26]], .0025, m.rubber);
  const snapshot = { deviceId, status: '', taskId: '', taskStatus: '', progress: 0, step: '', paused: false };
  let previous = '';
  const statusNames: Record<string, string> = { idle: '就绪', busy: '执行中', offline: '离线', fault: '故障', queued: '排队', running: '运行', paused: '暂停', completed: '完成', failed: '失败', cancelled: '取消' };
  return { snapshot, update(device, tasks, paused) {
    const relevant = tasks.filter((task) => task.steps.some((step) => step.deviceId === deviceId || step.stationId === deviceId));
    const task = relevant.find((item) => item.id === device.activeTaskId) ?? relevant.find((item) => ['running', 'paused', 'queued'].includes(item.status));
    const step = task?.steps[task.currentStepIndex];
    Object.assign(snapshot, { status: device.status, taskId: task?.id ?? '', taskStatus: task?.status ?? '', progress: Math.round((task?.progress ?? 0) * 100), step: step?.name ?? '', paused });
    const key = JSON.stringify([snapshot, relevant.slice(0, 4).map((item) => [item.id, item.name, item.status, Math.round(item.progress * 100)])]);
    if (key === previous) return; previous = key;
    ctx.fillStyle = '#111c25'; ctx.fillRect(0, 0, 1280, 720);
    ctx.fillStyle = '#1b2c37'; ctx.fillRect(0, 0, 1280, 60); ctx.fillRect(0, 60, 195, 660);
    const text = (value: string, x: number, y: number, size = 22, color = '#b6c9d1') => { ctx.font = `500 ${size}px system-ui, sans-serif`; ctx.fillStyle = color; ctx.fillText(value, x, y); };
    text('LIME / LAB', 26, 40, 27, '#e2eded'); text(device.name, 228, 40, 22, '#e2eded');
    text('SIMULATION', 1060, 39, 18, '#80b7b4');
    ['设备总览', '实验任务', '执行记录', '设备设置'].forEach((name, i) => { if (!i) { ctx.fillStyle = '#24404b'; ctx.fillRect(12, 95, 172, 49); } text(name, 32, 128 + i * 64, 21); });
    text(deviceId.toUpperCase(), 230, 106, 18, '#7e9eac'); text('工作站运行监视', 230, 155, 32, '#e1ebee');
    const cells = [['设备状态', statusNames[device.status]], ['样品数量', String(task?.sampleCount ?? 0)], ['任务进度', `${snapshot.progress}%`], ['仿真时钟', paused ? '已暂停' : '运行中']];
    cells.forEach(([name, value], i) => { const x = 230 + i * 250; ctx.fillStyle = '#1c303b'; ctx.fillRect(x, 184, 230, 108); text(name, x + 18, 214, 18, '#8aa7b4'); text(value, x + 18, 264, 31, '#a9e1d1'); });
    text(task ? task.name.slice(0, 32) : '当前没有待执行任务', 230, 342, 26, '#e1ebee');
    text(step ? `当前步骤  ${step.name.slice(0, 36)}` : '等待任务下发 · 设备状态与控制台同步', 230, 386, 21);
    ctx.fillStyle = '#2b414b'; ctx.fillRect(230, 411, 980, 8); ctx.fillStyle = '#4bb99f'; ctx.fillRect(230, 411, 980 * snapshot.progress / 100, 8);
    text('最近任务', 230, 468, 23, '#e1ebee');
    relevant.slice(0, 4).forEach((item, i) => {
      const y = 512 + i * 39; text(item.name.slice(0, 27), 230, y, 20); text(statusNames[item.status], 1005, y, 19, '#95cabc'); text(`${Math.round(item.progress * 100)}%`, 1140, y, 19);
    });
    if (!relevant.length) text('暂无记录', 230, 516, 20, '#7995a3');
    text('仿真设备 / 非实测数据', 230, 696, 16, '#6d8c9b'); text('A-01  /  LOCAL WORKSTATION', 902, 696, 16, '#6d8c9b');
    texture.needsUpdate = true;
  } };
}

/** 两个工位共享同一套尺寸、外设和真实状态绘制。坐标原点位于台面。 */
export function buildWorkstation(parent: THREE.Object3D, m: Materials, position: Point, deviceId: string, ownDesk: boolean) {
  const group = new THREE.Group(); group.position.set(...position); parent.add(group);
  if (ownDesk) {
    box(group, [1.0, .043, .87], [0, -.0215, .02], m.paint, .012);
    box(group, [.97, .012, .84], [0, -.049, .02], m.rubber, .004);
    for (const x of [-.438, .438]) for (const z of [-.32, .36]) {
      box(group, [.036, 1.037, .036], [x, -.575, z], m.aluminum, .004);
      cylinder(group, .027, .035, [x, -1.113, z], m.rubber);
    }
    for (const z of [-.32, .36]) box(group, [.89, .055, .025], [0, -.12, z], m.aluminum, .003);
    for (const x of [-.438, .438]) box(group, [.025, .035, .69], [x, -.93, .02], m.aluminum, .003);
    decal(group, 'ANALYSIS / WS-02', .22, .021, [-.22, -.024, .456]);
  }
  // 穿线孔、桌下线槽和排插都有线缆端点，避免悬浮电线。
  cylinder(group, .025, .004, [-.29, .002, -.26], m.rubber);
  cylinder(group, .019, .005, [-.29, .002, -.26], m.black);
  const powerY = ownDesk ? -.087 : .015, powerZ = ownDesk ? -.30 : -.46;
  if (ownDesk) box(group, [.55, .035, .095], [-.08, -.12, powerZ], m.aluminum, .004);
  box(group, [.31, .027, .055], [-.08, powerY, powerZ], m.paint, .006);
  for (let i = 0; i < 4; i++) {
    const x = -.18 + i * .066;
    for (const dx of [-.008, .008]) box(group, [.003, .001, .008], [x + dx, powerY + .014, powerZ], m.rubber, .0005);
  }
  box(group, [.018, .018, .022], [-.15, powerY + .02, powerZ], m.rubber, .003);
  if (ownDesk) {
    cable(group, [[-.29, .005, -.26], [-.295, -.06, -.26], [-.28, -.11, -.30], [-.15, -.067, -.30]], .003, m.rubber);
    cable(group, [[-.23, -.084, -.30], [-.39, -.12, -.34], [-.43, -.5, -.33], [-.43, -1.09, -.34], [-.22, -1.11, -.48], [.566, -1.075, -.49]], .0045, m.rubber);
  }
  const surfaces = { ...m, black: new THREE.MeshStandardMaterial({ color: 0x252b2e, roughness: .53, metalness: .03 }) };
  keyboard(group, surfaces); mouse(group, surfaces); computer(group, surfaces, ownDesk);
  return display(group, surfaces, deviceId);
}
