import { Component, DOCUMENT, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { ChatWidgetComponent } from '@wealthcompass/angular';
import { filter, map } from 'rxjs';
import { AuthService } from './core/auth.service';
import { MenuOverlayService } from './layout/menu-overlay.service';
import { MenuSidebarComponent } from './layout/menu-sidebar.component';
import { ToolbarComponent } from './layout/toolbar.component';

// Từ 768px trở lên dùng bố cục desktop của web thật (thanh trên + thanh bên trái có popup khi rê chuột);
// hẹp hơn thì giữ khung mobile cũ (thanh dưới + màn hình Menu).
const DESKTOP_QUERY = '(min-width: 768px)';

@Component({
  imports: [RouterOutlet, ChatWidgetComponent, MenuSidebarComponent, ToolbarComponent],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly overlay = inject(MenuOverlayService);
  private readonly router = inject(Router);

  private readonly desktop = signal(false);
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected readonly desktopShell = computed(() => this.desktop() && !!this.auth.user() && !this.url().startsWith('/login'));

  constructor() {
    const win = inject(DOCUMENT).defaultView;
    const media = win?.matchMedia?.(DESKTOP_QUERY);
    if (media) {
      this.desktop.set(media.matches);
      const onChange = (e: MediaQueryListEvent) => this.desktop.set(e.matches);
      media.addEventListener('change', onChange);
      inject(DestroyRef).onDestroy(() => media.removeEventListener('change', onChange));
    }
    effect(() => {
      if (!this.desktopShell()) this.overlay.close();
    });
  }
}
