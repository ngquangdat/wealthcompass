import { z } from 'zod';

// Bốn hợp đồng của WealthCompass (xem docs/universal-plan.md mục 3).
// Schema zod là nguồn duy nhất; kiểu TypeScript suy ra từ schema để không lệch.

export const SCHEMA_VERSION = '2';

// ---------------------------------------------------------------------------
// 3.1 Feature Map v2
// ---------------------------------------------------------------------------

export const sensitivitySchema = z.enum(['normal', 'user-only']);
export type Sensitivity = z.infer<typeof sensitivitySchema>;

export const targetSchema = z.object({
  tourId: z.string(),
  label: z.string().optional(),
  hint: z.string().optional(),
  sensitivity: sensitivitySchema.default('normal'),
  // Route của màn hình chứa phần tử này (suy ra từ component sở hữu template)
  route: z.string().optional(),
});
export type Target = z.infer<typeof targetSchema>;

// Một bước trong luồng hướng dẫn. Bước tham chiếu tourId, route lấy từ target.
export const tourStepSchema = z.object({
  tourId: z.string(),
  text: z.string(),
  // click: chờ người dùng tự bấm vào phần tử rồi mới tiến (engine không bao giờ tự click)
  // next: người dùng bấm nút "Tiếp" của popover
  advanceOn: z.enum(['next', 'click']).default('next'),
  // Route chứa phần tử; scanner điền từ target. Engine chỉ điều hướng khi phần tử chưa hiện.
  route: z.string().optional(),
  // Tiêu đề ngắn của popover (lấy từ nhãn của target)
  label: z.string().optional(),
});
export type TourStep = z.infer<typeof tourStepSchema>;

export const tourSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  // Màn hình bắt đầu luồng; engine điều hướng về đây trước bước đầu tiên
  startRoute: z.string(),
  steps: z.array(tourStepSchema).min(1),
});
export type Tour = z.infer<typeof tourSchema>;

export const featureSchema = z.object({
  id: z.string(),
  route: z.object({
    pattern: z.string(),
    exampleParams: z.record(z.string(), z.string()).optional(),
  }),
  title: z.string(),
  description: z.string().default(''),
  keywords: z.array(z.string()).default([]),
  menuPath: z.array(z.string()).default([]),
  facets: z.record(z.string(), z.string()).default({}),
  access: z
    .object({
      requires: z.array(z.string()).default([]),
      unknownGuards: z.array(z.string()).default([]),
    })
    .default({ requires: [], unknownGuards: [] }),
  targets: z.array(targetSchema).default([]),
  sampleQuestions: z.array(z.string()).default([]),
  // Id các tour dẫn tới / nằm trên tính năng này
  tourIds: z.array(z.string()).default([]),
  provenance: z.object({
    source: z.array(z.enum(['static', 'manual', 'llm'])),
    reviewed: z.boolean().default(false),
    sourceRef: z.string().optional(),
  }),
});
export type Feature = z.infer<typeof featureSchema>;

export const featureMapSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  appVersion: z.string(),
  generatedAt: z.string(),
  features: z.array(featureSchema),
  tours: z.array(tourSchema).default([]),
  coverage: z.object({
    routesFound: z.number(),
    routesWithTitle: z.number(),
    menuItemsMatched: z.number(),
    targetsFound: z.number(),
    warnings: z.array(z.string()),
  }),
});
export type FeatureMap = z.infer<typeof featureMapSchema>;

// ---------------------------------------------------------------------------
// 3.2 Context protocol (widget -> agent)
// ---------------------------------------------------------------------------

export const chatContextSchema = z.object({
  route: z.string(),
  routePattern: z.string().optional(),
  visibleTargets: z.array(z.string()).default([]),
  locale: z.string().default('vi'),
  // Chỉ để lọc kết quả cho gọn, KHÔNG phải ranh giới bảo mật (xem plan mục 6.2)
  capabilities: z.array(z.string()).default([]),
});
export type ChatContext = z.infer<typeof chatContextSchema>;

export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatRequestSchema = z.object({
  message: z.string().min(1).max(1000),
  history: z.array(chatMessageSchema).max(20).default([]),
  context: chatContextSchema,
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

// ---------------------------------------------------------------------------
// 3.3 Event protocol (agent -> widget, qua SSE)
// ---------------------------------------------------------------------------

// Agent KHÔNG có sự kiện click/điền/gửi form. Chỉ có hiển thị và dẫn đường.
export type ChatEvent =
  | { type: 'text'; delta: string }
  // Nút "Dẫn tôi đi": người dùng bấm mới bắt đầu tour
  | { type: 'offer_tour'; tourId: string; label: string }
  // Nút điều hướng thẳng tới màn hình
  | { type: 'offer_navigate'; route: string; label: string }
  | { type: 'handoff'; message: string }
  | { type: 'refusal'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

export type ToolResultStatus =
  | 'ok'
  | 'target_missing'
  | 'blocked_user_only'
  | 'route_denied'
  | 'timeout'
  | 'cancelled';

// ---------------------------------------------------------------------------
// 3.4 App config (compass.config.ts / compass.config.yaml)
// ---------------------------------------------------------------------------

export const compassConfigSchema = z.object({
  domainPack: z.string().default('finance-vn'),
  locale: z.string().default('vi'),
  discovery: z.object({
    entry: z.string(),
    menu: z.string().optional(),
    srcRoot: z.string().default('src'),
    overrides: z.string().default('compass.overrides.yaml'),
    out: z.string().default('feature-map.json'),
  }),
  access: z
    .object({
      guards: z.record(z.string(), z.object({ requires: z.array(z.string()) })).default({}),
    })
    .default({ guards: {} }),
  safety: z
    .object({
      userOnly: z.array(z.string()).default([]),
      blockedRoutes: z.array(z.string()).default([]),
    })
    .default({ userOnly: [], blockedRoutes: [] }),
});
export type CompassConfig = z.infer<typeof compassConfigSchema>;
