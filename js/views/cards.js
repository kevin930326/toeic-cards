// 單字探索：直接閱讀收藏內容；不評分、不更新複習排程或每日學習量。
import { getSettings, updateSettings, toggleUnfamiliar, subscribe, scopedWords, activeSetId } from '../store.js';
import { esc, openEditor, zhLines } from '../ui.js';
import { speak, canSpeak, speakerIcon } from '../speech.js';
import { onLookupStatus } from '../dictionary.js?v=custom-words-1';
import { onGenerateStatus } from '../generate.js?v=custom-words-1';
import { backHTML } from '../cardview.js?v=custom-words-1';
import { setScopeHTML, bindSetScope, refreshSetScope } from '../set-ui.js';
import { exploreWords, selectedExploreWord, stepExploreWord } from '../explore.js';

const state = { currentId: null, query: '' };

export function renderCards(root) {
  root.innerHTML = `<section class="page page-explore">
    <header class="explore-heading"><div><p class="eyebrow">READ & DISCOVER</p><h1 class="page-title">單字探索</h1>
      <p class="hint-text">自由看懂每個字。想練習回想，再到今日複習。</p></div><a class="btn btn-outline btn-sm" href="#/review">今日複習 →</a></header>
    <div class="explore-toolbar">${setScopeHTML()}
      <div class="segmented" role="radiogroup" aria-label="探索範圍">
        <label class="seg"><input type="radio" name="filter" value="all"><span>全部</span></label>
        <label class="seg"><input type="radio" name="filter" value="unfamiliar"><span>只看不熟</span></label>
      </div></div>
    <div class="explore-layout"><aside class="explore-index" aria-label="收藏單字清單">
      <label class="field"><span class="sr-only">搜尋探索中的收藏</span><input type="search" id="exploreSearch" placeholder="搜尋收藏的英文或中文" value="${esc(state.query)}" autocomplete="off"></label>
      <p id="exploreCount" class="hint-text" role="status"></p><ul id="exploreList" class="explore-list"></ul>
    </aside><article class="explore-detail panel" id="exploreDetail" aria-label="單字內容"></article></div>
    <p class="hint-text explore-footnote">英文解釋與例句可點字查意思、加入單字集。這裡的瀏覽與不熟標記不更動複習排程，也不計入每日學習量。</p>
  </section>`;
  const listEl = root.querySelector('#exploreList');
  const detail = root.querySelector('#exploreDetail');
  const search = root.querySelector('#exploreSearch');
  let detailKey = '';
  let listKey = '';

  function deck() { return exploreWords(scopedWords(), { query: state.query, filter: getSettings().cardFilter }); }
  function draw() {
    const focusId = root.contains(document.activeElement) ? document.activeElement.id : '';
    refreshSetScope(root);
    const filter = getSettings().cardFilter;
    for (const radio of root.querySelectorAll('input[name="filter"]')) radio.checked = radio.value === filter;
    const list = deck();
    const word = selectedExploreWord(list, state.currentId);
    state.currentId = word?.id || null;
    root.querySelector('#exploreCount').textContent = `${list.length} / ${scopedWords().length} 個收藏`;
    const nextListKey = JSON.stringify([state.currentId, list.map((w) => [w.id, w.word, w.zh, w.unfamiliar])]);
    if (listKey !== nextListKey) {
      listKey = nextListKey;
      const scroll = listEl.scrollTop;
      listEl.innerHTML = list.map((w) => `<li><button class="explore-item" type="button" data-id="${esc(w.id)}" ${w.id === state.currentId ? 'aria-current="true"' : ''}>
      <span lang="en">${esc(w.word)}${w.unfamiliar ? '<small aria-label="不熟">★</small>' : ''}</span>
      <span class="explore-item-meaning">${esc(zhLines(w.zh)[0]?.text || '尚無中文')}</span></button></li>`).join('');
      listEl.scrollTop = scroll;
    }
    const index = list.findIndex((w) => w.id === state.currentId);
    const nextKey = JSON.stringify([word, index, list.length, activeSetId(), state.query, filter]);
    if (detailKey !== nextKey) {
      detailKey = nextKey;
      if (word) {
        detail.innerHTML = `<div class="explore-entry-head"><div><p class="eyebrow">${index + 1} / ${list.length} · ${word.pack ? '內建內容' : '我的收藏'}</p>
          <h2 id="exploreWord" lang="en" tabindex="-1">${esc(word.word)}</h2>${word.phonetic ? `<p class="phonetic">${esc(word.phonetic)}</p>` : ''}</div>
          ${canSpeak() ? `<button class="icon-btn" type="button" data-speak aria-label="播放 ${esc(word.word)} 的發音">${speakerIcon}</button>` : ''}</div>
          <div class="explore-actions"><div class="explore-pager"><button class="btn btn-ghost btn-sm" id="prev" type="button" ${list.length < 2 ? 'disabled' : ''}>← 上一字</button>
          <button class="btn btn-ghost btn-sm" id="next" type="button" ${list.length < 2 ? 'disabled' : ''}>下一字 →</button></div>
          <button class="btn btn-ghost btn-sm" id="markBtn" type="button" aria-pressed="${word.unfamiliar}">${word.unfamiliar ? '★ 已標記不熟' : '☆ 標記不熟'}</button>
          <button class="btn btn-ghost btn-sm" id="editBtn" type="button">編輯內容</button></div>
          <div class="explore-reading">${backHTML(word, 'both')}</div>`;
      } else {
        detail.innerHTML = `<div class="empty-state"><h2 class="empty-title">${state.query.trim() ? '找不到符合的收藏' : scopedWords().length ? '沒有標記為「不熟」的字' : activeSetId() ? '這個單字集還沒有字卡' : '還沒有收藏的單字'}</h2>
          <p>${state.query.trim() ? '搜尋只包含目前範圍內的收藏；也能用上方「查單字」查字典。' : '可切換單字集或範圍，也能到單字庫加入想學的字。'}</p>
          ${state.query.trim() ? '<button class="btn btn-outline" id="clearExploreSearch" type="button">清除搜尋</button>' : '<a class="btn btn-primary" href="#/words">前往單字庫</a>'}</div>`;
      }
    }
    if (focusId && focusId !== 'exploreSearch') root.querySelector(`#${focusId}`)?.focus({ preventScroll: true });
  }

  function focusEntry() {
    root.querySelector('#exploreWord')?.focus({ preventScroll: true });
    if (window.matchMedia('(max-width: 700px)').matches) detail.scrollIntoView({ block: 'start' });
  }
  function go(step) {
    const word = stepExploreWord(deck(), state.currentId, step);
    if (!word) return;
    state.currentId = word.id;
    draw(); focusEntry();
    if (window.matchMedia('(min-width: 701px)').matches) listEl.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }
  bindSetScope(root);
  for (const radio of root.querySelectorAll('input[name="filter"]')) radio.addEventListener('change', () => updateSettings({ cardFilter: radio.value }));
  search.addEventListener('input', () => { state.query = search.value; draw(); });
  listEl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-id]');
    if (!button) return;
    state.currentId = button.dataset.id;
    draw(); focusEntry();
  });
  detail.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const word = selectedExploreWord(deck(), state.currentId);
    if (button.id === 'clearExploreSearch') { state.query = search.value = ''; draw(); search.focus(); }
    else if (!word) return;
    else if (button.id === 'prev') go(-1);
    else if (button.id === 'next') go(1);
    else if (button.id === 'markBtn') toggleUnfamiliar(word.id);
    else if (button.id === 'editBtn') openEditor(word.id);
    else if (button.hasAttribute('data-speak')) speak(word.word);
    else if (button.dataset.speakText) speak(button.dataset.speakText);
  });
  function onKey(event) {
    if (document.querySelector('dialog[open]') || event.target.closest('input, textarea, select, [contenteditable="true"]') || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); go(event.key === 'ArrowRight' ? 1 : -1); }
    else if (event.key.toLowerCase() === 'p') { const word = selectedExploreWord(deck(), state.currentId); if (word) speak(word.word); }
  }
  draw();
  const unsub = subscribe(draw);
  const unsubLookup = onLookupStatus(draw);
  const unsubGen = onGenerateStatus(draw);
  document.addEventListener('keydown', onKey);
  return () => { unsub(); unsubLookup(); unsubGen(); document.removeEventListener('keydown', onKey); };
}
