import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { logStats, scoreCase, summarize } from './routes-phase3';

const ranked = (...items: Array<[string, number, boolean?]>) => items.map(([id, score, allowed = true]) => ({ id, title: id, score, allowed }));
const search = (r: ReturnType<typeof ranked>) => ({ terms: [], threshold: 1.2, ranked: r });

test('chấm điểm: thứ hạng chỉ tính màn hình trợ lý thấy được; lý do khi trượt', () => {
  // Màn hình thiếu quyền đứng đầu bị bỏ qua khi tính hạng
  const ok = scoreCase({ q: 'a', expect: ['b'] }, search(ranked(['x', 9, false], ['b', 5], ['c', 3])));
  assert.deepEqual([ok.rank, ok.pass, ok.top.map((t) => t.id)], [1, true, ['b', 'c']]);
  assert.equal(scoreCase({ q: 'a', expect: ['d'] }, search(ranked(['a', 5], ['b', 4], ['c', 3], ['d', 2]))).reason, 'xếp thứ 4');
  assert.equal(scoreCase({ q: 'a', expect: ['b'] }, search(ranked(['b', 9, false]))).reason, 'người hỏi thiếu quyền');
  assert.equal(scoreCase({ q: 'a', expect: ['b'] }, search(ranked(['b', 0.5]))).reason, 'điểm 0.5 dưới ngưỡng 1.2');
  assert.equal(scoreCase({ q: 'a', expect: ['b'] }, search([])).reason, 'không khớp từ nào');

  const s = summarize([
    scoreCase({ q: '1', expect: ['a'] }, search(ranked(['a', 5]))),
    scoreCase({ q: '2', expect: ['a'] }, search(ranked(['b', 5], ['a', 4]))),
    scoreCase({ q: '3', expect: ['a'] }, search([])),
  ]);
  assert.deepEqual([s.hit1, s.hit3, s.mrr, s.failed], [1 / 3, 2 / 3, 0.5, 1]);
});

test('thống kê nhật ký: kết quả, câu không tìm thấy gom theo dạng chuẩn hóa, phễu tour', () => {
  const t = (n: number) => `2026-10-0${n}T10:00:00.000Z`;
  const stats = logStats(
    [
      { ts: t(1), event: 'chat', user: 'u1', q: 'Xin nghỉ', outcome: 'offered', offered: ['tao-don', 'leave.request'], ms: 1000 },
      { ts: t(1), event: 'chat', user: 'u2', q: 'Lương thưởng?', outcome: 'not_found', ms: 3000 },
      { ts: t(2), event: 'chat', user: 'u2', q: 'luong thuong', outcome: 'not_found', ms: 2000 },
      { ts: t(2), event: 'chat', user: 'u1', q: 'làm hộ tôi', outcome: 'refused', topic: 'act_on_behalf' },
      { ts: t(2), event: 'telemetry', what: 'tour_start', tourId: 'tao-don' },
      { ts: t(2), event: 'telemetry', what: 'tour_end', tourId: 'tao-don', status: 'completed' },
    ],
    new Set(['tao-don']),
  );
  assert.equal(stats.questions, 4);
  assert.equal(stats.users, 2);
  assert.deepEqual(stats.outcomes, { offered: 1, answered: 0, not_found: 2, refused: 1, error: 0 });
  assert.deepEqual(stats.notFound.map((n) => [n.q, n.count]), [['luong thuong', 2]], 'có dấu và không dấu là một câu');
  assert.deepEqual(stats.funnel, [{ tourId: 'tao-don', offered: 1, started: 1, completed: 1, cancelled: 0, failed: 0 }], 'leave.request là màn hình, không phải tour');
  assert.equal(stats.latency.p50, 2000);
  assert.deepEqual(stats.daily, [{ day: '2026-10-01', n: 2 }, { day: '2026-10-02', n: 2 }]);
});
