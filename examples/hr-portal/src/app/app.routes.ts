import { Routes } from '@angular/router';
import { authGuard, managerGuard, payrollGuard } from './core/guards';
import { ShellComponent } from './layout/shell.component';
import { LoginPage } from './pages/login.page';
import { DashboardPage } from './pages/dashboard.page';
import { LeaveHistoryPage } from './pages/leave-history.page';
import { PayslipsPage } from './pages/payslips.page';
import { ApprovalsPage } from './pages/approvals.page';
import { ProfilePage } from './pages/profile.page';

export const routes: Routes = [
  { path: 'login', component: LoginPage, title: 'Đăng nhập' },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', component: DashboardPage },
      {
        path: 'leave',
        children: [
          { path: 'request', loadComponent: () => import('./pages/leave-request.page').then((m) => m.LeaveRequestPage) },
          { path: 'history', component: LeaveHistoryPage, title: 'Lịch sử nghỉ phép' },
        ],
      },
      { path: 'payslips', component: PayslipsPage, canActivate: [payrollGuard] },
      { path: 'team/approvals', component: ApprovalsPage, canActivate: [managerGuard] },
      { path: 'profile', component: ProfilePage, title: 'Hồ sơ cá nhân' },
    ],
  },
  { path: '**', redirectTo: '' },
];
