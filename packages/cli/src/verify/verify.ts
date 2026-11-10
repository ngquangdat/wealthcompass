import { mkdirSync } from 'node:fs';
import { writeText } from '@wealthcompass/tourdb';
import { dirname, join, resolve } from 'node:path';
import type { Layout, Locator, Tour, TourStep } from '@wealthcompass/contracts';
import { routeMatches, stepsForLayout, type ProbeOptions, type ProbeResult } from '@wealthcompass/core';
import { loadConfig } from '../scan';
import { loadFeatureMap } from '../record/run';
import { readToursFile, writeTours } from '../record/write';
import { applyHealing } from './heal';

// tour:verify: chạy lại từng tour trên một bản web thật (staging) bằng Playwright, ở cả bố cục desktop và mobile,
// với đúng bộ tìm phần tử của widget. Báo bước hỏng/không chắc trước khi người dùng gặp, và tự sửa locator
// khi phần tử vẫn tìm chắc được nhưng manh mối chính đã đổi. Không bao giờ bấm phần tử nhạy cảm.

export type StepStatus = ProbeResult['status'] | 'not_reached';

export interface StepReport {
  index: number;
  key: string;
  status: StepStatus;
  matchedBy?: string;
  score?: number;
  userOnly?: boolean;
  drift?: string[];
  // Locator ghi lại từ phần tử tìm được, khi manh mối đã đổi
  proposed?: Locator;
  healed?: 'applied' | 'proposed';
  screenshot?: string;
}

export interface TourReport {
  id: string;
  layout: Layout;
  // Tour không có bản riêng cho bố cục này: chạy bản chính (như widget sẽ làm)
  fallback: boolean;
  ok: boolean;
  steps: StepReport[];
}

export interface VerifyReport {
  url: string;
  at: string;
  tours: TourReport[];
  summary: { runs: number; failed: number; ok: number; lowConfidence: number; missing: number; skipped: number; notReached: number; healed: number; proposed: number };
}

// Phần điều khiển trình duyệt, tách ra để test runner bằng bản giả
export interface VerifyDriver {
  open(path: string): Promise<void>;
  path(): string;
  waitForPath(pattern: string, timeoutMs: number): Promise<boolean>;
  probe(steps: TourStep[], index: number): Promise<ProbeResult>;
  // Bấm phần tử vừa tìm được ở probe
  click(): Promise<void>;
  // Di chuột thật vào phần tử vừa tìm được (bước hover mở menu); driver giả trong test có thể bỏ qua
  hover?(): Promise<void>;
  // Chụp phần tử vừa tìm được; false khi không chụp được
  screenshot(file: string): Promise<boolean>;
  close(): Promise<void>;
}

export const VIEWPORTS: Record<Layout, { width: number; height: number; isMobile?: boolean; hasTouch?: boolean }> = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
};

// Chạy một tour ở một bố cục. Bước "click" (không nhạy cảm) được bấm thật để đi tiếp như người dùng;
// bước "next" và bước nhạy cảm chỉ được tìm, không bấm.
export async function verifyTour(driver: VerifyDriver, tour: Tour, layout: Layout, opts: { screenshots?: string } = {}): Promise<TourReport> {
  const steps = stepsForLayout(tour, layout);
  const fallback = steps === tour.steps && (tour.layout ?? 'desktop') !== layout;
  const reports: StepReport[] = [];
  await driver.open(tour.startRoute);
  // Bị chuyển trang ngay từ đầu (thường là màn hình đăng nhập): báo rõ thay vì "không thấy phần tử"
  if (!tour.startRoute.includes(':') && !routeMatches(tour.startRoute, driver.path())) {
    throw new Error(`mở ${tour.startRoute} bị chuyển tới ${driver.path()}; trang cần đăng nhập thì tạo phiên bằng \`tour:auth\` rồi chạy lại với --storage-state`);
  }
  let stopped = false;
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const key = step.key ?? `s${index + 1}`;
    if (stopped) {
      reports.push({ index, key, status: 'not_reached' });
      continue;
    }
    // Lần bấm ở bước trước thường đổi màn hình; chưa tới thì tự mở route của bước (nếu không có tham số)
    if (step.route && !routeMatches(step.route, driver.path())) {
      const arrived = await driver.waitForPath(step.route, 1500);
      if (!arrived && !step.route.includes(':')) await driver.open(step.route);
    }
    const probe = await driver.probe(steps, index);
    const report: StepReport = {
      index,
      key,
      status: probe.status,
      ...(probe.matchedBy ? { matchedBy: probe.matchedBy } : {}),
      ...(probe.score !== undefined ? { score: probe.score } : {}),
      ...(probe.userOnly ? { userOnly: true } : {}),
      ...(probe.drift?.length ? { drift: probe.drift } : {}),
    };
    reports.push(report);
    if (probe.status === 'missing') {
      stopped = true;
      continue;
    }
    if (probe.status !== 'ok') continue;
    if (opts.screenshots) {
      const file = join(opts.screenshots, tour.id, `${layout}-${key}.png`);
      mkdirSync(dirname(file), { recursive: true });
      if (await driver.screenshot(file)) report.screenshot = file;
    }
    if (probe.proposed) report.proposed = probe.proposed;
    if (step.advanceOn === 'click' && !probe.userOnly) await driver.click();
    else if (step.advanceOn === 'hover') await driver.hover?.();
  }
  return { id: tour.id, layout, fallback, ok: reports.every((r) => r.status === 'ok' || r.status === 'skipped'), steps: reports };
}

export interface VerifyOptions {
  config: string;
  // Gốc của bản web cần kiểm (vd. https://staging.example.vn)
  url: string;
  only?: string[];
  layouts?: Layout[];
  // Ghi locator đã sửa vào compass.tours.json
  heal?: boolean;
  // File storageState của Playwright (phiên đã đăng nhập)
  storageState?: string;
  headed?: boolean;
  // Thư mục ảnh chụp từng bước (để `tour:push` đưa lên backend)
  screenshots?: string;
  // Ghi báo cáo JSON
  report?: string;
  // Coi bước "không chắc" là lỗi
  strict?: boolean;
  timeoutMs?: number;
  today?: string;
  // Thay trình duyệt (test)
  driverFactory?: (layout: Layout) => Promise<VerifyDriver>;
}

export async function verifyTours(opts: VerifyOptions, log: (msg: string) => void = console.log): Promise<VerifyReport> {
  const { config, root } = loadConfig(opts.config);
  const featureMap = loadFeatureMap(join(root, config.discovery.out));
  if (!featureMap) throw new Error(`Chưa có ${config.discovery.out}: chạy \`scan\` trước.`);
  const tours = featureMap.tours.filter((t) => !opts.only?.length || opts.only.includes(t.id));
  if (!tours.length) throw new Error(opts.only?.length ? `Không có tour nào khớp --only ${opts.only.join(',')}` : 'Feature Map chưa có tour nào.');
  const layouts = opts.layouts?.length ? opts.layouts : (['desktop', 'mobile'] as Layout[]);
  const base = opts.url.replace(/\/$/, '');
  const probeOptions: ProbeOptions = {
    mobileBreakpoint: config.tours.mobileBreakpoint,
    busySelector: config.tours.busySelector,
    userOnly: config.safety.userOnly,
    timeoutMs: opts.timeoutMs ?? 4000,
  };

  let closeBrowser: (() => Promise<void>) | null = null;
  const factory =
    opts.driverFactory ??
    (await (async () => {
      const { launchVerifyBrowser, playwrightDriver } = await import('./driver');
      const browser = await launchVerifyBrowser(!opts.headed);
      closeBrowser = () => browser.close();
      return (layout: Layout) => playwrightDriver(browser, base, layout, probeOptions, opts.storageState ? resolve(opts.storageState) : undefined);
    })());

  const reports: TourReport[] = [];
  try {
    for (const tour of tours) {
      for (const layout of layouts) {
        const driver = await factory(layout);
        try {
          const report = await verifyTour(driver, tour, layout, { screenshots: opts.screenshots });
          reports.push(report);
          log(formatTourReport(report));
        } catch (e) {
          // Trang lỗi (không mở được, hết phiên): ghi thành tour hỏng, kiểm tiếp tour khác
          const steps = stepsForLayout(tour, layout).map((s, index) => ({ index, key: s.key ?? `s${index + 1}`, status: 'not_reached' as const }));
          reports.push({ id: tour.id, layout, fallback: false, ok: false, steps });
          log(`✘ ${tour.id} [${layout}]: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          await driver.close().catch(() => undefined);
        }
      }
    }
  } finally {
    await (closeBrowser as (() => Promise<void>) | null)?.().catch(() => undefined);
  }

  // Sửa locator: chỉ tour ghi bằng tour:record (compass.tours.json); tour soạn tay dùng tourId trong template
  const toursFile = join(root, config.discovery.tours);
  const recorded = readToursFile(toursFile);
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  let changedFile = false;
  for (const report of reports) {
    const def = recorded.tours[report.id];
    // Lượt chạy bản chính ở bố cục kia: chỉ sửa khi bố cục của bản chính không được kiểm (tránh ghi đè bằng ảnh chụp sai khung nhìn)
    const main = tours.find((t) => t.id === report.id)?.layout ?? 'desktop';
    if (report.fallback && reports.some((r) => r.id === report.id && r.layout === main)) continue;
    for (const step of report.steps) {
      const proposed = step.proposed;
      if (!opts.heal || !proposed || !step.drift?.length || !def) continue;
      try {
        step.healed = applyHealing(recorded, {
          id: report.id,
          key: step.key,
          // Lượt chạy bản chính ở bố cục kia (fallback) thì sửa bản chính
          layout: report.fallback ? undefined : report.layout,
          proposed,
          changed: step.drift,
          needsReview: Boolean(step.userOnly),
          today,
        });
        changedFile = true;
      } catch (e) {
        log(`! Không sửa được ${report.id}/${step.key}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  if (changedFile) {
    writeTours(toursFile, recorded, 'tour:verify', 'Tự sửa locator (--heal)');
    log(`Đã cập nhật locator trong ${toursFile}. Chạy \`scan\` để đưa vào Feature Map, xem diff rồi commit.`);
  }

  const all = reports.flatMap((r) => r.steps);
  const count = (s: StepStatus) => all.filter((x) => x.status === s).length;
  const summary = {
    runs: reports.length,
    failed: reports.filter((r) => !r.ok && (opts.strict || r.steps.some((s) => s.status === 'missing' || s.status === 'not_reached'))).length,
    ok: count('ok'),
    lowConfidence: count('low_confidence'),
    missing: count('missing'),
    skipped: count('skipped'),
    notReached: count('not_reached'),
    healed: all.filter((s) => s.healed === 'applied').length,
    proposed: all.filter((s) => s.healed === 'proposed').length,
  };
  const result: VerifyReport = { url: base, at: new Date().toISOString(), tours: reports, summary };
  if (opts.report) {
    mkdirSync(dirname(resolve(opts.report)), { recursive: true });
    writeText(resolve(opts.report), JSON.stringify(result, null, 2) + '\n');
  }
  const drifted = all.filter((s) => s.drift?.length && !s.healed).length;
  log(
    `\n${summary.runs} lượt chạy, ${summary.failed} hỏng · bước: ${summary.ok} ok, ${summary.lowConfidence} không chắc, ${summary.missing} không thấy, ${summary.skipped} bỏ qua, ${summary.notReached} chưa tới` +
      (summary.healed || summary.proposed ? ` · đã sửa ${summary.healed}, chờ duyệt ${summary.proposed}` : '') +
      (drifted ? ` · ${drifted} bước có manh mối đã đổi (thêm --heal để sửa)` : ''),
  );
  return result;
}

const ICON: Record<StepStatus, string> = { ok: '✔', low_confidence: '?', missing: '✘', skipped: '↷', not_reached: '·' };

export function formatTourReport(report: TourReport): string {
  const head = `${report.ok ? '✔' : '✘'} ${report.id} [${report.layout}${report.fallback ? ', dùng bản chính' : ''}]`;
  const lines = report.steps.map((s) => {
    const detail = [s.matchedBy, s.score !== undefined ? `điểm ${s.score}` : '', s.userOnly ? 'nhạy cảm' : '', s.drift?.length ? `đổi: ${s.drift.join(', ')}` : ''].filter(Boolean).join(' · ');
    return `   ${ICON[s.status]} ${s.key} ${s.status}${detail ? ` (${detail})` : ''}`;
  });
  return [head, ...lines].join('\n');
}
