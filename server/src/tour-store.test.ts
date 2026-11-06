import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import Fastify from 'fastify';
import type { FeatureMap, Tour } from '@wealthcompass/contracts';
import { withTours } from './feature-store.js';
import { registerTourAdmin } from './tour-admin.js';
import { TourStore } from './tour-store.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

const tour = (text: string): Tour => ({
  id: 'sell-bond',
  title: 'Bán trái phiếu',
  startRoute: '/home',
  layout: 'desktop',
  steps: [
    { key: 's1', text, advanceOn: 'click', locator: { tag: 'a', role: 'link', name: 'Tài sản', attrs: {}, context: {} } },
    { key: 's2', text: 'Bấm **Bán**.', advanceOn: 'next', locator: { tag: 'button', role: 'button', name: 'Bán', attrs: {}, context: {} } },
  ],
  variants: { mobile: [{ key: 's1', text: 'Mở menu.', advanceOn: 'click', locator: { tag: 'button', name: 'Menu', attrs: {}, context: {} } }] },
});

async function admin() {
  const store = new TourStore(mkdtempSync(join(tmpdir(), 'compass-tours-')));
  let changes = 0;
  const app = Fastify();
  await registerTourAdmin(app, { tours: store, adminToken: 'secret-token', onChange: () => changes++ });
  const auth = { authorization: 'Bearer secret-token' };
  return { app, store, auth, changes: () => changes };
}

test('kho tour: mỗi lần lưu là một phiên bản, quay về bản cũ tạo bản mới, nội dung không đổi thì không tạo bản', async () => {
  const { app, store, auth, changes } = await admin();
  const put = (t: Tour, extra: object = {}) => app.inject({ method: 'PUT', url: '/admin/tours/sell-bond', headers: auth, payload: { tour: t, feature: 'iconnect.assets', ...extra } });

  assert.deepEqual((await put(tour('Mở tab **Tài sản**.'), { by: 'ci' })).json(), { version: 1, unchanged: false });
  assert.deepEqual((await put(tour('Mở tab **Tài sản**.'))).json(), { version: 1, unchanged: true });
  assert.deepEqual((await put(tour('Chuyển sang tab **Tài sản**.'))).json(), { version: 2, unchanged: false });
  assert.equal(changes(), 2);

  const detail = (await app.inject({ url: '/admin/tours/sell-bond', headers: auth })).json();
  assert.equal(detail.version, 2);
  assert.equal(detail.tour.steps[0].text, 'Chuyển sang tab **Tài sản**.');
  assert.deepEqual(detail.history.map((h: { version: number; savedBy: string }) => [h.version, h.savedBy]), [[2, 'admin'], [1, 'ci']]);

  const rollback = await app.inject({ method: 'POST', url: '/admin/tours/sell-bond/rollback', headers: auth, payload: { version: 1 } });
  assert.deepEqual(rollback.json(), { version: 3 });
  assert.equal(store.current('sell-bond')!.tour.steps[0].text, 'Mở tab **Tài sản**.');
  assert.equal(store.current('sell-bond')!.note, 'Quay về phiên bản 1');
  assert.equal((await app.inject({ url: '/admin/tours/sell-bond/versions/2', headers: auth })).json().tour.steps[0].text, 'Chuyển sang tab **Tài sản**.');

  // Đọc lại từ đĩa
  const reopened = new TourStore((store as unknown as { dir: string }).dir);
  assert.equal(reopened.list()[0].version, 3);
  assert.equal(reopened.list()[0].versions, 3);
});

test('kho tour: từ chối khi thiếu/sai khóa quản trị, tour sai, id lệch', async () => {
  const { app, auth } = await admin();
  assert.equal((await app.inject({ url: '/admin/tours' })).statusCode, 401);
  assert.equal((await app.inject({ url: '/admin/tours', headers: { authorization: 'Bearer wrong-token!' } })).statusCode, 401);
  assert.equal((await app.inject({ url: '/admin/tours', headers: auth })).statusCode, 200);
  const bad = await app.inject({ method: 'PUT', url: '/admin/tours/sell-bond', headers: auth, payload: { tour: { id: 'sell-bond', title: 'x', startRoute: '/', steps: [{ text: 'không trỏ vào đâu' }] } } });
  assert.equal(bad.statusCode, 400);
  assert.equal((await app.inject({ method: 'PUT', url: '/admin/tours/other-tour', headers: auth, payload: { tour: tour('a') } })).json().error, 'id_mismatch');
  assert.equal((await app.inject({ url: '/admin/tours/..%2Fetc', headers: auth })).statusCode, 400);
});

test('kho tour: ảnh chụp từng bước chỉ nhận PNG, gắn đường dẫn ảnh khi phục vụ tour, xóa tour xóa cả ảnh', async () => {
  const { app, store, auth } = await admin();
  await app.inject({ method: 'PUT', url: '/admin/tours/sell-bond', headers: auth, payload: { tour: tour('Mở tab.') } });
  const upload = (layout: string, key: string, body: Buffer) =>
    app.inject({ method: 'PUT', url: `/admin/tours/sell-bond/shots/${layout}/${key}`, headers: { ...auth, 'content-type': 'image/png' }, payload: body });
  assert.equal((await upload('desktop', 's2', PNG)).statusCode, 204);
  assert.equal((await upload('mobile', 's1', PNG)).statusCode, 204);
  assert.equal((await upload('desktop', 's1', Buffer.from('<svg/>'))).statusCode, 400, 'không phải PNG');
  assert.equal((await upload('tablet', 's1', PNG)).statusCode, 400, 'bố cục không hợp lệ');

  const served = store.withShots(store.current('sell-bond')!.tour);
  assert.equal(served.steps[0].shot, undefined);
  assert.equal(served.steps[1].shot, '/v1/tours/sell-bond/shots/desktop/s2');
  assert.equal(served.variants?.mobile?.[0].shot, '/v1/tours/sell-bond/shots/mobile/s1');
  assert.deepEqual(store.readShot('sell-bond', 'desktop', 's2'), PNG);
  assert.equal(store.readShot('sell-bond', '../x', 's2'), null);

  // Đường dẫn ảnh do kho gắn, không lưu vào phiên bản
  await app.inject({ method: 'PUT', url: '/admin/tours/sell-bond', headers: auth, payload: { tour: served } });
  assert.equal(store.current('sell-bond')!.version, 1, 'tour kèm shot vẫn tính là không đổi');

  assert.equal((await app.inject({ method: 'DELETE', url: '/admin/tours/sell-bond', headers: auth })).statusCode, 204);
  assert.equal(store.readShot('sell-bond', 'desktop', 's2'), null);
  assert.equal((await app.inject({ url: '/admin/tours/sell-bond', headers: auth })).statusCode, 404);
});

test('tour trong kho thay tour cùng id của Feature Map và đổi tính năng sở hữu', () => {
  const map = {
    schemaVersion: '2',
    appVersion: '1',
    generatedAt: '',
    features: [
      { id: 'home', tourIds: ['sell-bond', 'other'] },
      { id: 'iconnect.assets', tourIds: [] },
    ],
    tours: [{ ...tour('cũ'), id: 'sell-bond' }, { ...tour('khác'), id: 'other' }],
    coverage: { routesFound: 0, routesWithTitle: 0, menuItemsMatched: 0, targetsFound: 0, warnings: [] },
  } as unknown as FeatureMap;
  const merged = withTours(map, [{ tour: tour('mới'), feature: 'iconnect.assets' }, { tour: { ...tour('x'), id: 'stored-only' } }]);
  assert.equal(merged.tours.find((t) => t.id === 'sell-bond')!.steps[0].text, 'mới');
  assert.equal(merged.tours.filter((t) => t.id === 'sell-bond').length, 1);
  assert.ok(merged.tours.some((t) => t.id === 'stored-only'));
  assert.deepEqual(merged.features.find((f) => f.id === 'home')!.tourIds, ['other']);
  assert.deepEqual(merged.features.find((f) => f.id === 'iconnect.assets')!.tourIds, ['sell-bond']);
  assert.equal(withTours(map, []), map);
});
