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
import { getWord, updateWords } from './store.js';
import { generateJSON, LlmError, hasApiKey } from './llm.js';
import { normalizeWord } from './parse.js';
import { buildFormsPrompt, FORMS_SCHEMA, normalizeFormQ, formsQuestion, parseFormsBank, pickTargets } from './quiz.js?v=forms-1';

export const FORMS_BANK_URL = new URL('../data/packs/toeic-1000-forms.json?v=quality-2', import.meta.url);
const BATCH_SIZE = 10;
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

// 一批字送一次請求；回傳成功存下題目的字 id
async function generateBatch(batch, signal) {
  const { data } = await generateJSON({
    prompt: buildFormsPrompt(batch.map((w) => w.word)),
    schema: FORMS_SCHEMA,
    signal,
    temperature: 0.8,
  });
  const list = Array.isArray(data?.questions) ? data.questions : [];
  const byTarget = new Map(list.map((q) => [normalizeWord(q?.target), q]));
  const normalized=batch.map((it,i)=>normalizeFormQ(byTarget.get(normalizeWord(it.word)) || (list.length===batch.length ? list[i] : null),it.word));
  const approved=await reviewGenerated(normalized.filter(Boolean),signal);
  const now = Date.now();
  const patches = [];
  const ok = [];
  batch.forEach((it, i) => {
    let raw = byTarget.get(normalizeWord(it.word));
    if (!raw && list.length === batch.length) raw = list[i];   // 對不到字就用順序對應
    const q = approved.get(normalized[i]);
    const w = getWord(it.id);
    if (!q || !w) return;
    patches.push([w.id, { formQs: [...(w.formQs || []), { id: newId(), ...q, at: now, usedAt: 0 }].slice(-MAX_PER_WORD) }]);
    ok.push(w.id);
  });
  updateWords(patches);
  return ok;
}

// 準備詞性變化測驗
//   targets：可以考的字（已依範圍篩選）；count：題數
//   fresh：有金鑰時，自己的字一律重新出題（內建題庫的字照常使用題庫）
// 回傳 { questions, failed, skipped, bankUnavailable }：題庫故障時只重用已存題目，不送 AI。
// failed 是 AI 出題失敗的字，skipped 是這次沒有可用題目而略過的字數。
export async function prepareForms(targets, count, { fresh = false, signal, onProgress } = {}) {
  let bank;
  let bankError = null;
  try { bank = await loadFormsBank(); }
  catch (err) { bankError = err; bank = new Map(); }
  if (signal?.aborted) throw new LlmError('aborted', '已停止');
  // 題庫不可用時，只重用已存題目；不能把原本免費的內建字誤送給 AI。
  const canAI = hasApiKey() && !bankError;
  const useFresh = fresh && !bankError;
  const inBank = (w) => (bank.get(normalizeWord(w.word))||[]).some(q=>questionEnabled(formsQuestion(w,q)));
  const hasSaved = (w) => (w.formQs||[]).some(q=>currentSavedQuestion(q)&&questionEnabled(formsQuestion(w,q)));
  if (bankError && !targets.some(hasSaved)) throw bankError;
  const answerable = (w) => inBank(w) || hasSaved(w) || canAI;
  const ordered = pickTargets('forms', targets, targets.length);
  const picked = ordered.filter(answerable).slice(0, count);
  const skipped = canAI ? 0 : targets.filter((w) => !answerable(w)).length;

  const need = picked.filter((w) => !inBank(w) && canAI && (useFresh || !hasSaved(w)));
  const failed = [];
  let done = 0;
  onProgress?.({ done, total: need.length });
  for (let i = 0; i < need.length; i += BATCH_SIZE) {
    const batch = need.slice(i, i + BATCH_SIZE);
    let ok = [];
    try {
      ok = await generateBatch(batch, signal);
    } catch (err) {
      if (err instanceof LlmError && ['key', 'model', 'quota', 'aborted'].includes(err.kind)) throw err;
      console.warn('詞性變化出題失敗', err);   // 這一批失敗，其他批繼續
    }
    batch.forEach((w) => { if (!ok.includes(w.id)) failed.push(w.id); });
    done += batch.length;
    onProgress?.({ done, total: need.length });
  }

  const now = Date.now();
  const questions = [];
  const patches = [];
  for (const t of picked) {
    const w = getWord(t.id);
    if (!w) continue;
    const builtin = (bank.get(normalizeWord(w.word))||[]).filter(q=>questionEnabled(formsQuestion(w,q)));
    if (builtin.length) {
      questions.push(formsQuestion(w, builtin[Math.floor(Math.random() * builtin.length)]));
      continue;
    }
    const saved = (w.formQs || []).filter(q=>currentSavedQuestion(q)&&questionEnabled(formsQuestion(w,q)));
    if (!saved.length || (useFresh && failed.includes(w.id))) continue;
    const q = useFresh ? saved[saved.length - 1] : [...saved].sort((a, b) => (a.usedAt || 0) - (b.usedAt || 0))[0];
    questions.push(formsQuestion(w, q));
    patches.push([w.id, { formQs: saved.map((x) => (x.id === q.id ? { ...x, usedAt: now } : x)) }]);
  }
  updateWords(patches);
  return { questions:questions.filter(questionEnabled), failed, skipped, bankUnavailable: !!bankError };
}
