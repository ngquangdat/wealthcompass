import { CUSTOM_ELEMENTS_SCHEMA, Component, inject } from '@angular/core';
import { AuthService } from '../core/auth.service';

// Thanh trên cùng (desktop), cao 60px như app-toolbar > mat-toolbar của web thật.
@Component({
  selector: 'app-toolbar',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <mat-toolbar class="mat-toolbar">
      <div class="search"><span class="material-icons">search</span><span>Tìm kiếm</span></div>
      <span class="grow"></span>
      <span class="material-icons ic">calendar_month</span>
      <span class="material-icons ic">notifications</span>
      <span class="user">{{ auth.user()?.name }}</span>
      <button class="avatar" type="button" aria-label="Tài khoản" title="Đăng xuất (demo)" (click)="auth.logout()">
        <span class="material-icons">person</span>
      </button>
    </mat-toolbar>
  `,
  styles: `
    :host { display: block; height: 60px; }
    .mat-toolbar { display: flex; align-items: center; gap: 16px; height: 60px; padding: 0 16px; background: var(--header); }
    .search { width: 320px; height: 36px; border-radius: 18px; background: var(--elev); display: flex; align-items: center; gap: 8px; padding: 0 12px; color: var(--text-2); font-size: 14px; }
    .grow { flex: 1; }
    .ic { color: var(--text); font-size: 22px; }
    .user { color: var(--text-2); font-size: 14px; }
    .avatar { width: 36px; height: 36px; border-radius: 50%; border: 0; background: #cdd6e4; color: #44546a; display: grid; place-items: center; }
  `,
})
export class ToolbarComponent {
  protected readonly auth = inject(AuthService);
}
