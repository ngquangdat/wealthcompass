import { InjectionToken, makeEnvironmentProviders, EnvironmentProviders } from '@angular/core';
import { buildSafetyPolicy, type SafetyPolicy } from '@wealthcompass/core';

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
}

export interface ResolvedCompassConfig extends Required<Omit<CompassOptions, 'safety'>> {
  safety: SafetyPolicy;
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
          title: 'Trợ lý hướng dẫn',
          subtitle: 'Hỏi tôi tính năng nằm ở đâu',
          suggestions: [],
          ...o,
          safety: buildSafetyPolicy(o.safety),
        };
      },
    },
  ]);
}
