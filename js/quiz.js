// 測驗出題的純邏輯（不碰畫面、不碰儲存、不呼叫 API），方便單獨測試
//
// 題型：
//   zh2en   看中文，選英文單字
//   en2word 看英文解釋，選單字（解釋裡出現答案的字會被遮住）
//   listen  聽發音，選中文意思
//   part5   多益 Part 5 句子填空（題目由 Gemini 產生，見 part5.js）
//   forms   詞性變化：句子挖一個空，四個選項是同一個字的不同形式（內建題庫＋Gemini，見 forms-quiz.js）
//
// 一題的格式：
//   { mode, wordId, prompt, options: [4 個字串], answerIndex, word, extra }

export const MODES = ['zh2en', 'en2word', 'listen', 'part5', 'forms'];
// 題目是「句子挖空」的題型（畫面、鍵盤 A–D、朗讀整句都一樣）
export const SENTENCE_MODES = ['part5', 'forms'];
export const MIN_WORDS = 4;   // 至少要 4 個字才能出四選一

// ---- 小工具 ----

// 可以傳入固定的亂數產生器，測試時結果才會固定
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, rng = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 第一個詞性，例如 'vt. / vi.' → 'v'、'n.' → 'n'
export function mainPos(pos) {
  const p = String(pos || '').trim().split(/[\s/,&]+/)[0].replace(/\.$/, '').toLowerCase();
  if (p === 'vt' || p === 'vi') return 'v';
  if (p === 'a') return 'adj';
  if (p === 'ad') return 'adv';
  return p;
}

// 中文意思的第一行，去掉開頭的詞性，例如 'v. 核准；批准\nn. …' → '核准；批准'
export function firstMeaning(zh) {
  const line = String(zh || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  return line.replace(/^((?:[a-z]+\.\s*(?:&|\/)?\s*)+)\s*/i, '').trim();
}

// 把解釋或句子裡出現的答案遮住（approve → 也會遮 approved、approving、approval）
export function maskWord(text, word) {
  const w = String(word || '').toLowerCase().trim();
  if (!w) return text;
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let pattern;
  if (w.includes(' ')) pattern = escape(w);
  else {
    // 去掉常見的字尾 e / y，當成字根比對（太短的字只比對整個字）
    const stem = w.length >= 5 ? w.replace(/(e|y)$/, '') : w;
    pattern = `${escape(stem)}[a-z]*`;
  }
  return String(text).replace(new RegExp(`\\b${pattern}\\b`, 'gi'), '_____');
}

// ---- 挑選題目 ----

// 各題型需要哪些資料
export function isEligible(mode, w) {
  if (mode === 'zh2en' || mode === 'listen') return !!firstMeaning(w.zh);
  if (mode === 'en2word') return !!(w.en && w.en.trim());
  if (mode === 'part5' || mode === 'forms') return true;
  return false;
}

export function eligibleWords(mode, words) {
  return words.filter((w) => isEligible(mode, w));
}

// 這個題型能不能出題；不能的話回傳原因
export function checkMode(mode, words, targets = words) {
  // 詞性變化的四個選項都來自同一個字，不需要其他字當錯誤選項
  if (mode === 'forms') return targets.length ? { ok: true } : { ok: false, reason: '這個範圍裡沒有可以出題的字' };
  const pool = eligibleWords(mode, words);
  if (pool.length < MIN_WORDS) {
    const need = { zh2en: '有中文意思的字', listen: '有中文意思的字', en2word: '有英文解釋的字', part5: '單字' }[mode];
    return { ok: false, reason: `需要至少 ${MIN_WORDS} 個${need}（目前 ${pool.length} 個）` };
  }
  if (!eligibleWords(mode, targets).length) return { ok: false, reason: '這個範圍裡沒有可以出題的字' };
  return { ok: true };
}

// 從 pool 挑 n 個錯誤選項：
//   - 不能是答案本身，選項文字（key）不能重複
//   - 優先挑同詞性的字，比較像真的考題；不夠再用其他詞性補
export function pickDistractors(target, pool, n, { key = (w) => w.word, rng = Math.random } = {}) {
  const used = new Set([key(target).toLowerCase()]);
  const pos = mainPos(target.pos);
  const candidates = shuffle(pool.filter((w) => w.id !== target.id), rng);
  const same = candidates.filter((w) => pos && mainPos(w.pos) === pos);
  const other = candidates.filter((w) => !(pos && mainPos(w.pos) === pos));
  const picked = [];
  for (const w of [...same, ...other]) {
    const k = key(w).toLowerCase();
    if (!k || used.has(k)) continue;
    used.add(k);
    picked.push(w);
    if (picked.length === n) break;
  }
  return picked;
}

// 簡易題型（不需要 LLM）出一題
export function buildSimpleQuestion(mode, target, pool, rng = Math.random) {
  const optionText = mode === 'listen' ? (w) => firstMeaning(w.zh) : (w) => w.word;
  const distractors = pickDistractors(target, eligibleWords(mode, pool), 3, { key: optionText, rng });
  if (distractors.length < 3) return null;
  const options = shuffle([target, ...distractors], rng);
  let prompt;
  if (mode === 'zh2en') prompt = String(target.zh).trim();
  else if (mode === 'en2word') prompt = maskWord(target.en.trim(), target.word);
  else if (mode === 'listen') prompt = target.word;   // 畫面上不顯示，用來播放發音
  else throw new Error(`不是簡易題型：${mode}`);
  return {
    mode,
    wordId: target.id,
    word: target.word,
    prompt,
    options: options.map(optionText),
    answerIndex: options.indexOf(target),
  };
}

// 挑出這次要考的字：不熟的字優先一點（各自打亂後，不熟的排前面一半的機率）
export function pickTargets(mode, targets, count, rng = Math.random) {
  const list = shuffle(eligibleWords(mode, targets), rng);
  const unfamiliar = list.filter((w) => w.unfamiliar);
  const rest = list.filter((w) => !w.unfamiliar);
  const merged = [];
  while (unfamiliar.length || rest.length) {
    if (unfamiliar.length && (rng() < 0.6 || !rest.length)) merged.push(unfamiliar.shift());
    else merged.push(rest.shift());
  }
  return merged.slice(0, count);
}

export function buildSimpleQuiz(mode, targets, pool, count, rng = Math.random) {
  return pickTargets(mode, targets, count, rng)
    .map((w) => buildSimpleQuestion(mode, w, pool, rng))
    .filter(Boolean);
}

// ---- Part 5（題目內容由 LLM 產生，這裡負責組請求和驗證結果）----

export const BLANK = '_____';

export function buildPart5Prompt(items) {
  return `You are writing TOEIC Reading Part 5 (Incomplete Sentences) questions for a Taiwanese learner.

For each item:
- Write ONE natural business-context sentence (12-25 words) containing exactly one blank written as "${BLANK}".
- The correct answer is the target word. You may change its form (tense, plural, -ing, etc.) to fit the sentence. Put the exact text that fills the blank in "answer".
- Rewrite each of the three given distractors in the same grammatical form as your answer, so all four options look parallel. Put them in "distractors" in the given order.
- The sentence must make ONLY the answer correct. Each distractor must be clearly wrong in meaning, collocation, or grammar.
- "translation": Traditional Chinese as used in Taiwan (繁體中文、台灣用語) translation of the full sentence with the answer filled in.
- "explanation": one or two short sentences in Traditional Chinese (Taiwan) explaining the clue that makes the answer correct.
- Copy the target word exactly into "target". Return every item once, in the same order.

Items:
${items.map((it, i) => `${i + 1}. target: "${it.target}"; distractors: ${it.distractors.map((d) => `"${d}"`).join(', ')}`).join('\n')}`;
}

export const PART5_SCHEMA = {
  type: 'OBJECT',
  properties: {
    questions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          target: { type: 'STRING' },
          sentence: { type: 'STRING' },
          answer: { type: 'STRING' },
          distractors: { type: 'ARRAY', items: { type: 'STRING' } },
          translation: { type: 'STRING' },
          explanation: { type: 'STRING' },
        },
        required: ['target', 'sentence', 'answer', 'distractors', 'translation', 'explanation'],
      },
    },
  },
  required: ['questions'],
};

// 檢查 LLM 回傳的一題是否可用；可用就整理成要存的格式，否則回傳 null
export function normalizePart5(item) {
  if (!item || typeof item !== 'object') return null;
  const clean = (s, max = 400) => (typeof s === 'string' ? s.trim().slice(0, max) : '');
  // 各種寫法的空格（__、___、……）統一成 _____
  const sentence = clean(item.sentence).replace(/_{2,}|＿{2,}|\(\s*\)|\[\s*\]/g, BLANK);
  const blanks = sentence.split(BLANK).length - 1;
  const answer = clean(item.answer, 60);
  const distractors = (Array.isArray(item.distractors) ? item.distractors : []).map((d) => clean(d, 60)).filter(Boolean);
  if (blanks !== 1 || !answer || distractors.length < 3) return null;
  const options = [answer, ...distractors.slice(0, 3)];
  if (new Set(options.map((o) => o.toLowerCase())).size !== 4) return null;   // 選項不能重複
  // 答案不應該已經出現在句子裡（否則等於送分）
  if (new RegExp(`\\b${answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(sentence)) return null;
  return {
    sentence,
    answer,
    distractors: distractors.slice(0, 3),
    translation: clean(item.translation),
    explanation: clean(item.explanation),
  };
}

// 把存好的 Part 5 題目變成一題（選項每次重新打亂）
export function part5Question(word, q, rng = Math.random) {
  const options = shuffle([q.answer, ...q.distractors], rng);
  return {
    mode: 'part5',
    wordId: word.id,
    word: word.word,
    prompt: q.sentence,
    options,
    answerIndex: options.indexOf(q.answer),
    extra: { translation: q.translation, explanation: q.explanation, qid: q.id },
  };
}

// ---- 詞性變化（四個選項是同一個字的不同形式；內建題庫或 Gemini 出題）----

// 兩個字開頭相同的字母數
function sharedPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

// 選項是不是和目標字同一個字族（approve → approval、approving…）：
// 開頭至少有 3 個字母相同（很短的字放寬到 字長−1），擋掉 AI 混進別的字
export function sameFamily(option, target) {
  const a = String(option || '').toLowerCase().split(' ')[0];
  const b = String(target || '').toLowerCase().split(' ')[0];
  if (!a || !b) return false;
  return sharedPrefix(a, b) >= Math.min(3, b.length - 1);
}

// 四個選項都是同一個字族：和目標字開頭相同，或和「已確定同字族的選項」開頭相同
// （例如 payment 的 paid：和 payment 只有 pa 相同，但和 pay 相同）
export function allSameFamily(options, target) {
  const anchors = [target, ...options.filter((o) => sameFamily(o, target))];
  return options.every((o) => anchors.some((a) => sameFamily(o, a)));
}

// 檢查一題詞性變化題是否可用（內建題庫和 AI 的結果都經過這裡）；可用就整理成要存的格式，否則回傳 null
export function normalizeFormQ(item, target) {
  const q = normalizePart5(item);
  if (!q) return null;
  const word = String(target || item?.target || '').trim();
  if (!word || !allSameFamily([q.answer, ...q.distractors], word)) return null;
  return q;
}

// 把存好的詞性變化題變成一題（選項每次重新打亂）
export function formsQuestion(word, q, rng = Math.random) {
  return { ...part5Question(word, q, rng), mode: 'forms' };
}

export function buildFormsPrompt(targets) {
  return `You are writing TOEIC Reading Part 5 word-form questions for a Taiwanese learner.

For each target word:
- Write ONE natural business-context sentence (12-25 words) containing exactly one blank written as "${BLANK}".
- The four options are four DIFFERENT forms of the same word family as the target, e.g. approve / approval / approving / approved, or success / successful / successfully / succeed. Use real English words only.
- The sentence must contain a clear grammatical clue (article, preposition, auxiliary verb, subject-verb agreement, adverb position, etc.) so that EXACTLY ONE option is grammatically correct. Do not rely on meaning alone; the other three must be clearly ungrammatical in the blank.
- Put the correct form in "answer" and the other three forms in "distractors".
- "translation": Traditional Chinese as used in Taiwan (繁體中文、台灣用語) translation of the full sentence with the answer filled in.
- "explanation": one or two short sentences in Traditional Chinese (Taiwan) naming the grammatical clue and the part of speech required.
- Copy the target word exactly into "target". Return every item once, in the same order.

Targets:
${targets.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
}

export const FORMS_SCHEMA = PART5_SCHEMA;

// 內建詞性變化題庫：{ packId, version, questions: [{ target, sentence, answer, distractors, translation, explanation }] }
// 回傳 Map（單字 → 題目陣列）；每題都經過 normalizeFormQ，不合格的題目略過
export function parseFormsBank(raw, normalize = (w) => String(w || '').trim().toLowerCase()) {
  if (!raw || raw.packId !== 'toeic-1000' || raw.version !== 1 || !Array.isArray(raw.questions)) {
    throw new Error('詞性變化題庫格式不正確，請重新載入');
  }
  const bank = new Map();
  for (const item of raw.questions) {
    const word = normalize(item?.target);
    const q = word ? normalizeFormQ(item, word) : null;
    if (!q) continue;
    if (!bank.has(word)) bank.set(word, []);
    bank.get(word).push(q);
  }
  return bank;
}
