// Khóa hover: giữ menu mở bằng hover (menu desktop) trong lúc tour tô sáng và chờ người dùng bấm mục bên trong.
// Không khóa thì menu đóng ngay khi chuột rời nút mở (để bấm "Tiếp", đọc popover, hoặc khi lớp phủ của tour che nút mở).
//
// Khóa đặt ở tầng thấp nhất mà app không vượt qua được:
// 1. Cổng sự kiện (installHoverGuard, cài khi widget khởi tạo, trước khi app đăng ký listener): bọc MỌI listener của
//    các sự kiện chuột/cuộn mà app đăng ký qua addEventListener, dù gắn ở window, document hay phần tử, pha nào. Trong
//    lúc khóa, listener của app không nhận: sự kiện rời chuột (mouseleave/out, pointerleave/out) ở bất kỳ đâu; sự kiện
//    chuột (enter/over/move) xảy ra NGOÀI vùng menu, kể cả trên popover của tour (popover không cần các sự kiện này,
//    còn app thì đóng menu khi thấy chuột ở chỗ khác); sự kiện cuộn ngoài vùng menu (CDK đóng overlay khi trang cuộn).
//    Thêm một listener capture trên window (cài sớm nhất) chặn luôn cho listener đăng ký trước khi cổng được cài.
// 2. CSS (:hover): không ép được :hover từ JS, nên đóng băng kiểu hiển thị hiện tại (display, visibility, opacity...)
//    của mục cần giữ và các tổ tiên của nó bằng inline style !important.
// 3. Menu vẫn bị app gỡ (đóng theo cách khác): reopen() bắn lại sự kiện hover lên nút mở để menu JS mở lại.
// Nhả khóa: mở cổng, trả style cũ, rồi bắn mouseleave/mouseout vào nút mở để menu JS tự đóng.

export interface HoverLock {
  // Giữ thêm một phần tử (mục của bước sau trong cùng menu, menu con)
  hold(element: Element): void;
  // Mở lại menu khi app đã đóng nó (chỉ với menu mở bằng JS)
  reopen(): void;
  release(): void;
}

export interface HoverLockOptions {
  // Ghi diễn biến (bật debug): sự kiện bị chặn đầu tiên mỗi loại, menu bị gỡ kèm các sự kiện gần nhất đã tới app
  trace?: (msg: string) => void;
}

const LEAVE_EVENTS = new Set(['mouseleave', 'mouseout', 'pointerleave', 'pointerout']);
// Sự kiện báo "chuột đang ở chỗ khác": chặn khi xảy ra ngoài vùng menu
const ENTER_EVENTS = new Set(['mouseenter', 'mouseover', 'mousemove', 'pointerenter', 'pointerover', 'pointermove']);
const SCROLL_EVENTS = new Set(['scroll']);
const GATED = new Set([...LEAVE_EVENTS, ...ENTER_EVENTS, ...SCROLL_EVENTS]);
const FROZEN_PROPS = ['display', 'visibility', 'opacity', 'pointer-events', 'transform', 'max-height'] as const;
const MAX_DEPTH = 12;
// Lớp nền trong suốt của menu CDK/Material: phủ cả trang nên KHÔNG BAO GIỜ là vùng menu (chuột trên nó là chuột ở ngoài)
const BACKDROP = '.cdk-overlay-backdrop, .mat-mdc-menu-backdrop, .cdk-overlay-transparent-backdrop';

// Khung cỡ gần cả trang (cdk-overlay-container, khung bọc toàn màn hình): không dùng làm vùng menu
function pageSized(element: Element): boolean {
  const r = element.getBoundingClientRect();
  const vw = window.innerWidth || 1;
  const vh = window.innerHeight || 1;
  return r.width >= vw * 0.9 && r.height >= vh * 0.9;
}

function describe(node: EventTarget | null): string {
  if (!(node instanceof Element)) return node === document ? 'document' : node === window ? 'window' : String(node);
  const cls = typeof node.className === 'string' && node.className.trim() ? '.' + node.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
  return node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') + cls;
}

// ---------------------------------------------------------------------------
// Cổng sự kiện dùng chung cho mọi khóa đang giữ
// ---------------------------------------------------------------------------

interface ActiveLock {
  inZone(node: EventTarget | null): boolean;
  seen(event: Event, blocked: boolean): void;
}
const active = new Set<ActiveLock>();
// Listener của chính WealthCompass (bắt hover/click của tour): không đi qua cổng
const UNGATED = Symbol.for('wealthcompass.ungated');

// Sự kiện này có bị giấu khỏi app không (đang có khóa)
export function hoverGuardBlocks(event: Event): boolean {
  if (!active.size || !GATED.has(event.type)) return false;
  let blocked: boolean;
  if (LEAVE_EVENTS.has(event.type)) blocked = true;
  else {
    blocked = true;
    for (const lock of active) if (lock.inZone(event.target)) blocked = false;
  }
  for (const lock of active) lock.seen(event, blocked);
  return blocked;
}

// Đánh dấu listener của WealthCompass để cổng không chặn nó
export function ungated<T extends (event: Event) => unknown>(listener: T): T {
  (listener as unknown as Record<symbol, boolean>)[UNGATED] = true;
  return listener;
}

let installed = false;

// Cài cổng một lần, càng sớm càng tốt (provideCompass gọi lúc khởi tạo app). Khi không có khóa, cổng chỉ thêm một
// phép so sánh cho mỗi sự kiện chuột.
export function installHoverGuard(): void {
  if (installed || typeof window === 'undefined' || typeof EventTarget === 'undefined') return;
  installed = true;
  // Lớp 1: capture trên window, đăng ký sớm nhất nên chạy trước listener capture của app trên window
  const stopper = ungated((event: Event) => {
    if (hoverGuardBlocks(event)) event.stopImmediatePropagation();
  });
  for (const type of GATED) window.addEventListener(type, stopper, true);

  // Lớp 2: bọc listener app đăng ký về sau (gắn ở đâu, pha nào cũng vậy)
  const proto = EventTarget.prototype;
  const add = proto.addEventListener;
  const remove = proto.removeEventListener;
  const wrappers = new WeakMap<object, Map<string, EventListener>>();
  const keyOf = (type: string, options?: boolean | EventListenerOptions) =>
    `${type}|${typeof options === 'boolean' ? options : Boolean(options?.capture)}`;
  proto.addEventListener = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    if (!listener || !GATED.has(type) || (listener as unknown as Record<symbol, boolean>)[UNGATED]) return add.call(this, type, listener, options);
    let byKey = wrappers.get(listener);
    if (!byKey) wrappers.set(listener, (byKey = new Map()));
    const key = keyOf(type, options);
    let wrapper = byKey.get(key);
    if (!wrapper) {
      wrapper = function (this: unknown, event: Event) {
        if (active.size && hoverGuardBlocks(event)) return;
        return typeof listener === 'function' ? listener.call(this, event) : listener.handleEvent(event);
      };
      byKey.set(key, wrapper);
    }
    return add.call(this, type, wrapper, options);
  };
  proto.removeEventListener = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
    const wrapper = listener ? wrappers.get(listener)?.get(keyOf(type, options)) : undefined;
    return remove.call(this, type, wrapper ?? listener, options);
  };
}

// ---------------------------------------------------------------------------

export function lockHover(trigger: Element, options: HoverLockOptions = {}): HoverLock {
  installHoverGuard();
  const trace = options.trace;
  // Gốc của vùng cần giữ: nút mở và (các) vùng menu
  const zones = new Set<Element>([trigger]);
  const held = new Set<Element>();
  const frozen = new Map<HTMLElement, Array<[string, string, string]>>();
  let released = false;
  // Sự kiện gần nhất tới được app (để biết menu đóng vì đâu) và loại sự kiện đã báo bị chặn
  const recent: string[] = [];
  const reported = new Set<string>();

  const state: ActiveLock = {
    inZone(node) {
      if (!(node instanceof Element)) return false;
      if (node.closest(BACKDROP)) return false;
      for (const zone of zones) if (zone === node || zone.contains(node)) return true;
      return false;
    },
    seen(event, blocked) {
      if (!trace) return;
      if (blocked && !reported.has(event.type)) {
        reported.add(event.type);
        trace(`khóa hover chặn ${event.type} trên ${describe(event.target)}`);
      }
      if (!blocked) {
        const line = `${event.type} trên ${describe(event.target)}`;
        if (recent[recent.length - 1] !== line) recent.push(line);
        if (recent.length > 6) recent.shift();
      }
    },
  };
  active.add(state);

  // Menu bị gỡ khỏi trang trong lúc khóa: ghi lại để biết app đóng menu bằng cách nào
  const watcher =
    trace && typeof MutationObserver !== 'undefined'
      ? new MutationObserver(() => {
          const gone = [...held].find((el) => !el.isConnected);
          if (!gone) return;
          held.delete(gone);
          trace(`menu bị app đóng (${describe(gone)} rời trang). Sự kiện gần nhất tới app: ${recent.join(' → ') || 'không có'}`);
        })
      : null;
  watcher?.observe(document.documentElement, { childList: true, subtree: true });

  const freeze = (element: Element) => {
    if (!(element instanceof HTMLElement) || frozen.has(element)) return;
    const computed = getComputedStyle(element);
    const saved: Array<[string, string, string]> = [];
    for (const prop of FROZEN_PROPS) {
      saved.push([prop, element.style.getPropertyValue(prop), element.style.getPropertyPriority(prop)]);
      const value = computed.getPropertyValue(prop);
      if (value) element.style.setProperty(prop, value, 'important');
    }
    frozen.set(element, saved);
  };

  return {
    hold(element: Element) {
      if (released) return;
      held.add(element);
      // Đóng băng từ phần tử lên tới ngay dưới tổ tiên chung với nút mở (hoặc tới con của body)
      let top: Element = element;
      // Vùng menu: tổ tiên cao nhất còn nhỏ hơn cả trang (khung menu, overlay pane). cdk-overlay-container chứa cả lớp nền
      // phủ trang: lấy nó làm vùng thì chuột trên lớp nền bị coi là trong menu và app đóng menu.
      let zone: Element = element;
      let growing = true;
      let node: Element | null = element;
      for (let depth = 0; node && node !== document.body && node !== document.documentElement && depth < MAX_DEPTH; depth++) {
        if (node.contains(trigger)) break;
        freeze(node);
        top = node;
        if (growing && (pageSized(node) || node.querySelector(BACKDROP))) growing = false;
        if (growing) zone = node;
        node = node.parentElement;
      }
      if (!top.contains(trigger)) zones.add(zone);
    },
    reopen() {
      if (released || !trigger.isConnected) return;
      trace?.('mở lại menu (bắn sự kiện hover lên nút mở)');
      simulateHover(trigger);
    },
    release() {
      if (released) return;
      released = true;
      active.delete(state);
      watcher?.disconnect();
      for (const [element, saved] of frozen) {
        for (const [prop, value, priority] of saved) {
          if (value) element.style.setProperty(prop, value, priority);
          else element.style.removeProperty(prop);
        }
      }
      frozen.clear();
      // Cho app biết chuột đã rời để menu mở bằng JS tự đóng (cổng đã mở cho khóa này)
      const View = (trigger.ownerDocument.defaultView ?? window) as Window & typeof globalThis;
      for (const zone of zones) {
        if (!zone.isConnected) continue;
        zone.dispatchEvent(new View.MouseEvent('mouseout', { bubbles: true, cancelable: true }));
        zone.dispatchEvent(new View.MouseEvent('mouseleave', { bubbles: false }));
      }
      zones.clear();
      held.clear();
    },
  };
}

// Mở menu hover thay người dùng (màn hình cảm ứng không có hover, hoặc người dùng bấm "Tiếp"): chỉ có tác dụng với
// menu mở bằng JS; menu CSS :hover cần chuột thật. Không bao giờ là click.
export function simulateHover(element: Element): void {
  const View = (element.ownerDocument.defaultView ?? window) as Window & typeof globalThis;
  element.dispatchEvent(new View.MouseEvent('mouseover', { bubbles: true, cancelable: true }));
  element.dispatchEvent(new View.MouseEvent('mouseenter', { bubbles: false }));
  element.dispatchEvent(new View.MouseEvent('mousemove', { bubbles: true, cancelable: true }));
}
