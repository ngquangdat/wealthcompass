import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import type { AiState, GuardRow } from '../core/models';
import { ProjectStore } from '../core/project.store';
import { ToastService } from '../core/toast.service';
import { ChipsInputComponent } from '../shared/chips-input.component';
import { IconComponent } from '../shared/icon.component';
import { PageHeaderComponent } from '../shared/page-header.component';

const STATUS: Record<GuardRow['status'], { label: string; cls: string }> = {
  unmapped: { label: 'Chưa ánh xạ', cls: 'danger' },
  draft: { label: 'Đoán từ tên, cần duyệt', cls: 'warning' },
  reviewed: { label: 'Đã duyệt', cls: 'success' },
  code: { label: 'Đọc từ code', cls: 'success' },
  auth: { label: 'Chỉ cần đăng nhập', cls: 'primary' },
  manual: { label: 'Khai tay', cls: '' },
};

@Component({
  selector: 'page-permissions',
  imports: [IconComponent, PageHeaderComponent, ChipsInputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header title="Quyền" subtitle="Guard trên route quyết định màn hình cần quyền gì. Trợ lý dựa vào đây để không chỉ đường tới màn hình người dùng không vào được." />

    <div class="alert info"><ui-icon name="info" /><span>Tên quyền phải trùng với giá trị trong claim quyền của JWT (mặc định <code>roles</code>). Guard chỉ kiểm tra đăng nhập thì để trống.</span></div>

    <div class="card">
      <table class="table">
        <thead><tr><th>Guard</th><th>Dùng ở</th><th>Quyền yêu cầu</th><th>Nguồn</th><th></th></tr></thead>
        <tbody>
          @for (g of guards(); track g.name) {
            <tr>
              <td><code>{{ g.name }}</code></td>
              <td class="small muted">{{ g.screens.join(', ') || '—' }}</td>
              <td class="roles">
                @if (editing() === g.name) {
                  <ui-chips [(value)]="draft" placeholder="Tên quyền rồi Enter" />
                  @if (g.evidence) { <div class="hint">{{ g.evidence }}</div> }
                } @else {
                  @for (r of g.requires ?? []; track r) { <span class="chip">{{ r }}</span> }
                  @if (g.requires && !g.requires.length) { <span class="muted small">Không cần quyền riêng</span> }
                  @if (!g.requires) { <span class="muted small">—</span> }
                }
              </td>
              <td><span class="badge" [class]="status(g).cls">{{ status(g).label }}</span></td>
              <td class="actions">
                @if (editing() === g.name) {
                  <button class="btn btn-ai btn-sm" (click)="askAi(g)" [disabled]="aiBusy() || !ai()?.aiCode" [title]="ai()?.aiCode ? 'AI đọc code guard' : 'Bật quyền đọc mã nguồn trong Cài đặt AI'">
                    @if (aiBusy()) { <span class="spinner"></span> } @else { <ui-icon name="sparkles" [size]="13" /> } AI đọc code
                  </button>
                  <button class="btn btn-sm" (click)="editing.set(null)">Hủy</button>
                  <button class="btn btn-primary btn-sm" (click)="save(g)">Lưu</button>
                } @else {
                  @if (g.status === 'draft' || g.status === 'unmapped') {
                    <button class="btn btn-primary btn-sm" (click)="edit(g)">Duyệt</button>
                  } @else {
                    <button class="btn btn-ghost btn-sm" (click)="edit(g)"><ui-icon name="edit" [size]="13" /> Sửa</button>
                  }
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="5"><div class="empty"><h3>Không có guard nào</h3><p>Các route của dự án không dùng canActivate.</p></div></td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    td.roles { min-width: 260px; }
    td.roles .chip { margin: 0 4px 4px 0; }
    td.actions { white-space: nowrap; text-align: right; }
    td.actions .btn { margin-left: 6px; }
    .hint { margin-top: 6px; }
  `,
})
export class PermissionsPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly store = inject(ProjectStore);
  private readonly toast = inject(ToastService);
  protected readonly guards = signal<GuardRow[]>([]);
  protected readonly editing = signal<string | null>(null);
  protected readonly aiBusy = signal(false);
  protected readonly ai = signal<AiState | null>(null);
  protected draft: string[] = [];

  async ngOnInit(): Promise<void> {
    this.ai.set(await this.api.get<AiState>('/api/ai').catch(() => null));
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      this.guards.set(await this.api.get<GuardRow[]>('/api/guards'));
    } catch (e) {
      this.toast.error(e);
    }
  }

  protected status(g: GuardRow) {
    return STATUS[g.status];
  }

  protected edit(g: GuardRow): void {
    this.draft = [...(g.requires ?? [])];
    this.editing.set(g.name);
  }

  protected async save(g: GuardRow): Promise<void> {
    try {
      await this.api.put(`/api/guards/${encodeURIComponent(g.name)}`, { requires: this.draft });
      this.editing.set(null);
      await this.load();
      void this.store.refreshOverview();
      this.toast.success(`Đã lưu quyền của ${g.name}. Trợ lý dùng ngay quyền mới.`);
    } catch (e) {
      this.toast.error(e);
    }
  }

  protected async askAi(g: GuardRow): Promise<void> {
    this.aiBusy.set(true);
    try {
      const res = await this.api.stream<{ requires: string[]; evidence?: string; fromAi: boolean }>(`/api/guards/${encodeURIComponent(g.name)}/ai`, {}, () => undefined);
      if (res.fromAi) {
        this.draft = res.requires;
        this.toast.success(`AI đề xuất: ${res.requires.join(', ') || 'không cần quyền riêng'}. Kiểm tra rồi bấm Lưu.`);
      } else this.toast.show('AI không đọc được guard này; hãy khai tay.');
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.aiBusy.set(false);
    }
  }
}
