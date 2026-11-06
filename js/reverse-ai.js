// 中文 → 英文的 AI 備援：只在字典查不到、使用者按下按鈕時呼叫一次 Gemini。
// 送出的只有使用者輸入的中文；結果不存檔，點選後一樣走本機字典查完整解釋。
import { generateJSON } from './llm.js';

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    words: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { word: { type: 'STRING' }, pos: { type: 'STRING' }, zh: { type: 'STRING' } },
        required: ['word', 'zh'],
      },
    },
  },
  required: ['words'],
};

export function buildReversePrompt(text) {
  return `You help a Taiwanese learner preparing for the TOEIC test.
The learner typed this Traditional Chinese expression and wants the English for it: 「${text}」
Return up to 5 English words or short phrases (at most 4 words each) that express this meaning,
most natural and most common in workplace / TOEIC contexts first.
For each: "word" in lowercase unless it is a proper noun or acronym, "pos" as n. / v. / adj. / adv. / phrase,
and "zh" a short Traditional Chinese (Taiwan) gloss of that English, at most 12 characters.
If the input is not a meaningful Chinese expression, return an empty list.`;
}

// 清理 AI 回傳：只收英文拼字、去重、最多 5 個
export function cleanReverseResult(data) {
  const seen = new Set();
  const out = [];
  for (const item of data?.words || []) {
    const word = String(item?.word || '').trim().replace(/\s+/g, ' ');
    if (!/^[A-Za-zà-öø-ÿ]+(?:[-' ][A-Za-zà-öø-ÿ]+){0,4}$/.test(word) || word.length > 60) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ word, term: String(item.zh || '').trim().slice(0, 20), pos: String(item.pos || '').trim().slice(0, 12), ai: true });
    if (out.length >= 5) break;
  }
  return out;
}

export async function aiReverseLookup(text, { signal } = {}) {
  const { data } = await generateJSON({ prompt: buildReversePrompt(text), schema: SCHEMA, signal, maxRetries: 1, temperature: 0.2 });
  return cleanReverseResult(data);
}
