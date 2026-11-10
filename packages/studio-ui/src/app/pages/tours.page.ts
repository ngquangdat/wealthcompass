import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import type { RunState, TourDef, TourProposal, TourStep } from '../core/models';
import { ProjectStore } from '../core/project.store';
import { ToastService } from '../core/toast.service';
import { IconComponent } from '../shared/icon.component';
import { LogConsoleComponent } from '../shared/log-console.component';
import { PageHeaderComponent } from '../shared/page-header.component';

interface TargetInfo {
  tourId: string;
  label?: string;
  route?: string;
  sensitivity: string;
}

interface Editing {
  id: string;
  isNew: boolean;
  title: string;
  description: string;
  feature: string;
  startRoute: string;
  steps: TourStep[];
}

@Component({
  selector: 'page-tours',
  imports: [FormsModule, RouterLink, IconComponent, PageHeaderComponent, LogConsoleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header title="Tour" subtitle="Hướng dẫn từng bước trên giao diện. Ghi bằng thao tác thật hoặc soạn tay, rồi chạy thử trên web.">
      <button class="btn" (click)="openVerify()" [disabled]="!tours().length" title="Chạy lại mọi tour trên web đang chạy, ở desktop và mobile"><ui-icon name="check" /> Kiểm tra tour</button>
      <button class="btn" (click)="newBlank()"><ui-icon name="edit" /> Soạn tay</button>
      <button class="btn btn-primary" (click)="openRecord()"><ui-icon name="play" /> Ghi tour mới</button>
    </ui-page-header>

    @if (!targets().length && loaded()) {
      <div class="alert info"><ui-icon name="alert" /><span>Dự án chưa có tourId nào. "Ghi tour mới" không cần tourId: trợ lý nhận ra phần tử theo vai trò, chữ, thuộc tính và component. Chỉ soạn tay mới cần <a routerLink="/tourids">gắn tourId</a>.</span></div>
    }

    <div class="list">
      @for (t of tours(); track t.id) {
        <div class="card tour">
          <div class="t-main">
            <div class="row">
              <h2 class="grow">{{ t.title || t.id }}</h2>
              @if (!t.valid) { <span class="badge danger">Bị loại</span> }
              @else if (t.draft) { <span class="badge ai"><ui-icon name="sparkles" [size]="12" /> Nháp</span> }
              @else { <span class="badge success">Sẵn sàng</span> }
            </div>
            <div class="muted small">{{ t.description || 'Chưa có mô tả' }}</div>
            <div class="meta small">
              <span><b>{{ t.steps.length }}</b> bước</span>
              <span>bắt đầu ở <code>{{ t.startRoute }}</code></span>
              @if (featureTitle(t.feature); as f) { <span>dẫn tới <b>{{ f }}</b></span> }
              @if (t.layouts?.length) { <span>bố cục: <b>{{ t.layouts!.join(' + ') }}</b></span> }
              <span class="mono muted">{{ t.id }}</span>
            </div>
            @for (e of t.errors; track e) { <div class="err small">{{ e }}</div> }
            @for (p of t.proposals ?? []; track p.layout + p.key) {
              <div class="proposal small">
                <div><ui-icon name="sparkles" [size]="12" /> <b>Bước {{ p.index + 1 }}</b> ({{ p.layout }}) có manh mối đã đổi: {{ p.changed.join(', ') }}. Phần tử nhạy cảm nên cần bạn duyệt.</div>
                <div class="mono muted">{{ p.from }} → {{ p.to }}</div>
                <div class="row">
                  <button class="btn btn-sm btn-primary" (click)="decide(t, p, true)">Dùng locator mới</button>
                  <button class="btn btn-sm" (click)="decide(t, p, false)">Bỏ qua</button>
                  <button class="btn btn-sm" (click)="rerecord(t.id, p.key, p.layout)">Ghi lại bước này</button>
                </div>
              </div>
            }
          </div>
          <div class="t-actions">
            <button class="btn btn-sm" (click)="edit(t)"><ui-icon name="edit" [size]="13" /> {{ t.draft ? 'Duyệt' : 'Sửa' }}</button>
            @if (t.source === 'recorded' && t.layouts && t.layouts.length < 2) {
              <button class="btn btn-sm" (click)="openRecord(t)" [title]="'Ghi thêm bản cho bố cục ' + (t.layouts.includes('mobile') ? 'desktop' : 'mobile')"><ui-icon name="play" [size]="13" /> Ghi bản {{ t.layouts.includes('mobile') ? 'desktop' : 'mobile' }}</button>
            }
            <button class="btn btn-sm" (click)="tryTour(t)" [disabled]="!t.valid" [title]="webUrl() ? '' : 'Bật web ở trang Chạy thử'"><ui-icon name="external" [size]="13" /> Chạy thử</button>
          </div>
        </div>
      } @empty {
        @if (loaded()) {
          <div class="card empty"><h3>Chưa có tour nào</h3><p>Bấm "Ghi tour mới" để thao tác trên web và để AI soạn chữ cho từng bước.</p></div>
        }
      }
    </div>

    <!-- Ghi tour -->
    @if (recording()) {
      <div class="scrim"></div>
      <div class="modal" role="dialog" aria-label="Ghi tour">
        <div class="m-head"><h2 class="grow">Ghi tour mới</h2>@if (!recBusy()) { <button class="btn btn-ghost btn-icon" (click)="recording.set(false)"><ui-icon name="x" /></button> }</div>
        <div class="m-body stack">
          @if (!recBusy() && !recLogs().length) {
            <div class="grid-2">
              <div class="field"><label>Id tour</label><input class="input mono" [(ngModel)]="rec.id" placeholder="xin-nghi-phep" /></div>
              <div class="field">
                <label>Màn hình đích</label>
                <select class="select" [(ngModel)]="rec.feature">
                  <option value="">Tự xác định (màn hình lúc dừng ghi)</option>
                  @for (f of features(); track f.id) { <option [value]="f.id">{{ f.title }}</option> }
                </select>
              </div>
            </div>
            <div class="field">
              <label>Bạn đang ghi tour cho tính năng gì?</label>
              <textarea class="textarea" rows="2" [(ngModel)]="rec.about" placeholder="Ví dụ: hướng dẫn nhân viên tạo đơn nghỉ phép, từ trang chủ tới nút Gửi đơn"></textarea>
              <span class="hint">AI dựa vào câu này để viết chữ cho từng bước và câu hỏi mẫu.</span>
            </div>
            <div class="field"><label>Địa chỉ web</label><input class="input mono" [(ngModel)]="rec.url" /></div>
            <label class="small" style="display:flex;gap:8px;align-items:center;margin:4px 0 10px"><input type="checkbox" [(ngModel)]="rec.mobile" /> Ghi bằng khung nhìn điện thoại (bố cục mobile). Cùng id tour thì lưu thành bản mobile của tour đó.</label>
            <div class="alert info small"><ui-icon name="info" /><span>Chrome sẽ mở trên máy này. Đăng nhập, vào màn hình xuất phát, bấm <b>● Bắt đầu ghi</b> ở góc trái dưới, thao tác theo luồng, rồi bấm <b>■ Dừng & lưu</b>. Nút nhạy cảm (gửi, xác nhận...) bị chặn khi ghi nên không chạy thật.</span></div>
          } @else {
            <ui-log-console [lines]="recLogs()" height="260px" />
          }
        </div>
        <div class="m-foot">
          <span class="grow"></span>
          @if (!recBusy() && !recLogs().length) {
            <button class="btn" (click)="recording.set(false)">Hủy</button>
            <button class="btn btn-primary" (click)="startRecord()" [disabled]="!rec.id.trim() || !rec.url.trim()"><ui-icon name="play" /> Mở Chrome và ghi</button>
          } @else if (recBusy()) {
            <span class="muted small"><span class="spinner"></span> Đang chờ bạn ghi trên Chrome...</span>
          } @else {
            <button class="btn btn-primary" (click)="recording.set(false)">Xong</button>
          }
        </div>
      </div>
    }

    <!-- Kiểm tra tour / ghi lại bước -->
    @if (job(); as j) {
      <div class="scrim"></div>
      <div class="modal" role="dialog" [attr.aria-label]="j.title">
        <div class="m-head"><h2 class="grow">{{ j.title }}</h2>@if (!jobBusy()) { <button class="btn btn-ghost btn-icon" (click)="job.set(null)"><ui-icon name="x" /></button> }</div>
        <div class="m-body stack">
          @if (j.kind === 'verify' && !jobBusy() && !jobLogs().length) {
            <div class="field"><label>Địa chỉ web</label><input class="input mono" [(ngModel)]="verifyUrl" /></div>
            <label class="small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" [(ngModel)]="verifyHeal" /> Tự sửa locator khi phần tử vẫn tìm chắc nhưng manh mối đã đổi (bước nhạy cảm chỉ đề xuất, chờ bạn duyệt)</label>
            <div class="alert info small"><ui-icon name="info" /><span>Chạy lại từng tour bằng Chromium không giao diện ở 1280px và 390px. Bước "chờ bấm" được bấm thật để đi tiếp; bước nhạy cảm không bao giờ bị bấm. Trang cần đăng nhập thì chạy <code>tour:verify --storage-state</code> từ dòng lệnh.</span></div>
          } @else {
            <ui-log-console [lines]="jobLogs()" height="300px" />
          }
        </div>
        <div class="m-foot">
          <span class="grow"></span>
          @if (j.kind === 'verify' && !jobBusy() && !jobLogs().length) {
            <button class="btn" (click)="job.set(null)">Hủy</button>
            <button class="btn btn-primary" (click)="runVerify()" [disabled]="!verifyUrl.trim()"><ui-icon name="check" /> Kiểm tra</button>
          } @else if (jobBusy()) {
            <span class="muted small"><span class="spinner"></span> {{ j.kind === 'verify' ? 'Đang chạy lại tour...' : 'Đang chờ bạn bấm trên Chrome...' }}</span>
          } @else {
            <button class="btn btn-primary" (click)="job.set(null)">Xong</button>
          }
        </div>
      </div>
    }

    <!-- Sửa tour -->
    @if (editing(); as e) {
      <div class="scrim" (click)="editing.set(null)"></div>
      <aside class="drawer" role="dialog" aria-label="Sửa tour">
        <div class="d-head">
          <div class="grow"><h2>{{ e.isNew ? 'Tour mới' : e.title || e.id }}</h2><div class="mono muted small">{{ e.id }}</div></div>
          <button class="btn btn-ghost btn-icon" (click)="editing.set(null)"><ui-icon name="x" /></button>
        </div>
        <div class="d-body stack">
          @if (e.isNew) { <div class="field"><label>Id tour</label><input class="input mono" [(ngModel)]="e.id" placeholder="xem-phieu-luong" /></div> }
          <div class="field"><label>Tiêu đề</label><input class="input" [(ngModel)]="e.title" /></div>
          <div class="field"><label>Mô tả</label><input class="input" [(ngModel)]="e.description" /></div>
          <div class="grid-2">
            <div class="field">
              <label>Màn hình đích</label>
              <select class="select" [(ngModel)]="e.feature">
                <option value="">(không gắn)</option>
                @for (f of features(); track f.id) { <option [value]="f.id">{{ f.title }}</option> }
              </select>
              <span class="hint">Trợ lý đề xuất tour khi người dùng hỏi về màn hình này.</span>
            </div>
            <div class="field">
              <label>Bắt đầu ở</label>
              <select class="select" [(ngModel)]="e.startRoute">
                @for (r of routes(); track r) { <option [value]="r">{{ r }}</option> }
              </select>
            </div>
          </div>

          <div class="label">Các bước</div>
          @for (s of e.steps; track $index; let i = $index; let last = $last) {
            <div class="step">
              <div class="s-num">{{ i + 1 }}</div>
              <div class="grow stack s-body">
                @if (s.element) {
                  <div class="hint row">
                    <span class="grow"><ui-icon name="play" [size]="12" /> Phần tử đã ghi: <code>{{ s.element }}</code>@if (s.healedAt) { <span class="muted"> · làm mới {{ s.healedAt }}</span> }</span>
                    @if (s.key && !e.isNew) { <button class="btn btn-ghost btn-sm" (click)="rerecord(e.id, s.key)" title="Mở Chrome ở màn hình của bước, bấm vào phần tử mới; giữ nguyên chữ">Ghi lại phần tử</button> }
                  </div>
                }
                <div class="row">
                  <select class="select grow" [ngModel]="s.target" (ngModelChange)="setTarget(s, $event)">
                    @if (s.element) { <option value="">Tìm theo phần tử đã ghi (không cần tourId)</option> }
                    @for (t of targets(); track t.tourId) { <option [value]="t.tourId">{{ s.element ? 'Ghim tourId: ' : '' }}{{ t.label || t.tourId }} · {{ t.route }}</option> }
                  </select>
                  <select class="select kind" [(ngModel)]="s.advanceOn" [disabled]="isSensitive(s.target)" title="Ô nhập và phần tử nhạy cảm nên dùng nút Tiếp">
                    <option value="click">Chờ người dùng bấm</option>
                    <option value="next">Bấm "Tiếp"</option>
                    <option value="hover">Di chuột (mở menu hover)</option>
                  </select>
                </div>
                @if (isSensitive(s.target)) { <div class="hint"><ui-icon name="lock" [size]="12" /> Phần tử nhạy cảm: tour chỉ tô sáng, người dùng tự thao tác.</div> }
                <textarea class="textarea" rows="2" [(ngModel)]="s.text" placeholder="Chữ hiện trên popover; **in đậm** tên nút"></textarea>
              </div>
              <div class="s-tools">
                <button class="btn btn-ghost btn-icon btn-sm" (click)="move(e, i, -1)" [disabled]="i === 0" title="Lên"><ui-icon name="arrow-up" [size]="14" /></button>
                <button class="btn btn-ghost btn-icon btn-sm flip" (click)="move(e, i, 1)" [disabled]="last" title="Xuống"><ui-icon name="arrow-up" [size]="14" /></button>
                <button class="btn btn-ghost btn-icon btn-sm" (click)="removeStep(e, i)" title="Xóa bước"><ui-icon name="x" [size]="14" /></button>
              </div>
            </div>
          }
          <button class="btn btn-sm add" (click)="addStep(e)" [disabled]="!targets().length">+ Thêm bước</button>
        </div>
        <div class="d-foot">
          @if (!e.isNew) {
            @if (confirmingDelete()) {
              <button class="btn btn-danger btn-sm" (click)="remove(e)"><ui-icon name="trash" [size]="13" /> Xóa hẳn tour này</button>
              <button class="btn btn-ghost btn-sm" (click)="confirmingDelete.set(false)">Không xóa</button>
            } @else {
              <button class="btn btn-danger btn-sm" (click)="confirmingDelete.set(true)">Xóa tour</button>
            }
          }
          <span class="grow"></span>
          <button class="btn" (click)="editing.set(null)">Hủy</button>
          <button class="btn btn-primary" (click)="save(e)" [disabled]="saving()">@if (saving()) { <span class="spinner"></span> } Lưu</button>
        </div>
      </aside>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    .list { display: flex; flex-direction: column; gap: 12px; }
    .tour { display: flex; align-items: flex-start; gap: 16px; padding: 16px 20px; }
    .t-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
    .meta { display: flex; flex-wrap: wrap; gap: 14px; color: var(--text-2); }
    .err { color: var(--danger-text); }
    .t-actions { display: flex; gap: 8px; }
    .scrim { position: fixed; inset: 0; background: rgba(16, 24, 40, .3); z-index: 50; }
    .modal { position: fixed; z-index: 51; top: 10vh; left: 50%; transform: translateX(-50%); width: min(640px, 94vw); background: #fff; border-radius: 12px; box-shadow: var(--shadow-lg); display: flex; flex-direction: column; max-height: 80vh; }
    .m-head, .d-head { display: flex; align-items: center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--border); }
    .m-body { padding: 20px; overflow: auto; }
    .m-foot, .d-foot { display: flex; align-items: center; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--border); background: var(--surface-2); border-radius: 0 0 12px 12px; }
    .drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(640px, 100vw); background: #fff; z-index: 51; display: flex; flex-direction: column; box-shadow: var(--shadow-lg); }
    .d-body { flex: 1; overflow: auto; padding: 20px; }
    .d-foot { border-radius: 0; }
    .step { display: flex; gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); }
    .s-num { width: 24px; height: 24px; border-radius: 50%; background: var(--primary-soft); color: var(--primary); display: grid; place-items: center; font-size: 12px; font-weight: 600; flex: none; }
    .s-body { gap: 8px; }
    .kind { width: 190px; flex: none; }
    .s-tools { display: flex; flex-direction: column; gap: 2px; }
    .flip { transform: rotate(180deg); }
    .add { align-self: flex-start; }
    .proposal { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; margin-top: 4px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); }
  `,
})
export class ToursPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly store = inject(ProjectStore);
  private readonly toast = inject(ToastService);

  protected readonly tours = signal<TourDef[]>([]);
  protected readonly targets = signal<TargetInfo[]>([]);
  protected readonly features = signal<Array<{ id: string; title: string; route: string }>>([]);
  protected readonly routes = signal<string[]>([]);
  protected readonly loaded = signal(false);
  protected readonly editing = signal<Editing | null>(null);
  // Xác nhận xóa ngay trong trang (hộp thoại confirm() của trình duyệt bị chặn trong một số khung nhúng nên nút không có tác dụng)
  protected readonly confirmingDelete = signal(false);
  protected readonly saving = signal(false);
  protected readonly recording = signal(false);
  protected readonly recBusy = signal(false);
  protected readonly recLogs = signal<string[]>([]);
  protected readonly webUrl = signal<string | null>(null);
  protected rec = { id: '', about: '', feature: '', url: '', mobile: false };
  protected readonly job = signal<{ kind: 'verify' | 'rerecord'; title: string } | null>(null);
  protected readonly jobBusy = signal(false);
  protected readonly jobLogs = signal<string[]>([]);
  protected verifyUrl = '';
  protected verifyHeal = true;
  private readonly sensitive = computed(() => new Set(this.targets().filter((t) => t.sensitivity === 'user-only').map((t) => t.tourId)));

  async ngOnInit(): Promise<void> {
    await this.load();
    const run = await this.api.get<RunState>('/api/run').catch(() => null);
    this.webUrl.set(run?.web.running ? run.web.url : null);
    this.rec.url = this.store.project()?.webUrl ?? run?.web.url ?? `http://localhost:${this.store.project()?.devPort ?? 4200}`;
  }

  private async load(): Promise<void> {
    try {
      const res = await this.api.get<{ tours: TourDef[]; targets: TargetInfo[]; features: Array<{ id: string; title: string; route: string }>; routes: string[] }>('/api/tours');
      this.tours.set(res.tours);
      this.targets.set(res.targets);
      this.features.set(res.features);
      this.routes.set(res.routes);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.loaded.set(true);
    }
  }

  protected featureTitle(id?: string): string | null {
    return id ? (this.features().find((f) => f.id === id)?.title ?? id) : null;
  }

  protected isSensitive(tourId: string): boolean {
    return this.sensitive().has(tourId);
  }

  protected edit(t: TourDef): void {
    this.confirmingDelete.set(false);
    this.editing.set({
      id: t.id,
      isNew: false,
      title: t.title ?? '',
      description: t.description ?? '',
      feature: t.feature ?? '',
      startRoute: t.startRoute ?? this.routes()[0] ?? '/',
      steps: t.steps.map((s) => ({ key: s.key, element: s.element, target: s.target, advanceOn: s.advanceOn, text: s.text, healedAt: s.healedAt })),
    });
  }

  protected newBlank(): void {
    this.editing.set({ id: '', isNew: true, title: '', description: '', feature: '', startRoute: this.routes()[0] ?? '/', steps: [] });
  }

  protected addStep(e: Editing): void {
    const target = this.targets()[0]?.tourId ?? '';
    e.steps = [...e.steps, { target, advanceOn: 'next', text: '' }];
    this.editing.set({ ...e });
  }

  // Phần tử nhạy cảm: tour không chờ người dùng bấm (họ tự làm), luôn dùng nút Tiếp
  protected setTarget(s: TourStep, target: string): void {
    s.target = target;
    if (this.isSensitive(target)) s.advanceOn = 'next';
  }

  protected removeStep(e: Editing, i: number): void {
    e.steps = e.steps.filter((_, idx) => idx !== i);
    this.editing.set({ ...e });
  }

  protected move(e: Editing, i: number, d: number): void {
    const steps = [...e.steps];
    [steps[i], steps[i + d]] = [steps[i + d], steps[i]];
    e.steps = steps;
    this.editing.set({ ...e });
  }

  protected async save(e: Editing): Promise<void> {
    this.saving.set(true);
    try {
      const steps = e.steps.map(({ element: _element, healedAt: _healed, ...s }) => ({ ...s, advanceOn: this.isSensitive(s.target) ? 'next' : s.advanceOn }));
      await this.api.put(`/api/tours/${encodeURIComponent(e.id.trim())}`, { title: e.title, description: e.description, feature: e.feature || undefined, startRoute: e.startRoute, steps });
      this.editing.set(null);
      await this.load();
      void this.store.refreshOverview();
      this.toast.success('Đã lưu tour. Backend tự nạp lại.');
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(e: Editing): Promise<void> {
    this.confirmingDelete.set(false);
    try {
      await this.api.delete(`/api/tours/${encodeURIComponent(e.id)}`);
      this.editing.set(null);
      await this.load();
      this.toast.success('Đã xóa tour');
    } catch (err) {
      this.toast.error(err);
    }
  }

  // Có tour: ghi thêm bản cho bố cục còn thiếu, cùng id
  protected openRecord(tour?: TourDef): void {
    const mobile = tour ? !tour.layouts?.includes('mobile') : false;
    this.rec = { id: tour?.id ?? '', about: '', feature: tour?.feature ?? '', url: this.rec.url, mobile };
    this.recLogs.set([]);
    this.recording.set(true);
  }

  protected async startRecord(): Promise<void> {
    this.recBusy.set(true);
    this.recLogs.set([]);
    try {
      const res = await this.api.stream<{ id: string }>('/api/tours/record', { id: this.rec.id.trim(), about: this.rec.about, feature: this.rec.feature, url: this.rec.url.trim(), mobile: this.rec.mobile }, (l) => this.recLogs.update((x) => [...x, l]));
      await this.load();
      void this.store.refreshOverview();
      const t = this.tours().find((x) => x.id === res.id);
      this.toast.success('Đã ghi tour. Duyệt chữ từng bước trước khi dùng.');
      this.recording.set(false);
      if (t) this.edit(t);
    } catch (e) {
      this.recLogs.update((x) => [...x, `Lỗi: ${(e as Error).message}`]);
      this.toast.error(e);
    } finally {
      this.recBusy.set(false);
    }
  }

  protected openVerify(): void {
    this.verifyUrl = this.webUrl() ?? this.rec.url;
    this.jobLogs.set([]);
    this.job.set({ kind: 'verify', title: 'Kiểm tra tour' });
  }

  protected async runVerify(): Promise<void> {
    await this.runJob('/api/tours/verify', { url: this.verifyUrl.trim(), heal: this.verifyHeal });
  }

  // Ghi lại phần tử của một bước: Chrome mở ở màn hình của bước, lần bấm đầu tiên thay phần tử
  protected async rerecord(id: string, key: string, layout?: 'desktop' | 'mobile'): Promise<void> {
    this.editing.set(null);
    this.jobLogs.set([]);
    this.job.set({ kind: 'rerecord', title: `Ghi lại bước ${key}` });
    await this.runJob(`/api/tours/${encodeURIComponent(id)}/steps/${encodeURIComponent(key)}/rerecord`, { url: (this.webUrl() ?? this.rec.url).trim(), layout });
  }

  private async runJob(path: string, body: unknown): Promise<void> {
    this.jobBusy.set(true);
    try {
      await this.api.stream(path, body, (l) => this.jobLogs.update((x) => [...x, l]));
      await this.load();
      void this.store.refreshOverview();
    } catch (e) {
      this.jobLogs.update((x) => [...x, `Lỗi: ${(e as Error).message}`]);
      this.toast.error(e);
    } finally {
      this.jobBusy.set(false);
    }
  }

  protected async decide(t: TourDef, p: TourProposal, approve: boolean): Promise<void> {
    try {
      await this.api.post(`/api/tours/${encodeURIComponent(t.id)}/steps/${encodeURIComponent(p.key)}/proposal`, { approve, layout: p.layout });
      await this.load();
      this.toast.success(approve ? 'Đã dùng locator mới cho bước này.' : 'Đã bỏ đề xuất.');
    } catch (e) {
      this.toast.error(e);
    }
  }

  protected tryTour(t: TourDef): void {
    const base = this.webUrl() ?? this.rec.url;
    window.open(`${base.replace(/\/$/, '')}/?compassTour=${encodeURIComponent(t.id)}`, '_blank', 'noopener');
    if (!this.webUrl()) this.toast.show('Nếu trang không mở được, hãy bật web ở trang Chạy thử.');
  }
}
