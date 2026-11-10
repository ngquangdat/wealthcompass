import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { exists, readText } from '@wealthcompass/tourdb';
import { dataRoot } from '../project';
import { scan } from '../scan';
import { detectProject } from './detect';
import { analyzeGuards } from './guards';
import { setup, type SetupOptions } from './setup';

const fixtures = resolve(import.meta.dirname, '../../test-fixtures');

// Bản sao app mẫu trong một repo git riêng để thử `git apply` thật
function tempRepo(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `compass-setup-${name}-`));
  cpSync(join(fixtures, name), dir, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init');
  return dir;
}

// Thư mục .tgz giả (setup chỉ cần đường dẫn, không đọc nội dung)
function fakeTarballs(): string {
  const dir = mkdtempSync(join(tmpdir(), 'compass-tgz-'));
  mkdirSync(dir, { recursive: true });
  for (const n of ['angular', 'core', 'contracts', 'cli', 'server']) writeFileSync(join(dir, `wealthcompass-${n}-0.1.0.tgz`), '');
  return dir;
}

const options = (app: string, extra: Partial<SetupOptions> = {}): SetupOptions => ({
  app,
  backendUrl: 'http://localhost:8890',
  tarballs: fakeTarballs(),
  version: '0.1.0',
  llm: null,
  aiCode: false,
  force: false,
  today: '2026-10-03',
  ...extra,
});

const git = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir }).toString();

test('dò cấu trúc: route, menu khóa title/link/items, cách khởi động, service đăng nhập', () => {
  const info = detectProject(join(fixtures, 'setup-app'));
  assert.equal(info.projectName, 'shop');
  assert.equal(info.devPort, 4300);
  assert.equal(info.routesFile, 'src/app/app.routes.ts');
  assert.equal(info.menuFile, 'src/app/layout/nav.ts');
  assert.equal(info.bootstrap?.kind, 'standalone');
  assert.equal(info.bootstrap?.root.className, 'App');
  assert.equal(info.auth?.service, 'AuthService');
  assert.equal(info.auth?.tokenExpr, 'auth.getAccessToken()');
  assert.equal(info.auth?.rolesExpr, 'auth.roles()', 'computed() là signal nên phải gọi ()');
});

test('menu khóa khác tên vẫn ra đúng menuPath; title thiếu thì lấy nhãn menu', () => {
  const dir = tempRepo('setup-app');
  writeFileSync(join(dir, 'compass.config.yaml'), 'discovery:\n  entry: src/app/app.routes.ts\n  menu: src/app/layout/nav.ts\n');
  const { featureMap } = scan(join(dir, 'compass.config.yaml'));
  const returns = featureMap.features.find((f) => f.route.pattern === '/orders/returns')!;
  assert.deepEqual(returns.menuPath, ['Đơn hàng', 'Trả hàng']);
  assert.equal(returns.title, 'Trả hàng');
});

test('gợi ý quyền của guard: đăng nhập / đọc từ code / không rõ thì chỉ cần đăng nhập (không đoán từ tên)', () => {
  const info = detectProject(join(fixtures, 'setup-app'));
  const map = Object.fromEntries(analyzeGuards(info.project, ['authGuard', 'adminGuard', 'reportsGuard', 'ghostGuard']).map((g) => [g.name, g]));
  assert.deepEqual([map.authGuard.how, map.authGuard.requires], ['auth', []]);
  assert.deepEqual([map.adminGuard.how, map.adminGuard.requires], ['code', ['shop_admin']]);
  assert.deepEqual([map.reportsGuard.how, map.reportsGuard.requires], ['default', []]);
  assert.deepEqual([map.ghostGuard.how, map.ghostGuard.requires], ['default', []]);
});

test('setup (standalone): không sửa code, patch áp được, sau khi áp đủ gói/style/provider/widget', async () => {
  const dir = tempRepo('setup-app');
  const result = await setup(options(dir), () => undefined);
  assert.equal(git(dir, 'status', '--porcelain', '--', 'src', 'package.json', 'angular.json'), '', 'code của web chưa bị đụng');

  const config = readText(result.configFile);
  // Quyền mặc định là chỉ cần đăng nhập: setup không tự ghi quyền nào, chuỗi quyền trong code chỉ là gợi ý trong báo cáo
  assert.doesNotMatch(config, /adminGuard|reportsGuard/);
  assert.ok(!result.todo.some((t) => /guard/i.test(t)));
  assert.match(readFileSync(result.reportFile, 'utf8'), /Mặc định mọi màn hình chỉ cần đăng nhập.*`adminGuard` → \[shop_admin\]/);
  assert.ok(scan(result.configFile).featureMap.features.every((f) => f.access.requires.length === 0), 'mọi màn hình chỉ cần đăng nhập');
  assert.ok(!scan(result.configFile).featureMap.coverage.warnings.some((w) => /guard/i.test(w)));

  execFileSync('git', ['apply', '--check', result.patchFile!], { cwd: dir });
  execFileSync('git', ['apply', result.patchFile!], { cwd: dir });

  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.match(pkg.dependencies['@wealthcompass/angular'], /^file:.*wealthcompass-angular-0\.1\.0\.tgz$/);
  assert.equal(pkg.dependencies['driver.js'], '^1.8.0');
  assert.ok(!JSON.stringify(pkg).includes('@wealthcompass/server') && !JSON.stringify(pkg).includes('@wealthcompass/cli'), 'web chỉ cài lib giao diện; backend và CLI chạy độc lập');
  const ng = JSON.parse(readFileSync(join(dir, 'angular.json'), 'utf8'));
  assert.deepEqual(ng.projects.shop.architect.build.options.styles, ['driver.js/dist/driver.css', '@wealthcompass/angular/compass-theme.scss', 'src/styles.css']);

  const appConfig = readFileSync(join(dir, 'src/app/app.config.ts'), 'utf8');
  assert.match(appConfig, /import \{ provideCompass \} from '@wealthcompass\/angular';/);
  assert.match(appConfig, /import \{ AuthService \} from '\.\/core\/auth\.service';/);
  assert.match(appConfig, /import \{ ApplicationConfig, inject \} from '@angular\/core';/);
  assert.match(appConfig, /getToken: \(\) => auth\.getAccessToken\(\) \?\? null,/);
  assert.match(appConfig, /getCapabilities: \(\) => Array\.from\(auth\.roles\(\) \?\? \[\]\),/);
  const app = readFileSync(join(dir, 'src/app/app.ts'), 'utf8');
  assert.match(app, /imports: \[RouterOutlet, ChatWidgetComponent\]/);
  assert.match(app, /import \{ ChatWidgetComponent \} from '@wealthcompass\/angular';/);
  assert.match(readFileSync(join(dir, 'src/app/app.html'), 'utf8'), /<compass-chat-widget \/>/);

  const env = readText(result.envFile);
  assert.match(env, /COMPASS_ORIGINS=http:\/\/localhost:4300/, 'origin lấy từ cổng dev của angular.json');
  assert.match(readFileSync(result.reportFile, 'utf8'), /## Cần bạn xem/);
});

test('setup chạy lại sau khi đã áp patch: không còn gì để sửa', async () => {
  const dir = tempRepo('setup-app');
  const first = await setup(options(dir), () => undefined);
  execFileSync('git', ['apply', first.patchFile!], { cwd: dir });
  const second = await setup(options(dir), () => undefined);
  assert.equal(second.patchFile, null);
  assert.equal(second.stats.patchFiles, 0);
});

test('setup (NgModule): provider và widget vào AppModule, thẻ widget vào template của component gốc', async () => {
  const dir = tempRepo('setup-ngmodule-app');
  const result = await setup(options(dir), () => undefined);
  assert.equal(result.info.bootstrap?.kind, 'ngmodule');
  execFileSync('git', ['apply', '--check', result.patchFile!], { cwd: dir });
  execFileSync('git', ['apply', result.patchFile!], { cwd: dir });
  const mod = readFileSync(join(dir, 'src/app/app.module.ts'), 'utf8');
  assert.match(mod, /imports: \[BrowserModule, RouterModule\.forRoot\(routes\), ChatWidgetComponent\]/);
  assert.match(mod, /providers: \[provideCompass\(\(\) => \{/);
  assert.match(mod, /import \{ ChatWidgetComponent, provideCompass \} from '@wealthcompass\/angular';|import \{ provideCompass, ChatWidgetComponent \} from '@wealthcompass\/angular';/);
  assert.match(readFileSync(join(dir, 'src/app/app.component.html'), 'utf8'), /<compass-chat-widget \/>/);
});

// --ai-code: LLM giả trả lời cố định
async function fakeLlm(reply: (body: any) => unknown) {
  const { createServer } = await import('node:http');
  const requests: any[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      requests.push(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply(body)) } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as import('node:net').AddressInfo).port;
  return { llm: { provider: 'fake', baseUrl: `http://127.0.0.1:${port}`, apiKey: 'k', model: 'm' }, requests, close: () => new Promise<void>((r) => server.close(() => r())) };
}


test('--ai-code: LLM chọn thành viên, nhưng biểu thức do code dựng; tên bịa hoặc chèn code bị từ chối', async () => {
  const { guessAuthWithLlm } = await import('./guards');
  const info = detectProject(join(fixtures, 'setup-app'));
  const good = await fakeLlm(() => ({ service: 'AuthService', tokenMember: 'getAccessToken', rolesMember: 'roles' }));
  const ok = await guessAuthWithLlm(info.authCandidates, good.llm, () => undefined);
  await good.close();
  assert.deepEqual([ok?.tokenExpr, ok?.rolesExpr, ok?.source], ['auth.getAccessToken()', 'auth.roles()', 'llm']);

  const evil = await fakeLlm(() => ({ service: 'AuthService', tokenMember: "getAccessToken(); fetch('https://x')", rolesMember: null }));
  assert.equal(await guessAuthWithLlm(info.authCandidates, evil.llm, () => undefined), null, 'thành viên không có thật thì không dùng');
  await evil.close();
  const ghost = await fakeLlm(() => ({ service: 'GhostService', tokenMember: 'token' }));
  assert.equal(await guessAuthWithLlm(info.authCandidates, ghost.llm, () => undefined), null, 'service không nằm trong ứng viên');
  await ghost.close();
});

test('AI đọc code guard: chỉ guard chưa đọc được quyền mới được gửi cho LLM; đầu ra sai định dạng bị bỏ', async () => {
  const { analyzeGuards, refineGuardsWithLlm } = await import('./guards');
  const info = detectProject(join(fixtures, 'setup-app'));
  const base = analyzeGuards(info.project, ['adminGuard', 'reportsGuard']);
  const fake = await fakeLlm(() => ({ requires: ['report_viewer'], reason: 'startsWith report' }));
  const refined = await refineGuardsWithLlm(info.project, base, fake.llm, () => undefined);
  await fake.close();
  assert.equal(fake.requests.length, 1, 'adminGuard đã đọc được từ code nên không gửi');
  assert.match(fake.requests[0].messages[1].content, /reportsGuard/);
  assert.deepEqual(refined.find((g) => g.name === 'reportsGuard')?.requires, ['report_viewer']);

  const bad = await fakeLlm(() => ({ requires: ['x; drop table'] }));
  const kept = await refineGuardsWithLlm(info.project, base, bad.llm, () => undefined);
  await bad.close();
  assert.deepEqual([kept.find((g) => g.name === 'reportsGuard')?.how, kept.find((g) => g.name === 'reportsGuard')?.requires], ['default', []], 'chuỗi quyền không hợp lệ thì vẫn là chỉ cần đăng nhập');
});

test('setup: dữ liệu nằm trong kho dự án ngoài source; source web không có file nào của WealthCompass, .gitignore không bị đụng', async () => {
  const dir = tempRepo('setup-app');
  writeFileSync(join(dir, '.gitignore'), 'node_modules');
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'gi');
  const result = await setup(options(dir), () => undefined);
  // Mọi dữ liệu là tài liệu trong một file SQLite ngoài thư mục web
  const db = dataRoot(dir);
  assert.ok(db.endsWith('.db') && !db.startsWith(dir), db);
  assert.equal(result.configFile, join(db, 'compass.config.yaml'));
  for (const name of ['compass.config.yaml', 'compass.overrides.yaml', 'feature-map.json', 'compass.lock.json', 'wealthcompass.env']) assert.ok(exists(join(db, name)), name);
  assert.match(readText(result.configFile), new RegExp(`sourceDir: "${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  // Trong source chỉ có patch và báo cáo (tạm, để áp rồi xóa)
  for (const name of ['compass.config.yaml', 'compass.overrides.yaml', 'feature-map.json', 'compass.lock.json', 'wealthcompass.env', 'compass.tours.db']) assert.equal(existsSync(join(dir, name)), false, name);
  assert.doesNotMatch(readFileSync(result.patchFile!, 'utf8'), /\.gitignore|compass\.config|feature-map/);
  assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), 'node_modules');
  // Quét lại và doctor đọc từ kho
  assert.equal(scan(result.configFile).featureMap.features.length, result.stats.screens);
});
