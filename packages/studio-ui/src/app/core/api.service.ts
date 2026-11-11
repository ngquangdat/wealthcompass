import { Injectable } from '@angular/core';

// Gọi API của Studio (cùng máy, cùng origin). Không dùng token: máy chủ Studio chỉ nhận yêu cầu từ chính giao diện này.
@Injectable({ providedIn: 'root' })
export class ApiService {
  private headers(json = true): HeadersInit {
    return json ? { 'Content-Type': 'application/json' } : {};
  }

  private async handle<T>(res: Response): Promise<T> {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body as { error?: string }).error ?? `Lỗi ${res.status}`);
    return body as T;
  }

  get<T>(path: string): Promise<T> {
    return fetch(path, { headers: this.headers(false) }).then((r) => this.handle<T>(r));
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return fetch(path, { method: 'PUT', headers: this.headers(), body: JSON.stringify(body) }).then((r) => this.handle<T>(r));
  }

  post<T>(path: string, body: unknown = {}): Promise<T> {
    return fetch(path, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) }).then((r) => this.handle<T>(r));
  }

  delete<T>(path: string): Promise<T> {
    return fetch(path, { method: 'DELETE', headers: this.headers(false) }).then((r) => this.handle<T>(r));
  }

  // Việc chạy lâu: nhận log theo thời gian thực, trả kết quả cuối
  async stream<T>(path: string, body: unknown, onLog: (line: string) => void): Promise<T> {
    const res = await fetch(path, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
    if (!res.ok || !res.body) return this.handle<T>(res);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: T | undefined;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let i: number;
      while ((i = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, i).replace(/^data: /, '');
        buffer = buffer.slice(i + 2);
        const event = JSON.parse(chunk) as { type: string; message?: string; result?: T };
        if (event.type === 'log') onLog(event.message ?? '');
        else if (event.type === 'error') throw new Error(event.message);
        else if (event.type === 'result') result = event.result;
      }
    }
    return result as T;
  }

  // Luồng SSE nguyên bản (chat của trợ lý): gọi onEvent cho từng sự kiện; signal để hủy
  async sse(path: string, body: unknown, onEvent: (event: Record<string, unknown>) => void, signal?: AbortSignal): Promise<void> {
    const res = await fetch(path, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal });
    if (!res.ok || !res.body) return void (await this.handle(res));
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let i: number;
      while ((i = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, i).replace(/^data: /, '');
        buffer = buffer.slice(i + 2);
        if (chunk.trim()) onEvent(JSON.parse(chunk));
      }
    }
  }

  // Theo dõi log tiến trình (backend/web); trả hàm hủy
  follow(path: string, onLine: (line: string) => void): () => void {
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(path, { headers: this.headers(false), signal: ctrl.signal });
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let i: number;
          while ((i = buffer.indexOf('\n\n')) !== -1) {
            onLine(JSON.parse(buffer.slice(0, i).replace(/^data: /, '')));
            buffer = buffer.slice(i + 2);
          }
        }
      } catch {
        // hủy theo dõi hoặc mất kết nối: bỏ qua
      }
    })();
    return () => ctrl.abort();
  }
}
