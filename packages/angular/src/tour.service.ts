import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { driver, type Driver } from 'driver.js';
import type { Tour, ToolResultStatus } from '@wealthcompass/contracts';
import {
  currentLayout,
  describeLocator,
  isBlockedRoute,
  isUserOnly,
  renderLiteMarkdown,
  resolveStep,
  resumeStep,
  routeMatches,
  shouldSkipStep,
  stepsForLayout,
  waitForIdle,
  waitForRoute,
  waitForStep,
  type StepResolution,
} from '@wealthcompass/core';
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

  async start(input: Tour): Promise<TourOutcome> {
    this.stop();
    const run = ++this.runId;
    // Bản của bố cục hiện tại (mobile có thể có thêm bước mở menu); thiếu thì dùng bản chính
    const layout = currentLayout(this.config.tours.mobileBreakpoint);
    const tour: Tour = { ...input, steps: stepsForLayout(input, layout) };
    this.active.set(tour);
    this.message.set('');
    this.api.report({ event: 'tour_start', tourId: tour.id });

    if (isBlockedRoute(tour.startRoute, this.config.safety)) {
      return this.finish(tour, run, 'failed', 0, 'route_denied');
    }
    // Đang ở giữa luồng (vd. đã ở màn hình đích): bắt đầu từ bước của màn hình này, khi phần tử của bước đó đang hiện
    const path = this.router.url.split(/[?#]/)[0];
    let from = resumeStep(tour, path);
    // Bước mở chỗ chứa đã không còn cần (bước sau đang hiện) cũng tính là đang ở đúng chỗ
    if (from > 0 && !resolveStep(tour.steps[from])?.confident && !shouldSkipStep(tour.steps, from)) from = 0;
    // Phần tử của bước đầu đã có trên màn hình hiện tại (vd. mục menu ở khung chung): bắt đầu tại chỗ, không chuyển trang
    if (from === 0 && path !== tour.startRoute && !resolveStep(tour.steps[0])?.confident) {
      const ok = await this.router.navigateByUrl(tour.startRoute);
      // Guard chặn điều hướng (thiếu quyền, hết phiên) thì dừng và báo rõ
      if (!ok) return this.finish(tour, run, 'failed', 0, 'route_denied');
    }

    for (let index = from; index < tour.steps.length; index++) {
      if (run !== this.runId) return { tourId: tour.id, status: 'cancelled', lastStep: index };
      // Bước chỉ để mở chỗ chứa bước sau (nút menu trên mobile): bước sau đã hiện thì bỏ qua
      if (shouldSkipStep(tour.steps, index)) {
        this.api.report({ event: 'tour_step', tourId: tour.id, stepKey: tour.steps[index].key ?? String(index), status: 'skipped' });
        continue;
      }
      const result = await this.runStep(tour, index, run);
      if (result === 'cancelled') return this.finish(tour, run, 'cancelled', index);
      if (result === 'missing') return this.finish(tour, run, 'failed', index, 'target_missing');
    }
    return this.finish(tour, run, 'completed', tour.steps.length - 1);
  }

  private path(): string {
    return this.router.url.split(/[?#]/)[0];
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

  // Bước không chắc phần tử: popover không gắn phần tử, nói rõ cần tìm gì, người dùng bấm "Tiếp" để đi tiếp
  private async showUnanchored(tour: Tour, index: number, run: number): Promise<'next' | 'cancelled'> {
    const step = tour.steps[index];
    const isLast = index === tour.steps.length - 1;
    const hint = step.locator ? describeLocator(step.locator).split(' · ')[0] : step.label ?? '';
    // Ảnh chụp phần tử lúc tour:verify chạy được: cho người dùng thấy cần tìm gì trên màn hình
    const shot = step.shot ? await this.api.shotUrl(step.shot) : null;
    if (run !== this.runId) {
      if (shot) URL.revokeObjectURL(shot);
      return 'cancelled';
    }
    return new Promise((resolve) => {
      let settled = false;
      const settle = (value: 'next' | 'cancelled') => {
        if (settled) return;
        settled = true;
        this.teardown();
        if (shot) URL.revokeObjectURL(shot);
        resolve(run === this.runId ? value : 'cancelled');
      };
      this.current = driver({
        popoverClass: 'compass-popover',
        overlayColor: '#000',
        overlayOpacity: 0.5,
        allowClose: true,
        onDestroyStarted: () => settle('cancelled'),
      });
      this.current.highlight({
        popover: {
          title: step.label ?? `Bước ${index + 1}/${tour.steps.length}`,
          description:
            renderLiteMarkdown(step.text) +
            (hint ? `<br><small>Tìm trên màn hình: ${renderLiteMarkdown(hint)}</small>` : '') +
            (shot ? `<br><img class="compass-shot" src="${shot}" alt="" style="display:block;max-width:100%;max-height:120px;margin-top:8px;border-radius:4px;border:1px solid #ddd">` : ''),
          showButtons: ['next', 'close'],
          nextBtnText: isLast ? 'Xong' : 'Tiếp',
          onNextClick: () => settle('next'),
          onCloseClick: () => settle('cancelled'),
        },
      });
    });
  }

  // Trả về 'next' khi sang bước sau, 'cancelled' khi người dùng đóng, 'missing' khi không thấy phần tử
  private async runStep(tour: Tour, index: number, run: number): Promise<'next' | 'cancelled' | 'missing'> {
    const step = tour.steps[index];
    const isLast = index === tour.steps.length - 1;

    // Thứ tự chờ: route (lần bấm ở bước trước đổi màn hình bất đồng bộ) → hết spinner → phần tử
    if (step.route && index > 0 && !routeMatches(step.route, this.path())) await waitForRoute(step.route, () => this.path());
    await waitForIdle(this.config.tours.busySelector);
    if (run !== this.runId) return 'cancelled';

    let found: StepResolution | null = await waitForStep(step, step.route ? 600 : 4000);
    // Route có tham số (/orders/:id) không điều hướng được: chỉ chờ người dùng tự mở
    const canNavigate = step.route && !step.route.includes(':') && this.path() !== step.route;
    if (!found?.confident && canNavigate) {
      const ok = await this.router.navigateByUrl(step.route!);
      if (!ok) return 'missing';
      await waitForIdle(this.config.tours.busySelector);
      found = await waitForStep(step, 4000);
    }
    if (run !== this.runId) return 'cancelled';
    if (!found) return 'missing';
    // Chỉ báo bước tìm bằng locator: để biết tour nào đang dựa vào manh mối yếu trước khi nó hỏng hẳn
    if (found.matchedBy.startsWith('locator')) this.api.report({ event: 'tour_step', tourId: tour.id, stepKey: step.key ?? String(index), matchedBy: found.matchedBy, score: found.score, status: found.confident ? 'ok' : 'low_confidence' });
    // Không chắc phần tử nào: hiện bước dạng popover giữa màn hình, KHÔNG tô sáng phần tử có thể sai
    if (!found.confident) return this.showUnanchored(tour, index, run);

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
