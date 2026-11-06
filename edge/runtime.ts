import { LabEngine } from '../server/engine.js';
import type { LabState } from '../shared/types.js';

export interface SessionSnapshot {
  state: LabState;
  lastTickAt: number;
}

/** 将已提交墙钟与快照一起恢复，alarm 重试不会重复计算已提交的时间。 */
export class SessionRuntime {
  readonly engine: LabEngine;
  private lastTickAt: number;

  constructor(snapshot?: SessionSnapshot, now = Date.now()) {
    this.engine = snapshot ? new LabEngine({ initialState: snapshot.state, restoreMode: 'continue' }) : new LabEngine({ seedDemo: false });
    this.lastTickAt = snapshot?.lastTickAt ?? now;
  }

  hasWork(): boolean {
    const state = this.engine.getState();
    return !state.simulation.paused && state.tasks.some((task) => task.status === 'queued' || task.status === 'running');
  }

  advance(now = Date.now()): void {
    if (now <= this.lastTickAt) return;
    let seconds = (now - this.lastTickAt) / 1000;
    while (seconds > 0 && this.hasWork()) {
      const slice = Math.min(86400, seconds);
      this.engine.tick(slice);
      seconds -= slice;
    }
    // 空闲或暂停期间也更新基准，后续新任务不会补算之前的空闲时间。
    this.lastTickAt = now;
  }

  snapshot(): SessionSnapshot {
    return { state: this.engine.getState(), lastTickAt: this.lastTickAt };
  }
}
