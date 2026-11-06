// 「也譯作」：同一個意思的其他中文說法（prospective：潛在的 ↔ 預期的）。
// 存法：字卡中文意思的最後一行「也譯作：預期的；將來的」，沿用既有的中文欄位、備份與同步，不新增欄位。
// 來源：多益單字包的人工整理表（data/packs/toeic-1000-alt.json，只顯示不寫入）、AI 生成、使用者自己加。純函式，可單獨測試。

export const ALT_PREFIX = '也譯作：';
const VARIANTS = { 污: '汙', 台: '臺', 檯: '臺', 着: '著', 裏: '裡', 綫: '線' };

// 把一段中文意思拆成詞：去詞性、括號註解，用分號／逗號切開
export function meaningTerms(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim().replace(ALT_PREFIX, '').replace(/^[a-z]+\.(?:\s*(?:&|\/)\s*[a-z]+\.)*\s*/i, '')
      .replace(/\[[^\]]*\]|（[^）]*）|\([^)]*\)/g, '');
    for (const part of line.split(/[；;，,、]/)) {
      const term = part.trim();
      if (term && !out.includes(term)) out.push(term);
    }
  }
  return out;
}

const normalize = (term) => [...term].map((char) => VARIANTS[char] || char).join('')
  .replace(/^[使被]/, '').replace(/[的地]$/, '');

// 兩個詞算「同一種說法」：一個包含另一個，或有兩個字連在一起相同（規則同 tools/build_pack_alt.py）
export function similarTerms(a, b) {
  const x = normalize(a); const y = normalize(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  for (let i = 0; i + 1 < x.length; i++) if (y.includes(x.slice(i, i + 2))) return true;
  return false;
}

// 拆開主要意思與「也譯作」行
export function splitZh(zh) {
  const lines = String(zh || '').split('\n');
  const main = lines.filter((line) => !line.trim().startsWith(ALT_PREFIX)).join('\n').trim();
  const alt = meaningTerms(lines.filter((line) => line.trim().startsWith(ALT_PREFIX)).join('\n'));
  return { main, alt };
}

// 卡片要顯示的「也譯作」：使用者整理過（src.zh = user 且有這一行）就只用自己的；
// 否則合併字卡裡的這一行與單字包整理表。和主要意思太像的詞不重複列，最多 5 個。
export function altMeanings(word, packAlt = '') {
  const { main, alt } = splitZh(word?.zh);
  const mine = meaningTerms(main);
  if (!mine.length) return [];   // 還沒有中文意思的卡不顯示
  const candidates = word?.src?.zh === 'user' && alt.length ? alt : [...alt, ...meaningTerms(packAlt)];
  const out = [];
  for (const term of candidates) {
    if (mine.some((own) => similarTerms(own, term)) || out.some((kept) => kept === term)) continue;
    out.push(term);
  }
  return out.slice(0, 5);
}

// 把譯法寫回中文意思：主要意思不變，最後一行換成新的「也譯作」；沒有譯法就拿掉這一行
export function withAlt(zh, terms) {
  const { main } = splitZh(zh);
  const list = [...new Set(terms.map((term) => String(term).trim()).filter(Boolean))];
  return list.length ? `${main}\n${ALT_PREFIX}${list.join('；')}`.trim() : main;
}

// 使用者輸入的譯法：可用分號、逗號、頓號或空白分隔
export function parseAltInput(text) {
  return String(text || '').split(/[；;，,、\s/]+/).map((term) => term.trim()).filter(Boolean).slice(0, 5)
    .map((term) => term.slice(0, 20));
}
