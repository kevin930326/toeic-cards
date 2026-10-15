from onboarding_helpers import existing_user
from library_helpers import open_add, close_add, open_ai
"""部署後檢查：對真正的 GitHub Pages 網址做一次冒煙測試（子路徑 /toeic-cards/、HTTPS、Service Worker、離線）

用法：
  python tests/test_deployed.py                       # 預設檢查 https://kevin930326.github.io/toeic-cards/
  DEPLOY_URL=https://.../ python tests/test_deployed.py
"""
import os, sys
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'screenshots')
os.makedirs(OUT, exist_ok=True)
URL = os.environ.get('DEPLOY_URL', 'https://kevin930326.github.io/toeic-cards/')
errors = []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        errors.append(msg)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1000, 'height': 900}, service_workers='allow')
    existing_user(ctx)
    ctx.add_init_script('if (window.speechSynthesis) speechSynthesis.speak = () => {};')
    page = ctx.new_page()
    failed = []
    page.on('console', lambda m: m.type == 'error' and errors.append('console: ' + m.text))
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.on('response', lambda r: r.status >= 400 and 'dictionaryapi' not in r.url and failed.append(f'{r.status} {r.url}'))
    page.goto(URL)
    page.wait_for_load_state('networkidle')

    check(page.title().startswith('多益字卡'), f'網站打得開：{page.title()}')
    check(page.evaluate('window.isSecureContext') and page.url.startswith('https://'), 'HTTPS（PWA 離線功能需要）')
    check(not failed, f'沒有 404 等載入失敗的檔案 {failed[:5]}')

    # 子路徑：manifest、圖示、字典檔都要用相對路徑找得到
    man = page.evaluate("fetch(document.querySelector('link[rel=manifest]').href).then((r) => r.json())")
    check(man['scope'] == './' and man['start_url'].startswith('./'), 'manifest 使用相對路徑')
    ok_icon = page.evaluate("fetch('icons/icon-512.png').then((r) => r.ok)")
    check(ok_icon, '圖示在子路徑下找得到')

    # 新增單字 → 本機字典查得到中文（data/dict/ 在子路徑下）
    page.goto(URL + '#/words')
    open_add(page, 'single')
    page.fill('#addInput', 'approve')
    open_add(page, 'single')
    page.press('#addInput', 'Enter')
    close_add(page)
    page.wait_for_function("() => JSON.parse(localStorage.getItem('toeic-cards:words') || '[]').find((w) => w.word === 'approve')?.zh", timeout=15000)
    zh = page.evaluate("JSON.parse(localStorage.getItem('toeic-cards:words')).find((w) => w.word === 'approve').zh")
    check('核准' in zh, f'字典在子路徑下可以查：{zh!r}')

    # Service Worker 的範圍是 /toeic-cards/，而且會接手
    page.evaluate('navigator.serviceWorker.ready')
    scope = page.evaluate('navigator.serviceWorker.ready.then((r) => r.scope)')
    check(scope == URL, f'Service Worker 範圍正確：{scope}')
    page.reload()
    page.wait_for_load_state('networkidle')
    check(page.evaluate('!!navigator.serviceWorker.controller'), 'Service Worker 接手網頁')
    page.wait_for_function("""async () => {
      const c = await caches.open('toeic-shell-v1');
      return !!(await c.match(new URL('js/views/quiz.js', location.href).href));
    }""", timeout=20000)

    # 真正離線：重新整理仍然可以使用
    ctx.set_offline(True)
    page.goto(URL + '#/review')
    page.reload()
    page.wait_for_selector('.card-front .headword', timeout=15000)
    check(page.locator('.card-front .headword').inner_text() == 'approve', '離線時重新整理，網站照常開啟並可以複習')
    check(page.locator('#offlineBar').is_visible(), '離線提示列')
    page.screenshot(path=os.path.join(OUT, 'deployed_offline.png'))
    ctx.set_offline(False)

    # 設定頁：HTTPS 下不會出現「離線功能無法使用」
    page.goto(URL + '#/settings')
    page.wait_for_selector('#pwaPanel .panel-title')
    check('離線功能無法使用' not in page.locator('#pwaPanel').inner_text(), 'HTTPS 下沒有「離線功能無法使用」的警告')

    # 手機版面
    m = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True,
                            user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
    existing_user(m)
    mp = m.new_page()
    mp.goto(URL + '#/settings')
    mp.wait_for_selector('#pwaPanel .steps')
    check('加入主畫面' in mp.locator('#pwaPanel').inner_text(), 'iPhone 顯示加入主畫面教學')
    check(mp.evaluate('document.documentElement.scrollWidth') <= 390, '手機無橫向捲動')
    m.close()

    browser.close()

# Service Worker 在離線時抓不到的請求會在主控台留下網路錯誤，這是預期的，不算失敗。
# Free Dictionary API 是外部服務，它掛掉時（例如回應 522、沒有 CORS 標頭）網站會之後自動重試，也不算這個網站的錯。
external = [e for e in errors if 'api.dictionaryapi.dev' in e]
if external:
    print('WARN 外部服務 Free Dictionary API 目前無法使用（網站會在之後自動重試英文解釋）')
errors = [e for e in errors if 'ERR_INTERNET_DISCONNECTED' not in e and 'Failed to load resource' not in e and e not in external]
print('\nERRORS:' if errors else '\nALL PASSED', *errors, sep='\n')
sys.exit(1 if errors else 0)
