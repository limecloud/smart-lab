import test from 'node:test';
import assert from 'node:assert/strict';
import { LabEngine } from '../server/engine.js';
import worker, { LabSession, type Env } from '../edge/worker.js';
import { SessionRuntime, type SessionSnapshot } from '../edge/runtime.js';

function durableContext(shared = new Map<string, unknown>()) {
  const memory = { alarm: undefined as number | undefined, values: shared };
  let queue = Promise.resolve();
  const context = {
    storage: {
      async get(key: string) { return structuredClone(shared.get(key)); },
      async put(key: string, value: unknown) { shared.set(key, structuredClone(value)); },
      async setAlarm(value: number) { memory.alarm = value; },
      async deleteAlarm() { memory.alarm = undefined; },
    },
    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
      const result = queue.then(callback);
      queue = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  return { memory, context: context as unknown as ConstructorParameters<typeof LabSession>[0] };
}

function environment() {
  const sessions = new Map<string, LabSession>();
  const env = {
    ASSETS: { async fetch() { return new Response('<title>LimeLab</title>', { headers: { 'Content-Type': 'text/html' } }); } },
    LABS: {
      idFromName(name: string) { return name; },
      get(name: string) {
        if (!sessions.has(name)) sessions.set(name, new LabSession(durableContext().context, env as unknown as Env));
        return { fetch: (request: Request) => sessions.get(name)!.fetch(request) };
      },
    },
  };
  return { env: env as unknown as Env, sessions };
}

function request(path: string, method = 'GET', value?: unknown, cookie?: string) {
  return new Request('https://smart-lab.test' + path, {
    method, headers: { ...(value !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    ...(value !== undefined ? { body: JSON.stringify(value) } : {}),
  });
}

test('连续恢复保留运行状态、资源锁和移动插值，本地默认恢复仍暂停', () => {
  const original = new LabEngine({ seedDemo: false });
  const task = original.createTask({ workflowId: 'workflow-standard', sampleCount: 2 });
  original.tick(2);
  const saved = original.getState();
  const resumed = new LabEngine({ initialState: saved, restoreMode: 'continue' });
  assert.equal(resumed.getState().tasks[0].status, 'running');
  assert.equal(resumed.getState().devices[0].activeTaskId, task.id);
  original.tick(0.01);
  resumed.tick(0.01);
  assert.deepEqual(resumed.getState().devices[0].position, original.getState().devices[0].position);
  original.tick(1000);
  resumed.tick(1000);
  assert.equal(resumed.getState().tasks[0].status, 'completed');
  assert.deepEqual(resumed.getState().results.map((result) => result.value), original.getState().results.map((result) => result.value));
  assert.equal(new LabEngine({ initialState: saved }).getState().tasks[0].status, 'paused');
});

test('会话墙钟只从任务创建后推进，延迟重试不重复计算已提交时间', () => {
  const session = new SessionRuntime(undefined, 1000);
  assert.equal(session.engine.getState().tasks.length, 0);
  session.advance(61000);
  assert.equal(session.engine.getState().simulation.simTime, 0);
  session.engine.createTask({ workflowId: 'workflow-standard' });
  session.advance(63000);
  assert.equal(session.engine.getState().simulation.simTime, 2);
  const recovered = new SessionRuntime(session.snapshot(), 63000);
  recovered.advance(63000);
  assert.equal(recovered.engine.getState().simulation.simTime, 2);
  recovered.advance(64000);
  assert.equal(recovered.engine.getState().simulation.simTime, 3);
  assert.equal(recovered.engine.getState().tasks[0].status, 'running');
  const robot = recovered.engine.getState().devices.find((device) => device.id === 'robot-01')!;
  assert.deepEqual(robot.position, [-4, 1.175]);
});

test('暂停和长时间空闲不补算给下一任务；延迟alarm可以完成任务并只生成一次结果', () => {
  const session = new SessionRuntime(undefined, 0);
  session.engine.createTask({ workflowId: 'workflow-measurement', sampleCount: 3 });
  session.advance(2000);
  session.engine.configureSimulation({ paused: true });
  session.advance(3_600_000);
  assert.equal(session.engine.getState().simulation.simTime, 2);
  const recovered = new SessionRuntime(session.snapshot(), 3_600_000);
  recovered.engine.configureSimulation({ paused: false, speed: 4 });
  recovered.advance(3_603_000);
  assert.equal(recovered.engine.getState().tasks[0].status, 'completed');
  assert.equal(recovered.engine.getState().results.length, 3);
  const again = new SessionRuntime(recovered.snapshot(), 3_603_000);
  again.advance(7_000_000);
  assert.equal(again.engine.getState().results.length, 3);
  assert.equal(again.hasWork(), false);
});

test('Worker会话Cookie隔离、HTTPS属性、本地HTTP兼容和静态资源', async () => {
  const { env, sessions } = environment();
  const health = await worker.fetch(request('/api/health'), env);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('Set-Cookie'), null);
  assert.equal(sessions.size, 0);
  const first = await worker.fetch(request('/api/state'), env);
  const header = first.headers.get('Set-Cookie')!;
  assert.match(header, /smart_lab_session=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure/);
  const cookie = header.split(';')[0];
  assert.equal((await first.json() as { tasks: unknown[] }).tasks.length, 0);
  const created = await worker.fetch(request('/api/tasks', 'POST', { workflowId: 'workflow-measurement' }, cookie), env);
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('Set-Cookie'), null);
  const second = await worker.fetch(request('/api/state'), env);
  assert.notEqual(second.headers.get('Set-Cookie')!.split(';')[0], cookie);
  assert.equal((await second.json() as { tasks: unknown[] }).tasks.length, 0);
  assert.equal(sessions.size, 2);
  const local = await worker.fetch(new Request('http://localhost:8787/api/state'), env);
  assert.doesNotMatch(local.headers.get('Set-Cookie')!, /; Secure/);
  const assets = await worker.fetch(request('/'), env);
  assert.match(await assets.text(), /LimeLab/);
});

test('Worker与DO保留同源、请求大小、错误码和工作流合同', async () => {
  const { env } = environment();
  const first = await worker.fetch(request('/api/state'), env);
  const cookie = first.headers.get('Set-Cookie')!.split(';')[0];
  const state = await first.json() as { workflows: { id: string; name: string }[] };
  const cross = new Request('https://smart-lab.test/api/simulation', { method: 'POST', headers: { Origin: 'https://evil.invalid', 'Content-Type': 'application/json', Cookie: cookie }, body: '{"paused":true}' });
  assert.equal((await worker.fetch(cross, env)).status, 403);
  assert.equal((await worker.fetch(request('/api/tasks', 'POST', { workflowId: 'missing' }, cookie), env)).status, 404);
  assert.equal((await worker.fetch(request('/api/tasks', 'POST', { workflowId: state.workflows[0].id, sampleCount: 0 }, cookie), env)).status, 400);
  assert.equal((await worker.fetch(request('/api/devices/station-analyzer', 'PATCH', { status: ['offline'] }, cookie), env)).status, 400);
  assert.equal((await worker.fetch(request('/api/unknown', 'POST', undefined, cookie), env)).status, 404);
  assert.equal((await worker.fetch(request('/api/tasks', 'POST', { padding: 'x'.repeat(1024 * 1024) }, cookie), env)).status, 413);
  const invalid = new Request('https://smart-lab.test/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{' });
  assert.equal((await worker.fetch(invalid, env)).status, 400);
  const workflow = { name: '边缘测量流程', description: 'DO合同回归', sampleCount: 2, steps: [
    { id: 'edge-measure', name: '采集模拟值', action: 'measure', deviceId: 'station-analyzer', durationSeconds: 2 },
  ] };
  const created = await worker.fetch(request('/api/workflows', 'POST', workflow, cookie), env);
  assert.equal(created.status, 201);
  const saved = await created.json() as { id: string };
  assert.equal((await worker.fetch(request('/api/workflows/' + saved.id, 'PUT', { ...workflow, name: '更新后的测量流程' }, cookie), env)).status, 200);
});

test('Durable Object快照、alarm重试、实例重建和SSE均使用同一调度状态', async (t) => {
  let now = 10_000;
  t.mock.method(Date, 'now', () => now);
  const firstContext = durableContext();
  const env = environment().env;
  const session = new LabSession(firstContext.context, env);
  assert.equal((await session.fetch(request('/api/tasks', 'POST', { workflowId: 'workflow-standard', sampleCount: 2 }))).status, 201);
  assert.equal(firstContext.memory.alarm, 11_000);
  now = 12_000;
  await session.alarm();
  const saved = firstContext.memory.values.get('session-v1') as SessionSnapshot;
  assert.equal(saved.state.simulation.simTime, 2);
  assert.equal(saved.state.tasks[0].status, 'running');
  const secondContext = durableContext(firstContext.memory.values);
  const resumed = new LabSession(secondContext.context, env);
  now = 13_000;
  await resumed.alarm();
  await resumed.alarm();
  const recovered = secondContext.memory.values.get('session-v1') as SessionSnapshot;
  assert.equal(recovered.state.simulation.simTime, 3);
  assert.deepEqual(recovered.state.devices[0].position, [-4, 1.175]);
  const stream = await resumed.fetch(request('/api/stream'));
  assert.match(stream.headers.get('Content-Type')!, /text\/event-stream/);
  const reader = stream.body!.getReader();
  const initial = new TextDecoder().decode((await reader.read()).value);
  assert.match(initial, /event: state/);
  assert.match(initial, /"simTime":3/);
  // 首帧之外的广播可能已在队列中；循环读取到本次 alarm 推进后的状态。
  now = 80_000;
  await resumed.alarm();
  let frame = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    frame = new TextDecoder().decode((await reader.read()).value);
    if (frame.includes('"status":"completed"')) break;
  }
  assert.match(frame, /"status":"completed"/);
  assert.match(frame, /模拟吸光度/);
  await reader.cancel();
  const csv = await resumed.fetch(request('/api/results/export.csv'));
  assert.match(await csv.text(), /仿真数据（非实测）/);
  assert.equal(secondContext.memory.alarm, undefined);
});
