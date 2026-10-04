export interface ProjectSummary {
  path: string;
  name: string;
  angularVersion: string | null;
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
  tourIds: string[];
  targets: number;
  overridden: string[];
  draft: string[];
  gaps: string[];
  hidden: boolean;
  sourceRef?: string;
}

export interface Hunk {
  id: string;
  header: string;
  lines: string[];
  added: number;
  removed: number;
}

export interface FilePatch {
  path: string;
  head: string[];
  hunks: Hunk[];
}

export interface ProcState {
  running: boolean;
  pid?: number;
  startedAt?: number;
  exitCode?: number | null;
  port: number;
  available: boolean;
}

export interface RunState {
  backend: ProcState & { health: { features?: number; llmConfigured?: boolean; provider?: string; model?: string; pack?: string } | null };
  web: ProcState & { url: string };
}

export interface AiState {
  provider: string;
  model: string;
  baseUrl: string;
  hasKey: boolean;
  keySource: string | null;
  aiCode: boolean;
  providers: string[];
}

export interface GuardRow {
  name: string;
  requires: string[] | null;
  status: 'unmapped' | 'draft' | 'reviewed' | 'code' | 'auth' | 'manual';
  evidence: string | null;
  how: string;
  screens: string[];
}

export interface TourIdCandidate {
  key: string;
  tourId: string;
  tag: string;
  kind: string;
  label: string | null;
  sensitive: { level: 'sure' | 'maybe'; reason: string } | null;
  screen: string;
  screenTitle: string;
  file: string;
  line: number;
  component: string;
  // Mục menu sinh từ dữ liệu: gắn [tourMenu]="menuExpr", mỗi mục có mốc menu-<route>
  menuExpr: string | null;
}

export interface TourStep {
  target: string;
  advanceOn: 'click' | 'next';
  text: string;
  known?: boolean;
  label?: string;
  route?: string;
  sensitive?: boolean;
}

export interface TourDef {
  id: string;
  title?: string;
  description?: string;
  feature?: string;
  startRoute?: string;
  steps: TourStep[];
  draft: boolean;
  valid: boolean;
  errors: string[];
}

export interface PackState {
  name: string;
  dir: string | null;
  editable: boolean;
  error?: string;
  glossary: string[][];
  topics: Array<{ id: string; patterns: string[]; refusal: string }>;
  prompt: string;
}

export interface AssistantMeta {
  backend: { running: boolean; debug: boolean; url: string };
  roles: string[];
  routes: string[];
  features: Array<{ id: string; title: string; route: string; requires: string[] }>;
  samples: string[];
}

export interface DebugStage {
  stage: 'guardrail' | 'prefetch' | 'llm' | 'tool' | 'error' | 'done';
  data: Record<string, any>;
}

export interface EvalCase {
  q: string;
  expect: string[];
  blocked?: boolean;
  roles?: string[];
  draft?: boolean; // AI vừa đề xuất, chưa lưu
}

export interface EvalRow {
  q: string;
  expect: string[];
  blocked: boolean;
  rank: number | null;
  pass: boolean;
  reason: string | null;
  top: Array<{ id: string; title: string; score: number }>;
}

export interface EvalRun {
  at: string;
  summary: { total: number; hit1: number; hit3: number; mrr: number; blockedOk: number; blockedTotal: number; failed: number };
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
  byTopic: Record<string, number>;
  notFound: Array<{ q: string; count: number; last: string }>;
  funnel: Array<{ tourId: string; offered: number; started: number; completed: number; cancelled: number; failed: number }>;
  daily: Array<{ day: string; n: number }>;
  recent: Array<{ ts: string; q: string; outcome: string; offered: string[]; source: string }>;
}
