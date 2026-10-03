import { parse } from 'angular-html-parser';
import type { Sensitivity } from '@wealthcompass/contracts';

export interface TemplateTarget {
  tourId: string;
  label?: string;
  hint?: string;
  sensitivity: Sensitivity;
}

export interface TemplateInfo {
  targets: TemplateTarget[];
  // Tên thẻ trong template (để lần theo component con qua selector)
  tags: Set<string>;
}

interface LooseNode {
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

// Phân tích template bằng angular-html-parser (không gắn với phiên bản compiler của Angular).
// Hiểu cả @if/@for (block) lẫn *ngIf vì chỉ đi theo `children` và `attrs`.
export function analyzeTemplate(html: string): TemplateInfo {
  const result = parse(html, { canSelfClose: true, tokenizeAngularBlocks: true, tokenizeAngularLetDeclaration: true, isTagNameCaseSensitive: true });
  const targets: TemplateTarget[] = [];
  const tags = new Set<string>();

  const visit = (node: LooseNode) => {
    if (typeof node.name === 'string' && node.name && Array.isArray(node.attrs)) {
      tags.add(node.name);
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
  return { targets, tags };
}
