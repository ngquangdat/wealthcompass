import { writeText } from '@wealthcompass/tourdb';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { YAMLMap, isMap, isScalar } from 'yaml';
import { z } from 'zod';
import { describeLocator } from '@wealthcompass/core';
import { loadConfig } from '../scan';
import { analyzeGuards } from '../setup/guards';
import { finishRecording } from '../record/run';
import { recordSession } from '../record/recorder';
import { layoutOfSteps, readToursFile, writeTours } from '../record/write';
import { rerecordStep } from '../record/rerecord';
import { mainLayout, resolveProposal } from '../verify/heal';
import { verifyTours } from '../verify/verify';
import { readOverrides } from './overrides-edit';
import { cachedScan, configPath, httpError, invalidateScan, llm, loadDoc, requireApp, stream } from './context';

// Đợt 2 của Studio: quyền, tour

const today = () => new Date().toISOString().slice(0, 10);
const ROLE = /^[\w:.-]{1,60}$/;
const TOUR_ID = /^[a-z0-9][a-z0-9-]{1,60}$/;

// File tour ghi bằng locator (compass.tours.json) của dự án
function toursPath(app: string): string {
  const { config, root } = loadConfig(configPath(app));
  return join(root, config.discovery.tours);
}

function overridesPath(app: string): string {
  const { config, root } = loadConfig(configPath(app));
  return join(root, config.discovery.overrides);
}


export function registerPhase2(app: FastifyInstance): void {
  // ======================= Quyền (guard) =======================
  app.get('/api/guards', async () => {
    const dir = requireApp();
    const scanned = cachedScan(dir, true);
    const titles = new Map(scanned.featureMap.features.map((f) => [f.id, f.title]));
    const usage = new Map<string, string[]>();
    for (const ctx of Object.values(scanned.contexts)) {
      for (const g of ctx.guards) usage.set(g, [...(usage.get(g) ?? []), titles.get(ctx.id) ?? ctx.path]);
    }
    const doc = loadDoc(configPath(dir));
    const map = doc.getIn(['access', 'guards'], true);
    const configured = new Map<string, { requires: string[]; comment: string }>();
    if (isMap(map)) {
      for (const pair of (map as YAMLMap).items) {
        const name = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
        const value = pair.value as { toJSON?: () => { requires?: string[] }; comment?: string } | null;
        configured.set(name, { requires: value?.toJSON?.().requires ?? [], comment: (value?.comment ?? '').trim() });
      }
    }
    const names = [...new Set([...usage.keys(), ...configured.keys()])].sort();
    const analysis = new Map(analyzeGuards(scanned.project, names).map((g) => [g.name, g]));
    return names.map((name) => {
      const c = configured.get(name);
      const a = analysis.get(name);
      // Chưa khai: chỉ cần đăng nhập (mặc định). `suggested`: chuỗi quyền thấy trong code, chỉ để gợi ý khi người sửa.
      const status = !c ? 'default' : /DRAFT/.test(c.comment) ? 'draft' : /đã duyệt/i.test(c.comment) ? 'reviewed' : a?.how === 'code' ? 'code' : a?.how === 'auth' ? 'auth' : 'manual';
      return { name, requires: c?.requires ?? null, status, evidence: a?.evidence ?? null, how: a?.how ?? 'default', suggested: a?.how === 'code' ? a.requires : [], screens: (usage.get(name) ?? []).sort() };
    });
  });

  app.put('/api/guards/:name', async (req) => {
    const dir = requireApp();
    const { name } = req.params as { name: string };
    const { requires } = req.body as { requires: string[] };
    if (!/^[\w$]+$/.test(name)) throw httpError(400, 'Tên guard không hợp lệ');
    const roles = [...new Set(requires.map((r) => r.trim()).filter(Boolean))];
    const bad = roles.find((r) => !ROLE.test(r));
    if (bad) throw httpError(400, `Tên quyền không hợp lệ: ${bad}`);
    const doc = loadDoc(configPath(dir));
    if (!doc.hasIn(['access', 'guards'])) doc.setIn(['access', 'guards'], doc.createNode({}));
    const map = doc.getIn(['access', 'guards'], true) as YAMLMap;
    map.flow = false;
    const value = doc.createNode({ requires: roles }) as YAMLMap;
    value.flow = true;
    value.comment = ` đã duyệt trong Studio ngày ${today()}`;
    map.set(doc.createNode(name), value);
    writeText(configPath(dir), String(doc));
    invalidateScan();
    return { ok: true };
  });

  // ======================= Danh mục quyền =======================
  // Gồm quyền khai trong access.roles và quyền đang được dùng (guard, ghi đè màn hình) dù chưa khai
  app.get('/api/roles', async () => {
    const dir = requireApp();
    const { config } = loadConfig(configPath(dir));
    const scanned = cachedScan(dir);
    const raw = readOverrides(overridesPath(dir));
    const titles = new Map(scanned.featureMap.features.map((f) => [f.id, f.title]));
    const rows = new Map<string, { name: string; description: string; inCatalog: boolean; guards: string[]; screens: string[] }>();
    const row = (name: string) => {
      if (!rows.has(name)) rows.set(name, { name, description: '', inCatalog: false, guards: [], screens: [] });
      return rows.get(name)!;
    };
    for (const [name, r] of Object.entries(config.access.roles)) Object.assign(row(name), { description: r.description, inCatalog: true });
    for (const [guard, g] of Object.entries(config.access.guards)) for (const r of g.requires) row(r).guards.push(guard);
    for (const [id, ov] of Object.entries(raw)) {
      if (Array.isArray(ov['requires'])) for (const r of ov['requires'] as string[]) row(r).screens.push(titles.get(id) ?? id);
    }
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  app.put('/api/roles/:name', async (req) => {
    const dir = requireApp();
    const { name } = req.params as { name: string };
    if (!ROLE.test(name)) throw httpError(400, 'Tên quyền chỉ gồm chữ, số và các ký tự _ : . -');
    const { description } = (req.body ?? {}) as { description?: string };
    const doc = loadDoc(configPath(dir));
    if (!doc.hasIn(['access', 'roles'])) doc.setIn(['access', 'roles'], doc.createNode({}));
    (doc.getIn(['access', 'roles'], true) as YAMLMap).flow = false;
    const value = doc.createNode({ description: String(description ?? '').trim().slice(0, 200) }) as YAMLMap;
    value.flow = true;
    doc.setIn(['access', 'roles', name], value);
    writeText(configPath(dir), String(doc));
    invalidateScan();
    return { ok: true };
  });

  // Chỉ xóa quyền không còn guard hay màn hình nào dùng, để không làm lệch ánh xạ đang chạy
  app.delete('/api/roles/:name', async (req) => {
    const dir = requireApp();
    const { name } = req.params as { name: string };
    const { config } = loadConfig(configPath(dir));
    const guards = Object.entries(config.access.guards).filter(([, g]) => g.requires.includes(name)).map(([g]) => g);
    const screens = Object.entries(readOverrides(overridesPath(dir))).filter(([, ov]) => Array.isArray(ov['requires']) && (ov['requires'] as string[]).includes(name)).map(([id]) => id);
    if (guards.length || screens.length) throw httpError(400, `Quyền "${name}" đang được dùng ở ${[...guards.map((g) => `guard ${g}`), ...screens.map((s) => `màn hình ${s}`)].join(', ')}; bỏ ở đó trước`);
    const doc = loadDoc(configPath(dir));
    doc.deleteIn(['access', 'roles', name]);
    writeText(configPath(dir), String(doc));
    invalidateScan();
    return { ok: true };
  });

  // ======================= Tour =======================
  app.get('/api/tours', async () => {
    const dir = requireApp();
    const scanned = cachedScan(dir);
    const doc = loadDoc(overridesPath(dir));
    const tours = doc.get('tours', true);
    const targets = new Map<string, { tourId: string; label?: string; route?: string; sensitivity: string }>();
    for (const f of scanned.featureMap.features) for (const t of f.targets) if (!targets.has(t.tourId)) targets.set(t.tourId, { tourId: t.tourId, label: t.label, route: t.route, sensitivity: t.sensitivity });
    const valid = new Set(scanned.featureMap.tours.map((t) => t.id));
    const list = [];
    if (isMap(tours)) {
      for (const pair of (tours as YAMLMap).items) {
        const id = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
        const node = pair.value as YAMLMap;
        const data = (node?.toJSON?.() ?? {}) as { title?: string; description?: string; feature?: string; startRoute?: string; steps?: Array<{ target: string; advanceOn?: string; text: string }> };
        const comments = [isScalar(pair.key) ? pair.key.commentBefore : '', node?.commentBefore, ...(node?.items ?? []).map((p) => (isScalar(p.key) ? p.key.commentBefore : ''))].join('\n');
        list.push({
          id,
          ...data,
          steps: (data.steps ?? []).map((s) => ({ ...s, advanceOn: s.advanceOn ?? 'next', known: targets.has(s.target), label: targets.get(s.target)?.label, route: targets.get(s.target)?.route, sensitive: targets.get(s.target)?.sensitivity === 'user-only' })),
          draft: /DRAFT/.test(comments),
          valid: valid.has(id),
          errors: scanned.featureMap.coverage.warnings.filter((w) => w.includes(`"${id}"`)),
        });
      }
    }
    // Tour ghi bằng locator: phần tử mô tả bằng manh mối đã ghi, không cần tourId
    for (const [id, def] of Object.entries(readToursFile(toursPath(dir)).tours)) {
      if (list.some((t) => t.id === id)) continue;
      list.push({
        id,
        title: def.title,
        description: def.description,
        feature: def.feature,
        startRoute: def.startRoute,
        source: 'recorded',
        // Bố cục đã ghi: bản chính + các bản thêm (Studio chỉ sửa chữ của bản chính)
        layouts: [def.layout ?? layoutOfSteps(def.steps) ?? 'desktop', ...Object.keys(def.variants ?? {})],
        steps: def.steps.map((s) => ({
          key: s.key,
          target: s.tourId ?? '',
          advanceOn: s.advanceOn,
          text: s.text,
          known: s.tourId ? targets.has(s.tourId) : Boolean(s.locator),
          element: s.locator ? describeLocator(s.locator) : undefined,
          label: (s.tourId && targets.get(s.tourId)?.label) || s.locator?.name || s.locator?.text,
          route: s.route,
          sensitive: s.tourId ? targets.get(s.tourId)?.sensitivity === 'user-only' : s.advanceOn === 'next' && !!s.locator,
          ...(s.healedAt ? { healedAt: s.healedAt } : {}),
        })),
        // Đề xuất sửa locator của tour:verify cho bước nhạy cảm, ở mọi bố cục: chờ người duyệt
        proposals: (
          [[mainLayout(def), def.steps], ...Object.entries(def.variants ?? {})] as Array<[string, typeof def.steps | undefined]>
        ).flatMap(([layout, steps]) =>
          (steps ?? []).flatMap((s, i) =>
            s.proposal && s.key
              ? [{ layout, key: s.key, index: i, text: s.text, from: s.locator ? describeLocator(s.locator) : (s.tourId ?? ''), to: describeLocator(s.proposal.locator), changed: s.proposal.changed, at: s.proposal.at }]
              : [],
          ),
        ),
        draft: Boolean(def.draft),
        valid: valid.has(id),
        errors: scanned.featureMap.coverage.warnings.filter((w) => w.includes(`"${id}"`)),
      });
    }
    return {
      tours: list,
      targets: [...targets.values()].sort((a, b) => a.tourId.localeCompare(b.tourId)),
      features: scanned.featureMap.features.map((f) => ({ id: f.id, title: f.title, route: f.route.pattern })),
      routes: scanned.featureMap.features.map((f) => f.route.pattern).filter((r) => !r.includes(':')),
    };
  });

  app.put('/api/tours/:id', async (req) => {
    const dir = requireApp();
    const { id } = req.params as { id: string };
    if (!TOUR_ID.test(id)) throw httpError(400, 'Id tour chỉ gồm chữ thường, số và gạch nối');
    const body = z
      .object({
        title: z.string().min(2),
        description: z.string().optional(),
        feature: z.string().optional(),
        startRoute: z.string().startsWith('/'),
        steps: z.array(z.object({ key: z.string().optional(), target: z.string().default(''), advanceOn: z.enum(['click', 'next', 'hover']).default('next'), text: z.string().min(1) })).min(1),
      })
      .parse(req.body);

    // Tour ghi bằng locator: sửa trong compass.tours.json, giữ locator của từng bước theo key; lưu = đã duyệt
    const recordedFile = toursPath(dir);
    const recorded = readToursFile(recordedFile);
    const existingRecorded = recorded.tours[id];
    if (existingRecorded) {
      const byKey = new Map(existingRecorded.steps.map((s) => [s.key, s]));
      const steps = body.steps.map((s, i) => {
        const old = s.key ? byKey.get(s.key) : undefined;
        const tourId = s.target.trim() || undefined;
        if (!old?.locator && !tourId) throw httpError(400, `Bước ${i + 1} chưa trỏ vào phần tử nào`);
        return {
          key: old?.key ?? `s${i + 1}`,
          ...(tourId ? { tourId } : {}),
          ...(old?.locator ? { locator: old.locator } : {}),
          ...(old?.route ? { route: old.route } : {}),
          advanceOn: s.advanceOn,
          text: s.text.trim(),
          ...(old?.skipIfNextVisible ? { skipIfNextVisible: true } : {}),
          // Sửa chữ không làm mất dấu vết sửa locator và đề xuất đang chờ duyệt
          ...(old?.healedAt ? { healedAt: old.healedAt } : {}),
          ...(old?.proposal ? { proposal: old.proposal } : {}),
        };
      });
      const { draft: _draft, draftSource: _source, ...rest } = existingRecorded;
      recorded.tours[id] = {
        ...rest,
        title: body.title.trim(),
        description: body.description?.trim() || undefined,
        feature: body.feature || undefined,
        startRoute: body.startRoute,
        steps,
      };
      writeTours(recordedFile, recorded, 'studio');
      invalidateScan();
      return { ok: true };
    }
    if (body.steps.some((s) => !s.target.trim())) throw httpError(400, 'Tour soạn tay cần chọn tourId cho mọi bước');

    const file = overridesPath(dir);
    const doc = loadDoc(file);
    const tours = doc.get('tours', true);
    if (isMap(tours)) (tours as YAMLMap).flow = false;
    const data = {
      title: body.title.trim(),
      ...(body.description?.trim() ? { description: body.description.trim() } : {}),
      ...(body.feature ? { feature: body.feature } : {}),
      startRoute: body.startRoute,
      steps: body.steps.map((s) => ({ target: s.target, ...(s.advanceOn !== 'next' ? { advanceOn: s.advanceOn } : {}), text: s.text.trim() })),
    };
    // Lưu từ Studio = người đã duyệt: tạo lại nút, bỏ chú thích DRAFT của bản ghi tự động
    doc.setIn(['tours', id], doc.createNode(data));
    writeText(file, String(doc));
    invalidateScan();
    return { ok: true };
  });

  app.delete('/api/tours/:id', async (req) => {
    const dir = requireApp();
    const { id } = req.params as { id: string };
    const file = overridesPath(dir);
    const doc = loadDoc(file);
    doc.deleteIn(['tours', id]);
    writeText(file, String(doc));
    const recordedFile = toursPath(dir);
    const recorded = readToursFile(recordedFile);
    if (recorded.tours[id]) {
      delete recorded.tours[id];
      writeTours(recordedFile, recorded, 'studio');
    }
    invalidateScan();
    return { ok: true };
  });

  // Ghi tour bằng Chrome thật trên máy dev; chạy tới khi người bấm "Dừng & lưu" trong khung ghi
  app.post('/api/tours/record', async (req, reply) => {
    const dir = requireApp();
    const body = req.body as { id: string; about?: string; feature?: string; url: string; mobile?: boolean };
    if (!TOUR_ID.test(body.id)) throw httpError(400, 'Id tour chỉ gồm chữ thường, số và gạch nối');
    const layout = body.mobile ? 'mobile' : 'desktop';
    const existing = readToursFile(toursPath(dir)).tours[body.id];
    // Tour đã có chỉ được ghi thêm bản cho bố cục còn thiếu (vd. đã có desktop, giờ ghi mobile)
    const canAddVariant = existing && (existing.layout ?? layoutOfSteps(existing.steps) ?? 'desktop') !== layout && !existing.variants?.[layout];
    if (loadDoc(overridesPath(dir)).hasIn(['tours', body.id]) || (existing && !canAddVariant)) throw httpError(400, `Tour "${body.id}" đã có bản ${layout}; chọn id khác`);
    if (!/^https?:\/\//.test(body.url)) throw httpError(400, 'Địa chỉ web không hợp lệ');
    await stream(reply, async (log) => {
      log('Đang mở Chrome...');
      const { config } = loadConfig(configPath(dir));
      const { recorder, browser } = await recordSession(body.url, body.about ?? '', {
        mobileBreakpoint: config.tours.mobileBreakpoint,
        mobile: body.mobile,
      });
      log('Đã mở Chrome. Đăng nhập, vào màn hình xuất phát, bấm "● Bắt đầu ghi" ở góc trái dưới, thao tác theo luồng, rồi bấm "■ Dừng & lưu".');
      const closed = new Promise<void>((r) => browser.on('disconnected', () => r()));
      await Promise.race([recorder.done, closed]);
      const steps = [...recorder.steps];
      const { startRoute, endRoute, purpose } = recorder;
      await browser.close().catch(() => undefined);
      log(`Đã ghi ${steps.length} lần bấm.`);
      const c = llm();
      await finishRecording(
        { config: configPath(dir), url: body.url, id: body.id, title: undefined, feature: body.feature || undefined, about: body.about, force: false, noLlm: !c.apiKey, dryRun: false, llm: c.apiKey ? c : null },
        { steps, startRoute, endRoute, purpose },
        log,
      );
      invalidateScan();
      return { id: body.id };
    });
  });

  // Chạy lại tour trên web đang chạy (Playwright, không giao diện), sửa locator đã lệch nếu heal
  app.post('/api/tours/verify', async (req, reply) => {
    const dir = requireApp();
    const body = z.object({ url: z.string().regex(/^https?:\/\//), only: z.array(z.string()).optional(), heal: z.boolean().default(false) }).parse(req.body);
    cachedScan(dir);
    await stream(reply, async (log) => {
      log('Đang chạy lại tour bằng Chromium không giao diện (desktop 1280px và mobile 390px)...');
      const report = await verifyTours({ config: configPath(dir), url: body.url, only: body.only, heal: body.heal }, log);
      invalidateScan();
      return report;
    });
  });

  // Người duyệt chấp nhận hoặc bỏ locator đề xuất cho bước nhạy cảm
  app.post('/api/tours/:id/steps/:key/proposal', async (req) => {
    const dir = requireApp();
    const { id, key } = req.params as { id: string; key: string };
    const body = z.object({ approve: z.boolean(), layout: z.enum(['desktop', 'mobile']).optional() }).parse(req.body);
    const file = toursPath(dir);
    const data = readToursFile(file);
    const tour = data.tours[id];
    if (!tour) throw httpError(404, `Không có tour "${id}"`);
    try {
      resolveProposal(data, id, key, body.layout ?? mainLayout(tour), body.approve, today());
    } catch (e) {
      throw httpError(400, (e as Error).message);
    }
    writeTours(file, data, 'studio', `Duyệt đề xuất locator của ${id}/${key}`);
    invalidateScan();
    return { ok: true };
  });

  // Ghi lại phần tử của một bước: Chrome mở ở màn hình của bước, lần bấm đầu tiên thay phần tử, giữ chữ
  app.post('/api/tours/:id/steps/:key/rerecord', async (req, reply) => {
    const dir = requireApp();
    const { id, key } = req.params as { id: string; key: string };
    const body = z.object({ url: z.string().regex(/^https?:\/\//), layout: z.enum(['desktop', 'mobile']).optional() }).parse(req.body);
    const tour = readToursFile(toursPath(dir)).tours[id];
    if (!tour) throw httpError(404, `Không có tour "${id}"`);
    await stream(reply, async (log) => {
      log('Đang mở Chrome...');
      await rerecordStep({ config: configPath(dir), url: body.url, id, key, layout: body.layout ?? mainLayout(tour) }, log);
      invalidateScan();
      return { id, key };
    });
  });
}
