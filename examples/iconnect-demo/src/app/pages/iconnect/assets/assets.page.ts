import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TourIdDirective } from '@wealthcompass/angular';
import { BOND_HOLDINGS, BondHolding } from '../../../data/bonds';

@Component({
  selector: 'app-assets-page',
  imports: [TourIdDirective],
  templateUrl: './assets.page.html',
  styleUrl: './assets.page.scss',
})
export class AssetsPage {
  private readonly router = inject(Router);
  protected readonly holdings = BOND_HOLDINGS;
  protected readonly selectingSell = signal(false);
  protected readonly expanded = signal(false);
  // Lệnh bán thật nằm ngoài phạm vi demo: chỉ hiện hộp thoại giải thích
  protected readonly ticket = signal<BondHolding | null>(null);

  protected close(): void {
    void this.router.navigateByUrl('/home');
  }
}
