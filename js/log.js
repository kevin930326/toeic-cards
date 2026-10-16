import { profileStorage } from './profile-storage.js';
// 每日學習紀錄（統計、每日目標、連續打卡都用它）
// 存在 localStorage：{ '2026-10-14': { reviews, again, good, learned, quiz, quizCorrect, goal } }
//   reviews／again／good／learned：複習；quiz／quizCorrect：測驗題數、答對題數
//   goal：那一天的每日目標（之後改目標，不會影響過去的打卡紀錄）
//
// 跨裝置同步時：'toeic-cards:log' 只放「這台裝置自己」的紀錄；
// 其他裝置的紀錄放在 'toeic-cards:remoteLogs'（{ 裝置 id: 紀錄 }），顯示時加總（getLog）。
import { dayKey } from './srs.js';
import { getSettings } from './store.js';

const LOG_KEY = 'toeic-cards:log';
const REMOTE_KEY = 'toeic-cards:remoteLogs';
const listeners = new Set();       // 這台裝置記錄了學習（同步用來排程上傳）
const totalListeners = new Set();  // 畫面上的總數可能變了：本機記錄，或同步／還原寫入整本帳本

const LEDGER_KEY = 'toeic-cards:logLedger';
const ORIGIN_KEY = 'toeic-cards:logOrigin';
import { profileOwner } from './profile-storage.js';
import { deviceId } from './device-id.js';
import { cleanLedger, ledgerTotal } from './log-ledger.js';

function json(key, fallback) {
  try { return JSON.parse(profileStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
export function logOrigin() {
  let id = json(ORIGIN_KEY, '');
  if (!id) {
    id = profileOwner() || Object.keys(json(LOG_KEY, {})).length ? deviceId() : `guest-${crypto.randomUUID()}`;
    try {profileStorage.setItem(ORIGIN_KEY, JSON.stringify(id));}catch { /* 保留記憶體待重試 */ }
  }
  return id;
}
export function getLogLedger() {
  const stored = json(LEDGER_KEY, null);
  if (stored) return cleanLedger(stored);
  const sources = Object.fromEntries(Object.entries(json(REMOTE_KEY, {})).map(([id,log])=>[id,{log,updatedAt:0}]));
  const own = json(LOG_KEY, {});
  if (Object.keys(own).length) sources[logOrigin()] = {log:own,updatedAt:Date.now()};
  return cleanLedger({sources});
}
export function setLogLedger(raw) {
  const ledger = cleanLedger(raw);
  // ledger 為唯一真實來源，舊欄位僅相容既有測試與舊版匯出工具。
  try {profileStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));}catch {return false;}
  for (const fn of totalListeners) fn();
  const me = logOrigin();
  try {
    profileStorage.setItem(LOG_KEY, JSON.stringify(ledger.sources[me]?.log || {}));
    profileStorage.setItem(REMOTE_KEY, JSON.stringify(Object.fromEntries(Object.entries(ledger.sources).filter(([id])=>id!==me).map(([id,s])=>[id,s.log]))));
  }catch { /* 主帳本仍為唯一來源，失敗會有持續提示 */ }
  return true;
}
function read() { return getLogLedger().sources[logOrigin()]?.log || {}; }
function write(log) {
  const ledger = getLogLedger();
  const me = logOrigin();
  ledger.sources[me] = {log, updatedAt:Math.max(Date.now(),(ledger.sources[me]?.updatedAt || 0)+1)};
  setLogLedger(ledger);
  for (const fn of listeners) fn();
}
export function onLogChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
// 給畫面用：其他裝置的紀錄同步進來時也會通知（onLogChange 不會，否則同步會一直觸發上傳）
export function onLogTotals(fn) { totalListeners.add(fn); return () => totalListeners.delete(fn); }
export function getLog() { return ledgerTotal(getLogLedger()); }
export function getOwnLog() { return read(); }
export function setRemoteLogs(map) {
  const ledger = getLogLedger();
  for (const [id, log] of Object.entries(map || {})) ledger.sources[id] = {log, updatedAt:0};
  setLogLedger(ledger);
}
// 保留舊呼叫端語意：只取代本機來源，不把其他裝置加總寫進這裡。
export function replaceLog(log) { write(log || {}); }

export function currentGoal() {
  return Math.max(1, Number(getSettings().dailyGoal) || 20);
}

// 某一天（所有裝置加總）
export function getDay(now = Date.now()) {
  return { reviews: 0, again: 0, good: 0, learned: 0, quiz: 0, quizCorrect: 0, ...getLog()[dayKey(now)] };
}

// 每日目標的進度：複習一張卡或測驗答一題都算 1
export function dayProgress(day) {
  return Math.max(0, (Number(day?.reviews) || 0) + (Number(day?.quiz) || 0));
}

// 今天的進度一律對照「目前的目標」（今天改目標會立刻生效）
export function todayProgress(now = Date.now()) {
  const day = getDay(now);
  const goal = currentGoal();
  return { done: dayProgress(day), goal, met: dayProgress(day) >= goal };
}

// 寫入當天紀錄，並記下當天的目標（每次寫入都更新，所以是當天最後一次學習時的目標）
function update(now, fn) {
  const log = read();
  const k = dayKey(now);
  const d = { reviews: 0, again: 0, good: 0, learned: 0, ...log[k] };
  fn(d);
  d.goal = currentGoal();   // 以當天最後的目標為準（當天改目標會立刻反映）
  log[k] = d;
  write(log);
}

// 記錄一次複習；delta 為 +1（記錄）或 -1（復原）
export function recordReview(rating, wasNew, now = Date.now(), delta = 1) {
  update(now, (d) => {
    d.reviews += delta;
    d[rating] += delta;
    if (wasNew) d.learned += delta;
  });
}

// 今天已經學了幾個新字（用來控制每日新字上限）
export function learnedToday(now = Date.now()) {
  return getDay(now).learned;
}

// 記錄一題測驗結果
export function recordQuiz(correct, now = Date.now()) {
  update(now, (d) => {
    d.quiz = (Number(d.quiz) || 0) + 1;
    d.quizCorrect = (Number(d.quizCorrect) || 0) + (correct ? 1 : 0);
  });
}
