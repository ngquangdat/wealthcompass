import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { ProjectStore } from './core/project.store';

// Các trang cần đã mở dự án; chưa có thì đưa về trang chọn dự án
const needProject: CanActivateFn = () => (inject(ProjectStore).project() ? true : inject(Router).parseUrl('/open'));

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'overview' },
  { path: 'open', loadComponent: () => import('./pages/open.page').then((m) => m.OpenPage), title: 'Mở dự án · WealthCompass Studio' },
  { path: 'overview', canActivate: [needProject], loadComponent: () => import('./pages/overview.page').then((m) => m.OverviewPage), title: 'Tổng quan · WealthCompass Studio' },
  { path: 'screens', canActivate: [needProject], loadComponent: () => import('./pages/screens.page').then((m) => m.ScreensPage), title: 'Màn hình · WealthCompass Studio' },
  { path: 'permissions', canActivate: [needProject], loadComponent: () => import('./pages/permissions.page').then((m) => m.PermissionsPage), title: 'Quyền · WealthCompass Studio' },
  { path: 'tours', canActivate: [needProject], loadComponent: () => import('./pages/tours.page').then((m) => m.ToursPage), title: 'Tour · WealthCompass Studio' },
  { path: 'assistant', canActivate: [needProject], loadComponent: () => import('./pages/assistant.page').then((m) => m.AssistantPage), title: 'Thử trợ lý · WealthCompass Studio' },
  { path: 'eval', canActivate: [needProject], loadComponent: () => import('./pages/eval.page').then((m) => m.EvalPage), title: 'Kiểm thử · WealthCompass Studio' },
  { path: 'logs', canActivate: [needProject], loadComponent: () => import('./pages/logs.page').then((m) => m.LogsPage), title: 'Nhật ký · WealthCompass Studio' },
  { path: 'run', canActivate: [needProject], loadComponent: () => import('./pages/run.page').then((m) => m.RunPage), title: 'Chạy thử · WealthCompass Studio' },
  { path: 'settings', loadComponent: () => import('./pages/settings.page').then((m) => m.SettingsPage), title: 'Cài đặt AI · WealthCompass Studio' },
  { path: '**', redirectTo: 'overview' },
];
