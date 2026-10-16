// PWA：註冊 Service Worker、離線提示、安裝到主畫面、離線字典
//
// 注意：Service Worker 只能在 HTTPS 或 localhost 使用。
// 用區網 IP（例如 http://192.168.0.200:8000）開啟時，離線功能不會生效，部署到 GitHub Pages 後就可以。
const DICT_CACHE = 'toeic-dict-v1';   // 要和 sw.js 一致
const DICT_FILES = 'abcdefghijklmnopqrstuvwxyz'.split('').map((c) => `data/dict/${c}.json`);

let deferredPrompt = null;   // Android／電腦版 Chrome 的「安裝」事件
const listeners = new Set();

function emit() {
  for (const fn of listeners) fn();
}

export function onPwaChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function swSupported() {
  return 'serviceWorker' in navigator && window.isSecureContext;
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

export function isIOS() {
  const ua = navigator.userAgent || '';
  // iPad 新版的 Safari 會假裝成 Mac，用觸控點數判斷
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function installState() {
  return {
    standalone: isStandalone(),
    canPrompt: !!deferredPrompt,
    ios: isIOS(),
    secure: window.isSecureContext,
    sw: swSupported(),
  };
}

export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice.catch(() => null);
  deferredPrompt = null;
  emit();
  return choice?.outcome === 'accepted';
}

// 把整本字典（26 個檔案、約 2.8MB）存進快取，離線新增單字也查得到中文
export async function downloadDictionary(onProgress) {
  const cache = await caches.open(DICT_CACHE);
  let done = 0;
  for (const f of DICT_FILES) {
    if (!(await cache.match(new URL(f, location.href).href))) {
      const res = await fetch(f);
      if (!res.ok) throw new Error(`下載 ${f} 失敗`);
      await cache.put(new URL(f, location.href).href, res);
    }
    done++;
    onProgress?.(done, DICT_FILES.length);
  }
  return done;
}

export async function dictionaryCacheStatus() {
  if (!('caches' in window)) return { cached: 0, total: DICT_FILES.length };
  const cache = await caches.open(DICT_CACHE);
  let cached = 0;
  for (const f of DICT_FILES) if (await cache.match(new URL(f, location.href).href)) cached++;
  return { cached, total: DICT_FILES.length };
}

// 瀏覽器在空間不足時可能自動清掉網站資料；要求「持久保存」可以降低這個風險
export async function persistStatus() {
  if (!navigator.storage?.persisted) return null;
  return navigator.storage.persisted();
}

function requestPersist() {
  navigator.storage?.persist?.().then(() => emit()).catch(() => {});
}

// 離線提示列
function updateOnline() {
  const bar = document.getElementById('offlineBar');
  if (bar) bar.hidden = navigator.onLine;
  document.documentElement.classList.toggle('is-offline', !navigator.onLine);
}

export function initPWA({ onBackOnline } = {}) {
  updateOnline();
  window.addEventListener('offline', updateOnline);
  window.addEventListener('online', () => {
    updateOnline();
    onBackOnline?.();
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();   // 不要跳出瀏覽器預設的提示，改成在設定頁顯示「安裝」按鈕
    deferredPrompt = e;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    requestPersist();
    emit();
  });

  if (!swSupported()) return;
  navigator.serviceWorker.register('./sw.js', {updateViaCache: 'none'}).then((reg) => {
    function notifyUpdate() {
      if (!reg.waiting || !navigator.serviceWorker.controller || document.getElementById('appUpdateNotice')) return;
      const notice = document.createElement('aside');
      notice.id = 'appUpdateNotice'; notice.className = 'update-notice'; notice.setAttribute('role', 'status');
      notice.textContent = '新版已準備好。請先確認資料已儲存，再關閉所有本網站分頁與主畫面 App，重新開啟即可更新。';
      document.body.append(notice);
    }
    notifyUpdate();
    reg.addEventListener('updatefound', () => reg.installing?.addEventListener('statechange', notifyUpdate));
  }).catch((err) => console.warn('Service Worker 註冊失敗', err));
  // 程式與單字包已由完整發布保存；另通知快取公開字型。
  navigator.serviceWorker.ready.then((reg) => {
    const urls = [location.href.split('#')[0], ...performance.getEntriesByType('resource').map((e) => e.name)];
    reg.active?.postMessage({ type: 'cache-urls', urls });
  });
  requestPersist();
}
