# WealthCompass

*Tìm đúng tính năng, đi đúng từng bước.*

WealthCompass là trợ lý AI tích hợp trực tiếp vào web đầu tư, bao quát cổ phiếu, trái phiếu và chứng chỉ quỹ. Người dùng hỏi bằng ngôn ngữ tự nhiên, ví dụ "đặt lệnh ATC ở đâu?", "cách mua chứng chỉ quỹ" hay "bán lại trái phiếu trước hạn thế nào?". WealthCompass sẽ tìm đúng tính năng, điều hướng tới màn hình và dẫn tour từng bước ngay trên giao diện. Hệ thống tự học cấu trúc web từ source code Angular và phân quyền theo loại tài khoản cùng loại sản phẩm. Hệ thống chỉ hướng dẫn, không thao tác giao dịch hay tư vấn đầu tư.

## Cách hoạt động

1. **Lúc build (CI):** script `ts-morph` đọc source Angular (routes, menu, template) và sinh `feature-map.json`. Indexer embedding feature map vào PostgreSQL + pgvector.
2. **Lúc chạy:** widget chat trên web gửi câu hỏi kèm ngữ cảnh cho agent backend. Agent tìm trong index, gọi LLM, rồi trả về câu trả lời cùng lệnh điều hướng/tour để frontend thực thi bằng Driver.js.

## Gắn vào một web Angular

```bash
cd ~/wealthcompass && npm install && npm run pack        # đóng gói (một lần)
npm run studio                                           # mở WealthCompass Studio: làm mọi bước trên giao diện web
```

Thích dòng lệnh: `npm run setup -- --app ~/du-an/my-web`, duyệt rồi `git apply wealthcompass-setup.patch`.

Chi tiết: [docs/quickstart.md](docs/quickstart.md). Thử toàn bộ quy trình trên web mẫu: `npm run e2e:setup`.

## Tài liệu

- [Plan kỹ thuật v1](docs/technical-plan.md): bản cho một web đầu tư cụ thể
- [Bắt đầu nhanh: gắn vào web trong 3 bước](docs/quickstart.md)
- [Hướng dẫn tích hợp chi tiết (làm tay, tham khảo)](docs/integration-guide.md)
- Gắn `tourId` hàng loạt bằng `annotate` (mục 5.1) và soạn mô tả màn hình bằng `enrich` (mục 6.2b) trong hướng dẫn tích hợp
- [Ghi tour bằng `tour:record`](docs/tour-record.md): ghi thao tác thật, LLM soạn nháp tour vào overrides
- [Demo iConnect](docs/demo.md)
- [Plan kỹ thuật tổng quát](docs/universal-plan.md): áp vào bất kỳ web Angular 20+ nào, tự host, mức A có source (hợp đồng, scanner, backend tự host, Domain Pack, lộ trình)

## Trạng thái

Đã có bản demo chạy local (xem [docs/demo.md](docs/demo.md)): web Angular mô phỏng TCInvest iConnect, scanner sinh Feature Map từ source, backend tự host (JWT/JWKS, tìm kiếm, agent, chế độ dự phòng), widget chat + tour Driver.js.

```bash
npm install
npm run server   # cổng 8890
npm run demo     # cổng 4200
npm run check    # typecheck + test
```
