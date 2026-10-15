// 多益短文閱讀（Part 6／7 風格）的純邏輯：挑字、組 AI 請求、檢查 AI 回傳的短文（不碰畫面、不碰儲存）
//
// 一篇短文的格式：
//   { id, type, title, paragraphs: [英文段落], translation: [中文段落], targets: [短文裡用到的單字],
//     questions: [{ question, options: [4 個], answer: 0–3, explanation }], answers: [使用者選的], at }
import { shuffle } from './quiz.js?v=forms-1';

export const READING_TYPES = {
  email: '電子郵件',
  notice: '公告',
  advertisement: '廣告',
  article: '報導',
  memo: '公司備忘錄',
};
// 寫進 AI 提示的英文說法
export const READING_PROMPT_TYPES = {
  email: 'business email',
  notice: 'notice',
  advertisement: 'advertisement',
  article: 'short news article',
  memo: 'internal memo',
};
export const MAX_SAVED = 20;
const WORDS_PER_PASSAGE = 6;

// 挑要寫進短文的字：不熟的優先，其次是學習中的字，再來隨機；片語也可以
export function pickReadingWords(words, n = WORDS_PER_PASSAGE, rng = Math.random) {
  const pool = shuffle(words.filter((w) => w && typeof w.word === 'string' && w.word.trim()), rng);
  const rank = (w) => (w.unfamiliar ? 0 : w.srs ? 1 : 2);
  return pool.sort((a, b) => rank(a) - rank(b)).slice(0, n).map((w) => w.word);
}

export function buildReadingPrompt(words, type) {
  return `You are writing TOEIC Reading Part 7 practice material for a Taiwanese learner (TOEIC level around 600-800).

Write ONE ${READING_PROMPT_TYPES[type] || type} in a realistic business context.
- Length: 120-220 words, in 2-4 paragraphs. Natural, workplace English like the real TOEIC.
- Use as many of these target words as fit naturally (any grammatical form is fine): ${words.join(', ')}.
- "title": a short English title (for an email, use the subject line).
- "translation": a Traditional Chinese (繁體中文、台灣用語) translation, one item per paragraph, in the same order.
- "targets": the target words you actually used, copied exactly from the list above.
- Write 3 or 4 multiple-choice questions in TOEIC Part 7 style (purpose of the text, a stated detail, an inference, and one "closest in meaning to" question about one target word as used in the text).
- Each question has exactly 4 options and exactly one correct answer that can be found in the text. "answer" is the index (0-3) of the correct option.
- "explanation": one or two short sentences in Traditional Chinese (Taiwan) pointing to where the answer is in the text.`;
}

export const READING_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    paragraphs: { type: 'ARRAY', items: { type: 'STRING' } },
    translation: { type: 'ARRAY', items: { type: 'STRING' } },
    targets: { type: 'ARRAY', items: { type: 'STRING' } },
    questions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          question: { type: 'STRING' },
          options: { type: 'ARRAY', items: { type: 'STRING' } },
          answer: { type: 'INTEGER' },
          explanation: { type: 'STRING' },
        },
        required: ['question', 'options', 'answer', 'explanation'],
      },
    },
  },
  required: ['title', 'paragraphs', 'translation', 'targets', 'questions'],
};

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 單字（或它的變化形）有沒有出現在文字裡：approve 也算 approved、approving
export function wordPattern(word) {
  const w = String(word || '').toLowerCase().trim();
  if (!w) return null;
  if (w.includes(' ')) return new RegExp(`\\b${escapeRe(w)}\\b`, 'i');
  const stem = w.length >= 5 ? w.replace(/(e|y)$/, '') : w;
  return new RegExp(`\\b${escapeRe(stem)}[a-z]*\\b`, 'i');
}

// 檢查 AI 回傳（或本機存的）短文；可用就整理成要存的格式，否則回傳 null
//   words：這篇要用的字；只保留真的出現在短文裡的字
export function normalizeReading(raw, words = []) {
  if (!raw || typeof raw !== 'object') return null;
  const paragraphs = (Array.isArray(raw.paragraphs) ? raw.paragraphs : []).map((p) => str(p, 1500)).filter(Boolean).slice(0, 6);
  if (!paragraphs.length) return null;
  const text = paragraphs.join('\n');
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount < 60 || wordCount > 450) return null;
  const translation = (Array.isArray(raw.translation) ? raw.translation : []).map((p) => str(p, 1500)).filter(Boolean).slice(0, 6);
  const questions = (Array.isArray(raw.questions) ? raw.questions : []).map((q) => {
    if (!q || typeof q !== 'object') return null;
    const options = (Array.isArray(q.options) ? q.options : []).map((o) => str(o, 200)).filter(Boolean);
    const answer = Number(q.answer);
    const question = str(q.question, 300);
    if (!question || options.length !== 4 || new Set(options.map((o) => o.toLowerCase())).size !== 4) return null;
    if (!Number.isInteger(answer) || answer < 0 || answer > 3) return null;
    return { question, options, answer, explanation: str(q.explanation, 400) };
  }).filter(Boolean).slice(0, 4);
  if (questions.length < 3) return null;
  const candidates = words.length ? words : (Array.isArray(raw.targets) ? raw.targets : []);
  const targets = [...new Set(candidates.map((w) => str(w, 100).toLowerCase()).filter(Boolean))]
    .filter((w) => wordPattern(w)?.test(text)).slice(0, 12);
  const type = Object.hasOwn(READING_TYPES, raw.type) ? raw.type : 'article';
  return { type, title: str(raw.title, 150) || 'Reading', paragraphs, translation, targets, questions };
}

// 已經存的短文：重新檢查一次（資料可能是舊版或被改過），作答紀錄只留合法的數字
export function sanitizeSaved(list) {
  if (!Array.isArray(list)) return [];
  return list.map((r) => {
    const n = normalizeReading(r, Array.isArray(r?.targets) ? r.targets : []);
    if (!n || typeof r.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(r.id)) return null;
    const answers = n.questions.map((_, i) => {
      const a = Array.isArray(r.answers) ? r.answers[i] : null;
      return Number.isInteger(a) && a >= 0 && a <= 3 ? a : null;
    });
    return { ...n, id: r.id, answers, at: Number(r.at) || 0 };
  }).filter(Boolean).slice(0, MAX_SAVED);
}

// 答對幾題（只算已作答的）
export function readingScore(reading) {
  const answered = reading.answers.filter((a) => a !== null).length;
  const correct = reading.questions.filter((q, i) => reading.answers[i] === q.answer).length;
  return { answered, correct, total: reading.questions.length, done: answered === reading.questions.length };
}
