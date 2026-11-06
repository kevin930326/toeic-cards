// 中文 → 英文反查：讀 tools/build_reverse_index.py 產生的分片，不用 AI、不必登入。
// 分片依「中文字碼位 % 256」切開；查詢時讀每個字（最多 4 個）的分片後合併，
// 找出釋義「包含」查詢文字的英文字。排序：完全相同 → 開頭相同 → 包含，再看字典排名。
import { createJsonCache } from './dictionary-data.js';

const CJK = /[㐀-鿿]/;
export const REVERSE_LIMIT = 10;
const OBSCURE = 300_000;

export function hasChinese(text) {
  return CJK.test(String(text || ''));
}

// 只保留中文字，去掉空白與標點；最多 10 個字
export function normalizeChinese(text) {
  return [...String(text || '')].filter((char) => CJK.test(char)).join('').slice(0, 10);
}

export function reverseShard(char) {
  return (char.codePointAt(0) % 256).toString(16).padStart(2, '0');
}

// 比對時忽略「使延期」的「使」與「重要的」的「的」，讓動詞、形容詞不會被名詞擠到後面
const core = (text) => text.replace(/^[使被]/, '').replace(/[的地]$/, '') || text;

// 某個中文詞和查詢的符合程度：0 完全相同、1 開頭相同、2 包含、-1 不符
export function matchKind(term, query) {
  if (term === query || core(term) === core(query)) return 0;
  if (term.startsWith(query)) return 1;
  return term.includes(query) ? 2 : -1;
}

// entries：[中文詞, 英文字, 排名分數]；同一個英文字只留最符合的那個中文詞
export function rankReverse(entries, query, limit = REVERSE_LIMIT) {
  const best = new Map();
  for (const [term, word, score] of entries) {
    let kind = matchKind(term, query);
    if (kind < 0) continue;
    // 冷僻字（索引等級 3，分數 ≥ 300000）退一級，讓常用的「開頭相同」排在它前面
    if (score >= OBSCURE) kind++;
    const key = [kind, score, term.length];
    const prev = best.get(word);
    if (!prev || compare(key, prev.key) < 0) best.set(word, { word, term, key });
  }
  return [...best.values()].sort((a, b) => compare(a.key, b.key) || a.word.localeCompare(b.word))
    .slice(0, limit).map(({ word, term }) => ({ word, term }));
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
    out.push({ word: card.word, term, key: matchKind(term, query) });
  }
  return out.sort((a, b) => a.key - b.key).slice(0, limit).map(({ word, term }) => ({ word, term }));
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

// 回傳 { words: [{ word, term, owned }], status: 'ok' | 'unavailable' | 'invalid' }
export function createReverseLookup(load = fetchShard) {
  const shard = createJsonCache(load, 12);
  return async (value, owned = []) => {
    const query = normalizeChinese(value);
    if (!query) return { words: [], status: 'invalid' };
    const chars = [...new Set(query)].slice(0, 4);
    const shards = await Promise.all(chars.map((char) => shard(reverseShard(char))));
    const entries = shards.flatMap((data, i) => (data && data[chars[i]]) || []);
    const mine = ownedMatches(query, owned);
    const ownSet = new Set(owned.map((card) => card.word));
    const seen = new Set(mine.map((item) => item.word));
    const words = [...mine, ...rankReverse(entries, query, REVERSE_LIMIT + mine.length).filter((item) => !seen.has(item.word))]
      .slice(0, REVERSE_LIMIT).map((item) => ({ ...item, owned: ownSet.has(item.word) }));
    return { words, status: shards.some((data) => data === null) ? 'unavailable' : 'ok' };
  };
}

export const lookupReverse = createReverseLookup();
