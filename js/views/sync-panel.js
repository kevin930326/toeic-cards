// 設定頁的「帳號與同步」區塊
import {
  syncState, onSyncChange, signInWithGoogle, sendEmailLink, completeEmailLink, signOutSync, syncNow,
  signInWithPassword, registerWithPassword, setAccountPassword, sendPasswordReset, resolveGuestData,getMetaConflict,resolveMetaConflict,
} from '../sync.js';
import { isIOS, isStandalone } from '../pwa.js';
import { esc, toast, confirmAction } from '../ui.js';
import {getWords} from '../store.js';

const googleIcon = '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function metaConflictHTML(c) {
  const labels={dailyGoal:'每日目標',newPerDay:'每日新字',cardMode:'字卡語言',autoGenerate:'自動生成',quizScope:'測驗範圍',quizCount:'測驗題數',part5Fresh:'每次出新題',examDate:'考試日期'};
  const preview=value=>c.name==='settings'?`<ul>${Object.entries(value||{}).map(([k,v])=>`<li>${esc(labels[k]||k)}：${esc(typeof v==='boolean'?(v?'開啟':'關閉'):v)}</li>`).join('')}</ul>`:`<p>${Array.isArray(value)?value.length:0} 題</p><ul>${(Array.isArray(value)?value:[]).slice(0,8).map(m=>`<li>${esc(m.question?.word)}：${esc(m.question?.prompt?.slice(0,100))}</li>`).join('')}</ul>`;
  return `<div class="pwa-note meta-conflict"><h3>${c.name==='settings'?'學習設定':'錯題本'}有同步衝突</h3><p>兩邊都有修改，已保留兩份。這份資料以整份確認；保留本機會取代雲端版本，採用雲端則取代這台裝置的版本。建議先匯出備份。</p><details open><summary>比較本機與雲端</summary><h4>本機快照</h4>${preview(c.local)}<h4>雲端快照</h4>${preview(c.remote?.value)}</details><div class="backup-actions"><button class="btn btn-outline" id="metaLocal" type="button">保留本機並同步</button><button class="btn btn-outline" id="metaRemote" type="button">採用雲端版本</button></div></div>`;
}

export function renderSyncPanel(container) {
  let busy = false;
  let lastKey = '';
  let panelError = '';   // 登入相關的錯誤一直顯示在區塊裡（提示訊息只出現幾秒，容易沒看到）

  // 背景的狀態改變（例如 Firebase 載入完成、回報「尚未登入」）會重畫這個區塊；
  // 為了不把使用者正在輸入的 Email／連結清掉：
  //   1. 畫面上看得到的東西沒變就不重畫
  //   2. 重畫時保留輸入框的內容、「貼上連結」是否展開、以及游標所在的欄位
  function draw(st = syncState()) {
    const key = JSON.stringify([st.configured, st.user?.uid, st.user?.email, st.user?.providers, st.status, st.error,
      st.lastSyncAt, st.summary, st.pendingLink, st.linkSentTo, st.guestChoice, panelError,getMetaConflict()]);
    if (key === lastKey && container.firstChild) return;
    lastKey = key;
    const typed = {};
    container.querySelectorAll('input[id]').forEach((i) => { if (i.value) typed[i.id] = i.value; });
    const pasteOpen = container.querySelector('.paste-link')?.open;
    const linkOpen = container.querySelector('.link-login')?.open;
    const focusedId = container.contains(document.activeElement) ? document.activeElement.id : '';
    render(st);
    for (const [id, v] of Object.entries(typed)) {
      const el = container.querySelector(`#${id}`);
      if (el) el.value = v;
    }
    if (pasteOpen) container.querySelector('.paste-link')?.setAttribute('open', '');
    if (linkOpen) container.querySelector('.link-login')?.setAttribute('open', '');
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
    if (st.guestChoice) {
      body = `<p class="sync-user">即將使用帳號：<strong>${esc(st.user.email || st.user.uid)}</strong></p>
        <p class="panel-desc">這個瀏覽器有訪客資料。要將訪客的字卡、分類、紀錄與錯題合併到這個帳號嗎？確認前不會上傳任何資料。Gemini 金鑰不會移轉。</p>
        <div class="backup-actions"><button class="btn btn-outline" id="guestKeep" type="button">保留訪客資料，僅載入帳號</button>
        <button class="btn btn-primary" id="guestMerge" type="button">確認合併訪客資料</button>
        <button class="btn btn-ghost" id="signOut" type="button">取消登入</button></div>`;
    } else if (st.user) {
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
        ${getMetaConflict()?metaConflictHTML(getMetaConflict()):''}
        ${getWords().some(w=>w._conflicts?.length) ? '<p class="pwa-note" role="status">部分字卡有同欄位修改衝突，兩份內容都已保留。請到單字庫開啟編輯，比較後儲存要保留的版本。</p>' : ''}
        <div class="backup-actions">
          <button class="btn btn-outline" type="button" id="syncNow" ${st.status === 'syncing' ? 'disabled' : ''}>立即同步</button>
          <button class="btn btn-ghost" type="button" id="signOut">登出</button>
        </div>
        <p class="hint-text">資料改變後會自動同步。登出後回到獨立的訪客空間；此帳號的本機資料保留在自己的儲存區，下次登入同一帳號才能載入。</p>
        <div class="set-pw">
          <h3 class="sub-title">設定／變更密碼（讓 iPhone 主畫面 App 也能登入）</h3>
          <p class="hint-text">iPhone 主畫面 App 不能用 Google 登入。替這個帳號設定密碼後，在 App 裡用
            <strong>${esc(st.user.email)}</strong>＋密碼登入，就是同一個帳號。已經設定過的話，這裡可以改成新密碼。</p>
          <form id="setPwForm" class="email-form">
            <input type="password" id="newPassword" placeholder="至少 6 個字元" minlength="6" required autocomplete="new-password">
            <button class="btn btn-outline" type="submit">設定密碼</button>
          </form>
          ${panelError ? `<p class="ai-error" role="alert">⚠ ${esc(panelError)}</p>` : ''}
        </div>`;
    } else if (st.pendingLink) {
      // 用登入連結打開、但這個瀏覽器不知道 Email：
      //   - iPhone 的 Safari：多半是「主畫面 App 寄的信、在 Safari 打開」→ 建議複製連結回 App 貼上
      //   - 其他情況：輸入 Email 就能在這裡完成登入
      const iosSafari = isIOS() && !isStandalone();
      const copyBlock = `
        <button class="btn ${iosSafari ? 'btn-primary' : 'btn-outline'}" type="button" id="copyLink">複製登入連結</button>
        <p class="hint-text">${iosSafari
          ? '複製後回到<strong>主畫面的多益字卡 App</strong> › 設定 › 帳號與同步 › 「貼上連結」，貼上就能在 App 裡登入。'
          : '如果是在另一台裝置（或主畫面 App）要求的登入，可以複製這個連結，到那邊貼上。'}</p>`;
      const confirmBlock = `
        <p class="panel-desc">${iosSafari ? '或者直接在 Safari 登入：' : ''}輸入<strong>收到這封信的 Email</strong> 完成登入：</p>
        <form id="confirmForm" class="email-form">
          <input type="email" id="confirmEmail" placeholder="you@example.com" required autocomplete="email">
          <button class="btn ${iosSafari ? 'btn-outline' : 'btn-primary'}" type="submit">在這裡登入</button>
        </form>`;
      body = `
        <p class="panel-desc">你是用 Email 登入連結打開的。</p>
        ${iosSafari ? `<p class="pwa-note">📱 要在<strong>主畫面的 App</strong> 登入嗎？iPhone 會用 Safari 打開信裡的連結，但 Safari 和主畫面 App 的資料是分開的，
          所以請把連結帶回 App：</p>${copyBlock}${confirmBlock}` : `${confirmBlock}${copyBlock}`}`;
    } else {
      // iPhone 主畫面 App 打不開 Google 的登入視窗（Apple 的限制）→ 主要用 Email＋密碼；
      // Email 登入連結整個專案每天只能寄 5 封（Firebase 免費方案），放在次要位置
      const iosApp = isIOS() && isStandalone();
      body = `
        <p class="panel-desc">登入後，手機和電腦會自動同步<strong>單字、AI 內容、複習進度、學習紀錄和錯題本</strong>。
          不登入也可以照常使用（資料只存在這台裝置）。Gemini 金鑰不會上傳。</p>
        ${iosApp
          ? `<p class="pwa-note">📱 iPhone 主畫面 App 打不開 Google 的登入視窗（Apple 的限制），請用 <strong>Email＋密碼</strong>登入。<br>
              電腦是用 Google 登入的話：先在<strong>電腦</strong>的「帳號與同步」按「<strong>設定密碼</strong>」，再回來這裡輸入同一個 Gmail＋密碼，就是同一個帳號。</p>`
          : `<button class="btn btn-outline google-btn" type="button" id="googleBtn">${googleIcon} 用 Google 帳號登入</button>
             <p class="or-line"><span>或用 Email＋密碼</span></p>`}
        <form id="pwForm" class="email-form stacked">
          <input type="email" id="pwEmail" placeholder="Email" required autocomplete="email">
          <input type="password" id="pwPassword" placeholder="密碼（至少 6 個字元）" required minlength="6" autocomplete="current-password">
          <div class="backup-actions">
            <button class="btn ${iosApp ? 'btn-primary' : 'btn-outline'}" type="submit">登入</button>
            <button class="btn btn-ghost" type="button" id="registerBtn">建立新帳號</button>
            <button class="btn btn-ghost" type="button" id="resetBtn">忘記密碼</button>
          </div>
        </form>
        ${panelError ? `<p class="ai-error" role="alert">⚠ ${esc(panelError)}</p>` : ''}
        <details class="link-login" ${st.linkSentTo ? 'open' : ''}>
          <summary>用 Email 登入連結（不用密碼；整個網站每天最多寄 5 封）</summary>
          <form id="emailForm" class="email-form">
            <input type="email" id="emailInput" placeholder="you@example.com" required autocomplete="email" value="${esc(st.linkSentTo)}">
            <button class="btn btn-outline" type="submit">寄登入連結</button>
          </form>
          ${st.linkSentTo ? `<p class="sync-line ok">✓ 已寄出登入連結到 ${esc(st.linkSentTo)}（也請看一下垃圾郵件）。</p>` : ''}
          ${iosApp && st.linkSentTo ? `<ol class="steps link-steps">
              <li>打開「郵件」App，點信裡的登入連結（會用 Safari 打開）</li>
              <li>在 Safari 打開的頁面按「<strong>複製登入連結</strong>」</li>
              <li>回到這個 App，貼在下面，按「完成登入」</li>
            </ol>` : ''}
          <details class="paste-link" ${st.linkSentTo && isStandalone() ? 'open' : ''}>
            <summary>點了連結卻沒有登入？改用「貼上連結」</summary>
            <p class="hint-text">${iosApp
              ? '在「郵件」App 裡<strong>長按連結 › 拷貝</strong>，或在 Safari 打開的頁面按「複製登入連結」，貼在這裡。'
              : '在信裡的連結上按右鍵（手機長按）› 複製連結網址，貼在下面。'}</p>
            <form id="pasteForm" class="email-form stacked">
              <input type="email" id="pasteEmail" placeholder="收到信的 Email" required autocomplete="email" value="${esc(st.linkSentTo)}">
              <input type="url" id="pasteLink" placeholder="貼上登入連結（https://…）" required>
              <button class="btn btn-primary" type="submit">完成登入</button>
            </form>
          </details>
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
      panelError = '';
    } catch (err) {
      panelError = err.message;
      toast(err.message, 'error');
    }
    busy = false;
    lastKey = '';
    draw();
  }

  function bind() {
    container.querySelector('#metaLocal')?.addEventListener('click',e=>run(e.currentTarget,()=>resolveMetaConflict(false)));
    container.querySelector('#metaRemote')?.addEventListener('click',e=>run(e.currentTarget,()=>resolveMetaConflict(true)));
    container.querySelector('#guestKeep')?.addEventListener('click', e => run(e.currentTarget, () => resolveGuestData(false)));
    container.querySelector('#guestMerge')?.addEventListener('click', e => run(e.currentTarget, () => resolveGuestData(true)));
    container.querySelector('#googleBtn')?.addEventListener('click', (e) => run(e.currentTarget, async () => {
      await signInWithGoogle();
      toast('已登入，開始同步');
    }));
    const pwValues = () => [container.querySelector('#pwEmail').value, container.querySelector('#pwPassword').value];
    container.querySelector('#pwForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      run(e.submitter, async () => {
        await signInWithPassword(...pwValues());
        toast('已登入，開始同步');
      });
    });
    container.querySelector('#registerBtn')?.addEventListener('click', (e) => {
      if (!container.querySelector('#pwForm').reportValidity()) return;
      run(e.currentTarget, async () => {
        await registerWithPassword(...pwValues());
        toast('帳號建立完成，開始同步');
      });
    });
    container.querySelector('#resetBtn')?.addEventListener('click', (e) => {
      const email = container.querySelector('#pwEmail');
      if (!email.reportValidity()) return;
      run(e.currentTarget, async () => {
        await sendPasswordReset(email.value);
        toast(`已寄出重設密碼的信到 ${email.value}`);
      });
    });
    container.querySelector('#setPwForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      run(e.submitter, async () => {
        await setAccountPassword(container.querySelector('#newPassword').value);
        toast('密碼設定完成，iPhone App 可以用 Email＋密碼登入了');
      });
    });
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
    container.querySelector('#copyLink')?.addEventListener('click', async (e) => {
      const link = syncState().pendingLink;
      try {
        await navigator.clipboard.writeText(link);
        toast('已複製登入連結，回到 App 貼上');
      } catch (err) {
        // 不能寫入剪貼簿時，把連結放進輸入框並選取，讓使用者自己複製
        const box = document.createElement('input');
        box.className = 'link-box';
        box.readOnly = true;
        box.value = link;
        e.currentTarget.after(box);
        box.select();
        toast('請手動複製下面的連結');
      }
    });
    container.querySelector('#syncNow')?.addEventListener('click', (e) => run(e.currentTarget, syncNow));
    container.querySelector('#signOut')?.addEventListener('click', (e) => {
      if (!confirmAction('確定要登出並回到訪客空間嗎？帳號資料會分開保留，不會交給下一個帳號。')) return;
      run(e.currentTarget, async () => { await signOutSync(); toast('已登出'); });
    });
  }

  draw();
  return onSyncChange(draw);
}
