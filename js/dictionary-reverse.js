// 中文 → 英文反查：讀 tools/build_reverse_index.py 產生的分片，不用 AI、不必登入。
// 分片依「中文字碼位 % 512」切開；查詢時讀每個字（最多 4 個）的分片後合併，
// 找出釋義「包含」查詢文字的英文字。排序：完全相同 → 開頭相同 → 包含 → 部分符合，再看字典排名。
// 簡體輸入會用 s2t.json 轉成繁體再查一次。
import { createJsonCache } from './dictionary-data.js';

const CJK = /[㐀-鿿]/;
export const REVERSE_LIMIT = 10;
const OBSCURE = 300_000;
export const PARTIAL = 3;

export function hasChinese(text) {
  return CJK.test(String(text || ''));
}

// 只保留中文字，去掉空白與標點；最多 10 個字
export function normalizeChinese(text) {
  return [...String(text || '')].filter((char) => CJK.test(char)).join('').slice(0, 10);
}

export function reverseShard(char) {
  return (char.codePointAt(0) % 512).toString(16).padStart(3, '0');
}

// s2t.json 是「簡繁簡繁…」字串；轉成 Map 後逐字轉換
export function parseS2T(text) {
  const map = new Map();
  const chars = [...String(text || '')];
  for (let i = 0; i + 1 < chars.length; i += 2) map.set(chars[i], chars[i + 1]);
  return map;
}

export function toTraditional(text, map) {
  return [...text].map((char) => map?.get(char) || char).join('');
}

// 比對時忽略「使延期」的「使」與「重要的」的「的」，讓動詞、形容詞不會被名詞擠到後面
const core = (text) => text.replace(/^[使被]/, '').replace(/[的地]$/, '') || text;

// 某個中文詞和查詢的符合程度：0 完全相同、1 開頭相同、2 包含、3 部分符合（查詢裡含有這個詞）、-1 不符
export function matchKind(term, query) {
  if (term === query || core(term) === core(query)) return 0;
  if (term.startsWith(query)) return 1;
  if (term.includes(query)) return 2;
  return term.length >= 2 && query.includes(term) ? PARTIAL : -1;
}

// entries：[中文詞, 英文字, 排名分數, 詞性]；同一個英文字只留最符合的那個中文詞
export function rankReverse(entries, query, limit = REVERSE_LIMIT) {
  const best = new Map();
  for (const [term, word, score, pos = ''] of entries) {
    const match = matchKind(term, query);
    if (match < 0) continue;
    // 冷僻字（索引等級 3，分數 ≥ 300000）退一級，讓常用的「開頭相同」排在它前面
    const kind = match + (score >= OBSCURE && match < PARTIAL ? 1 : 0);
    // 部分符合時，對到的詞越長越接近查詢
    const key = [Math.min(kind, PARTIAL), match === PARTIAL ? -term.length : 0, score, term.length];
    const prev = best.get(word);
    if (!prev || compare(key, prev.key) < 0) best.set(word, { word, term, pos, partial: match === PARTIAL, key });
  }
  return [...best.values()].sort((a, b) => compare(a.key, b.key) || a.word.localeCompare(b.word))
    .slice(0, limit).map(({ key, ...item }) => item);
}

function compare(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// 收藏的字卡（含使用者自己改過的中文）排最前面，最多 3 個
export function ownedMatches(query, owned = [], limit = 3) {
  const out = [];
  for (const card of owned) {
    const zh = String(card.zh || '');
    if (!zh.includes(query)) continue;
    const term = zh.split(/[\n；;，,、]/).map((part) => part.replace(/^[a-z]+\.\s*/i, '').trim()).find((part) => part.includes(query)) || query;
    out.push({ word: card.word, term, pos: card.pos || '', partial: false, key: matchKind(term, query) });
  }
  return out.sort((a, b) => a.key - b.key).slice(0, limit).map(({ key, ...item }) => item);
}

async function fetchShard(key) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`data/dict/reverse-v1/${key}.json`, { signal: controller.signal });
    return response.ok ? await response.json() : null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

// 回傳 { words: [{ word, term, pos, partial, owned }], query, status: 'ok' | 'unavailable' | 'invalid' }
// query 是實際查詢的文字（簡體輸入時是轉好的繁體）
export function createReverseLookup(load = fetchShard) {
  const shard = createJsonCache(load, 12);
  async function search(query, owned) {
    const chars = [...new Set(query)].slice(0, 4);
    const shards = await Promise.all(chars.map((char) => shard(reverseShard(char))));
    const entries = shards.flatMap((data, i) => (data && data[chars[i]]) || []);
    const mine = ownedMatches(query, owned);
    const seen = new Set(mine.map((item) => item.word));
    const words = [...mine, ...rankReverse(entries, query, REVERSE_LIMIT + mine.length).filter((item) => !seen.has(item.word))]
      .slice(0, REVERSE_LIMIT);
    return { words, unavailable: shards.some((data) => data === null) };
  }
  return async (value, owned = []) => {
    let query = normalizeChinese(value);
    if (!query) return { words: [], query, status: 'invalid' };
    const s2t = await shard('s2t');
    const traditional = toTraditional(query, s2t ? parseS2T(s2t) : null);
    let result = await search(query, owned);
    // 簡體或混用時，轉成繁體再查；完整符合比較多的那次為準
    if (traditional !== query) {
      const converted = await search(traditional, owned);
      const full = (r) => r.words.filter((item) => !item.partial).length;
      if (full(converted) > full(result) || (full(converted) === full(result) && converted.words.length > result.words.length)) {
        result = converted; query = traditional;
      }
    }
    const ownSet = new Set(owned.map((card) => card.word));
    return { words: result.words.map((item) => ({ ...item, owned: ownSet.has(item.word) })), query,
      status: result.unavailable ? 'unavailable' : 'ok' };
  };
}

export const lookupReverse = createReverseLookup();
