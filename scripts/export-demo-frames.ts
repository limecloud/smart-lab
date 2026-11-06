import { mkdirSync, writeFileSync } from 'node:fs';
import { LabEngine } from '../server/engine.js';

// 动画直接采样项目调度器；导出的文件只供离线演示，不影响运行服务。
const engine = new LabEngine({ seedDemo: false, now: () => new Date('2026-11-06T00:00:00Z') });
engine.createTask({ workflowId: 'workflow-standard', name: '样品分析演示', sampleCount: 8 });
engine.createTask({ workflowId: 'workflow-preparation', name: '样品前处理演示', sampleCount: 6 });
const frames = [];
for (let index = 0; index < 96; index += 1) {
  engine.tick(0.9);
  const state = engine.getState();
  frames.push({ time: state.simulation.simTime, devices: state.devices, tasks: state.tasks, results: state.results.length });
}
mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/demo-frames.json', JSON.stringify(frames));
console.log(`已采样 ${frames.length} 个后端仿真帧`);
