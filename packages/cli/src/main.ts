#!/usr/bin/env -S npx tsx
import { scan } from './scan';
import { recordTour } from './record/run';
import { enrich, resolveOnly } from './enrich';
import { annotate, formatReport } from './annotate';
import { dirname, relative } from 'node:path';
import { resolveLlmConfig } from '@wealthcompass/llm';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const command = process.argv[2];

if (command === 'scan' || command === 'doctor') {
  const config = arg('config', 'compass.config.yaml')!;
  const { featureMap, outFile } = scan(config);
  const c = featureMap.coverage;
  const pct = (n: number) => (c.routesFound ? Math.round((n / c.routesFound) * 100) : 0);
  console.log(`Feature Map: ${outFile}`);
  console.log(`  Route/màn hình : ${c.routesFound}`);
  console.log(`  Có tiêu đề     : ${c.routesWithTitle} (${pct(c.routesWithTitle)}%)`);
  console.log(`  Có trên menu   : ${c.menuItemsMatched} (${pct(c.menuItemsMatched)}%)`);
  console.log(`  tourId         : ${c.targetsFound}`);
  console.log(`  Tour hợp lệ    : ${featureMap.tours.length}`);
  if (c.warnings.length) {
    console.log(`\nCảnh báo (${c.warnings.length}):`);
    for (const w of c.warnings) console.log(`  - ${w}`);
  }
  const strict = process.argv.includes('--strict');
  if (strict && c.warnings.length) process.exit(1);
} else if (command === 'annotate') {
  // Gợi ý tourId cho phần tử chưa có và xuất patch; KHÔNG sửa code
  const config = arg('config', 'compass.config.yaml')!;
  const print = process.argv.includes('--print');
  const result = annotate({ config, only: resolveOnly(arg('only')), out: print ? null : arg('out'), directiveImport: arg('directive-import') });
  const base = dirname(config);
  console.log(formatReport(result, base) || '\nKhông có phần tử tương tác nào còn thiếu tourId.');
  for (const s of result.skipped) console.log(`\n! Bỏ qua ${s.component} (${relative(base, s.file)})${s.count ? `, ${s.count} phần tử` : ''}: ${s.reason}`);
  const sure = result.candidates.filter((c) => c.sensitive?.level === 'sure').length;
  const maybe = result.candidates.filter((c) => c.sensitive?.level === 'maybe').length;
  console.log(`\n${result.candidates.length} phần tử gợi ý tourId (${sure} chắc chắn user-only, ${maybe} cần xem lại).`);
  if (print) console.log('\n' + result.patch);
  else if (result.patchFile) {
    console.log(`Đã ghi patch (${result.patchFileCount} file): ${result.patchFile}`);
    console.log('Xem patch, bỏ những chỗ không cần, rồi áp dụng:\n  ' + result.applyHint);
    console.log('Code chưa bị sửa. Sau khi áp patch: chạy scan để xác nhận.');
  }
} else if (command === 'enrich') {
  // Soạn nháp description/keywords/sampleQuestions cho màn hình còn thiếu; chỉ điền chỗ trống
  await enrich({
    config: arg('config', 'compass.config.yaml')!,
    dryRun: process.argv.includes('--dry-run'),
    only: resolveOnly(arg('only')),
    llm: resolveLlmConfig(),
  });
} else if (command === 'tour:record') {
  const url = arg('url');
  const id = arg('id');
  if (!url || !id) {
    console.error('Cách dùng: compass tour:record --config <yaml> --url <địa chỉ web> --id <tour-id> [--title "..."] [--about "mô tả tính năng"] [--feature <id>] [--force] [--no-llm] [--dry-run]');
    process.exit(1);
  }
  await recordTour({
    config: arg('config', 'compass.config.yaml')!,
    url,
    id,
    title: arg('title'),
    feature: arg('feature'),
    about: arg('about'),
    force: process.argv.includes('--force'),
    noLlm: process.argv.includes('--no-llm'),
    dryRun: process.argv.includes('--dry-run'),
  });
} else {
  console.log('Cách dùng: compass scan|doctor --config <compass.config.yaml> [--strict] | enrich --config <yaml> [--only id1,id2] [--dry-run] | annotate --config <yaml> [--only ...] [--out file] [--print] | tour:record ...');
  process.exit(command ? 1 : 0);
}
