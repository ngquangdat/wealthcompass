import { Injectable, signal } from '@angular/core';

// Danh sách tourId đang có trong DOM; gửi kèm mỗi câu hỏi để agent biết màn hình có gì
@Injectable({ providedIn: 'root' })
export class TourRegistryService {
  private readonly counts = new Map<string, number>();
  readonly ids = signal<string[]>([]);

  register(id: string): void {
    this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
    this.publish();
  }

  unregister(id: string): void {
    const next = (this.counts.get(id) ?? 1) - 1;
    if (next <= 0) this.counts.delete(id);
    else this.counts.set(id, next);
    this.publish();
  }

  private publish(): void {
    this.ids.set([...this.counts.keys()].sort());
  }
}
