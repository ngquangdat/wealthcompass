import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import type { AssistantMeta, DebugStage, RunState } from '../core/models';
import { ToastService } from '../core/toast.service';
import { IconComponent } from '../shared/icon.component';
import { PageHeaderComponent } from '../shared/page-header.component';
import { RichTextComponent } from '../shared/rich-text.component';

interface Action {
  kind: 'tour' | 'navigate';
  id: string; // tourId hoặc route
  label: string;
}

interface Turn {
  question: string;
  text: string;
  tone: 'normal' | 'refusal' | 'error';
  note: string | null; // handoff
  actions: Action[];
  stages: DebugStage[];
  pending: boolean;
  roles: string[];
}

const OUTCOME_HINT: Record<string, string> = {
  search_features: 'Tìm thêm màn hình',
  offer_tour: 'Hiện nút tour',
  offer_navigate: 'Hiện nút mở màn hình',
  handoff_support: 'Gợi ý liên hệ hỗ trợ',
};

@Component({
  selector: 'page-assistant',
  imports: [FormsModule, RouterLink, IconComponent, PageHeaderComponent, RichTextComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header title="Thử trợ lý" subtitle="Hỏi như người dùng thật, chọn quyền của người hỏi, và xem trợ lý đã tra cứu gì, gọi công cụ gì để trả lời.">
      @if (turns().length) { <button class="btn" (click)="reset()"><ui-icon name="refresh" /> Cuộc trò chuyện mới</button> }
    </ui-page-header>

    @if (meta(); as m) {
      @if (!m.backend.running || !m.backend.debug) {
        <div class="alert warning">
          <ui-icon name="alert" />
          <span>
            @if (!m.backend.running) { Backend chưa chạy. } @else { Backend đang chạy không có chế độ debug (gói cũ hoặc bật ngoài Studio). }
            Bật hoặc khởi động lại backend ở <a routerLink="/run">Chạy thử</a> rồi tải lại trang này.
          </span>
        </div>
      }

      <div class="layout">
        <section class="card chat">
          <div class="who">
            <div class="who-row">
              <span class="label">Người hỏi có quyền</span>
              <div class="roles">
                @for (r of m.roles; track r) {
                  <button type="button" class="pick" [class.on]="roles().includes(r)" (click)="toggleRole(r)">{{ r }}</button>
                } @empty { <span class="muted small">Web không có màn hình nào cần quyền riêng.</span> }
              </div>
            </div>
            <div class="who-row">
              <span class="label">Đang ở màn hình</span>
              <select class="select route" [(ngModel)]="route">
                @for (r of m.routes; track r) { <option [value]="r">{{ title(r) }} · {{ r }}</option> }
              </select>
            </div>
          </div>

          <div class="messages" #scroller>
            @for (t of turns(); track $index; let i = $index) {
              <div class="msg user"><div class="bubble">{{ t.question }}</div></div>
              <div class="msg bot" [class.selected]="selected() === i" (click)="selected.set(i)">
                <div class="bubble" [class.refusal]="t.tone === 'refusal'" [class.error]="t.tone === 'error'">
                  @if (t.text) { <ui-rich [text]="t.text" /> } @else if (t.pending) { <span class="typing"><i></i><i></i><i></i></span> }
                  @if (t.note) { <div class="note">{{ t.note }}</div> }
                  @if (t.actions.length) {
                    <div class="actions">
                      @for (a of t.actions; track a.id) {
                        <button class="btn btn-sm" [class.btn-primary]="a.kind === 'tour'" (click)="openAction(a); $event.stopPropagation()" [title]="a.kind === 'tour' ? 'Mở web và chạy tour này' : 'Mở màn hình này trên web'">
                          <ui-icon [name]="a.kind === 'tour' ? 'compass' : 'external'" [size]="13" /> {{ a.label }}
                        </button>
                      }
                    </div>
                  }
                </div>
                <div class="meta small muted">{{ t.roles.length ? t.roles.join(', ') : 'không quyền riêng' }} @if (doneMs(t); as ms) { · {{ (ms / 1000).toFixed(1) }} giây }</div>
              </div>
            } @empty {
              <div class="empty">
                <ui-icon name="message" [size]="28" />
                <p>Gõ một câu hỏi, hoặc thử:</p>
                <div class="samples">
                  @for (s of m.samples; track s) { <button class="pick" (click)="ask(s)">{{ s }}</button> }
                </div>
              </div>
            }
          </div>

          <form class="composer" (submit)="send($event)">
            <input class="input" [(ngModel)]="draft" name="q" placeholder="Hỏi trợ lý như người dùng..." [disabled]="busy()" autocomplete="off" />
            <button class="btn btn-primary" [disabled]="busy() || !draft.trim()"><ui-icon name="send" [size]="15" /> Gửi</button>
          </form>
        </section>

        <aside class="card debug">
          <h3>Trợ lý đã làm gì</h3>
          @if (current(); as t) {
            <p class="muted small q">“{{ t.question }}”</p>
            <ol class="timeline">
              @for (s of t.stages; track $index) {
                <li [class]="s.stage">
                  @switch (s.stage) {
                    @case ('guardrail') {
                      <div class="st-title">Bộ lọc chủ đề cấm</div>
                      @if (s.data['blocked']) { <span class="badge danger">Chặn: {{ s.data['topic'] }}</span> <div class="small muted">Không gửi tới AI, trả câu từ chối của Domain Pack.</div> }
                      @else { <span class="badge success">Cho qua</span> }
                      <code class="tiny">{{ s.data['normalized'] }}</code>
                    }
                    @case ('prefetch') {
                      <div class="st-title">Tra cứu ban đầu</div>
                      @for (r of s.data['results']; track r.id) {
                        <div class="hit"><b>{{ r.title }}</b> <span class="mono muted">{{ r.score }}</span> @if (r.tours.length) { <span class="badge">tour: {{ r.tours.join(', ') }}</span> }</div>
                      } @empty { <div class="small muted">Không màn hình nào vượt ngưỡng điểm.</div> }
                      @if (s.data['restricted']; as x) { <div class="small warn">Khớp nhất là <b>{{ x.title }}</b> nhưng người hỏi thiếu quyền {{ x.requires.join(', ') }}.</div> }
                    }
                    @case ('llm') {
                      <div class="st-title">AI · vòng {{ s.data['round'] }} <span class="muted small">{{ s.data['model'] }} · {{ s.data['ms'] }} ms</span></div>
                      <div class="small muted">{{ s.data['calls'].length ? 'Gọi: ' + s.data['calls'].join(', ') : 'Viết câu trả lời' + (s.data['textChars'] ? ' (' + s.data['textChars'] + ' ký tự)' : '') }}</div>
                    }
                    @case ('tool') {
                      <div class="st-title">{{ toolLabel(s.data['name']) }} <span class="mono muted small">{{ argsText(s.data['args']) }}</span></div>
                      @if (s.data['result']?.ok === false) { <span class="badge danger">Bị từ chối: {{ s.data['result'].error }}</span> }
                      @else if (s.data['name'] === 'search_features') { <div class="small muted">{{ s.data['result']?.results?.length ?? 0 }} kết quả</div> }
                      @else { <span class="badge success">OK</span> }
                    }
                    @case ('error') {
                      <div class="st-title">Lỗi AI</div>
                      <div class="small">{{ s.data['detail'] }}</div>
                      @if (s.data['fallback']) { <span class="badge warning">Chuyển sang chế độ dự phòng</span> }
                    }
                    @case ('done') {
                      <div class="st-title">Xong · {{ s.data['ms'] }} ms</div>
                      @if (s.data['offered'].length) { <div class="small muted">Nút đã hiện: {{ s.data['offered'].join(', ') }}</div> }
                    }
                  }
                </li>
              }
              @if (t.pending) { <li class="pending"><span class="spinner"></span></li> }
            </ol>
          } @else {
            <p class="muted small">Gửi một câu hỏi để xem từng bước: bộ lọc, tra cứu, AI gọi công cụ nào, nút nào được hiện.</p>
          }
        </aside>
      </div>
    } @else {
      <div class="card"><span class="spinner"></span> Đang tải...</div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 16px; align-items: start; }
    @media (max-width: 1100px) { .layout { grid-template-columns: 1fr; } }
    .chat { display: flex; flex-direction: column; height: calc(100vh - 190px); min-height: 480px; padding: 0; overflow: hidden; }
    .who { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; background: var(--surface-2); }
    .who-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .who-row .label { width: 130px; flex: none; margin: 0; }
    .roles { display: flex; flex-wrap: wrap; gap: 6px; flex: 1; }
    .route { flex: 1; min-width: 200px; max-width: 420px; }
    .messages { flex: 1; overflow: auto; padding: 20px 16px; display: flex; flex-direction: column; gap: 10px; }
    .msg { display: flex; flex-direction: column; max-width: 80%; }
    .msg.user { align-self: flex-end; align-items: flex-end; }
    .msg.user .bubble { background: var(--primary); color: #fff; border-radius: 14px 14px 4px 14px; }
    .msg.bot { align-self: flex-start; cursor: pointer; }
    .msg.bot .bubble { background: var(--surface-2); border: 1px solid var(--border); border-radius: 14px 14px 14px 4px; }
    .msg.bot.selected .bubble { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
    .bubble { padding: 10px 14px; font-size: 14px; line-height: 1.55; }
    .bubble.refusal { background: #fffaeb; border-color: #fedf89; }
    .bubble.error { background: #fef3f2; border-color: #fecdca; }
    .note { margin-top: 8px; font-size: 13px; color: var(--text-2); }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .meta { margin: 4px 6px 0; }
    .typing { display: inline-flex; gap: 4px; }
    .typing i { width: 6px; height: 6px; border-radius: 50%; background: var(--text-3); animation: blink 1s infinite; }
    .typing i:nth-child(2) { animation-delay: .2s; } .typing i:nth-child(3) { animation-delay: .4s; }
    @keyframes blink { 50% { opacity: .3; } }
    .empty { margin: auto; text-align: center; color: var(--text-3); display: flex; flex-direction: column; align-items: center; gap: 8px; max-width: 520px; }
    .samples { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
    .composer { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); }
    .composer .input { flex: 1; }
    .debug { padding: 16px; position: sticky; top: 16px; max-height: calc(100vh - 120px); overflow: auto; }
    .debug h3 { margin: 0 0 4px; }
    .q { margin: 0 0 12px; }
    .timeline { list-style: none; margin: 0; padding: 0 0 0 14px; border-left: 2px solid var(--border); display: flex; flex-direction: column; gap: 14px; }
    .timeline li { position: relative; display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
    .timeline li::before { content: ''; position: absolute; left: -20px; top: 4px; width: 10px; height: 10px; border-radius: 50%; background: var(--surface); border: 2px solid var(--border-strong); }
    .timeline li.guardrail::before, .timeline li.done::before { border-color: var(--success); }
    .timeline li.llm::before { border-color: var(--ai, #7a5af8); }
    .timeline li.tool::before { border-color: var(--primary); }
    .timeline li.error::before { border-color: var(--danger); }
    .st-title { font-weight: 600; font-size: 13px; }
    .hit { font-size: 13px; display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
    .warn { color: var(--warning-text, #b54708); }
    .tiny { font-size: 11px; word-break: break-word; }
  `,
})
export class AssistantPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly scroller = viewChild<ElementRef<HTMLDivElement>>('scroller');

  protected readonly meta = signal<AssistantMeta | null>(null);
  protected readonly roles = signal<string[]>([]);
  protected readonly turns = signal<Turn[]>([]);
  protected readonly selected = signal<number | null>(null);
  protected readonly busy = signal(false);
  protected readonly current = computed(() => {
    const i = this.selected() ?? this.turns().length - 1;
    return this.turns()[i] ?? null;
  });
  protected route = '/';
  protected draft = '';
  private webUrl = 'http://localhost:4200';
  private abort: AbortController | null = null;

  async ngOnInit(): Promise<void> {
    try {
      const m = await this.api.get<AssistantMeta>('/api/assistant/meta');
      this.meta.set(m);
      // Mặc định: người hỏi có mọi quyền, đứng ở màn hình đầu tiên
      this.roles.set([...m.roles]);
      this.route = m.routes[0] ?? '/';
      const run = await this.api.get<RunState>('/api/run').catch(() => null);
      if (run?.web.url) this.webUrl = run.web.url;
    } catch (e) {
      this.toast.error(e);
    }
  }

  ngOnDestroy(): void {
    this.abort?.abort();
  }

  protected title(route: string): string {
    return this.meta()?.features.find((f) => f.route === route)?.title ?? route;
  }

  protected toggleRole(r: string): void {
    this.roles.update((x) => (x.includes(r) ? x.filter((y) => y !== r) : [...x, r]));
  }

  protected toolLabel(name: string): string {
    return OUTCOME_HINT[name] ?? name;
  }

  protected argsText(args: Record<string, unknown>): string {
    return Object.values(args ?? {}).join(', ');
  }

  protected doneMs(t: Turn): number | null {
    return (t.stages.find((s) => s.stage === 'done')?.data['ms'] as number) ?? null;
  }

  protected reset(): void {
    this.abort?.abort();
    this.turns.set([]);
    this.selected.set(null);
  }

  protected send(e: Event): void {
    e.preventDefault();
    this.ask(this.draft);
  }

  protected async ask(text: string): Promise<void> {
    const question = text.trim();
    if (!question || this.busy()) return;
    this.draft = '';
    const history = this.turns().flatMap((t) => [
      { role: 'user', content: t.question },
      { role: 'assistant', content: t.text || t.note || '' },
    ]).filter((m) => m.content).slice(-8);
    const turn: Turn = { question, text: '', tone: 'normal', note: null, actions: [], stages: [], pending: true, roles: [...this.roles()] };
    this.turns.update((x) => [...x, turn]);
    this.selected.set(null);
    this.busy.set(true);
    this.scrollDown();
    this.abort = new AbortController();
    const update = (fn: (t: Turn) => void) => {
      fn(turn);
      this.turns.update((x) => [...x]);
      this.scrollDown();
    };
    try {
      await this.api.sse('/api/assistant/chat', { text: question, roles: turn.roles, route: this.route, history }, (ev) => {
        switch (ev['type']) {
          case 'text': return update((t) => (t.text += String(ev['delta'])));
          case 'refusal': return update((t) => { t.text = String(ev['message']); t.tone = 'refusal'; });
          case 'error': return update((t) => { t.text += (t.text ? '\n\n' : '') + String(ev['message']); t.tone = 'error'; });
          case 'handoff': return update((t) => (t.note = String(ev['message'])));
          case 'offer_tour': return update((t) => t.actions.push({ kind: 'tour', id: String(ev['tourId']), label: String(ev['label']) }));
          case 'offer_navigate': return update((t) => t.actions.push({ kind: 'navigate', id: String(ev['route']), label: String(ev['label']) }));
          case 'debug': return update((t) => t.stages.push({ stage: ev['stage'] as DebugStage['stage'], data: ev['data'] as Record<string, unknown> }));
        }
      }, this.abort.signal);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') update((t) => { t.text = (err as Error).message; t.tone = 'error'; });
    } finally {
      update((t) => (t.pending = false));
      this.busy.set(false);
    }
  }

  protected openAction(a: Action): void {
    const base = this.webUrl.replace(/\/$/, '');
    const url = a.kind === 'tour' ? `${base}${this.route}?compassTour=${encodeURIComponent(a.id)}` : `${base}${a.id}`;
    window.open(url, '_blank', 'noopener');
  }

  private scrollDown(): void {
    queueMicrotask(() => {
      const el = this.scroller()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}
