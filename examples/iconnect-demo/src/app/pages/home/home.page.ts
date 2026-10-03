import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TourIdDirective } from '@wealthcompass/angular';
import { AuthService } from '../../core/auth.service';

interface Slice { label: string; value: string; color: string; percent: number; change?: string }

@Component({
  selector: 'app-home-page',
  imports: [RouterLink, RouterLinkActive, TourIdDirective],
  templateUrl: './home.page.html',
  styleUrl: './home.page.scss',
})
export class HomePage {
  protected readonly auth = inject(AuthService);
  protected readonly hideMoney = signal(true);
  protected readonly bannerDot = signal(0);

  // Số liệu mô phỏng
  protected readonly slices: Slice[] = [
    { label: 'Tiền', value: '0.0 tr', color: '#c06dd9', percent: 0 },
    { label: 'Cổ phiếu', value: '0.0 tr', color: '#e5b73b', percent: 0 },
    { label: 'Trái phiếu', value: '1.6 tr', color: '#8fd1c8', percent: 89.3 },
    { label: 'Quỹ', value: '0.0 tr', color: '#d8c64a', percent: 0 },
    { label: 'TCWealth', value: '0.2 tr', color: '#6f58c9', percent: 10.7, change: '2.3%' },
  ];

  protected readonly donut = computed(() => {
    const radius = 70;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    return this.slices
      .filter((s) => s.percent > 0)
      .map((s) => {
        const length = (s.percent / 100) * circumference;
        const arc = { color: s.color, dash: `${length} ${circumference - length}`, offset: -offset, radius };
        offset += length;
        return arc;
      });
  });

}
