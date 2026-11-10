import { existsSync, readdirSync, statSync } from 'node:fs';
import { exists, readText } from '@wealthcompass/tourdb';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OutgoingHttpHeaders } from 'node:http';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import { completeText, LLM_PRESETS } from '@wealthcompass/llm';
import { compassHome, listDocuments, tourDbPath } from '@wealthcompass/tourdb';
import { parse as parseYaml } from 'yaml';
import { CONFIG_NAME, dataRoot, usesStore } from '../project';
import { enrich } from '../enrich';
import { loadConfig } from '../scan';
import { doctor } from '../setup/doctor';
import { VERSION } from '../version';
import { readEnvFile, updateEnvFile } from './env-file';
import { approveFeature, updateFeature, type FeatureChanges } from './overrides-edit';
import { dataFile, cachedCodeChecks, cachedScan, isProject, noSource, eventLogFile, configPath, featureRows, httpError, integrated, keySource, llm, projectSummary, requireApp, state, stream } from './context';
import { registerPhase2 } from './routes-phase2';
import { registerPhase3 } from './routes-phase3';
import { ngBin, onLog, portAnswers, procInfo, procLogs, sourceRepo, startProc, stopAll, stopProc, type ProcName } from './processes';

// WealthCompass Studio: giao diện web chạy trên máy dev, bọc các lệnh sẵn có (setup, scan, enrich, doctor...).
// Chỉ nghe 127.0.0.1 và không dùng token. Chặn trang web khác trong trình duyệt gọi API bằng cách kiểm Host
// (DNS rebinding) và Origin/Sec-Fetch-Site (yêu cầu từ site khác). Chương trình khác chạy trên cùng máy thì gọi được.

export interface StudioOptions {
  port: number;
  open?: string; // thư mục dự án mở sẵn
}

export async function startStudio(opts: StudioOptions): Promise<{ url: string; close: () => Promise<void> }> {
  const app = Fastify({ logger: false, bodyLimit: 2_000_000 });

  // Bảo vệ: chỉ chấp nhận Host là localhost; API chỉ nhận yêu cầu từ chính giao diện Studio, không nhận từ trang web khác
  const ownOrigins = new Set([`http://127.0.0.1:${opts.port}`, `http://localhost:${opts.port}`]);
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const host = (req.headers.host ?? '').split(':')[0];
    if (host !== '127.0.0.1' && host !== 'localhost') return reply.code(403).send({ error: 'host không hợp lệ' });
    if (!req.url.startsWith('/api/')) return;
    // Trình duyệt gửi Origin cho mọi yêu cầu ghi và mọi yêu cầu khác site; Sec-Fetch-Site cho biết yêu cầu đến từ site nào.
    // Thiếu cả hai (curl, công cụ dòng lệnh trên máy này) thì cho qua.
    const origin = req.headers.origin;
    const site = req.headers['sec-fetch-site'];
    if ((origin && !ownOrigins.has(origin)) || site === 'cross-site' || site === 'same-site') {
      return reply.code(403).send({ error: 'Studio chỉ nhận yêu cầu từ chính giao diện của nó' });
    }
  });
  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    reply.code(err.statusCode && err.statusCode >= 400 ? err.statusCode : 500).send({ error: err.message });
  });

  // Giao diện (bản build Angular)
  const here = dirname(fileURLToPath(import.meta.url));
  const uiDir = [join(here, '..', 'studio-ui'), resolve(here, '..', '..', '..', 'studio-ui', 'dist', 'studio-ui', 'browser')].find((d) => exists(join(d, 'index.html')));
  if (uiDir) {
    // wildcard: phục vụ file theo yêu cầu (không chỉ file có lúc khởi động) để build lại giao diện không cần khởi động lại
    await app.register(fastifyStatic, { root: uiDir, prefix: '/', wildcard: true });
    // SPA: mọi đường dẫn không phải /api trả index.html
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.code(404).send({ error: 'không có API này' }) : reply.sendFile('index.html')));
  } else {
    app.get('/', async () => 'Chưa build giao diện Studio: chạy `npm run build -w studio-ui` trong repo WealthCompass.');
  }

  // ---------------- Phiên và dự án ----------------
  app.get('/api/session', async () => ({ version: VERSION, project: state.appDir ? projectSummary(state.appDir) : null, home: homedir() }));

  app.get('/api/fs/list', async (req) => {
    const q = req.query as { path?: string };
    const dir = resolve(q.path || homedir());
    if (!exists(dir) || !statSync(dir).isDirectory()) throw httpError(400, 'Không phải thư mục');
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => {
        const path = join(dir, e.name);
        return { name: e.name, path, isAngular: isProject(path), integrated: integrated(path) };
      })
      .sort((a, b) => Number(b.isAngular) - Number(a.isAngular) || a.name.localeCompare(b.name));
    return { path: dir, parent: dirname(dir) === dir ? null : dirname(dir), isAngular: isProject(dir), entries };
  });

  // Các kho dự án đã có trên máy (~/.wealthcompass/projects): mở lại dự án mà không cần nhớ thư mục
  app.get('/api/projects', async () => {
    const home = join(compassHome(), 'projects');
    if (!existsSync(home)) return { home, projects: [] };
    const projects = readdirSync(home)
      .filter((f) => f.endsWith('.db'))
      .map((f) => {
        const db = join(home, f);
        try {
          if (!listDocuments(db).includes(CONFIG_NAME)) return null;
          const cfg = parseYaml(readText(join(db, CONFIG_NAME))) as { web?: { url?: string }; discovery?: { sourceDir?: string; source?: string } } | null;
          const sourceDir = cfg?.discovery?.sourceDir ?? null;
          // Mở bằng thư mục source (dự án có source) hoặc bằng chính file kho (dự án tour chưa có source)
          return { db, name: f.replace(/(-[0-9a-f]{8})?\.db$/, ''), sourceDir, url: cfg?.web?.url ?? null, open: sourceDir ?? db, missingSource: Boolean(sourceDir && !existsSync(sourceDir)) };
        } catch {
          return null;
        }
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
    return { home, projects };
  });

  app.post('/api/project/open', async (req) => {
    const { path } = req.body as { path: string };
    const dir = resolve(path.replace(/^~(?=$|\/)/, homedir()));
    if (!isProject(dir)) throw httpError(400, `${dir} không phải thư mục web Angular (không có angular.json) và cũng không phải kho dự án tour chưa có source (file .db tạo bằng \`wealthcompass init\`)`);
    state.appDir = dir;
    return projectSummary(dir);
  });

  // ---------------- Tổng quan ----------------
  app.get('/api/overview', async () => {
    const dir = requireApp();
    if (!integrated(dir)) return { integrated: false, checks: [], warnings: [], stats: null };
    const scanned = cachedScan(dir);
    // Chưa có source: không có gì để kiểm trong code của web
    const checks = noSource(dir)
      ? [{ status: 'ok' as const, name: 'Cấu hình dự án', detail: 'dự án tour chưa có source (discovery.source: none): màn hình lấy từ tour đã ghi' }]
      : await doctor(dir, undefined, scanned, { codeChecks: cachedCodeChecks(dir), devPort: projectSummary(dir).devPort });
    const { featureMap } = scanned;
    const rows = featureRows(dir);
    return {
      integrated: true,
      checks,
      warnings: featureMap.coverage.warnings,
      stats: {
        screens: featureMap.features.length,
        drafts: rows.filter((r) => r.draft.length).length,
        missing: rows.filter((r) => r.gaps.includes('description')).length,
        tourIds: featureMap.coverage.targetsFound,
        tours: featureMap.tours.length,
      },
    };
  });

  // ---------------- Màn hình ----------------
  app.get('/api/features', async () => featureRows(requireApp()));

  app.put('/api/features/:id', async (req) => {
    const dir = requireApp();
    const { id } = req.params as { id: string };
    const { config, root } = loadConfig(configPath(dir));
    // Chỉ nhận các trường sửa được; quyền phải là tên hợp lệ
    const body = z
      .object({
        title: z.string().nullable(),
        description: z.string().nullable(),
        keywords: z.array(z.string()),
        sampleQuestions: z.array(z.string()),
        facets: z.record(z.string(), z.string()),
        hidden: z.boolean(),
        // Bỏ khoảng trắng và mục rỗng trước khi kiểm tên quyền
        requires: z
          .preprocess((v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : v), z.array(z.string().regex(/^[\w:.-]{1,60}$/, 'Tên quyền không hợp lệ')))
          .nullable(),
      })
      .partial()
      .strict()
      .safeParse(req.body);
    if (!body.success) throw httpError(400, body.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ');
    const changes = body.data as FeatureChanges;
    if (changes.requires) changes.requires = [...new Set(changes.requires)];
    updateFeature(join(root, config.discovery.overrides), id, changes);
    return featureRows(dir).find((r) => r.id === id) ?? null;
  });

  app.post('/api/features/:id/approve', async (req) => {
    const dir = requireApp();
    const { id } = req.params as { id: string };
    const { config, root } = loadConfig(configPath(dir));
    approveFeature(join(root, config.discovery.overrides), id);
    return featureRows(dir).find((r) => r.id === id) ?? null;
  });

  app.post('/api/features/enrich', async (req, reply) => {
    const dir = requireApp();
    const { ids } = (req.body ?? {}) as { ids?: string[] };
    await stream(reply, async (log) => {
      const res = await enrich({ config: configPath(dir), dryRun: false, only: ids, llm: llm() }, log);
      return { drafted: res.drafted.length, skipped: res.skipped };
    });
  });

  // ---------------- Backend (chạy độc lập) và web ----------------
  // Backend KHÔNG do Studio bật: nó là một tiến trình riêng (trên máy này hoặc máy chủ), Studio chỉ kết nối tới để thử trợ lý.
  // Hai bên dùng chung một kho tour (compass.tours.db của dự án).
  app.get('/api/run', async () => {
    const dir = requireApp();
    const env = readEnvFile(dataFile(dir, 'wealthcompass.env'));
    const port = Number(env['PORT'] ?? 8890);
    let health: { tourDb?: string; debug?: boolean } | null = null;
    try {
      health = (await (await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: AbortSignal.timeout(1500) })).json()) as { tourDb?: string; debug?: boolean };
    } catch {
      health = null;
    }
    const { config, root } = loadConfig(configPath(dir));
    const tourDb = tourDbPath(join(root, config.discovery.tours));
    // Lệnh chạy backend cho dự án này. COMPASS_DEBUG và COMPASS_LOG_FILE chỉ cần khi muốn dùng trang Thử trợ lý, Kiểm thử, Nhật ký.
    const repo = sourceRepo();
    const extras = `COMPASS_DEBUG=1 COMPASS_LOG_FILE=${eventLogFile(dir)}`;
    // Backend không cài trong web: chạy từ repo WealthCompass (source) hoặc từ gói @wealthcompass/server cài riêng
    // Dự án dùng kho SQLite: backend chỉ cần biết file kho (bản đồ tính năng, tour và cấu hình backend đều nằm trong đó).
    // Dự án kiểu cũ: trỏ tới feature-map.json và file env cạnh source.
    const inStore = usesStore(dir);
    const envFile = dataFile(dir, 'wealthcompass.env');
    const target = inStore ? `COMPASS_PROJECT=${dataRoot(dir)}` : `COMPASS_FEATURE_MAP=${join(root, config.discovery.out)}`;
    const envArg = !inStore && exists(envFile) ? ` --env-file ${envFile}` : '';
    const base = repo ? `${target} npm run server${envArg ? ` --${envArg}` : ''}` : `${target} wealthcompass-server${envArg}`;
    const command = { cwd: repo ?? '(nơi cài gói @wealthcompass/server)', run: base, withStudio: `${extras} ${base}` };
    const devPort = projectSummary(dir).devPort;
    const web = procInfo('web');
    // `external`: web đang chạy nhưng không do Studio bật, nên Studio không dừng hay xem log được
    const webExternal = !web.running && (await portAnswers(`http://127.0.0.1:${devPort}/`));
    return {
      backend: {
        running: health !== null,
        port,
        health,
        command,
        tourDb,
        // null: backend không báo (không chạy debug) nên không kiểm được
        sameTourDb: health?.tourDb ? resolve(health.tourDb) === resolve(tourDb) : null,
      },
      web: { ...web, running: web.running || webExternal, external: webExternal, port: devPort, url: `http://localhost:${devPort}`, available: Boolean(ngBin(dir)) },
    };
  });

  app.post('/api/run/:name/:action', async (req) => {
    const dir = requireApp();
    const { name, action } = req.params as { name: string; action: 'start' | 'stop' };
    if (name !== 'web') throw httpError(400, 'Backend chạy độc lập với Studio: bật nó bằng lệnh ở trang Chạy thử');

    if (action === 'stop') {
      stopProc('web');
      return procInfo('web');
    }
    const ng = ngBin(dir);
    if (!ng) throw httpError(400, 'Chưa cài Angular CLI trong dự án (npm install)');
    const port = projectSummary(dir).devPort;
    // ng serve ưu tiên biến PORT hơn --port: bỏ PORT của Studio để web chạy đúng cổng dev của dự án
    const { PORT: _studioPort, ...webEnv } = process.env;
    return startProc('web', process.execPath, [ng, 'serve', '--port', String(port), '--host', '127.0.0.1'], dir, webEnv);
  });

  app.get('/api/run/:name/logs', async (req, reply) => {
    const { name } = req.params as { name: ProcName };
    reply.hijack();
    reply.raw.writeHead(200, { ...(reply.getHeaders() as OutgoingHttpHeaders), 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    for (const line of procLogs(name)) reply.raw.write(`data: ${JSON.stringify(line)}\n\n`);
    const off = onLog(name, (line) => reply.raw.write(`data: ${JSON.stringify(line)}\n\n`));
    req.raw.on('close', off);
  });

  app.get('/api/env', async () => {
    const dir = requireApp();
    return { exists: exists(dataFile(dir, 'wealthcompass.env')), values: readEnvFile(dataFile(dir, 'wealthcompass.env')) };
  });

  app.put('/api/env', async (req) => {
    const dir = requireApp();
    const changes = req.body as Record<string, string | null>;
    // Không cho ghi khóa LLM vào file: khóa chỉ đặt qua biến môi trường hoặc phiên Studio
    if (Object.keys(changes).some((k) => /API_KEY/.test(k))) throw httpError(400, 'Không ghi khóa API vào wealthcompass.env');
    updateEnvFile(dataFile(dir, 'wealthcompass.env'), changes);
    // Backend chạy độc lập: cấu hình mới có hiệu lực sau khi bạn khởi động lại backend
    return { values: readEnvFile(dataFile(dir, 'wealthcompass.env')), restartNeeded: true };
  });

  // ---------------- Cài đặt AI ----------------
  app.get('/api/ai', async () => {
    const c = llm();
    return { provider: c.provider, model: c.model, baseUrl: c.baseUrl, hasKey: Boolean(c.apiKey), keySource: keySource(), providers: Object.keys(LLM_PRESETS) };
  });

  app.put('/api/ai', async (req) => {
    const body = req.body as { provider?: string; model?: string; apiKey?: string | null };
    if (body.provider !== undefined) state.ai.provider = body.provider || undefined;
    if (body.model !== undefined) state.ai.model = body.model || undefined;
    if (body.apiKey !== undefined) state.ai.apiKey = body.apiKey || undefined;
    const c = llm();
    return { provider: c.provider, model: c.model, baseUrl: c.baseUrl, hasKey: Boolean(c.apiKey), keySource: keySource(), providers: Object.keys(LLM_PRESETS) };
  });

  app.post('/api/ai/test', async () => {
    const c = llm();
    if (!c.apiKey) return { ok: false, message: 'Chưa có khóa API' };
    const started = Date.now();
    try {
      const reply = await completeText(c, { messages: [{ role: 'user', content: 'Trả lời đúng một từ: OK' }] });
      return { ok: true, ms: Date.now() - started, reply: reply.slice(0, 60) };
    } catch (e) {
      return { ok: false, message: (e as Error).message, ms: Date.now() - started };
    }
  });

  registerPhase2(app);
  registerPhase3(app);

  if (opts.open) {
    const dir = resolve(opts.open);
    if (isProject(dir)) state.appDir = dir;
  }

  await app.listen({ port: opts.port, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${opts.port}/`;
  const close = async () => {
    stopAll();
    await app.close();
  };
  process.on('exit', stopAll);
  return { url, close };
}
