import { Injectable, computed, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly session = signal<{ token: string; roles: string[] } | null>(null);
  readonly roles = computed(() => this.session()?.roles ?? []);
  getAccessToken(): string | null {
    return this.session()?.token ?? null;
  }
  hasRole(r: string): boolean {
    return this.roles().includes(r);
  }
}
