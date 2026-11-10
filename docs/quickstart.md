# Gắn WealthCompass vào một web Angular

## Quy trình

Ba phần tách rời, nối với nhau bằng **một kho tour** (`compass.tours.db` trong thư mục web):

| Bước | Làm ở đâu | Việc |
| --- | --- | --- |
| 1. Cài lib vào source web | Dòng lệnh, **một lần** | `wealthcompass setup` sinh patch gắn lib giao diện (`@wealthcompass/angular`), provider, widget; bạn duyệt rồi `git apply` và `npm install`. Web **không** cài backend hay CLI |
| 2. Chạy backend | Dòng lệnh, **tiến trình riêng** | Backend chạy độc lập với Studio (trên máy dev hoặc máy chủ), đọc `feature-map.json` và kho tour của web |
| 3. Soạn và ghi tour | Studio | Studio ghi tour vào cùng kho tour đó; backend đang chạy dùng ngay, không cần khởi động lại |

```bash
# 1. Cài lib vào source web (một lần)
cd ~/wealthcompass && npm install && npm run pack
npm run setup -- --app ~/du-an/my-web
cd ~/du-an/my-web && git apply wealthcompass-setup.patch && npm install

# 2. Backend: tiến trình riêng, không do Studio bật và không cài trong web
cd ~/wealthcompass && npm run server -- --env-file ~/du-an/my-web/wealthcompass.env

# 3. Studio: soạn dữ liệu, ghi và kiểm tour
cd ~/wealthcompass && npm run studio -- --app ~/du-an/my-web
```

- **Xác thực:** mặc định backend tin API gateway đứng trước nó đã xác minh JWT (`COMPASS_AUTH=gateway`), không cần JWKS; backend chỉ được nhận yêu cầu qua gateway. Không có gateway thì đặt `COMPASS_AUTH=jwks` và khai JWKS.
- Studio **không bật, không tắt backend**. Trang Chạy thử chỉ cho biết backend có đang chạy không, in sẵn lệnh chạy, và báo backend có đọc đúng kho tour của dự án không.
- Backend tìm kho tour ở `compass.tours.db` cạnh `feature-map.json` (`COMPASS_FEATURE_MAP`); đổi bằng `COMPASS_TOUR_DB`. Tắt Studio không ảnh hưởng backend.
- Trang Thử trợ lý, Kiểm thử, Nhật ký của Studio cần backend chạy thêm `COMPASS_DEBUG=1` và `COMPASS_LOG_FILE=...` (lệnh đầy đủ có ở trang Chạy thử). Không bật `COMPASS_DEBUG` trên máy chủ thật.
- Web demo trong repo này: backend chạy bằng `npm run server` (đọc sẵn feature map và kho tour của `examples/iconnect-demo`).

**Chưa có source của web** (chỉ có địa chỉ, vd. bản staging): tạo một dự án tour rồi mở bằng Studio. Màn hình được dựng từ chính các tour đã ghi; khi có source thì chạy `setup` và chép `compass.tours.db`, `compass.overrides.yaml` sang.

```bash
npx tsx packages/cli/src/main.ts init --url https://staging.example.vn --dir ~/tours/my-web
npm run studio -- --app ~/tours/my-web
```

Web đã cài gói `@wealthcompass/cli` thì mở bằng `npx wealthcompass studio` ngay trong thư mục web.

Studio chạy trên máy của bạn (chỉ nghe `127.0.0.1`, không cần token; trang web khác trong trình duyệt không gọi được API của Studio, nhưng chương trình khác trên cùng máy thì gọi được) và làm mọi bước bằng chuột:

| Trang | Làm gì |
| --- | --- |
| **Mở dự án** | Duyệt thư mục; thư mục là web Angular, hoặc dự án tour chưa có source (tạo bằng `init`), được đánh dấu |
| **Tổng quan** | Số màn hình, số nội dung AI chờ duyệt, checklist tích hợp xanh/vàng/đỏ (chỉ xem; sửa bằng lệnh `setup`), cảnh báo của trình quét. Web chưa tích hợp thì hiện lệnh cần chạy |
| **Màn hình** | Bảng mọi màn hình, lọc *chờ duyệt / thiếu mô tả / đã ẩn*; bấm một dòng để sửa tiêu đề, mô tả, từ khóa, câu hỏi mẫu, ẩn khỏi trợ lý; **Duyệt** nội dung AI; **AI soạn** phần còn trống |
| **Quyền** | Mặc định mọi màn hình **chỉ cần đăng nhập**, không cần làm gì. Muốn trợ lý lọc theo quyền thì bấm **Khai quyền** cho guard (Studio gợi ý chuỗi quyền thấy trong code) hoặc ghi đè theo màn hình ở trang Màn hình |
| **Gắn tourId** | Chọn màn hình → quét phần tử chưa có tourId → (tùy chọn) mô tả luồng cần dẫn để **AI gợi ý** chọn phần tử thuộc luồng, đánh dấu thêm phần tử nhạy cảm, viết `tourHint` → sửa tên, bỏ chọn → xem diff → áp. Phần tử nhạy cảm chắc chắn (submit, Xác nhận, nút đổi mật khẩu, nút cùng khối với ô mật khẩu...) luôn là user-only. Menu sinh từ dữ liệu được gắn `[tourMenu]`: mỗi mục có mốc `menu-<route>`. Phần tử AI cho là không thuộc luồng nằm ở nhóm riêng để tích lại |
| **Tour** | Danh sách tour (nháp AI / sẵn sàng / bị loại kèm lý do). **Ghi tour mới**: mô tả tính năng, Chrome mở ra (giữ phiên đăng nhập giữa các lần ghi), thao tác thật, AI soạn chữ từng bước; menu mở bằng hover ghi bằng Alt+H. **Soạn tay** hoặc sửa: chọn màn hình đích, bước bắt đầu, từng bước (phần tử, chờ bấm / nút Tiếp / di chuột, chữ). **Chạy thử** mở web với `?compassTour=<id>` |
| **Chạy thử** | Trạng thái backend (chạy độc lập), lệnh để chạy nó, backend có dùng chung kho tour với Studio không; bật/tắt web của dự án, xem log, mở web; sửa `wealthcompass.env` bằng form |
| **Thử trợ lý** | Hỏi như người dùng, chọn quyền của người hỏi và màn hình đang đứng; bên phải là từng bước trợ lý đã làm (tra cứu ban đầu kèm điểm, các vòng AI, công cụ được gọi và kết quả). Nút tour/màn hình mở thẳng web để thử |
| **Kiểm thử** | Bộ câu hỏi mẫu + màn hình đúng trong `compass.eval.yaml` (commit cùng code). **AI viết câu hỏi** cho từng màn hình; **Chạy kiểm thử** cho hit@1, hit@3, MRR, và lý do từng câu trượt (thiếu quyền, dưới ngưỡng điểm, xếp thứ mấy). Chạy lại sau mỗi lần sửa mô tả hay từ đồng nghĩa |
| **Nhật ký** | Số câu hỏi, tỷ lệ tìm được, câu **không tìm thấy** (gom câu giống nhau, thêm thẳng vào Kiểm thử), phễu tour (đề xuất → bắt đầu → đi hết), thời gian trả lời |
| **Cài đặt AI** | Nhà cung cấp, model, đang dùng khóa từ đâu, nhập khóa cho riêng phiên Studio, thử kết nối, công tắc cho AI đọc mã nguồn |

Nguyên tắc vẫn như dòng lệnh: code của web chỉ đổi khi bạn xem diff rồi bấm **Áp**; khóa AI không bao giờ ghi vào file. Sửa quyền, màn hình, tour thì trợ lý dùng ngay (backend tự nạp lại bản đồ tính năng).

Chạy backend với `COMPASS_DEBUG=1` (các đường `/debug/*` chỉ nhận kết nối từ chính máy đó) để trang Thử trợ lý và Kiểm thử dùng được, và `COMPASS_LOG_FILE` trỏ vào `~/.wealthcompass/logs/` (ngoài dự án) cho trang Nhật ký. Nhật ký chỉ có câu hỏi đã che thông tin cá nhân và mã người dùng đã băm. **Không bật `COMPASS_DEBUG` trên máy chủ thật**; muốn có trang Nhật ký cho bản thật thì đặt `COMPASS_LOG_FILE` rồi chép file về máy.

## Cách dòng lệnh (3 bước)

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
npm start

# Backend và doctor chạy từ repo WealthCompass (không cài trong web)
cd ~/wealthcompass
npm run server -- --env-file ~/du-an/my-web/wealthcompass.env &
npx tsx packages/cli/src/main.ts doctor --app ~/du-an/my-web   # kiểm tra mọi thứ đã nối đúng
```

## Bước 1: đóng gói

`npm run pack` build các gói thành file `.tgz` trong `dist/tarballs/`, cài được như gói npm thường:

| Gói | Vai trò | Cài vào web như |
| --- | --- | --- |
| `@wealthcompass/angular` | Widget chat, `[tourId]`, tour (biên dịch partial, chạy Angular 20-23) | `dependencies` |
| `@wealthcompass/core`, `@wealthcompass/contracts` | Logic dùng chung, kiểu dữ liệu | `dependencies` |
| `@wealthcompass/cli` | Lệnh `wealthcompass` (setup, scan, enrich, annotate, tour:record, doctor, studio) | **Không cài vào web**: chạy từ repo WealthCompass hoặc cài riêng |
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
| `--annotate all\|/route1,/route2` | tắt | Gộp luôn gợi ý `tourId` (xem [integration-guide.md](integration-guide.md) mục 5.1) vào patch |
| `--ai-code` | **tắt** | Cho AI đọc trích đoạn code service đăng nhập và guard khi phân tích tĩnh không đoán được |
| `--no-llm` | (có LLM nếu có khóa) | Không gọi LLM chút nào |
| `--force` | | Tạo lại `compass.config.yaml`, `wealthcompass.env` |
| `--project <tên>` | app đầu tiên | Chọn app khi `angular.json` có nhiều app |

Sáu việc `setup` làm, theo thứ tự:

1. **Dò dự án (tĩnh, không AI):** app trong `angular.json`, phiên bản Angular, cổng dev; file route (theo `provideRouter(...)` / `RouterModule.forRoot(...)`); file menu (mảng literal giống menu nhất, hiểu các khóa `label/title/name`, `route/path/link/url/routerLink`, `children/items/submenu`); cách khởi động (standalone hay NgModule) và component gốc; service đăng nhập (tên `@Injectable` có `token`/`getAccessToken`/`jwt`..., và `roles`/`permissions`).
2. **Sinh `compass.config.yaml`** và `compass.overrides.yaml` (file của WealthCompass, không phải code của web).
3. **Quét route.** Quyền mặc định là chỉ cần đăng nhập: `setup` không ghi quyền nào vào cấu hình. Chuỗi quyền thấy trong code guard (`hasRole('manager')`, `.includes('x')`) được nêu trong báo cáo làm gợi ý, chưa áp.
4. **AI soạn nháp** `description`/`keywords`/`sampleQuestions` cho màn hình còn trống, từ chữ tĩnh trên giao diện (như `enrich`), đánh dấu `llmDraft`.
5. **Dựng một patch** gồm: gói trong `package.json`, style trong `angular.json`, `provideCompass(...)` với `getToken`/`getCapabilities` nối vào service đăng nhập đã dò, câu gợi ý của widget lấy từ câu hỏi mẫu vừa soạn, `ChatWidgetComponent` và thẻ `<compass-chat-widget />` ở component gốc (và gợi ý `tourId` nếu `--annotate`).
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
