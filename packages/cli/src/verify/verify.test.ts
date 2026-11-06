import { strict as assert } from 'node:assert';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import type { Layout, Locator, TourStep } from '@wealthcompass/contracts';
import type { ProbeResult } from '@wealthcompass/core';
import { scan } from '../scan';
import { applyRerecord } from '../record/rerecord';
import { readToursFile } from '../record/write';
import { resolveProposal } from './heal';
import { pushTours } from './push';
import { verifyTours, type VerifyDriver } from './verify';

const loc = (name: string, extra: Partial<Locator> = {}): Locator => ({ tag: 'button', role: 'button', name, attrs: {}, context: {}, ...extra });

// Dự án mẫu có tour ghi bằng locator: bản desktop 2 bước, bản mobile 3 bước (mở menu trước)
function project(): { dir: string; config: string; toursFile: string } {
  const dir = mkdtempSync(join(tmpdir(), 'compass-verify-'));
  cpSync(resolve(import.meta.dirname, '../../test-fixtures/mini-app'), dir, { recursive: true });
  const toursFile = join(dir, 'compass.tours.json');
  writeFileSync(
    toursFile,
    JSON.stringify({
      tours: {
        'settle-loan': {
          title: 'Tất toán khoản vay',
          feature: 'loans',
          startRoute: '/loans',
          layout: 'desktop',
          steps: [
            { key: 's1', locator: loc('Mở khoản vay'), route: '/loans', advanceOn: 'click', text: 'Mở khoản vay.' },
            { key: 's2', locator: loc('Tất toán', { attrs: { formcontrolname: 'settle' } }), route: '/loans', advanceOn: 'click', text: 'Bấm **Tất toán**; bạn tự xác nhận.' },
          ],
          variants: {
            mobile: [
              { key: 's1', locator: loc('Menu'), route: '/loans', advanceOn: 'click', skipIfNextVisible: true, text: 'Mở menu.' },
              { key: 's2', locator: loc('Mở khoản vay'), route: '/loans', advanceOn: 'click', text: 'Mở khoản vay.' },
              { key: 's3', locator: loc('Tất toán'), route: '/loans', advanceOn: 'next', text: 'Bấm **Tất toán**.' },
            ],
          },
        },
      },
    }),
  );
  const config = join(dir, 'compass.config.yaml');
  scan(config);
  return { dir, config, toursFile };
}

// Trình duyệt giả: kết quả probe theo kịch bản "bố cục:chỉ số bước", ghi lại lần bấm và trang đã mở
function fakeBrowser(script: Record<string, ProbeResult>) {
  const clicks: string[] = [];
  const opened: string[] = [];
  const factory = async (layout: Layout): Promise<VerifyDriver> => {
    let path = '/';
    let last = '';
    return {
      async open(p) {
        opened.push(`${layout}:${p}`);
        path = p;
      },
      path: () => path,
      waitForPath: async () => false,
      async probe(_steps: TourStep[], index: number) {
        last = `${layout}:${index}`;
        return script[last] ?? { status: 'missing' };
      },
      async click() {
        clicks.push(last);
      },
      screenshot: async (file) => {
        writeFileSync(file, Buffer.from('89504e470d0a1a0a00', 'hex'));
        return true;
      },
      close: async () => undefined,
    };
  };
  return { clicks, opened, factory };
}

test('tour:verify: báo từng bước ở hai bố cục, chỉ bấm bước thường, tự sửa bước thường và chỉ đề xuất cho bước nhạy cảm', async () => {
  const { dir, config, toursFile } = project();
  const browser = fakeBrowser({
    'desktop:0': { status: 'ok', matchedBy: 'locator:name~+tag', score: 7, userOnly: false, drift: ['name'], proposed: loc('Mở khoản vay mới') },
    'desktop:1': { status: 'ok', matchedBy: 'locator:formcontrolname', score: 9, userOnly: true, drift: ['name'], proposed: loc('Tất toán ngay', { attrs: { formcontrolname: 'settle' } }) },
    'mobile:0': { status: 'skipped' },
    'mobile:1': { status: 'missing' },
  });
  const logs: string[] = [];
  const report = await verifyTours(
    { config, url: 'http://staging.local/', heal: true, report: join(dir, 'out/report.json'), screenshots: join(dir, 'shots'), today: '2026-11-06', driverFactory: browser.factory },
    (m) => logs.push(m),
  );

  assert.deepEqual(
    report.tours.map((t) => [t.layout, t.ok, t.steps.map((s) => s.status).join(',')]),
    [
      ['desktop', true, 'ok,ok'],
      ['mobile', false, 'skipped,missing,not_reached'],
    ],
  );
  assert.deepEqual(browser.clicks, ['desktop:0'], 'bước nhạy cảm (desktop:1) không bao giờ bị bấm, kể cả khi advanceOn là click');
  assert.ok(browser.opened.includes('desktop:/loans'));
  assert.equal(report.summary.failed, 1);
  assert.equal(report.summary.healed, 1);
  assert.equal(report.summary.proposed, 1);
  assert.ok(existsSync(join(dir, 'out/report.json')));
  assert.ok(existsSync(join(dir, 'shots/settle-loan/desktop-s1.png')), 'ảnh chụp từng bước cho tour:push');
  assert.ok(logs.some((l) => l.includes('✘ settle-loan [mobile]')));

  const tour = readToursFile(toursFile).tours['settle-loan'];
  assert.equal(tour.steps[0].locator?.name, 'Mở khoản vay mới', 'bước thường: áp luôn');
  assert.equal(tour.steps[0].healedAt, '2026-11-06');
  assert.equal(tour.steps[1].locator?.name, 'Tất toán', 'bước nhạy cảm: locator đang dùng giữ nguyên');
  assert.equal(tour.steps[1].proposal?.locator.name, 'Tất toán ngay');
  assert.deepEqual(tour.steps[1].proposal?.changed, ['name']);
  assert.equal(tour.variants?.mobile?.[1].healedAt, undefined, 'bản mobile không bị đụng tới');

  // Người duyệt chấp nhận đề xuất trong Studio
  const data = readToursFile(toursFile);
  resolveProposal(data, 'settle-loan', 's2', 'desktop', true, '2026-11-07');
  assert.equal(data.tours['settle-loan'].steps[1].locator?.name, 'Tất toán ngay');
  assert.equal(data.tours['settle-loan'].steps[1].proposal, undefined);
  assert.equal(data.tours['settle-loan'].steps[1].healedAt, '2026-11-07');
  assert.throws(() => resolveProposal(data, 'settle-loan', 's2', 'desktop', false, '2026-11-07'), /không có đề xuất/);
});

test('tour:verify không --heal: không ghi file, chỉ báo manh mối đã đổi', async () => {
  const { config, toursFile } = project();
  const before = readFileSync(toursFile, 'utf8');
  const browser = fakeBrowser({
    'desktop:0': { status: 'ok', score: 7, drift: ['name'], proposed: loc('Mở khoản vay mới') },
    'desktop:1': { status: 'low_confidence', score: 5 },
  });
  const logs: string[] = [];
  const report = await verifyTours({ config, url: 'http://x', layouts: ['desktop'], driverFactory: browser.factory }, (m) => logs.push(m));
  assert.equal(readFileSync(toursFile, 'utf8'), before);
  assert.equal(report.summary.failed, 0, 'không chắc chưa phải lỗi nếu không --strict');
  assert.equal(report.tours[0].steps[0].proposed?.name, 'Mở khoản vay mới', 'báo cáo kèm locator đề xuất');
  assert.ok(logs.at(-1)!.includes('thêm --heal'));
  const strict = await verifyTours({ config, url: 'http://x', layouts: ['desktop'], strict: true, driverFactory: fakeBrowser({ 'desktop:0': { status: 'ok' }, 'desktop:1': { status: 'low_confidence' } }).factory }, () => undefined);
  assert.equal(strict.summary.failed, 1);
});

test('ghi lại một bước: thay phần tử, giữ chữ và khóa; phần tử mới nhạy cảm thì chỉ tô sáng', () => {
  const { config, toursFile } = project();
  const logs: string[] = [];
  applyRerecord(
    { config, url: 'http://x', id: 'settle-loan', key: 's2', layout: 'mobile', today: '2026-11-06' },
    { tourId: null, route: '/loans', advanceOn: 'next', userOnly: true, tag: 'button', text: 'Tất toán', locator: loc('Tất toán khoản vay') },
    (m) => logs.push(m),
  );
  const step = readToursFile(toursFile).tours['settle-loan'].variants!.mobile![1];
  assert.equal(step.key, 's2');
  assert.equal(step.text, 'Mở khoản vay.');
  assert.equal(step.locator?.name, 'Tất toán khoản vay');
  assert.equal(step.advanceOn, 'next');
  assert.equal(step.healedAt, '2026-11-06');
  assert.ok(logs.some((l) => l.includes('✔ scan')), logs.join('\n'));
  assert.throws(
    () => applyRerecord({ config, url: 'http://x', id: 'settle-loan', key: 's9' }, { tourId: null, route: '/loans', advanceOn: 'click', userOnly: false, tag: 'a', text: '', locator: loc('X') }, () => undefined),
    /không có bước "s9"/,
  );
  assert.throws(
    () => applyRerecord({ config, url: 'http://x', id: 'settle-loan', key: 's1' }, { tourId: null, route: '/loans', advanceOn: 'click', userOnly: false, tag: 'div', text: '', locator: { tag: 'div', attrs: {}, context: {} } }, () => undefined),
    /không có tên/,
  );
});

test('tour:push: gửi tour đã quét kèm tính năng sở hữu và ảnh từng bước', async () => {
  const { dir, config } = project();
  mkdirSync(join(dir, 'shots/settle-loan'), { recursive: true });
  writeFileSync(join(dir, 'shots/settle-loan/desktop-s1.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  writeFileSync(join(dir, 'shots/settle-loan/notes.txt'), 'bỏ qua');
  const calls: Array<{ url: string; method: string; type: string; auth: string; body: unknown }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({ url, method: String(init.method), type: headers['Content-Type'], auth: headers['Authorization'], body: headers['Content-Type'] === 'application/json' ? JSON.parse(String(init.body)) : init.body });
    return headers['Content-Type'] === 'application/json' ? new Response(JSON.stringify({ version: 3, unchanged: false })) : new Response(null, { status: 204 });
  }) as typeof fetch;
  const result = await pushTours({ config, server: 'http://backend/', token: 'secret', shots: join(dir, 'shots'), fetchImpl }, () => undefined);
  assert.deepEqual(result, { pushed: 1, unchanged: 0, shots: 1 });
  assert.equal(calls[0].url, 'http://backend/admin/tours/settle-loan');
  assert.equal(calls[0].auth, 'Bearer secret');
  const body = calls[0].body as { tour: { id: string; variants?: object }; feature: string };
  assert.equal(body.tour.id, 'settle-loan');
  assert.equal(body.feature, 'loans');
  assert.ok(body.tour.variants, 'gửi cả bản mobile');
  assert.equal(calls[1].url, 'http://backend/admin/tours/settle-loan/shots/desktop/s1');
  assert.equal(calls[1].type, 'image/png');
  assert.equal(calls.length, 2, 'file không phải ảnh bước bị bỏ qua');
});

test('tour:verify --heal: lượt chạy bản chính ở bố cục kia không ghi đè bản sửa của bố cục chính', async () => {
  const { config, toursFile } = project();
  const data = readToursFile(toursFile);
  delete data.tours['settle-loan'].variants;
  writeFileSync(toursFile, JSON.stringify(data));
  scan(config);
  const browser = fakeBrowser({
    'desktop:0': { status: 'ok', drift: ['name'], proposed: loc('Bản desktop', { layout: 'desktop' }) },
    'desktop:1': { status: 'ok' },
    'mobile:0': { status: 'ok', drift: ['name'], proposed: loc('Bản mobile', { layout: 'mobile' }) },
    'mobile:1': { status: 'ok' },
  });
  const report = await verifyTours({ config, url: 'http://x', heal: true, driverFactory: browser.factory }, () => undefined);
  assert.equal(report.tours[1].fallback, true);
  assert.equal(readToursFile(toursFile).tours['settle-loan'].steps[0].locator?.name, 'Bản desktop');
  assert.equal(report.summary.healed, 1);

  // Chỉ kiểm mobile: bản chính được sửa từ lượt chạy đó
  await verifyTours({ config, url: 'http://x', heal: true, layouts: ['mobile'], driverFactory: browser.factory }, () => undefined);
  assert.equal(readToursFile(toursFile).tours['settle-loan'].steps[0].locator?.name, 'Bản mobile');
});
