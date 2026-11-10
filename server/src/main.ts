import type { OutgoingHttpHeaders } from 'node:http';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { chatRequestSchema } from '@wealthcompass/contracts';
import { z } from 'zod';
import { runAgent } from './agent.js';
import { createAuthHook, type Principal } from './auth.js';
import { createEventLog } from './event-log.js';
import { loadConfig } from './config.js';
import { FeatureStore } from './feature-store.js';
import { registerMockIdp } from './idp.js';
import { TourStore } from './tour-store.js';
import { registerTourAdmin } from './tour-admin.js';

// --env-file <file>: nạp cấu hình do `wealthcompass setup` sinh ra (file của chính dự án, không phải .env chứa bí mật khác)
const envFlag = process.argv.indexOf('--env-file');
if (envFlag !== -1 && process.argv[envFlag + 1]) process.loadEnvFile(process.argv[envFlag + 1]);

const config = loadConfig();
const store = new FeatureStore(config.featureMapPath);
// Kho tour của backend: tour lưu ở đây thắng tour cùng id trong Feature Map (sửa tour không cần deploy web)
const tourStore = new TourStore(config.tourDbPath);
store.useTours(() => tourStore.list().map((t) => tourStore.current(t.id)!).map((v) => ({ tour: v.tour, feature: v.feature })));

const app = Fastify({ logger: { level: 'info' } });
await app.register(cors, {
  origin: config.allowedOrigins,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

if (config.mockIdp) await registerMockIdp(app, config);
const authenticate = createAuthHook(config);

// Rate limit trong bộ nhớ theo người dùng; đủ cho tự host một bản, thay bằng Redis khi chạy nhiều instance
const hits = new Map<string, number[]>();
function allowed(user: string): boolean {
  const now = Date.now();
  const recent = (hits.get(user) ?? []).filter((t) => now - t < config.rateLimit.windowMs);
  if (recent.length >= config.rateLimit.max) return false;
  recent.push(now);
  hits.set(user, recent);
  return true;
}

// Log của Fastify (stdout) và, nếu bật COMPASS_LOG_FILE, nhật ký JSONL để Studio thống kê
const eventLog = createEventLog(config.logFile);
const log = (entry: Record<string, unknown>) => {
  app.log.info(entry);
  eventLog(entry);
};

app.get('/v1/health', async () => ({
  ok: true,
  features: store.featureMap.features.length,
  tours: store.featureMap.tours.length,
  storedTours: tourStore.list().length,
  llmConfigured: Boolean(config.llm.apiKey),
  provider: config.llm.provider, model: config.llm.model,
  auth: config.authMode,
  debug: config.debug,
  // Chỉ báo đường dẫn kho tour khi chạy debug (trên máy dev) để Studio kiểm hai bên có dùng chung một file không
  ...(config.debug ? { tourDb: config.tourDbPath } : {}),
}));

// Quyền xem tour = quyền vào tính năng sở hữu tour
function canSeeTour(id: string, roles: string[]): boolean {
  const owner = store.featureMap.features.find((f) => f.tourIds.includes(id));
  return !owner || owner.access.requires.every((r) => roles.includes(r));
}

app.get('/v1/tours/:id', { preHandler: authenticate }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const tour = store.getTour(id);
  if (!tour) return reply.code(404).send({ error: 'not_found' });
  if (!canSeeTour(id, request.principal!.roles)) return reply.code(403).send({ error: 'forbidden' });
  // Bước có ảnh chụp trong kho: kèm đường dẫn để widget hiện khi không chắc phần tử
  return tourStore.withShots(tour);
});

app.get('/v1/tours/:id/shots/:layout/:key', { preHandler: authenticate }, async (request, reply) => {
  const { id, layout, key } = request.params as { id: string; layout: string; key: string };
  if (!store.getTour(id)) return reply.code(404).send({ error: 'not_found' });
  if (!canSeeTour(id, request.principal!.roles)) return reply.code(403).send({ error: 'forbidden' });
  const png = tourStore.readShot(id, layout, key);
  if (!png) return reply.code(404).send({ error: 'not_found' });
  return reply.header('Content-Type', 'image/png').header('Cache-Control', 'private, max-age=300').send(png);
});

if (config.adminToken) await registerTourAdmin(app, { tours: tourStore, adminToken: config.adminToken, onChange: () => store.reloadTours() });

app.post('/v1/telemetry', { preHandler: authenticate }, async (request, reply) => {
  // Chỉ ghi các trường đã biết, không ghi nguyên body
  const body = (request.body ?? {}) as Record<string, unknown>;
  log({ event: 'telemetry', user: request.principal!.id, what: body['event'], tourId: body['tourId'], status: body['status'], lastStep: body['lastStep'], reason: body['reason'], stepKey: body['stepKey'], matchedBy: body['matchedBy'], score: body['score'] });
  return reply.code(204).send();
});

// Mở luồng SSE; hijack để tự quản luồng nhưng giữ header CORS mà plugin đã đặt
function openSse(reply: import('fastify').FastifyReply): AbortSignal {
  reply.hijack();
  reply.raw.writeHead(200, {
    ...(reply.getHeaders() as OutgoingHttpHeaders),
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const abort = new AbortController();
  reply.raw.on('close', () => abort.abort());
  return abort.signal;
}

app.post('/v1/chat', { preHandler: authenticate }, async (request, reply) => {
  const parsed = chatRequestSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
  const principal = request.principal!;
  if (!allowed(principal.id)) return reply.code(429).send({ error: 'rate_limited' });

  const signal = openSse(reply);
  for await (const event of runAgent({ config, store, log }, principal, parsed.data, signal)) {
    if (reply.raw.writableEnded) break;
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  reply.raw.end();
});

// ---------------------------------------------------------------------------
// Chế độ debug (COMPASS_DEBUG=1): Studio dùng để thử trợ lý với quyền tùy chọn và chạy bộ kiểm thử.
// Không cần JWT nên CHỈ nhận kết nối từ chính máy này; không bật trên máy chủ thật.
// ---------------------------------------------------------------------------
if (config.debug) {
  const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/debug/') && !LOOPBACK.has(request.socket.remoteAddress ?? '')) return reply.code(403).send({ error: 'forbidden' });
  });
  const debugBody = z.object({
    text: z.string().min(1).max(1000),
    roles: z.array(z.string()).max(50).default([]),
    route: z.string().default('/'),
    history: chatRequestSchema.shape.history,
  });

  app.post('/debug/search', async (request, reply) => {
    const parsed = debugBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const { text, roles } = parsed.data;
    return store.explain(text, roles);
  });

  app.post('/debug/chat', async (request, reply) => {
    const parsed = debugBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const { text, roles, route, history } = parsed.data;
    const principal: Principal = { id: 'studio', name: 'Studio', roles };
    const signal = openSse(reply);
    const write = (data: unknown) => !reply.raw.writableEnded && reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    const deps = {
      config,
      store,
      // Câu hỏi thử trong Studio vẫn ghi nhật ký nhưng gắn nguồn để thống kê tách riêng
      log: (entry: Record<string, unknown>) => log({ ...entry, source: 'studio' }),
      trace: (stage: string, data: Record<string, unknown>) => write({ type: 'debug', stage, data }),
    };
    const req = { message: text, history, context: { route, visibleTargets: [], locale: 'vi', capabilities: roles } };
    for await (const event of runAgent(deps, principal, req, signal)) write(event);
    reply.raw.end();
  });
}

await app.listen({ port: config.port, host: config.host });
if (config.authMode === 'gateway') app.log.warn('Xác thực: chế độ gateway (mặc định). Backend KHÔNG kiểm chữ ký JWT; chỉ cho yêu cầu đi qua API gateway tới cổng này. Không có gateway thì đặt COMPASS_AUTH=jwks.');
app.log.info(`WealthCompass server: http://${config.host}:${config.port} (model ${config.llm.model}, llm ${config.llm.apiKey ? 'ok' : 'THIẾU KHÓA'}${config.debug ? ', DEBUG: /debug/* chỉ nhận từ máy này' : ''}${config.logFile ? `, nhật ký: ${config.logFile}` : ''}${config.adminToken ? ', API quản trị tour: /admin/tours' : ''})`);
