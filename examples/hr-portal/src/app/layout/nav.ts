export interface NavEntry {
  title: string;
  link?: string;
  items?: NavEntry[];
}

export const NAVIGATION: NavEntry[] = [
  { title: 'Tổng quan', link: '/dashboard' },
  {
    title: 'Nghỉ phép',
    items: [
      { title: 'Tạo đơn nghỉ', link: '/leave/request' },
      { title: 'Lịch sử nghỉ', link: '/leave/history' },
    ],
  },
  { title: 'Phiếu lương', link: '/payslips' },
  { title: 'Phê duyệt', link: '/team/approvals' },
  { title: 'Hồ sơ', link: '/profile' },
];
