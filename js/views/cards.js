// 字卡頁：一次顯示一張卡，點一下翻面
import { getWords, getSettings, updateSettings, toggleUnfamiliar, subscribe } from '../store.js';
import { esc, openEditor, zhLines } from '../ui.js';
import { speak, canSpeak, speakerIcon } from '../speech.js';
import { onLookupStatus, isLookingUp } from '../dictionary.js';
import { isGenerating, onGenerateStatus } from '../generate.js';

// 跨頁面保留目前看到哪一張
const state = { currentId: null, flipped: false };

function deck() {
  const { cardFilter } = getSettings();
  const all = getWords();
  return cardFilter === 'unfamiliar' ? all.filter((w) => w.unfamiliar) : all;
}

function backHTML(w, mode) {
  const empty = isLookingUp(w.id) || isGenerating(w.id)
    ? `<p class="back-empty">${isGenerating(w.id) ? 'AI 生成中…' : '查字典中…'}</p>`
    : '<p class="back-empty">還沒有資料<br><span>點下方「編輯」手動填寫</span></p>';
  let main;
  if (mode === 'zh') {
    const lines = zhLines(w.zh);
    const inlinePos = lines.some((l) => l.pos);
    main = lines.length
      ? `${!inlinePos && w.pos ? `<p class="back-pos">${esc(w.pos)}</p>` : ''}
         <div class="back-zh ${lines.length > 1 ? 'multi' : ''}">${lines.map((l) => `
           <p>${l.pos ? `<span class="zh-pos">${esc(l.pos)}</span>` : ''}${esc(l.text)}</p>`).join('')}</div>`
      : empty;
  } else {
    main = w.en
      ? `${w.pos ? `<p class="back-pos">${esc(w.pos)}</p>` : ''}<p class="back-en">${esc(w.en)}</p>`
      : empty;
  }
  const extras = [];
  if (w.examples.length) {
    extras.push(`<div class="extra"><h3>例句</h3>${w.examples.map((e) => `
      <p class="ex-en">${esc(e.en)}</p>${e.zh ? `<p class="ex-zh">${esc(e.zh)}</p>` : ''}`).join('')}</div>`);
  }
  if (w.collocations.length) {
    extras.push(`<div class="extra"><h3>常見搭配</h3><p class="chips">${w.collocations.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</p></div>`);
  }
  if (w.forms.length || w.synonyms.length) {
    extras.push(`<div class="extra">
      ${w.forms.length ? `<h3>詞性變化</h3><p class="chips">${w.forms.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</p>` : ''}
      ${w.synonyms.length ? `<h3>同義詞</h3><p class="chips">${w.synonyms.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</p>` : ''}
    </div>`);
  }
  return `<div class="back-main">${main}</div>${extras.length ? `<div class="extras">${extras.join('')}</div>` : ''}`;
}

export function renderCards(root) {
  function draw() {
    const { cardMode, cardFilter } = getSettings();
    const list = deck();
    const total = getWords().length;
    const unfamiliarCount = getWords().filter((w) => w.unfamiliar).length;

    let idx = list.findIndex((w) => w.id === state.currentId);
    if (idx === -1) { idx = 0; state.flipped = false; }
    const w = list[idx];
    state.currentId = w ? w.id : null;

    const toolbar = `
      <div class="card-toolbar">
        <div class="segmented" role="radiogroup" aria-label="背面顯示">
          <label class="seg"><input type="radio" name="mode" value="zh" ${cardMode === 'zh' ? 'checked' : ''}><span>中文</span></label>
          <label class="seg"><input type="radio" name="mode" value="en" ${cardMode === 'en' ? 'checked' : ''}><span>English</span></label>
        </div>
        <div class="segmented" role="radiogroup" aria-label="範圍">
          <label class="seg"><input type="radio" name="filter" value="all" ${cardFilter === 'all' ? 'checked' : ''}><span>全部 ${total}</span></label>
          <label class="seg"><input type="radio" name="filter" value="unfamiliar" ${cardFilter === 'unfamiliar' ? 'checked' : ''}><span>不熟 ${unfamiliarCount}</span></label>
        </div>
      </div>`;

    if (!w) {
      root.innerHTML = `<section class="page">${toolbar}
        <div class="empty-state">
          ${total === 0
            ? `<p class="empty-title">還沒有任何字卡</p><p>到「單字庫」輸入第一個英文單字吧。</p><a class="btn btn-primary" href="#/words">新增單字</a>`
            : `<p class="empty-title">沒有標記為「不熟」的字</p><p>很棒！切回「全部」繼續複習。</p>`}
        </div></section>`;
      bindToolbar();
      return;
    }

    root.innerHTML = `
      <section class="page page-cards">
        ${toolbar}
        <div class="card-stage">
          <div class="flashcard ${state.flipped ? 'is-flipped' : ''} ${w.unfamiliar ? 'is-unfamiliar' : ''}" id="card"
            role="button" tabindex="0" aria-label="${esc(w.word)}，按一下翻面">
            <div class="card-face card-front">
              <span class="card-corner">${idx + 1} / ${list.length}</span>
              ${w.unfamiliar ? '<span class="stamp">不熟</span>' : ''}
              <p class="headword">${esc(w.word)}</p>
              ${w.phonetic ? `<p class="phonetic">${esc(w.phonetic)}</p>` : ''}
              ${canSpeak() ? `<button class="icon-btn speak-btn" type="button" data-speak aria-label="播放 ${esc(w.word)} 的發音" title="發音">${speakerIcon}</button>` : ''}
              <p class="hint">點一下翻面</p>
            </div>
            <div class="card-face card-back">
              <span class="card-corner">${esc(w.word)}</span>
              ${backHTML(w, cardMode)}
            </div>
          </div>
        </div>
        <div class="card-controls">
          <button class="icon-btn big" id="prev" type="button" aria-label="上一張" ${list.length < 2 ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="btn ${w.unfamiliar ? 'btn-warn' : 'btn-outline'}" id="markBtn" type="button" aria-pressed="${w.unfamiliar}">
            ${w.unfamiliar ? '★ 已標記不熟' : '☆ 標記不熟'}
          </button>
          <button class="btn btn-ghost" id="editBtn" type="button">編輯</button>
          <button class="icon-btn big" id="next" type="button" aria-label="下一張" ${list.length < 2 ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
        <p class="kbd-hint">鍵盤：空白鍵翻面　← → 換卡　P 發音</p>
      </section>`;

    bindToolbar();
    const card = root.querySelector('#card');
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-speak]')) { e.stopPropagation(); speak(w.word); return; }
      flip();
    });
    root.querySelector('#prev').addEventListener('click', () => go(-1));
    root.querySelector('#next').addEventListener('click', () => go(1));
    root.querySelector('#markBtn').addEventListener('click', () => toggleUnfamiliar(w.id));
    root.querySelector('#editBtn').addEventListener('click', () => openEditor(w.id));
  }

  function bindToolbar() {
    root.querySelectorAll('input[name="mode"]').forEach((i) =>
      i.addEventListener('change', () => updateSettings({ cardMode: i.value })));
    root.querySelectorAll('input[name="filter"]').forEach((i) =>
      i.addEventListener('change', () => { state.flipped = false; updateSettings({ cardFilter: i.value }); }));
  }

  function flip() {
    state.flipped = !state.flipped;
    root.querySelector('#card')?.classList.toggle('is-flipped', state.flipped);
  }

  function go(step) {
    const list = deck();
    if (list.length < 2) return;
    const idx = list.findIndex((w) => w.id === state.currentId);
    const next = list[(idx + step + list.length) % list.length];
    state.currentId = next.id;
    state.flipped = false;
    draw();
  }

  function onKey(e) {
    if (document.querySelector('dialog[open]')) return;
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === ' ' || e.key === 'Enter') {
      // 焦點在按鈕上時讓按鈕自己處理，避免重複觸發
      if (e.target.closest('button, a')) return;
      e.preventDefault();
      flip();
    }
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'p' || e.key === 'P') { const w = deck().find((x) => x.id === state.currentId); if (w) speak(w.word); }
  }

  draw();
  const unsub = subscribe(draw);
  const unsubLookup = onLookupStatus(draw);
  let genKey = '';
  const unsubGen = onGenerateStatus((st) => {
    const k = `${st.running}|${st.done}|${st.failed}`;
    if (k !== genKey) { genKey = k; draw(); }
  });
  document.addEventListener('keydown', onKey);
  return () => { unsub(); unsubLookup(); unsubGen(); document.removeEventListener('keydown', onKey); };
}
