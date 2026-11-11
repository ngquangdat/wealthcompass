import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readEnvFile, updateEnvFile } from './env-file';
import { approveFeature, updateFeature } from './overrides-edit';
import { startStudio } from './server';

const tmp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

test('env: giữ chú thích, giá trị rỗng thì comment lại, bỏ comment khi đặt lại', () => {
  const file = join(tmp('studio-env-'), 'wealthcompass.env');
  writeFileSync(file, '# Cấu hình\nPORT=8890\n# COMPASS_JWKS_URL=https://x\nCOMPASS_MOCK_IDP=1\n');
  updateEnvFile(file, { PORT: '9000', COMPASS_JWKS_URL: 'https://sso/jwks', COMPASS_MOCK_IDP: null, NEW_KEY: 'v' });
  const text = readFileSync(file, 'utf8');
  assert.match(text, /^# Cấu hình$/m);
  assert.match(text, /^PORT=9000$/m);
  assert.match(text, /^COMPASS_JWKS_URL=https:\/\/sso\/jwks$/m);
  assert.match(text, /^# COMPASS_MOCK_IDP=$/m);
  assert.deepEqual(readEnvFile(file), { PORT: '9000', COMPASS_JWKS_URL: 'https://sso/jwks', NEW_KEY: 'v' });
  assert.throws(() => updateEnvFile(file, { 'BAD KEY': 'x' }), /không hợp lệ/);
});

test('overrides: sửa trường nào thì bỏ trường đó khỏi llmDraft; duyệt xóa llmDraft và dòng DRAFT', () => {
  const file = join(tmp('studio-ov-'), 'compass.overrides.yaml');
  writeFileSync(
    file,
    [
      '# Viết tay',
      'features:',
      '  leave:',
      '    # DRAFT (LLM soạn ngày 2026-10-03, bằng enrich): cần người duyệt',
      '    description: Mô tả AI',
      '    keywords: [a, b]',
      '    llmDraft: [description, keywords]',
      '',
    ].join('\n'),
  );
  updateFeature(file, 'leave', { description: 'Mô tả người sửa' });
  let text = readFileSync(file, 'utf8');
  assert.match(text, /# Viết tay/);
  assert.match(text, /description: Mô tả người sửa/);
  assert.match(text, /llmDraft:\s*\n?\s*-?\s*\[?keywords/);
  assert.match(text, /DRAFT/, 'còn trường nháp nên vẫn giữ dòng DRAFT');

  approveFeature(file, 'leave');
  text = readFileSync(file, 'utf8');
  assert.doesNotMatch(text, /llmDraft/);
  assert.doesNotMatch(text, /DRAFT/);

  updateFeature(file, 'login', { hidden: true });
  assert.match(readFileSync(file, 'utf8'), /login:\s*\n\s+hidden: true/);
  updateFeature(file, 'login', { hidden: false });
  assert.doesNotMatch(readFileSync(file, 'utf8'), /login:/, 'bỏ ẩn và không còn gì thì xóa hẳn mục');
});

function call(port: number, path: string, headers: Record<string, string>, method = 'GET', body?: string): Promise<{ status: number; body: string }> {
  return new Promise((ok, fail) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => ok({ status: res.statusCode ?? 0, body: data }));
    });
    req.on('error', fail);
    if (body) req.write(body);
    req.end();
  });
}

test('API Studio: không cần token; chặn Host lạ và yêu cầu từ trang web khác; không cho ghi khóa API vào file', async () => {
  const port = 5390 + Math.floor(Math.random() * 50);
  const { url, close } = await startStudio({ port });
  try {
    assert.equal(url, `http://127.0.0.1:${port}/`, 'link mở Studio không còn token');
    const host = `127.0.0.1:${port}`;
    assert.equal((await call(port, '/api/session', { Host: `evil.example:${port}` })).status, 403, 'Host lạ (DNS rebinding)');
    // Trang web khác trong trình duyệt gọi sang: bị chặn theo Origin hoặc Sec-Fetch-Site
    assert.equal((await call(port, '/api/session', { Host: host, Origin: 'https://evil.example' })).status, 403, 'Origin lạ');
    assert.equal((await call(port, '/api/session', { Host: host, 'Sec-Fetch-Site': 'cross-site' })).status, 403, 'yêu cầu từ site khác');
    assert.equal((await call(port, '/api/project/open', { Host: host, Origin: 'https://evil.example', 'Content-Type': 'application/json' }, 'POST', '{"path":"/"}')).status, 403);
    // Chính giao diện Studio (cùng origin) và công cụ dòng lệnh trên máy
    assert.equal((await call(port, '/api/session', { Host: host, Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-origin' })).status, 200);
    const ok = await call(port, '/api/session', { Host: host });
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.body).project, null);

    // Mở dự án mẫu rồi thử ghi khóa API vào env
    const fixture = join(import.meta.dirname, '../../test-fixtures/setup-app');
    const opened = await call(port, '/api/project/open', { Host: host, 'Content-Type': 'application/json' }, 'POST', JSON.stringify({ path: fixture }));
    assert.equal(JSON.parse(opened.body).name, 'shop');
    const put = await call(port, '/api/env', { Host: host, 'Content-Type': 'application/json' }, 'PUT', JSON.stringify({ COMPASS_LLM_API_KEY: 'sk-x' }));
    assert.equal(put.status, 400);
  } finally {
    await close();
  }
});
