import { existsSync } from 'node:fs';
import { exists, mtime, readText } from '@wealthcompass/tourdb';
import { configPathOf, dataRoot } from '../project';
import { Document, parseDocument } from 'yaml';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { OutgoingHttpHeaders } from 'node:http';
import type { FastifyReply } from 'fastify';
import { resolveLlmConfig, LLM_PRESETS } from '@wealthcompass/llm';
import { findGaps } from '../enrich';
import { indexIgnore, loadConfig, scan, type ScanResult } from '../scan';
import { forgetFingerprints, indexed, sourceFingerprint } from '../index-cache';
import { codeChecks, type Check } from '../setup/doctor';
import { detectProject } from '../setup/detect';
import { readEnvFile } from './env-file';
import { readOverrides } from './overrides-edit';

// Trạng thái và tiện ích dùng chung cho các nhóm API của Studio

interface State {
  appDir: string | null;
  // Ghi đè cấu hình AI trong phiên Studio (không ghi file)
  ai: { provider?: string; model?: string; apiKey?: string };
}

export const state: State = { appDir: null, ai: {} };

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

// Cấu hình của dự án: trong kho dự án SQLite (mặc định) hoặc cạnh source (dự án kiểu cũ)
export const configPath = (app: string) => configPathOf(app);
// Tài liệu dữ liệu khác của dự án (wealthcompass.env, compass.eval.yaml...)
export const dataFile = (app: string, name: string) => join(dataRoot(app), name);
export const integrated = (app: string) => exists(configPath(app));

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

// Dự án tour chưa có source của web: chỉ có compass.config.yaml với discovery.source: none (tạo bằng `wealthcompass init`)
export function noSource(app: string): boolean {
  if (!integrated(app)) return false;
  try {
    return loadConfig(configPath(app)).config.discovery.source === 'none';
  } catch {
    return false;
  }
}

// Thư mục Studio mở được: web Angular, hoặc dự án tour chưa có source
export const isProject = (dir: string) => existsSync(join(dir, 'angular.json')) || noSource(dir);

export function webUrl(app: string): string | null {
  try {
    return loadConfig(configPath(app)).config.web?.url ?? null;
  } catch {
    return null;
  }
}

export function projectSummary(app: string) {
  if (noSource(app)) {
    return {
      path: app,
      name: basename(app),
      angularVersion: null,
      devPort: 4200,
      bootstrap: null,
      routesFile: null,
      menuFile: null,
      auth: null,
      notes: [] as string[],
      integrated: true,
      installed: false,
      patchPending: false,
      noSource: true,
      webUrl: webUrl(app),
    };
  }
  // Dò cấu trúc dự án phải nạp ts-morph: lưu vào chỉ mục, chỉ dò lại khi source đổi
  const detected = indexed(app, 'detect', appFingerprint(app), () => {
    const info = detectProject(app);
    return {
      name: info.projectName,
      angularVersion: info.angularVersion,
      devPort: info.devPort,
      bootstrap: info.bootstrap ? { kind: info.bootstrap.kind, root: info.bootstrap.root.className } : null,
      routesFile: info.routesFile,
      menuFile: info.menuFile,
      auth: info.auth ? { service: info.auth.service, tokenExpr: info.auth.tokenExpr, rolesExpr: info.auth.rolesExpr } : null,
      notes: info.notes,
    };
  });
  return {
    path: app,
    ...detected,
    integrated: integrated(app),
    installed: existsSync(join(app, 'node_modules', '@wealthcompass', 'angular', 'package.json')),
    patchPending: existsSync(join(app, 'wealthcompass-setup.patch')),
    noSource: false,
    webUrl: webUrl(app),
    // Nơi lưu dữ liệu của dự án: file kho SQLite ngoài source, hoặc chính thư mục web (kiểu cũ)
    dataStore: dataRoot(app),
    legacyFiles: !dataRoot(app).endsWith('.db') && integrated(app),
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

let cache: { key: string; fingerprint: string; result: ScanResult } | null = null;


// Dấu vân tay source của dự án (bỏ qua file dữ liệu của WealthCompass)
export function appFingerprint(app: string): string {
  let ignore = ['compass.overrides.yaml', 'compass.tours.json', 'compass.tours.db', 'feature-map.json', 'compass.lock.json'];
  try {
    if (integrated(app)) ignore = indexIgnore(loadConfig(configPath(app)).config);
  } catch {
    // cấu hình hỏng: dùng tên mặc định
  }
  return sourceFingerprint(app, ignore);
}

// Các mục kiểm cần đọc mã nguồn: lấy từ chỉ mục, source đổi mới quét đầy đủ và kiểm lại
export function cachedCodeChecks(app: string): Check[] {
  return indexed(app, 'doctor-code', appFingerprint(app), () => codeChecks(app, undefined, cachedScan(app, true)));
}

// `full`: cần đối tượng ts-morph (phân tích guard, gợi ý tourId, enrich). Mặc định dùng chỉ mục source: mở Studio
// hay lưu một tour không phải nạp lại toàn bộ mã nguồn.
export function cachedScan(app: string, full = false): ScanResult {
  const config = configPath(app);
  const { config: cfg, root } = loadConfig(config);
  // Kho tour: file .db (hoặc compass.tours.json của bản trước khi chưa chuyển)
  const toursDb = join(root, cfg.discovery.tours).replace(/\.json$/, '.db');
  const files = [config, join(root, cfg.discovery.overrides), toursDb, toursDb.replace(/\.db$/, '.json')].filter((f) => exists(f));
  // File dữ liệu theo mtime; source theo commit + file đang sửa dở (không duyệt cả cây thư mục mỗi lần)
  const fingerprint = `${Math.max(0, ...files.map((f) => mtime(f)))}|${cfg.discovery.source === 'none' ? '' : appFingerprint(app)}`;
  if (cache && cache.key === config && cache.fingerprint === fingerprint && (!full || !cache.result.fromIndex)) return cache.result;
  const result = scan(config, { useIndex: !full });
  // scan ghi lại feature-map.json/lock (không nằm trong thư mục nguồn nên không làm đổi dấu vân tay)
  cache = { key: config, fingerprint, result };
  return result;
}

export function invalidateScan(): void {
  cache = null;
  forgetFingerprints();
}

// Nhật ký hỏi đáp của backend do Studio bật: để ngoài dự án (không lẫn vào git), mỗi dự án một file
export function eventLogFile(app: string): string {
  const id = createHash('sha256').update(resolve(app)).digest('hex').slice(0, 8);
  return join(homedir(), '.wealthcompass', 'logs', `${basename(app).replace(/[^\w.-]/g, '_')}-${id}.jsonl`);
}

// Địa chỉ backend của dự án (PORT trong wealthcompass.env, mặc định 8890); Studio gọi qua 127.0.0.1
export function backendUrl(app: string): string {
  const file = dataFile(app, 'wealthcompass.env');
  const port = exists(file) ? readEnvFile(file)['PORT'] : undefined;
  return `http://127.0.0.1:${port || 8890}`;
}

export function loadDoc(file: string): Document {
  const text = exists(file) ? readText(file) : '';
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
