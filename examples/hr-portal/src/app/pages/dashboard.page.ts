import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'hr-dashboard',
  imports: [RouterLink],
  template: `
    <section class="page">
      <h2>Tổng quan</h2>
      <div class="cards">
        <div class="card"><b>9</b><span>Ngày phép còn lại</span></div>
        <div class="card"><b>2</b><span>Đơn đang chờ duyệt</span></div>
        <div class="card"><b>10/2026</b><span>Kỳ lương gần nhất</span></div>
      </div>
      <div class="actions">
        <a routerLink="/leave/request">Tạo đơn nghỉ</a>
        <a routerLink="/payslips">Xem phiếu lương</a>
      </div>
    </section>
  `,
  styles: `
    .page { padding: 24px; }
    .cards { display: flex; gap: 16px; }
    .card { background: #fff; border-radius: 8px; padding: 16px; display: flex; flex-direction: column; min-width: 160px; }
    .card b { font-size: 26px; color: #12355b; }
    .actions { margin-top: 20px; display: flex; gap: 12px; }
    .actions a { background: #1f6feb; color: #fff; padding: 8px 14px; border-radius: 6px; text-decoration: none; }
  `,
})
export class DashboardPage {}
