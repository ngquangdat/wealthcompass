import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

// Địa chỉ IdP giả lập chạy cùng backend demo. Web thật dùng hệ thống đăng nhập của khách.
export const IDP_BASE_URL = 'http://localhost:8890';

const STORAGE_KEY = 'demo.jwt';

export interface SessionUser {
  sub: string;
  name: string;
  roles: string[];
}

function decodeJwt(token: string): SessionUser | null {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(payload)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    );
    const claims = JSON.parse(json) as { sub: string; name?: string; roles?: string[]; exp?: number };
    if (claims.exp && claims.exp * 1000 < Date.now()) return null;
    return { sub: claims.sub, name: claims.name ?? claims.sub, roles: claims.roles ?? [] };
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly router = inject(Router);
  private readonly tokenSignal = signal<string | null>(this.readStoredToken());

  readonly user = computed(() => {
    const token = this.tokenSignal();
    return token ? decodeJwt(token) : null;
  });

  token(): string | null {
    return this.user() ? this.tokenSignal() : null;
  }

  hasRole(role: string): boolean {
    return this.user()?.roles.includes(role) ?? false;
  }

  async login(username: string, password: string): Promise<void> {
    const response = await fetch(`${IDP_BASE_URL}/idp/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) throw new Error('Sai tên đăng nhập hoặc mật khẩu');
    const { access_token } = (await response.json()) as { access_token: string };
    this.store(access_token);
  }

  logout(): void {
    this.store(null);
    void this.router.navigateByUrl('/login');
  }

  private store(token: string | null): void {
    try {
      if (token) sessionStorage.setItem(STORAGE_KEY, token);
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // sessionStorage bị chặn thì chỉ giữ trong bộ nhớ
    }
    this.tokenSignal.set(token);
  }

  private readStoredToken(): string | null {
    try {
      return sessionStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }
}
