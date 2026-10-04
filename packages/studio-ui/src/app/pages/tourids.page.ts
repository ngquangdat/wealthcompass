import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import type { AiState, FilePatch, TourIdCandidate } from '../core/models';
import { ProjectStore } from '../core/project.store';
import { ToastService } from '../core/toast.service';
import { DiffViewComponent } from '../shared/diff-view.component';
import { IconComponent } from '../shared/icon.component';
import { LogConsoleComponent } from '../shared/log-console.component';
import { PageHeaderComponent } from '../shared/page-header.component';

interface ExistingTourId {
  tourId: string;
  label: string | null;
  hint: string | null;
  userOnly: boolean;
  menu: boolean;
  shared: boolean;
  screens: Array<{ route: string; title: string }>;
  location: string | null;
  usedBy: string[];
}

interface Row extends TourIdCandidate {
  include: boolean;
  newId: string;
  hint: string;
  userOnly: boolean;
  aiFlag?: string;
  // Đã chạy AI theo luồng và AI cho là không thuộc luồng: hiện ở nhóm riêng để dễ tích lại
  aiSkipped?: boolean;
}

const KIND: Record<string, string> = { button: 'Nút', link: 'Link', input: 'Ô nhập', tab: 'Tab', menu: 'Menu', other: 'Khác' };

@Component({
  selector: 'page-tourids',
  imports: [FormsModule, NgTemplateOutlet, IconComponent, PageHeaderComponent, DiffViewComponent, LogConsoleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header title="Gắn tourId" subtitle="Đánh dấu các phần tử tour sẽ trỏ vào. Chỉ chọn phần tử của luồng cần dẫn; mỗi tourId là một cam kết lâu dài với tour." />

    @if (!files().length) {
      <div class="tabs">
        <button [class.active]="tab() === 'scan'" (click)="tab.set('scan')">Chưa gắn</button>
        <button [class.active]="tab() === 'existing'" (click)="tab.set('existing')">Đã gắn <span class="count">{{ existing().length }}</span></button>
      </div>
    }

    @if (!files().length && tab() === 'existing') {
      <div class="card">
        <div class="toolbar">
          <ui-icon name="search" [size]="15" />
          <input class="input grow" [(ngModel)]="query" (ngModelChange)="touch()" placeholder="Tìm theo tourId, nhãn, màn hình hoặc tên tour" />
          <label class="check small"><input type="checkbox" [(ngModel)]="unusedOnly" (ngModelChange)="touch()" /> Chỉ mốc chưa dùng trong tour</label>
        </div>
        @for (g of existingGroups(); track g.title) {
          <div class="group-head"><b>{{ g.title }}</b> <span class="mono muted">{{ g.sub }}</span></div>
          <table class="table">
            <tbody>
              @for (x of g.items; track x.tourId) {
                <tr>
                  <td class="c-tid">
                    <code>{{ x.tourId }}</code>
                    @if (x.userOnly) { <span class="badge danger tiny-badge" title="Tour chỉ tô sáng, người dùng tự thao tác"><ui-icon name="lock" [size]="11" /> user-only</span> }
                  </td>
                  <td>
                    <div>{{ x.label || '(chưa có nhãn)' }}</div>
                    @if (x.hint) { <div class="muted small">{{ x.hint }}</div> }
                  </td>
                  <td class="c-loc mono muted small">{{ x.location ?? '' }}</td>
                  <td class="c-used">
                    @for (t of x.usedBy; track t) { <span class="badge info">{{ t }}</span> } @empty { <span class="muted small">chưa dùng</span> }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        } @empty {
          <div class="empty-row">@if (existing().length) { Không có mốc nào khớp. } @else { Dự án chưa có tourId nào. Chuyển sang tab "Chưa gắn" để quét. }</div>
        }
      </div>
    }

    @if (!files().length && tab() === 'scan') {
      <div class="card">
        <div class="card-body stack">
          <div class="field">
            <label>Màn hình cần quét</label>
            <div class="screen-pick">
              @if (!screensLoaded()) { <span class="muted small"><span class="spinner"></span> Đang đọc các màn hình...</span> }
              @for (s of screens(); track s.route) {
                <button type="button" class="pick" [class.on]="picked().has(s.route)" (click)="togglePick(s.route)">
                  {{ s.title }} @if (s.tourIds) { <span class="muted">· {{ s.tourIds }}</span> }
                </button>
              }
            </div>
            <span class="hint">Không chọn màn hình nào = quét tất cả. Số bên cạnh là tourId đã có.</span>
          </div>
          <div class="row">
            <span class="grow"></span>
            <button class="btn btn-primary" (click)="scan()" [disabled]="scanning()">@if (scanning()) { <span class="spinner"></span> } <ui-icon name="search" /> Tìm phần tử chưa có tourId</button>
          </div>
        </div>
      </div>

      @if (rows().length) {
        <div class="card ai-card">
          <div class="card-body stack">
            <div class="row">
              <span class="badge ai"><ui-icon name="sparkles" [size]="12" /> AI</span>
              <input class="input grow" [(ngModel)]="flow" placeholder="Luồng cần dẫn, ví dụ: xin nghỉ phép rồi xem đơn đã gửi (để trống nếu chỉ cần rà soát)" />
              <button class="btn btn-ai" (click)="askAi()" [disabled]="aiBusy() || !ai()?.hasKey">@if (aiBusy()) { <span class="spinner"></span> } AI gợi ý</button>
            </div>
            <p class="hint">AI chọn phần tử thuộc luồng (nếu có), đánh dấu thêm phần tử nhạy cảm (chỉ thêm, không bỏ) và viết gợi ý ngắn cho từng phần tử. AI chỉ đọc chữ hiển thị.</p>
            @if (aiLogs().length) { <ui-log-console [lines]="aiLogs()" height="90px" /> }
          </div>
        </div>

        <div class="card">
          <div class="toolbar">
            <span class="grow"><b>{{ selectedCount() }}</b> / {{ rows().length }} phần tử được chọn</span>
            <button class="btn btn-ghost btn-sm" (click)="selectAll(true)">Chọn tất cả</button>
            <button class="btn btn-ghost btn-sm" (click)="selectAll(false)">Bỏ chọn</button>
          </div>
          @for (g of groups(); track g.screen) {
            <div class="group-head"><b>{{ g.title }}</b> <span class="mono muted">{{ g.screen }}</span></div>
            <table class="table"><tbody>
              @for (r of g.rows; track r.key) { <ng-container [ngTemplateOutlet]="rowTpl" [ngTemplateOutletContext]="{ $implicit: r }" /> }
            </tbody></table>
          }
          @if (aiSkipped().length) {
            <button type="button" class="skipped-head" (click)="showSkipped.set(!showSkipped())">
              <ui-icon [name]="showSkipped() ? 'chevron-down' : 'chevron-right'" [size]="14" />
              <b>AI cho là không thuộc luồng · {{ aiSkipped().length }}</b>
              <span class="muted small">kiểm tra lại: thiếu một bước là tour không đi tiếp được</span>
            </button>
            @if (showSkipped()) {
              <table class="table"><tbody>
                @for (r of aiSkipped(); track r.key) { <ng-container [ngTemplateOutlet]="rowTpl" [ngTemplateOutletContext]="{ $implicit: r }" /> }
              </tbody></table>
            }
          }
          <ng-template #rowTpl let-r>
            <tr [class.off]="!r.include">
              <td class="c-check"><input type="checkbox" [(ngModel)]="r.include" (ngModelChange)="touch()" /></td>
              <td class="c-el">
                <span class="badge" [class.info]="r.kind === 'menu'">{{ kind(r.kind) }}</span>
                <span class="el-label">{{ r.kind === 'menu' ? 'Mọi mục của thanh menu' : r.label || '(không có chữ)' }}</span>
                @if (r.aiSkipped) { <span class="screen-tag muted small">{{ r.screenTitle }}</span> }
                <div class="mono muted small">{{ r.file }}:{{ r.line }}</div>
              </td>
              @if (r.kind === 'menu') {
                <td class="c-id" colspan="3">
                  <code class="menu-id">[tourMenu]="{{ r.menuExpr }}"</code>
                  <div class="muted small">Mỗi mục có mốc riêng theo route, ví dụ <code>menu-profile</code>, <code>menu-leave-request</code>; mục thêm sau cũng tự có.</div>
                </td>
              } @else {
                <td class="c-id"><input class="input mono" [(ngModel)]="r.newId" [disabled]="!r.include" /></td>
                <td class="c-hint"><input class="input" [(ngModel)]="r.hint" placeholder="Gợi ý (tùy chọn)" [disabled]="!r.include" /></td>
                <td class="c-only">
                  <label class="only" [title]="r.sensitive?.reason ?? r.aiFlag ?? ''">
                    <input type="checkbox" [(ngModel)]="r.userOnly" [disabled]="!r.include || r.sensitive?.level === 'sure'" />
                    @if (r.sensitive?.level === 'sure') { <ui-icon name="lock" [size]="12" /> }
                    <span>Người dùng tự bấm</span>
                  </label>
                  @if (r.sensitive) { <div class="why" [class.sure]="r.sensitive.level === 'sure'">{{ r.sensitive.reason }}</div> }
                  @else if (r.aiFlag) { <div class="why ai">AI: {{ r.aiFlag }}</div> }
                </td>
              }
            </tr>
          </ng-template>
          <div class="foot">
            @if (skipped().length) { <span class="muted small grow">{{ skipped().length }} component bị bỏ qua (xem ghi chú bên dưới)</span> } @else { <span class="grow"></span> }
            <button class="btn btn-primary" (click)="makePatch()" [disabled]="!selectedCount() || busy()">Tạo thay đổi cho {{ selectedCount() }} phần tử <ui-icon name="chevron-right" /></button>
          </div>
        </div>
        @if (skipped().length) {
          <div class="card"><div class="card-body small stack">@for (s of skipped(); track s.component) { <div><code>{{ s.component }}</code> <span class="muted">{{ s.file }}</span>: {{ s.reason }}</div> }</div></div>
        }
      } @else if (scanned()) {
        <div class="card empty"><h3>Không còn phần tử nào thiếu tourId</h3><p>Các màn hình đã chọn đều đã được gắn.</p></div>
      }
    }
    @if (files().length) {
      <div class="alert info"><ui-icon name="info" /><span>Thay đổi gồm thuộc tính <code>tourId</code> (hoặc <code>[tourMenu]</code> cho menu) trên phần tử và directive tương ứng trong component. Code chỉ đổi khi bạn bấm Áp.</span></div>
      <ui-diff-view [files]="files()" [selected]="selected()" (toggle)="toggle($event)" (setMany)="setMany($event.ids, $event.on)" />
      <div class="row">
        <button class="btn" (click)="files.set([])">Quay lại</button>
        <span class="grow muted small">Đã chọn {{ selected().size }} đoạn thay đổi</span>
        <button class="btn btn-primary" (click)="apply()" [disabled]="!selected().size || busy()">@if (busy()) { <span class="spinner"></span> } Áp thay đổi</button>
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    .screen-pick { display: flex; flex-wrap: wrap; gap: 8px; }
    .ai-card { border-color: #e4dcff; }
    .toolbar { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-bottom: 1px solid var(--border); }
    .group-head { padding: 10px 16px; background: var(--surface-2); border-bottom: 1px solid var(--border); display: flex; gap: 10px; align-items: baseline; font-size: 13.5px; }
    tr.off td { opacity: .55; }
    .c-check { width: 36px; }
    .c-el { min-width: 220px; }
    .el-label { margin-left: 8px; font-weight: 500; }
    .c-id { width: 230px; }
    .c-hint { min-width: 220px; }
    .c-id .input, .c-hint .input { height: 32px; font-size: 13px; }
    .c-only { width: 210px; }
    .only { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
    .why { font-size: 12px; color: var(--warning-text); margin-top: 4px; }
    .why.sure { color: var(--danger-text); }
    .why.ai { color: var(--ai); }
    .skipped-head { width: 100%; display: flex; align-items: center; gap: 8px; padding: 10px 16px; border: 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); background: #faf8ff; cursor: pointer; font: 13.5px Inter, sans-serif; text-align: left; color: var(--text); }
    .screen-tag { margin-left: 8px; }
    .menu-id { font-size: 12.5px; }
    .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-top: -8px; }
    .tabs button { border: 0; background: none; padding: 10px 12px; font: 500 14px Inter, sans-serif; color: var(--text-2); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
    .tabs button.active { color: var(--primary); border-bottom-color: var(--primary); }
    .count { font-size: 11.5px; background: var(--surface-2); border-radius: 10px; padding: 1px 7px; margin-left: 4px; color: var(--text-3); }
    .check { display: inline-flex; align-items: center; gap: 6px; color: var(--text-2); white-space: nowrap; }
    .c-tid { width: 280px; } .c-loc { width: 260px; } .c-used { width: 220px; }
    .c-used .badge { margin: 0 4px 4px 0; }
    .tiny-badge { margin-left: 6px; font-size: 11px; }
    .empty-row { padding: 28px; text-align: center; color: var(--text-3); }
    .foot { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-top: 1px solid var(--border); }
  `,
})
export class TourIdsPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly store = inject(ProjectStore);
  private readonly toast = inject(ToastService);

  protected readonly screensLoaded = signal(false);
  protected readonly screens = signal<Array<{ route: string; title: string; tourIds: number }>>([]);
  protected readonly picked = signal(new Set<string>());
  protected readonly rows = signal<Row[]>([]);
  protected readonly skipped = signal<Array<{ component: string; file: string; reason: string }>>([]);
  protected readonly scanning = signal(false);
  protected readonly scanned = signal(false);
  protected readonly aiBusy = signal(false);
  protected readonly aiLogs = signal<string[]>([]);
  protected readonly busy = signal(false);
  protected readonly files = signal<FilePatch[]>([]);
  protected readonly selected = signal(new Set<string>());
  protected readonly ai = signal<AiState | null>(null);
  private readonly version = signal(0);
  protected flow = '';

  protected readonly selectedCount = computed(() => (this.version(), this.rows().filter((r) => r.include).length));
  protected readonly groups = computed(() => {
    this.version();
    const map = new Map<string, { screen: string; title: string; rows: Row[] }>();
    for (const r of this.rows()) {
      if (r.aiSkipped && !r.include) continue;
      const g = map.get(r.screen) ?? { screen: r.screen, title: r.screenTitle, rows: [] };
      g.rows.push(r);
      map.set(r.screen, g);
    }
    return [...map.values()];
  });

  protected readonly showSkipped = signal(true);
  protected readonly tab = signal<'scan' | 'existing'>('scan');
  protected readonly existing = signal<ExistingTourId[]>([]);
  protected query = '';
  protected unusedOnly = false;
  // Nhóm: khung chung (menu, header) trước, rồi theo màn hình
  protected readonly existingGroups = computed(() => {
    this.version();
    const q = this.query.trim().toLowerCase();
    const items = this.existing().filter(
      (x) =>
        (!this.unusedOnly || !x.usedBy.length) &&
        (!q || [x.tourId, x.label ?? '', x.hint ?? '', ...x.usedBy, ...x.screens.map((s) => s.title + ' ' + s.route)].some((v) => v.toLowerCase().includes(q))),
    );
    const groups = new Map<string, { title: string; sub: string; items: ExistingTourId[] }>();
    for (const x of items) {
      const key = x.shared ? '*' : x.screens[0]?.route ?? '?';
      const g = groups.get(key) ?? { title: x.shared ? 'Khung chung (mọi màn hình)' : x.screens[0]?.title ?? '?', sub: x.shared ? 'menu, header, thanh tab' : key, items: [] };
      g.items.push(x);
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => (a.title.startsWith('Khung') ? -1 : b.title.startsWith('Khung') ? 1 : a.sub.localeCompare(b.sub)));
  });
  protected readonly aiSkipped = computed(() => (this.version(), this.rows().filter((r) => r.aiSkipped && !r.include)));

  async ngOnInit(): Promise<void> {
    this.ai.set(await this.api.get<AiState>('/api/ai').catch(() => null));
    // Lấy danh sách màn hình (quét nhẹ, không chọn màn hình nào = không gợi ý)
    const res = await this.api.get<{ screens: Array<{ route: string; title: string; tourIds: number }> }>('/api/tourids?only=__none__').catch(() => null);
    if (res) this.screens.set(res.screens);
    this.screensLoaded.set(true);
    const ex = await this.api.get<{ items: ExistingTourId[] }>('/api/tourids/existing').catch(() => null);
    if (ex) this.existing.set(ex.items.sort((a, b) => a.tourId.localeCompare(b.tourId)));
  }

  protected kind(k: string): string {
    return KIND[k] ?? k;
  }

  protected touch(): void {
    this.version.update((v) => v + 1);
  }

  protected togglePick(route: string): void {
    const s = new Set(this.picked());
    if (s.has(route)) s.delete(route);
    else s.add(route);
    this.picked.set(s);
  }

  protected async scan(): Promise<void> {
    this.scanning.set(true);
    try {
      const only = [...this.picked()].join(',');
      const res = await this.api.get<{ candidates: TourIdCandidate[]; skipped: Array<{ component: string; file: string; reason: string }>; screens: Array<{ route: string; title: string; tourIds: number }> }>(`/api/tourids${only ? `?only=${encodeURIComponent(only)}` : ''}`);
      this.rows.set(res.candidates.map((c) => ({ ...c, include: false, newId: c.tourId, hint: '', userOnly: Boolean(c.sensitive) })));
      this.skipped.set(res.skipped);
      this.screens.set(res.screens);
      this.scanned.set(true);
      this.aiLogs.set([]);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.scanning.set(false);
    }
  }

  protected selectAll(on: boolean): void {
    for (const r of this.rows()) r.include = on;
    this.touch();
  }

  protected async askAi(): Promise<void> {
    this.aiBusy.set(true);
    this.aiLogs.set([]);
    try {
      const res = await this.api.stream<{ relevant: string[]; sensitive: Record<string, string>; hints: Record<string, string> }>(
        '/api/tourids/ai',
        { flow: this.flow.trim() || undefined, keys: this.rows().map((r) => r.key) },
        (l) => this.aiLogs.update((x) => [...x, l]),
      );
      const relevant = new Set(res.relevant);
      for (const r of this.rows()) {
        if (this.flow.trim()) {
          r.include = relevant.has(r.key);
          r.aiSkipped = !r.include;
        }
        if (res.hints[r.key] && !r.hint) r.hint = res.hints[r.key];
        if (res.sensitive[r.key]) {
          r.aiFlag = res.sensitive[r.key];
          r.userOnly = true;
        }
      }
      this.touch();
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.aiBusy.set(false);
    }
  }

  protected async makePatch(): Promise<void> {
    this.busy.set(true);
    try {
      const items = this.rows().filter((r) => r.include).map((r) => ({ key: r.key, tourId: r.newId, userOnly: r.userOnly, hint: r.hint }));
      const res = await this.api.post<{ files: FilePatch[] }>('/api/tourids/patch', { items });
      this.files.set(res.files);
      this.selected.set(new Set(res.files.flatMap((f) => f.hunks.map((h) => h.id))));
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  protected toggle(id: string): void {
    const s = new Set(this.selected());
    if (s.has(id)) s.delete(id);
    else s.add(id);
    this.selected.set(s);
  }

  protected setMany(ids: string[], on: boolean): void {
    const s = new Set(this.selected());
    ids.forEach((id) => (on ? s.add(id) : s.delete(id)));
    this.selected.set(s);
  }

  protected async apply(): Promise<void> {
    this.busy.set(true);
    try {
      const res = await this.api.post<{ applied: number }>('/api/patch/apply', { name: 'tourid', hunks: [...this.selected()] });
      this.toast.success(`Đã gắn tourId (${res.applied} thay đổi). Commit khi bạn thấy ổn.`);
      this.files.set([]);
      this.rows.set([]);
      this.scanned.set(false);
      void this.store.refreshOverview();
      await this.ngOnInit();
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}
