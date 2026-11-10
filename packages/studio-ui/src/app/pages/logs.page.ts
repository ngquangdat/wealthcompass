import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import type { AssistantMeta, EvalCase, LogStats } from '../core/models';
import { ToastService } from '../core/toast.service';
import { IconComponent } from '../shared/icon.component';
import { PageHeaderComponent } from '../shared/page-header.component';

const OUTCOME: Record<string, { label: string; cls: string }> = {
  offered: { label: 'Có nút dẫn', cls: 'success' },
  answered: { label: 'Trả lời', cls: 'info' },
  not_found: { label: 'Không tìm thấy', cls: 'warning' },
  refused: { label: 'Bị chặn', cls: 'danger' },
  error: { label: 'Lỗi', cls: 'danger' },
};

@Component({
  selector: 'page-logs',
  imports: [FormsModule, RouterLink, IconComponent, PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header title="Nhật ký" subtitle="Người dùng hỏi gì, trợ lý tìm được bao nhiêu, câu nào chưa có câu trả lời, tour có được đi hết không.">
      <select class="select range" [ngModel]="days()" (ngModelChange)="days.set(+$event); load()">
        <option [value]="1">24 giờ qua</option>
        <option [value]="7">7 ngày qua</option>
        <option [value]="30">30 ngày qua</option>
      </select>
      <label class="check"><input type="checkbox" [ngModel]="studio()" (ngModelChange)="studio.set($event); load()" /> Gồm câu thử trong Studio</label>
      <button class="btn btn-icon" (click)="load()" title="Tải lại"><ui-icon name="refresh" /></button>
    </ui-page-header>

    @if (stats(); as s) {
      @if (!s.exists) {
        <div class="card empty-state">
          <ui-icon name="chart" [size]="28" />
          <h3>Chưa có nhật ký</h3>
          <p class="muted">Backend bật từ trang <a routerLink="/run">Chạy thử</a> tự ghi nhật ký vào <code>{{ s.file }}</code> (ngoài dự án, không vào git). Hỏi vài câu trên web hoặc ở trang <a routerLink="/assistant">Thử trợ lý</a> rồi quay lại.</p>
          <p class="muted small">Trên máy chủ thật: đặt <code>COMPASS_LOG_FILE</code> cho backend. Nhật ký chỉ có câu hỏi đã che thông tin cá nhân và mã người dùng đã băm.</p>
        </div>
      } @else {
        <div class="metrics">
          <div class="card metric"><div class="m-label">Câu hỏi</div><div class="m-value">{{ s.questions }}</div><div class="m-sub">{{ s.users }} người hỏi</div></div>
          <div class="card metric" [class.good]="foundRate() >= 0.8" [class.bad]="foundRate() < 0.6 && s.questions > 0">
            <div class="m-label">Tìm được</div><div class="m-value">{{ s.questions ? pct(foundRate()) : '—' }}</div><div class="m-sub">{{ s.outcomes.offered }} câu có nút dẫn đường</div>
          </div>
          <div class="card metric" [class.bad]="s.outcomes.not_found > 0"><div class="m-label">Không tìm thấy</div><div class="m-value">{{ s.outcomes.not_found }}</div><div class="m-sub">xem danh sách bên dưới</div></div>
          <div class="card metric" [class.bad]="s.outcomes.error + s.fallback > 0"><div class="m-label">Lỗi / dự phòng</div><div class="m-value">{{ s.outcomes.error }} / {{ s.fallback }}</div><div class="m-sub">AI lỗi giữa chừng / trả lời không cần AI</div></div>
          <div class="card metric"><div class="m-label">Thời gian trả lời</div><div class="m-value">{{ sec(s.latency.p50) }}</div><div class="m-sub">trung vị · 95%: {{ sec(s.latency.p95) }}</div></div>
        </div>

        @if (s.daily.length > 1) {
          <div class="card chart">
            @for (d of s.daily; track d.day) {
              <div class="bar" [title]="d.day + ': ' + d.n + ' câu'"><span [style.height.%]="(d.n / maxDaily()) * 100"></span><i>{{ d.day.slice(8) }}</i></div>
            }
          </div>
        }

        <div class="grid">
          <section class="card">
            <div class="sec-head"><h3>Câu hỏi chưa tìm thấy</h3><span class="muted small">gom các câu giống nhau</span></div>
            <table class="table">
              <tbody>
                @for (n of s.notFound; track n.q) {
                  <tr>
                    <td>{{ n.q }}</td>
                    <td class="c-count"><span class="badge">{{ n.count }}×</span></td>
                    <td class="c-act">
                      @if (adding() === n.q) {
                        <div class="add-row">
                          <select class="select" #pick>
                            @for (f of meta()?.features ?? []; track f.id) { <option [value]="f.id">{{ f.title }}</option> }
                          </select>
                          <button class="btn btn-sm btn-primary" (click)="addCase(n.q, pick.value)">Thêm</button>
                          <button class="btn btn-sm btn-ghost" (click)="adding.set(null)">Hủy</button>
                        </div>
                      } @else {
                        <button class="btn btn-sm" (click)="adding.set(n.q)" title="Đưa vào bộ kiểm thử với màn hình đúng">+ Kiểm thử</button>
                      }
                    </td>
                  </tr>
                } @empty { <tr><td class="empty">Không có câu nào. Tốt!</td></tr> }
              </tbody>
            </table>
            @if (s.notFound.length) { <p class="hint pad">Cách sửa thường gặp: thêm từ khóa/câu hỏi mẫu cho màn hình ở trang <a routerLink="/screens">Màn hình</a>, hoặc thêm từ đồng nghĩa ở <a routerLink="/pack">Domain Pack</a>; rồi chạy lại <a routerLink="/eval">Kiểm thử</a>.</p> }
          </section>

          <section class="card">
            <div class="sec-head"><h3>Tour</h3><span class="muted small">được đề xuất → bắt đầu → đi hết</span></div>
            <table class="table">
              <thead><tr><th>Tour</th><th class="num">Đề xuất</th><th class="num">Bắt đầu</th><th class="num">Đi hết</th><th class="num">Bỏ dở</th><th class="num">Lỗi</th></tr></thead>
              <tbody>
                @for (f of s.funnel; track f.tourId) {
                  <tr>
                    <td class="mono">{{ f.tourId }}</td>
                    <td class="num">{{ f.offered }}</td>
                    <td class="num">{{ f.started }}</td>
                    <td class="num"><b>{{ f.completed }}</b> @if (f.started) { <span class="muted small">{{ pct(f.completed / f.started) }}</span> }</td>
                    <td class="num">{{ f.cancelled }}</td>
                    <td class="num" [class.err]="f.failed">{{ f.failed }}</td>
                  </tr>
                } @empty { <tr><td colspan="6" class="empty">Chưa có tour nào được đề xuất.</td></tr> }
              </tbody>
            </table>
          </section>
        </div>

        <section class="card">
          <div class="sec-head"><h3>Gần đây</h3></div>
          <table class="table">
            <tbody>
              @for (r of s.recent; track $index) {
                <tr>
                  <td class="c-time muted small">{{ time(r.ts) }}</td>
                  <td>{{ r.q }} @if (r.source === 'studio') { <span class="badge tiny-badge">Studio</span> }</td>
                  <td class="c-out"><span class="badge" [class]="outcome(r.outcome).cls">{{ outcome(r.outcome).label }}</span></td>
                  <td class="c-off mono small muted">{{ r.offered.join(', ') }}</td>
                </tr>
              } @empty { <tr><td class="empty">Chưa có câu hỏi trong khoảng này.</td></tr> }
            </tbody>
          </table>
        </section>
      }
    } @else {
      <div class="card"><span class="spinner"></span> Đang tải...</div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    .range { width: 150px; }
    .check { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-2); }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
    .metric { padding: 14px 16px; }
    .m-label { font-size: 12.5px; color: var(--text-2); font-weight: 500; }
    .m-value { font-size: 24px; font-weight: 600; margin: 4px 0 2px; }
    .m-sub { font-size: 12px; color: var(--text-3); }
    .metric.good .m-value { color: var(--success-text); }
    .metric.bad .m-value { color: var(--danger-text); }
    .chart { display: flex; align-items: flex-end; gap: 6px; height: 110px; padding: 14px 16px 8px; }
    .bar { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 4px; min-width: 0; }
    .bar span { width: 100%; max-width: 28px; background: var(--primary); border-radius: 4px 4px 0 0; min-height: 2px; opacity: .85; }
    .bar i { font-style: normal; font-size: 10.5px; color: var(--text-3); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 16px; align-items: start; }
    .sec-head { display: flex; align-items: baseline; gap: 10px; padding: 14px 16px 8px; }
    .sec-head h3 { margin: 0; }
    .c-count { width: 60px; } .c-act { width: 1%; white-space: nowrap; text-align: right; }
    .add-row { display: flex; gap: 6px; align-items: center; }
    .add-row .select { width: 180px; }
    .num { text-align: right; width: 70px; white-space: nowrap; }
    .err { color: var(--danger-text); font-weight: 600; }
    .c-time { width: 110px; white-space: nowrap; } .c-out { width: 130px; } .c-off { width: 200px; }
    .tiny-badge { font-size: 10.5px; margin-left: 4px; }
    .empty { text-align: center; color: var(--text-3); padding: 20px !important; }
    .pad { padding: 0 16px 14px; margin: 0; }
    .empty-state { padding: 32px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 6px; color: var(--text-3); }
    .empty-state h3 { color: var(--text); margin: 4px 0; }
    .empty-state p { max-width: 640px; margin: 0; }
  `,
})
export class LogsPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  protected readonly stats = signal<LogStats | null>(null);
  protected readonly meta = signal<AssistantMeta | null>(null);
  protected readonly days = signal(7);
  protected readonly studio = signal(false);
  protected readonly adding = signal<string | null>(null);
  protected readonly foundRate = computed(() => {
    const s = this.stats();
    if (!s?.questions) return 0;
    const asked = s.questions - s.outcomes.refused;
    return asked ? (s.outcomes.offered + s.outcomes.answered) / asked : 0;
  });
  protected readonly maxDaily = computed(() => Math.max(1, ...(this.stats()?.daily ?? []).map((d) => d.n)));

  async ngOnInit(): Promise<void> {
    await this.load();
    this.meta.set(await this.api.get<AssistantMeta>('/api/assistant/meta').catch(() => null));
  }

  protected async load(): Promise<void> {
    try {
      this.stats.set(await this.api.get<LogStats>(`/api/logs?days=${this.days()}&studio=${this.studio() ? 1 : 0}`));
    } catch (e) {
      this.toast.error(e);
    }
  }

  protected pct(x: number): string {
    return `${Math.round(x * 100)}%`;
  }

  protected sec(ms: number | null): string {
    return ms === null ? '—' : `${(ms / 1000).toFixed(1)} giây`;
  }

  protected time(iso: string): string {
    return new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  }

  protected outcome(k: string): { label: string; cls: string } {
    return OUTCOME[k] ?? { label: k, cls: '' };
  }

  // Đưa câu chưa tìm thấy vào bộ kiểm thử, kèm màn hình đúng do người chọn
  protected async addCase(q: string, feature: string): Promise<void> {
    try {
      const data = await this.api.get<{ cases: EvalCase[] }>('/api/eval');
      if (data.cases.some((c) => c.q.trim().toLowerCase() === q.trim().toLowerCase())) {
        this.toast.show('Câu này đã có trong bộ kiểm thử.');
      } else {
        await this.api.put('/api/eval', { cases: [...data.cases, { q, expect: [feature] }] });
        this.toast.success('Đã thêm vào Kiểm thử. Sửa mô tả hoặc từ đồng nghĩa rồi chạy lại để xác nhận.');
      }
      this.adding.set(null);
    } catch (e) {
      this.toast.error(e);
    }
  }
}
