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

  protected readonly nav: NavItem[] = [
    { path: '/overview', label: 'Tổng quan', icon: 'grid', status: 'overview' },
    { path: '/integrate', label: 'Tích hợp', icon: 'plug', status: 'integrate' },
    { path: '/screens', label: 'Màn hình', icon: 'list', status: 'screens' },
    { path: '/run', label: 'Chạy thử', icon: 'play' },
    { path: '/settings', label: 'Cài đặt AI', icon: 'sliders' },
  ];

  // Các màn hình của đợt sau: hiện rõ để người dùng biết lộ trình
  protected readonly upcoming = ['Quyền', 'Gắn tourId', 'Tour', 'Domain Pack', 'Thử trợ lý', 'Kiểm thử', 'Nhật ký'];

  // Đường dẫn ngắn cho thanh bên: thay thư mục nhà bằng ~, dài quá thì chỉ giữ 2 thư mục cuối
  protected shortPath(p: string): string {
    const home = this.store.home();
    const path = home && p.startsWith(home) ? '~' + p.slice(home.length) : p;
    const parts = path.split('/').filter(Boolean);
    return path.length > 30 && parts.length > 2 ? '…/' + parts.slice(-2).join('/') : path;
  }
}
