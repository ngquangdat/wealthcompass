import { Component, ElementRef, EmbeddedViewRef, OnDestroy, TemplateRef, ViewContainerRef, computed, inject, input, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { MenuItem } from '../shared/menu.config';
import { MenuIconComponent } from './menu-icon.component';
import { MenuOverlayService, OverlayPopup } from './menu-overlay.service';

const COLLAPSED_COUNT = 5;

// Popup con của một mục gốc trên thanh bên. Host <app-popup-menu> nằm trong mục gốc và luôn rỗng;
// nội dung là một embedded view được chuyển sang overlay ở body khi mở (cách CDK TemplatePortal làm),
// và bị hủy khi đóng, nên popup chỉ có trong DOM lúc đang mở.
// Mục con là div/span thuần: không id, href, role, routerLink hay tourId. Điều hướng bằng (click) -> Router.
@Component({
  selector: 'app-popup-menu',
  imports: [MenuIconComponent],
  template: `
    <ng-template #panel>
      <div role="dialog" aria-label="Dialog" class="dialog-container custom-popup-menu-wrapper dark" [class.b-see-more]="hasMore()">
        <div class="pp-cs-wrapper">
          @for (group of groups(); track $index) {
            @if (group.name) {
              <div class="m-sub-s-header"><div>{{ group.name }}</div></div>
            }
            @for (entry of group.entries; track entry.label) {
              <div class="mat-ripple m-child-item dark" (click)="go(entry)">
                <app-menu-icon class="menu-icon-svg menu-icon" [name]="entry.icon" />
                <span class="title">
                  <div class="flex-center"><span>{{ entry.label }}</span></div>
                  @if (entry.description) {
                    <div class="item-description"> {{ entry.description }} </div>
                  }
                </span>
              </div>
            }
          }
          @if (hasMore()) {
            <div class="mat-ripple m-s-m-block" (click)="toggle()">{{ overlay.expanded() ? 'Rút gọn' : 'Xem thêm' }}<span class="material-icons">{{ overlay.expanded() ? 'arrow_drop_up' : 'arrow_drop_down' }}</span></div>
          }
        </div>
      </div>
    </ng-template>
  `,
  styles: `
    :host { display: none; }
    .dialog-container {
      width: 247px; max-height: calc(100vh - 68px); display: flex; flex-direction: column; box-sizing: border-box;
      background: rgb(50, 50, 50); border-radius: 8px; box-shadow: rgba(0, 0, 0, 0.4) 0 0 5px; padding: 8px 0 26px;
      position: relative; color: rgb(245, 245, 245); font-family: Roboto, 'Helvetica Neue', sans-serif;
    }
    .pp-cs-wrapper { overflow-y: auto; min-height: 0; }
    .m-sub-s-header { font-size: 12px; font-weight: 500; color: rgb(190, 190, 190); padding: 8px 0 4px 16px; }
    .m-child-item { display: flex; gap: 10px; padding: 6px 12px; cursor: pointer; align-items: flex-start; }
    .m-child-item:hover { background: rgba(255, 255, 255, 0.06); }
    .m-child-item:hover .flex-center span { color: rgb(255, 55, 71); }
    .menu-icon { width: 24px; height: 24px; color: rgb(239, 106, 106); }
    .title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .flex-center { display: flex; align-items: center; font-size: 14px; color: #fff; line-height: 18px; }
    .item-description { font-size: 12px; color: rgb(190, 190, 190); line-height: 14px; }
    .m-s-m-block {
      position: absolute; left: 0; right: 0; bottom: 4px; height: 20px; display: flex; align-items: center; justify-content: center;
      font-size: 12px; color: rgb(190, 190, 190); cursor: pointer;
    }
    .m-s-m-block .material-icons { font-size: 20px; }
  `,
})
export class PopupMenuComponent implements OverlayPopup, OnDestroy {
  readonly item = input.required<MenuItem>();

  protected readonly overlay = inject(MenuOverlayService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly vcr = inject(ViewContainerRef);
  private readonly panel = viewChild.required<TemplateRef<unknown>>('panel');
  private view: EmbeddedViewRef<unknown> | null = null;

  private readonly entries = computed(() => this.item().children ?? []);
  protected readonly hasMore = computed(() => this.entries().length > COLLAPSED_COUNT);

  // Thu gọn: chỉ 5 mục đầu (theo thứ tự trong menu); tiêu đề nhóm chỉ hiện khi nhóm còn mục
  protected readonly groups = computed(() => {
    const visible = this.overlay.expanded() ? this.entries() : this.entries().slice(0, COLLAPSED_COUNT);
    const groups: { name: string; entries: MenuItem[] }[] = [];
    for (const entry of visible) {
      const name = entry.group ?? '';
      const last = groups.at(-1);
      if (last && last.name === name) last.entries.push(entry);
      else groups.push({ name, entries: [entry] });
    }
    return groups;
  });

  open(): void {
    if (this.overlay.isOpen(this) || !this.entries().length) return;
    const pane = this.overlay.attach(this);
    const view = this.vcr.createEmbeddedView(this.panel());
    view.detectChanges();
    for (const node of view.rootNodes) pane.appendChild(node);
    this.view = view;
    this.reposition();
  }

  detach(): void {
    this.view?.destroy();
    this.view = null;
  }

  ngOnDestroy(): void {
    if (this.overlay.isOpen(this)) this.overlay.close();
  }

  protected go(entry: MenuItem): void {
    this.overlay.close();
    if (entry.route) void this.router.navigateByUrl(entry.route);
  }

  protected toggle(): void {
    this.overlay.expanded.update((v) => !v);
    this.view?.detectChanges();
    this.reposition();
  }

  private reposition(): void {
    const anchor = this.host.nativeElement.closest<HTMLElement>('.m-root-item') ?? this.host.nativeElement;
    this.overlay.position(anchor);
  }
}
