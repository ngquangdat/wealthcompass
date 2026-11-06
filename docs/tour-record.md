# Ghi tour hướng dẫn bằng `tour:record`

`tour:record` cho người vận hành **thao tác thật trên web** để tạo một tour, thay vì tự gõ YAML. Công cụ ghi lại những phần tử đã bấm, nhờ LLM soạn chữ và câu hỏi mẫu, rồi ghi vào `compass.tours.json` dưới dạng bản nháp (`"draft": true`) để người duyệt.

**Không cần `tourId` trong HTML.** Với mỗi lần bấm, công cụ ghi một *locator*: nhiều manh mối về phần tử (vai trò và tên truy cập, chữ, thuộc tính ổn định như `formcontrolname`/`routerlink`, thẻ component Angular, hộp thoại hay tiêu đề mục chứa nó, selector CSS dự phòng, vị trí). Lúc chạy, widget chấm điểm các ứng viên trên trang và chỉ tô sáng khi chắc chắn (xem mục 5b). Phần tử có `tourId` vẫn được ưu tiên tuyệt đối như một cái "ghim".

Tài liệu này dành cho người ghi tour. Muốn biết hệ thống tổng thể, xem [integration-guide.md](integration-guide.md); muốn chạy thử trên web demo, xem [demo.md](demo.md).

## 1. Khi nào dùng

| Tình huống | Cách làm |
| --- | --- |
| Có luồng nhiều bước qua nhiều màn hình (trang chủ → bảng giá → tab → nút) | `tour:record` |
| Sửa chữ một tour đã có | Studio (trang Tour) hoặc sửa thẳng `compass.tours.json` |
| Tour 1-2 bước rất đơn giản | Viết tay cũng nhanh |

## 2. Chuẩn bị (kiểm tra trước khi ghi)

- [ ] **Chrome** đã cài trên máy. Công cụ dùng Chrome có sẵn, không tải trình duyệt riêng. Chrome ở chỗ khác thì đặt `CHROME_PATH=/duong/dan/toi/chrome`.
- [ ] **Web đang chạy** và có tài khoản đăng nhập được. **Ghi trên môi trường thử/staging với tài khoản thử**, vì mọi lần bấm không nhạy cảm vẫn chạy thật trên web (xem mục 5).
- [ ] **Không bắt buộc** gắn `tourId`. Chỉ nên ghim `tourId` cho vài phần tử quan trọng hay có chữ trùng nhau (xem mục 5b).
- [ ] Mọi nút **gây thay đổi dữ liệu hay tiền** (đặt lệnh, xác nhận, hủy lệnh, chuyển tiền) được nhận ra là nhạy cảm: hoặc có `tourRole="user-only"`/`data-sensitive`, hoặc chữ trên nút khớp `safety.userOnlyText` trong `compass.config.yaml` (vd. `[đặt lệnh, xác nhận lệnh]`). Nút đó bị chặn khi ghi nên không vô tình chạy. Truyền cùng danh sách cho widget qua `provideCompass({ safety: { userOnlyText } })`.
- [ ] Đã chạy **`scan`** để có `feature-map.json` (công cụ lấy nhãn và tính năng đích từ đó). Trong repo này: `npm run scan`.
- [ ] (Tùy chọn) Khóa LLM. Không có khóa vẫn ghi được, chữ sẽ theo mẫu. Thứ tự tìm khóa: `COMPASS_LLM_API_KEY` → biến theo nhà cung cấp (`DEEPSEEK_API_KEY` mặc định, `GOOGLE_API_KEY` nếu `COMPASS_LLM_PROVIDER=gemini`) → đúng biến đó trong file chỉ định bởi `COMPASS_ENV_FILE` (nếu đặt). Ví dụ dùng chung khóa với dự án khác: `export COMPASS_ENV_FILE=~/du-an-khac/.env`.

## 3. Lệnh

**Phải chạy trong thư mục repo** (`cd ~/wealthcompass`). Chạy ở thư mục khác sẽ gặp `npm error ENOENT ... package.json`.

```bash
cd ~/wealthcompass
npm run tour:record -- --url http://localhost:4200 --id sell-bond --about "Hướng dẫn khách bán trái phiếu đang nắm giữ" --dry-run
```

Dấu `--` đứng riêng là bắt buộc: nó tách tham số của `npm` khỏi tham số của công cụ.

Script `tour:record` trong `package.json` đã gắn sẵn `--config examples/iconnect-demo/compass.config.yaml`. Với web khác, gọi trực tiếp:

```bash
npx tsx packages/cli/src/main.ts tour:record --config duong/dan/compass.config.yaml --url https://staging.congty.vn --id sell-bond
```

| Cờ | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `--url` | có | Địa chỉ web mở trong Chrome |
| `--id` | có | Id của tour (khóa dưới `tours:` trong YAML). Dạng `ban-trai-phieu` hoặc `sell-bond`; đừng đổi sau khi đã phát hành |
| `--config` | không | File `compass.config.yaml` của web (xác định nơi ghi overrides và feature map). Mặc định `compass.config.yaml` ở thư mục đang đứng; script `npm run tour:record` đã gắn sẵn cấu hình của web demo |
| `--about "..."` | không, nhưng nên có | Mô tả đang ghi tour cho tính năng gì. Có thể gõ hoặc sửa tiếp trong khung ghi |
| `--title "..."` | không | Ép tiêu đề tour; bỏ qua thì LLM đặt |
| `--feature <id>` | không | Tính năng đích (id trong Feature Map, như `iconnect.assets`). Bỏ qua thì tự suy ra theo màn hình lúc dừng ghi |
| `--dry-run` | không | In YAML ra màn hình, **không ghi file** |
| `--force` | không | Cho phép ghi đè tour trùng `--id` |
| `--no-llm` | không | Không gọi LLM, chữ theo mẫu |

## 4. Quy trình từng bước

1. **Chạy lệnh.** Chrome mở tới `--url`; ở góc trái dưới có một khung nhỏ **"WealthCompass · ghi tour"**.
2. **Đăng nhập** và đi tới **màn hình xuất phát** của tour (thường là trang chủ). Lúc này chưa ghi gì.
3. **Mô tả tính năng** vào ô *"Bạn đang ghi tour cho tính năng gì?"*, một hai câu: cho ai, làm việc gì, kết thúc ở đâu. Ví dụ: *"Hướng dẫn khách xem sổ lệnh trái phiếu để theo dõi và hủy lệnh đã đặt"*. Đây là thông tin LLM tin nhất; viết rõ thì chữ và câu hỏi mẫu sinh ra đúng hơn nhiều.
4. Bấm **● Bắt đầu ghi**. Màn hình hiện tại trở thành điểm bắt đầu (`startRoute`) của tour.
5. **Thao tác đúng luồng muốn dẫn**, từng phần tử một. Phần tử vừa được ghi sẽ nhấp nháy viền đỏ; khung hiện số bước đã ghi và phần tử gần nhất.
6. Đi tới **màn hình đích** (nơi người dùng sẽ làm việc cần làm), rồi bấm **■ Dừng & lưu**. Tính năng đích của tour được xác định theo màn hình bạn đang đứng lúc dừng. Nếu chưa có mô tả, khung nhắc một lần; bấm lại để vẫn dừng.
7. Công cụ soạn nội dung, ghi tour vào `compass.tours.json` (câu hỏi mẫu vào `compass.overrides.yaml`), rồi tự chạy lại `scan` để xác nhận tour hợp lệ. Xem phần tiếp theo để duyệt.

**Đóng cửa sổ Chrome** sau khi đã bấm "Bắt đầu ghi" cũng được coi như dừng và vẫn lưu các bước đã ghi, nhưng khi đó công cụ không biết màn hình đích nên chọn theo bước cuối cùng, dễ gán sai tính năng. Nên luôn bấm **■ Dừng & lưu**.

### Các nút trong khung ghi

| Nút | Tác dụng |
| --- | --- |
| **● Bắt đầu ghi** | Bắt đầu ghi (chỉ hiện khi chưa ghi). Màn hình hiện tại là điểm xuất phát |
| **■ Dừng & lưu** | Kết thúc và chuyển sang bước soạn nội dung |
| **Tô sáng (không bấm): tắt/BẬT** | Công tắc. Khi **BẬT**, mọi lần bấm vào phần tử có `tourId` được ghi thành bước chỉ giải thích và **bị chặn, app không chạy gì**. Dùng khi muốn trỏ vào một con số hay một khu vực mà không chuyển màn hình. **Nhớ tắt lại** (bấm lần nữa) để tiếp tục thao tác bình thường; quên tắt thì app đứng yên vì mọi lần bấm đều bị chặn |

## 5. Điều gì được ghi, điều gì bị chặn

- **Chỉ ghi lần bấm**. Bấm trúng icon/chữ bên trong nút thì phần tử được ghi là chính cái nút. Chữ gõ vào ô nhập, cuộn, hover, kéo thả **không** được ghi.
- Bấm bình thường → ghi thành bước `click` (người dùng thật sẽ phải bấm vào đúng chỗ đó), và **app vẫn chạy bình thường** (đổi màn hình, đổi tab...). Đó là lý do cần ghi trên môi trường thử.
- Bấm vào phần tử **nhạy cảm** (`tourRole="user-only"`, `data-sensitive`, ô mật khẩu, ô OTP) → ghi thành bước chỉ-tô-sáng (`next`) và **lần bấm bị chặn, không chạy thật**. Nhờ vậy ghi tour không vô tình đặt lệnh. Bước nhạy cảm nên là **bước cuối** của tour; nếu còn bước sau nó, công cụ in cảnh báo.
- Bấm vào phần tử **không có manh mối nào dùng được** (không tên, không chữ, không thuộc tính ổn định, vd. một `div` trống) → bị bỏ qua (app vẫn chạy) và có cảnh báo. Thêm `aria-label` hoặc `tourId` cho phần tử đó nếu cần bước này.
- **Không ghi dữ liệu cá nhân**: chữ trong vùng `data-sensitive`, chuỗi gần như toàn số (số dư, khối lượng) và chữ có email/số điện thoại/số giấy tờ bị bỏ; `href` chỉ giữ đường dẫn, bỏ query; id/class sinh tự động (`_ngcontent-*`, `mat-mdc-*`, `cdk-*`, `input-2`) không được dùng.
- Bấm đúp vào cùng một phần tử chỉ tính một bước.

## 5b. Widget tìm lại phần tử thế nào

Mỗi bước chấm điểm các ứng viên trên trang: tên truy cập khớp (5), `formcontrolname`/`routerlink`/`data-testid`/`id` khớp (4 mỗi cái), chữ (3), cùng component (2), cùng hộp thoại (2), cùng tiêu đề mục (1,5), selector CSS (1,5), vị trí gần (tối đa 1). Thuộc tính mạnh khác giá trị bị trừ điểm. Trọng số nằm trong `packages/core/src/locator.ts`.

| Kết quả | Widget làm gì |
| --- | --- |
| Có `tourId` và tìm thấy | Tô sáng, như trước |
| Điểm ≥ 6 và hơn ứng viên thứ hai ≥ 2 | Tô sáng phần tử |
| Có ứng viên nhưng không đủ chắc (vd. mỗi dòng bảng có một nút **BÁN** giống hệt nhau) | Hiện popover giữa màn hình kèm "Tìm trên màn hình: …", **không tô sáng** phần tử có thể sai; báo `low_confidence` |
| Không có ứng viên | Dừng tour, báo `target_missing` như trước |

Bước tìm bằng locator gửi telemetry `tour_step` (khóa bước, manh mối đã khớp, điểm) để thấy tour nào đang yếu trước khi nó hỏng hẳn. Ứng dụng có nhiều nút trùng chữ thì ghim `tourId` cho riêng phần tử đó.

## 6. Kết quả và cách duyệt

Lần chạy thật (không `--dry-run`) in ra dạng như sau (ví dụ; số bước và số câu hỏi mẫu tùy lần ghi):

```
! Bỏ qua lần bấm vào <div> ở /iconnect/orders: phần tử không có tên, chữ hay thuộc tính ổn định để tìm lại. Thêm aria-label hoặc tourId nếu cần bước này.
  · /home: link "Giao dịch iConnect" · app-home-page
  · /iconnect/price-board: link "Sổ lệnh" · app-iconnect-shell
Soạn nội dung bằng LLM (deepseek / deepseek-v4-flash)...
Đã ghi tour "orders-tour" (2 bước) vào .../examples/iconnect-demo/compass.tours.json, thêm 6 câu hỏi mẫu vào .../compass.overrides.yaml
✔ scan: tour "orders-tour" hợp lệ.
  - Tour "orders-tour" là nháp (LLM soạn), chưa duyệt: đọc lại chữ rồi xóa "draft" trong compass.tours.json
```

Tour được thêm vào `compass.tours.json` (file dữ liệu, **không sửa template**). Ví dụ rút gọn từ một lần ghi thật trên web demo:

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

- [ ] **Đọc lại chữ từng bước.** LLM soạn nháp, có thể sai chi tiết hay giọng văn; sửa trong Studio (trang Tour) hoặc trực tiếp trong `compass.tours.json`.
- [ ] **`feature:` đúng tính năng đích?** Sai thì trợ lý sẽ gắn tour vào nhầm màn hình. Sửa tay hoặc ghi lại với `--feature <id> --force`.
- [ ] **`advanceOn` hợp lý?** `click` = người dùng tự bấm vào phần tử sáng; `next` = bấm nút "Tiếp" của popover. Bước nhạy cảm phải là `next`.
- [ ] **Câu hỏi mẫu** mới thêm: xóa câu nghe lạ, giữ câu người dùng thật sẽ gõ.
- [ ] **Xóa `"draft": true`** sau khi duyệt xong (bấm Lưu trong Studio cũng xóa cờ này).
- [ ] Chạy **`npm run scan -- --strict`**: phải không còn cảnh báo.
- [ ] **Thử tour thật**: chạy web, mở chat, hỏi đúng câu liên quan, bấm "Dẫn tôi đi" và đi hết các bước.
- [ ] Commit `compass.tours.json`, `compass.overrides.yaml` cùng `feature-map.json` và `compass.lock.json`.

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
| Bấm nhiều nhưng khung báo "Đã ghi 0 bước" | Chưa bấm **● Bắt đầu ghi**, hoặc phần tử chưa có `tourId` (xem cảnh báo "Bỏ qua lần bấm...") |
| App không phản ứng khi bấm | Công tắc **Tô sáng** đang BẬT: bấm nút đó lần nữa để tắt |
| `! Bỏ qua lần bấm vào <tag> "..." ở /route: chưa có tourId` | Phần tử chưa có `tourId`. Thêm `tourId="..."` vào template, rồi ghi lại nếu muốn có bước đó |
| `Không có bước nào gắn tourId, không có gì để lưu.` | Mọi lần bấm đều vào phần tử chưa có `tourId` |
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

## 10. Giới hạn hiện tại

- Danh sách/bảng có nhiều phần tử giống hệt nhau (mỗi dòng một nút) chưa có cách nói "dòng nào cũng được": bước đó hiện dạng popover không gắn phần tử. Sẽ có `scope`/`match: any` ở đợt sau.
- Mỗi tour ghi ở một bố cục (desktop hoặc mobile, ghi trong `locator.layout`); chưa gộp hai bố cục thành biến thể của cùng tour. Thường vẫn chạy được ở bố cục kia nếu tên và thuộc tính phần tử giống nhau.

- Chỉ ghi **lần bấm** (chuột); chưa ghi hover, kéo thả, nhập liệu, phím tắt.
- Cần Chrome cài trên máy; chưa hỗ trợ Firefox/Safari.
- Phần tử trong iframe khác origin hoặc shadow DOM đóng không bắt được; `tourId` sinh động (`[tourId]="item.id"`) không được quét nên cũng không dùng được.
- Câu hỏi mẫu LLM sinh ra chưa được kiểm tra tự động với bộ test truy xuất; hãy đọc lại và thử vài câu thật.
- Chưa có chế độ ghi không giao diện (headless) cho CI; ghi tour là việc của người vận hành.

## 11. Kiểm thử công cụ

```bash
cd ~/wealthcompass
npm run check                                              # typecheck và toàn bộ test (không cần Chrome)
COMPASS_E2E_URL=http://localhost:4200 npm run test         # thêm bài E2E dùng Chrome thật, cần web demo đang chạy
```

Bài E2E đăng nhập, ghi tour thật trên web demo, bấm cả nút BÁN để kiểm tra lần bấm đó bị chặn (hộp thoại đặt lệnh không được mở), gõ vào ô mô tả, và kiểm tra `--dry-run` không ghi file.
