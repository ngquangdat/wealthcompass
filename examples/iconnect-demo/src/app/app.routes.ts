import { Routes } from '@angular/router';
import { authGuard, bondAccountGuard } from './core/guards';
import { LoginPage } from './pages/login/login.page';
import { HomePage } from './pages/home/home.page';
import { PlaceholderPage } from './pages/placeholder.page';
import { MenuPage } from './pages/menu.page';

export const routes: Routes = [
  { path: 'login', component: LoginPage, data: { title: 'Đăng nhập', hidden: true } },
  {
    path: '',
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'home', pathMatch: 'full' },
      {
        path: 'home',
        component: HomePage,
        data: {
          title: 'Trang chủ',
          description: 'Tổng quan tài khoản: tổng tiền, nộp tiền, chuyển tiền, tính năng ưa thích, cơ cấu tài sản, khám phá sản phẩm và chỉ số chứng khoán.',
          keywords: ['trang chu', 'tong quan', 'tai khoan', 'dashboard'],
        },
      },
      {
        path: 'iconnect',
        canActivate: [bondAccountGuard],
        loadComponent: () => import('./pages/iconnect/shell/iconnect.shell').then((m) => m.IconnectShell),
        children: [
          { path: '', redirectTo: 'price-board', pathMatch: 'full' },
          {
            path: 'price-board',
            loadComponent: () => import('./pages/iconnect/price-board/price-board.page').then((m) => m.PriceBoardPage),
            data: {
              title: 'Bảng giá trái phiếu iConnect',
              description: 'Theo dõi giá mua, giá bán, lãi suất và khối lượng của trái phiếu doanh nghiệp riêng lẻ giao dịch thỏa thuận trên iConnect.',
              keywords: ['bang gia', 'trai phieu', 'iconnect', 'lai suat', 'gia mua', 'gia ban'],
              facets: { product: 'bond' },
            },
          },
          {
            path: 'assets',
            loadComponent: () => import('./pages/iconnect/assets/assets.page').then((m) => m.AssetsPage),
            data: {
              title: 'Tài sản trái phiếu iConnect',
              description: 'Danh mục trái phiếu đang nắm giữ (gốc đầu tư, lãi khi đến hạn, ngày đáo hạn). Từ đây chọn trái phiếu muốn bán lại.',
              keywords: ['tai san', 'danh muc', 'trai phieu', 'ban trai phieu', 'chon ban', 'ban lai'],
              facets: { product: 'bond' },
            },
          },
          {
            path: 'orders',
            component: PlaceholderPage,
            data: { title: 'Sổ lệnh trái phiếu', description: 'Theo dõi các lệnh mua bán trái phiếu iConnect đã đặt, trạng thái khớp và lịch sử lệnh.', keywords: ['so lenh', 'lenh da dat', 'huy lenh'], facets: { product: 'bond' } },
          },
          {
            path: 'cashflow',
            component: PlaceholderPage,
            data: { title: 'Dòng tiền trái phiếu', description: 'Lịch nhận lãi coupon và gốc đáo hạn của các trái phiếu đang nắm giữ.', keywords: ['dong tien', 'lai coupon', 'dao han'], facets: { product: 'bond' } },
          },
          {
            path: 'pnl',
            component: PlaceholderPage,
            data: { title: 'Lãi lỗ trái phiếu', description: 'Báo cáo lãi lỗ đã thực hiện và chưa thực hiện của danh mục trái phiếu.', keywords: ['lai lo', 'loi nhuan', 'bao cao'], facets: { product: 'bond' } },
          },
        ],
      },
      {
        path: 'money/deposit',
        component: PlaceholderPage,
        data: { title: 'Nộp tiền', description: 'Nộp tiền vào tài khoản giao dịch chứng khoán qua chuyển khoản ngân hàng hoặc QR.', keywords: ['nop tien', 'chuyen khoan', 'nap tien'], facets: { product: 'money' } },
      },
      {
        path: 'money/transfer',
        component: PlaceholderPage,
        data: { title: 'Chuyển tiền', description: 'Rút/chuyển tiền từ tài khoản chứng khoán về tài khoản ngân hàng đã đăng ký.', keywords: ['chuyen tien', 'rut tien'], facets: { product: 'money' } },
      },
      {
        path: 'market/price-board',
        component: PlaceholderPage,
        data: { title: 'Bảng giá cổ phiếu', description: 'Bảng giá trực tuyến các mã cổ phiếu trên HOSE, HNX, UPCOM.', keywords: ['bang gia co phieu', 'gia co phieu', 'thi truong'], facets: { product: 'stock' } },
      },
      {
        path: 'analysis',
        component: PlaceholderPage,
        data: { title: 'Phân tích đầu tư', description: 'Báo cáo phân tích, dữ liệu và đánh giá về cổ phiếu và các loại chứng khoán.', keywords: ['phan tich', 'bao cao phan tich'], facets: { product: 'stock' } },
      },
      {
        path: 'ipower',
        component: PlaceholderPage,
        data: { title: 'iPower - Tài khoản nhàn lãi', description: 'Nhận lãi trên số tiền nhàn rỗi trong tài khoản.', keywords: ['ipower', 'nhan lai', 'lai tien nhan roi'], facets: { product: 'money' } },
      },
      {
        path: 'invest',
        component: PlaceholderPage,
        data: { title: 'Đầu tư', description: 'Lối vào nhanh các sản phẩm đầu tư.', keywords: ['dau tu'] },
      },
      {
        path: 'assets',
        component: PlaceholderPage,
        data: { title: 'Tổng tài sản', description: 'Tổng quan tài sản toàn tài khoản: tiền, cổ phiếu, trái phiếu, quỹ.', keywords: ['tong tai san'] },
      },
      { path: 'menu', component: MenuPage, data: { title: 'Menu', description: 'Danh sách đầy đủ các nhóm tính năng.', keywords: ['menu', 'tat ca tinh nang'], hidden: true } },
    ],
  },
  { path: '**', redirectTo: '' },
];
