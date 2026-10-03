import { Component } from '@angular/core';

@Component({
  selector: 'hr-payslips',
  template: `
    <section class="page">
      <h2>Phiếu lương</h2>
      <ul>
        @for (m of months; track m) {
          <li>Kỳ {{ m }} <button (click)="download(m)">Tải PDF</button></li>
        }
      </ul>
      <p class="note">Phiếu lương chỉ người có quyền bảng lương mới xem được.</p>
    </section>
  `,
  styles: `.page { padding: 24px; } li { background: #fff; margin: 6px 0; padding: 10px; border-radius: 6px; display: flex; justify-content: space-between; max-width: 420px; }`,
})
export class PayslipsPage {
  protected readonly months = ['10/2026', '09/2026', '08/2026'];
  protected download(month: string): void {
    alert(`Demo: tải phiếu lương ${month}`);
  }
}
