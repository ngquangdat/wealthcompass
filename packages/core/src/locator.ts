// Tìm lại phần tử từ locator lúc chạy tour: gom ứng viên, chấm điểm từng manh mối, chỉ nhận khi
// người thắng vượt rõ người về nhì. Không chắc thì báo "không chắc" để widget hiện bước dạng popover
// không gắn phần tử, thay vì tô sáng nhầm (nhầm ở màn hình giao dịch nguy hiểm hơn là không tô).
import { computeAccessibleName, getRole } from 'dom-accessibility-api';
import type { Locator } from '@wealthcompass/contracts';
import { normalizeVi } from './text';
import { DIALOG_SELECTOR, HEADING_SELECTOR, LANDMARK_SELECTOR, cleanText, columnOf, isVisible, rowIndex, stripIconText } from './locator-filters';

export interface LocatorMatch {
  element: HTMLElement;
  score: number;
  // Điểm của ứng viên đứng thứ hai (0 nếu chỉ có một)
  runnerUp: number;
  // Manh mối đã khớp, để telemetry biết tour đang dựa vào đâu
  matchedBy: string[];
  // Đủ điểm và cách biệt: được phép tô sáng
  confident: boolean;
}

// Trọng số và ngưỡng: chỉnh ở đây, test trong locator.test.ts
export const LOCATOR_WEIGHTS = {
  roleName: 5,
  nameOnly: 3,
  namePartial: 1.5,
  strongAttr: 4, // data-testid, formcontrolname, routerlink, id, name
  href: 3,
  weakAttr: 1, // aria-label, placeholder, type
  strongAttrConflict: -2,
  text: 3,
  textPartial: 1.5,
  tag: 0.5,
  component: 2,
  dialog: 2,
  dialogMissing: -2,
  heading: 1.5,
  landmark: 1,
  css: 1.5,
  rect: 1,
  listRow: 1,
  column: 1.5,
} as const;
export const ACCEPT_SCORE = 6;
export const ACCEPT_MARGIN = 2;
// Dưới mức này coi như không có ứng viên
const MIN_SCORE = 3;
const MAX_CANDIDATES = 1500;

const STRONG_ATTRS = new Set(['data-testid', 'formcontrolname', 'routerlink', 'id', 'name']);

function norm(text: string | null | undefined): string {
  return normalizeVi(cleanText(text, 120));
}

function nameOf(element: Element): string {
  try {
    return computeAccessibleName(element);
  } catch {
    return '';
  }
}

function safeQuery(root: ParentNode, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function candidatesFor(locator: Locator, root: ParentNode): Element[] {
  const set = new Set<Element>();
  const add = (list: Element[]) => list.forEach((e) => set.size < MAX_CANDIDATES && set.add(e));
  add(safeQuery(root, locator.tag));
  if (locator.role) add(safeQuery(root, `[role="${CSS.escape(locator.role)}"]`));
  for (const [name, value] of Object.entries(locator.attrs ?? {})) {
    if (name === 'href') add(safeQuery(root, `a[href$="${CSS.escape(value)}"]`));
    else add(safeQuery(root, `[${name}="${CSS.escape(value)}"]`));
  }
  if (locator.css) add(safeQuery(root, locator.css));
  return [...set];
}

function score(element: Element, locator: Locator): { score: number; matchedBy: string[] } {
  const w = LOCATOR_WEIGHTS;
  let total = 0;
  const matchedBy: string[] = [];
  const hit = (clue: string, points: number) => {
    total += points;
    if (points > 0) matchedBy.push(clue);
  };

  const role = getRole(element) ?? undefined;
  if (locator.name) {
    const want = norm(locator.name);
    const have = norm(stripIconText(element, cleanText(nameOf(element), 200)));
    if (have && have === want) hit('name', !locator.role || locator.role === role ? w.roleName : w.nameOnly);
    else if (have && want.length >= 3 && (have.includes(want) || want.includes(have))) hit('name~', w.namePartial);
  }

  for (const [attr, value] of Object.entries(locator.attrs ?? {})) {
    let actual = element.getAttribute(attr);
    if (attr === 'href' && actual) {
      try {
        actual = new URL(actual, location.href).pathname;
      } catch {
        // giữ nguyên
      }
    }
    const strong = STRONG_ATTRS.has(attr);
    if (actual === value) hit(attr, strong ? w.strongAttr : attr === 'href' ? w.href : w.weakAttr);
    else if (actual && strong) hit(attr, w.strongAttrConflict);
  }

  if (locator.text) {
    const want = norm(locator.text);
    const have = norm(stripIconText(element, cleanText((element as HTMLElement).innerText ?? element.textContent, 200)));
    if (have === want) hit('text', w.text);
    else if (want.length >= 3 && have.length <= want.length * 3 && have.includes(want)) hit('text~', w.textPartial);
  }

  if (element.tagName.toLowerCase() === locator.tag) hit('tag', w.tag);
  if (locator.component && element.closest(locator.component)) hit('component', w.component);

  const ctx = locator.context ?? {};
  if (ctx.dialog) {
    const dialog = element.closest(DIALOG_SELECTOR);
    if (!dialog) hit('dialog', w.dialogMissing);
    else if (ctx.dialog === '(dialog)' || norm(nameOf(dialog) || dialog.querySelector(HEADING_SELECTOR)?.textContent).includes(norm(ctx.dialog))) hit('dialog', w.dialog);
  }
  if (ctx.heading) {
    const want = norm(ctx.heading);
    let scope: Element | null = element.parentElement;
    for (let depth = 0; scope && depth < 6; depth++, scope = scope.parentElement) {
      if (safeQuery(scope, HEADING_SELECTOR).some((h) => norm(h.textContent) === want)) {
        hit('heading', w.heading);
        break;
      }
    }
  }
  if (ctx.landmark) {
    const landmark = element.closest(LANDMARK_SELECTOR);
    if (landmark && (getRole(landmark) ?? landmark.tagName.toLowerCase()) === ctx.landmark) hit('landmark', w.landmark);
  }

  if (locator.list) {
    if (rowFor(element, locator)) hit('list', w.listRow);
    if (locator.list.column && columnOf(element) === locator.list.column) hit('column', w.column);
  }

  if (locator.css) {
    try {
      if (element.matches(locator.css)) hit('css', w.css);
    } catch {
      // selector hỏng: bỏ qua
    }
  }

  if (locator.rect && typeof window !== 'undefined') {
    const r = element.getBoundingClientRect();
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    if (r.width || r.height) {
      const dx = (r.left + r.width / 2) / vw - (locator.rect.x + locator.rect.w / 2);
      const dy = (r.top + r.height / 2) / vh - (locator.rect.y + locator.rect.h / 2);
      const near = Math.max(0, 1 - Math.hypot(dx, dy) * 4);
      if (near > 0) hit('rect', Math.round(w.rect * near * 100) / 100);
    }
  }

  return { score: Math.round(total * 100) / 100, matchedBy };
}

function rowFor(element: Element, locator: Locator): Element | null {
  if (!locator.list) return null;
  try {
    return element.closest(locator.list.row);
  } catch {
    return null;
  }
}

// Hai ứng viên nằm ở hai dòng khác nhau của cùng một danh sách: cùng là "nút Bán của một dòng", không phải đối thủ
function sameList(a: Element, b: Element, locator: Locator): boolean {
  const ra = rowFor(a, locator);
  const rb = rowFor(b, locator);
  return Boolean(ra && rb && ra !== rb && ra.parentElement === rb.parentElement);
}

// Người duyệt ghim dòng (list.rowText): chỉ giữ ứng viên ở dòng chứa chữ đó
function inPinnedRow(element: Element, locator: Locator): boolean {
  const want = locator.list?.rowText;
  if (!want) return true;
  const row = rowFor(element, locator);
  return Boolean(row && normalizeVi(cleanText((row as HTMLElement).innerText ?? row.textContent, 2000)).includes(norm(want)));
}

export function findByLocator(
  locator: Locator,
  root: ParentNode = document,
  visible: (element: Element) => boolean = isVisible,
): LocatorMatch | null {
  const ranked = candidatesFor(locator, root)
    .filter(visible)
    .filter((element) => inPinnedRow(element, locator))
    .map((element) => ({ element, ...score(element, locator) }))
    .sort((a, b) => b.score - a.score);
  // Phần tử con và cha cùng khớp (span trong button): chỉ giữ phần tử điểm cao hơn khi tính người về nhì
  const top = ranked[0];
  if (!top || top.score < MIN_SCORE) return null;
  const best = pickRow(top, ranked, locator);
  // Danh sách: các dòng khác cùng danh sách không phải đối thủ; điểm bằng nhau thì giữ dòng đầu (thứ tự tài liệu)
  const rival = ranked.find(
    (r) => r !== best && !best.element.contains(r.element) && !r.element.contains(best.element) && !sameList(best.element, r.element, locator),
  );
  const runnerUp = rival?.score ?? 0;
  return {
    element: best.element as HTMLElement,
    score: best.score,
    runnerUp,
    matchedBy: best.matchedBy,
    confident: best.score >= ACCEPT_SCORE && best.score - runnerUp >= ACCEPT_MARGIN,
  };
}

// Danh sách có ghi thứ tự dòng (list.index): trong các phần tử "y hệt" ở những dòng khác của cùng danh sách, lấy phần tử
// ở dòng thứ i; danh sách ngắn hơn thì lấy dòng cuối. Các dòng chỉ lệch điểm vì vị trí/selector dự phòng nên cho phép
// lệch tới tổng hai trọng số đó. Dòng đã ghim bằng rowText thì không đổi.
function pickRow<T extends { element: Element; score: number }>(top: T, ranked: T[], locator: Locator): T {
  const index = locator.list?.index;
  if (index === undefined || locator.list?.rowText) return top;
  const slack = LOCATOR_WEIGHTS.rect + LOCATOR_WEIGHTS.css;
  const rows = new Map<number, T>();
  for (const r of ranked) {
    if (r !== top && (!sameList(top.element, r.element, locator) || top.score - r.score > slack)) continue;
    const row = rowFor(r.element, locator);
    if (!row) continue;
    const i = rowIndex(row);
    // Mỗi dòng giữ ứng viên điểm cao nhất (ranked đã xếp giảm dần)
    if (!rows.has(i)) rows.set(i, r);
  }
  if (!rows.size) return top;
  return rows.get(index) ?? rows.get(Math.max(...rows.keys()))!;
}

// Locator có ít nhất một manh mối đủ mạnh để tìm lại (không chỉ dựa vào CSS/vị trí)
export function isUsableLocator(locator: Locator | null | undefined): boolean {
  if (!locator) return false;
  return Boolean(locator.name || locator.text || Object.keys(locator.attrs ?? {}).length);
}

// Mô tả ngắn cho người đọc: button "Bán" · app-bond-sell-panel
export function describeLocator(locator: Locator): string {
  const label = locator.name ?? locator.text ?? locator.attrs?.['formcontrolname'] ?? locator.attrs?.['aria-label'] ?? '';
  return [`${locator.role ?? locator.tag}${label ? ` "${label}"` : ''}`, locator.component].filter(Boolean).join(' · ');
}
