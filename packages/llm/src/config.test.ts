import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { resolveLlmConfig } from './config';

function envFile(content: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'compass-env-')), '.env');
  writeFileSync(file, content);
  return file;
}

test('không có biến nào: không có khóa, không tự đọc file của dự án khác', () => {
  const c = resolveLlmConfig({ HOME: mkdtempSync(join(tmpdir(), 'home-')) });
  assert.equal(c.apiKey, null);
  assert.equal(c.provider, 'deepseek');
});

test('COMPASS_ENV_FILE: chỉ đọc đúng một biến theo nhà cung cấp, không nạp cả file', () => {
  const file = envFile('DB_PASSWORD=bi-mat\nDEEPSEEK_API_KEY=sk-tu-file  # ghi chu\nGOOGLE_API_KEY=g-key\n');
  const env: NodeJS.ProcessEnv = { COMPASS_ENV_FILE: file };
  assert.equal(resolveLlmConfig(env).apiKey, 'sk-tu-file');
  assert.equal(env['DB_PASSWORD'], undefined, 'không đưa biến khác của file vào môi trường');
  assert.equal(resolveLlmConfig({ ...env, COMPASS_LLM_PROVIDER: 'gemini' }).apiKey, 'g-key');
});

test('thứ tự ưu tiên: COMPASS_LLM_API_KEY > biến của nhà cung cấp > file', () => {
  const file = envFile('DEEPSEEK_API_KEY=tu-file\n');
  assert.equal(resolveLlmConfig({ COMPASS_ENV_FILE: file, DEEPSEEK_API_KEY: 'tu-env' }).apiKey, 'tu-env');
  assert.equal(resolveLlmConfig({ COMPASS_ENV_FILE: file, DEEPSEEK_API_KEY: 'tu-env', COMPASS_LLM_API_KEY: 'ro-rang' }).apiKey, 'ro-rang');
});

test('COMPASS_ENV_FILE trỏ tới file không tồn tại: không lỗi, chỉ là không có khóa', () => {
  assert.equal(resolveLlmConfig({ COMPASS_ENV_FILE: '/khong/ton/tai/.env' }).apiKey, null);
});
