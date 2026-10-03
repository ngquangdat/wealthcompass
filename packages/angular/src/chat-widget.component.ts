import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { COMPASS_CONFIG } from './compass.config';
import { CompassIconComponent } from './compass-icon.component';
import { ChatAction, ChatService } from './chat.service';
import { renderLiteMarkdown } from '@wealthcompass/core';
import { TourService } from './tour.service';

@Component({
  selector: 'compass-chat-widget',
  imports: [FormsModule, CompassIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (chat.open()) {
      <section class="panel" role="dialog" [attr.aria-label]="config.title">
        <header>
          <div class="avatar"><compass-icon name="explore" /></div>
          <div class="titles">
            <strong>{{ config.title }}</strong>
            <small>{{ config.subtitle }}</small>
          </div>
          <button class="icon" type="button" (click)="chat.clear()" title="Cuộc trò chuyện mới" aria-label="Cuộc trò chuyện mới">
            <compass-icon name="refresh" />
          </button>
          <button class="icon" type="button" (click)="chat.toggle()" aria-label="Thu nhỏ">
            <compass-icon name="close" />
          </button>
        </header>

        <div class="messages" #scroller>
          @if (chat.messages().length === 0) {
            <div class="welcome">
              <p>Xin chào! Hỏi tôi một tính năng bất kỳ, ví dụ:</p>
              @for (s of config.suggestions; track s) {
                <button type="button" class="chip" (click)="ask(s)">{{ s }}</button>
              }
              <small class="legal">Tôi chỉ hướng dẫn tìm tính năng và dẫn đường trên giao diện, không đặt lệnh hộ hay tư vấn đầu tư.</small>
            </div>
          }
          @for (m of chat.messages(); track m.id) {
            <div class="bubble" [class.user]="m.role === 'user'" [class.refusal]="m.tone === 'refusal'" [class.error]="m.tone === 'error'">
              @if (m.text) {
                <div class="text" [innerHTML]="render(m.text)"></div>
              } @else if (m.streaming) {
                <div class="typing"><i></i><i></i><i></i></div>
              }
              @for (a of m.actions; track $index) {
                <button type="button" class="action" [class.tour]="a.kind === 'tour'" (click)="run(a)">
                  <compass-icon [name]="a.kind === 'tour' ? 'directions' : 'open'" />
                  {{ a.label }}
                </button>
              }
            </div>
          }
        </div>

        <form class="composer" (ngSubmit)="submit()">
          <input name="q" [(ngModel)]="draft" placeholder="Nhập câu hỏi, ví dụ: bán trái phiếu ở đâu?" autocomplete="off" [disabled]="chat.busy()" />
          <button type="submit" [disabled]="chat.busy() || !draft().trim()" aria-label="Gửi">
            <compass-icon name="send" />
          </button>
        </form>
      </section>
    }

    @if (tours.message()) {
      <div class="toast" role="status">{{ tours.message() }}</div>
    }

    <button class="bubble-btn" type="button" (click)="chat.toggle()" [attr.aria-label]="chat.open() ? 'Đóng trợ lý' : 'Mở trợ lý'">
      <compass-icon [name]="chat.open() ? 'down' : 'chat'" />
    </button>
  `,
  styles: `
    /* Mặc định bám cửa sổ trình duyệt. Muốn nằm trong một khung (VD khung điện thoại) thì đặt
       --compass-position: absolute ở phần tử cha có position: relative, và chỉnh --compass-right/--compass-bottom. */
    :host {
      position: var(--compass-position, fixed);
      right: var(--compass-right, 16px);
      bottom: var(--compass-bottom, 76px);
      z-index: 9000;
      font-family: Roboto, sans-serif;
    }
    .bubble-btn {
      font-size: 28px; width: 56px; height: 56px; border-radius: 50%; border: 0; background: #ff3747; color: #fff;
      display: grid; place-items: center; box-shadow: 0 4px 14px rgba(0,0,0,.5); margin-left: auto;
    }
    .panel {
      position: absolute; right: 0; bottom: 68px; width: 372px; max-width: calc(100vw - 32px);
      height: min(560px, calc(100vh - 170px)); display: flex; flex-direction: column;
      background: #202020; color: #f5f5f5; border-radius: 12px; overflow: hidden;
      box-shadow: 0 12px 40px rgba(0,0,0,.65); border: 1px solid #3a3a3a;
    }
    header { display: flex; align-items: center; gap: 8px; padding: 10px 10px 10px 12px; background: #2e2e2e; }
    .avatar { width: 34px; height: 34px; border-radius: 50%; background: #ff3747; display: grid; place-items: center; }
    .avatar { font-size: 20px; }
    .titles { flex: 1; display: flex; flex-direction: column; line-height: 1.25; }
    .titles strong { font-size: 14px; font-weight: 500; }
    .titles small { color: #bebebe; font-size: 11.5px; }
    .icon { background: transparent; border: 0; color: #bebebe; border-radius: 50%; width: 32px; height: 32px; display: grid; place-items: center; }
    .icon:hover { background: #3d3d3d; color: #fff; }
    

    .messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
    .welcome { color: #bebebe; font-size: 13.5px; p { margin: 0 0 8px; } display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
    .chip {
      background: #2e2e2e; color: #f5f5f5; border: 1px solid #434343; border-radius: 16px;
      padding: 6px 12px; font-size: 13px; text-align: left;
    }
    .chip:hover { background: #3d3d3d; }
    .legal { margin-top: 8px; font-size: 11.5px; color: #8d8d8d; line-height: 1.4; }

    .bubble { max-width: 88%; align-self: flex-start; background: #2e2e2e; border-radius: 12px 12px 12px 3px; padding: 9px 12px; font-size: 13.5px; line-height: 1.5; display: flex; flex-direction: column; gap: 8px; }
    .bubble.user { align-self: flex-end; background: #ff3747; color: #fff; border-radius: 12px 12px 3px 12px; }
    .bubble.refusal { border-left: 3px solid #fbac20; }
    .bubble.error { border-left: 3px solid #ff3747; color: #ffb4ba; }
    .text :first-child { margin-top: 0; }

    .action {
      display: inline-flex; align-items: center; gap: 6px; align-self: flex-start;
      background: #3d3d3d; color: #f5f5f5; border: 0; border-radius: 6px; padding: 7px 12px; font-size: 13px; font-weight: 500;
    }
    .action compass-icon { font-size: 18px; }
    .action.tour { background: #ff3747; color: #fff; }
    .action:hover { filter: brightness(1.12); }

    .typing { display: flex; gap: 4px; padding: 4px 0; }
    .typing i { width: 6px; height: 6px; border-radius: 50%; background: #9a9a9a; animation: blink 1.2s infinite; }
    .typing i:nth-child(2) { animation-delay: .2s; } .typing i:nth-child(3) { animation-delay: .4s; }
    @keyframes blink { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }

    .composer { display: flex; gap: 8px; padding: 10px; background: #2e2e2e; }
    .composer input { flex: 1; border: 0; outline: 0; border-radius: 18px; background: #3d3d3d; color: #f5f5f5; padding: 0 14px; height: 36px; font-size: 13.5px; font-family: inherit; }
    .composer button { width: 36px; height: 36px; border-radius: 50%; border: 0; background: #ff3747; color: #fff; display: grid; place-items: center; }
    .composer button:disabled { opacity: .45; }
    .composer compass-icon { font-size: 18px; }

    .toast { position: absolute; right: 0; bottom: 68px; width: 300px; background: #3a2024; color: #ffd0d4; border-radius: 8px; padding: 10px 12px; font-size: 13px; box-shadow: 0 6px 20px rgba(0,0,0,.5); }
  `,
})
export class ChatWidgetComponent {
  protected readonly chat = inject(ChatService);
  protected readonly tours = inject(TourService);
  protected readonly config = inject(COMPASS_CONFIG);

  protected readonly draft = signal('');
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  constructor() {
    // Tự cuộn xuống cuối khi có tin nhắn hoặc chữ mới
    effect(() => {
      this.chat.messages();
      queueMicrotask(() => {
        const el = this.scroller()?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      });
    });
  }

  protected render(text: string): string {
    return renderLiteMarkdown(text);
  }

  protected submit(): void {
    const text = this.draft();
    this.draft.set('');
    void this.chat.send(text);
  }

  protected ask(text: string): void {
    void this.chat.send(text);
  }

  protected run(action: ChatAction): void {
    void this.chat.runAction(action);
  }
}
