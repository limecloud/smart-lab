import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity, ArrowDown, ArrowDownToLine, ArrowRight, ArrowUp, BatteryMedium,
  Bot, Box, Check, CheckCircle2, ChevronDown, ChevronRight, CircleDot, Clock3,
  Database, FlaskConical, Focus, Layers3, LayoutDashboard, LoaderCircle,
  Network, Pause, Play, Plus, Radio, RotateCcw, Save,
  ShieldCheck, Square, Trash2, Unplug, Workflow, X, XCircle,
} from 'lucide-react';
import type { LabDevice, LabState, LabTask, LabWorkflow, SaveWorkflowInput, StepAction, TaskStatus, WorkflowStep } from '../shared/types';
import { formatDuration, formatTime, getState, request } from './api';
import TwinScene from './TwinScene';

type Page = 'overview' | 'workflows' | 'tasks' | 'devices' | 'results';
const navigation: { id: Page; title: string; icon: typeof Activity }[] = [
  { id: 'overview', title: '实验总览', icon: LayoutDashboard },
  { id: 'workflows', title: '流程编排', icon: Workflow },
  { id: 'tasks', title: '实验任务', icon: Layers3 },
  { id: 'devices', title: '设备管理', icon: Bot },
  { id: 'results', title: '实验数据', icon: Database },
];
const taskLabels: Record<TaskStatus, string> = { queued: '排队中', running: '运行中', paused: '已暂停', completed: '已完成', failed: '执行失败', cancelled: '已取消' };
const deviceLabels = { idle: '空闲', busy: '运行中', offline: '离线', fault: '故障' };
const actionLabels: Record<StepAction, string> = { move: '移动到站', pick: '抓取样品', place: '放置样品', process: '样品处理', measure: '仪器测量' };
const pages = {
  overview: { title: '实验室总览', subtitle: '实验设备、移动机器人与实验任务的统一运行视图。' },
  workflows: { title: '流程编排', subtitle: '将实验步骤连接成可重复执行的标准流程。' },
  tasks: { title: '实验任务', subtitle: '从样品到结果，追踪每一个执行步骤。' },
  devices: { title: '设备管理', subtitle: '统一管理移动机器人、实验仪器与工作站。' },
  results: { title: '实验数据', subtitle: '查看可追溯的模拟测量结果与样品记录。' },
};

function Badge({ status, children }: { status: string; children: ReactNode }) {
  return <span className={`badge badge-${status}`}><span />{children}</span>;
}

function Progress({ value, compact = false }: { value: number; compact?: boolean }) {
  const progress = Math.min(100, Math.max(0, value * 100));
  return <div className={`progress-row ${compact ? 'compact' : ''}`}><div className="progress-track"><div style={{ width: `${progress}%` }} /></div><span>{Math.round(progress)}%</span></div>;
}

function Empty({ title, text, icon: Icon = FlaskConical }: { title: string; text: string; icon?: typeof Activity }) {
  return <div className="empty-state"><div><Icon size={26} strokeWidth={1.5} /></div><h3>{title}</h3><p>{text}</p></div>;
}

function Modal({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const body = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    body.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
      if (event.key === 'Tab' && body.current) {
        const elements = body.current.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex="0"]');
        const first = elements[0]; const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => { window.removeEventListener('keydown', handler); previous?.focus(); };
  }, []);
  return <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={body} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}><div className="modal-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="关闭对话框" onClick={onClose}><X size={20} /></button></div>{children}</div></div>;
}

export default function App() {
  const [state, setState] = useState<LabState | null>(null);
  const [connection, setConnection] = useState<'connecting' | 'online' | 'offline'>('connecting');
  const [page, setPage] = useState<Page>('overview');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState('robot-01');
  const [resetToken, setResetToken] = useState(0);
  const [showNewTask, setShowNewTask] = useState(false);
  const [taskForm, setTaskForm] = useState({ workflowId: '', name: '', sampleCount: 8, priority: 'normal' as 'normal' | 'high' });
  const [taskDetailId, setTaskDetailId] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SaveWorkflowInput | null>(null);

  useEffect(() => {
    let active = true;
    let stream: EventSource | undefined;
    async function connect() {
      // 先取得会话 Cookie，再订阅同一实验室，避免云端首次访问创建两个会话。
      try { const data = await getState(); if (active) setState(data); }
      catch (reason) { if (active) setError((reason as Error).message); }
      if (!active) return;
      stream = new EventSource('/api/stream');
      stream.addEventListener('state', (event: MessageEvent<string>) => {
        try { const next = JSON.parse(event.data) as LabState; if (active) { setState(next); setConnection('online'); } }
        catch { if (active) setError('服务器推送了无法读取的状态数据。'); }
      });
      stream.onopen = () => { if (active) setConnection('online'); };
      stream.onerror = () => { if (active) setConnection('offline'); };
    }
    void connect();
    return () => { active = false; stream?.close(); };
  }, []);

  useEffect(() => {
    if (!draft && state?.workflows[0]) chooseWorkflow(state.workflows[0]);
  }, [state, draft]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 4200); return () => window.clearTimeout(timer); }, [toast]);

  async function mutate<T>(path: string, method: string, input: unknown, message?: string): Promise<T | undefined> {
    setError(''); setBusy(true);
    try {
      const result = await request<T>(path, method, input);
      setState(await getState());
      if (message) setToast(message);
      return result;
    } catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败，请重试。'); return undefined; }
    finally { setBusy(false); }
  }

  function openNewTask(workflowId?: string) {
    setError('');
    const workflow = state?.workflows.find((item) => item.id === workflowId) ?? state?.workflows[0];
    setTaskForm({ workflowId: workflow?.id ?? '', name: '', sampleCount: workflow?.sampleCount ?? 8, priority: 'normal' });
    setShowNewTask(true);
  }

  async function createTask(event: FormEvent) {
    event.preventDefault();
    const task = await mutate<LabTask>('/tasks', 'POST', { ...taskForm, name: taskForm.name.trim() || undefined }, '实验任务已加入执行队列');
    if (task) { setShowNewTask(false); setTaskDetailId(task.id); }
  }

  async function startDemo() {
    setError(''); setBusy(true);
    try {
      if (state?.simulation.paused) await request('/simulation', 'POST', { paused: false });
      await request('/tasks', 'POST', { workflowId: 'workflow-standard', name: '协同演示 · 标准样品分析', sampleCount: 8 });
      await request('/tasks', 'POST', { workflowId: 'workflow-preparation', name: '协同演示 · 样品前处理', sampleCount: 6 });
      setState(await getState());
      setToast('协同演示已启动，两台机器人由任务调度器驱动运行');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '演示任务创建失败');
      getState().then(setState).catch(() => {});
    } finally { setBusy(false); }
  }

  function chooseWorkflow(workflow: LabWorkflow) {
    setEditingId(workflow.id);
    setDraft({ name: workflow.name, description: workflow.description, sampleCount: workflow.sampleCount, steps: structuredClone(workflow.steps) });
  }

  function newStep(): WorkflowStep {
    return { id: crypto.randomUUID(), name: '移动到样品准备台', action: 'move', deviceId: 'robot-01', stationId: 'station-prep', durationSeconds: 6 };
  }

  function updateStep(index: number, update: Partial<WorkflowStep>) {
    setDraft((current) => current ? { ...current, steps: current.steps.map((step, i) => i === index ? { ...step, ...update } : step) } : null);
  }

  async function saveWorkflow(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const saved = await mutate<LabWorkflow>(editingId ? `/workflows/${editingId}` : '/workflows', editingId ? 'PUT' : 'POST', draft, '实验流程已保存');
    if (saved) chooseWorkflow(saved);
  }

  async function taskAction(task: LabTask, action: 'pause' | 'resume' | 'cancel' | 'retry') {
    const labels = { pause: '任务已暂停', resume: '任务已继续', cancel: '任务已取消', retry: '任务已重新加入队列' };
    await mutate(`/tasks/${task.id}`, 'PATCH', { action }, labels[action]);
  }

  const devices = state?.devices ?? [];
  const workflows = state?.workflows ?? [];
  const tasks = [...(state?.tasks ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const events = [...(state?.events ?? [])].sort((a, b) => b.time.localeCompare(a.time));
  const results = [...(state?.results ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const selectedDevice = devices.find((device) => device.id === selectedDeviceId) ?? devices[0];
  const taskDetail = tasks.find((task) => task.id === taskDetailId);
  const activeTasks = tasks.filter((task) => task.status === 'running' || task.status === 'queued');
  const completedTasks = tasks.filter((task) => task.status === 'completed');
  const onlineDevices = devices.filter((device) => device.status !== 'offline' && device.status !== 'fault');
  const date = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });

  function taskControls(task: LabTask, compact = false) {
    return <div className="task-actions">
      {(task.status === 'running' || task.status === 'queued') && <button className={compact ? 'icon-button' : 'button secondary small'} aria-label={`暂停任务 ${task.name}`} disabled={busy} onClick={() => taskAction(task, 'pause')}><Pause size={14} />{!compact && '暂停'}</button>}
      {task.status === 'paused' && <button className={compact ? 'icon-button' : 'button primary small'} aria-label={`继续任务 ${task.name}`} disabled={busy} onClick={() => taskAction(task, 'resume')}><Play size={14} />{!compact && '继续'}</button>}
      {task.status === 'failed' && <button className={compact ? 'icon-button' : 'button secondary small'} aria-label={`重试任务 ${task.name}`} disabled={busy} onClick={() => taskAction(task, 'retry')}><RotateCcw size={14} />{!compact && '重试'}</button>}
      {!['completed', 'failed', 'cancelled'].includes(task.status) && <button className={compact ? 'icon-button danger' : 'button secondary small danger'} aria-label={`取消任务 ${task.name}`} disabled={busy} onClick={() => taskAction(task, 'cancel')}><Square size={13} />{!compact && '取消'}</button>}
    </div>;
  }

  function taskTable(items: LabTask[], expanded = false) {
    return !items.length ? <Empty title="还没有实验任务" text="从一个实验流程开始，创建你的第一项模拟实验。" /> : <div className="table-scroll"><table><thead><tr><th>实验任务</th><th>流程 / 样品</th><th>执行进度</th><th>状态</th>{expanded && <th>创建时间</th>}<th className="align-right">操作</th></tr></thead><tbody>{items.map((task) => <tr key={task.id}><td><button className="task-name" onClick={() => setTaskDetailId(task.id)}><span className="table-icon"><FlaskConical size={17} /></span><span><strong>{task.name}</strong><small>{task.id.slice(0, 18)}</small></span></button></td><td><span className="cell-title">{task.workflowName}</span><small className="cell-muted">{task.sampleCount} 个样品{task.priority === 'high' && ' · 高优先级'}</small></td><td><Progress value={task.progress} compact /><small className="cell-muted">{task.steps.filter((step) => step.status === 'completed').length} / {task.steps.length} 步骤</small></td><td><Badge status={task.status}>{taskLabels[task.status]}</Badge></td>{expanded && <td className="muted tabular">{formatTime(task.createdAt)}</td>}<td><div className="table-actions">{taskControls(task, true)}<button className="icon-button" aria-label={`查看任务 ${task.name}`} onClick={() => setTaskDetailId(task.id)}><ChevronRight size={18} /></button></div></td></tr>)}</tbody></table></div>;
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setPage('overview'); }} aria-label="LimeLab 实验总览"><div className="brand-mark"><FlaskConical size={23} strokeWidth={1.6} /></div><div>Lime<span>Lab</span><small>智能实验室</small></div></a>
      <div className="workspace-switch"><div className="workspace-icon"><Network size={16} /></div><span>智慧实验室 <small>研发中心 · A 区</small></span><ChevronDown size={14} /></div>
      <div className="nav-label">工作空间</div>
      <nav aria-label="主要导航">{navigation.map(({ id, title, icon: Icon }) => <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => setPage(id)} aria-label={title} aria-current={page === id ? 'page' : undefined}><Icon size={19} strokeWidth={1.65} /><span>{title}</span>{id === 'tasks' && activeTasks.length > 0 && <em>{activeTasks.length}</em>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="simulation-card"><div><ShieldCheck size={17} /><strong>仿真工作空间</strong></div><p>所有设备与测量数据均为模拟。<br />放心探索你的实验流程。</p><span><span className="status-dot" /> 本地运行 · 数据持久化</span></div><div className="user-profile"><div className="avatar">L</div><span>实验室管理员<small>本地工作空间</small></span><span className="profile-dot" /></div></div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><span>工作空间</span><ChevronRight size={14} /><strong>{pages[page].title}</strong></div><div className="topbar-right"><span className={`connection ${connection}`}><span />{connection === 'online' ? '实时连接正常' : connection === 'connecting' ? '正在连接' : '连接中断 · 自动重连'}</span><span className="topbar-separator" /><span className="date-text">{date}</span><div className="topbar-avatar" aria-label="本地管理员">L</div></div></header>
      <main className={page === 'overview' ? 'overview-main' : ''}>
        <div className="page-heading"><div><div className="eyebrow"><span /> LIME LAB / A-01</div><h1>{pages[page].title}</h1><p>{pages[page].subtitle}</p></div><div className="page-heading-actions"><span className="simulation-label"><Box size={13} /> 仿真模式</span><button className="button primary" disabled={!state || busy || !workflows.length} onClick={() => openNewTask()}><Plus size={17} /> 新建实验</button></div></div>

        {error && !showNewTask && !taskDetail && <div className="error-banner" role="alert"><XCircle size={18} /><span>{error}</span><button aria-label="关闭错误提示" onClick={() => setError('')}><X size={15} /></button></div>}
        {connection === 'offline' && state && <div className="offline-banner"><Unplug size={16} />正在尝试重新连接服务器。当前显示最后一次接收到的状态。</div>}

        {!state ? <div className="loading-state"><LoaderCircle className="spin" size={28} /><h2>正在连接实验室</h2><p>加载设备、实验流程与任务状态…</p><button className="button secondary" onClick={() => getState().then(setState).catch((reason: Error) => setError(reason.message))}>重新连接</button></div> : <>
          {page === 'overview' && <>
            <section className="stats-grid" aria-label="实验室关键指标">
              <div className="stat-card"><div><span>在线设备</span><span className="stat-icon green"><Bot size={19} /></span></div><strong>{onlineDevices.length}<small>/ {devices.length}</small></strong><p><span className="tiny-dot green" />{devices.filter((item) => item.status === 'busy').length} 台正在执行任务<span>状态实时同步</span></p></div>
              <div className="stat-card"><div><span>进行中的实验</span><span className="stat-icon blue"><Activity size={19} /></span></div><strong>{activeTasks.length}<small>项</small></strong><p><span className="tiny-dot blue" />{tasks.filter((item) => item.status === 'running').length} 运行 · {tasks.filter((item) => item.status === 'queued').length} 等待<span>智能调度</span></p></div>
              <div className="stat-card"><div><span>已完成实验</span><span className="stat-icon amber"><CheckCircle2 size={19} /></span></div><strong>{completedTasks.length}<small>项</small></strong><p><span className="tiny-dot amber" />累计完成 {completedTasks.reduce((sum, task) => sum + task.sampleCount, 0)} 个样品<span>完整流程</span></p></div>
              <div className="stat-card"><div><span>测量记录</span><span className="stat-icon purple"><Database size={19} /></span></div><strong>{results.length}<small>条</small></strong><p><span className="tiny-dot purple" />{results.filter((item) => item.quality === 'pass').length} 条通过质量检查<span>模拟结果</span></p></div>
            </section>

            <div className="overview-grid"><section className="panel scene-panel"><div className="panel-heading"><div><h2><span className="title-dot" />实验室数字孪生<span className="scene-version">TWIN / A-01</span></h2><p>交互式三维仿真，支持自由旋转、平移、缩放与实时任务联动</p></div><button className="icon-button" aria-label="重置三维视角" title="重置场景视角" onClick={() => setResetToken((value) => value + 1)}><Focus size={18} /></button></div><TwinScene devices={devices} tasks={tasks} selectedId={selectedDeviceId} onSelect={setSelectedDeviceId} resetToken={resetToken} paused={state.simulation.paused} onStartDemo={startDemo} busy={busy} /><div className="simulation-toolbar"><div className="sim-time"><Clock3 size={15} /><span>仿真时间</span><strong>{formatDuration(state.simulation.simTime)}</strong></div><div className="simulation-controls"><select aria-label="仿真运行速度" value={state.simulation.speed} disabled={busy} onChange={(event) => mutate('/simulation', 'POST', { speed: Number(event.target.value) })}><option value={0.5}>0.5× 速度</option><option value={1}>1× 速度</option><option value={2}>2× 速度</option><option value={4}>4× 速度</option></select><button className={`button ${state.simulation.paused ? 'primary' : 'secondary'} small`} disabled={busy} onClick={() => mutate('/simulation', 'POST', { paused: !state.simulation.paused })}>{state.simulation.paused ? <Play size={14} /> : <Pause size={14} />}{state.simulation.paused ? '继续仿真' : '暂停仿真'}</button></div></div></section>

              <aside className="overview-side"><section className="panel selected-panel"><div className="panel-heading"><h2>设备实时遥测</h2><span className="telemetry-live"><span />LIVE</span></div>{selectedDevice && <><div className={`device-product-preview ${selectedDevice.kind}`}><div className="product-grid" />{selectedDevice.kind === 'robot' ? <><Bot size={65} strokeWidth={1} /><img src={`/assets/twin/robot-${selectedDevice.id === 'robot-01' ? 'flare' : 'sunburst'}.png`} alt={selectedDevice.name} onError={(event) => { event.currentTarget.style.display = 'none'; }} /></> : <Box size={58} strokeWidth={1} />}<span>{selectedDevice.kind === 'robot' ? 'MOBILE MANIPULATOR' : 'LABORATORY WORKSTATION'}</span></div><div className="selected-device"><div className={`device-avatar ${selectedDevice.kind}`} >{selectedDevice.kind === 'robot' ? <Bot size={27} strokeWidth={1.4} /> : <Box size={27} strokeWidth={1.4} />}</div><div><h3>{selectedDevice.name}</h3><small>{selectedDevice.kind === 'robot' ? '自主移动复合机器人' : '自动化实验工作站'}</small></div></div><div className="device-status-row"><span>运行状态</span><Badge status={selectedDevice.status}>{deviceLabels[selectedDevice.status]}</Badge></div><div className="device-facts"><div><span>设备编号</span><strong>{selectedDevice.id.toUpperCase()}</strong></div><div><span>当前坐标</span><strong className="tabular">{selectedDevice.position.map((coordinate) => coordinate.toFixed(2)).join(', ')} <small>m</small></strong></div>{selectedDevice.battery !== undefined && <div><span>电池电量</span><strong className="battery-value"><BatteryMedium size={17} />{Math.round(selectedDevice.battery)}%</strong></div>}<div><span>连接方式</span><strong>模拟驱动 <span className="tiny-dot green" /></strong></div></div>{selectedDevice.activeTaskId ? <div className="device-task"><Activity size={15} /><span>{tasks.find((task) => task.id === selectedDevice.activeTaskId)?.name ?? '正在执行实验任务'}</span></div> : <div className="device-task idle"><CircleDot size={15} /><span>设备就绪，等待下一项实验</span></div>}<button className="text-button device-link" onClick={() => setPage('devices')}>查看所有设备 <ArrowRight size={14} /></button></>}</section>
              <section className="panel current-task-panel"><div className="panel-heading"><h2>当前任务</h2><span className="count-pill">{activeTasks.length}</span></div>{(() => { const active = tasks.find((task) => task.status === 'running') ?? activeTasks[0]; return active ? <div className="current-task-body"><div><span className="current-task-symbol"><FlaskConical size={17} /></span><strong>{active.name}</strong></div><p>{active.steps[active.currentStepIndex]?.name ?? active.message}</p><Progress value={active.progress} /><footer><span>{active.sampleCount} 个样品 · {active.currentStepIndex + 1}/{active.steps.length} 步</span><button className="text-button" onClick={() => setTaskDetailId(active.id)}>任务详情 <ArrowRight size={12} /></button></footer></div> : <div className="current-task-idle"><CheckCircle2 size={18} /><span>暂无正在执行的任务</span></div>; })()}</section><section className="panel activity-panel"><div className="panel-heading"><h2>实时动态</h2><span className="pulse-dot" /></div><div className="activity-list">{events.slice(0, 4).map((event) => <div className={`activity-item ${event.level}`} key={event.id}><span className="activity-pin" /><div><p>{event.message}</p><time>{formatTime(event.time)}</time></div></div>)}{!events.length && <p className="muted">等待实验室活动…</p>}</div></section></aside>
            </div>
            <section className="panel recent-tasks"><div className="panel-heading"><div className="heading-inline"><h2>最近实验</h2><span className="count-pill">{tasks.length}</span></div><button className="text-button" onClick={() => setPage('tasks')}>查看全部 <ArrowRight size={14} /></button></div>{taskTable(tasks.slice(0, 4))}</section>
          </>}

          {page === 'workflows' && <div className="workflow-layout"><aside className="panel workflow-library"><div className="panel-heading"><h2>实验流程</h2><span className="count-pill">{workflows.length}</span></div><div className="workflow-template-list">{workflows.map((workflow) => <button key={workflow.id} className={`workflow-template ${editingId === workflow.id ? 'active' : ''}`} onClick={() => chooseWorkflow(workflow)}><span className="template-icon"><Workflow size={20} /></span><strong>{workflow.name}</strong><p>{workflow.description}</p><small>{workflow.steps.length} 个步骤<span>·</span>{workflow.sampleCount} 个样品</small><ChevronRight size={15} /></button>)}</div><button className="button secondary new-workflow" onClick={() => { setEditingId(null); setDraft({ name: '新建实验流程', description: '', sampleCount: 8, steps: [newStep()] }); }}><Plus size={16} />新建流程</button></aside><section className="panel workflow-editor">{draft && <form onSubmit={saveWorkflow}><div className="panel-heading"><div><h2>{editingId ? '编辑实验流程' : '创建实验流程'}</h2><p>步骤按顺序执行，调度器自动管理设备占用。</p></div><div className="editor-heading-actions">{editingId && <button className="button secondary small" type="button" disabled={busy} onClick={() => openNewTask(editingId)}><Play size={14} />运行流程</button>}<button className="button primary small" type="submit" disabled={busy}><Save size={14} />保存流程</button></div></div><div className="workflow-form"><div className="form-grid"><label>流程名称<input aria-label="流程名称" value={draft.name} required maxLength={100} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label>默认样品数<input aria-label="默认样品数" type="number" min={1} max={96} value={draft.sampleCount} required onChange={(event) => setDraft({ ...draft, sampleCount: Number(event.target.value) })} /></label></div><label>流程说明<textarea aria-label="流程说明" rows={2} value={draft.description} maxLength={500} placeholder="描述实验目的、样品与预期结果" onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label><div className="flow-section-heading"><h3>执行步骤</h3><span>共 {draft.steps.length} 步 · 预计 {draft.steps.reduce((sum, step) => sum + step.durationSeconds, 0)} 秒仿真时间</span></div><div className="step-list">{draft.steps.map((step, index) => <div className="workflow-step" key={step.id}><div className="step-rail"><span>{String(index + 1).padStart(2, '0')}</span>{index < draft.steps.length - 1 && <i />}</div><div className="step-card"><div className="step-card-heading"><input aria-label={`步骤 ${index + 1} 名称`} value={step.name} required maxLength={100} onChange={(event) => updateStep(index, { name: event.target.value })} /><div><button className="icon-button" type="button" aria-label={`上移步骤 ${index + 1}`} disabled={index === 0} onClick={() => { const next = [...draft.steps]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; setDraft({ ...draft, steps: next }); }}><ArrowUp size={14} /></button><button className="icon-button" type="button" aria-label={`下移步骤 ${index + 1}`} disabled={index === draft.steps.length - 1} onClick={() => { const next = [...draft.steps]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; setDraft({ ...draft, steps: next }); }}><ArrowDown size={14} /></button><button className="icon-button danger" type="button" aria-label={`删除步骤 ${index + 1}`} disabled={draft.steps.length <= 1} onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, i) => i !== index) })}><Trash2 size={14} /></button></div></div><div className="step-fields"><label>执行动作<select aria-label={`步骤 ${index + 1} 执行动作`} value={step.action} onChange={(event) => { const action = event.target.value as StepAction; const robotAction = ['move', 'pick', 'place'].includes(action); const device = devices.find((item) => item.capabilities.includes(action) && item.kind === (robotAction ? 'robot' : 'station')); updateStep(index, { action, deviceId: device?.id ?? '', stationId: robotAction ? (step.stationId ?? 'station-prep') : undefined }); }}>{Object.entries(actionLabels).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label><label>执行设备<select aria-label={`步骤 ${index + 1} 执行设备`} value={step.deviceId} required onChange={(event) => updateStep(index, { deviceId: event.target.value })}>{devices.filter((device) => device.capabilities.includes(step.action) && device.kind === (['move', 'pick', 'place'].includes(step.action) ? 'robot' : 'station')).map((device) => <option value={device.id} key={device.id}>{device.name}</option>)}</select></label>{['move', 'pick', 'place'].includes(step.action) && <label>目标工作站<select aria-label={`步骤 ${index + 1} 目标工作站`} required value={step.stationId ?? ''} onChange={(event) => updateStep(index, { stationId: event.target.value })}>{devices.filter((device) => device.kind === 'station').map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label>}<label className="duration-field">时长（秒）<input aria-label={`步骤 ${index + 1} 时长`} required type="number" min={1} max={600} value={step.durationSeconds} onChange={(event) => updateStep(index, { durationSeconds: Number(event.target.value) })} /></label></div></div></div>)}</div><button className="add-step-button" type="button" onClick={() => setDraft({ ...draft, steps: [...draft.steps, newStep()] })}><Plus size={17} />添加执行步骤</button><div className="editor-note"><ShieldCheck size={16} />更改流程不会影响已创建任务的步骤快照。所有动作通过模拟设备执行。</div></div></form>}</section></div>}

          {page === 'tasks' && <section className="panel tasks-panel"><div className="panel-heading"><div className="filter-tabs" role="tablist" aria-label="任务状态筛选">{[['all', '全部任务'], ['running', '运行中'], ['queued', '排队中'], ['paused', '已暂停'], ['completed', '已完成'], ['failed', '执行失败']].map(([id, title]) => <button key={id} className={taskFilter === id ? 'active' : ''} role="tab" aria-selected={taskFilter === id} onClick={() => setTaskFilter(id)}>{title}<span>{id === 'all' ? tasks.length : tasks.filter((task) => task.status === id).length}</span></button>)}</div><span className="subtle-label">任务状态实时更新</span></div>{taskTable(tasks.filter((task) => taskFilter === 'all' || task.status === taskFilter), true)}</section>}

          {page === 'devices' && <><div className="section-caption"><span><Radio size={16} />{devices.length} 台设备接入当前实验室</span><span className="muted">连接方式：模拟驱动</span></div><div className="devices-grid">{devices.map((device) => <section className={`panel device-card ${device.status === 'fault' ? 'fault' : ''}`} key={device.id}><div className="device-card-top"><div className={`device-avatar ${device.kind}`}>{device.kind === 'robot' ? <Bot size={31} strokeWidth={1.4} /> : <Box size={31} strokeWidth={1.4} />}</div><Badge status={device.status}>{deviceLabels[device.status]}</Badge></div><h2>{device.name}</h2><p>{device.category}</p><div className="device-card-facts"><div><span>设备编号</span><strong>{device.id}</strong></div><div><span>当前坐标</span><strong>{device.position.map((coordinate) => coordinate.toFixed(2)).join(', ')} m</strong></div>{device.battery !== undefined && <div><span>电池电量</span><strong className="battery-value"><BatteryMedium size={16} />{Math.round(device.battery)}%</strong></div>}<div><span>连接方式</span><strong><span className="tiny-dot green" />模拟驱动</strong></div></div><div className="capability-tags">{device.capabilities.map((capability) => <span key={capability}>{actionLabels[capability]}</span>)}</div><div className="device-card-footer"><label>设备状态<select aria-label={`设备状态 ${device.name}`} value={device.status} disabled={busy} onChange={(event) => mutate(`/devices/${device.id}`, 'PATCH', { status: event.target.value }, '设备状态已更新')}>{device.status === 'busy' && <option value="busy" disabled>运行中</option>}<option value="idle">空闲 · 在线</option><option value="offline">离线</option><option value="fault">模拟故障</option></select></label><button className="icon-button" aria-label={`在三维场景查看 ${device.name}`} onClick={() => { setSelectedDeviceId(device.id); setPage('overview'); }}><Focus size={18} /></button></div></section>)}</div><div className="info-strip"><ShieldCheck size={17} /><span>运行中的设备由调度器管理。尝试切换占用中设备的状态时，服务器会拒绝操作并显示原因。</span></div></>}

          {page === 'results' && <><div className="results-summary"><div><span className="result-big-icon"><Database size={28} strokeWidth={1.4} /></span><div><span>可追溯测量记录</span><strong>{results.length}<small>条模拟数据</small></strong></div></div><div><span className="quality-dot" />{results.filter((result) => result.quality === 'pass').length} 条通过<span className="result-divider" />{results.filter((result) => result.quality === 'review').length} 条待复核</div><a className="button secondary" href="/api/results/export.csv" download><ArrowDownToLine size={16} />导出 CSV</a></div><section className="panel result-chart-panel"><div className="panel-heading"><div><h2>最近测量趋势</h2><p>按最近记录排列 · 原始值可在下表查询</p></div><span className="simulation-label">模拟数据</span></div>{results.length ? <div className="chart-wrap"><div className="chart-y-axis"><span>{Math.max(...results.slice(0, 30).map((result) => result.value)).toFixed(2)}</span><span>吸光度 / AU</span><span>0</span></div><svg viewBox="0 0 900 140" role="img" aria-label="最近三十条模拟测量结果趋势图" preserveAspectRatio="none"><defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#19a17f" stopOpacity=".2" /><stop offset="1" stopColor="#19a17f" stopOpacity="0" /></linearGradient></defs>{[25, 65, 105].map((y) => <line key={y} x1="0" y1={y} x2="900" y2={y} stroke="#e8eeeb" strokeDasharray="4 4" />)}{(() => { const points = [...results.slice(0, 30)].reverse(); const max = Math.max(1, ...points.map((point) => point.value)); const coords = points.map((point, index) => `${points.length === 1 ? 450 : index / (points.length - 1) * 880 + 10},${125 - point.value / max * 110}`); return <><polygon points={`10,140 ${coords.join(' ')} 890,140`} fill="url(#chartFill)" /><polyline points={coords.join(' ')} fill="none" stroke="#159b78" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />{coords.map((point, index) => { const [cx, cy] = point.split(','); return <circle key={points[index].id} cx={cx} cy={cy} r="3" fill="#159b78"><title>{points[index].sampleId}: {points[index].value} {points[index].unit}</title></circle>; })}</>; })()}</svg></div> : <Empty title="等待第一条测量记录" text="运行包含“仪器测量”的实验流程，完成后会在这里生成样品结果。" icon={Activity} />}</section><section className="panel results-table"><div className="panel-heading"><h2>样品测量结果</h2><span className="subtle-label">结果均为仿真生成，不代表实际仪器测量</span></div>{results.length ? <div className="table-scroll"><table><thead><tr><th>样品编号</th><th>所属任务</th><th>测量指标</th><th>测量数值</th><th>质量标记</th><th>记录时间</th></tr></thead><tbody>{results.map((result) => <tr key={result.id}><td className="result-sample"><FlaskConical size={15} />{result.sampleId}</td><td><button className="text-button" onClick={() => setTaskDetailId(result.taskId)}>{tasks.find((task) => task.id === result.taskId)?.name ?? result.taskId.slice(0, 12)}</button></td><td>{result.metric}</td><td className="tabular"><strong>{result.value.toFixed(4)}</strong><span className="cell-unit">{result.unit}</span></td><td><Badge status={result.quality === 'pass' ? 'completed' : 'paused'}>{result.quality === 'pass' ? '通过' : '待复核'}</Badge></td><td className="tabular muted">{formatTime(result.createdAt)}</td></tr>)}</tbody></table></div> : <Empty title="暂无测量结果" text="创建并运行实验后，测量结果将自动归档至此。" icon={Database} />}</section></>}
        </>}
        <footer className="page-footer"><span><ShieldCheck size={13} />LimeLab · 智能实验室仿真平台</span><span>SIMULATION WORKSPACE <span className="footer-dot" /> v0.1.0</span></footer>
      </main>
    </div>

    {toast && <div className="toast" role="status"><CheckCircle2 size={18} />{toast}<button onClick={() => setToast('')} aria-label="关闭成功提示"><X size={14} /></button></div>}
    {error && (showNewTask || taskDetail) && <div className="modal-error" role="alert"><XCircle size={18} /><span>{error}</span><button aria-label="关闭错误提示" onClick={() => setError('')}><X size={15} /></button></div>}
    {showNewTask && <Modal title="新建实验任务" subtitle="选择实验流程，调度器将自动安排模拟设备。" onClose={() => setShowNewTask(false)}><form onSubmit={createTask} className="modal-form"><label>任务名称<input aria-label="任务名称" placeholder="留空时自动生成任务名称" value={taskForm.name} maxLength={100} onChange={(event) => setTaskForm({ ...taskForm, name: event.target.value })} /></label><label>实验流程<select aria-label="实验流程" required value={taskForm.workflowId} onChange={(event) => { const workflow = workflows.find((item) => item.id === event.target.value); setTaskForm({ ...taskForm, workflowId: event.target.value, sampleCount: workflow?.sampleCount ?? 8 }); }}>{workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</select></label>{(() => { const workflow = workflows.find((item) => item.id === taskForm.workflowId); return workflow && <div className="selected-workflow-info"><Workflow size={18} /><span>{workflow.description}<small>{workflow.steps.length} 个执行步骤 · 预计 {workflow.steps.reduce((sum, step) => sum + step.durationSeconds, 0)} 秒仿真时间</small></span></div>; })()}<div className="form-grid"><label>样品数量<input aria-label="样品数量" type="number" min={1} max={96} required value={taskForm.sampleCount} onChange={(event) => setTaskForm({ ...taskForm, sampleCount: Number(event.target.value) })} /></label><label>任务优先级<select aria-label="任务优先级" value={taskForm.priority} onChange={(event) => setTaskForm({ ...taskForm, priority: event.target.value as 'normal' | 'high' })}><option value="normal">普通优先级</option><option value="high">高优先级</option></select></label></div><div className="editor-note"><ShieldCheck size={16} />任务通过模拟驱动执行，不会向真实机器人发送指令。</div><div className="modal-actions"><button className="button secondary" type="button" onClick={() => setShowNewTask(false)}>取消</button><button className="button primary" type="submit" disabled={busy || !taskForm.workflowId}>{busy ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}创建并运行</button></div></form></Modal>}
    {taskDetail && <Modal title={taskDetail.name} subtitle={`${taskDetail.workflowName} · ${taskDetail.sampleCount} 个样品 · ${taskDetail.id}`} onClose={() => setTaskDetailId(null)} wide><div className="task-detail-summary"><Badge status={taskDetail.status}>{taskLabels[taskDetail.status]}</Badge><span>创建于 {formatTime(taskDetail.createdAt)}</span><div>{taskControls(taskDetail)}</div></div><div className="task-detail-progress"><Progress value={taskDetail.progress} />{taskDetail.message && <p>{taskDetail.message}</p>}</div><div className="task-detail-columns"><section><h3>执行步骤 <span>{taskDetail.steps.length}</span></h3><div className="task-step-list">{taskDetail.steps.map((step, index) => <div className={`task-step-item ${step.status}`} key={step.id}><span className="task-step-number">{step.status === 'completed' ? <Check size={14} /> : step.status === 'running' ? <LoaderCircle className="spin" size={14} /> : index + 1}</span><div><strong>{step.name}</strong><small>{actionLabels[step.action]} · {devices.find((device) => device.id === step.deviceId)?.name ?? step.deviceId} · {step.durationSeconds}s</small>{step.status === 'running' && <Progress value={step.progress} compact />}</div><span className="task-step-state">{step.status === 'completed' ? '已完成' : step.status === 'running' ? '执行中' : step.status === 'failed' ? '失败' : '待执行'}</span></div>)}</div></section><section><h3>执行日志</h3><div className="task-log-list">{events.filter((event) => event.taskId === taskDetail.id).slice(0, 35).map((event) => <div className={`task-log ${event.level}`} key={event.id}><time>{formatTime(event.time)}</time><p>{event.message}</p></div>)}{!events.some((event) => event.taskId === taskDetail.id) && <p className="muted">等待任务执行日志…</p>}</div></section></div><div className="modal-bottom-note"><ShieldCheck size={14} />此任务的动作与数据均为模拟，步骤快照独立于原始流程。</div></Modal>}
  </div>;
}
