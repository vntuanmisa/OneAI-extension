# Changelog

Tất cả thay đổi quan trọng của OneAI Usage Tracker sẽ được ghi nhận trong file này.

## [v1.1.2] - 2025-09-18 (CURRENT)

### 🎉 CORS Fix & Production Ready
- ✅ **Fix CORS** cho Chrome Extension với `Access-Control-Allow-Origin: *`
- ✅ **URL cố định** với Vercel alias `one-ai-extension.vercel.app`
- ✅ **Production deployment** ổn định với environment variables
- ✅ **Final build** `oneai-extension-v1.1.2-final.zip`

### Technical Changes
- API CORS middleware đơn giản hóa để hỗ trợ tất cả origins
- Loại bỏ section `env` trong `vercel.json` để load biến môi trường từ UI
- Extension config trỏ về URL cố định không đổi

### API Updates
- **Production URL**: `https://one-ai-extension.vercel.app`
- **API Endpoints**: `/api/data/:employeeCode?period=YYYY-MM`
- **CORS**: Hỗ trợ đầy đủ Chrome Extension requests

---

## [v1.1.0] - 2025-09-18

### 🚀 API Sync Integration
- ✅ **Serverless API** trên Vercel với Express.js
- ✅ **Tự động đồng bộ** dữ liệu sau mỗi lần sử dụng OneAI
- ✅ **Lazy loading** dữ liệu tháng cũ từ server
- ✅ **Merge thông minh** giữa local và remote data

### New Features
- **API Backend**:
  - GET/POST endpoints với authentication
  - File-based storage trong `/tmp/oneai_data/`
  - CORS support cho Chrome Extensions
  - Test interface tại root URL

- **Extension Sync**:
  - Auto fetch dữ liệu khi khởi động (onInstalled/onStartup)
  - Auto push dữ liệu sau khi ghi nhận thành công
  - Message listener cho lazy loading từ popup
  - Merge strategy: max cho stats, concat cho history

### API Endpoints
```
GET  /api/data/:employeeCode?period=YYYY-MM  # Lấy dữ liệu tháng
POST /api/data/:employeeCode?period=YYYY-MM  # Lưu dữ liệu tháng
GET  /api/health                             # Health check
GET  /api/debug                              # Environment debug
```

### File Structure
```
├── oneai-api/              # API serverless code
└── oneai-extension/        # Extension với sync features
```

---

## [v1.0.0] - 2025-09-17

### 🎊 Initial Release
- ✅ **Automatic tracking** số lần sử dụng OneAI theo nhân viên
- ✅ **Two-step detection** với streaming + monitor requests
- ✅ **Smart filtering** dựa trên word count và blocked keywords
- ✅ **Calendar UI** hiển thị thống kê theo tháng

### Core Features
- **Background Service Worker**:
  - Intercept OneAI requests với webRequest API
  - Two-step success detection (streaming → monitor)
  - Session-based pending management với TTL
  - Badge counter và notification system

- **Popup Interface**:
  - Monthly calendar view với color coding
  - Daily history details với expand/collapse
  - Export lịch sử ngày thành HTML
  - Navigation: previous/next month, today button

- **Options Page**:
  - Cấu hình dailyGoal, reminderTimes
  - Tùy chỉnh bộ lọc: wordMinThreshold, blockedKeywords
  - Enable/disable notifications

### Data Storage
- **Local Storage**: settings, stats, history, currentEmployeeCode
- **Session Storage**: pendingMap, successStarted, monitorProcessed
- **In-memory Buffer**: memoryPending để tránh race conditions

### Smart Features
- **Message Filtering**: Lọc tin nhắn ngắn + blocked keywords
- **Duplicate Prevention**: Chống đếm lặp với TTL-based tracking
- **Employee Switching**: Tự động detect employee từ requests
- **Reminder System**: Multi-time reminders với flexible format

---

## 🛠️ Development Notes

### v1.1.x Series - API Integration
Focus: Đồng bộ dữ liệu giữa máy tính với serverless backend

**Challenges Solved:**
- CORS policy cho Chrome Extension origins
- Serverless function limitations với file storage
- Environment variables loading trong Vercel
- URL stability với deployment aliases

### v1.0.x Series - Core Tracking  
Focus: Local tracking với Chrome Extension APIs

**Key Decisions:**
- Manifest V3 với service worker
- Two-step detection để đảm bảo độ chính xác
- Session + local storage cho reliability
- Modern UI với CSS Grid cho calendar

---

## 📋 Migration Guide

### Từ v1.0.x → v1.1.x
1. **Automatic**: Extension tự động sync dữ liệu local lên server
2. **No data loss**: Merge strategy bảo toàn tất cả dữ liệu
3. **Backward compatible**: Hoạt động offline nếu API không khả dụng

### Future v1.2.x
- **Planning**: JWT authentication thay shared secret
- **Considering**: Real-time sync với WebSocket
- **Roadmap**: Multi-user dashboard

---

## 🐛 Known Issues

### v1.1.2
- ✅ ~~CORS blocked cho Chrome Extension~~ → Fixed
- ✅ ~~URL thay đổi khi redeploy API~~ → Fixed với alias

### v1.1.0  
- ⚠️ API secret trong client-side (security limitation)
- ⚠️ File storage trong /tmp có thể bị xóa (Vercel limitation)

### v1.0.0
- ⚠️ Không sync giữa máy tính → Fixed trong v1.1.0

---

## 🔮 Roadmap

### Short Term (v1.2.x)
- [ ] JWT authentication cho API
- [ ] Data encryption cho sensitive content  
- [ ] Enhanced error handling & retry logic
- [ ] Performance optimization cho large datasets

### Medium Term (v1.3.x)
- [ ] Real-time sync với WebSocket
- [ ] Conflict resolution cho concurrent edits
- [ ] Data export/import tools
- [ ] Advanced analytics dashboard

### Long Term (v2.0.x)
- [ ] Multi-user support với team dashboard
- [ ] Custom report generation
- [ ] Integration với external tools (Slack, Teams)
- [ ] Mobile companion app

---

## 📊 Statistics

### Development Metrics
- **Total commits**: 50+
- **Files changed**: 25+
- **Lines of code**: 2000+
- **Features implemented**: 15+
- **APIs created**: 4 endpoints
- **Test scenarios**: 10+ manual tests

### Release Cadence  
- **v1.0.0**: Core functionality (Week 1)
- **v1.1.0**: API integration (Week 2) 
- **v1.1.2**: Production ready (Week 2)
- **v1.2.0**: Security improvements (Planned)

---

**Legend:**
- ✅ Completed
- ⚠️ Known Issue  
- 🎉 Major Feature
- 🚀 Enhancement
- 🐛 Bug Fix
- 📋 Documentation