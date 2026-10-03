import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

// Preset nhà cung cấp LLM tương thích OpenAI. Chọn bằng COMPASS_LLM_PROVIDER; từng biến vẫn ghi đè được.
export const LLM_PRESETS = {
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', keyVar: 'DEEPSEEK_API_KEY' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.5-flash', keyVar: 'GOOGLE_API_KEY' },
} as const;

export interface LlmConfig {
  provider: string;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  reasoningEffort?: string;
}

// Chỉ lấy ĐÚNG một biến từ file .env, không nạp cả file vào process.env:
// file .env của dự án khác thường còn chứa mật khẩu và token không liên quan tới công cụ này.
export function readSingleEnv(file: string, key: string): string | null {
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`));
    if (match) return match[1].replace(/\s+#.*$/, '').trim().replace(/^['"]|['"]$/g, '') || null;
  }
  return null;
}

export function resolveLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const provider = (env['COMPASS_LLM_PROVIDER'] ?? 'deepseek') as keyof typeof LLM_PRESETS;
  const preset = LLM_PRESETS[provider] ?? LLM_PRESETS.deepseek;
  // Không tự mò vào file của dự án khác: chỉ đọc file .env khi người dùng chỉ rõ bằng COMPASS_ENV_FILE
  const envFile = env['COMPASS_ENV_FILE'];
  const apiKey =
    env['COMPASS_LLM_API_KEY'] ??
    env[preset.keyVar] ??
    (envFile ? readSingleEnv(resolve(envFile.replace(/^~(?=$|\/)/, homedir())), preset.keyVar) : null);
  return {
    provider,
    baseUrl: env['COMPASS_LLM_BASE_URL'] ?? preset.baseUrl,
    apiKey,
    model: env['COMPASS_LLM_MODEL'] ?? preset.model,
    reasoningEffort: env['COMPASS_LLM_REASONING_EFFORT'],
  };
}
