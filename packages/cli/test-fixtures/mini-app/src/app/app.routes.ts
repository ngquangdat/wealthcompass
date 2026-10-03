import { Component } from '@angular/core';
import { Routes } from '@angular/router';

@Component({ selector: 'app-loans', template: `<h2>Khoản vay của tôi</h2><button>Tất toán</button><p>Dư nợ: {{ debt }}</p>` })
export class LoansPage {}

@Component({
  selector: 'app-cards',
  template: `<h2>Thẻ tín dụng</h2><p>Khóa thẻ, mở thẻ, xem sao kê thẻ</p><input placeholder="Số thẻ" /><button>Khóa thẻ</button><style>.a{color:red}</style>`,
})
export class CardsPage {}

@Component({ selector: 'app-blank', template: `` })
export class BlankPage {}

export const routes: Routes = [
  // Mô tả đã được viết tay; thiếu title (phải lấy từ nhãn menu) và thiếu keywords
  { path: 'loans', component: LoansPage, data: { description: 'Xem dư nợ và tất toán khoản vay (viết tay).' } },
  // Thiếu cả title, description, keywords, câu hỏi mẫu
  { path: 'cards', component: CardsPage },
  // Gần như không có thông tin
  { path: 'blank', component: BlankPage, data: { title: 'Trống' } },
];
