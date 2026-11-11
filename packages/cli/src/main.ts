import { loadConfig, scan } from './scan';
import { recordTour } from './record/run';
import { rerecordStep } from './record/rerecord';
import { verifyTours } from './verify/verify';
import { pushTours } from './verify/push';
import { enrich, resolveOnly } from './enrich';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { layoutSchema, toursFileSchema } from '@wealthcompass/contracts';
import { compassHome, exists, exportProject, importProject, seedDirFor, writeText } from '@wealthcompass/tourdb';
import { CONFIG_NAME, dataRoot, migrateToStore, resolveConfigArg } from './project';
import { readToursFile, writeTours } from './record/write';
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

// Thiết bị khi ghi: --mobile (điện thoại), --tablet (iPad); không có thì desktop
function deviceFlag(): 'mobile' | 'tablet' | undefined {
  return process.argv.includes('--mobile') ? 'mobile' : process.argv.includes('--tablet') ? 'tablet' : undefined;
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
  const { url } = await startStudio({
    port: Number(arg('port', '5310')),
    open: arg('app'),
  });
  console.log(`WealthCompass Studio: ${url}\n(chỉ mở trên máy này; Ctrl+C để tắt, các tiến trình Studio mở sẽ dừng theo)`);
  if (!process.argv.includes('--no-open')) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    (await import('node:child_process')).spawn(opener, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  }
  process.on('SIGINT', () => process.exit(0));
} else if (command === 'init') {
  // Chưa có source của web: tạo cấu hình tối thiểu để ghi tour bằng URL (màn hình sinh từ tour đã ghi)
  const url = arg('url');
  if (!url || !/^https?:\/\//.test(url)) {
    console.error('Cách dùng: wealthcompass init --url <địa chỉ web> [--name <tên dự án>]');
    process.exit(1);
  }
  // Kho dự án: file SQLite ngoài mọi source, đặt tên theo tên miền của web (hoặc --name)
  const name = (arg('name') ?? new URL(url).hostname).replace(/[^\w.-]/g, '_');
  const db = arg('db') ? resolve(arg('db')!) : join(compassHome(), 'projects', `${name}.db`);
  const file = join(db, 'compass.config.yaml');
  if (exists(file) && !process.argv.includes('--force')) {
    console.error(`Kho dự án ${db} đã có cấu hình. Dùng --force để ghi đè, hoặc --name <tên khác>.`);
    process.exit(1);
  }
  writeText(
    file,
    [
      '# WealthCompass: dự án tour chưa có source của web. Khi có source, chạy `wealthcompass setup --app <thư mục web>`.',
      'locale: vi',
      `web: { url: ${JSON.stringify(new URL(url).origin)} }`,
      'discovery:',
      '  source: none',
      '',
    ].join('\n'),
  );
  if (!exists(join(db, 'compass.overrides.yaml'))) {
    writeText(join(db, 'compass.overrides.yaml'), '# Mô tả màn hình cho trợ lý. Khai màn hình có tham số: features: { orders.detail: { route: /orders/:id, title: ... } }\nfeatures: {}\n');
  }
  console.log(`Đã tạo kho dự án ${db}\nGhi tour: wealthcompass tour:record --app ${db} --id <tour-id>   (hoặc: wealthcompass studio --app ${db})`);
} else if (command === 'project:export' || command === 'project:import') {
  // Xuất cả kho dự án ra thư mục file văn bản (sao lưu, chuyển máy, bản mẫu commit cùng repo), hoặc nhập lại
  const app = arg('app');
  if (!app) {
    console.error('Cách dùng: wealthcompass project:export --app <thư mục web | file kho> [--out <thư mục>]   |   project:import --app <thư mục web | file kho> [--from <thư mục>]\nMặc định dùng thư mục bản mẫu cạnh source: <thư mục web>.compass');
    process.exit(1);
  }
  const abs = resolve(app);
  const db = dataRoot(abs);
  if (!db.endsWith('.db')) {
    console.error(`${abs} là dự án kiểu cũ (file cạnh source). Chạy \`wealthcompass migrate --app ${abs}\` trước.`);
    process.exit(1);
  }
  const dir = resolve(arg(command === 'project:export' ? 'out' : 'from') ?? seedDirFor(abs));
  const names = command === 'project:export' ? exportProject(db, dir) : importProject(db, dir, abs.endsWith('.db') ? undefined : abs);
  console.log(`${command === 'project:export' ? `Đã xuất kho ${db} ra ${dir}` : `Đã nhập ${dir} vào kho ${db}`}:\n` + names.map((n) => `  - ${n}`).join('\n'));
} else if (command === 'migrate') {
  // Chuyển dự án kiểu cũ (file của WealthCompass nằm cạnh source) vào kho dự án SQLite ngoài source, rồi xóa các file đó
  const app = arg('app');
  if (!app || !existsSync(join(resolve(app), CONFIG_NAME))) {
    console.error('Cách dùng: wealthcompass migrate --app <thư mục web còn compass.config.yaml cạnh source>');
    process.exit(1);
  }
  const result = migrateToStore(resolve(app));
  console.log(`Đã chuyển vào kho dự án ${result.db}:\n` + result.moved.map((m) => `  - ${m}`).join('\n'));
  if (result.left.length) console.log('Giữ lại trong source (không thuộc kho):\n' + result.left.map((m) => `  - ${m}`).join('\n'));
  console.log(`Chạy backend: COMPASS_PROJECT=${result.db} wealthcompass-server   ·   Studio: wealthcompass studio --app ${resolve(app)}`);
} else if (command === 'setup') {
  const app = arg('app');
  if (!app) {
    console.error('Cách dùng: wealthcompass setup --app <thư mục web Angular> [--backend-url http://localhost:8890] [--tarballs <thư mục .tgz> | --registry] [--ai-code] [--no-llm] [--force] [--project <tên>]');
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
  const result = await setup({
    app,
    project: arg('project'),
    backendUrl: arg('backend-url', 'http://localhost:8890')!,
    tarballs,
    version: VERSION,
    llm: process.argv.includes('--no-llm') ? null : resolveLlmConfig(),
    aiCode: process.argv.includes('--ai-code'),
    force: process.argv.includes('--force'),
  });
  console.log(`\nXong. Code của web chưa bị sửa.`);
  if (result.patchFile) console.log(`  Patch:    ${result.patchFile} (${result.stats.patchFiles} file)`);
  console.log(`  Báo cáo:  ${result.reportFile}`);
  console.log(`  Backend:  ${result.envFile}`);
  if (result.todo.length) console.log(`\nCần xem (${result.todo.length} mục, chi tiết trong báo cáo):\n` + result.todo.map((t) => '  - ' + t).join('\n'));
} else if (command === 'scan' || command === 'doctor') {
  const config = resolveConfigArg(arg('config'), arg('app'));
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
} else if (command === 'enrich') {
  // Soạn nháp description/keywords/sampleQuestions cho màn hình còn thiếu; chỉ điền chỗ trống
  await enrich({
    config: resolveConfigArg(arg('config'), arg('app')),
    dryRun: process.argv.includes('--dry-run'),
    only: resolveOnly(arg('only')),
    llm: resolveLlmConfig(),
  });
} else if (command === 'tour:record') {
  const id = arg('id');
  // --url bỏ qua được khi compass.config.yaml có web.url
  let url = arg('url');
  if (!url) {
    try {
      url = loadConfig(resolveConfigArg(arg('config'), arg('app'))).config.web?.url;
    } catch {
      url = undefined;
    }
  }
  if (!url || !id) {
    console.error('Cách dùng: compass tour:record --config <yaml> --url <địa chỉ web> --id <tour-id> [--title "..."] [--about "mô tả tính năng"] [--feature <id>] [--mobile | --tablet] [--force] [--no-llm] [--dry-run]');
    process.exit(1);
  }
  await recordTour({
    config: resolveConfigArg(arg('config'), arg('app')),
    url,
    id,
    title: arg('title'),
    feature: arg('feature'),
    about: arg('about'),
    force: process.argv.includes('--force'),
    noLlm: process.argv.includes('--no-llm'),
    dryRun: process.argv.includes('--dry-run'),
    device: deviceFlag(),
  });
} else if (command === 'tour:export' || command === 'tour:import') {
  // Kho tour là SQLite (nhị phân): xuất ra JSON để xem/sửa tay các trường nâng cao (list.index, rowText, chữ bản mobile), rồi nhập lại
  const { config, root } = loadConfig(resolveConfigArg(arg('config'), arg('app')));
  const db = join(root, config.discovery.tours);
  const file = resolve(arg('file', 'compass.tours.export.json')!);
  if (command === 'tour:export') {
    writeFileSync(file, JSON.stringify(readToursFile(db), null, 2) + '\n');
    console.log(`Đã xuất ${Object.keys(readToursFile(db).tours).length} tour ra ${file}. Sửa xong chạy: wealthcompass tour:import --file ${file}`);
  } else {
    if (!existsSync(file)) {
      console.error(`Không thấy ${file}. Cách dùng: wealthcompass tour:import --config <yaml> --file <json đã xuất bằng tour:export>`);
      process.exit(1);
    }
    const data = toursFileSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    // Chỉ thêm/cập nhật tour có trong file; tour khác trong kho giữ nguyên
    writeTours(db, { tours: { ...readToursFile(db).tours, ...data.tours } }, 'tour:import', `Nhập từ ${file}`);
    console.log(`Đã nhập ${Object.keys(data.tours).length} tour vào kho. Chạy \`scan\` để cập nhật Feature Map.`);
  }
} else if (command === 'tour:verify') {
  // Chạy lại mọi tour trên một bản web thật (staging), báo bước hỏng; --heal sửa locator đã lệch
  const url = arg('url');
  if (!url) {
    console.error('Cách dùng: compass tour:verify --config <yaml> --url <gốc web> [--only id1,id2] [--layout desktop|tablet|mobile] [--heal] [--storage-state auth.json] [--screenshots <thư mục>] [--report report.json] [--strict] [--headed]');
    process.exit(1);
  }
  const layout = arg('layout');
  if (layout && !layoutSchema.safeParse(layout).success) {
    console.error('--layout chỉ nhận desktop, tablet hoặc mobile');
    process.exit(1);
  }
  const report = await verifyTours({
    config: resolveConfigArg(arg('config'), arg('app')),
    url,
    only: arg('only')?.split(',').map((s) => s.trim()).filter(Boolean),
    layouts: layout ? [layoutSchema.parse(layout)] : undefined,
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
    console.error('Cách dùng: compass tour:rerecord --config <yaml> --url <gốc web> --id <tour-id> --step <s1|s2...> [--mobile | --tablet | --desktop]  (mặc định: bản chính của tour)');
    process.exit(1);
  }
  const layout = process.argv.includes('--desktop') ? 'desktop' : deviceFlag();
  await rerecordStep({ config: resolveConfigArg(arg('config'), arg('app')), url, id, key, layout });
} else if (command === 'tour:push') {
  // Đưa tour lên kho tour của backend (có phiên bản); widget lấy tour từ đó, không cần deploy lại web
  const server = arg('server');
  const token = arg('token') ?? process.env['COMPASS_ADMIN_TOKEN'];
  if (!server || !token) {
    console.error('Cách dùng: compass tour:push --config <yaml> --server <gốc backend> [--token <khóa> | COMPASS_ADMIN_TOKEN] [--only id1,id2] [--shots <thư mục ảnh của tour:verify>] [--note "..."] [--dry-run]');
    process.exit(1);
  }
  await pushTours({
    config: resolveConfigArg(arg('config'), arg('app')),
    server,
    token,
    only: arg('only')?.split(',').map((s) => s.trim()).filter(Boolean),
    shots: arg('shots'),
    note: arg('note'),
    by: arg('by'),
    dryRun: process.argv.includes('--dry-run'),
  });
} else {
  console.log('Cách dùng: wealthcompass studio [--app <dir>] | setup --app <dir> | init --url <web> [--name <tên>] | migrate --app <dir> | project:export --app <dir> | project:import --app <dir> | doctor --app <dir> | scan --config <compass.config.yaml> [--strict] | enrich --config <yaml> [--only id1,id2] [--dry-run] | tour:record ... | tour:verify ... | tour:auth ... | tour:rerecord ... | tour:push ... | tour:export [--file x.json] | tour:import --file x.json');
  process.exit(command ? 1 : 0);
}
