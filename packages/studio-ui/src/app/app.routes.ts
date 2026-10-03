import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { ProjectStore } from './core/project.store';

// Các trang cần đã mở dự án; chưa có thì đưa về trang chọn dự án
const needProject: CanActivateFn = () => (inject(ProjectStore).project() ? true : inject(Router).parseUrl('/open'));

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'overview' },
  { path: 'open', loadComponent: () => import('./pages/open.page').then((m) => m.OpenPage), title: 'Mở dự án · WealthCompass Studio' },
  { path: 'overview', canActivate: [needProject], loadComponent: () => import('./pages/overview.page').then((m) => m.OverviewPage), title: 'Tổng quan · WealthCompass Studio' },
  { path: 'integrate', canActivate: [needProject], loadComponent: () => import('./pages/integrate.page').then((m) => m.IntegratePage), title: 'Tích hợp · WealthCompass Studio' },
  { path: 'screens', canActivate: [needProject], loadComponent: () => import('./pages/screens.page').then((m) => m.ScreensPage), title: 'Màn hình · WealthCompass Studio' },
  { path: 'run', canActivate: [needProject], loadComponent: () => import('./pages/run.page').then((m) => m.RunPage), title: 'Chạy thử · WealthCompass Studio' },
  { path: 'settings', loadComponent: () => import('./pages/settings.page').then((m) => m.SettingsPage), title: 'Cài đặt AI · WealthCompass Studio' },
  { path: '**', redirectTo: 'overview' },
];
