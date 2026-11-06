import { resolve } from 'node:path';
import { createLabServer } from './http.js';

const port = Number(process.env.PORT ?? 4311);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须为 1–65535 的整数');
const app = createLabServer({ dataPath: process.env.LAB_DATA_PATH ?? resolve(process.cwd(), 'data/lab-state.json') });

app.server.on('error', (error) => {
  console.error('智能实验室服务启动失败：', error.message);
  void app.close().finally(() => { process.exitCode = 1; });
});
app.server.listen(port, '127.0.0.1', () => {
  console.log(`LimeLab 仿真服务：http://127.0.0.1:${port}`);
  console.log('当前为模拟模式，未连接真实机器人或仪器。');
});
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  void app.close().then(() => { process.exitCode = 0; }, (error: Error) => {
    console.error('保存或停止服务失败：', error.message); process.exitCode = 1;
  });
});
