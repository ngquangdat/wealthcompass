// Dữ liệu của một dự án nằm ở đâu.
// Mặc định: trong kho dự án SQLite ngoài source của web (~/.wealthcompass/projects/<tên>-<mã>.db), source web không có
// file nào của WealthCompass. Dự án kiểu cũ (còn compass.config.yaml nằm cạnh source) vẫn chạy như trước cho tới khi
// chuyển bằng `wealthcompass migrate`.
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { TourDb, ensureSeeded, projectDbFor, writeText } from '@wealthcompass/tourdb';

export const CONFIG_NAME = 'compass.config.yaml';

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// `app` là thư mục source của web, hoặc chính file kho (.db) của một dự án (vd. dự án tour chưa có source).
// Trả về "thư mục dữ liệu": file kho (đường dẫn ảo `<kho>.db/<tên>` nối bằng join như thư mục thường) hoặc thư mục kiểu cũ.
export function dataRoot(app: string): string {
  const abs = resolve(app);
  if (abs.endsWith('.db')) return abs;
  if (existsSync(join(abs, CONFIG_NAME))) return abs;
  // Web có bản mẫu đi kèm (`<thư mục web>.compass`) mà máy này chưa có kho: dựng kho từ bản mẫu (clone repo về là chạy được)
  ensureSeeded(abs);
  return projectDbFor(abs);
}

export const configPathOf = (app: string) => join(dataRoot(app), CONFIG_NAME);

// Dự án đang dùng kho SQLite (không phải file cạnh source)
export const usesStore = (app: string) => dataRoot(app).endsWith('.db');

// Tham số dòng lệnh: --config <file cấu hình hoặc file kho .db> hoặc --app <thư mục web | file kho>. Không có cả hai thì
// dùng thư mục hiện tại (file compass.config.yaml kiểu cũ, hoặc kho của web ở thư mục này).
export function resolveConfigArg(config?: string, app?: string): string {
  if (config) {
    const abs = resolve(config);
    return abs.endsWith('.db') || (!isFile(abs) && existsSync(abs)) ? configPathOf(abs) : abs;
  }
  return configPathOf(app ?? '.');
}


// Chuyển dự án kiểu cũ vào kho dự án SQLite ngoài source, rồi xóa các file đã chuyển khỏi thư mục web.
// Cấu hình được ghi thêm discovery.sourceDir (đường dẫn source) và trỏ tên file về mặc định trong kho.
export function migrateToStore(app: string): { db: string; moved: string[]; left: string[] } {
  const abs = resolve(app);
  const db = projectDbFor(abs);
  const moved: string[] = [];
  const configFile = join(abs, CONFIG_NAME);
  const doc = parseDocument(readFileSync(configFile, 'utf8'));
  const names = {
    overrides: String(doc.getIn(['discovery', 'overrides']) ?? 'compass.overrides.yaml'),
    out: String(doc.getIn(['discovery', 'out']) ?? 'feature-map.json'),
    tours: String(doc.getIn(['discovery', 'tours']) ?? 'compass.tours.db'),
  };
  // Tour: file .db riêng hoặc compass.tours.json của bản trước -> các bảng tour trong kho
  const oldTours = new TourDb(join(abs, names.tours));
  const tours = oldTours.all();
  if (Object.keys(tours.tours).length) new TourDb(join(db, 'compass.tours.db')).replaceAll(tours, 'migrate', 'Chuyển vào kho dự án');
  for (const f of [oldTours.file, oldTours.file.replace(/\.db$/, '.json')]) {
    if (existsSync(f)) {
      rmSync(f);
      moved.push(`${f} (${Object.keys(tours.tours).length} tour)`);
    }
  }
  const sources: Array<[string, string]> = [
    [names.overrides, 'compass.overrides.yaml'],
    ['compass.eval.yaml', 'compass.eval.yaml'],
    ['wealthcompass.env', 'wealthcompass.env'],
    [names.out, 'feature-map.json'],
    ['compass.lock.json', 'compass.lock.json'],
  ];
  for (const [from, to] of sources) {
    const file = join(abs, from);
    if (!existsSync(file)) continue;
    let text = readFileSync(file, 'utf8');
    // Backend tự tìm bản đồ tính năng và kho tour trong kho dự án: bỏ đường dẫn cũ
    if (to === 'wealthcompass.env') text = text.split('\n').filter((l) => !/^\s*COMPASS_(FEATURE_MAP|TOUR_DB)=/.test(l)).join('\n');
    writeText(join(db, to), text);
    rmSync(file);
    moved.push(file);
  }
  doc.setIn(['discovery', 'sourceDir'], abs);
  for (const key of ['overrides', 'out', 'tours']) doc.deleteIn(['discovery', key]);
  writeText(join(db, CONFIG_NAME), String(doc));
  rmSync(configFile);
  moved.push(configFile);
  const left = ['wealthcompass-setup.patch', 'WEALTHCOMPASS_SETUP.md'].map((f) => join(abs, f)).filter(existsSync);
  return { db, moved, left };
}
