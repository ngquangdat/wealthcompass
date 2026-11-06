import { scan } from './scan';
import { recordTour } from './record/run';
import { rerecordStep } from './record/rerecord';
import { verifyTours } from './verify/verify';
import { pushTours } from './verify/push';
import { enrich, resolveOnly } from './enrich';
import { annotate, formatReport } from './annotate';
import { dirname, join, relative, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setup } from './setup/setup';
import { doctor, formatChecks } from './setup/doctor';
import { VERSION } from './version';
import { startStudio } from './studio/server';
import { resolveLlmConfig } from '@wealthcompass/llm';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const command = process.argv[2];

if (command === 'doctor' && arg('app')) {
  // Kiểm tra web đã gắn WealthCompass đúng chưa
  const checks = await doctor(resolve(arg('app')!), arg('project'));
  console.log(formatChecks(checks));
  const failed = checks.filter((c) => c.status === 'fail').length;
  console.log(failed ? `\n${failed} mục cần sửa.` : '\nMọi thứ đã nối đúng.');
  process.exit(failed ? 1 : 0);
} else if (command === 'studio') {
  // Giao diện web trên máy dev, thay cho việc gõ từng lệnh
  const repoTarballs = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'dist', 'tarballs');
  // Chỉ chọn thư mục; có đúng bản .tgz hay không thì kiểm tra lúc dùng (có thể `npm run pack` sau khi mở Studio)
  const tgz = process.env['COMPASS_TARBALLS'] ?? (existsSync(repoTarballs) ? repoTarballs : null);
  const { url } = await startStudio({
    port: Number(arg('port', '5310')),
    open: arg('app'),
    tarballs: process.argv.includes('--registry') ? null : tgz,
  });
  console.log(`WealthCompass Studio: ${url}\n(chỉ mở trên máy này; Ctrl+C để tắt, các tiến trình Studio mở sẽ dừng theo)`);
  if (!process.argv.includes('--no-open')) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    (await import('node:child_process')).spawn(opener, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  }
  process.on('SIGINT', () => process.exit(0));
} else if (command === 'setup') {
  const app = arg('app');
  if (!app) {
    console.error('Cách dùng: wealthcompass setup --app <thư mục web Angular> [--pack generic|finance-vn] [--backend-url http://localhost:8890] [--tarballs <thư mục .tgz> | --registry] [--annotate all|màn-hình,...] [--ai-code] [--no-llm] [--force] [--project <tên>]');
    process.exit(1);
  }
  // Gói .tgz: --tarballs, biến COMPASS_TARBALLS, hoặc dist/tarballs của repo (khi chạy từ source)
  const repoTarballs = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'dist', 'tarballs');
  const tarballs = process.argv.includes('--registry')
    ? null
    : resolve(arg('tarballs') ?? process.env['COMPASS_TARBALLS'] ?? repoTarballs);
  if (tarballs && !existsSync(join(tarballs, `wealthcompass-angular-${VERSION}.tgz`))) {
    console.error(`Không thấy gói ${VERSION} trong ${tarballs}. Chạy \`npm run pack\` trong repo WealthCompass trước, chỉ đúng --tarballs, hoặc dùng --registry.`);
    process.exit(1);
  }
  const annotateArg = arg('annotate');
  const result = await setup({
    app,
    project: arg('project'),
    pack: arg('pack', 'generic')!,
    backendUrl: arg('backend-url', 'http://localhost:8890')!,
    tarballs,
    version: VERSION,
    llm: process.argv.includes('--no-llm') ? null : resolveLlmConfig(),
    aiCode: process.argv.includes('--ai-code'),
    annotate: annotateArg ? (annotateArg === 'all' ? 'all' : resolveOnly(annotateArg)!) : null,
    force: process.argv.includes('--force'),
  });
  console.log(`\nXong. Code của web chưa bị sửa.`);
  if (result.patchFile) console.log(`  Patch:    ${result.patchFile} (${result.stats.patchFiles} file)`);
  console.log(`  Báo cáo:  ${result.reportFile}`);
  console.log(`  Backend:  ${result.envFile}`);
  if (result.todo.length) console.log(`\nCần xem (${result.todo.length} mục, chi tiết trong báo cáo):\n` + result.todo.map((t) => '  - ' + t).join('\n'));
} else if (command === 'scan' || command === 'doctor') {
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
    console.error('Cách dùng: compass tour:record --config <yaml> --url <địa chỉ web> --id <tour-id> [--title "..."] [--about "mô tả tính năng"] [--feature <id>] [--mobile] [--force] [--no-llm] [--dry-run]');
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
    mobile: process.argv.includes('--mobile'),
  });
} else if (command === 'tour:verify') {
  // Chạy lại mọi tour trên một bản web thật (staging), báo bước hỏng; --heal sửa locator đã lệch
  const url = arg('url');
  if (!url) {
    console.error('Cách dùng: compass tour:verify --config <yaml> --url <gốc web> [--only id1,id2] [--layout desktop|mobile] [--heal] [--storage-state auth.json] [--screenshots <thư mục>] [--report report.json] [--strict] [--headed]');
    process.exit(1);
  }
  const layout = arg('layout');
  if (layout && layout !== 'desktop' && layout !== 'mobile') {
    console.error('--layout chỉ nhận desktop hoặc mobile');
    process.exit(1);
  }
  const report = await verifyTours({
    config: arg('config', 'compass.config.yaml')!,
    url,
    only: arg('only')?.split(',').map((s) => s.trim()).filter(Boolean),
    layouts: layout ? [layout as 'desktop' | 'mobile'] : undefined,
    heal: process.argv.includes('--heal'),
    storageState: arg('storage-state'),
    screenshots: arg('screenshots'),
    report: arg('report'),
    strict: process.argv.includes('--strict'),
    headed: process.argv.includes('--headed'),
  });
  process.exit(report.summary.failed ? 1 : 0);
} else if (command === 'tour:auth') {
  // Lưu phiên đăng nhập để tour:verify chạy được trên trang cần đăng nhập
  const url = arg('url');
  if (!url) {
    console.error('Cách dùng: compass tour:auth --url <trang đăng nhập> [--out compass.auth.json]');
    process.exit(1);
  }
  const { saveLoginState } = await import('./verify/driver');
  await saveLoginState(url, resolve(arg('out', 'compass.auth.json')!));
} else if (command === 'tour:rerecord') {
  // Ghi lại phần tử của một bước (giữ chữ, giữ khóa bước)
  const url = arg('url');
  const id = arg('id');
  const key = arg('step');
  if (!url || !id || !key) {
    console.error('Cách dùng: compass tour:rerecord --config <yaml> --url <gốc web> --id <tour-id> --step <s1|s2...> [--mobile | --desktop]  (mặc định: bản chính của tour)');
    process.exit(1);
  }
  const layout = process.argv.includes('--mobile') ? 'mobile' : process.argv.includes('--desktop') ? 'desktop' : undefined;
  await rerecordStep({ config: arg('config', 'compass.config.yaml')!, url, id, key, layout });
} else if (command === 'tour:push') {
  // Đưa tour lên kho tour của backend (có phiên bản); widget lấy tour từ đó, không cần deploy lại web
  const server = arg('server');
  const token = arg('token') ?? process.env['COMPASS_ADMIN_TOKEN'];
  if (!server || !token) {
    console.error('Cách dùng: compass tour:push --config <yaml> --server <gốc backend> [--token <khóa> | COMPASS_ADMIN_TOKEN] [--only id1,id2] [--shots <thư mục ảnh của tour:verify>] [--note "..."] [--dry-run]');
    process.exit(1);
  }
  await pushTours({
    config: arg('config', 'compass.config.yaml')!,
    server,
    token,
    only: arg('only')?.split(',').map((s) => s.trim()).filter(Boolean),
    shots: arg('shots'),
    note: arg('note'),
    by: arg('by'),
    dryRun: process.argv.includes('--dry-run'),
  });
} else {
  console.log('Cách dùng: wealthcompass studio [--app <dir>] | setup --app <dir> | doctor --app <dir> | scan --config <compass.config.yaml> [--strict] | enrich --config <yaml> [--only id1,id2] [--dry-run] | annotate --config <yaml> [--only ...] [--out file] [--print] | tour:record ... | tour:verify ... | tour:auth ... | tour:rerecord ... | tour:push ...');
  process.exit(command ? 1 : 0);
}
