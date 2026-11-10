import { Project } from 'ts-morph';
import { dirname, join, resolve } from 'node:path';
import { exists, readText, writeText } from '@wealthcompass/tourdb';
import { parse as parseYaml } from 'yaml';
import {
  SCHEMA_VERSION,
  compassConfigSchema,
  featureMapSchema,
  type CompassConfig,
  type Feature,
  type FeatureMap,
  type Target,
  type Tour,
} from '@wealthcompass/contracts';
import { scanRoutes, type ScannedLayout, type ScannedRoute } from './routes';
import { scanMenu } from './menu';
import { MENU_TARGETS } from './template';
import { menuTourId, routeMatches } from '@wealthcompass/core';
import { readToursFile } from './record/write';
import { readIndex, sourceFingerprint, writeIndex } from './index-cache';

interface Overrides {
  features?: Record<
    string,
    Partial<Pick<Feature, 'title' | 'description' | 'keywords' | 'sampleQuestions' | 'facets'>> & {
      hidden?: boolean;
      // Chỉ dùng khi chưa có source (discovery.source: none): khai màn hình bằng tay, vd. /orders/:id
      route?: string;
      // Quyền ghi đè cho riêng màn hình (thay cho quyền suy từ guard); [] = không cần quyền riêng
      requires?: string[];
      // Các trường do LLM soạn (lệnh enrich) và chưa được người duyệt; xóa khóa này sau khi đọc lại
      llmDraft?: string[];
    }
  >;
  tours?: Record<string, { title: string; description?: string; feature?: string; startRoute: string; steps: Array<{ target: string; text: string; advanceOn?: 'next' | 'click' | 'hover' }> }>;
}

interface Lock {
  features: Record<string, { route: string; component?: string }>;
}

// Ngữ cảnh của từng màn hình mà scanner thu được; lệnh enrich dùng để nhờ LLM soạn mô tả
export interface FeatureContext {
  id: string;
  path: string;
  componentName?: string;
  uiText: string[];
  classes: import('ts-morph').ClassDeclaration[];
  // Guard áp lên màn hình này (kể cả kế thừa từ route cha)
  guards: string[];
}

// Màn hình bị ẩn khỏi trợ lý (overrides `hidden: true`): không vào Feature Map, nhưng Studio vẫn cần thấy để bỏ ẩn
export interface HiddenScreen {
  id: string;
  path: string;
  title: string;
  sourceRef: string;
}

export interface ScanResult {
  featureMap: FeatureMap;
  outFile: string;
  contexts: Record<string, FeatureContext>;
  hidden: HiddenScreen[];
  // Project ts-morph đã nạp (phân tích guard, doctor dùng lại)
  project: Project;
  root: string;
  layouts: ScannedLayout[];
  // Route/menu lấy từ chỉ mục SQLite (source chưa đổi): `project` rỗng, `layouts` và `contexts[*].classes` rỗng.
  // Việc cần đọc mã nguồn (enrich, phân tích guard, doctor) phải quét đầy đủ (không truyền useIndex).
  fromIndex: boolean;
}

export interface ScanOptions {
  // Dùng chỉ mục source nếu còn hiệu lực thay vì nạp ts-morph. Kết quả Feature Map giống hệt quét đầy đủ.
  useIndex?: boolean;
}

// Phần của route lưu được vào chỉ mục (không gồm đối tượng ts-morph)
type IndexedRoute = Omit<ScannedRoute, 'classes'>;
interface SourceIndex {
  routes: IndexedRoute[];
  menu: Array<[string, string[]]>;
  warnings: string[];
}

// File dữ liệu của WealthCompass: sửa chúng không làm chỉ mục source hết hiệu lực
export function indexIgnore(config: CompassConfig): string[] {
  return [config.discovery.overrides, config.discovery.tours, config.discovery.tours.replace(/\.(db|json)$/, '.json'), config.discovery.tours.replace(/\.(db|json)$/, '.db'), config.discovery.out, 'compass.lock.json'];
}

function slug(path: string): string {
  const parts = path.split('/').filter(Boolean).map((p) => p.replace(/^:/, '').toLowerCase());
  return parts.length ? parts.join('.') : 'home';
}

function readYaml<T>(file: string): T | undefined {
  return exists(file) ? (parseYaml(readText(file)) as T) : undefined;
}

// `root`: nơi chứa dữ liệu của WealthCompass (kho dự án SQLite, hoặc thư mục kiểu cũ). `sourceRoot`: thư mục source của web.
// Dự án kiểu cũ thì hai nơi là một.
export function loadConfig(configPath: string): { config: CompassConfig; root: string; sourceRoot: string } {
  const file = resolve(configPath);
  const raw = readYaml<unknown>(file);
  if (!raw) throw new Error(`Không đọc được cấu hình: ${file}. Web chưa tích hợp thì chạy \`wealthcompass setup --app <thư mục web>\`.`);
  const config = compassConfigSchema.parse(raw);
  const root = dirname(file);
  return { config, root, sourceRoot: config.discovery.sourceDir ? resolve(config.discovery.sourceDir) : root };
}

// Chưa có source: màn hình = route khai trong overrides (features.<id>.route) + route xuất hiện trong tour đã ghi.
// Route trong tour là đường dẫn thật lúc ghi (/orders/42); muốn có tham số thì khai `route: /orders/:id` trong overrides.
function observedRoutes(overrides: Overrides, recorded: ReturnType<typeof readToursFile>, discovery: CompassConfig['discovery']): ScannedRoute[] {
  const make = (path: string, id: string | undefined, sourceRef: string): ScannedRoute =>
    ({ path, title: undefined, data: id ? { compassId: id } : {}, guards: [], targets: [], uiText: [], classes: [], componentName: undefined, sourceRef }) as unknown as ScannedRoute;
  const routes: ScannedRoute[] = [];
  for (const [id, ov] of Object.entries(overrides.features ?? {})) {
    if (typeof ov?.route === 'string' && ov.route.startsWith('/')) routes.push(make(ov.route, id, `${discovery.overrides}: features.${id}.route`));
  }
  const add = (path: string | undefined, tourId: string) => {
    if (!path || !path.startsWith('/') || routes.some((r) => routeMatches(r.path, path))) return;
    routes.push(make(path, undefined, `${discovery.tours}: tour ${tourId}`));
  };
  for (const [tourId, def] of Object.entries(recorded.tours)) {
    add(def.startRoute, tourId);
    for (const s of [...def.steps, ...Object.values(def.variants ?? {}).flat()]) add(s.route, tourId);
    // Màn hình đích của tour (nơi dừng ghi) có thể không có bước nào: tính năng sở hữu tour vẫn cần tồn tại
    add(def.endRoute, tourId);
  }
  return routes;
}

// Id tính năng suy từ đường dẫn (dùng chung cho scan và tour:record khi chưa có source)
export function featureIdOfRoute(path: string): string {
  return slug(path.split(/[?#]/)[0]);
}

export function scan(configPath: string, options: ScanOptions = {}): ScanResult {
  const { config, root, sourceRoot } = loadConfig(configPath);
  const warnings: string[] = [];

  const overrides = readYaml<Overrides>(join(root, config.discovery.overrides)) ?? {};
  const noSource = config.discovery.source === 'none';
  if (!noSource && !config.discovery.entry) throw new Error('compass.config.yaml thiếu discovery.entry (file route gốc). Chưa có source thì đặt discovery.source: none.');
  // Phần tốn thời gian (ts-morph đọc route, menu, template) chỉ phụ thuộc source: lưu vào chỉ mục theo dấu vân tay source
  const fingerprint = noSource ? '' : sourceFingerprint(sourceRoot, indexIgnore(config));
  const cached = !noSource && options.useIndex ? readIndex<SourceIndex>(sourceRoot, 'scan', fingerprint) : null;
  let project: Project;
  let routes: ScannedRoute[];
  let layouts: ScannedLayout[] = [];
  let menu: Map<string, string[]>;
  if (noSource) {
    project = new Project({ useInMemoryFileSystem: true });
    routes = observedRoutes(overrides, readToursFile(join(root, config.discovery.tours)), config.discovery);
    menu = new Map();
  } else if (cached) {
    project = new Project({ useInMemoryFileSystem: true });
    routes = cached.routes.map((r) => ({ ...r, classes: [] }));
    menu = new Map(cached.menu);
    warnings.push(...cached.warnings);
  } else {
    project = new Project({ tsConfigFilePath: join(sourceRoot, 'tsconfig.app.json'), skipAddingFilesFromTsConfig: false });
    const scanned = scanRoutes(project, config.discovery.entry!, sourceRoot, warnings);
    routes = scanned.routes;
    layouts = scanned.layouts;
    menu = scanMenu(project, config.discovery.menu, sourceRoot, warnings);
    // Cảnh báo tới đây đều từ source (route, menu): lưu kèm để lần đọc chỉ mục báo y như quét đầy đủ
    const index: SourceIndex = { routes: routes.map(({ classes: _classes, ...rest }) => rest), menu: [...menu], warnings: [...warnings] };
    writeIndex(sourceRoot, 'scan', fingerprint, index);
  }

  // Khóa ổn định: nếu id sinh ra chưa có trong lock nhưng component cũ vẫn còn, coi là đổi tên route
  const lockFile = join(root, 'compass.lock.json');
  const lock: Lock = exists(lockFile) ? JSON.parse(readText(lockFile)) : { features: {} };
  const claimed = new Set<string>();
  const idFor = (r: ScannedRoute): string => {
    const explicit = r.data['compassId'];
    if (typeof explicit === 'string') return explicit;
    const derived = slug(r.path);
    const entry = lock.features[derived];
    if (entry && entry.component === r.componentName) return derived;
    if (!entry) {
      const renamed = Object.entries(lock.features).find(
        ([oldId, v]) => v.component === r.componentName && v.route !== r.path && !claimed.has(oldId) && !routes.some((x) => slug(x.path) === oldId),
      );
      if (renamed) {
        warnings.push(`Route ${renamed[1].route} có vẻ đã đổi thành ${r.path}; giữ nguyên id "${renamed[0]}"`);
        return renamed[0];
      }
    }
    return derived;
  };

  const features: Feature[] = [];
  const contexts: Record<string, FeatureContext> = {};
  const hidden: HiddenScreen[] = [];
  const targetRoute = new Map<string, Target>(); // tourId -> target (route đầu tiên chứa nó)
  let routesWithTitle = 0;
  let menuMatched = 0;

  for (const r of routes) {
    if (r.data['hidden'] === true) continue;
    const id = idFor(r);
    claimed.add(id);
    const ov = overrides.features?.[id] ?? {};
    if (ov.hidden) {
      hidden.push({ id, path: r.path, title: ov.title ?? r.title ?? menu.get(r.path)?.at(-1) ?? r.path, sourceRef: r.sourceRef });
      continue;
    }

    const menuPath = menu.get(r.path) ?? [];
    if (menuPath.length) menuMatched++;
    else if (!noSource) warnings.push(`${r.sourceRef}: route ${r.path} không có trong menu (agent sẽ không trả lời được "ở đâu trong menu")`);

    // Thứ tự: overrides > title của route > nhãn menu (cuối đường dẫn menu). Dùng nhãn menu thay vì đường dẫn thô
    // vì người dùng nhìn thấy đúng chữ đó khi tìm trong menu.
    const title = ov.title ?? r.title ?? menuPath.at(-1);
    if (title) routesWithTitle++;
    else warnings.push(`${r.sourceRef}: route ${r.path} thiếu title (data.title, nhãn menu hoặc overrides)`);
    const description = ov.description ?? (r.data['description'] as string | undefined) ?? '';
    if (!description) warnings.push(`${r.sourceRef}: route ${r.path} thiếu description (chạy \`enrich\` để LLM soạn nháp)`);

    const drafted = Array.isArray(ov.llmDraft) ? ov.llmDraft : [];
    if (drafted.length) {
      warnings.push(`Feature "${id}": ${drafted.join(', ')} do LLM soạn, chưa duyệt (đọc lại rồi xóa khóa llmDraft trong overrides)`);
    }

    // Guard -> quyền theo bảng trong config. Guard không khai trong bảng: màn hình chỉ cần đăng nhập (mặc định),
    // tên guard ghi vào unknownGuards để Studio liệt kê, không cảnh báo.
    const requires = new Set<string>();
    const unknownGuards: string[] = [];
    for (const g of r.guards) {
      const mapped = config.access.guards[g];
      if (mapped) mapped.requires.forEach((x) => requires.add(x));
      else unknownGuards.push(g);
    }
    // Người duyệt ghi đè quyền cho màn hình này thì dùng đúng danh sách đó, guard chưa ánh xạ không còn là vấn đề
    const overrideRequires = Array.isArray(ov.requires) ? ov.requires.map(String) : null;

    const seen = new Set<string>();
    const targets: Target[] = [];
    if (!menu.size && r.targets.some((t) => t.tourId === MENU_TARGETS) && !warnings.some((w) => w.includes('[tourMenu]'))) {
      warnings.push('Layout dùng [tourMenu] nhưng không đọc được dữ liệu menu (discovery.menu): các mốc menu-<route> chưa được tạo');
    }
    // [tourMenu] động: mỗi mục có route trong dữ liệu menu là một mốc, nhãn là đường đi menu
    const expanded = r.targets.flatMap((t) =>
      t.tourId === MENU_TARGETS ? [...menu].map(([path, labels]) => ({ tourId: menuTourId(path), label: labels.join(' › '), hint: undefined, sensitivity: 'normal' as const })) : [t],
    );
    for (const t of expanded) {
      if (seen.has(t.tourId)) continue;
      seen.add(t.tourId);
      const target: Target = { tourId: t.tourId, label: t.label, hint: t.hint, sensitivity: t.sensitivity, route: r.path };
      targets.push(target);
      if (!targetRoute.has(t.tourId)) targetRoute.set(t.tourId, target);
    }

    features.push({
      id,
      route: { pattern: r.path },
      title: title ?? r.path,
      description,
      keywords: ov.keywords ?? ((r.data['keywords'] as string[] | undefined) ?? []),
      menuPath: menuPath.length ? menuPath : title ? [title] : [],
      facets: ov.facets ?? ((r.data['facets'] as Record<string, string> | undefined) ?? {}),
      access: { requires: overrideRequires ?? [...requires], unknownGuards: overrideRequires ? [] : unknownGuards },
      targets,
      sampleQuestions: ov.sampleQuestions ?? [],
      tourIds: [],
      provenance: {
        source: [
          'static',
          ...(ov.title || ov.description || ov.keywords || ov.sampleQuestions || overrideRequires ? (['manual'] as const) : []),
          ...(drafted.length ? (['llm'] as const) : []),
        ],
        reviewed: Boolean(ov.title || ov.description) && !drafted.length,
        sourceRef: r.sourceRef,
      },
    });
    contexts[id] = { id, path: r.path, componentName: r.componentName, uiText: r.uiText, classes: r.classes, guards: r.guards };

    lock.features[id] = { route: r.path, component: r.componentName };
  }

  // Tour: kiểm tra mọi tourId tham chiếu đều tồn tại trong template; thiếu thì loại tour và báo lỗi
  const tours: Tour[] = [];
  for (const [tourId, def] of Object.entries(overrides.tours ?? {})) {
    const missing = def.steps.filter((s) => !targetRoute.has(s.target)).map((s) => s.target);
    if (missing.length) {
      warnings.push(`Tour "${tourId}" bị loại: không tìm thấy tourId ${missing.join(', ')} trong template`);
      continue;
    }
    tours.push({
      id: tourId,
      title: def.title,
      description: def.description,
      startRoute: def.startRoute,
      steps: def.steps.map((s) => {
        const t = targetRoute.get(s.target)!;
        return { tourId: s.target, text: s.text, advanceOn: s.advanceOn ?? 'next', route: t.route, label: t.label };
      }),
    });
    const owner = features.find((f) => f.id === def.feature);
    if (def.feature && !owner) warnings.push(`Tour "${tourId}": feature "${def.feature}" không tồn tại`);
    owner?.tourIds.push(tourId);
  }

  // Tour ghi bằng `tour:record` (compass.tours.json): bước dùng locator không cần tourId trong template.
  // Bước có tourId vẫn được kiểm như trên; locator thì chỉ kiểm màn hình của bước có trong Feature Map.
  const recorded = readToursFile(join(root, config.discovery.tours));
  for (const [tourId, def] of Object.entries(recorded.tours)) {
    if (tours.some((t) => t.id === tourId)) {
      warnings.push(`Tour "${tourId}" có ở cả overrides lẫn ${config.discovery.tours}; dùng bản trong overrides`);
      continue;
    }
    const variants = Object.entries(def.variants ?? {}) as Array<['mobile' | 'desktop', typeof def.steps]>;
    const allSteps = [...def.steps, ...variants.flatMap(([, steps]) => steps)];
    const missing = [...new Set(allSteps.filter((s) => s.tourId && !s.locator && !targetRoute.has(s.tourId)).map((s) => s.tourId))];
    if (missing.length) {
      warnings.push(`Tour "${tourId}" bị loại: không tìm thấy tourId ${missing.join(', ')} trong template`);
      continue;
    }
    const unmatched = allSteps.filter((s) => s.route && !features.some((f) => routeMatches(f.route.pattern, s.route!)));
    for (const s of unmatched) warnings.push(`Tour "${tourId}" bước ${s.key ?? '?'}: màn hình ${s.route} không có trong Feature Map`);
    if (def.draft) warnings.push(`Tour "${tourId}" là nháp (${def.draftSource === 'llm' ? 'LLM soạn' : 'dựng bằng mẫu'}), chưa duyệt: đọc lại chữ rồi bấm Lưu ở trang Tour của Studio`);
    const mapSteps = (steps: typeof def.steps) =>
      steps.map((s, i) => {
        const t = s.tourId ? targetRoute.get(s.tourId) : undefined;
        return {
          key: s.key ?? `s${i + 1}`,
          ...(s.tourId && t ? { tourId: s.tourId } : {}),
          ...(s.locator ? { locator: s.locator } : {}),
          text: s.text,
          advanceOn: s.advanceOn,
          route: t?.route ?? s.route,
          label: t?.label ?? s.label ?? s.locator?.name ?? s.locator?.text,
          ...(s.skipIfNextVisible ? { skipIfNextVisible: true } : {}),
        };
      });
    tours.push({
      id: tourId,
      title: def.title,
      description: def.description,
      startRoute: def.startRoute,
      steps: mapSteps(def.steps),
      ...(def.layout ? { layout: def.layout } : {}),
      ...(variants.length ? { variants: Object.fromEntries(variants.map(([layout, steps]) => [layout, mapSteps(steps)])) } : {}),
    });
    const owner = features.find((f) => f.id === def.feature);
    if (def.feature && !owner) warnings.push(`Tour "${tourId}": feature "${def.feature}" không tồn tại`);
    owner?.tourIds.push(tourId);
  }

  // Dọn lock: id không còn route nào dùng thì bỏ và cảnh báo
  for (const id of Object.keys(lock.features)) {
    if (!claimed.has(id)) {
      warnings.push(`Feature "${id}" (${lock.features[id].route}) không còn trong code, xóa khỏi lock`);
      delete lock.features[id];
    }
  }

  const featureMap = featureMapSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    appVersion: process.env['COMPASS_APP_VERSION'] ?? 'dev',
    generatedAt: new Date().toISOString(),
    features,
    tours,
    coverage: {
      routesFound: routes.filter((r) => r.data['hidden'] !== true).length,
      routesWithTitle,
      menuItemsMatched: menuMatched,
      targetsFound: targetRoute.size,
      warnings,
    },
  });

  const outFile = resolve(root, config.discovery.out);
  writeText(outFile, JSON.stringify(featureMap, null, 2) + '\n');
  writeText(lockFile, JSON.stringify(lock, null, 2) + '\n');
  // `root` của kết quả quét là thư mục source
  return { featureMap, outFile, contexts, hidden, project, root: sourceRoot, layouts, fromIndex: Boolean(cached) };
}
