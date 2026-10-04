import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import type { PackState } from '../core/models';
import { ProjectStore } from '../core/project.store';
import { ToastService } from '../core/toast.service';
import { ChipsInputComponent } from '../shared/chips-input.component';
import { IconComponent } from '../shared/icon.component';
import { PageHeaderComponent } from '../shared/page-header.component';

interface TopicEdit {
  id: string;
  patterns: string;
  refusal: string;
}

interface TestResult {
  normalized: string;
  blocked: { topic: string; pattern: string; refusal: string } | null;
  expansions: string[][];
}

type Tab = 'glossary' | 'topics' | 'prompt';

@Component({
  selector: 'page-pack',
  imports: [FormsModule, IconComponent, PageHeaderComponent, ChipsInputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header title="Domain Pack" subtitle="Kiến thức theo ngành: từ đồng nghĩa giúp tìm đúng màn hình, chủ đề bị chặn và lời dặn cho AI.">
      @if (pack()?.editable) {
        <button class="btn btn-primary" (click)="save()" [disabled]="saving() || !dirty()">@if (saving()) { <span class="spinner"></span> } Lưu thay đổi</button>
      }
    </ui-page-header>

    @if (pack(); as p) {
      @if (p.error) {
        <div class="alert danger"><ui-icon name="alert" /><span>{{ p.error }}</span></div>
      } @else {
        <div class="card head">
          <div class="grow">
            <div class="row"><b>{{ p.name }}</b> @if (p.editable) { <span class="badge success">Bản riêng của dự án</span> } @else { <span class="badge">Đóng kèm gói</span> }</div>
            <div class="mono muted small path" [title]="p.dir">{{ shortDir(p.dir) }}</div>
          </div>
          @if (!p.editable) {
            <div class="fork">
              <span class="muted small">Pack đóng kèm gói chỉ xem được. Tạo bản riêng để sửa; bản riêng nằm trong dự án và commit cùng code.</span>
              <button class="btn" (click)="fork()" [disabled]="forking()">@if (forking()) { <span class="spinner"></span> } Tạo bản riêng để sửa</button>
            </div>
          }
        </div>

        <div class="layout">
          <div class="card main">
            <div class="tabs">
              <button [class.active]="tab() === 'glossary'" (click)="tab.set('glossary')">Từ đồng nghĩa <span class="count">{{ glossary().length }}</span></button>
              <button [class.active]="tab() === 'topics'" (click)="tab.set('topics')">Chủ đề bị chặn <span class="count">{{ topics().length }}</span></button>
              <button [class.active]="tab() === 'prompt'" (click)="tab.set('prompt')">Lời dặn cho AI</button>
            </div>

            @switch (tab()) {
              @case ('glossary') {
                <p class="muted small">Mỗi nhóm là các cách gọi khác nhau của cùng một khái niệm. Khi người dùng gõ một từ, trợ lý tìm cả các từ còn lại trong nhóm.</p>
                <div class="stack">
                  @for (g of glossary(); track $index; let i = $index) {
                    <div class="group">
                      <ui-chips class="grow" [value]="g" (valueChange)="setGroup(i, $event)" placeholder="Thêm cách gọi, Enter" [readonly]="!p.editable" />
                      @if (p.editable) { <button class="btn btn-ghost btn-icon btn-sm" (click)="removeGroup(i)" title="Xóa nhóm"><ui-icon name="x" [size]="14" /></button> }
                    </div>
                  }
                  @if (p.editable) { <button class="btn btn-sm add" (click)="addGroup()">+ Thêm nhóm</button> }
                </div>
              }
              @case ('topics') {
                <p class="muted small">Câu hỏi khớp một mẫu sẽ bị từ chối ngay, không gửi tới AI. Mẫu là biểu thức chính quy viết trên chữ <b>không dấu, chữ thường</b>, mỗi dòng một mẫu. Dùng ô "Thử một câu" bên phải để kiểm tra.</p>
                <div class="stack">
                  @for (t of topics(); track $index; let i = $index) {
                    <div class="topic">
                      <div class="row">
                        <input class="input mono id" [(ngModel)]="t.id" (ngModelChange)="touch()" [readonly]="!p.editable" />
                        <span class="grow"></span>
                        @if (p.editable) { <button class="btn btn-ghost btn-icon btn-sm" (click)="removeTopic(i)" title="Xóa chủ đề"><ui-icon name="x" [size]="14" /></button> }
                      </div>
                      <div class="field"><label>Mẫu</label><textarea class="textarea mono" rows="3" [(ngModel)]="t.patterns" (ngModelChange)="touch()" [readonly]="!p.editable"></textarea></div>
                      <div class="field"><label>Câu trả lời khi bị chặn</label><textarea class="textarea" rows="2" [(ngModel)]="t.refusal" (ngModelChange)="touch()" [readonly]="!p.editable"></textarea></div>
                    </div>
                  }
                  @if (p.editable) { <button class="btn btn-sm add" (click)="addTopic()">+ Thêm chủ đề</button> }
                </div>
              }
              @case ('prompt') {
                <p class="muted small">Nối vào lời dặn hệ thống của trợ lý: giọng văn, cách xưng hô, những điều không được làm. Không cần mô tả màn hình, trợ lý đã có bản đồ tính năng.</p>
                <textarea class="textarea prompt" rows="16" [(ngModel)]="prompt" (ngModelChange)="touch()" [readonly]="!p.editable"></textarea>
              }
            }
          </div>

          <div class="card tester">
            <h3>Thử một câu</h3>
            <p class="muted small">Xem câu hỏi bị chặn hay không và được mở rộng bằng những từ nào. Dùng bản đã lưu.</p>
            <textarea class="textarea" rows="3" [(ngModel)]="sample" placeholder="Có nên bán trái phiếu bây giờ không?" (keydown.control.enter)="test()" (keydown.meta.enter)="test()"></textarea>
            <button class="btn btn-sm" (click)="test()" [disabled]="!sample.trim() || testing()"><ui-icon name="search" [size]="13" /> Thử</button>
            @if (result(); as r) {
              <div class="res">
                <div class="label">Sau chuẩn hóa</div>
                <code class="norm">{{ r.normalized }}</code>
                @if (r.blocked; as b) {
                  <div class="alert danger small"><ui-icon name="lock" /><div><b>Bị chặn: {{ b.topic }}</b><div class="mono tiny">{{ b.pattern }}</div><div>{{ b.refusal }}</div></div></div>
                } @else {
                  <div class="alert success small"><ui-icon name="check-circle" /><span>Không bị chặn, câu hỏi được gửi tới trợ lý.</span></div>
                }
                <div class="label">Từ đồng nghĩa khớp</div>
                @for (g of r.expansions; track $index) { <div class="small">{{ g.join(' · ') }}</div> } @empty { <div class="muted small">Không khớp nhóm nào.</div> }
              </div>
            }
          </div>
        </div>
      }
    } @else {
      <div class="card"><span class="spinner"></span> Đang tải...</div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    .head { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; padding: 14px 20px; }
    .head > .grow { flex: 1 1 260px; min-width: 0; }
    .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
    .fork { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; flex: 1 1 320px; max-width: 560px; }
    .fork > span { flex: 1 1 220px; }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
    @media (max-width: 1100px) { .layout { grid-template-columns: 1fr; } }
    .main { padding: 0 20px 20px; }
    .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin: 0 -20px 16px; padding: 0 12px; }
    .tabs button { border: 0; background: none; padding: 12px 10px; font: 500 13.5px Inter, sans-serif; color: var(--text-2); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
    .tabs button.active { color: var(--primary); border-bottom-color: var(--primary); }
    .count { font-size: 11.5px; background: var(--surface-2); border-radius: 10px; padding: 1px 7px; margin-left: 4px; color: var(--text-3); }
    .group { display: flex; align-items: center; gap: 6px; }
    .topic { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px; display: flex; flex-direction: column; gap: 10px; }
    .id { width: 260px; }
    .prompt { font-size: 13.5px; line-height: 1.6; }
    .add { align-self: flex-start; }
    .tester { position: sticky; top: 16px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .tester h3 { margin: 0; }
    .tester .btn { align-self: flex-start; }
    .res { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--border); padding-top: 12px; }
    .norm { font-size: 12px; word-break: break-word; }
    .tiny { font-size: 11px; opacity: .8; margin: 2px 0; }
  `,
})
export class PackPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly store = inject(ProjectStore);

  protected readonly pack = signal<PackState | null>(null);
  protected readonly tab = signal<Tab>('glossary');
  protected readonly glossary = signal<string[][]>([]);
  protected readonly topics = signal<TopicEdit[]>([]);
  protected readonly dirty = signal(false);
  protected readonly saving = signal(false);
  protected readonly forking = signal(false);
  protected readonly testing = signal(false);
  protected readonly result = signal<TestResult | null>(null);
  protected prompt = '';
  protected sample = '';

  async ngOnInit(): Promise<void> {
    try {
      this.apply(await this.api.get<PackState>('/api/pack'));
    } catch (e) {
      this.toast.error(e);
    }
  }

  private apply(p: PackState): void {
    this.pack.set(p);
    this.glossary.set((p.glossary ?? []).map((g) => [...g]));
    this.topics.set((p.topics ?? []).map((t) => ({ id: t.id, patterns: t.patterns.join('\n'), refusal: t.refusal })));
    this.prompt = p.prompt ?? '';
    this.dirty.set(false);
  }

  // Đường dẫn tính từ dự án cho gọn; ngoài dự án thì giữ nguyên
  protected shortDir(dir: string | null): string {
    const root = this.store.project()?.path;
    return dir && root && dir.startsWith(root + '/') ? dir.slice(root.length + 1) : (dir ?? '');
  }

  protected touch(): void {
    this.dirty.set(true);
  }

  protected setGroup(i: number, value: string[]): void {
    this.glossary.update((g) => g.map((x, idx) => (idx === i ? value : x)));
    this.touch();
  }

  protected addGroup(): void {
    this.glossary.update((g) => [...g, []]);
  }

  protected removeGroup(i: number): void {
    this.glossary.update((g) => g.filter((_, idx) => idx !== i));
    this.touch();
  }

  protected addTopic(): void {
    this.topics.update((t) => [...t, { id: 'chu_de_moi', patterns: '', refusal: '' }]);
    this.touch();
  }

  protected removeTopic(i: number): void {
    this.topics.update((t) => t.filter((_, idx) => idx !== i));
    this.touch();
  }

  protected async fork(): Promise<void> {
    this.forking.set(true);
    try {
      this.apply(await this.api.post<PackState>('/api/pack/fork'));
      this.toast.success('Đã tạo compass-pack trong dự án. Khởi động lại backend để dùng bản riêng.');
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.forking.set(false);
    }
  }

  protected async save(): Promise<void> {
    const single = this.glossary().find((g) => g.length === 1);
    if (single) {
      this.tab.set('glossary');
      this.toast.show(`Nhóm "${single[0]}" mới có một cách gọi; thêm ít nhất một cách gọi nữa hoặc xóa nhóm.`, 'danger');
      return;
    }
    this.saving.set(true);
    try {
      const topics = this.topics().map((t) => ({ id: t.id.trim(), refusal: t.refusal, patterns: t.patterns.split('\n').map((x) => x.trim()).filter(Boolean) }));
      this.apply(await this.api.put<PackState>('/api/pack', { glossary: this.glossary(), topics, prompt: this.prompt }));
      this.toast.success('Đã lưu pack. Khởi động lại backend để áp dụng.');
      if (this.sample.trim()) void this.test();
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.saving.set(false);
    }
  }

  protected async test(): Promise<void> {
    if (!this.sample.trim()) return;
    this.testing.set(true);
    try {
      this.result.set(await this.api.post<TestResult>('/api/pack/test', { text: this.sample }));
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.testing.set(false);
    }
  }
}
