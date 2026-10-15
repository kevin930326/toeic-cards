// 探索只篩選與選字，不計算到期、不評分，也不修改字卡。
import { normalizeWord } from './parse.js';

export function exploreWords(words, { query = '', filter = 'all' } = {}) {
  const q = normalizeWord(query);
  return words.filter((w) => (filter !== 'unfamiliar' || w.unfamiliar)
    && (!q || normalizeWord(w.word).includes(q) || normalizeWord(w.zh).includes(q)));
}

export function selectedExploreWord(words, id) {
  return words.find((w) => w.id === id) || words[0] || null;
}

export function stepExploreWord(words, id, step) {
  if (!words.length) return null;
  const current = Math.max(0, words.findIndex((w) => w.id === id));
  return words[((current + step) % words.length + words.length) % words.length];
}
