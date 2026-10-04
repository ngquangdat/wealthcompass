import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resumeStep, routeMatches } from './resolver';

test('route của bước khớp cả tham số; query không tính', () => {
  assert.equal(routeMatches('/orders/:id', '/orders/42?tab=1'), true);
  assert.equal(routeMatches('/orders/:id', '/orders'), false);
  assert.equal(routeMatches('/', '/'), true);
  assert.equal(routeMatches('/profile', '/profile/edit'), false);
});

test('tour bắt đầu giữa chừng khi người dùng đã ở màn hình của một bước sau', () => {
  const tour = { startRoute: '/dashboard', steps: [{ route: '/dashboard' }, { route: '/profile' }, { route: '/profile' }] };
  assert.equal(resumeStep(tour, '/dashboard'), 0, 'đang ở màn hình xuất phát');
  assert.equal(resumeStep(tour, '/profile'), 1, 'bỏ bước bấm menu, bắt đầu ở ô mật khẩu');
  assert.equal(resumeStep(tour, '/payslips'), 0, 'màn hình không thuộc tour: về màn hình xuất phát');
  // Phần tử khung chung (menu) có route là màn hình đầu tiên tìm thấy: không được coi là "đã tới"
  assert.equal(resumeStep({ startRoute: '/home', steps: [{ route: '/home' }, { route: '/a' }, { route: '/b' }] }, '/b'), 2);
});
