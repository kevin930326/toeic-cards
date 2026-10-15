// 單字集的純資料規則。成員以單字本身對應，裝置間 id 不同也能合併。
// 名稱／刪除狀態與每個成員分開比較時間，移出保留紀錄，避免離線裝置把它加回來。
import { normalizeWord } from './parse.js';

export const UNFILED = 'unfiled';
export const normalizeSetName = (name) => String(name || '').trim().replace(/\s+/g, ' ');
const time = (n) => Number.isFinite(n) && n >= 0 ? n : 0;

export function sanitizeSets(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r) => r && typeof r.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(r.id)
    && r.id !== UNFILED && typeof r.name === 'string' && normalizeSetName(r.name)).map((r) => {
    const members = Object.create(null);
    if (r.members && typeof r.members === 'object' && !Array.isArray(r.members)) {
      for (const [word, m] of Object.entries(r.members)) {
        const key = normalizeWord(word);
        if (!key || key.length > 100 || !/[a-z]/i.test(key) || !m || typeof m.present !== 'boolean') continue;
        members[key] = { at: time(m.at), present: m.present };
      }
    }
    return { id: r.id, name: normalizeSetName(r.name).slice(0, 60), updatedAt: time(r.updatedAt),
      deleted: r.deleted === true, members };
  });
}

// 時間剛好相同時用固定排序決定結果，讓合併順序不影響結果；移出／刪除優先。
export function mergeSets(local, incoming) {
  const byId = new Map();
  for (const r of [...sanitizeSets(local), ...sanitizeSets(incoming)]) {
    const old = byId.get(r.id);
    if (!old) { byId.set(r.id, r); continue; }
    const useNew = r.updatedAt > old.updatedAt || (r.updatedAt === old.updatedAt
      && (Number(r.deleted) > Number(old.deleted) || (r.deleted === old.deleted && r.name > old.name)));
    const members = Object.assign(Object.create(null), old.members);
    for (const [word, m] of Object.entries(r.members)) {
      const prev = members[word];
      if (!prev || m.at > prev.at || (m.at === prev.at && !m.present)) members[word] = m;
    }
    byId.set(r.id, { ...(useNew ? r : old), members });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function setsForWord(sets, word) {
  return sets.filter((s) => !s.deleted && s.members[normalizeWord(word)]?.present);
}

export function filterSetWords(words, sets, id = '') {
  if (id === UNFILED) return words.filter((w) => !setsForWord(sets, w.word).length);
  if (!id) return words;
  const set = sets.find((s) => s.id === id && !s.deleted);
  return set ? words.filter((w) => set.members[w.word]?.present) : words;
}
