import { Directive, OnDestroy, computed, effect, inject, input, untracked } from '@angular/core';
import { menuTourId } from '@wealthcompass/core';
import { TourRegistryService } from './tour-registry.service';

// Gắn data-tour-id lên phần tử và đăng ký với registry theo vòng đời component.
// Scanner đọc các thuộc tính tourId/tourLabel/tourHint/tourRole tĩnh trong template.
@Directive({
  selector: '[tourId]',
  host: {
    '[attr.data-tour-id]': 'tourId()',
    '[attr.data-tour-role]': 'tourRole() ?? null',
  },
})
export class TourIdDirective implements OnDestroy {
  readonly tourId = input.required<string>();
  readonly tourLabel = input<string>();
  readonly tourHint = input<string>();
  // user-only: engine chỉ được highlight, không bao giờ click/điền
  readonly tourRole = input<'user-only'>();

  private readonly registry = inject(TourRegistryService);
  private registered: string | null = null;

  constructor() {
    effect(() => {
      const id = this.tourId();
      untracked(() => {
        if (this.registered) this.registry.unregister(this.registered);
        this.registry.register(id);
        this.registered = id;
      });
    });
  }

  ngOnDestroy(): void {
    if (this.registered) this.registry.unregister(this.registered);
  }
}

// Mục menu sinh từ dữ liệu (@for trên mảng menu): một thẻ <a> cho mọi mục nên không gắn được tourId cố định.
// [tourMenu]="mục.link" cho mỗi mục một mốc riêng "menu-<route>" (vd. /leave/request -> menu-leave-request);
// trình quét đọc dữ liệu menu và tạo đúng các mốc này để tour trỏ vào.
@Directive({
  selector: '[tourMenu]',
  host: { '[attr.data-tour-id]': 'id()' },
})
export class TourMenuDirective implements OnDestroy {
  readonly tourMenu = input.required<string | readonly unknown[] | null | undefined>();
  protected readonly id = computed(() => menuTourId(this.tourMenu()));

  private readonly registry = inject(TourRegistryService);
  private registered: string | null = null;

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => {
        if (this.registered) this.registry.unregister(this.registered);
        this.registry.register(id);
        this.registered = id;
      });
    });
  }

  ngOnDestroy(): void {
    if (this.registered) this.registry.unregister(this.registered);
  }
}
