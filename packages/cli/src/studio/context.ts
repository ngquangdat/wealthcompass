import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { Document, parseDocument } from 'yaml';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { OutgoingHttpHeaders } from 'node:http';
import { spawn } from 'node:child_process';
import type { FastifyReply } from 'fastify';
import { resolveLlmConfig, LLM_PRESETS } from '@wealthcompass/llm';
import { findGaps } from '../enrich';
import { loadConfig, scan, type ScanResult } from '../scan';
import { detectProject } from '../setup/detect';
import { readEnvFile } from './env-file';
import { readOverrides } from './overrides-edit';

// Trạng thái và tiện ích dùng chung cho các nhóm API của Studio

interface State {
  appDir: string | null;
  // Ghi đè cấu hình AI trong phiên Studio (không ghi file)
  ai: { provider?: string; model?: string; apiKey?: string; aiCode: boolean };
}

export const state: State = { appDir: null, ai: { aiCode: false } };

export function llmEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (state.ai.provider) env['COMPASS_LLM_PROVIDER'] = state.ai.provider;
  if (state.ai.model) env['COMPASS_LLM_MODEL'] = state.ai.model;
  if (state.ai.apiKey) env['COMPASS_LLM_API_KEY'] = state.ai.apiKey;
  return env;
}

export const llm = () => resolveLlmConfig(llmEnv());

export function keySource(): string | null {
  const env = llmEnv();
  const preset = LLM_PRESETS[(env['COMPASS_LLM_PROVIDER'] ?? 'deepseek') as keyof typeof LLM_PRESETS] ?? LLM_PRESETS.deepseek;
  if (state.ai.apiKey) return 'nhập trong Studio (chỉ trong phiên này)';
  if (env['COMPASS_LLM_API_KEY']) return 'biến COMPASS_LLM_API_KEY';
  if (env[preset.keyVar]) return `biến ${preset.keyVar}`;
  if (env['COMPASS_ENV_FILE'] && resolveLlmConfig(env).apiKey) return `file ${env['COMPASS_ENV_FILE']}`;
  return null;
}

export function requireApp(): string {
  if (!state.appDir) throw httpError(400, 'Chưa chọn dự án');
  return state.appDir;
}

export function httpError(status: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: status });
}

export const configPath = (app: string) => join(app, 'compass.config.yaml');
export const integrated = (app: string) => existsSync(configPath(app));

// Luồng sự kiện cho việc chạy lâu (setup, enrich, npm install): {type:'log'|'result'|'error'}
export async function stream(reply: FastifyReply, task: (log: (m: string) => void) => Promise<unknown>): Promise<void> {
  reply.hijack();
  reply.raw.writeHead(200, { ...(reply.getHeaders() as OutgoingHttpHeaders), 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (e: unknown) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
  try {
    const result = await task((m) => send({ type: 'log', message: m }));
    send({ type: 'result', result });
  } catch (e) {
    send({ type: 'error', message: (e as Error).message });
  }
  reply.raw.end();
}

export function runCommand(cmd: string, args: string[], cwd: string, log: (m: string) => void, env = process.env): Promise<void> {
  return new Promise((ok, fail) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const relay = (d: Buffer) => d.toString().split('\n').filter((l) => l.trim()).forEach(log);
    child.stdout.on('data', relay);
    child.stderr.on('data', relay);
    child.on('error', fail);
    child.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`${cmd} ${args.join(' ')} thoát với mã ${code}`))));
  });
}

export function projectSummary(app: string) {
  const info = detectProject(app);
  return {
    path: app,
    name: info.projectName,
    angularVersion: info.angularVersion,
    devPort: info.devPort,
    bootstrap: info.bootstrap ? { kind: info.bootstrap.kind, root: info.bootstrap.root.className } : null,
    routesFile: info.routesFile,
    menuFile: info.menuFile,
    auth: info.auth ? { service: info.auth.service, tokenExpr: info.auth.tokenExpr, rolesExpr: info.auth.rolesExpr } : null,
    notes: info.notes,
    integrated: integrated(app),
    installed: existsSync(join(app, 'node_modules', '@wealthcompass', 'angular', 'package.json')),
    patchPending: existsSync(join(app, 'wealthcompass-setup.patch')),
  };
}

export function featureRows(app: string) {
  const config = configPath(app);
  const { featureMap, hidden, contexts } = cachedScan(app);
  const { config: cfg, root } = loadConfig(config);
  const raw = readOverrides(join(root, cfg.discovery.overrides));
  return featureMap.features.map((f) => {
    const ov = raw[f.id] ?? {};
    const draft = Array.isArray(ov['llmDraft']) ? (ov['llmDraft'] as string[]) : [];
    return {
      id: f.id,
      route: f.route.pattern,
      title: f.title,
      description: f.description,
      keywords: f.keywords,
      sampleQuestions: f.sampleQuestions,
      menuPath: f.menuPath,
      facets: f.facets,
      requires: f.access.requires,
      // Quyền suy từ guard (để so với bản ghi đè) và guard trên route
      guards: contexts[f.id]?.guards ?? [],
      guardRequires: [...new Set((contexts[f.id]?.guards ?? []).flatMap((g) => cfg.access.guards[g]?.requires ?? []))],
      requiresOverride: Array.isArray(ov['requires']),
      tourIds: f.tourIds,
      targets: f.targets.length,
      overridden: Object.keys(ov).filter((k) => k !== 'llmDraft'),
      draft,
      gaps: findGaps(f),
      hidden: false,
      sourceRef: f.provenance.sourceRef,
    };
  }).concat(
    // Màn hình đang ẩn: hiện để có thể bỏ ẩn; dữ liệu tìm kiếm lấy từ overrides
    hidden.map((h) => {
      const ov = raw[h.id] ?? {};
      return {
        id: h.id,
        route: h.path,
        title: h.title,
        description: String(ov['description'] ?? ''),
        keywords: (ov['keywords'] as string[] | undefined) ?? [],
        sampleQuestions: (ov['sampleQuestions'] as string[] | undefined) ?? [],
        menuPath: [],
        facets: {},
        requires: (ov['requires'] as string[] | undefined) ?? [],
        guards: [] as string[],
        guardRequires: [] as string[],
        requiresOverride: Array.isArray(ov['requires']),
        tourIds: [],
        targets: 0,
        overridden: Object.keys(ov).filter((k) => k !== 'llmDraft'),
        draft: [],
        gaps: [],
        hidden: true,
        sourceRef: h.sourceRef,
      };
    }),
  );
}


// ---------------------------------------------------------------------------
// Bộ nhớ đệm kết quả quét: quét bằng ts-morph mất 1-2 giây, nên chỉ quét lại khi có file đổi.
// Dấu vân tay = thời điểm sửa mới nhất của config, overrides và mọi file trong thư mục nguồn.
// ---------------------------------------------------------------------------

let cache: { key: string; fingerprint: number; result: ScanResult } | null = null;

function newestMtime(dir: string): number {
  let newest = 0;
  const walk = (d: string) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else newest = Math.max(newest, statSync(p).mtimeMs);
    }
  };
  walk(dir);
  return newest;
}

export function cachedScan(app: string): ScanResult {
  const config = configPath(app);
  const { config: cfg, root } = loadConfig(config);
  const files = [config, join(root, cfg.discovery.overrides)].filter(existsSync);
  const fingerprint = Math.max(...files.map((f) => statSync(f).mtimeMs), newestMtime(join(root, cfg.discovery.srcRoot)));
  if (cache && cache.key === config && cache.fingerprint === fingerprint) return cache.result;
  const result = scan(config);
  // scan ghi lại feature-map.json/lock (không nằm trong thư mục nguồn nên không làm đổi dấu vân tay)
  cache = { key: config, fingerprint, result };
  return result;
}

export function invalidateScan(): void {
  cache = null;
}

// Các patch Studio sinh ra để người xem trước khi áp
const PATCHES: Record<string, string> = { setup: 'wealthcompass-setup.patch', tourid: 'wealthcompass-tourid.patch' };
export function patchFile(app: string, name = 'setup'): string {
  const file = PATCHES[name];
  if (!file) throw httpError(400, 'Tên patch không hợp lệ');
  return join(app, file);
}

// Nhật ký hỏi đáp của backend do Studio bật: để ngoài dự án (không lẫn vào git), mỗi dự án một file
export function eventLogFile(app: string): string {
  const id = createHash('sha256').update(resolve(app)).digest('hex').slice(0, 8);
  return join(homedir(), '.wealthcompass', 'logs', `${basename(app).replace(/[^\w.-]/g, '_')}-${id}.jsonl`);
}

// Địa chỉ backend của dự án (PORT trong wealthcompass.env, mặc định 8890); Studio gọi qua 127.0.0.1
export function backendUrl(app: string): string {
  const file = join(app, 'wealthcompass.env');
  const port = existsSync(file) ? readEnvFile(file)['PORT'] : undefined;
  return `http://127.0.0.1:${port || 8890}`;
}

export function loadDoc(file: string): Document {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const doc = text.trim() ? parseDocument(text) : new Document({});
  if (doc.errors.length) throw httpError(400, `${file} không phải YAML hợp lệ: ${doc.errors[0].message}`);
  return doc;
}

// Lấy khối JSON trong câu trả lời của LLM (có model bọc thêm chữ hoặc ```json)
export function parseJson(text: string): unknown {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  return JSON.parse(s >= 0 && e > s ? text.slice(s, e + 1) : text);
}
