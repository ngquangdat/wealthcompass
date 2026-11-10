import { existsSync } from 'node:fs';
import { resolveLlmConfig, type LlmConfig } from '@wealthcompass/llm';
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
  // Kho tour (file SQLite dùng chung với tour:record và Studio); COMPASS_TOUR_DB, mặc định compass.tours.db cạnh feature-map.json
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

function featureMapPath(): string {
  const value = process.env['COMPASS_FEATURE_MAP'];
  if (value) return resolve(value);
  if (inRepo) return resolve(repoRoot, 'examples/iconnect-demo/feature-map.json');
  throw new Error('Thiếu COMPASS_FEATURE_MAP: đường dẫn tới feature-map.json của web (do `wealthcompass setup` hoặc `scan` sinh ra).');
}
