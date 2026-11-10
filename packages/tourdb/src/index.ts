// Kho tour duy nhất, lưu trong một file SQLite (mặc định compass.tours.db cạnh compass.config.yaml, commit cùng dự án).
// Cả hai phía dùng chung file và lớp này:
//   - CLI/Studio: tour:record, sửa tour, tour:verify --heal, tour:rerecord ghi vào đây; scan đọc để dựng Feature Map.
//   - Backend: phục vụ tour cho widget từ đây; API quản trị và tour:push cũng ghi vào đây.
// Mỗi lần lưu là một phiên bản mới (không ghi đè), quay về bản cũ cũng tạo bản mới; ảnh chụp từng bước nằm cùng file.
// Chỉ chạy trên Node (node:sqlite, Node 22.5+); không import từ mã chạy trong trình duyệt.
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { recordedTourSchema, toursFileSchema, type RecordedTour, type ToursFile } from '@wealthcompass/contracts';
import { storeOf } from './store';

export * from './store';
export * from './seed';

export const TOUR_ID = /^[a-z0-9][a-z0-9-]{1,60}$/;
const STEP_KEY = /^[\w-]{1,40}$/;
const LAYOUTS = ['desktop', 'mobile'];

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

export interface TourVersionMeta {
  version: number;
  savedAt: string;
  savedBy: string;
  note?: string;
}
export interface StoredTour extends TourVersionMeta {
  id: string;
  tour: RecordedTour;
}
export interface TourSummary {
  id: string;
  title: string;
  feature?: string;
  version: number;
  versions: number;
  updatedAt: string;
  updatedBy: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tours (id TEXT PRIMARY KEY, current INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tour_versions (
  tour_id TEXT NOT NULL, version INTEGER NOT NULL, saved_at TEXT NOT NULL, saved_by TEXT NOT NULL, note TEXT, data TEXT NOT NULL,
  PRIMARY KEY (tour_id, version)
);
CREATE TABLE IF NOT EXISTS tour_shots (
  tour_id TEXT NOT NULL, layout TEXT NOT NULL, step_key TEXT NOT NULL, png BLOB NOT NULL, saved_at TEXT NOT NULL,
  PRIMARY KEY (tour_id, layout, step_key)
);`;

// Đường dẫn file SQLite của kho. Cấu hình cũ còn trỏ compass.tours.json thì dùng file .db cùng tên.
// Đường dẫn nằm trong kho dự án (`<kho>.db/compass.tours.db`): tour nằm ngay trong file kho đó, không có file riêng.
export function tourDbPath(file: string): string {
  const store = storeOf(file);
  if (store) return store.db;
  return file.endsWith('.json') ? file.replace(/\.json$/, '.db') : file;
}
// File JSON của bản trước (compass.tours.json) nằm cạnh file .db
export function legacyJsonPath(file: string): string {
  return tourDbPath(file).replace(/\.db$/, '.json');
}

// So sánh nội dung không phụ thuộc thứ tự khóa
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

// Ảnh chụp do kho tự gắn lúc phục vụ: không lưu đường dẫn ảnh trong tour
function stripShots(tour: RecordedTour): RecordedTour {
  const strip = (steps: RecordedTour['steps']) => steps.map(({ shot: _shot, ...s }) => s);
  return {
    ...tour,
    steps: strip(tour.steps),
    ...(tour.variants ? { variants: Object.fromEntries(Object.entries(tour.variants).map(([l, s]) => [l, s ? strip(s) : s])) } : {}),
  };
}

export class TourDb {
  readonly file: string;

  constructor(file: string) {
    this.file = tourDbPath(file);
  }

  exists(): boolean {
    return existsSync(this.file);
  }

  // Mở, chạy, đóng: không giữ file mở giữa các lần gọi (CLI, Studio và backend có thể cùng dùng một file)
  private use<T>(fn: (db: Db) => T, create = true): T {
    if (!create && !this.exists()) throw new Error(`Chưa có kho tour ${this.file}`);
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (file: string) => Db };
    mkdirSync(dirname(this.file), { recursive: true });
    const fresh = !this.exists();
    const db = new DatabaseSync(this.file);
    try {
      db.exec('PRAGMA busy_timeout = 3000');
      db.exec(SCHEMA);
      if (fresh) this.importLegacy(db);
      return fn(db);
    } finally {
      db.close();
    }
  }

  // Lần đầu tạo kho: chuyển tour từ compass.tours.json của bản trước (nếu có) rồi xóa file đó
  private importLegacy(db: Db): void {
    const legacy = legacyJsonPath(this.file);
    if (!existsSync(legacy)) return;
    const raw = readFileSync(legacy, 'utf8');
    const parsed = raw.trim() ? toursFileSchema.parse(JSON.parse(raw)) : { tours: {} };
    for (const [id, tour] of Object.entries(parsed.tours)) this.insert(db, id, tour, 'compass.tours.json', 'Chuyển từ compass.tours.json');
    rmSync(legacy);
  }

  private insert(db: Db, id: string, tour: RecordedTour, by: string, note?: string): StoredTour {
    const row = db.prepare('SELECT MAX(version) AS v FROM tour_versions WHERE tour_id = ?').get(id) as { v: number | null };
    const version = (row.v ?? 0) + 1;
    const savedAt = new Date().toISOString();
    db.prepare('INSERT INTO tour_versions (tour_id, version, saved_at, saved_by, note, data) VALUES (?, ?, ?, ?, ?, ?)').run(id, version, savedAt, by, note?.slice(0, 200) ?? null, JSON.stringify(tour));
    db.prepare('INSERT INTO tours (id, current) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET current = excluded.current').run(id, version);
    return { id, version, savedAt, savedBy: by, ...(note ? { note: note.slice(0, 200) } : {}), tour };
  }

  private row(r: { tour_id: string; version: number; saved_at: string; saved_by: string; note: string | null; data: string }): StoredTour {
    return { id: r.tour_id, version: r.version, savedAt: r.saved_at, savedBy: r.saved_by, ...(r.note ? { note: r.note } : {}), tour: recordedTourSchema.parse(JSON.parse(r.data)) };
  }

  // Chưa có file .db: đọc compass.tours.json của bản trước (không tạo file khi chỉ đọc)
  private legacyTours(): ToursFile {
    const legacy = legacyJsonPath(this.file);
    if (!existsSync(legacy)) return { tours: {} };
    const raw = readFileSync(legacy, 'utf8');
    try {
      return raw.trim() ? toursFileSchema.parse(JSON.parse(raw)) : { tours: {} };
    } catch (e) {
      throw new Error(`${legacy} không hợp lệ: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Mọi tour ở phiên bản hiện tại, cùng hình dạng với file compass.tours.json trước đây
  all(): ToursFile {
    if (!this.exists()) return this.legacyTours();
    return this.use((db) => {
      const rows = db.prepare('SELECT v.* FROM tours t JOIN tour_versions v ON v.tour_id = t.id AND v.version = t.current ORDER BY t.id').all() as Array<Parameters<TourDb['row']>[0]>;
      return { tours: Object.fromEntries(rows.map((r) => [r.tour_id, this.row(r).tour])) };
    });
  }

  list(): TourSummary[] {
    if (!this.exists()) return [];
    return this.use((db) => {
      const rows = db
        .prepare('SELECT v.*, (SELECT COUNT(*) FROM tour_versions c WHERE c.tour_id = t.id) AS n FROM tours t JOIN tour_versions v ON v.tour_id = t.id AND v.version = t.current ORDER BY t.id')
        .all() as Array<Parameters<TourDb['row']>[0] & { n: number }>;
      return rows.map((r) => {
        const s = this.row(r);
        return { id: s.id, title: s.tour.title, ...(s.tour.feature ? { feature: s.tour.feature } : {}), version: s.version, versions: r.n, updatedAt: s.savedAt, updatedBy: s.savedBy };
      });
    });
  }

  current(id: string): StoredTour | undefined {
    if (!this.exists()) return undefined;
    return this.use((db) => {
      const r = db.prepare('SELECT v.* FROM tours t JOIN tour_versions v ON v.tour_id = t.id AND v.version = t.current WHERE t.id = ?').get(id);
      return r ? this.row(r as Parameters<TourDb['row']>[0]) : undefined;
    });
  }

  version(id: string, version: number): StoredTour | undefined {
    if (!this.exists()) return undefined;
    return this.use((db) => {
      const r = db.prepare('SELECT v.* FROM tours t JOIN tour_versions v ON v.tour_id = t.id WHERE t.id = ? AND v.version = ?').get(id, version);
      return r ? this.row(r as Parameters<TourDb['row']>[0]) : undefined;
    });
  }

  history(id: string): Array<TourVersionMeta & { steps: number }> {
    if (!this.exists()) return [];
    return this.use((db) =>
      (db.prepare('SELECT v.* FROM tours t JOIN tour_versions v ON v.tour_id = t.id WHERE t.id = ? ORDER BY v.version DESC').all(id) as Array<Parameters<TourDb['row']>[0]>).map((r) => {
        const { tour, id: _id, ...meta } = this.row(r);
        return { ...meta, steps: tour.steps.length };
      }),
    );
  }

  // Lưu một phiên bản mới. Nội dung giống hệt bản hiện tại thì không tạo bản (trả bản hiện tại).
  save(id: string, input: RecordedTour, by: string, note?: string): StoredTour {
    if (!TOUR_ID.test(id)) throw new Error('Id tour chỉ gồm chữ thường, số và gạch nối');
    const tour = stripShots(recordedTourSchema.parse(input));
    return this.use((db) => {
      const r = db.prepare('SELECT v.* FROM tours t JOIN tour_versions v ON v.tour_id = t.id AND v.version = t.current WHERE t.id = ?').get(id);
      const now = r ? this.row(r as Parameters<TourDb['row']>[0]) : undefined;
      if (now && canonical(now.tour) === canonical(tour)) return now;
      return this.insert(db, id, tour, by, note);
    });
  }

  // Quay về bản cũ = lưu một bản mới có nội dung của bản đó (lịch sử không bị viết lại)
  rollback(id: string, version: number, by: string): StoredTour {
    const old = this.version(id, version);
    if (!old) throw new Error(`Tour "${id}" không có phiên bản ${version}`);
    return this.save(id, old.tour, by, `Quay về phiên bản ${version}`);
  }

  // Xóa tour, mọi phiên bản và ảnh của nó
  remove(id: string): boolean {
    if (!this.exists()) return false;
    return this.use((db) => {
      const had = Boolean(db.prepare('SELECT 1 FROM tours WHERE id = ?').get(id));
      db.prepare('DELETE FROM tour_shots WHERE tour_id = ?').run(id);
      db.prepare('DELETE FROM tour_versions WHERE tour_id = ?').run(id);
      db.prepare('DELETE FROM tours WHERE id = ?').run(id);
      return had;
    });
  }

  // Ghi cả tập tour (hình dạng file cũ): tour đổi nội dung thành phiên bản mới, tour không còn trong tập bị xóa
  replaceAll(data: ToursFile, by: string, note?: string): void {
    const before = this.all().tours;
    for (const [id, tour] of Object.entries(data.tours)) this.save(id, tour, by, note);
    for (const id of Object.keys(before)) if (!data.tours[id]) this.remove(id);
  }

  // ---- Ảnh chụp phần tử của từng bước (tour:verify --screenshots, tour:push) ----

  private static shotKey(id: string, layout: string, key: string): boolean {
    return TOUR_ID.test(id) && LAYOUTS.includes(layout) && STEP_KEY.test(key);
  }

  saveShot(id: string, layout: string, key: string, png: Buffer): void {
    if (!TourDb.shotKey(id, layout, key)) throw new Error('Id tour, bố cục hoặc khóa bước không hợp lệ');
    // Chỉ nhận PNG thật (8 byte chữ ký đầu file)
    if (png.length < 8 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Ảnh phải là PNG');
    this.use((db) =>
      db
        .prepare('INSERT INTO tour_shots (tour_id, layout, step_key, png, saved_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(tour_id, layout, step_key) DO UPDATE SET png = excluded.png, saved_at = excluded.saved_at')
        .run(id, layout, key, png, new Date().toISOString()),
    );
  }

  readShot(id: string, layout: string, key: string): Buffer | null {
    if (!TourDb.shotKey(id, layout, key) || !this.exists()) return null;
    return this.use((db) => {
      const r = db.prepare('SELECT png FROM tour_shots WHERE tour_id = ? AND layout = ? AND step_key = ?').get(id, layout, key) as { png: Uint8Array } | undefined;
      return r ? Buffer.from(r.png) : null;
    });
  }

  // Các bước có ảnh của một tour: "desktop-s1", "mobile-s2"...
  shotKeys(id: string): Set<string> {
    if (!this.exists()) return new Set();
    return this.use((db) => new Set((db.prepare('SELECT layout, step_key FROM tour_shots WHERE tour_id = ?').all(id) as Array<{ layout: string; step_key: string }>).map((r) => `${r.layout}-${r.step_key}`)));
  }
}
