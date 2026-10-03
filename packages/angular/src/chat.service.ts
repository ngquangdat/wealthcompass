import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { ChatEvent } from '@wealthcompass/contracts';
import { CompassApiService } from './compass-api.service';
import { CompassContextService } from './context.service';
import { TourService } from './tour.service';

export interface ChatAction {
  kind: 'tour' | 'navigate';
  label: string;
  tourId?: string;
  route?: string;
}

export interface ChatBubble {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  actions: ChatAction[];
  tone?: 'normal' | 'refusal' | 'error';
  streaming?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly api = inject(CompassApiService);
  private readonly context = inject(CompassContextService);
  private readonly router = inject(Router);
  private readonly tours = inject(TourService);

  readonly open = signal(false);
  readonly busy = signal(false);
  readonly messages = signal<ChatBubble[]>([]);

  private nextId = 1;
  private abort: AbortController | null = null;

  toggle(): void {
    this.open.update((v) => !v);
  }

  clear(): void {
    this.abort?.abort();
    this.messages.set([]);
    this.busy.set(false);
  }

  async send(text: string): Promise<void> {
    const message = text.trim();
    if (!message || this.busy()) return;

    const history = this.messages()
      .filter((m) => m.text && m.tone !== 'error')
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.text }));

    this.push({ role: 'user', text: message, actions: [] });
    const reply = this.push({ role: 'assistant', text: '', actions: [], streaming: true });
    this.busy.set(true);
    this.abort = new AbortController();

    try {
      for await (const event of this.api.chat({ message, history, context: this.context.build() }, this.abort.signal)) {
        this.apply(reply, event);
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        this.update(reply, (b) => ({ ...b, text: b.text || 'Không kết nối được trợ lý. Kiểm tra backend rồi thử lại.', tone: 'error' }));
      }
    } finally {
      this.update(reply, (b) => ({ ...b, streaming: false }));
      this.busy.set(false);
    }
  }

  // Người dùng bấm nút "Dẫn tôi đi": lúc này tour mới bắt đầu
  async runAction(action: ChatAction): Promise<void> {
    if (action.kind === 'navigate' && action.route) {
      const ok = await this.router.navigateByUrl(action.route);
      if (ok) this.open.set(false); // thu khung chat để người dùng thấy màn hình vừa mở
      else this.push({ role: 'assistant', text: 'Không mở được màn hình này, có thể tài khoản chưa có quyền truy cập.', actions: [], tone: 'error' });
      return;
    }
    if (action.kind === 'tour' && action.tourId) {
      try {
        const tour = await this.api.getTour(action.tourId);
        this.open.set(false); // thu khung chat để không che phần được highlight
        await this.tours.start(tour);
      } catch (e) {
        this.push({ role: 'assistant', text: (e as Error).message, actions: [], tone: 'error' });
      }
    }
  }

  private apply(target: ChatBubble, event: ChatEvent): void {
    switch (event.type) {
      case 'text':
        this.update(target, (b) => ({ ...b, text: b.text + event.delta }));
        break;
      case 'offer_tour':
        this.update(target, (b) => ({ ...b, actions: [...b.actions, { kind: 'tour', tourId: event.tourId, label: event.label }] }));
        break;
      case 'offer_navigate':
        this.update(target, (b) => ({ ...b, actions: [...b.actions, { kind: 'navigate', route: event.route, label: event.label }] }));
        break;
      case 'refusal':
      case 'handoff':
        this.update(target, (b) => ({ ...b, text: event.message, tone: event.type === 'refusal' ? 'refusal' : 'normal' }));
        break;
      case 'error':
        this.update(target, (b) => ({ ...b, text: event.message, tone: 'error' }));
        break;
      case 'done':
        break;
    }
  }

  private push(partial: Omit<ChatBubble, 'id'>): ChatBubble {
    const bubble: ChatBubble = { id: this.nextId++, ...partial };
    this.messages.update((list) => [...list, bubble]);
    return bubble;
  }

  private update(target: ChatBubble, fn: (b: ChatBubble) => ChatBubble): void {
    this.messages.update((list) => list.map((b) => (b.id === target.id ? fn(b) : b)));
  }
}
