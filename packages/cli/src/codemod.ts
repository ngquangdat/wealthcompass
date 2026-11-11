import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { relative } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { ClassDeclaration, Node, ObjectLiteralExpression, SourceFile } from 'ts-morph';

// Mô hình sửa code của setup: mọi thay đổi là "chèn chữ tại vị trí" trong file GỐC,
// gom theo file rồi xuất một patch git duy nhất. Không ghi gì vào code.

export interface Edit {
  pos: number;
  text: string;
  // Thay thế đoạn [pos, end) thay vì chỉ chèn (dùng cho file JSON)
  end?: number;
}

export type EditSet = Map<string, Edit[]>;

export function addEdit(set: EditSet, file: string, edit: Edit): void {
  set.set(file, [...(set.get(file) ?? []), edit]);
}

export function applyEdits(text: string, edits: Edit[]): string {
  // Từ cuối về đầu để vị trí các chỗ sửa trước không bị lệch
  return [...edits]
    .sort((a, b) => b.pos - a.pos)
    .reduce((acc, e) => acc.slice(0, e.pos) + e.text + acc.slice(e.end ?? e.pos), text);
}

export function decoratorArg(cls: ClassDeclaration, name = 'Component'): ObjectLiteralExpression | undefined {
  const arg = cls.getDecorator(name)?.getArguments()[0];
  return arg && Node.isObjectLiteralExpression(arg) ? arg : undefined;
}

// Thêm một ký hiệu vào mảng `imports` (hoặc `providers`...) của @Component/@NgModule.
// Không tự thêm được (mảng không phải literal) thì trả lý do để người làm tay.
export function addToDecoratorArray(
  cls: ClassDeclaration,
  property: 'imports' | 'providers',
  code: string,
  decorator: 'Component' | 'NgModule' = 'Component',
): { edits: Edit[]; problem?: string } {
  const arg = decoratorArg(cls, decorator);
  if (!arg) return { edits: [], problem: `không tìm thấy @${decorator}` };
  const symbol = code.match(/^[\w$]+/)?.[0] ?? code;
  const prop = arg.getProperty(property);
  if (prop && Node.isPropertyAssignment(prop)) {
    const init = prop.getInitializer();
    if (init && new RegExp(`\\b${symbol}\\b`).test(init.getText())) return { edits: [] };
    if (!init || !Node.isArrayLiteralExpression(init)) {
      return { edits: [], problem: `${property} của ${cls.getName()} không phải mảng literal, hãy thêm ${symbol} bằng tay` };
    }
    const els = init.getElements();
    return els.length
      ? { edits: [{ pos: els[els.length - 1].getEnd(), text: `, ${code}` }] }
      : { edits: [{ pos: init.getStart() + 1, text: code }] };
  }
  return { edits: [{ pos: arg.getStart() + 1, text: `\n  ${property}: [${code}],` }] };
}

// Thêm nhiều ký hiệu từ một module trong MỘT câu import (không tách dòng cho cùng module)
export function importsEdit(file: SourceFile, moduleName: string, symbols: string[]): Edit | null {
  const imports = file.getImportDeclarations();
  const missing = symbols.filter((s) => !imports.some((i) => i.getNamedImports().some((n) => n.getName() === s)));
  if (!missing.length) return null;
  const same = imports.find((i) => i.getModuleSpecifierValue() === moduleName && i.getNamedImports().length);
  if (same) {
    const named = same.getNamedImports();
    return { pos: named[named.length - 1].getEnd(), text: missing.map((m) => `, ${m}`).join('') };
  }
  const line = `import { ${missing.join(', ')} } from '${moduleName}';`;
  if (imports.length) return { pos: imports[imports.length - 1].getEnd(), text: `\n${line}` };
  return { pos: 0, text: `${line}\n` };
}

export function gitTopLevel(dir: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

// Patch dạng git; đường dẫn tính từ gốc repo git (để `git apply` chạy từ gốc repo).
// realpath cả hai phía: git trả đường dẫn thật (macOS: /private/var/...) còn ts-morph có thể trả qua symlink (/var/...).
export function buildGitPatch(edits: EditSet, dir: string): { patch: string; base: string; files: number } {
  const base = realpathSync(gitTopLevel(dir) ?? dir);
  let patch = '';
  let files = 0;
  for (const [file, list] of [...edits.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const before = readFileSync(file, 'utf8');
    const after = applyEdits(before, list);
    if (after === before) continue;
    files++;
    const rel = relative(base, realpathSync(file)).split('\\').join('/');
    const body = createTwoFilesPatch(`a/${rel}`, `b/${rel}`, before, after, '', '', { context: 3 })
      .split('\n')
      .filter((l) => !l.startsWith('====') && !l.startsWith('Index:'))
      .join('\n');
    patch += `diff --git a/${rel} b/${rel}\n${body}`;
  }
  return { patch, base, files };
}
