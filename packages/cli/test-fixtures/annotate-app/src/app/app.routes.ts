import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Routes } from '@angular/router';
import { ShellPage, InnerPage } from './shell';

@Component({ selector: 'app-orders', imports: [CommonModule], templateUrl: './orders.page.html' })
export class OrdersPage {}

// Không có thuộc tính imports; có mật khẩu và nút đăng nhập
@Component({
  selector: 'app-login',
  template: `<input type="password" name="pw"><input name="user"><button type="submit">Đăng nhập</button><button (click)="forgot()">Quên mật khẩu?</button>`,
})
export class LoginPage {}

@Component({ selector: 'app-legacy', standalone: false, template: `<button>Cũ</button>` })
export class LegacyPage {}

export const routes: Routes = [
  { path: 'orders', component: OrdersPage, data: { title: 'Sổ lệnh', description: 'Xem lệnh.' } },
  { path: 'login', component: LoginPage, data: { title: 'Đăng nhập', description: 'Đăng nhập.' } },
  { path: 'legacy', component: LegacyPage, data: { title: 'Cũ', description: 'Cũ.' } },
  { path: 'shell', component: ShellPage, children: [{ path: 'inner', component: InnerPage, data: { title: 'Trong khung', description: 'Trong khung.' } }] },
];
