// Service Worker：讓網站可以安裝成 App，並在沒有網路時照常使用
//
// 快取策略：
//   - 網站本身的檔案（HTML／CSS／JS／圖示）：先連網，連不上（或超過 4 秒）才用快取
//       → 有網路時一定是最新版，不需要手動更新版本號；離線時用上次的版本
//   - 字典檔 data/dict/*.json：有快取就用快取（內容幾乎不變、檔案比較大）
//   - Google Fonts、Firebase SDK：有快取就用快取（網址本身就帶版本）
//   - Gemini、Free Dictionary 等 API：一律不快取，直接連網
//
// 字典重新產生時，把 DICT_CACHE 的版本號 +1，舊的字典快取就會被清掉。
const SHELL_CACHE = 'toeic-shell-v1';
const DICT_CACHE = 'toeic-dict-v1';
const FONT_CACHE = 'toeic-fonts-v1';
const LIB_CACHE = 'toeic-lib-v1';   // Firebase SDK（網址帶版本號，內容不會變）
const KEEP = [SHELL_CACHE, DICT_CACHE, FONT_CACHE, LIB_CACHE];
const NETWORK_TIMEOUT = 4000;

// 安裝時先存好首頁；其他檔案在網頁載入後由頁面告訴我們要存哪些（見 js/pwa.js）
const CORE = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(CORE)));
  self.skipWaiting();   // 新版馬上生效（網站檔案本來就是先連網，不會新舊混用）
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('toeic-') && !KEEP.includes(name)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

// 頁面載入完成後，把用到的檔案清單傳過來，一次存進快取（第一次開網站時 Service Worker 還沒接手）
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'cache-urls') {
    event.waitUntil(cacheUrls(event.data.urls || []));
  }
});

async function cacheUrls(urls) {
  const shell = await caches.open(SHELL_CACHE);
  const fonts = await caches.open(FONT_CACHE);
  await Promise.all(urls.map(async (u) => {
    try {
      const url = new URL(u, self.location.href);
      if (url.origin === self.location.origin) {
        if (url.pathname.includes('/data/dict/')) return;   // 字典檔另外處理
        // 程式版本由查詢參數區分，不能拿舊版檔案視為已快取新版。
        if (!(await shell.match(url.href))) await shell.add(url.href);
      } else if (isFont(url)) {
        // 字型的 CSS（fonts.googleapis.com）是用 <link> 跨網站載入的「不透明」回應，要用 no-cors 抓；
        // 字型檔本身（fonts.gstatic.com）瀏覽器是用 CORS 方式要的，存的也必須是 CORS 回應，否則會被拒絕
        const mode = url.hostname === 'fonts.gstatic.com' ? 'cors' : 'no-cors';
        if (!(await fonts.match(url.href))) await fonts.put(url.href, await fetch(url.href, { mode }));
      }
    } catch (e) {
      // 單一檔案存不了不影響其他檔案
    }
  }));
}

function isFirebaseSdk(url) {
  return url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
}

function isFont(url) {
  return url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.includes('/data/dict/')) event.respondWith(cacheFirst(req, DICT_CACHE));
    else event.respondWith(networkFirst(req));
  } else if (isFont(url)) {
    event.respondWith(cacheFirst(req, FONT_CACHE));
  } else if (isFirebaseSdk(url)) {
    event.respondWith(cacheFirst(req, LIB_CACHE));
  }
  // 其他（Gemini、Free Dictionary、Firebase 的資料連線）不處理，照常連網
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  const network = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  network.catch(() => {});   // 離線時這個請求一定失敗，避免出現「未處理的錯誤」
  try {
    // 網路太慢時（例如訊號很差），4 秒後改用快取；網路之後回來還是會更新快取
    return await Promise.race([
      network,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT)),
    ]);
  } catch (e) {
    const hit = await cache.match(req);
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const home = await cache.match('./index.html') || await cache.match('./');
      if (home) return home;
    }
    try { return await network; } catch (err) { return Response.error(); }
  }
}
