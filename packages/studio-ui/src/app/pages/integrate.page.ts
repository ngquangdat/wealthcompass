import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import type { AiState, FilePatch } from '../core/models';
import { ProjectStore } from '../core/project.store';
import { ToastService } from '../core/toast.service';
import { DiffViewComponent } from '../shared/diff-view.component';
import { IconComponent } from '../shared/icon.component';
import { LogConsoleComponent } from '../shared/log-console.component';
import { PageHeaderComponent } from '../shared/page-header.component';
import { RichTextComponent } from '../shared/rich-text.component';

type Step = 1 | 2 | 3;

@Component({
  selector: 'page-integrate',
  imports: [FormsModule, RouterLink, IconComponent, PageHeaderComponent, LogConsoleComponent, DiffViewComponent, RichTextComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header title="Tích hợp" subtitle="Tạo các thay đổi cần thiết, xem trước từng dòng rồi mới áp vào code.">
      @if (store.project()?.installed) {
        <button class="btn" (click)="updatePackages()" [disabled]="busy()"><ui-icon name="download" /> Cập nhật gói</button>
      }
    </ui-page-header>

    <ol class="steps">
      @for (s of stepLabels; track s.n) {
        <li [class.active]="step() === s.n" [class.done]="step() > s.n">
          <span class="num">@if (step() > s.n) { <ui-icon name="check" [size]="13" /> } @else { {{ s.n }} }</span>
          <span>{{ s.label }}</span>
        </li>
      }
    </ol>

    <!-- Bước 1: cấu hình và tạo thay đổi -->
    @if (step() === 1) {
      <div class="card">
        <div class="card-body stack">
          @if (store.project()?.integrated && !running()) {
            <div class="alert success"><ui-icon name="check-circle" /> <span>Dự án đã có cấu hình WealthCompass. Chạy lại để tạo phần còn thiếu (nếu có); những gì đã có sẽ được giữ nguyên.</span></div>
          }
          <div class="grid-2">
            <div class="field">
              <label for="pack">Lĩnh vực của web (Domain Pack)</label>
              <select id="pack" class="select" [(ngModel)]="pack" [disabled]="running()">
                <option value="generic">Chung (web bất kỳ)</option>
                <option value="finance-vn">Tài chính, chứng khoán Việt Nam</option>
              </select>
              <span class="hint">Quyết định từ điển đồng nghĩa và những chủ đề trợ lý phải từ chối.</span>
            </div>
            <div class="field">
              <label for="backend">Địa chỉ backend WealthCompass</label>
              <input id="backend" class="input mono" [(ngModel)]="backendUrl" [disabled]="running()" />
              <span class="hint">Widget trong web sẽ gọi tới địa chỉ này.</span>
            </div>
          </div>

          <label class="ai-row">
            <input type="checkbox" [(ngModel)]="useAi" [disabled]="running() || !ai()?.hasKey" />
            <span class="badge ai"><ui-icon name="sparkles" [size]="12" /> AI</span>
            <span class="grow">Để AI soạn nháp mô tả, từ khóa và câu hỏi mẫu cho các màn hình còn trống</span>
            @if (ai(); as a) {
              @if (a.hasKey) { <span class="muted small">{{ a.provider }} · {{ a.model }}</span> }
              @else { <a class="small" routerLink="/settings">Chưa có khóa AI, cài đặt</a> }
            }
          </label>
          <p class="hint">AI chỉ đọc chữ hiển thị trong template (tiêu đề, nhãn, nút), không đọc mã nguồn. Nội dung AI soạn được đánh dấu nháp để bạn duyệt ở trang Màn hình.</p>

          <div class="row">
            <span class="grow"></span>
            <button class="btn btn-primary" (click)="runSetup()" [disabled]="running()">
              @if (running()) { <span class="spinner"></span> Đang tạo thay đổi... } @else { Tạo thay đổi <ui-icon name="chevron-right" /> }
            </button>
          </div>
          @if (logs().length) { <ui-log-console [lines]="logs()" height="240px" /> }
        </div>
      </div>
    }

    <!-- Bước 2: xem thay đổi -->
    @if (step() === 2) {
      <div class="stack">
        @if (todo().length) {
          <div class="card">
            <div class="card-head"><ui-icon name="info" /><h2>Cần bạn xem</h2><span class="badge warning">{{ todo().length }}</span></div>
            <ul class="todo">
              @for (t of todo(); track $index) { <li><ui-rich [text]="t" /></li> }
            </ul>
          </div>
        }
        @if (files().length) {
          <ui-diff-view [files]="files()" [selected]="selected()" (toggle)="toggle($event)" (setMany)="setMany($event.ids, $event.on)" />
          <div class="row">
            <button class="btn" (click)="step.set(1)"><ui-icon name="chevron-right" class="flip" /> Quay lại</button>
            <span class="grow muted small">Đã chọn {{ selected().size }}/{{ totalHunks() }} thay đổi · code chỉ đổi khi bạn bấm Áp</span>
            <button class="btn btn-primary" (click)="apply()" [disabled]="!selected().size || busy()">
              @if (busy()) { <span class="spinner"></span> } Áp {{ selected().size }} thay đổi
            </button>
          </div>
        } @else {
          <div class="card empty">
            <h3>Không có thay đổi code nào cần làm</h3>
            <p>Mọi thứ cần thiết đã có trong dự án.</p>
            <div class="row center"><button class="btn btn-primary" (click)="step.set(3)">Tiếp tục <ui-icon name="chevron-right" /></button></div>
          </div>
        }
      </div>
    }

    <!-- Bước 3: cài gói -->
    @if (step() === 3) {
      <div class="card">
        <div class="card-body stack">
          @if (applied()) {
            <div class="alert success"><ui-icon name="check-circle" /> <span>Đã áp {{ applied() }} thay đổi vào code. Commit khi bạn thấy ổn.</span></div>
          }
          <div class="row">
            <div class="grow">
              <h2>Cài gói</h2>
              <p class="muted small">Chạy <code>npm install</code> trong dự án để cài các gói WealthCompass vừa thêm.</p>
            </div>
            <button class="btn btn-primary" (click)="install()" [disabled]="busy()">
              @if (busy()) { <span class="spinner"></span> Đang cài... } @else { <ui-icon name="download" /> Cài gói }
            </button>
          </div>
          @if (logs().length) { <ui-log-console [lines]="logs()" height="220px" /> }
          @if (store.project()?.installed) {
            <div class="row">
              <span class="grow muted small">Đã cài xong. Bước tiếp theo: duyệt nội dung AI soạn, rồi chạy thử.</span>
              <a class="btn" routerLink="/screens">Duyệt màn hình</a>
              <a class="btn btn-primary" routerLink="/run">Chạy thử <ui-icon name="chevron-right" /></a>
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    .steps { list-style: none; display: flex; gap: 8px; margin: 0; padding: 0; }
    .steps li { display: flex; align-items: center; gap: 8px; padding: 6px 12px 6px 6px; border-radius: 999px; color: var(--text-3); font-weight: 500; font-size: 13px; }
    .steps li .num { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: #f2f4f7; font-size: 12px; }
    .steps li.active { background: var(--primary-soft); color: var(--primary); }
    .steps li.active .num { background: var(--primary); color: #fff; }
    .steps li.done { color: var(--success-text); }
    .steps li.done .num { background: var(--success-soft); color: var(--success-text); }
    .ai-row { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); cursor: pointer; }
    .todo { margin: 0; padding: 12px 20px 14px 38px; display: flex; flex-direction: column; gap: 8px; }
    .center { justify-content: center; margin-top: 12px; }
    .flip { transform: rotate(180deg); }
  `,
})
export class IntegratePage implements OnInit {
  protected readonly store = inject(ProjectStore);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  protected readonly stepLabels = [
    { n: 1 as Step, label: 'Tạo thay đổi' },
    { n: 2 as Step, label: 'Xem và chọn' },
    { n: 3 as Step, label: 'Áp và cài gói' },
  ];
  protected readonly step = signal<Step>(1);
  protected readonly running = signal(false);
  protected readonly busy = signal(false);
  protected readonly logs = signal<string[]>([]);
  protected readonly files = signal<FilePatch[]>([]);
  protected readonly selected = signal(new Set<string>());
  protected readonly todo = signal<string[]>([]);
  protected readonly applied = signal(0);
  protected readonly ai = signal<AiState | null>(null);
  protected readonly totalHunks = computed(() => this.files().reduce((s, f) => s + f.hunks.length, 0));

  protected pack = 'generic';
  protected backendUrl = 'http://localhost:8890';
  protected useAi = true;

  async ngOnInit(): Promise<void> {
    this.ai.set(await this.api.get<AiState>('/api/ai'));
    if (!this.ai()?.hasKey) this.useAi = false;
    const p = this.store.project();
    // Có patch đang chờ thì vào thẳng bước xem
    if (p?.patchPending) await this.loadPatch();
    else if (p?.integrated && !p.installed) this.step.set(3);
  }

  protected async runSetup(): Promise<void> {
    this.running.set(true);
    this.logs.set([]);
    try {
      await this.api.stream('/api/setup', { pack: this.pack, backendUrl: this.backendUrl, useAi: this.useAi }, (l) => this.logs.update((x) => [...x, l]));
      await this.store.refresh();
      await this.loadPatch();
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.running.set(false);
    }
  }

  private async loadPatch(): Promise<void> {
    const res = await this.api.get<{ exists: boolean; files: FilePatch[]; report: string | null }>('/api/patch');
    this.files.set(res.files);
    this.selected.set(new Set(res.files.flatMap((f) => f.hunks.map((h) => h.id))));
    this.todo.set(parseTodo(res.report));
    this.step.set(2);
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
      const res = await this.api.post<{ applied: number }>('/api/patch/apply', { hunks: [...this.selected()] });
      this.applied.set(res.applied);
      this.toast.success(`Đã áp ${res.applied} thay đổi`);
      this.logs.set([]);
      await this.store.refresh();
      this.step.set(3);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  protected async install(): Promise<void> {
    this.busy.set(true);
    this.logs.set(['$ npm install']);
    try {
      await this.api.stream('/api/install', {}, (l) => this.logs.update((x) => [...x, l]));
      this.logs.update((x) => [...x, '✔ Cài xong']);
      await this.store.refresh();
      this.toast.success('Đã cài gói');
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  protected async updatePackages(): Promise<void> {
    try {
      const res = await this.api.post<{ changed: number }>('/api/update-packages');
      if (!res.changed) {
        this.toast.success('Gói đã ở bản mới nhất');
        return;
      }
      await this.store.refresh();
      await this.loadPatch();
    } catch (e) {
      this.toast.error(e);
    }
  }
}

// Lấy danh sách "- [ ] ..." trong mục "Cần bạn xem" của báo cáo
function parseTodo(report: string | null): string[] {
  if (!report) return [];
  const section = report.split('## Cần bạn xem')[1]?.split('\n## ')[0] ?? '';
  return section
    .split('\n')
    .filter((l) => l.startsWith('- [ ] '))
    .map((l) => l.slice(6).trim());
}
