import { strict as assert } from 'node:assert';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

// Chỉ mục riêng cho test, không đụng ~/.wealthcompass
process.env['COMPASS_INDEX_DIR'] ??= mkdtempSync(join(tmpdir(), 'compass-index-'));
const { loadTranslator } = await import('./i18n');
const { analyzeTemplate } = await import('./template');
const { scan } = await import('./scan');

const fixture = resolve(import.meta.dirname, '../test-fixtures/mini-app');

test('file dịch lồng nhau hoặc phẳng: dịch đúng khóa, bỏ tham số và thẻ HTML; chữ thường giữ nguyên', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compass-i18n-'));
  mkdirSync(join(dir, 'src/assets/i18n'), { recursive: true });
  writeFileSync(join(dir, 'src/assets/i18n/vi.json'), JSON.stringify({ guest: { t2: 'Đổi số điện thoại' }, 'menu.home': 'Trang <b>chủ</b> của {{name}}' }));
  const t = loadTranslator(dir, 'vi');
  assert.equal(t.file, 'src/assets/i18n/vi.json');
  assert.equal(t.text('guest.t2'), 'Đổi số điện thoại');
  assert.equal(t.text('menu.home'), 'Trang chủ của');
  assert.equal(t.text('Khoản vay'), 'Khoản vay');
  assert.equal(t.missing('borrow.link.landing.page.1'), true);
  assert.equal(t.missing('guest.t2'), false);
  assert.equal(t.missing('Khoản vay'), false, 'chữ thường không phải khóa');
});

test('template: khóa trong pipe translate và directive translate được giữ lại để dịch', () => {
  const info = analyzeTemplate(
    `<h2>{{ 'guest.t2' | translate }}</h2><input [placeholder]="'form.phone' | translate" /><span translate="form.otp"></span>` +
      `<button tourId="save" [tourLabel]="'common.save' | translate">{{ total }}</button>`,
  );
  for (const key of ['guest.t2', 'form.phone', 'form.otp']) assert.ok(info.texts.includes(key), key);
  assert.equal(info.targets[0].label, 'common.save');
});

test('scan dịch title, nhãn menu và chữ trên màn hình bằng vi.json của web; khóa thiếu bản dịch dùng nhãn menu và có cảnh báo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compass-i18n-app-'));
  cpSync(fixture, dir, { recursive: true });
  const routesFile = join(dir, 'src/app/app.routes.ts');
  writeFileSync(
    routesFile,
    readFileSync(routesFile, 'utf8')
      .replace("data: { title: 'Trống' }", "data: { title: 'guest.t2' }")
      .replace("{ path: 'cards', component: CardsPage }", "{ path: 'cards', component: CardsPage, data: { title: 'card.title.missing' } }")
      .replace('<h2>Khoản vay của tôi</h2>', "<h2>{{ 'loan.heading' | translate }}</h2>"),
  );
  const menuFile = join(dir, 'src/app/menu.config.ts');
  writeFileSync(menuFile, readFileSync(menuFile, 'utf8').replace("{ label: 'Khoản vay', route: '/loans' }", "{ label: 'menu.loans', route: '/loans' }"));
  mkdirSync(join(dir, 'src/assets/i18n'), { recursive: true });
  writeFileSync(join(dir, 'src/assets/i18n/vi.json'), JSON.stringify({ guest: { t2: 'Đổi số điện thoại' }, menu: { loans: 'Khoản vay' }, loan: { heading: 'Khoản vay của tôi' } }));

  const { featureMap, contexts } = scan(join(dir, 'compass.config.yaml'));
  const byPath = (p: string) => featureMap.features.find((f) => f.route.pattern === p)!;
  assert.equal(byPath('/blank').title, 'Đổi số điện thoại');
  assert.deepEqual(byPath('/loans').menuPath, ['Khoản vay']);
  assert.equal(byPath('/loans').title, 'Khoản vay');
  assert.ok(contexts[byPath('/loans').id].uiText.includes('Khoản vay của tôi'), 'chữ trong pipe translate đã dịch');
  assert.ok(!contexts[byPath('/loans').id].uiText.includes('loan.heading'));
  assert.equal(byPath('/cards').title, 'Thẻ tín dụng', 'khóa không có bản dịch: dùng nhãn menu');
  assert.ok(featureMap.coverage.warnings.some((w) => w.includes('card.title.missing') && w.includes('vi.json')));
});
