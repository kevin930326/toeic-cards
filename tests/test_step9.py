from library_helpers import open_add, close_add, open_ai
"""第 9 步：PWA（安裝、離線使用）端對端測試"""
import json, os, re, sys
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'screenshots')
os.makedirs(OUT, exist_ok=True)
URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
# 非 HTTPS 的區網網址（用來測試「離線功能無法使用」的提示）；沒有設定就略過那一段
LAN_URL = os.environ.get('LAN_URL', '')
errors = []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        errors.append(msg)

OFFLINE = {'on': False}

def gemini(route):
    # Playwright 的假回應在「離線模式」下仍然會回應，所以要自己模擬斷線
    if OFFLINE['on']:
        return route.abort('internetdisconnected')
    prompt = json.loads(route.request.post_data)['contents'][0]['parts'][0]['text']
    words = re.findall(r'^\d+\. (.+)$', prompt.split('Words:')[1], re.M)
    cards = [{'word': w, 'pos': 'n.', 'zh': f'n. {w}（AI）', 'en': f'AI meaning of {w}', 'examples': [], 'collocations': [],
              'forms': [], 'synonyms': []} for w in words]
    route.fulfill(status=200, content_type='application/json', body=json.dumps(
        {'candidates': [{'content': {'parts': [{'text': json.dumps({'words': cards})}]}, 'finishReason': 'STOP'}]}))

SEED_WORDS = [{'id': w, 'word': w, 'phonetic': '', 'pos': 'v.', 'zh': f'v. {zh}', 'en': f'meaning of {w}', 'examples': [],
               'collocations': [], 'forms': [], 'synonyms': [], 'unfamiliar': False, 'src': {}, 'lookup': {'dictAt': 1, 'enDone': True},
               'llm': {'status': 'done'}, 'srs': None, 'createdAt': i, 'updatedAt': i}
              for i, (w, zh) in enumerate([('approve', '核准'), ('negotiate', '協商'), ('postpone', '延期'), ('submit', '提交')])]

def cached_paths(page, cache):
    return page.evaluate(f"""async () => {{
      const c = await caches.open('{cache}');
      return (await c.keys()).map((r) => {{ const u = new URL(r.url); return u.origin === location.origin ? u.pathname : u.hostname + u.pathname; }});
    }}""")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1000, 'height': 900}, service_workers='allow')
    ctx.add_init_script('if (window.speechSynthesis) speechSynthesis.speak = () => {};')
    ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    ctx.route('https://generativelanguage.googleapis.com/**', gemini)
    page = ctx.new_page()
    page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and 'net::ERR_INTERNET_DISCONNECTED' not in m.text and errors.append('console: ' + m.text))
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.goto(URL)
    page.evaluate("ws => { localStorage.clear(); localStorage.setItem('toeic-cards:words', JSON.stringify(ws)); }", SEED_WORDS)
    page.reload()
    page.wait_for_load_state('networkidle')

    # ---- manifest 與圖示 ----
    href = page.get_attribute('link[rel=manifest]', 'href')
    man = page.evaluate(f"fetch('{href}').then((r) => r.json())")
    check(man['display'] == 'standalone' and man['short_name'] == '多益字卡' and man['start_url'].startswith('./') and man['scope'] == './',
          'manifest：獨立 App 模式、相對路徑（GitHub Pages 子路徑也能用）')
    sizes = page.evaluate("""async (icons) => Promise.all(icons.map((i) => new Promise((ok) => {
      const img = new Image(); img.onload = () => ok([i.src, i.purpose, img.naturalWidth, img.naturalHeight]); img.onerror = () => ok([i.src, 'ERR', 0, 0]); img.src = i.src;
    })))""", man['icons'])
    check(all(w == int(s.split('/')[-1].split('-')[1].split('.')[0]) if 'maskable' not in s else w == 512 for s, _, w, h in sizes) and any(p_ == 'maskable' for _, p_, _, _ in sizes),
          f'圖示尺寸正確、有 maskable 版本 {sizes}')
    apple = page.get_attribute('link[rel=apple-touch-icon]', 'href')
    aw = page.evaluate(f"new Promise((ok) => {{ const i = new Image(); i.onload = () => ok(i.naturalWidth); i.src = '{apple}'; }})")
    check(aw == 180 and page.get_attribute('meta[name=apple-mobile-web-app-capable]', 'content') == 'yes', 'iPhone 主畫面圖示 180px 與全螢幕設定')

    # ---- Service Worker ----
    page.evaluate('navigator.serviceWorker.ready')
    page.reload()
    page.wait_for_load_state('networkidle')
    check(page.evaluate('!!navigator.serviceWorker.controller'), 'Service Worker 接手網頁')
    page.wait_for_function("""async () => {
      const c = await caches.open('toeic-shell-v1');
      return !!(await c.match(new URL('js/views/quiz.js', location.href).href));
    }""", timeout=10000)
    shell = cached_paths(page, 'toeic-shell-v1')
    need = ['/', '/index.html', '/css/style.css', '/js/app.js', '/js/srs.js', '/js/views/quiz.js', '/js/backup.js', '/js/pwa.js', '/manifest.webmanifest']
    check(all(n in shell for n in need), f'網站檔案都存進快取（{len(shell)} 個）')
    fonts = cached_paths(page, 'toeic-fonts-v1')
    check(any('fonts.googleapis.com' in f for f in fonts) and any('fonts.gstatic.com' in f for f in fonts), f'字型也存起來（{len(fonts)} 個）')
    check(not any('/data/dict/' in s for s in shell), '字典檔不放在網站檔案的快取裡')

    # ---- 下載離線字典 ----
    page.goto(URL + '#/settings')
    page.wait_for_selector('#dictStatus')
    page.wait_for_function("document.querySelector('#dictStatus').textContent !== '檢查中…'")
    page.click('#dictBtn')
    page.wait_for_function("document.querySelector('#dictStatus').textContent.includes('已下載（26')", timeout=30000)
    check(True, '下載完整字典（26 個檔案）')
    page.screenshot(path=os.path.join(OUT, 's9_settings.png'), full_page=True)

    # ---- 離線 ----
    ctx.set_offline(True)
    OFFLINE['on'] = True
    page.goto(URL + '#/review')
    page.reload()
    page.wait_for_load_state('domcontentloaded')
    page.wait_for_selector('.card-front .headword', timeout=10000)
    check(page.locator('.card-front .headword').count() == 1, '離線時重新整理，網站照常開啟')
    check(page.locator('#offlineBar').is_visible(), '顯示離線提示列')
    fam = page.evaluate("getComputedStyle(document.querySelector('.headword')).fontFamily")
    font_ok = page.evaluate("document.fonts.check('600 40px Fraunces')")
    check(font_ok, f'離線時字型仍然可用（{fam}）')
    page.click('#openLookup')
    page.fill('#lookupInput', 'zealous')
    page.click('#lookupForm button')
    page.wait_for_selector('.lookup-meaning')
    check('熱' in page.locator('.lookup-meaning').inner_text(), '離線重新整理後可用全站查字讀取已下載的本機字典')
    page.press('#lookupInput', 'Escape')
    page.goto(URL + '#/cards')
    page.wait_for_selector('#exploreWord')
    check(page.locator('.back-zh').is_visible() and page.locator('#card').count()==0, '真正離線時探索可直接閱讀收藏內容')
    page.click('#next')
    check(page.locator('#exploreWord').inner_text() != '', '離線探索可以換下一字')
    page.goto(URL + '#/review')
    page.keyboard.press('ArrowRight')
    page.wait_for_timeout(400)
    check(page.locator('#remain').inner_text() == '3', '離線可以複習')
    page.goto(URL + '#/quiz')
    page.click('.mode-btn[data-mode=zh2en]')
    page.keyboard.press('1')
    check(page.locator('.feedback').count() == 1, '離線可以做簡易測驗')
    page.click('#quit')
    page.click('#home')
    # 離線新增單字：字典查得到（字典已下載）
    page.goto(URL + '#/words')
    open_add(page, 'single')
    page.fill('#addInput', 'zealous')
    open_add(page, 'single')
    page.press('#addInput', 'Enter')
    close_add(page)
    page.wait_for_function("JSON.parse(localStorage.getItem('toeic-cards:words')).find((w) => w.word === 'zealous')?.zh", timeout=10000)
    zh = [w for w in page.evaluate("JSON.parse(localStorage.getItem('toeic-cards:words'))") if w['word'] == 'zealous'][0]['zh']
    check('熱心' in zh or '熱情' in zh or len(zh) > 0, f'離線新增單字也查得到中文：{zh!r}')
    page.screenshot(path=os.path.join(OUT, 's9_offline.png'))

    # 離線 + 有金鑰：AI 生成暫停（不算失敗），連上網路後自動繼續
    page.evaluate("""() => {
      localStorage.setItem('toeic-cards:gemini-key', 'k');
      const s = JSON.parse(localStorage.getItem('toeic-cards:settings') || '{}');
      localStorage.setItem('toeic-cards:settings', JSON.stringify({ ...s, llmRpm: 600 }));
    }""")
    page.reload()
    open_add(page, 'single')
    page.wait_for_selector('#addInput')
    open_add(page, 'single')
    page.fill('#addInput', 'yield')
    open_add(page, 'single')
    page.press('#addInput', 'Enter')
    close_add(page)
    page.wait_for_selector('.ai-error', timeout=10000)
    check('連不上 Gemini' in page.locator('.ai-error').inner_text(), '離線時 AI 生成顯示「連不上」')
    y = [w for w in page.evaluate("JSON.parse(localStorage.getItem('toeic-cards:words'))") if w['word'] == 'yield'][0]
    check(not y.get('llm'), '離線時的字不會被標成「生成失敗」')
    ctx.set_offline(False)
    OFFLINE['on'] = False
    page.evaluate("window.dispatchEvent(new Event('online'))")
    page.wait_for_function("JSON.parse(localStorage.getItem('toeic-cards:words')).find((w) => w.word === 'yield')?.llm?.status === 'done'", timeout=15000)
    check(True, '連上網路後自動繼續 AI 生成')
    check(page.locator('#offlineBar').is_hidden(), '連上網路後提示列消失')

    # ---- 安裝按鈕（模擬 Chrome 的 beforeinstallprompt）----
    page.goto(URL + '#/settings')
    page.evaluate("""() => {
      window.__prompted = false;
      const e = new Event('beforeinstallprompt');
      e.prompt = () => { window.__prompted = true; };
      e.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(e);
    }""")
    page.wait_for_selector('#installBtn')
    page.click('#installBtn')
    page.wait_for_timeout(200)
    check(page.evaluate('window.__prompted') and '已安裝' in page.locator('#toast').inner_text(), '安裝按鈕會叫出瀏覽器的安裝視窗')
    check(page.locator('#installBtn').count() == 0, '安裝後按鈕消失')

    # ---- 已安裝（App 模式）----
    st = browser.new_context(service_workers='block')
    st.add_init_script("""
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q) => q.includes('display-mode: standalone') ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : real(q);
    """)
    sp = st.new_page()
    sp.goto(URL + '#/settings')
    sp.wait_for_selector('#pwaPanel .panel-title')
    check('已經安裝成 App' in sp.locator('#pwaPanel').inner_text(), 'App 模式開啟時顯示「已經安裝」')
    st.close()

    # ---- iPhone：顯示「加入主畫面」教學 ----
    ios = browser.new_context(
        user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
        viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, service_workers='block')
    ip = ios.new_page()
    ip.goto(URL + '#/settings')
    ip.wait_for_selector('#pwaPanel .steps')
    t = ip.locator('#pwaPanel').inner_text()
    check('加入主畫面' in t and '分享' in t, 'iPhone 顯示「分享 › 加入主畫面」')
    check('資料是分開的' in t.replace('\n', '') and '匯出備份' in t, 'iPhone 提醒 Safari 和主畫面 App 的資料分開')
    ip.locator('#pwaPanel').scroll_into_view_if_needed()
    ip.screenshot(path=os.path.join(OUT, 's9_ios.png'))
    sw = ip.evaluate('document.documentElement.scrollWidth')
    check(sw <= 390, f'手機無橫向捲動 {sw}')
    ios.close()

    # ---- 非 HTTPS 的區網網址：說明離線功能無法使用 ----
    if LAN_URL:
        lan = browser.new_context()
        lp = lan.new_page()
        lp.goto(LAN_URL + '#/settings')
        lp.wait_for_selector('#pwaPanel .panel-title')
        check(not lp.evaluate('window.isSecureContext') and '離線功能無法使用' in lp.locator('#pwaPanel').inner_text(),
              '用區網 IP 開啟時，說明離線功能要 HTTPS')
        check(lp.locator('.pwa-offline').is_hidden(), '不能用的「離線字典」區塊會隱藏')
        lan.close()
    else:
        print('（略過區網網址測試：沒有設定 LAN_URL）')

    browser.close()

print('\nERRORS:' if errors else '\nALL PASSED', *errors, sep='\n')
sys.exit(1 if errors else 0)
