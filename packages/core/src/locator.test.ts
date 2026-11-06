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

test('nhận ra nút nhạy cảm theo chữ và nút gửi form', () => {
  page(`<button>Bán</button><button>Bán trái phiếu</button><button>Xem bảng giá</button><form><button type="submit">Gửi</button></form>`);
  const policy = buildSafetyPolicy({ userOnlyText: ['bán', 'xác nhận'] });
  const [sell, sellBond, view, submit] = Array.from(document.querySelectorAll('button'));
  assert.equal(isUserOnly(sell, policy), true);
  assert.equal(isUserOnly(sellBond, policy), true);
  assert.equal(isUserOnly(view, policy), false);
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
  assert.deepEqual(loc.list, { row: 'tr', column: 'Thao tác' });
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
