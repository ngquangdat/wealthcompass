import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { readText } from '@wealthcompass/tourdb';
import { dataRoot } from '../project';
import { readToursFile } from './write';
import { draftTour } from './draft';
import { finishRecording, loadFeatureMap } from './run';
import { mergeSampleQuestionsIntoOverrides, mergeTourIntoToursFile } from './write';
import { scan } from '../scan';
import { Recorder, type RecordedStep } from './recorder';
import type { Page } from 'playwright-core';
import type { LlmConfig } from '@wealthcompass/llm';

const demoDir = resolve(import.meta.dirname, '../../../../examples/iconnect-demo');
// Dữ liệu của demo nằm trong kho dự án (dựng từ bản mẫu examples/iconnect-demo.compass), không nằm trong source
const demoData = dataRoot(demoDir);
const featureMap = loadFeatureMap(join(demoData, 'feature-map.json'));

const steps: RecordedStep[] = [
  { tourId: 'home-shortcut-iconnect', route: '/home', advanceOn: 'click', userOnly: false, tag: 'a', text: 'Giao dịch iConnect' },
  { tourId: 'iconnect-tab-assets', route: '/iconnect/price-board', advanceOn: 'click', userOnly: false, tag: 'a', text: 'Tài sản' },
  { tourId: 'assets-sell-button', route: '/iconnect/assets', advanceOn: 'next', userOnly: true, tag: 'button', text: 'BÁN 123456789012' },
];

// LLM giả trả JSON không stream
async function fakeLlm(reply: (body: any) => unknown): Promise<{ config: LlmConfig; bodies: any[]; close: () => Promise<void> }> {
  const bodies: any[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      bodies.push(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: typeof reply(body) === 'string' ? reply(body) : JSON.stringify(reply(body)) } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { config: { provider: 'fake', baseUrl: `http://127.0.0.1:${port}`, apiKey: 'k', model: 'm' }, bodies, close: () => new Promise((r) => server.close(() => r())) };
}

test('soạn nháp bằng LLM: đúng số bước, không gửi chữ hiển thị chứa số tài khoản', async () => {
  const llm = await fakeLlm(() => ({
    title: 'Bán trái phiếu',
    description: 'Dẫn tới nút BÁN.',
    steps: [{ text: 'Bấm **Giao dịch iConnect**.' }, { text: 'Chuyển sang tab **Tài sản**.' }, { text: 'Đây là nút **Bán**; bạn tự xác nhận lệnh.' }],
    sampleQuestions: ['bán trái phiếu ở đâu', 'ban trai phieu'],
  }));
  const draft = await draftTour({ id: 'sell-bond-2', steps, featureMap, featureId: 'iconnect.assets', llm: llm.config });
  await llm.close();
  assert.equal(draft.source, 'llm');
  assert.equal(draft.steps.length, 3);
  const sent = JSON.stringify(llm.bodies[0]);
  assert.ok(sent.includes('Chọn bán') || sent.includes('Bán'), 'dùng nhãn tĩnh từ template');
  assert.equal(sent.includes('123456789012'), false, 'chữ trên trang phải được lọc PII hoặc không dùng');
  assert.equal(llm.bodies[0].response_format?.type, 'json_object');
});

test('mô tả của người ghi được đưa vào prompt như nguồn chính và đã lọc PII', async () => {
  const llm = await fakeLlm(() => ({ title: 'Bán trái phiếu', steps: [{ text: 'Bước một đủ dài' }, { text: 'Bước hai đủ dài' }, { text: 'Bước ba đủ dài' }] }));
  await draftTour({ id: 't', steps, featureMap, purpose: 'Hướng dẫn khách bán trái phiếu, hotline 0912345678', llm: llm.config });
  await llm.close();
  const [system, user] = llm.bodies[0].messages;
  assert.match(system.content, /operatorDescription/);
  const sent = JSON.parse(user.content);
  assert.match(sent.operatorDescription, /bán trái phiếu/);
  assert.equal(sent.operatorDescription.includes('0912345678'), false);
});

test('không có LLM: dùng lời người ghi làm tiêu đề và mô tả', async () => {
  const draft = await draftTour({ id: 't', steps, featureMap, purpose: 'Bán trái phiếu đang nắm giữ', llm: null });
  assert.equal(draft.title, 'Bán trái phiếu đang nắm giữ');
  assert.equal(draft.description, 'Bán trái phiếu đang nắm giữ');
});

test('LLM trả sai số bước: thử lại rồi rơi về mẫu', async () => {
  const llm = await fakeLlm(() => ({ title: 'x y z', steps: [{ text: 'chỉ một bước' }] }));
  const draft = await draftTour({ id: 't', steps, featureMap, llm: llm.config });
  await llm.close();
  assert.equal(draft.source, 'template');
  assert.equal(llm.bodies.length, 2, 'thử đúng 2 lần');
  assert.equal(draft.steps.length, 3);
  assert.match(draft.steps[2].text, /tự thao tác/);
});

test('không có khóa LLM: dùng mẫu, không gọi mạng', async () => {
  const draft = await draftTour({ id: 't', steps, featureMap, llm: { provider: 'x', baseUrl: 'http://127.0.0.1:1', apiKey: null, model: 'm' } });
  assert.equal(draft.source, 'template');
});

test('câu hỏi mẫu gộp vào overrides: giữ chú thích cũ, không thêm câu trùng', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compass-'));
  const file = join(dir, 'compass.overrides.yaml');
  writeFileSync(file, '# Do nghiệp vụ duyệt tay\nfeatures:\n  iconnect.assets:\n    sampleQuestions:\n      - bán trái phiếu ở đâu # giữ nguyên\n');
  const out = mergeSampleQuestionsIntoOverrides(file, 'iconnect.assets', ['Bán trái phiếu ở đâu', 'cách bán lại']);
  assert.match(out.yaml, /# Do nghiệp vụ duyệt tay/);
  assert.match(out.yaml, /# giữ nguyên/);
  assert.deepEqual(out.added, ['cách bán lại'], 'câu trùng (khác hoa thường) không thêm lại');
});

test('tính năng đích lấy theo màn hình lúc dừng, không theo route lúc bấm bước cuối', async () => {
  // Bước cuối là bấm tab Sổ lệnh khi còn đứng ở bảng giá; đích thật là /iconnect/orders
  const toOrders: RecordedStep[] = [
    steps[0],
    { tourId: 'iconnect-tab-orders', route: '/iconnect/price-board', advanceOn: 'click', userOnly: false, tag: 'a', text: 'Sổ lệnh' },
  ];
  const run = (endRoute?: string) =>
    finishRecording(
      { config: join(demoData, 'compass.config.yaml'), url: '', id: 'to-orders', force: false, noLlm: true, dryRun: true },
      { steps: toOrders, startRoute: '/home', endRoute },
      () => undefined,
    );
  assert.equal(JSON.parse((await run('/iconnect/orders')).json).tours['to-orders'].feature, 'iconnect.orders');
  // Thiếu endRoute thì rơi về route của bước cuối (hành vi cũ, kém chính xác hơn)
  assert.equal(JSON.parse((await run()).json).tours['to-orders'].feature, 'iconnect.price-board');
});

// Bước không có tourId: chỉ có locator ghi được từ trang (web chưa gắn tourId nào)
const sellButton = { tag: 'button', role: 'button', name: 'Tất toán', attrs: {}, component: 'app-loans', context: { heading: 'Khoản vay của tôi' } };
const locatorSteps: RecordedStep[] = [
  { tourId: null, route: '/loans', advanceOn: 'next', userOnly: false, tag: 'button', text: 'Tất toán', locator: sellButton },
  // Không có manh mối nào dùng được: phải bị bỏ
  { tourId: null, route: '/loans', advanceOn: 'click', userOnly: false, tag: 'div', text: '', locator: { tag: 'div', attrs: {}, context: {}, css: 'div:nth-child(3)' } },
];

test('ghi tour không cần tourId: giữ bước có locator, bỏ bước không nhận ra, ghi vào kho tour', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'compass-loc-'));
  cpSync(resolve(import.meta.dirname, '../../test-fixtures/mini-app'), dir, { recursive: true });
  const config = join(dir, 'compass.config.yaml');
  scan(config);
  const logs: string[] = [];
  const result = await finishRecording(
    { config, url: '', id: 'settle-loan', force: false, noLlm: true, dryRun: false },
    { steps: locatorSteps, startRoute: '/loans', endRoute: '/loans', purpose: 'Tất toán khoản vay' },
    (m) => logs.push(m),
  );
  assert.equal(result.written, true);
  const file = JSON.parse(JSON.stringify(readToursFile(join(dir, 'compass.tours.db'))));
  const tour = file.tours['settle-loan'];
  assert.equal(tour.draft, true);
  assert.equal(tour.feature, 'loans');
  assert.equal(tour.steps.length, 1, 'bước không có manh mối bị bỏ');
  assert.deepEqual(tour.steps[0].locator.name, 'Tất toán');
  assert.equal(tour.steps[0].tourId, undefined);
  assert.equal(tour.steps[0].key, 's1');
  assert.ok(logs.some((l) => l.includes('Bỏ qua lần bấm vào <div>')));
  assert.ok(logs.some((l) => l.includes('✔ scan')), logs.join('\n'));

  // Scanner gộp tour vào Feature Map, gắn vào tính năng đích, cảnh báo nháp
  const map = JSON.parse(readFileSync(join(dir, 'feature-map.json'), 'utf8'));
  const inMap = map.tours.find((t: { id: string }) => t.id === 'settle-loan');
  assert.equal(inMap.steps[0].label, 'Tất toán');
  assert.equal(inMap.steps[0].route, '/loans');
  assert.ok(map.features.find((f: { id: string }) => f.id === 'loans').tourIds.includes('settle-loan'));
  assert.ok(map.coverage.warnings.some((w: string) => w.includes('"settle-loan" là nháp')));
  // Không sửa template
  assert.equal(readFileSync(join(dir, 'src/app/app.routes.ts'), 'utf8').includes('tourId'), false);

  // Đã có thì không ghi đè khi chưa --force
  await assert.rejects(
    finishRecording({ config, url: '', id: 'settle-loan', force: false, noLlm: true, dryRun: true }, { steps: locatorSteps, startRoute: '/loans' }, () => undefined),
    /--force/,
  );
});

test('tour ghi bằng locator: route thật đổi sang mẫu route của tính năng', async () => {
  const draft = { title: 'T tour', description: '', source: 'template' as const, steps: [{ text: 'a' }], sampleQuestions: [] };
  const out = mergeTourIntoToursFile(join(mkdtempSync(join(tmpdir(), 'compass-')), 't.json'), {
    id: 'x', draft, startRoute: '/orders/42', force: false, today: '2026-11-06',
    steps: [{ ...locatorSteps[0], route: '/orders/42', routePattern: '/orders/:id' }],
  });
  const tour = JSON.parse(out.json).tours.x;
  assert.equal(tour.steps[0].route, '/orders/:id');
  assert.equal(tour.recordedAt, '2026-11-06');
  assert.equal(tour.draftSource, 'template');
});

test('lần bấm trúng phần tử vừa được mở ra: bước trước được đánh dấu mở chỗ chứa', () => {
  const recorder = new Recorder({} as Page);
  recorder.recording = true;
  const menu = { tag: 'button', role: 'button', name: 'Menu', attrs: {}, context: {}, layout: 'mobile' as const };
  recorder.onEvent({ tourId: null, route: '/loans', advanceOn: 'click', userOnly: false, tag: 'button', text: 'Menu', locator: menu });
  recorder.onEvent({ tourId: null, route: '/loans', advanceOn: 'next', userOnly: false, tag: 'button', text: 'Tất toán', locator: sellButton, appeared: true });
  assert.equal(recorder.steps[0].opensNext, true);
  // Khác màn hình hoặc bước trước chỉ tô sáng (không bấm thật) thì không đánh dấu
  recorder.onEvent({ tourId: null, route: '/other', advanceOn: 'click', userOnly: false, tag: 'a', text: 'Khác', locator: { ...menu, name: 'Khác' }, appeared: true });
  assert.equal(recorder.steps[1].opensNext, undefined);
});

test('cùng id ghi ở bố cục khác: lưu thành bản mobile, bước mở menu tự bỏ qua được, scanner đưa vào Feature Map', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'compass-layout-'));
  cpSync(resolve(import.meta.dirname, '../../test-fixtures/mini-app'), dir, { recursive: true });
  const config = join(dir, 'compass.config.yaml');
  scan(config);
  const desktop = { ...sellButton, layout: 'desktop' as const };
  const mobile = { ...sellButton, layout: 'mobile' as const };
  const menu = { tag: 'button', role: 'button', name: 'Menu', attrs: {}, context: {}, layout: 'mobile' as const };
  const quiet = () => undefined;
  await finishRecording(
    { config, url: '', id: 'settle-loan', force: false, noLlm: true, dryRun: false },
    { steps: [{ tourId: null, route: '/loans', advanceOn: 'next', userOnly: false, tag: 'button', text: 'Tất toán', locator: desktop }], startRoute: '/loans' },
    quiet,
  );
  await finishRecording(
    { config, url: '', id: 'settle-loan', force: false, noLlm: true, dryRun: false },
    {
      steps: [
        { tourId: null, route: '/loans', advanceOn: 'click', userOnly: false, tag: 'button', text: 'Menu', locator: menu, opensNext: true },
        { tourId: null, route: '/loans', advanceOn: 'next', userOnly: false, tag: 'button', text: 'Tất toán', locator: mobile },
      ],
      startRoute: '/loans',
    },
    quiet,
  );
  const tour = JSON.parse(JSON.stringify(readToursFile(join(dir, 'compass.tours.db')))).tours['settle-loan'];
  assert.equal(tour.layout, 'desktop');
  assert.equal(tour.steps.length, 1);
  assert.equal(tour.variants.mobile.length, 2);
  assert.equal(tour.variants.mobile[0].skipIfNextVisible, true);
  assert.equal(tour.variants.mobile[1].skipIfNextVisible, undefined);

  const inMap = JSON.parse(readFileSync(join(dir, 'feature-map.json'), 'utf8')).tours.find((t: { id: string }) => t.id === 'settle-loan');
  assert.equal(inMap.layout, 'desktop');
  assert.equal(inMap.variants.mobile[0].skipIfNextVisible, true);
  assert.equal(inMap.variants.mobile[1].label, 'Tất toán');

  // Bản mobile đã có: ghi lại cần --force; ghi lại bản chính cũng vậy
  const again = (locator: typeof mobile, force = false) =>
    finishRecording({ config, url: '', id: 'settle-loan', force, noLlm: true, dryRun: true }, { steps: [{ tourId: null, route: '/loans', advanceOn: 'next', userOnly: false, tag: 'button', text: 'Tất toán', locator }], startRoute: '/loans' }, quiet);
  await assert.rejects(again(mobile), /bản mobile/);
  await assert.rejects(again(desktop as never), /--force/);
  // --force bản chính vẫn giữ bản mobile
  const forced = JSON.parse((await again(desktop as never, true)).json).tours['settle-loan'];
  assert.equal(forced.variants.mobile.length, 2);
});

// E2E với Chrome thật: bỏ qua nếu không đặt COMPASS_E2E_URL (cần dev server demo đang chạy)
test('E2E: ghi tour trên web demo bằng Chrome thật, bước BÁN bị chặn không chạy thật', { skip: !process.env['COMPASS_E2E_URL'] }, async () => {
  const { recordSession } = await import('./recorder');
  const dir = mkdtempSync(join(tmpdir(), 'compass-e2e-'));
  // Sao chép cấu hình demo vào thư mục tạm để không đụng file thật; scanner cần tsconfig và src nên trỏ về app demo
  const config = join(demoData, 'compass.config.yaml');
  const overridesBackup = readText(join(demoData, 'compass.overrides.yaml'));
  const { recorder, browser } = await recordSession(process.env['COMPASS_E2E_URL']!);
  try {
    const page = (browser.contexts()[0].pages())[0];
    await page.click('button.submit'); // đăng nhập (đã điền sẵn tài khoản demo)
    await page.waitForURL('**/home');
    // Ô mô tả nằm trong shadow DOM của khung ghi; gõ vào đó phải chuyển về Node
    await page.fill('#purpose', 'Hướng dẫn khách bán trái phiếu đang nắm giữ');
    assert.equal(recorder.purpose, 'Hướng dẫn khách bán trái phiếu đang nắm giữ');
    await recorder.start();
    assert.equal(recorder.startRoute, '/home');
    // Ghi xong bấm vào khung công cụ không được bị tính là một bước tour
    await page.click('#purpose');
    await page.click('[data-tour-id="home-shortcut-iconnect"]');
    await page.waitForURL('**/iconnect/price-board');
    await page.click('[data-tour-id="iconnect-tab-assets"]');
    await page.waitForURL('**/iconnect/assets');
    await page.click('[data-tour-id="assets-select-sell"]');
    await page.click('[data-tour-id="assets-sell-button"]'); // user-only: phải bị chặn
    const opened = await page.locator('.modal').count();
    await recorder.stop();
    assert.equal(recorder.endRoute, '/iconnect/assets');
    assert.equal(opened, 0, 'lần bấm BÁN trong lúc ghi không được mở hộp thoại đặt lệnh');
    assert.deepEqual(recorder.steps.map((s) => [s.tourId, s.advanceOn]), [
      ['home-shortcut-iconnect', 'click'],
      ['iconnect-tab-assets', 'click'],
      ['assets-select-sell', 'click'],
      ['assets-sell-button', 'next'],
    ]);
    const result = await finishRecording(
      { config, url: '', id: 'sell-bond-e2e', feature: 'iconnect.assets', force: false, noLlm: true, dryRun: true },
      { steps: recorder.steps, startRoute: recorder.startRoute, endRoute: recorder.endRoute, purpose: recorder.purpose },
      () => undefined,
    );
    assert.ok(JSON.parse(result.json).tours['sell-bond-e2e']);
    assert.equal(readText(join(demoData, 'compass.overrides.yaml')), overridesBackup, 'dry-run không được ghi');
  } finally {
    await browser.close();
    void dir; void copyFileSync; void mkdirSync;
  }
});

test('bước không có tourId: cảnh báo đang tìm theo selector, nêu tourId của vùng chứa đã bỏ qua', async () => {
  const { stepNote } = await import('./recorder');
  const locator = { tag: 'button', role: 'button', name: 'Mua', attrs: {}, context: {}, css: '.toolbar > button:nth-child(2)' };
  const base = { route: '/home', advanceOn: 'click' as const, userOnly: false, tag: 'button', text: 'Mua' };
  assert.equal(stepNote({ ...base, tourId: 'home-buy', locator }), '', 'có tourId thì không cảnh báo');
  assert.match(stepNote({ ...base, tourId: null, locator }), /không có tourId: tìm theo selector \(\.toolbar > button:nth-child\(2\)\)/);
  assert.match(stepNote({ ...base, tourId: null, locator, skippedTourId: 'toolbar' }), /tourId "toolbar" là của vùng chứa nên không dùng/);
  assert.match(stepNote({ ...base, tourId: null, locator: { tag: 'div', attrs: {}, context: {} } }), /sẽ bị bỏ khi lưu/);

  // Lúc lưu: log cảnh báo cho từng bước không có tourId
  const logs: string[] = [];
  await finishRecording(
    { config: join(demoData, 'compass.config.yaml'), url: '', id: 'canh-bao-selector', force: false, noLlm: true, dryRun: true },
    { startRoute: '/home', endRoute: '/home', steps: [{ ...base, tourId: null, locator, skippedTourId: 'toolbar' }] },
    (m) => logs.push(m),
  );
  const warn = logs.find((l) => l.includes('không có tourId'))!;
  assert.match(warn, /^! Bước 1 \(\/home\) không có tourId, tìm theo selector: button "Mua" · \.toolbar > button:nth-child\(2\)\./);
  assert.match(warn, /tourId "toolbar" là của vùng chứa bao ngoài nên không dùng/);
});

test('khung ghi: tạm dừng không ghi, Ghi hover biến lần bấm kế tiếp thành bước hover, Hủy bỏ hết để ghi lại', async () => {
  const recorder = new Recorder({ evaluate: async () => undefined, url: () => 'http://x/home' } as unknown as Page);
  const step = (text: string, advanceOn: 'click' | 'hover' = 'click') => ({ tourId: text, route: '/home', advanceOn, userOnly: false, tag: 'button', text });
  await recorder.command('start');
  recorder.onEvent(step('a'));
  await recorder.command('togglePause');
  assert.equal(recorder.state().paused, true);
  recorder.onEvent(step('b'));
  assert.equal(recorder.steps.length, 1, 'đang tạm dừng thì không ghi');
  await recorder.command('togglePause');
  await recorder.command('armHover');
  assert.equal(recorder.state().hoverArmed, true);
  recorder.onEvent(step('menu', 'hover'));
  assert.equal(recorder.state().hoverArmed, false, 'ghi xong bước hover thì tự tắt');
  assert.deepEqual(recorder.steps.map((s) => s.advanceOn), ['click', 'hover']);
  await recorder.command('cancel');
  assert.equal(recorder.recording, false);
  assert.equal(recorder.steps.length, 0);
  assert.equal(recorder.startRoute, null);
  await recorder.command('start');
  assert.equal(recorder.recording, true, 'hủy xong ghi lại được');
});

test('đổi thiết bị của bản tour: đổi nhãn, trùng bản có sẵn thì đổi chỗ; locator gắn bố cục mới', async () => {
  const { relabelLayout } = await import('../verify/heal');
  const { layoutOfSteps } = await import('./write');
  const loc = (layout: 'desktop' | 'tablet' | 'mobile') => ({ ...sellButton, layout });
  const desktop = [{ key: 's1', text: 'a', advanceOn: 'click' as const, locator: loc('desktop') }];
  const mobile = [{ key: 's1', text: 'b', advanceOn: 'click' as const, locator: loc('mobile') }];
  const tour = { title: 'T', startRoute: '/', layout: 'desktop' as const, steps: desktop, variants: { mobile } };
  assert.equal(layoutOfSteps([{ locator: loc('tablet') }, { locator: loc('tablet') }, { locator: loc('desktop') }]), 'tablet');

  const toTablet = relabelLayout(tour, 'desktop', 'tablet');
  assert.equal(toTablet.layout, 'tablet');
  assert.equal(toTablet.steps[0].text, 'a');
  assert.equal(toTablet.steps[0].locator?.layout, 'tablet');
  assert.equal(toTablet.variants?.mobile?.[0].text, 'b');

  const swapped = relabelLayout(tour, 'mobile', 'desktop');
  assert.equal(swapped.layout, 'mobile', 'bản chính (chữ a) giờ là bản điện thoại');
  assert.equal(swapped.steps[0].text, 'a');
  assert.equal(swapped.variants?.desktop?.[0].text, 'b');
  assert.equal(swapped.variants?.desktop?.[0].locator?.layout, 'desktop');
  assert.throws(() => relabelLayout(tour, 'tablet', 'desktop'), /không có bản tablet/);
});
