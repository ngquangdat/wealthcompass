import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { ProjectStore } from '../core/project.store';
import { ToastService } from '../core/toast.service';
import { IconComponent } from '../shared/icon.component';
import { PageHeaderComponent } from '../shared/page-header.component';

interface Listing {
  path: string;
  parent: string | null;
  isAngular: boolean;
  entries: Array<{ name: string; path: string; isAngular: boolean; integrated: boolean }>;
}

@Component({
  selector: 'page-open',
  imports: [FormsModule, IconComponent, PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header title="Mở dự án" subtitle="Chọn thư mục gốc của web Angular (có angular.json), hoặc thư mục dự án tour tạo bằng wealthcompass init khi chưa có source." />

    <div class="layout">
      <div class="card">
        <div class="card-body stack">
          <form class="row" (ngSubmit)="open(path)">
            <input class="input mono grow" name="path" [(ngModel)]="path" placeholder="/Users/ban/du-an/my-web" autocomplete="off" />
            <button class="btn btn-primary" type="submit" [disabled]="!path.trim() || busy()">
              @if (busy()) { <span class="spinner"></span> } Mở dự án
            </button>
          </form>

          @if (listing(); as l) {
            <div class="browser">
              <div class="crumb">
                <button class="btn btn-ghost btn-icon btn-sm" type="button" [disabled]="!l.parent" (click)="browse(l.parent!)" title="Lên thư mục cha">
                  <ui-icon name="arrow-up" [size]="15" />
                </button>
                <span class="mono grow">{{ l.path }}</span>
                @if (l.isAngular) { <button class="btn btn-primary btn-sm" type="button" (click)="open(l.path)">Mở thư mục này</button> }
              </div>
              <div class="entries">
                @for (e of l.entries; track e.path) {
                  <div class="entry" [class.ng]="e.isAngular" (click)="e.isAngular ? open(e.path) : browse(e.path)">
                    <ui-icon [name]="e.isAngular ? 'compass' : 'folder'" [size]="16" />
                    <span class="grow">{{ e.name }}</span>
                    @if (e.integrated) { <span class="badge success">Đã tích hợp</span> }
                    @else if (e.isAngular) { <span class="badge primary">Angular</span> }
                    <ui-icon name="chevron-right" [size]="14" class="muted" />
                  </div>
                } @empty {
                  <div class="empty small">Thư mục trống</div>
                }
              </div>
            </div>
          }
        </div>
      </div>

      <div class="card side">
        <div class="card-head"><h2>Gần đây</h2></div>
        <div class="card-body">
          @for (r of recent; track r.path) {
            <button class="recent" type="button" (click)="open(r.path)">
              <ui-icon name="compass" [size]="16" />
              <div class="grow">
                <div class="r-name">{{ r.name }}</div>
                <div class="r-path mono">{{ r.path }}</div>
              </div>
            </button>
          } @empty {
            <p class="muted small">Chưa mở dự án nào.</p>
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    .layout { display: grid; grid-template-columns: 1fr 300px; gap: 16px; align-items: start; }
    @media (max-width: 1000px) { .layout { grid-template-columns: 1fr; } }
    .browser { border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
    .crumb { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: var(--surface-2); border-bottom: 1px solid var(--border); font-size: 12.5px; color: var(--text-2); }
    .entries { max-height: 420px; overflow: auto; }
    .entry { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-bottom: 1px solid var(--border); cursor: pointer; color: var(--text-2); }
    .entry:last-child { border-bottom: 0; }
    .entry:hover { background: #fafbfc; }
    .entry.ng { color: var(--text); font-weight: 500; }
    .entry.ng ui-icon:first-child { color: var(--primary); }
    .recent { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px; border: 0; background: none; border-radius: 7px; text-align: left; cursor: pointer; color: var(--primary); }
    .recent:hover { background: var(--surface-2); }
    .r-name { font-weight: 500; color: var(--text); }
    .r-path { font-size: 11.5px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 210px; }
  `,
})
export class OpenPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly store = inject(ProjectStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected path = '';
  protected readonly busy = signal(false);
  protected readonly listing = signal<Listing | null>(null);
  protected readonly recent = this.store.recent();

  ngOnInit(): void {
    const start = this.store.project()?.path ?? this.recent[0]?.path;
    void this.browse(start ? start.replace(/\/[^/]+$/, '') : '');
  }

  protected async browse(path: string): Promise<void> {
    try {
      this.listing.set(await this.api.get<Listing>(`/api/fs/list?path=${encodeURIComponent(path)}`));
      this.path = this.listing()!.path;
    } catch (e) {
      this.toast.error(e);
    }
  }

  protected async open(path: string): Promise<void> {
    this.busy.set(true);
    try {
      const p = await this.store.open(path.trim());
      this.toast.success(`Đã mở ${p.name}`);
      await this.router.navigateByUrl('/overview');
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}
