from library_helpers import open_add, close_add, open_ai
import json, os, sys
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'screenshots')
os.makedirs(OUT, exist_ok=True)
URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
errors = []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        errors.append(msg)

# 假的 Free Dictionary API 回應，讓測試不依賴外部網路
FAKE = {
    'approve': [{'word': 'approve', 'phonetic': '/əˈpruːv/', 'meanings': [
        {'partOfSpeech': 'noun', 'definitions': [{'definition': 'WRONG noun sense'}]},
        {'partOfSpeech': 'verb', 'definitions': [{'definition': 'To officially agree to or accept.'}]},
    ]}],
    'invoice': [{'word': 'invoice', 'meanings': [
        {'partOfSpeech': 'noun', 'definitions': [{'definition': 'A bill for goods or services.'}]},
    ]}],
}

def fake_dict(route):
    word = route.request.url.rstrip('/').split('/')[-1]
    if word in FAKE:
        route.fulfill(status=200, content_type='application/json', body=json.dumps(FAKE[word]))
    else:
        route.fulfill(status=404, content_type='application/json', body='{"title":"No Definitions Found"}')

# 攔截語音播放，記錄唸了什麼、用什麼口音
SPEECH_STUB = """
window.__spoken = [];
if (window.speechSynthesis) {
  speechSynthesis.speak = (u) => window.__spoken.push({ text: u.text, lang: u.lang, rate: u.rate });
}
"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1100, 'height': 850})
    ctx.add_init_script(SPEECH_STUB)
    ctx.route('https://api.dictionaryapi.dev/**', fake_dict)
    page = ctx.new_page()
    page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append('console: ' + m.text))
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.goto(URL + '#/words')
    page.wait_for_load_state('networkidle')

    for w in ['approve', 'invoice', 'zzqxv']:
        open_add(page, 'single')
        page.fill('#addInput', w)
        open_add(page, 'single')
        page.press('#addInput', 'Enter')
        close_add(page)

    page.wait_for_function("""() => {
      const ws = JSON.parse(localStorage.getItem('toeic-cards:words') || '[]');
      return ws.length === 3 && ws.every((w) => w.lookup && w.lookup.dictAt);
    }""", timeout=15000)
    words = {w['word']: w for w in page.evaluate("JSON.parse(localStorage.getItem('toeic-cards:words'))")}

    a = words['approve']
    check('核准' in a['zh'], f"approve 中文（繁體）: {a['zh']!r}")
    check('vt.' in a['pos'], f"approve 詞性: {a['pos']!r}")
    check(a['phonetic'].startswith('/') and 'ə' in a['phonetic'], f"approve 音標: {a['phonetic']!r}")
    check(a['en'] == 'To officially agree to or accept.', f"英文解釋挑對詞性（動詞）: {a['en']!r}")
    check(a['src'].get('zh') == 'dict' and a['src'].get('en') == 'freedict', '記錄資料來源')
    check('發票' in words['invoice']['zh'], f"invoice 中文: {words['invoice']['zh']!r}")
    check(words['zzqxv']['zh'] == '' and words['zzqxv']['en'] == '', '查不到的字留空，不會壞掉')
    check(page.locator('.word-row', has_text='zzqxv').locator('.muted').inner_text() == '（尚無中文）', '查不到的字顯示「尚無中文」')
    check(not any('贊' != c and '赞' in c for c in a['zh']) and '赞' not in a['zh'], '沒有殘留簡體字')

    # 列表發音
    page.locator('.word-row', has_text='invoice').locator('[data-act=speak]').click()
    spoken = page.evaluate('window.__spoken')
    check(spoken and spoken[-1]['text'] == 'invoice' and spoken[-1]['lang'] == 'en-US', f'列表發音 {spoken}')

    # 使用者手動改過的中文不會被字典覆蓋
    row = page.locator('.word-row', has_text='invoice')
    row.locator('[data-act=edit]').click()
    page.fill('#editForm [name=zh]', 'n. 請款單')
    page.click('#editForm button[type=submit]')
    page.evaluate("""() => {
      const ws = JSON.parse(localStorage.getItem('toeic-cards:words'));
      ws.forEach((w) => { w.lookup = {}; });   // 假裝都沒查過
      localStorage.setItem('toeic-cards:words', JSON.stringify(ws));
    }""")
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1500)
    inv = [w for w in page.evaluate("JSON.parse(localStorage.getItem('toeic-cards:words'))") if w['word'] == 'invoice'][0]
    check(inv['zh'] == 'n. 請款單' and inv['src']['zh'] == 'user', f"手動修改不被覆蓋: {inv['zh']!r}")

    # 探索：音標、發音、多行中文與英文同時顯示。
    page.goto(URL + '#/cards')
    page.wait_for_load_state('networkidle')
    page.locator('.explore-item').filter(has_text='approve').click()
    check(page.locator('.explore-entry-head .phonetic').inner_text() == a['phonetic'], '探索顯示音標')
    page.click('.explore-entry-head [data-speak]')
    check(page.locator('#card').count() == 0, '探索發音不需要翻面')
    check(page.evaluate('window.__spoken')[-1]['text'] == 'approve', '探索單字發音')
    before = len(page.evaluate('window.__spoken'))
    page.keyboard.press('p')
    after = page.evaluate('window.__spoken')
    check(len(after) == before + 1 and after[-1]['text'] == 'approve', 'P 鍵發音')
    check(page.locator('.explore-reading .zh-pos').count() == 2, '多詞性分行顯示（vt. / vi.）')
    check('officially agree' in page.locator('.back-en').inner_text(), '探索同時顯示 Free Dictionary 英文解釋')
    page.screenshot(path=os.path.join(OUT, 's2_explore.png'))

    # 設定：英式口音、速度
    page.goto(URL + '#/settings')
    page.click('.seg:has(input[name=accent][value="en-GB"])')
    page.click('.seg:has(input[name=speechRate][value="0.7"])')
    page.click('#testSpeak')
    last = page.evaluate('window.__spoken')[-1]
    check(last['lang'] == 'en-GB' and abs(last['rate'] - 0.7) < 0.01, f'口音與速度設定生效 {last}')
    page.screenshot(path=os.path.join(OUT, 's2_settings.png'))

    # 前端只下載用到的字母檔
    reqs = []
    p2 = ctx.new_page()
    p2.on('request', lambda r: '/data/dict/' in r.url and reqs.append(r.url.split('/')[-1]))
    p2.goto(URL + '#/cards')
    p2.wait_for_load_state('networkidle')
    p2.evaluate("""() => { const ws = JSON.parse(localStorage.getItem('toeic-cards:words')); }""")
    print('dict requests on load:', reqs)

    # API 掛掉（522）時：不會壞掉，之後重新開啟網站會再重試英文解釋
    p3 = ctx.new_page()
    ctx.unroute('https://api.dictionaryapi.dev/**')
    ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=522, body='down'))
    p3.goto(URL + '#/words')
    p3.wait_for_load_state('networkidle')
    open_add(p3, 'single')
    p3.fill('#addInput', 'schedule')
    open_add(p3, 'single')
    p3.press('#addInput', 'Enter')
    close_add(p3)
    p3.wait_for_function("""() => JSON.parse(localStorage.getItem('toeic-cards:words')).find((w) => w.word === 'schedule')?.lookup?.dictAt""", timeout=10000)
    sch = [w for w in p3.evaluate("JSON.parse(localStorage.getItem('toeic-cards:words'))") if w['word'] == 'schedule'][0]
    check(sch['zh'] != '' and sch['en'] == '' and sch['lookup']['enDone'] is False, 'API 掛掉時：中文照樣有、英文標記待重試')
    ctx.unroute('https://api.dictionaryapi.dev/**')
    ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=200, content_type='application/json',
        body=json.dumps([{'word': 'schedule', 'meanings': [{'partOfSpeech': 'noun', 'definitions': [{'definition': 'A plan of times.'}]}]}])))
    p3.reload()
    p3.wait_for_function("""() => JSON.parse(localStorage.getItem('toeic-cards:words')).find((w) => w.word === 'schedule')?.en""", timeout=10000)
    check(True, 'API 恢復後重新開啟網站，自動補上英文解釋')

    browser.close()

print('\nERRORS:' if errors else '\nALL PASSED', *errors, sep='\n')
sys.exit(1 if errors else 0)
