import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

// Phải đăng nhập mới vào được các màn hình bên trong
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.user() ? true : inject(Router).parseUrl('/login');
};

// Cần tài khoản trái phiếu để vào iConnect; thiếu quyền thì về trang chủ
export const bondAccountGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.hasRole('bond_account') ? true : inject(Router).parseUrl('/home');
};
