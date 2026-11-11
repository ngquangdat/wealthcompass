import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';
import { MenuItem, NAV_ITEMS } from '../shared/menu.config';
import { MenuIconComponent } from './menu-icon.component';
import { MenuOverlayService } from './menu-overlay.service';
import { PopupMenuComponent } from './popup-menu.component';

// Thanh bên trái (desktop) mô phỏng app-menu-sidebar của TCInvest ở trạng thái thu gọn: cột 60px, mỗi mục gốc
// là icon + nhãn nhỏ. Lớp trong suốt div.item-w2 phủ trên cùng nên là phần tử chuột thật sự chạm vào.
// Rê chuột vào mục gốc mở popup của nó; popup chỉ đóng khi chuột đi vào vùng nội dung (xem App), khi rê sang
// mục gốc khác, hoặc khi bấm một mục con. Không có id/href/role/routerLink/tourId ở đây.
@Component({
  selector: 'app-menu-sidebar',
  imports: [MenuIconComponent, PopupMenuComponent],
  template: `
    <div class="menu-sidebar-container menu-collapse dark">
      <div class="sidebar-container-wrapper"><div class="sc-wrapper">
        <div class="m-contained-content m-table-layout">
          <div class="m-home m-row"><div class="m-table-layout">
            <div class="m-row m-root-item" (mouseenter)="overlay.close()" (click)="go(home)">
              <div class="m-item-wrapper">
                <div class="item-w1" [class.activated]="isActive(home)">
                  @if (isActive(home)) {
                    <div class="line-activated"></div>
                  }
                  <div class="m-item-container">
                    <div class="m-item-b1 collapse"><app-menu-icon [name]="home.icon" /><div class="mini-title">{{ home.label }}</div></div>
                    <div class="m-item-b2"><div class="m-title"> {{ home.label }} </div></div>
                    <div class="m-item-b3"></div>
                  </div>
                </div>
                <div class="mat-ripple item-w2">&nbsp;</div>
              </div>
            </div>
          </div></div>
          <div class="m-menus m-row"><div class="sidebar-content-wrapper"><div class="contained-content-scrollable">
            @for (item of roots; track item.label) {
              <div class="m-root-item" (mouseenter)="hover(item, popup)" (click)="item.route ? go(item) : popup.open()">
                <div class="m-item-wrapper">
                  <div class="item-w1" [class.activated]="isActive(item)">
                    @if (isActive(item)) {
                      <div class="line-activated"></div>
                    }
                    <div class="m-item-container">
                      <div class="m-item-b1 collapse"><app-menu-icon [name]="item.icon" /><div class="mini-title">{{ item.label }}</div></div>
                      <div class="m-item-b2"><div class="m-title"> {{ item.label }} @if (item.children?.length) {<app-menu-icon name="chevron" />}</div></div>
                      <div class="m-item-b3"></div>
                    </div>
                  </div>
                  <div class="mat-ripple item-w2">&nbsp;</div>
                  <app-popup-menu #popup [item]="item" />
                </div>
              </div>
            }
          </div></div></div>
        </div>
      </div></div>
    </div>
  `,
  styles: `
    :host { display: block; width: 60px; height: 100%; background: rgb(32, 32, 32); overflow: hidden; }
    .menu-sidebar-container, .sidebar-container-wrapper, .sc-wrapper { height: 100%; }
    .sc-wrapper { overflow-y: auto; overflow-x: hidden; scrollbar-width: none; }
    /* Web thật: cả cột (m-contained-content và mọi lớp bên trong tới mục gốc) đều cursor:pointer */
    .m-contained-content, .m-contained-content .m-row, .m-contained-content .m-table-layout,
    .sidebar-content-wrapper, .contained-content-scrollable, .m-root-item, .m-item-wrapper { cursor: pointer; }
    .m-contained-content { display: table; width: 60px; }
    .m-row { display: table-row; }
    .m-table-layout { display: table; width: 100%; }
    .m-root-item { display: block; width: 60px; height: 60px; }
    .m-item-wrapper { position: relative; width: 60px; height: 60px; }
    .item-w1 { position: absolute; inset: 0; color: rgb(190, 190, 190); }
    .item-w1.activated { color: rgb(255, 55, 71); }
    .m-root-item:hover .item-w1 { color: rgb(255, 55, 71); }
    .line-activated { position: absolute; left: 0; top: 10px; bottom: 10px; width: 3px; border-radius: 0 2px 2px 0; background: rgb(255, 55, 71); }
    .m-item-container { height: 100%; display: flex; align-items: center; justify-content: center; }
    .m-item-b1 { display: flex; flex-direction: column; align-items: center; gap: 3px; }
    .m-item-b1 app-menu-icon { width: 24px; height: 24px; }
    .mini-title { font-size: 10px; line-height: 12px; text-align: center; white-space: nowrap; max-width: 58px; overflow: hidden; text-overflow: ellipsis; }
    /* Nhãn đầy đủ chỉ hiện khi thanh bên mở rộng; demo luôn thu gọn */
    .menu-collapse .m-item-b2, .menu-collapse .m-item-b3 { display: none; }
    .item-w2 { position: absolute; inset: 0; background: transparent; color: transparent; overflow: hidden; user-select: none; }
  `,
})
export class MenuSidebarComponent {
  protected readonly overlay = inject(MenuOverlayService);
  private readonly router = inject(Router);
  protected readonly home = NAV_ITEMS[0];
  protected readonly roots = NAV_ITEMS.slice(1);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected isActive(item: MenuItem): boolean {
    const url = this.url().split(/[?#]/)[0];
    const routes = [item.route, ...(item.children ?? []).map((c) => c.route)].filter((r): r is string => !!r);
    return routes.some((r) => url === r || url.startsWith(r + '/'));
  }

  protected hover(item: MenuItem, popup: PopupMenuComponent): void {
    if (item.children?.length) popup.open();
    else this.overlay.close();
  }

  protected go(item: MenuItem): void {
    this.overlay.close();
    if (item.route) void this.router.navigateByUrl(item.route);
  }
}
