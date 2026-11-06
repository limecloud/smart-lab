import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import type { LabState } from '../shared/types.js';
import { LabEngine, LabError } from './engine.js';

interface ServerOptions {
  engine?: LabEngine;
  dataPath?: string;
  clientPath?: string;
  tickMs?: number;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new LabError('请求必须使用 application/json', 415);
  return new Promise((accept, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    request.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) {
        if (!settled) { settled = true; reject(new LabError('JSON 请求体不能超过 1 MiB', 413)); }
        return;
      }
      if (!settled) chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object expected');
        accept(value as Record<string, unknown>);
      } catch { reject(new LabError('请求体必须是有效的 JSON 对象')); }
    });
    request.on('error', reject);
    request.on('aborted', () => reject(new LabError('请求已中断')));
  });
}

function checkOrigin(request: IncomingMessage): void {
  if (!request.headers.origin) return;
  try {
    const origin = new URL(request.headers.origin);
    if (origin.host === request.headers.host && (origin.protocol === 'http:' || origin.protocol === 'https:')) return;
  } catch { /* 统一拒绝无效或跨站 Origin。 */ }
  throw new LabError('仅允许来自当前控制台的同源操作', 403);
}

/** HTTP 层负责协议、持久化与广播；调度逻辑只存在于 LabEngine。 */
export function createLabServer(options: ServerOptions = {}) {
  const dataPath = options.dataPath ? resolve(options.dataPath) : undefined;
  let saved: LabState | undefined;
  if (!options.engine && dataPath && existsSync(dataPath)) {
    try { saved = JSON.parse(readFileSync(dataPath, 'utf8')) as LabState; }
    catch { throw new Error(`无法读取持久化状态 ${dataPath}；保留原文件，请先检查格式或权限`); }
  }
  const engine = options.engine ?? new LabEngine(saved ? { initialState: saved } : {});
  const clientPath = resolve(options.clientPath ?? resolve(process.cwd(), 'dist/client'));
  const clients = new Set<ServerResponse>();
  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  let persistenceError: Error | undefined;

  const persist = () => {
    if (!dataPath) return;
    try {
      mkdirSync(dirname(dataPath), { recursive: true });
      const temporary = `${dataPath}.tmp`;
      writeFileSync(temporary, JSON.stringify(engine.getState()), { encoding: 'utf8', mode: 0o600 });
      renameSync(temporary, dataPath);
      persistenceError = undefined;
    } catch (error) {
      persistenceError = error as Error;
      console.error('仿真状态持久化失败：', persistenceError.message);
    }
  };
  const unsubscribe = engine.subscribe((state) => {
    const frame = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
    for (const client of clients) if (!client.destroyed && !client.writableEnded) client.write(frame);
    if (dataPath && !persistTimer) {
      persistTimer = setTimeout(() => { persistTimer = undefined; persist(); }, 750);
      persistTimer.unref();
    }
  });

  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const path = decodeURIComponent(new URL(request.url ?? '/', 'http://lab.local').pathname);
      const method = request.method ?? 'GET';
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) checkOrigin(request);
      if (path === '/api/health' && method === 'GET') {
        json(response, persistenceError ? 503 : 200, { ok: !persistenceError, mode: 'simulation', ...(persistenceError ? { error: '仿真状态暂时无法持久化' } : {}) });
      } else if (path === '/api/state' && method === 'GET') {
        json(response, 200, engine.getState());
      } else if (path === '/api/stream' && method === 'GET') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
        });
        response.flushHeaders();
        response.write(`event: state\ndata: ${JSON.stringify(engine.getState())}\n\n`);
        clients.add(response);
        request.on('close', () => clients.delete(response));
      } else if (path === '/api/tasks' && method === 'POST') {
        json(response, 201, engine.createTask(await readJson(request)));
      } else if (/^\/api\/tasks\/[^/]+$/.test(path) && method === 'PATCH') {
        const body = await readJson(request);
        json(response, 200, engine.changeTask(path.split('/').at(-1)!, body.action));
      } else if (path === '/api/workflows' && method === 'POST') {
        json(response, 201, engine.saveWorkflow(await readJson(request)));
      } else if (/^\/api\/workflows\/[^/]+$/.test(path) && method === 'PUT') {
        json(response, 200, engine.saveWorkflow(await readJson(request), path.split('/').at(-1)!));
      } else if (/^\/api\/devices\/[^/]+$/.test(path) && method === 'PATCH') {
        const body = await readJson(request);
        json(response, 200, engine.setDeviceStatus(path.split('/').at(-1)!, body.status));
      } else if (path === '/api/simulation' && method === 'POST') {
        json(response, 200, engine.configureSimulation(await readJson(request)));
      } else if (path === '/api/results/export.csv' && method === 'GET') {
        response.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="smart-lab-simulation-results.csv"',
          'Cache-Control': 'no-store',
        });
        response.end(engine.exportResultsCsv());
      } else if (path === '/api' || path.startsWith('/api/')) {
        json(response, 404, { error: 'API 路径或请求方法不存在' });
      } else if (method === 'GET' || method === 'HEAD') {
        const requested = resolve(clientPath, `.${path}`);
        if (!requested.startsWith(clientPath + sep) && requested !== clientPath) throw new LabError('不允许访问该路径', 403);
        if (path.split('/').some((part) => part.startsWith('.'))) throw new LabError('不允许访问隐藏文件', 403);
        let file = requested;
        if (!existsSync(file) || !statSync(file).isFile()) file = resolve(clientPath, 'index.html');
        if (!existsSync(file)) {
          json(response, 404, { error: '前端尚未构建。开发时打开 http://127.0.0.1:5174，或先执行 npm run build' });
          return;
        }
        const mime: Record<string, string> = {
          '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
          '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webp': 'image/webp', '.gif': 'image/gif',
        };
        const content = readFileSync(file);
        response.writeHead(200, {
          'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
          'Content-Length': content.length, 'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600',
        });
        response.end(method === 'HEAD' ? undefined : content);
      } else {
        json(response, 405, { error: '不支持的请求方法' });
      }
    } catch (error) {
      if (response.headersSent) { response.end(); return; }
      if (error instanceof LabError) json(response, error.status, { error: error.message });
      else if (error instanceof URIError) json(response, 400, { error: 'URL 编码无效' });
      else { console.error(error); json(response, 500, { error: '服务内部错误，请查看终端日志' }); }
    }
  });

  const tickMs = options.tickMs ?? 250;
  let lastTick = performance.now();
  const timer = tickMs > 0 ? setInterval(() => {
    const current = performance.now();
    engine.tick(Math.min(60, (current - lastTick) / 1000));
    lastTick = current;
  }, tickMs) : undefined;
  timer?.unref();
  const heartbeat = setInterval(() => {
    for (const client of clients) if (!client.destroyed && !client.writableEnded) client.write(': heartbeat\n\n');
  }, 15000);
  heartbeat.unref();

  let closing = false;
  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    if (timer) clearInterval(timer);
    clearInterval(heartbeat);
    if (persistTimer) clearTimeout(persistTimer);
    unsubscribe();
    for (const client of clients) client.end();
    clients.clear();
    persist();
    await new Promise<void>((accept, reject) => {
      if (!server.listening) { accept(); return; }
      server.close((error) => error ? reject(error) : accept());
      server.closeIdleConnections();
    });
  };
  return { server, engine, close };
}
