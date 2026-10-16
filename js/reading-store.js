// 短文閱讀的 AI 產生與「背景先寫好的下一篇」
//
// 背景先寫好的那篇另外存在 toeic-cards:reading-next（只有一篇，不在已存列表裡）：
//   - 使用者按「產生新短文」時，如果類型符合、單字集也相同，就直接拿來用，不必等 AI
//   - 拿走之後 ai-stock.js 會在背景再寫下一篇（每篇 1 次請求，扣背景每日額度）
// 和已存短文一樣只存在這台裝置，不同步、不備份（decisions #94）。
import { profileStorage } from './profile-storage.js';
import { getSettings } from './store.js';
import { generateJSON } from './llm.js';
import { READING_TYPES, pickReadingWords, buildReadingPrompt, READING_SCHEMA, normalizeReading, sanitizeSaved } from './reading.js?v=reading-1';

const NEXT_KEY = 'toeic-cards:reading-next';
export const MIN_WORDS = 3;

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const currentScope = () => String(getSettings().activeSetId || '');
export const randomReadingType = () => {
  const keys = Object.keys(READING_TYPES);
  return keys[Math.floor(Math.random() * keys.length)];
};

// 用這些字請 AI 寫一篇；回傳可以存的短文，內容不完整就丟出錯誤
export async function writeReading(words, type, signal) {
  const { data } = await generateJSON({
    prompt: buildReadingPrompt(words, type),
    schema: READING_SCHEMA,
    signal,
    temperature: 0.8,
  });
  const reading = normalizeReading({ ...data, type }, words);
  if (!reading) throw new Error('AI 回傳的短文不完整，請再產生一次');
  return { ...reading, id: newId(), answers: reading.questions.map(() => null), at: Date.now() };
}

// 背景寫好、還沒拿去讀的那篇（不是目前單字集寫的就當作沒有）
export function preparedReading() {
  try {
    const raw = JSON.parse(profileStorage.getItem(NEXT_KEY) || 'null');
    if (!raw || raw.scope !== currentScope()) return null;
    return sanitizeSaved([raw])[0] || null;
  } catch (e) { return null; }
}

// 類型符合就拿走（拿走後就不在這裡了）；type 是 'random' 時任何類型都可以
export function takePreparedReading(type) {
  const r = preparedReading();
  if (!r || (type !== 'random' && r.type !== type)) return null;
  try { profileStorage.removeItem(NEXT_KEY); } catch (e) { /* 移不掉頂多下次再讀到同一篇 */ }
  return { ...r, at: Date.now() };
}

// 背景要不要寫：還沒有寫好的一篇、而且範圍內的字夠 → 回傳要寫進去的字
export function readingStockNeed(words) {
  if (preparedReading()) return null;
  const picked = pickReadingWords(words);
  return picked.length >= MIN_WORDS ? picked : null;
}

export async function fillReading(words, signal) {
  const scope = currentScope();
  const item = await writeReading(words, randomReadingType(), signal);
  profileStorage.setItem(NEXT_KEY, JSON.stringify({ ...item, scope }));
  return item;
}
