import { Project } from 'ts-morph';
import { resolve } from 'node:path';
import { evalLiteral } from './routes';

interface MenuNode {
  label?: string;
  route?: string;
  children?: MenuNode[];
}

// Đọc file menu (mảng literal) và trả về map route -> đường dẫn menu ["Trái phiếu", "Giao dịch iConnect"]
export function scanMenu(project: Project, menuFile: string | undefined, root: string, warnings: string[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (!menuFile) return result;

  const file = project.getSourceFile(resolve(root, menuFile));
  if (!file) {
    warnings.push(`Không tìm thấy file menu: ${menuFile}`);
    return result;
  }
  const decl = file.getVariableDeclarations().find((d) => d.isExported());
  const items = evalLiteral(decl?.getInitializer()) as MenuNode[] | undefined;
  if (!Array.isArray(items)) {
    warnings.push(`${menuFile}: không đọc được mảng menu literal`);
    return result;
  }

  const walk = (nodes: MenuNode[], trail: string[]) => {
    for (const node of nodes) {
      if (!node?.label) continue;
      const next = [...trail, node.label];
      if (node.route) result.set(node.route, next);
      if (node.children) walk(node.children, next);
    }
  };
  walk(items, []);
  return result;
}
