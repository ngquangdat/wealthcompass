// Lọc dữ liệu cá nhân trước khi gửi cho LLM và trước khi ghi log.
// Chỉ che những mẫu chắc chắn là PII; thà bỏ sót còn hơn che nhầm mã trái phiếu.

interface PiiRule {
  name: string;
  pattern: RegExp;
  replacement: string;
}

const RULES: PiiRule[] = [
  // Email
  { name: 'email', pattern: /[\w.+-]+@[\w-]+(\.[\w-]+)+/g, replacement: '[email]' },
  // Số điện thoại VN: 0xxxxxxxxx hoặc +84xxxxxxxxx
  { name: 'phone-vn', pattern: /(?<!\d)(?:\+84|0)(?:\s?\d){9}(?!\d)/g, replacement: '[sdt]' },
  // CCCD 12 số, CMND 9 số
  { name: 'national-id-vn', pattern: /(?<!\d)(?:\d{12}|\d{9})(?!\d)/g, replacement: '[so-giay-to]' },
  // Số tài khoản TCBS dạng 105C123456
  { name: 'custody-id', pattern: /\b\d{3}[A-Z]\d{6}\b/g, replacement: '[so-tai-khoan]' },
];

export interface PiiResult {
  text: string;
  redacted: string[];
}

export function redactPii(input: string): PiiResult {
  const redacted: string[] = [];
  let text = input;
  for (const rule of RULES) {
    text = text.replace(rule.pattern, () => {
      redacted.push(rule.name);
      return rule.replacement;
    });
  }
  return { text, redacted };
}
