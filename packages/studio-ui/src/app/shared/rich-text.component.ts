import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

// Hiện chữ có đoạn `mã` thành <code>, không dùng innerHTML
@Component({
  selector: 'ui-rich',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@for (p of parts(); track $index) { @if (p.code) { <code>{{ p.text }}</code> } @else { {{ p.text }} } }`,
})
export class RichTextComponent {
  readonly text = input.required<string>();
  protected readonly parts = computed(() => this.text().split('`').map((t, i) => ({ text: t, code: i % 2 === 1 })));
}
