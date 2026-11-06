import { randomUUID } from 'node:crypto';
import type {
  CreateTaskInput, LabDevice, LabEvent, LabResult, LabState, LabTask, LabWorkflow,
  SaveWorkflowInput, StepAction, TaskStep, WorkflowStep,
} from '../shared/types.js';

export class LabError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

interface EngineOptions {
  seedDemo?: boolean;
  initialState?: LabState;
  restoreMode?: 'pause' | 'continue';
  now?: () => Date;
  onChange?: (state: LabState) => void;
}

const actions = new Set<StepAction>(['move', 'pick', 'place', 'process', 'measure']);
const clone = <T>(value: T): T => structuredClone(value);
const id = (prefix: string) => `${prefix}-${randomUUID()}`;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LabError(`${label}必须是对象`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max = 120): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new LabError(`${label}必须为 1–${max} 个字符`);
  }
  return value.trim();
}

function sampleCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 96) {
    throw new LabError('样品数必须为 1–96 的整数');
  }
  return value;
}

function initialState(time: string): LabState {
  const device = (input: Omit<LabDevice, 'status' | 'connection' | 'homePosition'>): LabDevice => ({
    ...input, homePosition: [...input.position], status: 'idle', connection: 'simulated',
  });
  const devices: LabDevice[] = [
    device({ id: 'robot-01', name: '复合机器人 AMR-01', kind: 'robot', category: '移动机械臂', position: [-3, 1], battery: 94, capabilities: ['move', 'pick', 'place'] }),
    device({ id: 'robot-02', name: '复合机器人 AMR-02', kind: 'robot', category: '移动机械臂', position: [3, 2], battery: 88, capabilities: ['move', 'pick', 'place'] }),
    device({ id: 'station-prep', name: '样品准备台', kind: 'station', category: '样品前处理', position: [-5, 3], capabilities: ['process'] }),
    device({ id: 'station-hood', name: '通风操作柜', kind: 'station', category: '通风操作', position: [-5, -3], capabilities: ['process'] }),
    device({ id: 'station-analyzer', name: '自动分析仪', kind: 'station', category: '光学分析', position: [4, -3], capabilities: ['process', 'measure'] }),
    device({ id: 'station-storage', name: '样品存储站', kind: 'station', category: '样品归档', position: [6, 3], capabilities: ['process'] }),
  ];
  const step = (sid: string, name: string, action: StepAction, deviceId: string, durationSeconds: number, stationId?: string): WorkflowStep => ({
    id: sid, name, action, deviceId, durationSeconds, ...(stationId ? { stationId } : {}),
  });
  const workflow = (wid: string, name: string, description: string, count: number, steps: WorkflowStep[]): LabWorkflow => ({
    id: wid, name, description, sampleCount: count, steps, createdAt: time, updatedAt: time,
  });
  return {
    devices,
    workflows: [
      workflow('workflow-standard', '标准样品分析', '样品取样、自动分析、测量与归档的完整仿真流程', 12, [
        step('std-1', '前往样品准备台', 'move', 'robot-01', 6, 'station-prep'),
        step('std-2', '抓取样品托盘', 'pick', 'robot-01', 4, 'station-prep'),
        step('std-3', '转运至自动分析仪', 'move', 'robot-01', 9, 'station-analyzer'),
        step('std-4', '放置待测样品', 'place', 'robot-01', 4, 'station-analyzer'),
        step('std-5', '仪器预处理', 'process', 'station-analyzer', 8),
        step('std-6', '采集模拟吸光度', 'measure', 'station-analyzer', 8),
        step('std-return', '返回自动分析仪接驳点', 'move', 'robot-01', 7, 'station-analyzer'),
        step('std-7', '取回已测样品', 'pick', 'robot-01', 4, 'station-analyzer'),
        step('std-8', '送往样品存储站', 'move', 'robot-01', 7, 'station-storage'),
        step('std-9', '归档样品', 'place', 'robot-01', 4, 'station-storage'),
      ]),
      workflow('workflow-preparation', '通风柜样品前处理', 'AMR-02 将样品送入通风柜，完成模拟处理后归档', 8, [
        step('prep-1', '前往样品准备台', 'move', 'robot-02', 7, 'station-prep'),
        step('prep-2', '抓取原始样品', 'pick', 'robot-02', 4, 'station-prep'),
        step('prep-3', '移动至通风柜', 'move', 'robot-02', 7, 'station-hood'),
        step('prep-4', '放置样品', 'place', 'robot-02', 4, 'station-hood'),
        step('prep-5', '模拟样品前处理', 'process', 'station-hood', 12),
        step('prep-return', '返回通风柜接驳点', 'move', 'robot-02', 7, 'station-hood'),
        step('prep-6', '取回处理后样品', 'pick', 'robot-02', 4, 'station-hood'),
        step('prep-7', '移动至存储站', 'move', 'robot-02', 9, 'station-storage'),
        step('prep-8', '放置归档样品', 'place', 'robot-02', 4, 'station-storage'),
      ]),
      workflow('workflow-measurement', '仪器快速质控', '对已装载的质控样本采集模拟结果，不调度机器人', 6, [
        step('qc-1', '质控仪器预热', 'process', 'station-analyzer', 6),
        step('qc-2', '质控样品测量', 'measure', 'station-analyzer', 8),
      ]),
    ],
    tasks: [], events: [], results: [], simulation: { paused: false, speed: 1, simTime: 0 },
  };
}

/** 确定性逻辑仿真器；不实现真实导航、力控或硬件安全控制。 */
export class LabEngine {
  private state: LabState;
  private readonly now: () => Date;
  private readonly listeners = new Set<(state: LabState) => void>();
  private readonly moveOrigins = new Map<string, { position: [number, number]; progress: number }>();

  constructor(options: EngineOptions = {}) {
    this.now = options.now ?? (() => new Date());
    if (options.initialState) {
      this.state = clone(options.initialState);
      this.restore(options.restoreMode ?? 'pause');
    } else {
      this.state = initialState(this.timestamp());
      this.event('info', '仿真实验室已就绪；所有设备与测量结果均为模拟');
      if (options.seedDemo !== false) this.createTask({ workflowId: 'workflow-standard', name: '演示实验 · 标准样品分析' });
    }
    if (options.onChange) this.listeners.add(options.onChange);
  }

  getState(): LabState { return clone(this.state); }

  subscribe(listener: (state: LabState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private timestamp(): string { return this.now().toISOString(); }

  private changed(): void {
    if (!this.listeners.size) return;
    const snapshot = this.getState();
    for (const listener of this.listeners) listener(snapshot);
  }

  private event(level: LabEvent['level'], message: string, taskId?: string, deviceId?: string): void {
    this.state.events.unshift({ id: id('event'), time: this.timestamp(), level, message, ...(taskId ? { taskId } : {}), ...(deviceId ? { deviceId } : {}) });
    this.state.events = this.state.events.slice(0, 250);
  }

  private restore(mode: 'pause' | 'continue'): void {
    if (!Array.isArray(this.state.devices) || !Array.isArray(this.state.tasks) || !Array.isArray(this.state.workflows)
      || !Array.isArray(this.state.events) || !Array.isArray(this.state.results) || !this.state.simulation) {
      throw new LabError('持久化状态格式无效，无法自动恢复', 500);
    }
    for (const device of this.state.devices) {
      delete device.activeTaskId;
      if (device.status === 'busy') device.status = 'idle';
    }
    // DO 的实例唤醒不是服务重启；从已提交快照重建资源锁与移动剩余插值。
    if (mode === 'continue') {
      for (const task of this.state.tasks) {
        const step = task.steps[task.currentStepIndex];
        if (task.status !== 'running' || step?.status !== 'running') continue;
        for (const device of this.resources(step)) {
          if (device.activeTaskId || device.status !== 'idle') throw new LabError('持久化快照的运行资源发生冲突', 500);
          device.activeTaskId = task.id;
          device.status = 'busy';
        }
        if (step.action === 'move') this.moveOrigins.set(task.id, {
          position: [...this.device(step.deviceId).position], progress: step.progress,
        });
      }
      return;
    }
    let recovered = 0;
    for (const task of this.state.tasks) {
      if (['running', 'queued', 'paused'].includes(task.status)) {
        task.status = 'paused';
        task.message = '服务重启后已安全暂停，请确认后继续';
        for (const step of task.steps) if (step.status === 'running') step.status = 'pending';
        recovered++;
      }
    }
    if (recovered) this.event('warning', `已恢复 ${recovered} 个未完成任务，等待人工继续`);
  }

  private device(deviceId: string): LabDevice {
    const device = this.state.devices.find((candidate) => candidate.id === deviceId);
    if (!device) throw new LabError(`设备不存在：${deviceId}`, 404);
    return device;
  }

  private validateWorkflow(input: unknown): SaveWorkflowInput {
    const value = record(input, '流程');
    const name = text(value.name, '流程名称');
    if (typeof value.description !== 'string' || value.description.length > 800) throw new LabError('流程说明必须为不超过 800 字的文本');
    const count = sampleCount(value.sampleCount);
    if (!Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 40) throw new LabError('流程必须包含 1–40 个步骤');
    const ids = new Set<string>();
    const steps = value.steps.map((raw, index): WorkflowStep => {
      const item = record(raw, `步骤 ${index + 1}`);
      const stepId = text(item.id, '步骤 ID', 80);
      if (!/^[a-zA-Z0-9_-]+$/.test(stepId) || ids.has(stepId)) throw new LabError('步骤 ID 必须唯一，且只能包含字母、数字、横线和下划线');
      ids.add(stepId);
      const stepName = text(item.name, '步骤名称');
      if (!actions.has(item.action as StepAction)) throw new LabError(`步骤 ${index + 1} 的动作无效`);
      const action = item.action as StepAction;
      const deviceId = text(item.deviceId, '设备 ID', 100);
      const device = this.device(deviceId);
      if (!device.capabilities.includes(action)) throw new LabError(`${device.name} 不支持动作 ${action}`);
      if (typeof item.durationSeconds !== 'number' || !Number.isFinite(item.durationSeconds) || item.durationSeconds < 1 || item.durationSeconds > 600) {
        throw new LabError('步骤时长必须为 1–600 秒');
      }
      let stationId: string | undefined;
      if (['move', 'pick', 'place'].includes(action)) {
        if (device.kind !== 'robot') throw new LabError('移动和取放动作必须使用机器人');
        stationId = text(item.stationId, '目标站点 ID', 100);
        if (this.device(stationId).kind !== 'station') throw new LabError('目标必须为仪器或工作站');
      } else if (device.kind !== 'station') {
        throw new LabError('处理与测量动作必须使用仪器或工作站');
      } else if (item.stationId !== undefined && item.stationId !== '') {
        throw new LabError('处理与测量步骤不应设置额外目标站点');
      }
      let parameters: WorkflowStep['parameters'];
      if (item.parameters !== undefined) {
        const params = record(item.parameters, '步骤参数');
        if (Object.keys(params).length > 20) throw new LabError('每个步骤最多支持 20 个参数');
        for (const [key, val] of Object.entries(params)) {
          if (['__proto__', 'constructor', 'prototype'].includes(key) || key.length > 80
            || (typeof val !== 'string' && typeof val !== 'number')
            || (typeof val === 'string' && val.length > 300)
            || (typeof val === 'number' && !Number.isFinite(val))) throw new LabError('步骤参数只允许有限数值或短文本');
        }
        parameters = clone(params) as Record<string, string | number>;
      }
      return { id: stepId, name: stepName, action, deviceId, durationSeconds: item.durationSeconds,
        ...(stationId ? { stationId } : {}), ...(parameters ? { parameters } : {}) };
    });
    return { name, description: value.description.trim(), sampleCount: count, steps };
  }

  saveWorkflow(input: unknown, workflowId?: string): LabWorkflow {
    const validated = this.validateWorkflow(input);
    const existing = workflowId ? this.state.workflows.find((workflow) => workflow.id === workflowId) : undefined;
    if (workflowId && !existing) throw new LabError('流程不存在', 404);
    const workflow: LabWorkflow = {
      ...validated, id: existing?.id ?? id('workflow'), createdAt: existing?.createdAt ?? this.timestamp(), updatedAt: this.timestamp(),
    };
    if (existing) this.state.workflows[this.state.workflows.indexOf(existing)] = workflow;
    else this.state.workflows.unshift(workflow);
    this.event('info', `${existing ? '更新' : '创建'}流程：${workflow.name}；已有任务的步骤快照保持不变`);
    this.changed();
    return clone(workflow);
  }

  createTask(input: unknown): LabTask {
    const value = record(input, '任务');
    const workflowId = text(value.workflowId, '流程 ID', 100);
    const workflow = this.state.workflows.find((candidate) => candidate.id === workflowId);
    if (!workflow) throw new LabError('所选流程不存在', 404);
    const count = value.sampleCount === undefined ? workflow.sampleCount : sampleCount(value.sampleCount);
    const priority = value.priority ?? 'normal';
    if (priority !== 'normal' && priority !== 'high') throw new LabError('任务优先级必须为 normal 或 high');
    const task: LabTask = {
      id: id('task'), name: value.name === undefined ? `${workflow.name} · ${count} 样品` : text(value.name, '任务名称'),
      workflowId, workflowName: workflow.name, sampleCount: count, priority, status: 'queued',
      steps: clone(workflow.steps).map((step) => ({ ...step, status: 'pending', progress: 0 })),
      currentStepIndex: 0, progress: 0, createdAt: this.timestamp(), message: '等待调度',
    };
    this.state.tasks.unshift(task);
    this.event('info', `创建仿真任务：${task.name}（${count} 个样品）`, task.id);
    this.changed();
    return clone(task);
  }

  changeTask(taskId: string, action: unknown): LabTask {
    if (typeof action !== 'string' || !['pause', 'resume', 'cancel', 'retry'].includes(action)) {
      throw new LabError('任务动作必须为 pause、resume、cancel 或 retry');
    }
    const task = this.state.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new LabError('任务不存在', 404);
    const step = task.steps[task.currentStepIndex];
    if (action === 'pause' && ['queued', 'running'].includes(task.status)) {
      this.release(task);
      if (step?.status === 'running') step.status = 'pending';
      task.status = 'paused'; task.message = '任务已暂停，设备资源已释放';
      this.event('warning', `暂停任务：${task.name}`, task.id);
    } else if (action === 'resume' && task.status === 'paused') {
      task.status = 'queued'; task.message = '已恢复，等待重新获取资源';
      this.event('info', `恢复任务：${task.name}`, task.id);
    } else if (action === 'cancel' && ['queued', 'running', 'paused'].includes(task.status)) {
      this.release(task);
      if (step?.status === 'running') step.status = 'pending';
      task.status = 'cancelled'; task.completedAt = this.timestamp(); task.message = '任务已取消';
      this.event('warning', `取消任务：${task.name}`, task.id);
    } else if (action === 'retry' && task.status === 'failed') {
      if (step) { step.status = 'pending'; step.progress = 0; delete step.startedAt; delete step.completedAt; }
      task.status = 'queued'; task.message = '从失败步骤重试，等待调度'; delete task.completedAt;
      this.updateTaskProgress(task);
      this.event('info', `重试任务：${task.name}`, task.id);
    } else {
      throw new LabError(`当前任务状态 ${task.status} 不允许执行 ${action}`, 409);
    }
    this.changed();
    return clone(task);
  }

  setDeviceStatus(deviceId: string, status: unknown): LabDevice {
    const device = this.device(deviceId);
    if (typeof status !== 'string' || !['idle', 'offline', 'fault'].includes(status)) throw new LabError('设备状态必须为 idle、offline 或 fault');
    if (device.activeTaskId) throw new LabError('设备正在执行任务，请先暂停或取消关联任务', 409);
    device.status = status as 'idle' | 'offline' | 'fault';
    this.event(status === 'idle' ? 'info' : 'warning', `${device.name} 状态变更为 ${status}`, undefined, device.id);
    this.changed();
    return clone(device);
  }

  configureSimulation(input: unknown): LabState['simulation'] {
    const value = record(input, '仿真设置');
    if (value.paused === undefined && value.speed === undefined) throw new LabError('请提供 paused 或 speed');
    if (value.paused !== undefined && typeof value.paused !== 'boolean') throw new LabError('paused 必须为布尔值');
    if (value.speed !== undefined && ![0.5, 1, 2, 4].includes(value.speed as number)) throw new LabError('仿真速率仅支持 0.5、1、2、4 倍');
    if (value.paused !== undefined) this.state.simulation.paused = value.paused as boolean;
    if (value.speed !== undefined) this.state.simulation.speed = value.speed as number;
    this.event('info', `仿真${this.state.simulation.paused ? '已暂停' : '运行中'}，${this.state.simulation.speed} 倍速`);
    this.changed();
    return clone(this.state.simulation);
  }

  private resources(step: WorkflowStep): LabDevice[] {
    const result = [this.device(step.deviceId)];
    if (step.stationId) result.push(this.device(step.stationId));
    return result;
  }

  private dockingPoint(stationId: string): [number, number] {
    const [x, z] = this.device(stationId).position;
    return [x, z < 0 ? z + 1.65 : z - 1.65];
  }

  private release(task: LabTask): void {
    for (const device of this.state.devices) {
      if (device.activeTaskId === task.id) { delete device.activeTaskId; if (device.status === 'busy') device.status = 'idle'; }
    }
    this.moveOrigins.delete(task.id);
  }

  private fail(task: LabTask, message: string): void {
    const step = task.steps[task.currentStepIndex];
    if (step) step.status = 'failed';
    task.status = 'failed'; task.message = message; task.completedAt = this.timestamp();
    this.release(task);
    this.event('error', `${task.name}：${message}`, task.id, step?.deviceId);
  }

  private insertRecoveryMove(task: LabTask, step: TaskStep): TaskStep {
    const recovery: TaskStep = {
      id: id('recovery'), name: `恢复接驳：${this.device(step.stationId!).name}`, action: 'move', deviceId: step.deviceId,
      stationId: step.stationId, durationSeconds: 7, status: 'pending', progress: 0,
    };
    task.steps.splice(task.currentStepIndex, 0, recovery);
    this.updateTaskProgress(task);
    this.event('info', '机器人位置已变化，已插入显式恢复接驳步骤', task.id, step.deviceId);
    return recovery;
  }

  private schedule(): void {
    const candidates = this.state.tasks.filter((task) => ['queued', 'running'].includes(task.status)).reverse()
      .sort((a, b) => Number(b.priority === 'high') - Number(a.priority === 'high') || a.createdAt.localeCompare(b.createdAt));
    for (const task of candidates) {
      let step = task.steps[task.currentStepIndex];
      if (!step || step.status === 'running') continue;
      const resources = this.resources(step);
      const unavailable = resources.find((device) => device.status === 'offline' || device.status === 'fault');
      if (unavailable) { this.fail(task, `${unavailable.name} ${unavailable.status === 'offline' ? '已离线' : '发生故障'}，请恢复设备后重试`); continue; }
      const occupied = resources.find((device) => device.activeTaskId && device.activeTaskId !== task.id);
      if (occupied) { task.message = `等待资源：${occupied.name}`; continue; }
      if ((step.action === 'pick' || step.action === 'place') && step.stationId) {
        const [x, z] = this.device(step.deviceId).position;
        const [tx, tz] = this.dockingPoint(step.stationId);
        if (Math.hypot(x - tx, z - tz) > 0.8) {
          // 只重规划已经完成过正确导航、但在资源等待期间被其他任务改变的位置。
          const previousMove = task.steps.slice(0, task.currentStepIndex).reverse()
            .find((candidate) => candidate.action === 'move' && candidate.deviceId === step.deviceId && candidate.status === 'completed');
          if (previousMove?.stationId === step.stationId) step = this.insertRecoveryMove(task, step);
          else { this.fail(task, '机器人未到达目标接驳点，请先添加或执行对应的移动步骤'); continue; }
        }
      }
      for (const device of resources) { device.status = 'busy'; device.activeTaskId = task.id; }
      task.status = 'running'; task.startedAt ??= this.timestamp(); task.message = step.name;
      step.status = 'running'; step.startedAt ??= this.timestamp();
      if (step.action === 'move') this.moveOrigins.set(task.id, { position: [...this.device(step.deviceId).position], progress: step.progress });
      this.event('info', `执行步骤 ${task.currentStepIndex + 1}/${task.steps.length}：${step.name}`, task.id, step.deviceId);
    }
  }

  private updateTaskProgress(task: LabTask): void {
    const total = task.steps.reduce((sum, step) => sum + step.durationSeconds, 0);
    const elapsed = task.steps.reduce((sum, step) => sum + step.durationSeconds * step.progress, 0);
    task.progress = total ? Math.min(1, elapsed / total) : 0;
  }

  private measurement(task: LabTask, step: TaskStep): void {
    for (let index = 0; index < task.sampleCount; index++) {
      const sampleId = `S${String(index + 1).padStart(3, '0')}`;
      const resultId = `${task.id}:${step.id}:${sampleId}`;
      if (this.state.results.some((result) => result.id === resultId)) continue;
      let hash = 2166136261;
      for (const char of `${task.workflowId}:${step.id}:${sampleId}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
      const value = Number((0.15 + (hash % 7500) / 10000).toFixed(4));
      const result: LabResult = {
        id: resultId, taskId: task.id, sampleId, metric: '模拟吸光度', value, unit: 'AU',
        quality: value >= 0.2 && value <= 0.8 ? 'pass' : 'review', createdAt: this.timestamp(),
      };
      this.state.results.unshift(result);
    }
    this.event('info', `已记录 ${task.sampleCount} 条模拟测量结果（非仪器实测）`, task.id, step.deviceId);
  }

  /** 输入真实经过秒数；内部统一应用速率，支持无定时器的确定性测试。 */
  tick(realDeltaSeconds: number): void {
    if (!Number.isFinite(realDeltaSeconds) || realDeltaSeconds < 0 || realDeltaSeconds > 86400) throw new LabError('tick 时长必须为 0–86400 秒');
    if (this.state.simulation.paused) return;
    let remaining = realDeltaSeconds * this.state.simulation.speed;
    this.state.simulation.simTime += remaining;
    this.schedule();
    let guard = 0;
    while (remaining > 1e-9 && guard++ < 10000) {
      const running = this.state.tasks.filter((task) => task.status === 'running' && task.steps[task.currentStepIndex]?.status === 'running');
      if (!running.length) break;
      const slice = Math.min(remaining, ...running.map((task) => {
        const step = task.steps[task.currentStepIndex];
        return step.durationSeconds * (1 - step.progress);
      }));
      for (const task of running) {
        const step = task.steps[task.currentStepIndex];
        step.progress = Math.min(1, step.progress + slice / step.durationSeconds);
        if (step.action === 'move' && step.stationId) {
          const robot = this.device(step.deviceId);
          const origin = this.moveOrigins.get(task.id)!;
          const target = this.dockingPoint(step.stationId);
          const fraction = (step.progress - origin.progress) / Math.max(1e-9, 1 - origin.progress);
          robot.position = [origin.position[0] + (target[0] - origin.position[0]) * fraction, origin.position[1] + (target[1] - origin.position[1]) * fraction];
          if (robot.battery !== undefined) robot.battery = Math.max(0, robot.battery - slice * 0.006);
        }
        if (step.progress >= 1 - 1e-9) {
          step.progress = 1; step.status = 'completed'; step.completedAt = this.timestamp();
          if (step.action === 'measure') this.measurement(task, step);
          this.release(task);
          task.currentStepIndex++;
          if (task.currentStepIndex === task.steps.length) {
            task.status = 'completed'; task.completedAt = this.timestamp(); task.message = '全部步骤已完成';
            this.event('info', `仿真任务完成：${task.name}`, task.id);
          }
        }
        this.updateTaskProgress(task);
      }
      remaining -= slice;
      this.schedule();
    }
    this.changed();
  }

  exportResultsCsv(): string {
    const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const rows: (string | number)[][] = [['数据类型', '任务 ID', '样品 ID', '指标', '数值', '单位', '质量', '记录时间']];
    for (const result of this.state.results) rows.push(['仿真数据（非实测）', result.taskId, result.sampleId, result.metric, result.value, result.unit, result.quality, result.createdAt]);
    return '\uFEFF' + rows.map((row) => row.map(escape).join(',')).join('\r\n') + '\r\n';
  }
}
