import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'hr-login',
  imports: [FormsModule],
  template: `
    <form class="card" (ngSubmit)="submit()">
      <h1>HR Portal</h1>
      <label>Tên đăng nhập <input name="username" [(ngModel)]="username" /></label>
      <label>Mật khẩu <input name="password" type="password" [(ngModel)]="password" /></label>
      @if (error()) { <p class="err">{{ error() }}</p> }
      <button type="submit">Đăng nhập</button>
      <small>Tài khoản thử: hr / demo123</small>
    </form>
  `,
  styles: `
    :host { display: grid; place-items: center; min-height: 100vh; background: #12355b; }
    .card { background: #fff; padding: 28px; border-radius: 10px; width: 300px; display: flex; flex-direction: column; gap: 12px; }
    label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
    input { padding: 8px; border: 1px solid #c8d0db; border-radius: 6px; }
    button { background: #1f6feb; color: #fff; border: 0; padding: 10px; border-radius: 6px; cursor: pointer; }
    .err { color: #c62828; margin: 0; }
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected username = 'hr';
  protected password = 'demo123';
  protected readonly error = signal('');

  protected async submit(): Promise<void> {
    try {
      await this.auth.login(this.username, this.password);
      await this.router.navigateByUrl('/dashboard');
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
}
