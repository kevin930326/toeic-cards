// 測驗頁：選模式 → 作答 → 看結果；另外有錯題本
//   答錯的字自動標記「不熟」，並把整題存進錯題本；在錯題本重做答對就移除
import { getWord, getSettings, updateSettings, updateWord, subscribe } from '../store.js';
import { esc, toast, confirmAction } from '../ui.js';
import { speak, canSpeak, speakerIcon, resolveAccent, accentLabel } from '../speech.js';
import { hasApiKey, onRateWait } from '../llm.js';
import { checkMode, buildSimpleQuiz, pickTargets, firstMeaning, shuffle, BLANK, SENTENCE_MODES } from '../quiz.js?v=forms-1';
import { preparePart5 } from '../part5.js?v=forms-1';
import { prepareForms, loadFormsBank, loadedFormsBank } from '../forms-quiz.js?v=forms-1';
import { normalizeWord } from '../parse.js';
import { loadReadings } from './reading.js?v=reading-1';
import { getMistakes, addMistake, removeMistake, mistakeKey } from '../mistakes.js';
import { recordQuiz } from '../log.js';
import { scopedWords } from '../store.js';
import { setScopeHTML, bindSetScope } from '../set-ui.js?v=dictionary-scale-1';

const MODE_INFO = {
  zh2en: { title: '看中文選英文', desc: '看中文意思，選出正確的英文單字', icon: '中' },
  en2word: { title: '看解釋選單字', desc: '看淺白的英文解釋，選出是哪個字', icon: 'Aa' },
  listen: { title: '聽力測驗', desc: '聽發音，選出正確的中文意思', icon: '♪' },
  part5: { title: 'Part 5 句子填空', desc: '仿多益閱讀 Part 5：商務句子挖一個空，四選一', icon: '___' },
  forms: { title: '詞性變化', desc: '四個選項是同一個字的不同形式，看句子結構選對詞性（Part 5 最常考）', icon: '形' },
};
const isSentence = (mode) => SENTENCE_MODES.includes(mode);
// 詞性變化：有內建題目的字（題庫載入前先用「是不是單字包的字」估計）、或存過 AI 題目的字，不需要金鑰
function hasFormSource(w) {
  const bank = loadedFormsBank();
  const builtin = bank ? bank.has(normalizeWord(w.word)) : w.pack?.id === 'toeic-1000';
  return builtin || !!(w.formQs && w.formQs.length);
}
const modeTitle = (mode) => (MODE_INFO[mode] ? MODE_INFO[mode].title : '錯題重做');
const LETTERS = ['A', 'B', 'C', 'D'];

// 頁面狀態（切換頁面回來還在）
const state = { view: 'home', session: null, loading: null, error: null };
let controller = null;

function targetsForScope() {
  const all = scopedWords();
  return getSettings().quizScope === 'unfamiliar' ? all.filter((w) => w.unfamiliar) : all;
}

// 選項重新打亂（錯題重做時用，避免背答案位置）
function reshuffle(q) {
  const answer = q.options[q.answerIndex];
  const options = shuffle(q.options);
  return { ...q, options, answerIndex: options.indexOf(answer) };
}

function newSession(mode, questions, { fromMistakes = false } = {}) {
  state.session = { mode, questions, index: 0, results: [], answered: null, fromMistakes };
  state.view = questions.length ? 'question' : 'home';
}

export function renderQuiz(root) {
  let unsubWait = null;

  function draw() {
    unsubWait?.();
    unsubWait = null;
    if (state.view === 'question' && state.session) drawQuestion();
    else if (state.view === 'result' && state.session) drawResult();
    else if (state.view === 'loading') drawLoading();
    else if (state.view === 'mistakes') drawMistakes();
    else { state.view = 'home'; drawHome(); }
  }

  // ---------- 首頁：選模式 ----------
  function drawHome() {
    const s = getSettings();
    const all = scopedWords();
    const unfamiliar = all.filter((w) => w.unfamiliar).length;
    const targets = targetsForScope();
    // 題庫在背景載入，載入後重畫，讓「哪些字有內建題目」更準確（失敗沒關係，開始測驗時會再試）
    if (!loadedFormsBank()) loadFormsBank().then(() => { if (state.view === 'home') draw(); }).catch(() => {});
    const ids = new Set(all.map((w) => w.id));
    const mistakes = getMistakes().filter((m) => ids.has(m.question.wordId)).length;
    const readings = loadReadings().length;
    const cards = Object.entries(MODE_INFO).map(([mode, info]) => {
      let check = checkMode(mode, all, targets);
      if (mode === 'part5' && check.ok && !hasApiKey()) check = { ok: false, reason: '需要 Gemini 金鑰', needKey: true };
      if (mode === 'forms' && check.ok && !hasApiKey() && !targets.some(hasFormSource)) {
        check = { ok: false, reason: '目前範圍沒有內建題目的字（多益 1000 單字包）；自己加的字需要 Gemini 金鑰', needKey: true };
      }
      // 按鈕和「前往設定」連結分開放（連結不能放在按鈕裡面）
      return `
        <div class="mode-card ${check.ok ? '' : 'is-disabled'}" data-mode="${mode}">
          <button class="mode-btn" type="button" data-mode="${mode}" ${check.ok ? '' : 'disabled'}>
            <span class="mode-icon" aria-hidden="true">${esc(info.icon)}</span>
            <span class="mode-title">${esc(info.title)}${mode === 'part5' ? '<span class="badge badge-ai">AI</span>' : ''}</span>
            <span class="mode-desc">${esc(info.desc)}</span>
          </button>
          ${check.ok ? '' : `<p class="mode-reason">${esc(check.reason)}${check.needKey ? '，<a href="#/settings">前往設定</a>' : ''}</p>`}
        </div>`;
    }).join('');

    root.innerHTML = `
      <section class="page">
        <h1 class="page-title">測驗</h1>
        ${state.error ? `<p class="ai-error" role="alert">⚠ ${esc(state.error)}</p>` : ''}
        <div class="panel quiz-options">
          ${setScopeHTML()}
          <div class="setting-row wrap">
            <span class="setting-label">範圍</span>
            <div class="segmented" role="radiogroup" aria-label="範圍">
              <label class="seg"><input type="radio" name="scope" value="all" ${s.quizScope !== 'unfamiliar' ? 'checked' : ''}><span>全部 ${all.length}</span></label>
              <label class="seg"><input type="radio" name="scope" value="unfamiliar" ${s.quizScope === 'unfamiliar' ? 'checked' : ''}><span>不熟 ${unfamiliar}</span></label>
            </div>
          </div>
          <div class="setting-row wrap">
            <span class="setting-label">題數</span>
            <div class="segmented" role="radiogroup" aria-label="題數">
              ${[10, 20].map((n) => `<label class="seg"><input type="radio" name="count" value="${n}" ${Number(s.quizCount) === n ? 'checked' : ''}><span>${n} 題</span></label>`).join('')}
            </div>
          </div>
          <label class="check-row">
            <input type="checkbox" id="fresh" ${s.part5Fresh ? 'checked' : ''}>
            <span>Part 5／詞性變化出新題目<span class="muted">（不勾選會優先使用已存的題目，省 AI 額度；單字包的字一律用內建題目）</span></span>
          </label>
        </div>
        <div class="mode-grid">${cards}</div>
        <a class="panel mistake-entry reading-entry" href="#/reading">
          <span class="mistake-title">短文閱讀（Part 6／7）<span class="badge badge-ai">AI</span></span>
          <span class="mistake-count">${readings ? `${readings} 篇` : '用你的單字寫一篇短文'}</span>
          <span class="mistake-arrow" aria-hidden="true">›</span>
        </a>
        <button class="panel mistake-entry" type="button" id="openMistakes">
          <span class="mistake-title">錯題本</span>
          <span class="mistake-count">${mistakes ? `${mistakes} 題` : '目前沒有錯題'}</span>
          <span class="mistake-arrow" aria-hidden="true">›</span>
        </button>
      </section>`;

    bindSetScope(root);
    root.querySelectorAll('input[name="scope"]').forEach((i) =>
      i.addEventListener('change', () => updateSettings({ quizScope: i.value })));
    root.querySelectorAll('input[name="count"]').forEach((i) =>
      i.addEventListener('change', () => updateSettings({ quizCount: Number(i.value) })));
    root.querySelector('#fresh').addEventListener('change', (e) => updateSettings({ part5Fresh: e.target.checked }));
    root.querySelectorAll('.mode-btn').forEach((b) => b.addEventListener('click', () => start(b.dataset.mode)));
    root.querySelector('#openMistakes').addEventListener('click', () => { state.view = 'mistakes'; draw(); });
  }

  async function start(mode) {
    state.error = null;
    const count = Number(getSettings().quizCount) || 10;
    const targets = targetsForScope();
    const all = scopedWords();
    if (!isSentence(mode)) {
      let questions = buildSimpleQuiz(mode, targets, all, count);
      // 聽力題：每題先決定口音（「多益混合」時每題隨機），重聽時用同一個口音
      if (mode === 'listen') questions = questions.map((q) => ({ ...q, accent: resolveAccent(getSettings().accent) }));
      newSession(mode, questions);
      draw();
      autoPlay();   // 聽力題第一題也要自動播放
      return;
    }
    // Part 5：需要時呼叫 Gemini 出題
    state.view = 'loading';
    state.loading = { done: 0, total: 0, waiting: 0 };
    draw();
    controller = new AbortController();
    try {
      const options = {
        fresh: !!getSettings().part5Fresh,
        signal: controller.signal,
        onProgress: (p) => { Object.assign(state.loading, p); if (state.view === 'loading') draw(); },
      };
      let result;
      if (mode === 'forms') {
        result = await prepareForms(targets, count, options);
        if (!result.questions.length && result.skipped) {
          throw new Error('目前範圍沒有內建題目的字（多益 1000 單字包）；填入 Gemini 金鑰後，自己加的字也能出詞性變化題');
        }
        if (result.skipped && result.questions.length < count) toast(`有 ${result.skipped} 個字沒有內建題目，填入 Gemini 金鑰後也能考`);
      } else {
        result = await preparePart5(pickTargets('part5', targets, count), all, options);
      }
      const { questions, failed } = result;
      if (!questions.length) throw new Error('AI 沒有成功出題，請稍後再試');
      if (failed.length) toast(`有 ${failed.length} 個字出題失敗，這次先略過`);
      newSession(mode, questions);
    } catch (err) {
      state.view = 'home';
      state.error = err.kind === 'aborted' ? null : err.message;
    } finally {
      controller = null;
      state.loading = null;
    }
    draw();
  }

  // ---------- AI 出題中 ----------
  function drawLoading() {
    const l = state.loading || { done: 0, total: 0, waiting: 0 };
    const pct = l.total ? Math.round((l.done / l.total) * 100) : 0;
    root.innerHTML = `
      <section class="page">
        <div class="empty-state loading-state">
          <p class="empty-title">${l.total ? 'AI 出題中…' : '準備題目中…'}</p>
          <p class="muted" id="loadText">${l.total ? `正在為 ${l.total} 個字出新題目（每 10 題一次請求）` : '正在準備題目'}</p>
          <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
          <p class="ai-sub" id="waitText">${l.waiting ? `為了不超過免費額度，等待 ${l.waiting} 秒…` : ''}</p>
          <button class="btn btn-ghost" type="button" id="cancel">取消</button>
        </div>
      </section>`;
    root.querySelector('#cancel').addEventListener('click', () => controller?.abort());
    unsubWait = onRateWait((sec) => {
      if (state.loading) state.loading.waiting = sec;
      const el = root.querySelector('#waitText');
      if (el) el.textContent = sec ? `為了不超過免費額度，等待 ${sec} 秒…` : '';
    });
  }

  // ---------- 作答 ----------
  function drawQuestion() {
    const s = state.session;
    const q = s.questions[s.index];
    const answered = s.answered !== null;
    const word = getWord(q.wordId);
    const info = MODE_INFO[q.mode];
    const pct = Math.round((s.index / s.questions.length) * 100);

    let prompt;
    if (q.mode === 'zh2en') {
      prompt = `<p class="q-hint">選出符合這個意思的英文單字</p>
        <div class="q-zh">${q.prompt.split('\n').map((l) => `<p>${esc(l)}</p>`).join('')}</div>`;
    } else if (q.mode === 'en2word') {
      prompt = `<p class="q-hint">選出符合這個英文解釋的單字</p><p class="q-en">${esc(q.prompt)}</p>`;
    } else if (q.mode === 'listen') {
      prompt = `<p class="q-hint">聽發音，選出正確的中文意思</p>
        <button class="listen-btn" type="button" id="play" aria-label="再聽一次">${speakerIcon}<span>${answered ? esc(q.word) : '再聽一次'}</span></button>`;
    } else {
      const answer = q.options[q.answerIndex];
      const filled = answered
        ? esc(q.prompt).replace(BLANK, `<mark class="blank filled">${esc(answer)}</mark>`)
        : esc(q.prompt).replace(BLANK, '<span class="blank">_______</span>');
      prompt = `<p class="q-hint">選出最適合填入空格的答案</p><p class="q-sentence">${filled}</p>`;
    }

    const options = q.options.map((opt, i) => {
      let cls = '';
      if (answered) {
        if (i === q.answerIndex) cls = 'is-correct';
        else if (i === s.answered) cls = 'is-wrong';
      }
      const label = isSentence(q.mode) ? `(${LETTERS[i]})` : String(i + 1);
      return `<button class="option ${cls} ${q.mode === 'listen' ? 'option-zh' : 'option-en'}" type="button" data-i="${i}" ${answered ? 'disabled' : ''}>
        <span class="option-key">${label}</span><span class="option-text">${esc(opt)}</span></button>`;
    }).join('');

    let feedback = '';
    if (answered) {
      const ok = s.answered === q.answerIndex;
      let detail = '';
      if (isSentence(q.mode)) {
        detail = `${q.extra?.translation ? `<p class="fb-trans">${esc(q.extra.translation)}</p>` : ''}
           ${q.extra?.explanation ? `<p class="fb-explain">💡 ${esc(q.extra.explanation)}</p>` : ''}
           ${canSpeak() ? `<button class="btn btn-ghost btn-sm fb-read" type="button" id="readSentence">${speakerIcon} 朗讀整句</button>` : ''}`;
      } else if (q.mode === 'listen' && q.accent) {
        detail = `<p class="fb-explain">這題是<strong>${esc(accentLabel(q.accent))}</strong>口音</p>`;
      }
      feedback = `
        <div class="feedback ${ok ? 'ok' : 'bad'}" role="status">
          <p class="fb-head">${ok ? '✓ 答對了！' : `✗ 答錯了，正確答案是「${esc(q.options[q.answerIndex])}」`}</p>
          ${word ? `<p class="fb-word">
            <strong>${esc(word.word)}</strong>${word.phonetic ? ` <span class="fb-ipa">${esc(word.phonetic)}</span>` : ''}
            ${canSpeak() ? `<button class="icon-btn" type="button" id="fbSpeak" aria-label="播放發音">${speakerIcon}</button>` : ''}
            <span class="fb-zh">${esc(firstMeaning(word.zh))}</span></p>` : ''}
          ${detail}
          ${!ok ? '<p class="fb-note">已標記為「不熟」，並加入錯題本</p>' : ''}
          ${ok && q.fromMistakes ? '<p class="fb-note">已從錯題本移除</p>' : ''}
        </div>
        <button class="btn btn-primary next-btn" type="button" id="next">${s.index + 1 < s.questions.length ? '下一題 →' : '看結果'}</button>`;
    }

    root.innerHTML = `
      <section class="page page-quiz">
        <div class="quiz-head">
          <span class="quiz-mode">${esc(info.title)}${s.fromMistakes ? '・錯題重做' : ''}</span>
          <span class="quiz-progress"><strong>${s.index + 1}</strong> / ${s.questions.length}</span>
          <button class="btn btn-ghost btn-sm" type="button" id="quit">結束</button>
        </div>
        <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
        <div class="question q-${q.mode}">${prompt}</div>
        <div class="options ${isSentence(q.mode) ? 'options-part5' : ''}">${options}</div>
        ${feedback}
        <p class="kbd-hint">鍵盤：${isSentence(q.mode) ? 'A–D' : '1–4'} 作答　Enter 下一題${q.mode === 'listen' ? '　P 再聽一次' : ''}</p>
      </section>`;

    root.querySelectorAll('.option').forEach((b) => b.addEventListener('click', () => choose(Number(b.dataset.i))));
    root.querySelector('#play')?.addEventListener('click', () => speak(q.word, { accent: q.accent }));
    root.querySelector('#readSentence')?.addEventListener('click', () =>
      speak(q.prompt.replace(BLANK, q.options[q.answerIndex])));
    root.querySelector('#fbSpeak')?.addEventListener('click', () => speak(word.word));
    root.querySelector('#next')?.addEventListener('click', next);
    root.querySelector('#quit').addEventListener('click', () => {
      if (s.results.length) { state.view = 'result'; } else { state.view = 'home'; state.session = null; }
      draw();
    });
    if (answered) root.querySelector('#next')?.focus();
  }

  function choose(i) {
    const s = state.session;
    if (!s || s.answered !== null) return;
    const q = s.questions[s.index];
    const correct = i === q.answerIndex;
    s.answered = i;
    s.results.push({ q, chosen: i, correct });
    recordQuiz(correct);
    if (!correct) {
      addMistake(q, i);
      if (getWord(q.wordId)) updateWord(q.wordId, { unfamiliar: true });
    } else if (q.fromMistakes) {
      removeMistake(q.fromMistakes);
    }
    drawQuestion();
  }

  function next() {
    const s = state.session;
    if (!s || s.answered === null) return;
    s.index += 1;
    s.answered = null;
    if (s.index >= s.questions.length) state.view = 'result';
    draw();
    autoPlay();
  }

  function autoPlay() {
    const s = state.session;
    if (state.view !== 'question' || !s) return;
    const q = s.questions[s.index];
    if (q.mode === 'listen' && s.answered === null) speak(q.word, { accent: q.accent });
  }

  // ---------- 結果 ----------
  function drawResult() {
    const s = state.session;
    const total = s.results.length;
    const right = s.results.filter((r) => r.correct).length;
    const pct = total ? Math.round((right / total) * 100) : 0;
    const wrong = s.results.filter((r) => !r.correct);
    const msg = pct === 100 ? '全對！太厲害了 🎉' : pct >= 80 ? '很不錯！' : pct >= 60 ? '繼續加油！' : '多複習幾次，下次會更好';
    root.innerHTML = `
      <section class="page">
        <div class="empty-state result-state">
          <p class="score"><strong>${right}</strong> / ${total}</p>
          <p class="empty-title">${esc(msg)}</p>
          <p class="muted">${esc(modeTitle(s.mode))}・正確率 ${pct}%</p>
          <div class="done-actions">
            ${wrong.length ? `<button class="btn btn-primary" type="button" id="redoWrong">重做錯的 ${wrong.length} 題</button>` : ''}
            ${s.fromMistakes ? '' : '<button class="btn btn-outline" type="button" id="again">再測一次</button>'}
            <button class="btn btn-ghost" type="button" id="home">回測驗首頁</button>
          </div>
        </div>
        <ul class="result-list">
          ${s.results.map((r) => `
            <li class="result-row ${r.correct ? 'ok' : 'bad'}">
              <span class="result-mark" aria-label="${r.correct ? '答對' : '答錯'}">${r.correct ? '✓' : '✗'}</span>
              <span class="result-word">${esc(r.q.word)}</span>
              <span class="result-detail">${r.correct ? esc(r.q.options[r.q.answerIndex])
                : `你選「${esc(r.q.options[r.chosen])}」・正確「${esc(r.q.options[r.q.answerIndex])}」`}</span>
            </li>`).join('')}
        </ul>
      </section>`;
    root.querySelector('#redoWrong')?.addEventListener('click', () => {
      // 重做時答對，也會從錯題本移除
      const redo = wrong.map((r) => ({ ...reshuffle(r.q), fromMistakes: mistakeKey(r.q) }));
      newSession(s.mode, redo, { fromMistakes: true });
      draw();
      autoPlay();
    });
    root.querySelector('#again')?.addEventListener('click', () => start(s.mode));
    root.querySelector('#home').addEventListener('click', () => { state.view = 'home'; state.session = null; draw(); });
  }

  // ---------- 錯題本 ----------
  function drawMistakes() {
    const existing = new Set(scopedWords().map((w) => w.id));
    const list = getMistakes().filter((m) => existing.has(m.question.wordId));
    root.innerHTML = `
      <section class="page">
        <div class="quiz-head">
          <button class="btn btn-ghost btn-sm" type="button" id="back">‹ 測驗</button>
          <h1 class="page-title inline">錯題本</h1>
        </div>
        ${list.length ? `
          <div class="mistake-actions">
            <button class="btn btn-primary" type="button" id="redoAll">重做全部 ${list.length} 題</button>
            <button class="btn btn-ghost danger" type="button" id="clearAll">清空目前範圍的錯題</button>
          </div>
          <p class="hint-text">重做時答對的題目會自動從錯題本移除。</p>
          <ul class="mistake-list">
            ${list.map((m) => {
              const q = m.question;
              const promptText = q.mode === 'listen' ? `🔊 ${q.word}` : q.prompt;
              return `
              <li class="mistake-row" data-key="${esc(m.key)}">
                <div class="mistake-main">
                  <p class="mistake-meta"><span class="chip">${esc(MODE_INFO[q.mode].title)}</span>${m.count > 1 ? `<span class="mistake-times">錯 ${m.count} 次</span>` : ''}</p>
                  <p class="mistake-prompt">${esc(promptText)}</p>
                  <p class="mistake-ans">你選「<span class="bad">${esc(q.options[m.chosen] ?? '')}</span>」・正確「<span class="good">${esc(q.options[q.answerIndex])}</span>」</p>
                </div>
                <button class="btn btn-ghost btn-sm" type="button" data-act="remove" aria-label="從錯題本移除">移除</button>
              </li>`;
            }).join('')}
          </ul>` : '<div class="empty-state"><p class="empty-title">沒有錯題</p><p>測驗答錯的題目會自動收進這裡。</p></div>'}
      </section>`;
    root.querySelector('#back').addEventListener('click', () => { state.view = 'home'; draw(); });
    root.querySelector('#redoAll')?.addEventListener('click', () => {
      const questions = shuffle(list).map((m) => ({ ...reshuffle(m.question), fromMistakes: m.key }));
      newSession('mixed', questions, { fromMistakes: true });
      draw();
      autoPlay();
    });
    root.querySelector('#clearAll')?.addEventListener('click', () => {
      if (confirmAction('確定要清空目前範圍的錯題嗎？')) { for (const m of list) removeMistake(m.key); draw(); }
    });
    root.querySelectorAll('[data-act="remove"]').forEach((b) => b.addEventListener('click', () => {
      removeMistake(b.closest('.mistake-row').dataset.key);
      draw();
    }));
  }

  function onKey(e) {
    if (document.querySelector('dialog[open]')) return;
    if (e.target.matches('input, textarea, select')) return;
    const s = state.session;
    if (state.view !== 'question' || !s) return;
    const q = s.questions[s.index];
    const k = e.key.toLowerCase();
    if (s.answered === null) {
      const idx = isSentence(q.mode) ? 'abcd'.indexOf(k) : '1234'.indexOf(k);
      if (idx >= 0 && e.key.length === 1) { e.preventDefault(); choose(idx); return; }
    } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
      e.preventDefault();
      next();
      return;
    }
    if (k === 'p' && q.mode === 'listen') speak(q.word, { accent: q.accent });
  }

  draw();
  autoPlay();
  const unsub = subscribe(() => { if (state.view === 'home' || state.view === 'mistakes') draw(); });
  document.addEventListener('keydown', onKey);
  return () => { unsub(); unsubWait?.(); document.removeEventListener('keydown', onKey); };
}
