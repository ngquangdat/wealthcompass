import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import type { Layout, Locator } from '@wealthcompass/contracts';
import { describeLocator, isUsableLocator } from '@wealthcompass/core';
import { CAPTURE_SCRIPT } from './capture.bundle';
import { PAGE_SCRIPT } from './page-script';

// Một lần bấm của người vận hành, ghi lại từ trình duyệt
export interface RecordedStep {
  // null: phần tử người dùng bấm chưa có tourId trong template
  tourId: string | null;
  route: string;
  // click: người dùng bấm thật và app chạy tiếp. next: chỉ tô sáng, lần bấm bị chặn không cho chạy
  // hover: người ghi nhấn Alt khi đang di chuột trên nút mở menu hover, hoặc bấm "Ghi hover" rồi bấm vào nút đó
  advanceOn: 'click' | 'next' | 'hover';
  userOnly: boolean;
  tag: string;
  // Chữ trên phần tử (đã cắt ngắn); chỉ dùng khi template không có tourLabel
  text: string;
  // Manh mối để tìm lại phần tử lúc chạy, không cần tourId trong HTML (null khi trang không ghi được)
  locator?: Locator | null;
  // tourId của vùng chứa bao ngoài đã bị bỏ qua (vùng đó có nhiều phần tử bấm được, không trỏ đúng nút vừa bấm)
  skippedTourId?: string | null;
  // Phần tử của lần bấm này chưa hiện ở lần bấm trước (cùng màn hình): lần bấm trước đã mở nó ra
  appeared?: boolean;
  // Bước này chỉ mở chỗ chứa bước sau (nút menu, mở rộng): chạy tour thì bỏ qua khi bước sau đã hiện
  opensNext?: boolean;
}

export interface RecorderOptions {
  // Dưới bề rộng này (px) coi là bố cục mobile
  mobileBreakpoint?: number;
  // Từ mobileBreakpoint tới dưới bề rộng này là bố cục máy tính bảng
  tabletBreakpoint?: number;
  // Thiết bị giả lập khi mở Chrome: desktop (cửa sổ thường), tablet (khung nhìn iPad), mobile (khung nhìn điện thoại)
  device?: Layout;
  // Gọi sau mỗi lần bấm được ghi (ghi lại riêng một bước chỉ cần lần bấm đầu tiên)
  onStep?: (step: RecordedStep) => void;
}

export interface RecorderState {
  recording: boolean;
  // Tạm dừng: lần bấm chạy bình thường nhưng không ghi
  paused: boolean;
  highlight: boolean;
  // Đã bấm "Ghi hover": lần bấm kế tiếp trên trang ghi thành bước hover (lần bấm bị chặn)
  hoverArmed: boolean;
  count: number;
  last: string;
  // Cảnh báo cho bước vừa ghi: không có tourId nên tìm bằng selector; hoặc không nhận ra phần tử
  lastNote: string;
  // Số bước đã ghi không có tourId (tìm bằng selector)
  noIdCount: number;
  // Mô tả của người ghi: đang ghi tour cho tính năng gì
  purpose: string;
  mobileBreakpoint: number;
  tabletBreakpoint: number;
}

type Command = 'start' | 'stop' | 'toggleHighlight' | 'togglePause' | 'cancel' | 'armHover';

// Chờ trang tải: web nội bộ (VPN, SSO, bản dev chưa build xong) có thể chậm hơn nhiều so với 30 giây mặc định
export const NAV_TIMEOUT_MS = 300_000;

export class Recorder {
  readonly steps: RecordedStep[] = [];
  startRoute: string | null = null;
  // Màn hình người dùng đang đứng lúc bấm Dừng = đích của tour (bước cuối thường là bấm để chuyển màn hình,
  // nên route ghi lúc bấm là màn hình TRƯỚC khi chuyển, không phải đích)
  endRoute: string | null = null;
  // Mô tả do người ghi nhập ở khung công cụ (hoặc --about); là nguồn đáng tin nhất cho LLM soạn nội dung
  purpose = '';
  recording = false;
  paused = false;
  hoverArmed = false;
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
      paused: this.paused,
      highlight: this.highlight,
      hoverArmed: this.hoverArmed,
      purpose: this.purpose,
      count: this.steps.length,
      last: last ? (last.tourId ? `tourId ${last.tourId}` : last.locator ? describeLocator(last.locator) : `(không nhận ra: ${last.tag})`) : '',
      lastNote: stepNote(last),
      noIdCount: this.steps.filter((s) => !s.tourId).length,
      mobileBreakpoint: this.options.mobileBreakpoint ?? 768,
      tabletBreakpoint: this.options.tabletBreakpoint ?? 1024,
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
    this.paused = false;
    this.hoverArmed = false;
    this.endRoute = new URL(this.page.url()).pathname;
    await this.pushState();
    this.resolveDone();
  }

  // Hủy lần ghi đang làm: bỏ mọi bước, quay về màn "Bắt đầu ghi" để ghi lại từ đầu (giữ mô tả đã nhập)
  async cancel(): Promise<void> {
    this.recording = false;
    this.paused = false;
    this.highlight = false;
    this.hoverArmed = false;
    this.steps.length = 0;
    this.startRoute = null;
    this.endRoute = null;
    await this.pushState();
  }

  async togglePause(): Promise<void> {
    if (!this.recording) return;
    this.paused = !this.paused;
    this.hoverArmed = false;
    await this.pushState();
  }

  async armHover(): Promise<void> {
    if (!this.recording || this.paused) return;
    this.hoverArmed = !this.hoverArmed;
    await this.pushState();
  }

  setPurpose(text: string): void {
    this.purpose = text.slice(0, 600);
  }

  async toggleHighlight(): Promise<void> {
    this.highlight = !this.highlight;
    await this.pushState();
  }

  onEvent(step: RecordedStep): void {
    if (!this.recording || this.paused) return;
    if (step.advanceOn === 'hover') this.hoverArmed = false;
    const prev = this.steps.at(-1);
    // Bấm đúp vào cùng một phần tử chỉ tính một bước
    if (prev && prev.advanceOn === step.advanceOn && prev.route === step.route) {
      if (prev.tourId !== null && prev.tourId === step.tourId) return;
      if (prev.tourId === null && step.tourId === null && prev.locator && JSON.stringify({ ...prev.locator, rect: 0 }) === JSON.stringify({ ...step.locator, rect: 0 })) return;
    }
    // Lần bấm trước (bấm thật, cùng màn hình) đã mở ra phần tử này: đánh dấu là bước có thể bỏ qua
    if (step.appeared && prev && prev.advanceOn === 'click' && prev.route === step.route) prev.opensNext = true;
    // Bước hover chỉ để mở menu: menu đã mở sẵn (bố cục khác, menu ghim) thì bỏ qua
    if (step.advanceOn === 'hover') step.opensNext = true;
    this.steps.push(step);
    this.options.onStep?.(step);
  }

  async command(cmd: Command): Promise<void> {
    if (cmd === 'start') await this.start();
    else if (cmd === 'stop') await this.stop();
    else if (cmd === 'togglePause') await this.togglePause();
    else if (cmd === 'cancel') await this.cancel();
    else if (cmd === 'armHover') await this.armHover();
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

// Cảnh báo cho một bước không có tourId
export function stepNote(step: RecordedStep | undefined): string {
  if (!step || step.tourId) return '';
  if (!isUsableLocator(step.locator)) return 'Phần tử không có tourId và không có manh mối để tìm lại: bước này sẽ bị bỏ khi lưu.';
  const selector = step.locator?.css ? ` (${step.locator.css})` : '';
  return step.skippedTourId
    ? `Nút này không có tourId; tourId "${step.skippedTourId}" là của vùng chứa nên không dùng. Tìm theo selector${selector}.`
    : `Phần tử không có tourId: tìm theo selector${selector}.`;
}

export async function launchRecorderBrowser(): Promise<Browser> {
  // Dùng Chrome đã cài trên máy, không tải trình duyệt riêng. CHROME_PATH để chỉ định bản khác.
  const executablePath = process.env['CHROME_PATH'];
  return chromium.launch({ headless: false, ...(executablePath ? { executablePath } : { channel: 'chrome' }) });
}

// Cửa sổ Chrome của một lần ghi: đủ để chờ người dùng đóng và để đóng khi xong
export interface RecorderBrowser {
  on(event: 'disconnected', listener: () => void): unknown;
  close(): Promise<void>;
  contexts(): BrowserContext[];
}

// Hồ sơ Chrome riêng cho việc ghi tour, mỗi web (origin) một hồ sơ: phiên đăng nhập được giữ giữa các lần ghi nên
// không phải đăng nhập lại mỗi lần. Nằm ngoài dự án. COMPASS_RECORD_PROFILE=off để mỗi lần ghi dùng hồ sơ trắng;
// đặt thành một đường dẫn để dùng thư mục khác.
export function recorderProfileDir(startUrl: string): string | null {
  const setting = process.env['COMPASS_RECORD_PROFILE'];
  if (setting === 'off') return null;
  if (setting) return setting;
  let origin = startUrl;
  try {
    origin = new URL(startUrl).origin;
  } catch {
    // giữ nguyên
  }
  const name = origin.replace(/^https?:\/\//, '').replace(/[^\w.-]/g, '_').slice(0, 60);
  return join(homedir(), '.wealthcompass', 'chrome-profiles', `${name}-${createHash('sha256').update(origin).digest('hex').slice(0, 8)}`);
}

// Khung nhìn khi ghi bằng thiết bị giả lập: iPhone 12-15 và iPad Air dọc
export const DEVICE_VIEWPORTS: Record<'mobile' | 'tablet', { width: number; height: number }> = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
};

export async function recordSession(startUrl: string, about = '', options: RecorderOptions = {}): Promise<{ recorder: Recorder; browser: RecorderBrowser }> {
  // Khung nhìn điện thoại/iPad: app hiện bố cục của thiết bị đó (menu thu gọn, thẻ thay bảng) và locator ghi layout tương ứng
  const contextOptions = options.device && options.device !== 'desktop' ? { viewport: DEVICE_VIEWPORTS[options.device], isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: null };
  let browser: RecorderBrowser | null = null;
  let context: BrowserContext | null = null;
  const profile = recorderProfileDir(startUrl);
  if (profile) {
    try {
      mkdirSync(profile, { recursive: true });
      const executablePath = process.env['CHROME_PATH'];
      // Cửa sổ desktop đủ rộng: hồ sơ giữ lại có thể mở cửa sổ hẹp, làm app chuyển sang bố cục mobile
      const persistent = await chromium.launchPersistentContext(profile, {
        headless: false,
        ...(executablePath ? { executablePath } : { channel: 'chrome' }),
        ...contextOptions,
        ...(options.device && options.device !== 'desktop' ? {} : { args: ['--window-size=1440,900'] }),
      });
      context = persistent;
      browser = { on: (_event, listener) => persistent.on('close', listener), close: () => persistent.close(), contexts: () => [persistent] };
    } catch {
      // Hồ sơ đang bị một cửa sổ ghi khác giữ, hoặc không tạo được: ghi bằng hồ sơ trắng như trước
      context = null;
    }
  }
  if (!context || !browser) {
    const launched = await launchRecorderBrowser();
    browser = launched;
    context = await launched.newContext(contextOptions);
  }
  // Hồ sơ giữ lại mở sẵn một tab trắng: dùng luôn tab đó
  const page = context.pages()[0] ?? (await context.newPage());
  const recorder = new Recorder(page, options);
  recorder.setPurpose(about);
  await recorder.attach();
  await page.goto(startUrl, { timeout: NAV_TIMEOUT_MS });
  return { recorder, browser };
}
