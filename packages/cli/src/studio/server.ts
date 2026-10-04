import { randomBytes } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OutgoingHttpHeaders } from 'node:http';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import { completeText, LLM_PRESETS } from '@wealthcompass/llm';
import { buildGitPatch, gitTopLevel } from '../codemod';
import { enrich } from '../enrich';
import { loadConfig, scan } from '../scan';
import { doctor } from '../setup/doctor';
import { setup } from '../setup/setup';
import { VERSION } from '../version';
import { readEnvFile, updateEnvFile } from './env-file';
import { approveFeature, updateFeature, type FeatureChanges } from './overrides-edit';
import { cachedScan, eventLogFile, invalidateScan, patchFile, configPath, featureRows, httpError, integrated, keySource, llm, llmEnv, projectSummary, requireApp, runCommand, state, stream } from './context';
import { registerPhase2 } from './routes-phase2';
import { registerPhase3 } from './routes-phase3';
import { parsePatch, selectHunks } from './patch-hunks';
import { backendBin, ngBin, onLog, procInfo, procLogs, startProc, stopAll, stopProc, type ProcName } from './processes';

// WealthCompass Studio: giao diện web chạy trên máy dev, bọc các lệnh sẵn có (setup, scan, enrich, doctor...).
// Chỉ nghe 127.0.0.1, mọi API cần token ngẫu nhiên trong link mở Studio; kiểm Host để chặn DNS rebinding.

export interface StudioOptions {
  port: number;
  open?: string; // thư mục dự án mở sẵn
  tarballs: string | null;
}

export async function startStudio(opts: StudioOptions): Promise<{ url: string; close: () => Promise<void> }> {
  const token = randomBytes(18).toString('base64url');
  const app = Fastify({ logger: false, bodyLimit: 2_000_000 });

  // Bảo vệ: chỉ chấp nhận Host là localhost và token đúng cho mọi /api
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const host = (req.headers.host ?? '').split(':')[0];
    if (host !== '127.0.0.1' && host !== 'localhost') return reply.code(403).send({ error: 'host không hợp lệ' });
    if (req.url.startsWith('/api/') && req.headers['x-studio-token'] !== token) return reply.code(401).send({ error: 'thiếu hoặc sai token Studio' });
  });
  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    reply.code(err.statusCode && err.statusCode >= 400 ? err.statusCode : 500).send({ error: err.message });
  });

  // Giao diện (bản build Angular)
  const here = dirname(fileURLToPath(import.meta.url));
  const uiDir = [join(here, '..', 'studio-ui'), resolve(here, '..', '..', '..', 'studio-ui', 'dist', 'studio-ui', 'browser')].find((d) => existsSync(join(d, 'index.html')));
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
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw httpError(400, 'Không phải thư mục');
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => {
        const path = join(dir, e.name);
        return { name: e.name, path, isAngular: existsSync(join(path, 'angular.json')), integrated: existsSync(join(path, 'compass.config.yaml')) };
      })
      .sort((a, b) => Number(b.isAngular) - Number(a.isAngular) || a.name.localeCompare(b.name));
    return { path: dir, parent: dirname(dir) === dir ? null : dirname(dir), isAngular: existsSync(join(dir, 'angular.json')), entries };
  });

  app.post('/api/project/open', async (req) => {
    const { path } = req.body as { path: string };
    const dir = resolve(path.replace(/^~(?=$|\/)/, homedir()));
    if (!existsSync(join(dir, 'angular.json'))) throw httpError(400, `Không thấy angular.json trong ${dir}`);
    state.appDir = dir;
    return projectSummary(dir);
  });

  // ---------------- Tổng quan ----------------
  app.get('/api/overview', async () => {
    const dir = requireApp();
    if (!integrated(dir)) return { integrated: false, checks: [], warnings: [], stats: null };
    const scanned = cachedScan(dir);
    const checks = await doctor(dir, undefined, scanned);
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

  // ---------------- Tích hợp ----------------
  app.post('/api/setup', async (req, reply) => {
    const dir = requireApp();
    const body = (req.body ?? {}) as { pack?: string; backendUrl?: string; useAi?: boolean };
    await stream(reply, async (log) => {
      const result = await setup(
        {
          app: dir,
          pack: body.pack ?? 'generic',
          backendUrl: body.backendUrl ?? 'http://localhost:8890',
          tarballs: tarballsDir(),
          version: VERSION,
          llm: body.useAi === false ? null : llm(),
          aiCode: state.ai.aiCode,
          annotate: null,
          force: false,
        },
        log,
      );
      return { todo: result.todo, patch: result.patchFile !== null, stats: result.stats };
    });
  });

  app.get('/api/patch', async (req) => {
    const dir = requireApp();
    const file = patchFile(dir, (req.query as { name?: string }).name);
    if (!existsSync(file)) return { exists: false, files: [], report: readReport(dir) };
    return { exists: true, files: parsePatch(readFileSync(file, 'utf8')), report: readReport(dir) };
  });

  app.post('/api/patch/apply', async (req) => {
    const dir = requireApp();
    const { hunks, name } = req.body as { hunks: string[]; name?: string };
    const file = patchFile(dir, name);
    if (!existsSync(file)) throw httpError(400, 'Không có patch nào');
    const selected = selectHunks(parsePatch(readFileSync(file, 'utf8')), new Set(hunks));
    if (!selected) throw httpError(400, 'Chưa chọn thay đổi nào');
    const base = gitTopLevel(dir) ?? dir;
    const tmp = join(dir, '.wealthcompass-selected.patch');
    writeFileSync(tmp, selected);
    try {
      await exec('git', ['apply', '--check', tmp], base);
      await exec('git', ['apply', tmp], base);
    } finally {
      if (existsSync(tmp)) unlinkSync(tmp);
    }
    // Áp xong thì patch cũ không còn đúng (vị trí đã đổi); chạy lại tích hợp sẽ sinh patch cho phần còn thiếu
    unlinkSync(file);
    invalidateScan();
    return { applied: hunks.length };
  });

  // Cập nhật gói WealthCompass lên bản đang có (file .tgz mới hoặc phiên bản mới): tạo patch cho package.json để duyệt như bình thường
  // Thư mục .tgz có đúng phiên bản thì cài từ file; có thư mục mà thiếu bản thì báo, không âm thầm chuyển sang registry
  const tarballsDir = (): string | null => {
    if (!opts.tarballs) return null;
    if (existsSync(join(opts.tarballs, `wealthcompass-angular-${VERSION}.tgz`))) return opts.tarballs;
    throw httpError(400, `Chưa có gói ${VERSION} trong ${opts.tarballs}. Chạy \`npm run pack\` trong repo WealthCompass rồi thử lại.`);
  };

  app.post('/api/update-packages', async () => {
    const dir = requireApp();
    const file = join(dir, 'package.json');
    const text = readFileSync(file, 'utf8');
    const pkg = JSON.parse(text) as Record<string, Record<string, string> | undefined>;
    const tarballs = tarballsDir();
    const spec = (name: string) => {
      if (!tarballs) return `^${VERSION}`;
      const tgz = join(tarballs, `wealthcompass-${name}-${VERSION}.tgz`);
      const rel = relative(dir, tgz).split('\\').join('/');
      return `file:${(rel.match(/\.\.\//g)?.length ?? 0) > 3 ? tgz : rel}`;
    };
    let changed = 0;
    for (const section of ['dependencies', 'devDependencies']) {
      const deps = pkg[section];
      if (!deps) continue;
      for (const name of Object.keys(deps)) {
        if (!name.startsWith('@wealthcompass/')) continue;
        const next = spec(name.split('/')[1]);
        if (deps[name] !== next) {
          deps[name] = next;
          changed++;
        }
      }
    }
    if (!changed) return { changed: 0 };
    const edits = new Map([[file, [{ pos: 0, end: text.length, text: JSON.stringify(pkg, null, 2) + '\n' }]]]);
    const { patch } = buildGitPatch(edits, dir);
    writeFileSync(join(dir, 'wealthcompass-setup.patch'), patch);
    return { changed };
  });

  app.post('/api/install', async (_req, reply) => {
    const dir = requireApp();
    await stream(reply, async (log) => {
      await runCommand('npm', ['install', '--no-audit', '--no-fund'], dir, log);
      return { ok: true };
    });
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

  // ---------------- Chạy backend và web ----------------
  app.get('/api/run', async () => {
    const dir = requireApp();
    const env = readEnvFile(join(dir, 'wealthcompass.env'));
    const port = Number(env['PORT'] ?? 8890);
    let health: unknown = null;
    if (procInfo('backend').running) {
      try {
        health = await (await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: AbortSignal.timeout(1500) })).json();
      } catch {
        health = null;
      }
    }
    const devPort = projectSummary(dir).devPort;
    return {
      backend: { ...procInfo('backend'), port, health, available: Boolean(backendBin(dir)) },
      web: { ...procInfo('web'), port: devPort, url: `http://localhost:${devPort}`, available: Boolean(ngBin(dir)) },
    };
  });

  app.post('/api/run/:name/:action', async (req) => {
    const dir = requireApp();
    const { name, action } = req.params as { name: ProcName; action: 'start' | 'stop' };
    if (action === 'stop') {
      stopProc(name);
      return procInfo(name);
    }
    if (name === 'backend') {
      const bin = backendBin(dir);
      if (!bin) throw httpError(400, 'Chưa cài @wealthcompass/server trong dự án (áp patch tích hợp rồi npm install)');
      if (!existsSync(join(dir, 'wealthcompass.env'))) throw httpError(400, 'Chưa có wealthcompass.env (chạy tích hợp trước)');
      // Studio bật debug (chỉ nhận từ máy này) cho trang Thử trợ lý/Kiểm thử, và ghi nhật ký cho trang Nhật ký
      const env = { ...llmEnv(), COMPASS_DEBUG: '1', COMPASS_LOG_FILE: eventLogFile(dir) };
      return startProc('backend', process.execPath, [bin, '--env-file', 'wealthcompass.env'], dir, env);
    }
    if (name === 'web') {
      const ng = ngBin(dir);
      if (!ng) throw httpError(400, 'Chưa cài Angular CLI trong dự án (npm install)');
      const port = projectSummary(dir).devPort;
      return startProc('web', process.execPath, [ng, 'serve', '--port', String(port), '--host', '127.0.0.1'], dir, process.env);
    }
    throw httpError(400, 'Tiến trình không hợp lệ');
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
    return { exists: existsSync(join(dir, 'wealthcompass.env')), values: readEnvFile(join(dir, 'wealthcompass.env')) };
  });

  app.put('/api/env', async (req) => {
    const dir = requireApp();
    const changes = req.body as Record<string, string | null>;
    // Không cho ghi khóa LLM vào file: khóa chỉ đặt qua biến môi trường hoặc phiên Studio
    if (Object.keys(changes).some((k) => /API_KEY/.test(k))) throw httpError(400, 'Không ghi khóa API vào wealthcompass.env');
    updateEnvFile(join(dir, 'wealthcompass.env'), changes);
    return { values: readEnvFile(join(dir, 'wealthcompass.env')), restartNeeded: procInfo('backend').running };
  });

  // ---------------- Cài đặt AI ----------------
  app.get('/api/ai', async () => {
    const c = llm();
    return { provider: c.provider, model: c.model, baseUrl: c.baseUrl, hasKey: Boolean(c.apiKey), keySource: keySource(), aiCode: state.ai.aiCode, providers: Object.keys(LLM_PRESETS) };
  });

  app.put('/api/ai', async (req) => {
    const body = req.body as { provider?: string; model?: string; apiKey?: string | null; aiCode?: boolean };
    if (body.provider !== undefined) state.ai.provider = body.provider || undefined;
    if (body.model !== undefined) state.ai.model = body.model || undefined;
    if (body.apiKey !== undefined) state.ai.apiKey = body.apiKey || undefined;
    if (body.aiCode !== undefined) state.ai.aiCode = body.aiCode;
    const c = llm();
    return { provider: c.provider, model: c.model, baseUrl: c.baseUrl, hasKey: Boolean(c.apiKey), keySource: keySource(), aiCode: state.ai.aiCode, providers: Object.keys(LLM_PRESETS) };
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
    if (existsSync(join(dir, 'angular.json'))) state.appDir = dir;
  }

  await app.listen({ port: opts.port, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${opts.port}/?t=${token}`;
  const close = async () => {
    stopAll();
    await app.close();
  };
  process.on('exit', stopAll);
  return { url, close };
}

function readReport(dir: string): string | null {
  const f = join(dir, 'WEALTHCOMPASS_SETUP.md');
  return existsSync(f) ? readFileSync(f, 'utf8') : null;
}

function exec(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((ok, fail) =>
    execFile(cmd, args, { cwd }, (err, stdout, stderr) => (err ? fail(httpError(400, (stderr || err.message).trim())) : ok(stdout))),
  );
}

