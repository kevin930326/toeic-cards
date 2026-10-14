// 批次生成多益內容：一次把最多 20 個字放進同一個 Gemini 請求
//
// 每個字的 llm 狀態存在 word.llm：
//   { status: 'done', at }                  生成好了，之後翻卡都讀已存的資料
//   { status: 'failed', at, error }         失敗了，可以按「重試」
// 使用者手動改過的欄位（src[欄位] === 'user'）不會被覆蓋。
import { getWord, getWords, updateWords } from './store.js';
import { generateJSON, hasApiKey, LlmError } from './llm.js';

const BATCH_SIZE = 20;
const FIELDS = ['pos', 'zh', 'en', 'examples', 'collocations', 'forms', 'synonyms'];

const queue = [];          // 等待生成的字 id
const inQueue = new Set();
let running = false;
let controller = null;
const status = {
  total: 0,         // 這一輪總共幾個字
  done: 0,          // 已成功
  failed: 0,        // 這一輪失敗
  current: 0,       // 正在送出的這批有幾個字
  waiting: 0,       // 限速等待剩餘秒數
  error: null,      // 讓整個佇列停下來的錯誤（金鑰、模型、額度）
};
const listeners = new Set();

export function onGenerateStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function generateStatus() {
  return { ...status, running, queued: queue.length };
}
function emit() {
  const st = generateStatus();
  for (const fn of listeners) fn(st);
}
export function setWaiting(sec) {
  if (status.waiting !== sec) {
    status.waiting = sec;
    emit();
  }
}
export function isGenerating(id) {
  return inQueue.has(id);
}

export function needsGeneration(w) {
  return !w.llm || (w.llm.status !== 'done' && w.llm.status !== 'failed');
}

export function countByState() {
  const all = getWords();
  return {
    missing: all.filter(needsGeneration).length,
    failed: all.filter((w) => w.llm?.status === 'failed').length,
    done: all.filter((w) => w.llm?.status === 'done').length,
  };
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    words: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          word: { type: 'STRING' },
          pos: { type: 'STRING' },
          zh: { type: 'STRING' },
          en: { type: 'STRING' },
          examples: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { en: { type: 'STRING' }, zh: { type: 'STRING' } },
              required: ['en', 'zh'],
            },
          },
          collocations: { type: 'ARRAY', items: { type: 'STRING' } },
          forms: { type: 'ARRAY', items: { type: 'STRING' } },
          synonyms: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['word', 'pos', 'zh', 'en', 'examples', 'collocations', 'forms', 'synonyms'],
      },
    },
  },
  required: ['words'],
};

export function buildPrompt(words) {
  return `You are helping a Taiwanese learner prepare for the TOEIC test.
For each English word or phrase below, write a vocabulary card focused on the meaning most commonly tested on TOEIC (business, office, finance, travel, shopping, hiring contexts).

Rules for each item:
- "word": copy the input word exactly.
- "pos": part(s) of speech as abbreviations ("n.", "v.", "adj.", "adv.", "prep.", "conj.", "phr."), most TOEIC-relevant first, separated by " / ".
- "zh": Traditional Chinese as used in Taiwan (繁體中文、台灣用語, never Simplified Chinese). One line per part of speech, formatted like "v. 核准；批准". Put the TOEIC meaning first. At most 3 lines, at most 4 meanings per line. Separate lines with "\\n".
- "en": one simple English explanation (CEFR B1, max 20 words) of the TOEIC meaning, without using the word itself.
- "examples": exactly 2 natural TOEIC-style sentences using the word, each with a Traditional Chinese (Taiwan) translation in "zh".
- "collocations": 2-4 common collocations containing the word.
- "forms": related word-family members with part of speech, e.g. "approval (n.)". Do not repeat the word itself. Empty array if none.
- "synonyms": 1-3 synonyms for the TOEIC meaning.
Return every input word exactly once, in the same order.

Words:
${words.map((w, i) => `${i + 1}. ${w}`).join('\n')}`;
}

const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v, n) => (Array.isArray(v) ? v.map((x) => str(x, 120)).filter(Boolean).slice(0, n) : []);

// 把 LLM 回傳的一筆資料整理成安全的格式
export function sanitizeCard(item) {
  return {
    pos: str(item.pos, 60),
    zh: str(item.zh, 300).replace(/\\n/g, '\n'),
    en: str(item.en, 300),
    examples: (Array.isArray(item.examples) ? item.examples : [])
      .map((e) => ({ en: str(e?.en, 300), zh: str(e?.zh, 300) }))
      .filter((e) => e.en)
      .slice(0, 3),
    collocations: strList(item.collocations, 5),
    forms: strList(item.forms, 6),
    synonyms: strList(item.synonyms, 4),
  };
}

function mergePatch(w, card) {
  const patch = {};
  const src = { ...(w.src || {}) };
  for (const f of FIELDS) {
    if (src[f] === 'user') continue;             // 使用者改過的不動
    const v = card[f];
    if (Array.isArray(v) ? !v.length : !v) continue;  // LLM 沒給就保留原本的
    patch[f] = v;
    src[f] = 'llm';
  }
  patch.src = src;
  patch.llm = { status: 'done', at: Date.now() };
  return patch;
}

// 送出一批字；回傳 { ok: [id], missing: [id] }
async function runBatch(ids, signal) {
  const words = ids.map((id) => getWord(id)).filter(Boolean);
  if (!words.length) return { ok: [], missing: [] };
  let result;
  try {
    result = await generateJSON({ prompt: buildPrompt(words.map((w) => w.word)), schema: SCHEMA, signal });
  } catch (err) {
    // 回應被截斷：把這批拆成兩半重送
    if (err.kind === 'parse' && words.length > 1) {
      const half = Math.ceil(words.length / 2);
      const a = await runBatch(ids.slice(0, half), signal);
      const b = await runBatch(ids.slice(half), signal);
      return { ok: [...a.ok, ...b.ok], missing: [...a.missing, ...b.missing] };
    }
    throw err;
  }
  const items = Array.isArray(result.data?.words) ? result.data.words : [];
  const byWord = new Map(items.map((it) => [str(it?.word).toLowerCase(), it]));
  const patches = [];
  const ok = [];
  const missing = [];
  words.forEach((w, i) => {
    // 先用字對應；對不到就用順序對應（LLM 偶爾會改大小寫或加標點）
    let item = byWord.get(w.word);
    if (!item && items.length === words.length) item = items[i];
    const card = item ? sanitizeCard(item) : null;
    const cur = getWord(w.id);
    if (!cur) return;
    if (card && (card.zh || card.en)) {
      patches.push([w.id, mergePatch(cur, card)]);
      ok.push(w.id);
    } else {
      missing.push(w.id);
    }
  });
  updateWords(patches);
  return { ok, missing };
}

function markFailed(ids, message) {
  updateWords(ids.map((id) => [id, { llm: { status: 'failed', at: Date.now(), error: message } }]));
}

export function enqueueGenerate(ids) {
  let added = 0;
  for (const id of ids) {
    if (inQueue.has(id)) continue;
    inQueue.add(id);
    queue.push(id);
    added++;
  }
  if (!added) return;
  if (!running) {
    status.total = 0;
    status.done = 0;
    status.failed = 0;
  }
  status.total += added;
  status.error = null;
  emit();
  if (!running) run();
}

// 生成所有還沒生成的字
export function generateMissing() {
  enqueueGenerate(getWords().filter(needsGeneration).map((w) => w.id));
}

// 重試失敗的字（可以傳 id 只重試一個）
export function retryFailed(id) {
  const ids = id ? [id] : getWords().filter((w) => w.llm?.status === 'failed').map((w) => w.id);
  updateWords(ids.map((x) => [x, { llm: null }]));
  enqueueGenerate(ids);
}

export function stopGenerating() {
  controller?.abort();
}

function clearQueue() {
  for (const id of queue) inQueue.delete(id);
  queue.length = 0;
}

async function run() {
  if (!hasApiKey()) {
    status.error = { kind: 'key', message: '還沒有設定 Gemini API 金鑰' };
    clearQueue();
    emit();
    return;
  }
  running = true;
  controller = new AbortController();
  emit();
  while (queue.length) {
    const batch = queue.splice(0, BATCH_SIZE);
    status.current = batch.length;
    emit();
    try {
      const { ok, missing } = await runBatch(batch, controller.signal);
      status.done += ok.length;
      if (missing.length) {
        markFailed(missing, 'Gemini 沒有回傳這個字的資料');
        status.failed += missing.length;
      }
    } catch (err) {
      const e = err instanceof LlmError ? err : new LlmError('server', err.message || String(err));
      if (e.kind === 'aborted') {
        batch.forEach((id) => inQueue.delete(id));
        status.error = { kind: 'aborted', message: '已停止生成' };
        clearQueue();
        break;
      }
      // 金鑰、模型、額度問題：整個佇列停下來（剩下的字不算失敗，修好後可再生成）
      if (e.kind === 'key' || e.kind === 'model' || e.kind === 'quota') {
        batch.forEach((id) => inQueue.delete(id));
        status.error = { kind: e.kind, message: e.message, detail: e.detail };
        clearQueue();
        break;
      }
      // 其他錯誤（網路、伺服器、格式）：這批標為失敗，繼續下一批
      markFailed(batch, e.message);
      status.failed += batch.length;
    }
    batch.forEach((id) => inQueue.delete(id));
    status.current = 0;
    emit();
  }
  running = false;
  status.current = 0;
  status.waiting = 0;
  controller = null;
  emit();
}
