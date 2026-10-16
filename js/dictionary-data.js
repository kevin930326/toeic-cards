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

// ---- 變化形的中文 ----
// ECDICT 合併了一般字典、專業術語表、縮寫表等來源，變化形的拼字有時剛好撞到別的詞條：
// receives「n. 受光面」、scans「abbr. 網路系統自動程式控制」、faring「法林（遊戲中的地名）」。
// 變化形的意思本來就是原形的意思，所以：
//   1. 一律顯示原形的意思
//   2. 字典原文只有在多出「原形沒有的詞性」時才放在最後一行「另有：…」，例如 exceeding 多了形容詞「非常的」、
//      operated 多了形容詞「操作的」；只是換個說法的同義詞不重複列
//   3. 不顯示：沒有詞性標記的術語、縮寫／人名／地名／品牌／遊戲、-s 形（第三人稱單數、複數、比較級）
//      詞性又對不上的冷門同形字、動詞的「名詞複數」，以及「（offer 的複數）」這類說明（畫面另外標示原形與變化種類）
const FORM_POS = { 3: 'v', p: 'v', d: 'v', i: 'v', s: 'n', r: 'a', t: 'a' };
const JUNK = /abbr\.|人名|地名|品牌|遊戲/;
const FORM_NOTE = /\s*[（(][^（）()]*的[^（）()]*(?:複數|單數|過去|分詞|形式|比較級|最高級|動名詞)[^（）()]*[）)]\s*/g;
const LINE_POS = /^((?:vt|vi|v|n|adj|adv|a|pl|vbl|art|prep|conj|pron|num|int)\.)\s*/;

function posGroups(text) {
  const groups = new Set();
  for (const m of String(text || '').matchAll(/\b(vt|vi|v|n|adj|adv|a)\./g)) {
    groups.add(m[1].startsWith('v') ? 'v' : m[1] === 'n' ? 'n' : 'a');
  }
  return groups;
}

// e：變化形的字典資料（l 原形、f 變化種類、s 詞性、t 中文）；base：原形查到的 { pos, zh }
// 回傳要顯示的 { pos, zh }
export function inflectionMeaning(e, base) {
  const kinds = (e.f || []).filter((k) => FORM_POS[k]);
  const own = posGroups(e.s || e.t);
  const mismatch = own.size > 0 && !kinds.some((k) => own.has(FORM_POS[k]));
  const onlyS = kinds.length > 0 && kinds.every((k) => !'ipd'.includes(k));
  const baseGroups = posGroups(`${base.pos}\n${base.zh}`);
  const extras = [];
  // -s 形只有原形是形容詞時才可能有自己的意思（durables 耐用品、vitals 要害）；
  // 動詞的「名詞複數」（terminates「n. 結束」）本身就不存在
  if (!(mismatch && onlyS) && !(onlyS && !baseGroups.has('a'))) {
    for (const raw of String(e.t || '').split('\n')) {
      const line = raw.replace(FORM_NOTE, ' ').replace(/^[\[［]/, '').trim();
      const pos = (line.match(LINE_POS) || [])[1] || '';
      const groups = posGroups(pos);
      if (!groups.size || JUNK.test(line) || [...groups].some((g) => baseGroups.has(g))) continue;
      const body = line.slice(pos.length).trim();
      // 只是把原形已有的意思再寫一次（durables「n. 持久的；耐用的」）就不列
      const fresh = body.split(/[；;]/).some((x) => { const core = x.replace(/[（(][^）)]*[）)]/g, '').trim(); return core && !base.zh.includes(core); });
      if (fresh) extras.push(`${pos} ${body}`);
    }
  }
  return { pos: base.pos, zh: extras.length ? `${base.zh}\n另有：${extras.join('／')}` : base.zh };
}
