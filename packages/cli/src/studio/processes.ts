import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Quản lý tiến trình Studio mở hộ dev: dev server của web (backend chạy độc lập, Studio không bật).
// Giữ một ít log gần nhất để hiện trên giao diện; tắt hết khi Studio thoát.

export type ProcName = 'web';

export interface ProcInfo {
  name: ProcName;
  running: boolean;
  pid?: number;
  startedAt?: number;
  exitCode?: number | null;
  command?: string;
}

interface Managed {
  child: ChildProcess;
  info: ProcInfo;
}

const MAX_LINES = 400;
const procs = new Map<ProcName, Managed>();
const logs = new Map<ProcName, string[]>();
const listeners = new Map<ProcName, Set<(line: string) => void>>();

function push(name: ProcName, chunk: string): void {
  const buf = logs.get(name) ?? [];
  for (const line of chunk.split('\n')) {
    if (!line.trim()) continue;
    buf.push(line);
    listeners.get(name)?.forEach((fn) => fn(line));
  }
  if (buf.length > MAX_LINES) buf.splice(0, buf.length - MAX_LINES);
  logs.set(name, buf);
}

export function startProc(name: ProcName, command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ProcInfo {
  stopProc(name);
  logs.set(name, []);
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const info: ProcInfo = { name, running: true, pid: child.pid, startedAt: Date.now(), command: [command, ...args].join(' ') };
  child.stdout?.on('data', (d) => push(name, d.toString()));
  child.stderr?.on('data', (d) => push(name, d.toString()));
  child.on('exit', (code) => {
    info.running = false;
    info.exitCode = code;
    push(name, `[đã dừng, mã thoát ${code ?? '?'}]`);
  });
  child.on('error', (e) => push(name, `[không chạy được: ${e.message}]`));
  procs.set(name, { child, info });
  return info;
}

export function stopProc(name: ProcName): void {
  const p = procs.get(name);
  if (p && p.info.running) p.child.kill('SIGTERM');
  procs.delete(name);
}

export function procInfo(name: ProcName): ProcInfo {
  return procs.get(name)?.info ?? { name, running: false };
}

export function procLogs(name: ProcName): string[] {
  return logs.get(name) ?? [];
}

export function onLog(name: ProcName, fn: (line: string) => void): () => void {
  const set = listeners.get(name) ?? new Set();
  set.add(fn);
  listeners.set(name, set);
  return () => set.delete(fn);
}

export function stopAll(): void {
  for (const name of procs.keys()) stopProc(name);
}

// Tìm một file trong node_modules của dự án hoặc của thư mục cha (workspace npm đưa gói lên node_modules gốc)
function findInNodeModules(appDir: string, ...path: string[]): string | null {
  for (let dir = resolve(appDir); ; dir = dirname(dir)) {
    const file = join(dir, 'node_modules', ...path);
    if (existsSync(file)) return file;
    if (dirname(dir) === dir) return null;
  }
}

// Studio đang chạy từ source của repo WealthCompass (có sẵn source backend): trả về thư mục repo để in lệnh `npm run server`.
// Chạy từ gói đã build thì trả null (backend là lệnh `wealthcompass-server` của gói @wealthcompass/server cài riêng).
export function sourceRepo(): string | null {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  return existsSync(join(repo, 'server', 'src', 'main.ts')) && existsSync(join(repo, 'node_modules', 'tsx', 'dist', 'cli.mjs')) ? repo : null;
}

export function ngBin(appDir: string): string | null {
  return findInNodeModules(appDir, '@angular', 'cli', 'bin', 'ng.js');
}

// Cổng đã có tiến trình trả lời HTTP (vd. web hay backend chạy sẵn ngoài Studio)
export async function portAnswers(url: string, timeoutMs = 800): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return true;
  } catch {
    return false;
  }
}
