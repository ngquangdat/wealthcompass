import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  kind: 'success' | 'danger' | 'info';
  text: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly items = signal<Toast[]>([]);
  private next = 1;

  show(text: string, kind: Toast['kind'] = 'info'): void {
    const id = this.next++;
    this.items.update((l) => [...l, { id, kind, text }]);
    setTimeout(() => this.dismiss(id), kind === 'danger' ? 7000 : 3500);
  }
  success(text: string): void {
    this.show(text, 'success');
  }
  error(e: unknown): void {
    this.show(e instanceof Error ? e.message : String(e), 'danger');
  }
  dismiss(id: number): void {
    this.items.update((l) => l.filter((t) => t.id !== id));
  }
}
