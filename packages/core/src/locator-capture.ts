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
  isAppComponentTag,
  stripIconText,
  isStableToken,
  mostlyDigits,
} from './locator-filters';

export interface CaptureOptions {
  // Dưới bề rộng này coi là bố cục mobile
  mobileBreakpoint?: number;
}

// Lần bấm trúng icon/span bên trong nút: lấy phần tử tương tác gần nhất
export function interactiveTarget(element: Element): Element {
  return element.closest(INTERACTIVE_SELECTOR) ?? element;
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
  const context = { dialog: dialogOf(element), heading: headingOf(element), landmark: landmarkOf(element) };
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
  };
}
