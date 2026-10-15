// 自由翻卡只讀目前範圍；不呼叫 SRS 評分或每日紀錄。
import { scopedWords, activeSetId, getSettings, updateSettings, toggleUnfamiliar, subscribe } from '../store.js';
import { flashcardHTML, handleCardTap, modeToggleHTML } from '../cardview.js?v=lookup-mode-1';
import { createCardLookupMode } from '../card-lookup-mode.js';
import { setScopeHTML, bindSetScope } from '../set-ui.js';
import { speak } from '../speech.js';
import { shuffle } from '../quiz.js';
import { attachSwipe } from '../swipe.js?v=swipe-isolation-1';
import { onLookupStatus } from '../dictionary.js';
import { onGenerateStatus } from '../generate.js';

export function renderFreeCards(root) {
  let currentId = null, flipped = false, filter = 'all', random = false;
  let order = [], scope = activeSetId(), detachSwipe, disposed = false;
  const lookupMode = createCardLookupMode();
  function deck() {
    const words = scopedWords().filter(w => filter !== 'unfamiliar' || w.unfamiliar);
    if (scope !== activeSetId()) { scope = activeSetId(); order = random ? shuffle(words.map(w => w.id)) : []; currentId = null; }
    const ids = new Set(words.map(w => w.id));
    order = random ? [...order.filter(id => ids.has(id)), ...words.filter(w => !order.includes(w.id)).map(w => w.id)] : words.map(w => w.id);
    const byId = new Map(words.map(w => [w.id, w]));
    return order.map(id => byId.get(id));
  }
  function flip() { flipped = !flipped; root.querySelector('#card')?.classList.toggle('is-flipped', flipped); }
  function go(step) {
    if (disposed) return;
    const words = deck();
    if (words.length < 2) return;
    const at = Math.max(0, words.findIndex(w => w.id === currentId));
    currentId = words[(at + step + words.length) % words.length].id;
    lookupMode.reset();
    flipped = false; draw();
  }
  function draw() {
    if (disposed) return;
    const focus = root.contains(document.activeElement) ? document.activeElement.id : '';
    detachSwipe?.();
    const words = deck();
    const w = words.find(w => w.id === currentId) || words[0];
    if (currentId !== w?.id) flipped = false;
    currentId = w?.id || null;
    lookupMode.prepare(JSON.stringify([activeSetId(), currentId, getSettings().cardMode]));
    root.innerHTML = `<section class="page page-free-cards">
      <h1 class="page-title">自由翻卡</h1><p class="hint-text">依自己的節奏看所有字卡，不受到期日或每日新字數限制，也不更動複習排程與打卡紀錄。</p>
      <div class="free-toolbar">${setScopeHTML()}
        <label class="check-row"><input id="freeUnfamiliar" type="checkbox" ${filter === 'unfamiliar' ? 'checked' : ''}>只看不熟</label>
        <button class="btn btn-outline btn-sm" id="freeShuffle" type="button" aria-pressed="${random}">${random ? '改回原順序' : '隨機排序'}</button>
      </div>
      ${w ? `<div class="card-toolbar">${modeToggleHTML(getSettings().cardMode)}<p id="freePosition" role="status">${words.findIndex(word => word.id === w.id) + 1} / ${words.length}</p></div>
        ${lookupMode.html()}
        <div id="freeSwipe">${flashcardHTML(w, { flipped, mode: getSettings().cardMode, corner: '自由翻卡', hint: '點一下翻面・左右滑動換字', lookupEnabled: lookupMode.enabled, lookupOnly: lookupMode.lookupOnly })}</div>
        <div class="free-actions"><button class="btn btn-outline" id="freePrev" type="button" ${words.length < 2 ? 'disabled' : ''}>← 上一張</button>
        <button class="btn btn-ghost" id="freeMark" type="button" aria-pressed="${w.unfamiliar}">${w.unfamiliar ? '★ 已標記不熟' : '☆ 標記不熟'}</button>
        <button class="btn btn-outline" id="freeNext" type="button" ${words.length < 2 ? 'disabled' : ''}>下一張 →</button></div>
        <p class="swipe-tip hint-text">從卡片中央左右滑動；螢幕邊緣保留給上一頁／下一頁。</p>
        <p class="kbd-hint">空白鍵翻面・←／→ 換字・P 發音。星星只修改不熟標記。</p>`
      : `<div class="empty-state"><h2 class="empty-title">${filter === 'unfamiliar' && scopedWords().length ? '沒有標記為不熟的字' : '目前單字集還沒有字卡'}</h2><p>可切換單字集、取消篩選，或先到單字庫加入單字。</p><a class="btn btn-primary" href="#/words">前往單字庫</a></div>`}
      <p class="free-links"><a href="#/review">今日複習</a><a href="#/cards">探索單字</a></p>
    </section>`;
    bindSetScope(root);
    root.querySelector('#freeUnfamiliar').addEventListener('change', e => { filter = e.target.checked ? 'unfamiliar' : 'all'; flipped = false; draw(); });
    root.querySelector('#freeShuffle').addEventListener('click', () => {
      random = !random;
      order = random ? shuffle(deck().map(w => w.id)) : [];
      currentId = order[0] || null; flipped = false; draw();
    });
    if (w) {
      root.querySelector('#cardLookupToggle')?.addEventListener('click', () => {
        lookupMode.toggle();
        if (lookupMode.enabled) flipped = true;
        draw();
        root.querySelector('#cardLookupToggle').focus({ preventScroll: true });
      });
      for (const radio of root.querySelectorAll('[name=mode]')) radio.addEventListener('change', () => updateSettings({ cardMode: radio.value }));
      const tap = target => handleCardTap(target, w, flip);
      root.querySelector('#card').addEventListener('click', e => { e.stopPropagation(); tap(e.target); });
      detachSwipe = attachSwipe(root.querySelector('#freeSwipe'), { onTap: tap, onSwipe: dir => go(dir === 'left' ? 1 : -1) });
      root.querySelector('#freePrev').addEventListener('click', () => go(-1));
      root.querySelector('#freeNext').addEventListener('click', () => go(1));
      root.querySelector('#freeMark').addEventListener('click', () => toggleUnfamiliar(w.id));
    }
    if (focus) root.querySelector(`#${focus}`)?.focus({ preventScroll: true });
  }
  function onKey(e) {
    if (document.querySelector('dialog[open]') || e.target.closest('input, textarea, select, [contenteditable=true]') || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); go(e.key === 'ArrowRight' ? 1 : -1); }
    else if ((e.key === ' ' || e.key === 'Enter') && !e.target.closest('button, a')) { e.preventDefault(); if (currentId) flip(); }
    else if (e.key.toLowerCase() === 'p') { const w = deck().find(w => w.id === currentId); if (w) speak(w.word); }
  }
  draw();
  const unsubs = [subscribe(draw), onLookupStatus(draw), onGenerateStatus(draw)];
  document.addEventListener('keydown', onKey);
  return () => { disposed = true; detachSwipe?.(); unsubs.forEach(fn => fn()); document.removeEventListener('keydown', onKey); };
}
