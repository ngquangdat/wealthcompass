import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { FilePatch } from '../core/models';
import { IconComponent } from './icon.component';

// Xem diff theo file, mỗi đoạn có ô chọn để áp hoặc bỏ
@Component({
  selector: 'ui-diff-view',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="diff">
      <div class="files">
        @for (f of files(); track f.path; let i = $index) {
          <button class="file" type="button" [class.active]="current() === i" (click)="current.set(i)">
            <span class="fcheck" [class.on]="fileState(f) === 'all'" [class.part]="fileState(f) === 'some'"></span>
            <span class="grow fname">{{ f.path }}</span>
            <span class="plus">+{{ added(f) }}</span>
            @if (removed(f)) { <span class="minus">−{{ removed(f) }}</span> }
          </button>
        }
      </div>
      @if (files()[current()]; as f) {
        <div class="hunks">
          <div class="fhead">
            <ui-icon name="diff" />
            <span class="mono grow">{{ f.path }}</span>
            <button class="btn btn-ghost btn-sm" type="button" (click)="toggleFile(f, fileState(f) !== 'all')">{{ fileState(f) === 'all' ? 'Bỏ chọn file' : 'Chọn cả file' }}</button>
          </div>
          @for (h of f.hunks; track h.id) {
            <div class="hunk" [class.off]="!selected().has(h.id)">
              <label class="hhead">
                <input type="checkbox" [checked]="selected().has(h.id)" (change)="toggle.emit(h.id)" />
                <span class="mono">{{ h.header }}</span>
              </label>
              <pre>@for (l of h.lines; track $index) {<span [class.add]="l.startsWith('+')" [class.del]="l.startsWith('-')">{{ l || ' ' }}</span>}</pre>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .diff { display: grid; grid-template-columns: 260px 1fr; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--surface); }
    .files { border-right: 1px solid var(--border); background: var(--surface-2); padding: 6px; display: flex; flex-direction: column; gap: 2px; }
    .file { display: flex; align-items: center; gap: 8px; padding: 8px; border: 0; background: none; border-radius: 6px; cursor: pointer; text-align: left; font-size: 12.5px; color: var(--text-2); }
    .file:hover { background: #eef0f3; }
    .file.active { background: var(--surface); box-shadow: var(--shadow); color: var(--text); }
    .fname { font-family: var(--mono); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
    .fcheck { width: 14px; height: 14px; border-radius: 4px; border: 1.5px solid var(--border-strong); flex: none; }
    .fcheck.on { background: var(--primary); border-color: var(--primary); }
    .fcheck.part { background: linear-gradient(var(--primary), var(--primary)) center/8px 2px no-repeat; border-color: var(--primary); }
    .plus { color: var(--success-text); font-size: 12px; } .minus { color: var(--danger-text); font-size: 12px; }
    .hunks { min-width: 0; max-height: 560px; overflow: auto; }
    .fhead { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--surface); z-index: 1; font-size: 12.5px; }
    .hunk { border-bottom: 1px solid var(--border); }
    .hunk.off pre { opacity: .4; }
    .hhead { display: flex; align-items: center; gap: 10px; padding: 6px 14px; background: #f5f8ff; color: #3e63dd; font-size: 12px; cursor: pointer; }
    pre { margin: 0; padding: 6px 0; font: 12.5px/1.55 var(--mono); overflow-x: auto; }
    pre span { display: block; padding: 0 14px; white-space: pre; }
    .add { background: #ecfdf3; color: #05603a; }
    .del { background: #fef3f2; color: #912018; }
  `,
})
export class DiffViewComponent {
  readonly files = input.required<FilePatch[]>();
  readonly selected = input.required<Set<string>>();
  readonly toggle = output<string>();
  readonly setMany = output<{ ids: string[]; on: boolean }>();
  protected readonly current = signal(0);

  protected added = (f: FilePatch) => f.hunks.reduce((s, h) => s + h.added, 0);
  protected removed = (f: FilePatch) => f.hunks.reduce((s, h) => s + h.removed, 0);
  protected fileState(f: FilePatch): 'all' | 'some' | 'none' {
    const n = f.hunks.filter((h) => this.selected().has(h.id)).length;
    return n === f.hunks.length ? 'all' : n ? 'some' : 'none';
  }
  protected toggleFile(f: FilePatch, on: boolean): void {
    this.setMany.emit({ ids: f.hunks.map((h) => h.id), on });
  }
  readonly total = computed(() => this.files().reduce((s, f) => s + f.hunks.length, 0));
}
