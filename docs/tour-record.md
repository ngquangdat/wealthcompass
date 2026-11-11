# Ghi tour hướng dẫn bằng `tour:record`

`tour:record` cho người vận hành **thao tác thật trên web** để tạo một tour, thay vì tự gõ YAML. Công cụ ghi lại những phần tử đã bấm, nhờ LLM soạn chữ và câu hỏi mẫu, rồi lưu vào kho tour `compass.tours.db` (SQLite) dưới dạng bản nháp để người duyệt.

**Không cần `tourId` trong HTML.** Với mỗi lần bấm, công cụ ghi một *locator*: nhiều manh mối về phần tử (vai trò và tên truy cập, chữ, thuộc tính ổn định như `formcontrolname`/`routerlink`, thẻ component Angular, hộp thoại hay tiêu đề mục chứa nó, selector CSS dự phòng, vị trí). Lúc chạy, widget chấm điểm các ứng viên trên trang và chỉ tô sáng khi chắc chắn (xem mục 5b). Phần tử có `tourId` vẫn được ưu tiên tuyệt đối như một cái "ghim".

Tài liệu này dành cho người ghi tour. Muốn biết hệ thống tổng thể, xem [integration-guide.md](integration-guide.md); muốn chạy thử trên web demo, xem [demo.md](demo.md).

## 1. Khi nào dùng

| Tình huống | Cách làm |
| --- | --- |
| Có luồng nhiều bước qua nhiều màn hình (trang chủ → bảng giá → tab → nút) | `tour:record` |
| Sửa chữ một tour đã có | Studio (trang Tour) |
| Tour 1-2 bước rất đơn giản | Viết tay cũng nhanh |

## 2. Chuẩn bị (kiểm tra trước khi ghi)

- [ ] **Chrome** đã cài trên máy. Công cụ dùng Chrome có sẵn, không tải trình duyệt riêng. Chrome ở chỗ khác thì đặt `CHROME_PATH=/duong/dan/toi/chrome`.
- [ ] **Web đang chạy** và có tài khoản đăng nhập được. **Ghi trên môi trường thử/staging với tài khoản thử**, vì mọi lần bấm đều chạy thật trên web (xem mục 5).
- [ ] **Không bắt buộc** gắn `tourId`. Chỉ nên ghim `tourId` cho vài phần tử quan trọng hay có chữ trùng nhau (xem mục 5b).
- [ ] **Mọi lần bấm chạy thật trên web**, kể cả nút đặt lệnh hay xác nhận: công cụ không đoán nút nhạy cảm theo chữ. Nút nào không muốn bấm thật thì bật **Tô sáng (không bấm)** trong khung ghi trước khi bấm (xem mục 4). Chỉ phần tử dev đã đánh dấu trong source (`tourRole="user-only"`, `data-sensitive`) và ô mật khẩu/OTP mới tự bị chặn.
- [ ] Đã chạy **`scan`** để có `feature-map.json` (công cụ lấy nhãn và tính năng đích từ đó). Trong repo này: `npm run scan`.
- [ ] (Tùy chọn) Khóa LLM. Không có khóa vẫn ghi được, chữ sẽ theo mẫu. Thứ tự tìm khóa: `COMPASS_LLM_API_KEY` → biến theo nhà cung cấp (`DEEPSEEK_API_KEY` mặc định, `GOOGLE_API_KEY` nếu `COMPASS_LLM_PROVIDER=gemini`) → đúng biến đó trong file chỉ định bởi `COMPASS_ENV_FILE` (nếu đặt). Ví dụ dùng chung khóa với dự án khác: `export COMPASS_ENV_FILE=~/du-an-khac/.env`.

## 3. Lệnh

**Phải chạy trong thư mục repo** (`cd ~/wealthcompass`). Chạy ở thư mục khác sẽ gặp `npm error ENOENT ... package.json`.

```bash
cd ~/wealthcompass
npm run tour:record -- --url http://localhost:4200 --id sell-bond --about "Hướng dẫn khách bán trái phiếu đang nắm giữ" --dry-run
```

Dấu `--` đứng riêng là bắt buộc: nó tách tham số của `npm` khỏi tham số của công cụ.

Script `tour:record` trong `package.json` đã gắn sẵn `--app examples/iconnect-demo`. Với web khác, gọi trực tiếp:

```bash
npx tsx packages/cli/src/main.ts tour:record --app ~/du-an/my-web --url https://staging.congty.vn --id sell-bond
```

| Cờ | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `--url` | có, trừ khi cấu hình có `web.url` | Địa chỉ web mở trong Chrome |
| `--id` | có | Id của tour (khóa dưới `tours:` trong YAML). Dạng `ban-trai-phieu` hoặc `sell-bond`; đừng đổi sau khi đã phát hành |
| `--app` | có (script `npm run tour:record` đã gắn sẵn web demo) | Thư mục source của web, hoặc file kho `.db` của dự án chưa có source. Công cụ tìm kho dự án từ đó. Dự án kiểu cũ dùng `--config <compass.config.yaml>` |
| `--about "..."` | không, nhưng nên có | Mô tả đang ghi tour cho tính năng gì. Có thể gõ hoặc sửa tiếp trong khung ghi |
| `--title "..."` | không | Ép tiêu đề tour; bỏ qua thì LLM đặt |
| `--feature <id>` | không | Tính năng đích (id trong Feature Map, như `iconnect.assets`). Bỏ qua thì tự suy ra theo màn hình lúc dừng ghi |
| `--dry-run` | không | In YAML ra màn hình, **không ghi file** |
| `--force` | không | Cho phép ghi đè tour trùng `--id` |
| `--no-llm` | không | Không gọi LLM, chữ theo mẫu |
| `--mobile` / `--tablet` | không | Mở Chrome với khung nhìn điện thoại (390×844) hoặc iPad (820×1180) để ghi bản cho thiết bị đó. Cùng `--id` với tour đã có bản khác thì lưu thành `variants.mobile`/`variants.tablet` của tour đó, không cần `--force` |

## 4. Quy trình từng bước

1. **Chạy lệnh.** Chrome mở tới `--url`; ở góc trái dưới có một khung nhỏ **"WealthCompass · ghi tour"**.
2. **Đăng nhập** và đi tới **màn hình xuất phát** của tour (thường là trang chủ). Lúc này chưa ghi gì.
3. **Mô tả tính năng** vào ô *"Bạn đang ghi tour cho tính năng gì?"*, một hai câu: cho ai, làm việc gì, kết thúc ở đâu. Ví dụ: *"Hướng dẫn khách xem sổ lệnh trái phiếu để theo dõi và hủy lệnh đã đặt"*. Đây là thông tin LLM tin nhất; viết rõ thì chữ và câu hỏi mẫu sinh ra đúng hơn nhiều.
4. Bấm **● Bắt đầu ghi**. Màn hình hiện tại trở thành điểm bắt đầu (`startRoute`) của tour.
5. **Thao tác đúng luồng muốn dẫn**, từng phần tử một. Phần tử vừa được ghi sẽ nhấp nháy viền đỏ; khung hiện số bước đã ghi và phần tử gần nhất.
6. Đi tới **màn hình đích** (nơi người dùng sẽ làm việc cần làm), rồi bấm **■ Dừng & lưu**. Tính năng đích của tour được xác định theo màn hình bạn đang đứng lúc dừng. Nếu chưa có mô tả, khung nhắc một lần; bấm lại để vẫn dừng.
7. Công cụ soạn nội dung, lưu tour vào kho `compass.tours.db` (câu hỏi mẫu vào `compass.overrides.yaml`), rồi tự chạy lại `scan` để xác nhận tour hợp lệ. Xem phần tiếp theo để duyệt.

**Đóng cửa sổ Chrome** sau khi đã bấm "Bắt đầu ghi" cũng được coi như dừng và vẫn lưu các bước đã ghi, nhưng khi đó công cụ không biết màn hình đích nên chọn theo bước cuối cùng, dễ gán sai tính năng. Nên luôn bấm **■ Dừng & lưu**.

### Menu mở bằng hover (desktop)

Menu chỉ hiện khi di chuột (thanh menu desktop) không có lần bấm nào trên nút mở menu, nên phải báo cho công cụ:

1. Di chuột vào nút mở menu (menu hiện ra).
2. Giữ chuột ở đó và nhấn rồi thả riêng phím **Alt** (Mac: **⌥**). Nút mở menu nhấp nháy viền đỏ và được ghi thành bước `hover`. Alt kèm phím khác (Alt+Tab...) hoặc kèm lần bấm chuột thì không tính.
   Cách khác: bấm nút **Ghi hover** trên khung ghi, rồi bấm vào nút mở menu. Lần bấm đó chỉ chọn nút (bị chặn, app không chạy) và được ghi thành bước `hover`.
3. Bấm mục trong menu như bình thường (ghi thành bước `click`). Menu nhiều tầng thì lặp lại bước 1-2 cho từng tầng.

Phím Alt tiện nhất vì chuột không phải rời nút mở menu; đưa chuột xuống khung ghi thì menu thường đã đóng, nên nút **Ghi hover** chỉ hợp với menu mở được lại khi chuột quay về nút.

Lúc chạy tour, bước `hover` tô sáng nút mở menu và chờ người dùng di chuột vào. Khi menu mở, widget **khóa hover**: menu được giữ mở trong lúc tour tô sáng mục bên trong, dù chuột rời nút mở hay lớp phủ của tour che mất nó. Khóa được nhả ngay sau bước không-hover kế tiếp (mục trong menu đã được bấm), khi tour kết thúc hoặc bị đóng.

- Menu mở bằng JS (`mouseenter`/`mouseleave`, overlay): widget chặn mọi sự kiện "rời chuột" (kể cả khung bọc ngoài nút mở, như lớp trong suốt phủ lên tên người dùng của TCBS), và chặn luôn các sự kiện hover xảy ra **ngoài** vùng menu. Lớp nền trong suốt của menu CDK/Material (`cdk-overlay-backdrop`) luôn tính là ngoài menu (nhiều web, như TCInvest, đóng menu khi chuột đi vào phần thân trang chứ không phải khi rời nút). Popover của tour và khung chat không bị chặn. Trong lúc khóa, phần còn lại của trang tạm không phản ứng với hover (tooltip, menu khác) cho tới khi nhả khóa.
- Menu mở bằng CSS `:hover`: widget ghim kiểu hiển thị hiện tại (`display`, `visibility`, `opacity`...) của mục và các phần tử chứa nó.
- Màn hình cảm ứng không có hover: nút **Tiếp** của bước gửi sự kiện hover thay người dùng (chỉ mở được menu JS). Bước `hover` luôn có `skipIfNextVisible`, nên bố cục mà mục đã hiện sẵn (menu mobile) thì bước này tự được bỏ qua.
- `tour:verify` di chuột thật vào nút mở menu rồi mới thử bước sau.

### Các nút trong khung ghi

Khung ghi che mất phần tử cần bấm thì **nắm thanh tiêu đề "WealthCompass · ghi tour" và kéo** ra chỗ khác. Vị trí được nhớ khi chuyển trang trong cùng tab; thao tác kéo không bị ghi thành bước tour.

| Nút | Tác dụng |
| --- | --- |
| **● Bắt đầu ghi** | Bắt đầu ghi (chỉ hiện khi chưa ghi). Màn hình hiện tại là điểm xuất phát |
| **■ Dừng & lưu** | Kết thúc và chuyển sang bước soạn nội dung |
| **❚❚ Tạm dừng / ▶ Tiếp tục** | Tạm dừng: lần bấm vẫn chạy thật nhưng **không được ghi** (vd. đóng thông báo, đăng nhập lại giữa chừng). Bấm **Tiếp tục** để ghi tiếp |
| **✕ Hủy** | Bỏ mọi bước đã ghi và quay về **● Bắt đầu ghi** để ghi lại từ đầu (mô tả đã nhập được giữ). Đã có bước thì phải bấm hai lần |
| **Ghi hover** | Lần bấm kế tiếp trên trang được ghi thành bước `hover` (lần bấm bị chặn). Xem phần menu hover ở trên |
| **Tô sáng (không bấm): tắt/BẬT** | Công tắc. Khi **BẬT**, mọi lần bấm được ghi thành bước chỉ giải thích và **bị chặn, app không chạy gì**. Dùng khi muốn trỏ vào một con số hay một khu vực mà không chuyển màn hình. **Nhớ tắt lại** (bấm lần nữa) để tiếp tục thao tác bình thường; quên tắt thì app đứng yên vì mọi lần bấm đều bị chặn |

## 5. Điều gì được ghi, điều gì bị chặn

- **Ghi lần bấm, và hover khi nhấn riêng phím Alt hoặc dùng nút Ghi hover**. Bấm trúng icon/chữ bên trong nút thì phần tử được ghi là chính cái nút. Web gắn `(click)` lên `div`/`span` thường (không `role`, không `href`): công cụ leo lên vùng bấm ngoài cùng còn `cursor: pointer`; bấm trúng icon không có chữ thì lấy mục gần nhất có chữ. Chữ gõ vào ô nhập, cuộn, kéo thả **không** được ghi.
- Bấm bình thường → ghi thành bước `click` (người dùng thật sẽ phải bấm vào đúng chỗ đó), và **app vẫn chạy bình thường** (đổi màn hình, đổi tab...). Đó là lý do cần ghi trên môi trường thử.
- Bấm vào phần tử **nhạy cảm** (`tourRole="user-only"`, `data-sensitive`, ô mật khẩu, ô OTP) → ghi thành bước chỉ-tô-sáng (`next`) và **lần bấm bị chặn, không chạy thật**. Nhờ vậy ghi tour không vô tình đặt lệnh. Bước nhạy cảm nên là **bước cuối** của tour; nếu còn bước sau nó, công cụ in cảnh báo.
- Bấm vào phần tử **không có manh mối nào dùng được** (không tên, không chữ, không thuộc tính ổn định, vd. một `div` trống) → bị bỏ qua (app vẫn chạy) và có cảnh báo. Thêm `aria-label` hoặc `tourId` cho phần tử đó nếu cần bước này.
- **Không ghi dữ liệu cá nhân**: chữ trong vùng `data-sensitive`, chuỗi gần như toàn số (số dư, khối lượng) và chữ có email/số điện thoại/số giấy tờ bị bỏ; `href` chỉ giữ đường dẫn, bỏ query; id/class sinh tự động (`_ngcontent-*`, `mat-mdc-*`, `cdk-*`, `input-2`) không được dùng.
- Bấm đúp vào cùng một phần tử chỉ tính một bước.

### tourId lồng nhau và bước không có tourId

Một lần bấm có thể nằm trong nhiều phần tử có `tourId` lồng nhau (vd. `div[tourId] > button[tourId] > span`). Công cụ chọn theo thứ tự:

1. `tourId` của **chính phần tử tương tác vừa bấm** (nút, link, ô nhập).
2. `tourId` của phần tử con nằm giữa chỗ bấm và nút (span/icon trong nút), gần chỗ bấm nhất.
3. `tourId` của phần tử **bọc sát** bên ngoài (tối đa 3 cấp), chỉ khi nó chứa đúng một phần tử bấm được.

`tourId` của vùng chứa có nhiều nút (thanh công cụ, thẻ, form) hoặc của cả khu vực **không được dùng**: nó trỏ cả vùng, không trỏ nút vừa bấm.

Khi lần bấm không có `tourId` dùng được, bước được ghi bằng selector (locator) và có cảnh báo ở hai chỗ:

- **Khung ghi:** dòng ⚠ dưới bước vừa ghi (kèm selector, và tên `tourId` của vùng chứa đã bỏ qua nếu có), cùng tổng số bước không có `tourId`.
- **Lúc lưu:** mỗi bước một dòng `! Bước N (/route) không có tourId, tìm theo selector: ...`.

Bước như vậy vẫn chạy được; cảnh báo để biết chỗ nào nên nhờ dev gắn `tourId` nếu muốn ghim chắc chắn.

## 5b. Widget tìm lại phần tử thế nào

Mỗi bước chấm điểm các ứng viên trên trang: tên truy cập khớp (5), `formcontrolname`/`routerlink`/`data-testid`/`id` khớp (4 mỗi cái), chữ (3), cùng component (2), cùng hộp thoại (2), cùng tiêu đề mục (1,5), selector CSS (1,5), vị trí gần (tối đa 1). Thuộc tính mạnh khác giá trị bị trừ điểm. Trọng số nằm trong `packages/core/src/locator.ts`.

| Kết quả | Widget làm gì |
| --- | --- |
| Có `tourId` và tìm thấy | Tô sáng, như trước |
| Điểm ≥ 6 và hơn ứng viên thứ hai ≥ 2 | Tô sáng phần tử |
| Có ứng viên nhưng không đủ chắc (vd. hai nút **Xác nhận** ở hai vùng khác nhau, không phân biệt được) | Hiện popover giữa màn hình kèm "Tìm trên màn hình: …", **không tô sáng** phần tử có thể sai; báo `low_confidence` |
| Không có ứng viên | Dừng tour, báo `target_missing` như trước |

### Danh sách, bảng, thẻ lặp

Nút lặp trên mỗi dòng (mỗi dòng bảng có một nút **BÁN**, mỗi thẻ trong `@for` có một nút) được nhận ra lúc ghi: phần tử nằm trong một dòng lặp và dòng anh em có phần tử y hệt. Locator khi đó có `list`:

```json
"list": { "row": "tr", "column": "Thao tác", "index": 2 }
```

- Ghi **hình dạng dòng** và **thứ tự dòng đã bấm** (`index`, từ 0, đếm trong các dòng cùng hình dạng); không ghi chữ trong dòng (mã trái phiếu, số dư). Tiêu đề mục lấy từ ngoài vùng danh sách.
- Lúc chạy, các dòng khác của cùng danh sách không bị coi là đối thủ: widget tô sáng phần tử ở **dòng thứ `index`**; danh sách ngắn hơn thì lấy dòng cuối. Dữ liệu đổi, số dòng đổi đều chạy.
- Thứ tự là theo vị trí: danh sách đổi cách sắp xếp thì dòng thứ i là dòng khác. Sửa `index` (xuất tour ra JSON bằng `tour:export`, sửa, rồi `tour:import`) để trỏ dòng khác (vd. `0` cho dòng đầu); tour ghi trước khi có `index` (không có khóa này) giữ cách chọn cũ theo vị trí trên màn hình.
- `column` (tiêu đề cột hoặc tên cột `mat-column-*`) cộng điểm cho ô đúng cột.
- Muốn trỏ vào một dòng theo nội dung thì người duyệt thêm `"rowText": "VIC2025"`: chỉ chọn dòng chứa chữ đó (ưu tiên hơn `index`). Công cụ không tự ghi vì chữ trong dòng có thể là dữ liệu khách.

### Thiết bị: máy tính, iPad, điện thoại

- Mỗi locator ghi `layout` theo bề rộng khung nhìn lúc bấm: dưới `tours.mobileBreakpoint` (mặc định 768px) là `mobile`, dưới `tours.tabletBreakpoint` (mặc định 1024px) là `tablet`, còn lại là `desktop`. Tour được lưu theo bố cục của đa số bước, nên ghi bằng cửa sổ Chrome hẹp cũng ra đúng loại.
- Ghi bản chính như thường, rồi ghi lại **cùng `--id`** với `--tablet` hoặc `--mobile` (Studio: chọn **Thiết bị** khi ghi, hoặc nút "Ghi bản iPad/Điện thoại"): tour có thêm `variants.tablet`/`variants.mobile`.
- Widget chọn bản theo bề rộng màn hình. Thiếu bản cho thiết bị đang dùng thì: iPad dùng bản desktop, desktop dùng bản iPad, điện thoại dùng bản chính.
- Ghi nhầm loại (vd. ghi trên máy tính nhưng tour dành cho iPad): ở trang **Tour** của Studio, dòng **thiết bị** của mỗi tour có ô chọn cho từng bản; đổi sang thiết bị khác là xong. Chọn thiết bị đã có bản thì hai bản đổi chỗ cho nhau.
- Widget cần cùng breakpoint: `provideCompass({ ..., tours: { mobileBreakpoint: 768, tabletBreakpoint: 1024 } })`.

### Bước mở chỗ chứa (`skipIfNextVisible`)

Lúc ghi, nếu phần tử bạn bấm **chưa hiện** ở lần bấm trước (cùng màn hình), lần bấm trước được coi là bước mở chỗ chứa (nút ☰ menu, mở rộng mục) và có `"skipIfNextVisible": true`. Lúc chạy, nếu phần tử của bước sau đã hiện chắc chắn (menu đang mở, hoặc màn hình rộng không có nút ☰) thì bước đó được bỏ qua và báo `tour_step` với `status: skipped`. Xóa cờ này nếu bước đó luôn cần làm.

### Chờ màn hình sẵn sàng

Widget chỉ dẫn một bước khi thành phần chứa phần tử đã tải xong. Trước mỗi bước nó chờ theo thứ tự:

1. Router chuyển trang xong (lần bấm ở bước trước mở màn hình mới; resolver hay lazy chunk chậm, tối đa 15 giây), rồi tới đúng route của bước (tối đa 3 giây).
2. Phần tử của bước **sẵn sàng**, tối đa 10 giây:
   - tìm thấy chắc chắn;
   - không còn "đang tải" quanh nó: không nằm trong vùng `aria-busy`, không có chỉ báo tải đè lên nó, nằm trong cùng component với nó, hay trải rộng cả trang (thanh tải trên đầu trang, lớp phủ tải). Spinner nhỏ ở widget khác (bảng giá đang cập nhật) **không** làm tour chờ;
   - đã đứng yên khoảng 150 ms (hết hiệu ứng mở, bố cục không còn nhảy), để popover trỏ đúng chỗ.
   Hết giờ mà phần tử đã tìm chắc thì vẫn chỉ dẫn, không để tour kẹt.
3. Chưa ở màn hình của bước: chờ ngắn (0,8 giây) xem phần tử có sẵn không (menu, khung chung), không có thì tự điều hướng rồi chờ như bước 2.

Lần bấm được nhận ở pha capture của `document`: app chặn lan truyền sự kiện (`stopPropagation`), hay lớp trong suốt phủ lên nút (lần bấm rơi vào lớp phủ), tour vẫn sang bước sau ngay. Component xử lý ở `pointerdown` rồi gỡ phần tử (click không bao giờ tới) cũng được tính là đã bấm.

Phần tử "đang tải" mặc định là `[aria-busy="true"], mat-spinner, mat-progress-spinner, mat-progress-bar[mode="indeterminate"], ngx-skeleton-loader, .compass-busy`; app dùng spinner riêng thì khai báo:

```yaml
# compass.config.yaml
tours:
  mobileBreakpoint: 768
  tabletBreakpoint: 1024
  busySelector: "app-loading, .page-spinner"
```

và truyền cùng giá trị cho widget: `provideCompass({ ..., tours: { busySelector: 'app-loading, .page-spinner' } })`.

Bước tìm bằng locator gửi telemetry `tour_step` (khóa bước, manh mối đã khớp, điểm) để thấy tour nào đang yếu trước khi nó hỏng hẳn. Ứng dụng có nhiều nút trùng chữ thì ghim `tourId` cho riêng phần tử đó.

## 6. Kết quả và cách duyệt

Lần chạy thật (không `--dry-run`) in ra dạng như sau (ví dụ; số bước và số câu hỏi mẫu tùy lần ghi):

```
! Bỏ qua lần bấm vào <div> ở /iconnect/orders: phần tử không có tên, chữ hay thuộc tính ổn định để tìm lại. Thêm aria-label hoặc tourId nếu cần bước này.
! Bước 1 (/home) không có tourId, tìm theo selector: link "Giao dịch iConnect" · app-home-page · [routerlink="/iconnect/price-board"]. Muốn ghim chắc chắn thì dev gắn tourId cho phần tử này.
! Bước 2 (/iconnect/price-board) không có tourId, tìm theo selector: link "Sổ lệnh" · app-iconnect-shell.
Soạn nội dung bằng LLM (deepseek / deepseek-v4-flash)...
Đã ghi tour "orders-tour" (2 bước) vào kho dự án iconnect-demo, thêm 6 câu hỏi mẫu vào compass.overrides.yaml
✔ scan: tour "orders-tour" hợp lệ.
  - Tour "orders-tour" là nháp (LLM soạn), chưa duyệt: đọc lại chữ rồi bấm Lưu ở trang Tour của Studio
```

Tour được lưu vào kho `compass.tours.db` (**không sửa template**). Nội dung một tour trong kho có dạng (ví dụ rút gọn từ một lần ghi thật trên web demo):

```json
{
  "tours": {
    "orders-tour": {
      "title": "Xem sổ lệnh trái phiếu iConnect",
      "feature": "iconnect.orders",
      "startRoute": "/home",
      "draft": true,
      "draftSource": "llm",
      "recordedAt": "2026-11-06",
      "purpose": "Hướng dẫn khách xem sổ lệnh trái phiếu",
      "steps": [
        {
          "key": "s1",
          "locator": {
            "tag": "a", "role": "link", "name": "Giao dịch iConnect",
            "attrs": { "routerlink": "/iconnect/price-board", "href": "/iconnect/price-board" },
            "component": "app-home-page", "context": { "heading": "Tính năng ưa thích" },
            "css": "[routerlink=\"\\/iconnect\\/price-board\"]", "layout": "desktop"
          },
          "route": "/home",
          "advanceOn": "click",
          "text": "Từ Trang chủ, bấm vào **Giao dịch iConnect** để mở bảng giá."
        }
      ]
    }
  }
}
```

Câu hỏi mẫu mới được **thêm** vào `features.<feature>.sampleQuestions` (không xóa, không trùng câu cũ, không phân biệt hoa thường).

### Checklist duyệt (làm trước khi commit)

- [ ] **Đọc lại chữ từng bước.** LLM soạn nháp, có thể sai chi tiết hay giọng văn; sửa trong Studio (trang Tour).
- [ ] **`feature:` đúng tính năng đích?** Sai thì trợ lý sẽ gắn tour vào nhầm màn hình. Sửa tay hoặc ghi lại với `--feature <id> --force`.
- [ ] **`advanceOn` hợp lý?** `click` = người dùng tự bấm vào phần tử sáng; `next` = bấm nút "Tiếp" của popover. Bước nhạy cảm phải là `next`.
- [ ] **Câu hỏi mẫu** mới thêm: xóa câu nghe lạ, giữ câu người dùng thật sẽ gõ.
- [ ] **Bấm Lưu trong Studio** sau khi duyệt xong: tour hết là bản nháp.
- [ ] Chạy **`npm run scan -- --strict`**: phải không còn cảnh báo.
- [ ] **Thử tour thật**: chạy web, mở chat, hỏi đúng câu liên quan, bấm "Dẫn tôi đi" và đi hết các bước.
- [ ] Sao lưu file kho của dự án (dữ liệu không nằm trong git của web). Dự án kiểu cũ: commit `compass.tours.db`, `compass.overrides.yaml`, `feature-map.json`, `compass.lock.json`.

## 7. LLM làm gì và gửi đi những gì

LLM chỉ **soạn nháp** tiêu đề, mô tả, chữ từng bước và 4-6 câu hỏi mẫu. Quy tắc ngầm: không bảo hệ thống hay trợ lý làm hộ, nhắc người dùng tự nhập và tự xác nhận ở bước nhạy cảm.

Dữ liệu gửi cho nhà cung cấp LLM (gọi trực tiếp từ máy chạy lệnh, không qua backend của hệ thống):

- Mô tả bạn gõ (đã lọc số điện thoại, số tài khoản, CCCD, email).
- Nhãn và gợi ý tĩnh của từng phần tử lấy từ template (`tourLabel`, `tourHint`), tiêu đề màn hình, kiểu bước, tên và mô tả tính năng đích.
- **Không gửi** chữ hiển thị trên trang (có thể chứa số dư, tên khách), trừ khi template chưa có nhãn cho phần tử đó; khi đó chỉ gửi bản đã cắt ngắn và lọc PII.

Nếu LLM trả sai định dạng hoặc sai số bước, công cụ thử lại một lần rồi dùng mẫu dựng sẵn (có in cảnh báo). Không có khóa hoặc dùng `--no-llm` cũng ra tour, với chữ dạng *"Bấm **Nhãn**."* và dùng chính mô tả của bạn làm tiêu đề, mô tả.

## 8. Mẹo dùng

- **Chạy `--dry-run` trước**, đọc YAML, ổn rồi mới bỏ cờ này để ghi.
- **Ghi lại tour đã có** (ví dụ giao diện đổi): chạy lại với cùng `--id` và `--force`. Không có `--force` công cụ từ chối, không bao giờ âm thầm ghi đè.
- **Tour dài chia nhỏ** theo mục tiêu (3-6 bước), mỗi tour một tính năng đích; tour quá dài người dùng bỏ giữa chừng.
- **Ghi sai một bước**: cứ ghi tiếp tới hết rồi sửa tay trong YAML (xóa hoặc đổi thứ tự bước), hoặc chạy lại lệnh với cùng `--id` và `--force`. Hiện chưa có nút "hoàn tác bước cuối" trong khung ghi.
- Muốn một bước chỉ giải thích: bật **Tô sáng**, bấm vào phần tử, rồi tắt.

## 9. Xử lý sự cố

| Triệu chứng / thông báo | Nguyên nhân và cách xử lý |
| --- | --- |
| `npm error ENOENT ... package.json` | Chạy sai thư mục. `cd ~/wealthcompass` rồi chạy lại |
| Chrome không mở, lỗi không tìm thấy trình duyệt | Chưa cài Chrome hoặc ở chỗ khác; đặt `CHROME_PATH` |
| Bấm nhiều nhưng khung báo "Đã ghi 0 bước" | Chưa bấm **● Bắt đầu ghi** |
| App không phản ứng khi bấm | Công tắc **Tô sáng** đang BẬT: bấm nút đó lần nữa để tắt |
| `! Bỏ qua lần bấm vào <tag> ở /route: phần tử không có tên, chữ hay thuộc tính ổn định...` | Phần tử không có manh mối nào để tìm lại (vd. `div` trống). Bấm vào phần có chữ của mục đó, hoặc thêm `aria-label`/`tourId` |
| `Không có bước nào nhận ra được, không có gì để lưu.` | Mọi lần bấm đều vào phần tử không có manh mối |
| Menu hover đóng mất khi chạy tour | Bước mở menu chưa được ghi là `hover`: ghi lại và nhấn **Alt** khi chuột đang ở trên nút mở menu, hoặc đổi kiểu bước thành "Di chuột" ở trang Tour của Studio |
| `Chưa bấm "Bắt đầu ghi".` / `Đóng trình duyệt trước khi ghi.` | Đã dừng hoặc đóng Chrome mà chưa bắt đầu ghi |
| `! Chưa có feature-map.json (hãy chạy scan trước)...` | Chạy `npm run scan` trước. Không có thì không điền được nhãn, và không tự xác định được tính năng đích |
| `! Không xác định được tính năng đích (dùng --feature <id>)...` | Màn hình lúc dừng không khớp tính năng nào. Dừng ở đúng màn hình đích, hoặc truyền `--feature` |
| `--feature "x" không có trong feature-map.json` | Gõ sai id; mở `feature-map.json` xem id đúng, hoặc chạy lại `scan` |
| `Tour "x" đã có trong ... Dùng --force để ghi đè hoặc đặt --id khác.` | Trùng id; dùng `--force` hoặc id khác |
| `... không phải YAML hợp lệ` | File overrides đang sai cú pháp; sửa rồi chạy lại. Công cụ không ghi đè file hỏng |
| `! Đã tắt LLM (--no-llm), dùng mẫu.` / `! Không tìm thấy khóa LLM, dùng mẫu.` | Chữ theo mẫu. Muốn LLM: bỏ `--no-llm` và/hoặc đặt khóa (mục 2) |
| `! LLM lỗi (...), dùng mẫu.` | LLM từ chối hoặc trả sai định dạng sau 2 lần; ví dụ hết hạn mức (lỗi 402), sai khóa (401), sai tên model (404). Kiểm tra khóa và `COMPASS_LLM_MODEL`; tour vẫn được ghi với chữ mẫu |
| `✘ scan: tour "x" bị loại.` kèm dòng `- Tour "x" bị loại: không tìm thấy tourId ...` | Một `tourId` đã ghi không còn trong template (bị xóa hoặc đổi). Thêm lại hoặc ghi lại tour |
| `! Bước N là phần tử nhạy cảm (user-only) nhưng còn M bước sau nó` | Thường là bấm nhầm sau bước nhạy cảm; ghi lại sao cho bước nhạy cảm là bước cuối |
| Tour gắn nhầm tính năng | Dừng ghi khi chưa tới màn hình đích, hoặc đóng cửa sổ thay vì bấm Dừng. Sửa `feature:` trong YAML hoặc ghi lại với `--feature` |

## 9b. Giữ tour không hỏng: kiểm tra, tự sửa, ghi lại một bước, kho tour

Web đổi liên tục (đổi chữ nút, migration component, đổi route). Bốn công cụ dưới đây giữ tour chạy đúng mà không phải ghi lại cả tour.

### `tour:verify`: chạy lại mọi tour trên một bản web thật

```bash
# Trang cần đăng nhập: lưu phiên một lần (mở Chrome, đăng nhập tài khoản kiểm thử, đóng Chrome)
npx tsx packages/cli/src/main.ts tour:auth --url https://staging.example.vn/login --out compass.auth.json

npx tsx packages/cli/src/main.ts tour:verify --app ~/du-an/my-web \
  --url https://staging.example.vn --storage-state compass.auth.json \
  --report verify-report.json --screenshots .compass-shots
```

- Chạy Chromium không giao diện, mỗi tour hai lượt: desktop 1280px và mobile 390px. Mỗi lượt dùng bản tour của bố cục đó (`variants`), thiếu thì dùng bản chính (báo `dùng bản chính`), đúng như widget.
- Trang trình duyệt được tiêm đúng bộ tìm phần tử của widget (`resolveStep`, `findByLocator`, chờ spinner, `skipIfNextVisible`), nên kết quả là điều người dùng sẽ thấy.
- Bước "chờ bấm" được **bấm thật** để đi tiếp như người dùng. Bước "Tiếp" (bước chỉ tô sáng), phần tử dev đánh dấu `user-only`/`data-sensitive` và nút gửi form **không bao giờ bị bấm**. Nút đặt lệnh hay xác nhận muốn an toàn thì phải được ghi là bước tô sáng (bật **Tô sáng** lúc ghi): bước ghi là "chờ bấm" sẽ bị `tour:verify` bấm thật.
- Kết quả từng bước: `ok`, `low_confidence` (widget sẽ hiện popover không gắn phần tử), `missing` (các bước sau báo `not_reached`), `skipped`. Bước có manh mối đã đổi ghi `đổi: name, attrs.routerlink...`.
- Mã thoát khác 0 khi có tour hỏng (`missing`), hoặc khi có bước không chắc nếu thêm `--strict`: dùng được trong CI và lịch chạy hằng đêm.
- `tour:auth` lưu cả cookie, localStorage và **sessionStorage** (nhiều web ngân hàng giữ phiên ở đó). File phiên là phiên thật: đã có trong `.gitignore`, không commit, dùng tài khoản kiểm thử.
- Mở trang xuất phát mà bị chuyển trang (thường là `/login`), lệnh báo rõ là cần `--storage-state` thay vì báo không thấy phần tử.

| Cờ | Ý nghĩa |
|---|---|
| `--only id1,id2` | Chỉ kiểm các tour này |
| `--layout desktop\|tablet\|mobile` | Chỉ kiểm một bố cục. Mặc định kiểm desktop và mobile, thêm tablet khi tour có bản iPad |
| `--heal` | Ghi locator đã sửa vào kho tour (xem dưới) |
| `--storage-state <file>` | Phiên đăng nhập do `tour:auth` lưu |
| `--screenshots <thư mục>` | Chụp phần tử của từng bước tìm được (`<tour>/<bố cục>-<bước>.png`) cho `tour:push` |
| `--report <file>` | Báo cáo JSON: từng bước, điểm, manh mối khớp, manh mối đổi, locator đề xuất |
| `--strict` | Coi bước `low_confidence` là lỗi |
| `--headed` | Hiện trình duyệt để xem nó chạy |

### Tự sửa locator (`--heal`)

Khi phần tử vẫn được tìm **chắc chắn** bằng các manh mối còn lại nhưng manh mối chính đã đổi, verify ghi lại locator từ chính phần tử tìm được:

- Manh mối được so: tên truy cập, chữ, vai trò, thuộc tính danh tính (`data-testid`, `formcontrolname`, `routerlink`, `href`, `name`, `id`), component, tiêu đề hộp thoại/mục, hình dạng dòng danh sách. CSS và vị trí không tính (thay đổi giữa các lần là bình thường). Chữ hoa/thường và dấu không tính.
- `tourId` ghim không còn tìm thấy nhưng locator tìm chắc: báo `đổi: tourId`; khi sửa thì bỏ ghim để locator làm nguồn chính.
- **Bước thường**: áp luôn, ghi `"healedAt": "<ngày>"` vào bước. Giữ dòng người duyệt đã ghim (`list.rowText`) và bố cục của bản ghi.
- **Bước nhạy cảm**: chỉ ghi `"proposal": { locator, changed, at }`; locator đang dùng giữ nguyên tới khi người duyệt bấm **Dùng locator mới** (hoặc **Bỏ qua**) ở trang Tour của Studio.
- Lượt chạy bản chính ở bố cục kia (`dùng bản chính`) không ghi đè bản sửa của lượt chạy đúng bố cục.
- Chỉ tour ghi bằng `tour:record` (trong kho tour) được sửa; tour soạn tay bằng tourId trong YAML chỉ được báo cáo.
- Sau khi sửa: chạy `scan`, xem lại ở trang Tour của Studio rồi commit `compass.tours.db`.

### Ghi lại riêng một bước

Phần tử của một bước đổi hẳn (không còn manh mối nào khớp) thì không cần ghi lại cả tour:

```bash
npx tsx packages/cli/src/main.ts tour:rerecord --app ~/du-an/my-web --url http://localhost:4200 --id sell-bond --step s3 [--mobile | --tablet]
```

Chrome mở ở màn hình của bước và **đang ghi sẵn**: lần bấm đầu tiên trở thành phần tử mới của bước, rồi Chrome tự đóng. Chữ, khóa bước và thứ tự giữ nguyên; `healedAt` được ghi; phần tử mới nhạy cảm thì bước chuyển sang chỉ tô sáng. Bước ở route có tham số (`/orders/:id`) thì bạn tự mở tới màn hình đó và bấm **● Bắt đầu ghi** trước. Trong Studio: nút **Ghi lại phần tử** cạnh mỗi bước trong ngăn sửa tour, và nút **Ghi lại bước này** trong đề xuất.

Studio cũng có nút **Kiểm tra tour** (chạy `tour:verify` trên web đang chạy, có tùy chọn tự sửa).

### Một kho tour duy nhất (SQLite)

Mọi tour ghi bằng `tour:record` hay sửa trong Studio nằm trong **kho dự án**: một file SQLite cho mỗi web, ngoài source (`~/.wealthcompass/projects/<tên web>-<mã>.db`), cùng chỗ với cấu hình và bản đồ tính năng (xem [quickstart.md](quickstart.md)). Backend không có kho riêng: nó mở chính file đó (`COMPASS_PROJECT`). Dự án kiểu cũ thì tour nằm trong `compass.tours.db` cạnh source cho tới khi chạy `wealthcompass migrate`.

| Ai | Làm gì với kho dự án |
|---|---|
| `tour:record`, `tour:rerecord`, `tour:verify --heal`, Studio | Ghi tour (mỗi lần lưu là một phiên bản mới) |
| `scan` | Đọc để dựng `feature-map.json` |
| Backend | Đọc để phục vụ tour cho widget; API quản trị ghi vào chính file này |

- **Phiên bản:** nội dung không đổi thì không tạo bản; quay về bản cũ cũng tạo bản mới, lịch sử không bị viết lại. Xóa tour xóa cả lịch sử và ảnh của nó.
- **Chuyển từ bản trước:** lần đầu ghi, `compass.tours.json` (nếu có) được chuyển vào kho rồi xóa. Trước đó nó vẫn được đọc như cũ.
- **Backend dùng file nào:** file kho của dự án (`COMPASS_PROJECT=<thư mục web hoặc file .db>`). Chạy backend trên cùng máy với Studio thì lưu tour là trợ lý dùng ngay.
- Kho nằm ngoài source nên không có trong git của web; sao lưu bằng cách chép file `.db`. Xem tour ở trang Tour của Studio. Cần xem hoặc sửa tay dạng chữ (vd. `list.index`, `rowText`): `wealthcompass tour:export --file tours.json`, sửa, rồi `wealthcompass tour:import --file tours.json`.
- Cần Node 22.5+ (`node:sqlite`).

**Backend chạy ở máy khác** (máy chủ thật): chép file kho của dự án sang và trỏ `COMPASS_PROJECT` vào đó, hoặc sửa thẳng kho trên máy chủ qua API quản trị:

```bash
# Backend: bật API quản trị bằng một khóa riêng (không phải JWT người dùng)
COMPASS_ADMIN_TOKEN=<khóa dài, ngẫu nhiên> npm run server

# CI sau tour:verify: đẩy tour đã quét kèm ảnh từng bước lên kho của máy chủ
COMPASS_ADMIN_TOKEN=<khóa> npx tsx packages/cli/src/main.ts tour:push --app ~/du-an/my-web \
  --server https://compass.example.vn --shots .compass-shots --note "verify hằng đêm"
```

API (cần `Authorization: Bearer <COMPASS_ADMIN_TOKEN>`; không đặt biến này thì API tắt):

| Đường | Việc |
|---|---|
| `GET /admin/tours` | Danh sách: phiên bản hiện tại, số phiên bản, ai sửa cuối |
| `GET /admin/tours/:id` | Bản hiện tại kèm lịch sử |
| `GET /admin/tours/:id/versions/:n` | Một phiên bản |
| `PUT /admin/tours/:id` | `{ tour, feature?, note?, by? }`: lưu bản mới |
| `POST /admin/tours/:id/rollback` | `{ version }`: quay về bản đó (thành bản mới) |
| `DELETE /admin/tours/:id` | Xóa tour và ảnh |
| `PUT /admin/tours/:id/shots/:layout/:key` | Ảnh PNG của một bước (tối đa 2 MB) |

- `feature` là tính năng sở hữu tour: quyền xem tour (`/v1/tours/:id`, `offer_tour`) theo quyền của tính năng đó.
- **Ảnh chụp phần tử** lưu trong cùng file SQLite: tour phục vụ cho widget kèm `shot` ở bước có ảnh; khi widget không chắc phần tử, nó tải ảnh bằng JWT của người dùng (`GET /v1/tours/:id/shots/:layout/:key`, cùng kiểm quyền) và hiện dưới dòng "Tìm trên màn hình". Tải lỗi hoặc quá 1,5 giây thì chỉ hiện chữ.

## 9c. Ghi nhanh hơn: phiên đăng nhập, chỉ mục source, web chưa có source

**Giữ phiên đăng nhập.** Chrome ghi tour dùng một hồ sơ riêng cho mỗi web (`~/.wealthcompass/chrome-profiles/<origin>`), nên chỉ đăng nhập lần đầu; các lần ghi sau vào thẳng. Hồ sơ chứa phiên thật của tài khoản thử và nằm ngoài dự án. `COMPASS_RECORD_PROFILE=off` để mỗi lần ghi dùng hồ sơ trắng; đặt thành một đường dẫn để dùng thư mục khác.

**Chỉ mục source (SQLite).** Phần quét tốn thời gian (đọc route, menu, template bằng ts-morph; dò cấu trúc dự án; các mục kiểm tích hợp) được lưu vào `~/.wealthcompass/index/index.db` theo dấu vân tay của source: commit `HEAD` cộng các file đang sửa dở. Mở Studio, lưu một tour, ghi lại một bước đều đọc chỉ mục; chỉ quét lại khi **có commit mới hoặc có file source sửa chưa commit**. Sửa `compass.overrides.yaml`, kho tour `compass.tours.db`, `feature-map.json` không làm chỉ mục hết hiệu lực. Trên web demo: quét đầy đủ ~850 ms, đọc chỉ mục ~3 ms, Feature Map giống hệt.

- `wealthcompass scan`, `enrich`, `setup` luôn quét đầy đủ (và ghi lại chỉ mục): dùng `scan` khi muốn ép quét lại.
- `COMPASS_INDEX=off` tắt chỉ mục; `COMPASS_INDEX_DIR` đổi chỗ lưu. Cần Node 22.5+ (`node:sqlite`); bản cũ hơn tự chạy không có chỉ mục.

**Web chưa có source.** `wealthcompass init --url <địa chỉ web>` tạo một kho dự án (`~/.wealthcompass/projects/<tên miền>.db`) với `discovery.source: none` và `web.url`. Ghi tour như thường (`tour:record --app <file kho> --id ...`, không cần `--url`, hoặc mở file kho bằng Studio):

- Màn hình trong Feature Map được dựng từ route xuất hiện trong các tour đã ghi (màn hình xuất phát, màn hình của từng bước, màn hình lúc dừng `endRoute`); tính năng đích của tour là màn hình lúc dừng.
- Route là đường dẫn thật lúc ghi. Màn hình có tham số thì khai trong `compass.overrides.yaml`: `features: { orders.detail: { route: /orders/:id, title: Chi tiết lệnh } }`. Tiêu đề, mô tả màn hình cũng điền ở đó (hoặc trang Màn hình của Studio).
- Không có quyền theo guard, không có menu, không gắn/gợi ý `tourId` (cần source). Để **chạy** tour cho người dùng thật vẫn phải gắn widget vào source bằng `setup`; trước đó dùng `tour:verify` để kiểm tour trên bản web.

## 10. Giới hạn hiện tại

- Danh sách chỉ được nhận ra khi lúc ghi có **ít nhất hai dòng**; danh sách chỉ có một dòng thì ghi như phần tử thường (vẫn tìm được, nhưng lúc chạy gặp nhiều dòng sẽ báo không chắc). Ghi lại khi có dữ liệu nhiều dòng.
- Bước mở chỗ chứa chỉ nhận ra trong cùng một màn hình (cùng route); mở menu rồi chuyển trang thì không đánh dấu.
- Studio chỉ sửa chữ của bản chính; chữ của `variants.mobile` sửa bằng `tour:export` / `tour:import`.

- Ghi **lần bấm** và **hover có chủ đích** (phím Alt hoặc nút Ghi hover); chưa ghi kéo thả, nhập liệu, phím tắt. Khóa hover không giữ được menu mà app tự đóng theo hẹn giờ hoặc khi cuộn trang.
- Cần Chrome cài trên máy; chưa hỗ trợ Firefox/Safari.
- Phần tử trong iframe khác origin hoặc shadow DOM đóng không bắt được; `tourId` sinh động (`[tourId]="item.id"`) không được quét nên cũng không dùng được.
- Câu hỏi mẫu LLM sinh ra chưa được kiểm tra tự động với bộ test truy xuất; hãy đọc lại và thử vài câu thật.
- Ghi tour vẫn là việc của người vận hành (cần Chrome có giao diện); CI chỉ **kiểm** và **tự sửa** tour (`tour:verify`).
- `tour:verify` bấm thật các bước "chờ bấm" trên bản web được chỉ định: chạy trên staging với tài khoản kiểm thử, không chạy trên bản thật.
- Kho tour chưa có giao diện quản trị riêng trong Studio; dùng `tour:push` và API `/admin/tours`.

## 11. Kiểm thử công cụ

```bash
cd ~/wealthcompass
npm run check                                              # typecheck và toàn bộ test (không cần Chrome; tour:verify, kho tour dùng trình duyệt/máy chủ giả)
COMPASS_E2E_URL=http://localhost:4200 npm run test         # thêm bài E2E dùng Chrome thật, cần web demo đang chạy
```

Bài E2E đăng nhập, ghi tour thật trên web demo, bấm cả nút BÁN để kiểm tra lần bấm đó bị chặn (hộp thoại đặt lệnh không được mở), gõ vào ô mô tả, và kiểm tra `--dry-run` không ghi file.
