// 卡片背面的「也譯作」：讀單字包整理表、顯示、讓使用者加上自己背的譯法。
import { esc, toast } from './ui.js';
import { getWord, updateWord } from './store.js';
import { altMeanings, withAlt, parseAltInput } from './meaning-compare.js';

let packAlt = {};
let loading = null;
// 整理表約 10 KB；畫到單字包字卡時才讀（單字包資料按需載入），讀完更新畫面上的「也譯作」。
// 讀不到（離線且未快取）只是少顯示一行，不影響翻卡；下次畫卡再重試。
function loadPackAlt() {
  if (loading) return;
  loading = fetch(new URL('../data/packs/toeic-1000-alt.json', import.meta.url))
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!data?.alt || typeof data.alt !== 'object') { loading = null; return; }
      packAlt = data.alt;
      for (const el of document.querySelectorAll('[data-alt-for]')) {
        const w = getWord(el.dataset.altFor);
        if (w) el.outerHTML = altLineHTML(w);
      }
    })
    .catch(() => { loading = null; });
}

export function packAltFor(word) {
  return Object.hasOwn(packAlt, word) ? String(packAlt[word]) : '';
}

export function cardAltMeanings(w) {
  return altMeanings(w, packAltFor(w.word));
}

// 卡片背面那一行；沒有任何譯法時只顯示「＋ 我背的譯法」小按鈕
export function altLineHTML(w) {
  if (w.pack?.id === 'toeic-1000') loadPackAlt();
  const terms = cardAltMeanings(w);
  return `<div class="back-alt" data-alt-for="${esc(w.id)}">${terms.length ? `<p><span class="back-alt-label">也譯作</span>${esc(terms.join('；'))}</p>` : ''}
    <button type="button" class="back-alt-add" data-alt-add="${esc(w.id)}">＋ 我背的譯法</button></div>`;
}

export function openAltDialog(id, trigger) {
  const w = getWord(id);
  if (!w || document.querySelector('dialog[open]')) return;
  const current = cardAltMeanings(w);
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog alt-dialog';
  dialog.setAttribute('aria-labelledby', 'altDialogTitle');
  dialog.innerHTML = `<form method="dialog" class="alt-form">
    <p class="eyebrow" lang="en">${esc(w.word)}</p><h2 id="altDialogTitle">加上我背的譯法</h2>
    <p class="hint-text">之前背的說法和卡片不一樣？加在「也譯作」裡，主要意思不變。多個說法用分號或空白分開。</p>
    <label class="field"><span>我背的譯法</span><input id="altInput" maxlength="60" autocomplete="off" placeholder="例如：預期的" required></label>
    ${current.length ? `<p class="hint-text">目前也譯作：${esc(current.join('；'))}（會保留）</p>` : ''}
    <p class="set-error" id="altError" role="alert" hidden></p>
    <div class="dialog-actions"><button class="btn btn-outline" type="button" data-cancel>取消</button><button class="btn btn-primary" type="submit">儲存</button></div>
  </form>`;
  document.body.append(dialog);
  const input = dialog.querySelector('#altInput');
  const close = () => { dialog.close(); dialog.remove(); trigger?.isConnected && trigger.focus({ preventScroll: true }); };
  dialog.querySelector('[data-cancel]').addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  dialog.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    const added = parseAltInput(input.value);
    if (!added.length) { const error = dialog.querySelector('#altError'); error.hidden = false; error.textContent = '請輸入譯法。'; return; }
    const latest = getWord(id);
    if (!latest) { close(); return; }
    try {
      // 寫進中文意思最後一行，標記為使用者修改：之後 AI 生成或單字包更新都不會蓋掉
      updateWord(id, { zh: withAlt(latest.zh, [...cardAltMeanings(latest), ...added]), src: { ...(latest.src || {}), zh: 'user' } });
      close();
      toast('已加上你背的譯法');
    } catch (err) { toast(err.message, 'error'); }
  });
  dialog.showModal();
  input.focus();
}

// 單字探索等沒有翻卡處理的地方用文件層級的點擊事件；複習／自由翻卡的卡片會攔下點擊，改由 cardview.js handleCardTap 開啟
document.addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-alt-add]');
  if (button) { event.preventDefault(); openAltDialog(button.dataset.altAdd, button); }
});
