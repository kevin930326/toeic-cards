// 資料儲存：所有單字和設定都存在瀏覽器的 localStorage
import { normalizeWord } from './parse.js';
import { normalizeSetName, sanitizeSets, mergeSets, filterSetWords, UNFILED } from './word-sets.js?v=dictionary-scale-1';

const WORDS_KEY = 'toeic-cards:words';
const SETTINGS_KEY = 'toeic-cards:settings';

const DEFAULT_SETTINGS = {
  theme: 'system',      // 'system' | 'light' | 'dark'
  cardMode: 'zh',       // 'zh'（背面顯示中文）| 'en'（背面顯示英文解釋）
  cardFilter: 'all',    // 'all' | 'unfamiliar'
  accent: 'en-US',      // 發音口音：'en-US' | 'en-GB'
  speechRate: 0.9,      // 發音速度
  llmModel: '',         // Gemini 模型（空白＝用預設）
  llmRpm: 5,            // 每分鐘最多送幾個請求（免費額度保守值）
  autoGenerate: true,   // 新增單字後自動用 AI 生成
  newPerDay: 20,        // 每天最多學幾個新字
  quizScope: 'all',     // 測驗範圍：'all' | 'unfamiliar'
  quizCount: 10,        // 每次測驗題數
  part5Fresh: false,    // Part 5 每次都出新題目（會用 AI 額度）
  statsDays: 30,        // 統計頁的期間：7 | 30 | 90
  dailyGoal: 20,        // 每日目標：複習＋測驗合計題數，達標才算打卡
  activeSetId: '',      // 本機目前選的單字集：空字串全部、unfiled 未分類
  examDate: '',         // 多益考試日期 'YYYY-MM-DD'（空字串＝沒設定），用來倒數和建議每天新字數
};

const listeners = new Set();

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.warn('讀取資料失敗', key, e);
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error('儲存資料失敗', key, e);
    throw new Error('瀏覽器儲存空間不足或被封鎖，資料沒有存到。');
  }
}

let words = readJSON(WORDS_KEY, []);
let settings = { ...DEFAULT_SETTINGS, ...readJSON(SETTINGS_KEY, {}) };
const SETS_KEY = 'toeic-cards:wordSets';
let wordSets = sanitizeSets(readJSON(SETS_KEY, []));

function emit() {
  for (const fn of listeners) fn();
}

function saveWords() {
  writeJSON(WORDS_KEY, words);
  emit();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// normalizeWord 放在 parse.js（純函式、可單獨測試），這裡轉出去給其他模組用
export { normalizeWord };

function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createWord(word) {
  return {
    id: newId(),
    word: normalizeWord(word),
    phonetic: '',
    pos: '',
    zh: '',
    en: '',
    examples: [],       // [{ en, zh }]
    collocations: [],
    forms: [],
    synonyms: [],
    unfamiliar: false,
    src: {},            // 每個欄位的來源：'dict' | 'freedict' | 'llm' | 'user'
    lookup: {},         // 查詢紀錄，例如 { dictAt: 時間 }
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function getWords() {
  return words;
}

export function getWord(id) {
  return words.find((w) => w.id === id);
}

export function hasWord(word) {
  const n = normalizeWord(word);
  return words.some((w) => w.word === n);
}

// 回傳 { added, skipped }；skipped 是重複或已存在的字
export function addWords(list, { autoGenerate = true, initialData = new Map() } = {}) {
  const added = [];
  const skipped = [];
  const seen = new Set(words.map((w) => w.word));
  // 同一批的字時間各差 1 毫秒，讓「新字」照貼上的順序出現在複習裡
  const base = Date.now();
  for (const raw of list) {
    const n = normalizeWord(raw);
    if (!n) continue;
    if (seen.has(n)) {
      skipped.push(n);
      continue;
    }
    seen.add(n);
    clearTombstone(n);   // 刪掉後又加回來
    const w = createWord(n);
    const prepared = initialData.get(n);
    // 只允許預填內容欄位，id、建立時間與學習進度仍由儲存模組管理。
    if (prepared) for (const key of ['phonetic', 'pos', 'zh', 'en', 'examples', 'collocations', 'forms', 'synonyms', 'src', 'lookup', 'pack']) {
      if (Object.hasOwn(prepared, key)) w[key] = structuredClone(prepared[key]);
    }
    if (!autoGenerate) w.autoGenerate = false;
    w.createdAt = w.updatedAt = base + added.length;
    words.unshift(w);
    added.push(w);
  }
  if (added.length) saveWords();
  return { added, skipped };
}

export function updateWord(id, patch) {
  const w = getWord(id);
  if (!w) return null;
  if (patch.word !== undefined) {
    const n = normalizeWord(patch.word);
    if (!n) throw new Error('英文單字不能空白');
    if (n !== w.word && hasWord(n)) throw new Error(`「${n}」已經在字卡裡了`);
    // 改拼字時保留原本的分類；這是同一張卡，不建立第二份進度。
    if (n !== w.word) {
      const now = nextSetTime();
      for (const set of wordSets) {
        if (!set.deleted && set.members[w.word]?.present) {
          set.members[w.word] = { present: false, at: now };
          set.members[n] = { present: true, at: now };
        }
      }
      writeJSON(SETS_KEY, wordSets);
    }
    patch = { ...patch, word: n };
  }
  Object.assign(w, patch, { updatedAt: Date.now() });
  saveWords();
  return w;
}

// 一次更新多個字、只存一次檔（批次處理時比較快）。patches: [[id, patch], ...]
export function updateWords(patches) {
  let changed = 0;
  const now = Date.now();
  for (const [id, patch] of patches) {
    const w = getWord(id);
    if (!w) continue;
    Object.assign(w, patch, { updatedAt: now });
    changed++;
  }
  if (changed) saveWords();
  return changed;
}

export function deleteWord(id) {
  const target = words.find((w) => w.id === id);
  if (!target) return;
  words = words.filter((w) => w.id !== id);
  // 留下「刪除紀錄」，同步時其他裝置也會跟著刪掉
  const tombs = getTombstones();
  tombs[target.word] = Date.now();
  setTombstones(tombs);
  saveWords();
}

function clearTombstone(word) {
  const tombs = getTombstones();
  if (tombs[word]) {
    delete tombs[word];
    setTombstones(tombs);
  }
}

// ---- 刪除紀錄（跨裝置同步用）：{ 單字: 刪除時間 } ----
const TOMB_KEY = 'toeic-cards:deleted';
export function getTombstones() {
  return readJSON(TOMB_KEY, {});
}
export function setTombstones(map) {
  writeJSON(TOMB_KEY, map || {});
}

export function toggleUnfamiliar(id, value) {
  const w = getWord(id);
  if (!w) return;
  updateWord(id, { unfamiliar: value === undefined ? !w.unfamiliar : !!value });
}

// 匯入備份：整批換掉
export function replaceWords(list) {
  words = Array.isArray(list) ? list : [];
  saveWords();
}

export function replaceSettings(obj) {
  settings = { ...DEFAULT_SETTINGS, ...(obj || {}) };
  writeJSON(SETTINGS_KEY, settings);
  emit();
}

export function getDefaultSettings() {
  return { ...DEFAULT_SETTINGS };
}

export function getSettings() {
  return settings;
}

// 會跨裝置同步的設定（要和 sync-core.js 的 SYNCED_SETTINGS 一致；這裡不 import 它，避免互相依賴）
const SYNCED_KEYS = ['dailyGoal', 'newPerDay', 'cardMode', 'autoGenerate', 'quizScope', 'quizCount', 'part5Fresh', 'examDate'];
const SETTINGS_AT_KEY = 'toeic-cards:settingsAt';

export function updateSettings(patch, { fromSync = false } = {}) {
  const changedSynced = SYNCED_KEYS.some((k) => k in patch && patch[k] !== settings[k]);
  settings = { ...settings, ...patch };
  writeJSON(SETTINGS_KEY, settings);
  // 記下「要同步的設定」最後修改的時間；從雲端套用時不算本機修改
  if (changedSynced && !fromSync) writeJSON(SETTINGS_AT_KEY, Date.now());
  emit();
}

export function settingsUpdatedAt() {
  return Number(readJSON(SETTINGS_AT_KEY, 0)) || 0;
}
export function setSettingsUpdatedAt(t) {
  writeJSON(SETTINGS_AT_KEY, t);
}

// ---- 自訂單字集：獨立於卡片內容、共用同一張卡的複習進度 ----
export function getSetRecords() { return wordSets; }
export function getWordSets() { return wordSets.filter((s) => !s.deleted); }
export function activeSetId() {
  const id = settings.activeSetId;
  return id === UNFILED || getWordSets().some((s) => s.id === id) ? id : '';
}
export function scopedWords() { return filterSetWords(words, wordSets, activeSetId()); }

function nextSetTime(records = wordSets) {
  // 同一毫秒連續加入／移出也必須能分辨先後。
  return records.reduce((latest, s) => Object.values(s.members)
    .reduce((t, m) => Math.max(t, m.at + 1), Math.max(latest, s.updatedAt + 1)), Date.now());
}

export function replaceSetRecords(list) {
  const next = mergeSets([], list);
  writeJSON(SETS_KEY, next);
  wordSets = next;
  emit();
}

export function mergeSetRecords(list) { replaceSetRecords(mergeSets(wordSets, list)); }

// 「取代備份」是新的本機操作：留下被取代的刪除／移出紀錄，避免下次同步復活。
export function restoreSetRecords(list) {
  const incoming = mergeSets([], list);
  const now = nextSetTime([...wordSets, ...incoming]);
  const restored = new Map(incoming.map((s) => [s.id, s]));
  const ids = new Set([...wordSets, ...incoming].map((s) => s.id));
  replaceSetRecords([...ids].map((id) => {
    const old = wordSets.find((s) => s.id === id);
    const next = restored.get(id);
    const members = Object.create(null);
    for (const word of Object.keys(old?.members || {})) members[word] = { at: now, present: false };
    for (const [word, m] of Object.entries(next?.members || {})) members[word] = { at: now, present: m.present };
    return { ...(next || old), updatedAt: now, deleted: next ? next.deleted : true, members };
  }));
}

function checkedSetName(raw, exceptId = '') {
  const name = normalizeSetName(raw);
  if (!name) throw new Error('請輸入單字集名稱');
  if (name.length > 60) throw new Error('單字集名稱最多 60 個字元');
  if (getWordSets().some((s) => s.id !== exceptId && s.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error('已經有同名的單字集，請換個名稱');
  }
  return name;
}

export function createWordSet(raw) {
  const set = { id: newId(), name: checkedSetName(raw), updatedAt: nextSetTime(), deleted: false, members: {} };
  replaceSetRecords([...wordSets, set]);
  return set;
}

export function renameWordSet(id, raw) {
  const name = checkedSetName(raw, id);
  const now = nextSetTime();
  replaceSetRecords(wordSets.map((s) => s.id === id && !s.deleted ? { ...s, name, updatedAt: now } : s));
}

export function deleteWordSet(id) {
  const now = nextSetTime();
  replaceSetRecords(wordSets.map((s) => s.id === id ? { ...s, deleted: true, updatedAt: now } : s));
}

export function assignWordSet(ids, setId, present = true) {
  const set = getWordSets().find((s) => s.id === setId);
  if (!set) throw new Error('請先選擇單字集');
  const selected = new Set(ids);
  const changed = words.filter((w) => selected.has(w.id) && !!set.members[w.word]?.present !== present);
  if (!changed.length) return 0;
  const now = nextSetTime();
  const members = Object.assign(Object.create(null), set.members);
  for (const w of changed) members[w.word] = { at: now, present };
  replaceSetRecords(wordSets.map((s) => s.id === setId ? { ...s, members } : s));
  return changed.length;
}
