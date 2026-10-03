import { Project } from 'ts-morph';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

interface Overrides {
  features?: Record<
    string,
    Partial<Pick<Feature, 'title' | 'description' | 'keywords' | 'sampleQuestions' | 'facets'>> & {
      hidden?: boolean;
      // Các trường do LLM soạn (lệnh enrich) và chưa được người duyệt; xóa khóa này sau khi đọc lại
      llmDraft?: string[];
    }
  >;
  tours?: Record<string, { title: string; description?: string; feature?: string; startRoute: string; steps: Array<{ target: string; text: string; advanceOn?: 'next' | 'click' }> }>;
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
  // Project ts-morph đã nạp; annotate dùng lại để tính chỗ sửa mà không phải nạp lần nữa
  project: Project;
  root: string;
  layouts: ScannedLayout[];
}

function slug(path: string): string {
  const parts = path.split('/').filter(Boolean).map((p) => p.replace(/^:/, '').toLowerCase());
  return parts.length ? parts.join('.') : 'home';
}

function readYaml<T>(file: string): T | undefined {
  return existsSync(file) ? (parseYaml(readFileSync(file, 'utf8')) as T) : undefined;
}

export function loadConfig(configPath: string): { config: CompassConfig; root: string } {
  const file = resolve(configPath);
  const raw = readYaml<unknown>(file);
  if (!raw) throw new Error(`Không đọc được cấu hình: ${file}`);
  return { config: compassConfigSchema.parse(raw), root: dirname(file) };
}

export function scan(configPath: string): ScanResult {
  const { config, root } = loadConfig(configPath);
  const warnings: string[] = [];

  const project = new Project({ tsConfigFilePath: join(root, 'tsconfig.app.json'), skipAddingFilesFromTsConfig: false });
  const { routes, layouts } = scanRoutes(project, config.discovery.entry, root, warnings);
  const menu = scanMenu(project, config.discovery.menu, root, warnings);
  const overrides = readYaml<Overrides>(join(root, config.discovery.overrides)) ?? {};

  // Khóa ổn định: nếu id sinh ra chưa có trong lock nhưng component cũ vẫn còn, coi là đổi tên route
  const lockFile = join(root, 'compass.lock.json');
  const lock: Lock = existsSync(lockFile) ? JSON.parse(readFileSync(lockFile, 'utf8')) : { features: {} };
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
    else warnings.push(`${r.sourceRef}: route ${r.path} không có trong menu (agent sẽ không trả lời được "ở đâu trong menu")`);

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

    // Guard -> quyền theo bảng trong config; guard lạ ghi unknownGuards
    const requires = new Set<string>();
    const unknownGuards: string[] = [];
    for (const g of r.guards) {
      const mapped = config.access.guards[g];
      if (mapped) mapped.requires.forEach((x) => requires.add(x));
      else unknownGuards.push(g);
    }
    if (unknownGuards.length) warnings.push(`${r.sourceRef}: guard chưa ánh xạ quyền: ${unknownGuards.join(', ')}`);

    const seen = new Set<string>();
    const targets: Target[] = [];
    for (const t of r.targets) {
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
      access: { requires: [...requires], unknownGuards },
      targets,
      sampleQuestions: ov.sampleQuestions ?? [],
      tourIds: [],
      provenance: {
        source: [
          'static',
          ...(ov.title || ov.description || ov.keywords || ov.sampleQuestions ? (['manual'] as const) : []),
          ...(drafted.length ? (['llm'] as const) : []),
        ],
        reviewed: Boolean(ov.title || ov.description) && !drafted.length,
        sourceRef: r.sourceRef,
      },
    });
    contexts[id] = { id, path: r.path, componentName: r.componentName, uiText: r.uiText, classes: r.classes };

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
  writeFileSync(outFile, JSON.stringify(featureMap, null, 2) + '\n');
  writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n');
  return { featureMap, outFile, contexts, hidden, project, root, layouts };
}
