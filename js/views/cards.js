// 字卡（瀏覽）頁：自由翻看全部或「不熟」的字；不影響複習排程
// 手機上左右滑動換卡（往左滑＝下一張，往右滑＝上一張）
import { getWords, getSettings, updateSettings, toggleUnfamiliar, subscribe } from '../store.js';
import { openEditor } from '../ui.js';
import { speak } from '../speech.js';
import { onLookupStatus } from '../dictionary.js';
import { onGenerateStatus } from '../generate.js';
import { flashcardHTML, modeToggleHTML } from '../cardview.js';
import { attachSwipe } from '../swipe.js';

// 跨頁面保留目前看到哪一張
const state = { currentId: null, flipped: false };

function deck() {
  const { cardFilter } = getSettings();
  const all = getWords();
  return cardFilter === 'unfamiliar' ? all.filter((w) => w.unfamiliar) : all;
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
        ${modeToggleHTML(cardMode)}
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
          <div class="swipe-wrap" id="swipe">
            ${flashcardHTML(w, { flipped: state.flipped, mode: cardMode, corner: `${idx + 1} / ${list.length}` })}
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
    // 滑鼠／觸控的點擊由 attachSwipe 的 onTap 處理；這裡處理鍵盤觸發的 click
    const tap = (target) => {
      if (target.closest('[data-speak]')) speak(w.word);
      else flip();
    };
    card.addEventListener('click', (e) => { e.stopPropagation(); tap(e.target); });
    attachSwipe(root.querySelector('#swipe'), {
      onTap: tap,
      onSwipe: (dir) => go(dir === 'left' ? 1 : -1),
      threshold: list.length > 1 ? 90 : Infinity,   // 只有一張時不能滑
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
