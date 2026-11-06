export type DeviceStatus = 'idle' | 'busy' | 'offline' | 'fault';
export type StepAction = 'move' | 'pick' | 'place' | 'process' | 'measure';
export type TaskStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface LabDevice {
  id: string;
  name: string;
  kind: 'robot' | 'station';
  category: string;
  status: DeviceStatus;
  position: [number, number];
  homePosition: [number, number];
  battery?: number;
  capabilities: StepAction[];
  connection: 'simulated';
  activeTaskId?: string;
}

export interface WorkflowStep {
  id: string;
  name: string;
  action: StepAction;
  deviceId: string;
  stationId?: string;
  durationSeconds: number;
  parameters?: Record<string, string | number>;
}

export interface LabWorkflow {
  id: string;
  name: string;
  description: string;
  sampleCount: number;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskStep extends WorkflowStep {
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  startedAt?: string;
  completedAt?: string;
}

export interface LabTask {
  id: string;
  name: string;
  workflowId: string;
  workflowName: string;
  sampleCount: number;
  priority: 'normal' | 'high';
  status: TaskStatus;
  steps: TaskStep[];
  currentStepIndex: number;
  progress: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  message?: string;
}

export interface LabEvent {
  id: string;
  time: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  taskId?: string;
  deviceId?: string;
}

export interface LabResult {
  id: string;
  taskId: string;
  sampleId: string;
  metric: string;
  value: number;
  unit: string;
  quality: 'pass' | 'review';
  createdAt: string;
}

export interface LabState {
  devices: LabDevice[];
  workflows: LabWorkflow[];
  tasks: LabTask[];
  events: LabEvent[];
  results: LabResult[];
  simulation: { paused: boolean; speed: number; simTime: number };
}

export interface CreateTaskInput {
  workflowId: string;
  name?: string;
  sampleCount?: number;
  priority?: 'normal' | 'high';
}

export interface SaveWorkflowInput {
  name: string;
  description: string;
  sampleCount: number;
  steps: WorkflowStep[];
}

export interface ApiError { error: string }
