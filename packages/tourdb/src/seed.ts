// Xuất/nhập cả kho dự án ra một thư mục file văn bản. Dùng để:
//   - sao lưu, chuyển máy, xem diff trong git (kho SQLite là nhị phân và nằm ngoài source);
//   - "bản mẫu" đi kèm một web: thư mục `<thư mục web>.compass` nằm cạnh (không nằm trong) source của web. Lần đầu mở
//     dự án trên một máy mà chưa có kho, kho được dựng tự động từ bản mẫu này, nên clone repo về là chạy được.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { toursFileSchema } from '@wealthcompass/contracts';
import { TourDb } from './index';
import { exists, listDocuments, projectDbFor, readText, writeText } from './store';

const CONFIG = 'compass.config.yaml';
const TOURS = 'tours.json';
// Tài liệu chỉ có nghĩa trên một máy (kết quả chạy gần nhất): không xuất
const LOCAL_ONLY = new Set(['eval-last.json']);

// Thư mục bản mẫu của một web: nằm cạnh thư mục source, tên `<tên thư mục web>.compass`
export function seedDirFor(webDir: string): string {
  return `${resolve(webDir)}.compass`;
}

// Đường dẫn source khác nhau trên mỗi máy: không ghi vào bản xuất, điền lại lúc nhập
function withoutSourceDir(config: string): string {
  return config.replace(/^[ \t]*sourceDir:.*\n/m, '');
}
function withSourceDir(config: string, sourceDir: string): string {
  const clean = withoutSourceDir(config);
  // Dự án chưa có source (discovery.source: none) thì không có sourceDir
  if (/^[ \t]*source:\s*none\b/m.test(clean) || !/^discovery:\s*$/m.test(clean)) return clean;
  return clean.replace(/^discovery:\s*$/m, `discovery:\n  sourceDir: ${JSON.stringify(resolve(sourceDir))}`);
}

export function exportProject(db: string, outDir: string): string[] {
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  for (const name of listDocuments(db)) {
    if (LOCAL_ONLY.has(name)) continue;
    const text = readText(join(db, name));
    writeFileSync(join(outDir, name), name === CONFIG ? withoutSourceDir(text) : text);
    written.push(name);
  }
  const tours = new TourDb(db).all();
  writeFileSync(join(outDir, TOURS), JSON.stringify(tours, null, 2) + '\n');
  written.push(`${TOURS} (${Object.keys(tours.tours).length} tour)`);
  return written;
}

// Nhập đè các tài liệu có trong thư mục; tour trong tours.json được thêm/cập nhật (tour khác trong kho giữ nguyên)
export function importProject(db: string, fromDir: string, sourceDir?: string): string[] {
  if (!existsSync(join(fromDir, CONFIG))) throw new Error(`Không thấy ${CONFIG} trong ${fromDir}`);
  const read: string[] = [];
  for (const name of readdirSync(fromDir)) {
    if (name === TOURS || name.startsWith('.') || !/\.(ya?ml|json|env)$/.test(name)) continue;
    const text = readFileSync(join(fromDir, name), 'utf8');
    writeText(join(db, name), name === CONFIG && sourceDir ? withSourceDir(text, sourceDir) : text);
    read.push(name);
  }
  if (existsSync(join(fromDir, TOURS))) {
    const tours = toursFileSchema.parse(JSON.parse(readFileSync(join(fromDir, TOURS), 'utf8')));
    const store = new TourDb(db);
    for (const [id, tour] of Object.entries(tours.tours)) store.save(id, tour, 'import', `Nhập từ ${fromDir}`);
    read.push(`${TOURS} (${Object.keys(tours.tours).length} tour)`);
  }
  return read;
}

// Web chưa có kho trên máy này nhưng có bản mẫu đi kèm: dựng kho từ bản mẫu. Trả true khi vừa dựng.
export function ensureSeeded(webDir: string): boolean {
  const abs = resolve(webDir);
  if (abs.endsWith('.db')) return false;
  const seed = seedDirFor(abs);
  if (!existsSync(join(seed, CONFIG))) return false;
  const db = projectDbFor(abs);
  if (exists(join(db, CONFIG))) return false;
  importProject(db, seed, abs);
  return true;
}
