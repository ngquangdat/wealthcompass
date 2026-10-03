import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Document, YAMLMap, YAMLSeq, isMap, isSeq, parseDocument } from 'yaml';
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

  // Câu hỏi mẫu: hợp với câu đã có, không trùng, không xóa
  let addedQuestions: string[] = [];
  if (input.featureId && input.draft.sampleQuestions.length) {
    const path = ['features', input.featureId, 'sampleQuestions'];
    const seq = doc.getIn(path, true);
    const current: string[] = isSeq(seq) ? ((seq as YAMLSeq).toJSON() as string[]) : [];
    const have = new Set(current.map((q) => q.toLowerCase()));
    addedQuestions = input.draft.sampleQuestions.filter((q) => !have.has(q.toLowerCase()));
    if (isSeq(seq)) {
      // Thêm vào dãy sẵn có để giữ nguyên chú thích của từng câu cũ
      for (const q of addedQuestions) (seq as YAMLSeq).add(doc.createNode(q));
    } else if (addedQuestions.length) {
      doc.setIn(path, doc.createNode(addedQuestions));
    }
  }

  return { yaml: String(doc), replaced, addedQuestions };
}

export function writeOverrides(file: string, yaml: string): void {
  writeFileSync(file, yaml);
}
