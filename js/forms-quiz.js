import {currentSavedQuestion} from './question-policy.js';
import {questionEnabled} from './question-reports.js';
import {reviewGenerated} from './question-review.js';
// 詞性變化題：四個選項是同一個字的不同形式（approve／approval／approving／approved），多益 Part 5 最常考的題型
//
// 每個字的題目來源（依序）：
//   1. 內建題庫 data/packs/toeic-1000-forms.json：多益 1000 單字包的字，不用金鑰、離線也能練（第一次用時才下載）
//   2. 字卡上存過的 AI 題目 word.formQs：最多 3 題，輪流使用「最久沒考過」的
//   3. 有 Gemini 金鑰時，替還沒有題目的字出題（每 10 個字一次請求），存起來重複使用
// 沒有金鑰時，只從前兩種來源有題目的字出題，不會考到一半卡住
//
// 和 Part 5 一樣不讓使用者乾等：馬上能考的字排前面、第一批 AI 只出 5 題就開考、其餘邊考邊補；
// ai-stock.js 會在背景替「自己加的字」先備題（formsStockNeed／fillForms）。
import { getWord, updateWords } from './store.js';
import { generateJSON, LlmError, hasApiKey } from './llm.js';
import { beginForeground } from './ai-prefetch.js';
import { splitBatches, BATCH_SIZE } from './part5.js?v=part5-fast-1';
import { normalizeWord } from './parse.js';
import { buildFormsPrompt, FORMS_SCHEMA, normalizeFormQ, formsQuestion, parseFormsBank, pickTargets, pickInTiers } from './quiz.js?v=forms-1';

export const FORMS_BANK_URL = new URL('../data/packs/toeic-1000-forms.json?v=quality-2', import.meta.url);
const MAX_PER_WORD = 3;
let bankPromise = null;
let loadedBank = null;   // 已經載入的題庫（測驗首頁用來判斷哪些字有內建題目）

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function loadFormsBank() {
  if (!bankPromise) {
    bankPromise = fetch(FORMS_BANK_URL)
      .then((res) => {
        if (!res.ok) throw new Error('詞性變化題庫目前讀不到，請連上網路後重試');
        return res.json();
      })
      .then((raw) => { loadedBank = parseFormsBank(raw, normalizeWord); return loadedBank; })
      .catch((err) => {
        bankPromise = null;   // 失敗不要留在快取裡，下次再試
        if (err instanceof TypeError || err instanceof SyntaxError) throw new Error('無法讀取詞性變化題庫，請連上網路後重試');
        throw err;
      });
  }
  return bankPromise;
}

// 題庫還沒載入時回傳 null
export function loadedFormsBank() {
  return loadedBank;
}

// 一批字：出題 → 覆核，兩次請求；回傳 { ok: 成功存題的字 id, rejected: 被刷掉的題數 }
async function generateBatch(batch, signal, onPhase) {
  onPhase?.('generate');
  const { data } = await generateJSON({
    prompt: buildFormsPrompt(batch.map((w) => w.word)),
    schema: FORMS_SCHEMA,
    signal,
    temperature: 0.8,
  });
  const list = Array.isArray(data?.questions) ? data.questions : [];
  const byTarget = new Map(list.map((q) => [normalizeWord(q?.target), q]));
  const normalized=batch.map((it,i)=>normalizeFormQ(byTarget.get(normalizeWord(it.word)) || (list.length===batch.length ? list[i] : null),it.word));
  onPhase?.('review');
  const approved=await reviewGenerated(normalized.filter(Boolean),signal);
  const now = Date.now();
  const patches = [];
  const ok = [];
  batch.forEach((it, i) => {
    const q = approved.get(normalized[i]);
    const w = getWord(it.id);
    if (!q || !w) return;
    patches.push([w.id, { formQs: [...(w.formQs || []), { id: newId(), ...q, at: now, usedAt: 0 }].slice(-MAX_PER_WORD) }]);
    ok.push(w.id);
  });
  updateWords(patches);
  return { ok, rejected: batch.length - ok.length };
}

// 每個字的題目來源判斷（bank 是載入好的題庫 Map）
function sources(bank) {
  const builtinOf = (w) => (bank.get(normalizeWord(w.word))||[]).filter(q=>questionEnabled(formsQuestion(w,q)));
  const savedOf = (w) => (w.formQs||[]).filter(q=>currentSavedQuestion(q)&&questionEnabled(formsQuestion(w,q)));
  return {
    builtinOf, savedOf,
    inBank: (w) => builtinOf(w).length > 0,
    hasSaved: (w) => savedOf(w).length > 0,
    hasUnused: (w) => savedOf(w).some((q) => !q.usedAt),
  };
}

// 準備詞性變化測驗
//   targets：可以考的字（已依範圍篩選）；count：題數
//   fresh：有金鑰時，自己的字一律重新出題（內建題庫的字照常使用題庫）
//   onProgress／onQuestions：和 preparePart5 一樣，有題目就先通知，不必等 AI 全部出完
// 回傳 { questions, failed, skipped, bankUnavailable, rejected, error? }：題庫故障時只重用已存題目，不送 AI。
// failed 是 AI 出題失敗的字，skipped 是這次沒有可用題目而略過的字數。
export async function prepareForms(targets, count, { fresh = false, signal, onProgress, onQuestions } = {}) {
  const end = beginForeground();
  try {
    let bank;
    let bankError = null;
    try { bank = await loadFormsBank(); }
    catch (err) { bankError = err; bank = new Map(); }
    if (signal?.aborted) throw new LlmError('aborted', '已停止');
    // 題庫不可用時，只重用已存題目；不能把原本免費的內建字誤送給 AI。
    const canAI = hasApiKey() && !bankError;
    const useFresh = fresh && !bankError;
    const { builtinOf, savedOf, inBank, hasSaved, hasUnused } = sources(bank);
    if (bankError && !targets.some(hasSaved)) throw bankError;
    const answerable = (w) => inBank(w) || hasSaved(w) || canAI;
    const pool = targets.filter(answerable);
    // 馬上能考的排前面，要 AI 出題的其次，已經考過的存題最後（出新題目時不分先後）
    const picked = useFresh ? pickTargets('forms', pool, count) : pickInTiers('forms', pool, count, [
      (w) => inBank(w) || hasUnused(w) || (w.unfamiliar && hasSaved(w)),
      (w) => !hasSaved(w),
      () => true,
    ]);
    const skipped = canAI ? 0 : targets.filter((w) => !answerable(w)).length;
    const need = picked.filter((w) => !inBank(w) && canAI && (useFresh || !hasSaved(w)));

    const now = Date.now();
    const all = [];
    // 把一些字變成題目（記下存題的使用時間），有題目就通知畫面
    const emit = (words, newest) => {
      const questions = [];
      const patches = [];
      for (const t of words) {
        const w = getWord(t.id);
        if (!w) continue;
        const builtin = builtinOf(w);
        if (builtin.length) {
          questions.push(formsQuestion(w, builtin[Math.floor(Math.random() * builtin.length)]));
          continue;
        }
        const saved = savedOf(w);
        if (!saved.length) continue;
        const q = newest ? saved[saved.length - 1] : [...saved].sort((a, b) => (a.usedAt || 0) - (b.usedAt || 0))[0];
        questions.push(formsQuestion(w, q));
        patches.push([w.id, { formQs: saved.map((x) => (x.id === q.id ? { ...x, usedAt: now } : x)) }]);
      }
      updateWords(patches);
      const ok = questions.filter(questionEnabled);
      if (ok.length) { all.push(...ok); onQuestions?.(ok); }
    };
    emit(picked.filter((w) => !need.includes(w)), false);

    const batches = splitBatches(need);
    const failed = [];
    let rejected = 0;
    let done = 0;
    const progress = (extra) => onProgress?.({ done, total: need.length, batches: batches.length, ...extra });
    progress({ batch: 0, phase: 'generate' });
    const result = (extra) => ({ questions: all, failed, skipped, bankUnavailable: !!bankError, rejected, ...extra });
    for (const [n, batch] of batches.entries()) {
      let ok = [];
      try {
        const r = await generateBatch(batch, signal, (phase) => progress({ batch: n + 1, phase }));
        ok = r.ok;
        rejected += r.rejected;
      } catch (err) {
        if (err instanceof LlmError && ['key', 'model', 'quota', 'aborted'].includes(err.kind)) {
          if (!all.length || err.kind === 'aborted') throw err;
          batches.slice(n).flat().forEach((w) => failed.push(w.id));
          return result({ error: err.message });
        }
        console.warn('詞性變化出題失敗', err);   // 這一批失敗，其他批繼續
      }
      batch.forEach((w) => { if (!ok.includes(w.id)) failed.push(w.id); });
      done += batch.length;
      progress({ batch: n + 1, phase: 'done' });
      emit(batch.filter((w) => ok.includes(w.id)), useFresh);
    }
    return result();
  } finally {
    end();
  }
}

// ---- 背景補題（由 ai-stock.js 排程、扣每日額度）----

// 範圍內「馬上能考」的字（內建題、還沒考過的存題）少於 goal，而且還有自己加的字沒有題目 → 回傳下一批
export async function formsStockNeed(targets, goal) {
  let bank;
  try { bank = await loadFormsBank(); } catch (e) { return null; }   // 題庫讀不到時不要把內建字送去 AI
  const { inBank, hasSaved, hasUnused } = sources(bank);
  const ready = targets.filter((w) => inBank(w) || hasUnused(w)).length;
  if (ready >= Math.min(goal, targets.length)) return null;
  const batch = pickTargets('forms', targets.filter((w) => !inBank(w) && !hasSaved(w)), BATCH_SIZE);
  return batch.length ? batch : null;
}

export function fillForms(batch, signal) {
  return generateBatch(batch, signal);
}

// 範圍內自己加的字（不在內建題庫）有幾個字備好還沒考過的 AI 題目；題庫還沒載入時回傳 null
export function formsStockReady(targets) {
  if (!loadedBank) return null;
  const { inBank, hasUnused } = sources(loadedBank);
  return targets.filter((w) => !inBank(w) && hasUnused(w)).length;
}
