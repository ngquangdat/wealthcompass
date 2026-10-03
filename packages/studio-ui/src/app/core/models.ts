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
