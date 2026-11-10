// Ghi locator cho một phần tử lúc `tour:record`. Chạy TRONG trình duyệt (được esbuild đóng gói thành
// capture.bundle.ts và tiêm vào trang); không nằm trong widget nên không kéo @medv/finder vào web chủ.
import { computeAccessibleName, getRole } from 'dom-accessibility-api';
import { finder } from '@medv/finder';
import type { Locator } from '@wealthcompass/contracts';
import { redactPii } from './pii';
import {
  DIALOG_SELECTOR,
  HEADING_SELECTOR,
  INTERACTIVE_SELECTOR,
  LANDMARK_SELECTOR,
  LOCATOR_ATTRS,
  cleanText,
  columnOf,
  isAppComponentTag,
  isVisible,
  rowIndex,
  rowOf,
  rowSignature,
  stripIconText,
  isStableToken,
  mostlyDigits,
} from './locator-filters';

export interface CaptureOptions {
  // Dưới bề rộng này coi là bố cục mobile
  mobileBreakpoint?: number;
}

function cursorOf(element: Element): string {
  try {
    return getComputedStyle(element).cursor;
  } catch {
    return '';
  }
}

function shortText(element: Element): string {
  return cleanText((element as HTMLElement).innerText ?? element.textContent, 200);
}

// Vùng bấm quá lớn (cả thẻ, cả trang) không phải "một nút": dừng leo ở đây
const MAX_TARGET_TEXT = 120;

// Phần tử thật sự nhận lần bấm.
// 1. Thẻ/role tương tác gần nhất (bấm trúng icon/span bên trong nút).
// 2. Web gắn (click) lên div/span thường (không role, không href): leo lên tổ tiên ngoài cùng còn `cursor: pointer`
//    (cursor kế thừa xuống con, nên phần tử ngoài cùng là nơi khai báo), miễn vùng đó không quá lớn.
// 3. Bấm trúng icon/ảnh không có chữ và không có cursor: leo tối đa 4 cấp tới tổ tiên gần nhất có chữ ngắn,
//    để locator có manh mối tìm lại.
export function interactiveTarget(element: Element): Element {
  const semantic = element.closest(INTERACTIVE_SELECTOR);
  if (semantic) return semantic;
  if (cursorOf(element) === 'pointer') {
    let target = element;
    for (let depth = 0; depth < 6; depth++) {
      const parent = target.parentElement;
      if (!parent || parent === document.body || cursorOf(parent) !== 'pointer' || shortText(parent).length > MAX_TARGET_TEXT) break;
      target = parent;
    }
    return target;
  }
  if (!shortText(element)) {
    let scope = element.parentElement;
    for (let depth = 0; scope && scope !== document.body && depth < 4; depth++, scope = scope.parentElement) {
      const text = shortText(scope);
      if (text.length > MAX_TARGET_TEXT) break;
      if (text) return scope;
    }
  }
  return element;
}

// Chữ an toàn để ghi: không lấy trong vùng nhạy cảm, không lấy chuỗi toàn số, đã che PII
function safeText(raw: string | null | undefined, element: Element, max = 60): string | undefined {
  if (element.closest('[data-sensitive]')) return undefined;
  const text = cleanText(raw, max);
  if (!text || mostlyDigits(text)) return undefined;
  // Có PII thì bỏ hẳn, không ghi chuỗi đã che (chuỗi che không giúp tìm lại phần tử)
  return redactPii(text).text === text ? text : undefined;
}

function accessibleName(element: Element): string {
  try {
    return computeAccessibleName(element);
  } catch {
    return '';
  }
}

function attrsOf(element: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of LOCATOR_ATTRS) {
    const value = element.getAttribute(name);
    if (!value) continue;
    if (name === 'id' && !isStableToken(value)) continue;
    if (name === 'href') {
      // Chỉ giữ đường dẫn cùng origin, bỏ query (có thể chứa mã khách hàng)
      try {
        const url = new URL(value, location.href);
        if (url.origin !== location.origin) continue;
        out[name] = url.pathname;
      } catch {
        // href lạ: bỏ qua
      }
      continue;
    }
    if (mostlyDigits(value)) continue;
    out[name] = value.slice(0, 80);
  }
  return out;
}

function componentOf(element: Element): string | undefined {
  for (let el: Element | null = element; el; el = el.parentElement) {
    const tag = el.tagName.toLowerCase();
    if (isAppComponentTag(tag)) return tag;
  }
  return undefined;
}

// Tiêu đề mục gần nhất đứng TRƯỚC phần tử, tìm ngược lên tối đa 6 cấp tổ tiên
function headingOf(element: Element): string | undefined {
  let scope: Element | null = element.parentElement;
  for (let depth = 0; scope && depth < 6; depth++, scope = scope.parentElement) {
    const headings = Array.from(scope.querySelectorAll(HEADING_SELECTOR)).filter(
      (h) => h !== element && !h.contains(element) && h.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const last = headings.at(-1);
    if (last) return safeText(last.textContent, last, 60);
  }
  return undefined;
}

function dialogOf(element: Element): string | undefined {
  const dialog = element.closest(DIALOG_SELECTOR);
  if (!dialog) return undefined;
  const name = accessibleName(dialog) || dialog.querySelector(HEADING_SELECTOR)?.textContent || '';
  return safeText(name, dialog, 60) ?? '(dialog)';
}

function landmarkOf(element: Element): string | undefined {
  const landmark = element.closest(LANDMARK_SELECTOR);
  if (!landmark) return undefined;
  return getRole(landmark) ?? landmark.tagName.toLowerCase();
}

function cssOf(element: Element): string | undefined {
  try {
    return finder(element, {
      idName: isStableToken,
      className: (name) => isStableToken(name) && !/^(ng-|mat-|cdk-|mdc-|active|selected|focus|hover|disabled)/.test(name),
      tagName: () => true,
      attr: (name, value) => (name === 'formcontrolname' || name === 'name' || name === 'data-testid' || name === 'routerlink') && isStableToken(value),
      timeoutMs: 200,
    });
  } catch {
    return undefined;
  }
}

// Khóa rẻ để so phần tử giữa hai lần bấm (tính được cho hàng nghìn phần tử, không cần tên truy cập)
function quickKey(element: Element): string {
  return `${element.tagName}|${cleanText(element.getAttribute('aria-label') || element.textContent, 40)}`;
}

// Khóa để nhận ra phần tử "y hệt" ở dòng khác: thẻ, chữ và các thuộc tính phân biệt (hai ô nhập khác formcontrolname là khác)
function twinKey(element: Element): string {
  const attrs = ['aria-label', 'formcontrolname', 'name', 'placeholder', 'type', 'routerlink'].map((a) => element.getAttribute(a) ?? '');
  return [element.tagName, cleanText(element.textContent, 40), ...attrs].join('|');
}

// Phần tử bấm được nằm trong một dòng lặp, VÀ dòng anh em cũng có phần tử y hệt (nút "Bán" trên mỗi dòng):
// ghi hình dạng dòng thay vì dòng cụ thể. Dòng lặp nhưng phần tử khác nhau (form-group) thì không phải danh sách.
function listOf(element: Element): Locator['list'] {
  const row = rowOf(element);
  if (!row?.parentElement) return undefined;
  const signature = rowSignature(row);
  const key = twinKey(element);
  const twin = Array.from(row.parentElement.children).some(
    (other) => other !== row && rowSignature(other) === signature && Array.from(other.querySelectorAll(element.tagName)).some((e) => twinKey(e) === key),
  );
  if (!twin) return undefined;
  const column = columnOf(element);
  return { row: signature, ...(column ? { column } : {}), index: rowIndex(row) };
}

export interface VisibleSnapshot {
  path: string;
  elements: WeakSet<Element>;
  keys: Set<string>;
}

// Chụp các phần tử bấm được đang hiện, ở pha capture của lần bấm (DOM chưa đổi). Lần bấm sau so với ảnh này
// để biết phần tử của nó có phải do lần bấm trước mở ra không (nút menu, mở rộng mục).
export function snapshotVisible(root: ParentNode = document): VisibleSnapshot {
  const elements = new WeakSet<Element>();
  const keys = new Set<string>();
  for (const el of Array.from(root.querySelectorAll(INTERACTIVE_SELECTOR)).slice(0, 5000)) {
    if (!isVisible(el)) continue;
    elements.add(el);
    keys.add(quickKey(el));
  }
  return { path: location.pathname, elements, keys };
}

// Phần tử vừa bấm chưa hiện lúc chụp ảnh (cùng màn hình): do lần bấm trước mở ra
export function appearedSince(snapshot: VisibleSnapshot | null | undefined, clicked: Element): boolean {
  if (!snapshot || snapshot.path !== location.pathname) return false;
  const element = interactiveTarget(clicked);
  // Ảnh chụp chỉ gồm thẻ/role tương tác; div/span có (click) không nằm trong đó nên không kết luận được
  if (!element.matches(INTERACTIVE_SELECTOR)) return false;
  return !snapshot.elements.has(element) && !snapshot.keys.has(quickKey(element));
}

export function captureLocator(clicked: Element, options: CaptureOptions = {}): Locator {
  const element = interactiveTarget(clicked);
  const role = getRole(element) ?? undefined;
  const name = safeText(stripIconText(element, cleanText(accessibleName(element), 200)), element, 80);
  const text = safeText(stripIconText(element, cleanText((element as HTMLElement).innerText ?? element.textContent, 200)), element, 60);
  const rect = element.getBoundingClientRect();
  const vw = window.innerWidth || 1;
  const vh = window.innerHeight || 1;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const component = componentOf(element);
  const css = cssOf(element);
  const list = listOf(element);
  // Trong danh sách: tiêu đề tìm từ NGOÀI vùng chứa các dòng (tiêu đề trong dòng là dữ liệu, vd. mã trái phiếu)
  const headingFrom = list ? (rowOf(element)?.parentElement ?? element) : element;
  const context = { dialog: dialogOf(element), heading: headingOf(headingFrom), landmark: landmarkOf(element) };
  return {
    tag: element.tagName.toLowerCase(),
    ...(role ? { role } : {}),
    ...(name ? { name } : {}),
    ...(text && text !== name ? { text } : {}),
    attrs: attrsOf(element),
    ...(component ? { component } : {}),
    context: Object.fromEntries(Object.entries(context).filter(([, v]) => v !== undefined)),
    ...(css ? { css } : {}),
    rect: { x: round(rect.left / vw), y: round(rect.top / vh), w: round(rect.width / vw), h: round(rect.height / vh) },
    layout: vw < (options.mobileBreakpoint ?? 768) ? 'mobile' : 'desktop',
    ...(list ? { list } : {}),
  };
}
