import test from 'node:test';
import assert from 'node:assert/strict';
import { LabEngine, LabError } from '../server/engine.js';

const fresh = () => new LabEngine({ seedDemo: false, now: () => new Date('2026-11-06T00:00:00Z') });
const taskState = (engine: LabEngine, taskId: string) => engine.getState().tasks.find((task) => task.id === taskId)!;

test('同一设备资源互斥，排队任务在释放后继续执行', () => {
  const engine = fresh();
  const first = engine.createTask({ workflowId: 'workflow-measurement', sampleCount: 2 });
  const second = engine.createTask({ workflowId: 'workflow-measurement', sampleCount: 2 });
  engine.tick(2);
  assert.equal(taskState(engine, first.id).status, 'running');
  assert.equal(taskState(engine, second.id).status, 'queued');
  assert.match(taskState(engine, second.id).message!, /等待资源/);
  assert.equal(engine.getState().devices.find((device) => device.id === 'station-analyzer')?.activeTaskId, first.id);
  engine.tick(26);
  assert.equal(taskState(engine, first.id).status, 'completed');
  assert.equal(taskState(engine, second.id).status, 'completed');
  assert.equal(engine.getState().results.length, 4);
  assert.ok(engine.getState().devices.every((device) => !device.activeTaskId));
});

test('互不冲突的资源允许并发，高优先级任务优先获取尚未占用的设备', () => {
  const engine = fresh();
  const normal = engine.createTask({ workflowId: 'workflow-measurement' });
  const high = engine.createTask({ workflowId: 'workflow-measurement', priority: 'high' });
  const other = engine.createTask({ workflowId: 'workflow-preparation' });
  engine.tick(1);
  assert.equal(taskState(engine, normal.id).status, 'queued');
  assert.equal(taskState(engine, high.id).status, 'running');
  assert.equal(taskState(engine, other.id).status, 'running');
});

for (const workflowId of ['workflow-standard', 'workflow-preparation']) {
  test(`两个 ${workflowId} 全流程并发时，仪器处理后重新导航并全部完成`, () => {
    const engine = fresh();
    const first = engine.createTask({ workflowId, sampleCount: 2 });
    const second = engine.createTask({ workflowId, sampleCount: 2 });
    engine.tick(1000);
    assert.equal(taskState(engine, first.id).status, 'completed', taskState(engine, first.id).message);
    assert.equal(taskState(engine, second.id).status, 'completed', taskState(engine, second.id).message);
    assert.ok(engine.getState().devices.every((device) => !device.activeTaskId && device.status === 'idle'));
    if (workflowId === 'workflow-standard') {
      assert.equal(engine.getState().results.filter((result) => result.taskId === first.id).length, 2);
      assert.equal(engine.getState().results.filter((result) => result.taskId === second.id).length, 2);
    }
  });
}

test('移动期间插入高优先级任务，原任务等待后显式重新接驳并完成', () => {
  const engine = fresh();
  const first = engine.createTask({ workflowId: 'workflow-standard', sampleCount: 2 });
  engine.tick(2);
  const high = engine.createTask({ workflowId: 'workflow-standard', sampleCount: 2, priority: 'high' });
  engine.tick(1000);
  assert.equal(taskState(engine, high.id).status, 'completed');
  const finished = taskState(engine, first.id);
  assert.equal(finished.status, 'completed', finished.message);
  assert.ok(finished.steps.some((step) => step.id.startsWith('recovery-') && step.status === 'completed'));
  assert.equal(engine.getState().results.length, 4);
});

test('任务暂停冻结进度并释放设备，恢复后从中断位置继续', () => {
  const engine = fresh();
  const task = engine.createTask({ workflowId: 'workflow-standard' });
  engine.tick(2);
  const before = taskState(engine, task.id).progress;
  const position = engine.getState().devices.find((device) => device.id === 'robot-01')!.position;
  engine.changeTask(task.id, 'pause');
  engine.tick(10);
  assert.equal(taskState(engine, task.id).progress, before);
  assert.deepEqual(engine.getState().devices.find((device) => device.id === 'robot-01')!.position, position);
  assert.ok(engine.getState().devices.every((device) => !device.activeTaskId));
  engine.changeTask(task.id, 'resume');
  engine.tick(2);
  assert.ok(taskState(engine, task.id).progress > before);
  engine.tick(100);
  assert.equal(taskState(engine, task.id).status, 'completed');
});

for (const [action, elapsed] of [['pick', 6.5], ['place', 19.5]] as const) {
  test(`暂停已开始的 ${action} 后机器人被其他任务调走，恢复时重新接驳`, () => {
    const engine = fresh();
    const first = engine.createTask({ workflowId: 'workflow-standard', sampleCount: 2 });
    engine.tick(elapsed);
    assert.equal(taskState(engine, first.id).steps[taskState(engine, first.id).currentStepIndex].action, action);
    engine.changeTask(first.id, 'pause');
    const other = engine.createTask({ workflowId: 'workflow-standard', sampleCount: 2 });
    engine.tick(1000);
    assert.equal(taskState(engine, other.id).status, 'completed');
    engine.changeTask(first.id, 'resume');
    engine.tick(0);
    const resumed = taskState(engine, first.id);
    assert.equal(resumed.steps[resumed.currentStepIndex].action, 'move');
    assert.match(resumed.steps[resumed.currentStepIndex].name, /恢复接驳/);
    engine.tick(1000);
    assert.equal(taskState(engine, first.id).status, 'completed', taskState(engine, first.id).message);
    assert.equal(engine.getState().results.filter((result) => result.taskId === first.id).length, 2);
    assert.ok(engine.getState().devices.every((device) => !device.activeTaskId));
  });
}

test('被中断的移动从实际位置重建插值，不跳回暂停前位置', () => {
  const engine = fresh();
  const first = engine.createTask({ workflowId: 'workflow-standard' });
  engine.tick(2);
  engine.changeTask(first.id, 'pause');
  const other = engine.createTask({ workflowId: 'workflow-standard' });
  engine.tick(1000);
  assert.equal(taskState(engine, other.id).status, 'completed');
  const actual = engine.getState().devices.find((device) => device.id === 'robot-01')!.position;
  engine.changeTask(first.id, 'resume');
  engine.tick(0);
  assert.deepEqual(engine.getState().devices.find((device) => device.id === 'robot-01')!.position, actual);
  engine.tick(0.01);
  const next = engine.getState().devices.find((device) => device.id === 'robot-01')!.position;
  assert.ok(Math.hypot(next[0] - actual[0], next[1] - actual[1]) < 0.1);
  engine.tick(1000);
  assert.equal(taskState(engine, first.id).status, 'completed');
});

test('取消任务释放锁，不允许恢复已取消或已完成任务', () => {
  const engine = fresh();
  const task = engine.createTask({ workflowId: 'workflow-measurement' });
  engine.tick(1);
  engine.changeTask(task.id, 'cancel');
  assert.equal(taskState(engine, task.id).status, 'cancelled');
  assert.ok(engine.getState().devices.every((device) => !device.activeTaskId));
  assert.throws(() => engine.changeTask(task.id, 'resume'), (error) => error instanceof LabError && error.status === 409);
  engine.tick(30);
  assert.equal(engine.getState().results.length, 0);
});

test('全局暂停冻结仿真时间和进度，速率统一应用到执行时间', () => {
  const engine = fresh();
  const task = engine.createTask({ workflowId: 'workflow-measurement' });
  engine.tick(1);
  const before = engine.getState();
  engine.configureSimulation({ paused: true, speed: 4 });
  engine.tick(10);
  assert.equal(engine.getState().simulation.simTime, before.simulation.simTime);
  assert.equal(taskState(engine, task.id).progress, taskState(new LabEngine({ initialState: before }), task.id).progress);
  engine.configureSimulation({ paused: false });
  engine.tick(3.25);
  assert.equal(taskState(engine, task.id).status, 'completed');
  assert.equal(engine.getState().simulation.simTime, 14);
});

test('离线设备使任务明确失败，设备恢复后从失败步骤重试', () => {
  const engine = fresh();
  engine.setDeviceStatus('station-analyzer', 'offline');
  const task = engine.createTask({ workflowId: 'workflow-measurement', sampleCount: 3 });
  engine.tick(0);
  assert.equal(taskState(engine, task.id).status, 'failed');
  assert.match(taskState(engine, task.id).message!, /已离线/);
  engine.setDeviceStatus('station-analyzer', 'idle');
  engine.changeTask(task.id, 'retry');
  engine.tick(14);
  assert.equal(taskState(engine, task.id).status, 'completed');
  assert.equal(engine.getState().results.length, 3);
});

test('运行中的设备不允许切离线，缺少导航的取样流程失败而非远程抓取', () => {
  const engine = fresh();
  const task = engine.createTask({ workflowId: 'workflow-measurement' });
  engine.tick(0);
  assert.throws(() => engine.setDeviceStatus('station-analyzer', 'fault'), (error) => error instanceof LabError && error.status === 409);
  engine.changeTask(task.id, 'cancel');
  const workflow = engine.saveWorkflow({ name: '无导航测试', description: '', sampleCount: 1, steps: [
    { id: 'pick-only', name: '取样', action: 'pick', deviceId: 'robot-01', stationId: 'station-prep', durationSeconds: 1 },
  ] });
  const invalid = engine.createTask({ workflowId: workflow.id });
  engine.changeTask(invalid.id, 'pause');
  engine.changeTask(invalid.id, 'resume');
  engine.tick(1);
  assert.equal(taskState(engine, invalid.id).status, 'failed');
  assert.match(taskState(engine, invalid.id).message!, /接驳点/);
});

test('流程更新不改变已创建任务的步骤快照', () => {
  const engine = fresh();
  const workflow = engine.getState().workflows.find((candidate) => candidate.id === 'workflow-measurement')!;
  const task = engine.createTask({ workflowId: workflow.id });
  workflow.steps[0].durationSeconds = 30;
  workflow.name = '已修改的流程';
  engine.saveWorkflow(workflow, workflow.id);
  assert.equal(taskState(engine, task.id).steps[0].durationSeconds, 6);
  assert.equal(taskState(engine, task.id).workflowName, '仪器快速质控');
  assert.equal(engine.createTask({ workflowId: workflow.id }).steps[0].durationSeconds, 30);
});

test('每个样品产生可追溯的确定性模拟结果，导出明确标记仿真', () => {
  const engine = fresh();
  const first = engine.createTask({ workflowId: 'workflow-measurement', sampleCount: 3 });
  engine.tick(14);
  const firstValues = engine.getState().results.filter((result) => result.taskId === first.id).map((result) => result.value);
  assert.equal(firstValues.length, 3);
  const second = engine.createTask({ workflowId: 'workflow-measurement', sampleCount: 3 });
  engine.tick(14);
  assert.deepEqual(engine.getState().results.filter((result) => result.taskId === second.id).map((result) => result.value), firstValues);
  assert.equal(taskState(engine, second.id).progress, 1);
  assert.ok(engine.getState().results.every((result) => result.metric.includes('模拟') && result.unit === 'AU'));
  const csv = engine.exportResultsCsv();
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /仿真数据（非实测）/);
  assert.match(csv, new RegExp(first.id));
});

test('持久化恢复暂停未完成任务，保留进度，清除残留设备锁', () => {
  const engine = fresh();
  const task = engine.createTask({ workflowId: 'workflow-standard' });
  engine.tick(3);
  const saved = engine.getState();
  const restored = new LabEngine({ initialState: saved });
  assert.equal(taskState(restored, task.id).status, 'paused');
  assert.equal(taskState(restored, task.id).progress, taskState(engine, task.id).progress);
  assert.ok(restored.getState().devices.every((device) => !device.activeTaskId && device.status !== 'busy'));
  restored.changeTask(task.id, 'resume');
  restored.tick(100);
  assert.equal(taskState(restored, task.id).status, 'completed');
});

test('严格验证样品数、动作、设备能力、时间、重复步骤ID和仿真设置', () => {
  const engine = fresh();
  for (const count of [0, 97, 1.2, '12', null]) assert.throws(() => engine.createTask({ workflowId: 'workflow-standard', sampleCount: count }), LabError);
  assert.throws(() => engine.createTask({ workflowId: 'missing' }), (error) => error instanceof LabError && error.status === 404);
  assert.throws(() => engine.createTask({ workflowId: 'workflow-standard', priority: 'urgent' }), LabError);
  const valid = { name: '验证流程', description: '', sampleCount: 1, steps: [{ id: 'step-1', name: '测量', action: 'measure', deviceId: 'station-analyzer', durationSeconds: 1 }] };
  assert.throws(() => engine.saveWorkflow({ ...valid, steps: [{ ...valid.steps[0], deviceId: 'robot-01' }] }), LabError);
  assert.throws(() => engine.saveWorkflow({ ...valid, steps: [{ ...valid.steps[0], durationSeconds: 0 }] }), LabError);
  assert.throws(() => engine.saveWorkflow({ ...valid, steps: [valid.steps[0], valid.steps[0]] }), LabError);
  assert.throws(() => engine.configureSimulation({ speed: 10 }), LabError);
  assert.throws(() => engine.configureSimulation({ paused: 'false' }), LabError);
  for (const invalid of [['offline'], { toString: () => 'offline' }, null, 0]) {
    assert.throws(() => engine.setDeviceStatus('station-analyzer', invalid), (error) => error instanceof LabError && error.status === 400);
  }
  const task = engine.createTask({ workflowId: 'workflow-measurement' });
  for (const invalid of [['pause'], { toString: () => 'pause' }, null, 0]) {
    assert.throws(() => engine.changeTask(task.id, invalid), (error) => error instanceof LabError && error.status === 400);
  }
  assert.throws(() => engine.tick(Number.NaN), LabError);
  const snapshot = engine.getState();
  snapshot.devices[0].status = 'fault';
  assert.equal(engine.getState().devices[0].status, 'idle');
});
