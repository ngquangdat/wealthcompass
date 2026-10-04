import { existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Tìm thư mục Domain Pack theo tên hoặc đường dẫn. Thứ tự:
// 1) giá trị là đường dẫn tới thư mục có pack.yaml
// 2) COMPASS_PACKS_DIR/<tên>
// 3) đi ngược từ startDir tìm packs/<tên> (khi chạy trong repo)
// 4) packs/<tên> đóng kèm gói đã build (bên cạnh thư mục bin)
export function resolvePackDir(nameOrPath: string, startDir: string = process.cwd()): string | null {
  const isPack = (dir: string) => existsSync(join(dir, 'pack.yaml'));
  const asPath = isAbsolute(nameOrPath) ? nameOrPath : resolve(startDir, nameOrPath);
  if (existsSync(asPath) && statSync(asPath).isDirectory() && isPack(asPath)) return asPath;

  const name = nameOrPath.replace(/^.*[\\/]/, '');
  const envDir = process.env['COMPASS_PACKS_DIR'];
  if (envDir && isPack(join(envDir, name))) return join(envDir, name);

  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (isPack(join(dir, 'packs', name))) return join(dir, 'packs', name);
    // Dự án đã cài gói: pack đóng kèm trong node_modules
    for (const pkg of ['server', 'cli']) {
      const inModules = join(dir, 'node_modules', '@wealthcompass', pkg, 'packs', name);
      if (isPack(inModules)) return inModules;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }

  // Gói đã build: <gói>/bin/x.mjs và <gói>/packs/<tên>
  const here = dirname(fileURLToPath(import.meta.url));
  // Chạy từ mã nguồn: packages/llm/src -> <repo>/packs
  for (const candidate of [join(here, '..', 'packs', name), join(here, 'packs', name), join(here, '..', '..', '..', 'packs', name)]) {
    if (isPack(candidate)) return candidate;
  }
  return null;
}
