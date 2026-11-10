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

// Locator: nhiều manh mối về một phần tử, ghi lúc `tour:record` để tìm lại phần tử KHÔNG cần tourId trong HTML.
// Lúc chạy, widget chấm điểm các ứng viên theo các manh mối này (core/locator.ts). Không chứa dữ liệu cá nhân:
// chữ đã qua redactPii, bỏ chữ trong vùng nhạy cảm và chuỗi gần như toàn số.
export const locatorSchema = z.object({
  tag: z.string(),
  // Vai trò và tên truy cập (như trình đọc màn hình thấy): bền khi đổi CSS, đổi cấu trúc HTML
  role: z.string().optional(),
  name: z.string().optional(),
  // Chữ hiển thị, đã cắt ngắn
  text: z.string().optional(),
  // Thuộc tính ổn định (formcontrolname, routerlink, href, name, placeholder, type, aria-label, data-testid, id ổn định)
  attrs: z.record(z.string(), z.string()).default({}),
  // Thẻ component Angular gần nhất chứa phần tử (vd. app-bond-sell-panel)
  component: z.string().optional(),
  // Vùng chứa: tiêu đề hộp thoại, tiêu đề mục gần nhất, landmark (nav, main, header...)
  context: z
    .object({ dialog: z.string().optional(), heading: z.string().optional(), landmark: z.string().optional() })
    .default({}),
  // Selector CSS dự phòng (đã bỏ class/id sinh tự động)
  css: z.string().optional(),
  // Vị trí theo tỉ lệ khung nhìn; chỉ dùng để phân xử khi hòa điểm
  rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
  layout: z.enum(['mobile', 'desktop']).optional(),
  // Phần tử nằm trong một dòng của danh sách lặp (bảng, @for, virtual scroll): mọi dòng có phần tử giống hệt
  // đều đúng, nên không coi các dòng khác là "đối thủ". Ghi hình dạng dòng, không ghi dòng cụ thể.
  list: z
    .object({
      // Selector của dòng (vd. "tr", "[role=row]", "mat-row", "div.bond-card")
      row: z.string(),
      // Tiêu đề cột chứa phần tử (bảng): thêm điểm cho ô đúng cột
      column: z.string().optional(),
      // Người duyệt có thể ghim một dòng cụ thể: chỉ chọn dòng chứa chữ này (không tự ghi vì có thể là dữ liệu khách)
      rowText: z.string().optional(),
      // Thứ tự (từ 0) của dòng người ghi đã bấm, tính trong các dòng cùng hình dạng. Lúc chạy chọn đúng dòng thứ i;
      // danh sách ngắn hơn thì lấy dòng cuối. rowText (nếu có) được ưu tiên hơn.
      index: z.number().int().min(0).optional(),
    })
    .optional(),
});
export type Locator = z.infer<typeof locatorSchema>;

// Một bước trong luồng hướng dẫn. Bước trỏ vào phần tử bằng tourId (ghim, luôn thắng) và/hoặc locator.
export const tourStepSchema = z
  .object({
    // Khóa ổn định của bước trong tour (s1, s2...), dùng cho telemetry
    key: z.string().optional(),
    tourId: z.string().optional(),
    locator: locatorSchema.optional(),
    text: z.string(),
    // click: chờ người dùng tự bấm vào phần tử rồi mới tiến (engine không bao giờ tự click)
    // next: người dùng bấm nút "Tiếp" của popover
    // hover: chờ người dùng di chuột vào phần tử (nút mở menu hover trên desktop); engine giữ menu mở (khóa hover)
    // cho tới khi xong bước không-hover kế tiếp
    advanceOn: z.enum(['next', 'click', 'hover']).default('next'),
    // Route chứa phần tử; scanner điền từ target. Engine chỉ điều hướng khi phần tử chưa hiện.
    route: z.string().optional(),
    // Tiêu đề ngắn của popover (lấy từ nhãn của target)
    label: z.string().optional(),
    // Bước chỉ để mở chỗ chứa bước sau (nút menu trên mobile, mở rộng mục): bỏ qua khi phần tử của bước sau đã hiện
    skipIfNextVisible: z.boolean().optional(),
    // Ngày locator được làm mới (tour:verify --heal tự sửa, hoặc ghi lại riêng bước này)
    healedAt: z.string().optional(),
    // Locator đề xuất bởi tour:verify cho bước cần người duyệt (phần tử nhạy cảm): chưa dùng tới khi được duyệt
    proposal: z
      .object({
        locator: locatorSchema,
        // Manh mối đã đổi so với locator đang dùng (name, text, attrs.routerlink, tourId...)
        changed: z.array(z.string()),
        at: z.string(),
      })
      .optional(),
    // Đường dẫn ảnh chụp phần tử (backend điền khi có ảnh), widget hiện trong popover lúc không chắc phần tử
    shot: z.string().optional(),
  })
  .refine((s) => Boolean(s.tourId || s.locator), { message: 'Bước tour cần tourId hoặc locator' });
export type TourStep = z.infer<typeof tourStepSchema>;

export const layoutSchema = z.enum(['mobile', 'desktop']);
export type Layout = z.infer<typeof layoutSchema>;

// Cùng một tour ghi riêng cho từng bố cục: bố cục mobile thường có thêm bước mở menu, phần tử khác chỗ.
// `steps` là bản chính; `variants` là bản cho bố cục khác. Widget chọn theo bề rộng màn hình, thiếu thì dùng `steps`.
const tourVariantsSchema = z.object({ mobile: z.array(tourStepSchema).min(1).optional(), desktop: z.array(tourStepSchema).min(1).optional() });

export const tourSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  // Màn hình bắt đầu luồng; engine điều hướng về đây trước bước đầu tiên
  startRoute: z.string(),
  steps: z.array(tourStepSchema).min(1),
  // Bố cục của `steps` (khi tour được ghi ở một bố cục cụ thể)
  layout: layoutSchema.optional(),
  variants: tourVariantsSchema.optional(),
});
export type Tour = z.infer<typeof tourSchema>;

// Tour lưu trong kho tour (compass.tours.db): dữ liệu nằm cạnh cấu hình, không sửa template.
// Scanner gộp vào Feature Map; bước dùng locator không cần tourId tồn tại trong HTML.
export const recordedTourSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  // Id tính năng đích (tour được đề xuất khi người dùng hỏi về tính năng này)
  feature: z.string().optional(),
  startRoute: z.string(),
  // Màn hình người ghi đứng lúc dừng (màn hình đích). Khi chưa có source, scanner lấy nó làm màn hình của tính năng đích.
  endRoute: z.string().optional(),
  // Nháp chưa duyệt: `scan --strict` báo lỗi tới khi người duyệt xóa cờ này
  draft: z.boolean().optional(),
  draftSource: z.enum(['llm', 'template']).optional(),
  recordedAt: z.string().optional(),
  // Lời người ghi mô tả tính năng, để người duyệt biết nội dung dựa vào đâu
  purpose: z.string().optional(),
  steps: z.array(tourStepSchema).min(1),
  layout: layoutSchema.optional(),
  variants: tourVariantsSchema.optional(),
});
export type RecordedTour = z.infer<typeof recordedTourSchema>;

export const toursFileSchema = z.object({
  tours: z.record(z.string(), recordedTourSchema).default({}),
});
export type ToursFile = z.infer<typeof toursFileSchema>;

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
  | 'cancelled'
  // Có ứng viên nhưng không đủ chắc phần tử nào: hiện bước dạng popover không gắn phần tử
  | 'low_confidence';

// ---------------------------------------------------------------------------
// 3.4 App config (compass.config.ts / compass.config.yaml)
// ---------------------------------------------------------------------------

export const compassConfigSchema = z.object({
  locale: z.string().default('vi'),
  // Địa chỉ backend để `doctor` kiểm tra kết nối (widget dùng apiBaseUrl trong provideCompass)
  backend: z.object({ url: z.string() }).optional(),
  // Địa chỉ web để ghi/kiểm tour (bắt buộc có ích khi chưa có source: Studio và tour:record lấy làm mặc định)
  web: z.object({ url: z.string() }).optional(),
  discovery: z.object({
    // angular: quét source Angular (route, menu, template). none: chưa có source, màn hình lấy từ tour đã ghi
    // và từ `features.<id>.route` trong overrides.
    source: z.enum(['angular', 'none']).default('angular'),
    // Thư mục source của web (đường dẫn tuyệt đối) khi dữ liệu nằm trong kho dự án ngoài source; bỏ trống = cùng thư mục với cấu hình
    sourceDir: z.string().optional(),
    // File route gốc; bắt buộc khi source là angular
    entry: z.string().optional(),
    menu: z.string().optional(),
    srcRoot: z.string().default('src'),
    overrides: z.string().default('compass.overrides.yaml'),
    // Kho tour (file SQLite): tour:record, Studio và backend cùng đọc/ghi file này; commit cùng dự án
    tours: z.string().default('compass.tours.db'),
    out: z.string().default('feature-map.json'),
  }),
  access: z
    .object({
      guards: z.record(z.string(), z.object({ requires: z.array(z.string()) })).default({}),
      // Danh mục quyền của hệ thống (trùng giá trị trong claim quyền của JWT) kèm mô tả, để chọn thay vì gõ tay
      roles: z.record(z.string(), z.object({ description: z.string().default('') })).default({}),
    })
    .default({ guards: {}, roles: {} }),
  safety: z
    .object({
      userOnly: z.array(z.string()).default([]),
      blockedRoutes: z.array(z.string()).default([]),
    })
    .default({ userOnly: [], blockedRoutes: [] }),
  // Bố cục và chờ tải khi ghi/chạy tour
  tours: z
    .object({
      // Dưới bề rộng này (px) là bố cục mobile; widget dùng cùng giá trị qua provideCompass({ tours })
      mobileBreakpoint: z.number().int().positive().default(768),
      // Phần tử "đang tải" của app; engine chờ chúng biến mất rồi mới tìm phần tử của bước
      busySelector: z.string().optional(),
    })
    .default({ mobileBreakpoint: 768 }),
});
export type CompassConfig = z.infer<typeof compassConfigSchema>;
