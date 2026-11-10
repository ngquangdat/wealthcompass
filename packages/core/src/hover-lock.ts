// Khóa hover: giữ menu mở bằng hover (menu desktop) trong lúc tour tô sáng và chờ người dùng bấm mục bên trong.
// Không khóa thì menu đóng ngay khi chuột rời nút mở (để bấm "Tiếp", hoặc khi lớp phủ của tour che nút mở).
//
// Ba cách một web đóng menu hover, và cách khóa xử lý từng cách:
// 1. JS nghe "rời chuột" trên nút mở/vùng menu (mouseleave, mouseout): chặn các sự kiện đó ở pha capture trên window cho
//    nút mở và vùng menu, nên app không biết chuột đã rời.
// 2. JS nghe "chuột đi vào chỗ khác" (mouseenter/mouseover/mousemove trên phần thân trang hay mục menu khác rồi đóng
//    menu đang mở; TCInvest làm vậy): chặn các sự kiện hover xảy ra NGOÀI vùng menu. Giao diện của chính tour (popover,
//    widget chat) được chừa ra.
// 3. CSS (:hover): không ép được :hover từ JS, nên đóng băng kiểu hiển thị hiện tại (display, visibility, opacity...)
//    của mục cần giữ và các tổ tiên của nó bằng inline style !important.
// Nhả khóa: gỡ chặn, trả style cũ, rồi bắn mouseleave/mouseout vào nút mở để menu JS tự đóng.

export interface HoverLock {
  // Giữ thêm một phần tử (mục của bước sau trong cùng menu, menu con)
  hold(element: Element): void;
  release(): void;
}

const LEAVE_EVENTS = ['mouseleave', 'mouseout', 'pointerleave', 'pointerout'] as const;
// Sự kiện báo "chuột đang ở chỗ khác": chặn khi xảy ra ngoài vùng menu
const ENTER_EVENTS = ['mouseenter', 'mouseover', 'mousemove', 'pointerenter', 'pointerover', 'pointermove'] as const;
// Giao diện của tour và trợ lý: không bao giờ bị chặn sự kiện
const OWN_UI = '.driver-popover, .compass-popover, compass-chat-widget, #__compass-recorder';
const FROZEN_PROPS = ['display', 'visibility', 'opacity', 'pointer-events', 'transform', 'max-height'] as const;
const MAX_DEPTH = 12;

export function lockHover(trigger: Element): HoverLock {
  // Gốc của vùng cần giữ: nút mở và (các) vùng menu
  const zones = new Set<Element>([trigger]);
  const frozen = new Map<HTMLElement, Array<[string, string, string]>>();
  let released = false;

  const inZone = (node: EventTarget | null): boolean => {
    if (!(node instanceof Element)) return false;
    for (const zone of zones) if (zone === node || zone.contains(node)) return true;
    return false;
  };
  const block = (event: Event) => {
    if (inZone(event.target)) event.stopImmediatePropagation();
  };
  const ownUi = (node: EventTarget | null): boolean => {
    try {
      return node instanceof Element && node.closest(OWN_UI) !== null;
    } catch {
      return false;
    }
  };
  const blockOutside = (event: Event) => {
    if (!inZone(event.target) && !ownUi(event.target)) event.stopImmediatePropagation();
  };
  for (const type of LEAVE_EVENTS) window.addEventListener(type, block, true);
  for (const type of ENTER_EVENTS) window.addEventListener(type, blockOutside, true);

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
      // Đóng băng từ phần tử lên tới ngay dưới tổ tiên chung với nút mở (hoặc tới con của body)
      let top: Element = element;
      let node: Element | null = element;
      for (let depth = 0; node && node !== document.body && node !== document.documentElement && depth < MAX_DEPTH; depth++) {
        if (node.contains(trigger)) break;
        freeze(node);
        top = node;
        node = node.parentElement;
      }
      // Vùng menu (vd. khung overlay nằm ngoài nút mở): chặn luôn sự kiện rời chuột của nó
      if (!top.contains(trigger)) zones.add(top);
    },
    release() {
      if (released) return;
      released = true;
      for (const type of LEAVE_EVENTS) window.removeEventListener(type, block, true);
      for (const type of ENTER_EVENTS) window.removeEventListener(type, blockOutside, true);
      for (const [element, saved] of frozen) {
        for (const [prop, value, priority] of saved) {
          if (value) element.style.setProperty(prop, value, priority);
          else element.style.removeProperty(prop);
        }
      }
      frozen.clear();
      // Cho app biết chuột đã rời để menu mở bằng JS tự đóng
      const View = (trigger.ownerDocument.defaultView ?? window) as Window & typeof globalThis;
      for (const zone of zones) {
        if (!zone.isConnected) continue;
        zone.dispatchEvent(new View.MouseEvent('mouseout', { bubbles: true, cancelable: true }));
        zone.dispatchEvent(new View.MouseEvent('mouseleave', { bubbles: false }));
      }
      zones.clear();
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
