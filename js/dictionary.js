// 字典查詢：
//   1. 中文意思＋詞性＋音標 → 本機的 ECDICT 子集（data/dict/a.json ~ z.json，按首字母分檔、用到才載入）
//   2. 英文解釋（備援）     → Free Dictionary API（免費、免金鑰）
// LLM 生成的多益版解釋會在第 4 步覆蓋這裡的英文解釋。
import { getWord, getWords, updateWord, updateWords, normalizeWord } from './store.js';
import { hasApiKey } from './llm.js';
import { EXTRA_ENTRIES } from './dictionary-extra.js';

const chunks = new Map(); // 字母 → Promise<{ word: entry }>

function chunkKey(word) {
  const c = word[0];
  return c >= 'a' && c <= 'z' ? c : '_';
}

function loadChunk(key) {
  if (!chunks.has(key)) {
    const p = fetch(`data/dict/${key}.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => {
        chunks.delete(key); // 網路失敗下次可重試
        return {};
      });
    chunks.set(key, p);
  }
  return chunks.get(key);
}

// 回傳 { phonetic, pos, zh } 或 null
export async function lookupLocal(word) {
  const w = normalizeWord(word);
  if (!w) return null;
  const chunk = await loadChunk(chunkKey(w));
  const e = EXTRA_ENTRIES[w] || chunk[w];
  if (!e) return null;
  return { phonetic: e.p || '', pos: e.s || '', zh: e.t || '' };
}

// Free Dictionary API：回傳
//   { status: 'ok', en, phonetic } | { status: 'notfound' } | { status: 'error' }
// 'error'（離線、伺服器掛掉）之後會再重試；'notfound' 就不再查
export async function lookupEnglish(word, preferPos = '', { signal } = {}) {
  const w = normalizeWord(word);
  let res;
  try {
    res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`, { signal });
  } catch (e) {
    return { status: 'error' };
  }
  if (res.status === 404) return { status: 'notfound' };
  if (!res.ok) return { status: 'error' };
  let data;
  try { data = await res.json(); } catch (e) { return { status: 'error' }; }
  if (!Array.isArray(data)) return { status: 'notfound' };

  const meanings = data.flatMap((d) => d.meanings || []);
  const posMap = { 'n.': 'noun', 'v.': 'verb', 'vt.': 'verb', 'vi.': 'verb', 'adj.': 'adjective', 'adv.': 'adverb', 'prep.': 'preposition', 'conj.': 'conjunction' };
  const first = preferPos.split(/[\s/,]+/)[0];
  const want = posMap[first];
  const m = (want && meanings.find((x) => x.partOfSpeech === want)) || meanings[0];
  const def = m?.definitions?.[0]?.definition || '';
  const phonetic = data.map((d) => d.phonetic).find(Boolean)
    || data.flatMap((d) => d.phonetics || []).map((p) => p.text).find(Boolean) || '';
  return def ? { status: 'ok', en: def, phonetic } : { status: 'notfound' };
}

// 字典只補空白欄位，絕不覆蓋已有內容（使用者手動改過的也一樣）
function canFill(w, field) {
  return !w[field];
}

const pending = new Set();   // 還沒查完的字
const queue = [];            // 等著查英文解釋的字
let running = false;
let batchTotal = 0;          // 這一輪總共要查幾個字（顯示進度用）
const statusListeners = new Set();

export function onLookupStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

export function lookupStatus() {
  return { pending: pending.size, total: batchTotal, done: batchTotal - pending.size };
}

function emitStatus() {
  const st = lookupStatus();
  for (const fn of statusListeners) fn(st);
}

export function isLookingUp(id) {
  return pending.has(id);
}

// 第一階段：本機字典（中文、詞性、音標）。很快，整批一起處理、只存一次檔
async function fillLocal(ids) {
  // 1. 先把需要的字典資料都查好（會等待下載）
  const found = new Map();
  for (const id of ids) {
    const w = getWord(id);
    if (!w || (w.zh && w.phonetic)) continue;
    const local = await lookupLocal(w.word);
    if (local) found.set(id, local);
  }
  // 2. 再「一口氣」檢查並寫入，中間沒有任何等待：
  //    等待下載時 AI 可能已經寫好內容，這時要看最新的資料，才不會用字典蓋掉 AI 的結果
  const patches = [];
  for (const id of ids) {
    const w = getWord(id);
    if (!w) continue;
    // 查本機與完成標記一起批次存，避免後面的純本機佇列逐字重存所有字卡。
    const patch = { lookup: { ...(w.lookup || {}), dictAt: Date.now(), enDone: !!w.lookup?.enDone } };
    const local = found.get(id);
    const src = { ...(w.src || {}) };
    if (canFill(w, 'zh') && local?.zh) {
      patch.zh = local.zh;
      src.zh = 'dict';
      if (!w.pos && local.pos) { patch.pos = local.pos; src.pos = 'dict'; }
    }
    if (!w.phonetic && local?.phonetic) patch.phonetic = local.phonetic;
    if (Object.keys(patch).length) patches.push([id, { ...patch, src }]);
  }
  updateWords(patches);
}

// 第二階段：線上查英文解釋。回傳是否真的送出了網路請求
async function fillEnglish(id) {
  let w = getWord(id);
  if (!w) return false;
  const patch = {};
  let enDone = !!w.lookup?.enDone;
  let usedNetwork = false;
  // 有 Gemini 金鑰時，英文解釋交給 AI 生成（比較貼近多益）；AI 失敗的字才用字典補
  const llmWillWrite = hasApiKey() && w.autoGenerate !== false && w.llm?.status !== 'failed';
  if (canFill(w, 'en') && !enDone && !llmWillWrite) {
    usedNetwork = true;
    const eng = await lookupEnglish(w.word, w.pos);
    w = getWord(id);
    if (!w) return true;
    if (eng.status === 'ok') {
      if (canFill(w, 'en')) {
        patch.en = eng.en;
        patch.src = { ...(w.src || {}), en: 'freedict' };
      }
      if (!w.phonetic && eng.phonetic) patch.phonetic = eng.phonetic;
    }
    enDone = eng.status !== 'error';
  }
  if (usedNetwork) updateWord(id, { ...patch, lookup: { ...(w.lookup || {}), dictAt: Date.now(), enDone } });
  return usedNetwork;
}

// 加入查詢：先整批查本機字典，再排隊查英文（避免一次對 Free Dictionary API 送太多請求）
export async function enqueueLookup(ids) {
  const fresh = ids.filter((id) => !pending.has(id));
  if (!fresh.length) return;
  if (!pending.size) batchTotal = 0;
  fresh.forEach((id) => pending.add(id));
  batchTotal += fresh.length;
  emitStatus();
  try {
    await fillLocal(fresh);
  } catch (e) {
    console.warn('查本機字典失敗', e);
  }
  queue.push(...fresh);
  emitStatus();
  if (!running) runQueue();
}

async function runQueue() {
  running = true;
  while (queue.length) {
    const id = queue.shift();
    let usedNetwork = false;
    try {
      usedNetwork = await fillEnglish(id);
    } catch (e) {
      console.warn('查英文解釋失敗', id, e);
    }
    pending.delete(id);
    // 本機完成的字不需要逐字重建畫面；網路查詢保留逐字進度，純本機一次更新。
    if (usedNetwork || !queue.length) emitStatus();
    if (usedNetwork && queue.length) await new Promise((r) => setTimeout(r, 250));
  }
  running = false;
}

// 開啟網站時，把還沒查過字典的字補查一次
export function lookupMissing() {
  const ids = getWords()
    .filter((w) => !w.lookup?.dictAt || (!w.en && !w.lookup?.enDone))
    .map((w) => w.id);
  if (ids.length) enqueueLookup(ids);
}
