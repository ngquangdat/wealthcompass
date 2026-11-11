// Chỉ mục source lưu trong SQLite: phần quét tốn thời gian (ts-morph đọc route, menu, template; dò cấu trúc dự án)
// chỉ chạy lại khi source đổi. Dấu vân tay của source = commit HEAD + các file đang sửa dở (đường dẫn, mtime, cỡ),
// nên commit mới hoặc sửa chưa commit đều làm chỉ mục cũ hết hiệu lực; còn sửa overrides/tour/feature map thì không.
// File chỉ mục nằm ngoài dự án (~/.wealthcompass/index) để không lẫn vào git của web.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from './version';

// Đổi khi hình dạng dữ liệu lưu thay đổi: chỉ mục cũ tự bị bỏ
const FORMAT = 1;

interface Db {
  exec(sql: string): void;
  prepare(sql: string): { get(...args: unknown[]): unknown; run(...args: unknown[]): unknown };
  close(): void;
}

let db: Db | null | undefined;

function indexDir(): string {
  return process.env['COMPASS_INDEX_DIR'] ?? join(homedir(), '.wealthcompass', 'index');
}

// node:sqlite có từ Node 22.5; bản cũ hơn hoặc lỗi mở file thì chạy không có chỉ mục (quét lại mỗi lần, như trước)
function open(): Db | null {
  if (db !== undefined) return db;
  if (process.env['COMPASS_INDEX'] === 'off') return (db = null);
  try {
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (file: string) => Db };
    mkdirSync(indexDir(), { recursive: true });
    const handle = new DatabaseSync(join(indexDir(), 'index.db'));
    handle.exec(
      'CREATE TABLE IF NOT EXISTS source_index (root TEXT NOT NULL, name TEXT NOT NULL, fingerprint TEXT NOT NULL, data TEXT NOT NULL, indexed_at TEXT NOT NULL, PRIMARY KEY (root, name))',
    );
    db = handle;
  } catch {
    db = null;
  }
  return db;
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 });
  } catch {
    return null;
  }
}

// Không có git: mtime mới nhất và số file của cả cây (bỏ node_modules, dist, thư mục ẩn)
function treeStamp(dir: string): string {
  let newest = 0;
  let count = 0;
  const walk = (d: string) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        count++;
        newest = Math.max(newest, statSync(p).mtimeMs);
      }
    }
  };
  walk(dir);
  return `${count}:${newest}`;
}

// Dấu vân tay code của chính WealthCompass (thư mục chứa module này: src khi chạy dev, bản bundle khi đóng gói):
// sửa scanner mà chưa nâng VERSION thì chỉ mục cũ vẫn phải bỏ, không thì Studio hiện kết quả quét của code cũ
let codeStamp: string | undefined;
function toolStamp(): string {
  if (codeStamp !== undefined) return codeStamp;
  const hash = createHash('sha256');
  const walk = (d: string) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|js|mjs)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) hash.update(`${p}\0`).update(readFileSync(p));
    }
  };
  walk(dirname(fileURLToPath(import.meta.url)));
  return (codeStamp = hash.digest('hex').slice(0, 16));
}

const memo = new Map<string, { at: number; value: string }>();

// `ignore`: file dữ liệu của WealthCompass (overrides, tour, feature map, lock, patch) không phải source của web:
// sửa chúng không làm chỉ mục hết hiệu lực. Đường dẫn tính từ `root`.
export function sourceFingerprint(rootInput: string, ignore: string[] = []): string {
  const root = resolve(rootInput);
  const key = `${root}|${ignore.join(',')}`;
  // Studio gọi liên tiếp trong một lần tải trang: dùng lại trong 0,3 giây (nơi vừa sửa source gọi forgetFingerprints)
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < 300) return hit.value;

  const skip = new Set(ignore.map((p) => p.replace(/^\.\//, '')));
  const hash = createHash('sha256').update(`v${FORMAT}|${VERSION}|${toolStamp()}|`);
  const head = git(root, ['rev-parse', 'HEAD']);
  const status = head ? git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']) : null;
  if (head && status !== null) {
    hash.update(head.trim());
    const prefix = (git(root, ['rev-parse', '--show-prefix']) ?? '').trim();
    for (const entry of status.split('\0')) {
      if (entry.length < 4) continue;
      // Đường dẫn trong status tính từ gốc repo; đổi về tính từ root
      const repoPath = entry.slice(3);
      const rel = prefix && repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : repoPath;
      if (skip.has(rel) || /(^|\/)(wealthcompass-[\w-]+\.patch|WEALTHCOMPASS_SETUP\.md|wealthcompass\.env)$/.test(rel)) continue;
      let stamp = 'gone';
      try {
        const st = statSync(join(root, rel));
        stamp = `${st.mtimeMs}:${st.size}`;
      } catch {
        // file đã xóa
      }
      hash.update(`\n${entry.slice(0, 2)}${rel}:${stamp}`);
    }
  } else {
    hash.update(`nogit:${treeStamp(root)}`);
  }
  const value = hash.digest('hex');
  memo.set(key, { at: Date.now(), value });
  return value;
}

// Gọi ngay sau khi công cụ tự sửa source (áp patch): lần quét kế tiếp phải tính lại dấu vân tay
export function forgetFingerprints(): void {
  memo.clear();
}

// Xóa mọi chỉ mục của một dự án (gốc dự án và thư mục con, như thư mục source): lần sau quét lại từ đầu
export function dropIndex(rootInput: string): void {
  const handle = open();
  if (!handle) return;
  const root = resolve(rootInput);
  try {
    handle.prepare("DELETE FROM source_index WHERE root = ? OR root LIKE ? ESCAPE '\\'").run(root, root.replace(/[\\%_]/g, '\\$&') + '/%');
  } catch {
    // không xóa được thì vẫn quét lại nhờ invalidateScan
  }
}

export function readIndex<T>(root: string, name: string, fingerprint: string): T | null {
  const handle = open();
  if (!handle) return null;
  try {
    const row = handle.prepare('SELECT fingerprint, data FROM source_index WHERE root = ? AND name = ?').get(resolve(root), name) as { fingerprint: string; data: string } | undefined;
    return row && row.fingerprint === fingerprint ? (JSON.parse(row.data) as T) : null;
  } catch {
    return null;
  }
}

export function writeIndex(root: string, name: string, fingerprint: string, data: unknown): void {
  const handle = open();
  if (!handle) return;
  try {
    handle
      .prepare('INSERT INTO source_index (root, name, fingerprint, data, indexed_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(root, name) DO UPDATE SET fingerprint = excluded.fingerprint, data = excluded.data, indexed_at = excluded.indexed_at')
      .run(resolve(root), name, fingerprint, JSON.stringify(data), new Date().toISOString());
  } catch {
    // không ghi được chỉ mục thì lần sau quét lại, không ảnh hưởng kết quả
  }
}

// Lấy từ chỉ mục nếu source chưa đổi, không thì tính lại và lưu
export function indexed<T>(root: string, name: string, fingerprint: string, compute: () => T): T {
  const hit = readIndex<T>(root, name, fingerprint);
  if (hit !== null) return hit;
  const value = compute();
  writeIndex(root, name, fingerprint, value);
  return value;
}
