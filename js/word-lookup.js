// 全站查字典：不切換頁面、不使用 Gemini，也不影響學習紀錄。
import { getWords, addWords, assignWordSet, activeSetId, subscribe } from './store.js';
import { normalizeWord } from './parse.js';
import { lookupLocal, lookupEnglish } from './dictionary.js';
import { esc, toast, zhLines } from './ui.js';
import { setOptions } from './set-ui.js';
import { speak, canSpeak, speakerIcon } from './speech.js';

export function initWordLookup() {
  const dialog = document.createElement('dialog');
  dialog.id = 'lookupDialog';
  dialog.className = 'dialog lookup-dialog';
  dialog.setAttribute('aria-labelledby', 'lookupTitle');
  dialog.innerHTML = `<div class="tool-heading"><div><p class="eyebrow">隨手查，不中斷學習</p><h2 id="lookupTitle">查單字</h2></div>
    <button class="icon-btn" type="button" data-close aria-label="關閉查單字">✕</button></div>
    <form id="lookupForm" class="lookup-form"><label class="field grow"><span class="sr-only">想查的英文單字</span>
      <input id="lookupInput" type="search" maxlength="80" placeholder="輸入英文單字，例如 invoice" autocomplete="off" spellcheck="false" autocapitalize="off" required></label>
      <button class="btn btn-primary" type="submit">查詢</button></form>
    <div id="lookupResult" aria-live="polite"><p class="tool-empty">知道怎麼拼，卻想不起意思？<br><span>查中文、聽發音，也能順手收藏。</span></p></div>`;
  document.body.append(dialog);
  const result = dialog.querySelector('#lookupResult');
  const input = dialog.querySelector('#lookupInput');
  let sequence = 0;
  let controller;
  let current = null;
  let viewingCard = false;
  const saved = (word) => getWords().find((w) => w.word === word);
  function stop() { sequence++; controller?.abort(); }
  function open() {
    if (document.querySelector('dialog[open]')) return;
    dialog.showModal();
    input.focus(); input.select();
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
      ${item.zh ? `<p class="lookup-meaning">${!lines.some((line) => line.pos) && item.pos ? `<span class="lookup-pos">${esc(item.pos)}</span>` : ''}${meaning}</p>` : '<p class="hint-text">本機字典沒有這個字的中文。</p>'}
      ${item.en ? `<p class="lookup-en" lang="en">${esc(item.en)}</p>` : ''}
      ${examples.length ? `<div class="lookup-example"><p lang="en">${esc(examples[0].en)}</p><p>${esc(examples[0].zh)}</p></div>` : ''}
      <p class="hint-text">${esc(viewingCard && own ? '來自你已收藏的字卡' : current.source)}</p>
      ${!item.en ? '<button class="btn btn-ghost btn-sm" id="lookupEnglish" type="button">查英文解釋</button><p class="hint-text" id="lookupEnglishStatus" role="status"></p>' : ''}
      <div class="lookup-save"><label class="field"><span>${own ? '加入其他單字集' : '收藏到單字集'}</span><select id="lookupSet">${setOptions(activeSetId() === 'unfiled' ? '' : activeSetId())}</select></label>
      <button class="btn btn-primary" id="lookupSave" type="button">${own ? '加入單字集' : '加入我的單字庫'}</button></div>
      ${own ? '<button class="btn btn-ghost" type="button" id="lookupOwn">查看我的字卡</button>' : ''}
      <p class="hint-text" id="lookupSaveStatus" role="status"></p></article>`;
    result.querySelector('#lookupSpeak')?.addEventListener('click', () => speak(current.word));
    result.querySelector('#lookupEnglish')?.addEventListener('click', () => english(current.word));
    result.querySelector('#lookupOwn')?.addEventListener('click', () => { viewingCard = true; render(); });
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
          const initialData = new Map([[current.word, { phonetic: current.phonetic || '', pos: current.pos || '', zh: current.zh || '', en: current.en || '',
            src: { ...(current.zh ? { zh: 'dict', pos: 'dict' } : {}), ...(current.en ? { en: 'freedict' } : {}) },
            lookup: { dictAt: Date.now(), enDone: true } }]]);
          word = addWords([current.word], { autoGenerate: false, initialData }).added[0];
        }
        if (setId) assignWordSet([word.id], setId);
        render();
        result.querySelector('#lookupSaveStatus').textContent = setId ? '已收藏到指定單字集，原有進度保留。' : '已加入我的單字庫。';
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
      if (status) status.textContent = response.status === 'notfound' ? '找不到英文解釋，請確認拼字或改查原形。' : '目前無法連線查英文，已查到的中文仍可使用。';
      if (button) button.disabled = false;
    }
  }
  dialog.querySelector('#lookupForm').addEventListener('submit', async (event) => {
    event.preventDefault(); stop();
    const token = sequence;
    const word = normalizeWord(input.value);
    current = null; viewingCard = false;
    if (!/^[a-zà-öø-ÿ]+(?:[-' ][a-zà-öø-ÿ]+)*$/i.test(word) || word.length > 80) {
      result.innerHTML = '<p class="set-error" role="alert">請輸入一個英文單字或片語。</p>'; return;
    }
    const own = saved(word);
    result.innerHTML = '<p class="tool-empty" role="status">正在查詢…</p>';
    const local = await lookupLocal(word);
    if (token !== sequence || !dialog.open) return;
    current = { word, ...(local || {}), source: local ? '中文：本機 ECDICT 字典' : '本機字典未收錄此字，可連線查英文解釋。' };
    if (!local && own) { current = { ...own, source: '來自你已收藏的字卡' }; viewingCard = true; }
    render();
  });
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dialog.close(); }
  });
  dialog.addEventListener('close', stop);
  document.getElementById('openLookup').addEventListener('click', open);
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
