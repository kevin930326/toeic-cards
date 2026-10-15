// 把使用者貼上的一段文字拆成單字清單
//
// 規則：
//   - 換行、逗號、分號、tab、斜線都是分隔符號
//   - 中文、數字、項目符號都會被當成分隔（所以「1. approve 批准」→ approve）
//   - 同一段裡有空白時：如果像片語（含 up / over / of 等小字，最多 4 個字）就保留成片語，
//     否則依空白拆成多個字（所以「approve deadline invoice」→ 三個字）

// 單字一律用小寫、去頭尾空白、多個空白合成一個，再比較是否重複
export function normalizeWord(w) {
  return String(w || '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
}

const PARTICLES = new Set([
  'up', 'down', 'out', 'off', 'on', 'in', 'into', 'over', 'of', 'to', 'for', 'with',
  'by', 'at', 'away', 'back', 'about', 'from', 'ahead', 'through', 'behalf', 'charge',
  'forward', 'around', 'along', 'across', 'after', 'under',
]);

function looksLikePhrase(parts) {
  return parts.length >= 2 && parts.length <= 4 && parts.slice(1).some((p) => PARTICLES.has(p));
}

function cleanToken(t) {
  // 去掉頭尾的連字號、撇號（例如從清單貼上的「- approve」）
  return t.replace(/^['-]+|['-]+$/g, '');
}

export function splitWords(text) {
  const out = [];
  const segments = String(text || '')
    .toLowerCase()
    .split(/[\n\r,，;；\t/、]+/);
  for (const seg of segments) {
    // 非英文的東西（中文、數字、標點）都當成空白
    const cleaned = seg.replace(/[^a-z'\- ]+/g, ' ').trim();
    if (!cleaned) continue;
    const parts = cleaned.split(/\s+/).map(cleanToken).filter(Boolean);
    if (looksLikePhrase(parts)) out.push(parts.join(' '));
    else out.push(...parts);
  }
  // 單一字母多半是清單編號（a. b. c.）留下的，不當成單字
  return out.filter((w) => w.length >= 2);
}

// 回傳 { fresh, dupes, existing }
//   fresh：要新增的字；dupes：這次貼上的內容裡重複的字；existing：字卡裡已經有的字
export function analyzeInput(text, existingWords) {
  const existingSet = new Set(existingWords.map(normalizeWord));
  const seen = new Set();
  const fresh = [];
  const dupes = [];
  const existing = [];
  for (const raw of splitWords(text)) {
    const w = normalizeWord(raw);
    if (seen.has(w)) {
      if (!dupes.includes(w)) dupes.push(w);
      continue;
    }
    seen.add(w);
    if (existingSet.has(w)) existing.push(w);
    else fresh.push(w);
  }
  return { fresh, dupes, existing };
}
