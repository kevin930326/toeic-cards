// 背景先備題：網站開著時，替目前的測驗範圍先把 AI 題目準備好，點進測驗或短文閱讀就不用等
//
// 三種工作輪流做，一次只做一批（每批之間隔 30 秒）：
//   - Part 5：還沒考過的題目補到「題數 × 3」個字（每批 10 字＝出題＋覆核 2 次請求）
//   - 詞性變化：自己加的字（內建題庫沒有的）一樣補到題數 × 3（每批 2 次請求）
//   - 短文閱讀：先寫好下一篇（1 次請求）
// 條件：設定開啟、有金鑰、分頁在前景、連得上網路、沒有在生成字卡內容或前景出題；
// 背景每天最多用 aiPrefetchDaily 次請求（ai-prefetch.js），用完就等明天。
import { getSettings, scopedWords, subscribe } from './store.js';
import { hasApiKey, LlmError } from './llm.js';
import { generateStatus } from './generate.js?v=dictionary-scale-1';
import { foregroundBusy, backgroundBusy, budgetLeft, runBackground } from './ai-prefetch.js';
import { part5StockNeed, fillPart5, hasUnusedPart5 } from './part5.js?v=part5-fast-1';
import { formsStockNeed, fillForms, formsStockReady } from './forms-quiz.js?v=review-fixes-1';
import { readingStockNeed, fillReading, preparedReading } from './reading-store.js';

export const STOCK_MULTIPLIER = 3;
const FIRST_DELAY = 20000;   // 開網站後先等一下，不和載入搶資源
const NEXT_DELAY = 30000;    // 一批完成後隔多久再做下一批
const RETRY_DELAY = 60000;   // 現在不方便（前景在出題、正在生成字卡）時多久後再看
const CHANGE_DELAY = 120000; // 單字或設定改變後多久再檢查（避免一直重算）
const ERROR_PAUSE = 30 * 60000;

// 和測驗頁相同的範圍：目前單字集＋全部／不熟
function quizScope() {
  const all = scopedWords();
  return { all, targets: getSettings().quizScope === 'unfamiliar' ? all.filter((w) => w.unfamiliar) : all };
}
export const stockGoal = () => (Number(getSettings().quizCount) || 10) * STOCK_MULTIPLIER;

const JOBS = [
  { name: 'part5', requests: 2, need: (c) => part5StockNeed(c.all, c.targets, c.goal), run: (batch, c, signal) => fillPart5(batch, c.all, signal) },
  { name: 'forms', requests: 2, need: (c) => formsStockNeed(c.targets, c.goal), run: (batch, c, signal) => fillForms(batch, signal) },
  { name: 'reading', requests: 1, need: (c) => readingStockNeed(c.all), run: (words, c, signal) => fillReading(words, signal) },
];

let turn = 0;            // 下一次從哪一種工作開始看，讓三種輪流
let pausedUntil = 0;     // 金鑰／模型／額度出錯後暫停一段時間
let checking = false;

// 做一批；回傳 'filled'（做了一批）、'enough'（都備好了）、'budget'（今天額度用完）、'skip'（現在不方便）、'off'
export async function topUpOnce() {
  // window.__toeicAiPrefetchOff：自動測試用，避免背景請求干擾其他測試的請求計數
  if (!getSettings().aiPrefetch || !hasApiKey() || window.__toeicAiPrefetchOff) return 'off';
  if (document.visibilityState === 'hidden' || navigator.onLine === false) return 'skip';
  if (checking || foregroundBusy() || backgroundBusy() || generateStatus().running || Date.now() < pausedUntil) return 'skip';
  if (budgetLeft() <= 0) return 'budget';
  checking = true;
  try {
    const ctx = { ...quizScope(), goal: stockGoal() };
    let overBudget = false;
    for (let i = 0; i < JOBS.length; i++) {
      const job = JOBS[(turn + i) % JOBS.length];
      const need = await job.need(ctx);
      if (!need) continue;
      if (budgetLeft() < job.requests) { overBudget = true; continue; }
      if (foregroundBusy()) return 'skip';   // 檢查期間使用者開始了測驗
      turn = (turn + i + 1) % JOBS.length;
      try {
        await runBackground(job.requests, (signal) => job.run(need, ctx, signal));
        return 'filled';
      } catch (err) {
        if (err instanceof LlmError && err.kind === 'aborted') return 'skip';
        console.warn(`背景備題失敗（${job.name}）`, err);
        if (err instanceof LlmError && ['key', 'model', 'quota'].includes(err.kind)) pausedUntil = Date.now() + ERROR_PAUSE;
        return 'skip';
      }
    }
    return overBudget ? 'budget' : 'enough';
  } finally {
    checking = false;
  }
}

let timer = null;
let timerAt = 0;
// 排定下一次檢查；已經排了更早的就不動
export function scheduleTopUp(delay = NEXT_DELAY) {
  const at = Date.now() + delay;
  if (timer && timerAt <= at) return;
  clearTimeout(timer);
  timerAt = at;
  timer = setTimeout(async () => {
    timer = null;
    const r = await topUpOnce();
    if (r === 'filled') scheduleTopUp(NEXT_DELAY);
    else if (r === 'skip') scheduleTopUp(RETRY_DELAY);
    // enough／budget／off：等使用者操作（考完、加字、改設定、回到分頁）再看
  }, delay);
}

export function initAiStock() {
  scheduleTopUp(FIRST_DELAY);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleTopUp(); });
  subscribe(() => { if (getSettings().aiPrefetch && hasApiKey()) scheduleTopUp(CHANGE_DELAY); });
}

// 測驗首頁／短文頁顯示用：目前範圍備好了多少
export function stockStatus() {
  const { targets } = quizScope();
  return {
    part5: targets.filter(hasUnusedPart5).length,
    forms: formsStockReady(targets),
    reading: !!preparedReading(),
  };
}
