import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

// Quá cỡ này thì đổi tên thành .1 và ghi file mới (giữ đúng một bản cũ)
const MAX_BYTES = 20 * 1024 * 1024;

// Nhật ký hỏi đáp dạng JSONL cho thống kê (Studio đọc). Chỉ ghi các trường agent đã chọn lọc:
// câu hỏi đã che thông tin cá nhân, người dùng đã băm, không ghi token hay nguyên body.
export function createEventLog(file: string | undefined): (entry: Record<string, unknown>) => void {
  if (!file) return () => undefined;
  mkdirSync(dirname(file), { recursive: true });
  return (entry) => {
    try {
      if (existsSync(file) && statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`);
      appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', { mode: 0o600 });
    } catch {
      // Ghi nhật ký lỗi (đầy đĩa, mất quyền) không được làm hỏng câu trả lời
    }
  };
}
