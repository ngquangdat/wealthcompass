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

// Không có danh sách "chữ trên nút nhạy cảm": đoán theo chữ chặn nhầm cả mục menu (vd. "Đặt lệnh cổ phiếu"). Nút nào chỉ
// nên tô sáng thì người ghi tour tự bật "Tô sáng (không bấm)" lúc ghi, hoặc dev đánh dấu trong source
// (tourRole="user-only", data-sensitive).

export function buildSafetyPolicy(extra?: Partial<SafetyPolicy>): SafetyPolicy {
  return {
    userOnlySelectors: [...BASE_USER_ONLY_SELECTORS, ...(extra?.userOnlySelectors ?? [])],
    blockedRoutes: [...(extra?.blockedRoutes ?? [])],
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
  return element.closest('button[type=submit], input[type=submit]')?.closest('form') != null;
}

export function isBlockedRoute(route: string, policy: SafetyPolicy): boolean {
  const path = route.split('?')[0].split('#')[0];
  return policy.blockedRoutes.some((blocked) => path === blocked || path.startsWith(blocked + '/'));
}
