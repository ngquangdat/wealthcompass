export interface ProjectSummary {
  path: string;
  name: string;
  angularVersion: string | null;
  // Dự án tour chưa có source của web (discovery.source: none)
  noSource?: boolean;
  // web.url trong cấu hình
  webUrl?: string | null;
  // File kho SQLite chứa dữ liệu của dự án (ngoài source), hoặc thư mục web với dự án kiểu cũ
  dataStore?: string;
  // Dự án kiểu cũ: file của WealthCompass còn nằm cạnh source, nên chuyển bằng `wealthcompass migrate`
  legacyFiles?: boolean;
  devPort: number;
  bootstrap: { kind: 'standalone' | 'ngmodule'; root: string } | null;
  routesFile: string | null;
  menuFile: string | null;
  auth: { service: string; tokenExpr: string | null; rolesExpr: string | null } | null;
  notes: string[];
  integrated: boolean;
  installed: boolean;
  patchPending: boolean;
}

export interface Check {
  status: 'ok' | 'fail' | 'warn';
  name: string;
  detail?: string;
  fix?: string;
}

export interface Overview {
  integrated: boolean;
  checks: Check[];
  warnings: string[];
  stats: { screens: number; drafts: number; missing: number; tourIds: number; tours: number } | null;
}

export interface FeatureRow {
  id: string;
  route: string;
  title: string;
  description: string;
  keywords: string[];
  sampleQuestions: string[];
  menuPath: string[];
  facets: Record<string, string>;
  requires: string[];
  guards: string[];
  guardRequires: string[];
  requiresOverride: boolean;
  tourIds: string[];
  targets: number;
  overridden: string[];
  draft: string[];
  gaps: string[];
  hidden: boolean;
  sourceRef?: string;
}

export interface ProcState {
  running: boolean;
  pid?: number;
  startedAt?: number;
  exitCode?: number | null;
  port: number;
  available: boolean;
  // Đang chạy nhưng không do Studio bật (terminal khác): Studio không dừng hay xem log được
  external?: boolean;
}

export interface RunState {
  // Backend chạy độc lập với Studio; Studio chỉ kết nối tới
  backend: {
    running: boolean;
    port: number;
    health: { features?: number; storedTours?: number; llmConfigured?: boolean; provider?: string; model?: string; debug?: boolean; tourDb?: string } | null;
    command: { cwd: string; run: string; withStudio: string } | null;
    // Kho tour của dự án (Studio ghi vào đây)
    tourDb: string;
    // Backend có đọc đúng kho đó không; null khi backend không báo (không chạy debug)
    sameTourDb: boolean | null;
  };
  web: ProcState & { url: string };
}

export interface AiState {
  provider: string;
  model: string;
  baseUrl: string;
  hasKey: boolean;
  keySource: string | null;
  providers: string[];
}

export interface RoleRow {
  name: string;
  description: string;
  inCatalog: boolean; // đã khai trong access.roles
  guards: string[];
  screens: string[]; // màn hình ghi đè quyền dùng quyền này
}

export interface GuardRow {
  name: string;
  requires: string[] | null;
  // default: chưa khai, chỉ cần đăng nhập. draft: cấu hình cũ còn quyền đoán từ tên, cần xem lại
  status: 'default' | 'draft' | 'reviewed' | 'code' | 'auth' | 'manual';
  // Chuỗi quyền thấy trong code của guard (gợi ý, chưa áp)
  suggested?: string[];
  evidence: string | null;
  how: string;
  screens: string[];
}

export interface TourStep {
  // Khóa bước của tour ghi bằng locator (giữ locator khi sắp xếp lại)
  key?: string;
  // tourId ghim; rỗng = tìm phần tử theo locator đã ghi
  target: string;
  // Mô tả phần tử đã ghi, vd. button "Bán" · app-bond-sell-panel
  element?: string;
  advanceOn: 'click' | 'next' | 'hover';
  text: string;
  known?: boolean;
  label?: string;
  route?: string;
  sensitive?: boolean;
  // Ngày locator được làm mới (tour:verify --heal hoặc ghi lại bước)
  healedAt?: string;
}

// Thiết bị của một bản tour
export type TourLayout = 'desktop' | 'tablet' | 'mobile';

// Locator đề xuất bởi tour:verify cho bước nhạy cảm, chờ người duyệt
export interface TourProposal {
  layout: TourLayout;
  key: string;
  index: number;
  text: string;
  from: string;
  to: string;
  changed: string[];
  at: string;
}

export interface TourDef {
  id: string;
  title?: string;
  description?: string;
  feature?: string;
  startRoute?: string;
  steps: TourStep[];
  // recorded: ghi bằng tour:record (compass.tours.json), không cần tourId
  source?: 'recorded';
  // Thiết bị đã ghi (bản chính trước), vd. ['desktop', 'mobile']
  layouts?: TourLayout[];
  proposals?: TourProposal[];
  draft: boolean;
  valid: boolean;
  errors: string[];
}

export interface AssistantMeta {
  backend: { running: boolean; debug: boolean; url: string };
  roles: string[];
  routes: string[];
  features: Array<{ id: string; title: string; route: string; requires: string[] }>;
  samples: string[];
}

export interface DebugStage {
  stage: 'prefetch' | 'llm' | 'tool' | 'error' | 'done';
  data: Record<string, any>;
}

export interface EvalCase {
  q: string;
  expect: string[];
  roles?: string[];
  draft?: boolean; // AI vừa đề xuất, chưa lưu
}

export interface EvalRow {
  q: string;
  expect: string[];
  rank: number | null;
  pass: boolean;
  reason: string | null;
  top: Array<{ id: string; title: string; score: number }>;
}

export interface EvalRun {
  at: string;
  summary: { total: number; hit1: number; hit3: number; mrr: number; failed: number };
  rows: EvalRow[];
}

export interface LogStats {
  file: string;
  exists: boolean;
  days: number;
  questions: number;
  users: number;
  outcomes: { offered: number; answered: number; not_found: number; refused: number; error: number };
  fallback: number;
  latency: { p50: number | null; p95: number | null };
  notFound: Array<{ q: string; count: number; last: string }>;
  funnel: Array<{ tourId: string; offered: number; started: number; completed: number; cancelled: number; failed: number }>;
  daily: Array<{ day: string; n: number }>;
  recent: Array<{ ts: string; q: string; outcome: string; offered: string[]; source: string }>;
}
