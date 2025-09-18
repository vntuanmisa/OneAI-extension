## OneAI Usage Tracker (Chrome Extension)

Theo dõi và thống kê số lần sử dụng OneAI tại `https://misajsc.amis.vn/oneai` theo nhân viên và theo ngày. Một "lần sử dụng thành công" được tính khi request log/monitor xác nhận client đã nhận token để bắt đầu sinh câu trả lời.

### Memory Bank (Logic cốt lõi)
- **Điểm kích hoạt**: Chỉ ghi nhận khi bắt được request `.../api/system/*/log/monitor` có `CustomType: 3` và `StepName: "Client_ReveiceTokenToGenerate"`; hỗ trợ fast-track đếm các model đến muộn trong 10 phút.
- **Nhận dạng người dùng**: `employeeCode` lấy từ request gửi câu hỏi `.../chats/streaming` và liên kết qua `messageId`.
- **Logic lọc**: Một câu hỏi là không hợp lệ nếu đồng thời: (1) tổng số từ < ngưỡng (mặc định 5), và (2) chứa ít nhất một từ/cụm từ trong danh sách chặn (mặc định: `cảm ơn`, `xin chào`, `tạm biệt`).
- **Lưu trữ**: `chrome.storage.session` dùng để lưu tạm `[messageId -> employeeCode]`, `chrome.storage.local` lưu thống kê dài hạn và cài đặt.

### Cấu trúc tệp
- `manifest.json`: MV3, quyền `storage`, `webRequest`, `alarms`, `notifications`, `host_permissions` cho OneAI.
- `background.js`: Service worker lắng nghe request, xử lý 2 bước, lọc, tăng bộ đếm, badge, nhắc nhở theo `reminderTimes` (HH:MM), ghi lịch sử.
- `popup.html`, `popup.css`, `popup.js`: Popup hiển thị lịch theo tháng. Nhấn vào số trong ô ngày để xem lịch sử ghi nhận của ngày đó (giờ, message, modelCode). Cho phép chuyển tháng.
- `options.html`, `options.js`: Trang cài đặt. Cho phép bật/tắt cảnh báo, chỉ tiêu/ngày, ngưỡng số từ, danh sách từ khóa chặn, và nhập nhiều mốc nhắc dạng `HH:MM` (ví dụ: `4:30, 16:30`).

### Cách hoạt động
1. Bắt request `.../chats/streaming`, trích `employeeCode`, `messageId`, `message`.
2. Áp dụng lọc. Nếu hợp lệ, lưu pending entry vào `storage.session` (hỗ trợ nhiều `modelCode`) và ghi `currentEmployeeCode` vào `storage.local`.
3. Bắt request `.../log/monitor` thỏa `CustomType:3`, `StepName:"Client_ReveiceTokenToGenerate"` và có `messageId` -> đánh dấu `successStarted`, consume mọi pending của `messageId`, tăng thống kê, ghi lịch sử.

### Cấu hình & Badge
- Mặc định: `wordMinThreshold=5`, `blockedKeywords=['cảm ơn','xin chào','tạm biệt']`, `dailyGoal=6`, `alertsEnabled=true`, `reminderTimes=['10:00','14:00','16:00','17:00']`.
- Badge icon hiển thị tổng số lần hôm nay của nhân viên hiện tại: xanh khi đã đạt chỉ tiêu, đỏ khi chưa.
- Nếu bật cảnh báo, tiện ích kiểm tra mỗi phút; khi giờ:phút hiện tại trùng một mốc trong `reminderTimes` và chưa đạt chỉ tiêu, sẽ hiển thị thông báo nhắc.

### Checklist Đồng bộ hóa Tài liệu
- [x] README.md: Mô tả logic lọc và quy trình ghi nhận thành công.
- [x] Comment trong `background.js`: Giải thích quy trình 2 bước và key points.

### Build & Kiểm thử
1. Lưu toàn bộ thay đổi.
2. Mở Chrome → `chrome://extensions`.
3. Bật Developer mode.
4. Load unpacked thư mục `EXAI` hoặc Reload nếu đã nạp.
5. Mở `https://misajsc.amis.vn/oneai` và kiểm thử:
   - Câu hỏi ngắn và chứa từ khóa chặn (ví dụ: "Cảm ơn bạn"): không ghi nhận.
   - Câu hỏi ngắn nhưng không chứa từ khóa chặn (ví dụ: "Tiếp tục"): ghi nhận khi có request confirm log/monitor.
   - Câu hỏi dài hợp lệ: ghi nhận khi có request confirm log/monitor.
   - Kiểm tra badge và popup cập nhật theo ngày.
   - Điều chỉnh ngưỡng/từ khóa trong Options và kiểm tra lại.

### Đóng gói để phát hành (Chrome Web Store)
1. Đảm bảo `manifest.json` có `name`, `short_name`, `version`, `version_name`, `description`, `icons` đầy đủ.
2. Tạo file ZIP từ toàn bộ thư mục dự án (không bao gồm `.git`, tệp tạm).
3. Chuẩn bị tài sản hình ảnh theo `ASSET_GUIDE.md`.
4. Soạn mô tả và metadata theo `CHROME_STORE_DESCRIPTION.md`.
5. Cung cấp chính sách trong `PRIVACY_POLICY.md` và `SUPPORT.md`.
6. Tải lên Dashboard nhà phát triển và điền thông tin phân phối.


