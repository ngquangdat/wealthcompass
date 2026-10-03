// Tách patch git thành file -> đoạn (hunk) để người dùng chọn áp từng phần trên Studio,
// rồi ghép lại đúng các đoạn đã chọn thành patch hợp lệ cho `git apply`.

export interface Hunk {
  id: string;
  header: string; // dòng @@ ... @@
  lines: string[]; // các dòng ' ', '+', '-' của đoạn
  added: number;
  removed: number;
}

export interface FilePatch {
  path: string;
  head: string[]; // diff --git, ---, +++
  hunks: Hunk[];
}

export function parsePatch(patch: string): FilePatch[] {
  const files: FilePatch[] = [];
  let file: FilePatch | null = null;
  let hunk: Hunk | null = null;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = { path: line.replace(/^diff --git a\/(.*) b\/.*$/, '$1'), head: [line], hunks: [] };
      files.push(file);
      hunk = null;
    } else if (file && !hunk && (line.startsWith('--- ') || line.startsWith('+++ '))) {
      file.head.push(line);
    } else if (file && line.startsWith('@@')) {
      hunk = { id: `${file.path}#${file.hunks.length}`, header: line, lines: [], added: 0, removed: 0 };
      file.hunks.push(hunk);
    } else if (hunk && (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-') || line.startsWith('\\'))) {
      hunk.lines.push(line);
      if (line.startsWith('+')) hunk.added++;
      else if (line.startsWith('-')) hunk.removed++;
    }
  }
  return files;
}

// Ghép lại chỉ các đoạn được chọn. File không còn đoạn nào thì bỏ hẳn.
// Bỏ một đoạn làm lệch số dòng của đoạn sau; `git apply` tự dò lại theo ngữ cảnh nên vẫn áp được.
export function selectHunks(files: FilePatch[], selected: Set<string>): string {
  let out = '';
  for (const f of files) {
    const keep = f.hunks.filter((h) => selected.has(h.id));
    if (!keep.length) continue;
    out += f.head.join('\n') + '\n';
    for (const h of keep) out += h.header + '\n' + h.lines.join('\n') + '\n';
  }
  return out;
}
