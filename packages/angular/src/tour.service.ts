import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { driver, type Driver } from 'driver.js';
import type { Tour, ToolResultStatus } from '@wealthcompass/contracts';
import { isBlockedRoute, isUserOnly, renderLiteMarkdown, waitForTarget } from '@wealthcompass/core';
import { COMPASS_CONFIG } from './compass.config';
import { CompassApiService } from './compass-api.service';

export interface TourOutcome {
  tourId: string;
  status: 'completed' | 'cancelled' | 'failed';
  lastStep: number;
  reason?: ToolResultStatus;
}

// TourService: dẫn đường từng bước. Engine CHỈ highlight và chờ người dùng tự bấm.
// Không có đường code nào click/điền/gửi form; bước trỏ vào phần tử user-only chỉ được highlight.
@Injectable({ providedIn: 'root' })
export class TourService {
  private readonly router = inject(Router);
  private readonly config = inject(COMPASS_CONFIG);
  private readonly api = inject(CompassApiService);

  readonly active = signal<Tour | null>(null);
  readonly message = signal<string>('');

  private current: Driver | null = null;
  private runId = 0;
  private detachClick: (() => void) | null = null;

  async start(tour: Tour): Promise<TourOutcome> {
    this.stop();
    const run = ++this.runId;
    this.active.set(tour);
    this.message.set('');
    this.api.report({ event: 'tour_start', tourId: tour.id });

    if (isBlockedRoute(tour.startRoute, this.config.safety)) {
      return this.finish(tour, run, 'failed', 0, 'route_denied');
    }
    if (this.router.url.split('?')[0] !== tour.startRoute) {
      const ok = await this.router.navigateByUrl(tour.startRoute);
      // Guard chặn điều hướng (thiếu quyền, hết phiên) thì dừng và báo rõ
      if (!ok) return this.finish(tour, run, 'failed', 0, 'route_denied');
    }

    for (let index = 0; index < tour.steps.length; index++) {
      if (run !== this.runId) return { tourId: tour.id, status: 'cancelled', lastStep: index };
      const result = await this.runStep(tour, index, run);
      if (result === 'cancelled') return this.finish(tour, run, 'cancelled', index);
      if (result === 'missing') return this.finish(tour, run, 'failed', index, 'target_missing');
    }
    return this.finish(tour, run, 'completed', tour.steps.length - 1);
  }

  stop(): void {
    this.runId++;
    this.teardown();
    this.active.set(null);
  }

  private teardown(): void {
    this.detachClick?.();
    this.detachClick = null;
    if (this.current) {
      const d = this.current;
      this.current = null;
      d.destroy();
    }
  }

  private finish(tour: Tour, run: number, status: TourOutcome['status'], lastStep: number, reason?: ToolResultStatus): TourOutcome {
    if (run === this.runId) {
      this.teardown();
      this.active.set(null);
      this.message.set(
        status === 'failed'
          ? reason === 'route_denied'
            ? 'Không mở được màn hình này, có thể tài khoản chưa có quyền truy cập.'
            : 'Không tìm thấy phần tử trên màn hình, giao diện có thể đã thay đổi.'
          : '',
      );
    }
    this.api.report({ event: 'tour_end', tourId: tour.id, status, lastStep, reason });
    return { tourId: tour.id, status, lastStep, reason };
  }

  // Trả về 'next' khi sang bước sau, 'cancelled' khi người dùng đóng, 'missing' khi không thấy phần tử
  private async runStep(tour: Tour, index: number, run: number): Promise<'next' | 'cancelled' | 'missing'> {
    const step = tour.steps[index];
    const isLast = index === tour.steps.length - 1;

    let found = await waitForTarget(step.tourId, step.route ? 600 : 4000);
    if (!found && step.route && this.router.url.split('?')[0] !== step.route) {
      const ok = await this.router.navigateByUrl(step.route);
      if (!ok) return 'missing';
      found = await waitForTarget(step.tourId, 4000);
    }
    if (run !== this.runId) return 'cancelled';
    if (!found) return 'missing';

    const element = found.element;
    // Phần tử nhạy cảm: giữ nguyên chỉ-highlight; không có nhánh nào can thiệp vào nó
    const sensitive = isUserOnly(element, this.config.safety);
    element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    return new Promise((resolve) => {
      let settled = false;
      const settle = (value: 'next' | 'cancelled') => {
        if (settled) return;
        settled = true;
        this.teardown();
        resolve(value);
      };

      const waitsForClick = step.advanceOn === 'click' && !sensitive;
      this.current = driver({
        popoverClass: 'compass-popover',
        overlayColor: '#000',
        overlayOpacity: 0.72,
        stagePadding: 5,
        stageRadius: 6,
        allowClose: true,
        smoothScroll: true,
        // Với bước chờ click, vẫn cho người dùng thao tác trực tiếp lên phần tử được highlight
        disableActiveInteraction: false,
        onDestroyStarted: () => settle('cancelled'),
      });

      this.current.highlight({
        element,
        popover: {
          title: step.label ?? `Bước ${index + 1}/${tour.steps.length}`,
          description: renderLiteMarkdown(step.text) + (waitsForClick ? '<br><small>Bấm vào phần được tô sáng để tiếp tục.</small>' : ''),
          side: 'top',
          align: 'center',
          showButtons: waitsForClick ? ['close'] : ['next', 'close'],
          nextBtnText: isLast ? 'Xong' : 'Tiếp',
          onNextClick: () => settle('next'),
          onCloseClick: () => settle('cancelled'),
        },
      });

      if (waitsForClick) {
        const onClick = () => {
          // Chờ app xử lý click (đổi route, đổi tab) rồi mới sang bước sau
          setTimeout(() => settle('next'), 120);
        };
        element.addEventListener('click', onClick, { once: true });
        this.detachClick = () => element.removeEventListener('click', onClick);
      }
    });
  }
}
