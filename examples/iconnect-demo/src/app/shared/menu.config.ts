// Cây menu của web. Scanner đọc file này để dựng menuPath cho từng tính năng.
// Mô phỏng menu thật của TCInvest: mục gốc trên thanh bên trái, rê chuột vào thì mở popup các mục con.
// `group` chỉ là tiêu đề nhóm trong popup, không phải một cấp menu (menuPath vẫn là [mục gốc, mục con]).
export interface MenuItem {
  label: string;
  route?: string;
  icon?: string;
  group?: string;
  description?: string;
  children?: MenuItem[];
}

export const NAV_ITEMS: MenuItem[] = [
  { label: 'Trang chủ', route: '/home', icon: 'home' },
  {
    label: 'Tiền',
    icon: 'wallet',
    children: [
      { label: 'Nộp tiền', route: '/money/deposit', group: 'Giao dịch tiền', icon: 'wallet', description: 'Nộp tiền vào tài khoản qua chuyển khoản ngân hàng hoặc QR' },
      { label: 'Chuyển tiền', route: '/money/transfer', group: 'Giao dịch tiền', icon: 'swap', description: 'Rút tiền về tài khoản ngân hàng đã đăng ký' },
      { label: 'Ứng trước tiền bán', route: '/money/advance', group: 'Giao dịch tiền', icon: 'bolt', description: 'Nhận trước tiền bán chứng khoán chưa về tài khoản' },
      { label: 'iPower - Tài khoản nhàn lãi', route: '/ipower', group: 'Sản phẩm tiền', icon: 'trend', description: 'Nhận lãi trên số tiền nhàn rỗi trong tài khoản' },
      { label: 'Tổng tài sản', route: '/assets', group: 'Sản phẩm tiền', icon: 'pie', description: 'Tổng quan tài sản: tiền, cổ phiếu, trái phiếu, quỹ' },
      { label: 'Lịch sử giao dịch tiền', route: '/money/history', group: 'Sản phẩm tiền', icon: 'history', description: 'Tra cứu các lần nộp, rút và chuyển tiền' },
    ],
  },
  {
    label: 'Cổ phiếu',
    icon: 'chart',
    children: [
      { label: 'Bảng giá cổ phiếu', route: '/market/price-board', group: 'Giao dịch', icon: 'chart', description: 'Nơi theo dõi trực tuyến biến động giá cổ phiếu trên thị trường' },
      { label: 'Đặt lệnh cổ phiếu', route: '/stock/order', group: 'Giao dịch', icon: 'order', description: 'Mua bán cổ phiếu niêm yết trên HOSE, HNX, UPCOM' },
      { label: 'Trade Station', route: '/stock/trade-station', group: 'Giao dịch', icon: 'apps', description: 'Không gian giao dịch chuyên nghiệp nhiều cửa sổ' },
      { label: 'Đặt lệnh điều kiện', route: '/stock/conditional-order', group: 'Giao dịch', icon: 'order', description: 'Lệnh tự kích hoạt khi giá chạm điều kiện đã đặt' },
      { label: 'iPO', route: '/stock/ipo', group: 'Giao dịch', icon: 'star', description: 'Đăng ký mua cổ phiếu phát hành lần đầu' },
      { label: 'Giao dịch Darkpool', route: '/stock/darkpool', group: 'Giao dịch', icon: 'swap', description: 'Giao dịch thỏa thuận khối lượng lớn' },
      { label: 'Quản lý Margin', route: '/stock/margin', group: 'Hỗ trợ giao dịch', icon: 'pie', description: 'Theo dõi sức mua, tỷ lệ ký quỹ và dư nợ margin' },
      { label: 'Hiệu quả đầu tư', route: '/stock/performance', group: 'Hỗ trợ giao dịch', icon: 'trend', description: 'Lãi lỗ và hiệu quả danh mục cổ phiếu theo thời gian' },
      { label: 'Phân tích đầu tư', route: '/analysis', group: 'Hỗ trợ giao dịch', icon: 'search', description: 'Báo cáo phân tích, dữ liệu và đánh giá cổ phiếu' },
      { label: 'Bộ lọc', route: '/stock/screener', group: 'Hỗ trợ giao dịch', icon: 'filter', description: 'Lọc cổ phiếu theo chỉ số tài chính và kỹ thuật' },
      { label: 'Kiểm thử', route: '/stock/backtest', group: 'Hỗ trợ giao dịch', icon: 'history', description: 'Chạy thử chiến lược đầu tư trên dữ liệu quá khứ' },
      { label: 'Đăng ký quyền mua', route: '/stock/rights', group: 'Hỗ trợ giao dịch', icon: 'check', description: 'Thực hiện quyền mua cổ phiếu phát hành thêm' },
      { label: 'Chuyển khoản chứng khoán', route: '/stock/transfer', group: 'Hỗ trợ giao dịch', icon: 'swap', description: 'Chuyển cổ phiếu giữa các tiểu khoản hoặc công ty chứng khoán' },
      { label: 'Lưu ký chứng khoán', route: '/stock/custody', group: 'Hỗ trợ giao dịch', icon: 'lock', description: 'Lưu ký cổ phiếu chứng chỉ vào tài khoản' },
      { label: 'iCopy', route: '/stock/icopy', group: 'Hỗ trợ giao dịch', icon: 'people', description: 'Sao chép danh mục của nhà đầu tư chuyên nghiệp' },
    ],
  },
  {
    label: 'Phái sinh',
    icon: 'swap',
    children: [
      { label: 'Bảng giá phái sinh', route: '/derivatives/price-board', group: 'Giao dịch', icon: 'chart', description: 'Giá hợp đồng tương lai chỉ số VN30 và trái phiếu chính phủ' },
      { label: 'Đặt lệnh phái sinh', route: '/derivatives/order', group: 'Giao dịch', icon: 'order', description: 'Mở và đóng vị thế hợp đồng tương lai' },
      { label: 'Quản lý ký quỹ phái sinh', route: '/derivatives/margin', group: 'Quản lý', icon: 'wallet', description: 'Nộp, rút ký quỹ và theo dõi tỷ lệ sử dụng ký quỹ' },
    ],
  },
  {
    label: 'Trái phiếu',
    icon: 'bond',
    children: [
      { label: 'Giao dịch trái phiếu iConnect', route: '/iconnect/price-board', group: 'Giao dịch', icon: 'bond', description: 'Mua bán trái phiếu doanh nghiệp riêng lẻ theo thỏa thuận' },
      { label: 'Sổ lệnh trái phiếu', route: '/iconnect/orders', group: 'Giao dịch', icon: 'order', description: 'Lệnh mua bán trái phiếu đã đặt và trạng thái khớp' },
      { label: 'Tài sản trái phiếu', route: '/iconnect/assets', group: 'Quản lý', icon: 'pie', description: 'Danh mục trái phiếu đang nắm giữ, chọn trái phiếu để bán lại' },
      { label: 'Dòng tiền trái phiếu', route: '/iconnect/cashflow', group: 'Quản lý', icon: 'wallet', description: 'Lịch nhận lãi coupon và gốc đáo hạn' },
      { label: 'Lãi lỗ trái phiếu', route: '/iconnect/pnl', group: 'Quản lý', icon: 'trend', description: 'Lãi lỗ đã và chưa thực hiện của danh mục trái phiếu' },
      { label: 'Trái phiếu iBond', route: '/bond/ibond', group: 'Sản phẩm khác', icon: 'star', description: 'Trái phiếu phân phối sơ cấp, kỳ hạn linh hoạt' },
    ],
  },
  {
    label: 'Quỹ',
    icon: 'pie',
    children: [
      { label: 'Mua bán chứng chỉ quỹ', route: '/fund/trade', group: 'Giao dịch', icon: 'order', description: 'Đặt lệnh mua, bán chứng chỉ quỹ mở' },
      { label: 'Đầu tư định kỳ', route: '/fund/sip', group: 'Giao dịch', icon: 'history', description: 'Tự động mua chứng chỉ quỹ hằng tháng' },
      { label: 'Tài sản quỹ', route: '/fund/assets', group: 'Quản lý', icon: 'pie', description: 'Số chứng chỉ quỹ đang nắm giữ và lãi lỗ' },
    ],
  },
  {
    label: 'Tiện ích',
    icon: 'apps',
    children: [
      { label: 'Đầu tư', route: '/invest', group: 'Tiện ích', icon: 'trend', description: 'Lối vào nhanh các sản phẩm đầu tư' },
      { label: 'Lịch sự kiện', route: '/utilities/calendar', group: 'Tiện ích', icon: 'calendar', description: 'Lịch chia cổ tức, đại hội cổ đông, phát hành' },
      { label: 'Tin tức thị trường', route: '/utilities/news', group: 'Tiện ích', icon: 'search', description: 'Tin tức doanh nghiệp và thị trường mới nhất' },
    ],
  },
  {
    label: 'Đối tác',
    icon: 'people',
    children: [
      { label: 'TCWealth', route: '/partners/tcwealth', group: 'Đối tác', icon: 'star', description: 'Quản lý tài sản cùng chuyên gia TCWealth' },
      { label: 'Bảo hiểm', route: '/partners/insurance', group: 'Đối tác', icon: 'lock', description: 'Sản phẩm bảo hiểm từ đối tác liên kết' },
    ],
  },
  {
    label: 'Ưa thích',
    icon: 'star',
    children: [{ label: 'Tùy chỉnh tính năng ưa thích', route: '/favorites', group: 'Ưa thích', icon: 'star', description: 'Chọn các tính năng hiện ở trang chủ' }],
  },
  { label: 'Góp ý', route: '/feedback', icon: 'feedback' },
];
