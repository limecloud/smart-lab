import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { LabState, LabTask, LabWorkflow } from '../shared/types';

async function state(request: APIRequestContext): Promise<LabState> {
  const response = await request.get('/api/state');
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function prepare(request: APIRequestContext) {
  expect((await request.post('/api/simulation', { data: { paused: true, speed: 4 } })).ok()).toBeTruthy();
  const current = await state(request);
  for (const task of current.tasks) {
    if (['running', 'queued', 'paused'].includes(task.status)) {
      expect((await request.patch(`/api/tasks/${task.id}`, { data: { action: 'cancel' } })).ok()).toBeTruthy();
    }
  }
  for (const device of (await state(request)).devices) {
    if (device.status === 'fault' || device.status === 'offline') {
      expect((await request.patch(`/api/devices/${device.id}`, { data: { status: 'idle' } })).ok()).toBeTruthy();
    }
  }
}

async function createWorkflow(request: APIRequestContext, durationSeconds = 2): Promise<LabWorkflow> {
  const response = await request.post('/api/workflows', { data: {
    name: `验收测量流程 ${Date.now()}`, description: '浏览器验收使用的模拟流程', sampleCount: 3,
    steps: [{ id: 'measure', name: '模拟吸光度检测', action: 'measure', deviceId: 'station-analyzer', durationSeconds }],
  } });
  expect(response.status()).toBe(201);
  return response.json();
}

async function openTask(page: Page, workflowId: string, name: string): Promise<LabTask> {
  await page.getByRole('button', { name: '新建实验', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建实验任务', exact: true });
  await dialog.getByLabel('实验流程', { exact: true }).selectOption(workflowId);
  await dialog.getByLabel('任务名称', { exact: true }).fill(name);
  await dialog.getByLabel('样品数量', { exact: true }).fill('3');
  const response = page.waitForResponse((response) => response.url().endsWith('/api/tasks') && response.request().method() === 'POST' && response.status() === 201);
  await dialog.getByRole('button', { name: '创建并运行', exact: true }).click();
  const task = await (await response).json() as LabTask;
  await expect(page.getByRole('dialog', { name, exact: true })).toBeVisible();
  return task;
}

test.beforeEach(async ({ request, page }) => {
  await prepare(request);
  await page.goto('/');
  await expect(page.getByText('实时连接正常', { exact: true })).toBeVisible();
});

test('三维场景、五个页面和全局仿真控制可用', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByRole('heading', { name: '实验室总览', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '融合孪生', exact: true }).click();
  const canvas = page.getByTestId('lab-scene').locator('canvas');
  await expect(canvas).toBeVisible();
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.width > 0 && !!element.getContext('webgl2'))).toBe(true);
  await page.getByRole('button', { name: '重置三维视角', exact: true }).click();
  await page.getByLabel('仿真运行速度').selectOption('2');
  await expect.poll(async () => (await state(request)).simulation.speed).toBe(2);
  await page.getByRole('button', { name: '继续仿真', exact: true }).click();
  await expect.poll(async () => (await state(request)).simulation.paused).toBe(false);
  await page.getByRole('button', { name: '暂停仿真', exact: true }).click();
  await expect.poll(async () => (await state(request)).simulation.paused).toBe(true);
  for (const name of ['流程编排', '实验任务', '设备管理', '实验数据']) {
    await page.getByRole('navigation', { name: '主要导航' }).getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('写实双模型、设备热点、图层、缩放与GIF预览可用', async ({ page }) => {
  await page.getByRole('button', { name: '写实参考', exact: true }).click();
  const stage = page.getByTestId('lab-scene');
  await expect(stage).toHaveAttribute('data-mode', 'realistic');
  const background = stage.locator('.twin-background');
  await expect(background).toBeVisible();
  expect(await background.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 1000)).toBe(true);
  await expect(stage.locator('.twin-robot')).toHaveCount(2);
  for (const sprite of await stage.locator('.robot-cutout').all()) {
    expect(await sprite.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  }
  await page.getByLabel('写实素材模型', { exact: true }).selectOption('sunburst');
  await expect(stage).toHaveAttribute('data-model', 'sunburst');
  await expect(background).toHaveAttribute('src', '/assets/twin/lab-sunburst.png');
  await stage.getByRole('button', { name: '选择设备 自动分析仪', exact: true }).click();
  await expect(page.locator('.selected-device h3')).toHaveText('自动分析仪');
  await page.getByRole('button', { name: '显示移动轨迹', exact: true }).click();
  await expect(stage.locator('.twin-routes')).toHaveCount(0);
  await page.getByRole('button', { name: '显示移动轨迹', exact: true }).click();
  await expect(stage.locator('.twin-routes')).toHaveCount(1);
  await page.getByRole('button', { name: '显示设备标签', exact: true }).click();
  await expect(stage.locator('.twin-station.labels-hidden')).toHaveCount(4);
  await page.getByRole('button', { name: '放大写实场景', exact: true }).click();
  await expect(stage.locator('.twin-world')).toHaveCSS('transform', /1\.2/);
  await page.getByRole('button', { name: '重置写实视角', exact: true }).click();
  await expect(stage.locator('.twin-world')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await page.getByRole('button', { name: '预览仿真演示 GIF', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '仿真演示 GIF', exact: true });
  await expect(dialog).toContainText('非实时');
  await expect(dialog.locator('img')).toBeVisible();
  expect(await dialog.locator('img').evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth === 1120)).toBe(true);
  const downloaded = page.waitForEvent('download');
  await dialog.getByRole('link', { name: '下载 GIF', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe('lab-simulation.gif');
  await dialog.getByRole('button', { name: '关闭 GIF 预览', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('三维主体加载写实材质，保留轨道操作并实际执行机器人移动', async ({ page, request }) => {
  const stage = page.getByTestId('lab-scene');
  await expect(stage).toHaveAttribute('data-mode', 'fused');
  await expect(stage).toHaveAttribute('data-generation', 'physical-v2');
  await expect(stage).toHaveAttribute('data-robot-asset', 'panda-glb', { timeout: 25_000 });
  await expect(stage).toHaveAttribute('data-hdr', 'ready');
  await expect.poll(async () => Number(await stage.getAttribute('data-textures'))).toBeGreaterThanOrEqual(5);
  const beforeCamera = await stage.getAttribute('data-camera');
  const canvas = stage.locator('canvas');
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width * .5, box!.y + box!.height * .5);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * .65, box!.y + box!.height * .55, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => await stage.getAttribute('data-camera')).not.toBe(beforeCamera);
  await page.getByLabel('写实素材模型', { exact: true }).selectOption('sunburst');
  await expect(stage).toHaveAttribute('data-model', 'sunburst');
  await expect.poll(async () => Number(await stage.getAttribute('data-textures'))).toBeGreaterThanOrEqual(5);
  const before = (await state(request)).devices.filter((device) => device.kind === 'robot').map((device) => [...device.position]);
  await page.getByRole('button', { name: '启动协同演示', exact: true }).click();
  await expect.poll(async () => (await state(request)).tasks.filter((task) => ['running', 'queued'].includes(task.status)).length).toBeGreaterThanOrEqual(1);
  await expect.poll(async () => (await state(request)).devices.filter((device) => device.kind === 'robot').some((device, index) => Math.hypot(device.position[0] - before[index][0], device.position[1] - before[index][1]) > .1)).toBe(true);
  await expect(page.locator('.twin-active-strip')).toContainText('当前执行');
});

test('三维设备近景、放大工作区和自由相机保留交互', async ({ page }) => {
  const stage = page.getByTestId('lab-scene');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(stage).toHaveAttribute('data-robot-asset', 'panda-glb', { timeout: 25_000 });
  const before = await stage.boundingBox();
  await page.getByRole('button', { name: '放大三维工作区', exact: true }).click();
  await expect(page.locator('.twin-experience')).toHaveClass(/is-expanded/);
  await expect.poll(async () => (await stage.boundingBox())!.height).toBeGreaterThan(before!.height);
  await page.getByRole('button', { name: '机器人近景', exact: true }).click();
  await expect(stage).toHaveAttribute('data-view', 'robot');
  await page.getByRole('button', { name: '分析工位', exact: true }).click();
  await expect(stage).toHaveAttribute('data-view', 'analyzer');
  await expect.poll(async () => Number((await stage.getAttribute('data-camera'))!.split(',')[0])).toBeGreaterThan(7);
  const camera = await stage.getAttribute('data-camera');
  const rect = await stage.locator('canvas').boundingBox();
  await page.mouse.move(rect!.x + rect!.width * .5, rect!.y + rect!.height * .5);
  await page.mouse.wheel(0, -200);
  await expect.poll(async () => stage.getAttribute('data-camera')).not.toBe(camera);
  await page.keyboard.press('Escape');
  await expect(page.locator('.twin-experience')).not.toHaveClass(/is-expanded/);
  expect(errors).toEqual([]);
});

test('设备模型加载失败可重试恢复精细模型', async ({ page }) => {
  await page.route('**/assets/physical/panda-arm.glb', (route) => route.abort('failed'));
  await page.reload();
  const stage = page.getByTestId('lab-scene');
  await expect(stage).toHaveAttribute('data-robot-asset', 'fallback');
  await expect(page.getByRole('status')).toContainText('设备模型加载失败');
  await page.unroute('**/assets/physical/panda-arm.glb');
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(stage).toHaveAttribute('data-robot-asset', 'panda-glb', { timeout: 25_000 });
  await expect(page.locator('.scene-asset-notice')).toHaveCount(0);
});

test('电脑正背近景可自由操作，屏幕随实际任务和暂停状态更新', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const stage = page.getByTestId('lab-scene');
  const screen = async () => JSON.parse((await stage.getAttribute('data-screens')) ?? '[]').find((item: { deviceId: string }) => item.deviceId === 'station-analyzer');
  await expect.poll(async () => (await screen())?.status).toBe('idle');
  const workflow = await createWorkflow(request, 120);
  const response = await request.post('/api/tasks', { data: { workflowId: workflow.id, name: '电脑屏幕同步验收', sampleCount: 3 } });
  expect(response.status()).toBe(201);
  const task = await response.json() as LabTask;
  await request.post('/api/simulation', { data: { paused: false, speed: 4 } });
  await expect.poll(async () => (await screen())?.taskId).toBe(task.id);
  await expect.poll(async () => (await screen())?.progress).toBeGreaterThan(0);
  expect((await screen()).step).toBe('模拟吸光度检测');
  await page.getByRole('button', { name: '放大三维工作区', exact: true }).click();
  for (const [name, view] of [['电脑工位', 'computer'], ['电脑背部', 'computer-back']]) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(stage).toHaveAttribute('data-view', view);
  }
  await expect.poll(async () => Number((await stage.getAttribute('data-camera'))!.split(',')[2])).toBeLessThan(-4.5);
  const camera = await stage.getAttribute('data-camera');
  const rect = (await stage.locator('canvas').boundingBox())!;
  await page.mouse.move(rect.x + rect.width * .5, rect.y + rect.height * .5);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * .6, rect.y + rect.height * .55, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => stage.getAttribute('data-camera')).not.toBe(camera);
  await request.patch(`/api/tasks/${task.id}`, { data: { action: 'pause' } });
  await expect.poll(async () => (await screen())?.taskStatus).toBe('paused');
  await request.post('/api/simulation', { data: { paused: true } });
  await expect.poll(async () => (await screen())?.paused).toBe(true);
  expect(errors).toEqual([]);
});

test('编辑流程、运行实验、归档结果并导出CSV', async ({ page, request }) => {
  await page.getByRole('button', { name: '流程编排', exact: true }).click();
  await page.getByRole('button', { name: '新建流程', exact: true }).click();
  const workflowName = `界面编排验收 ${Date.now()}`;
  await page.getByLabel('流程名称', { exact: true }).fill(workflowName);
  await page.getByLabel('默认样品数', { exact: true }).fill('3');
  await page.getByLabel('流程说明', { exact: true }).fill('从编辑到测量结果的浏览器验收');
  await page.getByLabel('步骤 1 执行动作', { exact: true }).selectOption('measure');
  await page.getByLabel('步骤 1 名称', { exact: true }).fill('验收吸光度检测');
  await page.getByLabel('步骤 1 时长', { exact: true }).fill('2');
  await page.getByRole('button', { name: '添加执行步骤', exact: true }).click();
  await expect(page.getByLabel('步骤 2 名称', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '上移步骤 2', exact: true }).click();
  await expect(page.getByLabel('步骤 2 名称', { exact: true })).toHaveValue('验收吸光度检测');
  await page.getByRole('button', { name: '删除步骤 1', exact: true }).click();
  const savedResponse = page.waitForResponse((response) => response.url().endsWith('/api/workflows') && response.request().method() === 'POST' && response.status() === 201);
  await page.getByRole('button', { name: '保存流程', exact: true }).click();
  const saved = await (await savedResponse).json() as LabWorkflow;
  expect(saved.steps).toHaveLength(1);
  expect(saved.steps[0].action).toBe('measure');
  await expect(page.getByRole('status')).toContainText('实验流程已保存');
  const name = `完整实验验收 ${Date.now()}`;
  const task = await openTask(page, saved.id, name);
  await page.getByRole('dialog', { name, exact: true }).getByRole('button', { name: '关闭对话框', exact: true }).click();
  await page.getByRole('button', { name: '实验总览', exact: true }).click();
  await page.getByRole('button', { name: '继续仿真', exact: true }).click();
  await expect.poll(async () => (await state(request)).tasks.find((item) => item.id === task.id)?.status).toBe('completed');
  await page.getByRole('button', { name: '实验数据', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(3);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: '导出 CSV', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('.csv');
  const csv = await (await request.get('/api/results/export.csv')).text();
  expect(csv).toContain(task.id);
  expect(csv).toContain('仿真数据（非实测）');
});

test('运行中任务可暂停、继续和取消', async ({ page, request }) => {
  const workflow = await createWorkflow(request, 120);
  await page.reload();
  await expect(page.getByText('实时连接正常', { exact: true })).toBeVisible();
  await request.post('/api/simulation', { data: { paused: false, speed: 1 } });
  const name = `任务控制验收 ${Date.now()}`;
  const task = await openTask(page, workflow.id, name);
  const dialog = page.getByRole('dialog', { name, exact: true });
  await expect.poll(async () => (await state(request)).tasks.find((item) => item.id === task.id)?.status).toBe('running');
  await dialog.getByRole('button', { name: `暂停任务 ${name}`, exact: true }).click();
  await expect.poll(async () => (await state(request)).tasks.find((item) => item.id === task.id)?.status).toBe('paused');
  const progress = (await state(request)).tasks.find((item) => item.id === task.id)!.progress;
  await page.waitForTimeout(700);
  expect((await state(request)).tasks.find((item) => item.id === task.id)!.progress).toBe(progress);
  await dialog.getByRole('button', { name: `继续任务 ${name}`, exact: true }).click();
  await expect.poll(async () => (await state(request)).tasks.find((item) => item.id === task.id)?.status).toBe('running');
  await dialog.getByRole('button', { name: `取消任务 ${name}`, exact: true }).click();
  await expect.poll(async () => (await state(request)).tasks.find((item) => item.id === task.id)?.status).toBe('cancelled');
  await expect(dialog.getByRole('button', { name: `重试任务 ${name}`, exact: true })).toHaveCount(0);
});

test('设备故障导致任务失败，修复后可重试完成', async ({ page, request }) => {
  const workflow = await createWorkflow(request);
  await page.reload();
  await expect(page.getByText('实时连接正常', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '设备管理', exact: true }).click();
  const select = page.getByLabel('设备状态 自动分析仪', { exact: true });
  await select.selectOption('fault');
  await expect.poll(async () => (await state(request)).devices.find((item) => item.id === 'station-analyzer')?.status).toBe('fault');
  const name = `故障恢复验收 ${Date.now()}`;
  const task = await openTask(page, workflow.id, name);
  await request.post('/api/simulation', { data: { paused: false, speed: 4 } });
  await expect.poll(async () => (await state(request)).tasks.find((item) => item.id === task.id)?.status).toBe('failed');
  let dialog = page.getByRole('dialog', { name, exact: true });
  await expect(dialog).toContainText('执行失败');
  await dialog.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await select.selectOption('idle');
  await expect.poll(async () => (await state(request)).devices.find((item) => item.id === 'station-analyzer')?.status).toBe('idle');
  await page.getByRole('button', { name: '实验任务', exact: true }).click();
  await page.getByRole('button', { name: `查看任务 ${name}`, exact: true }).click();
  dialog = page.getByRole('dialog', { name, exact: true });
  await dialog.getByRole('button', { name: `重试任务 ${name}`, exact: true }).click();
  await expect.poll(async () => (await state(request)).tasks.find((item) => item.id === task.id)?.status).toBe('completed');
  await expect(dialog.locator('.task-detail-progress .progress-row')).toContainText('100%');
});

test('占用中的设备不能切离线，界面显示真实拒绝原因', async ({ page, request }) => {
  const workflow = await createWorkflow(request, 120);
  await page.reload();
  await expect(page.getByText('实时连接正常', { exact: true })).toBeVisible();
  await request.post('/api/simulation', { data: { paused: false, speed: 1 } });
  const name = `设备互锁验收 ${Date.now()}`;
  const task = await openTask(page, workflow.id, name);
  await expect.poll(async () => (await state(request)).tasks.find((item) => item.id === task.id)?.status).toBe('running');
  await page.getByRole('dialog', { name, exact: true }).getByRole('button', { name: '关闭对话框', exact: true }).click();
  await page.getByRole('button', { name: '设备管理', exact: true }).click();
  await page.getByLabel('设备状态 自动分析仪', { exact: true }).selectOption('offline');
  await expect(page.getByRole('alert')).toContainText('设备正在执行任务');
  expect((await state(request)).devices.find((item) => item.id === 'station-analyzer')?.status).toBe('busy');
});

test('窄屏能访问导航并查看数据', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '电脑工位', exact: true }).click();
  await expect(page.getByTestId('lab-scene')).toHaveAttribute('data-view', 'computer');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByRole('button', { name: '实验数据', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '实验数据', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '导出 CSV', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
