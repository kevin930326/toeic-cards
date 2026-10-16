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
//   - 挑字時先挑「已備好、還沒考過」的題目和不熟的字，再挑要 AI 出題的字，最後才重考考過的題目
//   - 第一批只出 5 題，出好就先開考，其餘邊考邊補（onQuestions）
//   - ai-stock.js 會在背景把「還沒考過的題目」補到題數的 3 倍（part5StockNeed／fillPart5）
import { getWord, updateWords } from './store.js';
import { generateJSON, LlmError } from './llm.js';
import { beginForeground } from './ai-prefetch.js';
import { buildPart5Prompt, PART5_SCHEMA, normalizePart5, pickDistractors, part5Question, pickTargets, pickInTiers, checkMode } from './quiz.js?v=forms-1';

const FIRST_BATCH_SIZE = 5;
export const BATCH_SIZE = 10;
const MAX_PER_WORD = 3;

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const savedQuestions = (w) => (w.part5 || []).filter(currentSavedQuestion);
export function cachedCount(word) {
  return savedQuestions(word).length;
}
// 有還沒考過的存題（背景備好、或上次出了沒用到）
export const hasUnusedPart5 = (w) => savedQuestions(w).some((q) => !q.usedAt);

// 第一批小一點，其餘每批 10 個字
export function splitBatches(list, first = FIRST_BATCH_SIZE, size = BATCH_SIZE) {
  const out = [];
  if (list.length) out.push(list.slice(0, first));
  for (let i = first; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// 這次要考哪些字：
//   1. 有還沒考過的存題、或不熟而且有存題 → 馬上能考
//   2. 還沒有題目的字 → 要 AI 出題（排在後面，邊考邊補）
//   3. 有存題但都考過了 → 最後才重考，讓單字輪流被考到
// 出新題目（fresh）時每個字都要重出，不分先後
export function pickPart5Targets(targets, count, { fresh = false, rng = Math.random } = {}) {
  if (fresh) return pickTargets('part5', targets, count, rng);
  return pickInTiers('part5', targets, count, [
    (w) => hasUnusedPart5(w) || (w.unfamiliar && cachedCount(w) > 0),
    (w) => !cachedCount(w),
    () => true,
  ], rng);
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
    const saved = w ? savedQuestions(w) : [];
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

// 準備 Part 5 測驗題目
//   targets：要考的字（用 pickPart5Targets 挑好）；pool：可以當錯誤選項的字
//   fresh：true 時全部重新出題
//   onProgress({ done, total, phase, batch, batches })：生成進度（只算需要呼叫 AI 的字）
//   onQuestions(questions)：每有一批題目可以考就通知一次（已存的題目最先通知），讓畫面不必等全部出完
// 回傳 { questions, failed, rejected, error? }；還沒有任何題目時，金鑰／額度等嚴重錯誤會直接丟出 LlmError
export async function preparePart5(targets, pool, { fresh = false, signal, onProgress, onQuestions } = {}) {
  const end = beginForeground();
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
          batches.slice(n).flat().forEach((w) => failed.push(w.id));
          return { questions: all, failed, rejected, error: err.message };
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
    end();
  }
}

// ---- 背景補題（由 ai-stock.js 排程、扣每日額度）----

// 目前範圍還要不要補：還沒考過的題目少於 goal，而且還有沒題目的字 → 回傳下一批要出題的字
export function part5StockNeed(all, targets, goal) {
  if (!checkMode('part5', all, targets).ok) return null;
  const ready = targets.filter(hasUnusedPart5).length;
  if (ready >= Math.min(goal, targets.length)) return null;
  const batch = pickTargets('part5', targets.filter((w) => !cachedCount(w)), BATCH_SIZE);
  return batch.length ? batch : null;
}

export function fillPart5(batch, pool, signal) {
  return generateBatch(batch, pool, signal);
}
