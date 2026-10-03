import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Preset nhà cung cấp LLM tương thích OpenAI. Chọn bằng COMPASS_LLM_PROVIDER; từng biến vẫn ghi đè được.
const LLM_PRESETS = {
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', keyVar: 'DEEPSEEK_API_KEY' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.5-flash', keyVar: 'GOOGLE_API_KEY' },
} as const;

export interface ServerConfig {
  port: number;
  host: string;
  repoRoot: string;
  featureMapPath: string;
  packDir: string;
  allowedOrigins: string[];
  mockIdp: boolean;
  jwt: { jwksUrl: string; issuer: string; audience: string };
  llm: { provider: string; baseUrl: string; apiKey: string | null; model: string; reasoningEffort?: string };
  capabilitiesClaim: string;
  rateLimit: { max: number; windowMs: number };
}

// Chỉ lấy ĐÚNG một biến từ file .env, không nạp cả file vào process.env.
// File của tcbs-agent còn chứa mật khẩu và token khác không liên quan tới demo này.
function readSingleEnv(file: string, key: string): string | null {
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`));
    if (match) return match[1].replace(/\s+#.*$/, '').trim().replace(/^['"]|['"]$/g, '') || null;
  }
  return null;
}

export function loadConfig(): ServerConfig {
  const port = Number(process.env['PORT'] ?? 8890);
  const provider = (process.env['COMPASS_LLM_PROVIDER'] ?? 'deepseek') as keyof typeof LLM_PRESETS;
  const preset = LLM_PRESETS[provider] ?? LLM_PRESETS.deepseek;
  const apiKey =
    process.env['COMPASS_LLM_API_KEY'] ??
    process.env[preset.keyVar] ??
    readSingleEnv(process.env['COMPASS_ENV_FILE'] ?? resolve(homedir(), 'tcbs-agent', '.env'), preset.keyVar);

  return {
    port,
    host: process.env['HOST'] ?? '127.0.0.1',
    repoRoot,
    featureMapPath: resolve(repoRoot, process.env['COMPASS_FEATURE_MAP'] ?? 'examples/iconnect-demo/feature-map.json'),
    packDir: resolve(repoRoot, process.env['COMPASS_PACK'] ?? 'packs/finance-vn'),
    allowedOrigins: (process.env['COMPASS_ORIGINS'] ?? 'http://localhost:4200,http://127.0.0.1:4200').split(','),
    mockIdp: process.env['COMPASS_MOCK_IDP'] !== '0',
    jwt: {
      jwksUrl: process.env['COMPASS_JWKS_URL'] ?? `http://127.0.0.1:${port}/idp/jwks.json`,
      issuer: process.env['COMPASS_JWT_ISSUER'] ?? 'https://idp.demo.local',
      audience: process.env['COMPASS_JWT_AUDIENCE'] ?? 'wealthcompass-demo',
    },
    llm: {
      provider,
      baseUrl: process.env['COMPASS_LLM_BASE_URL'] ?? preset.baseUrl,
      apiKey,
      model: process.env['COMPASS_LLM_MODEL'] ?? preset.model,
      reasoningEffort: process.env['COMPASS_LLM_REASONING_EFFORT'],
    },
    capabilitiesClaim: process.env['COMPASS_CAPABILITIES_CLAIM'] ?? 'roles',
    rateLimit: { max: Number(process.env['COMPASS_RATE_MAX'] ?? 30), windowMs: 10 * 60_000 },
  };
}
