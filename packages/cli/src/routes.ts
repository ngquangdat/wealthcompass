import {
  ArrayLiteralExpression,
  CallExpression,
  ClassDeclaration,
  Node,
  ObjectLiteralExpression,
  Project,
  SourceFile,
  SyntaxKind,
} from 'ts-morph';
import { dirname, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { analyzeTemplate, type TemplateTarget } from './template';

export interface ScannedRoute {
  path: string; // đường dẫn đầy đủ, bắt đầu bằng '/'
  componentName?: string;
  title?: string;
  data: Record<string, unknown>;
  guards: string[];
  sourceRef: string;
  // Target nằm trên màn hình này, gồm cả component con và component layout của route cha
  targets: TemplateTarget[];
  // Chữ tĩnh của chính màn hình (component của route và component con), KHÔNG gồm layout cha
  // vì chữ của layout (thanh tab...) chung cho mọi màn hình và làm loãng ngữ cảnh
  uiText: string[];
  // Các component có template thuộc màn hình này (component của route và component con)
  classes: ClassDeclaration[];
}

export interface ScannedLayout {
  // Route khung (có children) và các component của nó
  path: string;
  classes: ClassDeclaration[];
}

interface Context {
  project: Project;
  warnings: string[];
  root: string;
  layouts: ScannedLayout[];
}

function ref(node: Node, root: string): string {
  const file = node.getSourceFile().getFilePath().replace(root + '/', '');
  return `${file}:${node.getStartLineNumber()}`;
}

// Đọc giá trị literal (chuỗi, số, bool, mảng, object); không phải literal thì trả undefined
export function evalLiteral(node: Node | undefined): unknown {
  if (!node) return undefined;
  switch (node.getKind()) {
    case SyntaxKind.StringLiteral:
    case SyntaxKind.NoSubstitutionTemplateLiteral:
      return (node as unknown as { getLiteralText(): string }).getLiteralText();
    case SyntaxKind.NumericLiteral:
      return Number(node.getText());
    case SyntaxKind.TrueKeyword:
      return true;
    case SyntaxKind.FalseKeyword:
      return false;
    case SyntaxKind.ArrayLiteralExpression:
      return (node as ArrayLiteralExpression).getElements().map((el) => evalLiteral(el));
    case SyntaxKind.ObjectLiteralExpression: {
      const out: Record<string, unknown> = {};
      for (const prop of (node as ObjectLiteralExpression).getProperties()) {
        if (Node.isPropertyAssignment(prop)) out[prop.getName().replace(/['"]/g, '')] = evalLiteral(prop.getInitializer());
      }
      return out;
    }
    case SyntaxKind.AsExpression:
    case SyntaxKind.ParenthesizedExpression:
    case SyntaxKind.SatisfiesExpression:
      return evalLiteral((node as unknown as { getExpression(): Node }).getExpression());
    default:
      return undefined;
  }
}

function prop(obj: ObjectLiteralExpression, name: string): Node | undefined {
  const p = obj.getProperty(name);
  return p && Node.isPropertyAssignment(p) ? p.getInitializer() : undefined;
}

// Đi theo tham chiếu biến (const routes = [...]) tới mảng literal
function resolveArray(node: Node | undefined): ArrayLiteralExpression | undefined {
  if (!node) return undefined;
  if (Node.isArrayLiteralExpression(node)) return node;
  if (Node.isIdentifier(node)) {
    for (const def of node.getDefinitionNodes()) {
      if (Node.isVariableDeclaration(def)) return resolveArray(def.getInitializer());
    }
  }
  if (Node.isAsExpression(node) || Node.isSatisfiesExpression(node) || Node.isParenthesizedExpression(node)) {
    return resolveArray(node.getExpression());
  }
  return undefined;
}

function findDynamicImport(node: Node): { specifier: string; member?: string; call: CallExpression } | undefined {
  const call = node
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((c) => c.getExpression().getKind() === SyntaxKind.ImportKeyword);
  if (!call) return undefined;
  const arg = call.getArguments()[0];
  const specifier = arg && Node.isStringLiteral(arg) ? arg.getLiteralText() : undefined;
  if (!specifier) return undefined;
  // import('./x').then(m => m.Name) hoặc .then(m => m.default)
  const access = node
    .getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
    .find((p) => p.getExpression().getKind() === SyntaxKind.Identifier && p.getParent()?.getKind() === SyntaxKind.ArrowFunction);
  return { specifier, member: access?.getName(), call };
}

function loadModule(from: SourceFile, specifier: string, ctx: Context): SourceFile | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = resolve(dirname(from.getFilePath()), specifier);
  return ctx.project.getSourceFile(base + '.ts') ?? ctx.project.getSourceFile(base + '/index.ts');
}

function findClass(file: SourceFile, name?: string): ClassDeclaration | undefined {
  if (name && name !== 'default') return file.getClass(name);
  return file.getClasses().find((c) => c.isDefaultExport()) ?? file.getClasses()[0];
}

export function templateOf(cls: ClassDeclaration): string | undefined {
  const decorator = cls.getDecorator('Component');
  const arg = decorator?.getArguments()[0];
  if (!arg || !Node.isObjectLiteralExpression(arg)) return undefined;
  const inline = evalLiteral(prop(arg, 'template'));
  if (typeof inline === 'string') return inline;
  const url = evalLiteral(prop(arg, 'templateUrl'));
  if (typeof url === 'string') {
    const file = resolve(dirname(cls.getSourceFile().getFilePath()), url);
    if (existsSync(file)) return readFileSync(file, 'utf8');
  }
  return undefined;
}

function selectorOf(cls: ClassDeclaration): string | undefined {
  const arg = decoratorArg(cls, 'Component');
  if (!arg) return undefined;
  const sel = evalLiteral(prop(arg, 'selector'));
  return typeof sel === 'string' ? sel : undefined;
}

function decoratorArg(cls: ClassDeclaration, name: string): ObjectLiteralExpression | undefined {
  const arg = cls.getDecorator(name)?.getArguments()[0];
  return arg && Node.isObjectLiteralExpression(arg) ? arg : undefined;
}

// Các class trong một mảng của decorator (imports, declarations, exports); phần tử kiểu
// RouterModule.forChild(...) thì lấy class RouterModule
function classesIn(obj: ObjectLiteralExpression | undefined, key: string): ClassDeclaration[] {
  const list = obj && resolveArray(prop(obj, key));
  if (!list) return [];
  const out: ClassDeclaration[] = [];
  for (const raw of list.getElements()) {
    let el: Node = raw;
    if (Node.isCallExpression(el)) el = el.getExpression();
    if (Node.isPropertyAccessExpression(el)) el = el.getExpression();
    if (!Node.isIdentifier(el)) continue;
    for (const def of el.getDefinitionNodes()) if (Node.isClassDeclaration(def)) out.push(def);
  }
  return out;
}

function classKey(cls: ClassDeclaration): string {
  return cls.getSourceFile().getFilePath() + '#' + cls.getName();
}

// NgModule khai báo từng component (theo declarations), lập một lần cho mỗi project
const declaringModules = new WeakMap<Project, Map<string, ClassDeclaration>>();

function declaringModule(cls: ClassDeclaration): ClassDeclaration | undefined {
  const project = cls.getProject();
  let index = declaringModules.get(project);
  if (!index) {
    index = new Map();
    for (const file of project.getSourceFiles()) {
      if (file.isDeclarationFile() || file.getFilePath().includes('/node_modules/')) continue;
      for (const mod of file.getClasses()) {
        for (const c of classesIn(decoratorArg(mod, 'NgModule'), 'declarations')) index.set(classKey(c), mod);
      }
    }
    declaringModules.set(project, index);
  }
  return index.get(classKey(cls));
}

// Class mà module đưa ra ngoài: exports, và exports của module được re-export
function moduleExports(mod: ClassDeclaration, seen = new Set<string>()): ClassDeclaration[] {
  if (seen.has(classKey(mod))) return [];
  seen.add(classKey(mod));
  const out: ClassDeclaration[] = [];
  for (const c of classesIn(decoratorArg(mod, 'NgModule'), 'exports')) {
    out.push(c);
    if (c.getDecorator('NgModule')) out.push(...moduleExports(c, seen));
  }
  return out;
}

// Component có thể dùng trong template: imports của component standalone; component trong NgModule thì
// là declarations của module đó cộng exports của các module nó import
function importedClasses(cls: ClassDeclaration): ClassDeclaration[] {
  const out = classesIn(decoratorArg(cls, 'Component'), 'imports');
  const mod = declaringModule(cls);
  if (mod) {
    const meta = decoratorArg(mod, 'NgModule');
    out.push(...classesIn(meta, 'declarations'));
    for (const imp of classesIn(meta, 'imports')) {
      if (imp.getDecorator('NgModule')) out.push(...moduleExports(imp));
      else out.push(imp); // component/directive standalone import vào module
    }
  }
  for (const c of [...out]) if (c.getDecorator('NgModule')) out.push(...moduleExports(c));
  return out.filter((c) => c.getDecorator('Component'));
}

// Mảng route trong RouterModule.forChild(...)/forRoot(...) của một NgModule hoặc module nó import
// (thường là XxxRoutingModule nằm ở file riêng)
function moduleRoutes(mod: ClassDeclaration, seen = new Set<string>()): ArrayLiteralExpression | undefined {
  if (seen.has(classKey(mod))) return undefined;
  seen.add(classKey(mod));
  const meta = decoratorArg(mod, 'NgModule');
  const list = meta && resolveArray(prop(meta, 'imports'));
  if (!list) return undefined;
  for (const el of list.getElements()) {
    if (!Node.isCallExpression(el)) continue;
    const callee = el.getExpression();
    if (Node.isPropertyAccessExpression(callee) && /^for(Child|Root)$/.test(callee.getName()) && callee.getExpression().getText() === 'RouterModule') {
      const arr = resolveArray(el.getArguments()[0]);
      if (arr) return arr;
    }
  }
  for (const imp of classesIn(meta, 'imports')) {
    if (!imp.getDecorator('NgModule')) continue;
    const arr = moduleRoutes(imp, seen);
    if (arr) return arr;
  }
  return undefined;
}

// Mảng route con của loadChildren: biến/export default là mảng Routes, hoặc NgModule có RouterModule.forChild
function lazyRoutes(file: SourceFile, member: string | undefined): ArrayLiteralExpression | undefined {
  const decl = member && member !== 'default' ? file.getVariableDeclaration(member) : undefined;
  const arr = resolveArray(decl?.getInitializer() ?? file.getDefaultExportSymbol()?.getDeclarations()[0]);
  if (arr) return arr;
  const mod = member && member !== 'default'
    ? file.getClass(member)
    : file.getClasses().find((c) => c.isDefaultExport() && c.getDecorator('NgModule')) ??
      file.getClasses().find((c) => c.getDecorator('NgModule'));
  return mod?.getDecorator('NgModule') ? moduleRoutes(mod) : undefined;
}

export interface ComponentInfo {
  targets: TemplateTarget[];
  uiText: string[];
  classes: ClassDeclaration[];
}

// Gom target và chữ tĩnh của một component và mọi component con được dùng trong template của nó
export function collectComponent(cls: ClassDeclaration, seen = new Set<string>()): ComponentInfo {
  const key = cls.getSourceFile().getFilePath() + '#' + cls.getName();
  if (seen.has(key)) return { targets: [], uiText: [], classes: [] };
  seen.add(key);

  const html = templateOf(cls);
  if (!html) return { targets: [], uiText: [], classes: [] };
  const info = analyzeTemplate(html);
  const targets = [...info.targets];
  const uiText = [...info.texts];
  const classes = [cls];
  for (const child of importedClasses(cls)) {
    const selector = selectorOf(child);
    if (selector && info.tags.has(selector)) {
      const inner = collectComponent(child, seen);
      targets.push(...inner.targets);
      for (const t of inner.uiText) if (!uiText.includes(t)) uiText.push(t);
      classes.push(...inner.classes);
    }
  }
  return { targets, uiText, classes };
}

function readRoutes(
  array: ArrayLiteralExpression,
  prefix: string,
  inheritedTargets: TemplateTarget[],
  inheritedGuards: string[],
  ctx: Context,
  out: ScannedRoute[],
): void {
  for (const el of array.getElements()) {
    if (!Node.isObjectLiteralExpression(el)) {
      ctx.warnings.push(`${ref(el, ctx.root)}: phần tử route không phải object literal (spread/hàm?), bỏ qua`);
      continue;
    }
    const segment = evalLiteral(prop(el, 'path'));
    if (typeof segment !== 'string') {
      ctx.warnings.push(`${ref(el, ctx.root)}: route không có path literal`);
      continue;
    }
    if (segment === '**' || prop(el, 'redirectTo')) continue;

    const full = '/' + [prefix, segment].filter(Boolean).join('/').replace(/^\/+/, '');
    const normalized = full === '/' ? '/' : full.replace(/\/+$/, '');

    // Component của route: component: X hoặc loadComponent: () => import(...)
    let cls: ClassDeclaration | undefined;
    const compNode = prop(el, 'component');
    if (compNode && Node.isIdentifier(compNode)) {
      cls = compNode.getDefinitionNodes().find(Node.isClassDeclaration);
    }
    const lazyComp = prop(el, 'loadComponent');
    if (lazyComp) {
      const dyn = findDynamicImport(lazyComp);
      const file = dyn && loadModule(el.getSourceFile(), dyn.specifier, ctx);
      cls = file ? findClass(file, dyn?.member) : undefined;
      if (!cls) ctx.warnings.push(`${ref(el, ctx.root)}: không resolve được loadComponent của ${normalized}`);
    }

    const ownInfo = cls ? collectComponent(cls) : { targets: [], uiText: [], classes: [] };
    const own = ownInfo.targets;
    const data = (evalLiteral(prop(el, 'data')) as Record<string, unknown> | undefined) ?? {};
    const titleRaw = evalLiteral(prop(el, 'title'));
    const guardsNode = prop(el, 'canActivate');
    const guards = guardsNode && Node.isArrayLiteralExpression(guardsNode)
      ? guardsNode.getElements().map((g) => g.getText())
      : [];

    // Route có children là layout (khung chứa router-outlet), không phải màn hình riêng
    const hasChildren = prop(el, 'children') || prop(el, 'loadChildren');
    const allGuards = [...inheritedGuards, ...guards];
    if (cls && hasChildren) ctx.layouts.push({ path: normalized, classes: ownInfo.classes });
    if (cls && !hasChildren) {
      out.push({
        path: normalized,
        componentName: cls.getName(),
        title: typeof titleRaw === 'string' ? titleRaw : (data['title'] as string | undefined),
        data,
        guards: allGuards,
        sourceRef: ref(el, ctx.root),
        targets: [...inheritedTargets, ...own],
        uiText: ownInfo.uiText,
        classes: ownInfo.classes,
      });
    }

    // Component có <router-outlet> là layout: target của nó hiện ở mọi route con
    const nextInherited = hasChildren ? [...inheritedTargets, ...own] : inheritedTargets;

    const children = resolveArray(prop(el, 'children'));
    if (children) readRoutes(children, normalized === '/' ? '' : normalized, nextInherited, allGuards, ctx, out);

    const lazyChildren = prop(el, 'loadChildren');
    if (lazyChildren) {
      // () => import('./x').then(m => m.X) hoặc chuỗi kiểu cũ './x.module#XModule'
      const legacy = evalLiteral(lazyChildren);
      const dyn = typeof legacy === 'string'
        ? { specifier: legacy.split('#')[0], member: legacy.split('#')[1] }
        : findDynamicImport(lazyChildren);
      const file = dyn && loadModule(el.getSourceFile(), dyn.specifier, ctx);
      const arr = file ? lazyRoutes(file, dyn.member) : undefined;
      if (arr) readRoutes(arr, normalized === '/' ? '' : normalized, nextInherited, allGuards, ctx, out);
      else ctx.warnings.push(`${ref(el, ctx.root)}: không resolve được loadChildren của ${normalized}`);
    }
  }
}

export function scanRoutes(
  project: Project,
  entryFile: string,
  root: string,
  warnings: string[],
): { routes: ScannedRoute[]; layouts: ScannedLayout[] } {
  const ctx: Context = { project, warnings, root, layouts: [] };
  const file = project.getSourceFile(resolve(root, entryFile));
  if (!file) throw new Error(`Không tìm thấy file route: ${entryFile}`);

  // Route gốc: biến export kiểu Routes (const routes: Routes = [...])
  const decl = file
    .getVariableDeclarations()
    .find((d) => d.getTypeNode()?.getText() === 'Routes' || /routes$/i.test(d.getName()));
  const array = resolveArray(decl?.getInitializer());
  if (!array) throw new Error(`Không tìm thấy mảng Routes trong ${entryFile}`);

  const out: ScannedRoute[] = [];
  readRoutes(array, '', [], [], ctx, out);
  return { routes: out, layouts: ctx.layouts };
}
