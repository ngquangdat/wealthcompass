import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { setup } from '../setup/setup';
import { startStudio } from './server';

const fixtures = resolve(import.meta.dirname, '../../test-fixtures');

// App mẫu đã chạy setup và áp patch, trong repo git riêng
async function integratedApp(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'studio-p2-'));
  cpSync(join(fixtures, 'setup-app'), dir, { recursive: true });
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'i');
  const tgz = mkdtempSync(join(tmpdir(), 'studio-p2-tgz-'));
  mkdirSync(tgz, { recursive: true });
  for (const n of ['angular', 'core', 'contracts', 'cli', 'server']) writeFileSync(join(tgz, `wealthcompass-${n}-0.1.0.tgz`), '');
  const result = await setup(
    { app: dir, pack: 'generic', backendUrl: 'http://localhost:8890', tarballs: tgz, version: '0.1.0', llm: null, aiCode: false, annotate: null, force: false, today: '2026-10-03' },
    () => undefined,
  );
  git('apply', result.patchFile!);
  return dir;
}

function client(port: number, token: string) {
  return (method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> =>
    new Promise((ok, fail) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const headers: Record<string, string> = { Host: `127.0.0.1:${port}`, 'X-Studio-Token': token };
      if (data) headers['Content-Type'] = 'application/json';
      const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => ok({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : null }));
      });
      req.on('error', fail);
      if (data) req.write(data);
      req.end();
    });
}

test('Studio đợt 2: quyền, gắn tourId, tour, domain pack qua API', async () => {
  const dir = await integratedApp();
  const port = 5440 + Math.floor(Math.random() * 50);
  const { url, close } = await startStudio({ port, tarballs: null, open: dir });
  const api = client(port, new URL(url).searchParams.get('t')!);
  try {
    // --- Quyền: guard đoán từ tên là nháp; duyệt xong ghi chú "đã duyệt"
    let guards = (await api('GET', '/api/guards')).json as Array<{ name: string; status: string; requires: string[] }>;
    assert.equal(guards.find((g) => g.name === 'reportsGuard')?.status, 'draft');
    assert.equal(guards.find((g) => g.name === 'adminGuard')?.status, 'code');
    assert.equal((await api('PUT', '/api/guards/reportsGuard', { requires: ['bad role!'] })).status, 400);
    assert.equal((await api('PUT', '/api/guards/reportsGuard', { requires: ['reports_viewer', 'reports_viewer'] })).status, 200);
    guards = (await api('GET', '/api/guards')).json;
    const reports = guards.find((g) => g.name === 'reportsGuard')!;
    assert.deepEqual([reports.status, reports.requires], ['reviewed', ['reports_viewer']]);
    assert.match(readFileSync(join(dir, 'compass.config.yaml'), 'utf8'), /reportsGuard: \{ requires: \[ reports_viewer \] \} # đã duyệt trong Studio/);

    // --- Gắn tourId: tên sai/trùng bị từ chối; nhạy cảm "chắc chắn" không bỏ được dù gửi userOnly=false
    const scan = (await api('GET', '/api/tourids')).json as { candidates: Array<{ key: string; label: string; sensitive: { level: string } | null }> };
    const cancel = scan.candidates.find((c) => c.label === 'Hủy đơn')!;
    const submit = scan.candidates.find((c) => c.label === 'Gửi yêu cầu')!;
    assert.equal(submit.sensitive?.level, 'sure');
    assert.equal((await api('POST', '/api/tourids/patch', { items: [{ key: cancel.key, tourId: 'Sai Ten', userOnly: false }] })).status, 400);
    assert.equal((await api('POST', '/api/tourids/patch', { items: [{ key: cancel.key, tourId: 'trung', userOnly: false }, { key: submit.key, tourId: 'trung', userOnly: false }] })).status, 400);
    const patch = await api('POST', '/api/tourids/patch', {
      items: [
        { key: cancel.key, tourId: 'orders-cancel', userOnly: true, hint: 'Hủy đơn chưa giao' },
        { key: submit.key, tourId: 'returns-submit', userOnly: false },
      ],
    });
    assert.equal(patch.status, 200);
    const hunks = (patch.json.files as Array<{ hunks: Array<{ id: string }> }>).flatMap((f) => f.hunks.map((h) => h.id));
    assert.equal((await api('POST', '/api/patch/apply', { name: 'tourid', hunks })).status, 200);
    const routes = readFileSync(join(dir, 'src/app/app.routes.ts'), 'utf8');
    assert.match(routes, /<button tourId="orders-cancel"[^>]*tourHint="Hủy đơn chưa giao"[^>]*tourRole="user-only"/);
    assert.match(routes, /<button tourId="returns-submit"[^>]*tourRole="user-only"/, 'submit vẫn là user-only');

    // --- Tour: lưu từ Studio là bản đã duyệt; tour trỏ tới tourId thật thì hợp lệ; xóa được
    assert.equal((await api('PUT', '/api/tours/Bad%20Id', { title: 'x', startRoute: '/', steps: [] })).status, 400);
    const saved = await api('PUT', '/api/tours/huy-don', {
      title: 'Hủy đơn hàng',
      feature: 'orders',
      startRoute: '/orders',
      steps: [{ target: 'orders-cancel', advanceOn: 'next', text: 'Bấm **Hủy đơn** để hủy.' }],
    });
    assert.equal(saved.status, 200);
    let tours = (await api('GET', '/api/tours')).json as { tours: Array<{ id: string; valid: boolean; draft: boolean; steps: Array<{ sensitive: boolean }> }>; targets: Array<{ tourId: string }> };
    const tour = tours.tours.find((t) => t.id === 'huy-don')!;
    assert.deepEqual([tour.valid, tour.draft, tour.steps[0].sensitive], [true, false, true]);
    assert.ok(tours.targets.some((t) => t.tourId === 'returns-submit'));
    assert.equal((await api('DELETE', '/api/tours/huy-don')).status, 200);
    tours = (await api('GET', '/api/tours')).json;
    assert.equal(tours.tours.length, 0);

    // --- Domain Pack: pack đóng kèm chỉ xem; tạo bản riêng (đường dẫn tương đối) rồi sửa và thử
    let pack = (await api('GET', '/api/pack')).json as { editable: boolean; glossary: string[][] };
    assert.equal(pack.editable, false);
    assert.equal((await api('PUT', '/api/pack', { prompt: 'x' })).status, 400);
    pack = (await api('POST', '/api/pack/fork')).json;
    assert.equal(pack.editable, true);
    assert.ok(existsSync(join(dir, 'compass-pack', 'pack.yaml')));
    assert.match(readFileSync(join(dir, 'compass.config.yaml'), 'utf8'), /domainPack: \.\/compass-pack/);
    if (existsSync(join(dir, 'wealthcompass.env'))) assert.match(readFileSync(join(dir, 'wealthcompass.env'), 'utf8'), /^COMPASS_PACK=\.\/compass-pack$/m);
    const put = await api('PUT', '/api/pack', { glossary: [...pack.glossary, ['trả hàng', 'hoàn hàng', 'refund'], ['một mình']] });
    assert.equal(put.status, 200);
    assert.equal(put.json.glossary.length, pack.glossary.length + 1, 'nhóm chỉ có một từ bị bỏ');
    assert.equal((await api('PUT', '/api/pack', { topics: [{ id: 'x', patterns: ['('], refusal: 'r' }] })).status, 400, 'mẫu regex hỏng');
    const tried = (await api('POST', '/api/pack/test', { text: 'Muốn hoàn hàng thì làm sao' })).json as { blocked: unknown; expansions: string[][] };
    assert.equal(tried.blocked, null);
    assert.ok(tried.expansions.some((g) => g.includes('refund')));
    const blocked = (await api('POST', '/api/pack/test', { text: 'nhập mật khẩu giúp mình' })).json as { blocked: { topic: string } | null };
    assert.equal(blocked.blocked?.topic, 'act_on_behalf');
  } finally {
    await close();
  }
});
