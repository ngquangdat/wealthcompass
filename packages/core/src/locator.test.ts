import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

// jsdom không có layout: mọi phần tử coi là hiện (truyền hàm visible riêng), rect bị bỏ qua
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://app.example.vn/home' });
const g = globalThis as Record<string, unknown>;
for (const key of ['window', 'document', 'location', 'Node', 'HTMLElement', 'Element', 'MutationObserver', 'getComputedStyle'] as const) {
  g[key] = key === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : (dom.window as unknown as Record<string, unknown>)[key];
}
g['CSS'] ??= { escape: (s: string) => s.replace(/["\\]/g, '\\$&') };

const { isStableToken } = await import('./locator-filters');
const { findByLocator, isUsableLocator, describeLocator } = await import('./locator');
const { captureLocator } = await import('./locator-capture');
const { resolveStep, isUserOnly, buildSafetyPolicy } = await import('./index');

const always = () => true;
function page(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

test('bỏ id/class sinh tự động, giữ tên có nghĩa', () => {
  for (const bad of ['_ngcontent-abc-c12', 'ng-tns-c3-1', 'mat-mdc-form-field-3', 'cdk-overlay-12', 'input-2', 'css-1x2y3z', 'a1b2c3d4-0000-1111']) {
    assert.equal(isStableToken(bad), false, bad);
  }
  for (const good of ['sell-button', 'quantity', 'orderForm', 'btn-primary']) assert.equal(isStableToken(good), true, good);
});

test('ghi locator: vai trò, tên, component, tiêu đề mục; không ghi id sinh tự động và số dư', () => {
  page(`
    <app-bond-portfolio>
      <h2>Trái phiếu đang nắm giữ</h2>
      <div class="row"><span>Số dư 125.000.000</span>
        <button id="mat-mdc-button-7" class="btn _ngcontent-x"><span class="icon"></span>Bán</button>
      </div>
    </app-bond-portfolio>`);
  const icon = document.querySelector('.icon')!;
  const loc = captureLocator(icon);
  assert.equal(loc.tag, 'button', 'lần bấm trúng icon được nâng lên nút');
  assert.equal(loc.role, 'button');
  assert.equal(loc.name, 'Bán');
  assert.equal(loc.component, 'app-bond-portfolio');
  assert.equal(loc.context.heading, 'Trái phiếu đang nắm giữ');
  assert.equal(loc.attrs['id'], undefined, 'id sinh tự động bị bỏ');
  assert.ok(!JSON.stringify(loc).includes('125'), 'không ghi số dư');
  assert.equal(isUsableLocator(loc), true);
  assert.equal(describeLocator(loc), 'button "Bán" · app-bond-portfolio');
});

test('ghi locator: formcontrolname và href giữ đường dẫn, bỏ query', () => {
  page(`<form><input formcontrolname="quantity" placeholder="Khối lượng"></form><a href="/bond/sell?account=105C123456">Bán trái phiếu</a>`);
  assert.equal(captureLocator(document.querySelector('input')!).attrs['formcontrolname'], 'quantity');
  assert.equal(captureLocator(document.querySelector('a')!).attrs['href'], '/bond/sell');
});

test('tìm lại sau khi đổi CSS và bọc thêm thẻ', () => {
  page(`<app-bond-portfolio><h2>Trái phiếu</h2><button class="old">Bán</button><button class="old">Mua</button></app-bond-portfolio>`);
  const loc = captureLocator(document.querySelectorAll('button')[0]);
  // Giao diện đổi: class khác, nút bị bọc trong div mới, thêm nút khác
  page(`<app-bond-portfolio><h2>Trái phiếu</h2><div class="toolbar"><button class="new-style">Mua</button><div><button class="new-style">Bán</button></div></div></app-bond-portfolio>`);
  const found = findByLocator(loc, document, always);
  assert.ok(found);
  assert.equal(found.element.textContent, 'Bán');
  assert.equal(found.confident, true, JSON.stringify(found));
});

test('hai nút giống hệt nhau: báo không chắc thay vì đoán', () => {
  page(`<button>Bán</button><button>Bán</button>`);
  const loc = captureLocator(document.querySelector('button')!);
  const found = findByLocator(loc, document, always);
  assert.ok(found);
  assert.equal(found.confident, false);
});

test('component và hộp thoại phân xử giữa các nút cùng chữ', () => {
  page(`<app-order-list><button>Xác nhận</button></app-order-list>
        <div role="dialog" aria-label="Bán trái phiếu"><app-bond-sell-panel><button>Xác nhận</button></app-bond-sell-panel></div>`);
  const loc = captureLocator(document.querySelectorAll('button')[1]);
  assert.equal(loc.context.dialog, 'Bán trái phiếu');
  const found = findByLocator(loc, document, always);
  assert.ok(found?.confident);
  assert.ok(found.element.closest('app-bond-sell-panel'));
});

test('không có ứng viên nào đủ điểm thì trả null', () => {
  page(`<button>Mua</button>`);
  assert.equal(findByLocator({ tag: 'button', role: 'button', name: 'Bán', attrs: {}, context: {} }, document, always), null);
});

test('thuộc tính mạnh khác giá trị bị trừ điểm', () => {
  page(`<input formcontrolname="price"><input formcontrolname="quantity">`);
  const found = findByLocator({ tag: 'input', attrs: { formcontrolname: 'quantity' }, context: {} }, document, always);
  assert.equal(found?.element.getAttribute('formcontrolname'), 'quantity');
  assert.equal(found?.confident, false, 'chỉ một manh mối: 4 + 0.5 chưa đủ ngưỡng 6');
});

test('tourId ghim luôn thắng locator', () => {
  page(`<button data-tour-id="sell">Bán ngay</button><button>Bán</button>`);
  // resolveTarget dùng isVisible thật; jsdom không có layout nên giả lập kích thước
  for (const b of document.querySelectorAll('button')) (b as HTMLElement).getBoundingClientRect = () => ({ width: 10, height: 10 }) as DOMRect;
  const r = resolveStep({ tourId: 'sell', locator: { tag: 'button', role: 'button', name: 'Bán', attrs: {}, context: {} } });
  assert.equal(r?.element.textContent, 'Bán ngay');
  assert.equal(r?.matchedBy, 'tour-id');
  assert.equal(r?.confident, true);
});

test('phần tử chỉ được tô sáng: do dev đánh dấu hoặc là nút gửi form; không đoán theo chữ trên nút', () => {
  page(`<button>Bán</button><button>Đặt lệnh cổ phiếu</button><button tourrole="user-only">Xác nhận</button><div data-sensitive><button>Số dư</button></div><form><button type="submit">Gửi</button></form>`);
  const policy = buildSafetyPolicy();
  const [sell, order, marked, inSensitive, submit] = Array.from(document.querySelectorAll('button'));
  assert.equal(isUserOnly(sell, policy), false, 'chữ "Bán" không tự thành nhạy cảm');
  assert.equal(isUserOnly(order, policy), false, 'mục menu "Đặt lệnh..." bấm được bình thường');
  assert.equal(isUserOnly(marked, policy), true);
  assert.equal(isUserOnly(inSensitive, policy), true);
  assert.equal(isUserOnly(submit, policy), true);
});

// ---------------------------------------------------------------------------
// Giai đoạn 2: danh sách lặp, bước mở chỗ chứa, bố cục, chờ tải
// ---------------------------------------------------------------------------

const { stepsForLayout, currentLayout, shouldSkipStep, waitForIdle } = await import('./resolver');
const { snapshotVisible, appearedSince } = await import('./locator-capture');

// jsdom không có layout: coi mọi phần tử có kích thước, trừ phần tử display:none
function withLayout<T>(fn: () => T): T {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const hidden = this.closest('[style*="display:none"]');
    return (hidden ? { width: 0, height: 0 } : { width: 10, height: 10, left: 0, top: 0, right: 10, bottom: 10 }) as DOMRect;
  };
  try {
    return fn();
  } finally {
    Element.prototype.getBoundingClientRect = original;
  }
}

const bondTable = (codes: string[]) => `
  <app-bond-portfolio><h2>Trái phiếu đang nắm giữ</h2>
    <table><thead><tr><th>Mã</th><th>Khối lượng</th><th>Thao tác</th></tr></thead>
      <tbody>${codes.map((c) => `<tr><td>${c}</td><td>1.000</td><td><button>Bán</button></td></tr>`).join('')}</tbody>
    </table>
  </app-bond-portfolio>`;

test('nút lặp trên mỗi dòng bảng: ghi hình dạng dòng, tìm lại chắc chắn ở bất kỳ dòng nào', () => {
  page(bondTable(['VIC2025', 'MSN2026', 'HPG2027']));
  const loc = captureLocator(document.querySelectorAll('button')[1]);
  assert.deepEqual(loc.list, { row: 'tr', column: 'Thao tác', index: 1 });
  assert.equal(loc.context.heading, 'Trái phiếu đang nắm giữ', 'tiêu đề lấy từ ngoài dòng');
  assert.ok(!JSON.stringify(loc).includes('MSN2026'), 'không ghi dữ liệu của dòng');

  // Dữ liệu đổi: dòng đã ghi không còn, thứ tự khác
  page(bondTable(['TCB2030', 'VPB2031']));
  const found = findByLocator(loc, document, always);
  assert.ok(found?.confident, JSON.stringify(found && { score: found.score, runnerUp: found.runnerUp }));
  // Selector dự phòng (tr:nth-child(2)) ưu tiên dòng cùng vị trí nếu còn
  assert.equal(found.element.closest('tr')?.cells[0].textContent, 'VPB2031');
  assert.ok(found.matchedBy.includes('list') && found.matchedBy.includes('column'));
  page(bondTable(['TCB2030']));
  assert.equal(findByLocator(loc, document, always)?.confident, true, 'còn một dòng vẫn tìm được');
});

test('list.index: chọn đúng dòng thứ i đã ghi, danh sách ngắn hơn thì lấy dòng cuối', () => {
  const codes = ['A1', 'B2', 'C3', 'D4', 'E5'];
  page(bondTable(codes));
  const loc = captureLocator(document.querySelectorAll('button')[3]);
  assert.equal(loc.list?.index, 3);
  // Dữ liệu khác, nhiều dòng hơn: vẫn là dòng thứ 4
  page(bondTable(['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7']));
  const found = findByLocator(loc, document, always);
  assert.ok(found?.confident);
  assert.equal(found.element.closest('tr')?.cells[0].textContent, 'K4');
  // Bỏ selector dự phòng (nth-child) vẫn chọn theo index
  const bare = findByLocator({ ...loc, css: undefined }, document, always);
  assert.equal(bare?.element.closest('tr')?.cells[0].textContent, 'K4');
  // Chỉ còn 2 dòng: lấy dòng cuối
  page(bondTable(['Z1', 'Z2']));
  assert.equal(findByLocator(loc, document, always)?.element.closest('tr')?.cells[0].textContent, 'Z2');
  // Người duyệt đổi index
  page(bondTable(codes));
  assert.equal(findByLocator({ ...loc, list: { ...loc.list!, index: 0 } }, document, always)?.element.closest('tr')?.cells[0].textContent, 'A1');
});

test('list.index trong thẻ @for', () => {
  const cards = (n: number) => Array.from({ length: n }, (_, i) => `<div class="bond-card"><h3>TP${i}</h3><button>Bán</button></div>`).join('');
  page(`<app-bonds><h2>Danh mục</h2><div class="cards"><p>Ghi chú</p>${cards(4)}</div></app-bonds>`);
  const loc = captureLocator(document.querySelectorAll('button')[2]);
  assert.equal(loc.list?.index, 2, 'không đếm phần tử chen giữa không phải dòng');
  page(`<app-bonds><h2>Danh mục</h2><div class="cards">${cards(6)}</div></app-bonds>`);
  assert.equal(findByLocator(loc, document, always)?.element.closest('.bond-card')?.querySelector('h3')?.textContent, 'TP2');
});

test('ghim dòng bằng list.rowText', () => {
  page(bondTable(['TCB2030', 'VPB2031']));
  const loc = captureLocator(document.querySelector('button')!);
  const found = findByLocator({ ...loc, list: { ...loc.list!, rowText: 'VPB2031' } }, document, always);
  assert.equal(found?.element.closest('tr')?.cells[0].textContent, 'VPB2031');
});

test('thẻ lặp trong @for (không phải bảng) cũng là danh sách', () => {
  const cards = (n: number) => Array.from({ length: n }, (_, i) => `<div class="bond-card"><h3>TP${i}</h3><button>Bán</button></div>`).join('');
  page(`<app-bonds><h2>Danh mục</h2><div class="cards">${cards(3)}</div></app-bonds>`);
  const loc = captureLocator(document.querySelectorAll('button')[2]);
  assert.equal(loc.list?.row, 'div.bond-card');
  assert.equal(loc.context.heading, 'Danh mục', 'không lấy tiêu đề trong thẻ (mã trái phiếu)');
  page(`<app-bonds><h2>Danh mục</h2><div class="cards">${cards(5)}</div></app-bonds>`);
  assert.equal(findByLocator(loc, document, always)?.confident, true);
});

test('khối lặp có phần tử khác nhau (form-group) không phải danh sách; hai nút trùng ngoài danh sách vẫn không chắc', () => {
  page(`<form><div class="fg"><input formcontrolname="price"></div><div class="fg"><input formcontrolname="quantity"></div></form>`);
  assert.equal(captureLocator(document.querySelectorAll('input')[1]).list, undefined);
  page(`<section><button>Bán</button></section><aside><button>Bán</button></aside>`);
  const loc = captureLocator(document.querySelector('button')!);
  assert.equal(loc.list, undefined);
  assert.equal(findByLocator(loc, document, always)?.confident, false);
});

test('nhận ra phần tử do lần bấm trước mở ra (nút menu mobile)', () => {
  withLayout(() => {
    page(`<header><button>Menu</button></header><nav style="display:none"><a href="/bond">Trái phiếu</a></nav><a href="/home">Trang chủ</a>`);
    const before = snapshotVisible(document);
    // Bấm "Menu": nav hiện ra
    (document.querySelector('nav') as HTMLElement).style.display = '';
    assert.equal(appearedSince(before, document.querySelector('nav a')!), true);
    assert.equal(appearedSince(before, document.querySelector('body > a')!), false, 'đã hiện từ trước');
    assert.equal(appearedSince(null, document.querySelector('nav a')!), false);
  });
});

test('bước mở chỗ chứa được bỏ qua khi phần tử bước sau đã hiện', () => {
  const steps = [
    { key: 's1', skipIfNextVisible: true, locator: { tag: 'button', role: 'button', name: 'Menu', attrs: {}, context: {} } },
    { key: 's2', locator: { tag: 'a', role: 'link', name: 'Trái phiếu', attrs: { href: '/bond' }, context: { landmark: 'navigation' } } },
  ];
  withLayout(() => {
    page(`<header><button>Menu</button></header><nav style="display:none"><a href="/bond">Trái phiếu</a></nav>`);
    assert.equal(shouldSkipStep(steps, 0), false, 'menu đang đóng: phải bấm Menu');
    page(`<header><button>Menu</button></header><nav><a href="/bond">Trái phiếu</a></nav>`);
    assert.equal(shouldSkipStep(steps, 0), true, 'desktop/menu đã mở: bỏ qua');
    assert.equal(shouldSkipStep(steps, 1), false);
  });
});

test('chọn bản tour theo bố cục, thiếu thì dùng bản chính', () => {
  assert.equal(currentLayout(768, 390), 'mobile');
  assert.equal(currentLayout(768, 1280), 'desktop');
  const tour = { steps: ['d1', 'd2'], variants: { mobile: ['m0', 'm1', 'm2'] } };
  assert.deepEqual(stepsForLayout(tour, 'mobile'), ['m0', 'm1', 'm2']);
  assert.deepEqual(stepsForLayout(tour, 'desktop'), ['d1', 'd2']);
  assert.deepEqual(stepsForLayout({ steps: ['d1'] }, 'mobile'), ['d1']);
});

test('chờ spinner biến mất rồi mới tìm phần tử', async () => {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    return { width: 10, height: 10 } as DOMRect;
  };
  try {
    page(`<mat-spinner></mat-spinner><button>Bán</button>`);
    setTimeout(() => document.querySelector('mat-spinner')!.remove(), 30);
    const started = Date.now();
    assert.equal(await waitForIdle(undefined, 2000), true);
    assert.ok(Date.now() - started >= 25);
    page(`<div class="loading-x" aria-busy="true"></div>`);
    assert.equal(await waitForIdle(undefined, 50), false, 'hết giờ thì đi tiếp');
  } finally {
    Element.prototype.getBoundingClientRect = original;
  }
});

test('chỉ dẫn khi thành phần tải xong: chờ hết đang tải quanh phần tử và phần tử đứng yên; spinner ở chỗ khác không chờ', async () => {
  const { waitForReady } = await import('./resolver');
  const original = Element.prototype.getBoundingClientRect;
  const boxes = new Map<string, { left: number; top: number; width: number; height: number }>();
  Element.prototype.getBoundingClientRect = function () {
    const b = boxes.get((this as Element).id) ?? { left: 0, top: 0, width: 10, height: 10 };
    return { ...b, right: b.left + b.width, bottom: b.top + b.height, x: b.left, y: b.top } as DOMRect;
  };
  try {
    // Spinner trong cùng component với nút: chờ tới khi spinner biến mất
    page(`<app-order-panel><mat-spinner id="sp"></mat-spinner><button id="buy" data-tour-id="buy">Mua</button></app-order-panel>`);
    boxes.set('sp', { left: 500, top: 500, width: 20, height: 20 });
    boxes.set('buy', { left: 0, top: 0, width: 60, height: 30 });
    setTimeout(() => document.getElementById('sp')!.remove(), 120);
    let started = Date.now();
    const found = await waitForReady({ tourId: 'buy' }, { stableMs: 50, timeoutMs: 2000 });
    assert.equal(found?.element.id, 'buy');
    assert.ok(Date.now() - started >= 110, 'chờ spinner của component');

    // Spinner nhỏ ở một widget khác (bảng giá đang tải): không chờ
    page(`<app-price-board><mat-spinner id="sp2"></mat-spinner></app-price-board><app-order-panel><button id="sell" data-tour-id="sell">Bán</button></app-order-panel>`);
    boxes.set('sp2', { left: 800, top: 600, width: 20, height: 20 });
    started = Date.now();
    assert.equal((await waitForReady({ tourId: 'sell' }, { stableMs: 50, timeoutMs: 2000 }))?.element.id, 'sell');
    assert.ok(Date.now() - started < 500, 'spinner ở chỗ khác không làm chậm');

    // Phần tử còn đang dịch chuyển (hiệu ứng mở, bố cục nhảy): chờ đứng yên
    page(`<button id="move" data-tour-id="move">Đặt lệnh</button>`);
    let x = 0;
    const timer = setInterval(() => boxes.set('move', { left: (x += 10), top: 0, width: 60, height: 30 }), 20);
    setTimeout(() => clearInterval(timer), 200);
    started = Date.now();
    assert.equal((await waitForReady({ tourId: 'move' }, { stableMs: 80, timeoutMs: 2000 }))?.element.id, 'move');
    assert.ok(Date.now() - started >= 200, 'chờ hết dịch chuyển');

    // Không bao giờ hết tải: hết giờ vẫn chỉ dẫn, không kẹt
    page(`<div aria-busy="true"><button id="stuck" data-tour-id="stuck">Gửi</button></div>`);
    assert.equal((await waitForReady({ tourId: 'stuck' }, { stableMs: 50, timeoutMs: 150 }))?.element.id, 'stuck');
  } finally {
    Element.prototype.getBoundingClientRect = original;
  }
});

test('khóa hover kiểu TCBS: chuột rời khung bọc ngoài nút mở hay đi vào lớp nền của menu CDK đều không làm menu đóng', async () => {
  const { lockHover } = await import('./hover-lock');
  page(`<div class="relative"><div class="name">Test User</div><div class="absolute" id="trigger"></div></div>
    <div class="cdk-overlay-container"><div class="cdk-overlay-backdrop"></div><div class="cdk-overlay-pane"><button id="item">Bảo mật</button></div></div>`);
  let closed = 0;
  document.querySelector('.relative')!.addEventListener('mouseleave', () => closed++);
  // Menu tự đóng khi chuột đi vào lớp nền phủ trang (nằm chung khung overlay với menu)
  document.querySelector('.cdk-overlay-backdrop')!.addEventListener('mouseenter', () => closed++);
  const lock = lockHover(document.getElementById('trigger')!);
  lock.hold(document.getElementById('item')!);
  document.querySelector('.relative')!.dispatchEvent(new window.MouseEvent('mouseleave'));
  assert.equal(closed, 0, 'khung bọc ngoài không nhận được sự kiện rời chuột');
  document.querySelector('.cdk-overlay-backdrop')!.dispatchEvent(new window.MouseEvent('mouseenter'));
  assert.equal(closed, 0, 'lớp nền không được coi là vùng menu');
  let inMenu = 0;
  document.getElementById('item')!.addEventListener('mouseenter', () => inMenu++);
  document.getElementById('item')!.dispatchEvent(new window.MouseEvent('mouseenter'));
  assert.equal(inMenu, 1, 'trong menu vẫn nhận sự kiện hover');
  lock.release();
  document.querySelector('.relative')!.dispatchEvent(new window.MouseEvent('mouseleave'));
  assert.equal(closed, 1);
});

// ---------------------------------------------------------------------------
// Giai đoạn 3: tour:verify thử từng bước và tự sửa locator
// ---------------------------------------------------------------------------

const { locatorDrift, healLocator } = await import('./locator-heal');
const { probeStep } = await import('./locator-probe');

async function withLayoutAsync<T>(fn: () => Promise<T>): Promise<T> {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    return { width: 10, height: 10, left: 0, top: 0, right: 10, bottom: 10 } as DOMRect;
  };
  try {
    return await fn();
  } finally {
    Element.prototype.getBoundingClientRect = original;
  }
}

test('manh mối đã đổi: tên, thuộc tính danh tính, component; không tính css, vị trí, chữ hoa/dấu', () => {
  const stored = { tag: 'button', role: 'button', name: 'Bán', attrs: { routerlink: '/bond/sell', type: 'button' }, component: 'app-bond-portfolio', context: { heading: 'Trái phiếu' }, css: 'button.a', rect: { x: 0, y: 0, w: 0.1, h: 0.1 } };
  assert.deepEqual(locatorDrift(stored, { ...stored, name: 'BÁN', css: 'div > button', rect: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } }), []);
  assert.deepEqual(
    locatorDrift(stored, { ...stored, name: 'Bán ngay', attrs: { routerlink: '/bonds/sell', type: 'submit' }, component: 'app-bond-list' }),
    ['name', 'attrs.routerlink', 'component'],
  );
  // Chữ trùng tên không được lưu riêng: so với tên của bản mới
  assert.deepEqual(locatorDrift({ tag: 'a', text: 'Tài sản', attrs: {}, context: {} }, { tag: 'a', name: 'Tài sản', attrs: {}, context: {} }), []);

  const healed = healLocator(
    { ...stored, layout: 'mobile', list: { row: 'tr', rowText: 'VIC2401' } },
    { ...stored, name: 'Bán ngay', layout: 'desktop', list: { row: 'mat-row', column: 'Thao tác' } },
  );
  assert.equal(healed.name, 'Bán ngay');
  assert.equal(healed.layout, 'mobile', 'giữ bố cục của bản ghi');
  assert.deepEqual(healed.list, { row: 'mat-row', column: 'Thao tác', rowText: 'VIC2401' }, 'giữ dòng người duyệt đã ghim');
});

test('probeStep: tìm chắc nhưng chữ nút đã đổi thì đề xuất locator mới và báo phần tử nhạy cảm', async () => {
  await withLayoutAsync(async () => {
    page(`<app-bond-sell-panel><h2>Bán trái phiếu</h2><button data-testid="sell-submit" data-tour-role="user-only">Đặt lệnh bán</button></app-bond-sell-panel>`);
    const steps = [{ key: 's1', locator: { tag: 'button', role: 'button', name: 'Bán', attrs: { 'data-testid': 'sell-submit' }, component: 'app-bond-sell-panel', context: {} } }];
    const r = await probeStep(steps, 0, { timeoutMs: 50 });
    assert.equal(r.status, 'ok');
    assert.equal(r.userOnly, true);
    assert.deepEqual(r.drift, ['name']);
    assert.equal(r.proposed?.name, 'Đặt lệnh bán');
    assert.equal(r.proposed?.attrs['data-testid'], 'sell-submit');
    assert.equal((window as unknown as { __compassFound: Element }).__compassFound, document.querySelector('button'), 'phần tử tìm được để phía Node bấm/chụp');

    // Không đổi gì: không có đề xuất
    const same = await probeStep([{ key: 's1', locator: { ...steps[0].locator, name: 'Đặt lệnh bán' } }], 0, { timeoutMs: 50 });
    assert.equal(same.status, 'ok');
    assert.equal(same.drift, undefined);
    assert.equal(same.userOnly, true, 'phần tử dev đánh dấu user-only luôn là nhạy cảm');
  });
});

test('probeStep: tourId ghim mất nhưng locator tìm chắc thì báo đổi tourId; không thấy thì missing', async () => {
  await withLayoutAsync(async () => {
    page(`<nav><a href="/iconnect/assets">Tài sản</a></nav>`);
    const r = await probeStep([{ key: 's1', tourId: 'assets-tab', locator: { tag: 'a', role: 'link', name: 'Tài sản', attrs: { href: '/iconnect/assets' }, context: {} } }], 0, { timeoutMs: 50 });
    assert.equal(r.status, 'ok');
    assert.ok(r.drift?.includes('tourId'));
    assert.ok(r.matchedBy?.startsWith('locator:'));
    const gone = await probeStep([{ key: 's1', locator: { tag: 'button', role: 'button', name: 'Không có', attrs: {}, context: {} } }], 0, { timeoutMs: 50 });
    assert.equal(gone.status, 'missing');
  });
});

test('web gắn (click) lên div/span thường: leo tới vùng bấm, icon không chữ lấy mục chứa nó', () => {
  // Menu kiểu TCInvest: không role, không href, không cursor; bấm trúng icon
  page(`<app-left-menu><h3>Tiền</h3><div class="menu-group-content">
      <div class="m-child-item"><app-menu-icon><svg></svg></app-menu-icon><div><span class="t">Nộp tiền</span></div></div>
      <div class="m-child-item"><app-menu-icon><svg></svg></app-menu-icon><div><span class="t">Rút tiền</span></div></div>
    </div></app-left-menu>`);
  const fromIcon = captureLocator(document.querySelectorAll('svg')[1]);
  assert.equal(fromIcon.text, 'Rút tiền');
  assert.equal(fromIcon.tag, 'div');
  assert.ok(isUsableLocator(fromIcon));
  const found = findByLocator(fromIcon, document, always);
  assert.ok(found?.confident, JSON.stringify(found && { score: found.score, runnerUp: found.runnerUp }));
  assert.equal(found.element.className, 'm-child-item');

  // cursor: pointer khai báo ở thẻ ngoài, bấm trúng chữ bên trong
  page(`<app-home><div class="tile" style="cursor:pointer"><b style="cursor:pointer"><i style="cursor:pointer">Bảng giá</i></b></div><div class="tile" style="cursor:pointer"><b style="cursor:pointer"><i style="cursor:pointer">Sổ lệnh</i></b></div></app-home>`);
  const tile = captureLocator(document.querySelectorAll('i')[1]);
  assert.equal(tile.tag, 'div');
  assert.equal(tile.text, 'Sổ lệnh');
  assert.equal(findByLocator(tile, document, always)?.element, document.querySelectorAll('.tile')[1]);
});

test('khóa hover: chặn sự kiện rời chuột của menu JS, đóng băng hiển thị của menu CSS, nhả thì trả lại', async () => {
  const { lockHover, simulateHover } = await import('./hover-lock');
  page(`<nav><div class="top" id="trigger">Cổ phiếu<ul class="dropdown" style="display:block"><li><a href="/dat-lenh">Đặt lệnh</a></li></ul></div></nav>
    <div class="overlay"><div class="panel"><button>Sổ lệnh</button></div></div>`);
  const trigger = document.getElementById('trigger')!;
  const dropdown = document.querySelector('.dropdown') as HTMLElement;
  const overlayButton = document.querySelector('.panel button')!;
  let left = 0;
  let entered = 0;
  trigger.addEventListener('mouseleave', () => left++);
  trigger.addEventListener('mouseenter', () => entered++);
  document.querySelector('.panel')!.addEventListener('mouseleave', () => left++);

  simulateHover(trigger);
  assert.equal(entered, 1, 'mở menu JS bằng sự kiện hover giả');

  const lock = lockHover(trigger);
  lock.hold(document.querySelector('.dropdown a')!);
  lock.hold(overlayButton);
  // Chuột rời nút mở và rời khung overlay: app không được biết
  trigger.dispatchEvent(new window.MouseEvent('mouseleave'));
  document.querySelector('.panel')!.dispatchEvent(new window.MouseEvent('mouseleave'));
  assert.equal(left, 0);
  // Menu CSS: kiểu hiển thị bị ghim bằng !important nên mất :hover vẫn hiện
  assert.equal(dropdown.style.getPropertyValue('display'), 'block');
  assert.equal(dropdown.style.getPropertyPriority('display'), 'important');
  assert.equal(trigger.style.getPropertyPriority('display'), '', 'không đụng tới nút mở và tổ tiên chung');

  // Web đóng menu khi chuột ĐI VÀO chỗ khác (phần thân trang): sự kiện hover ngoài vùng menu cũng bị chặn,
  // còn trong vùng menu và trên giao diện của tour thì vẫn tới nơi
  const body = document.createElement('main');
  body.innerHTML = '<p id="content">Nội dung</p><div class="driver-popover"><button id="next">Tiếp</button></div>';
  document.body.appendChild(body);
  const got: string[] = [];
  for (const id of ['content', 'next']) document.getElementById(id)!.addEventListener('mouseenter', () => got.push(id));
  document.querySelector('.dropdown a')!.addEventListener('mouseenter', () => got.push('item'));
  for (const el of [document.getElementById('content')!, document.getElementById('next')!, document.querySelector('.dropdown a')!]) el.dispatchEvent(new window.MouseEvent('mouseenter'));
  assert.deepEqual(got, ['next', 'item'], 'chỉ sự kiện hover ở phần thân trang bị chặn');

  lock.release();
  assert.equal(dropdown.style.getPropertyPriority('display'), '', 'trả style cũ');
  assert.equal(dropdown.style.getPropertyValue('display'), 'block');
  assert.ok(left >= 1, 'nhả khóa thì báo rời chuột để menu JS tự đóng');
  const before = left;
  trigger.dispatchEvent(new window.MouseEvent('mouseleave'));
  assert.equal(left, before + 1, 'sau khi nhả, sự kiện chạy bình thường');
  document.getElementById('content')!.dispatchEvent(new window.MouseEvent('mouseenter'));
  assert.deepEqual(got, ['next', 'item', 'content'], 'sau khi nhả, phần thân trang nhận lại sự kiện hover');
});

test('tourId lồng nhau: lấy tourId của chính nút vừa bấm; vùng chứa nhiều nút không được dùng', async () => {
  const { pickTourId } = await import('./locator-capture');
  const q = (sel: string) => document.querySelector(sel)!;

  // div[tourId] > button[tourId] > span: bấm trúng chữ trong nút -> tourId của nút, không phải của div
  page(`<div data-tour-id="toolbar"><button data-tour-id="sell-btn"><span class="t">Bán</span></button><button id="other">Mua</button></div>`);
  assert.equal(pickTourId(q('.t')).tourId, 'sell-btn');
  assert.equal(pickTourId(q('[data-tour-id="sell-btn"]')).tourId, 'sell-btn');
  // Nút không có tourId nằm trong vùng chứa có tourId và nhiều nút: không lấy tourId của vùng, báo lại là đã bỏ qua
  const other = pickTourId(q('#other'));
  assert.deepEqual([other.tourId, other.element, other.skipped], [null, null, 'toolbar']);

  // Nút và phần tử con đều có tourId: nút thắng
  page(`<button data-tour-id="outer"><span data-tour-id="inner">Xác nhận</span></button>`);
  assert.equal(pickTourId(q('span')).tourId, 'outer');
  // Chỉ phần tử con trong nút có tourId: dùng nó
  page(`<button><i class="ic"></i><span data-tour-id="label"><b>Lưu</b></span></button>`);
  assert.equal(pickTourId(q('b')).tourId, 'label');
  assert.equal(pickTourId(q('.ic')).tourId, null, 'bấm trúng phần khác của nút: không có tourId trên đường đi');

  // Phần tử bọc sát chỉ chứa đúng một nút: dùng tourId của nó
  page(`<section><div data-tour-id="wrap"><span><button>Gửi</button></span></div><button>Khác</button></section>`);
  assert.equal(pickTourId(q('button')).tourId, 'wrap');
  // tourId ở xa (cả khu vực): không dùng, có báo lại
  page(`<main data-tour-id="page"><div><div><div><div><button>Sâu</button></div></div></div></div></main>`);
  assert.deepEqual([pickTourId(q('button')).tourId, pickTourId(q('button')).skipped], [null, 'page']);
  // Không có tourId nào
  page(`<button>Trần</button>`);
  assert.deepEqual(pickTourId(q('button')), { element: null, tourId: null });
});

test('menu có cursor: pointer trên cả vùng chứa (thanh bên TCInvest): chỉ lấy đúng mục, không lấy cả thanh', () => {
  const pointer = 'style="cursor:pointer"';
  page(`<app-menu-sidebar><div class="m-contained-content" ${pointer}>
      <div class="m-root-item" ${pointer}><div class="m-item-wrapper" ${pointer}><div class="item-w2" ${pointer}><i class="ic" ${pointer}></i><span ${pointer}>Tiền</span></div></div></div>
      <div class="m-root-item" ${pointer}><div class="m-item-wrapper" ${pointer}><div class="item-w2" ${pointer}><i class="ic" ${pointer}></i><span ${pointer}>Cổ phiếu</span></div></div></div>
      <div class="m-root-item" ${pointer}><div class="m-item-wrapper" ${pointer}><div class="item-w2" ${pointer}><i class="ic" ${pointer}></i><span ${pointer}>Trái phiếu</span></div></div></div>
    </div></app-menu-sidebar>`);
  const root = document.querySelectorAll('.m-root-item')[1];
  // Chuột nằm trên khung trong của mục, trên chữ, hoặc trên icon không chữ: đều ra đúng mục "Cổ phiếu"
  for (const el of [root.querySelector('.item-w2')!, root.querySelector('span')!, root.querySelector('.ic')!]) {
    const loc = captureLocator(el);
    assert.equal(loc.text, 'Cổ phiếu', el.className || el.tagName);
    const found = findByLocator(loc, document, always);
    assert.ok(found?.confident, JSON.stringify(found && { score: found.score, runnerUp: found.runnerUp }));
    assert.equal(found.element.closest('.m-root-item'), root);
  }
  // Mục có tiêu đề và dòng mô tả: lấy tiêu đề vừa bấm, không gộp mô tả
  page(`<div class="cdk-overlay-pane"><div class="block" ${pointer}><div class="flex-center" ${pointer}><span ${pointer}>Bảng giá cổ phiếu</span></div><div class="item-description" ${pointer}>Nơi theo dõi giá</div></div>
    <div class="block" ${pointer}><div class="flex-center" ${pointer}><span ${pointer}>Đặt lệnh cổ phiếu</span></div><div class="item-description" ${pointer}>Đặt lệnh mua bán</div></div></div>`);
  assert.equal(captureLocator(document.querySelector('span')!).text, 'Bảng giá cổ phiếu');
});

test('trang rất nhiều div: phần tử nằm cuối trang (popup) vẫn được tìm thấy theo chữ', () => {
  const filler = Array.from({ length: 2200 }, (_, i) => `<div class="cell">ô ${i}</div>`).join('');
  page(`<main>${filler}</main><div class="cdk-overlay-container"><div class="cdk-overlay-pane"><div class="title"><div class="flex-center"><span>Bảng giá cổ phiếu</span></div></div><div class="title"><div class="flex-center"><span>Đặt lệnh cổ phiếu</span></div></div></div></div>`);
  const target = document.querySelector('.flex-center')!;
  const loc = captureLocator(target.querySelector('span')!);
  // Không dựa vào selector dự phòng: chỉ thẻ + chữ + ngữ cảnh
  const found = findByLocator({ ...loc, css: undefined }, document, always);
  assert.ok(found, 'popup cuối trang phải nằm trong danh sách ứng viên');
  assert.ok(found.element === target || target.contains(found.element) || found.element.contains(target));
  assert.equal(findByLocator(loc, document, always)?.confident, true);
});

test('mục menu dựng bằng div chỉ có chữ: bố cục đổi (selector và vị trí lệch) vẫn tìm chắc nhờ đúng chữ + ngữ cảnh', () => {
  const menu = (items: string[]) => `<main><p>Cổ phiếu</p></main><div class="cdk-overlay-pane">${items.map((t) => `<div class="row"><div class="title"><div class="flex-center" style="cursor:pointer"><span style="cursor:pointer">${t}</span></div></div></div>`).join('')}</div>`;
  page(menu(['Bảng giá cổ phiếu', 'Đặt lệnh cổ phiếu', 'Trade Station']));
  const loc = captureLocator(document.querySelector('span')!);
  assert.equal(loc.text, 'Bảng giá cổ phiếu');
  assert.equal(loc.role, undefined);
  // Menu mở rộng: thêm mục phía trước, selector dự phòng (nth-of-type) và vị trí không còn đúng
  page(menu(['iPO', 'Giao dịch Darkpool', 'Bảng giá cổ phiếu', 'Đặt lệnh cổ phiếu']));
  const found = findByLocator(loc, document, always);
  assert.ok(found?.confident, JSON.stringify(found && { score: found.score, runnerUp: found.runnerUp, by: found.matchedBy }));
  assert.equal(found.element.textContent, 'Bảng giá cổ phiếu');
  // Cùng chữ ở hai nơi không phân biệt được bằng ngữ cảnh thì vẫn không chắc
  page(`<section><div style="cursor:pointer">Cổ phiếu</div></section><aside><div style="cursor:pointer">Cổ phiếu</div></aside>`);
  const twin = captureLocator(document.querySelector('div')!);
  assert.equal(findByLocator({ ...twin, css: undefined, rect: undefined }, document, always)?.confident, false);
});
