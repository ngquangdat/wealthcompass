import { inject } from '@angular/core';
import { AuthService } from './auth.service';
export const authGuard = () => inject(AuthService).getAccessToken() !== null;
export const adminGuard = () => inject(AuthService).hasRole('shop_admin');
export const reportsGuard = () => inject(AuthService).roles().some((r) => r.startsWith('report'));
