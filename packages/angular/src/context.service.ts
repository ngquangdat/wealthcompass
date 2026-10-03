import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import type { ChatContext } from '@wealthcompass/contracts';
import { COMPASS_CONFIG } from './compass.config';
import { TourRegistryService } from './tour-registry.service';

// Gom ngữ cảnh giao diện gửi kèm câu hỏi. Tuyệt đối không có giá trị ô nhập, số dư, token.
@Injectable({ providedIn: 'root' })
export class CompassContextService {
  private readonly router = inject(Router);
  private readonly registry = inject(TourRegistryService);
  private readonly config = inject(COMPASS_CONFIG);

  build(): ChatContext {
    return {
      route: this.router.url.split('?')[0].split('#')[0],
      visibleTargets: this.registry.ids(),
      locale: this.config.locale,
      capabilities: this.config.getCapabilities(),
    };
  }
}
