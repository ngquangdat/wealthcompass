// Đóng gói các gói WealthCompass thành file .tgz cài được như gói npm thường.
// Chạy: npm run pack   (kết quả ở dist/tarballs)
// Không publish đi đâu cả; publish lên registry là việc làm riêng, có chủ đích.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = process.env.COMPASS_VERSION ?? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).compassVersion ?? '0.1.0';
const out = join(root, 'dist', 'build');
const tarballs = join(root, 'dist', 'tarballs');

const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const readPkg = (dir) => JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'));
const writeJson = (file, data) => writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
const internal = (deps) => Object.fromEntries(Object.entries(deps ?? {}).map(([k, v]) => [k, k.startsWith('@wealthcompass/') ? VERSION : v]));
const external = (deps) => Object.keys(deps ?? {}).filter((d) => !d.startsWith('@wealthcompass/'));

rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(tarballs, { recursive: true });

// 1) Gói TypeScript thuần: bundle JS bằng esbuild, sinh .d.ts bằng tsc
async function buildLibrary(dir, { platform }) {
  const pkg = readPkg(dir);
  const name = pkg.name.split('/')[1];
  const dest = join(out, name);
  await build({
    entryPoints: [join(root, dir, 'src/index.ts')],
    outfile: join(dest, 'index.js'),
    bundle: true,
    format: 'esm',
    platform,
    target: 'es2022',
    // Phụ thuộc khai trong package.json để người dùng cài, không nhét vào bundle
    external: Object.keys(pkg.dependencies ?? {}),
    sourcemap: true,
    logLevel: 'warning',
  });
  const tsconfig = join(root, dir, 'tsconfig.dts.json');
  writeJson(tsconfig, {
    extends: '../../tsconfig.base.json',
    compilerOptions: {
      noEmit: false,
      declaration: true,
      emitDeclarationOnly: true,
      // Coi gói anh em trong workspace là thư viện ngoài, không sinh .d.ts cho chúng
      preserveSymlinks: true,
      rootDir: 'src',
      outDir: join(dest, 'types'),
      types: platform === 'node' ? ['node'] : [],
    },
    include: ['src'],
    exclude: ['src/**/*.test.ts', 'src/test/**'],
  });
  try {
    run('npx', ['tsc', '-p', tsconfig]);
  } finally {
    rmSync(tsconfig);
  }
  writeJson(join(dest, 'package.json'), {
    name: pkg.name,
    version: VERSION,
    type: 'module',
    main: './index.js',
    types: './types/index.d.ts',
    exports: { '.': { types: './types/index.d.ts', import: './index.js', default: './index.js' } },
    sideEffects: false,
    dependencies: internal(pkg.dependencies),
  });
  return dest;
}

// 2) Thư viện Angular: ng-packagr, chế độ partial compilation (một bản chạy được nhiều phiên bản Angular)
function buildAngular() {
  run('npx', ['ng-packagr', '-p', 'packages/angular/ng-package.json', '-c', 'packages/angular/tsconfig.lib.json']);
  const dest = join(out, 'angular');
  const file = join(dest, 'package.json');
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  delete pkg.private;
  // Manifest gốc trỏ vào source (src/index.ts) cho chế độ dev; bản đóng gói dùng exports/typings do ng-packagr sinh
  delete pkg.main;
  delete pkg.types;
  pkg.version = VERSION;
  pkg.dependencies = internal(pkg.dependencies);
  // Cho phép web chủ trỏ styles tới file theme
  pkg.exports = { ...pkg.exports, './compass-theme.scss': './compass-theme.scss' };
  writeJson(file, pkg);
  return dest;
}

// 3) Công cụ dòng lệnh và backend: một file bin, phụ thuộc nặng (ts-morph, fastify...) cài từ npm
async function buildBin(dir, { name, entry, bin }) {
  const pkg = readPkg(dir);
  const dest = join(out, name);
  await build({
    entryPoints: [join(root, dir, entry)],
    outfile: join(dest, 'bin', `${bin}.mjs`),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    external: external(pkg.dependencies),
    banner: { js: '#!/usr/bin/env node\nimport { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
    sourcemap: true,
    logLevel: 'warning',
  });
  cpSync(join(root, 'packs'), join(dest, 'packs'), { recursive: true });
  // CLI kèm giao diện Studio đã build (phục vụ bởi lệnh `wealthcompass studio`)
  if (name === 'cli') {
    run('npm', ['run', 'build', '-w', 'studio-ui', '--silent']);
    cpSync(join(root, 'packages', 'studio-ui', 'dist', 'studio-ui', 'browser'), join(dest, 'studio-ui'), { recursive: true });
  }
  const deps = Object.fromEntries(Object.entries(pkg.dependencies ?? {}).filter(([k]) => !k.startsWith('@wealthcompass/')));
  writeJson(join(dest, 'package.json'), {
    name: `@wealthcompass/${name}`,
    version: VERSION,
    type: 'module',
    bin: { [bin]: `./bin/${bin}.mjs` },
    files: name === 'cli' ? ['bin', 'packs', 'studio-ui'] : ['bin', 'packs'],
    engines: { node: '>=20' },
    dependencies: deps,
  });
  return dest;
}

const dirs = [];
dirs.push(await buildLibrary('packages/contracts', { platform: 'neutral' }));
dirs.push(await buildLibrary('packages/core', { platform: 'browser' }));
dirs.push(buildAngular());
dirs.push(await buildBin('packages/cli', { name: 'cli', entry: 'src/main.ts', bin: 'wealthcompass' }));
dirs.push(await buildBin('server', { name: 'server', entry: 'src/main.ts', bin: 'wealthcompass-server' }));

for (const dir of dirs) {
  if (!existsSync(join(dir, 'package.json'))) throw new Error(`Thiếu package.json ở ${dir}`);
  run('npm', ['pack', '--silent', '--pack-destination', tarballs], dir);
}
console.log(`\nĐã đóng gói phiên bản ${VERSION} vào ${tarballs}`);
