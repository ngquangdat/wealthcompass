import { Component } from '@angular/core';
import { Routes } from '@angular/router';
import { adminGuard, authGuard, reportsGuard } from './core/guards';

@Component({ selector: 'p-orders', template: `<h2>Đơn của tôi</h2><button>Hủy đơn</button>` })
export class OrdersPage {}
@Component({ selector: 'p-returns', template: `<h2>Trả hàng</h2><button type="submit">Gửi yêu cầu</button>` })
export class ReturnsPage {}
@Component({ selector: 'p-reports', template: `<h2>Báo cáo doanh thu</h2>` })
export class ReportsPage {}
@Component({ selector: 'p-admin', template: `<h2>Quản trị</h2>` })
export class AdminPage {}

export const routes: Routes = [
  {
    path: '',
    canActivate: [authGuard],
    children: [
      { path: 'orders', component: OrdersPage, data: { description: 'Xem và hủy đơn hàng.' } },
      { path: 'orders/returns', component: ReturnsPage },
      { path: 'reports', component: ReportsPage, canActivate: [reportsGuard] },
      { path: 'admin', component: AdminPage, canActivate: [adminGuard] },
    ],
  },
];
