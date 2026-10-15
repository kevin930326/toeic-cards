// 內建單字包：驗證與預覽為純函式；正式加入仍走既有的單字／分類儲存流程。
import { normalizeWord } from './parse.js';

export const TOEIC_PACK_URL = new URL('../data/packs/toeic-1000.json', import.meta.url);
export const PACK_SET_NAME = '多益 1000 單';
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
  }).then(validateWordPack).catch((err) => {
    cached = null;
    if (err instanceof TypeError || err instanceof SyntaxError) throw new Error('無法讀取單字包，請連上網路後重試');
    throw err;
  });
  return cached;
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
