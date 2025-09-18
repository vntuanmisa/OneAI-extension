const LOCAL_KEYS = {
  settings: 'settings',
  stats: 'stats',
  currentEmployeeCode: 'currentEmployeeCode',
  history: 'history'
};

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
});


