// 匯出／匯入備份（純函式，不碰畫面、不碰儲存，方便單獨測試）
//
// 備份檔格式：
//   { app: 'toeic-cards', version: 2, exportedAt, counts, data: { words, settings, log, mistakes, wordSets } }
//   - 不含 Gemini 金鑰（金鑰存在另一個欄位，匯出時本來就不會讀到）
//
// 匯入時：
//   - 每個欄位都重新檢查、清理（備份檔可能被改過、壞掉，或根本不是這個網站的檔案）
//   - 「合併」：新的字加入；同一個字留下「最後修改時間」比較新的版本；
//     每日紀錄同一天取各欄位較大的值（同一份備份匯入兩次也不會重複計算）；錯題本聯集
//   - 「取代」：全部換成備份裡的資料
import { normalizeWord } from './parse.js';
import { mistakeKey } from './mistakes.js';
import { sanitizeSets, mergeSets } from './word-sets.js';

export const BACKUP_APP = 'toeic-cards';
export const BACKUP_VERSION = 2;
export const MAX_BACKUP_CHARS = 20 * 1024 * 1024;
const MAX_MISTAKES = 300;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOG_FIELDS = ['reviews', 'again', 'good', 'learned', 'quiz', 'quizCorrect', 'goal'];
const SRC_FIELDS = ['pos', 'zh', 'en', 'examples', 'collocations', 'forms', 'synonyms'];
const SRC_VALUES = ['dict', 'freedict', 'llm', 'user'];
const QUIZ_MODES = ['zh2en', 'en2word', 'listen', 'part5'];

// ---- 小工具 ----
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, min = 0) => (Number.isFinite(Number(v)) ? Math.max(min, Number(v)) : min);
const strList = (v, n, max = 120) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.slice(0, max)).slice(0, n) : []);

export function backupFileName(now = Date.now()) {
  const d = new Date(now);
  const pad = (x) => String(x).padStart(2, '0');
  return `toeic-cards-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

export function buildBackup({ words, settings, log, mistakes, wordSets = [] }, now = Date.now()) {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date(now).toISOString(),
    counts: { words: words.length, days: Object.keys(log).length, mistakes: mistakes.length, wordSets: wordSets.filter((s) => !s.deleted).length },
    data: { words, settings, log, mistakes, wordSets },
  };
}

// ---- 清理各種資料 ----

function sanitizeSrs(v) {
  if (!isObj(v)) return null;
  return {
    reps: Math.round(num(v.reps)),
    interval: Math.round(num(v.interval)),
    ease: Math.min(5, Math.max(1.3, num(v.ease, 0) || 2.5)),
    lapses: Math.round(num(v.lapses)),
    due: num(v.due),
    last: num(v.last),
  };
}

function sanitizePart5(v) {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).map((q) => ({
    id: str(q.id, 80) || `q-${Math.random().toString(36).slice(2)}`,
    sentence: str(q.sentence, 400),
    answer: str(q.answer, 60),
    distractors: strList(q.distractors, 3, 60),
    translation: str(q.translation, 400),
    explanation: str(q.explanation, 400),
    at: num(q.at),
    usedAt: num(q.usedAt),
  })).filter((q) => q.sentence.includes('_____') && q.answer && q.distractors.length === 3).slice(-3);
}

export function sanitizeWord(raw) {
  if (!isObj(raw)) return null;
  const word = normalizeWord(str(raw.word, 100));
  if (!word || !/[a-z]/.test(word)) return null;
  const src = {};
  if (isObj(raw.src)) {
    for (const f of SRC_FIELDS) if (SRC_VALUES.includes(raw.src[f])) src[f] = raw.src[f];
  }
  const llm = isObj(raw.llm) && ['done', 'failed'].includes(raw.llm.status)
    ? { status: raw.llm.status, at: num(raw.llm.at), ...(raw.llm.error ? { error: str(raw.llm.error, 200) } : {}) }
    : null;
  return {
    id: str(raw.id, 80) || `imp-${word}`,
    word,
    ...(raw.autoGenerate === false ? { autoGenerate: false } : {}),
    phonetic: str(raw.phonetic, 80),
    pos: str(raw.pos, 60),
    zh: str(raw.zh, 400),
    en: str(raw.en, 400),
    examples: (Array.isArray(raw.examples) ? raw.examples : [])
      .filter(isObj).map((e) => ({ en: str(e.en, 300), zh: str(e.zh, 300) })).filter((e) => e.en).slice(0, 5),
    collocations: strList(raw.collocations, 6),
    forms: strList(raw.forms, 8),
    synonyms: strList(raw.synonyms, 6),
    unfamiliar: raw.unfamiliar === true,
    src,
    lookup: isObj(raw.lookup) ? { dictAt: num(raw.lookup.dictAt), enDone: raw.lookup.enDone === true } : {},
    llm,
    srs: sanitizeSrs(raw.srs),
    part5: sanitizePart5(raw.part5),
    createdAt: num(raw.createdAt),
    updatedAt: num(raw.updatedAt),
  };
}

export function sanitizeLog(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!DAY_RE.test(k) || !isObj(v)) continue;
    const d = {};
    for (const f of LOG_FIELDS) if (v[f] !== undefined) d[f] = Math.round(num(v[f]));
    out[k] = d;
  }
  return out;
}

export function sanitizeMistakes(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const m of raw) {
    if (!isObj(m) || !isObj(m.question)) continue;
    const q = m.question;
    const options = strList(q.options, 4, 400);
    const answerIndex = Math.round(num(q.answerIndex, -1));
    if (!QUIZ_MODES.includes(q.mode) || options.length !== 4 || answerIndex < 0 || answerIndex > 3) continue;
    const question = {
      mode: q.mode,
      wordId: str(q.wordId, 80),
      word: str(q.word, 100),
      prompt: str(q.prompt, 600),
      options,
      answerIndex,
      ...(isObj(q.extra) ? { extra: { translation: str(q.extra.translation, 400), explanation: str(q.extra.explanation, 400) } } : {}),
      ...(typeof q.accent === 'string' ? { accent: str(q.accent, 10) } : {}),
    };
    if (!question.wordId) continue;
    out.push({
      key: mistakeKey(question),
      question,
      chosen: Math.min(3, Math.max(0, Math.round(num(m.chosen)))),
      count: Math.max(1, Math.round(num(m.count, 1))),
      at: num(m.at),
    });
  }
  return out.slice(0, MAX_MISTAKES);
}

// 只留目前版本認得的設定，而且型別要和預設值一樣
export function sanitizeSettings(raw, defaults) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [k, def] of Object.entries(defaults)) {
    if (raw[k] !== undefined && typeof raw[k] === typeof def) out[k] = raw[k];
  }
  return out;
}

// 讀取備份檔的文字；回傳 { ok: true, backup } 或 { ok: false, error }
export function parseBackup(text, defaultSettings) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: '檔案是空的' };
  if (text.length > MAX_BACKUP_CHARS) return { ok: false, error: '檔案太大（超過 20MB），不像是這個網站的備份檔' };
  let obj;
  try { obj = JSON.parse(text); } catch (e) { return { ok: false, error: '不是有效的 JSON 檔，可能檔案壞掉了' }; }
  if (!isObj(obj) || obj.app !== BACKUP_APP || !isObj(obj.data)) return { ok: false, error: '這不是多益字卡的備份檔' };
  if (num(obj.version) > BACKUP_VERSION) return { ok: false, error: '這份備份來自比較新的版本，請先重新整理網站再匯入' };

  const rawWords = Array.isArray(obj.data.words) ? obj.data.words : [];
  const byWord = new Map();
  let skipped = 0;
  for (const r of rawWords) {
    const w = sanitizeWord(r);
    if (!w) { skipped++; continue; }
    // 備份裡重複的字只留最新的；被丟掉的那一筆（不論先後）都算「略過」
    const old = byWord.get(w.word);
    if (old) skipped++;
    if (!old || w.updatedAt > old.updatedAt) byWord.set(w.word, w);
  }
  return {
    ok: true,
    backup: {
      exportedAt: str(obj.exportedAt, 40),
      words: [...byWord.values()],
      settings: sanitizeSettings(obj.data.settings, defaultSettings),
      log: sanitizeLog(obj.data.log),
      mistakes: sanitizeMistakes(obj.data.mistakes),
      wordSets: mergeSets([], sanitizeSets(obj.data.wordSets)),
      skipped,
    },
  };
}

// 合併：local 是目前的資料，incoming 是備份（都已清理過）
export function mergeBackup(local, incoming) {
  const byWord = new Map(local.words.map((w) => [w.word, w]));
  const usedIds = new Set(local.words.map((w) => w.id));
  const idMap = new Map();   // 備份裡的 id → 合併後的 id（錯題本要跟著換）
  const added = [];
  let updated = 0;
  let kept = 0;
  for (const w of incoming.words) {
    const cur = byWord.get(w.word);
    if (!cur) {
      let id = w.id;
      while (usedIds.has(id)) id = `${w.id}-${Math.random().toString(36).slice(2, 6)}`;
      usedIds.add(id);
      const nw = { ...w, id };
      byWord.set(w.word, nw);
      added.push(nw);
      idMap.set(w.id, id);
    } else if (w.updatedAt > cur.updatedAt) {
      byWord.set(w.word, { ...w, id: cur.id });   // 保留目前的 id
      updated++;
      idMap.set(w.id, cur.id);
    } else {
      kept++;
      idMap.set(w.id, cur.id);
    }
  }
  // 新加入的字放最前面（和平常新增單字一樣），其他維持原本順序
  const words = [
    ...added.sort((a, b) => b.createdAt - a.createdAt),
    ...local.words.map((w) => byWord.get(w.word)),
  ];

  const log = { ...local.log };
  for (const [k, d] of Object.entries(incoming.log)) {
    const cur = log[k] || {};
    const merged = { ...cur };
    for (const f of LOG_FIELDS) {
      if (d[f] !== undefined || cur[f] !== undefined) merged[f] = Math.max(num(cur[f]), num(d[f]));
    }
    log[k] = merged;
  }

  const mistakes = new Map(local.mistakes.map((m) => [m.key, m]));
  for (const m of incoming.mistakes) {
    const wordId = idMap.get(m.question.wordId);
    if (!wordId) continue;   // 對應的字不在備份裡
    const question = { ...m.question, wordId };
    const key = mistakeKey(question);
    const cur = mistakes.get(key);
    if (!cur || m.count > cur.count) mistakes.set(key, { ...m, key, question });
  }

  return {
    words,
    wordSets: mergeSets(local.wordSets, incoming.wordSets),
    log,
    mistakes: [...mistakes.values()].sort((a, b) => b.at - a.at).slice(0, MAX_MISTAKES),
    summary: { added: added.length, updated, kept },
  };
}
