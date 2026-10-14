// 錯題本：記下每一題答錯的題目（整題存下來，重做時不需要再呼叫 AI）
// 存在 localStorage：[{ key, question, chosen, count, at }]
//   重做時答對 → 從錯題本移除；又答錯 → count + 1
const KEY = 'toeic-cards:mistakes';
const MAX = 300;

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch (e) { console.error('寫入錯題本失敗', e); }
}

// 同一個字、同一種題型、同一個題目算同一題
export function mistakeKey(q) {
  return `${q.mode}|${q.wordId}|${q.prompt}`;
}

export function getMistakes() {
  return read();
}

export function countMistakes() {
  return read().length;
}

export function addMistake(question, chosen) {
  const list = read();
  const key = mistakeKey(question);
  const old = list.find((m) => m.key === key);
  const rest = list.filter((m) => m.key !== key);
  const q = { ...question };
  delete q.fromMistakes;
  rest.unshift({ key, question: q, chosen, count: (old?.count || 0) + 1, at: Date.now() });
  write(rest);
}

export function removeMistake(key) {
  write(read().filter((m) => m.key !== key));
}

// 單字被刪掉時，相關的錯題也一起清掉
export function pruneMistakes(existingIds) {
  const ids = new Set(existingIds);
  const list = read();
  const kept = list.filter((m) => ids.has(m.question.wordId));
  if (kept.length !== list.length) write(kept);
}

export function clearMistakes() {
  write([]);
}
