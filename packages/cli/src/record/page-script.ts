// Script chạy TRONG trình duyệt. Viết thành chuỗi JS thuần (không phải hàm TypeScript) vì công cụ
// chạy TS có thể chèn hàm phụ (như __name) mà trang không có, làm vỡ khi serialize sang trình duyệt.
// Không dùng backtick hay ${...} bên trong chuỗi này.
export const PAGE_SCRIPT = `
(function () {
  // Script khởi tạo chạy khi tài liệu chưa có <html>; phải đợi rồi mới cài, không bỏ qua
  if (window.__compassRecorderInstalled) return;
  if (!document.documentElement) {
    document.addEventListener('readystatechange', function retry() {
      if (document.documentElement) { document.removeEventListener('readystatechange', retry); install(); }
    });
    return;
  }
  install();

  function install() {
  if (window.__compassRecorderInstalled) return;
  window.__compassRecorderInstalled = true;

  // Cùng quy tắc nền với SafetyPolicy ở client: những phần tử này không bao giờ để lần bấm chạy thật
  var USER_ONLY = ['input[type=password]', 'input[autocomplete=one-time-code]', '[data-sensitive]', '[data-tour-role=user-only]'];
  var state = { recording: false, highlight: false, count: 0, last: '', lastNote: '', noIdCount: 0, mobileBreakpoint: 768 };

  var host = document.createElement('div');
  host.id = '__compass-recorder';
  host.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;';
  var root = host.attachShadow({ mode: 'open' });
  root.innerHTML = [
    '<style>',
    '.bar{font:13px/1.4 Roboto,Arial,sans-serif;background:#1b1b1b;color:#f5f5f5;border:1px solid #444;border-radius:10px;padding:10px 12px;box-shadow:0 6px 24px rgba(0,0,0,.6);width:250px}',
    'b{display:block;margin-bottom:6px}',
    '.grip{cursor:move;user-select:none;-webkit-user-select:none;display:flex;align-items:center;gap:6px;margin:-4px -4px 6px;padding:4px;border-radius:6px}',
    '.grip:hover{background:#2a2a2a}',
    '.grip b{margin:0;flex:1}',
    '.grip span{color:#888;font-size:14px;letter-spacing:1px}',
    'button{font:inherit;border:0;border-radius:6px;padding:6px 10px;margin:2px 4px 2px 0;cursor:pointer;color:#fff;background:#444}',
    '.rec{background:#e53935}.stop{background:#43a047}.on{background:#fbac20;color:#222}',
    'small{color:#bbb;display:block;margin-top:6px}',
    'label{display:block;font-size:12px;color:#ddd;margin-bottom:4px}',
    'textarea{width:100%;box-sizing:border-box;resize:vertical;min-height:58px;border-radius:6px;border:1px solid #555;background:#2a2a2a;color:#f5f5f5;font:12.5px/1.4 Roboto,Arial,sans-serif;padding:6px 8px;margin-bottom:6px}',
    'textarea.warn{border-color:#e53935}',
    '.warn-text{color:#ff8a80}',
    '</style>',
    '<div class="bar"><div class="grip" id="grip" title="Kéo để dời khung ghi"><b>WealthCompass · ghi tour</b><span>⋮⋮</span></div>',
    '<label for="purpose">Bạn đang ghi tour cho tính năng gì?</label>',
    '<textarea id="purpose" maxlength="600" placeholder="VD: Hướng dẫn khách bán trái phiếu đang nắm giữ, từ trang chủ tới nút BÁN"></textarea>',
    '<div id="body"></div></div>'
  ].join('');
  var body = root.getElementById('body');
  var purposeEl = root.getElementById('purpose');
  var confirmedEmpty = false;
  // Ảnh các phần tử bấm được đang hiện ở lần bấm trước: để biết lần bấm này trúng phần tử vừa được mở ra
  var lastSnapshot = null;

  // Kéo khung ghi ra chỗ khác (nắm ở thanh tiêu đề) khi nó che mất phần tử cần bấm. Vị trí được nhớ qua các lần
  // chuyển trang trong cùng tab. Lần bấm/kéo trên khung không bao giờ bị ghi thành bước tour.
  var POS_KEY = '__compassRecorderPos';
  function place(left, top) {
    var w = host.offsetWidth || 276, h = host.offsetHeight || 160;
    left = Math.max(4, Math.min(left, window.innerWidth - w - 4));
    top = Math.max(4, Math.min(top, window.innerHeight - h - 4));
    host.style.left = left + 'px';
    host.style.top = top + 'px';
    host.style.bottom = 'auto';
    return { left: left, top: top };
  }
  function restorePlace() {
    try {
      var saved = JSON.parse(sessionStorage.getItem(POS_KEY) || 'null');
      if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') place(saved.left, saved.top);
    } catch (err) { /* không có vị trí đã nhớ */ }
  }
  var drag = null;
  root.getElementById('grip').addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    var r = host.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.preventDefault();
  });
  window.addEventListener('mousemove', function (e) {
    if (!drag) return;
    place(e.clientX - drag.dx, e.clientY - drag.dy);
    e.preventDefault(); e.stopPropagation();
  }, true);
  window.addEventListener('mouseup', function (e) {
    if (!drag) return;
    var pos = place(e.clientX - drag.dx, e.clientY - drag.dy);
    drag = null;
    try { sessionStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (err) { /* không nhớ được cũng không sao */ }
    e.preventDefault(); e.stopPropagation();
  }, true);
  // Cửa sổ đổi cỡ: giữ khung trong màn hình
  window.addEventListener('resize', function () { if (host.style.bottom === 'auto') place(parseFloat(host.style.left) || 0, parseFloat(host.style.top) || 0); });

  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  function render() {
    if (!state.recording) {
      body.innerHTML = '<button class="rec" data-cmd="start">● Bắt đầu ghi</button>' +
        '<small>Đăng nhập và mở màn hình xuất phát trước, rồi bấm nút này. Màn hình hiện tại là điểm bắt đầu của tour.</small>';
    } else {
      body.innerHTML = '<button class="stop" data-cmd="stop">' + (confirmedEmpty ? '■ Vẫn dừng, không mô tả' : '■ Dừng &amp; lưu') + '</button>' +
        '<button class="' + (state.highlight ? 'on' : '') + '" data-cmd="toggleHighlight">Tô sáng (không bấm): ' + (state.highlight ? 'BẬT' : 'tắt') + '</button>' +
        '<small>Đã ghi ' + state.count + ' bước' + (state.last ? ' · gần nhất: ' + esc(state.last) : '') +
        '.' + (state.lastNote ? '<br><span class="warn-text">⚠ ' + esc(state.lastNote) + '</span>' : '') + (state.noIdCount ? '<br><span class="warn-text">' + state.noIdCount + ' bước không có tourId, tìm theo selector.</span>' : '') + (confirmedEmpty ? '<br><span class="warn-text">Chưa có mô tả: LLM sẽ phải đoán tính năng từ tên nút.</span>' : '') + '<br>Bấm vào từng phần tử theo thứ tự muốn dẫn; không cần tourId trong HTML. <b style="display:inline;margin:0">Mọi lần bấm chạy thật.</b> Nút không muốn bấm thật (đặt lệnh, xác nhận): bật <b style="display:inline;margin:0">Tô sáng (không bấm)</b> trước khi bấm, rồi tắt.<br><b style="display:inline;margin:0">Menu mở bằng hover:</b> di chuột vào nút mở menu rồi nhấn <b style="display:inline;margin:0">Alt+H</b> (⌥H) để ghi bước hover, sau đó bấm mục trong menu.</small>';
    }
  }

  function applyState(s) {
    state = s;
    // Không ghi đè chữ người dùng đang gõ; chỉ điền khi ô còn trống (giá trị từ --about hoặc sau khi tải lại trang)
    if (s.purpose && !purposeEl.value) purposeEl.value = s.purpose;
    render();
  }
  function sync() {
    return window.__compassRecorderState().then(applyState);
  }
  // Node đẩy trạng thái mới xuống khi bắt đầu/dừng; trang không phải chờ lượt hỏi
  window.__compassRecorderSet = applyState;

  purposeEl.addEventListener('input', function () {
    confirmedEmpty = false;
    purposeEl.className = '';
    window.__compassRecorderSetPurpose(purposeEl.value);
  });

  root.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-cmd]') : null;
    if (!el) return;
    var cmd = el.getAttribute('data-cmd');
    // Dừng mà chưa mô tả: nhắc một lần (LLM soạn đúng hơn nhiều khi biết mục đích), bấm lần nữa mới dừng
    if (cmd === 'stop' && !purposeEl.value.trim() && !confirmedEmpty) {
      confirmedEmpty = true;
      purposeEl.className = 'warn';
      purposeEl.focus();
      render();
      return;
    }
    window.__compassRecorderCommand(cmd).then(sync);
  });

  // tourId lồng nhau: lấy tourId của chính nút vừa bấm, không lấy của vùng chứa bao ngoài (quy tắc trong pickTourId của core)
  function pickTour(target) {
    try { if (window.__compassPickTourId) return window.__compassPickTourId(target); } catch (err) { /* dùng cách dưới */ }
    var near = target.closest('[data-tour-id]');
    return { element: near, tourId: near ? near.getAttribute('data-tour-id') : null };
  }

  function flash(el) {
    var prev = el.style.outline;
    el.style.outline = '3px solid #e53935';
    setTimeout(function () { el.style.outline = prev; }, 700);
  }

  document.addEventListener('click', function (e) {
    if (e.composedPath().indexOf(host) !== -1 || !state.recording) return;
    var target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    var pick = pickTour(target);
    var marked = pick.element;
    var source = marked || target;
    // Ghi locator TRƯỚC khi app xử lý lần bấm (đang ở pha capture nên DOM chưa đổi)
    var locator = null;
    try { if (window.__compassCapture) locator = window.__compassCapture(source, { mobileBreakpoint: state.mobileBreakpoint }); } catch (err) { locator = null; }
    var appeared = false;
    try {
      if (window.__compassAppeared) appeared = window.__compassAppeared(lastSnapshot, source);
      if (window.__compassSnapshot) lastSnapshot = window.__compassSnapshot(document);
    } catch (err) { appeared = false; }
    // Chỉ phần tử dev đã đánh dấu (hoặc ô mật khẩu/OTP) mới tự bị chặn. Nút khác muốn chỉ tô sáng: người ghi bật công tắc.
    var userOnly = USER_ONLY.some(function (sel) { return target.closest(sel); });
    var block = userOnly || state.highlight;
    if (block) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
    window.__compassRecorderEvent({
      tourId: pick.tourId,
      skippedTourId: pick.skipped || null,
      route: location.pathname,
      advanceOn: block ? 'next' : 'click',
      userOnly: !!userOnly,
      tag: target.tagName.toLowerCase(),
      text: String(source.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 60),
      locator: locator,
      appeared: appeared
    });
    flash(source);
    setTimeout(sync, 50);
  }, true);

  // Menu hover (desktop): không có lần bấm nào trên nút mở menu, nên người ghi nhấn Alt+H khi chuột đang ở trên nó.
  // Phải là phím tắt: đưa chuột xuống khung ghi để bấm nút thì menu đã đóng.
  document.addEventListener('keydown', function (e) {
    if (!state.recording || !e.altKey || e.code !== 'KeyH') return;
    e.preventDefault(); e.stopPropagation();
    var hovered = document.querySelectorAll(':hover');
    var target = hovered.length ? hovered[hovered.length - 1] : null;
    if (!target || target === document.documentElement || target === document.body || host.contains(target)) return;
    var pick = pickTour(target);
    var marked = pick.element;
    var source = marked || target;
    var locator = null;
    try { if (window.__compassCapture) locator = window.__compassCapture(source, { mobileBreakpoint: state.mobileBreakpoint }); } catch (err) { locator = null; }
    try { if (window.__compassSnapshot) lastSnapshot = window.__compassSnapshot(document); } catch (err) { /* bỏ qua */ }
    window.__compassRecorderEvent({
      tourId: pick.tourId,
      skippedTourId: pick.skipped || null,
      route: location.pathname,
      advanceOn: 'hover',
      userOnly: false,
      tag: target.tagName.toLowerCase(),
      text: String(source.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 60),
      locator: locator,
      appeared: false
    });
    flash(source);
    setTimeout(sync, 50);
  }, true);

  function mount() { document.documentElement.appendChild(host); restorePlace(); sync(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  }
})();
`;
