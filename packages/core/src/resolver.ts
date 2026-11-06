// TargetResolver: tìm phần tử theo tourId, thử lần lượt các chiến lược (plan mục 5.3).
// Ở mức A, data-tour-id là nguồn chính; các chiến lược sau chỉ là lưới an toàn.

import type { Layout, Locator, TourStep } from '@wealthcompass/contracts';
import { DEFAULT_BUSY_SELECTOR, isVisible } from './locator-filters';
import { findByLocator } from './locator';

export type MatchedBy = 'tour-id' | 'testid' | 'id' | 'aria-label';

export interface ResolvedTarget {
  element: HTMLElement;
  matchedBy: MatchedBy;
}

function firstVisible(root: ParentNode, selector: string): HTMLElement | null {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(selector));
  return nodes.find(isVisible) ?? null;
}

export function resolveTarget(tourId: string, root: ParentNode = document): ResolvedTarget | null {
  const escaped = CSS.escape(tourId);
  const attempts: Array<[MatchedBy, string]> = [
    ['tour-id', `[data-tour-id="${escaped}"]`],
    ['testid', `[data-testid="${escaped}"]`],
    ['id', `#${escaped}`],
    ['aria-label', `[aria-label="${escaped}"]`],
  ];
  for (const [matchedBy, selector] of attempts) {
    const element = firstVisible(root, selector);
    if (element) return { element, matchedBy };
  }
  return null;
}

// Kết quả tìm phần tử cho một bước tour: theo tourId (ghim, luôn chắc chắn) hoặc theo locator (có điểm)
export interface StepResolution {
  element: HTMLElement;
  matchedBy: string;
  confident: boolean;
  score?: number;
}

export function resolveStep(
  step: { tourId?: string; locator?: Locator },
  root: ParentNode = document,
): StepResolution | null {
  if (step.tourId) {
    const pinned = resolveTarget(step.tourId, root);
    if (pinned) return { element: pinned.element, matchedBy: pinned.matchedBy, confident: true };
  }
  if (step.locator) {
    const found = findByLocator(step.locator, root);
    if (found) return { element: found.element, matchedBy: `locator:${found.matchedBy.join('+')}`, confident: found.confident, score: found.score };
  }
  return null;
}

// Chờ tới khi `probe` trả kết quả đạt `done` bằng MutationObserver thay vì setTimeout cố định:
// @if async và change detection có thể chưa kịp render khi route vừa đổi. Hết giờ thì trả kết quả cuối (có thể chưa đạt).
export function waitFor<T>(
  probe: () => T | null,
  timeoutMs = 4000,
  root: ParentNode = document,
  done: (value: T) => boolean = () => true,
): Promise<T | null> {
  const immediate = probe();
  if (immediate && done(immediate)) return Promise.resolve(immediate);

  return new Promise((resolve) => {
    const observeRoot = ((root as Document).documentElement ?? root) as Node;
    let pending = false;
    const finish = (value: T | null) => {
      observer.disconnect();
      clearTimeout(timer);
      resolve(value);
    };
    const observer = new MutationObserver(() => {
      // Gộp nhiều thay đổi DOM liên tiếp vào một lần chấm điểm
      if (pending) return;
      pending = true;
      queueMicrotask(() => {
        pending = false;
        const found = probe();
        if (found && done(found)) finish(found);
      });
    });
    const timer = setTimeout(() => finish(probe()), timeoutMs);
    observer.observe(observeRoot, { childList: true, subtree: true, attributes: true });
  });
}

export function waitForTarget(tourId: string, timeoutMs = 4000, root: ParentNode = document): Promise<ResolvedTarget | null> {
  return waitFor(() => resolveTarget(tourId, root), timeoutMs, root);
}

// Chờ phần tử của bước; với locator thì chờ tới khi chắc chắn, hết giờ trả kết quả "không chắc" nếu có
export function waitForStep(
  step: { tourId?: string; locator?: Locator },
  timeoutMs = 4000,
  root: ParentNode = document,
): Promise<StepResolution | null> {
  return waitFor(() => resolveStep(step, root), timeoutMs, root, (r) => r.confident);
}

// Route của bước có thể chứa tham số (/orders/:id): khớp mọi đoạn khác rỗng ở vị trí đó
export function routeMatches(pattern: string, path: string): boolean {
  const a = pattern.split('/').filter(Boolean);
  const b = path.split(/[?#]/)[0].split('/').filter(Boolean);
  return a.length === b.length && a.every((seg, i) => seg.startsWith(':') ? b[i].length > 0 : seg === b[i]);
}

// Người dùng đã ở giữa luồng (vd. đang ở màn hình đích của tour): bắt đầu từ bước đầu tiên nằm trên màn hình hiện tại
// thay vì quay về màn hình xuất phát. Đang ở màn hình xuất phát hoặc không bước nào thuộc màn hình này thì từ bước đầu.
export function resumeStep(tour: { startRoute: string; steps: Array<{ route?: string }> }, path: string): number {
  if (routeMatches(tour.startRoute, path)) return 0;
  const index = tour.steps.findIndex((s, i) => i > 0 && s.route !== undefined && routeMatches(s.route, path));
  return index === -1 ? 0 : index;
}

// ---------------------------------------------------------------------------
// Bố cục, bước điều kiện, chờ tải
// ---------------------------------------------------------------------------

// Cùng quy tắc với lúc ghi (locator.layout): hẹp hơn breakpoint là mobile
export function currentLayout(mobileBreakpoint = 768, width = typeof window === 'undefined' ? 1280 : window.innerWidth): Layout {
  return width < mobileBreakpoint ? 'mobile' : 'desktop';
}

// Bước cho bố cục hiện tại: bản ghi riêng cho bố cục đó nếu có, không thì bản chính
export function stepsForLayout<S>(tour: { steps: S[]; variants?: Partial<Record<Layout, S[]>> }, layout: Layout): S[] {
  return tour.variants?.[layout] ?? tour.steps;
}

// Bước mở chỗ chứa bước sau (nút menu mobile): bỏ qua khi phần tử của bước sau đã hiện chắc chắn
export function shouldSkipStep(steps: Array<Pick<TourStep, 'tourId' | 'locator' | 'skipIfNextVisible'>>, index: number, root: ParentNode = document): boolean {
  const next = steps[index + 1];
  if (!steps[index]?.skipIfNextVisible || !next) return false;
  return resolveStep(next, root)?.confident === true;
}

function busy(selector: string, root: ParentNode): boolean {
  try {
    return Array.from(root.querySelectorAll(selector)).some(isVisible);
  } catch {
    return false;
  }
}

// Chờ spinner/khung "đang tải" biến mất (hết giờ thì đi tiếp: không để tour kẹt vì spinner không tắt)
export async function waitForIdle(selector = DEFAULT_BUSY_SELECTOR, timeoutMs = 5000, root: ParentNode = document): Promise<boolean> {
  const idle = await waitFor(() => (busy(selector, root) ? null : true), timeoutMs, root);
  return idle === true;
}

// Chờ app tự chuyển tới màn hình của bước (lần bấm ở bước trước thường đổi route, router xử lý bất đồng bộ)
export async function waitForRoute(pattern: string, currentPath: () => string, timeoutMs = 1500, root: ParentNode = document): Promise<boolean> {
  const ok = await waitFor(() => (routeMatches(pattern, currentPath()) ? true : null), timeoutMs, root);
  return ok === true;
}
