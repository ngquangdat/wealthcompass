import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => (inject(AuthService).isLoggedIn() ? true : inject(Router).parseUrl('/login'));

export const managerGuard: CanActivateFn = () => (inject(AuthService).hasRole('manager') ? true : inject(Router).parseUrl('/dashboard'));

// Ai có quyền liên quan bảng lương (payroll_viewer, payroll_admin...) đều xem được phiếu lương
export const payrollGuard: CanActivateFn = () =>
  inject(AuthService).roles().some((r) => r.startsWith('payroll')) ? true : inject(Router).parseUrl('/dashboard');
