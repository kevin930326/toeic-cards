import {currentSavedQuestion} from './question-policy.js';
import {reviewGenerated} from './question-review.js';
import {questionEnabled} from './question-reports.js';
// 多益 Part 5 句子填空：用 Gemini 出題，題目存在單字上重複使用
//
// word.part5 = [{ id, sentence, answer, distractors, translation, explanation, at, usedAt }]
//   - 每個字最多存 3 題
//   - 出題時優先用「最久沒考過」的存檔題目；沒有存檔（或選了「出新題目」）才呼叫 Gemini
//   - 錯誤選項優先從使用者字卡裡的其他字挑（同詞性優先），由 Gemini 改成和答案一樣的詞形
//
// 為了不讓使用者乾等（每批要「出題＋覆核」兩次請求）：
//   - 已存題目的字馬上可以考；第一批只出 5 題，出好就先開考，其餘邊考邊補（onQuestions）
//   - topUpPart5：有金鑰時在背景把目前範圍的存題補到 STOCK_TARGET 個字，每天有請求上限
import { getWord, updateWords, getSettings, scopedWords } from './store.js';
import { generateJSON, LlmError, hasApiKey } from './llm.js';
import { profileStorage } from './profile-storage.js';
import { dayKey } from './srs.js';
import { generateStatus } from './generate.js?v=dictionary-scale-1';
import { buildPart5Prompt, PART5_SCHEMA, normalizePart5, pickDistractors, part5Question, pickTargets, checkMode } from './quiz.js?v=forms-1';

const FIRST_BATCH_SIZE = 5;
const BATCH_SIZE = 10;
const MAX_PER_WORD = 3;
export const STOCK_TARGET = 20;        // 背景補題：範圍內有存題的字補到幾個
export const STOCK_DAILY_BATCHES = 4;  // 背景補題每天最多幾批（每批＝出題＋覆核 2 次請求）
const STOCK_KEY = 'toeic-cards:part5-stock';

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function cachedCount(word) {
  return (word.part5||[]).filter(currentSavedQuestion).length;
}

// 第一批小一點，其餘每批 10 個字
export function splitBatches(list, first = FIRST_BATCH_SIZE, size = BATCH_SIZE) {
  const out = [];
  if (list.length) out.push(list.slice(0, first));
  for (let i = first; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// 一批字：出題 → 覆核，兩次請求；回傳 { ok: 成功存題的字 id, rejected: 被格式檢查或覆核刷掉的題數 }
//   onPhase('generate' | 'review')：讓畫面顯示目前在哪個階段
async function generateBatch(batch, pool, signal, onPhase) {
  const items = batch.map((w) => ({
    word: w,
    target: w.word,
    distractors: pickDistractors(w, pool, 3).map((d) => d.word),
  })).filter((it) => it.distractors.length === 3);
  if (!items.length) return { ok: [], rejected: 0 };

  onPhase?.('generate');
  const { data } = await generateJSON({
    prompt: buildPart5Prompt(items),
    schema: PART5_SCHEMA,
    signal,
    temperature: 0.8,   // 高一點，每次出的句子比較不一樣
  });
  const list = Array.isArray(data?.questions) ? data.questions : [];
  const byTarget = new Map(list.map((q) => [String(q?.target || '').trim().toLowerCase(), q]));
  const normalized = items.map((it,i)=>normalizePart5(byTarget.get(it.target.toLowerCase()) || (list.length===items.length ? list[i] : null)));
  onPhase?.('review');
  const approved = await reviewGenerated(normalized.filter(Boolean),signal);
  const now = Date.now();
  const patches = [];
  const ok = [];
  items.forEach((it, i) => {
    const q = approved.get(normalized[i]);
    const w = getWord(it.word.id);
    if (!q || !w) return;
    const saved = [...(w.part5 || []), { id: newId(), ...q, at: now, usedAt: 0 }].slice(-MAX_PER_WORD);
    patches.push([w.id, { part5: saved }]);
    ok.push(w.id);
  });
  updateWords(patches);
  return { ok, rejected: items.length - ok.length };
}

// 從存題挑一題給這次測驗，並記下使用時間：出新題目時用最新的，否則用最久沒考過的
function takeQuestions(words, fresh, now = Date.now()) {
  const questions = [];
  const patches = [];
  for (const t of words) {
    const w = getWord(t.id);
    const saved = (w?.part5 || []).filter(currentSavedQuestion);
    if (!saved.length) continue;
    const q = fresh ? saved[saved.length - 1] : [...saved].sort((a, b) => (a.usedAt || 0) - (b.usedAt || 0))[0];
    const question = part5Question(w, q);
    if (!questionEnabled(question)) continue;
    questions.push(question);
    patches.push([w.id, { part5: saved.map((x) => (x.id === q.id ? { ...x, usedAt: now } : x)) }]);
  }
  updateWords(patches);
  return questions;
}

// ---- 前景出題與背景補題不同時送請求：前景開始時，背景那批直接中止 ----
let foreground = 0;
let stockController = null;

// 準備 Part 5 測驗題目
//   targets：要考的字；pool：可以當錯誤選項的字
//   fresh：true 時全部重新出題
//   onProgress({ done, total, phase, batch, batches })：生成進度（只算需要呼叫 AI 的字）
//   onQuestions(questions)：每有一批題目可以考就通知一次（已存的題目最先通知），讓畫面不必等全部出完
// 回傳 { questions, failed, rejected }；金鑰／額度等嚴重錯誤會直接丟出 LlmError
export async function preparePart5(targets, pool, { fresh = false, signal, onProgress, onQuestions } = {}) {
  foreground++;
  stockController?.abort();
  try {
    const need = targets.filter((w) => fresh || !cachedCount(w));
    const all = [];
    const emit = (qs) => { if (qs.length) { all.push(...qs); onQuestions?.(qs); } };
    emit(takeQuestions(targets.filter((w) => !need.includes(w)), false));

    const batches = splitBatches(need);
    const failed = [];
    let rejected = 0;
    let done = 0;
    const progress = (extra) => onProgress?.({ done, total: need.length, batches: batches.length, ...extra });
    progress({ batch: 0, phase: 'generate' });
    for (const [n, batch] of batches.entries()) {
      let ok = [];
      try {
        const r = await generateBatch(batch, pool, signal, (phase) => progress({ batch: n + 1, phase }));
        ok = r.ok;
        rejected += r.rejected;
      } catch (err) {
        if (err instanceof LlmError && ['key', 'model', 'quota', 'aborted'].includes(err.kind)) {
          if (!all.length || err.kind === 'aborted') throw err;
          // 已經有題目在考了：停止補題，但不要把考到一半的測驗打斷
          batch.forEach((w) => failed.push(w.id));
          batches.slice(n + 1).flat().forEach((w) => failed.push(w.id));
          return { questions: all, failed, rejected, error: err };
        }
        console.warn('Part 5 出題失敗', err);   // 這一批失敗，其他批繼續
      }
      batch.forEach((w) => { if (!ok.includes(w.id)) failed.push(w.id); });
      done += batch.length;
      progress({ batch: n + 1, phase: 'done' });
      emit(takeQuestions(batch.filter((w) => ok.includes(w.id)), fresh));
    }
    return { questions: all, failed, rejected };
  } finally {
    foreground--;
  }
}

// ---- 背景補題 ----

function stockUsage(today = dayKey(Date.now())) {
  try {
    const v = JSON.parse(profileStorage.getItem(STOCK_KEY) || '{}');
    return v.day === today ? Number(v.batches) || 0 : 0;
  } catch (e) { return 0; }
}
function addStockUsage() {
  const today = dayKey(Date.now());
  try { profileStorage.setItem(STOCK_KEY, JSON.stringify({ day: today, batches: stockUsage(today) + 1 })); } catch (e) { /* 記不住只會多補一批 */ }
}

// 測驗範圍（和測驗頁相同：目前單字集＋全部／不熟）
function quizScopeWords() {
  const all = scopedWords();
  return { all, targets: getSettings().quizScope === 'unfamiliar' ? all.filter((w) => w.unfamiliar) : all };
}

// 目前範圍的存題狀態：ready 是已有題目的字數
export function part5Stock() {
  const { targets } = quizScopeWords();
  const ready = targets.filter((w) => cachedCount(w)).length;
  return { ready, goal: Math.min(STOCK_TARGET, targets.length), usedToday: stockUsage(), dailyLimit: STOCK_DAILY_BATCHES };
}

// 背景補一批題目；回傳 'filled'（還要再補）、'enough'、'skip'（現在不適合）、'stop'（今天不要再試）
export async function topUpPart5() {
  if (!getSettings().part5Prefetch || !hasApiKey() || foreground || stockController) return 'skip';
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return 'skip';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'skip';
  if (generateStatus().running) return 'skip';   // 正在生成字卡內容時讓它先用額度
  if (stockUsage() >= STOCK_DAILY_BATCHES) return 'stop';
  const { all, targets } = quizScopeWords();
  if (!checkMode('part5', all, targets).ok) return 'enough';
  const ready = targets.filter((w) => cachedCount(w)).length;
  if (ready >= Math.min(STOCK_TARGET, targets.length)) return 'enough';
  const batch = pickTargets('part5', targets.filter((w) => !cachedCount(w)), BATCH_SIZE);
  if (!batch.length) return 'enough';
  stockController = new AbortController();
  addStockUsage();
  try {
    await generateBatch(batch, all, stockController.signal);
    return 'filled';
  } catch (err) {
    if (err instanceof LlmError && err.kind === 'aborted') return 'skip';
    console.warn('背景補 Part 5 題目失敗', err);
    return err instanceof LlmError && ['key', 'model', 'quota'].includes(err.kind) ? 'stop' : 'skip';
  } finally {
    stockController = null;
  }
}

// 開網站後等一下再開始補，一批完成後隔一段時間再補下一批；分頁回到前景時也會再檢查
const FIRST_DELAY = 20000;
const NEXT_DELAY = 30000;
let stockTimer = null;
let stockStopped = false;
export function scheduleTopUp(delay = NEXT_DELAY) {
  if (stockStopped || stockTimer) return;
  stockTimer = setTimeout(async () => {
    stockTimer = null;
    const r = await topUpPart5();
    if (r === 'stop') stockStopped = true;
    else if (r === 'filled') scheduleTopUp();
  }, delay);
}
export function initPart5Stock() {
  scheduleTopUp(FIRST_DELAY);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleTopUp(); });
}
