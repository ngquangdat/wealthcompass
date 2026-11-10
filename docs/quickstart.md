# Gắn WealthCompass vào một web Angular

## Quy trình

Ba phần tách rời, nối với nhau bằng **một kho dự án**: một file SQLite cho mỗi web, nằm ngoài source (`~/.wealthcompass/projects/<tên web>-<mã>.db`). Kho chứa mọi dữ liệu của WealthCompass cho web đó: cấu hình, mô tả màn hình, bản đồ tính năng, tour, bộ câu kiểm thử, cấu hình backend. **Source của web không có file nào của WealthCompass**, chỉ có lib, `provideCompass` và thẻ widget.

| Bước | Làm ở đâu | Việc |
| --- | --- | --- |
| 1. Cài lib vào source web | Dòng lệnh, **một lần** | `wealthcompass setup` đọc source, ghi dữ liệu vào kho dự án và sinh một patch gắn lib giao diện (`@wealthcompass/angular`), provider, widget; bạn duyệt rồi `git apply` và `npm install`. Web **không** cài backend hay CLI |
| 2. Chạy backend | Dòng lệnh, **tiến trình riêng** | Backend chạy độc lập với Studio, chỉ cần biết file kho: `COMPASS_PROJECT=<file kho>` |
| 3. Soạn và ghi tour | Studio | Studio đọc source của web và ghi vào cùng kho đó; backend đang chạy dùng ngay, không cần khởi động lại |

```bash
# 1. Cài lib vào source web (một lần)
cd ~/wealthcompass && npm install && npm run pack
npm run setup -- --app ~/du-an/my-web          # in ra đường dẫn kho dự án
cd ~/du-an/my-web && git apply wealthcompass-setup.patch && npm install

# 2. Backend: tiến trình riêng, không do Studio bật và không cài trong web
cd ~/wealthcompass && COMPASS_PROJECT=~/du-an/my-web npm run server     # nhận thư mục web hoặc file kho .db

# 3. Studio: soạn dữ liệu, ghi và kiểm tour
cd ~/wealthcompass && npm run studio -- --app ~/du-an/my-web
```

- **Kho dự án ở đâu:** `~/.wealthcompass/projects/`, đổi thư mục gốc bằng `COMPASS_HOME`. Tên file suy từ đường dẫn source nên mọi lệnh chỉ cần `--app <thư mục web>`. Studio hiện đường dẫn kho ở trang Tổng quan và liệt kê các kho đã có ở trang Mở dự án.
- **Không còn trong git của web:** dữ liệu nằm ngoài source nên không được git của web theo dõi. Sao lưu hoặc chuyển máy bằng cách chép file `.db`; máy chủ thật thì chép file kho sang và trỏ `COMPASS_PROJECT` vào đó.
- **Dự án kiểu cũ** (còn `compass.config.yaml`, `feature-map.json`... cạnh source) vẫn chạy như trước. Chuyển vào kho: `wealthcompass migrate --app <thư mục web>` (chuyển xong xóa các file đó khỏi source).
- **Xác thực:** mặc định backend tin API gateway đứng trước nó đã xác minh JWT (`COMPASS_AUTH=gateway`), không cần JWKS; backend chỉ được nhận yêu cầu qua gateway. Không có gateway thì đặt `COMPASS_AUTH=jwks` và khai JWKS.
- Studio **không bật, không tắt backend**. Trang Chạy thử chỉ cho biết backend có đang chạy không, in sẵn lệnh chạy, và báo backend có đọc đúng kho của dự án không. Tắt Studio không ảnh hưởng backend.
- Trang Thử trợ lý, Kiểm thử, Nhật ký của Studio cần backend chạy thêm `COMPASS_DEBUG=1` và `COMPASS_LOG_FILE=...` (lệnh đầy đủ có ở trang Chạy thử). Không bật `COMPASS_DEBUG` trên máy chủ thật.
- **Sửa tay, sao lưu, đưa vào git:** `wealthcompass project:export --app <thư mục web>` xuất cả kho ra thư mục file văn bản (`compass.config.yaml`, `compass.overrides.yaml`, `feature-map.json`, `tours.json`...), mặc định là `<thư mục web>.compass` nằm **cạnh** (không nằm trong) source. Sửa xong nhập lại bằng `wealthcompass project:import --app <thư mục web>`.
- **Bản mẫu đi kèm web:** nếu cạnh thư mục web có `<thư mục web>.compass` mà máy chưa có kho cho web đó, kho được dựng tự động từ thư mục này ở lần chạy đầu. Web demo của repo dùng cách này: `examples/iconnect-demo.compass` được commit, nên clone về là `npm run scan`, `npm run server`, `npm run studio -- --app examples/iconnect-demo` chạy được ngay. Sau khi sửa dữ liệu demo trong Studio, chạy `npx tsx packages/cli/src/main.ts project:export --app examples/iconnect-demo` rồi commit thư mục bản mẫu.

**Chưa có source của web** (chỉ có địa chỉ, vd. bản staging): tạo một kho dự án rồi mở bằng Studio. Màn hình được dựng từ chính các tour đã ghi; khi có source thì chạy `setup`.

```bash
npx tsx packages/cli/src/main.ts init --url https://staging.example.vn      # tạo ~/.wealthcompass/projects/staging.example.vn.db
npm run studio -- --app ~/.wealthcompass/projects/staging.example.vn.db
```

## Bước 1: đóng gói

`npm run pack` build các gói thành file `.tgz` trong `dist/tarballs/`, cài được như gói npm thường:

| Gói | Vai trò | Cài vào web như |
| --- | --- | --- |
| `@wealthcompass/angular` | Widget chat, `[tourId]`, tour (biên dịch partial, chạy Angular 20-23) | `dependencies` |
| `@wealthcompass/core`, `@wealthcompass/contracts` | Logic dùng chung, kiểu dữ liệu | `dependencies` |
| `@wealthcompass/cli` | Lệnh `wealthcompass` (setup, scan, enrich, tour:record, doctor, studio) | **Không cài vào web**: chạy từ repo WealthCompass hoặc cài riêng |
| `@wealthcompass/server` | Backend `wealthcompass-server` | **Không cài vào web**: tiến trình riêng |

Không publish đi đâu. Muốn đưa lên registry nội bộ thì `npm publish dist/build/<gói>` là việc làm riêng, có chủ đích.

## Bước 2: `setup`

```bash
npm run setup -- --app <thư mục web> [tùy chọn]
```

| Tùy chọn | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `--backend-url <url>` | `http://localhost:8890` | Địa chỉ backend ghi vào `provideCompass` và `wealthcompass.env` |
| `--tarballs <thư mục>` / `--registry` | `dist/tarballs` của repo | Cài gói từ file `.tgz`, hoặc theo phiên bản từ registry |
| `--ai-code` | **tắt** | Cho AI đọc trích đoạn code service đăng nhập và guard khi phân tích tĩnh không đoán được |
| `--no-llm` | (có LLM nếu có khóa) | Không gọi LLM chút nào |
| `--force` | | Tạo lại cấu hình và cấu hình backend trong kho dự án |
| `--project <tên>` | app đầu tiên | Chọn app khi `angular.json` có nhiều app |

Sáu việc `setup` làm, theo thứ tự:

1. **Dò dự án (tĩnh, không AI):** app trong `angular.json`, phiên bản Angular, cổng dev; file route (theo `provideRouter(...)` / `RouterModule.forRoot(...)`); file menu (mảng literal giống menu nhất, hiểu các khóa `label/title/name`, `route/path/link/url/routerLink`, `children/items/submenu`); cách khởi động (standalone hay NgModule) và component gốc; service đăng nhập (tên `@Injectable` có `token`/`getAccessToken`/`jwt`..., và `roles`/`permissions`).
2. **Sinh cấu hình** (`compass.config.yaml`) và `compass.overrides.yaml` dưới dạng tài liệu trong kho dự án, không ghi vào source của web.
3. **Quét route.** Quyền mặc định là chỉ cần đăng nhập: `setup` không ghi quyền nào vào cấu hình. Chuỗi quyền thấy trong code guard (`hasRole('manager')`, `.includes('x')`) được nêu trong báo cáo làm gợi ý, chưa áp.
4. **AI soạn nháp** `description`/`keywords`/`sampleQuestions` cho màn hình còn trống, từ chữ tĩnh trên giao diện (như `enrich`), đánh dấu `llmDraft`.
5. **Dựng một patch** gồm: gói trong `package.json`, style trong `angular.json`, `provideCompass(...)` với `getToken`/`getCapabilities` nối vào service đăng nhập đã dò, câu gợi ý của widget lấy từ câu hỏi mẫu vừa soạn, `ChatWidgetComponent` và thẻ `<compass-chat-widget />` ở component gốc.
6. **Viết `wealthcompass.env`** cho backend và báo cáo **`WEALTHCOMPASS_SETUP.md`**.

Chạy lại `setup` sau khi đã áp patch thì không còn gì để sửa (chỉ thêm, không lặp).

## Bước 3: duyệt, áp, chạy

Đọc mục **"Cần bạn xem"** trong `WEALTHCOMPASS_SETUP.md`. Với web HR mẫu, danh sách là:

- 7 màn hình AI soạn mô tả: đọc lại, sửa, xóa khóa `llmDraft`.
- `provideCompass` lấy token từ `auth.getAccessToken()`, quyền từ `auth.roles()`: kiểm tra đúng chưa.
- JWKS/issuer/audience của hệ thống đăng nhập trong `wealthcompass.env` (khi thử có thể để IdP giả lập).

Sau đó `git apply`, `npm install`, chạy backend và web, rồi `npx wealthcompass doctor --app .` để kiểm tra: gói đã cài, style, provider, `getToken` không còn là TODO, widget, `TourIdDirective` có mặt nơi có `tourId`, backend chạy và cùng số màn hình, LLM của backend, CORS cho cổng dev.

## Cấu hình AI cho `setup`

AI trong `setup` (và `enrich`, `tour:record`) do **chính lệnh CLI gọi thẳng tới nhà cung cấp LLM** từ máy đang chạy lệnh, không đi qua backend. Cấu hình bằng biến môi trường của terminal chạy lệnh; `wealthcompass.env` chỉ dành cho backend, CLI không đọc file đó.

```bash
COMPASS_LLM_API_KEY=... npm run setup -- --app ~/du-an/my-web          # DeepSeek (mặc định)
COMPASS_LLM_PROVIDER=gemini GOOGLE_API_KEY=... npm run setup -- --app ...
export COMPASS_ENV_FILE=~/du-an-khac/.env                               # dùng chung khóa trong file .env có sẵn (chỉ đọc đúng một biến)
```

Thứ tự tìm khóa: `COMPASS_LLM_API_KEY` → `DEEPSEEK_API_KEY` (hoặc `GOOGLE_API_KEY` khi `COMPASS_LLM_PROVIDER=gemini`) → đúng biến đó trong file `COMPASS_ENV_FILE` nếu có đặt. Không có khóa thì `setup` vẫn chạy, chỉ bỏ bước AI soạn nháp. `COMPASS_LLM_MODEL`, `COMPASS_LLM_BASE_URL` để dùng model hoặc LLM on-prem tương thích OpenAI.

## AI làm gì, không làm gì

| | Mặc định | Với `--ai-code` | Không bao giờ |
| --- | --- | --- | --- |
| Gửi cho LLM | Chữ tĩnh trên giao diện (tiêu đề, nhãn, nút), tiêu đề/menu màn hình; đã lọc PII | Thêm trích đoạn code service đăng nhập và guard (đã lọc PII), chỉ khi phân tích tĩnh không đoán được | Dữ liệu người dùng, dữ liệu chạy của web |
| Kết quả AI | Bản nháp đánh dấu `llmDraft`, câu gợi ý của widget | Tên thành viên token/quyền (biểu thức cuối cùng vẫn do code dựng và chỉ nhận thành viên có thật), quyền của guard | Tự sửa code, tự áp patch |

`--ai-code` tắt mặc định vì nó gửi **mã nguồn** của web sang nhà cung cấp LLM: hãy kiểm tra chính sách của công ty trước khi bật.

## Sau setup (tùy chọn)

- `tourId`: dev tự gắn trong source khi cần ghim phần tử ([integration-guide.md](integration-guide.md) mục 5); tour ghi bằng `tour:record` không cần.
- Ghi tour bằng thao tác thật: `wealthcompass tour:record --app <thư mục web> --url http://localhost:4200 --id ten-tour` ([tour-record.md](tour-record.md)).

## Thử toàn bộ quy trình bằng một lệnh

```bash
cd ~/wealthcompass
npm run e2e:setup              # có LLM nếu có khóa
npm run e2e:setup -- --no-llm  # không gọi LLM
npm run e2e:setup -- --keep    # giữ thư mục và để backend chạy để mở thử
```

Script đóng gói, copy `examples/hr-portal` sạch vào thư mục tạm (repo git riêng), chạy `setup`, kiểm tra code chưa bị sửa, `git apply`, `npm install`, build, chạy backend từ gói đã cài rồi `doctor`. Lỗi ở bước nào thì dừng ở bước đó.

## Lưu ý

- **Đóng gói lại cùng phiên bản** rồi cài vào web đã cài trước đó: npm dùng bản trong cache theo `package-lock.json`. Tăng phiên bản (`COMPASS_VERSION=0.1.1 npm run pack` rồi chạy lại `setup`), hoặc xóa các mục `@wealthcompass/*` trong `package-lock.json` trước khi `npm install`.
- `angular.json` có chú thích thì `setup` không tự sửa style (báo trong "Cần bạn xem").
- Route khai trực tiếp trong `provideRouter([...])` (không qua biến) thì scanner không đọc được; `setup` báo cách sửa.
- Màn hình đăng nhập thường không có trong menu nên scanner còn 1 cảnh báo; có thể ẩn bằng `features.login.hidden: true` trong overrides.
