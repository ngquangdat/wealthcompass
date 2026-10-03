import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NAV_ITEMS } from '../shared/menu.config';

@Component({
  selector: 'app-menu-page',
  imports: [RouterLink],
  template: `
    <header class="page-header">
      <button class="back" type="button" (click)="back()" aria-label="Quay lại"><span class="material-icons">arrow_back</span></button>
      <span class="title">Menu</span>
    </header>
    <div class="list">
      @for (group of items; track group.label) {
        <div class="group">
          @if (group.route) {
            <a [routerLink]="group.route" class="g-title"><span class="material-icons">{{ group.icon }}</span>{{ group.label }}</a>
          } @else {
            <div class="g-title"><span class="material-icons">{{ group.icon }}</span>{{ group.label }}</div>
          }
          @for (child of group.children ?? []; track child.label) {
            <a [routerLink]="child.route" class="child">{{ child.label }}</a>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; flex: 1; min-height: 0; background: var(--bg); }
    .back { background: transparent; border: 0; color: var(--text); display: grid; padding: 0; }
    .list { overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
    .group { background: var(--card); border-radius: 8px; padding: 6px 16px 8px; }
    .g-title { display: flex; align-items: center; gap: 10px; padding: 10px 0; font-weight: 500; .material-icons { color: var(--text-2); } }
    .child { display: block; padding: 10px 0 10px 34px; color: var(--text-2); font-size: 14px; border-top: 1px solid #292929; }
  `,
})
export class MenuPage {
  private readonly router = inject(Router);
  protected readonly items = NAV_ITEMS;

  protected back(): void {
    void this.router.navigateByUrl('/home');
  }
}
