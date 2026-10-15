// 設定頁的「安裝與離線使用」區塊
import {
  installState, promptInstall, onPwaChange, downloadDictionary, dictionaryCacheStatus, persistStatus,
} from '../pwa.js';
import { toast } from '../ui.js';

// iPhone／iPad 的分享圖示（方框加向上箭頭）
const shareIcon = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" class="inline-icon"><path d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function renderPwaPanel(container) {
  let downloading = false;

  async function draw() {
    const st = installState();
    let install;
    if (st.standalone) {
      install = '<p class="pwa-ok">✓ 已經安裝成 App，正在用 App 模式開啟</p>';
    } else if (st.canPrompt) {
      install = `<p class="panel-desc">安裝後會出現在桌面／主畫面，像 App 一樣全螢幕開啟，沒有網路也能複習。</p>
        <button class="btn btn-primary" type="button" id="installBtn">安裝到桌面／主畫面</button>`;
    } else if (st.ios) {
      install = `<p class="panel-desc">在 iPhone／iPad 上，用 <strong>Safari</strong> 開啟這個網站，然後：</p>
        <ol class="steps">
          <li>點下方的「分享」按鈕 ${shareIcon}</li>
          <li>往下滑，選「<strong>加入主畫面</strong>」</li>
          <li>按右上角的「加入」</li>
        </ol>
        <p class="pwa-note">⚠ iPhone 上「主畫面的 App」和「Safari」的資料是<strong>分開的</strong>。
          如果已經在 Safari 用了一陣子，請先在 Safari 的設定頁「匯出備份」，安裝後再到 App 裡「匯入備份」。</p>`;
    } else {
      install = `<p class="panel-desc">可以用瀏覽器選單裡的「安裝應用程式」或「加到主畫面」，把這個網站裝成 App。
        （Chrome、Edge 的網址列右邊也可能有安裝圖示）</p>`;
    }

    const insecure = !st.secure
      ? `<p class="pwa-note">⚠ 目前的網址不是 HTTPS（例如用區網 IP 開啟），<strong>離線功能無法使用</strong>。
          網站部署到 GitHub Pages（HTTPS）之後就可以了。</p>`
      : '';

    container.innerHTML = `
      <h2 class="panel-title">安裝與離線使用</h2>
      ${install}
      ${insecure}
      <div class="pwa-offline" ${st.sw ? '' : 'hidden'}>
        <h3 class="sub-title">離線字典</h3>
        <p class="panel-desc">常用字典約 2.8MB，下載後離線新增單字也能查中文。擴充字典按需載入，最近快取的分片可離線使用（最多 128 片）；這個按鈕只下載常用字典。</p>
        <p class="dict-status" id="dictStatus">檢查中…</p>
        <button class="btn btn-outline" type="button" id="dictBtn">下載常用字典</button>
      </div>
      <p class="hint-text" id="persistStatus"></p>`;

    container.querySelector('#installBtn')?.addEventListener('click', async () => {
      const ok = await promptInstall();
      if (ok) toast('已安裝！可以從桌面／主畫面開啟');
    });

    if (st.sw) {
      const status = await dictionaryCacheStatus();
      const el = container.querySelector('#dictStatus');
      const btn = container.querySelector('#dictBtn');
      if (!el) return;
      if (status.cached === status.total) {
        el.textContent = `✓ 已下載（${status.total} 個檔案），離線也能查字典`;
        el.classList.add('ok');
        btn.hidden = true;
      } else {
        el.textContent = status.cached ? `已下載 ${status.cached} / ${status.total} 個檔案（用過的字母會自動存起來）` : '還沒下載';
        btn.addEventListener('click', async () => {
          if (downloading) return;
          downloading = true;
          btn.disabled = true;
          try {
            await downloadDictionary((done, total) => { el.textContent = `下載中… ${done} / ${total}`; });
            toast('離線字典下載完成');
          } catch (err) {
            toast(`下載失敗：${err.message}`, 'error');
          }
          downloading = false;
          draw();
        });
      }
    }

    const persisted = await persistStatus();
    const ps = container.querySelector('#persistStatus');
    if (ps && persisted !== null) {
      ps.textContent = persisted
        ? '🔒 瀏覽器已同意保存這個網站的資料，不會在空間不足時自動清除。'
        : '瀏覽器在空間不足時，可能會清除網站資料；安裝成 App 並定期「匯出備份」比較保險。';
    }
  }

  draw();
  return onPwaChange(draw);
}
