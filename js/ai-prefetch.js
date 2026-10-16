// 背景先備題（Part 5、詞性變化、短文閱讀）共用的兩件事：
//   1. 前景優先：使用者按下開始測驗／產生短文時，中止背景正在送的那一批，避免兩邊搶額度
//   2. 每日額度：背景一天最多送幾次請求（設定可選 12／24／40），前景請求不受這個限制
// 這個檔案不 import 出題模組，出題模組都 import 它，才不會互相依賴。
import { profileStorage } from './profile-storage.js';
import { getSettings } from './store.js';
import { dayKey } from './srs.js';

const USAGE_KEY = 'toeic-cards:ai-prefetch';
export const DAILY_CHOICES = [12, 24, 40];
export const DEFAULT_DAILY = 24;

let foreground = 0;
let background = null;   // 背景這一批的 AbortController

// 前景開始出題時呼叫；回傳「結束」函式（呼叫多次也只算一次）
export function beginForeground() {
  foreground++;
  background?.abort();
  let ended = false;
  return () => { if (!ended) { ended = true; foreground--; } };
}
export const foregroundBusy = () => foreground > 0;
export const backgroundBusy = () => !!background;

export function dailyLimit() {
  const n = Number(getSettings().aiPrefetchDaily);
  return DAILY_CHOICES.includes(n) ? n : DEFAULT_DAILY;
}

export function usedToday(today = dayKey(Date.now())) {
  try {
    const v = JSON.parse(profileStorage.getItem(USAGE_KEY) || '{}');
    return v.day === today ? Number(v.requests) || 0 : 0;
  } catch (e) { return 0; }
}

export const budgetLeft = () => Math.max(0, dailyLimit() - usedToday());

function addUsage(requests) {
  const today = dayKey(Date.now());
  try { profileStorage.setItem(USAGE_KEY, JSON.stringify({ day: today, requests: usedToday(today) + requests })); }
  catch (e) { /* 記不住只會多用一點額度 */ }
}

// 在背景執行一批工作：先扣額度（送出就算，不管成功與否），前景開始時 signal 會被中止
export async function runBackground(requests, work) {
  if (background) throw new Error('背景已經有工作在跑');
  background = new AbortController();
  addUsage(requests);
  try {
    return await work(background.signal);
  } finally {
    background = null;
  }
}
