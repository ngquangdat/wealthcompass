import { parse } from 'angular-html-parser';
import type { Sensitivity } from '@wealthcompass/contracts';
import { menuTourId } from '@wealthcompass/core';

// Đánh dấu "template có [tourMenu] động": trình quét thay bằng một mốc cho mỗi mục trong dữ liệu menu
export const MENU_TARGETS = '*menu*';

export interface TemplateTarget {
  tourId: string;
  label?: string;
  hint?: string;
  sensitivity: Sensitivity;
}

export interface TemplateInfo {
  targets: TemplateTarget[];
  // Chữ tĩnh người dùng nhìn thấy (tiêu đề, nhãn, nút, placeholder...); dùng làm ngữ cảnh cho LLM soạn mô tả
  texts: string[];
  // Tên thẻ trong template (để lần theo component con qua selector)
  tags: Set<string>;
}

interface LooseNode {
  value?: string;
  name?: string;
  attrs?: Array<{ name: string; value: string }>;
  children?: LooseNode[];
}

// Lấy giá trị chuỗi tĩnh từ `attr="x"` hoặc `[attr]="'x'"`
function staticValue(attrs: Array<{ name: string; value: string }>, name: string): string | undefined {
  for (const attr of attrs) {
    if (attr.name === name) return attr.value;
    if (attr.name === `[${name}]`) {
      const match = attr.value.trim().match(/^(['"])(.*)\1$/);
      if (match) return match[2];
    }
  }
  return undefined;
}

// Thuộc tính mang chữ cho người dùng; tourLabel/tourHint do dev viết nên cũng là nguồn nghĩa tốt
const TEXT_ATTRS = ['placeholder', 'aria-label', 'title', 'alt', 'tourLabel', 'tourHint'];
const SKIP_TEXT_IN = new Set(['style', 'script', 'svg']);

// Giữ phần chữ cố định, bỏ phần nội suy {{ ... }}; bỏ chuỗi không có chữ cái
function cleanText(raw: string): string | null {
  const text = raw.replace(/\{\{[\s\S]*?\}\}/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length >= 2 && /\p{L}/u.test(text) ? text.slice(0, 80) : null;
}

// Phân tích template bằng angular-html-parser (không gắn với phiên bản compiler của Angular).
// Hiểu cả @if/@for (block) lẫn *ngIf vì chỉ đi theo `children` và `attrs`.
export function analyzeTemplate(html: string): TemplateInfo {
  const result = parse(html, { canSelfClose: true, tokenizeAngularBlocks: true, tokenizeAngularLetDeclaration: true, isTagNameCaseSensitive: true });
  const targets: TemplateTarget[] = [];
  const tags = new Set<string>();
  const texts: string[] = [];
  const addText = (raw: string | undefined) => {
    const t = raw ? cleanText(raw) : null;
    if (t && !texts.includes(t)) texts.push(t);
  };

  const visit = (node: LooseNode) => {
    // Nút chữ: có value và không có tên thẻ
    if (typeof node.value === 'string' && !node.name) addText(node.value);
    if (typeof node.name === 'string' && node.name && Array.isArray(node.attrs)) {
      if (SKIP_TEXT_IN.has(node.name)) return;
      tags.add(node.name);
      for (const attr of TEXT_ATTRS) addText(staticValue(node.attrs, attr));
      const menu = node.attrs.find((a) => a.name === 'tourMenu' || a.name === '[tourMenu]');
      if (menu) {
        const route = staticValue(node.attrs, 'tourMenu');
        if (route !== undefined) targets.push({ tourId: menuTourId(route), label: staticValue(node.attrs, 'tourLabel'), sensitivity: 'normal' });
        else if (!targets.some((t) => t.tourId === MENU_TARGETS)) targets.push({ tourId: MENU_TARGETS, sensitivity: 'normal' });
      }
      const tourId = staticValue(node.attrs, 'tourId') ?? staticValue(node.attrs, 'data-tour-id');
      if (tourId) {
        const role = staticValue(node.attrs, 'tourRole');
        targets.push({
          tourId,
          label: staticValue(node.attrs, 'tourLabel'),
          hint: staticValue(node.attrs, 'tourHint'),
          sensitivity: role === 'user-only' ? 'user-only' : 'normal',
        });
      }
    }
    (node.children ?? []).forEach(visit);
  };
  (result.rootNodes as unknown as LooseNode[]).forEach(visit);
  return { targets, texts, tags };
}
