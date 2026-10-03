import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { NAVIGATION } from './nav';

@Component({
  selector: 'hr-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <aside>
      <div class="brand">HR Portal</div>
      @for (entry of nav; track entry.title) {
        @if (entry.link) {
          <a [routerLink]="entry.link" routerLinkActive="on">{{ entry.title }}</a>
        } @else {
          <div class="group">{{ entry.title }}</div>
          @for (child of entry.items; track child.title) {
            <a class="child" [routerLink]="child.link" routerLinkActive="on">{{ child.title }}</a>
          }
        }
      }
      <button class="logout" (click)="auth.logout()">Đăng xuất</button>
    </aside>
    <main>
      <header>Xin chào, {{ auth.user()?.name }}</header>
      <router-outlet />
    </main>
  `,
  styles: `
    :host { display: flex; min-height: 100vh; }
    aside { width: 220px; background: #12355b; color: #fff; padding: 16px 12px; display: flex; flex-direction: column; gap: 4px; }
    .brand { font-weight: 700; font-size: 18px; margin-bottom: 16px; }
    a { color: #dbe7f5; text-decoration: none; padding: 8px 10px; border-radius: 6px; }
    a.on, a:hover { background: #1f4d80; color: #fff; }
    .child { padding-left: 22px; }
    .group { margin-top: 10px; font-size: 12px; text-transform: uppercase; color: #9db6d3; padding: 4px 10px; }
    .logout { margin-top: auto; background: transparent; border: 1px solid #5d7ea3; color: #fff; padding: 8px; border-radius: 6px; cursor: pointer; }
    main { flex: 1; background: #f4f6f9; }
    header { padding: 16px 24px; background: #fff; border-bottom: 1px solid #e3e7ee; }
  `,
})
export class ShellComponent {
  protected readonly auth = inject(AuthService);
  protected readonly nav = NAVIGATION;
}
