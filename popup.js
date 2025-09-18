const LOCAL_KEYS = {
  settings: 'settings',
  stats: 'stats',
  currentEmployeeCode: 'currentEmployeeCode',
  history: 'history'
};

// Global variable to track current viewing date
let currentViewingDate = null;

const DEFAULT_SETTINGS = {
  wordMinThreshold: 5,
  blockedKeywords: ['cảm ơn', 'xin chào', 'tạm biệt'],
  alertsEnabled: true,
  dailyGoal: 5,
  reminderHour: 16
};

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function getSettings() {
  const { [LOCAL_KEYS.settings]: s } = await chrome.storage.local.get(LOCAL_KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}

function monthMeta(year, monthIndex) {
  const first = new Date(year, monthIndex, 1);
  const last = new Date(year, monthIndex + 1, 0);
  return { first, last, days: last.getDate(), startWeekday: first.getDay() };
}

function weekdayLabels() {
  // Thứ tự: Thứ 2 → Chủ nhật
  return ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'];
}

async function renderCalendar(year, monthIndex) {
  const calendar = document.getElementById('calendar');
  calendar.innerHTML = '';

  const { [LOCAL_KEYS.currentEmployeeCode]: employeeCode } = await chrome.storage.local.get(LOCAL_KEYS.currentEmployeeCode);
  const store = await chrome.storage.local.get([LOCAL_KEYS.stats, LOCAL_KEYS.history]);
  const stats = store[LOCAL_KEYS.stats] || {};
  const history = store[LOCAL_KEYS.history] || {};
  const settings = await getSettings();

  const monthDate = new Date(year, monthIndex, 1);
  const monthText = monthDate.toLocaleDateString('vi-VN', { month: 'long' });
  const yearText = String(monthDate.getFullYear());
  document.getElementById('monthLabel').textContent = `${monthText.toUpperCase()} ${yearText}`;
  document.getElementById('employee').textContent = employeeCode ? `Mã NV: ${employeeCode}` : '';

  // Weekday headers
  for (const w of weekdayLabels()) {
    const el = document.createElement('div');
    el.className = 'weekday';
    el.textContent = w;
    calendar.appendChild(el);
  }

  const meta = monthMeta(year, monthIndex);
  // Monday-first calendar → number of placeholders before day 1
  // native getDay(): 0=Sun..6=Sat → convert to Mon=0..Sun=6 via (d+6)%7
  const leading = (meta.startWeekday + 6) % 7;
  for (let i = 0; i < leading; i++) {
    const el = document.createElement('div');
    el.className = 'empty';
    calendar.appendChild(el);
  }

  const userStats = employeeCode ? (stats[employeeCode] || {}) : {};
  for (let day = 1; day <= meta.days; day++) {
    const date = new Date(year, monthIndex, day);
    const key = toDateKey(date);
    const count = userStats[key] || 0;
    const hitGoal = count >= settings.dailyGoal;

    // Determine day status with override rule for past weekdays and for today
    const today = new Date();
    const d0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const cur = new Date(year, monthIndex, day);
    const isPast = cur.getTime() < d0.getTime();
    const isToday = cur.getTime() === d0.getTime();
    const weekday = cur.getDay(); // 0 Sunday ... 6 Saturday
    const isWeekend = weekday === 0 || weekday === 6;
    let statusClass;
    if (isToday && count < settings.dailyGoal) {
      statusClass = 'below';
    } else if (isPast && !isWeekend && count < settings.dailyGoal) {
      statusClass = 'below';
    } else if (count === 0) {
      statusClass = 'na';
    } else {
      statusClass = hitGoal ? 'goal' : 'below';
    }

    const el = document.createElement('div');
    const weekendClass = weekday === 0 ? ' sun' : (weekday === 6 ? ' sat' : '');
    const todayClass = isToday ? ' today' : '';
    el.className = 'day' + weekendClass + todayClass + ' ' + statusClass;
    el.innerHTML = `<span class="d">${day}</span><span class="c" title="Xem lịch sử ngày này">${count}</span>`;
    const num = el.querySelector('.c');
    if (num) {
      num.style.cursor = 'pointer';
      num.addEventListener('click', (e) => {
        e.stopPropagation();
        renderHistory(history, employeeCode, key);
      });
    }
    calendar.appendChild(el);
  }
  // render default history: today if current month/year, else day 1
  const today = new Date();
  const defaultKey = (today.getFullYear() === year && today.getMonth() === monthIndex)
    ? toDateKey(today)
    : toDateKey(new Date(year, monthIndex, 1));
  renderHistory(history, employeeCode, defaultKey);
}

function renderHistory(history, employeeCode, dateKey) {
  // Store current viewing date for export functionality
  currentViewingDate = dateKey;
  
  const container = document.getElementById('historyList');
  container.innerHTML = '';
  const label = document.getElementById('historyDateLabel');
  if (label) {
    const [yy, mm, dd] = dateKey.split('-');
    label.textContent = `Lịch sử (${dd}/${mm}/${yy})`;
  }
  if (!employeeCode || !history[employeeCode] || !history[employeeCode][dateKey]) {
    container.textContent = 'Không có bản ghi.';
    return;
  }
  const records = history[employeeCode][dateKey] || [];
  // sort by timestamp asc
  records.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  for (const r of records) {
    const t = new Date(r.timestamp || 0);
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const item = document.createElement('div');
    item.className = 'history-item';
    const text = String(r.message || '');
    const safeText = text.replace(/[<>]/g, s => s === '<' ? '&lt;' : '&gt;');
    item.innerHTML = `<div class="history-head"><span class="time">${hh}:${mm}</span><span class="model">${(r.modelCode||'')}</span></div><span class="msg clamped">${safeText}</span><div class="history-foot"><span class="toggle-more">Xem thêm</span></div>`;
    const msgEl = item.querySelector('.msg');
    const toggle = item.querySelector('.toggle-more');
    // Hide toggle if content fits within 2 lines
    requestAnimationFrame(() => {
      const clampedHeight = msgEl.getBoundingClientRect().height;
      msgEl.classList.remove('clamped');
      const fullHeight = msgEl.getBoundingClientRect().height;
      msgEl.classList.add('clamped');
      if (fullHeight <= clampedHeight + 1) {
        toggle.style.display = 'none';
      }
    });
    toggle.addEventListener('click', () => {
      const expanded = !msgEl.classList.contains('clamped');
      if (expanded) {
        msgEl.classList.add('clamped');
        toggle.textContent = 'Xem thêm';
      } else {
        msgEl.classList.remove('clamped');
        toggle.textContent = 'Thu gọn';
      }
    });
    container.appendChild(item);
  }
}

async function exportDayHistory() {
  if (!currentViewingDate) {
    alert('Không có ngày nào được chọn để xuất khẩu.');
    return;
  }

  const { [LOCAL_KEYS.currentEmployeeCode]: employeeCode } = await chrome.storage.local.get(LOCAL_KEYS.currentEmployeeCode);
  if (!employeeCode) {
    alert('Không tìm thấy mã nhân viên.');
    return;
  }

  const { [LOCAL_KEYS.history]: history } = await chrome.storage.local.get(LOCAL_KEYS.history);
  if (!history || !history[employeeCode] || !history[employeeCode][currentViewingDate]) {
    alert('Không có dữ liệu lịch sử cho ngày này.');
    return;
  }

  const records = history[employeeCode][currentViewingDate] || [];
  if (records.length === 0) {
    alert('Không có bản ghi nào để xuất khẩu.');
    return;
  }

  // Sort records by timestamp
  records.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  // Get date info for display
  const [yy, mm, dd] = currentViewingDate.split('-');
  const displayDate = `${dd}/${mm}/${yy}`;

  // Create simplified HTML content
  const htmlContent = `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lịch Sử OneAI - ${displayDate}</title>
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', system-ui, sans-serif;
            line-height: 1.5;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #e3f2fd 0%, #f3e5f5 100%);
            color: #2c3e50;
            font-size: 14px;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
            background: #ffffff;
            border-radius: 12px;
            padding: 25px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08);
            border: 1px solid #e8f4f8;
        }
        .header {
            text-align: center;
            margin-bottom: 25px;
            padding-bottom: 20px;
            border-bottom: 3px solid #42a5f5;
            background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
            margin: -25px -25px 25px -25px;
            padding: 25px;
            border-radius: 12px 12px 0 0;
        }
        .header h1 {
            color: #1565c0;
            margin: 0 0 10px 0;
            font-size: 24px;
            font-weight: 600;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.1);
        }
        .header .info {
            background: linear-gradient(135deg,rgb(103, 178, 243),rgb(82, 144, 236));
            color: white;
            padding: 10px 20px;
            border-radius: 25px;
            display: inline-block;
            font-size: 13px;
            font-weight: 500;
            box-shadow: 0 2px 8px rgba(66,165,245,0.3);
        }
        .summary {
            background: linear-gradient(135deg,rgb(133, 178, 236),rgb(153, 190, 238));
            color: white;
            padding: 15px;
            border-radius: 10px;
            margin-bottom: 25px;
            text-align: center;
            font-weight: 600;
            font-size: 16px;
            box-shadow: 0 3px 10px rgba(76,175,80,0.3);
        }
        .record {
            background: #ffffff;
            border: 2px solid #e1f5fe;
            margin-bottom: 6px;
            border-radius: 6px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }
        .record-header {
            background: linear-gradient(135deg,rgb(168, 198, 241),rgb(194, 217, 240));
            color: white;
            padding: 8px 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 10px;
        }
        .record-number {
            background:rgb(255, 255, 255);
            color:rgb(102, 156, 238);
            padding: 4px 10px;
            border-radius: 15px;
            font-size: 12px;
            font-weight: 700;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }
        .record-meta {
            display: flex;
            gap: 15px;
            font-size: 12px;
            font-weight: 600;
        }
        .time-badge {
            background:rgb(255, 255, 255);
            color:rgb(240, 117, 35);
            padding: 4px 10px;
            border-radius: 15px;
            font-weight: 600;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }
        .model-badge {
            background:rgb(255, 255, 255);
            color:rgb(0, 68, 255);
            padding: 4px 10px;
            border-radius: 15px;
            font-weight: 600;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }
        .record-content {
            padding: 15px;
            background: linear-gradient(135deg, #fafafa 0%, #f5f5f5 100%);
            border-top: 1px solid #e0e0e0;
            line-height: 1.4;
            color: #37474f;
        }
        .footer {
            text-align: center;
            margin-top: 25px;
            padding: 15px;
            background: linear-gradient(135deg, #f5f5f5 0%, #eeeeee 100%);
            border-radius: 8px;
            color: #607d8b;
            font-size: 12px;
            border: 1px solid #e0e0e0;
        }
        @media (max-width: 600px) {
            .container { margin: 10px; padding: 20px; }
            .header { margin: -20px -20px 25px -20px; padding: 20px; }
            .record-header { flex-direction: column; align-items: flex-start; }
            .record-meta { flex-direction: row; gap: 10px; }
        }
        @media print {
            body { background: white !important; font-size: 12px; }
            .container { box-shadow: none; border: 1px solid #ccc; }
            .record { margin-bottom: 8px; }
            .header { background: #f5f5f5 !important; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 LỊCH SỬ SỬ DỤNG ONEAI</h1>
            <div class="info">
                👤 ${employeeCode} • 📅 ${displayDate} • ⏰ ${new Date().toLocaleString('vi-VN')}
            </div>
        </div>

        <div class="summary">
            📈 TỔNG CỘNG: ${records.length} CÂU HỎI ĐÃ SỬ DỤNG
        </div>

        ${records.map((record, index) => {
          const timestamp = new Date(record.timestamp || 0);
          const timeStr = timestamp.toLocaleTimeString('vi-VN', { hour12: false });
          const model = record.modelCode || 'N/A';
          const message = (record.message || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          
          return `
        <div class="record">
            <div class="record-header">
                <span class="record-number">${index + 1}</span>
                <div class="record-meta">
                    <span class="time-badge">⏰ ${timeStr}</span>
                    <span class="model-badge">🤖 ${model}</span>
                </div>
            </div>
            <div class="record-content">
                ${message}
            </div>
        </div>`;
        }).join('')}

        <div class="footer">
            <p>🔒 Báo cáo được tạo bởi OneAI Usage Tracker Extension</p>
        </div>
    </div>
</body>
</html>`;

  // Create and download file
  const filename = `OneAI_LichSu_${employeeCode}_${dd}-${mm}-${yy}.html`;
  
  // Create blob and download
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  downloadFile(blob, filename);

}



function downloadFile(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// removed day list under calendar per request

document.addEventListener('DOMContentLoaded', async () => {
  let now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth();

  await renderCalendar(y, m);

  document.getElementById('prevMonth').addEventListener('click', async () => {
    m -= 1;
    if (m < 0) { m = 11; y -= 1; }
    await renderCalendar(y, m);
    await updateClearButton();
  });
  document.getElementById('nextMonth').addEventListener('click', async () => {
    m += 1;
    if (m > 11) { m = 0; y += 1; }
    await renderCalendar(y, m);
    await updateClearButton();
  });
  document.getElementById('todayBtn').addEventListener('click', async () => {
    now = new Date();
    y = now.getFullYear();
    m = now.getMonth();
    await renderCalendar(y, m);
    await updateClearButton();
  });

  async function updateClearButton() {
    const btn = document.getElementById('clearMonthBtn');
    const now = new Date();
    const isPastMonth = y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth());
    btn.style.display = isPastMonth ? 'inline-block' : 'none';
  }
  await updateClearButton();

  document.getElementById('clearMonthBtn').addEventListener('click', async () => {
    const label = new Date(y, m, 1).toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' });
    if (!confirm(`Bạn có chắc chắn muốn xóa lịch sử của tháng ${label} hay không?`)) return;
    const store = await chrome.storage.local.get([LOCAL_KEYS.stats, LOCAL_KEYS.history, LOCAL_KEYS.currentEmployeeCode]);
    const stats = store[LOCAL_KEYS.stats] || {};
    const history = store[LOCAL_KEYS.history] || {};
    const emp = store[LOCAL_KEYS.currentEmployeeCode];
    if (!emp) return;
    const userStats = stats[emp] || {};
    const userHist = history[emp] || {};
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    for (let d = 1; d <= last.getDate(); d++) {
      const key = `${first.getFullYear()}-${String(m + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      delete userStats[key];
      delete userHist[key];
    }
    stats[emp] = userStats;
    history[emp] = userHist;
    await chrome.storage.local.set({ [LOCAL_KEYS.stats]: stats, [LOCAL_KEYS.history]: history });
    await renderCalendar(y, m);
    await updateClearButton();
  });

  // Export button event listener
  document.getElementById('exportBtn').addEventListener('click', exportDayHistory);
});


