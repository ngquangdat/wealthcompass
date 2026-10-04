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

// Mốc tour của một mục menu: "menu-" + route (bỏ dấu "/" đầu, query, ký tự lạ). Widget (TourMenuDirective)
// và trình quét dùng chung hàm này để id hai phía luôn khớp. Route gốc "/" thành menu-home.
export function menuTourId(route: string | readonly unknown[] | null | undefined): string {
  const path = Array.isArray(route) ? route.join('/') : String(route ?? '');
  const slug = normalizeVi(path.split(/[?#]/)[0].replace(/[/_.]+/g, ' ')).replace(/ /g, '-').slice(0, 55).replace(/-+$/, '');
  return `menu-${slug || 'home'}`;
}
