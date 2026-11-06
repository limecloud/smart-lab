import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Activity, Bot, Box, CheckCircle2, CircleDot, Film, Focus, Layers3, LoaderCircle, Minus, MousePointer2, Play, Plus, Route, ScanLine, X } from 'lucide-react';
import type { LabDevice, LabTask } from '../shared/types';
import LabScene from './LabScene';
import { dockingPosition, projectDeviceAnchor, projectPosition, type Point2D, type TwinModel } from './twinProjection';

interface Props {
  devices: LabDevice[];
  tasks: LabTask[];
  selectedId: string;
  onSelect: (id: string) => void;
  resetToken: number;
  paused: boolean;
  onStartDemo: () => void;
  busy: boolean;
}

const statusLabels = { idle: '就绪', busy: '执行中', offline: '已离线', fault: '设备故障' };
const shortNames: Record<string, string> = { 'station-prep': '样品准备台', 'station-hood': '通风操作柜', 'station-analyzer': '自动分析仪', 'station-storage': '样品存储站' };

function useImageAsset(source: string) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLoaded(false);
    const load = () => {
      const asset = new Image();
      asset.onload = () => { if (alive) setLoaded(true); };
      asset.onerror = () => { if (alive) timer = setTimeout(load, 12000); };
      asset.src = source;
    };
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, [source]);
  return loaded;
}

export default function TwinScene({ devices, tasks, selectedId, onSelect, resetToken, paused, onStartDemo, busy }: Props) {
  const [mode, setMode] = useState<'realistic' | 'fused'>('fused');
  const [model, setModel] = useState<TwinModel>('flare');
  const [routes, setRoutes] = useState(true);
  const [labels, setLabels] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [preview, setPreview] = useState(false);
  const [gifError, setGifError] = useState(false);
  const [robotErrors, setRobotErrors] = useState<string[]>([]);
  const [localReset, setLocalReset] = useState(0);
  const [paths, setPaths] = useState<Record<string, Point2D[]>>({});
  const stage = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const background = `/assets/twin/lab-${model}.png`;
  const imageReady = useImageAsset(background);
  const robots = devices.filter((device) => device.kind === 'robot');
  const stations = devices.filter((device) => device.kind === 'station');
  const activeTask = tasks.find((task) => task.status === 'running') ?? tasks.find((task) => task.status === 'queued');
  const activeStep = activeTask?.steps[activeTask.currentStepIndex];
  const offlineCount = devices.filter((device) => device.status === 'offline' || device.status === 'fault').length;

  useEffect(() => {
    if (!preview) return;
    const closePreview = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreview(false); };
    window.addEventListener('keydown', closePreview);
    return () => window.removeEventListener('keydown', closePreview);
  }, [preview]);

  useEffect(() => { setZoom(1); setOffset({ x: 0, y: 0 }); setLocalReset((value) => value + 1); }, [resetToken]);
  useEffect(() => { setRobotErrors([]); setPaths({}); }, [model]);
  useEffect(() => {
    setPaths((previous) => {
      const next = { ...previous };
      let changed = false;
      for (const robot of robots) {
        const point = projectPosition(robot.position, model);
        const old = next[robot.id] ?? [];
        const last = old.at(-1);
        if (!last || Math.hypot(last.x - point.x, last.y - point.y) > 0.24) {
          next[robot.id] = [...old.slice(-85), point]; changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [devices, model]);

  function zoomBy(delta: number) { setZoom((value) => Math.min(2, Math.max(1, Number((value + delta).toFixed(1))))); }
  function pointerDown(event: ReactPointerEvent) {
    if (zoom <= 1 || (event.target as HTMLElement).closest('button')) return;
    dragging.current = { x: event.clientX, y: event.clientY, originX: offset.x, originY: offset.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: ReactPointerEvent) {
    if (!dragging.current) return;
    const bound = (zoom - 1) * 200;
    setOffset({ x: Math.min(bound, Math.max(-bound, dragging.current.originX + event.clientX - dragging.current.x)), y: Math.min(bound, Math.max(-bound, dragging.current.originY + event.clientY - dragging.current.y)) });
  }

  return <div className={`twin-experience ${mode === 'fused' ? 'is-3d' : ''}`}>
    <div className="twin-mode-bar"><div className="twin-mode-switch" aria-label="数字孪生视图模式"><button aria-pressed={mode === 'fused'} className={mode === 'fused' ? 'active' : ''} onClick={() => setMode('fused')}><Box size={14} />融合孪生</button><button aria-pressed={mode === 'realistic'} className={mode === 'realistic' ? 'active' : ''} onClick={() => setMode('realistic')}><ScanLine size={14} />写实参考</button></div><div className="twin-layer-controls"><select aria-label="写实素材模型" value={model} onChange={(event) => setModel(event.target.value as TwinModel)}><option value="flare">Flare 材质</option><option value="sunburst">Sunburst 材质</option></select><button className={routes ? 'active' : ''} aria-label="显示移动轨迹" aria-pressed={routes} onClick={() => setRoutes((value) => !value)} title="移动轨迹"><Route size={15} /><span>轨迹</span></button><button className={labels ? 'active' : ''} aria-label="显示设备标签" aria-pressed={labels} onClick={() => setLabels((value) => !value)} title="设备标签"><Layers3 size={15} /><span>标签</span></button><button aria-label="预览仿真演示 GIF" title="预览仿真演示 GIF" onClick={() => { setPreview(true); setGifError(false); }}><Film size={15} /><span>演示</span></button></div></div>

    {mode === 'realistic' && imageReady ? <div ref={stage} className={`twin-stage ${zoom > 1 ? 'can-pan' : ''}`} data-testid="lab-scene" data-mode="realistic" data-model={model} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { dragging.current = null; }} onPointerCancel={() => { dragging.current = null; }}>
      <div className="twin-world" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}>
        <img className="twin-background" src={background} alt={`${model === 'flare' ? 'Flare' : 'Sunburst'} 模型生成的等距智能实验室环境，机器人由实时状态独立叠加`} draggable={false} />
        <div className="twin-photo-shade" />
        {routes && <svg className="twin-routes" viewBox="0 0 1000 562.5" aria-label="机器人实际移动轨迹与当前目标路线"><defs><filter id="routeGlow"><feGaussianBlur stdDeviation="2" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>{robots.map((robot, index) => {
          const path = paths[robot.id] ?? [];
          const current = projectPosition(robot.position, model);
          const task = tasks.find((item) => item.id === robot.activeTaskId);
          const step = task?.steps[task.currentStepIndex];
          const targetStation = step?.stationId ? devices.find((device) => device.id === step.stationId) : undefined;
          const target = targetStation ? projectPosition(dockingPosition(targetStation.position), model) : undefined;
          const color = index === 0 ? '#53e4bd' : '#70b5ff';
          return <g key={robot.id} stroke={color} fill="none"><polyline className="twin-history-route" points={path.map((point) => `${point.x * 10},${point.y * 5.625}`).join(' ')} strokeWidth="2" strokeOpacity=".65" filter="url(#routeGlow)" />{target && step?.action === 'move' && <><path className={paused ? 'twin-target-route paused' : 'twin-target-route'} d={`M ${current.x * 10} ${current.y * 5.625} L ${target.x * 10} ${target.y * 5.625}`} strokeWidth="1.8" strokeDasharray="6 5" filter="url(#routeGlow)" /><ellipse cx={target.x * 10} cy={target.y * 5.625} rx="17" ry="7" strokeWidth="1.4" /><path d={`M ${target.x * 10 - 5} ${target.y * 5.625} h10 M ${target.x * 10} ${target.y * 5.625 - 3} v6`} strokeWidth="1" /></>}</g>;
        })}</svg>}

        {stations.map((device) => {
          const point = projectDeviceAnchor(device.id, device.position, model);
          return <button key={device.id} className={`twin-station ${device.status} ${selectedId === device.id ? 'selected' : ''} ${labels ? '' : 'labels-hidden'}`} style={{ left: `${point.x}%`, top: `${point.y}%` }} aria-label={`选择设备 ${device.name}`} aria-pressed={selectedId === device.id} onClick={() => onSelect(device.id)}><span className="station-ground-mark"><i /><i /></span><span className="station-label"><span className="station-status-light" /><span>{shortNames[device.id] ?? device.name}<small>{device.id.replace('station-', '').toUpperCase()} / {statusLabels[device.status]}</small></span>{device.status === 'busy' ? <Activity size={13} /> : <CircleDot size={12} />}</span></button>;
        })}

        {robots.map((robot, index) => {
          const point = projectPosition(robot.position, model);
          const task = tasks.find((item) => item.id === robot.activeTaskId);
          const step = task?.steps[task.currentStepIndex];
          const src = `/assets/twin/robot-${index === 0 ? model : model === 'flare' ? 'sunburst' : 'flare'}.png`;
          return <button key={robot.id} className={`twin-robot ${index === 1 ? 'robot-secondary' : ''} ${robot.status} ${selectedId === robot.id ? 'selected' : ''} ${labels ? '' : 'labels-hidden'}`} style={{ left: `${point.x}%`, top: `${point.y}%`, zIndex: 10 + Math.round(point.y) }} aria-label={`选择设备 ${robot.name}`} aria-pressed={selectedId === robot.id} onClick={() => onSelect(robot.id)}><span className="robot-ground-ring" /><span className="robot-ground-shadow" />{robotErrors.includes(src) ? <span className="robot-fallback"><Bot size={35} /></span> : <img src={src} alt="" draggable={false} className={`robot-cutout ${robot.status === 'busy' && !paused && step?.action !== 'move' ? 'robot-working' : ''}`} onError={() => setRobotErrors((previous) => previous.includes(src) ? previous : [...previous, src])} />}<span className="robot-label"><i /><strong>AMR-{String(index + 1).padStart(2, '0')}</strong><small>{robot.status === 'busy' && step ? (step.action === 'move' ? '导航中' : '机械臂作业') : statusLabels[robot.status]}</small></span>{robot.status === 'busy' && task && labels && <span className="robot-step">{step?.name}<span style={{ width: `${Math.round((step?.progress ?? 0) * 100)}%` }} /></span>}</button>;
        })}
      </div>

      <div className="twin-hud-top"><div className="twin-live-pill"><span className={paused ? 'paused' : ''} />{paused ? 'SIMULATION PAUSED' : 'LIVE DIGITAL TWIN'}<em>仿真</em></div><div className="twin-location"><span>研发中心 · A-01</span><small>FIXED CAMERA / {model.toUpperCase()}</small></div></div>
      <div className="twin-hud-left"><span className="hud-cross" /><div><strong>LAB A-01</strong><small>智能实验室 / 无人化协同</small></div></div>
      <div className="twin-zoom-tools"><button aria-label="放大写实场景" disabled={zoom >= 2} onClick={() => zoomBy(0.2)}><Plus size={16} /></button><span>{Math.round(zoom * 100)}%</span><button aria-label="缩小写实场景" disabled={zoom <= 1} onClick={() => { zoomBy(-0.2); if (zoom <= 1.2) setOffset({ x: 0, y: 0 }); }}><Minus size={16} /></button><i /><button aria-label="重置写实视角" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}><Focus size={16} /></button></div>
      <div className="twin-hud-bottom"><span><i className="mint" />AMR-01<i className="blue" />AMR-02<span className="hud-divider" />{devices.filter((device) => device.status !== 'offline' && device.status !== 'fault').length}/{devices.length} 设备在线</span><span><MousePointer2 size={11} />点击设备查看遥测</span></div>
      {offlineCount > 0 && <div className="twin-alert"><span />{offlineCount} 台设备异常 · 请检查设备状态</div>}
    </div> : <div className="twin-3d-fallback fused-scene"><LabScene devices={devices} selectedId={selectedId} onSelect={onSelect} resetToken={resetToken + localReset} paused={paused} model={model} routes={routes} labels={labels} tasks={tasks} />{mode === 'realistic' ? <div className="asset-loading-note"><LoaderCircle size={13} className="spin" />写实素材加载中，当前显示交互式 3D 仿真</div> : <><div className="fused-scene-hud"><span className="twin-live-pill"><span className={paused ? 'paused' : ''} />AI MATERIALS × LIVE 3D<em>仿真</em></span><span>左键旋转 · 右键平移 · 滚轮缩放</span></div>{!activeTask && <div className="fused-empty-prompt"><span><Bot size={16} />当前无运行任务，点击右下角启动协同演示</span></div>}{labels && <div className="fused-device-selector" aria-label="场景设备选择">{devices.map((device) => <button key={device.id} className={selectedId === device.id ? 'selected' : ''} aria-label={`选择设备 ${device.name}`} aria-pressed={selectedId === device.id} onClick={() => onSelect(device.id)}><span className={device.status} />{device.kind === 'robot' ? device.id.replace('robot', 'AMR').toUpperCase() : shortNames[device.id] ?? device.name}</button>)}</div>}</>}</div>}

    <div className="fused-interaction-bar"><span><MousePointer2 size={12} />{mode === 'fused' ? '三维仿真空间 · AI 图像材质 · 点击设备查看遥测' : '固定相机图像仅作视觉参考，返回融合孪生可自由操作'}</span><button className="button primary small" aria-label="启动协同演示" disabled={busy} onClick={onStartDemo}>{busy ? <LoaderCircle size={13} className="spin" /> : <Play size={13} />}启动协同演示</button></div>

    <div className="twin-active-strip"><span className={`strip-icon ${activeTask ? 'active' : ''}`}>{activeTask ? <Activity size={17} /> : <CheckCircle2 size={17} />}</span><div><span>{activeTask ? '当前执行' : '系统就绪'}</span><strong>{activeStep?.name ?? '所有工作站就绪，等待实验任务'}</strong></div>{activeTask && <><div className="strip-progress"><i style={{ width: `${Math.round(activeTask.progress * 100)}%` }} /></div><span className="strip-percent">{Math.round(activeTask.progress * 100)}%</span><span className="strip-step">{activeTask.currentStepIndex + 1} / {activeTask.steps.length} 步骤</span></>}<span className="strip-simulation">模拟设备 · 实时状态</span></div>

    {preview && <div className="gif-preview" role="dialog" aria-modal="true" aria-label="仿真演示 GIF"><div className="gif-preview-card"><header><div><Film size={18} /><strong>数字孪生 · 循环演示</strong><span>演示录像 / 非实时</span></div><button className="icon-button" aria-label="关闭 GIF 预览" onClick={() => setPreview(false)}><X size={20} /></button></header>{gifError ? <div className="gif-unavailable"><Film size={30} /><strong>演示文件正在准备</strong><p>实时实验室视图继续使用服务器推送状态。</p></div> : <img src="/assets/twin/lab-simulation.gif" alt="智能实验室模拟运行的循环演示，不代表当前实时设备状态" onError={() => setGifError(true)} />}<footer><span>此 GIF 仅用于展示视觉效果，实时任务与遥测以上方实验室状态为准。</span><a className="button secondary small" href="/assets/twin/lab-simulation.gif" download>下载 GIF</a></footer></div></div>}
  </div>;
}
