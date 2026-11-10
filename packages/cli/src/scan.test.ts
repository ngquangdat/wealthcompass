import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { scan } from './scan';

// Chạy scanner trên app demo thật và kiểm tra những điều mà agent dựa vào
const config = resolve(import.meta.dirname, '../../../examples/iconnect-demo/compass.config.yaml');
const { featureMap } = scan(config);
const feature = (id: string) => featureMap.features.find((f) => f.id === id)!;

test('tìm đủ route lazy-loaded và route con, bỏ route ẩn', () => {
  const ids = featureMap.features.map((f) => f.id);
  for (const id of ['home', 'iconnect.price-board', 'iconnect.assets', 'money.deposit']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('login'));
  assert.ok(!ids.includes('menu'));
});

test('guard được ánh xạ sang quyền, kể cả guard của route cha', () => {
  assert.deepEqual(feature('iconnect.assets').access.requires, ['bond_account']);
  assert.deepEqual(feature('money.deposit').access.requires, []);
  assert.deepEqual(feature('iconnect.assets').access.unknownGuards, []);
});

test('menuPath lấy từ file menu', () => {
  assert.deepEqual(feature('iconnect.assets').menuPath, ['Trái phiếu', 'Tài sản trái phiếu']);
});

test('tourId nằm trong component con và layout được gán vào màn hình', () => {
  const ids = feature('iconnect.assets').targets.map((t) => t.tourId);
  assert.ok(ids.includes('assets-select-sell'));
  assert.ok(ids.includes('iconnect-tab-assets'), 'tab của layout phải hiện ở mọi route con');
});

test('nút BÁN được đánh dấu user-only', () => {
  const sell = feature('iconnect.assets').targets.find((t) => t.tourId === 'assets-sell-button');
  assert.equal(sell?.sensitivity, 'user-only');
});

test('tour hợp lệ: 4 bước, route từng bước đúng, bước cuối không chờ click', () => {
  const tour = featureMap.tours.find((t) => t.id === 'sell-bond')!;
  assert.deepEqual(tour.steps.map((s) => s.route), ['/home', '/iconnect/price-board', '/iconnect/assets', '/iconnect/assets']);
  assert.equal(tour.steps.at(-1)?.advanceOn, 'next');
  assert.ok(feature('iconnect.assets').tourIds.includes('sell-bond'));
});

test('không còn cảnh báo thiếu title/description/menu', () => {
  const bad = featureMap.coverage.warnings.filter((w) => /thiếu|không có trong menu/.test(w));
  assert.deepEqual(bad, []);
});

test('chưa có source (discovery.source: none): màn hình lấy từ tour đã ghi và route khai trong overrides', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { finishRecording } = await import('./record/run');
  const dir = mkdtempSync(join(tmpdir(), 'compass-nosource-'));
  const cfg = join(dir, 'compass.config.yaml');
  writeFileSync(cfg, 'web: { url: https://staging.example.vn }\ndiscovery:\n  source: none\n');
  writeFileSync(join(dir, 'compass.overrides.yaml'), 'features:\n  orders.detail: { route: /orders/:id, title: Chi tiết lệnh, description: Xem một lệnh }\n');

  // Ghi một tour: hover mở menu, bấm mục trong menu, dừng ở màn hình đích
  const locator = (text: string) => ({ tag: 'div', text, attrs: {}, context: {} });
  await finishRecording(
    { config: cfg, url: 'https://staging.example.vn', id: 'nop-tien', force: false, noLlm: true, dryRun: false, about: 'Hướng dẫn nộp tiền' },
    {
      startRoute: '/home',
      endRoute: '/money/deposit',
      steps: [
        { tourId: null, route: '/home', advanceOn: 'hover', userOnly: false, tag: 'div', text: 'Tiền', locator: locator('Tiền'), opensNext: true },
        { tourId: null, route: '/home', advanceOn: 'click', userOnly: false, tag: 'div', text: 'Nộp tiền', locator: locator('Nộp tiền') },
      ],
    },
    () => undefined,
  );
  const { featureMap: fm } = scan(cfg);
  assert.deepEqual(fm.features.map((f) => f.id).sort(), ['home', 'money.deposit', 'orders.detail']);
  assert.equal(fm.features.find((f) => f.id === 'orders.detail')?.route.pattern, '/orders/:id');
  const tour = fm.tours.find((t) => t.id === 'nop-tien')!;
  assert.deepEqual(tour.steps.map((s) => s.advanceOn), ['hover', 'click']);
  assert.equal(tour.steps[0].skipIfNextVisible, true, 'bước hover bỏ qua được khi menu đã mở');
  assert.deepEqual(fm.features.find((f) => f.id === 'money.deposit')?.tourIds, ['nop-tien'], 'tour gắn với màn hình đích');
  assert.ok(!fm.coverage.warnings.some((w) => w.includes('không có trong Feature Map') || w.includes('không tồn tại')), fm.coverage.warnings.join('\n'));
});
