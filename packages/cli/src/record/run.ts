import { exists, readText } from '@wealthcompass/tourdb';
import { join } from 'node:path';
import { featureMapSchema, type FeatureMap, type Layout } from '@wealthcompass/contracts';
import { resolveLlmConfig } from '@wealthcompass/llm';
import { describeLocator, isUsableLocator, routeMatches } from '@wealthcompass/core';
import { featureIdOfRoute, loadConfig, scan } from '../scan';
import { draftTour } from './draft';
import { recordSession, type RecordedStep } from './recorder';
import { layoutOfSteps, mergeSampleQuestionsIntoOverrides, mergeTourIntoToursFile, writeOverrides, writeTours } from './write';

export interface RecordOptions {
  config: string;
  url: string;
  id: string;
  title?: string;
  feature?: string;
  // Mô tả tính năng đang ghi (--about); có thể sửa tiếp ở ô nhập trong khung ghi
  about?: string;
  force: boolean;
  noLlm: boolean;
  dryRun: boolean;
  // Cấu hình LLM truyền sẵn (Studio có thể ghi đè trong phiên); không có thì đọc biến môi trường
  llm?: import('@wealthcompass/llm').LlmConfig | null;
  // Thiết bị khi mở Chrome (--mobile, --tablet; mặc định desktop). Tour lưu theo bố cục thật lúc bấm (bề rộng khung nhìn).
  device?: Layout;
}

// Mẫu route của tính năng khớp với đường dẫn thật (/orders/42 -> /orders/:id); ưu tiên khớp chính xác, rồi ít tham số nhất
export function matchRoutePattern(featureMap: FeatureMap | null, path: string): string | undefined {
  const clean = path.split(/[?#]/)[0];
  const candidates = (featureMap?.features ?? []).map((f) => f.route.pattern).filter((p) => routeMatches(p, clean));
  if (candidates.includes(clean)) return clean;
  return candidates.sort((a, b) => (a.match(/:/g)?.length ?? 0) - (b.match(/:/g)?.length ?? 0))[0];
}

export function loadFeatureMap(path: string): FeatureMap | null {
  if (!exists(path)) return null;
  try {
    return featureMapSchema.parse(JSON.parse(readText(path)));
  } catch {
    return null;
  }
}

// Phần sau khi ghi xong: lọc bước, soạn nháp, gộp vào YAML, kiểm lại bằng scanner.
// Tách khỏi trình duyệt để test được.
export async function finishRecording(
  opts: RecordOptions,
  recorded: { steps: RecordedStep[]; startRoute: string | null; endRoute?: string | null; purpose?: string },
  log: (msg: string) => void = console.log,
): Promise<{ json: string; written: boolean }> {
  const { config, root } = loadConfig(opts.config);
  const featureMap = loadFeatureMap(join(root, config.discovery.out));
  // Chưa có source: không có route/màn hình quét sẵn; màn hình sinh ra từ chính các tour đã ghi
  const noSource = config.discovery.source === 'none';
  if (!featureMap && !noSource) log('! Chưa có feature-map.json (hãy chạy `scan` trước) nên không gắn được nhãn/tính năng đích tự động.');

  // Bước dùng được: có tourId (ghim) hoặc locator đủ manh mối. Không còn bắt buộc phải gắn tourId vào HTML.
  const mapped = recorded.steps
    .filter((s) => s.tourId !== null || isUsableLocator(s.locator))
    .map((s) => ({ ...s, routePattern: matchRoutePattern(featureMap, s.route) }));
  for (const u of recorded.steps.filter((s) => s.tourId === null && !isUsableLocator(s.locator))) {
    log(`! Bỏ qua lần bấm vào <${u.tag}> ở ${u.route}: phần tử không có tên, chữ hay thuộc tính ổn định để tìm lại. Thêm aria-label hoặc tourId nếu cần bước này.`);
  }
  if (!mapped.length) throw new Error('Không có bước nào nhận ra được, không có gì để lưu.');
  if (!recorded.startRoute) throw new Error('Chưa bấm "Bắt đầu ghi".');
  for (const s of mapped) {
    if (!s.tourId && s.locator) {
      const step = mapped.indexOf(s) + 1;
      const skipped = s.skippedTourId ? ` tourId "${s.skippedTourId}" là của vùng chứa bao ngoài nên không dùng.` : '';
      log(`! Bước ${step} (${s.route}) không có tourId, tìm theo selector: ${describeLocator(s.locator)}${s.locator.css ? ` · ${s.locator.css}` : ''}.${skipped} Muốn ghim chắc chắn thì dev gắn tourId cho phần tử này.`);
    }
    if (featureMap && !noSource && !s.routePattern) log(`! Màn hình ${s.route} không khớp route nào trong feature-map.json; bước vẫn được lưu nhưng tour không tự mở được màn hình đó.`);
  }

  // Bước nhạy cảm phải là bước chỉ-tô-sáng; các bước sau nó (nếu có) thường là bấm nhầm
  const firstSensitive = mapped.findIndex((s) => s.userOnly);
  if (firstSensitive !== -1 && firstSensitive < mapped.length - 1) {
    log(`! Bước ${firstSensitive + 1} là phần tử nhạy cảm (user-only) nhưng còn ${mapped.length - 1 - firstSensitive} bước sau nó; thường bước nhạy cảm nên là bước cuối.`);
  }

  // Tính năng đích: --feature, hoặc tính năng có route khớp màn hình người dùng đứng lúc dừng ghi
  // (không dùng route lúc bấm bước cuối: bước cuối hay là bấm tab để chuyển sang màn hình đích)
  const destination = recorded.endRoute ?? mapped.at(-1)!.route;
  const destinationPattern = matchRoutePattern(featureMap, destination);
  const featureId =
    opts.feature ?? featureMap?.features.find((f) => f.route.pattern === destinationPattern)?.id ?? (noSource ? featureIdOfRoute(destination) : undefined);
  if (!featureId) log('! Không xác định được tính năng đích (dùng --feature <id>); tour sẽ không gắn với tính năng nào nên trợ lý chưa thể đề xuất nó.');
  else if (featureMap && !noSource && !featureMap.features.some((f) => f.id === featureId)) throw new Error(`--feature "${featureId}" không có trong feature-map.json`);

  // Ưu tiên chữ người ghi nhập trong lúc ghi, rồi mới tới --about
  const purpose = (recorded.purpose?.trim() || opts.about?.trim() || '').slice(0, 600);
  if (!purpose) log('! Chưa có mô tả tính năng (ô trong khung ghi hoặc --about): LLM sẽ phải đoán mục đích từ tên nút nên dễ lệch.');

  const llm = opts.noLlm ? null : opts.llm !== undefined ? opts.llm : resolveLlmConfig();
  log(llm?.apiKey ? `Soạn nội dung bằng LLM (${llm.provider} / ${llm.model})...` : 'Soạn nội dung bằng mẫu (không dùng LLM).');
  const draft = await draftTour({ id: opts.id, title: opts.title, steps: mapped, featureMap, featureId, purpose, llm });
  if (draft.note) log(`! ${draft.note}`);

  // Bố cục theo bề rộng khung nhìn lúc bấm; bước không ghi được locator thì theo thiết bị đã chọn
  const layout = layoutOfSteps(mapped) ?? opts.device;
  const opened = mapped.filter((s) => s.opensNext).length;
  if (opened) log(`  · ${opened} bước chỉ mở chỗ chứa bước sau (menu, mở rộng): khi chạy sẽ tự bỏ qua nếu bước sau đã hiện.`);

  const toursFile = join(root, config.discovery.tours);
  const merged = mergeTourIntoToursFile(toursFile, {
    layout,
    id: opts.id,
    draft,
    steps: mapped,
    startRoute: recorded.startRoute,
    ...(noSource ? { endRoute: destinationPattern ?? destination.split(/[?#]/)[0] } : {}),
    featureId,
    purpose,
    force: opts.force,
  });
  const overridesFile = join(root, config.discovery.overrides);
  const questions = featureId ? mergeSampleQuestionsIntoOverrides(overridesFile, featureId, draft.sampleQuestions) : { yaml: '', added: [] };

  if (opts.dryRun) {
    log(`\n--- ${config.discovery.tours} (dry-run, chưa ghi) ---\n` + merged.json);
    return { json: merged.json, written: false };
  }
  writeTours(toursFile, JSON.parse(merged.json), 'tour:record', `Ghi tour ${opts.id}`);
  if (questions.added.length) writeOverrides(overridesFile, questions.yaml);
  log(`Đã ghi tour "${opts.id}"${merged.variant ? ` bản ${merged.variant}` : layout ? ` (${layout})` : ''} (${mapped.length} bước) vào ${toursFile}${questions.added.length ? `, thêm ${questions.added.length} câu hỏi mẫu vào ${overridesFile}` : ''}`);

  // Quét lại để chắc tour vào được Feature Map
  // Chỉ file tour đổi, source không đổi: dùng chỉ mục source, không nạp lại ts-morph
  const result = scan(opts.config, { useIndex: true });
  const ok = result.featureMap.tours.some((t) => t.id === opts.id);
  const problems = result.featureMap.coverage.warnings.filter((w) => w.includes(`"${opts.id}"`));
  log(ok ? `✔ scan: tour "${opts.id}" hợp lệ.` : `✘ scan: tour "${opts.id}" bị loại.`);
  for (const p of problems) log(`  - ${p}`);
  log(`Tour đã lưu vào kho ${config.discovery.tours} (bản nháp). Đọc lại chữ từng bước ở trang Tour của Studio rồi bấm Lưu để duyệt; commit file kho cùng dự án. Không cần sửa template.`);
  return { json: merged.json, written: true };
}

export async function recordTour(opts: RecordOptions): Promise<void> {
  const { config } = loadConfig(opts.config);
  const { recorder, browser } = await recordSession(opts.url, opts.about, {
    mobileBreakpoint: config.tours.mobileBreakpoint,
    tabletBreakpoint: config.tours.tabletBreakpoint,
    device: opts.device,
  });
  console.log('Đã mở Chrome. Đăng nhập, vào màn hình xuất phát, bấm "● Bắt đầu ghi" ở góc trái dưới, thao tác theo đúng luồng, rồi bấm "■ Dừng & lưu".');
  const closed = new Promise<void>((resolve) => browser.on('disconnected', () => resolve()));
  await Promise.race([recorder.done, closed]);
  const steps = [...recorder.steps];
  const startRoute = recorder.startRoute;
  const endRoute = recorder.endRoute;
  const purpose = recorder.purpose;
  await browser.close().catch(() => undefined);
  if (!recorder.recording && steps.length === 0 && !startRoute) throw new Error('Đóng trình duyệt trước khi ghi.');
  await finishRecording(opts, { steps, startRoute, endRoute, purpose });
}
