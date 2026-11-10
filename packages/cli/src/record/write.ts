import { exists, readText, writeText } from '@wealthcompass/tourdb';
import { Document, YAMLSeq, isSeq, parseDocument } from 'yaml';
import { TourDb } from '@wealthcompass/tourdb';
import { type Layout, type Locator, type RecordedTour, type ToursFile, type TourStep } from '@wealthcompass/contracts';
import type { RecordedStep } from './recorder';
import type { TourDraft } from './draft';

// Câu hỏi mẫu: hợp với câu đã có, không trùng, không xóa
function addSampleQuestions(doc: Document, featureId: string, questions: string[]): string[] {
  if (!questions.length) return [];
  const path = ['features', featureId, 'sampleQuestions'];
  const seq = doc.getIn(path, true);
  const current: string[] = isSeq(seq) ? ((seq as YAMLSeq).toJSON() as string[]) : [];
  const have = new Set(current.map((q) => q.toLowerCase()));
  const added = questions.filter((q) => !have.has(q.toLowerCase()));
  if (isSeq(seq)) {
    // Thêm vào dãy sẵn có để giữ nguyên chú thích của từng câu cũ
    for (const q of added) (seq as YAMLSeq).add(doc.createNode(q));
  } else if (added.length) {
    doc.setIn(path, doc.createNode(added));
  }
  return added;
}

// Chỉ thêm câu hỏi mẫu vào overrides (tour ghi bằng locator nằm ở compass.tours.json)
export function mergeSampleQuestionsIntoOverrides(file: string, featureId: string, questions: string[]): { yaml: string; added: string[] } {
  const existing = exists(file) ? readText(file) : '';
  const doc: Document = existing.trim() ? parseDocument(existing) : new Document({});
  if (doc.errors.length) throw new Error(`${file} không phải YAML hợp lệ: ${doc.errors[0].message}`);
  const added = addSampleQuestions(doc, featureId, questions);
  return { yaml: String(doc), added };
}

export interface ToursMergeInput {
  id: string;
  draft: TourDraft;
  // Bước đã lọc (có tourId hoặc locator dùng được); route đã đổi sang mẫu route của tính năng nếu khớp
  steps: Array<RecordedStep & { routePattern?: string }>;
  startRoute: string;
  // Màn hình lúc dừng ghi (chỉ ghi vào file khi chưa có source, để scanner dựng màn hình đích)
  endRoute?: string;
  featureId?: string;
  purpose?: string;
  // Bố cục lúc ghi (theo bề rộng khung nhìn)
  layout?: Layout;
  force: boolean;
  today?: string;
}

// Mọi tour (phiên bản hiện tại) trong kho tour SQLite của dự án. `file` là đường dẫn kho (discovery.tours).
export function readToursFile(file: string): ToursFile {
  return new TourDb(file).all();
}

// Ghi lại tập tour vào kho: tour đổi nội dung thành một phiên bản mới, tour không còn trong tập bị xóa
export function writeTours(file: string, data: ToursFile, by: string, note?: string): void {
  new TourDb(file).replaceAll(data, by, note);
}

// Bố cục của một lần ghi: bố cục ghi trên đa số locator (mỗi locator ghi bề rộng khung nhìn lúc bấm)
export function layoutOfSteps(steps: Array<{ locator?: Locator | null }>): Layout | undefined {
  const counts = { mobile: 0, desktop: 0 };
  for (const s of steps) if (s.locator?.layout) counts[s.locator.layout]++;
  if (!counts.mobile && !counts.desktop) return undefined;
  return counts.mobile > counts.desktop ? 'mobile' : 'desktop';
}

// Gộp tour vào compass.tours.json. Không ghi đè tour đã có trừ khi --force; thứ tự khóa ổn định để diff gọn.
// Cùng id nhưng ghi ở bố cục khác (tour bản desktop đã có, giờ ghi bằng --mobile): thêm vào `variants`, không cần --force.
export function mergeTourIntoToursFile(file: string, input: ToursMergeInput): { json: string; replaced: boolean; variant?: Layout } {
  const data = readToursFile(file);
  const existing = data.tours[input.id];
  const steps: TourStep[] = input.steps.map((s, i) => ({
    key: `s${i + 1}`,
    ...(s.tourId ? { tourId: s.tourId } : {}),
    ...(s.locator ? { locator: s.locator } : {}),
    route: s.routePattern ?? s.route,
    advanceOn: s.advanceOn,
    text: input.draft.steps[i].text,
    ...(s.opensNext ? { skipIfNextVisible: true } : {}),
  }));
  const recordedAt = input.today ?? new Date().toISOString().slice(0, 10);

  const existingLayout = existing ? (existing.layout ?? layoutOfSteps(existing.steps)) : undefined;
  const otherLayout = existing && input.layout && existingLayout && existingLayout !== input.layout;
  if (existing && otherLayout) {
    const layout = input.layout!;
    if (existing.variants?.[layout] && !input.force) {
      throw new Error(`Tour "${input.id}" đã có bản ${layout} trong ${file}. Dùng --force để ghi đè bản này.`);
    }
    // Bản mới chưa duyệt: cả tour trở lại trạng thái nháp
    data.tours[input.id] = { ...existing, layout: existingLayout, draft: true, draftSource: input.draft.source, recordedAt, variants: { ...existing.variants, [layout]: steps } };
    return { json: JSON.stringify(data, null, 2) + '\n', replaced: Boolean(existing.variants?.[layout]), variant: layout };
  }

  if (existing && !input.force) {
    throw new Error(`Tour "${input.id}" đã có trong ${file}. Dùng --force để ghi đè, đặt --id khác, hoặc ghi bản cho bố cục kia (--mobile).`);
  }
  const about = (input.purpose ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const tour: RecordedTour = {
    title: input.draft.title,
    ...(input.draft.description ? { description: input.draft.description } : {}),
    ...(input.featureId ? { feature: input.featureId } : {}),
    startRoute: input.startRoute,
    ...(input.endRoute ? { endRoute: input.endRoute } : {}),
    draft: true,
    draftSource: input.draft.source,
    recordedAt,
    ...(about ? { purpose: about } : {}),
    ...(input.layout ? { layout: input.layout } : {}),
    steps,
    // Ghi đè bản chính (--force) vẫn giữ bản của bố cục kia
    ...(existing?.variants ? { variants: existing.variants } : {}),
  };
  data.tours[input.id] = tour;
  return { json: JSON.stringify(data, null, 2) + '\n', replaced: Boolean(existing) };
}

export function writeOverrides(file: string, yaml: string): void {
  writeText(file, yaml);
}
