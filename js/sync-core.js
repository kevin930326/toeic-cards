// 跨裝置同步的合併規則（純函式，不碰畫面、不碰儲存、不連網，方便單獨測試）
//
// 雲端資料（Firestore）的樣子：
//   users/{uid}/words/{單字}   每個字一份：{ word, updatedAt, deleted, data, syncedAt }
//   users/{uid}/logs/{裝置}    每台裝置自己的每日紀錄：{ log, updatedAt }
//   users/{uid}/meta/settings  要同步的設定：{ value, updatedAt }
//   users/{uid}/meta/mistakes  錯題本：{ value, updatedAt }
//
// 規則：
//   - 單字：同一個字以「最後修改時間 updatedAt」比較新的為準；刪除會留下「刪除紀錄」，讓其他裝置也刪掉
//   - 每日紀錄：每台裝置各記各的，顯示時「加總」（手機背 10 題＋電腦背 10 題＝ 20 題，打卡才不會少算）
//   - 設定、錯題本：整份以比較新的為準
import { sanitizeWord } from './backup.js';
import { normalizeWord } from './parse.js';
import { mistakeKey } from './mistakes.js';

// 只同步「學習相關」的設定；外觀、口音（每台裝置的語音不同）、模型、統計期間留在各自的裝置
export const SYNCED_SETTINGS = ['dailyGoal', 'newPerDay', 'cardMode', 'autoGenerate', 'quizScope', 'quizCount', 'part5Fresh'];

const LOG_SUM_FIELDS = ['reviews', 'again', 'good', 'learned', 'quiz', 'quizCorrect'];

// Firestore 文件 id 不能有「/」，也不能是「.」或「..」；英文單字和片語用網址編碼就安全
export function wordDocId(word) {
  return encodeURIComponent(normalizeWord(word)).replace(/\./g, '%2E');
}

export function toRemoteWord(w) {
  return { word: w.word, updatedAt: w.updatedAt || 0, deleted: false, data: w };
}

export function toRemoteTombstone(word, time) {
  return { word: normalizeWord(word), updatedAt: time, deleted: true, data: null };
}

// 把雲端拉下來的單字套用到本機
//   local：本機單字陣列；tombstones：本機的刪除紀錄 { 單字: 刪除時間 }；remote：雲端文件陣列
// 回傳新的 words、tombstones，以及新增／更新／刪除的數量
export function applyRemoteWords(local, tombstones, remote) {
  const byWord = new Map(local.map((w) => [w.word, w]));
  const usedIds = new Set(local.map((w) => w.id));
  const tombs = { ...tombstones };
  const added = [];
  let updated = 0;
  let deleted = 0;

  for (const r of remote) {
    const word = normalizeWord(r?.word);
    if (!word) continue;
    const time = Number(r.updatedAt) || 0;
    const cur = byWord.get(word);
    if (r.deleted) {
      // 別的裝置刪掉了：本機的版本比較舊才跟著刪（本機刪之後又修改過就保留）
      if (cur && cur.updatedAt <= time) {
        byWord.delete(word);
        deleted++;
      }
      tombs[word] = Math.max(tombs[word] || 0, time);
      continue;
    }
    const data = sanitizeWord(r.data);
    if (!data) continue;
    data.updatedAt = time;
    if ((tombs[word] || 0) >= time) continue;   // 本機在這之後刪掉了，以刪除為準
    if (!cur) {
      let id = data.id;
      while (usedIds.has(id)) id = `${data.id}-${Math.random().toString(36).slice(2, 6)}`;
      usedIds.add(id);
      const nw = { ...data, id };
      byWord.set(word, nw);
      added.push(nw);
      delete tombs[word];
    } else if (time > cur.updatedAt) {
      byWord.set(word, { ...data, id: cur.id });   // 保留本機的 id（錯題本用 id 對應單字）
      updated++;
    }
  }
  // 新的字放最前面（和平常新增單字一樣），其他維持原本順序
  const words = [
    ...added.sort((a, b) => b.createdAt - a.createdAt),
    ...local.map((w) => byWord.get(w.word)).filter(Boolean),   // 被刪掉的字在 byWord 裡已經不存在
  ];
  return { words, tombstones: tombs, summary: { added: added.length, updated, deleted } };
}

// 找出要上傳的東西：最後修改時間比「上次上傳的版本」新的字，以及新的刪除紀錄
//   pushed：{ 單字: 上次上傳時的 updatedAt }
export function pendingChanges(words, tombstones, pushed) {
  const out = [];
  for (const w of words) {
    if ((w.updatedAt || 0) > (pushed[w.word] || 0)) out.push(toRemoteWord(w));
  }
  for (const [word, time] of Object.entries(tombstones)) {
    if (time > (pushed[word] || 0)) out.push(toRemoteTombstone(word, time));
  }
  return out;
}

// 把自己的每日紀錄和其他裝置的加總起來
//   次數類欄位相加；goal（每日目標）取較大值
export function combineLogs(own, others = []) {
  const out = {};
  for (const log of [own, ...others]) {
    if (!log || typeof log !== 'object') continue;
    for (const [day, d] of Object.entries(log)) {
      if (!d || typeof d !== 'object') continue;
      const cur = out[day] || {};
      for (const f of LOG_SUM_FIELDS) {
        if (d[f] !== undefined) cur[f] = (Number(cur[f]) || 0) + (Number(d[f]) || 0);
      }
      if (d.goal !== undefined) cur.goal = Math.max(Number(cur.goal) || 0, Number(d.goal) || 0);
      out[day] = cur;
    }
  }
  return out;
}

export function pickSyncedSettings(settings) {
  const out = {};
  for (const k of SYNCED_SETTINGS) if (settings[k] !== undefined) out[k] = settings[k];
  return out;
}

// 錯題本從別的裝置來：wordId 是那台裝置的 id，用單字本身換成本機的 id；對不到的丟掉
export function remapMistakes(list, words) {
  const idByWord = new Map(words.map((w) => [w.word, w.id]));
  const out = [];
  for (const m of Array.isArray(list) ? list : []) {
    const wordId = idByWord.get(normalizeWord(m?.question?.word));
    if (!wordId) continue;
    const question = { ...m.question, wordId };
    out.push({ ...m, question, key: mistakeKey(question) });
  }
  return out;
}

// 整份資料（設定、錯題本）的「比較新的勝出」
//   回傳 'pull'（用雲端的）、'push'（上傳本機的）或 'none'（一樣新）
export function newerSide(localAt, remote) {
  const remoteAt = Number(remote?.updatedAt) || 0;
  if (!remote) return localAt ? 'push' : 'none';
  if (remoteAt > (localAt || 0)) return 'pull';
  if ((localAt || 0) > remoteAt) return 'push';
  return 'none';
}
