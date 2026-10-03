import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../core/toast.service';
import { IconComponent } from './icon.component';

@Component({
  selector: 'ui-toasts',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (t of toasts.items(); track t.id) {
      <div class="toast" [class]="t.kind" role="status">
        <ui-icon [name]="t.kind === 'success' ? 'check-circle' : t.kind === 'danger' ? 'x-circle' : 'info'" />
        <span class="grow">{{ t.text }}</span>
        <button class="btn btn-ghost btn-icon btn-sm" (click)="toasts.dismiss(t.id)" aria-label="Đóng"><ui-icon name="x" [size]="14" /></button>
      </div>
    }
  `,
  styles: `
    :host { position: fixed; left: 50%; transform: translateX(-50%); bottom: 20px; z-index: 1000; display: flex; flex-direction: column; gap: 8px; width: 380px; }
    .toast { display: flex; align-items: center; gap: 10px; padding: 10px 10px 10px 14px; background: #fff; border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow-lg); font-size: 13.5px; }
    .toast.success ui-icon { color: var(--success); }
    .toast.danger { border-color: #fecdca; }
    .toast.danger ui-icon:first-child { color: var(--danger); }
    .toast.info ui-icon:first-child { color: var(--primary); }
  `,
})
export class ToastsComponent {
  protected readonly toasts = inject(ToastService);
}
