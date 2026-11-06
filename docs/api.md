# API 合同

所有设备连接均为 `simulated`。前后端共同使用 [shared/types.ts](../shared/types.ts)，服务器是唯一状态源。

本地 Node 服务共用一个实验室；Cloudflare 按 `smart_lab_session` Cookie 隔离浏览器会话。非浏览器客户端应先请求 `/api/state` 并保存响应 Cookie，之后所有请求和 SSE 使用同一个 Cookie。`/api/health` 不创建会话。

| 方法 | 路径 | 输入 / 输出 |
| --- | --- | --- |
| GET | `/api/health` | `{ ok: true, mode: "simulation" }` |
| GET | `/api/state` | 完整 `LabState` |
| GET | `/api/stream` | SSE，`event: state` 的 data 为完整 `LabState`，立即发送初始状态；之后每次状态变化推送 |
| POST | `/api/tasks` | `CreateTaskInput` → 201 `LabTask` |
| PATCH | `/api/tasks/:id` | `{ action: "pause" \| "resume" \| "cancel" \| "retry" }` → `LabTask`；不允许的状态转换返回 409 |
| POST | `/api/workflows` | `SaveWorkflowInput` → 201 `LabWorkflow` |
| PUT | `/api/workflows/:id` | `SaveWorkflowInput` → `LabWorkflow`；已有任务保留步骤快照 |
| PATCH | `/api/devices/:id` | `{ status: "idle" \| "offline" \| "fault" }` → `LabDevice`；运行中的设备不可直接切离线 |
| POST | `/api/simulation` | `{ paused?: boolean, speed?: 0.5 \| 1 \| 2 \| 4 }` → `LabState.simulation` |
| GET | `/api/results/export.csv` | UTF-8 BOM CSV，包含模拟标识、任务/样品、指标、数值、单位、质量和时间 |

错误为非 2xx HTTP 状态与 `{ error: string }`；JSON 请求最多 1 MiB。所有变更调用都必须校验输入，前端显示实际错误，不得伪造成功。

## 场景坐标与默认设备

三维场景使用 x/z 地面坐标，`position` = `[x, z]`，实验室约 16×12 米。

| id | 类型 | 名称 | 位置 | 能力 |
| --- | --- | --- | --- | --- |
| `robot-01` | robot | 复合机器人 AMR-01 | `[-3, 1]` | move, pick, place |
| `robot-02` | robot | 复合机器人 AMR-02 | `[3, 2]` | move, pick, place |
| `station-prep` | station | 样品准备台 | `[-5, 3]` | process |
| `station-hood` | station | 通风操作柜 | `[-5, -3]` | process |
| `station-analyzer` | station | 自动分析仪 | `[4, -3]` | process, measure |
| `station-storage` | station | 样品存储站 | `[6, 3]` | process |

`move` / `pick` / `place` 使用机器人 `deviceId` 并要求有效 `stationId`；`process` / `measure` 使用支持对应动作的仪器 `deviceId`。移动抵达仪器前的接驳点，避免底盘与仪器重叠。所有时间均为仿真时间，`durationSeconds` 范围 1–600，样品数 1–96。设备占用由调度器集中管理；同一设备不可被并发步骤重复占用。

本地持久化文件位于 `data/lab-state.json`，不提交版本库；进程重启后把未完成任务恢复为暂停。Cloudflare 使用 SQLite Durable Object 持久化，对象实例恢复后自动继续仿真；alarm 可能延迟，按墙钟补算。详见[部署说明](deployment.md)。模拟结果不代表仪器实测，也不包含原厂算法。
