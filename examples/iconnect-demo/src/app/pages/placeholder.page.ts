import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

// Màn hình giữ chỗ cho các tính năng ngoài phạm vi demo, nhưng vẫn có route/title/description
// để scanner đưa vào Feature Map và trợ lý có thể chỉ đường tới.
@Component({
  selector: 'app-placeholder-page',
  template: `
    <header class="page-header">
      <button class="back" type="button" (click)="back()" aria-label="Quay lại"><span class="material-icons">arrow_back</span></button>
      <span class="title">{{ title }}</span>
    </header>
    <div class="body">
      <span class="material-icons big">construction</span>
      <h3>{{ title }}</h3>
      <p>{{ description }}</p>
      <small>Màn hình mô phỏng, nằm ngoài phạm vi demo.</small>
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; flex: 1; min-height: 0; background: var(--card); }
    .back { background: transparent; border: 0; color: var(--text); display: grid; padding: 0; }
    .body { padding: 40px 24px; text-align: center; color: var(--text-2); display: flex; flex-direction: column; align-items: center; gap: 10px; }
    .big { font-size: 48px; color: var(--elev-2); }
    h3 { margin: 0; color: var(--text); font-weight: 500; }
    p { margin: 0; font-size: 14px; line-height: 1.5; }
    small { margin-top: 14px; color: #777; }
  `,
})
export class PlaceholderPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly title = (this.route.snapshot.data['title'] as string) ?? '';
  protected readonly description = (this.route.snapshot.data['description'] as string) ?? '';

  protected back(): void {
    void this.router.navigateByUrl('/home');
  }
}
