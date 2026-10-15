// 此演算法與 tools/build_extended_dict.py 一致。只計算檔名，不必下載龐大的索引。
export function dictionaryShard(word) {
  let hash = 2166136261;
  for (const char of word) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return (hash % 1024).toString(16).padStart(3, '0');
}

// 已完成的 JSON 採 LRU；同檔請求合併。失敗不留快取，下次可重試。
export function createJsonCache(load, limit = 16) {
  const settled = new Map();
  const pending = new Map();
  return async (key) => {
    if (settled.has(key)) {
      const data = settled.get(key);
      settled.delete(key); settled.set(key, data);
      return data;
    }
    if (pending.has(key)) return pending.get(key);
    const task = Promise.resolve().then(() => load(key)).then((data) => {
      if (data !== null) {
        settled.set(key, data);
        while (settled.size > limit) settled.delete(settled.keys().next().value);
      }
      return data;
    }).catch(() => null).finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  };
}

export const FORM_LABELS = { p: '過去式', d: '過去分詞', i: '現在分詞', '3': '第三人稱單數',
  s: '複數', r: '比較級', t: '最高級' };
