// Cây menu của web. Scanner đọc file này để dựng menuPath cho từng tính năng.
export interface MenuItem {
  label: string;
  route?: string;
  icon?: string;
  children?: MenuItem[];
}

export const NAV_ITEMS: MenuItem[] = [
  { label: 'Trang chủ', route: '/home', icon: 'home' },
  {
    label: 'Tiền',
    icon: 'account_balance_wallet',
    children: [
      { label: 'Nộp tiền', route: '/money/deposit' },
      { label: 'Chuyển tiền', route: '/money/transfer' },
    ],
  },
  {
    label: 'Trái phiếu',
    icon: 'workspace_premium',
    children: [
      { label: 'Giao dịch trái phiếu iConnect', route: '/iconnect/price-board' },
      { label: 'Tài sản trái phiếu', route: '/iconnect/assets' },
      { label: 'Sổ lệnh trái phiếu', route: '/iconnect/orders' },
      { label: 'Dòng tiền trái phiếu', route: '/iconnect/cashflow' },
      { label: 'Lãi lỗ trái phiếu', route: '/iconnect/pnl' },
    ],
  },
  {
    label: 'Cổ phiếu',
    icon: 'show_chart',
    children: [{ label: 'Bảng giá', route: '/market/price-board' }],
  },
  { label: 'Phân tích đầu tư', route: '/analysis', icon: 'query_stats' },
  { label: 'iPower - Tài khoản nhàn lãi', route: '/ipower', icon: 'trending_up' },
  { label: 'Đầu tư', route: '/invest', icon: 'paid' },
  { label: 'Tổng tài sản', route: '/assets', icon: 'pie_chart' },
];
