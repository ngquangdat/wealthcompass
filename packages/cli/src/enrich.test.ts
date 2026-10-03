import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import type { LlmConfig } from '@wealthcompass/llm';
import { enrich, findGaps, mergeDrafts } from './enrich';
import { scan } from './scan';

const fixture = resolve(import.meta.dirname, '../test-fixtures/mini-app');

// Bản sao tạm của app mẫu để scanner ghi feature-map/lock mà không đụng repo
function tempApp(): { config: string; overrides: string } {
  const dir = mkdtempSync(join(tmpdir(), 'compass-enrich-'));
  cpSync(fixture, dir, { recursive: true });
  return { config: join(dir, 'compass.config.yaml'), overrides: join(dir, 'compass.overrides.yaml') };
}

type Screen = { id: string; need: string[]; uiText: string[]; have: Record<string, unknown> };

async function fakeLlm(reply: (screens: Screen[], body: any) => unknown): Promise<{ llm: LlmConfig; requests: any[]; close: () => Promise<void> }> {
  const requests: any[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      requests.push(body);
      const screens = JSON.parse(body.messages[1].content).screens as Screen[];
      const out = reply(screens, body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: typeof out === 'string' ? out : JSON.stringify(out) } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { llm: { provider: 'fake', baseUrl: `http://127.0.0.1:${port}`, apiKey: 'k', model: 'm' }, requests, close: () => new Promise((r) => server.close(() => r())) };
}

const goodReply = (screens: Screen[]) => ({
  features: screens.map((s) =>
    s.id === 'blank'
      ? { id: s.id, description: '' }
      : {
          id: s.id,
          description: 'Cho phép người dùng khóa thẻ tín dụng và xem sao kê thẻ. Gọi 0912345678 nếu cần.',
          keywords: ['khoa the', 'the tin dung', 'khóa thẻ', 'khoa the'],
          sampleQuestions: ['khóa thẻ ở đâu', 'khoa the tin dung'],
        },
  ),
});

test('title lấy từ nhãn menu khi route không có title; chữ UI lấy từ template', () => {
  const app = tempApp();
  const { featureMap, contexts } = scan(app.config);
  const byId = Object.fromEntries(featureMap.features.map((f) => [f.id, f]));
  assert.equal(byId['loans'].title, 'Khoản vay');
  assert.equal(byId['cards'].title, 'Thẻ tín dụng');
  assert.equal(byId['blank'].title, 'Trống', 'title khai trong route vẫn thắng nhãn menu');
  assert.deepEqual(contexts['cards'].uiText, ['Thẻ tín dụng', 'Khóa thẻ, mở thẻ, xem sao kê thẻ', 'Số thẻ', 'Khóa thẻ']);
  // Phần nội suy bị bỏ, <style> bị bỏ
  assert.deepEqual(contexts['loans'].uiText, ['Khoản vay của tôi', 'Tất toán', 'Dư nợ:']);
});

test('findGaps chỉ liệt kê trường đang trống', () => {
  const { featureMap } = scan(tempApp().config);
  const byId = Object.fromEntries(featureMap.features.map((f) => [f.id, f]));
  assert.deepEqual(findGaps(byId['loans']), ['keywords', 'sampleQuestions']);
  assert.deepEqual(findGaps(byId['cards']), ['description', 'keywords', 'sampleQuestions']);
});

test('enrich: chỉ điền chỗ trống, không đè mô tả viết tay, đánh dấu llmDraft và scanner cảnh báo', async () => {
  const app = tempApp();
  const fake = await fakeLlm(goodReply);
  const log: string[] = [];
  const result = await enrich({ config: app.config, dryRun: false, llm: fake.llm, today: '2026-10-03' }, (m) => log.push(m));
  await fake.close();

  assert.deepEqual(result.drafted.map((d) => d.id).sort(), ['cards', 'loans']);
  assert.deepEqual(result.skipped.map((s) => s.id), ['blank'], 'LLM trả mô tả rỗng nghĩa là không đủ thông tin');

  // LLM chỉ được yêu cầu soạn đúng trường còn thiếu của từng màn hình
  const asked = (JSON.parse(fake.requests[0].messages[1].content).screens as Screen[]).find((s) => s.id === 'loans')!;
  assert.deepEqual(asked.need, ['keywords', 'sampleQuestions']);
  assert.equal(asked.have['description'], 'Xem dư nợ và tất toán khoản vay (viết tay).');
  assert.equal(JSON.stringify(fake.requests[0]).includes('{{'), false, 'phần nội suy không được lọt vào prompt');

  const { featureMap } = scan(app.config);
  const byId = Object.fromEntries(featureMap.features.map((f) => [f.id, f]));
  assert.equal(byId['loans'].description, 'Xem dư nợ và tất toán khoản vay (viết tay).', 'không đè mô tả viết tay');
  assert.ok(byId['loans'].keywords.length > 0);
  assert.match(byId['cards'].description, /khóa thẻ tín dụng/);
  assert.equal(byId['cards'].description.includes('0912345678'), false, 'PII trong đầu ra bị che');
  assert.deepEqual(byId['cards'].keywords, ['khoa the', 'the tin dung', 'khóa thẻ'], 'không trùng, đúng thứ tự');
  assert.ok(byId['cards'].provenance.source.includes('llm'));
  assert.equal(byId['cards'].provenance.reviewed, false);
  assert.ok(featureMap.coverage.warnings.some((w) => w.includes('"cards"') && w.includes('do LLM soạn')));

  const yaml = readFileSync(app.overrides, 'utf8');
  assert.match(yaml, /# Do nghiệp vụ viết tay/, 'giữ chú thích cũ');
  assert.match(yaml, /DRAFT \(LLM soạn ngày 2026-10-03/);
  assert.match(yaml, /llmDraft:/);
});

test('người xóa khóa llmDraft thì hết cảnh báo và tính là đã duyệt; chạy lại enrich không soạn lại phần đã có', async () => {
  const app = tempApp();
  const first = await fakeLlm(goodReply);
  await enrich({ config: app.config, dryRun: false, llm: first.llm }, () => undefined);
  await first.close();

  writeFileSync(app.overrides, readFileSync(app.overrides, 'utf8').replace(/\s+llmDraft:\n(\s+- \w+\n)+/g, '\n'));
  const { featureMap } = scan(app.config);
  assert.equal(featureMap.coverage.warnings.some((w) => w.includes('do LLM soạn')), false);

  const second = await fakeLlm((screens) => ({ features: screens.map((s) => ({ id: s.id, description: '' })) }));
  await enrich({ config: app.config, dryRun: false, llm: second.llm }, () => undefined);
  await second.close();
  const asked = (JSON.parse(second.requests[0].messages[1].content).screens as Screen[]).map((s) => s.id);
  assert.deepEqual(asked, ['blank'], 'chỉ còn màn hình trống thông tin');
});

test('--dry-run không ghi file', async () => {
  const app = tempApp();
  const before = readFileSync(app.overrides, 'utf8');
  const fake = await fakeLlm(goodReply);
  const result = await enrich({ config: app.config, dryRun: true, llm: fake.llm }, () => undefined);
  await fake.close();
  assert.equal(result.written, false);
  assert.equal(readFileSync(app.overrides, 'utf8'), before);
});

test('LLM trả sai định dạng 2 lần: bỏ qua màn hình đó, không ghi gì', async () => {
  const app = tempApp();
  const before = readFileSync(app.overrides, 'utf8');
  const fake = await fakeLlm(() => 'không phải json');
  const result = await enrich({ config: app.config, dryRun: false, llm: fake.llm }, () => undefined);
  await fake.close();
  assert.equal(fake.requests.length, 2);
  assert.equal(result.written, false);
  assert.equal(result.drafted.length, 0);
  assert.equal(readFileSync(app.overrides, 'utf8'), before);
});

test('--only giới hạn phạm vi; id không tồn tại báo lỗi; thiếu khóa LLM báo lỗi', async () => {
  const app = tempApp();
  const fake = await fakeLlm(goodReply);
  await enrich({ config: app.config, dryRun: true, only: ['cards'], llm: fake.llm }, () => undefined);
  assert.deepEqual((JSON.parse(fake.requests[0].messages[1].content).screens as Screen[]).map((s) => s.id), ['cards']);
  await assert.rejects(enrich({ config: app.config, dryRun: true, only: ['nope'], llm: fake.llm }, () => undefined), /Không có feature: nope/);
  await fake.close();
  await assert.rejects(enrich({ config: app.config, dryRun: true, llm: { ...fake.llm, apiKey: null } }, () => undefined), /khóa LLM/);
});

test('mergeDrafts không đè trường người đã viết và giữ chú thích', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compass-'));
  const file = join(dir, 'o.yaml');
  writeFileSync(file, '# giữ\nfeatures:\n  cards:\n    description: Người viết  # giữ nguyên\n');
  const out = mergeDrafts(file, new Map([['cards', { description: 'LLM viết', keywords: ['a b'] }]]), '2026-10-03');
  assert.match(out.yaml, /description: Người viết {1,2}# giữ nguyên/);
  assert.equal(/llmDraft:\n\s+- description/.test(out.yaml), false, 'trường người viết tay không được đánh dấu là nháp LLM');
  assert.match(out.yaml, /llmDraft:\n\s+- keywords/);
  assert.equal(out.yaml.includes('LLM viết'), false);
  assert.match(out.yaml, /# giữ\n/);
  assert.match(out.yaml, /keywords:\n\s+- a b/);
});
