import { chromium, type Browser, type Page } from 'playwright-core';
import type { Locator } from '@wealthcompass/contracts';
import { describeLocator } from '@wealthcompass/core';
import { CAPTURE_SCRIPT } from './capture.bundle';
import { PAGE_SCRIPT } from './page-script';

// Một lần bấm của người vận hành, ghi lại từ trình duyệt
export interface RecordedStep {
  // null: phần tử người dùng bấm chưa có tourId trong template
  tourId: string | null;
  route: string;
  // click: người dùng bấm thật và app chạy tiếp. next: chỉ tô sáng, lần bấm bị chặn không cho chạy
  advanceOn: 'click' | 'next';
  userOnly: boolean;
  tag: string;
  // Chữ trên phần tử (đã cắt ngắn); chỉ dùng khi template không có tourLabel
  text: string;
  // Manh mối để tìm lại phần tử lúc chạy, không cần tourId trong HTML (null khi trang không ghi được)
  locator?: Locator | null;
  // Phần tử của lần bấm này chưa hiện ở lần bấm trước (cùng màn hình): lần bấm trước đã mở nó ra
  appeared?: boolean;
  // Bước này chỉ mở chỗ chứa bước sau (nút menu, mở rộng): chạy tour thì bỏ qua khi bước sau đã hiện
  opensNext?: boolean;
}

export interface RecorderOptions {
  // Từ khóa nút nhạy cảm (safety.userOnlyText): lần bấm khớp bị chặn và ghi thành bước chỉ-tô-sáng
  userOnlyText?: string[];
  // Dưới bề rộng này (px) coi là bố cục mobile
  mobileBreakpoint?: number;
  // Mở trình duyệt với khung nhìn điện thoại để ghi bản mobile của tour
  mobile?: boolean;
  // Gọi sau mỗi lần bấm được ghi (ghi lại riêng một bước chỉ cần lần bấm đầu tiên)
  onStep?: (step: RecordedStep) => void;
}

export interface RecorderState {
  recording: boolean;
  highlight: boolean;
  count: number;
  last: string;
  // Mô tả của người ghi: đang ghi tour cho tính năng gì
  purpose: string;
  userOnlyText: string[];
  mobileBreakpoint: number;
}

type Command = 'start' | 'stop' | 'toggleHighlight';

export class Recorder {
  readonly steps: RecordedStep[] = [];
  startRoute: string | null = null;
  // Màn hình người dùng đang đứng lúc bấm Dừng = đích của tour (bước cuối thường là bấm để chuyển màn hình,
  // nên route ghi lúc bấm là màn hình TRƯỚC khi chuyển, không phải đích)
  endRoute: string | null = null;
  // Mô tả do người ghi nhập ở khung công cụ (hoặc --about); là nguồn đáng tin nhất cho LLM soạn nội dung
  purpose = '';
  recording = false;
  // Chế độ tô sáng: lần bấm kế tiếp bị chặn và ghi thành bước chỉ-tô-sáng
  highlight = false;

  private resolveDone!: () => void;
  readonly done = new Promise<void>((resolve) => (this.resolveDone = resolve));

  constructor(
    private readonly page: Page,
    private readonly options: RecorderOptions = {},
  ) {}

  state(): RecorderState {
    const last = this.steps.at(-1);
    return {
      recording: this.recording,
      highlight: this.highlight,
      purpose: this.purpose,
      count: this.steps.length,
      last: last ? (last.tourId ?? (last.locator ? describeLocator(last.locator) : `(không nhận ra: ${last.tag})`)) : '',
      userOnlyText: this.options.userOnlyText ?? [],
      mobileBreakpoint: this.options.mobileBreakpoint ?? 768,
    };
  }

  // Đẩy trạng thái sang trang để bộ bắt click biết đang ghi hay không (trang không tự hỏi được đồng bộ)
  async pushState(): Promise<void> {
    await this.page
      .evaluate(`window.__compassRecorderSet && window.__compassRecorderSet(${JSON.stringify(this.state())})`)
      .catch(() => undefined);
  }

  async start(): Promise<void> {
    if (this.recording) return;
    this.recording = true;
    this.steps.length = 0;
    this.startRoute = new URL(this.page.url()).pathname;
    await this.pushState();
  }

  async stop(): Promise<void> {
    this.recording = false;
    this.endRoute = new URL(this.page.url()).pathname;
    await this.pushState();
    this.resolveDone();
  }

  setPurpose(text: string): void {
    this.purpose = text.slice(0, 600);
  }

  async toggleHighlight(): Promise<void> {
    this.highlight = !this.highlight;
    await this.pushState();
  }

  onEvent(step: RecordedStep): void {
    if (!this.recording) return;
    const prev = this.steps.at(-1);
    // Bấm đúp vào cùng một phần tử chỉ tính một bước
    if (prev && prev.advanceOn === step.advanceOn && prev.route === step.route) {
      if (prev.tourId !== null && prev.tourId === step.tourId) return;
      if (prev.tourId === null && step.tourId === null && prev.locator && JSON.stringify({ ...prev.locator, rect: 0 }) === JSON.stringify({ ...step.locator, rect: 0 })) return;
    }
    // Lần bấm trước (bấm thật, cùng màn hình) đã mở ra phần tử này: đánh dấu là bước có thể bỏ qua
    if (step.appeared && prev && prev.advanceOn === 'click' && prev.route === step.route) prev.opensNext = true;
    this.steps.push(step);
    this.options.onStep?.(step);
  }

  async command(cmd: Command): Promise<void> {
    if (cmd === 'start') await this.start();
    else if (cmd === 'stop') await this.stop();
    else await this.toggleHighlight();
  }

  // Cài hàm cầu nối và script chạy trong trang (thanh công cụ + bắt click)
  async attach(): Promise<void> {
    await this.page.exposeFunction('__compassRecorderEvent', (step: RecordedStep) => this.onEvent(step));
    await this.page.exposeFunction('__compassRecorderState', () => this.state());
    await this.page.exposeFunction('__compassRecorderSetPurpose', (text: string) => this.setPurpose(text));
    await this.page.exposeFunction('__compassRecorderCommand', (cmd: Command) => this.command(cmd));
    // Bộ ghi locator phải có trước script bắt click
    await this.page.addInitScript({ content: CAPTURE_SCRIPT });
    await this.page.addInitScript({ content: PAGE_SCRIPT });
    // Trang đã mở sẵn thì chạy ngay, không đợi lần tải sau
    await this.page.evaluate(CAPTURE_SCRIPT).catch(() => undefined);
    await this.page.evaluate(PAGE_SCRIPT).catch(() => undefined);
  }
}

export async function launchRecorderBrowser(): Promise<Browser> {
  // Dùng Chrome đã cài trên máy, không tải trình duyệt riêng. CHROME_PATH để chỉ định bản khác.
  const executablePath = process.env['CHROME_PATH'];
  return chromium.launch({ headless: false, ...(executablePath ? { executablePath } : { channel: 'chrome' }) });
}

export async function recordSession(startUrl: string, about = '', options: RecorderOptions = {}): Promise<{ recorder: Recorder; browser: Browser }> {
  const browser = await launchRecorderBrowser();
  // Khung nhìn điện thoại: bố cục mobile của app (menu thu gọn, thẻ thay bảng) và locator ghi layout "mobile"
  const context = await browser.newContext(
    options.mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: null },
  );
  const page = await context.newPage();
  const recorder = new Recorder(page, options);
  recorder.setPurpose(about);
  await recorder.attach();
  await page.goto(startUrl);
  return { recorder, browser };
}
