import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

// 使用独立 Cookie 会话，只创建仿真任务，不接触其他访客的实验。
const origin = new URL(process.argv[2] ?? 'https://smart-lab.limeai.run').origin;
let cookie = '';
async function request(path, { method = 'GET', body, headers = {}, status = 200 } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== status) assert.fail(`${method} ${path}: expected ${status}, got ${response.status}: ${await response.text()}`);
  const issued = response.headers.get('set-cookie');
  if (issued) cookie = issued.split(';')[0];
  return response;
}

const health = await (await request('/api/health')).json();
assert.equal(health.ok, true);
assert.equal(health.mode, 'simulation');
const page = await (await request('/')).text();
assert.match(page, /<div id="root"><\/div>/);
const initial = await (await request('/api/state')).json();
assert.ok(cookie, '云端必须设置独立会话 Cookie');
assert.equal(initial.tasks.length, 0);
assert.equal(initial.devices.length, 6);
console.log('PASS 网页、健康检查、初始会话');

await request('/api/simulation', { method: 'POST', body: { speed: 4 }, headers: { Origin: 'https://unrelated.invalid' }, status: 403 });
await request('/api/devices/robot-01', { method: 'PATCH', body: { status: ['offline'] }, status: 400 });
await request('/api/simulation', { method: 'POST', body: { speed: 4, paused: false } });
const task = await (await request('/api/tasks', { method: 'POST', body: { workflowId: 'workflow-standard', name: 'Cloudflare 独立验收', sampleCount: 2 }, status: 201 })).json();
await request(`/api/tasks/${task.id}`, { method: 'PATCH', body: { action: 'pause' } });
const paused = await (await request('/api/state')).json();
assert.equal(paused.tasks.find((item) => item.id === task.id).status, 'paused');
await request(`/api/tasks/${task.id}`, { method: 'PATCH', body: { action: 'resume' } });

const stream = await request('/api/stream');
assert.match(stream.headers.get('content-type'), /text\/event-stream/);
const reader = stream.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
let streamedMovement = false;
while (!streamedMovement) {
  const frame = await reader.read();
  assert.equal(frame.done, false, 'SSE 应保持连接直到收到 alarm 推进的机器人位置');
  buffer += decoder.decode(frame.value, { stream: true });
  let boundary;
  while ((boundary = buffer.indexOf('\n\n')) >= 0) {
    const event = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 2);
    const data = event.split('\n').find((line) => line.startsWith('data: '));
    if (!data) continue;
    const snapshot = JSON.parse(data.slice(6));
    assert.ok(snapshot.tasks.some((item) => item.id === task.id), 'SSE 必须订阅当前任务所在的同一会话');
    const robot = snapshot.devices.find((device) => device.id === 'robot-01');
    streamedMovement ||= Math.hypot(robot.position[0] - initial.devices[0].position[0], robot.position[1] - initial.devices[0].position[1]) > 0.1;
  }
}
await reader.cancel();
console.log('PASS 同源限制、输入校验、任务暂停/恢复、SSE 与 alarm 主动推进');

const separate = await fetch(`${origin}/api/state`, { signal: AbortSignal.timeout(15_000) });
assert.equal(separate.status, 200);
assert.notEqual(separate.headers.get('set-cookie')?.split(';')[0], cookie);
assert.equal((await separate.json()).tasks.length, 0);

let completed;
let moved = false;
const deadline = Date.now() + 55_000;
while (Date.now() < deadline) {
  const state = await (await request('/api/state')).json();
  const robot = state.devices.find((device) => device.id === 'robot-01');
  moved ||= Math.hypot(robot.position[0] - initial.devices[0].position[0], robot.position[1] - initial.devices[0].position[1]) > 0.1;
  const current = state.tasks.find((item) => item.id === task.id);
  assert.notEqual(current.status, 'failed', current.message);
  if (current.status === 'completed') { completed = state; break; }
  await delay(1000);
}
assert.ok(completed, '任务必须由云端时钟推进到完成');
assert.ok(moved, '后端机器人坐标必须改变');
assert.equal(completed.results.filter((result) => result.taskId === task.id).length, 2);
const persisted = await (await request('/api/state')).json();
assert.equal(persisted.tasks.find((item) => item.id === task.id).status, 'completed');
const csv = await (await request('/api/results/export.csv')).text();
assert.ok(csv.includes(task.id));
for (const file of ['flare-hood.jpg', 'flare-analyzer.jpg', 'flare-storage.jpg', 'flare-robot-front.jpg', 'sunburst-robot-front.jpg']) {
  const asset = await request(`/assets/twin/textures/${file}`);
  assert.match(asset.headers.get('content-type'), /image\/jpeg/);
}
console.log('PASS 访客隔离、机器人移动、任务完成、两条检测结果、状态回读、CSV、三维纹理');
console.log(`Cloudflare 验收通过：${origin}`);
