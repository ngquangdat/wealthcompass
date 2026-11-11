import { InjectionToken, makeEnvironmentProviders, EnvironmentProviders } from '@angular/core';
import { DEFAULT_BUSY_SELECTOR, buildSafetyPolicy, type SafetyPolicy } from '@wealthcompass/core';

export interface CompassOptions {
  // Địa chỉ backend WealthCompass tự host, VD http://localhost:8890
  apiBaseUrl: string;
  // Token JWT của phiên đăng nhập hiện có trên web
  getToken: () => string | null;
  // Quyền của người dùng (từ claim đã xác minh); chỉ để lọc kết quả cho gọn
  getCapabilities?: () => string[];
  locale?: string;
  title?: string;
  subtitle?: string;
  suggestions?: string[];
  safety?: Partial<SafetyPolicy>;
  tours?: TourOptions;
}

export interface TourOptions {
  // Dưới bề rộng này (px) dùng bản mobile của tour; nên trùng tours.mobileBreakpoint trong compass.config.yaml
  mobileBreakpoint?: number;
  // Từ mobileBreakpoint tới dưới bề rộng này dùng bản máy tính bảng (iPad); nên trùng tours.tabletBreakpoint
  tabletBreakpoint?: number;
  // Phần tử "đang tải" của app: engine chờ chúng biến mất rồi mới tìm phần tử của bước
  busySelector?: string;
}

export interface ResolvedCompassConfig extends Required<Omit<CompassOptions, 'safety' | 'tours'>> {
  safety: SafetyPolicy;
  tours: Required<TourOptions>;
}

export const COMPASS_CONFIG = new InjectionToken<ResolvedCompassConfig>('COMPASS_CONFIG');

// Nhận object hoặc factory; factory chạy trong injection context nên dùng được inject()
// để lấy AuthService của web chủ mà không cần biến toàn cục.
export function provideCompass(options: CompassOptions | (() => CompassOptions)): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: COMPASS_CONFIG,
      useFactory: (): ResolvedCompassConfig => {
        const o = typeof options === 'function' ? options() : options;
        return {
          getCapabilities: () => [],
          locale: 'vi',
          title: 'WealthCompass',
          subtitle: 'Tìm đúng tính năng, đi đúng từng bước',
          suggestions: [],
          ...o,
          safety: buildSafetyPolicy(o.safety),
          tours: { mobileBreakpoint: 768, tabletBreakpoint: 1024, busySelector: DEFAULT_BUSY_SELECTOR, ...o.tours },
        };
      },
    },
  ]);
}
