import { Node, Project, type SourceFile } from 'ts-morph';
import { resolve } from 'node:path';
import { evalLiteral } from './routes';

// Web khác nhau đặt tên khóa menu khác nhau; chấp nhận các tên phổ biến
const LABEL_KEYS = ['label', 'title', 'name', 'text', 'displayName'];
const ROUTE_KEYS = ['route', 'path', 'link', 'url', 'routerLink', 'href'];
const CHILD_KEYS = ['children', 'items', 'submenu', 'subItems', 'subMenu'];

type Item = Record<string, unknown>;

const pick = (item: Item, keys: string[]): unknown => keys.map((k) => item[k]).find((v) => v !== undefined);

function routeOf(item: Item): string | undefined {
  const value = pick(item, ROUTE_KEYS);
  if (typeof value === 'string') return value.startsWith('/') ? value : '/' + value;
  // routerLink dạng mảng ['/a', 'b']
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return '/' + value.join('/').replace(/^\/+/, '').replace(/\/+/g, '/');
  return undefined;
}

// Điểm "giống menu" của một mảng literal: số mục có cả nhãn lẫn đường dẫn (kể cả mục con)
export function menuScore(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  let score = 0;
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Item;
    const label = pick(item, LABEL_KEYS);
    if (typeof label === 'string' && routeOf(item)) score++;
    score += menuScore(pick(item, CHILD_KEYS));
  }
  return score;
}

export interface MenuCandidate {
  file: SourceFile;
  name: string;
  score: number;
  value: unknown;
}

// Biến mảng literal trong một file, xếp theo độ giống menu
export function menuCandidates(file: SourceFile): MenuCandidate[] {
  return file
    .getVariableDeclarations()
    .map((d) => {
      const init = d.getInitializer();
      const value = init && (Node.isArrayLiteralExpression(init) || Node.isAsExpression(init) || Node.isSatisfiesExpression(init)) ? evalLiteral(init) : undefined;
      return { file, name: d.getName(), score: menuScore(value), value };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
}

// Đọc file menu và trả về map route -> đường dẫn menu ["Trái phiếu", "Giao dịch iConnect"]
export function scanMenu(project: Project, menuFile: string | undefined, root: string, warnings: string[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (!menuFile) return result;

  const file = project.getSourceFile(resolve(root, menuFile));
  if (!file) {
    warnings.push(`Không tìm thấy file menu: ${menuFile}`);
    return result;
  }
  const best = menuCandidates(file)[0];
  if (!best) {
    warnings.push(`${menuFile}: không thấy mảng menu literal (cần các mục có nhãn ${LABEL_KEYS.join('/')} và đường dẫn ${ROUTE_KEYS.join('/')})`);
    return result;
  }

  const walk = (nodes: unknown, trail: string[]) => {
    if (!Array.isArray(nodes)) return;
    for (const raw of nodes) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Item;
      const label = pick(item, LABEL_KEYS);
      if (typeof label !== 'string') continue;
      const next = [...trail, label];
      const route = routeOf(item);
      if (route) result.set(route, next);
      walk(pick(item, CHILD_KEYS), next);
    }
  };
  walk(best.value, []);
  return result;
}
