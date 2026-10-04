import { existsSync } from 'node:fs';
import { resolveLlmConfig, resolvePackDir, type LlmConfig } from '@wealthcompass/llm';
import { dirname, resolve } from 'node:path';
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
  packDir: string;
  allowedOrigins: string[];
  mockIdp: boolean;
  jwt: { jwksUrl: string; issuer: string; audience: string };
  llm: LlmConfig;
  capabilitiesClaim: string;
  rateLimit: { max: number; windowMs: number };
  // COMPASS_DEBUG=1: mở /debug/search và /debug/chat, CHỈ nhận yêu cầu từ chính máy này (Studio dùng để thử và kiểm thử)
  debug: boolean;
  // COMPASS_LOG_FILE: ghi nhật ký hỏi đáp JSONL để thống kê
  logFile?: string;
}

export function loadConfig(): ServerConfig {
  const port = Number(process.env['PORT'] ?? 8890);
  return {
    port,
    host: process.env['HOST'] ?? '127.0.0.1',
    repoRoot,
    dataDir: process.env['COMPASS_DATA_DIR'] ?? resolve(inRepo ? repoRoot : process.cwd(), '.wealthcompass'),
    featureMapPath: featureMapPath(),
    packDir: packDir(),
    allowedOrigins: (process.env['COMPASS_ORIGINS'] ?? 'http://localhost:4200,http://127.0.0.1:4200').split(','),
    mockIdp: process.env['COMPASS_MOCK_IDP'] !== '0',
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
  };
}

function featureMapPath(): string {
  const value = process.env['COMPASS_FEATURE_MAP'];
  if (value) return resolve(value);
  if (inRepo) return resolve(repoRoot, 'examples/iconnect-demo/feature-map.json');
  throw new Error('Thiếu COMPASS_FEATURE_MAP: đường dẫn tới feature-map.json của web (do `wealthcompass setup` hoặc `scan` sinh ra).');
}

function packDir(): string {
  const value = process.env['COMPASS_PACK'] ?? 'finance-vn';
  const dir = resolvePackDir(value, inRepo ? repoRoot : process.cwd());
  if (!dir) throw new Error(`Không tìm thấy Domain Pack "${value}". Đặt COMPASS_PACK là tên pack có sẵn (finance-vn, generic) hoặc đường dẫn thư mục pack.`);
  return dir;
}
