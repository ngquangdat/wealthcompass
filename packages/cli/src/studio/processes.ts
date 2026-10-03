import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Quản lý tiến trình Studio mở hộ dev: backend WealthCompass và dev server của web.
// Giữ một ít log gần nhất để hiện trên giao diện; tắt hết khi Studio thoát.

export type ProcName = 'backend' | 'web' | 'task';

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

// Backend dùng đúng gói @wealthcompass/server đã cài trong dự án (giống khi chạy thật)
export function backendBin(appDir: string): string | null {
  const bin = join(appDir, 'node_modules', '@wealthcompass', 'server', 'bin', 'wealthcompass-server.mjs');
  return existsSync(bin) ? bin : null;
}

export function ngBin(appDir: string): string | null {
  const bin = join(appDir, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
  return existsSync(bin) ? bin : null;
}
