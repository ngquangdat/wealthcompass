import { ChangeDetectionStrategy, Component, ElementRef, input, model, viewChild } from '@angular/core';
import { IconComponent } from './icon.component';

// Ô nhập dạng thẻ: Enter hoặc dấu phẩy để thêm, x để bỏ
@Component({
  selector: 'ui-chips',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chips-input">
      @for (v of value(); track $index) {
        <span class="chip">{{ v }} @if (!readonly()) { <button type="button" (click)="remove($index)" aria-label="Bỏ"><ui-icon name="x" [size]="11" /></button> }</span>
      }
      @if (!readonly()) { <input #box (input)="onInput()" (keydown)="onKey($event)" (blur)="add()" [placeholder]="placeholder()" /> }
    </div>
  `,
  styles: `
    .chips-input { display: flex; flex-wrap: wrap; gap: 6px; padding: 5px 6px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); min-height: 36px; background: #fff; }
    .chips-input input { border: 0; outline: 0; flex: 1; min-width: 100px; font: 13.5px Inter, sans-serif; }
    .chip button { border: 0; background: none; padding: 0; cursor: pointer; color: var(--text-3); display: inline-flex; }
  `,
})
export class ChipsInputComponent {
  readonly value = model<string[]>([]);
  readonly placeholder = input('Gõ rồi Enter');
  readonly readonly = input(false);
  private readonly box = viewChild<ElementRef<HTMLInputElement>>('box');

  // Có dấu phẩy (gõ, dán, bộ gõ tiếng Việt không phát keydown) thì tách thành thẻ, phần sau dấu phẩy cuối giữ lại để gõ tiếp
  protected onInput(): void {
    const el = this.box()?.nativeElement;
    if (!el) return;
    const cut = el.value.lastIndexOf(',');
    if (cut === -1) return;
    const rest = el.value.slice(cut + 1);
    this.addParts(el.value.slice(0, cut));
    el.value = rest;
  }

  // Enter để thêm thẻ
  protected onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.add();
    } else if (e.key === 'Backspace') {
      this.removeLast();
    }
  }

  protected add(): void {
    const el = this.box()?.nativeElement;
    if (!el) return;
    this.addParts(el.value);
    el.value = '';
  }

  private addParts(text: string): void {
    const next = [...this.value()];
    for (const p of text.split(',').map((x) => x.trim()).filter(Boolean)) if (!next.includes(p)) next.push(p);
    if (next.length !== this.value().length) this.value.set(next);
  }

  // Backspace ở ô trống: bỏ thẻ cuối
  protected removeLast(): void {
    if (!this.box()?.nativeElement.value && this.value().length) this.value.set(this.value().slice(0, -1));
  }

  protected remove(i: number): void {
    this.value.set(this.value().filter((_, idx) => idx !== i));
  }
}
