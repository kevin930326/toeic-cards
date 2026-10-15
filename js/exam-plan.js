// 考試倒數＋讀書計畫的純邏輯（不碰畫面、不碰儲存，方便單獨測試）
//
// 建議每天新字數 ＝ 還沒學的字 ÷ 可以學新字的天數
//   - 離考試超過 14 天：新字在考前一週學完，最後一週留給複習
//   - 14 天以內：每一天都用來學新字
// 「今天」和其他統計一樣，早上 4 點才換日（見 srs.js 的 dayKey）
import { dayKey } from './srs.js';

export const REVIEW_WEEK = 7;      // 考前留幾天只複習、不學新字
const LONG_ENOUGH = 14;            // 離考試超過幾天才保留複習週
const MAX_SUGGESTED = 200;         // 可套用的建議上限；是否趕得上另依實際需要判斷。

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// 'YYYY-MM-DD' 而且是真的日期（擋掉 2026-02-30 這種）
export function isValidExamDate(value) {
  const m = DATE_RE.exec(String(value || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

const utcDay = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

// 離考試還有幾天：考試當天是 0，已經過了是負數
export function daysUntilExam(examDate, now = Date.now()) {
  if (!isValidExamDate(examDate)) return null;
  return utcDay(examDate) - utcDay(dayKey(now));
}

// 讀書計畫；沒有設定（或格式不對）回傳 null
//   words：要算進計畫的字（沒有 srs 的就是還沒學過的新字）
//   newPerDay：目前設定的每天新字數
export function examPlan({ examDate, words = [], newPerDay = 20, now = Date.now() }) {
  const days = daysUntilExam(examDate, now);
  if (days === null) return null;
  const newLeft = words.filter((w) => !w.srs).length;
  const current = Math.max(1, Number(newPerDay) || 20);
  if (days < 0) return { status: 'past', days, newLeft, current };
  if (days === 0) return { status: 'today', days, newLeft, current };
  if (!newLeft) return { status: 'allLearned', days, newLeft, current };
  const learnDays = days > LONG_ENOUGH ? days - REVIEW_WEEK : days;
  const requiredPerDay = Math.ceil(newLeft / learnDays);
  const suggested = Math.min(MAX_SUGGESTED, requiredPerDay);
  return {
    status: 'ok',
    days,
    newLeft,
    learnDays,
    reviewWeek: days > LONG_ENOUGH,
    suggested,
    requiredPerDay,
    capped: requiredPerDay > suggested,
    current,
    daysAtCurrent: Math.ceil(newLeft / current),   // 照目前的速度，幾天學完
    onTrack: current >= requiredPerDay,
  };
}
