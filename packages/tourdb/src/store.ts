// Kho dự án: MỘT file SQLite cho mỗi web, nằm NGOÀI source của web (mặc định ~/.wealthcompass/projects/<tên>-<mã>.db).
// Kho chứa mọi dữ liệu của WealthCompass cho web đó: cấu hình, mô tả màn hình, bản đồ tính năng, lock, bộ câu kiểm thử,
// cấu hình backend (dạng tài liệu văn bản trong bảng `documents`) và tour (các bảng tour_*, xem index.ts).
// Source của web không còn file nào của WealthCompass; Studio, CLI và backend cùng mở file kho này.
//
// Để phần còn lại của mã không phải biết dữ liệu nằm ở đâu, một tài liệu trong kho có "đường dẫn ảo"
// `<file kho>.db/<tên tài liệu>` (vd. ~/.wealthcompass/projects/my-web-1a2b3c4d.db/compass.config.yaml). Các hàm dưới đây
// nhận cả đường dẫn ảo lẫn đường dẫn file thật: file thật thì đọc/ghi đĩa như thường (dự án kiểu cũ, test, source của web).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

interface Statement {
  get(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
  run(...args: unknown[]): unknown;
}
interface Db {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

// Thư mục dữ liệu của WealthCompass trên máy này; đổi bằng COMPASS_HOME
export function compassHome(): string {
  return process.env['COMPASS_HOME'] ? resolve(process.env['COMPASS_HOME']) : join(homedir(), '.wealthcompass');
}

// File kho của một web, suy từ đường dẫn tuyệt đối tới source của nó (hai web trùng tên thư mục vẫn khác kho)
export function projectDbFor(webDir: string): string {
  const abs = resolve(webDir);
  const name = basename(abs).replace(/[^\w.-]/g, '_').slice(0, 40) || 'web';
  return join(compassHome(), 'projects', `${name}-${createHash('sha256').update(abs).digest('hex').slice(0, 8)}.db`);
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// Đường dẫn ảo `<kho>.db/<tên>` -> { db, name }; đường dẫn file thật -> null
export function storeOf(path: string): { db: string; name: string } | null {
  const dir = dirname(path);
  return dir.endsWith('.db') && !isDir(dir) ? { db: dir, name: basename(path) } : null;
}

// Một đường dẫn có nằm trong kho dự án không (để chọn kho tour, in thông báo)
export function isStorePath(path: string): boolean {
  return storeOf(path) !== null;
}

function use<T>(db: string, fn: (handle: Db) => T): T {
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (file: string) => Db };
  mkdirSync(dirname(db), { recursive: true });
  const handle = new DatabaseSync(db);
  try {
    handle.exec('PRAGMA busy_timeout = 3000');
    handle.exec('CREATE TABLE IF NOT EXISTS documents (name TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at INTEGER NOT NULL)');
    return fn(handle);
  } finally {
    handle.close();
  }
}

export function exists(path: string): boolean {
  const s = storeOf(path);
  if (!s) return existsSync(path);
  if (!existsSync(s.db)) return false;
  return use(s.db, (h) => Boolean(h.prepare('SELECT 1 FROM documents WHERE name = ?').get(s.name)));
}

// Như readFileSync(path, 'utf8'): ném lỗi khi không có
export function readText(path: string): string {
  const s = storeOf(path);
  if (!s) return readFileSync(path, 'utf8');
  const row = existsSync(s.db) ? (use(s.db, (h) => h.prepare('SELECT content FROM documents WHERE name = ?').get(s.name)) as { content: string } | undefined) : undefined;
  if (!row) throw Object.assign(new Error(`Không có "${s.name}" trong kho dự án ${s.db}`), { code: 'ENOENT' });
  return row.content;
}

export function writeText(path: string, content: string): void {
  const s = storeOf(path);
  if (!s) return writeFileSync(path, content);
  use(s.db, (h) =>
    h.prepare('INSERT INTO documents (name, content, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at').run(s.name, content, Date.now()),
  );
}

// Thời điểm sửa cuối (ms); 0 khi không có
export function mtime(path: string): number {
  const s = storeOf(path);
  try {
    if (!s) return statSync(path).mtimeMs;
    if (!existsSync(s.db)) return 0;
    const row = use(s.db, (h) => h.prepare('SELECT updated_at FROM documents WHERE name = ?').get(s.name)) as { updated_at: number } | undefined;
    return row?.updated_at ?? 0;
  } catch {
    return 0;
  }
}

// Tên các tài liệu trong một kho
export function listDocuments(db: string): string[] {
  if (!existsSync(db)) return [];
  return use(db, (h) => (h.prepare('SELECT name FROM documents ORDER BY name').all() as Array<{ name: string }>).map((r) => r.name));
}
