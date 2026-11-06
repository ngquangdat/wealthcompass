// Đóng gói phần ghi locator (packages/core/src/locator-capture.ts + dom-accessibility-api + @medv/finder) và bộ thử bước
// (locator-probe.ts) thành một chuỗi JS để `tour:record` và `tour:verify` tiêm vào trang. File sinh ra được commit để CLI không cần esbuild lúc chạy.
// node scripts/build-capture.mjs          ghi lại file
// node scripts/build-capture.mjs --check  báo lỗi nếu file đã cũ (chạy trong `npm run check`)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'packages/cli/src/record/capture.bundle.ts');

const result = await build({
  stdin: {
    contents: [
      "import { appearedSince, captureLocator, snapshotVisible } from './packages/core/src/locator-capture';",
      "import { matchesUserOnlyText } from './packages/core/src/safety';",
      "import { probeStep } from './packages/core/src/locator-probe';",
      'window.__compassCapture = captureLocator;',
      'window.__compassUserOnlyText = matchesUserOnlyText;',
      'window.__compassSnapshot = snapshotVisible;',
      'window.__compassAppeared = appearedSince;',
      // tour:verify: thử từng bước bằng đúng bộ tìm phần tử của widget
      'window.__compassProbe = probeStep;',
    ].join('\n'),
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
});

const code = result.outputFiles[0].text.trim();
const content = [
  '// FILE SINH TỰ ĐỘNG bởi scripts/build-capture.mjs từ packages/core/src/locator-capture.ts. Không sửa tay.',
  '// Chạy `npm run build:capture` sau khi đổi locator-*.ts, resolver.ts hoặc safety.ts.',
  `export const CAPTURE_SCRIPT = ${JSON.stringify(code)};`,
  '',
].join('\n');

if (process.argv.includes('--check')) {
  if (!existsSync(out) || readFileSync(out, 'utf8') !== content) {
    console.error('capture.bundle.ts đã cũ: chạy `npm run build:capture` rồi commit.');
    process.exit(1);
  }
  console.log('capture.bundle.ts khớp mã nguồn.');
} else {
  writeFileSync(out, content);
  console.log(`Đã ghi ${out} (${(code.length / 1024).toFixed(1)} KB)`);
}
