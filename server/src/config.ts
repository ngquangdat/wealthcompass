import { existsSync } from 'node:fs';
import { resolveLlmConfig, type LlmConfig } from '@wealthcompass/llm';
import { ensureSeeded, projectDbFor } from '@wealthcompass/tourdb';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Đang chạy từ source trong repo (có web demo) hay từ gói đã build
const inRepo = existsSync(resolve(repoRoot, 'examples', 'iconnect-demo'));

export interface ServerConfig {
  port: number;
  host: string;
  repoRoot: string;
  // Nơi lưu dữ liệu chạy (khóa IdP giả lập...); gitignore
  dataDir: string;
  featureMapPath: string;
  allowedOrigins: string[];
  mockIdp: boolean;
  // gateway (mặc định): đã có API gateway xác minh JWT phía trước, backend chỉ đọc
  // thông tin người dùng trong token (KHÔNG kiểm chữ ký): backend chỉ được nhận yêu cầu qua gateway.
  // jwks: backend tự xác minh chữ ký JWT bằng JWKS (COMPASS_AUTH=jwks), dùng khi không có gateway.
  authMode: 'jwks' | 'gateway';
  jwt: { jwksUrl: string; issuer: string; audience: string };
  llm: LlmConfig;
  capabilitiesClaim: string;
  rateLimit: { max: number; windowMs: number };
  // COMPASS_DEBUG=1: mở /debug/search và /debug/chat, CHỈ nhận yêu cầu từ chính máy này (Studio dùng để thử và kiểm thử)
  debug: boolean;
  // COMPASS_LOG_FILE: ghi nhật ký hỏi đáp JSONL để thống kê
  logFile?: string;
  // Kho tour: nằm trong chính kho dự án (cùng file với bản đồ tính năng); dự án kiểu cũ thì compass.tours.db cạnh feature-map.json
  tourDbPath: string;
  // COMPASS_ADMIN_TOKEN: bật API quản trị tour (/admin/tours). Không đặt thì API tắt.
  adminToken?: string;
}

export function loadConfig(): ServerConfig {
  const port = Number(process.env['PORT'] ?? 8890);
  const dataDir = process.env['COMPASS_DATA_DIR'] ?? resolve(inRepo ? repoRoot : process.cwd(), '.wealthcompass');
  return {
    port,
    host: process.env['HOST'] ?? '127.0.0.1',
    repoRoot,
    dataDir,
    featureMapPath: featureMapPath(),
    allowedOrigins: (process.env['COMPASS_ORIGINS'] ?? 'http://localhost:4200,http://127.0.0.1:4200').split(','),
    // Mặc định gateway: API gateway phía trước đã xác minh JWT. Đặt COMPASS_AUTH=jwks để backend tự xác minh chữ ký.
    authMode: process.env['COMPASS_AUTH'] === 'jwks' ? 'jwks' : 'gateway',
    // IdP giả lập chỉ để thử web demo trong repo; nơi khác mặc định tắt
    mockIdp: process.env['COMPASS_MOCK_IDP'] ? process.env['COMPASS_MOCK_IDP'] !== '0' : inRepo,
    jwt: {
      jwksUrl: process.env['COMPASS_JWKS_URL'] ?? `http://127.0.0.1:${port}/idp/jwks.json`,
      issuer: process.env['COMPASS_JWT_ISSUER'] ?? 'https://idp.demo.local',
      audience: process.env['COMPASS_JWT_AUDIENCE'] ?? 'wealthcompass-demo',
    },
    llm: resolveLlmConfig(),
    capabilitiesClaim: process.env['COMPASS_CAPABILITIES_CLAIM'] ?? 'roles',
    rateLimit: { max: Number(process.env['COMPASS_RATE_MAX'] ?? 30), windowMs: 10 * 60_000 },
    debug: process.env['COMPASS_DEBUG'] === '1',
    logFile: process.env['COMPASS_LOG_FILE'] ? resolve(process.env['COMPASS_LOG_FILE']) : undefined,
    tourDbPath: resolve(process.env['COMPASS_TOUR_DB'] ?? join(dirname(featureMapPath()), 'compass.tours.db')),
    adminToken: process.env['COMPASS_ADMIN_TOKEN'] || undefined,
  };
}

// Kho dự án (file SQLite ngoài source của web) mà backend phục vụ: COMPASS_PROJECT là file kho .db hoặc thư mục source
// của web (khi đó suy ra file kho như Studio). Trả null khi không đặt.
export function projectDb(): string | null {
  const value = process.env['COMPASS_PROJECT'];
  if (!value) return null;
  const abs = resolve(value);
  if (abs.endsWith('.db')) return abs;
  // Thư mục web có bản mẫu đi kèm mà máy này chưa có kho: dựng kho từ bản mẫu
  ensureSeeded(abs);
  return projectDbFor(abs);
}

// Bản đồ tính năng: COMPASS_FEATURE_MAP (file) > kho dự án (COMPASS_PROJECT) > web demo trong repo
function featureMapPath(): string {
  const value = process.env['COMPASS_FEATURE_MAP'];
  if (value) return resolve(value);
  const project = projectDb();
  if (project) return join(project, 'feature-map.json');
  if (inRepo) {
    // Web demo trong repo: kho dự án của nó, dựng từ bản mẫu examples/iconnect-demo.compass nếu máy này chưa có
    const demo = resolve(repoRoot, 'examples/iconnect-demo');
    ensureSeeded(demo);
    return join(projectDbFor(demo), 'feature-map.json');
  }
  throw new Error('Thiếu COMPASS_PROJECT: file kho dự án (.db) hoặc thư mục source của web đã chạy `wealthcompass setup`.');
}
