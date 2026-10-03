import { ChangeDetectionStrategy, Component, ElementRef, effect, input, viewChild } from '@angular/core';

// Khung log nền tối, tự cuộn xuống cuối
@Component({
  selector: 'ui-log-console',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<pre #box>@for (l of lines(); track $index) {<span [class.err]="isError(l)" [class.ok]="isOk(l)">{{ l }}</span>
}@if (!lines().length) {<span class="dim">{{ placeholder() }}</span>}</pre>`,
  styles: `
    pre { margin: 0; background: #0f1217; color: #d0d5dd; border-radius: 8px; padding: 12px 14px; font: 12.5px/1.6 var(--mono); white-space: pre-wrap; word-break: break-word; overflow: auto; }
    .err { color: #fda29b; } .ok { color: #75e0a7; } .dim { color: #667085; }
  `,
  host: { '[style.--h]': 'height()' },
})
export class LogConsoleComponent {
  readonly lines = input<string[]>([]);
  readonly height = input('260px');
  readonly placeholder = input('Chưa có log.');
  private readonly box = viewChild<ElementRef<HTMLPreElement>>('box');

  constructor() {
    effect(() => {
      this.lines();
      const el = this.box()?.nativeElement;
      if (el) {
        el.style.height = this.height();
        queueMicrotask(() => (el.scrollTop = el.scrollHeight));
      }
    });
  }

  protected isError(l: string): boolean {
    return /lỗi|error|!|✘|không/i.test(l) && !/✔/.test(l);
  }
  protected isOk(l: string): boolean {
    return /✔|xong|đã ghi|listening|hợp lệ/i.test(l);
  }
}
