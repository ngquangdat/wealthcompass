import { exists, readText, writeText } from '@wealthcompass/tourdb';

// Đọc/sửa wealthcompass.env mà giữ nguyên chú thích và thứ tự dòng.
// Giá trị rỗng = comment dòng đó lại (`# KEY=`), vì biến rỗng vẫn được backend coi là "đã đặt".

export function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!exists(file)) return out;
  for (const line of readText(file).split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/\s+#.*$/, '').trim();
  }
  return out;
}

export function updateEnvFile(file: string, changes: Record<string, string | null>): void {
  const lines = exists(file) ? readText(file).split('\n') : [];
  for (const [key, raw] of Object.entries(changes)) {
    if (!/^[A-Z0-9_]+$/.test(key)) throw new Error(`Tên biến không hợp lệ: ${key}`);
    const value = raw === null ? '' : String(raw).replace(/[\r\n]/g, '').trim();
    const active = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
    const commented = lines.findIndex((l) => new RegExp(`^\\s*#\\s*${key}\\s*=`).test(l));
    const next = value ? `${key}=${value}` : `# ${key}=`;
    if (active !== -1) lines[active] = next;
    else if (commented !== -1) lines[commented] = value ? next : lines[commented];
    else if (value) lines.push(next);
  }
  writeText(file, lines.join('\n').replace(/\n*$/, '\n'));
}
