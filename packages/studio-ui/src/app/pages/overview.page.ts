import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProjectStore } from '../core/project.store';
import type { Check } from '../core/models';
import { IconComponent } from '../shared/icon.component';
import { PageHeaderComponent } from '../shared/page-header.component';

// Mục kiểm tra -> trang xử lý
const LINKS: Array<[RegExp, string, string]> = [
  [/Gói|Style|provideCompass|getToken|compass-chat-widget|compass\.config/, '/integrate', 'Tích hợp'],
  [/AI chưa duyệt|Quét route/, '/screens', 'Màn hình'],
  [/Backend|CORS/, '/run', 'Chạy thử'],
  [/LLM/, '/settings', 'Cài đặt AI'],
];

@Component({
  selector: 'page-overview',
  imports: [RouterLink, IconComponent, PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.project(); as p) {
      <ui-page-header [title]="p.name" [subtitle]="'Angular ' + (p.angularVersion ?? '?') + ' · ' + p.path">
        <button class="btn" (click)="store.refresh()" [disabled]="store.loading()">
          @if (store.loading()) { <span class="spinner"></span> } @else { <ui-icon name="refresh" /> } Kiểm tra lại
        </button>
      </ui-page-header>

      @if (!p.integrated) {
        <div class="card hero">
          <div class="hero-icon"><ui-icon name="plug" [size]="22" /></div>
          <div class="grow">
            <h2>Dự án chưa gắn WealthCompass</h2>
            <p class="muted">Studio sẽ dò cấu trúc dự án, để AI soạn nháp dữ liệu tìm kiếm và tạo các thay đổi cần thiết. Bạn xem từng thay đổi trước khi áp.</p>
          </div>
          <a class="btn btn-primary" routerLink="/integrate">Bắt đầu tích hợp <ui-icon name="chevron-right" /></a>
        </div>
      } @else if (store.overview(); as o) {
        @if (o.stats; as s) {
          <div class="grid-4 stats">
            <a class="card stat" routerLink="/screens"><span class="muted small">Màn hình</span><b>{{ s.screens }}</b></a>
            <a class="card stat" routerLink="/screens" [class.attn]="s.drafts"><span class="muted small">AI soạn, chờ duyệt</span><b>{{ s.drafts }}</b></a>
            <a class="card stat" routerLink="/screens" [class.attn]="s.missing"><span class="muted small">Thiếu mô tả</span><b>{{ s.missing }}</b></a>
            <div class="card stat"><span class="muted small">tourId · tour</span><b>{{ s.tourIds }} · {{ s.tours }}</b></div>
          </div>
        }

        <div class="card">
          <div class="card-head">
            <h2>Trạng thái tích hợp</h2>
            @if (failCount()) { <span class="badge danger">{{ failCount() }} mục cần sửa</span> }
            @else { <span class="badge success"><ui-icon name="check" [size]="12" /> Đã nối đúng</span> }
          </div>
          <div class="checks">
            @for (c of o.checks; track c.name) {
              <div class="check" [class]="c.status">
                <ui-icon [name]="c.status === 'ok' ? 'check-circle' : c.status === 'fail' ? 'x-circle' : 'alert'" [size]="18" />
                <div class="grow">
                  <div class="c-name">{{ c.name }}</div>
                  @if (c.detail) { <div class="muted small">{{ c.detail }}</div> }
                  @if (c.status !== 'ok' && c.fix) { <div class="fix small">{{ c.fix }}</div> }
                </div>
                @if (c.status !== 'ok' && link(c); as l) {
                  <a class="btn btn-sm" [routerLink]="l[0]">{{ l[1] }} <ui-icon name="chevron-right" [size]="14" /></a>
                }
              </div>
            }
          </div>
        </div>

        @if (o.warnings.length) {
          <div class="card">
            <div class="card-head">
              <h2>Cảnh báo của trình quét</h2>
              <span class="badge warning">{{ o.warnings.length }}</span>
            </div>
            <ul class="warnings">
              @for (w of shownWarnings(); track $index) { <li class="small">{{ w }}</li> }
            </ul>
            @if (o.warnings.length > 6) {
              <div class="card-body more"><button class="btn btn-ghost btn-sm" (click)="allWarnings.set(!allWarnings())">{{ allWarnings() ? 'Thu gọn' : 'Xem tất cả ' + o.warnings.length }}</button></div>
            }
          </div>
        }
      }

      <div class="card">
        <div class="card-head"><h2>Cấu trúc dự án đã dò được</h2></div>
        <div class="card-body facts">
          <div><span class="muted small">Khởi động</span><span>{{ p.bootstrap ? (p.bootstrap.kind === 'standalone' ? 'Standalone · ' : 'NgModule · ') + p.bootstrap.root : 'Không rõ' }}</span></div>
          <div><span class="muted small">File route</span><code>{{ p.routesFile ?? 'không thấy' }}</code></div>
          <div><span class="muted small">File menu</span><code>{{ p.menuFile ?? 'không thấy' }}</code></div>
          <div><span class="muted small">Đăng nhập</span><span>@if (p.auth) { {{ p.auth.service }} · <code>{{ p.auth.tokenExpr }}</code> } @else { không đoán được }</span></div>
          <div><span class="muted small">Cổng dev</span><span>{{ p.devPort }}</span></div>
        </div>
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    .hero { display: flex; align-items: center; gap: 16px; padding: 24px; }
    .hero-icon { width: 44px; height: 44px; border-radius: 10px; background: var(--primary-soft); color: var(--primary); display: grid; place-items: center; }
    .hero p { margin-top: 4px; max-width: 620px; }
    .stat { display: flex; flex-direction: column; gap: 4px; padding: 16px 18px; color: inherit; }
    .stat:hover { text-decoration: none; border-color: var(--border-strong); }
    .stat b { font-size: 24px; font-weight: 600; }
    .stat.attn b { color: var(--warning-text); }
    .checks { display: flex; flex-direction: column; }
    .check { display: flex; align-items: flex-start; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--border); }
    .check:last-child { border-bottom: 0; }
    .check.ok ui-icon:first-child { color: var(--success); }
    .check.fail ui-icon:first-child { color: var(--danger); }
    .check.warn ui-icon:first-child { color: var(--warning); }
    .c-name { font-weight: 500; }
    .fix { color: var(--text-2); margin-top: 2px; }
    .warnings { margin: 0; padding: 12px 20px 12px 36px; display: flex; flex-direction: column; gap: 6px; color: var(--text-2); }
    .more { padding-top: 0; }
    .facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px 24px; }
    .facts > div { display: flex; flex-direction: column; gap: 4px; }
  `,
})
export class OverviewPage {
  protected readonly store = inject(ProjectStore);
  protected readonly allWarnings = signal(false);
  protected readonly failCount = computed(() => this.store.overview()?.checks.filter((c) => c.status === 'fail').length ?? 0);
  protected readonly shownWarnings = computed(() => {
    const w = this.store.overview()?.warnings ?? [];
    return this.allWarnings() ? w : w.slice(0, 6);
  });

  protected link(c: Check): [string, string] | null {
    const hit = LINKS.find(([re]) => re.test(c.name));
    return hit ? [hit[1], hit[2]] : null;
  }
}
