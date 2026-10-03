// Chuẩn hóa tiếng Việt để so khớp: bỏ dấu, hạ chữ thường, gộp khoảng trắng.
// Người dùng hay gõ không dấu ("ban trai phieu") nên cả index lẫn câu hỏi đều đi qua hàm này.
export function normalizeVi(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(input: string): string[] {
  const normalized = normalizeVi(input);
  return normalized ? normalized.split(' ') : [];
}

// Escape HTML rồi mới đổi **đậm** và xuống dòng: an toàn để gán innerHTML vì không thể chèn thẻ từ nội dung
export function renderLiteMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}
