import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import type { AiState } from '../core/models';
import { ToastService } from '../core/toast.service';
import { IconComponent } from '../shared/icon.component';
import { PageHeaderComponent } from '../shared/page-header.component';

@Component({
  selector: 'page-settings',
  imports: [FormsModule, IconComponent, PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header title="Cài đặt AI" subtitle="AI dùng để soạn nháp mô tả màn hình, câu hỏi mẫu và nội dung tour. Mọi nội dung AI soạn đều cần bạn duyệt." />

    @if (ai(); as a) {
      <div class="card">
        <div class="card-head">
          <h2>Nhà cung cấp</h2>
          @if (a.hasKey) { <span class="badge success"><ui-icon name="check" [size]="12" /> Đã có khóa</span> }
          @else { <span class="badge warning">Chưa có khóa</span> }
        </div>
        <div class="card-body stack">
          <div class="grid-2">
            <div class="field">
              <label>Nhà cung cấp</label>
              <select class="select" [ngModel]="a.provider" (ngModelChange)="update({ provider: $event, model: '' })">
                @for (p of a.providers; track p) { <option [value]="p">{{ p === 'deepseek' ? 'DeepSeek' : p === 'gemini' ? 'Google Gemini' : p }}</option> }
              </select>
            </div>
            <div class="field">
              <label>Model</label>
              <input class="input mono" [ngModel]="a.model" (change)="update({ model: $any($event.target).value })" />
              <span class="hint">Để trống để dùng model mặc định của nhà cung cấp.</span>
            </div>
          </div>

          <div class="field">
            <label>Khóa API</label>
            <div class="key-status">
              <ui-icon name="key" />
              @if (a.keySource) { <span>Đang dùng khóa từ <b>{{ a.keySource }}</b></span> }
              @else { <span class="muted">Chưa tìm thấy khóa trong biến môi trường</span> }
            </div>
            <div class="row">
              <input class="input mono grow" type="password" [(ngModel)]="keyInput" placeholder="Dán khóa để dùng trong phiên Studio này" autocomplete="off" />
              <button class="btn" (click)="setKey()" [disabled]="!keyInput.trim()">Dùng khóa này</button>
            </div>
            <span class="hint">Khóa nhập ở đây chỉ giữ trong bộ nhớ của Studio, mất khi tắt Studio, không ghi vào file nào. Muốn dùng lâu dài: đặt <code>COMPASS_LLM_API_KEY</code> hoặc <code>COMPASS_ENV_FILE</code> trong terminal trước khi mở Studio.</span>
          </div>

          <div class="row">
            <button class="btn" (click)="test()" [disabled]="testing() || !a.hasKey">
              @if (testing()) { <span class="spinner"></span> } @else { <ui-icon name="play" /> } Thử kết nối
            </button>
            @if (testResult(); as t) {
              @if (t.ok) { <span class="badge success">Kết nối được · {{ t.ms }} ms</span> }
              @else { <span class="badge danger">{{ t.message }}</span> }
            }
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Quyền của AI</h2></div>
        <div class="card-body stack">
          <div class="perm">
            <ui-icon name="check-circle" class="ok" />
            <div class="grow"><b>Đọc chữ hiển thị trong template</b><p class="muted small">Tiêu đề, nhãn, tên nút, đường dẫn menu. Dùng để soạn mô tả và câu hỏi mẫu. Luôn bật khi có khóa.</p></div>
          </div>
          <label class="perm toggle">
            <input type="checkbox" [ngModel]="a.aiCode" (ngModelChange)="update({ aiCode: $event })" />
            <div class="grow">
              <b>Cho AI đọc trích đoạn mã nguồn</b>
              <p class="muted small">Chỉ dùng khi phân tích tĩnh không đoán được service đăng nhập hoặc quyền của guard. Trích đoạn code của dự án sẽ được gửi sang {{ a.provider }}.</p>
              @if (a.aiCode) {
                <div class="alert warning small"><ui-icon name="alert" /><span>Đang bật. Kiểm tra chính sách công ty về việc gửi mã nguồn ra ngoài.</span></div>
              }
            </div>
          </label>
        </div>
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; max-width: 860px; }
    .key-status { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--surface-2); border: 1px solid var(--border); font-size: 13.5px; }
    .perm { display: flex; gap: 12px; align-items: flex-start; padding: 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); }
    .perm.toggle { cursor: pointer; }
    .perm input { margin-top: 3px; }
    .perm p { margin-top: 2px; }
    .ok { color: var(--success); }
    .alert { margin-top: 10px; }
  `,
})
export class SettingsPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly ai = signal<AiState | null>(null);
  protected readonly testing = signal(false);
  protected readonly testResult = signal<{ ok: boolean; ms?: number; message?: string } | null>(null);
  protected keyInput = '';

  async ngOnInit(): Promise<void> {
    this.ai.set(await this.api.get<AiState>('/api/ai'));
  }

  protected async update(changes: Partial<{ provider: string; model: string; apiKey: string | null; aiCode: boolean }>): Promise<void> {
    try {
      this.ai.set(await this.api.put<AiState>('/api/ai', changes));
      this.testResult.set(null);
    } catch (e) {
      this.toast.error(e);
    }
  }

  protected async setKey(): Promise<void> {
    await this.update({ apiKey: this.keyInput.trim() });
    this.keyInput = '';
    this.toast.success('Đã đặt khóa cho phiên Studio này');
  }

  protected async test(): Promise<void> {
    this.testing.set(true);
    try {
      this.testResult.set(await this.api.post('/api/ai/test'));
    } finally {
      this.testing.set(false);
    }
  }
}
