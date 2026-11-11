import { strict as assert } from 'node:assert';
import { cpSync, existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { exists, listDocuments, readText } from '@wealthcompass/tourdb';
import { configPathOf, dataRoot, migrateToStore, resolveConfigArg, usesStore } from './project';
import { readToursFile, writeTours } from './record/write';
import { scan } from './scan';
import { FeatureStore } from '../../../server/src/feature-store';
import { TourStore } from '../../../server/src/tour-store';

const fixture = resolve(import.meta.dirname, '../test-fixtures/mini-app');
const tour = { title: 'Xem tài sản', startRoute: '/home', steps: [{ key: 's1', locator: { tag: 'a', name: 'Tài sản', attrs: {}, context: {} }, route: '/home', advanceOn: 'click' as const, text: 'Bấm **Tài sản**.' }] };

test('migrate: chuyển dự án kiểu cũ vào một file SQLite ngoài source; scan, Studio và backend đọc cùng kho đó', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compass-migrate-'));
  cpSync(fixture, dir, { recursive: true });
  // Trước khi chuyển: dữ liệu nằm cạnh source
  assert.equal(usesStore(dir), false);
  const before = scan(configPathOf(dir));
  writeTours(join(dir, 'compass.tours.db'), { tours: { 'xem-tai-san': tour } }, 'test');
  writeFileSync(join(dir, 'wealthcompass.env'), `PORT=8891\nCOMPASS_FEATURE_MAP=${join(dir, 'feature-map.json')}\nCOMPASS_ORIGINS=http://localhost:4200\n`);
  const sourceFiles = readdirSync(join(dir, 'src'), { recursive: true }).length;

  const { db, moved } = migrateToStore(dir);
  assert.ok(db.endsWith('.db') && !db.startsWith(dir));
  assert.ok(moved.length >= 5);
  // Source web không còn file nào của WealthCompass, mã nguồn không bị đụng
  for (const name of ['compass.config.yaml', 'compass.overrides.yaml', 'feature-map.json', 'compass.lock.json', 'wealthcompass.env', 'compass.tours.db', 'compass.tours.json']) {
    assert.equal(existsSync(join(dir, name)), false, name);
  }
  assert.equal(readdirSync(join(dir, 'src'), { recursive: true }).length, sourceFiles);

  // Từ đây mọi thứ tìm dữ liệu qua thư mục web như cũ, nhưng đọc từ kho
  assert.equal(usesStore(dir), true);
  assert.equal(dataRoot(dir), db);
  assert.equal(resolveConfigArg(undefined, dir), join(db, 'compass.config.yaml'));
  assert.equal(resolveConfigArg(db), join(db, 'compass.config.yaml'), '--config nhận cả file kho');
  assert.deepEqual(listDocuments(db), ['compass.config.yaml', 'compass.lock.json', 'compass.overrides.yaml', 'feature-map.json', 'wealthcompass.env']);
  assert.match(readText(join(db, 'compass.config.yaml')), /sourceDir:/);
  assert.doesNotMatch(readText(join(db, 'wealthcompass.env')), /COMPASS_FEATURE_MAP/, 'backend tự tìm bản đồ tính năng trong kho');
  assert.match(readText(join(db, 'wealthcompass.env')), /PORT=8891/);

  const after = scan(configPathOf(dir));
  assert.deepEqual(after.featureMap.features.map((f) => f.id), before.featureMap.features.map((f) => f.id), 'quét source từ kho cho cùng kết quả');
  assert.ok(after.featureMap.tours.some((t) => t.id === 'xem-tai-san'), 'tour đi theo vào kho');
  assert.ok(exists(join(db, 'feature-map.json')));
  assert.deepEqual(Object.keys(readToursFile(join(db, 'compass.tours.db')).tours), ['xem-tai-san']);

  // Backend: bản đồ tính năng và tour đọc từ chính file kho
  const store = new FeatureStore(join(db, 'feature-map.json'));
  assert.equal(store.featureMap.features.length, after.featureMap.features.length);
  assert.deepEqual(new TourStore(join(db, 'compass.tours.db')).list().map((t) => t.id), ['xem-tai-san']);
});

test('bản mẫu: xuất kho ra thư mục cạnh source, máy chưa có kho tự dựng lại từ đó (clone về là chạy được)', async () => {
  const { exportProject, projectDbFor, seedDirFor } = await import('@wealthcompass/tourdb');
  const { rmSync } = await import('node:fs');
  const web = join(mkdtempSync(join(tmpdir(), 'compass-seed-')), 'shop');
  cpSync(fixture, web, { recursive: true });
  const { db } = migrateToStore(web);
  writeTours(join(db, 'compass.tours.db'), { tours: { 'xem-tai-san': tour } }, 'test');
  const features = scan(configPathOf(web)).featureMap.features.map((f) => f.id);

  // Xuất: file văn bản nằm cạnh (không nằm trong) source; không ghi đường dẫn source của máy này
  const seed = seedDirFor(web);
  assert.equal(seed, `${web}.compass`);
  exportProject(db, seed);
  assert.deepEqual(readdirSync(seed).sort(), ['compass.config.yaml', 'compass.lock.json', 'compass.overrides.yaml', 'feature-map.json', 'tours.json']);
  assert.doesNotMatch(readText(join(seed, 'compass.config.yaml')), /sourceDir/);
  assert.equal(readdirSync(web).some((f) => f.startsWith('compass') || f === 'feature-map.json'), false, 'source vẫn sạch');

  // "Máy mới": chưa có kho. Lần đầu hỏi dữ liệu của web, kho được dựng từ bản mẫu.
  rmSync(db);
  assert.equal(dataRoot(web), projectDbFor(web));
  assert.match(readText(configPathOf(web)), new RegExp(`sourceDir: "${web.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), 'điền lại đường dẫn source của máy này');
  assert.deepEqual(scan(configPathOf(web)).featureMap.features.map((f) => f.id), features);
  assert.deepEqual(Object.keys(readToursFile(join(db, 'compass.tours.db')).tours), ['xem-tai-san']);
});
