import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login-page',
  imports: [FormsModule],
  templateUrl: './login.page.html',
  styleUrl: './login.page.scss',
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  // Tài khoản demo do IdP giả lập cấp; không phải tài khoản thật
  protected username = 'demo';
  protected password = 'demo123';
  protected readonly showPassword = signal(false);
  protected readonly error = signal('');
  protected readonly busy = signal(false);

  protected readonly cards = [
    { icon: 'computer', title: 'GD chứng khoán trực tuyến', text: 'Nơi quản lý và thực hiện các hoạt động giao dịch chứng khoán trực tuyến' },
    { icon: 'bar_chart', title: 'Bảng giá', text: 'Nơi theo dõi trực tuyến biến động giá của các loại chứng khoán và dòng cung - cầu chứng khoán' },
    { icon: 'analytics', title: 'Phân tích đầu tư', text: 'Nơi tổng hợp thông tin, dữ liệu, phân tích và đánh giá về cổ phiếu và các loại chứng khoán khác' },
    { icon: 'savings', title: 'Quản lý gia sản', text: 'Tư vấn, lập kế hoạch đầu tư và quản lý gia sản trọn đời' },
  ];

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.login(this.username, this.password);
      await this.router.navigateByUrl('/home');
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Không đăng nhập được');
    } finally {
      this.busy.set(false);
    }
  }
}
