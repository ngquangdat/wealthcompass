import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import type { AiState, GuardRow, RoleRow } from '../core/models';
import { ProjectStore } from '../core/project.store';
import { ToastService } from '../core/toast.service';
import { ChipsInputComponent } from '../shared/chips-input.component';
import { IconComponent } from '../shared/icon.component';
import { PageHeaderComponent } from '../shared/page-header.component';

const STATUS: Record<GuardRow['status'], { label: string; cls: string }> = {
  default: { label: 'Mặc định', cls: '' },
  draft: { label: 'Đoán từ tên (cấu hình cũ), nên xem lại', cls: 'warning' },
  reviewed: { label: 'Đã khai', cls: 'success' },
  code: { label: 'Đã khai', cls: 'success' },
  auth: { label: 'Đã khai', cls: 'success' },
  manual: { label: 'Đã khai', cls: 'success' },
};

@Component({
  selector: 'page-permissions',
  imports: [FormsModule, IconComponent, PageHeaderComponent, ChipsInputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header title="Quyền" subtitle="Mặc định mọi màn hình chỉ cần đăng nhập. Chỉ khai quyền khi muốn trợ lý không chỉ đường tới màn hình mà người dùng thiếu quyền không vào được." />

    <div class="alert info"><ui-icon name="info" /><span>Không cần làm gì ở trang này nếu web không phân quyền theo màn hình. Khi khai quyền: tên quyền phải trùng với giá trị trong claim quyền của JWT (mặc định <code>roles</code>); để trống là chỉ cần đăng nhập.</span></div>

    <section class="card">
      <div class="sec-head">
        <h3 class="grow">Danh mục quyền</h3>
        <span class="muted small">Lưu trong <code>compass.config.yaml</code> (<code>access.roles</code>); dùng làm gợi ý khi chọn quyền cho guard, màn hình và Thử trợ lý.</span>
      </div>
      <table class="table">
        <thead><tr><th class="c-name">Quyền</th><th>Mô tả</th><th>Dùng ở</th><th></th></tr></thead>
        <tbody>
          @for (r of roles(); track r.name) {
            <tr>
              <td><code>{{ r.name }}</code> @if (!r.inCatalog) { <span class="badge warning tiny" title="Đang được dùng nhưng chưa khai trong danh mục">chưa khai</span> }</td>
              <td>
                @if (editingRole() === r.name) {
                  <input class="input" [(ngModel)]="roleDesc" (keydown.enter)="saveRole(r.name)" placeholder="Ví dụ: nhân viên phòng nhân sự, xem được bảng lương" />
                } @else {
                  {{ r.description || '' }} @if (!r.description) { <span class="muted small">chưa có mô tả</span> }
                }
              </td>
              <td class="small">
                @for (g of r.guards; track g) { <span class="chip">{{ g }}</span> }
                @for (s of r.screens; track s) { <span class="chip screen">{{ s }}</span> }
                @if (!r.guards.length && !r.screens.length) { <span class="muted">chưa dùng</span> }
              </td>
              <td class="actions">
                @if (editingRole() === r.name) {
                  <button class="btn btn-sm" (click)="editingRole.set(null)">Hủy</button>
                  <button class="btn btn-primary btn-sm" (click)="saveRole(r.name)">Lưu</button>
                } @else {
                  <button class="btn btn-ghost btn-sm" (click)="editRole(r)"><ui-icon name="edit" [size]="13" /> {{ r.inCatalog ? 'Sửa' : 'Khai' }}</button>
                  @if (r.inCatalog && !r.guards.length && !r.screens.length) {
                    @if (confirmingRole() === r.name) {
                      <button class="btn btn-danger btn-sm" (click)="removeRole(r)">Xóa</button>
                      <button class="btn btn-ghost btn-sm" (click)="confirmingRole.set(null)">Không</button>
                    } @else {
                      <button class="btn btn-ghost btn-icon btn-sm" (click)="confirmingRole.set(r.name)" title="Xóa khỏi danh mục"><ui-icon name="trash" [size]="13" /></button>
                    }
                  }
                }
              </td>
            </tr>
          }
          <tr class="add-row">
            <td><input class="input mono" [(ngModel)]="newName" placeholder="ten_quyen" (keydown.enter)="addRole()" /></td>
            <td><input class="input" [(ngModel)]="newDesc" placeholder="Mô tả ngắn: ai có quyền này, làm được gì" (keydown.enter)="addRole()" /></td>
            <td class="muted small">Tên trùng giá trị trong claim JWT</td>
            <td class="actions"><button class="btn btn-sm" (click)="addRole()" [disabled]="!newName.trim()">+ Thêm quyền</button></td>
          </tr>
        </tbody>
      </table>
    </section>

    <div class="card">
      <div class="sec-head">
        <h3 class="grow">Guard trên route</h3>
        <span class="muted small">Quyền của guard áp cho mọi màn hình dùng guard đó; ghi đè riêng từng màn hình ở trang Màn hình.</span>
      </div>
      <table class="table">
        <thead><tr><th>Guard</th><th>Dùng ở</th><th>Quyền yêu cầu</th><th>Nguồn</th><th></th></tr></thead>
        <tbody>
          @for (g of guards(); track g.name) {
            <tr>
              <td><code>{{ g.name }}</code></td>
              <td class="small muted">{{ g.screens.join(', ') || '—' }}</td>
              <td class="roles">
                @if (editing() === g.name) {
                  <ui-chips [(value)]="draft" [suggestions]="roleNames()" placeholder="Chọn hoặc gõ tên quyền" />
                  @if (g.evidence) { <div class="hint">{{ g.evidence }}</div> }
                } @else {
                  @for (r of g.requires ?? []; track r) { <span class="chip">{{ r }}</span> }
                  @if (!g.requires?.length) { <span class="muted small">Chỉ cần đăng nhập</span> }
                  @if (!g.requires && g.suggested?.length) { <div class="hint">Trong code có: {{ g.suggested!.join(', ') }} (chưa áp)</div> }
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
                  <button class="btn btn-ghost btn-sm" (click)="edit(g)"><ui-icon name="edit" [size]="13" /> {{ g.requires ? 'Sửa' : 'Khai quyền' }}</button>
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
    .sec-head { display: flex; align-items: baseline; gap: 12px; padding: 14px 16px 6px; flex-wrap: wrap; }
    .sec-head h3 { margin: 0; }
    .c-name { width: 220px; }
    td .chip { margin: 0 4px 4px 0; }
    .chip.screen { background: var(--primary-soft); color: var(--primary); }
    .badge.tiny { font-size: 10.5px; margin-left: 6px; }
    tr.add-row td { background: var(--surface-2); }
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
  protected readonly roles = signal<RoleRow[]>([]);
  protected readonly roleNames = computed(() => this.roles().map((r) => r.name));
  protected readonly editingRole = signal<string | null>(null);
  protected roleDesc = '';
  protected newName = '';
  protected newDesc = '';

  async ngOnInit(): Promise<void> {
    this.ai.set(await this.api.get<AiState>('/api/ai').catch(() => null));
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      const [guards, roles] = await Promise.all([this.api.get<GuardRow[]>('/api/guards'), this.api.get<RoleRow[]>('/api/roles')]);
      this.guards.set(guards);
      this.roles.set(roles);
    } catch (e) {
      this.toast.error(e);
    }
  }

  protected status(g: GuardRow) {
    return STATUS[g.status];
  }

  protected edit(g: GuardRow): void {
    // Chưa khai thì điền sẵn chuỗi quyền thấy trong code để người chọn giữ hay xóa
    this.draft = [...(g.requires ?? g.suggested ?? [])];
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

  protected editRole(r: RoleRow): void {
    this.roleDesc = r.description;
    this.editingRole.set(r.name);
  }

  protected async saveRole(name: string): Promise<void> {
    try {
      await this.api.put(`/api/roles/${encodeURIComponent(name)}`, { description: this.roleDesc });
      this.editingRole.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(e);
    }
  }

  protected async addRole(): Promise<void> {
    const name = this.newName.trim();
    if (!name) return;
    if (this.roles().some((r) => r.name === name && r.inCatalog)) return this.toast.show(`Quyền "${name}" đã có.`);
    try {
      await this.api.put(`/api/roles/${encodeURIComponent(name)}`, { description: this.newDesc });
      this.newName = '';
      this.newDesc = '';
      await this.load();
      this.toast.success(`Đã thêm quyền ${name}`);
    } catch (e) {
      this.toast.error(e);
    }
  }

  // Xác nhận xóa ngay trong trang, không dùng confirm() của trình duyệt (bị chặn trong một số khung nhúng)
  protected readonly confirmingRole = signal<string | null>(null);

  protected async removeRole(r: RoleRow): Promise<void> {
    this.confirmingRole.set(null);
    try {
      await this.api.delete(`/api/roles/${encodeURIComponent(r.name)}`);
      await this.load();
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
