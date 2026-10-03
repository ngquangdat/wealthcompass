// TargetResolver: tìm phần tử theo tourId, thử lần lượt các chiến lược (plan mục 5.3).
// Ở mức A, data-tour-id là nguồn chính; các chiến lược sau chỉ là lưới an toàn.

export type MatchedBy = 'tour-id' | 'testid' | 'id' | 'aria-label';

export interface ResolvedTarget {
  element: HTMLElement;
  matchedBy: MatchedBy;
}

function visible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = getComputedStyle(element);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

function firstVisible(root: ParentNode, selector: string): HTMLElement | null {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(selector));
  return nodes.find(visible) ?? null;
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

// Chờ phần tử xuất hiện bằng MutationObserver thay vì setTimeout cố định:
// @if async và change detection có thể chưa kịp render khi route vừa đổi.
export function waitForTarget(
  tourId: string,
  timeoutMs = 4000,
  root: ParentNode = document,
): Promise<ResolvedTarget | null> {
  const immediate = resolveTarget(tourId, root);
  if (immediate) return Promise.resolve(immediate);

  return new Promise((resolve) => {
    const observeRoot = root instanceof Document ? root.documentElement : (root as Node);
    const finish = (value: ResolvedTarget | null) => {
      observer.disconnect();
      clearTimeout(timer);
      resolve(value);
    };
    const observer = new MutationObserver(() => {
      const found = resolveTarget(tourId, root);
      if (found) finish(found);
    });
    const timer = setTimeout(() => finish(resolveTarget(tourId, root)), timeoutMs);
    observer.observe(observeRoot, { childList: true, subtree: true, attributes: true });
  });
}
