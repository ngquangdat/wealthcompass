import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { currentLayout, layoutUsed, resumeStep, routeMatches, stepsForLayout } from './resolver';

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

test('bố cục theo bề rộng: dưới 768 là điện thoại, dưới 1024 là iPad, còn lại là desktop', () => {
  assert.equal(currentLayout(768, 390), 'mobile');
  assert.equal(currentLayout(768, 820), 'tablet');
  assert.equal(currentLayout(768, 1180), 'desktop');
  assert.equal(currentLayout(768, 900, 800), 'desktop');
});

test('chọn bản tour theo thiết bị: thiếu bản iPad thì dùng bản desktop, thiếu bản điện thoại thì dùng bản chính', () => {
  const d = ['d'], m = ['m'], t = ['t'];
  assert.equal(stepsForLayout({ steps: d }, 'tablet'), d);
  assert.equal(stepsForLayout({ steps: m, layout: 'mobile' as const, variants: { desktop: d } }, 'tablet'), d);
  assert.equal(layoutUsed({ steps: m, layout: 'mobile' as const, variants: { desktop: d } }, 'tablet'), 'desktop');
  assert.equal(stepsForLayout({ steps: d, variants: { tablet: t, mobile: m } }, 'tablet'), t);
  assert.equal(stepsForLayout({ steps: t, layout: 'tablet' as const }, 'desktop'), t);
  assert.equal(stepsForLayout({ steps: d, variants: { tablet: t } }, 'mobile'), d);
  assert.equal(stepsForLayout({ steps: d, variants: { mobile: m } }, 'mobile'), m);
});
