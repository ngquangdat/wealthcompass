import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, utimesSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

// Chỉ mục riêng cho test, không đụng ~/.wealthcompass
process.env['COMPASS_INDEX_DIR'] = mkdtempSync(join(tmpdir(), 'compass-index-'));
const { forgetFingerprints, sourceFingerprint } = await import('./index-cache');
const { indexIgnore, loadConfig, scan } = await import('./scan');

const fixture = resolve(import.meta.dirname, '../test-fixtures/mini-app');

test('chỉ mục source: dùng lại khi source không đổi, quét lại khi có commit mới hoặc file sửa dở', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compass-idx-app-'));
  cpSync(fixture, dir, { recursive: true });
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  const cfg = join(dir, 'compass.config.yaml');
  const ignore = indexIgnore(loadConfig(cfg).config);
  const fp = () => {
    forgetFingerprints();
    return sourceFingerprint(dir, ignore);
  };

  const first = scan(cfg, { useIndex: true });
  assert.equal(first.fromIndex, false, 'lần đầu chưa có chỉ mục');
  const base = fp();
  const second = scan(cfg, { useIndex: true });
  assert.equal(second.fromIndex, true);
  assert.deepEqual({ ...second.featureMap, generatedAt: '' }, { ...first.featureMap, generatedAt: '' }, 'Feature Map từ chỉ mục giống hệt quét đầy đủ');

  // File dữ liệu của WealthCompass đổi (scan vừa ghi feature-map.json, lock; ghi thêm tour): source không đổi
  writeFileSync(join(dir, 'compass.tours.json'), '{"tours":{}}\n');
  assert.equal(fp(), base);
  assert.equal(scan(cfg, { useIndex: true }).fromIndex, true);

  // Sửa source chưa commit: chỉ mục hết hiệu lực; sửa tiếp cùng file cũng vậy
  const routes = join(dir, 'src/app/app.routes.ts');
  appendFileSync(routes, '\n// sửa dở\n');
  const dirty = fp();
  assert.notEqual(dirty, base);
  assert.equal(scan(cfg, { useIndex: true }).fromIndex, false);
  assert.equal(scan(cfg, { useIndex: true }).fromIndex, true);
  appendFileSync(routes, '// sửa tiếp\n');
  utimesSync(routes, new Date(), new Date(Date.now() + 5000));
  assert.notEqual(fp(), dirty);

  // Commit mới: HEAD đổi
  git('add', '-A');
  git('commit', '-q', '-m', 'đổi route');
  const committed = fp();
  assert.notEqual(committed, base);
  assert.equal(scan(cfg, { useIndex: true }).fromIndex, false);
  assert.equal(scan(cfg, { useIndex: true }).fromIndex, true);
  // Quét đầy đủ (CLI scan, annotate, enrich) không bao giờ đọc chỉ mục
  assert.equal(scan(cfg).fromIndex, false);
});
