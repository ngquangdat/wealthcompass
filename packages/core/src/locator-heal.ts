// Tự sửa locator (healing): khi tour:verify vẫn tìm chắc được phần tử nhưng manh mối chính đã đổi
// (đổi chữ trên nút, đổi routerLink, đổi component sau migration), ghi lại locator từ phần tử tìm được
// để lần sau không phải dựa vào các manh mối còn lại. Hàm thuần, không đụng DOM: test được ở Node.
import type { Locator } from '@wealthcompass/contracts';
import { normalizeVi } from './text';

// Thuộc tính mà đổi giá trị là đổi "danh tính" của phần tử (không tính placeholder, type, aria-label phụ)
const IDENTITY_ATTRS = ['data-testid', 'formcontrolname', 'routerlink', 'href', 'name', 'id'];

function same(a: string | undefined, b: string | undefined): boolean {
  return normalizeVi(a ?? '') === normalizeVi(b ?? '');
}

// Manh mối của locator đang lưu không còn đúng với phần tử thật (locator ghi lại từ phần tử tìm được).
// CSS và vị trí không tính: finder sinh selector khác nhau giữa các lần, vị trí đổi theo dữ liệu.
export function locatorDrift(stored: Locator, fresh: Locator): string[] {
  const changed: string[] = [];
  if (stored.name && !same(stored.name, fresh.name)) changed.push('name');
  // Lúc ghi, chữ trùng tên thì không lưu `text`: so với tên khi bản mới không có chữ riêng
  if (stored.text && !same(stored.text, fresh.text ?? fresh.name)) changed.push('text');
  if (stored.role && fresh.role && stored.role !== fresh.role) changed.push('role');
  for (const attr of IDENTITY_ATTRS) {
    const want = stored.attrs?.[attr];
    if (want !== undefined && fresh.attrs?.[attr] !== want) changed.push(`attrs.${attr}`);
  }
  if (stored.component && stored.component !== fresh.component) changed.push('component');
  const ctx = stored.context ?? {};
  if (ctx.dialog && !same(ctx.dialog, fresh.context?.dialog)) changed.push('dialog');
  if (ctx.heading && !same(ctx.heading, fresh.context?.heading)) changed.push('heading');
  if (stored.list && fresh.list && stored.list.row !== fresh.list.row) changed.push('list');
  return changed;
}

// Locator mới = locator ghi lại từ phần tử thật, giữ phần người duyệt đã chọn (dòng ghim) và bố cục của bản ghi
export function healLocator(stored: Locator, fresh: Locator): Locator {
  const list = fresh.list ?? stored.list;
  return {
    ...fresh,
    ...(stored.layout ? { layout: stored.layout } : {}),
    ...(list ? { list: { ...list, ...(stored.list?.rowText ? { rowText: stored.list.rowText } : {}), ...(stored.list?.index !== undefined ? { index: stored.list.index } : {}) } } : {}),
  };
}
