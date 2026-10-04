import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import type { AiState, AssistantMeta, EvalCase, EvalRow, EvalRun } from '../core/models';
import { ToastService } from '../core/toast.service';
import { ChipsInputComponent } from '../shared/chips-input.component';
import { IconComponent } from '../shared/icon.component';
import { LogConsoleComponent } from '../shared/log-console.component';
import { PageHeaderComponent } from '../shared/page-header.component';

// Giá trị đặc biệt trong ô "màn hình đúng": câu này phải bị chặn
const BLOCKED = '__blocked__';

interface Row extends EvalCase {
  target: string; // id màn hình hoặc BLOCKED
}

@Component({
  selector: 'page-eval',
  imports: [FormsModule, RouterLink, IconComponent, PageHeaderComponent, ChipsInputComponent, LogConsoleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header title="Kiểm thử" subtitle="Bộ câu hỏi mẫu và màn hình đúng của từng câu. Chạy sau mỗi lần sửa mô tả, từ đồng nghĩa hay quyền để biết trợ lý tìm đúng hơn hay kém đi.">
      <button class="btn btn-ai" (click)="generate()" [disabled]="busy() || !ai()?.hasKey" [title]="ai()?.hasKey ? '' : 'Cần khóa AI (Cài đặt AI)'"><ui-icon name="sparkles" /> AI viết câu hỏi</button>
      <button class="btn" (click)="save()" [disabled]="busy() || !dirty()">Lưu</button>
      <button class="btn btn-primary" (click)="run()" [disabled]="busy() || !rows().length"><ui-icon name="play" /> Chạy kiểm thử</button>
    </ui-page-header>

    @if (meta() && (!meta()!.backend.running || !meta()!.backend.debug)) {
      <div class="alert warning"><ui-icon name="alert" /><span>Cần backend chạy từ Studio (chế độ debug) để chấm điểm. Bật ở <a routerLink="/run">Chạy thử</a>.</span></div>
    }

    @if (last(); as l) {
      <div class="metrics">
        <div class="card metric" [class.good]="l.summary.hit3 >= 0.9" [class.bad]="l.summary.hit3 < 0.7">
          <div class="m-label">Đúng trong top 3 (hit@3)</div><div class="m-value">{{ pct(l.summary.hit3) }}</div>
          <div class="m-sub">màn hình đúng nằm trong 3 kết quả đầu trợ lý thấy</div>
        </div>
        <div class="card metric"><div class="m-label">Đúng ngay đầu (hit@1)</div><div class="m-value">{{ pct(l.summary.hit1) }}</div><div class="m-sub">MRR {{ l.summary.mrr.toFixed(2) }}</div></div>
        <div class="card metric"><div class="m-label">Chặn đúng</div><div class="m-value">{{ l.summary.blockedOk }}/{{ l.summary.blockedTotal }}</div><div class="m-sub">câu phải bị từ chối</div></div>
        <div class="card metric" [class.bad]="l.summary.failed > 0"><div class="m-label">Chưa đạt</div><div class="m-value">{{ l.summary.failed }}</div><div class="m-sub">chạy lúc {{ time(l.at) }}</div></div>
      </div>
    }

    @if (logs().length) { <ui-log-console [lines]="logs()" height="120px" /> }

    <div class="card">
      <div class="toolbar">
        <div class="seg">
          <button [class.on]="filter() === 'all'" (click)="filter.set('all')">Tất cả <span class="count">{{ rows().length }}</span></button>
          <button [class.on]="filter() === 'fail'" (click)="filter.set('fail')" [disabled]="!last()">Chưa đạt <span class="count">{{ failCount() }}</span></button>
          <button [class.on]="filter() === 'draft'" (click)="filter.set('draft')">AI đề xuất <span class="count">{{ draftCount() }}</span></button>
        </div>
        <span class="grow"></span>
        <span class="muted small mono">compass.eval.yaml</span>
      </div>
      <table class="table">
        <thead><tr><th>Câu hỏi</th><th class="c-target">Màn hình đúng</th><th class="c-roles">Quyền người hỏi</th><th class="c-res">Kết quả</th><th></th></tr></thead>
        <tbody>
          @for (r of visible(); track r) {
            <tr [class.draft]="r.draft">
              <td>
                <input class="input" [(ngModel)]="r.q" (ngModelChange)="touch()" placeholder="Câu người dùng gõ" />
                @if (r.draft) { <span class="badge ai tiny-badge"><ui-icon name="sparkles" [size]="11" /> AI</span> }
              </td>
              <td>
                <select class="select" [(ngModel)]="r.target" (ngModelChange)="touch()">
                  <option [value]="''" disabled>Chọn màn hình</option>
                  @for (f of meta()?.features ?? []; track f.id) { <option [value]="f.id">{{ f.title }}</option> }
                  <option [value]="blockedValue">⛔ Phải bị chặn</option>
                </select>
              </td>
              <td><ui-chips [value]="r.roles ?? []" (valueChange)="r.roles = $event; touch()" placeholder="mọi quyền" /></td>
              <td>
                @if (result(r.q); as x) {
                  @if (x.pass) {
                    <span class="badge success">{{ x.blocked ? 'Chặn đúng' : '#' + x.rank }}</span>
                  } @else {
                    <span class="badge danger" [title]="topText(x)">✖ {{ x.reason }}</span>
                    @if (x.top.length) { <div class="tiny muted">Trợ lý thấy: {{ x.top[0].title }}</div> }
                  }
                } @else { <span class="muted small">—</span> }
              </td>
              <td><button class="btn btn-ghost btn-icon btn-sm" (click)="remove(r)" title="Xóa câu"><ui-icon name="trash" [size]="14" /></button></td>
            </tr>
          } @empty {
            <tr><td colspan="5" class="empty">
              @if (filter() === 'all') { Chưa có câu kiểm thử. Bấm <b>AI viết câu hỏi</b> để có bộ đầu tiên, hoặc thêm từng câu; câu chưa tìm thấy ở trang Nhật ký cũng thêm được vào đây. }
              @else { Không có câu nào. }
            </td></tr>
          }
        </tbody>
      </table>
      <div class="foot"><button class="btn btn-sm" (click)="add()">+ Thêm câu</button></div>
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
    .metric { padding: 14px 16px; }
    .m-label { font-size: 12.5px; color: var(--text-2); font-weight: 500; }
    .m-value { font-size: 26px; font-weight: 600; margin: 4px 0 2px; }
    .m-sub { font-size: 12px; color: var(--text-3); }
    .metric.good .m-value { color: var(--success-text); }
    .metric.bad .m-value { color: var(--danger-text); }
    .toolbar { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--border); }
    .seg { display: inline-flex; border: 1px solid var(--border-strong); border-radius: 8px; overflow: hidden; }
    .seg button { border: 0; background: #fff; padding: 6px 12px; font: 500 13px Inter, sans-serif; color: var(--text-2); cursor: pointer; }
    .seg button + button { border-left: 1px solid var(--border-strong); }
    .seg button.on { background: var(--primary-soft); color: var(--primary); }
    .seg button:disabled { opacity: .5; cursor: default; }
    .count { font-size: 11.5px; color: var(--text-3); margin-left: 3px; }
    .table td { vertical-align: top; }
    .c-target { width: 220px; } .c-roles { width: 220px; } .c-res { width: 200px; }
    tr.draft td:first-child { box-shadow: inset 3px 0 0 var(--ai, #7a5af8); }
    .tiny-badge { margin-top: 4px; }
    .tiny { font-size: 11.5px; margin-top: 4px; }
    .empty { text-align: center; color: var(--text-3); padding: 28px !important; }
    .foot { padding: 10px 14px; border-top: 1px solid var(--border); }
  `,
})
export class EvalPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  protected readonly blockedValue = BLOCKED;
  protected readonly meta = signal<AssistantMeta | null>(null);
  protected readonly ai = signal<AiState | null>(null);
  protected readonly rows = signal<Row[]>([]);
  protected readonly last = signal<EvalRun | null>(null);
  protected readonly dirty = signal(false);
  protected readonly busy = signal(false);
  protected readonly logs = signal<string[]>([]);
  protected readonly filter = signal<'all' | 'fail' | 'draft'>('all');
  private readonly byQuestion = computed(() => new Map((this.last()?.rows ?? []).map((r) => [r.q, r])));
  protected readonly failCount = computed(() => this.rows().filter((r) => this.byQuestion().get(r.q)?.pass === false).length);
  protected readonly draftCount = computed(() => this.rows().filter((r) => r.draft).length);
  protected readonly visible = computed(() => {
    const f = this.filter();
    return this.rows().filter((r) => f === 'all' || (f === 'draft' ? r.draft : this.byQuestion().get(r.q)?.pass === false));
  });

  async ngOnInit(): Promise<void> {
    try {
      const [meta, data, ai] = await Promise.all([
        this.api.get<AssistantMeta>('/api/assistant/meta'),
        this.api.get<{ cases: EvalCase[]; last: EvalRun | null }>('/api/eval'),
        this.api.get<AiState>('/api/ai').catch(() => null),
      ]);
      this.meta.set(meta);
      this.ai.set(ai);
      this.rows.set(data.cases.map((c) => this.toRow(c)));
      this.last.set(data.last);
    } catch (e) {
      this.toast.error(e);
    }
  }

  private toRow(c: EvalCase): Row {
    return { ...c, roles: c.roles ?? [], target: c.blocked ? BLOCKED : (c.expect[0] ?? '') };
  }

  protected pct(x: number): string {
    return `${Math.round(x * 100)}%`;
  }

  protected time(iso: string): string {
    return new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  }

  protected result(q: string): EvalRow | undefined {
    return this.byQuestion().get(q);
  }

  protected topText(x: EvalRow): string {
    return x.top.map((t, i) => `${i + 1}. ${t.title} (${t.score})`).join('\n') || 'Không có kết quả';
  }

  protected touch(): void {
    this.dirty.set(true);
  }

  protected add(): void {
    this.rows.update((r) => [...r, { q: '', expect: [], roles: [], target: '' }]);
    this.filter.set('all');
  }

  protected remove(r: Row): void {
    this.rows.update((x) => x.filter((y) => y !== r));
    this.touch();
  }

  private toCases(): EvalCase[] {
    return this.rows()
      .filter((r) => r.q.trim() && r.target)
      .map((r) => (r.target === BLOCKED ? { q: r.q.trim(), expect: [], blocked: true, roles: r.roles } : { q: r.q.trim(), expect: [r.target], roles: r.roles }))
      .map((c) => (c.roles?.length ? c : { ...c, roles: undefined }));
  }

  protected async save(): Promise<boolean> {
    const incomplete = this.rows().filter((r) => r.q.trim() && !r.target).length;
    try {
      const res = await this.api.put<{ count: number }>('/api/eval', { cases: this.toCases() });
      this.rows.update((x) => x.filter((r) => r.q.trim() && r.target).map((r) => ({ ...r, draft: false })));
      this.dirty.set(false);
      this.toast.success(`Đã lưu ${res.count} câu vào compass.eval.yaml${incomplete ? ` (bỏ ${incomplete} câu chưa chọn màn hình)` : ''}`);
      return true;
    } catch (e) {
      this.toast.error(e);
      return false;
    }
  }

  protected async run(): Promise<void> {
    if (this.dirty() && !(await this.save())) return;
    this.busy.set(true);
    this.logs.set(['Đang chấm điểm...']);
    try {
      const res = await this.api.stream<EvalRun>('/api/eval/run', {}, (l) => this.logs.update((x) => [...x, l]));
      this.last.set(res);
      if (res.summary.failed) this.filter.set('fail');
    } catch (e) {
      this.logs.update((x) => [...x, `Lỗi: ${(e as Error).message}`]);
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  protected async generate(): Promise<void> {
    this.busy.set(true);
    this.logs.set([]);
    try {
      const res = await this.api.stream<{ cases: EvalCase[] }>('/api/eval/generate', {}, (l) => this.logs.update((x) => [...x, l]));
      const existing = new Set(this.rows().map((r) => r.q.trim().toLowerCase()));
      const fresh = res.cases.filter((c) => !existing.has(c.q.toLowerCase())).map((c) => ({ ...this.toRow(c), draft: true }));
      this.rows.update((r) => [...r, ...fresh]);
      if (fresh.length) {
        this.dirty.set(true);
        this.filter.set('draft');
      }
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}
