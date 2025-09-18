const LOCAL_KEYS = { settings: 'settings' };

const DEFAULT_SETTINGS = {
  wordMinThreshold: 5,
  blockedKeywords: ['cảm ơn', 'xin chào', 'tạm biệt'],
  alertsEnabled: true,
  dailyGoal: 5,
  // new: HH:MM list
  reminderTimes: ['10:00', '14:00', '16:00', '17:00']
};

async function loadSettings() {
  const { [LOCAL_KEYS.settings]: s } = await chrome.storage.local.get(LOCAL_KEYS.settings);
  let cfg = { ...(s || {}) };
  // migrate legacy reminderHour / reminderHours -> reminderTimes
  if (!Array.isArray(cfg.reminderTimes)) {
    let times = [];
    if (Array.isArray(cfg.reminderHours)) {
      times = cfg.reminderHours
        .map(h => Number(h))
        .filter(n => Number.isFinite(n))
        .map(h => `${String(Math.max(0, Math.min(23, Math.floor(h)))).padStart(2,'0')}:00`);
    } else if (Number.isFinite(Number(cfg.reminderHour))) {
      const h = Math.max(0, Math.min(23, Number(cfg.reminderHour)));
      times = [`${String(h).padStart(2,'0')}:00`];
    } else {
      times = DEFAULT_SETTINGS.reminderTimes;
    }
    cfg.reminderTimes = times;
    delete cfg.reminderHours;
    delete cfg.reminderHour;
    await chrome.storage.local.set({ [LOCAL_KEYS.settings]: cfg });
  }
  return { ...DEFAULT_SETTINGS, ...cfg };
}

function toTextArea(list) {
  return (list || []).join('\n');
}

function fromTextArea(text) {
  return (text || '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
}

async function render() {
  const s = await loadSettings();
  document.getElementById('alertsEnabled').checked = !!s.alertsEnabled;
  document.getElementById('dailyGoal').value = Number(s.dailyGoal) || 0;
  const times = Array.isArray(s.reminderTimes) ? s.reminderTimes : [];
  document.getElementById('reminderTimes').value = times.join(', ');
  document.getElementById('wordMinThreshold').value = Number(s.wordMinThreshold) || 0;
  document.getElementById('blockedKeywords').value = toTextArea(s.blockedKeywords);
}

async function save() {
  function parseTimeTokenToHHMM(token){
    const t = String(token||'').trim().toLowerCase();
    if (!t) return null;
    const m = t.match(/^(\d{1,2})[:h]?(\d{0,2})$/);
    if (!m) return null;
    const h = Math.max(0, Math.min(23, Number(m[1])));
    const mm = m[2] ? Math.max(0, Math.min(59, Number(m[2]))) : 0;
    if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
    return `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
  }

  const settings = {
    alertsEnabled: document.getElementById('alertsEnabled').checked,
    dailyGoal: Number(document.getElementById('dailyGoal').value) || 0,
    reminderTimes: (document.getElementById('reminderTimes').value || '')
      .split(',')
      .map(s => parseTimeTokenToHHMM(s))
      .filter(Boolean),
    wordMinThreshold: Number(document.getElementById('wordMinThreshold').value) || 0,
    blockedKeywords: fromTextArea(document.getElementById('blockedKeywords').value)
  };
  await chrome.storage.local.set({ [LOCAL_KEYS.settings]: settings });
  alert('Đã lưu cài đặt');
}

async function resetDefaults() {
  await chrome.storage.local.set({ [LOCAL_KEYS.settings]: DEFAULT_SETTINGS });
  await render();
  alert('Đã khôi phục mặc định');
}

document.addEventListener('DOMContentLoaded', async () => {
  await render();
  document.getElementById('saveBtn').addEventListener('click', save);
  document.getElementById('resetBtn').addEventListener('click', resetDefaults);
});


