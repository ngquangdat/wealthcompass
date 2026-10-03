import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import type { RunState } from '../core/models';
import { ProjectStore } from '../core/project.store';
import { ToastService } from '../core/toast.service';
import { IconComponent } from '../shared/icon.component';
import { LogConsoleComponent } from '../shared/log-console.component';
import { PageHeaderComponent } from '../shared/page-header.component';

type Proc = 'backend' | 'web';

interface EnvForm {
  PORT: string;
  COMPASS_PACK: string;
  COMPASS_ORIGINS: string;
  COMPASS_MOCK_IDP: boolean;
  COMPASS_JWKS_URL: string;
  COMPASS_JWT_ISSUER: string;
  COMPASS_JWT_AUDIENCE: string;
  COMPASS_CAPABILITIES_CLAIM: string;
}

@Component({
  selector: 'page-run',
  imports: [FormsModule, RouterLink, IconComponent, PageHeaderComponent, LogConsoleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header title="Chạy thử" subtitle="Bật backend WealthCompass và web của dự án trên máy này để thử trợ lý." />

    @if (state(); as s) {
      <div class="grid-2">
        <div class="card proc">
          <div class="card-head">
            <span class="p-icon"><ui-icon name="server" /></span>
            <div class="grow">
              <h2>Backend WealthCompass</h2>
              <div class="muted small">Cổng {{ s.backend.port }}</div>
            </div>
            <span class="dot" [class.running]="s.backend.running"></span>
            <span class="small">{{ s.backend.running ? 'Đang chạy' : 'Đã dừng' }}</span>
          </div>
          <div class="card-body stack">
            @if (!s.backend.available) {
              <div class="alert warning"><ui-icon name="alert" /><span>Chưa cài gói backend trong dự án. <a routerLink="/integrate">Tích hợp và cài gói</a> trước.</span></div>
            } @else if (s.backend.health; as h) {
              <div class="facts">
                <div><span class="muted small">Màn hình</span><b>{{ h.features }}</b></div>
                <div><span class="muted small">Domain Pack</span><b>{{ h.pack }}</b></div>
                <div><span class="muted small">AI</span>@if (h.llmConfigured) { <b>{{ h.provider }} · {{ h.model }}</b> } @else { <span class="badge warning">Chưa có khóa</span> }</div>
              </div>
            } @else if (s.backend.running) {
              <p class="muted small">Đang khởi động...</p>
            }
            <div class="row">
              @if (s.backend.running) {
                <button class="btn" (click)="act('backend', 'stop')"><ui-icon name="stop" /> Dừng</button>
                <button class="btn" (click)="restart('backend')"><ui-icon name="refresh" /> Khởi động lại</button>
              } @else {
                <button class="btn btn-primary" (click)="act('backend', 'start')" [disabled]="!s.backend.available"><ui-icon name="play" /> Chạy backend</button>
              }
              <span class="grow"></span>
              <button class="btn btn-ghost btn-sm" (click)="showLog('backend')"><ui-icon name="terminal" [size]="14" /> Log</button>
            </div>
          </div>
        </div>

        <div class="card proc">
          <div class="card-head">
            <span class="p-icon"><ui-icon name="globe" /></span>
            <div class="grow">
              <h2>Web của dự án</h2>
              <div class="muted small">{{ s.web.url }}</div>
            </div>
            <span class="dot" [class.running]="s.web.running"></span>
            <span class="small">{{ s.web.running ? 'Đang chạy' : 'Đã dừng' }}</span>
          </div>
          <div class="card-body stack">
            <p class="muted small">Chạy <code>ng serve</code> ở cổng {{ s.web.port }}. Mở web, đăng nhập rồi bấm bong bóng chat để hỏi trợ lý.</p>
            <div class="row">
              @if (s.web.running) {
                <a class="btn btn-primary" [href]="s.web.url" target="_blank" rel="noopener"><ui-icon name="external" /> Mở web</a>
                <button class="btn" (click)="act('web', 'stop')"><ui-icon name="stop" /> Dừng</button>
              } @else {
                <button class="btn btn-primary" (click)="act('web', 'start')" [disabled]="!s.web.available"><ui-icon name="play" /> Chạy web</button>
              }
              <span class="grow"></span>
              <button class="btn btn-ghost btn-sm" (click)="showLog('web')"><ui-icon name="terminal" [size]="14" /> Log</button>
            </div>
          </div>
        </div>
      </div>

      @if (logOf()) {
        <div class="card">
          <div class="card-head">
            <ui-icon name="terminal" />
            <h2>Log {{ logOf() === 'backend' ? 'backend' : 'web' }}</h2>
            <button class="btn btn-ghost btn-icon btn-sm" (click)="hideLog()" aria-label="Đóng log"><ui-icon name="x" /></button>
          </div>
          <div class="card-body"><ui-log-console [lines]="logLines()" height="280px" placeholder="Chưa có log. Hãy chạy tiến trình." /></div>
        </div>
      }
    }

    <div class="card">
      <div class="card-head">
        <h2>Cấu hình backend</h2>
        <span class="muted small mono">wealthcompass.env</span>
      </div>
      @if (envExists()) {
        <div class="card-body stack">
          <div class="grid-2">
            <div class="field"><label>Cổng</label><input class="input mono" [(ngModel)]="env.PORT" /></div>
            <div class="field">
              <label>Domain Pack</label>
              <select class="select" [(ngModel)]="env.COMPASS_PACK">
                <option value="generic">Chung (generic)</option>
                <option value="finance-vn">Tài chính (finance-vn)</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label>Origin của web được gọi backend (CORS)</label>
            <input class="input mono" [(ngModel)]="env.COMPASS_ORIGINS" />
            <span class="hint">Phân tách bằng dấu phẩy, gồm cả cổng.</span>
          </div>

          <div class="divider"></div>
          <label class="toggle-row">
            <input type="checkbox" [(ngModel)]="env.COMPASS_MOCK_IDP" />
            <div class="grow">
              <div>Dùng IdP giả lập để thử</div>
              <div class="hint">Backend tự cấp JWT cho tài khoản demo. Tắt khi đã có hệ thống đăng nhập thật và điền JWKS bên dưới.</div>
            </div>
          </label>
          <div class="grid-2">
            <div class="field"><label>JWKS URL</label><input class="input mono" [(ngModel)]="env.COMPASS_JWKS_URL" placeholder="https://sso.congty.vn/.well-known/jwks.json" [disabled]="env.COMPASS_MOCK_IDP" /></div>
            <div class="field"><label>Claim chứa quyền</label><input class="input mono" [(ngModel)]="env.COMPASS_CAPABILITIES_CLAIM" /></div>
            <div class="field"><label>Issuer</label><input class="input mono" [(ngModel)]="env.COMPASS_JWT_ISSUER" [disabled]="env.COMPASS_MOCK_IDP" /></div>
            <div class="field"><label>Audience</label><input class="input mono" [(ngModel)]="env.COMPASS_JWT_AUDIENCE" [disabled]="env.COMPASS_MOCK_IDP" /></div>
          </div>
          <div class="row">
            <span class="hint grow"><ui-icon name="key" [size]="12" /> Khóa AI không lưu vào file này; xem trang Cài đặt AI.</span>
            <button class="btn btn-primary" (click)="saveEnv()" [disabled]="savingEnv()">Lưu cấu hình</button>
          </div>
        </div>
      } @else {
        <div class="empty"><h3>Chưa có wealthcompass.env</h3><p>File này được tạo ở bước <a routerLink="/integrate">Tích hợp</a>.</p></div>
      }
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    .p-icon { width: 34px; height: 34px; border-radius: 8px; background: var(--primary-soft); color: var(--primary); display: grid; place-items: center; }
    .facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .facts > div { display: flex; flex-direction: column; gap: 2px; }
    .toggle-row { display: flex; gap: 10px; align-items: flex-start; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; }
  `,
})
export class RunPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly store = inject(ProjectStore);
  private readonly toast = inject(ToastService);

  protected readonly state = signal<RunState | null>(null);
  protected readonly logOf = signal<Proc | null>(null);
  protected readonly logLines = signal<string[]>([]);
  protected readonly envExists = signal(false);
  protected readonly savingEnv = signal(false);
  protected env: EnvForm = { PORT: '8890', COMPASS_PACK: 'generic', COMPASS_ORIGINS: '', COMPASS_MOCK_IDP: true, COMPASS_JWKS_URL: '', COMPASS_JWT_ISSUER: '', COMPASS_JWT_AUDIENCE: '', COMPASS_CAPABILITIES_CLAIM: 'roles' };

  private timer?: ReturnType<typeof setInterval>;
  private unfollow?: () => void;

  async ngOnInit(): Promise<void> {
    await Promise.all([this.poll(), this.loadEnv()]);
    // Trạng thái tiến trình đổi ngoài ý người dùng (thoát lỗi, khởi động xong): hỏi lại định kỳ
    this.timer = setInterval(() => void this.poll(), 2500);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
    this.unfollow?.();
  }

  private async poll(): Promise<void> {
    try {
      this.state.set(await this.api.get<RunState>('/api/run'));
    } catch {
      // bỏ qua lỗi tạm thời khi hỏi trạng thái
    }
  }

  private async loadEnv(): Promise<void> {
    const res = await this.api.get<{ exists: boolean; values: Record<string, string> }>('/api/env');
    this.envExists.set(res.exists);
    const v = res.values;
    this.env = {
      PORT: v['PORT'] ?? '8890',
      COMPASS_PACK: v['COMPASS_PACK'] ?? 'generic',
      COMPASS_ORIGINS: v['COMPASS_ORIGINS'] ?? '',
      COMPASS_MOCK_IDP: v['COMPASS_MOCK_IDP'] !== '0',
      COMPASS_JWKS_URL: v['COMPASS_JWKS_URL'] ?? '',
      COMPASS_JWT_ISSUER: v['COMPASS_JWT_ISSUER'] ?? '',
      COMPASS_JWT_AUDIENCE: v['COMPASS_JWT_AUDIENCE'] ?? '',
      COMPASS_CAPABILITIES_CLAIM: v['COMPASS_CAPABILITIES_CLAIM'] ?? 'roles',
    };
  }

  protected async act(name: Proc, action: 'start' | 'stop'): Promise<void> {
    try {
      await this.api.post(`/api/run/${name}/${action}`);
      if (action === 'start') this.showLog(name);
      await this.poll();
      if (name === 'backend') setTimeout(() => void this.store.refreshOverview(), 1500);
    } catch (e) {
      this.toast.error(e);
    }
  }

  protected async restart(name: Proc): Promise<void> {
    await this.act(name, 'stop');
    await this.act(name, 'start');
  }

  protected showLog(name: Proc): void {
    this.unfollow?.();
    this.logOf.set(name);
    this.logLines.set([]);
    this.unfollow = this.api.follow(`/api/run/${name}/logs`, (l) => this.logLines.update((x) => [...x.slice(-399), l]));
  }

  protected hideLog(): void {
    this.unfollow?.();
    this.logOf.set(null);
  }

  protected async saveEnv(): Promise<void> {
    this.savingEnv.set(true);
    try {
      const e = this.env;
      const res = await this.api.put<{ restartNeeded: boolean }>('/api/env', {
        PORT: e.PORT,
        COMPASS_PACK: e.COMPASS_PACK,
        COMPASS_ORIGINS: e.COMPASS_ORIGINS,
        COMPASS_MOCK_IDP: e.COMPASS_MOCK_IDP ? '1' : '0',
        COMPASS_JWKS_URL: e.COMPASS_JWKS_URL || null,
        COMPASS_JWT_ISSUER: e.COMPASS_JWT_ISSUER || null,
        COMPASS_JWT_AUDIENCE: e.COMPASS_JWT_AUDIENCE || null,
        COMPASS_CAPABILITIES_CLAIM: e.COMPASS_CAPABILITIES_CLAIM,
      });
      this.toast.success(res.restartNeeded ? 'Đã lưu. Khởi động lại backend để áp dụng.' : 'Đã lưu cấu hình backend');
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.savingEnv.set(false);
    }
  }
}
