// 設定頁的「帳號與同步」區塊
import {
  syncState, onSyncChange, signInWithGoogle, sendEmailLink, completeEmailLink, signOutSync, syncNow,
} from '../sync.js';
import { isIOS, isStandalone } from '../pwa.js';
import { esc, toast, confirmAction } from '../ui.js';

const googleIcon = '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function renderSyncPanel(container) {
  let busy = false;
  let lastKey = '';

  // 背景的狀態改變（例如 Firebase 載入完成、回報「尚未登入」）會重畫這個區塊；
  // 為了不把使用者正在輸入的 Email／連結清掉：
  //   1. 畫面上看得到的東西沒變就不重畫
  //   2. 重畫時保留輸入框的內容、「貼上連結」是否展開、以及游標所在的欄位
  function draw(st = syncState()) {
    const key = JSON.stringify([st.configured, st.user?.uid, st.user?.email, st.status, st.error, st.lastSyncAt,
      st.summary, st.pendingLink, st.linkSentTo]);
    if (key === lastKey && container.firstChild) return;
    lastKey = key;
    const typed = {};
    container.querySelectorAll('input[id]').forEach((i) => { if (i.value) typed[i.id] = i.value; });
    const pasteOpen = container.querySelector('.paste-link')?.open;
    const focusedId = container.contains(document.activeElement) ? document.activeElement.id : '';
    render(st);
    for (const [id, v] of Object.entries(typed)) {
      const el = container.querySelector(`#${id}`);
      if (el) el.value = v;
    }
    if (pasteOpen) container.querySelector('.paste-link')?.setAttribute('open', '');
    if (focusedId) container.querySelector(`#${focusedId}`)?.focus();
  }

  function render(st) {
    if (!st.configured) {
      container.innerHTML = `
        <h2 class="panel-title">帳號與同步</h2>
        <p class="panel-desc">登入後，手機和電腦會自動同步單字、複習進度、學習紀錄和錯題本。</p>
        <p class="pwa-note">同步功能還沒有設定：網站管理者需要照 <code>docs/firebase-setup.md</code> 建立 Firebase 專案，
          並把設定填進 <code>js/firebase-config.js</code>。在那之前，資料只存在這台裝置。</p>`;
      return;
    }

    let body;
    if (st.user) {
      const via = st.user.provider === 'google.com' ? 'Google' : 'Email';
      let line;
      if (st.status === 'syncing' || st.status === 'connecting') line = '<p class="sync-line">同步中…</p>';
      else if (st.status === 'offline') line = '<p class="sync-line">離線中，連上網路後會自動同步</p>';
      else if (st.status === 'error') line = `<p class="ai-error" role="alert">⚠ 同步失敗：${esc(st.error)}</p>`;
      else if (st.lastSyncAt) {
        const s = st.summary || {};
        const parts = [s.added && `新增 ${s.added}`, s.updated && `更新 ${s.updated}`, s.deleted && `刪除 ${s.deleted}`, s.pushed && `上傳 ${s.pushed}`].filter(Boolean);
        line = `<p class="sync-line ok">✓ ${fmtTime(st.lastSyncAt)} 已同步${parts.length ? `（${parts.join('、')}）` : '，沒有變更'}</p>`;
      } else line = '<p class="sync-line">準備同步…</p>';
      body = `
        <p class="sync-user">已登入：<strong>${esc(st.user.email || st.user.name || '已登入')}</strong> <span class="muted">（${via}）</span></p>
        ${line}
        <div class="backup-actions">
          <button class="btn btn-outline" type="button" id="syncNow" ${st.status === 'syncing' ? 'disabled' : ''}>立即同步</button>
          <button class="btn btn-ghost" type="button" id="signOut">登出</button>
        </div>
        <p class="hint-text">資料改變後會自動同步；打開網站、切回這個 App 時也會同步。登出後，這台裝置的資料會保留。</p>`;
    } else if (st.pendingLink) {
      // 在另一台裝置（或另一個瀏覽器）點了登入連結：需要再輸入一次 Email
      body = `
        <p class="panel-desc">你是用登入連結打開的。請輸入<strong>收到這封信的 Email</strong> 完成登入：</p>
        <form id="confirmForm" class="email-form">
          <input type="email" id="confirmEmail" placeholder="you@example.com" required autocomplete="email">
          <button class="btn btn-primary" type="submit">完成登入</button>
        </form>`;
    } else {
      const iosApp = isIOS();
      body = `
        <p class="panel-desc">登入後，手機和電腦會自動同步<strong>單字、AI 內容、複習進度、學習紀錄和錯題本</strong>。
          不登入也可以照常使用（資料只存在這台裝置）。Gemini 金鑰不會上傳。</p>
        <button class="btn btn-outline google-btn" type="button" id="googleBtn">${googleIcon} 用 Google 帳號登入</button>
        <p class="or-line"><span>或用 Email 登入（不用密碼）</span></p>
        <form id="emailForm" class="email-form">
          <input type="email" id="emailInput" placeholder="you@example.com" required autocomplete="email" value="${esc(st.linkSentTo)}">
          <button class="btn btn-outline" type="submit">寄登入連結</button>
        </form>
        ${st.linkSentTo ? `<p class="sync-line ok">✓ 已寄出登入連結到 ${esc(st.linkSentTo)}，請到信箱點連結（也請看一下垃圾郵件）。</p>` : ''}
        <details class="paste-link" ${st.linkSentTo && (iosApp || isStandalone()) ? 'open' : ''}>
          <summary>${iosApp ? 'iPhone 主畫面 App：' : ''}點了連結卻沒有登入？改用「貼上連結」</summary>
          <p class="hint-text">${iosApp
            ? 'iPhone 會用 Safari 打開信裡的連結，登入的是 Safari，不是主畫面 App。請在「郵件」App 裡<strong>長按連結 › 拷貝</strong>，回到這裡貼上。'
            : '在信裡的連結上按右鍵（手機長按）› 複製連結網址，貼在下面。'}</p>
          <form id="pasteForm" class="email-form stacked">
            <input type="email" id="pasteEmail" placeholder="收到信的 Email" required autocomplete="email" value="${esc(st.linkSentTo)}">
            <input type="url" id="pasteLink" placeholder="貼上登入連結（https://…）" required>
            <button class="btn btn-primary" type="submit">完成登入</button>
          </form>
        </details>
        ${st.status === 'error' && st.error ? `<p class="ai-error" role="alert">⚠ ${esc(st.error)}</p>` : ''}`;
    }

    container.innerHTML = `<h2 class="panel-title">帳號與同步</h2>${body}`;
    bind();
  }

  async function run(btn, fn) {
    if (busy) return;
    busy = true;
    if (btn) btn.disabled = true;
    try {
      await fn();
    } catch (err) {
      toast(err.message, 'error');
    }
    busy = false;
    lastKey = '';
    draw();
  }

  function bind() {
    container.querySelector('#googleBtn')?.addEventListener('click', (e) => run(e.currentTarget, async () => {
      await signInWithGoogle();
      toast('已登入，開始同步');
    }));
    container.querySelector('#emailForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      run(e.submitter, async () => {
        await sendEmailLink(container.querySelector('#emailInput').value);
        toast('已寄出登入連結');
      });
    });
    container.querySelector('#pasteForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      run(e.submitter, async () => {
        await completeEmailLink(container.querySelector('#pasteEmail').value, container.querySelector('#pasteLink').value.trim());
        toast('已登入，開始同步');
      });
    });
    container.querySelector('#confirmForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      run(e.submitter, async () => {
        await completeEmailLink(container.querySelector('#confirmEmail').value, syncState().pendingLink);
        toast('已登入，開始同步');
      });
    });
    container.querySelector('#syncNow')?.addEventListener('click', (e) => run(e.currentTarget, syncNow));
    container.querySelector('#signOut')?.addEventListener('click', (e) => {
      if (!confirmAction('確定要登出嗎？這台裝置的資料會保留，只是不再同步。')) return;
      run(e.currentTarget, async () => { await signOutSync(); toast('已登出'); });
    });
  }

  draw();
  return onSyncChange(draw);
}
