import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, scan } from '../scan';
import { detectProject } from './detect';

// Kiểm tra một web đã gắn WealthCompass đúng chưa. Mỗi dòng: trạng thái, việc kiểm, cách sửa.
export interface Check {
  status: 'ok' | 'fail' | 'warn';
  name: string;
  detail?: string;
  fix?: string;
}

export async function doctor(appDir: string, project?: string): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  const configFile = join(appDir, 'compass.config.yaml');
  if (!existsSync(configFile)) {
    add({ status: 'fail', name: 'compass.config.yaml', fix: 'Chạy `wealthcompass setup --app .`' });
    return checks;
  }
  const { config } = loadConfig(configFile);
  add({ status: 'ok', name: 'compass.config.yaml' });

  // Quét lại và đếm cảnh báo
  const scanned = scan(configFile);
  const fm = scanned.featureMap;
  const drafts = fm.coverage.warnings.filter((w) => w.includes('do LLM soạn')).length;
  const others = fm.coverage.warnings.length - drafts;
  add({ status: fm.features.length ? 'ok' : 'fail', name: 'Quét route', detail: `${fm.features.length} màn hình, ${fm.coverage.targetsFound} tourId, ${fm.tours.length} tour` });
  if (drafts) add({ status: 'warn', name: 'Nội dung AI chưa duyệt', detail: `${drafts} màn hình còn khóa llmDraft`, fix: 'Đọc lại trong compass.overrides.yaml rồi xóa khóa llmDraft' });
  if (others) add({ status: 'warn', name: 'Cảnh báo của scanner', detail: `${others} cảnh báo`, fix: 'Chạy `wealthcompass scan` để xem chi tiết' });

  // Gói đã cài chưa
  const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
  const declared = Boolean(pkg.dependencies?.['@wealthcompass/angular']);
  const installed = existsSync(join(appDir, 'node_modules', '@wealthcompass', 'angular', 'package.json'));
  add({
    status: declared && installed ? 'ok' : 'fail',
    name: 'Gói @wealthcompass/angular',
    detail: declared ? (installed ? 'đã cài' : 'đã khai trong package.json nhưng chưa cài') : 'chưa khai trong package.json',
    fix: declared ? 'npm install' : 'Áp wealthcompass-setup.patch rồi npm install',
  });

  // Style
  const ng = readFileSync(join(appDir, 'angular.json'), 'utf8');
  const hasStyles = ng.includes('driver.js/dist/driver.css') && ng.includes('compass-theme');
  add({ status: hasStyles ? 'ok' : 'fail', name: 'Style tour trong angular.json', fix: 'Thêm "driver.js/dist/driver.css" và "@wealthcompass/angular/compass-theme.scss" vào styles' });

  // Provider, widget, directive: tìm trong source
  const info = detectProject(appDir, project);
  const files = info.project.getSourceFiles().filter((f) => !f.getFilePath().includes('/node_modules/'));
  const allText = files.map((f) => f.getFullText()).join('\n');
  add({ status: /provideCompass\s*\(/.test(allText) ? 'ok' : 'fail', name: 'provideCompass(...)', fix: 'Áp patch hoặc thêm vào providers của app' });
  const todoToken = /getToken:\s*\(\)\s*=>\s*null\b/.test(allText);
  add({ status: todoToken ? 'fail' : 'ok', name: 'getToken trả JWT', detail: todoToken ? 'đang là TODO trả null' : undefined, fix: 'Sửa getToken trong provideCompass để trả token của phiên đăng nhập' });

  let widget = /compass-chat-widget/.test(allText);
  if (!widget) {
    // template ngoài (.html)
    const htmlHit = files.some((f) => {
      const m = f.getFullText().match(/templateUrl:\s*['"]([^'"]+)['"]/g) ?? [];
      return m.some((x) => {
        const p = join(f.getDirectoryPath(), x.replace(/templateUrl:\s*['"]|['"]/g, ''));
        return existsSync(p) && readFileSync(p, 'utf8').includes('compass-chat-widget');
      });
    });
    widget = htmlHit;
  }
  add({ status: widget ? 'ok' : 'fail', name: '<compass-chat-widget />', fix: 'Thêm vào template của component gốc' });

  // tourId trong template mà component không import TourIdDirective: thuộc tính thành HTML thường, tour hỏng âm thầm
  const missingDirective: string[] = [];
  for (const ctx of Object.values(scanned.contexts)) {
    for (const cls of ctx.classes) {
      const own = cls.getText();
      const tpl = templateTextOf(cls.getSourceFile().getDirectoryPath(), own);
      if (/\btourId\s*=/.test(tpl) && !/\bTourIdDirective\b/.test(own)) missingDirective.push(cls.getName() ?? '?');
    }
  }
  for (const l of scanned.layouts) {
    for (const cls of l.classes) {
      const own = cls.getText();
      const tpl = templateTextOf(cls.getSourceFile().getDirectoryPath(), own);
      if (/\btourId\s*=/.test(tpl) && !/\bTourIdDirective\b/.test(own)) missingDirective.push(cls.getName() ?? '?');
    }
  }
  const uniq = [...new Set(missingDirective)];
  add({
    status: uniq.length ? 'fail' : 'ok',
    name: 'TourIdDirective được import nơi có tourId',
    detail: uniq.length ? `thiếu ở: ${uniq.join(', ')}` : undefined,
    fix: 'Thêm TourIdDirective vào imports của các component trên (annotate tự làm việc này)',
  });

  // Backend
  const url = (config as { backend?: { url?: string } }).backend?.url;
  if (!url) {
    add({ status: 'warn', name: 'Backend', detail: 'compass.config.yaml chưa có backend.url', fix: 'Thêm backend: { url: http://localhost:8890 }' });
  } else {
    try {
      const res = await fetch(`${url}/v1/health`, { signal: AbortSignal.timeout(3000) });
      const health = (await res.json()) as { features?: number; llmConfigured?: boolean; provider?: string; model?: string };
      add({
        status: health.features === fm.features.length ? 'ok' : 'warn',
        name: `Backend ${url}`,
        detail: `${health.features} màn hình${health.features === fm.features.length ? '' : ` (khác bản quét: ${fm.features.length}, kiểm tra COMPASS_FEATURE_MAP)`}`,
      });
      add({ status: health.llmConfigured ? 'ok' : 'warn', name: 'LLM của backend', detail: health.llmConfigured ? `${health.provider} / ${health.model}` : 'chưa có khóa: trợ lý chạy chế độ dự phòng', fix: 'Đặt COMPASS_LLM_API_KEY cho backend' });
      const origin = `http://localhost:${info.devPort}`;
      const pre = await fetch(`${url}/v1/chat`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' }, signal: AbortSignal.timeout(3000) });
      const allowed = pre.headers.get('access-control-allow-origin');
      add({ status: allowed === origin ? 'ok' : 'fail', name: `CORS cho ${origin}`, fix: `Thêm ${origin} vào COMPASS_ORIGINS của backend` });
    } catch {
      add({ status: 'fail', name: `Backend ${url}`, detail: 'không kết nối được', fix: 'npx wealthcompass-server --env-file wealthcompass.env' });
    }
  }
  return checks;
}

function templateTextOf(dir: string, classText: string): string {
  const url = classText.match(/templateUrl:\s*['"]([^'"]+)['"]/);
  if (url) {
    const p = join(dir, url[1]);
    return existsSync(p) ? readFileSync(p, 'utf8') : '';
  }
  return classText.match(/template:\s*`([\s\S]*?)`/)?.[1] ?? '';
}

export function formatChecks(checks: Check[]): string {
  const icon = { ok: '✔', fail: '✘', warn: '!' };
  return checks
    .map((c) => `${icon[c.status]} ${c.name}${c.detail ? ` — ${c.detail}` : ''}${c.status !== 'ok' && c.fix ? `\n    → ${c.fix}` : ''}`)
    .join('\n');
}
