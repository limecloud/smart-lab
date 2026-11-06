import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { LabEngine } from '../server/engine.js';
import { createLabServer } from '../server/http.js';

async function setup(options: Parameters<typeof createLabServer>[0] = {}) {
  const app = createLabServer({ engine: new LabEngine({ seedDemo: false }), tickMs: 0, ...options });
  await new Promise<void>((accept) => app.server.listen(0, '127.0.0.1', accept));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const request = (path: string, method = 'GET', body?: unknown, headers?: Record<string, string>) => fetch(base + path, {
    method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { ...app, base, request };
}

test('HTTP任务生命周期、状态与错误状态码', async () => {
  const app = await setup();
  try {
    assert.deepEqual(await (await app.request('/api/health')).json(), { ok: true, mode: 'simulation' });
    const response = await app.request('/api/tasks', 'POST', { workflowId: 'workflow-measurement', sampleCount: 2 });
    assert.equal(response.status, 201);
    const task = await response.json() as { id: string };
    app.engine.tick(1);
    const pause = await app.request(`/api/tasks/${task.id}`, 'PATCH', { action: 'pause' });
    assert.equal(pause.status, 200);
    assert.equal((await pause.json() as { status: string }).status, 'paused');
    assert.equal((await app.request(`/api/tasks/${task.id}`, 'PATCH', { action: 'pause' })).status, 409);
    assert.equal((await app.request('/api/tasks/missing', 'PATCH', { action: 'resume' })).status, 404);
    assert.equal((await app.request('/api/tasks', 'POST', { workflowId: 'workflow-measurement', sampleCount: 0 })).status, 400);
    await app.request(`/api/tasks/${task.id}`, 'PATCH', { action: 'resume' });
    app.engine.tick(20);
    const csv = await app.request('/api/results/export.csv');
    assert.match(csv.headers.get('content-type')!, /text\/csv/);
    assert.match(await csv.text(), /仿真数据（非实测）/);
  } finally { await app.close(); }
});

test('HTTP拒绝跨站写入、无效JSON和超过1MiB请求', async () => {
  const app = await setup();
  try {
    assert.equal((await app.request('/api/simulation', 'POST', { paused: true }, { Origin: 'https://example.invalid' })).status, 403);
    assert.equal((await app.request('/api/simulation', 'POST', { paused: true }, { Origin: app.base })).status, 200);
    const invalid = await fetch(app.base + '/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json() as { error: string }).error, '请求体必须是有效的 JSON 对象');
    const tooLarge = await app.request('/api/tasks', 'POST', { padding: 'x'.repeat(1024 * 1024) });
    assert.equal(tooLarge.status, 413);
    assert.equal((await app.request('/api/unknown')).status, 404);
  } finally { await app.close(); }
});

test('HTTP枚举输入拒绝数组和对象，不污染设备状态', async () => {
  const app = await setup();
  try {
    for (const status of [['offline'], { value: 'offline' }]) {
      const response = await app.request('/api/devices/station-analyzer', 'PATCH', { status });
      assert.equal(response.status, 400);
      assert.match((await response.json() as { error: string }).error, /设备状态/);
    }
    assert.equal(app.engine.getState().devices.find((device) => device.id === 'station-analyzer')!.status, 'idle');
    const task = app.engine.createTask({ workflowId: 'workflow-measurement' });
    for (const action of [['pause'], { value: 'pause' }]) {
      assert.equal((await app.request(`/api/tasks/${task.id}`, 'PATCH', { action })).status, 400);
    }
    assert.equal(app.engine.getState().tasks[0].status, 'queued');
  } finally { await app.close(); }
});

test('SSE立即返回初始状态并推送后续状态变化', async () => {
  const app = await setup();
  const controller = new AbortController();
  try {
    const response = await fetch(app.base + '/api/stream', { signal: controller.signal });
    assert.match(response.headers.get('content-type')!, /text\/event-stream/);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const initial = decoder.decode((await reader.read()).value);
    assert.match(initial, /event: state/);
    assert.match(initial, /"tasks":\[\]/);
    app.engine.createTask({ workflowId: 'workflow-measurement', name: 'SSE推送验证' });
    const update = decoder.decode((await reader.read()).value);
    assert.match(update, /SSE推送验证/);
    controller.abort();
    await reader.cancel().catch(() => {});
  } finally { controller.abort(); await app.close(); }
});

test('原子持久化与HTTP重启恢复未完成任务', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'smart-lab-persistence-'));
  const dataPath = join(directory, 'state.json');
  const app = await setup({ dataPath });
  const task = app.engine.createTask({ workflowId: 'workflow-standard' });
  app.engine.tick(2);
  await app.close();
  const saved = JSON.parse(readFileSync(dataPath, 'utf8')) as { tasks: { id: string; status: string }[] };
  assert.equal(saved.tasks[0].id, task.id);
  const restored = createLabServer({ dataPath, tickMs: 0 });
  try {
    assert.equal(restored.engine.getState().tasks[0].status, 'paused');
    assert.ok(restored.engine.getState().devices.every((device) => !device.activeTaskId));
  } finally { await restored.close(); }
});

test('静态托管提供构建文件，拒绝目录穿越和隐藏文件', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'smart-lab-static-'));
  writeFileSync(join(directory, 'index.html'), '<!doctype html><title>test lab</title>');
  const app = await setup({ clientPath: directory });
  try {
    const page = await app.request('/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /test lab/);
    assert.equal((await app.request('/.env')).status, 403);
    assert.equal((await app.request('/..%2f..%2fpackage.json')).status, 403);
    assert.equal((await app.request('/api/missing')).status, 404);
  } finally { await app.close(); }
});
