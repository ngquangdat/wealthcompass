import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { menuTourId } from '@wealthcompass/core';
import { analyzeTemplateForAnnotate, annotate, detectSensitive, screenSlug, slug } from './annotate';
import { scan } from './scan';

const fixture = resolve(import.meta.dirname, '../test-fixtures/annotate-app');

// Bản sao tạm trong một repo git riêng, để thử `git apply` thật
function tempRepo(): { dir: string; config: string } {
  const dir = mkdtempSync(join(tmpdir(), 'compass-annotate-'));
  cpSync(fixture, dir, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init');
  return { dir, config: join(dir, 'compass.config.yaml') };
}

test('đặt tên: bỏ dấu, tối đa vài từ, màn hình lấy đoạn cuối của route', () => {
  assert.equal(slug('Đặt lệnh mua cổ phiếu ngay bây giờ'), 'dat-lenh-mua-co');
  assert.equal(screenSlug('/iconnect/assets'), 'assets');
  assert.equal(screenSlug('/fund/:id'), 'fund');
  assert.equal(screenSlug('/'), 'home');
});

test('phát hiện nhạy cảm: chắc chắn / cần xem lại / không', () => {
  const base = { tag: 'button', kind: 'button' as const, identifiers: [], navigates: false };
  assert.equal(detectSensitive({ ...base, label: 'BÁN' })?.level, 'sure');
  assert.equal(detectSensitive({ ...base, label: 'Đặt lệnh' })?.level, 'sure');
  assert.equal(detectSensitive({ ...base, label: 'Xác nhận' })?.level, 'sure');
  assert.equal(detectSensitive({ ...base, type: 'submit', label: 'Lưu' })?.level, 'sure');
  assert.equal(detectSensitive({ tag: 'input', kind: 'input', type: 'password', identifiers: [], navigates: false })?.level, 'sure');
  assert.equal(detectSensitive({ tag: 'input', kind: 'input', identifiers: ['otpCode'], navigates: false })?.level, 'sure');
  assert.equal(detectSensitive({ ...base, label: 'Chọn bán' })?.level, 'maybe');
  assert.equal(detectSensitive({ ...base, label: 'Mở', identifiers: ['confirmOrder'] })?.level, 'maybe');
  assert.equal(detectSensitive({ ...base, label: 'Làm mới' }), null);
  assert.equal(detectSensitive({ ...base, label: 'Xác nhận lại thông tin' })?.level, 'maybe', 'cụm xác nhận');
  // Từ đơn "toan" trong "toàn thị trường" không còn bị coi là thanh toán
  assert.equal(detectSensitive({ ...base, label: 'Toàn thị trường' }), null);
  // Tên biến trước tên hàm không tính: selectingSell.set(false) chỉ là bật/tắt chế độ
  // Link chuyển trang không phải hành động, kể cả chữ "Đặt lệnh"
  assert.equal(detectSensitive({ ...base, kind: 'link', label: 'Đặt lệnh', navigates: true }), null);
  // Ô nhập thường (mã chứng khoán) không nhạy cảm dù có chữ "mua"
  assert.equal(detectSensitive({ tag: 'input', kind: 'input', label: 'Mã mua', identifiers: [], navigates: false }), null);
});

test('tên hàm trong (click) chỉ lấy đoạn cuối; khung bao ngoài và nhãn không có chữ cái', () => {
  const found = analyzeTemplateForAnnotate(`
    <button (click)="selectingSell.set(false)">Bỏ qua</button>
    <button (click)="placeOrder(row)">Mở</button>
    <div (click)="close()"><button (click)="ok()">Đồng ý</button></div>
    <button>+5</button>`);
  assert.deepEqual(found.map((f) => f.label), ['Bỏ qua', 'Mở', 'Đồng ý', '+5'], 'div bao ngoài bị bỏ');
  assert.ok(found[0].identifiers.includes('set') && !found[0].identifiers.some((i) => /selectingSell/.test(i)), 'chỉ lấy tên hàm được gọi');
  assert.equal(detectSensitive({ tag: 'button', kind: 'button', label: found[0].label, identifiers: found[0].identifiers, navigates: false }), null);
  assert.equal(detectSensitive({ tag: 'button', kind: 'button', label: found[1].label, identifiers: found[1].identifiers, navigates: false })?.level, 'maybe');
});

test('phân tích template: bỏ phần tử đã có tourId, ẩn, input hidden; lấy chữ không kể icon', () => {
  const found = analyzeTemplateForAnnotate(`
    <button tourId="x">A</button><button hidden>B</button><input type="hidden" name="h">
    <button (click)="go()"><mat-icon>refresh</mat-icon> Làm mới</button>
    @if (a) { <a routerLink="/x/y">Đi</a> }`);
  assert.deepEqual(found.map((f) => [f.kind, f.label]), [['button', 'Làm mới'], ['link', 'Đi']]);
});

test('nhãn ô nhập: lấy từ <label> bao ngoài hoặc <label for>, không lấy chữ của option', () => {
  const found = analyzeTemplateForAnnotate(`
    <label>Loại nghỉ
      <select name="type"><option>Nghỉ phép năm</option><option>Nghỉ ốm</option></select>
    </label>
    <label for="reason">Lý do</label><textarea id="reason"></textarea>
    <mat-form-field><mat-label>Số tiền</mat-label><input matInput name="amount" /><mat-hint>VND</mat-hint></mat-form-field>
    <select name="bare"><option>A</option></select>
    <input aria-label="Tìm kiếm" placeholder="Nhập mã" />
  `);
  assert.deepEqual(found.map((f) => f.label), ['Loại nghỉ', 'Lý do', 'Số tiền', null, 'Tìm kiếm']);
});

test('annotate: gợi ý đúng, không sửa code, patch áp được bằng git apply', () => {
  const { dir, config } = tempRepo();
  const before = readFileSync(join(dir, 'src/app/orders.page.html'), 'utf8');
  const result = annotate({ config });

  // Code chưa bị sửa
  assert.equal(readFileSync(join(dir, 'src/app/orders.page.html'), 'utf8'), before);
  const ids = result.candidates.map((c) => c.tourId);
  assert.equal(new Set(ids).size, ids.length, 'tourId không trùng nhau');
  const byLabel = (screen: string, label: string) => result.candidates.find((c) => c.screen === screen && c.label === label)!;

  assert.equal(byLabel('/orders', 'Hủy lệnh').tourId, 'orders-huy-lenh');
  assert.equal(byLabel('/orders', 'Hủy lệnh').sensitive?.level, 'sure');
  assert.equal(byLabel('/orders', 'Đặt lệnh').sensitive?.level, 'sure');
  assert.equal(byLabel('/orders', 'Chọn bán').sensitive?.level, 'maybe');
  assert.equal(byLabel('/orders', 'Làm mới').sensitive, null);
  assert.equal(byLabel('/orders', 'Lịch sử lệnh').kind, 'link');
  assert.equal(byLabel('/orders', 'Mã chứng khoán').tourId, 'orders-ma-chung-khoan-input');
  assert.equal(byLabel('/orders', 'Tab một').kind, 'tab');
  assert.ok(!ids.includes('orders-existing'), 'phần tử đã có tourId không được gợi ý lại');
  assert.ok(!result.candidates.some((c) => c.label === 'Ẩn'));
  // Mật khẩu trong template nằm trong .ts
  const pw = result.candidates.find((c) => c.screen === '/login' && c.kind === 'input' && c.sensitive);
  assert.equal(pw?.sensitive?.reason, 'ô mật khẩu');
  // Khung chung (route cha) cũng được quét
  assert.ok(result.candidates.some((c) => c.screen === '/shell' && c.label === 'Quay về sổ lệnh'));
  // Component không standalone bị bỏ qua có lý do, không có trong patch
  assert.ok(result.skipped.some((s) => s.component === 'LegacyPage' && /standalone/.test(s.reason)));
  assert.ok(!result.candidates.some((c) => c.component === 'LegacyPage'));

  // Áp patch thật
  assert.ok(result.patchFile && result.patch.length > 0);
  execFileSync('git', ['apply', '--check', result.patchFile!], { cwd: dir });
  execFileSync('git', ['apply', result.patchFile!], { cwd: dir });

  const html = readFileSync(join(dir, 'src/app/orders.page.html'), 'utf8');
  assert.match(html, /<button tourId="orders-huy-lenh" tourLabel="Hủy lệnh" tourRole="user-only" type="button" class="x">/);
  assert.match(html, /<button tourId="orders-existing">/, 'phần tử cũ giữ nguyên');
  const ts = readFileSync(join(dir, 'src/app/app.routes.ts'), 'utf8');
  assert.match(ts, /import \{ TourIdDirective \} from '@wealthcompass\/angular';/);
  assert.match(ts, /imports: \[CommonModule, TourIdDirective\]/, 'thêm vào mảng imports có sẵn');
  assert.match(ts, /imports: \[TourIdDirective\],\n\s*selector: 'app-login'|selector: 'app-login',[\s\S]*imports: \[TourIdDirective\]/, 'tạo imports khi chưa có');
  assert.match(ts, /<input type="password" tourId="login-[a-z-]+" tourRole="user-only"|<input tourId="login-[a-z-]+" tourRole="user-only" type="password"/);
  // standalone:false không bị đụng
  assert.match(ts, /standalone: false, template: `<button>Cũ<\/button>`/);
});

test('khứ hồi: sau khi áp patch, scan thấy đúng các tourId mới và chạy annotate lần nữa không còn gợi ý', () => {
  const { dir, config } = tempRepo();
  const first = annotate({ config });
  execFileSync('git', ['apply', first.patchFile!], { cwd: dir });

  const { featureMap } = scan(config);
  const targets = new Set(featureMap.features.flatMap((f) => f.targets.map((t) => t.tourId)));
  for (const c of first.candidates.filter((x) => x.component !== 'LegacyPage')) assert.ok(targets.has(c.tourId), `scan phải thấy ${c.tourId}`);
  const sell = featureMap.features.flatMap((f) => f.targets).find((t) => t.tourId === 'orders-huy-lenh');
  assert.equal(sell?.sensitivity, 'user-only');

  const second = annotate({ config, out: null });
  assert.deepEqual(second.candidates.map((c) => c.tourId), [], 'idempotent: không còn gì để gợi ý');
  assert.equal(second.patch, '');
});

test('--only giới hạn theo route; --print không ghi file; id mới không trùng id đã có', () => {
  const { dir, config } = tempRepo();
  writeFileSync(join(dir, 'src/app/orders.page.html'), readFileSync(join(dir, 'src/app/orders.page.html'), 'utf8').replace('tourId="orders-existing"', 'tourId="orders-lam-moi"'));
  const only = annotate({ config, only: ['/orders'], out: null });
  assert.ok(only.candidates.every((c) => c.screen === '/orders'));
  assert.equal(only.patchFile, null);
  const refresh = only.candidates.find((c) => c.label === 'Làm mới')!;
  assert.equal(refresh.tourId, 'orders-lam-moi-2', 'đã có orders-lam-moi nên thêm hậu tố');
});

test('menu sinh từ dữ liệu: gắn [tourMenu] thay vì tourId trùng, scan tạo mốc menu-<route> cho từng mục; nút cùng khối mật khẩu là user-only', () => {
  const { dir, config } = tempRepo();
  const shell = join(dir, 'src/app/shell.ts');
  writeFileSync(
    shell,
    readFileSync(shell, 'utf8').replace(
      '<nav><a routerLink="/orders">Quay về sổ lệnh</a></nav>',
      '<nav>@for (m of nav; track m.route) { <a [routerLink]="m.route">{{ m.label }}</a> }</nav><section><input type="password" name="p" /><button>Lưu</button></section>',
    ),
  );
  assert.equal(menuTourId('/leave/request'), 'menu-leave-request');
  assert.equal(menuTourId('shell/inner?x=1'), 'menu-shell-inner');
  assert.equal(menuTourId('/'), 'menu-home');
  assert.equal(menuTourId(['/orders', 'returns']), 'menu-orders-returns');

  const first = annotate({ config });
  const menu = first.candidates.find((c) => c.kind === 'menu')!;
  assert.equal(menu.menuExpr, 'm.route');
  assert.equal(menu.sensitive, null);
  assert.equal(first.candidates.find((c) => c.label === 'Lưu')?.sensitive?.reason, 'nút nằm cùng khối với ô mật khẩu/OTP/PIN');
  execFileSync('git', ['apply', first.patchFile!], { cwd: dir });
  const ts = readFileSync(shell, 'utf8');
  assert.match(ts, /<a \[tourMenu\]="m\.route" \[routerLink\]="m\.route">/);
  assert.match(ts, /import \{ TourMenuDirective, TourIdDirective \} from '@wealthcompass\/angular';/);
  assert.match(ts, /imports: \[TourMenuDirective, TourIdDirective\]/);

  const targets = scan(config).featureMap.features.find((f) => f.route.pattern === '/shell/inner')!.targets;
  const inner = targets.find((t) => t.tourId === 'menu-shell-inner');
  assert.equal(inner?.label, 'Khung › Trong khung');
  assert.ok(targets.some((t) => t.tourId === 'menu-orders'));
  assert.ok(!annotate({ config, out: null }).candidates.some((c) => c.kind === 'menu'), 'đã có [tourMenu] thì không gợi ý lại');
});

test('nút có chữ mật khẩu/OTP là user-only chắc chắn; link "Quên mật khẩu" thì không', () => {
  const base = { tag: 'button', kind: 'button' as const, identifiers: [], navigates: false };
  assert.equal(detectSensitive({ ...base, label: 'Cập nhật mật khẩu' })?.level, 'sure');
  assert.equal(detectSensitive({ ...base, label: 'Gửi lại OTP' })?.level, 'sure');
  assert.equal(detectSensitive({ ...base, tag: 'a', kind: 'link', label: 'Quên mật khẩu', navigates: true }), null);
});
