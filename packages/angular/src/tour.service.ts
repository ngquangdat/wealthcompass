import { Injectable, inject, signal } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router } from '@angular/router';
import { driver, type Driver } from 'driver.js';
import type { Tour, ToolResultStatus } from '@wealthcompass/contracts';
import {
  currentLayout,
  describeLocator,
  isBlockedRoute,
  isUserOnly,
  isVisible,
  lockHover,
  renderLiteMarkdown,
  resolveStep,
  resumeStep,
  routeMatches,
  shouldSkipStep,
  simulateHover,
  stepsForLayout,
  waitForReady,
  waitForRoute,
  type HoverLock,
  type StepResolution,
} from '@wealthcompass/core';
import { COMPASS_CONFIG } from './compass.config';
import { CompassApiService } from './compass-api.service';

// Chờ phần tử của bước sẵn sàng (thành phần tải xong, đứng yên) tối đa chừng này khi đã ở đúng màn hình
const READY_TIMEOUT_MS = 10000;
// Chưa ở màn hình của bước: chờ ngắn xem phần tử có sẵn không (khung chung, menu) rồi mới tự điều hướng
const OFF_ROUTE_PEEK_MS = 800;
// Router đang chuyển trang (resolver, lazy chunk chậm): chờ tối đa chừng này
const NAVIGATION_TIMEOUT_MS = 15000;

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
  // Khóa hover đang giữ menu mở (bước hover lồng nhau: menu rồi menu con); nhả khi xong bước không-hover kế tiếp
  private hoverLocks: HoverLock[] = [];
  // Router đang chuyển trang: bước sau chờ trang mới dựng xong rồi mới tìm phần tử
  private navigating = false;

  constructor() {
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationStart) this.navigating = true;
      else if (e instanceof NavigationEnd || e instanceof NavigationCancel || e instanceof NavigationError) this.navigating = false;
    });
  }

  private async navigationSettled(timeoutMs = NAVIGATION_TIMEOUT_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.navigating && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  }

  async start(input: Tour): Promise<TourOutcome> {
    this.stop();
    const run = ++this.runId;
    // Bản của bố cục hiện tại (mobile có thể có thêm bước mở menu); thiếu thì dùng bản chính
    const layout = currentLayout(this.config.tours.mobileBreakpoint, undefined, this.config.tours.tabletBreakpoint);
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
      // Xong mục bên trong menu hover (bước không-hover): nhả khóa để menu đóng lại như bình thường
      if (tour.steps[index].advanceOn !== 'hover') this.releaseHover();
      if (result === 'cancelled') return this.finish(tour, run, 'cancelled', index);
      if (result === 'missing') return this.finish(tour, run, 'failed', index, 'target_missing');
    }
    return this.finish(tour, run, 'completed', tour.steps.length - 1);
  }

  private path(): string {
    return this.router.url.split(/[?#]/)[0];
  }

  private releaseHover(): void {
    for (const lock of this.hoverLocks.splice(0)) lock.release();
  }

  stop(): void {
    this.runId++;
    this.releaseHover();
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
      this.releaseHover();
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

    // Thứ tự chờ: router chuyển trang xong (lần bấm ở bước trước) → đúng route → phần tử SẴN SÀNG: tìm thấy chắc chắn,
    // thành phần quanh nó hết "đang tải" và đã đứng yên. Chỉ dẫn sớm hơn thì popover trỏ vào khung chưa dựng xong.
    await this.navigationSettled();
    if (step.route && index > 0 && !routeMatches(step.route, this.path())) await waitForRoute(step.route, () => this.path(), 3000);
    await this.navigationSettled();
    if (run !== this.runId) return 'cancelled';

    const ready = { busySelector: this.config.tours.busySelector, stableMs: 150 };
    // Route có tham số (/orders/:id) không điều hướng được: chờ người dùng tự mở
    const canNavigate = Boolean(step.route && !step.route.includes(':') && !routeMatches(step.route, this.path()));
    let found: StepResolution | null = await waitForReady(step, { ...ready, timeoutMs: canNavigate ? OFF_ROUTE_PEEK_MS : READY_TIMEOUT_MS });
    if (!found?.confident && canNavigate) {
      if (run !== this.runId) return 'cancelled';
      const ok = await this.router.navigateByUrl(step.route!);
      if (!ok) return 'missing';
      await this.navigationSettled();
      found = await waitForReady(step, { ...ready, timeoutMs: READY_TIMEOUT_MS });
    }
    if (run !== this.runId) return 'cancelled';
    if (!found) return 'missing';
    // Chỉ báo bước tìm bằng locator: để biết tour nào đang dựa vào manh mối yếu trước khi nó hỏng hẳn
    if (found.matchedBy.startsWith('locator')) this.api.report({ event: 'tour_step', tourId: tour.id, stepKey: step.key ?? String(index), matchedBy: found.matchedBy, score: found.score, status: found.confident ? 'ok' : 'low_confidence' });
    // Không chắc phần tử nào: hiện bước dạng popover giữa màn hình, KHÔNG tô sáng phần tử có thể sai
    if (!found.confident) return this.showUnanchored(tour, index, run);

    const element = found.element;
    // Phần tử nằm trong menu đang được giữ mở: giữ luôn nó (và menu con chứa nó)
    for (const lock of this.hoverLocks) lock.hold(element);
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
      // Bước hover: chờ người dùng di chuột vào nút mở menu, rồi khóa hover để menu không đóng khi tour sang mục bên trong
      const waitsForHover = step.advanceOn === 'hover' && !sensitive;
      const next = tour.steps[index + 1];
      let opening = false;
      const openMenu = async (simulate: boolean) => {
        if (opening || settled) return;
        opening = true;
        if (simulate) simulateHover(element);
        const lock = lockHover(element);
        this.hoverLocks.push(lock);
        // Chờ mục của bước sau hiện ra trong menu (hết hiệu ứng mở) rồi giữ nó; không thấy thì vẫn đi tiếp (bước sau tự báo)
        const inside = next ? await waitForReady(next, { timeoutMs: 3000, stableMs: 100, busySelector: this.config.tours.busySelector }) : null;
        if (inside?.confident) lock.hold(inside.element);
        settle('next');
      };
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
          description:
            renderLiteMarkdown(step.text) +
            (waitsForClick ? '<br><small>Bấm vào phần được tô sáng để tiếp tục.</small>' : waitsForHover ? '<br><small>Di chuột vào phần được tô sáng để mở menu.</small>' : ''),
          side: 'top',
          align: 'center',
          showButtons: waitsForClick ? ['close'] : ['next', 'close'],
          nextBtnText: isLast ? 'Xong' : 'Tiếp',
          // Bước hover: "Tiếp" mở menu thay người dùng (màn hình cảm ứng không có hover); chỉ là sự kiện hover, không click
          onNextClick: () => (waitsForHover ? void openMenu(true) : settle('next')),
          onCloseClick: () => settle('cancelled'),
        },
      });

      // Nghe ở pha capture trên document: app chặn lan truyền (stopPropagation) hay lớp trong suốt phủ lên phần tử
      // (lần bấm/di chuột rơi vào lớp phủ, không vào phần tử) vẫn nhận ra người dùng đã thao tác đúng chỗ
      const onTarget = (e: Event): boolean => {
        const t = e.target;
        if (t instanceof Element && t.closest('.driver-popover, .compass-popover')) return false;
        if (t instanceof Node && element.contains(t)) return true;
        const m = e as MouseEvent;
        if (typeof m.clientX !== 'number' || !element.isConnected) return false;
        const r = element.getBoundingClientRect();
        return m.clientX >= r.left && m.clientX <= r.right && m.clientY >= r.top && m.clientY <= r.bottom;
      };
      const detach: Array<() => void> = [];
      const listen = (type: string, handler: (e: Event) => void) => {
        document.addEventListener(type, handler, true);
        detach.push(() => document.removeEventListener(type, handler, true));
      };
      this.detachClick = () => detach.splice(0).forEach((d) => d());

      if (waitsForHover) {
        const onMove = (e: Event) => onTarget(e) && void openMenu(false);
        listen('mouseover', onMove);
        listen('mousemove', onMove);
        // Chuột đã ở sẵn trên phần tử (vừa bấm bước trước ngay tại đó): không có sự kiện chuột mới
        if (element.matches(':hover')) void openMenu(false);
      }
      if (waitsForClick) {
        // Sang bước sau ngay sau khi app nhận lần bấm (bước sau tự chờ trang/thành phần mới sẵn sàng)
        listen('click', (e) => onTarget(e) && setTimeout(() => settle('next'), 30));
        // Component xử lý ở pointerdown rồi gỡ phần tử (click không bao giờ tới): phần tử biến mất sau lần nhấn là đã bấm
        listen('pointerdown', (e) => {
          if (!onTarget(e)) return;
          setTimeout(() => !settled && (!element.isConnected || !isVisible(element)) && settle('next'), 400);
        });
      }
    });
  }
}
