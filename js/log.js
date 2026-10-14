// 每日學習紀錄（統計、每日目標、連續打卡都用它）
// 存在 localStorage：{ '2026-10-14': { reviews, again, good, learned, quiz, quizCorrect, goal } }
//   reviews／again／good／learned：複習；quiz／quizCorrect：測驗題數、答對題數
//   goal：那一天的每日目標（之後改目標，不會影響過去的打卡紀錄）
//
// 跨裝置同步時：'toeic-cards:log' 只放「這台裝置自己」的紀錄；
// 其他裝置的紀錄放在 'toeic-cards:remoteLogs'（{ 裝置 id: 紀錄 }），顯示時加總（getLog）。
import { dayKey } from './srs.js';
import { getSettings } from './store.js';
import { combineLogs } from './sync-core.js';

const LOG_KEY = 'toeic-cards:log';
const REMOTE_KEY = 'toeic-cards:remoteLogs';
const listeners = new Set();

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(LOG_KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (e) {
    return {};
  }
}

function write(log) {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch (e) { console.error('寫入學習紀錄失敗', e); }
  for (const fn of listeners) fn();
}

// 紀錄改變時通知（例如：達成每日目標的慶祝訊息）
export function onLogChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function readRemote() {
  try {
    const v = JSON.parse(localStorage.getItem(REMOTE_KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (e) {
    return {};
  }
}

// 所有裝置加總後的紀錄（統計、打卡、每日目標都用這個）
export function getLog() {
  return combineLogs(read(), Object.values(readRemote()));
}

// 只有這台裝置自己的紀錄（同步時上傳這份）
export function getOwnLog() {
  return read();
}

// 同步時把其他裝置的紀錄存起來（不跳慶祝訊息）
export function setRemoteLogs(map) {
  try { localStorage.setItem(REMOTE_KEY, JSON.stringify(map && typeof map === 'object' ? map : {})); } catch (e) { /* 存不了只是統計少算 */ }
}

// 匯入備份時整個換掉（不通知「紀錄改變」，免得匯入時跳出達標慶祝）
export function replaceLog(log) {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log && typeof log === 'object' ? log : {}));
  } catch (e) {
    console.error('寫入學習紀錄失敗', e);
  }
}

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
