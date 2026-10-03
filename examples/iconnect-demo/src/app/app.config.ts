import { ApplicationConfig, inject, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideCompass } from '@wealthcompass/angular';
import { routes } from './app.routes';
import { AuthService, IDP_BASE_URL } from './core/auth.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideCompass(() => {
      const auth = inject(AuthService);
      return {
        apiBaseUrl: IDP_BASE_URL,
        // Dùng đúng JWT của phiên đăng nhập hiện có; backend tự xác minh bằng JWKS
        getToken: () => auth.token(),
        getCapabilities: () => auth.user()?.roles ?? [],
        title: 'WealthCompass',
        subtitle: 'Tìm đúng tính năng, đi đúng từng bước',
        suggestions: ['Bán trái phiếu ở đâu?', 'Làm sao để nộp tiền vào tài khoản?', 'Xem lãi lỗ trái phiếu'],
      };
    }),
  ],
};
