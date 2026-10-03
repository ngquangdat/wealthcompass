import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

const SESSION_KEY = 'hr.session';
// Máy chủ đăng nhập của công ty (khi thử: IdP giả lập của WealthCompass)
export const SSO_URL = 'http://localhost:8890/idp';

interface Claims {
  sub: string;
  name?: string;
  roles?: string[];
  exp?: number;
}

function decode(token: string | null): Claims | null {
  if (!token) return null;
  try {
    const json = decodeURIComponent(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    );
    const claims = JSON.parse(json) as Claims;
    return claims.exp && claims.exp * 1000 < Date.now() ? null : claims;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly router = inject(Router);
  private readonly jwt = signal<string | null>(sessionStorage.getItem(SESSION_KEY));

  readonly user = computed(() => decode(this.jwt()));
  readonly roles = computed(() => this.user()?.roles ?? []);
  readonly isLoggedIn = computed(() => this.user() !== null);

  getAccessToken(): string | null {
    return this.user() ? this.jwt() : null;
  }

  hasRole(role: string): boolean {
    return this.roles().includes(role);
  }

  async login(username: string, password: string): Promise<void> {
    const res = await fetch(`${SSO_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error('Sai tên đăng nhập hoặc mật khẩu');
    const { access_token } = (await res.json()) as { access_token: string };
    sessionStorage.setItem(SESSION_KEY, access_token);
    this.jwt.set(access_token);
  }

  logout(): void {
    sessionStorage.removeItem(SESSION_KEY);
    this.jwt.set(null);
    void this.router.navigateByUrl('/login');
  }
}
