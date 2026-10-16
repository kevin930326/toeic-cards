// 字典查詢：
//   1. 中文意思＋詞性＋音標 → 常用 ECDICT 子集，再查雜湊分片的完整擴充字典
//   2. 英文解釋（備援）     → Free Dictionary API（免費、免金鑰）
// LLM 生成的多益版解釋會在第 4 步覆蓋這裡的英文解釋。
import { getWord, getWords, updateWord, updateWords, normalizeWord } from './store.js';
import { hasApiKey } from './llm.js';
import { EXTRA_ENTRIES } from './dictionary-extra.js';
import { createJsonCache, dictionaryShard, FORM_LABELS } from './dictionary-data.js';

async function fetchJson(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(path, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
  finally { clearTimeout(timer); }
}
const loadChunk = createJsonCache((key) => fetchJson(`data/dict/${key}.json`), 26);
const loadExtended = createJsonCache((key) => fetchJson(`data/dict/extended-v1/${key}.json`), 16);

function chunkKey(word) {
  const c = word[0];
  return c >= 'a' && c <= 'z' ? c : '_';
}

// 回傳 { phonetic, pos, zh } 或 null
export async function lookupLocal(word) {
  return (await lookupLocalResult(word)).entry;
}

// 額外提供未收錄／無法載入的區別，避免離線時誤稱「字典沒有」。
export async function lookupLocalResult(word) {
  const w = normalizeWord(word);
  if (!w) return { entry: null, status: 'notfound' };
  let e = Object.hasOwn(EXTRA_ENTRIES, w) ? EXTRA_ENTRIES[w] : null;
  const chunk = e ? null : await loadChunk(chunkKey(w));
  if (!e && chunk && Object.hasOwn(chunk, w)) e = chunk[w];
  let extended;
  if (!e) {
    extended = await loadExtended(dictionaryShard(w));
    if (extended && Object.hasOwn(extended, w)) e = extended[w];
  }
  if (!e) return { entry: null, status: !chunk || !extended ? 'unavailable' : 'notfound' };
  const entry = { phonetic: e.p || '', pos: e.s || '', zh: e.t || '',
    lemma: e.l || '', form: (e.f || []).map((kind) => FORM_LABELS[kind]).filter(Boolean).join('／') };
  const fix = inflectionFix(e);
  if (fix) {
    const base = (await lookupLocalResult(e.l)).entry;
    if (base?.zh && !base.lemma) {
      if (fix === 'base') Object.assign(entry, { pos: base.pos, zh: base.zh });
      else entry.zh = `${entry.zh}\n${base.zh}`;
    }
  }
  return { status: 'ok', entry };
}

// 變化形（有 l 原形、f 變化種類）的中文，詞性卻和變化種類對不上時（例如 receives 是第三人稱單數，
// 字典卻寫「n. 受光面」），那筆中文是另一個同形字的意思，不是這個變化形的意思：
//   - 只有 -s 形（第三人稱單數、複數）或比較級／最高級 → 幾乎都是冷門同形字，改用原形的意思（回傳 'base'）
//   - 有 -ing／-ed 形 → 常是有用的衍生意思（bearing 軸承、defined 清晰的），保留並補上原形的意思（'append'）
// 詞性對得上就不動（回傳 ''）。
const FORM_POS = { 3: 'v', p: 'v', d: 'v', i: 'v', s: 'n', r: 'a', t: 'a' };
function posGroups(text) {
  const groups = new Set();
  for (const m of String(text || '').matchAll(/\b(vt|vi|v|n|adj|adv|a)\./g)) {
    groups.add(m[1].startsWith('v') ? 'v' : m[1] === 'n' ? 'n' : 'a');
  }
  return groups;
}
export function inflectionFix(e) {
  const kinds = e?.l ? (e.f || []).filter((k) => FORM_POS[k]) : [];
  if (!kinds.length) return '';
  const own = posGroups(e.s || e.t);
  if (!own.size || kinds.some((k) => own.has(FORM_POS[k]))) return '';
  return kinds.some((k) => 'ipd'.includes(k)) ? 'append' : 'base';
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
  const byId = new Map(getWords().map((w) => [w.id, w]));
  let cursor = 0;
  // 最多四個工作者，避免大量罕見字同時下載數百個檔案。
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      const w = byId.get(id);
      if (!w || (w.zh && w.phonetic)) continue;
      const local = await lookupLocal(w.word);
      if (local) found.set(id, local);
    }
  }));
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
