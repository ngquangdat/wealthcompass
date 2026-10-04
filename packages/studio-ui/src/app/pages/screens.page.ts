import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import type { AiState, FeatureRow } from '../core/models';
import { ProjectStore } from '../core/project.store';
import { ToastService } from '../core/toast.service';
import { ChipsInputComponent } from '../shared/chips-input.component';
import { IconComponent } from '../shared/icon.component';
import { LogConsoleComponent } from '../shared/log-console.component';
import { PageHeaderComponent } from '../shared/page-header.component';

type Filter = 'all' | 'draft' | 'missing' | 'hidden';

interface Draft {
  title: string;
  description: string;
  keywords: string[];
  questions: string;
  hidden: boolean;
  // Ghi đè quyền cho riêng màn hình (thay cho quyền suy từ guard)
  overrideRoles: boolean;
  roles: string[];
}

const FIELD_LABEL: Record<string, string> = { description: 'mô tả', keywords: 'từ khóa', sampleQuestions: 'câu hỏi mẫu', title: 'tiêu đề' };

@Component({
  selector: 'page-screens',
  imports: [FormsModule, RouterLink, ChipsInputComponent, IconComponent, PageHeaderComponent, LogConsoleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header title="Màn hình" subtitle="Dữ liệu trợ lý dùng để tìm đúng màn hình. Nội dung AI soạn cần bạn duyệt trước khi dùng thật.">
      @if (missingCount()) {
        <button class="btn btn-ai" (click)="enrich()" [disabled]="enriching() || !ai()?.hasKey" [title]="ai()?.hasKey ? '' : 'Chưa có khóa AI'">
          @if (enriching()) { <span class="spinner"></span> Đang soạn... } @else { <ui-icon name="sparkles" /> AI soạn cho {{ missingCount() }} màn hình còn thiếu }
        </button>
      }
    </ui-page-header>

    @if (enrichLogs().length) { <ui-log-console [lines]="enrichLogs()" height="140px" /> }

    <div class="card">
      <div class="toolbar">
        <div class="tabs">
          @for (t of tabs; track t.key) {
            <button class="tab" [class.active]="filter() === t.key" (click)="filter.set(t.key)">
              {{ t.label }} <span class="count">{{ counts()[t.key] }}</span>
            </button>
          }
        </div>
        <div class="search">
          <ui-icon name="search" [size]="15" />
          <input [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="Tìm màn hình..." />
        </div>
      </div>

      <table class="table">
        <thead>
          <tr><th>Màn hình</th><th>Trong menu</th><th>Tìm kiếm</th><th>Quyền</th><th>Trạng thái</th></tr>
        </thead>
        <tbody>
          @for (r of rows(); track r.id) {
            <tr class="clickable" [class.selected]="selectedId() === r.id" (click)="select(r)">
              <td>
                <div class="t-title">{{ r.title }}</div>
                <div class="mono muted t-route">{{ r.route }}</div>
              </td>
              <td class="small muted">{{ r.menuPath.join(' › ') || '—' }}</td>
              <td class="small">
                <span [class.muted]="!r.description">{{ r.description ? truncate(r.description, 70) : 'Chưa có mô tả' }}</span>
                <div class="muted t-meta">{{ r.keywords.length }} từ khóa · {{ r.sampleQuestions.length }} câu hỏi</div>
              </td>
              <td>
                @for (q of r.requires; track q) { <span class="chip">{{ q }}</span> } @empty { <span class="muted small">—</span> }
                @if (r.requiresOverride) { <span class="badge tiny" title="Quyền ghi đè cho riêng màn hình này">ghi đè</span> }
              </td>
              <td>
                @if (r.hidden) { <span class="badge"><ui-icon name="eye-off" [size]="12" /> Ẩn</span> }
                @else if (r.draft.length) { <span class="badge ai"><ui-icon name="sparkles" [size]="12" /> Chờ duyệt</span> }
                @else if (r.gaps.includes('description')) { <span class="badge warning">Thiếu mô tả</span> }
                @else { <span class="badge success"><ui-icon name="check" [size]="12" /> Sẵn sàng</span> }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="5"><div class="empty">Không có màn hình nào khớp.</div></td></tr>
          }
        </tbody>
      </table>
    </div>

    @if (selected(); as r) {
      <div class="scrim" (click)="close()"></div>
      <aside class="drawer" role="dialog" aria-label="Sửa màn hình">
        <div class="d-head">
          <div class="grow">
            <h2>{{ r.title }}</h2>
            <div class="mono muted small">{{ r.route }}@if (r.sourceRef) { · {{ r.sourceRef }} }</div>
          </div>
          <button class="btn btn-ghost btn-icon" (click)="close()" aria-label="Đóng"><ui-icon name="x" /></button>
        </div>

        <div class="d-body stack">
          @if (r.draft.length) {
            <div class="alert info ai-alert">
              <ui-icon name="sparkles" />
              <div class="grow">AI đã soạn {{ draftLabels(r) }}. Đọc lại, sửa nếu cần rồi bấm duyệt.</div>
              <button class="btn btn-sm" (click)="approve(r)">Duyệt nguyên trạng</button>
            </div>
          }

          <div class="field">
            <label for="f-title">Tiêu đề</label>
            <input id="f-title" class="input" [(ngModel)]="draft.title" />
            <span class="hint">Tên người dùng thấy trên giao diện. Để trống để dùng tiêu đề từ code hoặc menu.</span>
          </div>
          <div class="field">
            <label for="f-desc">Mô tả</label>
            <textarea id="f-desc" class="textarea" rows="3" [(ngModel)]="draft.description" placeholder="Người dùng làm được gì ở màn hình này"></textarea>
          </div>
          <div class="field">
            <label>Từ khóa</label>
            <ui-chips [(value)]="draft.keywords" placeholder="Gõ rồi Enter hoặc dấu phẩy" />
            <span class="hint">Cách người dùng hay gọi, nên có cả cách viết không dấu.</span>
          </div>
          <div class="field">
            <label for="f-q">Câu hỏi mẫu</label>
            <textarea id="f-q" class="textarea" rows="4" [(ngModel)]="draft.questions" placeholder="Mỗi dòng một câu"></textarea>
          </div>
          <label class="toggle-row">
            <input type="checkbox" [(ngModel)]="draft.hidden" />
            <div class="grow">
              <div>Ẩn khỏi trợ lý</div>
              <div class="hint">Trợ lý sẽ không chỉ đường tới màn hình này (ví dụ trang đăng nhập, trang lỗi).</div>
            </div>
          </label>
          <div class="field">
            <label>Quyền cần có</label>
            <div class="perm">
              <div class="perm-row">
                <ui-icon name="lock" [size]="13" />
                <span class="grow">
                  Theo guard
                  @for (g of r.guards; track g) { <code>{{ g }}</code> }
                  : <b>{{ r.guardRequires.length ? r.guardRequires.join(', ') : 'chỉ cần đăng nhập' }}</b>
                </span>
                @if (r.guards.length) { <a routerLink="/permissions" class="small">Sửa ở guard</a> }
              </div>
              <label class="perm-row check">
                <input type="checkbox" [(ngModel)]="draft.overrideRoles" />
                <span>Ghi đè cho riêng màn hình này</span>
              </label>
              @if (draft.overrideRoles) {
                <ui-chips [(value)]="draft.roles" [suggestions]="roleNames()" placeholder="Tên quyền rồi Enter (để trống = không cần quyền riêng)" />
              }
            </div>
            <span class="hint">Trợ lý chỉ dẫn tới màn hình khi người hỏi có đủ các quyền này (lấy từ claim quyền của JWT). Sửa ở guard thì áp cho mọi màn hình dùng guard đó. Đây không phải lớp bảo mật: web vẫn tự chặn bằng guard.</span>
          </div>
        </div>

        <div class="d-foot">
          <button class="btn btn-ai btn-sm" (click)="enrich([r.id])" [disabled]="enriching() || !ai()?.hasKey" title="Chỉ soạn phần đang trống">
            <ui-icon name="sparkles" [size]="14" /> AI soạn phần trống
          </button>
          <span class="grow"></span>
          <button class="btn" (click)="close()">Hủy</button>
          <button class="btn btn-primary" (click)="save(r)" [disabled]="saving()">@if (saving()) { <span class="spinner"></span> } Lưu</button>
        </div>
      </aside>
    }
  `,
  styles: `
    .perm { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
    .perm-row { display: flex; align-items: center; gap: 8px; font-size: 13.5px; }
    .perm-row code { margin-left: 4px; }
    .perm-row.check { cursor: pointer; }
    .badge.tiny { font-size: 10.5px; margin-left: 4px; }
    :host { display: flex; flex-direction: column; gap: 16px; }
    .toolbar { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
    .tabs { display: flex; gap: 4px; flex: 1; }
    .tab { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 7px; border: 0; background: none; color: var(--text-2); font: 500 13.5px Inter, sans-serif; cursor: pointer; }
    .tab:hover { background: #f2f4f7; }
    .tab.active { background: var(--primary-soft); color: var(--primary); }
    .count { font-size: 12px; background: #fff; border: 1px solid var(--border); border-radius: 999px; padding: 0 7px; color: var(--text-3); }
    .search { display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 10px; border: 1px solid var(--border-strong); border-radius: 7px; width: 240px; color: var(--text-3); }
    .search input { border: 0; outline: 0; flex: 1; font: 13.5px Inter, sans-serif; background: transparent; }
    .t-title { font-weight: 500; }
    .t-route { font-size: 12px; margin-top: 2px; }
    .t-meta { font-size: 12px; margin-top: 3px; }
    td .chip { margin: 0 4px 4px 0; }
    .scrim { position: fixed; inset: 0; background: rgba(16, 24, 40, .25); z-index: 50; }
    .drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(560px, 100vw); background: var(--surface); z-index: 51; display: flex; flex-direction: column; box-shadow: var(--shadow-lg); }
    .d-head { display: flex; align-items: flex-start; gap: 12px; padding: 20px 24px; border-bottom: 1px solid var(--border); }
    .d-body { flex: 1; overflow: auto; padding: 20px 24px; }
    .d-foot { display: flex; align-items: center; gap: 8px; padding: 14px 24px; border-top: 1px solid var(--border); background: var(--surface-2); }
    .ai-alert { align-items: center; background: var(--ai-soft); border-color: #d9d6fe; color: #5925dc; }
    .toggle-row { display: flex; gap: 10px; align-items: flex-start; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; }
  `,
})
export class ScreensPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly store = inject(ProjectStore);
  private readonly toast = inject(ToastService);

  protected readonly tabs: Array<{ key: Filter; label: string }> = [
    { key: 'all', label: 'Tất cả' },
    { key: 'draft', label: 'Chờ duyệt' },
    { key: 'missing', label: 'Thiếu mô tả' },
    { key: 'hidden', label: 'Đã ẩn' },
  ];
  protected readonly all = signal<FeatureRow[]>([]);
  protected readonly filter = signal<Filter>('all');
  protected readonly query = signal('');
  protected readonly selectedId = signal<string | null>(null);
  protected readonly enriching = signal(false);
  protected readonly enrichLogs = signal<string[]>([]);
  protected readonly saving = signal(false);
  protected readonly ai = signal<AiState | null>(null);

  protected draft: Draft = { title: '', description: '', keywords: [], questions: '', hidden: false, overrideRoles: false, roles: [] };

  protected readonly counts = computed(() => {
    const a = this.all();
    return {
      all: a.length,
      draft: a.filter((r) => r.draft.length).length,
      missing: a.filter((r) => r.gaps.includes('description') && !r.hidden).length,
      hidden: a.filter((r) => r.hidden).length,
    } as Record<Filter, number>;
  });
  protected readonly missingCount = computed(() => this.all().filter((r) => r.gaps.length && !r.hidden).length);
  protected readonly selected = computed(() => this.all().find((r) => r.id === this.selectedId()) ?? null);
  protected readonly rows = computed(() => {
    const q = this.query().toLowerCase().trim();
    return this.all().filter((r) => {
      const f = this.filter();
      if (f === 'draft' && !r.draft.length) return false;
      if (f === 'missing' && (!r.gaps.includes('description') || r.hidden)) return false;
      if (f === 'hidden' && !r.hidden) return false;
      return !q || `${r.title} ${r.route} ${r.menuPath.join(' ')}`.toLowerCase().includes(q);
    });
  });

  // Danh mục quyền để gợi ý khi ghi đè quyền
  protected readonly roleNames = signal<string[]>([]);

  async ngOnInit(): Promise<void> {
    this.ai.set(await this.api.get<AiState>('/api/ai').catch(() => null));
    await this.load();
    const roles = await this.api.get<Array<{ name: string }>>('/api/roles').catch(() => []);
    this.roleNames.set(roles.map((r) => r.name));
  }

  private async load(): Promise<void> {
    try {
      this.all.set(await this.api.get<FeatureRow[]>('/api/features'));
    } catch (e) {
      this.toast.error(e);
    }
  }

  protected select(r: FeatureRow): void {
    this.selectedId.set(r.id);
    this.draft = {
      title: r.overridden.includes('title') ? r.title : '',
      description: r.description,
      keywords: [...r.keywords],
      questions: r.sampleQuestions.join('\n'),
      hidden: r.hidden,
      overrideRoles: r.requiresOverride,
      roles: [...r.requires],
    };
  }

  protected close(): void {
    this.selectedId.set(null);
  }

  protected async save(r: FeatureRow): Promise<void> {
    this.saving.set(true);
    try {
      const questions = this.draft.questions.split('\n').map((q) => q.trim()).filter(Boolean);
      // Chỉ gửi trường thực sự đổi để không biến dữ liệu lấy từ code thành bản ghi đè
      const changes: Record<string, unknown> = {};
      if ((this.draft.title.trim() || null) !== (r.overridden.includes('title') ? r.title : null)) changes['title'] = this.draft.title.trim() || null;
      if (this.draft.description.trim() !== r.description) changes['description'] = this.draft.description.trim() || null;
      if (JSON.stringify(this.draft.keywords) !== JSON.stringify(r.keywords)) changes['keywords'] = this.draft.keywords;
      if (JSON.stringify(questions) !== JSON.stringify(r.sampleQuestions)) changes['sampleQuestions'] = questions;
      if (this.draft.hidden !== r.hidden) changes['hidden'] = this.draft.hidden;
      // Quyền: bật ghi đè gửi danh sách (kể cả rỗng); tắt ghi đè gửi null để quay về quyền từ guard
      if (this.draft.overrideRoles !== r.requiresOverride || (this.draft.overrideRoles && JSON.stringify(this.draft.roles) !== JSON.stringify(r.requires))) {
        changes['requires'] = this.draft.overrideRoles ? this.draft.roles : null;
      }
      if (!Object.keys(changes).length && !r.draft.length) {
        this.close();
        return;
      }
      // Lưu mà không đổi gì ở màn hình đang chờ duyệt = duyệt nguyên trạng
      if (!Object.keys(changes).length) await this.api.post(`/api/features/${encodeURIComponent(r.id)}/approve`);
      else await this.api.put(`/api/features/${encodeURIComponent(r.id)}`, changes);
      await this.load();
      void this.store.refreshOverview();
      this.toast.success(`Đã lưu ${r.title}`);
      this.close();
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.saving.set(false);
    }
  }

  protected async approve(r: FeatureRow): Promise<void> {
    try {
      await this.api.post(`/api/features/${encodeURIComponent(r.id)}/approve`);
      await this.load();
      void this.store.refreshOverview();
      this.toast.success(`Đã duyệt ${r.title}`);
    } catch (e) {
      this.toast.error(e);
    }
  }

  protected async enrich(ids?: string[]): Promise<void> {
    this.enriching.set(true);
    this.enrichLogs.set([]);
    try {
      const res = await this.api.stream<{ drafted: number }>('/api/features/enrich', { ids }, (l) => this.enrichLogs.update((x) => [...x, l]));
      await this.load();
      void this.store.refreshOverview();
      this.toast.success(res.drafted ? `AI đã soạn nháp ${res.drafted} màn hình` : 'Không có màn hình nào cần soạn');
      const s = this.selected();
      if (s) this.select(s);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.enriching.set(false);
    }
  }

  protected draftLabels(r: FeatureRow): string {
    return r.draft.map((f) => FIELD_LABEL[f] ?? f).join(', ');
  }

  protected truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }
}
