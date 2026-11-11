import { join } from 'node:path';
import type { Layout } from '@wealthcompass/contracts';
import { describeLocator, isUsableLocator } from '@wealthcompass/core';
import { loadConfig, scan } from '../scan';
import { mainLayout, replaceStep, stepsOf } from '../verify/heal';
import { recordSession, type RecordedStep } from './recorder';
import { loadFeatureMap, matchRoutePattern } from './run';
import { readToursFile, writeTours } from './write';

export interface RerecordOptions {
  config: string;
  // Gốc của web (http://localhost:4200); trang mở ở route của bước
  url: string;
  id: string;
  key: string;
  // Bản của bố cục nào (mặc định bản chính); quyết định cả khung nhìn của Chrome
  layout?: Layout;
  today?: string;
}

// Ghi đè phần tử của một bước bằng một lần bấm (phần đọc/ghi file, tách khỏi trình duyệt để test)
export function applyRerecord(opts: RerecordOptions, step: RecordedStep, log: (msg: string) => void = console.log): void {
  const { config, root } = loadConfig(opts.config);
  const file = join(root, config.discovery.tours);
  const data = readToursFile(file);
  if (step.tourId === null && !isUsableLocator(step.locator)) throw new Error(`Phần tử vừa bấm (<${step.tag}>) không có tên, chữ hay thuộc tính ổn định để tìm lại; chọn phần tử khác hoặc thêm aria-label.`);
  const featureMap = loadFeatureMap(join(root, config.discovery.out));
  const next = replaceStep(data, {
    id: opts.id,
    key: opts.key,
    layout: opts.layout,
    tourId: step.tourId,
    locator: step.locator,
    userOnly: step.userOnly,
    route: matchRoutePattern(featureMap, step.route) ?? step.route,
    today: opts.today ?? new Date().toISOString().slice(0, 10),
  });
  writeTours(file, data, 'tour:rerecord', `Ghi lại bước ${opts.key} của ${opts.id}`);
  log(`Đã thay phần tử của bước ${opts.key}: ${next.tourId ?? (next.locator ? describeLocator(next.locator) : '')}${step.userOnly ? ' (nhạy cảm: chỉ tô sáng)' : ''}`);
  const ok = scan(opts.config, { useIndex: true }).featureMap.tours.some((t) => t.id === opts.id);
  log(ok ? `✔ scan: tour "${opts.id}" hợp lệ.` : `✘ scan: tour "${opts.id}" bị loại.`);
}

// Mở Chrome ở màn hình của bước, ghi sẵn: lần bấm đầu tiên thành phần tử mới của bước, rồi đóng
export async function rerecordStep(opts: RerecordOptions, log: (msg: string) => void = console.log): Promise<void> {
  const { config, root } = loadConfig(opts.config);
  const tour = readToursFile(join(root, config.discovery.tours)).tours[opts.id];
  if (!tour) throw new Error(`Không có tour "${opts.id}" trong ${config.discovery.tours}`);
  const steps = stepsOf(tour, opts.layout);
  const old = steps.find((s) => s.key === opts.key);
  if (!old) throw new Error(`Tour "${opts.id}" không có bước "${opts.key}"`);
  // Route có tham số (/orders/:id): người dùng tự mở tới màn hình đó rồi mới bấm "Bắt đầu ghi"
  const direct = !old.route?.includes(':');
  const route = old.route && direct ? old.route : tour.startRoute;
  let first: (step: RecordedStep) => void = () => undefined;
  const clicked = new Promise<RecordedStep>((resolve) => (first = resolve));
  const { recorder, browser } = await recordSession(opts.url.replace(/\/$/, '') + route, `Ghi lại bước ${opts.key}: ${old.text}`, {
    mobileBreakpoint: config.tours.mobileBreakpoint,
    tabletBreakpoint: config.tours.tabletBreakpoint,
    device: opts.layout ?? mainLayout(tour),
    onStep: (s) => first(s),
  });
  if (direct) await recorder.start();
  log(
    direct
      ? `Đã mở Chrome ở ${route}, đang ghi. Bấm vào phần tử mới của bước ${opts.key}: "${old.text.slice(0, 80)}". Đóng Chrome để hủy.`
      : `Đã mở Chrome. Mở tới màn hình ${old.route}, bấm "● Bắt đầu ghi", rồi bấm vào phần tử mới của bước ${opts.key}: "${old.text.slice(0, 80)}".`,
  );
  const closed = new Promise<null>((resolve) => browser.on('disconnected', () => resolve(null)));
  const step = await Promise.race([clicked, closed]);
  await browser.close().catch(() => undefined);
  if (!step) throw new Error('Đã đóng Chrome trước khi bấm, không đổi gì.');
  applyRerecord(opts, step, log);
}
