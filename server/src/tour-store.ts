import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { tourSchema, type Layout, type Tour } from '@wealthcompass/contracts';

// Kho tour phía backend: sửa tour không cần build lại web hay sửa repo. Mỗi lần lưu là một phiên bản mới
// (không ghi đè), quay lại bản cũ cũng tạo bản mới, nên luôn xem được lịch sử ai đổi gì.
// Lưu thành file JSON trong thư mục dữ liệu (đủ cho tự host một bản; đổi sang DB thì giữ nguyên giao diện lớp này).

export const TOUR_ID = /^[a-z0-9][a-z0-9-]{1,60}$/;
const STEP_KEY = /^[\w-]{1,40}$/;
const LAYOUTS: readonly Layout[] = ['desktop', 'mobile'];

const versionSchema = z.object({
  version: z.number().int().positive(),
  savedAt: z.string(),
  savedBy: z.string(),
  note: z.string().optional(),
  // Id tính năng sở hữu tour: quyền xem tour theo quyền của tính năng
  feature: z.string().optional(),
  tour: tourSchema,
});
export type TourVersion = z.infer<typeof versionSchema>;

const entrySchema = z.object({ current: z.number().int().positive(), versions: z.array(versionSchema).min(1) });
const fileSchema = z.object({ tours: z.record(z.string(), entrySchema).default({}) });
type StoreFile = z.infer<typeof fileSchema>;

// Bỏ đường dẫn ảnh (do kho gắn lúc phục vụ) khỏi tour trước khi lưu/so sánh
export function stripShots(tour: Tour): Tour {
  const strip = (steps: Tour['steps']) => steps.map(({ shot: _shot, ...s }) => s);
  return {
    ...tour,
    steps: strip(tour.steps),
    ...(tour.variants ? { variants: Object.fromEntries(Object.entries(tour.variants).map(([l, s]) => [l, s ? strip(s) : s])) } : {}),
  };
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

export class TourStore {
  private data: StoreFile;
  private readonly file: string;

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'tours.json');
    this.data = existsSync(this.file) ? fileSchema.parse(JSON.parse(readFileSync(this.file, 'utf8'))) : { tours: {} };
  }

  private persist(): void {
    // Ghi file tạm rồi đổi tên: máy chủ tắt giữa chừng không làm hỏng kho
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2) + '\n');
    renameSync(tmp, this.file);
  }

  list(): TourSummary[] {
    return Object.entries(this.data.tours)
      .map(([id, e]) => {
        const v = e.versions.find((x) => x.version === e.current)!;
        return { id, title: v.tour.title, ...(v.feature ? { feature: v.feature } : {}), version: e.current, versions: e.versions.length, updatedAt: v.savedAt, updatedBy: v.savedBy };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  has(id: string): boolean {
    return Boolean(this.data.tours[id]);
  }

  current(id: string): TourVersion | undefined {
    const e = this.data.tours[id];
    return e?.versions.find((v) => v.version === e.current);
  }

  version(id: string, version: number): TourVersion | undefined {
    return this.data.tours[id]?.versions.find((v) => v.version === version);
  }

  history(id: string): Array<Omit<TourVersion, 'tour'> & { steps: number }> {
    return (this.data.tours[id]?.versions ?? []).map(({ tour, ...meta }) => ({ ...meta, steps: tour.steps.length })).reverse();
  }

  save(input: { tour: Tour; feature?: string; by: string; note?: string }): TourVersion {
    const tour = tourSchema.parse(input.tour);
    if (!TOUR_ID.test(tour.id)) throw new Error('Id tour chỉ gồm chữ thường, số và gạch nối');
    // Ảnh chụp do kho tự gắn lúc phục vụ, không lưu đường dẫn ảnh trong tour
    const clean = stripShots(tour);
    const entry = this.data.tours[tour.id];
    const version = entry ? Math.max(...entry.versions.map((v) => v.version)) + 1 : 1;
    const saved: TourVersion = {
      version,
      savedAt: new Date().toISOString(),
      savedBy: input.by,
      ...(input.note ? { note: input.note.slice(0, 200) } : {}),
      ...(input.feature ? { feature: input.feature } : {}),
      tour: clean,
    };
    this.data.tours[tour.id] = { current: version, versions: [...(entry?.versions ?? []), saved] };
    this.persist();
    return saved;
  }

  // Quay về bản cũ = lưu một bản mới có nội dung của bản đó (lịch sử không bị viết lại)
  rollback(id: string, version: number, by: string): TourVersion {
    const old = this.version(id, version);
    if (!old) throw new Error(`Tour "${id}" không có phiên bản ${version}`);
    return this.save({ tour: old.tour, feature: old.feature, by, note: `Quay về phiên bản ${version}` });
  }

  remove(id: string): boolean {
    if (!this.data.tours[id]) return false;
    delete this.data.tours[id];
    this.persist();
    rmSync(join(this.dir, 'shots', id), { recursive: true, force: true });
    return true;
  }

  // ---- Ảnh chụp phần tử của từng bước (tour:verify --screenshots, đẩy lên bằng tour:push) ----

  shotFile(id: string, layout: string, key: string): string | null {
    if (!TOUR_ID.test(id) || !LAYOUTS.includes(layout as Layout) || !STEP_KEY.test(key)) return null;
    return join(this.dir, 'shots', id, `${layout}-${key}.png`);
  }

  saveShot(id: string, layout: string, key: string, png: Buffer): void {
    const file = this.shotFile(id, layout, key);
    if (!file) throw new Error('Id tour, bố cục hoặc khóa bước không hợp lệ');
    // Chỉ nhận PNG thật (8 byte chữ ký đầu file)
    if (png.length < 8 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Ảnh phải là PNG');
    mkdirSync(join(this.dir, 'shots', id), { recursive: true });
    writeFileSync(file, png);
  }

  readShot(id: string, layout: string, key: string): Buffer | null {
    const file = this.shotFile(id, layout, key);
    return file && existsSync(file) ? readFileSync(file) : null;
  }

  // Tour để phục vụ widget: gắn đường dẫn ảnh cho bước có ảnh. Bản chính không ghi bố cục thì coi là desktop.
  withShots(tour: Tour, base = '/v1/tours'): Tour {
    const mark = (steps: Tour['steps'], layout: Layout) =>
      steps.map((s, i) => {
        const key = s.key ?? `s${i + 1}`;
        const file = this.shotFile(tour.id, layout, key);
        return file && existsSync(file) ? { ...s, shot: `${base}/${tour.id}/shots/${layout}/${key}` } : s;
      });
    return {
      ...tour,
      steps: mark(tour.steps, tour.layout ?? 'desktop'),
      ...(tour.variants
        ? { variants: Object.fromEntries(Object.entries(tour.variants).map(([layout, steps]) => [layout, steps ? mark(steps, layout as Layout) : steps])) }
        : {}),
    };
  }
}
