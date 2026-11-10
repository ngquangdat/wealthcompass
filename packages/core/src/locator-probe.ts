// Thử một bước tour trong trang thật cho `tour:verify` (chạy TRONG trình duyệt, đóng gói cùng capture.bundle.ts).
// Dùng đúng resolveStep/findByLocator của widget, nên kết quả khớp với những gì người dùng sẽ thấy.
// Không bao giờ click: phía Node quyết định có bấm hay không (và không bao giờ bấm phần tử nhạy cảm).
import type { Locator, TourStep } from '@wealthcompass/contracts';
import { captureLocator } from './locator-capture';
import { healLocator, locatorDrift } from './locator-heal';
import { resolveStep, shouldSkipStep, waitForIdle, waitForStep } from './resolver';
import { buildSafetyPolicy, isUserOnly } from './safety';

export interface ProbeOptions {
  mobileBreakpoint?: number;
  busySelector?: string;
  userOnly?: string[];
  timeoutMs?: number;
}

export interface ProbeResult {
  status: 'ok' | 'low_confidence' | 'missing' | 'skipped';
  matchedBy?: string;
  score?: number;
  // Phần tử nhạy cảm theo SafetyPolicy hiện tại: không được bấm, sửa locator cần người duyệt
  userOnly?: boolean;
  // Manh mối đã đổi (khi tìm chắc nhưng locator lưu không còn khớp hoàn toàn); 'tourId' khi ghim không còn tìm thấy
  drift?: string[];
  // Locator ghi lại từ phần tử tìm được (chỉ khi có drift)
  proposed?: Locator;
}

type ProbeStep = Pick<TourStep, 'tourId' | 'locator' | 'skipIfNextVisible'>;

const PIN = new Set(['tour-id', 'testid', 'id', 'aria-label']);

export async function probeStep(steps: ProbeStep[], index: number, options: ProbeOptions = {}): Promise<ProbeResult> {
  const w = window as unknown as { __compassFound?: Element | null };
  w.__compassFound = null;
  const step = steps[index];
  await waitForIdle(options.busySelector, 5000);
  if (shouldSkipStep(steps, index)) return { status: 'skipped' };
  const found = (await waitForStep(step, options.timeoutMs ?? 4000)) ?? resolveStep(step);
  if (!found) return { status: 'missing' };
  w.__compassFound = found.element;
  const userOnly = isUserOnly(found.element, buildSafetyPolicy({ userOnlySelectors: options.userOnly ?? [] }));
  const base = { matchedBy: found.matchedBy, ...(found.score !== undefined ? { score: found.score } : {}), userOnly };
  if (!found.confident) return { status: 'low_confidence', ...base };

  const drift: string[] = [];
  if (step.tourId && !PIN.has(found.matchedBy)) drift.push('tourId');
  let proposed: Locator | undefined;
  if (step.locator) {
    const fresh = captureLocator(found.element, { mobileBreakpoint: options.mobileBreakpoint });
    drift.push(...locatorDrift(step.locator, fresh));
    if (drift.length) proposed = healLocator(step.locator, fresh);
  }
  return { status: 'ok', ...base, ...(drift.length ? { drift } : {}), ...(proposed ? { proposed } : {}) };
}
