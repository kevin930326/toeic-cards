// 保留原句的空白、標點及大小寫，只有英文詞彙帶查詢值；不猜測原形。
import { normalizeWord } from './parse.js';

export function wordTokens(value) {
  const text = String(value ?? '');
  const pattern = /[a-zà-öø-ÿ][a-zà-öø-ÿ\u0300-\u036f]*(?:['’-][a-zà-öø-ÿ][a-zà-öø-ÿ\u0300-\u036f]*)*/gi;
  const parts = [];
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > index) parts.push({ text: text.slice(index, match.index) });
    parts.push({ text: match[0], word: normalizeWord(match[0].replace(/’/g, "'")) });
    index = match.index + match[0].length;
  }
  if (index < text.length) parts.push({ text: text.slice(index) });
  return parts;
}
