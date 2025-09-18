// Background service worker (MV3, module)
// - Listens to OneAI network requests
// - Two-step success detection (simplified):
//   Step 1: catch /chats/streaming to capture { employeeCode, answerMessageId (as messageId), message, modelCode }
//            -> apply filter, then store temp by messageId (overwrite any previous temp)
//   Step 2: catch /log/monitor with CustomType:3 & StepName:"Client_ReveiceTokenToGenerate"
//            -> read messageId from monitor body, take temp entry and write to history (no dedupe checks), then clear temp

import { API_BASE_URL, API_SECRET_KEY } from './config.js';
const ONEAI_HOST = 'misajsc.amis.vn';
const ONEAI_PATH_SEGMENT = '/oneai/';
const ONEAI_CHAT_URL = 'https://misajsc.amis.vn/oneai/chat';

// Defaults for settings stored in chrome.storage.local
const DEFAULT_SETTINGS = {
  wordMinThreshold: 5,
  blockedKeywords: ['cảm ơn', 'xin chào', 'tạm biệt'],
  alertsEnabled: true,
  dailyGoal: 6,
  // hỗ trợ nhiều mốc giờ nhắc dạng HH:MM, ví dụ ['09:00', '13:00', '16:30']
  reminderTimes: ['10:00', '14:00', '16:00', '17:00']
};

// Keys in storage
const LOCAL_KEYS = {
  settings: 'settings',
  stats: 'stats', // { [employeeCode]: { [yyyy-mm-dd]: number } }
  currentEmployeeCode: 'currentEmployeeCode',
  history: 'history' // { [employeeCode]: { [yyyy-mm-dd]: Array<{ timestamp, message, modelCode, messageId }> } }
};

const SESSION_KEYS = {
  // Map messageId to a list of pending entries to support multiple modelCode per message
  // { [messageId]: Array<{ employeeCode, createdAt, message?: string, modelCode?: string }> }
  pendingMap: 'pendingMap',
  // Track messageIds that have already passed the success monitor step, so late models can be counted too
  // { [messageId]: number (confirmedAtMs) }
  successStarted: 'successStarted',
  // Track monitor-processed messageIds to avoid double counting when multiple monitor requests fire
  // { [messageId]: number (processedAtMs) }
  monitorProcessed: 'monitorProcessed'
};

const SUCCESS_TTL_MS = 10 * 60 * 1000; // 10 minutes window to count late models after monitor
const MONITOR_PROCESSED_TTL_MS = 10 * 60 * 1000; // 10 minutes to prevent duplicate processing

// In-memory pending buffer to avoid race and to group dual IDs (answerMessageId/messageId) for one logical request
// memoryPending maps a groupKey (sorted combo of ids) to entry list
const memoryPending = Object.create(null);
function clearAllMemoryPending() {
  for (const k of Object.keys(memoryPending)) delete memoryPending[k];
}

// Utilities
function toDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function getSettings() {
  const { [LOCAL_KEYS.settings]: settings } = await chrome.storage.local.get(LOCAL_KEYS.settings);
  if (settings && typeof settings === 'object') {
    let migrated = { ...settings };
    // Migrate legacy: reminderHour (number) or reminderHours (number[]) -> reminderTimes (string[] HH:MM)
    if (!Array.isArray(migrated.reminderTimes)) {
      let times = [];
      if (Array.isArray(migrated.reminderHours)) {
        times = migrated.reminderHours
          .map(h => Number(h))
          .filter(n => Number.isFinite(n))
          .map(h => `${String(Math.max(0, Math.min(23, Math.floor(h)))).padStart(2, '0')}:00`);
      } else if (Number.isFinite(Number(migrated.reminderHour))) {
        const h = Math.max(0, Math.min(23, Number(migrated.reminderHour)));
        times = [`${String(h).padStart(2, '0')}:00`];
      } else {
        times = DEFAULT_SETTINGS.reminderTimes;
      }
      migrated.reminderTimes = times;
      delete migrated.reminderHours;
      delete migrated.reminderHour;
      await chrome.storage.local.set({ [LOCAL_KEYS.settings]: migrated });
      return { ...DEFAULT_SETTINGS, ...migrated };
    }
    return { ...DEFAULT_SETTINGS, ...migrated };
  }
  // Initialize defaults on first run
  await chrome.storage.local.set({ [LOCAL_KEYS.settings]: DEFAULT_SETTINGS });
  return { ...DEFAULT_SETTINGS };
}

async function readRequestBody(details) {
  try {
    const body = details?.requestBody;
    if (!body) return null;
    if (body.formData) {
      // Convert simple form-data into object
      const obj = {};
      for (const [k, v] of Object.entries(body.formData)) {
        obj[k] = Array.isArray(v) && v.length === 1 ? v[0] : v;
      }
      return obj;
    }
    if (body.raw && body.raw.length > 0) {
      const bytes = body.raw[0].bytes;
      if (!bytes) return null;
      const decoder = new TextDecoder('utf-8');
      const text = decoder.decode(bytes);
      try {
        return JSON.parse(text);
      } catch (err) {
        // Not JSON; best-effort parse of key=value pairs
        const obj = {};
        for (const pair of text.split('&')) {
          const [k, v] = pair.split('=');
          if (k) obj[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
        }
        return obj;
      }
    }
  } catch (e) {
    // ignore
  }
  return null;
}

function normalizeText(text) {
  if (typeof text !== 'string') return '';
  return text.trim().toLowerCase();
}

function countWords(text) {
  const t = normalizeText(text);
  if (!t) return 0;
  // Split by whitespace; Vietnamese is whitespace-delimited
  return t.split(/\s+/).filter(Boolean).length;
}

function extractField(obj, candidates) {
  for (const key of candidates) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
    // Try case-insensitive match
    const found = Object.keys(obj || {}).find(k => k.toLowerCase() === key.toLowerCase());
    if (found) return obj[found];
  }
  return undefined;
}

function extractFieldDeepExact(obj, candidates) {
  if (!obj || typeof obj !== 'object') return undefined;
  const queue = [obj];
  const lowers = candidates.map(c => String(c).toLowerCase());
  while (queue.length) {
    const cur = queue.shift();
    if (!cur || typeof cur !== 'object') continue;
    for (const [k, v] of Object.entries(cur)) {
      if (lowers.includes(String(k).toLowerCase())) return v;
      if (v && typeof v === 'object') queue.push(v);
    }
  }
  return undefined;
}

function getCanonicalMessageId(payload) {
  // Prefer explicit messageId keys only; never fall back to answerMessageId
  let mid = extractField(payload, ['messageId', 'MessageId', 'msgId']);
  if (mid == null) mid = extractFieldDeepExact(payload, ['messageId', 'MessageId', 'msgId']);
  return mid != null ? String(mid) : undefined;
}

function getAnswerMessageId(payload) {
  // For streaming step: use answerMessageId only
  let mid = extractField(payload, ['answerMessageId', 'AnswerMessageId', 'answerMsgId']);
  if (mid == null) mid = extractFieldDeepExact(payload, ['answerMessageId', 'AnswerMessageId', 'answerMsgId']);
  return mid != null ? String(mid) : undefined;
}

function buildGroupKeyFromIds(answerId, requestId) {
  const parts = [answerId, requestId].filter(Boolean).map(String);
  parts.sort();
  return parts.join('||');
}

function isOneAIUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === ONEAI_HOST && u.pathname.includes(ONEAI_PATH_SEGMENT);
  } catch (_) {
    return false;
  }
}

let notifHandlersBound = false;
function ensureNotificationHandlers() {
  if (notifHandlersBound) return;
  notifHandlersBound = true;
  chrome.notifications.onClicked.addListener(() => {
    chrome.tabs.create({ url: ONEAI_CHAT_URL });
  });
  chrome.notifications.onButtonClicked.addListener((_id, _btnIdx) => {
    if (_btnIdx === 0) chrome.tabs.create({ url: ONEAI_CHAT_URL });
  });
}

function isStreamingEndpoint(url) {
  try {
    const u = new URL(url);
    return u.pathname.includes('/chats/streaming');
  } catch (_) {
    return false;
  }
}

function isMonitorEndpoint(url) {
  try {
    const u = new URL(url);
    return u.pathname.endsWith('/log/monitor') && u.pathname.includes('/api/system/');
  } catch (_) {
    return false;
  }
}

async function isMessageValid(messageText) {
  const settings = await getSettings();
  const words = countWords(messageText);
  const containsBlocked = settings.blockedKeywords.some(k =>
    normalizeText(messageText).includes(normalizeText(k))
  );
  // Invalid only if both conditions are true
  return !(words < settings.wordMinThreshold && containsBlocked);
}

async function addPendingDual(answerId, requestId, employeeCode, extra = {}) {
  if ((!answerId && !requestId) || !employeeCode) return;
  // Clear entire memory buffer to avoid any stale entries across rapid sequences
  clearAllMemoryPending();
  // Write the fresh entry (atomic in this event loop)
  const groupKey = buildGroupKeyFromIds(answerId, requestId);
  memoryPending[groupKey] = [{ employeeCode, createdAt: Date.now(), ids: { answerId: answerId ? String(answerId) : undefined, requestId: requestId ? String(requestId) : undefined }, ...extra }];
  const { [SESSION_KEYS.pendingMap]: pendingMap = {} } = await chrome.storage.session.get(SESSION_KEYS.pendingMap);
  // Overwrite any previous temp data for this groupKey (keep only the latest)
  pendingMap[groupKey] = memoryPending[groupKey];
  await chrome.storage.session.set({ [SESSION_KEYS.pendingMap]: pendingMap });
}

async function popPending(messageId, modelCode) {
  const { [SESSION_KEYS.pendingMap]: pendingMap = {} } = await chrome.storage.session.get(SESSION_KEYS.pendingMap);
  const list = Array.isArray(pendingMap[messageId]) ? pendingMap[messageId] : null;
  if (!list || list.length === 0) return undefined;
  let indexToRemove = 0;
  if (modelCode != null) {
    const idx = list.findIndex(e => (e.modelCode || '') === String(modelCode));
    if (idx >= 0) indexToRemove = idx;
  }
  const [entry] = list.splice(indexToRemove, 1);
  if (list.length === 0) delete pendingMap[messageId]; else pendingMap[messageId] = list;
  await chrome.storage.session.set({ [SESSION_KEYS.pendingMap]: pendingMap });
  return entry;
}

async function popAllPendingByAnyId(singleId) {
  if (!singleId) return [];
  // Try memory first: find any group whose ids contain singleId
  const collected = [];
  const memKeys = Object.keys(memoryPending);
  for (const k of memKeys) {
    const list = memoryPending[k];
    const first = Array.isArray(list) ? list[0] : null;
    const ids = first?.ids || {};
    if (String(ids.answerId || '') === String(singleId) || String(ids.requestId || '') === String(singleId)) {
      collected.push(...list);
    }
  }
  if (collected.length > 0) {
    clearAllMemoryPending();
    return collected;
  }
  // Fallback to session storage
  const { [SESSION_KEYS.pendingMap]: pendingMap = {} } = await chrome.storage.session.get(SESSION_KEYS.pendingMap);
  const keys = Object.keys(pendingMap);
  const matchedKeys = [];
  for (const k of keys) {
    const list = pendingMap[k];
    const first = Array.isArray(list) ? list[0] : null;
    const ids = first?.ids || {};
    if (String(ids.answerId || '') === String(singleId) || String(ids.requestId || '') === String(singleId)) {
      collected.push(...list);
      matchedKeys.push(k);
    }
  }
  if (matchedKeys.length > 0) {
    for (const k of matchedKeys) delete pendingMap[k];
    await chrome.storage.session.set({ [SESSION_KEYS.pendingMap]: pendingMap });
  }
  return collected;
}

async function incrementStat(employeeCode, dateKey) {
  if (!employeeCode) return;
  const { [LOCAL_KEYS.stats]: stats = {} } = await chrome.storage.local.get(LOCAL_KEYS.stats);
  const userStats = stats[employeeCode] || {};
  userStats[dateKey] = (userStats[dateKey] || 0) + 1;
  stats[employeeCode] = userStats;
  await chrome.storage.local.set({ [LOCAL_KEYS.stats]: stats });
  return userStats[dateKey];
}

async function appendHistory(employeeCode, dateKey, record) {
  if (!employeeCode) return;
  const { [LOCAL_KEYS.history]: history = {} } = await chrome.storage.local.get(LOCAL_KEYS.history);
  const userHist = history[employeeCode] || {};
  const dayList = userHist[dateKey] || [];
  dayList.push(record);
  userHist[dateKey] = dayList;
  history[employeeCode] = userHist;
  await chrome.storage.local.set({ [LOCAL_KEYS.history]: history });
}

// ===== Đồng bộ server: helpers =====
function monthFromDateKey(dateKey) {
  // dateKey: YYYY-MM-DD -> YYYY-MM
  if (!dateKey || typeof dateKey !== 'string') return null;
  const m = dateKey.match(/^(\d{4}-\d{2})-\d{2}$/);
  return m ? m[1] : null;
}

async function fetchDataFromServer(employeeCode, period) {
  try {
    const url = `${API_BASE_URL}/${encodeURIComponent(employeeCode)}?period=${encodeURIComponent(period)}`;
    const res = await fetch(url, { headers: { 'X-Auth-Token': API_SECRET_KEY } });
    if (res.status === 200) return await res.json();
    if (res.status === 404) return null; // không có dữ liệu
    return null;
  } catch (_) {
    return null;
  }
}

async function postDataToServer(employeeCode, period, data) {
  try {
    const url = `${API_BASE_URL}/${encodeURIComponent(employeeCode)}?period=${encodeURIComponent(period)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Token': API_SECRET_KEY },
      body: JSON.stringify(data || {})
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

async function mergeMonthlyDataToLocal(employeeCode, period, remoteData) {
  if (!remoteData || !employeeCode || !period) return;
  // remoteData kỳ vọng dạng: { stats: {YYYY-MM-DD: number}, history: {YYYY-MM-DD: Array<...>} }
  const store = await chrome.storage.local.get([LOCAL_KEYS.stats, LOCAL_KEYS.history]);
  const stats = store[LOCAL_KEYS.stats] || {};
  const history = store[LOCAL_KEYS.history] || {};
  const userStats = stats[employeeCode] || {};
  const userHist = history[employeeCode] || {};
  const prefix = `${period}-`;

  // Merge: ưu tiên lớn hơn giữa local và remote theo count; history thì nối mảng (không dedupe tinh vi)
  const remoteStats = (remoteData.stats || {});
  const remoteHist = (remoteData.history || {});
  for (const [dayKey, cnt] of Object.entries(remoteStats)) {
    if (String(dayKey).startsWith(prefix)) {
      const localCnt = Number(userStats[dayKey] || 0);
      userStats[dayKey] = Math.max(localCnt, Number(cnt || 0));
    }
  }
  for (const [dayKey, list] of Object.entries(remoteHist)) {
    if (String(dayKey).startsWith(prefix)) {
      const localList = Array.isArray(userHist[dayKey]) ? userHist[dayKey] : [];
      const remoteList = Array.isArray(list) ? list : [];
      userHist[dayKey] = [...localList, ...remoteList];
    }
  }
  stats[employeeCode] = userStats;
  history[employeeCode] = userHist;
  await chrome.storage.local.set({ [LOCAL_KEYS.stats]: stats, [LOCAL_KEYS.history]: history });
}

async function dumpMonthlyDataFromLocal(employeeCode, period) {
  const store = await chrome.storage.local.get([LOCAL_KEYS.stats, LOCAL_KEYS.history]);
  const stats = store[LOCAL_KEYS.stats] || {};
  const history = store[LOCAL_KEYS.history] || {};
  const userStats = stats[employeeCode] || {};
  const userHist = history[employeeCode] || {};
  const prefix = `${period}-`;
  const outStats = {};
  const outHist = {};
  for (const [k, v] of Object.entries(userStats)) {
    if (String(k).startsWith(prefix)) outStats[k] = v;
  }
  for (const [k, v] of Object.entries(userHist)) {
    if (String(k).startsWith(prefix)) outHist[k] = v;
  }
  return { stats: outStats, history: outHist };
}

async function hasHistoryRecord(employeeCode, dateKey, messageId, modelCode) {
  const { [LOCAL_KEYS.history]: history = {} } = await chrome.storage.local.get(LOCAL_KEYS.history);
  const list = history?.[employeeCode]?.[dateKey] || [];
  return list.some(r => String(r.messageId) === String(messageId) && String(r.modelCode || '') === String(modelCode || ''));
}

async function markSuccessStarted(messageId) {
  const { [SESSION_KEYS.successStarted]: success = {} } = await chrome.storage.session.get(SESSION_KEYS.successStarted);
  success[String(messageId)] = Date.now();
  await chrome.storage.session.set({ [SESSION_KEYS.successStarted]: success });
}

async function wasSuccessStarted(messageId) {
  const { [SESSION_KEYS.successStarted]: success = {} } = await chrome.storage.session.get(SESSION_KEYS.successStarted);
  const ts = success[String(messageId)];
  if (!ts) return false;
  if (Date.now() - ts > SUCCESS_TTL_MS) {
    delete success[String(messageId)];
    await chrome.storage.session.set({ [SESSION_KEYS.successStarted]: success });
    return false;
  }
  return true;
}

async function markMonitorProcessed(messageId) {
  const { [SESSION_KEYS.monitorProcessed]: map = {} } = await chrome.storage.session.get(SESSION_KEYS.monitorProcessed);
  map[String(messageId)] = Date.now();
  await chrome.storage.session.set({ [SESSION_KEYS.monitorProcessed]: map });
}

async function wasMonitorProcessed(messageId) {
  const { [SESSION_KEYS.monitorProcessed]: map = {} } = await chrome.storage.session.get(SESSION_KEYS.monitorProcessed);
  const ts = map[String(messageId)];
  if (!ts) return false;
  if (Date.now() - ts > MONITOR_PROCESSED_TTL_MS) {
    delete map[String(messageId)];
    await chrome.storage.session.set({ [SESSION_KEYS.monitorProcessed]: map });
    return false;
  }
  return true;
}

async function setCurrentEmployee(employeeCode) {
  if (!employeeCode) return;
  await chrome.storage.local.set({ [LOCAL_KEYS.currentEmployeeCode]: employeeCode });
}

async function updateBadgeFor(employeeCode) {
  if (!employeeCode) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  const today = toDateKey();
  const { [LOCAL_KEYS.stats]: stats = {} } = await chrome.storage.local.get(LOCAL_KEYS.stats);
  const count = stats?.[employeeCode]?.[today] || 0;
  await chrome.action.setBadgeBackgroundColor({ color: count >= (await getSettings()).dailyGoal ? '#4caf50' : '#f44336' });
  await chrome.action.setBadgeText({ text: String(count) });
}

// Pick current employee, or fallback to the latest employee that has any stats
async function getCurrentEmployeeOrLast() {
  const store = await chrome.storage.local.get([LOCAL_KEYS.currentEmployeeCode, LOCAL_KEYS.stats]);
  let emp = store[LOCAL_KEYS.currentEmployeeCode];
  if (emp) return String(emp);
  const stats = store[LOCAL_KEYS.stats] || {};
  let latestEmp = null;
  let latestDateTs = -1;
  for (const [code, byDate] of Object.entries(stats)) {
    for (const dateKey of Object.keys(byDate)) {
      const ts = Date.parse(dateKey);
      if (!Number.isNaN(ts) && ts > latestDateTs) {
        latestDateTs = ts;
        latestEmp = code;
      }
    }
  }
  if (latestEmp) {
    await chrome.storage.local.set({ [LOCAL_KEYS.currentEmployeeCode]: latestEmp });
    return latestEmp;
  }
  return null;
}

function parseTimeTokenToHM(token) {
  if (!token) return null;
  const t = String(token).trim().toLowerCase().replace(/\s+/g, '');
  // allow formats: HH:MM, H:MM, HHhMM, HHh, HH
  let m = t.match(/^(\d{1,2}):?(\d{0,2})$/);
  if (!m) m = t.match(/^(\d{1,2})h?(\d{0,2})$/);
  if (!m) return null;
  const h = Math.max(0, Math.min(23, Number(m[1])));
  const mm = m[2] ? Math.max(0, Math.min(59, Number(m[2]))) : 0;
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  return { h, m: mm };
}

async function maybeNotify(employeeCode) {
  const settings = await getSettings();
  if (!settings.alertsEnabled) return;
  const now = new Date();
  const times = Array.isArray(settings.reminderTimes) ? settings.reminderTimes : [];
  const hmList = times
    .map(parseTimeTokenToHM)
    .filter(Boolean);
  const matchNow = hmList.some(({ h, m }) => h === now.getHours() && m === now.getMinutes());
  if (!matchNow) return;
  const today = toDateKey(now);
  const { [LOCAL_KEYS.stats]: stats = {} } = await chrome.storage.local.get(LOCAL_KEYS.stats);
  const count = stats?.[employeeCode]?.[today] || 0;
  if (count < settings.dailyGoal) {
    try {
      const notifId = await chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Nhắc nhở sử dụng OneAI!',
        message: `Hôm nay bạn mới dùng OneAI ${count}/${settings.dailyGoal} lần. Hãy hoàn thành chỉ tiêu nhé!`,
        requireInteraction: true,
        buttons: [{ title: 'Mở OneAI ngay' }]
      });
      ensureNotificationHandlers();
    } catch (_) {
      // Notifications may fail on some platforms or if icons missing; ignore silently
    }
  }
}

async function maybeNotifyNoUser() {
  const settings = await getSettings();
  if (!settings.alertsEnabled) return;
  const now = new Date();
  const times = Array.isArray(settings.reminderTimes) ? settings.reminderTimes : [];
  const hmList = times
    .map(parseTimeTokenToHM)
    .filter(Boolean);
  const matchNow = hmList.some(({ h, m }) => h === now.getHours() && m === now.getMinutes());
  if (!matchNow) return;
  try {
    const notifId = await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Nhắc nhở sử dụng OneAI!',
      message: 'Bạn chưa có dữ liệu sử dụng hôm nay. Hãy mở OneAI và bắt đầu sử dụng.',
      requireInteraction: true,
      buttons: [{ title: 'Mở OneAI ngay' }]
    });
    ensureNotificationHandlers();
  } catch (_) {}
}

// Alarm to check reminders every minute
chrome.runtime.onInstalled.addListener(() => {
  // check every minute to support HH:MM reminders
  chrome.alarms.create('minuteReminder', { periodInMinutes: 1 });
  applyDefaultActionIcon();
  // Initialize badge for last known user
  getCurrentEmployeeOrLast().then(emp => { if (emp) updateBadgeFor(emp); });
  // Đồng bộ về local trên cài đặt mới: lấy tháng hiện tại
  getCurrentEmployeeOrLast().then(async (emp) => {
    if (!emp) return;
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const remote = await fetchDataFromServer(emp, period);
    if (remote) await mergeMonthlyDataToLocal(emp, period, remote);
  });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'minuteReminder') return;
  const employeeCode = await getCurrentEmployeeOrLast();
  if (employeeCode) await maybeNotify(employeeCode); else await maybeNotifyNoUser();
});

chrome.runtime.onStartup.addListener(() => {
  applyDefaultActionIcon();
  // Restore badge on browser startup for last known user
  getCurrentEmployeeOrLast().then(emp => { if (emp) updateBadgeFor(emp); });
  // Ensure the minute alarm is active after startup
  chrome.alarms.create('minuteReminder', { periodInMinutes: 1 });
  // Đồng bộ về local khi khởi động: tháng hiện tại
  getCurrentEmployeeOrLast().then(async (emp) => {
    if (!emp) return;
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const remote = await fetchDataFromServer(emp, period);
    if (remote) await mergeMonthlyDataToLocal(emp, period, remote);
  });
});

async function applyDefaultActionIcon() {
  try {
    await chrome.action.setIcon({
      path: {
        16: 'icons/icon16.png',
        32: 'icons/icon32.png',
        48: 'icons/icon48.png',
        128: 'icons/icon128.png'
      }
    });
  } catch (_) {
    // Ignore if icons are not present yet
  }
}

// Core listeners for network requests
chrome.webRequest.onBeforeRequest.addListener(
  async (details) => {
    if (!isOneAIUrl(details.url)) return;

    // Step 1: streaming request captures employeeCode + messageId + message
    if (isStreamingEndpoint(details.url)) {
      const body = await readRequestBody(details);
      if (!body || typeof body !== 'object') return;

      const employeeCode = extractField(body, ['employeeCode', 'EmployeeCode', 'empCode']);
      const answerId = getAnswerMessageId(body);
      const requestId = getCanonicalMessageId(body);
      const message = extractField(body, ['message', 'content', 'prompt', 'Message']);
      const modelCode = extractField(body, ['modelCode', 'model', 'ModelCode']);

      if (!employeeCode || (!answerId && !requestId)) return;
      await setCurrentEmployee(employeeCode);

      const valid = await isMessageValid(String(message || ''));
      if (!valid) return; // filtered out

      // Always: save/overwrite temp pending for this message
      await addPendingDual(answerId ? String(answerId) : undefined, requestId ? String(requestId) : undefined, String(employeeCode), { message: String(message || ''), modelCode: modelCode ? String(modelCode) : undefined });
      await updateBadgeFor(employeeCode);
      console.log(`Added to pending: answerId=${answerId}, messageId=${requestId}, model=${modelCode}`);
      return;
    }

    // Step 2: monitor request confirms success when CustomType=3 & StepName="Client_ReveiceTokenToGenerate"
    if (isMonitorEndpoint(details.url)) {
      const body = await readRequestBody(details);
      if (!body || typeof body !== 'object') return;

      const customType = extractField(body, ['CustomType', 'customType']);
      const stepName = extractField(body, ['StepName', 'stepName']);
      const requestId = getCanonicalMessageId(body);

      if (Number(customType) === 3 && String(stepName) === 'Client_ReveiceTokenToGenerate' && requestId) {
        // Prevent double processing of the same messageId in case multiple monitors arrive
        const processedKey = String(requestId);
        const alreadyProcessed = await wasMonitorProcessed(processedKey);
        if (alreadyProcessed) return;
        await markMonitorProcessed(processedKey);
        const consumed = await popAllPendingByAnyId(requestId);
        if (consumed && consumed.length > 0) {
          const todayKey = toDateKey();
          for (const pending of consumed) {
            const newCount = await incrementStat(pending.employeeCode, todayKey);
            await appendHistory(pending.employeeCode, todayKey, {
              timestamp: Date.now(),
              messageId: String(requestId),
              message: pending.message || '',
              modelCode: pending.modelCode || ''
            });
            await updateBadgeFor(pending.employeeCode);

            // Đẩy đồng bộ tháng hiện tại sau khi ghi nhận thành công
            try {
              const now = new Date();
              const period = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
              const dump = await dumpMonthlyDataFromLocal(pending.employeeCode, period);
              await postDataToServer(pending.employeeCode, period, dump);
            } catch (_) {}
            const settings = await getSettings();
            if (settings.alertsEnabled && newCount === settings.dailyGoal) {
              try {
                await chrome.notifications.create({
                  type: 'basic',
                  iconUrl: 'icons/icon48.png',
                  title: 'Thống kê sử dụng OneAI!',
                  message: `Bạn đã sử dụng OneAI đủ ${settings.dailyGoal} lần hôm nay. Tốt lắm!`,
                  requireInteraction: true
                });
                ensureNotificationHandlers();
              } catch (_) {}
            }
          }
        }
      }
    }
  },
  { urls: [
      'https://misajsc.amis.vn/*'
    ]
  },
  ['requestBody']
);

// Lắng nghe yêu cầu lazy-load tháng từ popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      if (message && message.type === 'sync:fetchPeriod') {
        const employeeCode = String(message.employeeCode || '');
        const period = String(message.period || '');
        if (!employeeCode || !period) return sendResponse({ ok: false, error: 'invalid_params' });
        const remote = await fetchDataFromServer(employeeCode, period);
        if (remote) {
          await mergeMonthlyDataToLocal(employeeCode, period, remote);
          return sendResponse({ ok: true, found: true });
        }
        return sendResponse({ ok: true, found: false });
      }
    } catch (e) {
      return sendResponse({ ok: false, error: 'exception' });
    }
  })();
  return true;
});



