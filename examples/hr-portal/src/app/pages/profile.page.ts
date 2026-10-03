import { Component, inject } from '@angular/core';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'hr-profile',
  template: `
    <section class="page">
      <h2>Hồ sơ cá nhân</h2>
      <p>Họ tên: {{ auth.user()?.name }}</p>
      <p>Vai trò: {{ auth.roles().join(', ') }}</p>
      <h3>Đổi mật khẩu</h3>
      <input type="password" name="newPassword" placeholder="Mật khẩu mới" />
      <button>Cập nhật mật khẩu</button>
    </section>
  `,
  styles: `.page { padding: 24px; } input { padding: 8px; margin-right: 8px; }`,
})
export class ProfilePage {
  protected readonly auth = inject(AuthService);
}
