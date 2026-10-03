# Hướng dẫn tích hợp WealthCompass vào một web Angular

Tài liệu cho người đưa trợ lý vào một web Angular có sẵn. Mọi bước dưới đây đã chạy thật trên app demo ([demo.md](demo.md)); chỗ nào chưa hiện thực hoặc chưa kiểm thử thì ghi rõ ở mục "Giới hạn hiện tại".

## 0. Điều kiện

| Cần có | Chi tiết |
| --- | --- |
| Web Angular **20 trở lên** | Có source, sửa được (mức A). Đã kiểm thử trên Angular 22 standalone |
| Đăng nhập bằng **JWT** | Có JWKS URL công khai (RS256/ES256...), token có `iss`, `aud`, và claim chứa quyền (mặc định `roles`) |
| Một máy chạy backend | Node 22+; mạng ra được tới nhà cung cấp LLM (hoặc LLM on-prem tương thích OpenAI) |
| Trình duyệt người dùng gọi được backend | Cùng domain qua reverse proxy, hoặc CORS cho origin của web |

## 1. Tổng quan: ba mảnh phải nối với nhau

```
Source Angular ──scan──▶ feature-map.json ──nạp──▶ Backend (agent, tìm kiếm, JWT) ◀──SSE── Widget trong web
   (route, menu, tourId)   (+ compass.overrides.yaml)         ▲                          (bong bóng chat + tour)
                                                              └── xác minh token bằng JWKS của hệ thống đăng nhập
```

Thứ tự làm: (1) dựng backend, (2) chuẩn bị route/menu để scanner đọc, (3) gắn widget vào web, (4) gắn `tourId`, (5) quét và viết tour, (6) kiểm tra.

## 2. Bước 1: Chạy backend

Backend nằm ở `server/`. Cấu hình hoàn toàn bằng biến môi trường (mẫu: `server/.env.example`).

```bash
npm install
PORT=8890 \
COMPASS_MOCK_IDP=0 \
COMPASS_JWKS_URL=https://sso.congty.vn/.well-known/jwks.json \
COMPASS_JWT_ISSUER=https://sso.congty.vn \
COMPASS_JWT_AUDIENCE=web-dau-tu \
COMPASS_CAPABILITIES_CLAIM=roles \
COMPASS_ORIGINS=https://web.congty.vn \
COMPASS_FEATURE_MAP=/duong/dan/feature-map.json \
COMPASS_PACK=packs/finance-vn \
COMPASS_LLM_PROVIDER=deepseek COMPASS_LLM_API_KEY=... \
npm run server
```

| Biến | Ý nghĩa | Mặc định |
| --- | --- | --- |
| `COMPASS_MOCK_IDP` | `0` để tắt IdP giả lập (**bắt buộc tắt ngoài demo**) | `1` |
| `COMPASS_JWKS_URL`, `COMPASS_JWT_ISSUER`, `COMPASS_JWT_AUDIENCE` | Xác minh chữ ký, nhà phát hành, đối tượng của JWT | trỏ IdP giả lập |
| `COMPASS_CAPABILITIES_CLAIM` | Tên claim chứa quyền; chấp nhận mảng hoặc chuỗi cách nhau bằng dấu cách/phẩy | `roles` |
| `COMPASS_ORIGINS` | Origin được gọi (CORS), phân tách bằng dấu phẩy | `localhost:4200` |
| `COMPASS_FEATURE_MAP` | File Feature Map; tự nạp lại khi file đổi | file của demo |
| `COMPASS_PACK` | Thư mục Domain Pack | `packs/finance-vn` |
| `COMPASS_LLM_PROVIDER` | `deepseek` hoặc `gemini` (preset base URL + model + tên biến khóa) | `deepseek` |
| `COMPASS_LLM_BASE_URL`, `COMPASS_LLM_MODEL`, `COMPASS_LLM_API_KEY` | Ghi đè preset, dùng cho endpoint tương thích OpenAI bất kỳ (vLLM, Ollama on-prem...) | theo preset |
| `COMPASS_LLM_REASONING_EFFORT` | `low`/`high`/`max` cho mô hình suy luận, `low` nhanh hơn | không đặt |
| `COMPASS_RATE_MAX` | Số câu hỏi tối đa mỗi người trong 10 phút | `30` |

Khóa LLM tìm theo thứ tự: `COMPASS_LLM_API_KEY` → biến môi trường của preset (`DEEPSEEK_API_KEY`/`GOOGLE_API_KEY`) → đúng biến đó trong `COMPASS_ENV_FILE` (mặc định `~/tcbs-agent/.env`, chỉ đọc một biến, không nạp cả file). **Môi trường thật nên đặt `COMPASS_LLM_API_KEY` bằng secret của hệ thống, không dựa vào file `.env` của dự án khác.**

Kiểm tra: `GET /v1/health` trả `llmConfigured: true`, số `features` và `tours` đúng kỳ vọng.

**Đặt sau reverse proxy** (nginx/ingress): chat dùng SSE nên phải tắt buffering và nới timeout, nếu không chữ không hiện dần.

```nginx
location /v1/ {
  proxy_pass http://127.0.0.1:8890;
  proxy_http_version 1.1;
  proxy_buffering off;
  proxy_read_timeout 120s;
}
```

## 3. Bước 2: Chuẩn bị route, menu, guard để scanner đọc được

Scanner đọc source nên chất lượng câu trả lời phụ thuộc vào mức đủ của dữ liệu này.

**Route.** Mỗi màn hình nên có `data` (hoặc khai báo thay thế ở `compass.overrides.yaml`). Nếu để trống, scanner lấy `title` từ **nhãn menu**, còn `description`, `keywords`, `sampleQuestions` có thể nhờ LLM soạn nháp bằng lệnh `enrich` (mục 6.2b):

```ts
{
  path: 'assets',
  loadComponent: () => import('./assets.page').then((m) => m.AssetsPage),
  data: {
    title: 'Tài sản trái phiếu iConnect',                 // nên có; thiếu thì lấy nhãn menu
    description: 'Danh mục trái phiếu đang nắm giữ...',   // nên có; mô tả nghiệp vụ, không mô tả kỹ thuật (thiếu thì chạy enrich)
    keywords: ['ban trai phieu', 'danh muc'],            // cách người dùng hay gọi, có thể không dấu
    facets: { product: 'bond' },                          // tùy chọn, do Domain Pack định nghĩa
    // compassId: 'bond.assets',                          // tùy chọn: cố định id, không đổi khi đổi route
    // hidden: true,                                      // bỏ khỏi trợ lý (trang đăng nhập, trang lỗi...)
  },
}
```

**Menu.** Một mảng literal được export, mỗi phần tử có `label`, `route`, `children`. Scanner dùng nó để trả lời "nằm ở đâu trong menu" (`menuPath`). Nếu menu của web sinh động từ API thì khai báo tĩnh một bản cho scanner hoặc ghi `menuPath` qua overrides.

**Guard → quyền.** Scanner không hiểu guard làm gì, nên khai báo ánh xạ trong `compass.config.yaml`:

```yaml
access:
  guards:
    authGuard: { requires: [] }
    bondAccountGuard: { requires: [bond_account] }   # tên quyền phải trùng giá trị trong claim của JWT
```

Guard chưa ánh xạ sẽ báo cảnh báo và ghi vào `unknownGuards`.

## 4. Bước 3: Gắn widget vào web

### 4.1 Lấy gói

Các gói `@wealthcompass/*` **chưa publish lên npm** và chưa có schematic `ng add`. Có hai cách dùng:

- **Cùng monorepo/workspace:** đặt `packages/contracts`, `packages/core`, `packages/angular` cạnh web và khai báo npm workspaces (như repo này).
- **Copy và dùng tsconfig paths** (cách demo đang dùng), trong `tsconfig.json` của web:

```json
{
  "compilerOptions": {
    "paths": {
      "@wealthcompass/angular": ["../wealthcompass/packages/angular/src/index.ts"],
      "@wealthcompass/core": ["../wealthcompass/packages/core/src/index.ts"],
      "@wealthcompass/contracts": ["../wealthcompass/packages/contracts/src/index.ts"]
    }
  }
}
```

Cài thêm `driver.js` (`npm i driver.js`). Không có font hay icon phụ thuộc: widget dùng SVG nội bộ.

### 4.2 Style

Thêm vào mảng `styles` của project trong `angular.json`:

```json
"styles": [
  "driver.js/dist/driver.css",
  "../wealthcompass/packages/angular/src/compass-theme.scss",
  "src/styles.scss"
]
```

Đổi màu popover tour bằng cách ghi đè biến ở `:root`: `--compass-surface`, `--compass-text`, `--compass-text-muted`, `--compass-accent`, `--compass-accent-muted`.

### 4.3 Cấu hình provider (`app.config.ts`)

```ts
import { inject } from '@angular/core';
import { provideCompass } from '@wealthcompass/angular';

provideCompass(() => {
  const auth = inject(AuthService);            // service đăng nhập sẵn có của web
  return {
    apiBaseUrl: 'https://web.congty.vn',           // gốc của backend; widget gọi {apiBaseUrl}/v1/chat, /v1/tours/...
    getToken: () => auth.accessToken(),            // trả JWT hiện tại, hoặc null khi chưa đăng nhập
    getCapabilities: () => auth.roles(),           // chỉ để hiển thị/gợi ý; backend dùng quyền trong JWT
    title: 'WealthCompass',                        // tiêu đề khung chat
    subtitle: 'Tìm đúng tính năng, đi đúng từng bước',
    suggestions: ['Bán trái phiếu ở đâu?', 'Cách nộp tiền vào tài khoản?'],
    // Tùy chọn: siết thêm an toàn phía client (quy tắc nền không tắt được)
    safety: { userOnly: ['button.confirm-order'], blockedRoutes: ['/settings/security'] },
  };
}),
```

`getToken()` được gọi mỗi request, nên token làm mới tự động được dùng ngay. Backend **không tin** `getCapabilities`; quyền thật lấy từ JWT đã xác minh.

### 4.4 Đặt widget

Trong component gốc, chỉ hiện khi đã đăng nhập:

```ts
imports: [RouterOutlet, ChatWidgetComponent],
```
```html
<router-outlet />
@if (auth.user()) { <compass-chat-widget /> }
```

Mặc định bong bóng bám góc phải dưới cửa sổ (`right: 16px; bottom: 76px`, `z-index: 9000`). Chỉnh bằng biến CSS: `--compass-right`, `--compass-bottom`. Nếu web là một khung nội dung hẹp căn giữa (như khung điện thoại của demo) và bong bóng phải nằm trong khung, đặt `--compass-position: absolute` ở phần tử cha có `position: relative` và đặt `<compass-chat-widget />` bên trong phần tử đó.

**App còn dùng NgModule:** `provideCompass(...)` đặt vào `providers` của `AppModule`; `ChatWidgetComponent` và `TourIdDirective` là standalone nên thêm vào `imports` của module. Cách này **chưa được kiểm thử** (xem mục 9).

## 5. Bước 4: Gắn `tourId` vào template

`tourId` đánh dấu phần tử mà tour có thể trỏ tới. Chỉ cần gắn cho phần tử then chốt của luồng cần hướng dẫn (lối vào, tab, nút hành động chính).

```html
<a routerLink="/iconnect/price-board"
   tourId="home-shortcut-iconnect"
   tourLabel="Giao dịch iConnect"
   tourHint="Lối vào bảng giá và giao dịch trái phiếu">…</a>

<button tourId="assets-sell-button" tourRole="user-only" (click)="openTicket(h)">BÁN</button>
```

Quy tắc:

1. Import `TourIdDirective` vào component standalone chứa phần tử.
2. Viết **chuỗi tĩnh** (`tourId="x"` hoặc `[tourId]="'x'"`). Scanner chỉ đọc được literal; id sinh động (`[tourId]="item.id"`) không được quét và tour sẽ bị loại.
3. Id ổn định, dạng `màn-hình-phần-tử` (`assets-select-sell`). Đổi id là phá tour, nên coi như API công khai.
4. Nút **giao dịch, xác nhận, nhập mật khẩu/OTP** luôn gắn `tourRole="user-only"`: tour chỉ tô sáng và giải thích, không bao giờ click hay điền. Thêm vào đó engine còn tự coi `input[type=password]`, ô OTP, ô thẻ, `[data-sensitive]` là user-only.
5. Phần tử lặp trong danh sách có thể dùng chung một `tourId`; tour trỏ vào phần tử hiển thị đầu tiên.
6. Phần tử nằm trong khung chung (thanh tab dưới, header) nên gắn ở component khung; scanner tự gán nó cho mọi route con.

### 5.1 Gợi ý `tourId` hàng loạt bằng `annotate`

Gắn tay từng phần tử thì chậm, nên `annotate` quét template, gợi ý `tourId` cho phần tử tương tác còn thiếu và **xuất patch**. Nó **không bao giờ tự sửa code**.

```bash
cd ~/wealthcompass
npm run annotate                                   # toàn bộ màn hình; ghi compass-annotate.patch cạnh compass.config.yaml
npm run annotate -- --only /iconnect/assets,/home  # chỉ một vài màn hình (id tính năng hoặc tiền tố route)
npm run annotate -- --print                        # in patch ra màn hình, không ghi file
npm run annotate -- --out /tmp/x.patch --directive-import @cong-ty/compass
# web khác: npx tsx packages/cli/src/main.ts annotate --config duong/dan/compass.config.yaml
```

Nó làm gì:

1. **Liệt kê** nút, link, tab, ô nhập (và phần tử có `(click)`) chưa có `tourId`. Bỏ qua phần tử đã có `tourId`, phần tử ẩn (`hidden`), `input type="hidden"`, và khung bao ngoài chỉ để bắt click.
2. **Đặt tên** `<màn-hình>-<phần-tử>`: màn hình lấy từ đoạn cuối của route, phần tử lấy từ chữ trên nó (ưu tiên `aria-label`, rồi chữ bên trong không kể icon, rồi `placeholder`, `title`), bỏ dấu và viết thường: nút "Hủy lệnh" ở `/orders` thành `orders-huy-lenh`; ô nhập thêm hậu tố `-input`, tab thêm `-tab`. Trùng thì thêm `-2`, `-3`, và không bao giờ trùng với `tourId` đã có trong dự án. Thêm `tourLabel` từ chữ trên nút.
3. **Đánh dấu `tourRole="user-only"`** cho phần tử có vẻ nhạy cảm:
   - ⛔ *chắc chắn*: ô mật khẩu, ô OTP/PIN/CVV, ô thẻ, `type="submit"`, nút có chữ đúng là BÁN, MUA, Đặt lệnh, Xác nhận, Đồng ý, Thanh toán, Chuyển tiền, Rút tiền, Nộp tiền, Hủy lệnh, Xóa...
   - ⚠ *cần xem lại*: có từ liên quan trong chữ, tên hàm trong `(click)` hoặc class (ví dụ "Lệnh nhanh", `placeOrder()`, `class="btn-sell"`).
   - Link chuyển trang (`routerLink`, `href`) và ô nhập thông thường không bị đánh dấu.
4. **Thêm `TourIdDirective`** vào `imports` của component và câu `import` tương ứng (nếu không, thuộc tính `tourId` chỉ là thuộc tính HTML thường, không gắn `data-tour-id` và tour sẽ hỏng âm thầm). Component khai trong NgModule (`standalone: false`) hoặc có `imports` không phải mảng literal sẽ **bị bỏ qua kèm lý do**, bạn thêm tay.

Quy trình duyệt:

```bash
cd ~/wealthcompass                       # gốc repo git
git apply --check compass-annotate.patch # thử, chưa sửa gì
# mở patch (hoặc IDE) xem; xóa những hunk không cần; sửa tên nếu muốn
git apply compass-annotate.patch
npm run scan                             # xác nhận scanner thấy các tourId mới
```

- **Đọc kỹ cột user-only.** Gắn thừa thì tour không bấm thay được nút đó (chỉ tô sáng); thiếu ở nút giao dịch thì nguy hiểm hơn, nên heuristic nghiêng về gắn thừa. Nút "chọn bán" kiểu bật/tắt chế độ thường bị ⚠ nhưng có thể bỏ `tourRole` đi nếu muốn tour tự chờ người dùng bấm vào nó.
- **Chỉ giữ `tourId` của phần tử tour thật sự cần.** Danh sách gợi ý thường nhiều hơn mức cần (một web demo 13 màn hình ra khoảng 35 gợi ý); đặt tên và gắn thừa đều là việc phải duy trì về sau. Dùng `--only` theo luồng đang làm.
- Chạy lại `annotate` sau khi áp patch sẽ không còn gợi ý nào (đã có `tourId`).
- Template nằm trong `.ts` chỉ sửa được khi là chuỗi không có ký tự thoát (`\`) hay `${}`; trường hợp khác bị bỏ qua kèm lý do.

## 6. Bước 5: Quét và viết tour

### 6.1 Cấu hình quét

`compass.config.yaml` đặt cùng thư mục với `tsconfig.app.json` của web:

```yaml
domainPack: finance-vn
locale: vi
discovery:
  entry: src/app/app.routes.ts                 # file khai báo mảng Routes gốc
  menu: src/app/shared/menu.config.ts          # tùy chọn
  overrides: compass.overrides.yaml
  out: feature-map.json
access:
  guards:
    authGuard: { requires: [] }
```

An toàn phía client (selector `user-only` bổ sung, route tour không bao giờ được dẫn tới) khai trong `provideCompass({ safety: {...} })` ở bước 4.3, vì engine chạy trong trình duyệt. Mục `safety` trong file yaml của bản demo hiện chưa được dùng.

### 6.2 Viết tour và câu hỏi mẫu (`compass.overrides.yaml`)

```yaml
features:
  iconnect.assets:
    sampleQuestions: [bán trái phiếu ở đâu, cách bán lại trái phiếu trước hạn]
tours:
  sell-bond:
    title: Bán trái phiếu trên iConnect
    feature: iconnect.assets              # tính năng mà tour dẫn tới (id của Feature Map)
    startRoute: /home
    steps:
      - target: home-shortcut-iconnect    # tourId
        advanceOn: click                  # chờ người dùng tự bấm vào phần được tô sáng
        text: "Bấm **Giao dịch iConnect** để vào bảng giá."
      - target: assets-sell-button        # bước cuối: chỉ tô sáng, người dùng tự thao tác
        text: "Bấm **BÁN** ở dòng muốn bán. Bạn tự nhập và xác nhận lệnh."
```

- `advanceOn: click` (người dùng bấm vào phần tử được tô sáng) hoặc `next` (bấm nút "Tiếp" của popover). Phần tử `user-only` luôn dùng `next`.
- Route của từng bước tự suy ra từ template; tour chỉ điều hướng khi phần tử chưa hiện.
- `text` hỗ trợ `**đậm**`.

### 6.2a Ghi tour bằng `tour:record` (thay cho viết tay)

> Hướng dẫn đầy đủ (cờ, quy trình, checklist duyệt, xử lý sự cố): [tour-record.md](tour-record.md). Dưới đây là bản tóm tắt.

Thay vì tự gõ YAML, người vận hành thao tác thật trên web, công cụ ghi lại và nhờ LLM soạn chữ.

```bash
npm run tour:record -- --url http://localhost:4200 --id sell-bond-2 [--title "Bán trái phiếu"] [--feature iconnect.assets] [--about "Hướng dẫn khách bán trái phiếu"] [--dry-run] [--force] [--no-llm]
# hoặc: npx tsx packages/cli/src/main.ts tour:record --config <compass.config.yaml> --url ... --id ...
```

Cách dùng:

1. Chạy `scan` trước để có `feature-map.json` (công cụ lấy nhãn và tính năng đích từ đó).
2. Lệnh mở **Chrome đã cài trên máy** (không tải trình duyệt riêng; đặt `CHROME_PATH` nếu muốn bản khác) tới địa chỉ `--url`. Đăng nhập và đi tới màn hình xuất phát.
3. Gõ vào ô **"Bạn đang ghi tour cho tính năng gì?"** ở khung nhỏ góc trái dưới (hoặc truyền sẵn bằng `--about`), rồi bấm **● Bắt đầu ghi**. Mô tả này là nguồn đáng tin nhất cho LLM: tiêu đề, mô tả và câu hỏi mẫu phải bám theo nó, và nó thắng khi mâu thuẫn với nhãn kỹ thuật. Bỏ trống thì LLM phải đoán mục đích từ tên nút (dễ lệch); bấm Dừng khi chưa mô tả sẽ bị nhắc một lần. Màn hình lúc này là `startRoute` của tour.
4. Bấm lần lượt các phần tử theo đúng luồng muốn dẫn. Mỗi phần tử có `tourId` được ghi thành một bước. Nút **Tô sáng (không bấm)** để ghi một bước chỉ giải thích mà không để lần bấm chạy.
5. Bấm **■ Dừng & lưu** khi đang đứng ở **màn hình đích**: tính năng đích của tour được xác định theo màn hình lúc dừng (không theo màn hình lúc bấm bước cuối, vì bước cuối thường là bấm tab để chuyển sang đích). Công cụ soạn nội dung, ghi vào `compass.overrides.yaml`, rồi tự chạy lại scanner để xác nhận tour hợp lệ.

Quy tắc an toàn khi ghi:

- Phần tử `user-only` (nút BÁN, xác nhận, ô mật khẩu/OTP...) khi bị bấm trong lúc ghi **không được chạy thật**: lần bấm bị chặn và ghi thành bước tô sáng (`next`). Nhờ vậy ghi tour không vô tình đặt lệnh trên môi trường đang ghi.
- Chỉ ghi lần bấm. Chữ gõ vào ô nhập không được ghi.
- Lần bấm vào phần tử chưa có `tourId` bị bỏ qua và in cảnh báo kèm màn hình/thẻ; thêm `tourId` vào template rồi ghi lại nếu muốn có bước đó.

LLM chỉ **soạn nháp**:

- Đầu vào gửi LLM là nhãn và gợi ý tĩnh lấy từ template (`tourLabel`, `tourHint`), tiêu đề màn hình, kiểu bước. Chữ hiển thị trên trang (có thể chứa số dư, tên khách) chỉ dùng khi template chưa có nhãn, và đã qua lọc PII.
- Mô tả của người ghi cũng đi qua lọc PII, được lưu vào dòng chú thích `# Người ghi mô tả: ...` của tour để người duyệt biết LLM dựa vào đâu. Không có LLM thì dùng chính lời đó làm tiêu đề và mô tả.
- Đầu ra: tiêu đề, mô tả, chữ từng bước, 4-6 câu hỏi mẫu. Kiểm tra bằng schema, đúng số bước; sai thì thử lại một lần rồi dùng mẫu dựng sẵn. Không có khóa LLM hoặc dùng `--no-llm` cũng ra được tour (chữ theo mẫu).
- Ghi vào file bằng cách **giữ nguyên** chú thích và phần người viết tay. Tour mới có dòng `# DRAFT (LLM soạn ngày ...): cần người duyệt`. Tour trùng id không bị ghi đè nếu thiếu `--force`. Câu hỏi mẫu chỉ được thêm vào, không xóa, không trùng.
- `--dry-run` in kết quả ra màn hình mà không ghi file.

**Luôn đọc lại chữ trước khi commit.** Sau khi duyệt, xóa dòng `# DRAFT`.

### 6.2b Soạn mô tả màn hình bằng `enrich` (cho dự án có nhiều route)

`description`, `keywords` và `sampleQuestions` là thứ tìm kiếm dựa vào nhiều nhất. Dự án có hàng chục route thì gõ tay rất lâu, nên `enrich` nhờ LLM soạn **nháp** cho những màn hình còn trống.

```bash
cd ~/wealthcompass
npm run enrich -- --dry-run                 # xem LLM định viết gì, chưa ghi file
npm run enrich                              # ghi vào compass.overrides.yaml
npm run enrich -- --only iconnect.assets,money.deposit
# web khác: npx tsx packages/cli/src/main.ts enrich --config duong/dan/compass.config.yaml
```

Cách hoạt động:

1. Chạy `scan`, tìm các màn hình thiếu `description`, `keywords` hoặc `sampleQuestions`. Chỉ **điền chỗ trống**, không bao giờ đè thứ đã viết (trong `route.data` hay overrides).
2. Với mỗi màn hình, gửi LLM: tiêu đề, đường dẫn menu, nhóm sản phẩm, **chữ tĩnh trong template** (tiêu đề, nhãn, tên nút, placeholder; bỏ phần nội suy `{{ }}`), phần đã có, danh sách trường cần soạn, và từ điển thuật ngữ của Domain Pack nếu có. Không gửi dữ liệu hiển thị trên màn hình khi chạy; mọi chuỗi qua lọc PII cả chiều gửi và chiều nhận.
3. Gửi theo lô 6 màn hình mỗi lần. Kết quả được kiểm bằng schema; sai định dạng thì thử lại một lần rồi bỏ qua lô đó.
4. LLM được dặn: chỉ dùng thông tin trong đầu vào, không bịa tính năng; **nếu đầu vào quá ít thì trả mô tả rỗng**. Màn hình như vậy được báo "không đủ thông tin để soạn" và bỏ qua thay vì đoán.
5. Ghi vào `compass.overrides.yaml` (giữ nguyên chú thích và phần viết tay), kèm khóa `llmDraft` liệt kê các trường do LLM soạn:

```yaml
features:
  cards:
    # DRAFT (LLM soạn ngày 2026-10-03, bằng enrich): cần người duyệt, xóa khóa llmDraft sau khi đọc lại.
    description: Xem thông tin thẻ tín dụng, khóa/mở thẻ và xem sao kê thẻ.
    keywords: [thẻ tín dụng, khóa thẻ, khoa the, the tin dung]
    sampleQuestions: [khóa thẻ ở đâu, khoa the tin dung o dau]
    llmDraft: [description, keywords, sampleQuestions]
```

**Duyệt bắt buộc:** chừng nào còn khóa `llmDraft`, `scan` báo cảnh báo *"... do LLM soạn, chưa duyệt"* và `scan --strict` (CI) sẽ đỏ; Feature Map ghi `provenance.reviewed: false` và nguồn có `llm`. Đọc lại nội dung, sửa chỗ sai, rồi **xóa khóa `llmDraft` của màn hình đó** là xong.

Hạn chế: LLM chỉ thấy chữ trong template nên có thể hiểu lệch nghiệp vụ (ví dụ tab "Tài sản" là toàn tài khoản hay chỉ trái phiếu); component tải nội dung từ API hay dùng chữ sinh động sẽ ít thông tin hơn. Màn hình chỉ có nhãn ngắn thường cho mô tả nông; bổ sung tay những màn hình quan trọng.

### 6.3 Quét

```bash
npm run scan -- --config duong/dan/compass.config.yaml      # trong repo này: npm run scan
npx tsx packages/cli/src/main.ts scan --config ... --strict # trả mã lỗi 1 nếu còn cảnh báo (dùng trong CI)
```

Đọc báo cáo: số màn hình, % có tiêu đề, % có trên menu, số `tourId`, số tour hợp lệ, danh sách cảnh báo (thiếu `title`/`description`, route không có trên menu, guard chưa ánh xạ, tour tham chiếu `tourId` không tồn tại, route đổi tên). **Mục tiêu trước khi chạy thật: 100% có tiêu đề, 100% có trên menu, 0 cảnh báo.**

Kết quả là `feature-map.json` và `compass.lock.json` (giữ `id` ổn định khi đổi tên route). Commit cả hai. Backend tự nạp lại `feature-map.json` khi file đổi, nên đưa file lên máy chạy backend là đủ. **Đưa vào CI:** chạy `scan --strict` mỗi build, có thay đổi thì triển khai file mới cùng bản web.

## 7. Domain Pack (nội dung theo ngành)

`COMPASS_PACK` trỏ tới một thư mục:

| File | Nội dung |
| --- | --- |
| `pack.yaml` | Tên, phiên bản, locale |
| `glossary.yaml` | Nhóm từ đồng nghĩa (CCQ = chứng chỉ quỹ...), dùng mở rộng câu hỏi khi tìm |
| `topics.yaml` | Mẫu regex (trên văn bản không dấu) cho chủ đề bị chặn **trước khi gọi LLM** |
| `refusals.vi.md` | Câu từ chối cho từng chủ đề bị chặn, do pháp chế duyệt |
| `prompt.vi.md` | System prompt của agent |

Web ngành khác: sao chép `packs/finance-vn`, sửa từ điển, chủ đề chặn, mẫu từ chối và prompt. Sau khi sửa luôn chạy lại `npm run test` và thử tay vài câu hỏi để chắc mẫu chặn không chặn nhầm câu hỏi "ở đâu/làm sao" bình thường.

## 8. Kiểm tra sau khi tích hợp

- [ ] `GET /v1/health` đúng provider/model, `llmConfigured: true`, số `features`/`tours` đúng.
- [ ] Đăng nhập bằng token thật: gọi `POST /v1/chat` không token trả 401; token sai chữ ký hoặc sai `aud` trả 401.
- [ ] Hỏi 5 câu thật về tính năng: trả lời đúng đường đi, không bịa tên menu.
- [ ] Bấm nút "Dẫn tôi đi": tour chạy hết các bước, bước cuối chỉ tô sáng nút nhạy cảm.
- [ ] Tài khoản thiếu quyền: hỏi tính năng bị khóa nhận câu giải thích thiếu quyền; `GET /v1/tours/<id>` trả 403.
- [ ] "Có nên mua mã X không?" bị từ chối bằng mẫu đã duyệt, log không có lượt gọi LLM.
- [ ] Gửi câu chứa số điện thoại/số tài khoản: log chỉ thấy bản đã che (`[sdt]`, `[so-tai-khoan]`).
- [ ] Tắt LLM (sai khóa): vẫn trả lời ở chế độ dự phòng, có ghi chú rõ.
- [ ] Mở trên điện thoại và máy tính; widget không che nút quan trọng của web.

## 9. Giới hạn hiện tại của scanner và widget

Đã kiểm thử: standalone, `provideRouter`, `loadComponent`, `loadChildren` (file route export mảng), `children`, guard kế thừa từ route cha, `templateUrl` và `template`, component con khai trong `imports` của component cha, `@if/@for`.

Chưa hỗ trợ hoặc chưa kiểm thử:

- Route khai bằng **spread** (`...adminRoutes`) hoặc sinh từ hàm: scanner ghi cảnh báo và bỏ qua phần đó. Đường dẫn không phải chuỗi literal (hằng số `ROUTE_PATHS.x`) cũng bị bỏ qua kèm cảnh báo.
- **NgModule**: chưa kiểm thử. Component con khai trong `declarations` (không phải `imports`) không được lần theo, nên `tourId` trong đó không được quét; chỉ `tourId` nằm trong template của chính component được route tới là chắc chắn thấy.
- Route theo **tham số** (`:id`): đưa vào Feature Map nhưng agent không tạo nút mở thẳng (thiếu giá trị tham số); `exampleParams` chưa dùng.
- `tourId` sinh động, phần tử trong iframe khác origin hoặc shadow DOM đóng: không hỗ trợ.
- `tour:record` chỉ ghi lần bấm (chưa ghi hover, kéo thả, nhập liệu) và cần Chrome cài trên máy; chưa lưu trạng thái tour khi tải lại trang.
- Widget nạp từ source (chưa build thư viện ng-packagr, chưa có `ng add`); chưa có đóng gói npm.
- Backend: Feature Map nạp từ file (chưa có API publish và index theo phiên bản); tìm kiếm là từ khóa + đồng nghĩa (chưa có embedding); rate limit và log trong bộ nhớ/stdout.

## 10. Xử lý sự cố

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
| --- | --- | --- |
| Chat báo "Phiên đăng nhập hết hạn" ngay | JWT sai `iss`/`aud`, hết hạn, hoặc JWKS URL backend không truy cập được | Giải mã JWT kiểm `iss`/`aud`; `curl` thử JWKS URL từ máy backend |
| Lỗi CORS trong console | Origin của web chưa có trong `COMPASS_ORIGINS` | Thêm đúng origin (gồm cổng) |
| Chữ hiện một cục sau vài giây | Reverse proxy buffer SSE | `proxy_buffering off` (mục 2) |
| Luôn trả lời "chế độ dự phòng" | LLM lỗi: hết hạn mức (402), sai khóa (401), sai tên model (404) | Xem log server (`chat_error` có mã lỗi); đổi khóa/model |
| Hỏi bán trái phiếu mà bị chỉ tới màn hình khác | Thiếu `keywords`/`description`/`sampleQuestions` cho màn hình đúng | Bổ sung ở `route.data` hoặc overrides, hoặc chạy `enrich` rồi duyệt; quét lại |
| `scan --strict` đỏ: "do LLM soạn, chưa duyệt" | Có khóa `llmDraft` trong overrides sau khi chạy `enrich` | Đọc lại nội dung rồi xóa khóa `llmDraft` của màn hình đó |
| `enrich`: "LLM không đủ thông tin để soạn" | Màn hình hầu như không có chữ tĩnh để dựa vào | Viết tay `description` trong `route.data` hoặc overrides |
| Gắn `tourId` mà tour vẫn không tìm thấy phần tử, DOM không có `data-tour-id` | Component chưa import `TourIdDirective` (thuộc tính thành HTML thường). `annotate` tự thêm; gắn tay thì phải thêm vào `imports` |
| Tour báo "không tìm thấy phần tử" | `tourId` bị xóa/đổi, hoặc phần tử chỉ hiện sau một thao tác | Thêm bước `advanceOn: click` trước đó; chạy `scan --strict` trong CI để bắt sớm |
| Tour bị loại khỏi Feature Map | Bước tham chiếu `tourId` không có trong template (hoặc là chuỗi động) | Xem cảnh báo "Tour ... bị loại" khi quét |
| Câu hỏi "ở đâu" bị từ chối như tư vấn | Mẫu trong `topics.yaml` quá rộng | Thu hẹp regex, thêm test |
| Popover tour không có màu/kiểu | Chưa thêm `driver.css` hoặc `compass-theme.scss` vào `styles` | Mục 4.2 |
