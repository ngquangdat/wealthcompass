// Dịch khóa i18n của web (ngx-translate, transloco...) sang chữ người dùng thấy, trước khi dùng làm tiêu đề, nhãn
// menu, chữ trên màn hình. Route khai `data: { title: 'guest.t2' }` thì Feature Map, mô tả LLM soạn và tìm kiếm đều
// dựa vào chuỗi khóa vô nghĩa nếu không dịch.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Translator {
  // File dịch đã đọc (đường dẫn tương đối với thư mục source); null khi không có
  file: string | null;
  // Số khóa đã đọc
  size: number;
  // Chuỗi đúng bằng một khóa có trong file dịch thì trả bản dịch; không thì trả nguyên chuỗi
  text(value: string): string;
  // Chuỗi là khóa (có dạng a.b.c) nhưng không có trong file dịch
  missing(value: string): boolean;
}

// Dạng của khóa: các đoạn chữ/số/gạch nối/gạch dưới nối bằng dấu chấm (guest.t2, appconfig.customer.renewDebtFull)
const KEY_SHAPE = /^[A-Za-z_][\w-]*(\.[\w-]+)+$/;

// ngx-translate và transloco lưu file lồng nhau ({ guest: { t2: "..." } }): trải thành khóa có dấu chấm.
// File phẳng ({ "guest.t2": "..." }) giữ nguyên.
function flatten(value: unknown, prefix: string, out: Map<string, string>): void {
  if (typeof value === 'string') {
    if (prefix) out.set(prefix, value);
    return;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
}

// Bỏ tham số nội suy ({{name}}, {name}) và thẻ HTML trong bản dịch: chỉ giữ chữ
function clean(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{\{[^}]*\}\}|\{[\w.]+\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Chỗ thường đặt file dịch của web Angular, theo ngôn ngữ của Feature Map
export function i18nCandidates(locale: string): string[] {
  const langs = [...new Set([locale, locale.split('-')[0], `${locale.split('-')[0]}-VN`])];
  const dirs = ['src/assets/i18n', 'src/assets/locale', 'src/assets/locales', 'src/assets/lang', 'public/i18n', 'public/assets/i18n', 'src/i18n'];
  return dirs.flatMap((d) => langs.map((l) => `${d}/${l}.json`));
}

export function loadTranslator(sourceRoot: string, locale: string, configured?: string, warnings: string[] = []): Translator {
  const file = configured ?? i18nCandidates(locale).find((f) => existsSync(join(sourceRoot, f))) ?? null;
  const dict = new Map<string, string>();
  if (file) {
    try {
      flatten(JSON.parse(readFileSync(join(sourceRoot, file), 'utf8')), '', dict);
    } catch (e) {
      warnings.push(`Không đọc được file dịch ${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const lookup = (value: string): string | undefined => {
    const key = value.trim();
    const hit = dict.get(key);
    return hit !== undefined ? clean(hit) || undefined : undefined;
  };
  return {
    file: file && dict.size ? file : null,
    size: dict.size,
    text: (value) => lookup(value) ?? value,
    missing: (value) => KEY_SHAPE.test(value.trim()) && lookup(value) === undefined,
  };
}
