# OneAI API - Serverless Sync Backend

API serverless trên Vercel để đồng bộ dữ liệu OneAI Usage Tracker giữa các máy tính.

## 🚀 Deployment Status

- **Production URL**: `https://one-ai-extension.vercel.app`
- **API Base**: `https://one-ai-extension.vercel.app/api/data`
- **Test Interface**: `https://one-ai-extension.vercel.app/`
- **Health Check**: `https://one-ai-extension.vercel.app/api/health`

## 📡 API Endpoints

### Authentication
Tất cả requests cần header: `X-Auth-Token: b75d8f44f4d54d1abf1d8fc3d1e0b9a3`

### GET `/api/data/:employeeCode`
Lấy dữ liệu tháng cho nhân viên

**Parameters:**
- `employeeCode`: Mã nhân viên (path parameter)
- `period`: Tháng định dạng YYYY-MM (query parameter)

**Example:**
```bash
curl -H "X-Auth-Token: b75d8f44f4d54d1abf1d8fc3d1e0b9a3" \
  "https://one-ai-extension.vercel.app/api/data/NV123?period=2025-09"
```

**Response:**
- `200 OK`: Trả về dữ liệu JSON
- `404 Not Found`: Trả về `{}` nếu chưa có dữ liệu
- `400 Bad Request`: Period không hợp lệ
- `401 Unauthorized`: Token không đúng

### POST `/api/data/:employeeCode`
Lưu/cập nhật dữ liệu tháng

**Parameters:**
- `employeeCode`: Mã nhân viên (path parameter)  
- `period`: Tháng định dạng YYYY-MM (query parameter)

**Body:**
```json
{
  "stats": {
    "2025-09-18": 5,
    "2025-09-17": 3
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

**Example:**
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-Auth-Token: b75d8f44f4d54d1abf1d8fc3d1e0b9a3" \
  -d '{"stats":{"2025-09-18":3},"history":{"2025-09-18":[]}}' \
  "https://one-ai-extension.vercel.app/api/data/NV123?period=2025-09"
```

**Response:**
- `200 OK`: `{"status": "success"}`
- `400 Bad Request`: Lỗi validation
- `401 Unauthorized`: Token không đúng

## 🗂️ Data Storage

### File Structure
```
/tmp/oneai_data/
├── NV123/
│   ├── 2025-09.json
│   ├── 2025-08.json
│   └── ...
└── NV456/
    ├── 2025-09.json
    └── ...
```

### JSON Schema
```json
{
  "type": "object",
  "properties": {
    "stats": {
      "type": "object",
      "patternProperties": {
        "^\\d{4}-\\d{2}-\\d{2}$": {"type": "number"}
      }
    },
    "history": {
      "type": "object", 
      "patternProperties": {
        "^\\d{4}-\\d{2}-\\d{2}$": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "timestamp": {"type": "number"},
              "messageId": {"type": "string"},
              "message": {"type": "string"},
              "modelCode": {"type": "string"}
            }
          }
        }
      }
    }
  }
}
```

## 🔧 Development

### Local Development
```bash
npm install
vercel dev
```

Server sẽ chạy tại `http://localhost:3000`

### Environment Variables
Set trong Vercel Project Settings:
- `API_SECRET_KEY`: Secret key cho authentication

### Test Interface
Truy cập `/` để sử dụng giao diện test:
- Điền Employee Code, Period, Token
- Test GET/POST requests
- Xem response trực tiếp

## 🚀 Deployment

### Vercel CLI
```bash
# Link project (chỉ lần đầu)
vercel link --project one-ai-extension

# Deploy production
vercel --prod --yes
```

### Environment Setup
1. Vào Vercel Dashboard → Project Settings
2. Environment Variables → Add New
3. Name: `API_SECRET_KEY`
4. Value: `b75d8f44f4d54d1abf1d8fc3d1e0b9a3`
5. Environment: Production
6. Save → Redeploy

### Custom Domain
Project đã có alias cố định: `one-ai-extension.vercel.app`
→ URL không thay đổi khi redeploy

## 🔒 Security

### Authentication
- **Method**: Shared secret trong header
- **Header**: `X-Auth-Token`
- **Key**: `b75d8f44f4d54d1abf1d8fc3d1e0b9a3`

### CORS Policy
```javascript
// Cho phép tất cả origins (Chrome Extensions)
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token');
res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
```

### ⚠️ Security Notes
- Secret key có thể bị lộ từ client-side extension
- Chỉ dùng cho demo/non-critical applications
- Consider JWT authentication cho production

## 📊 Monitoring

### Health Check
```bash
curl https://one-ai-extension.vercel.app/api/health
# Response: {"ok": true}
```

### Debug Endpoint
```bash
curl https://one-ai-extension.vercel.app/api/debug
# Response: {"hasSecret": true, "secretLength": 32, "env": "production"}
```

### Logs
- Vercel Dashboard → Project → Functions tab
- Xem real-time logs và errors
- Monitor performance metrics

## 🧪 Testing

### Manual Testing
1. Truy cập `https://one-ai-extension.vercel.app/`
2. Điền form với thông tin test
3. Click GET/POST để test endpoints
4. Verify response status và data

### cURL Testing
```bash
# Test GET (empty data)
curl -i -H "X-Auth-Token: b75d8f44f4d54d1abf1d8fc3d1e0b9a3" \
  "https://one-ai-extension.vercel.app/api/data/TEST?period=2025-09"

# Test POST (save data)  
curl -i -X POST \
  -H "Content-Type: application/json" \
  -H "X-Auth-Token: b75d8f44f4d54d1abf1d8fc3d1e0b9a3" \
  -d '{"stats":{"2025-09-01":1},"history":{"2025-09-01":[]}}' \
  "https://one-ai-extension.vercel.app/api/data/TEST?period=2025-09"

# Test GET (with data)
curl -i -H "X-Auth-Token: b75d8f44f4d54d1abf1d8fc3d1e0b9a3" \
  "https://one-ai-extension.vercel.app/api/data/TEST?period=2025-09"
```

## 🔄 API Versioning

### Current Version: v1
- Base endpoints: `/api/data/`
- Compatible với OneAI Extension v1.1.0+

### Future Considerations
- `/api/v2/` cho breaking changes
- Backward compatibility support
- Migration endpoints

## 📋 Changelog

### v1.2 (Current)
- ✅ CORS fix cho Chrome Extensions
- ✅ URL cố định với Vercel alias
- ✅ Environment variables support

### v1.1
- ✅ Express.js serverless implementation
- ✅ File-based storage trong /tmp
- ✅ Authentication với shared secret

### v1.0
- ✅ Basic GET/POST endpoints
- ✅ JSON data validation
- ✅ Error handling

## 🤝 Contributing

1. Fork repository
2. Tạo feature branch
3. Test thoroughly với manual + cURL
4. Update documentation
5. Submit pull request

## 📞 Support

- **Issues**: GitHub Issues
- **Docs**: [Main README](../README.md)
- **Memory Bank**: [MEMORY-BANK.md](../MEMORY-BANK.md)

