import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../scan';
import { loadFeatureMap } from '../record/run';

export interface PushOptions {
  config: string;
  // Gốc backend (http://localhost:8890)
  server: string;
  token: string;
  only?: string[];
  // Thư mục ảnh của `tour:verify --screenshots`
  shots?: string;
  note?: string;
  by?: string;
  dryRun?: boolean;
  fetchImpl?: typeof fetch;
}

// Đưa tour đã quét (feature-map.json) lên kho tour của backend. Mỗi tour đổi nội dung thành một phiên bản mới;
// tour không đổi thì backend bỏ qua. Ảnh chụp từng bước (nếu có) đi kèm để widget hiện khi không chắc phần tử.
export async function pushTours(opts: PushOptions, log: (msg: string) => void = console.log): Promise<{ pushed: number; unchanged: number; shots: number }> {
  const { config, root } = loadConfig(opts.config);
  const featureMap = loadFeatureMap(join(root, config.discovery.out));
  if (!featureMap) throw new Error(`Chưa có ${config.discovery.out}: chạy \`scan\` trước.`);
  const tours = featureMap.tours.filter((t) => !opts.only?.length || opts.only.includes(t.id));
  if (!tours.length) throw new Error('Không có tour nào để đẩy lên.');
  const base = opts.server.replace(/\/$/, '');
  const doFetch = opts.fetchImpl ?? fetch;
  const headers = { Authorization: `Bearer ${opts.token}`, ...(opts.by ? { 'X-Compass-User': opts.by } : {}) };
  let pushed = 0;
  let unchanged = 0;
  let shots = 0;
  for (const tour of tours) {
    const feature = featureMap.features.find((f) => f.tourIds.includes(tour.id))?.id;
    if (opts.dryRun) {
      log(`· ${tour.id}${feature ? ` (${feature})` : ''}: ${tour.steps.length} bước (dry-run)`);
      continue;
    }
    const res = await doFetch(`${base}/admin/tours/${encodeURIComponent(tour.id)}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tour, feature, note: opts.note }),
    });
    if (res.status === 401) throw new Error('Backend từ chối khóa quản trị (COMPASS_ADMIN_TOKEN).');
    if (res.status === 404) throw new Error('Backend chưa bật API quản trị tour (đặt COMPASS_ADMIN_TOKEN cho server).');
    if (!res.ok) throw new Error(`Đẩy tour "${tour.id}" lỗi ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { version: number; unchanged: boolean };
    if (body.unchanged) unchanged++;
    else pushed++;
    log(`${body.unchanged ? '=' : '↑'} ${tour.id} v${body.version}${body.unchanged ? ' (không đổi)' : ''}`);

    const dir = opts.shots ? join(opts.shots, tour.id) : null;
    if (!dir || !existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => /^(desktop|tablet|mobile)-[\w-]+\.png$/.test(f))) {
      const [, layout, key] = /^(desktop|tablet|mobile)-([\w-]+)\.png$/.exec(file)!;
      const shot = await doFetch(`${base}/admin/tours/${encodeURIComponent(tour.id)}/shots/${layout}/${key}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'image/png' },
        body: readFileSync(join(dir, file)),
      });
      if (shot.ok) shots++;
      else log(`! Ảnh ${file} của ${tour.id}: lỗi ${shot.status}`);
    }
  }
  log(`\nĐã đẩy ${pushed} tour, ${unchanged} không đổi${shots ? `, ${shots} ảnh` : ''}.`);
  return { pushed, unchanged, shots };
}
