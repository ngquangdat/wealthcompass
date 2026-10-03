import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'hr-leave-request',
  imports: [FormsModule],
  templateUrl: './leave-request.page.html',
  styles: `
    .page { padding: 24px; max-width: 480px; }
    form { display: flex; flex-direction: column; gap: 12px; background: #fff; padding: 20px; border-radius: 8px; }
    label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
    input, select, textarea { padding: 8px; border: 1px solid #c8d0db; border-radius: 6px; }
    button { align-self: flex-start; background: #1f6feb; color: #fff; border: 0; padding: 8px 16px; border-radius: 6px; }
    .ok { color: #2e7d32; }
  `,
})
export class LeaveRequestPage {
  protected type = 'annual';
  protected from = '';
  protected to = '';
  protected reason = '';
  protected readonly sent = signal(false);

  protected send(): void {
    this.sent.set(true);
  }
}
