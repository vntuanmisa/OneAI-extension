# OneAI Usage Tracker Extension v1.1.0

Extension Chrome theo dõi và thống kê việc sử dụng OneAI với tính năng đồng bộ dữ liệu.

## Tính năng

### Core
- Theo dõi tự động số lần sử dụng OneAI theo nhân viên và ngày
- Lọc tin nhắn dựa trên độ dài và từ khóa
- Calendar view hiển thị thống kê hàng tháng
- Xuất lịch sử sử dụng thành file HTML

### Đồng bộ dữ liệu (v1.1.0)
- Tự động đồng bộ dữ liệu lên server khi có sử dụng mới
- Tải dữ liệu từ server khi khởi động extension
- Lazy loading dữ liệu tháng cũ khi xem calendar
- Merge thông minh giữa dữ liệu local và server

## Cài đặt

1. Mở Chrome → Gõ `chrome://extensions/`
2. Bật "Developer mode" (góc trên bên phải)
3. Chọn "Load unpacked" và chọn thư mục extension này
4. Extension sẽ xuất hiện trên thanh công cụ

## Cấu hình API

API endpoint: `https://one-ai-extension-mkwh339q0-amismakts-projects.vercel.app/api/data`

Để thay đổi API endpoint, sửa file `config.js`:
```js
export const API_BASE_URL = 'https://your-domain.vercel.app/api/data';
export const API_SECRET_KEY = 'your-secret-key';
```

## Sử dụng

1. Sử dụng OneAI bình thường tại https://misajsc.amis.vn/oneai/
2. Extension tự động theo dõi và đồng bộ dữ liệu
3. Click icon extension để xem thống kê
4. Chuyển tháng để xem lịch sử cũ (tự động load từ server)

## Cấu trúc dữ liệu đồng bộ

```json
{
  "stats": {
    "2025-09-18": 5
  },
  "history": {
    "2025-09-18": [
      {
        "timestamp": 1726653600000,
        "messageId": "msg123",
        "message": "Câu hỏi demo",
        "modelCode": "gpt"
      }
    ]
  }
}
```

## Bảo mật

⚠️ **Lưu ý**: API_SECRET_KEY được lưu trong extension (client-side) nên có thể bị lộ. Chỉ dùng cho mục đích demo hoặc môi trường không quan trọng về bảo mật.

## Version History

- **v1.1.0**: Thêm tính năng đồng bộ API
- **v1.0.0**: Phiên bản cơ bản với tracking và calendar
