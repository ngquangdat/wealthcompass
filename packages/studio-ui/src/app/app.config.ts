import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { ProjectStore } from './core/project.store';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Nạp phiên (dự án đang mở) trước khi định tuyến để guard biết đã có dự án chưa
    provideAppInitializer(() => inject(ProjectStore).init().catch(() => undefined)),
    provideRouter(routes, withComponentInputBinding()),
  ],
};
