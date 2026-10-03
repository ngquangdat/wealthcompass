import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { BOND_QUOTES } from '../../../data/bonds';

@Component({
  selector: 'app-price-board-page',
  templateUrl: './price-board.page.html',
  styleUrl: './price-board.page.scss',
})
export class PriceBoardPage {
  private readonly router = inject(Router);
  protected readonly quotes = BOND_QUOTES;
  protected readonly showLegend = signal(true);

  protected close(): void {
    void this.router.navigateByUrl('/home');
  }
}
