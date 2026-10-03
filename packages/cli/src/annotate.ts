import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parse } from 'angular-html-parser';
import { ClassDeclaration, Node } from 'ts-morph';
import { addEdit, addToDecoratorArray, buildGitPatch, decoratorArg, importEdit, type EditSet } from './codemod';
import { normalizeVi } from '@wealthcompass/core';
import { loadConfig, scan } from './scan';

// annotate: quét template, gợi ý tourId cho phần tử tương tác chưa có, và XUẤT PATCH.
// Không bao giờ tự ghi vào code: tourId là hợp đồng giữa template và tour, nên người phải xem và duyệt.

export type CandidateKind = 'button' | 'link' | 'input' | 'tab' | 'other';

export interface Sensitivity {
  // sure: chắc chắn nhạy cảm (nộp, mật khẩu, nút gửi/đặt lệnh...). maybe: có dấu hiệu, người cần xem lại
  level: 'sure' | 'maybe';
  reason: string;
}

export interface Candidate {
  tourId: string;
  tag: string;
  kind: CandidateKind;
  label: string | null;
  sensitive: Sensitivity | null;
  screen: string; // đường dẫn route của màn hình/khung chứa phần tử
  file: string; // file template (.html hoặc .ts nếu template nằm trong component)
  line: number;
  component: string;
  // Vị trí chèn thuộc tính trong file (đã tính cả offset nếu template nằm trong .ts)
  offset: number;
}

export interface SkippedComponent {
  component: string;
  file: string;
  reason: string;
  count: number;
}

export interface AnnotateOptions {
  config: string;
  only?: string[];
  // Module chứa TourIdDirective, để chèn import vào component
  directiveImport?: string;
  // Đường dẫn file patch; null = không ghi file (chỉ trả về nội dung)
  out?: string | null;
}

export interface AnnotateResult {
  candidates: Candidate[];
  skipped: SkippedComponent[];
  patch: string;
  patchFile: string | null;
  patchFileCount: number;
  applyHint: string | null;
  // Các chỗ sửa (chưa áp) để setup gộp chung vào một patch
  edits: EditSet;
}

// ---------------------------------------------------------------------------
// Phát hiện phần tử nhạy cảm
// ---------------------------------------------------------------------------

// Cụm đúng nguyên văn của nút hành động (đã bỏ dấu, chữ thường)
const SURE_LABELS = new Set([
  'mua', 'ban', 'dat lenh', 'dat mua', 'dat ban', 'xac nhan', 'dong y', 'gui', 'gui lenh', 'thanh toan', 'chuyen tien',
  'rut tien', 'nop tien', 'huy lenh', 'xoa', 'hoan tat', 'xac thuc', 'dang ky mua',
]);
const SURE_FIELD = /\b(otp|pin|cvv|cvc|password|passwd|passcode|matkhau|mat khau)\b/;
// Chỉ là dấu hiệu: từ xuất hiện trong chữ/tên hàm/tên trường
// Từ đơn chỉ gồm những từ ít gây nhầm; các từ như "toan" (trong "toàn thị trường") hay "xac", "nhan" phải đi theo cụm
const MAYBE_WORDS = new Set([
  'mua', 'ban', 'lenh', 'chuyen', 'rut', 'xoa', 'huy', 'gui', 'submit', 'confirm', 'order',
  'buy', 'sell', 'pay', 'transfer', 'withdraw', 'deposit', 'delete', 'cancel', 'place', 'checkout',
]);
const MAYBE_PHRASES = ['xac nhan', 'thanh toan', 'chuyen khoan', 'dang ky'];

export interface SensitivityInput {
  tag: string;
  kind: CandidateKind;
  type?: string;
  autocomplete?: string;
  label?: string | null;
  // Các chuỗi định danh khác: name, id, formControlName, tên hàm trong (click), class...
  identifiers: string[];
  navigates: boolean;
}

export function detectSensitive(input: SensitivityInput): Sensitivity | null {
  // Link chuyển trang chỉ đưa người dùng tới màn hình khác, không phải hành động
  if (input.navigates) return null;
  const type = (input.type ?? '').toLowerCase();
  const ac = (input.autocomplete ?? '').toLowerCase();
  if (type === 'password') return { level: 'sure', reason: 'ô mật khẩu' };
  if (ac === 'one-time-code' || ac.startsWith('cc-')) return { level: 'sure', reason: 'ô OTP/thẻ' };
  if (type === 'submit') return { level: 'sure', reason: 'nút gửi biểu mẫu (type=submit)' };

  const ids = input.identifiers.map((i) => normalizeVi(i.replace(/([a-z])([A-Z])/g, '$1 $2')));
  if (ids.some((i) => SURE_FIELD.test(i))) return { level: 'sure', reason: 'tên trường là mật khẩu/OTP/PIN/CVV' };

  const label = input.label ? normalizeVi(input.label) : '';
  if (label && SURE_LABELS.has(label) && input.kind !== 'input') return { level: 'sure', reason: `chữ "${input.label}" là nút hành động` };

  if (input.kind === 'input' || input.kind === 'link') return null;
  const phrase = MAYBE_PHRASES.find((p) => ` ${label} `.includes(` ${p} `));
  if (phrase) return { level: 'maybe', reason: `chữ có cụm "${phrase}"` };
  const tokens = new Set([...label.split(' '), ...ids.flatMap((i) => i.split(' '))].filter(Boolean));
  const hit = [...tokens].find((t) => MAYBE_WORDS.has(t));
  if (hit) return { level: 'maybe', reason: `có từ "${hit}" trong chữ hoặc tên hàm` };
  return null;
}

// ---------------------------------------------------------------------------
// Đặt tên: <màn-hình>-<phần-tử>
// ---------------------------------------------------------------------------

export function slug(text: string, maxWords = 4, maxLen = 32): string {
  const words = normalizeVi(text).split(' ').filter(Boolean).slice(0, maxWords);
  return words.join('-').slice(0, maxLen).replace(/-+$/, '');
}

// Phần tên màn hình: đoạn cuối của route, bỏ tham số (:id); gốc → home
export function screenSlug(routePath: string): string {
  const segments = routePath.split('/').filter((s) => s && !s.startsWith(':'));
  return slug(segments.at(-1) ?? 'home', 3, 24) || 'home';
}

// ---------------------------------------------------------------------------
// Phân tích một template
// ---------------------------------------------------------------------------

interface RawCandidate {
  tag: string;
  kind: CandidateKind;
  label: string | null;
  identifiers: string[];
  type?: string;
  autocomplete?: string;
  navigates: boolean;
  insertAt: number; // offset trong chính template
}

interface LooseAttr {
  name: string;
  value: string;
}
interface LooseNode {
  name?: string;
  value?: string;
  attrs?: LooseAttr[];
  children?: LooseNode[];
  startSourceSpan?: { start: { offset: number } };
}

const attr = (n: LooseNode, name: string): string | undefined => {
  const hit = n.attrs?.find((a) => a.name === name || a.name === `[${name}]` || a.name === `[attr.${name}]`);
  return hit?.value;
};
const has = (n: LooseNode, name: string): boolean => Boolean(n.attrs?.some((a) => a.name === name || a.name === `[${name}]`));

// Chữ tĩnh bên trong phần tử (bỏ nội suy, bỏ icon font và svg)
function innerText(node: LooseNode): string {
  const parts: string[] = [];
  const walk = (n: LooseNode) => {
    if (typeof n.value === 'string' && !n.name) {
      parts.push(n.value.replace(/\{\{[\s\S]*?\}\}/g, ' '));
      return;
    }
    if (n.name === 'mat-icon' || n.name === 'svg' || n.name === 'compass-icon') return;
    const cls = attr(n, 'class') ?? '';
    if (/material-icons|material-symbols/.test(cls)) return;
    (n.children ?? []).forEach(walk);
  };
  (node.children ?? []).forEach(walk);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// `ticket.set(h)` -> "set"; `auth.logout()` -> "logout"; `placeOrder(row)` -> "placeOrder".
// Chỉ lấy tên hàm được gọi: tên biến đứng trước (selectingSell.set) không nói gì về việc nút làm gì.
function handlerName(click: string): string | undefined {
  const call = click.trim().match(/^([\w$.]+)\s*\(/);
  return call ? call[1].split('.').at(-1) : undefined;
}

const INPUT_TAGS = new Set(['input', 'textarea', 'select', 'mat-select', 'mat-checkbox', 'mat-radio-button', 'mat-slide-toggle']);

function classify(n: LooseNode): CandidateKind | null {
  const tag = n.name ?? '';
  const role = (attr(n, 'role') ?? '').toLowerCase();
  if (tag === 'input') return (attr(n, 'type') ?? '').toLowerCase() === 'hidden' ? null : 'input';
  if (INPUT_TAGS.has(tag)) return 'input';
  if (role === 'tab' || has(n, 'mat-tab-link') || tag === 'mat-tab') return 'tab';
  if (tag === 'button' || role === 'button') return 'button';
  if (tag === 'a' && (has(n, 'routerLink') || has(n, 'href'))) return 'link';
  if (has(n, 'routerLink')) return 'link';
  if (has(n, '(click)')) return 'button';
  return null;
}

function containsInteractive(n: LooseNode): boolean {
  return (n.children ?? []).some((c) => (typeof c.name === 'string' && Array.isArray(c.attrs) && classify(c) !== null) || containsInteractive(c));
}

export function analyzeTemplateForAnnotate(html: string): RawCandidate[] {
  const result = parse(html, { canSelfClose: true, tokenizeAngularBlocks: true, tokenizeAngularLetDeclaration: true, isTagNameCaseSensitive: true });
  const out: RawCandidate[] = [];
  const visit = (n: LooseNode) => {
    if (typeof n.name === 'string' && n.name && Array.isArray(n.attrs) && n.startSourceSpan) {
      const kind = classify(n);
      const marked = has(n, 'tourId') || has(n, 'data-tour-id');
      const hidden = has(n, 'hidden') || has(n, '[hidden]');
      // Phần tử chung chung (div, section...) mà có (click) nhưng bao ngoài phần tử tương tác khác là khung chứa, không phải nút
      const container = kind !== null && n.name !== 'button' && n.name !== 'a' && containsInteractive(n);
      if (kind && !marked && !hidden && !container) {
        const click = attr(n, '(click)') ?? '';
        const label =
          attr(n, 'aria-label') || innerText(n) || attr(n, 'placeholder') || attr(n, 'title') || null;
        const routerLink = attr(n, 'routerLink');
        out.push({
          tag: n.name,
          kind,
          label: label ? label.slice(0, 60) : null,
          identifiers: [
            attr(n, 'name'), attr(n, 'id'), attr(n, 'formControlName'), attr(n, 'class'), handlerName(click),
            routerLink && !routerLink.includes('{{') ? routerLink.split('/').filter(Boolean).at(-1) : undefined,
          ].filter((x): x is string => Boolean(x)),
          type: attr(n, 'type'),
          autocomplete: attr(n, 'autocomplete'),
          navigates: kind === 'link',
          // Ngay sau tên thẻ: "<button" + chèn + phần còn lại
          insertAt: n.startSourceSpan.start.offset + 1 + n.name.length,
        });
      }
    }
    (n.children ?? []).forEach(visit);
  };
  (result.rootNodes as unknown as LooseNode[]).forEach(visit);
  return out;
}

// ---------------------------------------------------------------------------
// Nguồn template của component (file .html hoặc literal trong .ts)
// ---------------------------------------------------------------------------

interface TemplateSource {
  html: string;
  file: string;
  baseOffset: number;
  editable: boolean;
  why?: string;
}

function templateSource(cls: ClassDeclaration): TemplateSource | undefined {
  const arg = decoratorArg(cls);
  if (!arg) return undefined;
  const urlProp = arg.getProperty('templateUrl');
  if (urlProp && Node.isPropertyAssignment(urlProp)) {
    const init = urlProp.getInitializer();
    if (init && (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init))) {
      const file = resolve(dirname(cls.getSourceFile().getFilePath()), init.getLiteralText());
      try {
        return { html: readFileSync(file, 'utf8'), file, baseOffset: 0, editable: true };
      } catch {
        return undefined;
      }
    }
  }
  const tplProp = arg.getProperty('template');
  if (tplProp && Node.isPropertyAssignment(tplProp)) {
    const init = tplProp.getInitializer();
    if (init && (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init))) {
      const raw = init.getText().slice(1, -1);
      const file = cls.getSourceFile().getFilePath();
      // Chuỗi có ký tự thoát: vị trí trong chuỗi không còn khớp vị trí trong file, nên không dám sửa
      if (raw !== init.getLiteralText()) return { html: init.getLiteralText(), file, baseOffset: 0, editable: false, why: 'template trong .ts có ký tự thoát (\\), không tính được vị trí sửa' };
      return { html: raw, file, baseOffset: init.getStart() + 1, editable: true };
    }
    return { html: '', file: cls.getSourceFile().getFilePath(), baseOffset: 0, editable: false, why: 'template không phải chuỗi literal' };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Chỉnh component: import TourIdDirective (dùng codemod chung)
// ---------------------------------------------------------------------------

function isStandalone(cls: ClassDeclaration): boolean {
  const prop = decoratorArg(cls)?.getProperty('standalone');
  return !(prop && Node.isPropertyAssignment(prop) && prop.getInitializer()?.getText() === 'false');
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length;
}

// ---------------------------------------------------------------------------
// Chính
// ---------------------------------------------------------------------------

export function annotate(opts: AnnotateOptions): AnnotateResult {
  const directiveModule = opts.directiveImport ?? '@wealthcompass/angular';
  const { root } = loadConfig(opts.config);
  const { featureMap, contexts, layouts, project } = scan(opts.config);

  const only = opts.only?.length ? opts.only : null;
  const selected = (path: string, id?: string) => !only || only.some((o) => o === id || o === path || path.startsWith(o.endsWith('/') ? o : o + '/'));

  // Danh sách (màn hình, các component) cần quét: màn hình thường + khung chung (tab, header...)
  const units: Array<{ path: string; classes: ClassDeclaration[] }> = [];
  for (const f of featureMap.features) {
    const ctx = contexts[f.id];
    if (ctx && selected(f.route.pattern, f.id)) units.push({ path: f.route.pattern, classes: ctx.classes });
  }
  for (const l of layouts) {
    if (!only || units.some((u) => u.path === l.path || u.path.startsWith(l.path + '/'))) units.push({ path: l.path, classes: l.classes });
  }

  const taken = new Set<string>(featureMap.features.flatMap((f) => f.targets.map((t) => t.tourId)));
  const seenSpot = new Set<string>();
  const candidates: Candidate[] = [];
  const skipped: SkippedComponent[] = [];
  const touchedClasses = new Map<string, ClassDeclaration>(); // key: file#class

  for (const unit of units.sort((a, b) => a.path.localeCompare(b.path))) {
    for (const cls of unit.classes) {
      const className = cls.getName() ?? '(ẩn danh)';
      const src = templateSource(cls);
      if (!src) continue;
      if (!src.editable) {
        skipped.push({ component: className, file: src.file, reason: src.why ?? 'không sửa được template', count: 0 });
        continue;
      }
      const raws = analyzeTemplateForAnnotate(src.html);
      if (!raws.length) continue;

      if (!isStandalone(cls)) {
        skipped.push({ component: className, file: src.file, reason: 'component không standalone (khai trong NgModule): thêm TourIdDirective vào module rồi chạy lại', count: raws.length });
        continue;
      }
      const dir = addToDecoratorArray(cls, 'imports', 'TourIdDirective');
      if (dir.problem) {
        skipped.push({ component: className, file: src.file, reason: dir.problem, count: raws.length });
        continue;
      }

      let added = 0;
      for (const raw of raws) {
        const offset = src.baseOffset + raw.insertAt;
        const spot = `${src.file}:${offset}`;
        if (seenSpot.has(spot)) continue; // component dùng chung ở nhiều route: chỉ tính một lần
        seenSpot.add(spot);

        const screen = screenSlug(unit.path);
        const labelSlug = slug(raw.label ?? '');
        const part = /[a-z]/.test(labelSlug) ? labelSlug : raw.kind;
        let base = `${screen}-${part}`;
        if (raw.kind === 'input' && !base.endsWith('-input')) base += '-input';
        if (raw.kind === 'tab' && !base.endsWith('-tab')) base += '-tab';
        let tourId = base;
        for (let n = 2; taken.has(tourId); n++) tourId = `${base}-${n}`;
        taken.add(tourId);

        candidates.push({
          tourId,
          tag: raw.tag,
          kind: raw.kind,
          label: raw.label,
          sensitive: detectSensitive({ tag: raw.tag, kind: raw.kind, type: raw.type, autocomplete: raw.autocomplete, label: raw.label, identifiers: raw.identifiers, navigates: raw.navigates }),
          screen: unit.path,
          file: src.file,
          line: lineOf(src.file.endsWith('.ts') ? readFileSync(src.file, 'utf8') : src.html, offset),
          component: className,
          offset,
        });
        added++;
      }
      if (added) touchedClasses.set(`${cls.getSourceFile().getFilePath()}#${className}`, cls);
    }
  }

  const edits = annotationEdits(candidates, touchedClasses, directiveModule);
  const { patch, base, files } = buildGitPatch(edits, root);

  let patchFile: string | null = null;
  if (patch && opts.out !== null) {
    patchFile = resolve(opts.out ?? join(root, 'compass-annotate.patch'));
    writeFileSync(patchFile, patch);
  }
  const applyHint = patchFile ? `cd ${base} && git apply --check ${relative(base, patchFile) || patchFile} && git apply ${relative(base, patchFile) || patchFile}` : null;
  return { candidates, skipped, patch, patchFile, patchFileCount: files, applyHint, edits };
}

// Dựng chỗ sửa: thuộc tính tourId trên phần tử + TourIdDirective trong component
export function annotationEdits(candidates: Candidate[], classes: Map<string, ClassDeclaration>, directiveModule: string): EditSet {
  const edits: EditSet = new Map();
  for (const c of candidates) {
    const attrs = [`tourId="${c.tourId}"`];
    if (c.label) attrs.push(`tourLabel="${escapeAttr(c.label)}"`);
    if (c.sensitive) attrs.push('tourRole="user-only"');
    addEdit(edits, c.file, { pos: c.offset, text: ' ' + attrs.join(' ') });
  }
  const importedIn = new Set<string>();
  for (const cls of classes.values()) {
    const file = cls.getSourceFile();
    const path = file.getFilePath();
    for (const e of addToDecoratorArray(cls, 'imports', 'TourIdDirective').edits) addEdit(edits, path, e);
    if (!importedIn.has(path)) {
      importedIn.add(path);
      const ie = importEdit(file, directiveModule, 'TourIdDirective');
      if (ie) addEdit(edits, path, ie);
    }
  }
  return edits;
}

export function formatReport(result: AnnotateResult, base: string): string {
  const lines: string[] = [];
  const bySreen = new Map<string, Candidate[]>();
  for (const c of result.candidates) bySreen.set(c.screen, [...(bySreen.get(c.screen) ?? []), c]);
  for (const [screen, list] of bySreen) {
    lines.push(`\n${screen}  (${list[0].component} · ${relative(base, list[0].file)})`);
    for (const c of list) {
      const flag = c.sensitive ? (c.sensitive.level === 'sure' ? '  ⛔ user-only' : '  ⚠ user-only (cần xem lại)') : '';
      lines.push(`  ${c.tourId.padEnd(34)} ${c.kind.padEnd(7)} ${(c.label ? `"${c.label}"` : '(không có chữ)').padEnd(30)}${flag}${c.sensitive ? ` — ${c.sensitive.reason}` : ''}`);
    }
  }
  return lines.join('\n');
}
