# Demo: trợ lý tìm chức năng "Bán trái phiếu" trên web mô phỏng TCInvest iConnect

Demo chạy local, không cần Docker hay Helm. Gồm 3 phần chạy cùng nhau:

| Phần | Việc làm | Cổng |
| --- | --- | --- |
| `examples/iconnect-demo` | Web Angular 22 mô phỏng giao diện mobile của TCInvest (đăng nhập, trang chủ, bảng giá iConnect, tab Tài sản). Đã gắn `provideCompass()` và các `tourId` | 4200 |
| `server` | Backend WealthCompass: xác minh JWT bằng JWKS, tìm kiếm, agent LLM, SSE | 8890 |
| IdP giả lập | Nằm trong `server` (`/idp/*`), đóng vai hệ thống đăng nhập của khách để cấp JWT | 8890 |

## Chạy

```bash
npm install
npm run scan      # quét source Angular -> examples/iconnect-demo/feature-map.json (đã commit sẵn)
npm run server    # terminal 1
npm run demo      # terminal 2, rồi mở http://localhost:4200
```

Tài khoản demo (IdP giả lập, không phải tài khoản thật): `demo` / `demo123` có đủ quyền; `nobond` / `demo123` không có quyền trái phiếu để thử nhánh thiếu quyền.

## Luồng demo

1. Đăng nhập, vào **Trang chủ**.
2. Bấm bong bóng chat ở góc phải, hỏi "Bán trái phiếu ở đâu?".
3. Trợ lý trả lời bằng chữ (đường đi, các bước) kèm nút **Dẫn tôi đi: Bán trái phiếu trên iConnect**.
4. Bấm nút: tour bắt đầu từ trang chủ, highlight **Giao dịch iConnect** → tab **Tài sản** → **CHỌN BÁN** → nút **BÁN**. Ba bước đầu chờ bạn tự bấm vào phần được tô sáng; bước cuối chỉ highlight nút BÁN (nhạy cảm, engine không chạm), bạn tự bấm và tự đặt lệnh.

Các câu hỏi khác để thử: "nộp tiền vào tài khoản", "xem lãi lỗ trái phiếu", "hủy lệnh đã đặt" (có nút mở màn hình, không có tour); "có nên mua VHM12607 không" (bị từ chối trước khi gọi LLM); đăng nhập `nobond` rồi hỏi bán trái phiếu (giải thích thiếu quyền).

## Cấu hình LLM

Xem `server/.env.example`. Mặc định server dùng Gemini qua endpoint tương thích OpenAI, khóa lấy theo thứ tự `COMPASS_LLM_API_KEY` → `GOOGLE_API_KEY` → biến `GOOGLE_API_KEY` trong `~/tcbs-agent/.env` (chỉ đọc đúng biến đó). Đổi sang DeepSeek hay model on-prem bằng `COMPASS_LLM_BASE_URL` + `COMPASS_LLM_MODEL` + `COMPASS_LLM_API_KEY`.

**Chế độ dự phòng:** khi LLM lỗi (hết hạn mức, mất mạng), agent vẫn trả lời từ bản đồ tính năng (đường đi, các bước, nút tour) và ghi chú rõ "chế độ dự phòng". `GET /v1/health` cho biết cấu hình LLM; log server ghi `chat_error` khi gọi LLM thất bại.

## Kiểm thử

```bash
npm run check   # tsc cho server và core, test scanner (7) và agent (9)
```

Test agent dùng LLM giả (`server/src/test/mock-llm.ts`) nên không tốn hạn mức và kiểm được: tool-calling, whitelist tourId, thiếu quyền, chặn tư vấn đầu tư, che PII, chế độ dự phòng.

## Giới hạn của demo

- Giao diện mô phỏng bản **mobile** của TCInvest (bố cục 430px, căn giữa trên màn hình rộng), dựa trên ảnh chụp và số đo màu/cỡ chữ. Icon dùng Material Icons thay cho bộ icon riêng; banner khuyến mãi và linh vật không được sao chép; mọi số liệu là dữ liệu giả. Bản desktop (menu trái, nhiều cột) chưa làm.
- Màn hình đặt lệnh bán chỉ là hộp thoại giải thích; các màn hình khác (nộp tiền, sổ lệnh...) là trang giữ chỗ nhưng vẫn có route, tiêu đề, mô tả để trợ lý chỉ đường tới.
- Tìm kiếm hiện là từ khóa (BM25) + từ điển đồng nghĩa của Domain Pack; chưa có embedding/pgvector. Giao diện `FeatureStore` tách riêng nên thay được.
- Rate limit và log nằm trong bộ nhớ/stdout; chưa có dashboard, eval hit@3 tự động và E2E Playwright cho tour.
