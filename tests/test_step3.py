from onboarding_helpers import existing_user
from library_helpers import open_add, close_add, open_ai
import json, os, sys, time
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'screenshots')
os.makedirs(OUT, exist_ok=True)
URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
errors = []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        errors.append(msg)

api_calls = []

def slow_dict(route):
    # 模擬比較慢的 Free Dictionary API（每個 150ms）
    word = route.request.url.rstrip('/').split('/')[-1]
    api_calls.append(word)
    time.sleep(0.15)
    route.fulfill(status=200, content_type='application/json', body=json.dumps(
        [{'word': word, 'meanings': [{'partOfSpeech': 'noun', 'definitions': [{'definition': f'meaning of {word}'}]}]}]))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1100, 'height': 900})
    existing_user(ctx)
    ctx.add_init_script('window.__toeicFirebaseConfig = null;')
    ctx.route('https://api.dictionaryapi.dev/**', slow_dict)
    page = ctx.new_page()
    page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append('console: ' + m.text))
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.goto(URL + '#/words')
    page.wait_for_load_state('networkidle')

    # ---- 拆字規則 ----
    cases = [
        ('approve, deadline, invoice', ['approve', 'deadline', 'invoice']),
        ('approve deadline invoice', ['approve', 'deadline', 'invoice']),
        ('1. reimbursement 報銷\n2) itinerary 行程', ['reimbursement', 'itinerary']),
        ('take over\nlook forward to\nin charge of', ['take over', 'look forward to', 'in charge of']),
        ('- approve\n• follow-up\na. b.', ['approve', 'follow-up']),
        ('merger；refund、warranty\tpayroll/agenda', ['merger', 'refund', 'warranty', 'payroll', 'agenda']),
        ('Approve\nAPPROVE', ['approve', 'approve']),
    ]
    for text, want in cases:
        got = page.evaluate("async (t) => (await import('/js/parse.js')).splitWords(t)", text)
        check(got == want, f'拆字 {text!r} → {got}')
    r = page.evaluate("async () => (await import('/js/parse.js')).analyzeInput('Approve, approve, invoice, deadline', ['invoice'])")
    check(r == {'fresh': ['approve', 'deadline'], 'dupes': ['approve'], 'existing': ['invoice']}, f'analyzeInput {r}')

    # ---- 先加一個字 ----
    open_add(page, 'single')
    page.fill('#addInput', 'invoice')
    open_add(page, 'single')
    page.press('#addInput', 'Enter')
    close_add(page)
    page.wait_for_timeout(500)

    # ---- 批次新增介面 ----
    open_add(page, 'batch')
    check(page.locator('#batchInput').is_visible(), '展開批次新增')
    check(page.locator('#batchAdd').is_disabled(), '沒輸入時「加入」按鈕停用')
    open_add(page, 'batch')
    page.fill('#batchInput', '1. Approve 批准\n2. deadline\n3. invoice\napprove, merger refund\ntake over')
    preview = page.locator('#batchPreview').inner_text()
    check('將新增 5 個字' in preview, f'預覽新增數 ({preview[:40]!r})')
    check('已在字卡裡，略過 1 個' in preview, '預覽顯示已存在的字')
    check('重複' in preview and '1 個' in preview, '預覽顯示重複的字')
    check(page.locator('#batchAdd').inner_text() == '加入 5 個字', '按鈕顯示數量')
    page.screenshot(path=os.path.join(OUT, 's3_preview.png'), full_page=True)
    open_add(page, 'batch')
    page.click('#batchAdd')
    close_add(page)
    check(page.locator('#batchInput').input_value() == '', '加入後清空文字框')
    words = [w.lower() for w in page.locator('.word-en').all_inner_texts()]
    check(sorted(words) == sorted(['invoice', 'approve', 'deadline', 'merger', 'refund', 'take over']), f'列表內容 {words}')
    page.wait_for_function("() => !document.querySelector('#lookupProgress') || document.querySelector('#lookupProgress').hidden", timeout=15000)

    # ---- 大量新增：100 個字 ----
    sample = page.evaluate("async () => Object.keys(await (await fetch('/data/dict/c.json')).json()).filter(w => !w.includes(' ')).slice(200, 300)")
    api_calls.clear()
    open_add(page, 'batch')
    page.fill('#batchInput', '\n'.join(sample))
    t0 = time.time()
    open_add(page, 'batch')
    page.click('#batchAdd')
    close_add(page)
    page.wait_for_selector('#lookupProgress:not([hidden])', timeout=3000)
    page.wait_for_function(f"""() => {{
      const ws = JSON.parse(localStorage.getItem('toeic-cards:words'));
      const batch = ws.filter((w) => {json.dumps(sample)}.includes(w.word));
      return batch.length === 100 && batch.every((w) => w.zh);
    }}""", timeout=5000)
    t_zh = time.time() - t0
    check(t_zh < 3, f'100 個字的中文在 {t_zh:.2f} 秒內全部出現')
    progress_text = page.locator('#progressText').inner_text()
    check('/ 100' in progress_text and '英文解釋' in progress_text, f'進度顯示 {progress_text!r}')
    page.screenshot(path=os.path.join(OUT, 's3_progress.png'))
    check(len(api_calls) < 100, f'英文解釋是排隊慢慢查的（目前已送出 {len(api_calls)} 個）')
    page.wait_for_selector('#lookupProgress[hidden]', state='attached', timeout=120000)
    t_all = time.time() - t0
    check(len(set(api_calls)) == 100 and len(api_calls) == 100, f'每個字只查一次英文（{len(api_calls)} 次，{t_all:.1f} 秒）')
    ws = page.evaluate("JSON.parse(localStorage.getItem('toeic-cards:words'))")
    check(len(ws) == 106 and all(w['lookup'].get('dictAt') for w in ws), '106 個字全部查完')

    # 再貼一次同樣的字：全部略過
    open_add(page, 'batch')
    page.fill('#batchInput', '\n'.join(sample[:10]))
    check('沒有新的字可以加入' in page.locator('#batchPreview').inner_text() and page.locator('#batchAdd').is_disabled(), '再貼一次全部被略過')

    # 單個輸入框也能貼多個字
    open_add(page, 'single')
    page.fill('#addInput', 'agenda, payroll')
    open_add(page, 'single')
    page.press('#addInput', 'Enter')
    close_add(page)
    check(page.locator('.word-en', has_text='payroll').count() == 1 and page.locator('.word-en', has_text='agenda').count() == 1, '單個輸入框貼多個字')

    # 重新整理後：批次面板不會殘留錯誤，資料都在
    page.reload()
    page.wait_for_load_state('networkidle')
    check(page.locator('.word-row').count() == 100 and page.evaluate("JSON.parse(localStorage.getItem('toeic-cards:words')).length") == 108, '重新整理後 108 個字都在，首頁顯示 100 字')

    # 手機版面
    m = ctx.new_page()
    m.set_viewport_size({'width': 375, 'height': 812})
    m.goto(URL + '#/words')
    m.wait_for_load_state('networkidle')
    open_add(m, 'batch')
    open_add(m, 'batch')
    m.fill('#batchInput', 'approve deadline brand-new words here')
    sw = m.evaluate('document.documentElement.scrollWidth')
    check(sw <= 375, f'手機無橫向捲動 {sw}')
    m.screenshot(path=os.path.join(OUT, 's3_mobile.png'))

    browser.close()

print('\nERRORS:' if errors else '\nALL PASSED', *errors, sep='\n')
sys.exit(1 if errors else 0)
