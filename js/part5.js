// 多益 Part 5 句子填空：用 Gemini 出題，題目存在單字上重複使用
//
// word.part5 = [{ id, sentence, answer, distractors, translation, explanation, at, usedAt }]
//   - 每個字最多存 3 題
//   - 出題時優先用「最久沒考過」的存檔題目；沒有存檔（或選了「出新題目」）才呼叫 Gemini
//   - 錯誤選項優先從使用者字卡裡的其他字挑（同詞性優先），由 Gemini 改成和答案一樣的詞形
import { getWord, updateWords } from './store.js';
import { generateJSON, LlmError } from './llm.js';
import { buildPart5Prompt, PART5_SCHEMA, normalizePart5, pickDistractors, part5Question } from './quiz.js?v=forms-1';

const BATCH_SIZE = 10;
const MAX_PER_WORD = 3;

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function cachedCount(word) {
  return word.part5?.length || 0;
}

// 一批字送一次請求；回傳成功存下題目的字 id
async function generateBatch(batch, pool, signal) {
  const items = batch.map((w) => ({
    word: w,
    target: w.word,
    distractors: pickDistractors(w, pool, 3).map((d) => d.word),
  })).filter((it) => it.distractors.length === 3);
  if (!items.length) return [];

  const { data } = await generateJSON({
    prompt: buildPart5Prompt(items),
    schema: PART5_SCHEMA,
    signal,
    temperature: 0.8,   // 高一點，每次出的句子比較不一樣
  });
  const list = Array.isArray(data?.questions) ? data.questions : [];
  const byTarget = new Map(list.map((q) => [String(q?.target || '').trim().toLowerCase(), q]));
  const now = Date.now();
  const patches = [];
  const ok = [];
  items.forEach((it, i) => {
    let raw = byTarget.get(it.target);
    if (!raw && list.length === items.length) raw = list[i];   // 對不到字就用順序對應
    const q = normalizePart5(raw);
    const w = getWord(it.word.id);
    if (!q || !w) return;
    const saved = [...(w.part5 || []), { id: newId(), ...q, at: now, usedAt: 0 }].slice(-MAX_PER_WORD);
    patches.push([w.id, { part5: saved }]);
    ok.push(w.id);
  });
  updateWords(patches);
  return ok;
}

// 準備 Part 5 測驗題目
//   targets：要考的字；pool：可以當錯誤選項的字
//   fresh：true 時全部重新出題
//   onProgress({ done, total })：生成進度（只算需要呼叫 AI 的字）
// 回傳 { questions, failed }；金鑰／額度等嚴重錯誤會直接丟出 LlmError
export async function preparePart5(targets, pool, { fresh = false, signal, onProgress } = {}) {
  const need = targets.filter((w) => fresh || !cachedCount(w));
  const failed = [];
  let done = 0;
  onProgress?.({ done, total: need.length });
  for (let i = 0; i < need.length; i += BATCH_SIZE) {
    const batch = need.slice(i, i + BATCH_SIZE);
    let ok = [];
    try {
      ok = await generateBatch(batch, pool, signal);
    } catch (err) {
      if (err instanceof LlmError && ['key', 'model', 'quota', 'aborted'].includes(err.kind)) throw err;
      console.warn('Part 5 出題失敗', err);   // 這一批失敗，其他批繼續
    }
    batch.forEach((w) => { if (!ok.includes(w.id)) failed.push(w.id); });
    done += batch.length;
    onProgress?.({ done, total: need.length });
  }

  // 每個字挑一題：出新題目時用最新的，否則用最久沒考過的
  const now = Date.now();
  const questions = [];
  const patches = [];
  for (const t of targets) {
    const w = getWord(t.id);
    const saved = w?.part5 || [];
    if (!saved.length || (fresh && failed.includes(t.id))) continue;
    const q = fresh
      ? saved[saved.length - 1]
      : [...saved].sort((a, b) => (a.usedAt || 0) - (b.usedAt || 0))[0];
    questions.push(part5Question(w, q));
    patches.push([w.id, { part5: saved.map((x) => (x.id === q.id ? { ...x, usedAt: now } : x)) }]);
  }
  updateWords(patches);
  return { questions, failed };
}
