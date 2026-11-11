import { DOCUMENT, Injectable, inject, signal } from '@angular/core';

// Popup đang mở (mỗi mục gốc có một app-popup-menu tự gắn/gỡ nội dung của nó vào overlay).
export interface OverlayPopup {
  detach(): void;
}

// Overlay tự làm, mô phỏng đúng chuỗi DOM của @angular/cdk overlay trên web thật:
//   body > div.cdk-overlay-container > div.cdk-overlay-connected-position-bounding-box > div.cdk-overlay-pane > [popup]
// Container nằm sẵn ở body (như CDK); bounding box + pane chỉ tồn tại khi popup đang mở.
@Injectable({ providedIn: 'root' })
export class MenuOverlayService {
  private readonly doc = inject(DOCUMENT);
  private current: OverlayPopup | null = null;
  private box: HTMLElement | null = null;

  // Trạng thái "Xem thêm / Rút gọn" dùng chung, nhớ suốt phiên mở app (web thật nhớ ở lần mở popup sau)
  readonly expanded = signal(false);

  isOpen(popup: OverlayPopup): boolean {
    return this.current === popup;
  }

  // Tạo bounding box + pane mới cho popup, đóng popup cũ nếu có. Trả về pane để popup chèn nội dung vào.
  attach(popup: OverlayPopup): HTMLElement {
    this.close();
    const container = this.container();
    const box = this.doc.createElement('div');
    box.className = 'cdk-overlay-connected-position-bounding-box';
    box.setAttribute('dir', 'ltr');
    const pane = this.doc.createElement('div');
    pane.className = 'cdk-overlay-pane';
    pane.style.position = 'static';
    box.appendChild(pane);
    container.appendChild(box);
    this.box = box;
    this.current = popup;
    return pane;
  }

  // Đặt popup sát mép phải thanh bên, ngang hàng mục gốc; đẩy lên nếu tràn đáy cửa sổ.
  position(anchor: HTMLElement): void {
    const box = this.box;
    const pane = box?.firstElementChild as HTMLElement | null;
    if (!box || !pane) return;
    const win = this.doc.defaultView!;
    const rect = anchor.getBoundingClientRect();
    const height = pane.offsetHeight;
    const top = Math.max(60, Math.min(rect.top, win.innerHeight - height - 8));
    Object.assign(box.style, {
      top: `${top}px`,
      left: `${rect.right}px`,
      height: `${win.innerHeight - top}px`,
      width: `${win.innerWidth - rect.right}px`,
      alignItems: 'flex-start',
      justifyContent: 'flex-start',
    });
  }

  close(): void {
    const popup = this.current;
    this.current = null;
    popup?.detach();
    this.box?.remove();
    this.box = null;
  }

  private container(): HTMLElement {
    let el = this.doc.body.querySelector<HTMLElement>(':scope > .cdk-overlay-container');
    if (!el) {
      el = this.doc.createElement('div');
      el.className = 'cdk-overlay-container';
      this.doc.body.appendChild(el);
    }
    return el;
  }
}
