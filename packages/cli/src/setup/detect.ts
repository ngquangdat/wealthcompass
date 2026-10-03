import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { ClassDeclaration, Node, Project, SourceFile, SyntaxKind } from 'ts-morph';
import { menuCandidates } from '../menu';

// Dò cấu trúc một dự án Angular CHỈ bằng phân tích tĩnh (không gọi LLM, không chạy app).
// Kết quả dùng để sinh config và patch tích hợp; chỗ nào không chắc thì ghi vào `notes` để người xử lý.

export interface ComponentRef {
  file: string;
  className: string;
  cls: ClassDeclaration;
}

export type Bootstrap =
  | { kind: 'standalone'; mainFile: string; root: ComponentRef; configFile?: string; configVar?: string }
  | { kind: 'ngmodule'; mainFile: string; root: ComponentRef; module: ComponentRef };

export interface AuthGuess {
  service: string;
  file: string;
  tokenExpr: string | null;
  rolesExpr: string | null;
  // heuristic: suy từ tên thành viên; llm: do LLM đọc code (chỉ khi bật --ai-code)
  source: 'heuristic' | 'llm';
  note?: string;
}

export interface ProjectInfo {
  appDir: string;
  projectName: string;
  angularVersion: string | null;
  tsconfigApp: string;
  sourceRoot: string;
  devPort: number;
  routesFile: string | null;
  routesVar: string | null;
  menuFile: string | null;
  menuVar: string | null;
  bootstrap: Bootstrap | null;
  auth: AuthGuess | null;
  authCandidates: ClassDeclaration[];
  project: Project;
  notes: string[];
}

interface AngularJson {
  projects: Record<string, { projectType?: string; root?: string; sourceRoot?: string; architect?: Record<string, { options?: Record<string, unknown> }> }>;
}

function readJson<T>(file: string): T {
  // angular.json đôi khi có chú thích; bỏ chú thích dòng trước khi parse
  return JSON.parse(readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '')) as T;
}

export function detectProject(appDirInput: string, projectName?: string): ProjectInfo {
  const appDir = resolve(appDirInput);
  const notes: string[] = [];
  const angularJsonPath = join(appDir, 'angular.json');
  if (!existsSync(angularJsonPath)) throw new Error(`Không thấy angular.json trong ${appDir}. Trỏ --app vào thư mục gốc của web Angular.`);
  const ng = readJson<AngularJson>(angularJsonPath);

  const apps = Object.entries(ng.projects).filter(([, p]) => (p.projectType ?? 'application') === 'application');
  if (!apps.length) throw new Error('angular.json không có project kiểu application.');
  const chosen = projectName ? apps.find(([n]) => n === projectName) : apps[0];
  if (!chosen) throw new Error(`Không có project "${projectName}" trong angular.json (có: ${apps.map(([n]) => n).join(', ')}).`);
  if (!projectName && apps.length > 1) notes.push(`Có ${apps.length} app trong angular.json, đang dùng "${chosen[0]}" (đổi bằng --project).`);
  const [name, proj] = chosen;

  const buildOpts = proj.architect?.['build']?.options ?? {};
  const tsconfigApp = resolve(appDir, String(buildOpts['tsConfig'] ?? 'tsconfig.app.json'));
  const mainRel = String(buildOpts['browser'] ?? buildOpts['main'] ?? 'src/main.ts');
  const serveOpts = proj.architect?.['serve']?.options ?? {};
  const devPort = Number(serveOpts['port'] ?? 4200);

  let angularVersion: string | null = null;
  try {
    const pkg = readJson<{ dependencies?: Record<string, string> }>(join(appDir, 'package.json'));
    angularVersion = pkg.dependencies?.['@angular/core'] ?? null;
  } catch {
    notes.push('Không đọc được package.json.');
  }
  const major = Number(angularVersion?.match(/(\d+)/)?.[1] ?? 0);
  if (major && major < 20) notes.push(`Angular ${angularVersion}: WealthCompass hỗ trợ từ v20; có thể vẫn chạy nhưng chưa được kiểm thử.`);

  const project = new Project({ tsConfigFilePath: tsconfigApp });
  const files = project.getSourceFiles().filter((f) => !f.getFilePath().includes('/node_modules/') && !f.getFilePath().endsWith('.spec.ts'));

  const { routesFile, routesVar } = findRoutes(files, appDir, notes);
  const { menuFile, menuVar } = findMenu(files, appDir, notes);
  const bootstrap = findBootstrap(project, resolve(appDir, mainRel), notes);
  const authCandidates = findAuthCandidates(files);
  const auth = guessAuthHeuristic(authCandidates);
  if (!auth) notes.push('Không đoán được service đăng nhập; getToken trong patch để TODO (hoặc chạy lại với --ai-code để LLM đọc code service).');

  return {
    appDir,
    projectName: name,
    angularVersion,
    tsconfigApp,
    sourceRoot: resolve(appDir, proj.sourceRoot ?? 'src'),
    devPort,
    routesFile,
    routesVar,
    menuFile,
    menuVar,
    bootstrap,
    auth,
    authCandidates,
    project,
    notes,
  };
}

// provideRouter(routes) hoặc RouterModule.forRoot(routes) → file khai báo biến routes
function findRoutes(files: SourceFile[], appDir: string, notes: string[]): { routesFile: string | null; routesVar: string | null } {
  for (const file of files) {
    for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression().getText();
      if (callee !== 'provideRouter' && callee !== 'RouterModule.forRoot') continue;
      const arg = call.getArguments()[0];
      if (!arg) continue;
      if (Node.isIdentifier(arg)) {
        const decl = arg.getDefinitionNodes().find(Node.isVariableDeclaration);
        if (decl) return { routesFile: relative(appDir, decl.getSourceFile().getFilePath()), routesVar: decl.getName() };
      }
      notes.push(`${relative(appDir, file.getFilePath())}: ${callee}(...) nhận mảng route viết trực tiếp; hãy tách ra một biến \`export const routes: Routes = [...]\` để scanner đọc được.`);
    }
  }
  notes.push('Không tìm thấy provideRouter(...) hoặc RouterModule.forRoot(...).');
  return { routesFile: null, routesVar: null };
}

function findMenu(files: SourceFile[], appDir: string, notes: string[]): { menuFile: string | null; menuVar: string | null } {
  const all = files.flatMap((f) => menuCandidates(f)).sort((a, b) => b.score - a.score);
  const best = all[0];
  if (!best || best.score < 2) {
    notes.push('Không thấy file menu dạng mảng literal; "nằm ở đâu trong menu" sẽ dựa vào tiêu đề màn hình. Có thể khai `discovery.menu` bằng tay.');
    return { menuFile: null, menuVar: null };
  }
  if (all[1] && all[1].score >= best.score * 0.8 && all[1].file !== best.file) {
    notes.push(`Có nhiều mảng giống menu: chọn ${best.name} (${relative(appDir, best.file.getFilePath())}); kiểm tra lại discovery.menu.`);
  }
  return { menuFile: relative(appDir, best.file.getFilePath()), menuVar: best.name };
}

function classOf(node: Node | undefined): ClassDeclaration | undefined {
  if (!node || !Node.isIdentifier(node)) return undefined;
  return node.getDefinitionNodes().find(Node.isClassDeclaration);
}

function findBootstrap(project: Project, mainFile: string, notes: string[]): Bootstrap | null {
  const main = project.getSourceFile(mainFile) ?? project.addSourceFileAtPathIfExists(mainFile);
  if (!main) {
    notes.push(`Không đọc được ${mainFile}.`);
    return null;
  }
  for (const call of main.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression().getText();
    if (callee === 'bootstrapApplication') {
      const [rootArg, configArg] = call.getArguments();
      const root = classOf(rootArg);
      if (!root) break;
      let configFile: string | undefined;
      let configVar: string | undefined;
      if (configArg && Node.isIdentifier(configArg)) {
        const decl = configArg.getDefinitionNodes().find(Node.isVariableDeclaration);
        if (decl) {
          configFile = decl.getSourceFile().getFilePath();
          configVar = decl.getName();
        }
      }
      if (!configVar) notes.push('bootstrapApplication không có biến cấu hình (appConfig); provider sẽ phải thêm bằng tay.');
      return { kind: 'standalone', mainFile, root: ref(root), configFile, configVar };
    }
    if (callee.endsWith('.bootstrapModule')) {
      const mod = classOf(call.getArguments()[0]);
      if (!mod) break;
      const arg = mod.getDecorator('NgModule')?.getArguments()[0];
      const bootstrapProp = arg && Node.isObjectLiteralExpression(arg) ? arg.getProperty('bootstrap') : undefined;
      const first = bootstrapProp && Node.isPropertyAssignment(bootstrapProp) ? bootstrapProp.getInitializer() : undefined;
      const root = first && Node.isArrayLiteralExpression(first) ? classOf(first.getElements()[0]) : undefined;
      if (!root) {
        notes.push('Không tìm thấy component trong `bootstrap: [...]` của NgModule.');
        return null;
      }
      return { kind: 'ngmodule', mainFile, root: ref(root), module: ref(mod) };
    }
  }
  notes.push('Không nhận ra cách khởi động app trong main.ts (bootstrapApplication / bootstrapModule).');
  return null;
}

function ref(cls: ClassDeclaration): ComponentRef {
  return { file: cls.getSourceFile().getFilePath(), className: cls.getName() ?? '', cls };
}

// ---------------------------------------------------------------------------
// Service đăng nhập: tìm theo tên và thành viên, KHÔNG gửi code đi đâu
// ---------------------------------------------------------------------------

const AUTH_NAME = /auth|session|identity|account|login|user|token|security/i;
const TOKEN_MEMBER = /^(get)?(access|id|jwt|auth|bearer)?_?token$|^(get)?jwt$|^token$/i;
const ROLE_MEMBER = /^(get)?(roles|permissions|authorities|scopes|capabilities)$/i;

export function findAuthCandidates(files: SourceFile[]): ClassDeclaration[] {
  const scored: Array<{ cls: ClassDeclaration; score: number }> = [];
  for (const file of files) {
    for (const cls of file.getClasses()) {
      if (!cls.getDecorator('Injectable')) continue;
      const name = cls.getName() ?? '';
      let score = AUTH_NAME.test(name) ? 2 : 0;
      for (const m of memberNames(cls)) {
        if (TOKEN_MEMBER.test(m)) score += 3;
        if (ROLE_MEMBER.test(m)) score += 1;
      }
      if (score >= 2) scored.push({ cls, score });
    }
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.cls);
}

function memberNames(cls: ClassDeclaration): string[] {
  return [
    ...cls.getMethods().map((m) => m.getName()),
    ...cls.getGetAccessors().map((g) => g.getName()),
    ...cls.getProperties().map((p) => p.getName()),
  ];
}

// Biểu thức đọc một thành viên trên biến `auth`: method/signal thì gọi (), getter/property thì đọc thẳng
export function memberExpr(cls: ClassDeclaration, member: string): string | null {
  const method = cls.getMethod(member);
  if (method) return method.getParameters().filter((p) => !p.isOptional() && !p.hasInitializer()).length === 0 ? `auth.${member}()` : null;
  if (cls.getGetAccessor(member)) return `auth.${member}`;
  const prop = cls.getProperty(member);
  if (prop) {
    const init = prop.getInitializer()?.getText() ?? '';
    // signal(...) / computed(...) / input(...) là hàm đọc giá trị
    return /^(signal|computed|toSignal|linkedSignal)\s*[<(]/.test(init) ? `auth.${member}()` : `auth.${member}`;
  }
  return null;
}

export function guessAuthHeuristic(candidates: ClassDeclaration[]): AuthGuess | null {
  for (const cls of candidates) {
    const names = memberNames(cls);
    const tokenMember = names.find((n) => TOKEN_MEMBER.test(n));
    if (!tokenMember) continue;
    const tokenExpr = memberExpr(cls, tokenMember);
    if (!tokenExpr) continue;
    const roleMember = names.find((n) => ROLE_MEMBER.test(n));
    const rolesExpr = roleMember ? memberExpr(cls, roleMember) : null;
    return {
      service: cls.getName() ?? '',
      file: cls.getSourceFile().getFilePath(),
      tokenExpr,
      rolesExpr,
      source: 'heuristic',
      note: rolesExpr ? undefined : 'Không thấy thành viên chứa quyền (roles/permissions); getCapabilities trả [] (chỉ ảnh hưởng gợi ý, backend vẫn lấy quyền từ JWT).',
    };
  }
  return null;
}

export function relImport(fromFile: string, toFile: string): string {
  let rel = relative(dirname(fromFile), toFile).replace(/\.ts$/, '').split('\\').join('/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}
