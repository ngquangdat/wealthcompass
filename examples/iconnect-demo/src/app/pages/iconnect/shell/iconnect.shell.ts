import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TourIdDirective } from '@wealthcompass/angular';

// Khung iConnect: nội dung từng tab + thanh tab dưới. Các tourId ở đây hiện trên mọi tab con.
@Component({
  selector: 'app-iconnect-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TourIdDirective],
  template: `
    <div class="content"><router-outlet /></div>
    <nav class="bb">
      <a class="bb-item" routerLink="/iconnect/price-board" routerLinkActive="active" tourId="iconnect-tab-board" tourLabel="Tab Bảng giá" tourHint="Bảng giá trái phiếu iConnect">
        <span class="material-icons">handshake</span>Bảng giá
      </a>
      <a class="bb-item" routerLink="/iconnect/orders" routerLinkActive="active" tourId="iconnect-tab-orders" tourLabel="Tab Sổ lệnh" tourHint="Sổ lệnh trái phiếu">
        <span class="material-icons">receipt_long</span>Sổ lệnh
      </a>
      <a class="bb-item" routerLink="/iconnect/assets" routerLinkActive="active" tourId="iconnect-tab-assets" tourLabel="Tab Tài sản" tourHint="Danh mục trái phiếu đang nắm giữ">
        <span class="material-icons">pie_chart</span>Tài sản
      </a>
      <a class="bb-item" routerLink="/iconnect/cashflow" routerLinkActive="active" tourId="iconnect-tab-cashflow" tourLabel="Tab Dòng tiền" tourHint="Dòng tiền trái phiếu">
        <span class="material-icons">currency_exchange</span>Dòng tiền
      </a>
      <a class="bb-item" routerLink="/iconnect/pnl" routerLinkActive="active" tourId="iconnect-tab-pnl" tourLabel="Tab Lãi lỗ" tourHint="Lãi lỗ trái phiếu">
        <span class="material-icons">import_export</span>Lãi lỗ
      </a>
      <a class="bb-item" routerLink="/menu" routerLinkActive="active"><span class="material-icons">menu</span>Menu</a>
    </nav>
  `,
  styles: `
    :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .content { flex: 1; min-height: 0; display: flex; flex-direction: column; position: relative; }
    .content > ::ng-deep :not(router-outlet) { flex: 1; min-height: 0; }
  `,
})
export class IconnectShell {}
