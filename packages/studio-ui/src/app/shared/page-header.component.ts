import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'ui-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="text">
      <h1>{{ title() }}</h1>
      @if (subtitle()) { <p class="muted">{{ subtitle() }}</p> }
    </div>
    <div class="actions"><ng-content /></div>
  `,
  styles: `
    :host { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px 16px; margin-bottom: 24px; }
    .text { flex: 1 1 320px; min-width: 0; }
    .text p { margin-top: 4px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  `,
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string>();
}
