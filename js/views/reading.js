import { profileStorage } from '../profile-storage.js';
// 短文閱讀頁（多益 Part 6／7 風格）：用自己的單字讓 AI 寫一篇商務短文＋閱讀理解題
//   - 文章裡的英文字都可以點來查（沿用全站查字視窗），自己的字會標出來
//   - 每答一題就顯示解析，並計入每日目標；全部答完可以看中文翻譯
//   - 短文存在這台裝置（最多 20 篇），可以重複閱讀；不同步、不放進備份
import { scopedWords, subscribe } from '../store.js';
import { esc, toast, confirmAction } from '../ui.js';
import { hasApiKey, generateJSON, onRateWait } from '../llm.js';
import { recordQuiz } from '../log.js';
import { wordTokens } from '../word-tokens.js';
import { setScopeHTML, bindSetScope } from '../set-ui.js?v=dictionary-scale-1';
import { aiBadge } from '../ai-badge.js';
import {
  READING_TYPES, MAX_SAVED, pickReadingWords, buildReadingPrompt, READING_SCHEMA, normalizeReading, sanitizeSaved,
  readingScore, wordPattern,
} from '../reading.js?v=reading-1';

const STORAGE_KEY = 'toeic-cards:readings';
const MIN_WORDS = 3;
const LETTERS = ['A', 'B', 'C', 'D'];
const state = { view: 'list', currentId: null, type: 'random', error: null };
let controller = null;

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function loadReadings() {
  try {
    return sanitizeSaved(JSON.parse(profileStorage.getItem(STORAGE_KEY) || '[]'));
  } catch {
    return [];
  }
}

function saveReadings(list) {
  try {
    profileStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_SAVED)));
    return true;
  } catch {
    toast('瀏覽器空間不足，這篇短文沒有存起來', 'error');
    return false;
  }
}

// 段落裡的英文字變成可以點來查的按鈕；自己的字加上標記
function passageHTML(text, patterns) {
  return wordTokens(text).map((part) => {
    if (!part.word) return esc(part.text);
    const mine = patterns.some((re) => re.test(part.text));
    return `<button class="lookup-token${mine ? ' reading-target' : ''}" type="button" data-lookup-word="${esc(part.word)}" aria-label="查詢 ${esc(part.text)}">${esc(part.text)}</button>`;
  }).join('');
}

const fmtDate = (t) => new Date(t).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });

export function renderReading(root) {
  let unsubWait = null;
  let alive = true;   // 離開頁面後，背景完成的 AI 請求不能再畫到別的頁面上

  function draw() {
    unsubWait?.();
    unsubWait = null;
    if (state.view === 'loading') drawLoading();
    else if (state.view === 'read' && loadReadings().some((r) => r.id === state.currentId)) drawRead();
    else { state.view = 'list'; drawList(); }
  }

  // ---------- 列表：產生新短文、已存的短文 ----------
  function drawList() {
    const list = loadReadings();
    const words = scopedWords();
    const canAI = hasApiKey();
    const enough = words.length >= MIN_WORDS;
    root.innerHTML = `
      <section class="page page-reading">
        <div class="quiz-head">
          <a class="btn btn-ghost btn-sm" href="#/quiz">‹ 測驗</a>
          <h1 class="page-title inline">短文閱讀</h1>
        </div>
        <p class="panel-desc">用你的單字寫一篇多益風格的短文（Email、公告、廣告…），附 Part 7 閱讀理解題。文章裡的字都可以點來查、收藏。</p>
        ${state.error ? `<p class="ai-error" role="alert">⚠ ${esc(state.error)}</p>` : ''}
        <div class="panel reading-new">
          ${setScopeHTML()}
          <label class="set-scope"><span>類型</span><select id="readingType">
            <option value="random" ${state.type === 'random' ? 'selected' : ''}>隨機</option>
            ${Object.entries(READING_TYPES).map(([k, v]) => `<option value="${k}" ${state.type === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
          </select></label>
          <button class="btn btn-primary" type="button" id="generate" ${canAI && enough ? '' : 'disabled'}>產生新短文${aiBadge('required')}</button>
          <p class="hint-text">${!canAI ? '需要 Gemini 金鑰，<a href="#/settings">前往設定</a>。已存的短文不需要金鑰也能讀。'
            : !enough ? `目前範圍只有 ${words.length} 個字，至少需要 ${MIN_WORDS} 個字。`
            : '每篇約用 1 次 AI 請求；會優先挑「不熟」的字寫進文章。'}</p>
        </div>
        ${list.length ? `
          <h2 class="panel-title">已存的短文（${list.length}）</h2>
          <ul class="reading-list">
            ${list.map((r) => {
              const s = readingScore(r);
              return `<li><button class="panel reading-item" type="button" data-id="${esc(r.id)}">
                <span class="chip">${esc(READING_TYPES[r.type])}</span>
                <span class="reading-item-title" lang="en">${esc(r.title)}</span>
                <span class="reading-item-meta">${fmtDate(r.at)}・${s.done ? `答對 ${s.correct} / ${s.total}` : s.answered ? `作答中 ${s.answered} / ${s.total}` : '還沒作答'}</span>
              </button></li>`;
            }).join('')}
          </ul>` : '<div class="empty-state"><p class="empty-title">還沒有短文</p><p>產生第一篇，用文章複習你的單字。</p></div>'}
      </section>`;
    bindSetScope(root);
    root.querySelector('#readingType').addEventListener('change', (e) => { state.type = e.target.value; });
    root.querySelector('#generate').addEventListener('click', generate);
    root.querySelectorAll('.reading-item').forEach((b) => b.addEventListener('click', () => {
      state.currentId = b.dataset.id;
      state.view = 'read';
      state.error = null;
      draw();
      window.scrollTo(0, 0);
    }));
  }

  async function generate() {
    state.error = null;
    const words = pickReadingWords(scopedWords());
    if (words.length < MIN_WORDS) return;
    const keys = Object.keys(READING_TYPES);
    const type = state.type === 'random' ? keys[Math.floor(Math.random() * keys.length)] : state.type;
    state.view = 'loading';
    draw();
    controller = new AbortController();
    try {
      const { data } = await generateJSON({
        prompt: buildReadingPrompt(words, type),
        schema: READING_SCHEMA,
        signal: controller.signal,
        temperature: 0.8,
      });
      const reading = normalizeReading({ ...data, type }, words);
      if (!reading) throw new Error('AI 回傳的短文不完整，請再產生一次');
      const item = { ...reading, id: newId(), answers: reading.questions.map(() => null), at: Date.now() };
      if (saveReadings([item, ...loadReadings()])) {
        state.currentId = item.id;
        state.view = 'read';
      } else {
        state.view = 'list';
      }
    } catch (err) {
      state.view = 'list';
      state.error = err.kind === 'aborted' ? null : err.message;
    } finally {
      controller = null;
    }
    if (alive) draw();
  }

  // ---------- AI 寫作中 ----------
  function drawLoading() {
    root.innerHTML = `
      <section class="page">
        <div class="empty-state loading-state">
          <p class="empty-title">AI 正在寫短文…</p>
          <p class="muted">大約需要十幾秒</p>
          <p class="ai-sub" id="waitText"></p>
          <button class="btn btn-ghost" type="button" id="cancel">取消</button>
        </div>
      </section>`;
    root.querySelector('#cancel').addEventListener('click', () => controller?.abort());
    unsubWait = onRateWait((sec) => {
      const el = root.querySelector('#waitText');
      if (el) el.textContent = sec ? `為了不超過免費額度，等待 ${sec} 秒…` : '';
    });
  }

  // ---------- 閱讀與作答 ----------
  function drawRead() {
    const r = loadReadings().find((x) => x.id === state.currentId);
    const patterns = r.targets.map(wordPattern).filter(Boolean);
    const score = readingScore(r);
    root.innerHTML = `
      <section class="page page-reading">
        <div class="quiz-head">
          <button class="btn btn-ghost btn-sm" type="button" id="back">‹ 短文列表</button>
          <span class="quiz-progress">${score.done ? `答對 <strong>${score.correct}</strong> / ${score.total}` : `${score.answered} / ${score.total} 題`}</span>
        </div>
        <article class="panel reading-passage">
          <p class="eyebrow">${esc(READING_TYPES[r.type])}</p>
          <h1 class="reading-title" lang="en">${esc(r.title)}</h1>
          <div class="reading-body" lang="en">${r.paragraphs.map((p) => `<p>${passageHTML(p, patterns)}</p>`).join('')}</div>
          ${r.targets.length ? `<p class="hint-text reading-legend">標底色的是你的單字：${r.targets.map((t) => `<span class="reading-target-chip" lang="en">${esc(t)}</span>`).join(' ')}；文章裡任何字都可以點來查。</p>` : ''}
        </article>
        <ol class="reading-questions">
          ${r.questions.map((q, i) => {
            const chosen = r.answers[i];
            const answered = chosen !== null;
            return `<li class="reading-q" data-q="${i}">
              <p class="reading-q-text" lang="en">${esc(q.question)}</p>
              <div class="options reading-options">
                ${q.options.map((opt, j) => `<button class="option option-sentence ${answered && j === q.answer ? 'is-correct' : ''} ${answered && j === chosen && j !== q.answer ? 'is-wrong' : ''}" type="button" data-o="${j}" ${answered ? 'disabled' : ''}>
                  <span class="option-key">(${LETTERS[j]})</span><span class="option-text" lang="en">${esc(opt)}</span></button>`).join('')}
              </div>
              ${answered ? `<div class="feedback ${chosen === q.answer ? 'ok' : 'bad'}" role="status">
                <p class="fb-head">${chosen === q.answer ? '✓ 答對了！' : `✗ 答錯了，正確答案是 (${LETTERS[q.answer]})`}</p>
                ${q.explanation ? `<p class="fb-explain">💡 ${esc(q.explanation)}</p>` : ''}
              </div>` : ''}
            </li>`;
          }).join('')}
        </ol>
        ${score.done && r.translation.length ? `<details class="panel reading-translation"><summary>看中文翻譯</summary>${r.translation.map((p) => `<p>${esc(p)}</p>`).join('')}</details>` : ''}
        ${!score.done ? '<p class="hint-text">全部答完後可以看中文翻譯。</p>' : ''}
        <div class="done-actions">
          <button class="btn btn-ghost danger" type="button" id="delete">刪除這篇</button>
        </div>
      </section>`;
    root.querySelector('#back').addEventListener('click', () => { state.view = 'list'; draw(); });
    root.querySelector('#delete').addEventListener('click', () => {
      if (!confirmAction('確定要刪除這篇短文嗎？')) return;
      saveReadings(loadReadings().filter((x) => x.id !== r.id));
      state.view = 'list';
      draw();
    });
    root.querySelectorAll('.reading-q').forEach((el) => el.querySelectorAll('.option').forEach((b) => b.addEventListener('click', () => {
      answer(Number(el.dataset.q), Number(b.dataset.o));
    })));
  }

  function answer(qi, choice) {
    const list = loadReadings();
    const r = list.find((x) => x.id === state.currentId);
    if (!r || r.answers[qi] !== null) return;
    r.answers[qi] = choice;
    saveReadings(list);
    recordQuiz(choice === r.questions[qi].answer);
    const y = window.scrollY;
    drawRead();
    window.scrollTo(0, y);   // 重畫後停在原本的位置
  }

  draw();
  // 換單字集等設定改變時，列表上的「目前範圍有幾個字」要更新
  const unsub = subscribe(() => { if (state.view === 'list') draw(); });
  return () => { alive = false; unsub(); unsubWait?.(); controller?.abort(); };
}
