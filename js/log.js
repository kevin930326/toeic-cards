// 每日學習紀錄（第 7 步「學習統計」也會用到）
// 存在 localStorage：{ '2026-10-14': { reviews, again, good, learned, quiz, quizCorrect } }
//   reviews／again／good／learned：複習；quiz／quizCorrect：測驗題數、答對題數
import { dayKey } from './srs.js';

const LOG_KEY = 'toeic-cards:log';

function read() {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || '{}'); } catch (e) { return {}; }
}

function write(log) {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch (e) { console.error('寫入學習紀錄失敗', e); }
}

export function getLog() {
  return read();
}

export function getDay(now = Date.now()) {
  return { reviews: 0, again: 0, good: 0, learned: 0, ...read()[dayKey(now)] };
}

// 記錄一次複習；delta 為 +1（記錄）或 -1（復原）
export function recordReview(rating, wasNew, now = Date.now(), delta = 1) {
  const log = read();
  const k = dayKey(now);
  const d = { reviews: 0, again: 0, good: 0, learned: 0, ...log[k] };
  d.reviews += delta;
  d[rating] += delta;
  if (wasNew) d.learned += delta;
  log[k] = d;
  write(log);
}

// 今天已經學了幾個新字（用來控制每日新字上限）
export function learnedToday(now = Date.now()) {
  return getDay(now).learned;
}

// 記錄一題測驗結果
export function recordQuiz(correct, now = Date.now()) {
  const log = read();
  const k = dayKey(now);
  const d = { quiz: 0, quizCorrect: 0, ...log[k] };
  d.quiz += 1;
  if (correct) d.quizCorrect += 1;
  log[k] = d;
  write(log);
}
