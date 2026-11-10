// Quy tắc chung cho locator (dùng cả lúc ghi lẫn lúc chạy): giá trị nào đủ ổn định để làm manh mối.
// Angular và các thư viện UI sinh id/class theo lần build hoặc lần render (_ngcontent-abc, mat-mdc-form-field-3,
// cdk-overlay-12): dùng chúng thì tour hỏng ngay lần deploy sau.

const UNSTABLE_PREFIX = /^(_ng|ng-tns|ng-star|ng-trigger|ng-animat|ng-untouched|ng-touched|ng-pristine|ng-dirty|ng-valid|ng-invalid|ng-pending|mat-mdc-|mdc-|cdk-|mat-ripple|ng-reflect)/i;

// Id/class ổn định: không có tiền tố sinh tự động, không chứa chuỗi số dài, không giống mã băm
export function isStableToken(value: string): boolean {
  if (!value || value.length > 60) return false;
  if (UNSTABLE_PREFIX.test(value)) return false;
  if (/\d{3,}/.test(value)) return false;
  // Kiểu css-modules / styled: chữ + gạch + chuỗi lẫn số và chữ (css-1x2y3z, sc-AxjAm)
  if (/[-_][a-z0-9]{5,}$/i.test(value) && /\d/.test(value.split(/[-_]/).pop() ?? '')) return false;
  // Id kiểu uuid hoặc chuỗi dài lẫn số
  if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(value)) return false;
  // Id kết thúc bằng số thứ tự (input-2, tab-label-0-1): đổi theo thứ tự render
  if (/[-_]\d+([-_]\d+)*$/.test(value)) return false;
  return true;
}

// Thuộc tính đáng tin, theo thứ tự ưu tiên. formcontrolname/routerlink là thuộc tính tĩnh Angular để lại trên DOM.
export const LOCATOR_ATTRS = ['data-testid', 'formcontrolname', 'routerlink', 'href', 'name', 'id', 'aria-label', 'placeholder', 'type'] as const;

// Thư viện UI dùng chung: thẻ của chúng không nói gì về màn hình nên không lấy làm "component"
const LIBRARY_TAG = /^(mat|cdk|mdc|ion|p|nz|ngx|kendo|dx|igx|ejs|clr|tui|app-root)(-|$)/i;

export function isAppComponentTag(tag: string): boolean {
  return tag.includes('-') && !LIBRARY_TAG.test(tag) && !tag.startsWith('compass-');
}

// Phần tử người dùng thực sự tương tác (lần bấm thường trúng icon/span bên trong nút)
export const INTERACTIVE_SELECTOR = [
  'a[href]', 'button', 'input', 'select', 'textarea', 'summary', 'label',
  '[role=button]', '[role=link]', '[role=tab]', '[role=menuitem]', '[role=option]', '[role=checkbox]',
  '[role=radio]', '[role=switch]', '[role=combobox]', '[role=treeitem]', '[tabindex]:not([tabindex="-1"])',
].join(',');

export const DIALOG_SELECTOR = '[role=dialog],[role=alertdialog],dialog,mat-dialog-container,.cdk-overlay-pane';
export const LANDMARK_SELECTOR = 'nav,main,header,footer,aside,[role=navigation],[role=main],[role=banner],[role=contentinfo],[role=complementary],[role=search]';
export const HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6,[role=heading]';

export function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = getComputedStyle(element);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

// Chuỗi đa số là số (số dư, khối lượng, số tài khoản): không bao giờ ghi vào locator
export function mostlyDigits(text: string): boolean {
  const compact = text.replace(/\s/g, '');
  if (!compact) return false;
  const digits = compact.replace(/[^\d]/g, '').length;
  return digits / compact.length > 0.4;
}

export function cleanText(text: string | null | undefined, max = 60): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Icon font dùng chữ ligature ("handshake", "pie_chart") nên tên truy cập của nút có icon bị lẫn tên icon.
// Bỏ chữ của icon con khỏi tên/chữ để locator không hỏng khi đổi icon và không lộ tên kỹ thuật cho người dùng.
const ICON_SELECTOR = 'mat-icon, .material-icons, .material-icons-outlined, .material-icons-round, .material-symbols-outlined, .material-symbols-rounded, .material-symbols-sharp, [class*="icon-"], i[class]';

export function stripIconText(element: Element, text: string): string {
  let out = ` ${text} `;
  // Thêm thẻ icon riêng của app (tcbs-icon, app-menu-icon...): tên thẻ kết thúc bằng "-icon"
  const icons = new Set([...Array.from(element.querySelectorAll(ICON_SELECTOR)), ...Array.from(element.querySelectorAll('*')).filter((e) => /-icon$/i.test(e.tagName))]);
  for (const icon of icons) {
    const word = (icon.textContent ?? '').trim();
    if (word && /^[a-z0-9_]+$/.test(word)) out = out.replace(` ${word} `, ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Danh sách lặp (bảng, @for, virtual scroll): cùng một nút lặp lại trên mỗi dòng
// ---------------------------------------------------------------------------

const ROW_SELECTOR = 'tr,[role=row],mat-row,cdk-row,mat-list-item,[role=listitem],[role=option],[role=article],li';
const STATE_CLASS = /^(ng-|mat-|cdk-|mdc-|active|selected|focus|hover|disabled|odd|even|first|last|expanded|collapsed)/;

// Hình dạng của một dòng: thẻ + class ổn định (không có trạng thái như active/selected)
export function rowSignature(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const classes = Array.from(element.classList)
    .filter((c) => isStableToken(c) && !STATE_CLASS.test(c))
    .sort()
    .slice(0, 3);
  return [tag, ...classes.map((c) => CSS.escape(c))].join('.');
}

// Phần tử có ít nhất một anh em cùng hình dạng (dòng thứ hai của danh sách)
function isRepeated(element: Element): boolean {
  const parent = element.parentElement;
  if (!parent || element === document.body || element === document.documentElement) return false;
  const signature = rowSignature(element);
  return Array.from(parent.children).some((c) => c !== element && rowSignature(c) === signature);
}

// Thứ tự của dòng trong các anh em cùng hình dạng (bỏ qua tiêu đề, dòng ngăn cách chen giữa)
export function rowIndex(row: Element): number {
  const signature = rowSignature(row);
  return Array.from(row.parentElement?.children ?? []).filter((c) => rowSignature(c) === signature).indexOf(row);
}

// Dòng chứa phần tử: thẻ dòng quen thuộc (tr, [role=row], mat-row...) hoặc tổ tiên gần nhất (≤6 cấp) lặp lại
// cùng hình dạng với anh em của nó (thẻ card trong @for). Bản thân phần tử không tính là dòng.
export function rowOf(element: Element): Element | null {
  const explicit = element.parentElement?.closest(ROW_SELECTOR);
  if (explicit && isRepeated(explicit)) return explicit;
  let scope = element.parentElement;
  for (let depth = 0; scope && depth < 6; depth++, scope = scope.parentElement) {
    if (scope === document.body) break;
    if (isRepeated(scope)) return scope;
  }
  return null;
}

// Cột của ô chứa phần tử: tên cột Angular Material (mat-column-ten) hoặc chữ tiêu đề cột của bảng HTML
export function columnOf(element: Element): string | undefined {
  const cell = element.closest('td,th,[role=cell],[role=gridcell],mat-cell,cdk-cell');
  if (!cell) return undefined;
  const named = Array.from(cell.classList).find((c) => /^(mat|cdk)-column-/.test(c));
  if (named) return named.replace(/^(mat|cdk)-column-/, '');
  if (cell.tagName === 'TD' || cell.tagName === 'TH') {
    const table = cell.closest('table');
    const headerRow = table?.tHead?.rows[0] ?? (table?.rows[0]?.querySelector('th') ? table.rows[0] : undefined);
    const header = headerRow?.cells[(cell as HTMLTableCellElement).cellIndex];
    const text = cleanText(header?.textContent, 40);
    if (header && header !== cell && text && !mostlyDigits(text)) return text;
  }
  return undefined;
}

// Phần tử "đang tải" mặc định; app có spinner riêng thì khai báo tours.busySelector
export const DEFAULT_BUSY_SELECTOR = '[aria-busy="true"],mat-spinner,mat-progress-spinner,.compass-busy';
