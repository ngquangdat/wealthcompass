# Gắn WealthCompass vào một web Angular trong 3 bước

Điều kiện: web Angular **20 trở lên**, có source và sửa được, đăng nhập bằng **JWT**. Đã chạy thật trên hai web khác ngành: web đầu tư mô phỏng TCInvest (`examples/iconnect-demo`) và cổng nhân sự tạo mới từ `ng new` (`examples/hr-portal`).

```bash
# 1. Đóng gói (một lần, trong repo WealthCompass)
cd ~/wealthcompass && npm install && npm run pack

# 2. Setup: dò dự án, sinh cấu hình, AI soạn nháp, xuất MỘT patch (không sửa code)
npm run setup -- --app ~/du-an/my-web

# 3. Duyệt, áp, chạy
cd ~/du-an/my-web
cat WEALTHCOMPASS_SETUP.md                 # báo cáo: đã dò được gì, cần bạn xem gì
git apply wealthcompass-setup.patch && npm install
npx wealthcompass-server --env-file wealthcompass.env &
npm start
npx wealthcompass doctor --app .           # kiểm tra mọi thứ đã nối đúng
```

## Bước 1: đóng gói

`npm run pack` build các gói thành file `.tgz` trong `dist/tarballs/`, cài được như gói npm thường:

| Gói | Vai trò | Cài vào web như |
| --- | --- | --- |
| `@wealthcompass/angular` | Widget chat, `[tourId]`, tour (biên dịch partial, chạy Angular 20-23) | `dependencies` |
| `@wealthcompass/core`, `@wealthcompass/contracts` | Logic dùng chung, kiểu dữ liệu | `dependencies` |
| `@wealthcompass/cli` | Lệnh `wealthcompass` (setup, scan, enrich, annotate, tour:record, doctor) | `devDependencies` |
| `@wealthcompass/server` | Backend `wealthcompass-server` (kèm Domain Pack `generic`, `finance-vn`) | `devDependencies` để thử local; chạy thật thì triển khai riêng |

Không publish đi đâu. Muốn đưa lên registry nội bộ thì `npm publish dist/build/<gói>` là việc làm riêng, có chủ đích.

## Bước 2: `setup`

```bash
npm run setup -- --app <thư mục web> [tùy chọn]
```

| Tùy chọn | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `--pack generic\|finance-vn` | `generic` | Domain Pack (từ điển, chủ đề bị chặn, prompt). Web đầu tư dùng `finance-vn` |
| `--backend-url <url>` | `http://localhost:8890` | Địa chỉ backend ghi vào `provideCompass` và `wealthcompass.env` |
| `--tarballs <thư mục>` / `--registry` | `dist/tarballs` của repo | Cài gói từ file `.tgz`, hoặc theo phiên bản từ registry |
| `--annotate all\|/route1,/route2` | tắt | Gộp luôn gợi ý `tourId` (xem [integration-guide.md](integration-guide.md) mục 5.1) vào patch |
| `--ai-code` | **tắt** | Cho AI đọc trích đoạn code service đăng nhập và guard khi phân tích tĩnh không đoán được |
| `--no-llm` | (có LLM nếu có khóa) | Không gọi LLM chút nào |
| `--force` | | Tạo lại `compass.config.yaml`, `wealthcompass.env` |
| `--project <tên>` | app đầu tiên | Chọn app khi `angular.json` có nhiều app |

Sáu việc `setup` làm, theo thứ tự:

1. **Dò dự án (tĩnh, không AI):** app trong `angular.json`, phiên bản Angular, cổng dev; file route (theo `provideRouter(...)` / `RouterModule.forRoot(...)`); file menu (mảng literal giống menu nhất, hiểu các khóa `label/title/name`, `route/path/link/url/routerLink`, `children/items/submenu`); cách khởi động (standalone hay NgModule) và component gốc; service đăng nhập (tên `@Injectable` có `token`/`getAccessToken`/`jwt`..., và `roles`/`permissions`).
2. **Sinh `compass.config.yaml`** và `compass.overrides.yaml` (file của WealthCompass, không phải code của web).
3. **Quét route và ánh xạ guard → quyền:** đọc chuỗi quyền trong code guard (`hasRole('manager')`, `.includes('x')`); guard tên kiểu `authGuard` coi là chỉ kiểm đăng nhập; còn lại đoán từ tên và **ghi `# DRAFT ... kiểm tra lại`** ngay cạnh dòng đó.
4. **AI soạn nháp** `description`/`keywords`/`sampleQuestions` cho màn hình còn trống, từ chữ tĩnh trên giao diện (như `enrich`), đánh dấu `llmDraft`.
5. **Dựng một patch** gồm: gói trong `package.json`, style trong `angular.json`, `provideCompass(...)` với `getToken`/`getCapabilities` nối vào service đăng nhập đã dò, câu gợi ý của widget lấy từ câu hỏi mẫu vừa soạn, `ChatWidgetComponent` và thẻ `<compass-chat-widget />` ở component gốc (và gợi ý `tourId` nếu `--annotate`).
6. **Viết `wealthcompass.env`** cho backend và báo cáo **`WEALTHCOMPASS_SETUP.md`**.

Chạy lại `setup` sau khi đã áp patch thì không còn gì để sửa (chỉ thêm, không lặp).

## Bước 3: duyệt, áp, chạy

Đọc mục **"Cần bạn xem"** trong `WEALTHCOMPASS_SETUP.md`. Với web HR mẫu, danh sách là:

- Quyền của `payrollGuard` (đoán từ tên là `payroll`; thật ra guard nhận mọi quyền bắt đầu bằng `payroll`, tài khoản thật có `payroll_viewer`). **Nếu không sửa, trợ lý sẽ báo người dùng không có quyền xem phiếu lương dù họ có.** Đây là lý do mọi thứ đoán được đều phải qua người duyệt.
- 7 màn hình AI soạn mô tả: đọc lại, sửa, xóa khóa `llmDraft`.
- `provideCompass` lấy token từ `auth.getAccessToken()`, quyền từ `auth.roles()`: kiểm tra đúng chưa.
- JWKS/issuer/audience của hệ thống đăng nhập trong `wealthcompass.env` (khi thử có thể để IdP giả lập).

Sau đó `git apply`, `npm install`, chạy backend và web, rồi `npx wealthcompass doctor --app .` để kiểm tra: gói đã cài, style, provider, `getToken` không còn là TODO, widget, `TourIdDirective` có mặt nơi có `tourId`, backend chạy và cùng số màn hình, LLM của backend, CORS cho cổng dev.

## AI làm gì, không làm gì

| | Mặc định | Với `--ai-code` | Không bao giờ |
| --- | --- | --- | --- |
| Gửi cho LLM | Chữ tĩnh trên giao diện (tiêu đề, nhãn, nút), tiêu đề/menu màn hình; đã lọc PII | Thêm trích đoạn code service đăng nhập và guard (đã lọc PII), chỉ khi phân tích tĩnh không đoán được | Dữ liệu người dùng, dữ liệu chạy của web |
| Kết quả AI | Bản nháp đánh dấu `llmDraft`, câu gợi ý của widget | Tên thành viên token/quyền (biểu thức cuối cùng vẫn do code dựng và chỉ nhận thành viên có thật), quyền của guard | Tự sửa code, tự áp patch |

`--ai-code` tắt mặc định vì nó gửi **mã nguồn** của web sang nhà cung cấp LLM: hãy kiểm tra chính sách của công ty trước khi bật.

## Sau setup (tùy chọn)

- Gắn `tourId` hàng loạt: `npx wealthcompass annotate --config compass.config.yaml --only /route` ([integration-guide.md](integration-guide.md) mục 5.1).
- Ghi tour bằng thao tác thật: `npx wealthcompass tour:record --config compass.config.yaml --url http://localhost:4200 --id ten-tour` ([tour-record.md](tour-record.md)).

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
