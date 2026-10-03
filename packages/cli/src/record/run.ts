import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { featureMapSchema, type FeatureMap } from '@wealthcompass/contracts';
import { resolveLlmConfig } from '@wealthcompass/llm';
import { loadConfig, scan } from '../scan';
import { draftTour } from './draft';
import { recordSession, type RecordedStep } from './recorder';
import { mergeTourIntoOverrides, writeOverrides } from './write';

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
}

export function loadFeatureMap(path: string): FeatureMap | null {
  if (!existsSync(path)) return null;
  try {
    return featureMapSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
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
): Promise<{ yaml: string; written: boolean }> {
  const { config, root } = loadConfig(opts.config);
  const featureMap = loadFeatureMap(join(root, config.discovery.out));
  if (!featureMap) log('! Chưa có feature-map.json (hãy chạy `scan` trước) nên không gắn được nhãn/tính năng đích tự động.');

  const mapped = recorded.steps.filter((s) => s.tourId !== null);
  const unmapped = recorded.steps.filter((s) => s.tourId === null);
  for (const u of unmapped) {
    log(`! Bỏ qua lần bấm vào <${u.tag}> "${u.text}" ở ${u.route}: chưa có tourId. Thêm tourId="..." vào template rồi ghi lại nếu muốn có bước này.`);
  }
  if (!mapped.length) throw new Error('Không có bước nào gắn tourId, không có gì để lưu.');
  if (!recorded.startRoute) throw new Error('Chưa bấm "Bắt đầu ghi".');

  // Bước nhạy cảm phải là bước chỉ-tô-sáng; các bước sau nó (nếu có) thường là bấm nhầm
  const firstSensitive = mapped.findIndex((s) => s.userOnly);
  if (firstSensitive !== -1 && firstSensitive < mapped.length - 1) {
    log(`! Bước ${firstSensitive + 1} là phần tử nhạy cảm (user-only) nhưng còn ${mapped.length - 1 - firstSensitive} bước sau nó; thường bước nhạy cảm nên là bước cuối.`);
  }

  // Tính năng đích: --feature, hoặc tính năng có route trùng màn hình người dùng đứng lúc dừng ghi
  // (không dùng route lúc bấm bước cuối: bước cuối hay là bấm tab để chuyển sang màn hình đích)
  const destination = recorded.endRoute ?? mapped.at(-1)!.route;
  const featureId = opts.feature ?? featureMap?.features.find((f) => f.route.pattern === destination)?.id;
  if (!featureId) log('! Không xác định được tính năng đích (dùng --feature <id>); tour sẽ không gắn với tính năng nào nên trợ lý chưa thể đề xuất nó.');
  else if (featureMap && !featureMap.features.some((f) => f.id === featureId)) throw new Error(`--feature "${featureId}" không có trong feature-map.json`);

  // Ưu tiên chữ người ghi nhập trong lúc ghi, rồi mới tới --about
  const purpose = (recorded.purpose?.trim() || opts.about?.trim() || '').slice(0, 600);
  if (!purpose) log('! Chưa có mô tả tính năng (ô trong khung ghi hoặc --about): LLM sẽ phải đoán mục đích từ tên nút nên dễ lệch.');

  const llm = opts.noLlm ? null : resolveLlmConfig();
  log(llm?.apiKey ? `Soạn nội dung bằng LLM (${llm.provider} / ${llm.model})...` : 'Soạn nội dung bằng mẫu (không dùng LLM).');
  const draft = await draftTour({ id: opts.id, title: opts.title, steps: mapped, featureMap, featureId, purpose, llm });
  if (draft.note) log(`! ${draft.note}`);

  const overridesFile = join(root, config.discovery.overrides);
  const merged = mergeTourIntoOverrides(overridesFile, {
    id: opts.id,
    draft,
    steps: mapped,
    startRoute: recorded.startRoute,
    featureId,
    purpose,
    force: opts.force,
  });

  if (opts.dryRun) {
    log('\n--- compass.overrides.yaml (dry-run, chưa ghi) ---\n' + merged.yaml);
    return { yaml: merged.yaml, written: false };
  }
  writeOverrides(overridesFile, merged.yaml);
  log(`Đã ghi tour "${opts.id}" (${mapped.length} bước${merged.addedQuestions.length ? `, thêm ${merged.addedQuestions.length} câu hỏi mẫu` : ''}) vào ${overridesFile}`);

  // Quét lại để chắc tour hợp lệ (mọi tourId có trong template)
  const result = scan(opts.config);
  const ok = result.featureMap.tours.some((t) => t.id === opts.id);
  const problems = result.featureMap.coverage.warnings.filter((w) => w.includes(`"${opts.id}"`));
  log(ok ? `✔ scan: tour "${opts.id}" hợp lệ.` : `✘ scan: tour "${opts.id}" bị loại.`);
  for (const p of problems) log(`  - ${p}`);
  log('Mở file, đọc lại chữ của từng bước (đang ở dạng DRAFT) rồi commit.');
  return { yaml: merged.yaml, written: true };
}

export async function recordTour(opts: RecordOptions): Promise<void> {
  const { recorder, browser } = await recordSession(opts.url, opts.about);
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
