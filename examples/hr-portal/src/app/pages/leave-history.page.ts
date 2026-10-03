import { Component, signal } from '@angular/core';

@Component({
  selector: 'hr-leave-history',
  template: `
    <section class="page">
      <h2>Lịch sử nghỉ phép</h2>
      <table>
        <thead><tr><th>Từ</th><th>Đến</th><th>Loại</th><th>Trạng thái</th><th></th></tr></thead>
        <tbody>
          @for (r of rows(); track r.id) {
            <tr>
              <td>{{ r.from }}</td><td>{{ r.to }}</td><td>{{ r.type }}</td><td>{{ r.status }}</td>
              <td>@if (r.status === 'Chờ duyệt') { <button (click)="cancel(r.id)">Hủy đơn</button> }</td>
            </tr>
          }
        </tbody>
      </table>
    </section>
  `,
  styles: `
    .page { padding: 24px; }
    table { background: #fff; border-collapse: collapse; width: 100%; }
    th, td { padding: 10px; border-bottom: 1px solid #eef1f5; text-align: left; }
  `,
})
export class LeaveHistoryPage {
  protected readonly rows = signal([
    { id: 1, from: '02/10', to: '03/10', type: 'Phép năm', status: 'Đã duyệt' },
    { id: 2, from: '20/10', to: '21/10', type: 'Phép năm', status: 'Chờ duyệt' },
  ]);

  protected cancel(id: number): void {
    this.rows.update((list) => list.filter((r) => r.id !== id));
  }
}
