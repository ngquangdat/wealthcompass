import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Document, YAMLMap, YAMLSeq, isMap, isSeq, parseDocument } from 'yaml';
import { toursFileSchema, type RecordedTour, type ToursFile } from '@wealthcompass/contracts';
import type { RecordedStep } from './recorder';
import type { TourDraft } from './draft';

export interface MergeInput {
  id: string;
  draft: TourDraft;
  steps: RecordedStep[]; // đã lọc, đều có tourId
  startRoute: string;
  featureId?: string;
  // Mô tả do người ghi nhập, ghi vào chú thích để người duyệt biết LLM đã dựa vào đâu
  purpose?: string;
  force: boolean;
  today?: string;
}

export interface MergeResult {
  yaml: string;
  replaced: boolean;
  addedQuestions: string[];
}

// Gộp tour vào compass.overrides.yaml mà GIỮ NGUYÊN chú thích và phần người viết tay.
// Không bao giờ ghi đè tour đã có trừ khi --force; câu hỏi mẫu chỉ thêm vào, không xóa câu cũ.
export function mergeTourIntoOverrides(file: string, input: MergeInput): MergeResult {
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const doc: Document = existing.trim() ? parseDocument(existing) : new Document({});
  if (doc.errors.length) throw new Error(`${file} không phải YAML hợp lệ: ${doc.errors[0].message}`);

  const replaced = doc.hasIn(['tours', input.id]);
  if (replaced && !input.force) {
    throw new Error(`Tour "${input.id}" đã có trong ${file}. Dùng --force để ghi đè hoặc đặt --id khác.`);
  }

  const tour: Record<string, unknown> = {
    title: input.draft.title,
    ...(input.draft.description ? { description: input.draft.description } : {}),
    ...(input.featureId ? { feature: input.featureId } : {}),
    startRoute: input.startRoute,
    steps: input.steps.map((s, i) => ({
      target: s.tourId,
      ...(s.advanceOn === 'click' ? { advanceOn: 'click' } : {}),
      text: input.draft.steps[i].text,
    })),
  };
  const node = doc.createNode(tour);
  const stamp = input.today ?? new Date().toISOString().slice(0, 10);
  node.commentBefore =
    input.draft.source === 'llm'
      ? ` DRAFT (LLM soạn ngày ${stamp}, ghi bằng tour:record): cần người duyệt chữ trước khi dùng.`
      : ` DRAFT (dựng bằng mẫu ngày ${stamp}, ghi bằng tour:record): hãy viết lại chữ cho tự nhiên.`;
  const about = (input.purpose ?? '').replace(/\s+/g, ' ').trim();
  if (about) node.commentBefore += `\n Người ghi mô tả: ${about.slice(0, 200)}`;
  // `tours: {}` viết kiểu flow thì mọi thứ thêm vào cũng bị in kiểu flow; đổi sang block cho dễ đọc
  const toursNode = doc.get('tours', true);
  if (isMap(toursNode)) (toursNode as YAMLMap).flow = false;
  doc.setIn(['tours', input.id], node);

  const addedQuestions = input.featureId ? addSampleQuestions(doc, input.featureId, input.draft.sampleQuestions) : [];

  return { yaml: String(doc), replaced, addedQuestions };
}

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
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
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
  featureId?: string;
  purpose?: string;
  force: boolean;
  today?: string;
}

export function readToursFile(file: string): ToursFile {
  if (!existsSync(file)) return { tours: {} };
  const raw = readFileSync(file, 'utf8');
  if (!raw.trim()) return { tours: {} };
  try {
    return toursFileSchema.parse(JSON.parse(raw));
  } catch (e) {
    throw new Error(`${file} không hợp lệ: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Gộp tour vào compass.tours.json. Không ghi đè tour đã có trừ khi --force; thứ tự khóa ổn định để diff gọn.
export function mergeTourIntoToursFile(file: string, input: ToursMergeInput): { json: string; replaced: boolean } {
  const data = readToursFile(file);
  const replaced = Boolean(data.tours[input.id]);
  if (replaced && !input.force) {
    throw new Error(`Tour "${input.id}" đã có trong ${file}. Dùng --force để ghi đè hoặc đặt --id khác.`);
  }
  const about = (input.purpose ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const tour: RecordedTour = {
    title: input.draft.title,
    ...(input.draft.description ? { description: input.draft.description } : {}),
    ...(input.featureId ? { feature: input.featureId } : {}),
    startRoute: input.startRoute,
    draft: true,
    draftSource: input.draft.source,
    recordedAt: input.today ?? new Date().toISOString().slice(0, 10),
    ...(about ? { purpose: about } : {}),
    steps: input.steps.map((s, i) => ({
      key: `s${i + 1}`,
      ...(s.tourId ? { tourId: s.tourId } : {}),
      ...(s.locator ? { locator: s.locator } : {}),
      route: s.routePattern ?? s.route,
      advanceOn: s.advanceOn,
      text: input.draft.steps[i].text,
    })),
  };
  data.tours[input.id] = tour;
  return { json: JSON.stringify(data, null, 2) + '\n', replaced };
}

export function writeOverrides(file: string, yaml: string): void {
  writeFileSync(file, yaml);
}
