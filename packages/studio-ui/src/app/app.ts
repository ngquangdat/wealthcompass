import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ProjectStore } from './core/project.store';
import { IconComponent } from './shared/icon.component';
import { ToastsComponent } from './shared/toasts.component';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  status?: string;
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent, ToastsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly store = inject(ProjectStore);

  // Nhóm theo thứ tự làm việc: dựng dữ liệu cho trợ lý → kiểm tra trợ lý → cấu hình
  protected readonly groups: Array<{ title: string | null; items: NavItem[] }> = [
    {
      title: null,
      items: [
        { path: '/overview', label: 'Tổng quan', icon: 'grid', status: 'overview' },
        { path: '/integrate', label: 'Tích hợp', icon: 'plug', status: 'integrate' },
      ],
    },
    {
      title: 'Dữ liệu cho trợ lý',
      items: [
        { path: '/screens', label: 'Màn hình', icon: 'list', status: 'screens' },
        { path: '/permissions', label: 'Quyền', icon: 'key' },
        { path: '/tourids', label: 'Gắn tourId', icon: 'search' },
        { path: '/tours', label: 'Tour', icon: 'compass' },
        { path: '/pack', label: 'Domain Pack', icon: 'file-text' },
      ],
    },
    {
      title: 'Kiểm tra',
      items: [
        { path: '/run', label: 'Chạy thử', icon: 'play' },
        { path: '/assistant', label: 'Thử trợ lý', icon: 'message' },
        { path: '/eval', label: 'Kiểm thử', icon: 'target' },
        { path: '/logs', label: 'Nhật ký', icon: 'chart' },
      ],
    },
    { title: null, items: [{ path: '/settings', label: 'Cài đặt AI', icon: 'sliders' }] },
  ];

  // Đường dẫn ngắn cho thanh bên: thay thư mục nhà bằng ~, dài quá thì chỉ giữ 2 thư mục cuối
  protected shortPath(p: string): string {
    const home = this.store.home();
    const path = home && p.startsWith(home) ? '~' + p.slice(home.length) : p;
    const parts = path.split('/').filter(Boolean);
    return path.length > 30 && parts.length > 2 ? '…/' + parts.slice(-2).join('/') : path;
  }
}
