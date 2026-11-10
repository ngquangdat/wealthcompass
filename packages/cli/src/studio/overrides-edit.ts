import { exists, readText, writeText } from '@wealthcompass/tourdb';
import { Document, YAMLMap, YAMLSeq, isMap, isScalar, isSeq, parseDocument } from 'yaml';

// Sửa một màn hình trong compass.overrides.yaml từ Studio, giữ nguyên chú thích và phần khác của file.
// Trường nào người vừa sửa thì coi như đã duyệt: bỏ khỏi llmDraft; hết llmDraft thì bỏ luôn dòng DRAFT.

export type EditableField = 'title' | 'description' | 'keywords' | 'sampleQuestions' | 'facets' | 'hidden' | 'requires';
export type FeatureChanges = Partial<{
  title: string | null;
  description: string | null;
  keywords: string[];
  sampleQuestions: string[];
  facets: Record<string, string>;
  hidden: boolean;
  // Quyền ghi đè cho riêng màn hình; null = bỏ ghi đè, dùng lại quyền từ guard. [] là "không cần quyền riêng", khác null
  requires: string[] | null;
}>;

function load(file: string): Document {
  const text = exists(file) ? readText(file) : '';
  const doc = text.trim() ? parseDocument(text) : new Document({});
  if (doc.errors.length) throw new Error(`${file} không phải YAML hợp lệ: ${doc.errors[0].message}`);
  return doc;
}

function featureMap(doc: Document, id: string): YAMLMap {
  const features = doc.get('features', true);
  if (isMap(features)) (features as YAMLMap).flow = false;
  let node = doc.getIn(['features', id], true);
  if (!isMap(node)) {
    doc.setIn(['features', id], doc.createNode({}));
    node = doc.getIn(['features', id], true);
  }
  (node as YAMLMap).flow = false;
  return node as YAMLMap;
}

// Bỏ đúng các dòng chú thích DRAFT, giữ chú thích khác. Khi đọc lại file, thư viện YAML có thể gắn chú thích
// trước khóa đầu tiên vào chính khối map thay vì vào khóa, nên phải xử lý cả hai chỗ.
function withoutDraft(comment: string | null | undefined): string | undefined {
  if (!comment) return comment ?? undefined;
  const rest = comment.split('\n').filter((l) => !l.includes('DRAFT'));
  return rest.length ? rest.join('\n') : undefined;
}

function dropDraftComment(map: YAMLMap): void {
  map.commentBefore = withoutDraft(map.commentBefore);
  for (const pair of map.items) {
    if (isScalar(pair.key)) pair.key.commentBefore = withoutDraft(pair.key.commentBefore);
  }
}

function markReviewed(map: YAMLMap, fields: string[]): void {
  const draft = map.get('llmDraft', true);
  if (!isSeq(draft)) return;
  const rest = ((draft as YAMLSeq).toJSON() as string[]).filter((f) => !fields.includes(f));
  if (rest.length) map.set('llmDraft', rest);
  else {
    map.delete('llmDraft');
    dropDraftComment(map);
  }
}

export function updateFeature(file: string, id: string, changes: FeatureChanges): void {
  const doc = load(file);
  const map = featureMap(doc, id);
  const touched: string[] = [];
  for (const [key, value] of Object.entries(changes) as Array<[EditableField, unknown]>) {
    if (value === undefined) continue;
    touched.push(key);
    const empty = value === null || value === '' || (Array.isArray(value) && value.length === 0 && key !== 'requires') || (key === 'hidden' && value === false) ||
      (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0);
    // Rỗng = bỏ ghi đè, quay về giá trị lấy từ code
    if (empty) map.delete(key);
    else map.set(doc.createNode(key), doc.createNode(value));
  }
  markReviewed(map, touched);
  if (map.items.length === 0) (doc.get('features', true) as YAMLMap).delete(id);
  writeText(file, String(doc));
}

export function approveFeature(file: string, id: string): void {
  const doc = load(file);
  const node = doc.getIn(['features', id], true);
  if (!isMap(node)) return;
  const map = node as YAMLMap;
  map.delete('llmDraft');
  dropDraftComment(map);
  writeText(file, String(doc));
}

export function readOverrides(file: string): Record<string, Record<string, unknown>> {
  if (!exists(file)) return {};
  const json = load(file).toJSON() as { features?: Record<string, Record<string, unknown>> } | null;
  return json?.features ?? {};
}
