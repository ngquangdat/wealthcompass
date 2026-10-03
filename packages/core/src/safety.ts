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
}

export function buildSafetyPolicy(extra?: Partial<SafetyPolicy>): SafetyPolicy {
  return {
    userOnlySelectors: [...BASE_USER_ONLY_SELECTORS, ...(extra?.userOnlySelectors ?? [])],
    blockedRoutes: [...(extra?.blockedRoutes ?? [])],
  };
}

// Phần tử (hoặc tổ tiên) khớp selector user-only => engine chỉ được highlight, không click/điền/focus
export function isUserOnly(element: Element, policy: SafetyPolicy): boolean {
  return policy.userOnlySelectors.some((selector) => {
    try {
      return element.closest(selector) !== null;
    } catch {
      return false; // selector sai cú pháp thì bỏ qua, không làm vỡ tour
    }
  });
}

export function isBlockedRoute(route: string, policy: SafetyPolicy): boolean {
  const path = route.split('?')[0].split('#')[0];
  return policy.blockedRoutes.some((blocked) => path === blocked || path.startsWith(blocked + '/'));
}
