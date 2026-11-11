// TargetResolver: tìm phần tử theo tourId, thử lần lượt các chiến lược (plan mục 5.3).
// Ở mức A, data-tour-id là nguồn chính; các chiến lược sau chỉ là lưới an toàn.

import type { Layout, Locator, TourStep } from '@wealthcompass/contracts';
import { DEFAULT_BUSY_SELECTOR, isVisible, layoutOfWidth } from './locator-filters';
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

// Khoảng cách tối thiểu giữa hai lần dò khi DOM đổi liên tục (bảng giá cập nhật realtime đổi DOM hàng trăm lần mỗi
// giây; dò sau từng lần đổi làm nghẽn luồng chính nên tour hiện chậm)
const PROBE_INTERVAL_MS = 60;

// Chờ tới khi `probe` trả kết quả đạt `done` bằng MutationObserver thay vì setTimeout cố định:
// @if async và change detection có thể chưa kịp render khi route vừa đổi. Hết giờ thì trả kết quả cuối (có thể chưa đạt).
// `pollMs`: dò thêm theo nhịp (điều kiện phụ thuộc thời gian, vd. phần tử đứng yên đủ lâu, không cần DOM đổi).
export function waitFor<T>(
  probe: () => T | null,
  timeoutMs = 4000,
  root: ParentNode = document,
  done: (value: T) => boolean = () => true,
  pollMs = 0,
): Promise<T | null> {
  const immediate = probe();
  if (immediate && done(immediate)) return Promise.resolve(immediate);

  return new Promise((resolve) => {
    const observeRoot = ((root as Document).documentElement ?? root) as Node;
    let scheduled: ReturnType<typeof setTimeout> | null = null;
    let last = Date.now();
    let finished = false;
    const finish = (value: T | null) => {
      if (finished) return;
      finished = true;
      observer.disconnect();
      clearTimeout(timer);
      if (scheduled) clearTimeout(scheduled);
      if (poll) clearInterval(poll);
      resolve(value);
    };
    const check = () => {
      scheduled = null;
      last = Date.now();
      const found = probe();
      if (found && done(found)) finish(found);
    };
    // Gộp các thay đổi DOM liên tiếp: dò ngay nếu đã lâu chưa dò, không thì dò một lần ở cuối khoảng
    const observer = new MutationObserver(() => {
      if (scheduled || finished) return;
      scheduled = setTimeout(check, Math.max(0, last + PROBE_INTERVAL_MS - Date.now()));
    });
    const timer = setTimeout(() => finish(probe()), timeoutMs);
    const poll = pollMs > 0 ? setInterval(() => !scheduled && check(), pollMs) : null;
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

// Cùng quy tắc với lúc ghi (locator.layout): hẹp hơn mobileBreakpoint là mobile, tới dưới tabletBreakpoint là tablet
export function currentLayout(mobileBreakpoint = 768, width = typeof window === 'undefined' ? 1280 : window.innerWidth, tabletBreakpoint = 1024): Layout {
  return layoutOfWidth(width, mobileBreakpoint, tabletBreakpoint);
}

// Thiếu bản cho bố cục hiện tại thì dùng bản gần nhất: máy tính bảng thường giống desktop hơn (menu ngang, bảng),
// điện thoại không có bản riêng thì dùng bản chính
const LAYOUT_FALLBACK: Record<Layout, Layout[]> = { desktop: ['desktop', 'tablet'], tablet: ['tablet', 'desktop'], mobile: ['mobile'] };

type LayoutTour<S> = { steps: S[]; layout?: Layout; variants?: Partial<Record<Layout, S[]>> };

// Bản tour (theo bố cục) dùng cho bố cục hiện tại: bản của chính bố cục đó (bản chính hoặc bản thêm), không có thì
// bản gần nhất, cuối cùng là bản chính. Bản chính không ghi bố cục (tour cũ) được coi là desktop.
export function layoutUsed<S>(tour: LayoutTour<S>, layout: Layout): Layout {
  const main = tour.layout ?? 'desktop';
  return LAYOUT_FALLBACK[layout].find((l) => l === main || tour.variants?.[l]) ?? main;
}

export function stepsForLayout<S>(tour: LayoutTour<S>, layout: Layout): S[] {
  const used = layoutUsed(tour, layout);
  return (used !== (tour.layout ?? 'desktop') && tour.variants?.[used]) || tour.steps;
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

// Vùng "component" chứa phần tử: thẻ Angular gần nhất (có dấu gạch nối) không phải khung của cả trang
function componentHost(element: Element): Element | null {
  const vw = window.innerWidth || 1;
  const vh = window.innerHeight || 1;
  for (let el = element.parentElement; el && el !== document.body; el = el.parentElement) {
    if (!el.tagName.includes('-') || el.tagName === 'APP-ROOT') continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height >= vw * vh * 0.8) return null;
    return el;
  }
  return null;
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

// Phần tử của bước còn đang tải: nằm trong vùng aria-busy, hoặc có chỉ báo "đang tải" che lên nó, nằm trong cùng
// component với nó, hay trải rộng cả trang (thanh tải trên đầu trang, lớp phủ tải). Spinner nhỏ ở chỗ khác không tính.
export function isLoadingAround(element: Element, selector = DEFAULT_BUSY_SELECTOR, root: ParentNode = document): boolean {
  if (element.closest('[aria-busy="true"]')) return true;
  let indicators: Element[];
  try {
    indicators = Array.from(root.querySelectorAll(selector)).filter(isVisible);
  } catch {
    return false;
  }
  if (!indicators.length) return false;
  const rect = element.getBoundingClientRect();
  const host = componentHost(element);
  const vw = window.innerWidth || 1;
  return indicators.some((ind) => {
    if (ind === element || ind.contains(element)) return true;
    if (host && host.contains(ind)) return true;
    const r = ind.getBoundingClientRect();
    return r.width >= vw * 0.5 || overlaps(r, rect);
  });
}

export interface ReadyOptions {
  timeoutMs?: number;
  busySelector?: string;
  // Phần tử phải đứng yên (vị trí, cỡ không đổi) chừng này ms: component đã dựng xong, không còn nhảy bố cục
  stableMs?: number;
}

// Chờ phần tử của bước SẴN SÀNG rồi mới chỉ dẫn: tìm thấy chắc chắn, không còn đang tải quanh nó, và đã đứng yên.
// Hết giờ: trả phần tử chắc chắn dù chưa đứng yên/còn tải (không để tour kẹt), không có thì trả kết quả tốt nhất đã thấy.
export async function waitForReady(
  step: { tourId?: string; locator?: Locator },
  options: ReadyOptions = {},
  root: ParentNode = document,
): Promise<StepResolution | null> {
  const { timeoutMs = 8000, busySelector = DEFAULT_BUSY_SELECTOR, stableMs = 150 } = options;
  let seen: { element: Element; box: string; since: number } | null = null;
  let best: StepResolution | null = null;
  const ready = (r: StepResolution): boolean => {
    if (!r.confident || isLoadingAround(r.element, busySelector, root)) {
      seen = null;
      return false;
    }
    const b = r.element.getBoundingClientRect();
    const box = `${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.width)},${Math.round(b.height)}`;
    const now = Date.now();
    if (!seen || seen.element !== r.element || seen.box !== box) {
      seen = { element: r.element, box, since: now };
      return stableMs <= 0;
    }
    return now - seen.since >= stableMs;
  };
  const result = await waitFor(
    () => {
      const r = resolveStep(step, root);
      if (r && (!best || r.confident || !best.confident)) best = r;
      return r;
    },
    timeoutMs,
    root,
    ready,
    Math.max(40, Math.min(100, stableMs / 2)),
  );
  return result?.confident ? result : best;
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
