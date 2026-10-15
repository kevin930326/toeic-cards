import { esc } from './ui.js';

// 只負責確認，不碰資料。頁面卸載時由 signal 關閉，避免延遲確認刪除舊頁的選取。
export function confirmWordDeletion(words, { signal } = {}) {
  if (!words.length || signal?.aborted) return Promise.resolve(false);
  const dialog = document.createElement('dialog');
  dialog.id = 'deleteWordsDialog';
  dialog.className = 'dialog delete-confirm';
  dialog.setAttribute('aria-labelledby', 'deleteWordsTitle');
  dialog.setAttribute('aria-describedby', 'deleteWordsDescription');
  dialog.innerHTML = `<div class="delete-confirm-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7"/></svg></div>
    <p class="eyebrow">整理你的收藏</p><h2 id="deleteWordsTitle">刪除 ${words.length} 張字卡？</h2>
    <p id="deleteWordsDescription">這些字卡與複習進度會從整個單字庫、所有單字集中刪除，無法直接復原。登入同步後，其他裝置也會套用刪除。</p>
    <div class="delete-preview" aria-label="即將刪除的單字">${words.slice(0, 8).map(w => `<span class="chip" lang="en">${esc(w.word)}</span>`).join('')}${words.length > 8 ? `<span class="delete-preview-more">另 ${words.length - 8} 個字</span>` : ''}</div>
    <p class="delete-alternative">只想移除分類？請取消後使用「移出單字集」，字卡和進度就會保留。</p>
    <div class="dialog-actions"><button class="btn btn-outline" type="button" id="cancelWordDeletion" autofocus>保留字卡</button><button class="btn btn-primary" type="button" id="confirmWordDeletion">刪除 ${words.length} 張字卡</button></div>`;
  document.body.append(dialog);
  return new Promise(resolve => {
    let settled = false;
    function finish(value) {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      dialog.close(); dialog.remove(); resolve(value);
    }
    function abort() { finish(false); }
    dialog.querySelector('#cancelWordDeletion').addEventListener('click', abort);
    dialog.querySelector('#confirmWordDeletion').addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', e => { e.preventDefault(); abort(); });
    dialog.addEventListener('close', abort);
    signal?.addEventListener('abort', abort, { once: true });
    dialog.showModal();
  });
}
