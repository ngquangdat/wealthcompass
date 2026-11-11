import { readFileSync, writeFileSync } from 'node:fs';
import { chromium, type Browser, type BrowserContextOptions, type ElementHandle } from 'playwright-core';
import type { Layout, TourStep } from '@wealthcompass/contracts';
import { routeMatches, type ProbeOptions, type ProbeResult } from '@wealthcompass/core';
import { CAPTURE_SCRIPT } from '../record/capture.bundle';
import { NAV_TIMEOUT_MS } from '../record/recorder';
import { VIEWPORTS, type VerifyDriver } from './verify';

// Chạy không giao diện (CI). CHROME_PATH chỉ định Chrome/Chromium; không có thì dùng Chromium của Playwright,
// rồi tới Chrome cài trên máy.
export async function launchVerifyBrowser(headless: boolean): Promise<Browser> {
  const executablePath = process.env['CHROME_PATH'];
  if (executablePath) return chromium.launch({ headless, executablePath });
  try {
    return await chromium.launch({ headless });
  } catch {
    return chromium.launch({ headless, channel: 'chrome' });
  }
}

export async function playwrightDriver(browser: Browser, base: string, layout: Layout, probe: ProbeOptions, storageState?: string): Promise<VerifyDriver> {
  const { width, height, isMobile, hasTouch } = VIEWPORTS[layout];
  const auth = storageState ? readAuthState(storageState) : null;
  const context = await browser.newContext({ viewport: { width, height }, isMobile, hasTouch, ...(auth ? { storageState: auth.state } : {}) });
  // Phiên lưu trong sessionStorage (nhiều web ngân hàng làm vậy): nạp lại trước khi app chạy
  if (auth?.session) {
    await context.addInitScript({
      content: `(function(d){var s=d[location.origin];if(!s)return;for(var k in s){if(sessionStorage.getItem(k)===null)sessionStorage.setItem(k,s[k]);}})(${JSON.stringify(auth.session)});`,
    });
  }
  await context.addInitScript({ content: CAPTURE_SCRIPT });
  const page = await context.newPage();
  const settle = () => page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
  const found = async (): Promise<ElementHandle | null> => (await page.evaluateHandle('window.__compassFound')).asElement() as ElementHandle | null;

  return {
    async open(path) {
      await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      await settle();
    },
    path: () => new URL(page.url()).pathname,
    async waitForPath(pattern, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (routeMatches(pattern, new URL(page.url()).pathname)) return true;
        await page.waitForTimeout(100);
      }
      return routeMatches(pattern, new URL(page.url()).pathname);
    },
    async probe(steps: TourStep[], index: number) {
      // Biểu thức chuỗi thay vì hàm: công cụ chạy TS có thể chèn hàm phụ mà trang không có khi serialize hàm
      return (await page.evaluate(`window.__compassProbe(${JSON.stringify(steps)}, ${index}, ${JSON.stringify(probe)})`)) as ProbeResult;
    },
    async click() {
      const element = await found();
      if (!element) return;
      await element.click({ timeout: 3000 }).catch(() => undefined);
      await settle();
    },
    async hover() {
      const element = await found();
      if (!element) return;
      // Chuột thật đứng yên trên nút mở nên menu hover (CSS lẫn JS) vẫn mở tới bước sau
      await element.hover({ timeout: 3000 }).catch(() => undefined);
      await page.waitForTimeout(250);
    },
    async screenshot(file) {
      const element = await found();
      if (!element) return false;
      return element
        .screenshot({ path: file, timeout: 3000 })
        .then(() => true)
        .catch(() => false);
    },
    close: () => context.close(),
  };
}

// Lưu phiên đăng nhập cho tour:verify: mở Chrome có giao diện, người dùng tự đăng nhập, phiên (cookie +
// localStorage) được ghi ra file mỗi giây tới khi đóng Chrome. File chứa phiên thật: không commit.
export async function saveLoginState(url: string, out: string, log: (msg: string) => void = console.log): Promise<void> {
  const browser = await launchVerifyBrowser(false);
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  await page.goto(url, { timeout: NAV_TIMEOUT_MS });
  log(`Đã mở Chrome. Đăng nhập bằng tài khoản kiểm thử rồi đóng Chrome; phiên được lưu vào ${out}.`);
  let saved = false;
  const closed = new Promise<void>((resolve) => browser.on('disconnected', () => resolve()));
  const session: Record<string, Record<string, string>> = {};
  const timer = setInterval(() => {
    void (async () => {
      const state = await context.storageState();
      // storageState của Playwright không có sessionStorage: lưu thêm theo origin
      const origin = new URL(page.url()).origin;
      if (origin.startsWith('http')) session[origin] = JSON.parse(String(await page.evaluate('JSON.stringify(sessionStorage)')));
      writeFileSync(out, JSON.stringify({ ...state, sessionStorage: session }, null, 2));
      saved = true;
    })().catch(() => undefined);
  }, 1000);
  page.on('close', () => void browser.close().catch(() => undefined));
  await closed;
  clearInterval(timer);
  if (!saved) throw new Error('Chưa lưu được phiên (đóng Chrome quá sớm).');
  log(`Đã lưu phiên vào ${out}. Chạy: tour:verify --storage-state ${out} ...`);
}

// File phiên: storageState của Playwright (cookie, localStorage) + sessionStorage theo origin do tour:auth thêm
function readAuthState(file: string): { state: Exclude<BrowserContextOptions['storageState'], string | undefined>; session?: Record<string, Record<string, string>> } {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { cookies?: []; origins?: []; sessionStorage?: Record<string, Record<string, string>> };
  return { state: { cookies: raw.cookies ?? [], origins: raw.origins ?? [] }, ...(raw.sessionStorage ? { session: raw.sessionStorage } : {}) };
}
