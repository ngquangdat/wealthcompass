import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { tourSchema } from '@wealthcompass/contracts';
import { TOUR_ID, type TourStore } from './tour-store.js';

// API quản trị kho tour: chỉ bật khi đặt COMPASS_ADMIN_TOKEN. Dùng bởi `tour:push` (CI sau khi tour:verify)
// và công cụ nội bộ. Khóa quản trị tách khỏi JWT của người dùng cuối: người dùng web không bao giờ sửa được tour.

export interface TourAdminDeps {
  tours: TourStore;
  adminToken: string;
  // Gọi sau mỗi lần kho đổi (nạp lại tour vào FeatureStore)
  onChange: () => void;
}

const saveBody = z.object({ tour: tourSchema, feature: z.string().optional(), note: z.string().max(200).optional(), by: z.string().max(80).optional() });

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function registerTourAdmin(app: FastifyInstance, deps: TourAdminDeps): Promise<void> {
  const { tours } = deps;
  await app.register(async (admin) => {
    // Ảnh PNG gửi thẳng làm body
    admin.addContentTypeParser('image/png', { parseAs: 'buffer', bodyLimit: 2 * 1024 * 1024 }, (_req, body, done) => done(null, body));
    admin.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      const header = request.headers.authorization ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token || !sameToken(token, deps.adminToken)) return reply.code(401).send({ error: 'unauthorized' });
    });
    const by = (request: FastifyRequest, given?: string) => given?.trim() || String(request.headers['x-compass-user'] ?? 'admin').slice(0, 80);
    const id = (request: FastifyRequest) => {
      const value = (request.params as { id: string }).id;
      if (!TOUR_ID.test(value)) throw Object.assign(new Error('Id tour không hợp lệ'), { statusCode: 400 });
      return value;
    };

    admin.get('/admin/tours', async () => ({ tours: tours.list() }));

    admin.get('/admin/tours/:id', async (request, reply) => {
      const current = tours.current(id(request));
      if (!current) return reply.code(404).send({ error: 'not_found' });
      return { ...current, history: tours.history(current.tour.id) };
    });

    admin.get('/admin/tours/:id/versions/:version', async (request, reply) => {
      const v = tours.version(id(request), Number((request.params as { version: string }).version));
      return v ?? reply.code(404).send({ error: 'not_found' });
    });

    // Lưu = phiên bản mới; id trong đường dẫn phải trùng id trong tour
    admin.put('/admin/tours/:id', async (request, reply) => {
      const tourId = id(request);
      const parsed = saveBody.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_tour', detail: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) });
      if (parsed.data.tour.id !== tourId) return reply.code(400).send({ error: 'id_mismatch' });
      const before = tours.current(tourId)?.version;
      // Nội dung không đổi: kho không tạo bản mới (tour:push chạy mỗi đêm vẫn giữ lịch sử gọn)
      const saved = tours.save({ tour: parsed.data.tour, feature: parsed.data.feature, note: parsed.data.note, by: by(request, parsed.data.by) });
      if (saved.version === before) return { version: saved.version, unchanged: true };
      deps.onChange();
      return { version: saved.version, unchanged: false };
    });

    admin.post('/admin/tours/:id/rollback', async (request, reply) => {
      const tourId = id(request);
      const version = Number((request.body as { version?: unknown } | undefined)?.version);
      if (!tours.version(tourId, version)) return reply.code(404).send({ error: 'not_found' });
      const saved = tours.rollback(tourId, version, by(request));
      deps.onChange();
      return { version: saved.version };
    });

    admin.delete('/admin/tours/:id', async (request, reply) => {
      if (!tours.remove(id(request))) return reply.code(404).send({ error: 'not_found' });
      deps.onChange();
      return reply.code(204).send();
    });

    admin.put('/admin/tours/:id/shots/:layout/:key', async (request, reply) => {
      const { layout, key } = request.params as { layout: string; key: string };
      const tourId = id(request);
      if (!tours.has(tourId)) return reply.code(404).send({ error: 'not_found' });
      if (!Buffer.isBuffer(request.body)) return reply.code(415).send({ error: 'png_required' });
      try {
        tours.saveShot(tourId, layout, key, request.body);
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : 'invalid_shot' });
      }
      return reply.code(204).send();
    });
  });
}
