import { Component, signal } from '@angular/core';

@Component({
  selector: 'hr-approvals',
  template: `
    <section class="page">
      <h2>Phê duyệt đơn nghỉ của nhóm</h2>
      @for (r of pending(); track r.id) {
        <div class="row">
          <span>{{ r.who }}: {{ r.days }}</span>
          <button class="approve" (click)="decide(r.id)">Duyệt</button>
          <button class="reject" (click)="decide(r.id)">Từ chối</button>
        </div>
      } @empty {
        <p>Không còn đơn nào chờ duyệt.</p>
      }
    </section>
  `,
  styles: `.page { padding: 24px; } .row { background: #fff; padding: 10px; border-radius: 6px; display: flex; gap: 10px; align-items: center; margin: 6px 0; max-width: 520px; } .row span { flex: 1; }`,
})
export class ApprovalsPage {
  protected readonly pending = signal([
    { id: 1, who: 'Trần Văn C', days: '20/10 - 21/10' },
    { id: 2, who: 'Lê Thị D', days: '25/10' },
  ]);
  protected decide(id: number): void {
    this.pending.update((l) => l.filter((r) => r.id !== id));
  }
}
