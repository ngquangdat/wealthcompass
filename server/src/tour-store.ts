import { tourSchema, type Layout, type RecordedTour, type Tour } from '@wealthcompass/contracts';
import { TOUR_ID, TourDb, type StoredTour, type TourSummary } from '@wealthcompass/tourdb';

// Kho tour phía backend. Đây KHÔNG phải kho riêng: nó mở chính file SQLite của dự án (compass.tours.db) mà tour:record
// và Studio ghi vào, nên chỉ có một nơi lưu tour. Sửa tour ở đâu (Studio, tour:verify --heal, API quản trị, tour:push)
// thì backend cũng phục vụ ngay bản đó. Mỗi lần lưu là một phiên bản mới; quay về bản cũ cũng tạo bản mới.

export { TOUR_ID };
export type { TourSummary };

export interface TourVersion {
  version: number;
  savedAt: string;
  savedBy: string;
  note?: string;
  // Id tính năng sở hữu tour: quyền xem tour theo quyền của tính năng
  feature?: string;
  tour: Tour;
}

// Bỏ đường dẫn ảnh (do kho gắn lúc phục vụ) khỏi tour trước khi lưu/so sánh
export function stripShots(tour: Tour): Tour {
  const strip = (steps: Tour['steps']) => steps.map(({ shot: _shot, ...s }) => s);
  return {
    ...tour,
    steps: strip(tour.steps),
    ...(tour.variants ? { variants: Object.fromEntries(Object.entries(tour.variants).map(([l, s]) => [l, s ? strip(s) : s])) } : {}),
  };
}

// Tour trong kho (không có id, kèm tính năng và ghi chú của người soạn) -> tour phục vụ cho widget
function toTour(id: string, stored: RecordedTour): Tour {
  const keyed = (steps: RecordedTour['steps']) => steps.map((s, i) => ({ ...s, key: s.key ?? `s${i + 1}` }));
  return tourSchema.parse({
    id,
    title: stored.title,
    description: stored.description,
    startRoute: stored.startRoute,
    steps: keyed(stored.steps),
    layout: stored.layout,
    variants: stored.variants ? Object.fromEntries(Object.entries(stored.variants).map(([l, s]) => [l, s ? keyed(s) : s])) : undefined,
  });
}

export class TourStore {
  private readonly db: TourDb;

  // `file`: đường dẫn kho tour SQLite (compass.tours.db của dự án)
  constructor(readonly file: string) {
    this.db = new TourDb(file);
  }

  private view(stored: StoredTour): TourVersion {
    const { id, tour, ...meta } = stored;
    return { ...meta, ...(tour.feature ? { feature: tour.feature } : {}), tour: toTour(id, tour) };
  }

  list(): TourSummary[] {
    return this.db.list();
  }

  has(id: string): boolean {
    return Boolean(this.db.current(id));
  }

  current(id: string): TourVersion | undefined {
    const stored = this.db.current(id);
    return stored && this.view(stored);
  }

  version(id: string, version: number): TourVersion | undefined {
    const stored = this.db.version(id, version);
    return stored && this.view(stored);
  }

  history(id: string) {
    return this.db.history(id);
  }

  // Nội dung giống bản hiện tại thì không tạo phiên bản mới (trả bản hiện tại)
  save(input: { tour: Tour; feature?: string; by: string; note?: string }): TourVersion {
    const { id, ...tour } = stripShots(tourSchema.parse(input.tour));
    // Giữ ghi chú của người soạn (mục đích, ngày ghi, màn hình đích); bản lưu qua API quản trị là bản đã duyệt
    const { draft: _draft, draftSource: _source, ...kept } = this.db.current(id)?.tour ?? ({} as Partial<RecordedTour>);
    const next: RecordedTour = { ...kept, ...tour, feature: input.feature } as RecordedTour;
    if (!tour.description) delete next.description;
    if (!tour.layout) delete next.layout;
    if (!tour.variants) delete next.variants;
    if (!input.feature) delete next.feature;
    return this.view(this.db.save(id, next, input.by, input.note));
  }

  rollback(id: string, version: number, by: string): TourVersion {
    return this.view(this.db.rollback(id, version, by));
  }

  remove(id: string): boolean {
    return this.db.remove(id);
  }

  // ---- Ảnh chụp phần tử của từng bước (tour:verify --screenshots, đẩy lên bằng tour:push) ----

  saveShot(id: string, layout: string, key: string, png: Buffer): void {
    this.db.saveShot(id, layout, key, png);
  }

  readShot(id: string, layout: string, key: string): Buffer | null {
    return this.db.readShot(id, layout, key);
  }

  // Tour để phục vụ widget: gắn đường dẫn ảnh cho bước có ảnh. Bản chính không ghi bố cục thì coi là desktop.
  withShots(tour: Tour, base = '/v1/tours'): Tour {
    const have = this.db.shotKeys(tour.id);
    if (!have.size) return tour;
    const mark = (steps: Tour['steps'], layout: Layout) =>
      steps.map((s, i) => {
        const key = s.key ?? `s${i + 1}`;
        return have.has(`${layout}-${key}`) ? { ...s, shot: `${base}/${tour.id}/shots/${layout}/${key}` } : s;
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
