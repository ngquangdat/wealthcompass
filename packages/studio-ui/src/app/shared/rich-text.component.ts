import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

// Hiện chữ có `mã` và **đậm** (cú pháp trợ lý và báo cáo dùng), giữ xuống dòng; không dùng innerHTML
@Component({
  selector: 'ui-rich',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@for (p of parts(); track $index) { @switch (p.kind) { @case ('code') { <code>{{ p.text }}</code> } @case ('bold') { <b>{{ p.text }}</b> } @default { {{ p.text }} } } }`,
  styles: `:host { white-space: pre-line; }`,
})
export class RichTextComponent {
  readonly text = input.required<string>();
  protected readonly parts = computed(() =>
    this.text()
      .split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/)
      .filter(Boolean)
      .map((t) =>
        t.startsWith('`') && t.endsWith('`') && t.length > 2
          ? { kind: 'code', text: t.slice(1, -1) }
          : t.startsWith('**') && t.endsWith('**') && t.length > 4
            ? { kind: 'bold', text: t.slice(2, -2) }
            : { kind: 'text', text: t },
      ),
  );
}
