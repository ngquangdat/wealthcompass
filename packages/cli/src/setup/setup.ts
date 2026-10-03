import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { Node } from 'ts-morph';
import { parseDocument, type YAMLMap } from 'yaml';
import type { LlmConfig } from '@wealthcompass/llm';
import { annotate } from '../annotate';
import { addEdit, addToDecoratorArray, buildGitPatch, importsEdit, mergeEdits, type EditSet } from '../codemod';
import { enrich } from '../enrich';
import { scan } from '../scan';
import { detectProject, relImport, type AuthGuess, type ProjectInfo } from './detect';
import { analyzeGuards, guessAuthWithLlm, refineGuardsWithLlm, type GuardMapping } from './guards';

export interface SetupOptions {
  app: string;
  project?: string;
  pack: string;
  backendUrl: string;
  // Thư mục chứa các file .tgz (npm run pack); null = cài từ registry theo phiên bản
  tarballs: string | null;
  version: string;
  llm: LlmConfig | null;
  // Cho phép gửi trích đoạn code (service đăng nhập, guard) cho LLM
  aiCode: boolean;
  // Gợi ý tourId luôn trong patch: danh sách màn hình, 'all', hoặc null (không)
  annotate: string[] | 'all' | null;
  force: boolean;
  today?: string;
}

export interface SetupResult {
  info: ProjectInfo;
  configFile: string;
  patchFile: string | null;
  reportFile: string;
  envFile: string;
  guards: GuardMapping[];
  auth: AuthGuess | null;
  todo: string[];
  stats: { screens: number; drafted: number; annotated: number; patchFiles: number };
}

const PKG = '@wealthcompass/angular';

export async function setup(opts: SetupOptions, log: (m: string) => void = console.log): Promise<SetupResult> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const todo: string[] = [];

  // 1) Dò cấu trúc dự án (tĩnh)
  log('1/6 Dò cấu trúc dự án...');
  const info = detectProject(opts.app, opts.project);
  const appDir = info.appDir;
  log(`    app "${info.projectName}", Angular ${info.angularVersion ?? '?'}, ${info.bootstrap?.kind ?? 'không rõ cách khởi động'}`);
  log(`    route: ${info.routesFile ?? '(không thấy)'} · menu: ${info.menuFile ?? '(không thấy)'}`);
  if (!info.routesFile) throw new Error('Không tìm thấy khai báo route; xem các ghi chú: ' + info.notes.join(' | '));

  // 2) compass.config.yaml + overrides (file của WealthCompass, không phải code của web)
  log('2/6 Tạo cấu hình WealthCompass...');
  const configFile = join(appDir, 'compass.config.yaml');
  if (existsSync(configFile) && !opts.force) {
    log('    compass.config.yaml đã có, giữ nguyên (dùng --force để tạo lại).');
  } else {
    writeFileSync(configFile, configYaml(info, opts, today));
  }
  const overridesFile = join(appDir, 'compass.overrides.yaml');
  if (!existsSync(overridesFile)) {
    writeFileSync(overridesFile, '# Phần do người viết/duyệt: mô tả, câu hỏi mẫu, tour. Ưu tiên hơn nội dung quét từ code.\nfeatures: {}\ntours: {}\n');
  }

  // 3) Quét + ánh xạ guard
  log('3/6 Quét route và ánh xạ guard -> quyền...');
  let scanned = scan(configFile);
  const unknown = [...new Set(scanned.featureMap.features.flatMap((f) => f.access.unknownGuards))];
  let guards = analyzeGuards(scanned.project, unknown);
  if (opts.aiCode && opts.llm?.apiKey && guards.some((g) => g.how === 'name')) {
    guards = await refineGuardsWithLlm(scanned.project, guards, opts.llm, log);
  }
  if (guards.length) {
    writeGuards(configFile, guards);
    scanned = scan(configFile);
  }
  for (const g of guards) log(`    ${g.name} -> [${g.requires.join(', ')}] (${g.evidence ?? g.how})`);
  for (const g of guards.filter((x) => x.how === 'name' || x.how === 'unknown')) {
    todo.push(`Kiểm tra quyền của guard \`${g.name}\` trong compass.config.yaml (${g.evidence}).`);
  }
  log(`    ${scanned.featureMap.features.length} màn hình, ${scanned.featureMap.coverage.targetsFound} tourId có sẵn.`);

  // 4) AI soạn nháp mô tả/từ khóa/câu hỏi mẫu cho màn hình còn trống
  let drafted = 0;
  if (opts.llm?.apiKey) {
    log('4/6 AI soạn nháp mô tả màn hình (chỉ điền chỗ trống)...');
    try {
      const res = await enrich({ config: configFile, dryRun: false, llm: opts.llm, today }, (m) => log('    ' + m.trim()));
      drafted = res.drafted.length;
      if (drafted) todo.push(`Duyệt ${drafted} màn hình do AI soạn trong compass.overrides.yaml (xóa khóa \`llmDraft\` sau khi đọc lại).`);
    } catch (e) {
      log(`    ! Bỏ qua bước AI: ${(e as Error).message}`);
    }
  } else {
    log('4/6 Bỏ qua AI soạn mô tả (không có khóa LLM hoặc --no-llm).');
    todo.push('Viết description/keywords cho các màn hình còn thiếu, hoặc chạy `wealthcompass enrich` khi có khóa LLM.');
  }

  // 5) Patch tích hợp (code của web: chỉ xuất patch, không sửa)
  log('5/6 Dựng patch tích hợp...');
  let auth = info.auth;
  if (!auth && opts.aiCode && opts.llm?.apiKey) auth = await guessAuthWithLlm(info.authCandidates, opts.llm, log);
  const edits: EditSet = new Map();
  const suggestions = pickSuggestions(scan(configFile).featureMap.features);
  integrationEdits(info, opts, auth, edits, todo, suggestions);

  let annotated = 0;
  if (opts.annotate) {
    const res = annotate({ config: configFile, only: opts.annotate === 'all' ? undefined : opts.annotate, out: null });
    mergeEdits(edits, res.edits);
    annotated = res.candidates.length;
    if (annotated) todo.push(`Xem ${annotated} gợi ý tourId trong patch, đặc biệt các phần tử bị đánh dấu user-only.`);
  }

  const { patch, base, files } = buildGitPatch(edits, appDir);
  const patchFile = patch ? join(appDir, 'wealthcompass-setup.patch') : null;
  if (patchFile) writeFileSync(patchFile, patch);

  // 6) File cấu hình backend + báo cáo
  log('6/6 Viết file cấu hình backend và báo cáo...');
  const envFile = join(appDir, 'wealthcompass.env');
  if (!existsSync(envFile) || opts.force) writeFileSync(envFile, envText(info, opts, scanned.outFile));
  todo.push('Điền JWKS/issuer/audience của hệ thống đăng nhập vào wealthcompass.env (hoặc dùng IdP giả lập khi thử).');
  todo.push(...info.notes);

  const result: SetupResult = {
    info,
    configFile,
    patchFile,
    reportFile: join(appDir, 'WEALTHCOMPASS_SETUP.md'),
    envFile,
    guards,
    auth,
    todo,
    stats: { screens: scanned.featureMap.features.length, drafted, annotated, patchFiles: files },
  };
  writeFileSync(result.reportFile, report(result, opts, base, today));
  return result;
}

// ---------------------------------------------------------------------------

function configYaml(info: ProjectInfo, opts: SetupOptions, today: string): string {
  const lines = [
    `# Sinh bởi \`wealthcompass setup\` ngày ${today}. Sửa thoải mái; chạy lại setup không ghi đè file này (trừ khi --force).`,
    `domainPack: ${opts.pack}`,
    'locale: vi',
    'backend:',
    `  url: ${opts.backendUrl}`,
    'discovery:',
    `  entry: ${info.routesFile}`,
    ...(info.menuFile ? [`  menu: ${info.menuFile}`] : ['  # menu: src/app/duong-dan/menu.ts   # không tự tìm thấy file menu']),
    '  overrides: compass.overrides.yaml',
    '  out: feature-map.json',
    'access:',
    '  guards: {}',
    '',
  ];
  return lines.join('\n');
}

function writeGuards(configFile: string, guards: GuardMapping[]): void {
  const doc = parseDocument(readFileSync(configFile, 'utf8'));
  if (!doc.hasIn(['access', 'guards'])) doc.setIn(['access', 'guards'], doc.createNode({}));
  const map = doc.getIn(['access', 'guards'], true) as YAMLMap;
  map.flow = false;
  for (const g of guards) {
    if (map.has(g.name)) continue; // người đã khai thì giữ
    const value = doc.createNode({ requires: g.requires }) as YAMLMap;
    value.flow = true;
    // Ghi nguồn gốc ngay cạnh dòng để người duyệt thấy: đọc từ code, hay chỉ đoán từ tên
    value.comment = g.how === 'name' || g.how === 'unknown' ? ` DRAFT: ${g.evidence}, kiểm tra lại` : ` ${g.evidence}`;
    map.set(doc.createNode(g.name), value);
  }
  writeFileSync(configFile, String(doc));
}

// Mỗi màn hình lấy một câu hỏi mẫu dạng "... ở đâu?" (bỏ màn hình đăng nhập), tối đa 3 câu
function pickSuggestions(features: Array<{ id: string; route: { pattern: string }; sampleQuestions: string[] }>): string[] {
  const out: string[] = [];
  for (const f of features) {
    if (/login|dang-nhap|signin|sign-in/.test(f.route.pattern)) continue;
    const q = f.sampleQuestions.find((x) => /ở đâu|o dau|\?$/.test(x) && x.length <= 60);
    if (q) out.push(q.endsWith('?') ? q : q + '?');
    if (out.length === 3) break;
  }
  return out;
}

function integrationEdits(info: ProjectInfo, opts: SetupOptions, auth: AuthGuess | null, edits: EditSet, todo: string[], suggestions: string[]): void {
  const appDir = info.appDir;

  // a) package.json: các gói WealthCompass (+ driver.js vì angular.json trỏ thẳng vào css của nó)
  const pkgFile = join(appDir, 'package.json');
  const pkgText = readFileSync(pkgFile, 'utf8');
  const pkg = JSON.parse(pkgText) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  pkg.dependencies ??= {};
  pkg.devDependencies ??= {};
  const spec = (name: string) => {
    if (!opts.tarballs) return `^${opts.version}`;
    const file = join(opts.tarballs, `wealthcompass-${name}-${opts.version}.tgz`);
    const rel = relative(appDir, file).split('\\').join('/');
    // Tương đối khi gói nằm gần web (cùng repo); quá xa thì dùng tuyệt đối cho dễ đọc
    return `file:${(rel.match(/\.\.\//g)?.length ?? 0) > 3 ? file : rel}`;
  };
  const wanted: Record<string, string> = {
    '@wealthcompass/angular': spec('angular'),
    '@wealthcompass/core': spec('core'),
    '@wealthcompass/contracts': spec('contracts'),
    'driver.js': '^1.8.0',
  };
  let pkgChanged = false;
  for (const [k, v] of Object.entries(wanted)) {
    if (!pkg.dependencies[k]) {
      pkg.dependencies[k] = v;
      pkgChanged = true;
    }
  }
  // Backend và CLI là devDependencies: để chạy thử local bằng `npx wealthcompass-server`, `npx wealthcompass doctor`.
  // Khi chạy thật, backend triển khai như một dịch vụ riêng.
  for (const [k, v] of Object.entries({ '@wealthcompass/server': spec('server'), '@wealthcompass/cli': spec('cli') })) {
    if (!pkg.devDependencies[k] && !pkg.dependencies[k]) {
      pkg.devDependencies[k] = v;
      pkgChanged = true;
    }
  }
  if (pkgChanged) {
    pkg.dependencies = Object.fromEntries(Object.entries(pkg.dependencies).sort(([a], [b]) => a.localeCompare(b)));
    pkg.devDependencies = Object.fromEntries(Object.entries(pkg.devDependencies).sort(([a], [b]) => a.localeCompare(b)));
    addEdit(edits, pkgFile, { pos: 0, end: pkgText.length, text: JSON.stringify(pkg, null, 2) + '\n' });
  }

  // b) angular.json: style của driver.js và theme của WealthCompass (đặt trước style của web để web ghi đè được)
  const ngFile = join(appDir, 'angular.json');
  const ngText = readFileSync(ngFile, 'utf8');
  if (/^\s*\/\//m.test(ngText)) {
    todo.push('angular.json có chú thích nên không tự sửa: thêm "driver.js/dist/driver.css" và "@wealthcompass/angular/compass-theme.scss" vào mảng styles.');
  } else {
    const ng = JSON.parse(ngText);
    const options = ng.projects[info.projectName]?.architect?.build?.options;
    if (options) {
      const styles: unknown[] = Array.isArray(options.styles) ? options.styles : [];
      const add = ['driver.js/dist/driver.css', `${PKG}/compass-theme.scss`].filter((s) => !styles.some((x) => JSON.stringify(x).includes(s)));
      if (add.length) {
        options.styles = [...add, ...styles];
        addEdit(edits, ngFile, { pos: 0, end: ngText.length, text: JSON.stringify(ng, null, 2) + '\n' });
      }
    }
  }

  // c) provideCompass + widget
  const b = info.bootstrap;
  if (!b) {
    todo.push('Không nhận ra cách khởi động app: thêm provideCompass(...) và <compass-chat-widget /> bằng tay (xem integration-guide mục 4).');
    return;
  }
  const providerCode = providerSnippet(opts.backendUrl, auth, suggestions);
  if (!auth) todo.push('Điền getToken trong provideCompass (đang để TODO trả null): trợ lý cần JWT của phiên đăng nhập để gọi backend.');
  else if (!auth.rolesExpr) todo.push(auth.note ?? 'Kiểm tra getCapabilities trong provideCompass.');
  else if (auth.source === 'heuristic' || auth.source === 'llm') todo.push(`Kiểm tra provideCompass: token lấy từ \`${auth.tokenExpr}\`, quyền từ \`${auth.rolesExpr}\` (đoán bằng ${auth.source === 'llm' ? 'AI đọc code' : 'tên thành viên'} của ${auth.service}).`);

  const withImports = (filePath: string, symbols: Array<[string, string]>) => {
    const sf = info.project.getSourceFile(filePath);
    if (!sf) return;
    // Gom theo module để mỗi module chỉ có một câu import
    const byModule = new Map<string, string[]>();
    for (const [symbol, from] of symbols) byModule.set(from, [...(byModule.get(from) ?? []), symbol]);
    for (const [from, list] of byModule) {
      const e = importsEdit(sf, from, list);
      if (e) addEdit(edits, filePath, e);
    }
  };
  const providerImports = (target: string): Array<[string, string]> => [
    ['provideCompass', PKG],
    ...(auth ? ([['inject', '@angular/core'], [auth.service, relImport(target, auth.file)]] as Array<[string, string]>) : []),
  ];

  if (b.kind === 'standalone') {
    if (b.configFile && b.configVar) {
      const sf = info.project.getSourceFile(b.configFile)!;
      const decl = sf.getVariableDeclaration(b.configVar);
      const obj = decl?.getInitializer();
      const providers = obj && Node.isObjectLiteralExpression(obj) ? obj.getProperty('providers') : undefined;
      const arr = providers && Node.isPropertyAssignment(providers) ? providers.getInitializer() : undefined;
      if (/provideCompass\s*\(/.test(sf.getFullText())) {
        // đã có, bỏ qua
      } else if (arr && Node.isArrayLiteralExpression(arr)) {
        const els = arr.getElements();
        const pos = els.length ? els[els.length - 1].getEnd() : arr.getStart() + 1;
        addEdit(edits, b.configFile, { pos, text: `${els.length ? ',' : ''}\n    ${providerCode}` });
        withImports(b.configFile, providerImports(b.configFile));
      } else {
        todo.push(`${relative(appDir, b.configFile)}: không thấy mảng providers literal; thêm provideCompass(...) bằng tay.`);
      }
    }
    const imp = addToDecoratorArray(b.root.cls, 'imports', 'ChatWidgetComponent');
    if (imp.problem) todo.push(imp.problem);
    for (const e of imp.edits) addEdit(edits, b.root.file, e);
    withImports(b.root.file, [['ChatWidgetComponent', PKG]]);
  } else {
    const prov = addToDecoratorArray(b.module.cls, 'providers', providerCode, 'NgModule');
    const imp = addToDecoratorArray(b.module.cls, 'imports', 'ChatWidgetComponent', 'NgModule');
    for (const p of [prov, imp]) if (p.problem) todo.push(p.problem);
    for (const e of [...prov.edits, ...imp.edits]) addEdit(edits, b.module.file, e);
    withImports(b.module.file, [...providerImports(b.module.file), ['ChatWidgetComponent', PKG]]);
  }

  // Thẻ widget ở cuối template của component gốc (chỉ hiện khi đã đăng nhập là tùy web; để người quyết)
  const rootArg = b.root.cls.getDecorator('Component')?.getArguments()[0];
  if (rootArg && Node.isObjectLiteralExpression(rootArg)) {
    const url = rootArg.getProperty('templateUrl');
    const inline = rootArg.getProperty('template');
    if (url && Node.isPropertyAssignment(url)) {
      const lit = url.getInitializer();
      const file = lit && (Node.isStringLiteral(lit) || Node.isNoSubstitutionTemplateLiteral(lit)) ? resolve(b.root.file, '..', lit.getLiteralText()) : null;
      if (file && existsSync(file)) {
        const text = readFileSync(file, 'utf8');
        if (!text.includes('compass-chat-widget')) addEdit(edits, file, { pos: text.length, text: `${text.endsWith('\n') ? '' : '\n'}<compass-chat-widget />\n` });
      }
    } else if (inline && Node.isPropertyAssignment(inline)) {
      const lit = inline.getInitializer();
      if (lit && Node.isNoSubstitutionTemplateLiteral(lit) && !lit.getText().includes('compass-chat-widget') && lit.getText().slice(1, -1) === lit.getLiteralText()) {
        addEdit(edits, b.root.file, { pos: lit.getEnd() - 1, text: '\n<compass-chat-widget />\n' });
      } else if (lit && !lit.getText().includes('compass-chat-widget')) {
        todo.push(`Thêm <compass-chat-widget /> vào template của ${b.root.className} bằng tay.`);
      }
    }
  }
}

function providerSnippet(backendUrl: string, auth: AuthGuess | null, suggestions: string[]): string {
  const sugg = suggestions.length ? [`      suggestions: [${suggestions.map((q) => `'${q.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`).join(', ')}],`] : [];
  if (!auth) {
    return [
      'provideCompass({',
      `      apiBaseUrl: '${backendUrl}',`,
      '      // TODO(wealthcompass): trả về JWT của phiên đăng nhập hiện tại',
      '      getToken: () => null,',
      ...sugg,
      '    })',
    ].join('\n');
  }
  return [
    'provideCompass(() => {',
    `      const auth = inject(${auth.service});`,
    '      return {',
    `        apiBaseUrl: '${backendUrl}',`,
    `        getToken: () => ${auth.tokenExpr} ?? null,`,
    `        getCapabilities: () => ${auth.rolesExpr ? `Array.from(${auth.rolesExpr} ?? [])` : '[]'},`,
    ...sugg.map((l) => '  ' + l),
    '      };',
    '    })',
  ].join('\n');
}

function envText(info: ProjectInfo, opts: SetupOptions, featureMap: string): string {
  const port = info.devPort;
  return [
    '# Cấu hình backend WealthCompass cho web này. Chạy: npx wealthcompass-server --env-file wealthcompass.env',
    '# KHÔNG ghi khóa LLM vào file này; đặt COMPASS_LLM_API_KEY qua biến môi trường/secret.',
    `COMPASS_FEATURE_MAP=${featureMap}`,
    `COMPASS_PACK=${opts.pack}`,
    `COMPASS_ORIGINS=http://localhost:${port},http://127.0.0.1:${port}`,
    `PORT=${new URL(opts.backendUrl).port || 8890}`,
    '',
    '# Xác thực: JWKS của hệ thống đăng nhập (bắt buộc khi chạy thật)',
    '# COMPASS_JWKS_URL=https://sso.example.com/.well-known/jwks.json',
    '# COMPASS_JWT_ISSUER=https://sso.example.com',
    '# COMPASS_JWT_AUDIENCE=my-web',
    'COMPASS_CAPABILITIES_CLAIM=roles',
    '# Thử nhanh khi chưa có JWKS: bật IdP giả lập (tài khoản demo/demo123). Tắt (=0) khi chạy thật.',
    'COMPASS_MOCK_IDP=1',
    '',
    '# LLM: deepseek (mặc định) hoặc gemini; khóa lấy từ biến môi trường',
    'COMPASS_LLM_PROVIDER=deepseek',
    '',
  ].join('\n');
}

function report(r: SetupResult, opts: SetupOptions, base: string, today: string): string {
  const i = r.info;
  const rel = (p: string | null | undefined) => (p ? relative(i.appDir, p) || '.' : '(không có)');
  const patchRel = r.patchFile ? relative(base, r.patchFile) : null;
  const lines = [
    `# WealthCompass: báo cáo setup`,
    '',
    `Sinh ngày ${today} bởi \`wealthcompass setup\`. Code của web **chưa bị sửa**: mọi thay đổi code nằm trong \`wealthcompass-setup.patch\`.`,
    '',
    '## Đã dò được',
    '',
    '| Mục | Kết quả |',
    '| --- | --- |',
    `| App | ${i.projectName} (Angular ${i.angularVersion ?? '?'}) |`,
    `| Khởi động | ${i.bootstrap ? (i.bootstrap.kind === 'standalone' ? `standalone, component gốc ${i.bootstrap.root.className}` : `NgModule ${i.bootstrap.module.className}`) : 'không rõ'} |`,
    `| Route | \`${i.routesFile}\` (${r.stats.screens} màn hình) |`,
    `| Menu | ${i.menuFile ? `\`${i.menuFile}\` (biến ${i.menuVar})` : 'không thấy'} |`,
    `| Đăng nhập | ${r.auth ? `${r.auth.service}: token \`${r.auth.tokenExpr}\`, quyền \`${r.auth.rolesExpr ?? '[]'}\` (${r.auth.source === 'llm' ? 'AI đọc code' : 'đoán từ tên'})` : 'không đoán được (TODO trong patch)'} |`,
    `| Guard | ${r.guards.length ? r.guards.map((g) => `\`${g.name}\` → [${g.requires.join(', ')}]`).join('; ') : 'không có'} |`,
    '',
    '## Đã tạo',
    '',
    `- \`compass.config.yaml\`, \`compass.overrides.yaml\`, \`feature-map.json\`, \`compass.lock.json\`: file của WealthCompass (không phải code của web).`,
    `- \`wealthcompass.env\`: cấu hình backend cho web này.`,
    r.patchFile ? `- \`wealthcompass-setup.patch\`: ${r.stats.patchFiles} file code cần sửa (gói, style, provider, widget${r.stats.annotated ? `, ${r.stats.annotated} gợi ý tourId` : ''}).` : '- Không có thay đổi code nào cần làm.',
    r.stats.drafted ? `- AI đã soạn nháp dữ liệu tìm kiếm cho ${r.stats.drafted} màn hình (đánh dấu \`llmDraft\`).` : '',
    '',
    '## Cần bạn xem',
    '',
    ...r.todo.map((t) => `- [ ] ${t}`),
    '',
    '## Các bước tiếp theo',
    '',
    '```bash',
    ...(patchRel ? [`cd ${base}`, `git apply --check ${patchRel} && git apply ${patchRel}`] : []),
    `cd ${i.appDir}`,
    'npm install',
    `npx wealthcompass-server --env-file wealthcompass.env   # backend (cổng ${new URL(opts.backendUrl).port || 8890})`,
    'npm start                                              # web',
    'npx wealthcompass doctor --app .                       # kiểm tra mọi thứ đã nối đúng',
    '```',
    '',
    `Gói WealthCompass: ${opts.tarballs ? `cài từ file .tgz trong \`${rel(opts.tarballs)}\`` : `phiên bản ^${opts.version} từ registry npm`}.`,
    '',
  ];
  return lines.filter((l, idx, arr) => !(l === '' && arr[idx - 1] === '')).join('\n');
}
