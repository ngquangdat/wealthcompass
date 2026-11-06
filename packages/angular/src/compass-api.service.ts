import { Injectable, inject } from '@angular/core';
import type { ChatEvent, ChatRequest, Tour } from '@wealthcompass/contracts';
import { readChatEvents, redactPii } from '@wealthcompass/core';
import { COMPASS_CONFIG } from './compass.config';

@Injectable({ providedIn: 'root' })
export class CompassApiService {
  private readonly config = inject(COMPASS_CONFIG);

  private headers(): Record<string, string> {
    const token = this.config.getToken();
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  async *chat(request: ChatRequest, signal: AbortSignal): AsyncGenerator<ChatEvent> {
    // Lọc PII ngay ở trình duyệt, trước khi câu hỏi rời khỏi máy người dùng
    const safe: ChatRequest = {
      ...request,
      message: redactPii(request.message).text,
      history: request.history.map((m) => ({ ...m, content: redactPii(m.content).text })),
    };
    const response = await fetch(`${this.config.apiBaseUrl}/v1/chat`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(safe),
      signal,
    });
    if (!response.ok) {
      const reason = response.status === 401 ? 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại.' : `Lỗi máy chủ (${response.status})`;
      yield { type: 'error', message: reason };
      return;
    }
    yield* readChatEvents(response);
  }

  async getTour(tourId: string): Promise<Tour> {
    const response = await fetch(`${this.config.apiBaseUrl}/v1/tours/${encodeURIComponent(tourId)}`, {
      headers: this.headers(),
    });
    if (!response.ok) throw new Error(`Không tải được hướng dẫn (${response.status})`);
    return (await response.json()) as Tour;
  }

  // Ảnh chụp phần tử của bước (kho tour của backend). Cần JWT nên tải bằng fetch rồi đổi thành object URL;
  // lỗi hoặc quá lâu thì bỏ qua, popover vẫn hiện chữ
  async shotUrl(path: string, timeoutMs = 1500): Promise<string | null> {
    try {
      const response = await fetch(`${this.config.apiBaseUrl}${path}`, { headers: this.headers(), signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return null;
      return URL.createObjectURL(await response.blob());
    } catch {
      return null;
    }
  }

  // Báo kết quả bước tour về backend để đo tỷ lệ hoàn thành; lỗi mạng bỏ qua, không ảnh hưởng tour
  report(event: Record<string, unknown>): void {
    void fetch(`${this.config.apiBaseUrl}/v1/telemetry`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(event),
      keepalive: true,
    }).catch(() => undefined);
  }
}
