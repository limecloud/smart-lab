import { LabError } from '../server/engine.js';
import { SessionRuntime, type SessionSnapshot } from './runtime.js';

export interface Env {
  ASSETS: Fetcher;
  LABS: DurableObjectNamespace;
}

const SESSION_COOKIE = 'smart_lab_session';
const SESSION_KEY = 'session-v1';
const encoder = new TextEncoder();

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

function checkOrigin(request: Request): void {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
  const origin = request.headers.get('Origin');
  if (origin !== null && origin !== new URL(request.url).origin) throw new LabError('仅允许来自当前控制台的同源操作', 403);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    throw new LabError('请求必须使用 application/json', 415);
  }
  const length = request.headers.get('Content-Length');
  if (length !== null && Number(length) > 1024 * 1024) throw new LabError('JSON 请求体不能超过 1 MiB', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new LabError('请求体必须是有效的 JSON 对象');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > 1024 * 1024) {
        void reader.cancel().catch(() => {});
        throw new LabError('JSON 请求体不能超过 1 MiB', 413);
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object expected');
    return value as Record<string, unknown>;
  } catch { throw new LabError('请求体必须是有效的 JSON 对象'); }
}

function errorResponse(error: unknown): Response {
  if (error instanceof LabError) return json({ error: error.message }, error.status);
  if (error instanceof URIError) return json({ error: 'URL 编码无效' }, 400);
  console.error('实验室边缘服务错误：', error);
  return json({ error: '服务内部错误，请稍后重试' }, 500);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
        if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: '不支持的请求方法' }, 405);
        return env.ASSETS.fetch(request);
      }
      checkOrigin(request);
      if (url.pathname === '/api/health' && request.method === 'GET') return json({ ok: true, mode: 'simulation' });
      const cookies = request.headers.get('Cookie') ?? '';
      let session = cookies.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
      const newSession = !session || !/^[a-f0-9]{64}$/.test(session);
      if (newSession) session = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
      const stub = env.LABS.get(env.LABS.idFromName(session!));
      const response = await stub.fetch(request);
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-store');
      headers.set('X-Content-Type-Options', 'nosniff');
      if (newSession) headers.append('Set-Cookie', `${SESSION_COOKIE}=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${url.protocol === 'https:' ? '; Secure' : ''}`);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (error) { return errorResponse(error); }
  },
} satisfies ExportedHandler<Env>;

/** 每个随机浏览器会话一个 SQLite Durable Object；调度仅复用 LabEngine。 */
export class LabSession {
  private runtime!: SessionRuntime;
  private readonly ready: Promise<void>;
  private readonly clients = new Set<ReadableStreamDefaultController<Uint8Array>>();

  constructor(private readonly ctx: DurableObjectState, _env: Env) {
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const snapshot = await ctx.storage.get<SessionSnapshot>(SESSION_KEY);
      this.runtime = new SessionRuntime(snapshot);
    });
  }

  private broadcast(): void {
    if (!this.clients.size) return;
    const frame = encoder.encode(`event: state\ndata: ${JSON.stringify(this.runtime.engine.getState())}\n\n`);
    for (const client of this.clients) {
      try {
        if (client.desiredSize !== null && client.desiredSize < -2) { client.close(); this.clients.delete(client); }
        else client.enqueue(frame);
      } catch { this.clients.delete(client); }
    }
  }

  private async persistAndSchedule(): Promise<void> {
    // KV API 由 new_sqlite_classes 指定的 SQLite 后端持久化；快照与墙钟同一次提交。
    await this.ctx.storage.put(SESSION_KEY, this.runtime.snapshot());
    if (this.runtime.hasWork()) await this.ctx.storage.setAlarm(Date.now() + 1000);
    else if (this.clients.size) await this.ctx.storage.setAlarm(Date.now() + 15000);
    else await this.ctx.storage.deleteAlarm();
  }

  private stream(): Response {
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start: (value) => {
        controller = value;
        this.clients.add(controller);
        controller.enqueue(encoder.encode(`event: state\ndata: ${JSON.stringify(this.runtime.engine.getState())}\n\n`));
      },
      cancel: () => { if (controller) this.clients.delete(controller); },
    });
    return new Response(stream, { headers: {
      'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    } });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        checkOrigin(request);
        const path = decodeURIComponent(new URL(request.url).pathname);
        const method = request.method;
        // 先读完并校验请求体，避免慢上传在计时后长时间阻塞本会话。
        const jsonRoute = (method === 'POST' && ['/api/tasks', '/api/workflows', '/api/simulation'].includes(path))
          || (method === 'PATCH' && /^\/api\/(tasks|devices)\/[^/]+$/.test(path))
          || (method === 'PUT' && /^\/api\/workflows\/[^/]+$/.test(path));
        const body = jsonRoute ? await readJson(request) : undefined;
        this.runtime.advance();
        const engine = this.runtime.engine;
        let response: Response;
        if (path === '/api/health' && method === 'GET') response = json({ ok: true, mode: 'simulation' });
        else if (path === '/api/state' && method === 'GET') response = json(engine.getState());
        else if (path === '/api/stream' && method === 'GET') response = this.stream();
        else if (path === '/api/tasks' && method === 'POST') response = json(engine.createTask(body), 201);
        else if (/^\/api\/tasks\/[^/]+$/.test(path) && method === 'PATCH') response = json(engine.changeTask(path.split('/').at(-1)!, body?.action));
        else if (path === '/api/workflows' && method === 'POST') response = json(engine.saveWorkflow(body), 201);
        else if (/^\/api\/workflows\/[^/]+$/.test(path) && method === 'PUT') response = json(engine.saveWorkflow(body, path.split('/').at(-1)!));
        else if (/^\/api\/devices\/[^/]+$/.test(path) && method === 'PATCH') response = json(engine.setDeviceStatus(path.split('/').at(-1)!, body?.status));
        else if (path === '/api/simulation' && method === 'POST') response = json(engine.configureSimulation(body));
        else if (path === '/api/results/export.csv' && method === 'GET') response = new Response(engine.exportResultsCsv(), { headers: {
          'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="smart-lab-simulation-results.csv"',
        } });
        else response = json({ error: 'API 路径或请求方法不存在' }, 404);
        await this.persistAndSchedule();
        this.broadcast();
        return response;
      } catch (error) {
        // 即便命令被拒绝，也提交请求前已推进的时间，保证后续 alarm 不重复推进。
        try { await this.persistAndSchedule(); } catch (storageError) { return errorResponse(storageError); }
        return errorResponse(error);
      }
    });
  }

  async alarm(): Promise<void> {
    await this.ready;
    await this.ctx.blockConcurrencyWhile(async () => {
      this.runtime.advance();
      await this.persistAndSchedule();
      this.broadcast();
    });
  }
}
