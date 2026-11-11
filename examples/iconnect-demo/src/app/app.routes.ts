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
      {
        path: 'money/advance',
        component: PlaceholderPage,
        data: { title: 'Ứng trước tiền bán', description: 'Nhận trước tiền bán chứng khoán khi tiền bán chưa về tài khoản.', keywords: ['ung truoc', 'tien ban'], facets: { product: 'money' } },
      },
      {
        path: 'money/history',
        component: PlaceholderPage,
        data: { title: 'Lịch sử giao dịch tiền', description: 'Tra cứu lịch sử nộp, rút và chuyển tiền của tài khoản.', keywords: ['lich su', 'sao ke', 'giao dich tien'], facets: { product: 'money' } },
      },
      {
        path: 'stock/order',
        component: PlaceholderPage,
        data: { title: 'Đặt lệnh cổ phiếu', description: 'Mua bán cổ phiếu niêm yết trên HOSE, HNX, UPCOM.', keywords: ['dat lenh', 'mua co phieu', 'ban co phieu'], facets: { product: 'stock' } },
      },
      {
        path: 'stock/trade-station',
        component: PlaceholderPage,
        data: { title: 'Trade Station', description: 'Không gian giao dịch chuyên nghiệp với nhiều cửa sổ bảng giá, biểu đồ và đặt lệnh.', keywords: ['trade station', 'giao dich chuyen nghiep'], facets: { product: 'stock' } },
      },
      {
        path: 'stock/conditional-order',
        component: PlaceholderPage,
        data: { title: 'Đặt lệnh điều kiện', description: 'Lệnh cổ phiếu tự kích hoạt khi giá chạm điều kiện đã đặt (chốt lời, cắt lỗ).', keywords: ['lenh dieu kien', 'chot loi', 'cat lo'], facets: { product: 'stock' } },
      },
      {
        path: 'stock/ipo',
        component: PlaceholderPage,
        data: { title: 'iPO', description: 'Đăng ký mua cổ phiếu phát hành lần đầu ra công chúng.', keywords: ['ipo', 'phat hanh lan dau'], facets: { product: 'stock' } },
      },
      {
        path: 'stock/darkpool',
        component: PlaceholderPage,
        data: { title: 'Giao dịch Darkpool', description: 'Giao dịch thỏa thuận cổ phiếu khối lượng lớn.', keywords: ['darkpool', 'thoa thuan'], facets: { product: 'stock' } },
      },
      {
        path: 'stock/margin',
        component: PlaceholderPage,
        data: { title: 'Quản lý Margin', description: 'Theo dõi sức mua, tỷ lệ ký quỹ và dư nợ margin.', keywords: ['margin', 'ky quy', 'du no'], facets: { product: 'stock' } },
      },
      {
        path: 'stock/performance',
        component: PlaceholderPage,
        data: { title: 'Hiệu quả đầu tư', description: 'Lãi lỗ và hiệu quả danh mục cổ phiếu theo thời gian.', keywords: ['hieu qua dau tu', 'lai lo co phieu'], facets: { product: 'stock' } },
      },
      {
        path: 'stock/screener',
        component: PlaceholderPage,
        data: { title: 'Bộ lọc cổ phiếu', description: 'Lọc cổ phiếu theo chỉ số tài chính và kỹ thuật.', keywords: ['bo loc', 'loc co phieu'], facets: { product: 'stock' } },
      },
      {
        path: 'stock/backtest',
        component: PlaceholderPage,
        data: { title: 'Kiểm thử chiến lược', description: 'Chạy thử chiến lược đầu tư trên dữ liệu giá quá khứ.', keywords: ['kiem thu', 'backtest'], facets: { product: 'stock' } },
      },
      {
        path: 'stock/rights',
        component: PlaceholderPage,
        data: { title: 'Đăng ký quyền mua', description: 'Thực hiện quyền mua cổ phiếu phát hành thêm cho cổ đông hiện hữu.', keywords: ['quyen mua', 'phat hanh them'], facets: { product: 'stock' } },
      },
      {
        path: 'stock/transfer',
        component: PlaceholderPage,
        data: { title: 'Chuyển khoản chứng khoán', description: 'Chuyển cổ phiếu giữa các tiểu khoản hoặc sang công ty chứng khoán khác.', keywords: ['chuyen khoan chung khoan', 'chuyen co phieu'], facets: { product: 'stock' } },
      },
      {
        path: 'stock/custody',
        component: PlaceholderPage,
        data: { title: 'Lưu ký chứng khoán', description: 'Lưu ký cổ phiếu chứng chỉ vào tài khoản giao dịch.', keywords: ['luu ky'], facets: { product: 'stock' } },
      },
      {
        path: 'stock/icopy',
        component: PlaceholderPage,
        data: { title: 'iCopy', description: 'Sao chép danh mục của nhà đầu tư chuyên nghiệp.', keywords: ['icopy', 'sao chep danh muc'], facets: { product: 'stock' } },
      },
      {
        path: 'derivatives/price-board',
        component: PlaceholderPage,
        data: { title: 'Bảng giá phái sinh', description: 'Giá hợp đồng tương lai chỉ số VN30 và trái phiếu chính phủ.', keywords: ['bang gia phai sinh', 'hop dong tuong lai', 'vn30f'], facets: { product: 'derivatives' } },
      },
      {
        path: 'derivatives/order',
        component: PlaceholderPage,
        data: { title: 'Đặt lệnh phái sinh', description: 'Mở và đóng vị thế hợp đồng tương lai.', keywords: ['lenh phai sinh', 'vi the'], facets: { product: 'derivatives' } },
      },
      {
        path: 'derivatives/margin',
        component: PlaceholderPage,
        data: { title: 'Quản lý ký quỹ phái sinh', description: 'Nộp, rút ký quỹ phái sinh và theo dõi tỷ lệ sử dụng ký quỹ.', keywords: ['ky quy phai sinh'], facets: { product: 'derivatives' } },
      },
      {
        path: 'bond/ibond',
        component: PlaceholderPage,
        data: { title: 'Trái phiếu iBond', description: 'Trái phiếu phân phối sơ cấp, kỳ hạn linh hoạt.', keywords: ['ibond', 'trai phieu so cap'], facets: { product: 'bond' } },
      },
      {
        path: 'fund/trade',
        component: PlaceholderPage,
        data: { title: 'Mua bán chứng chỉ quỹ', description: 'Đặt lệnh mua, bán chứng chỉ quỹ mở.', keywords: ['chung chi quy', 'mua quy', 'ban quy'], facets: { product: 'fund' } },
      },
      {
        path: 'fund/sip',
        component: PlaceholderPage,
        data: { title: 'Đầu tư định kỳ', description: 'Tự động mua chứng chỉ quỹ hằng tháng.', keywords: ['dinh ky', 'sip'], facets: { product: 'fund' } },
      },
      {
        path: 'fund/assets',
        component: PlaceholderPage,
        data: { title: 'Tài sản quỹ', description: 'Số chứng chỉ quỹ đang nắm giữ và lãi lỗ.', keywords: ['tai san quy'], facets: { product: 'fund' } },
      },
      {
        path: 'utilities/calendar',
        component: PlaceholderPage,
        data: { title: 'Lịch sự kiện', description: 'Lịch chia cổ tức, đại hội cổ đông và phát hành.', keywords: ['lich su kien', 'co tuc'] },
      },
      {
        path: 'utilities/news',
        component: PlaceholderPage,
        data: { title: 'Tin tức thị trường', description: 'Tin tức doanh nghiệp và thị trường mới nhất.', keywords: ['tin tuc'] },
      },
      {
        path: 'partners/tcwealth',
        component: PlaceholderPage,
        data: { title: 'TCWealth', description: 'Quản lý tài sản cùng chuyên gia TCWealth.', keywords: ['tcwealth', 'quan ly tai san'] },
      },
      {
        path: 'partners/insurance',
        component: PlaceholderPage,
        data: { title: 'Bảo hiểm', description: 'Sản phẩm bảo hiểm từ đối tác liên kết.', keywords: ['bao hiem'] },
      },
      {
        path: 'favorites',
        component: PlaceholderPage,
        data: { title: 'Tùy chỉnh tính năng ưa thích', description: 'Chọn các tính năng hiện ở mục ưa thích trên trang chủ.', keywords: ['ua thich', 'tuy chinh'] },
      },
      {
        path: 'feedback',
        component: PlaceholderPage,
        data: { title: 'Góp ý', description: 'Gửi góp ý, báo lỗi cho đội phát triển.', keywords: ['gop y', 'phan hoi', 'bao loi'] },
      },
      { path: 'menu', component: MenuPage, data: { title: 'Menu', description: 'Danh sách đầy đủ các nhóm tính năng.', keywords: ['menu', 'tat ca tinh nang'], hidden: true } },
    ],
  },
  { path: '**', redirectTo: '' },
];
