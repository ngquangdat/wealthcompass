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
