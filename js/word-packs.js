// 內建單字包：驗證與預覽為純函式；正式加入仍走既有的單字／分類儲存流程。
import { normalizeWord } from './parse.js';

export const TOEIC_PACK_URL = new URL('../data/packs/toeic-1000.json', import.meta.url);
export const PACK_SET_NAME = '多益 1000 單';
export const PACK_CONTENT_VERSION = 1;
let cached = null;

export function validateWordPack(raw) {
  if (!raw || raw.id !== 'toeic-1000' || raw.version !== 1 || raw.groupSize !== 100
    || !Array.isArray(raw.words) || raw.words.length !== 1000) throw new Error('單字包格式不正確，請重新載入');
  const words = raw.words.map((w) => typeof w === 'string' ? normalizeWord(w) : '');
  if (words.some((w) => !/^[a-zà-öø-ÿ]+(?:[-' ][a-zà-öø-ÿ]+)*$/i.test(w)) || new Set(words).size !== 1000) {
    throw new Error('單字包有不正確或重複的單字，請重新載入');
  }
  return { id: raw.id, version: raw.version, title: PACK_SET_NAME, groupSize: 100, words,
    source: { title: String(raw.source?.title || ''), note: String(raw.source?.note || '') } };
}

export function loadWordPack() {
  if (!cached) cached = fetch(TOEIC_PACK_URL).then((res) => {
    if (!res.ok) throw new Error('單字包目前讀不到，請連上網路後重試');
    return res.json();
  }).then(validateWordPack).then(async (pack) => {
    // 開啟單字包時一併載入十組內容，載入完成後整包均可離線加入。
    const groups = await Promise.all(Array.from({ length: 10 }, async (_, group) => {
      const url = new URL(`../data/packs/toeic-1000/${String(group + 1).padStart(2, '0')}.json`, import.meta.url);
      const res = await fetch(url);
      if (!res.ok) throw new Error('單字包內容未載入完整，請連上網路後重試');
      return validatePackContent(await res.json(), pack, group);
    }));
    return { ...pack, entries: groups.flat() };
  }).catch((err) => {
    cached = null;
    if (err instanceof TypeError || err instanceof SyntaxError) throw new Error('無法讀取單字包，請連上網路後重試');
    throw err;
  });
  return cached;
}

const CONTENT_FIELDS = ['phonetic', 'pos', 'zh', 'en', 'examples', 'collocations', 'forms', 'synonyms'];
const hasContent = (value) => Array.isArray(value) ? value.length > 0 : typeof value === 'string' && !!value.trim();

export function validatePackContent(raw, pack, group) {
  const expected = packWords(pack, String(group));
  if (raw?.packId !== pack.id || raw.version !== PACK_CONTENT_VERSION || raw.group !== group
    || !Array.isArray(raw.entries) || raw.entries.length !== expected.length) throw new Error('單字包內容格式不正確');
  return raw.entries.map((entry, i) => {
    if (entry?.word !== expected[i] || !['n.', 'v.', 'adj.', 'adv.', 'prep.'].includes(entry.pos)
      || !['zh', 'en'].every((key) => typeof entry[key] === 'string' && entry[key].trim() && entry[key].length <= 400)
      || !Array.isArray(entry.examples) || !entry.examples.length || entry.examples.length > 5
      || !entry.examples.every((e) => e && ['en', 'zh'].every((key) => typeof e[key] === 'string' && e[key].trim() && e[key].length <= 300))
      || !['collocations', 'forms', 'synonyms'].every((key) => Array.isArray(entry[key]) && entry[key].length <= 8
        && entry[key].every((s) => typeof s === 'string' && s.trim() && s.length <= 120))
      || !entry.collocations.length) throw new Error(`單字包內容不完整：${expected[i]}`);
    return Object.fromEntries(['word', ...CONTENT_FIELDS].map((key) => [key, key === 'phonetic' ? String(entry.phonetic || '') : entry[key]]));
  });
}

export function initialPackData(entry) {
  const value = Object.fromEntries(CONTENT_FIELDS.map((key) => [key, entry[key]]));
  return { ...value, src: Object.fromEntries(CONTENT_FIELDS.filter((key) => key !== 'phonetic' && hasContent(entry[key])).map((key) => [key, 'pack'])),
    pack: { id: 'toeic-1000', version: PACK_CONTENT_VERSION }, lookup: { dictAt: Date.now(), enDone: true } };
}

// 舊字卡只在使用者勾選後補空白；手動清空過的欄位仍尊重 user 標記。
export function packBackfill(word, entry) {
  const patch = {};
  const src = { ...(word.src || {}) };
  for (const key of CONTENT_FIELDS) {
    if (word.src?.[key] === 'user' || hasContent(word[key]) || !hasContent(entry[key])) continue;
    patch[key] = entry[key];
    if (key !== 'phonetic') src[key] = 'pack';
  }
  if (!Object.keys(patch).length) return null;
  return { ...patch, src, pack: { id: 'toeic-1000', version: PACK_CONTENT_VERSION }, autoGenerate: false,
    lookup: { ...(word.lookup || {}), dictAt: word.lookup?.dictAt || Date.now(), enDone: true } };
}

export function packWords(pack, group = '0') {
  if (group === 'all') return pack.words;
  const index = Number(group);
  const count = pack.words.length / pack.groupSize;
  if (!/^\d+$/.test(String(group)) || !Number.isInteger(index) || index < 0 || index >= count) return [];
  return pack.words.slice(index * pack.groupSize, (index + 1) * pack.groupSize);
}

export function previewPack(pack, group, localWords, targetSet = null) {
  const selected = packWords(pack, group);
  const local = new Set(localWords.map((w) => normalizeWord(w.word)));
  const fresh = selected.filter((w) => !local.has(w));
  const existing = selected.filter((w) => local.has(w));
  const alreadyInSet = selected.filter((w) => local.has(w) && targetSet?.members[w]?.present);
  return { selected, fresh, existing, alreadyInSet,
    toAssign: selected.length - alreadyInSet.length,
    owned: pack.words.filter((w) => local.has(w)).length };
}
