import { normalizeVi } from './text';
// SafetyPolicy: quy tắc nền "chỉ người dùng được chạm" (plan mục 5.5).
// Cấu hình tenant/pack chỉ được THÊM selector, không được bỏ các selector nền.

export const BASE_USER_ONLY_SELECTORS: readonly string[] = [
  'input[type=password]',
  'input[autocomplete=one-time-code]',
  'input[name*=otp i]',
  'input[name*=pin i]',
  'input[autocomplete^=cc-]',
  '[data-sensitive]',
  '[tourrole=user-only]',
  '[data-tour-role=user-only]',
];

export interface SafetyPolicy {
  userOnlySelectors: string[];
  blockedRoutes: string[];
  // Từ khóa trên nút nhạy cảm (vd. "bán", "xác nhận"): tour không gắn tourId nên không có thuộc tính đánh dấu,
  // phải nhận ra theo chữ. So khớp không dấu, theo nguyên cụm từ.
  userOnlyText: string[];
}

export function buildSafetyPolicy(extra?: Partial<SafetyPolicy>): SafetyPolicy {
  return {
    userOnlySelectors: [...BASE_USER_ONLY_SELECTORS, ...(extra?.userOnlySelectors ?? [])],
    blockedRoutes: [...(extra?.blockedRoutes ?? [])],
    userOnlyText: [...(extra?.userOnlyText ?? [])],
  };
}

// Phần tử (hoặc tổ tiên) khớp selector user-only => engine chỉ được highlight, không click/điền/focus
export function isUserOnly(element: Element, policy: SafetyPolicy): boolean {
  const bySelector = policy.userOnlySelectors.some((selector) => {
    try {
      return element.closest(selector) !== null;
    } catch {
      return false; // selector sai cú pháp thì bỏ qua, không làm vỡ tour
    }
  });
  if (bySelector) return true;
  // Nút gửi form: không biết form làm gì nên coi là nhạy cảm (chỉ tô sáng, người dùng tự bấm)
  if (element.closest('button[type=submit], input[type=submit]')?.closest('form')) return true;
  return matchesUserOnlyText(element, policy.userOnlyText ?? []);
}

// Chữ/nhãn của phần tử tương tác chứa một từ khóa nhạy cảm
export function matchesUserOnlyText(element: Element, keywords: readonly string[]): boolean {
  if (!keywords.length) return false;
  const target = element.closest('button, a, input, [role=button], [role=menuitem], [role=link]') ?? element;
  const raw = [target.getAttribute('aria-label'), target.getAttribute('value'), (target as HTMLElement).innerText ?? target.textContent].join(' ');
  const text = ` ${normalizeVi(raw.slice(0, 200))} `;
  return keywords.some((k) => {
    const key = normalizeVi(k);
    return key.length > 0 && text.includes(` ${key} `);
  });
}

export function isBlockedRoute(route: string, policy: SafetyPolicy): boolean {
  const path = route.split('?')[0].split('#')[0];
  return policy.blockedRoutes.some((blocked) => path === blocked || path.startsWith(blocked + '/'));
}
