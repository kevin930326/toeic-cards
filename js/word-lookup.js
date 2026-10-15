// 全站查字典：不切換頁面、不使用 Gemini，也不影響學習紀錄。
import { getWords, addWords, assignWordSet, activeSetId, subscribe } from './store.js';
import { normalizeWord } from './parse.js';
import { lookupLocalResult, lookupEnglish } from './dictionary.js?v=dictionary-scale-1';
import { esc, toast, zhLines } from './ui.js';
import { setOptions } from './set-ui.js?v=dictionary-scale-1';
import { speak, canSpeak, speakerIcon } from './speech.js';
import { lookupSuggestions } from './dictionary-suggestions.js';

export function initWordLookup() {
  const dialog = document.createElement('dialog');
  dialog.id = 'lookupDialog';
  dialog.className = 'dialog lookup-dialog';
  dialog.setAttribute('aria-labelledby', 'lookupTitle');
  dialog.innerHTML = `<div class="tool-heading"><div><p class="eyebrow">隨手查，不中斷學習</p><h2 id="lookupTitle">查單字</h2></div>
    <button class="icon-btn" type="button" data-close aria-label="關閉查單字">✕</button></div>
    <form id="lookupForm" class="lookup-form"><label class="field grow"><span class="sr-only">想查的英文單字</span>
      <input id="lookupInput" type="search" maxlength="80" placeholder="輸入英文單字，例如 invoice" autocomplete="off" spellcheck="false" autocapitalize="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="lookupSuggestions" required></label>
      <button class="btn btn-primary" type="submit">查詢</button></form>
    <ul id="lookupSuggestions" class="lookup-suggestions" role="listbox" aria-label="候選單字" hidden></ul>
    <p id="lookupSuggestionStatus" class="hint-text" role="status" hidden></p>
    <div id="lookupResult" aria-live="polite"><p class="tool-empty">知道怎麼拼，卻想不起意思？<br><span>查中文、聽發音，也能順手收藏。</span></p></div>`;
  document.body.append(dialog);
  const result = dialog.querySelector('#lookupResult');
  const input = dialog.querySelector('#lookupInput');
  const suggestions = dialog.querySelector('#lookupSuggestions');
  const suggestionStatus = dialog.querySelector('#lookupSuggestionStatus');
  let suggestionSequence = 0;
  let suggestionTimer;
  let candidates = [];
  let activeCandidate = -1;
  let composing = false;
  let sequence = 0;
  let controller;
  let current = null;
  let viewingCard = false;
  let manual = { pos: '', zh: '', en: '' };
  let returnTrigger = null;
  const saved = (word) => getWords().find((w) => w.word === word);
  function clearSuggestions() {
    suggestionSequence++;
    clearTimeout(suggestionTimer);
    candidates = []; activeCandidate = -1;
    suggestions.hidden = true; suggestions.replaceChildren();
    suggestionStatus.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }
  function highlightCandidate(index) {
    activeCandidate = index;
    for (const [i, option] of [...suggestions.children].entries()) option.setAttribute('aria-selected', String(i === index));
    if (index < 0) input.removeAttribute('aria-activedescendant');
    else {
      input.setAttribute('aria-activedescendant', `lookupSuggestion-${index}`);
      suggestions.children[index]?.scrollIntoView({ block: 'nearest' });
    }
  }
  function scheduleSuggestions() {
    clearSuggestions();
    const prefix = normalizeWord(input.value);
    if (!prefix || composing) return;
    const token = suggestionSequence;
    suggestionTimer = setTimeout(async () => {
      suggestionStatus.hidden = false;
      suggestionStatus.textContent = '尋找候選單字…';
      const response = await lookupSuggestions(prefix, getWords().map((word) => word.word));
      if (token !== suggestionSequence || !dialog.open || normalizeWord(input.value) !== prefix) return;
      candidates = response.words;
      suggestions.innerHTML = candidates.map((item, index) => `<li id="lookupSuggestion-${index}" role="option" tabindex="-1" aria-selected="false" data-candidate="${index}"><span lang="en">${esc(item.word)}</span>${item.owned ? '<small>已收藏</small>' : ''}</li>`).join('');
      suggestions.hidden = !candidates.length;
      input.setAttribute('aria-expanded', String(!!candidates.length));
      suggestionStatus.textContent = response.status === 'unavailable'
        ? '部分候選索引尚未快取，連網後可補齊；仍可直接查詢。'
        : candidates.length ? '可點選單字，或用上下鍵選擇、Enter 查詢。'
        : response.status === 'invalid' ? '' : '沒有符合的候選字，仍可直接查詢原拼字。';
      suggestionStatus.hidden = !suggestionStatus.textContent;
    }, 150);
  }
  input.addEventListener('input', (event) => {
    stop(); current = null;
    result.innerHTML = '<p class="tool-empty">選擇候選單字，或輸入完整拼字後按「查詢」。</p>';
    if (!event.isComposing) scheduleSuggestions();
  });
  input.addEventListener('compositionstart', () => { composing = true; clearSuggestions(); });
  input.addEventListener('compositionend', () => { composing = false; scheduleSuggestions(); });
  input.addEventListener('keydown', (event) => {
    if (event.isComposing || composing) return;
    if (['ArrowDown', 'ArrowUp'].includes(event.key) && candidates.length) {
      event.preventDefault(); event.stopPropagation();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      highlightCandidate(activeCandidate < 0 ? (step > 0 ? 0 : candidates.length - 1) : (activeCandidate + step + candidates.length) % candidates.length);
    } else if (event.key === 'Enter' && activeCandidate >= 0) {
      event.preventDefault(); event.stopPropagation();
      const word = candidates[activeCandidate].word;
      input.value = word; query(word);
    }
  });
  suggestions.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') event.preventDefault();
  });
  suggestions.addEventListener('click', (event) => {
    const option = event.target.closest('[data-candidate]');
    const item = option && candidates[Number(option.dataset.candidate)];
    if (item) { input.value = item.word; input.focus({ preventScroll: true }); query(item.word); }
  });
  dialog.addEventListener('focusout', (event) => {
    if (event.target === input && event.relatedTarget && !suggestions.contains(event.relatedTarget)) clearSuggestions();
  });
  function stop() { sequence++; controller?.abort(); }
  function open(word = '', trigger = null) {
    if (document.querySelector('dialog[open]')) return;
    returnTrigger = trigger;
    clearSuggestions();
    dialog.showModal();
    input.focus(); input.select();
    if (word) { input.value = word; query(word); }
  }
  function render() {
    if (!current) return;
    const own = saved(current.word);
    const item = viewingCard && own ? own : current;
    const examples = item.examples || [];
    const lines = zhLines(item.zh);
    const meaning = lines.map((line) => `${line.pos ? `<span class="lookup-pos">${esc(line.pos)}</span>` : ''}${esc(line.text)}`).join('<br>');
    result.innerHTML = `<article class="lookup-card"><div class="lookup-word"><div><p class="eyebrow">${viewingCard && own ? '我的字卡' : own ? '已在我的單字庫' : '字典查詢'}</p>
      <h3 lang="en">${esc(item.word)}</h3>${item.phonetic ? `<p class="phonetic">${esc(item.phonetic)}</p>` : ''}</div>
      ${canSpeak() ? `<button class="icon-btn" type="button" id="lookupSpeak" aria-label="播放單字發音">${speakerIcon}</button>` : ''}</div>
      ${item.zh ? `<p class="lookup-meaning">${!lines.some((line) => line.pos) && item.pos ? `<span class="lookup-pos">${esc(item.pos)}</span>` : ''}${meaning}</p>` : `<p class="hint-text">${current.loadStatus === 'unavailable' ? '暫時沒有可用的中文字義。' : '本機字典沒有這個字的中文。'}</p>`}
      ${!viewingCard && current.lemma ? `<p class="hint-text lookup-form-note">${esc(current.word)} 是 ${esc(current.lemma)} 的${esc(current.form)}；收藏時保留 ${esc(current.word)}。</p>` : ''}
      ${item.en ? `<p class="lookup-en" lang="en">${esc(item.en)}</p>` : ''}
      ${examples.length ? `<div class="lookup-example"><p lang="en">${esc(examples[0].en)}</p><p>${esc(examples[0].zh)}</p></div>` : ''}
      <p class="hint-text">${esc(viewingCard && own ? '來自你已收藏的字卡' : current.source)}</p>
      ${!item.en ? '<button class="btn btn-ghost btn-sm" id="lookupEnglish" type="button">查英文解釋</button><p class="hint-text" id="lookupEnglishStatus" role="status"></p>' : ''}
      ${!own && !current.zh ? `<p class="hint-text">未收錄可能是變化形或拼字差異；仍可保留「${esc(current.word)}」新增字卡，不會自動改成原形。</p>
        <details class="lookup-manual"><summary>手動補上意思（選填）</summary>
          <label class="field"><span>中文意思</span><textarea id="lookupManualZh" rows="2" maxlength="300" placeholder="例如：討論（discuss 的過去式／過去分詞）">${esc(manual.zh)}</textarea></label>
          <label class="field"><span>詞性（選填）</span><input id="lookupManualPos" maxlength="60" value="${esc(manual.pos)}" placeholder="例如 v."></label>
          <label class="field"><span>英文解釋（選填）</span><textarea id="lookupManualEn" rows="2" maxlength="300">${esc(manual.en)}</textarea></label>
        </details>` : ''}
      <div class="lookup-save"><label class="field"><span>${own ? '加入其他單字集' : '收藏到單字集'}</span><select id="lookupSet">${setOptions(activeSetId() === 'unfiled' ? '' : activeSetId())}</select></label>
      <button class="btn btn-primary" id="lookupSave" type="button">${own ? '加入單字集' : '加入我的單字庫'}</button></div>
      ${own ? '<button class="btn btn-ghost" type="button" id="lookupOwn">查看我的字卡</button>' : ''}
      <p class="hint-text" id="lookupSaveStatus" role="status"></p></article>`;
    result.querySelector('#lookupSpeak')?.addEventListener('click', () => speak(current.word));
    result.querySelector('#lookupEnglish')?.addEventListener('click', () => english(current.word));
    result.querySelector('#lookupOwn')?.addEventListener('click', () => { viewingCard = true; render(); });
    for (const [id, key] of [['lookupManualZh', 'zh'], ['lookupManualPos', 'pos'], ['lookupManualEn', 'en']]) {
      result.querySelector('#' + id)?.addEventListener('input', (event) => { manual[key] = event.target.value; });
    }
    const save = result.querySelector('#lookupSave');
    const select = result.querySelector('#lookupSet');
    const refreshSave = () => { save.disabled = !!saved(current.word) && !select.value; };
    select.addEventListener('change', refreshSave);
    refreshSave();
    save.addEventListener('click', () => {
      const setId = select.value;
      try {
        let word = saved(current.word);
        if (!word) {
          const fields = Object.fromEntries(['pos', 'zh', 'en'].map((key) => [key, manual[key].trim() || current[key] || '']));
          const src = {};
          for (const key of ['pos', 'zh', 'en']) if (fields[key]) src[key] = manual[key].trim() ? 'user' : key === 'en' ? 'freedict' : 'dict';
          const initialData = new Map([[current.word, { phonetic: current.phonetic || '', ...fields,
            src,
            lookup: { dictAt: Date.now(), enDone: true } }]]);
          word = addWords([current.word], { autoGenerate: false, initialData }).added[0];
          viewingCard = true;
        }
        if (setId) assignWordSet([word.id], setId);
        render();
        result.querySelector('#lookupSaveStatus').textContent = setId ? '已收藏到指定單字集，原有進度保留。' : '已加入我的單字庫。';
        if (!word.zh && !word.en) result.querySelector('#lookupSaveStatus').textContent += ' 尚無解釋，可在單字庫的編輯模式手動補上，或設定 Gemini 金鑰後使用 AI 內容工具。';
        toast('已收藏單字');
      } catch (err) { result.querySelector('#lookupSaveStatus').textContent = err.message; }
    });
  }
  async function english(word) {
    const token = sequence;
    const status = result.querySelector('#lookupEnglishStatus');
    const button = result.querySelector('#lookupEnglish');
    if (button) button.disabled = true;
    if (status) status.textContent = '正在查英文解釋…';
    controller?.abort(); controller = new AbortController();
    const requestController = controller;
    const timeout = setTimeout(() => requestController.abort(), 8000);
    const response = await lookupEnglish(word, current?.pos || '', { signal: requestController.signal });
    clearTimeout(timeout);
    if (token !== sequence || !dialog.open) return;
    if (response.status === 'ok') {
      current = { ...current, en: response.en, phonetic: current.phonetic || response.phonetic, source: `${current.source} · 英文：Free Dictionary` };
      viewingCard = false;
      render();
    } else {
      if (status) status.textContent = response.status === 'notfound' ? '找不到英文解釋，請確認拼字；也可保留原拼字新增字卡。' : '目前無法連線查英文，仍可新增字卡或手動補意思。';
      if (button) button.disabled = false;
    }
  }
  async function query(value) {
    clearSuggestions();
    stop();
    const token = sequence;
    const word = normalizeWord(value);
    current = null; viewingCard = false; manual = { pos: '', zh: '', en: '' };
    if (!/^[a-zà-öø-ÿ]+(?:[-' ][a-zà-öø-ÿ]+)*$/i.test(word) || word.length > 80) {
      result.innerHTML = '<p class="set-error" role="alert">請輸入一個英文單字或片語。</p>'; return;
    }
    const own = saved(word);
    result.innerHTML = '<p class="tool-empty" role="status">正在查詢…</p>';
    const response = await lookupLocalResult(word);
    const local = response.entry;
    if (token !== sequence || !dialog.open) return;
    current = { word, ...(local || {}), loadStatus: response.status, source: local ? '中文：ECDICT 字典（常用＋擴充，按需載入）'
      : response.status === 'unavailable' ? '目前無法載入所需字典檔，請連網後重試；仍可保留原拼字收藏。'
      : '字典未收錄此字，可查英文解釋或手動補上意思。' };
    if (!local && own) { current = { ...own, source: '來自你已收藏的字卡' }; viewingCard = true; }
    render();
  }
  dialog.querySelector('#lookupForm').addEventListener('submit', (event) => { event.preventDefault(); query(input.value); });
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', (event) => {
    if (event.isComposing || composing) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (!suggestions.hidden || !suggestionStatus.hidden) clearSuggestions();
      else dialog.close();
    }
  });
  dialog.addEventListener('close', () => {
    clearSuggestions();
    stop();
    if (!returnTrigger) return;
    const trigger = returnTrigger.isConnected ? returnTrigger : [...document.querySelectorAll('[data-lookup-word]')].find((el) => el.dataset.lookupWord === returnTrigger.dataset.lookupWord);
    trigger?.focus({ preventScroll: true });
    returnTrigger = null;
  });
  document.getElementById('openLookup').addEventListener('click', () => open());
  document.addEventListener('toeic:lookup-word', (event) => {
    if (typeof event.detail?.word === 'string') open(event.detail.word, event.detail.trigger);
  });
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-lookup-word]');
    if (!trigger || dialog.contains(trigger)) return;
    event.preventDefault();
    open(trigger.dataset.lookupWord, trigger);
  });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); open(); }
  });
  // 分類可能由另一個頁面或同步更新，開啟查詢時重新查即可；關閉時不背景查詢。
  subscribe(() => {
    if (!dialog.open || !current) return;
    const select = result.querySelector('#lookupSet');
    if (select) select.innerHTML = setOptions(select.value);
  });
}
