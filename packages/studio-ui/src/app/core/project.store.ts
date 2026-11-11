import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import type { Overview, ProjectSummary } from './models';

const RECENT_KEY = 'studio.recent';

// Trạng thái dùng chung: dự án đang mở và tổng quan của nó
@Injectable({ providedIn: 'root' })
export class ProjectStore {
  private readonly api = inject(ApiService);
  readonly project = signal<ProjectSummary | null>(null);
  readonly overview = signal<Overview | null>(null);
  readonly version = signal('');
  readonly home = signal('');
  readonly loading = signal(false);

  // Trạng thái từng mục trên thanh bên
  readonly navStatus = computed(() => {
    const p = this.project();
    const o = this.overview();
    const fails = o?.checks.filter((c) => c.status === 'fail').length ?? 0;
    const warns = o?.checks.filter((c) => c.status === 'warn').length ?? 0;
    return {
      overview: !p?.integrated ? 'none' : fails ? 'danger' : warns ? 'warning' : 'success',
      screens: !o?.stats ? 'none' : o.stats.drafts || o.stats.missing ? 'warning' : 'success',
    } as Record<string, 'none' | 'success' | 'warning' | 'danger'>;
  });

  async init(): Promise<void> {
    const s = await this.api.get<{ version: string; project: ProjectSummary | null; home: string }>('/api/session');
    this.version.set(s.version);
    this.home.set(s.home);
    this.project.set(s.project);
    if (s.project) await this.refreshOverview();
  }

  async open(path: string): Promise<ProjectSummary> {
    const p = await this.api.post<ProjectSummary>('/api/project/open', { path });
    this.project.set(p);
    this.remember(p);
    await this.refreshOverview();
    return p;
  }

  async refresh(): Promise<void> {
    const p = this.project();
    if (!p) return;
    this.loading.set(true);
    try {
      await this.api.post('/api/rescan');
      this.project.set(await this.api.post<ProjectSummary>('/api/project/open', { path: p.path }));
    } finally {
      this.loading.set(false);
    }
    await this.refreshOverview();
  }

  async refreshOverview(): Promise<void> {
    this.loading.set(true);
    try {
      this.overview.set(await this.api.get<Overview>('/api/overview'));
    } finally {
      this.loading.set(false);
    }
  }

  recent(): Array<{ path: string; name: string }> {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    } catch {
      return [];
    }
  }

  private remember(p: ProjectSummary): void {
    try {
      const list = [{ path: p.path, name: p.name }, ...this.recent().filter((r) => r.path !== p.path)].slice(0, 6);
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch {
      // localStorage bị chặn: chỉ mất danh sách gần đây
    }
  }
}
