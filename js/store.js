// 資料儲存：所有單字和設定都存在瀏覽器的 localStorage
import { normalizeWord } from './parse.js';

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
export function addWords(list) {
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
    const w = createWord(n);
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
  const before = words.length;
  words = words.filter((w) => w.id !== id);
  if (words.length !== before) saveWords();
}

export function toggleUnfamiliar(id, value) {
  const w = getWord(id);
  if (!w) return;
  updateWord(id, { unfamiliar: value === undefined ? !w.unfamiliar : !!value });
}

export function getSettings() {
  return settings;
}

export function updateSettings(patch) {
  settings = { ...settings, ...patch };
  writeJSON(SETTINGS_KEY, settings);
  emit();
}
