import type { OutgoingHttpHeaders } from 'node:http';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { chatRequestSchema } from '@wealthcompass/contracts';
import { runAgent } from './agent.js';
import { createAuthHook } from './auth.js';
import { loadConfig } from './config.js';
import { FeatureStore } from './feature-store.js';
import { registerMockIdp } from './idp.js';
import { loadPack } from './pack.js';

const config = loadConfig();
const pack = loadPack(config.packDir);
const store = new FeatureStore(config.featureMapPath, pack);

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

const log = (entry: Record<string, unknown>) => app.log.info(entry);

app.get('/v1/health', async () => ({
  ok: true,
  pack: pack.name,
  features: store.featureMap.features.length,
  tours: store.featureMap.tours.length,
  llmConfigured: Boolean(config.llm.apiKey),
  provider: config.llm.provider, model: config.llm.model,
}));

app.get('/v1/tours/:id', { preHandler: authenticate }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const tour = store.getTour(id);
  if (!tour) return reply.code(404).send({ error: 'not_found' });
  const owner = store.featureMap.features.find((f) => f.tourIds.includes(id));
  const roles = request.principal!.roles;
  if (owner && !owner.access.requires.every((r) => roles.includes(r))) return reply.code(403).send({ error: 'forbidden' });
  return tour;
});

app.post('/v1/telemetry', { preHandler: authenticate }, async (request, reply) => {
  // Chỉ ghi các trường đã biết, không ghi nguyên body
  const body = (request.body ?? {}) as Record<string, unknown>;
  log({ event: 'telemetry', user: request.principal!.id, what: body['event'], tourId: body['tourId'], status: body['status'], lastStep: body['lastStep'], reason: body['reason'] });
  return reply.code(204).send();
});

app.post('/v1/chat', { preHandler: authenticate }, async (request, reply) => {
  const parsed = chatRequestSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
  const principal = request.principal!;
  if (!allowed(principal.id)) return reply.code(429).send({ error: 'rate_limited' });

  // Phản hồi SSE; hijack để tự quản luồng nhưng giữ header CORS mà plugin đã đặt
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

  for await (const event of runAgent({ config, store, pack, log }, principal, parsed.data, abort.signal)) {
    if (reply.raw.writableEnded) break;
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  reply.raw.end();
});

await app.listen({ port: config.port, host: config.host });
app.log.info(`WealthCompass server: http://${config.host}:${config.port} (pack ${pack.name}, model ${config.llm.model}, llm ${config.llm.apiKey ? 'ok' : 'THIẾU KHÓA'})`);
