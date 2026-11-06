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
  for (const icon of Array.from(element.querySelectorAll(ICON_SELECTOR))) {
    const word = (icon.textContent ?? '').trim();
    if (word && /^[a-z0-9_]+$/.test(word)) out = out.replace(` ${word} `, ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}
