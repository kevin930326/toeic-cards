import json, os, re, sys, time
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'screenshots')
os.makedirs(OUT, exist_ok=True)
URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
GOOD_KEY = 'test-key-ok'
errors = []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        errors.append(msg)

# ---------- 假的 Gemini ----------
mode = {'429_once': False, 'always_429': False, 'drop': set(), 'truncate_over': 0}
gen_requests = []   # 每次 generateContent 的字數
all_urls = []
dict_calls = []

def card_for(w):
    return {
        'word': w, 'pos': 'v.', 'zh': f'v. {w}的多益意思\nn. 第二行',
        'en': f'simple meaning of {w}',
        'examples': [{'en': f'Please {w} the report.', 'zh': '請處理報告。'}, {'en': f'We {w} it.', 'zh': '我們處理了。'}],
        'collocations': [f'{w} a plan', f'{w} a request'],
        'forms': [f'{w}al (n.)'], 'synonyms': ['accept'],
    }

def gemini(route):
    req = route.request
    all_urls.append(req.url)
    key = req.headers.get('x-goog-api-key')
    def err(code, status, msg, details=None):
        body = {'error': {'code': code, 'status': status, 'message': msg}}
        if details: body['error']['details'] = details
        route.fulfill(status=code, content_type='application/json', body=json.dumps(body))
    if key != GOOD_KEY:
        return err(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.')
    if req.method == 'GET' and '/models' in req.url:
        models = [
            {'name': 'models/gemini-2.5-flash', 'supportedGenerationMethods': ['generateContent']},
            {'name': 'models/gemini-2.5-flash-lite', 'supportedGenerationMethods': ['generateContent']},
            {'name': 'models/gemini-2.5-pro', 'supportedGenerationMethods': ['generateContent']},
            {'name': 'models/gemini-3.5-flash', 'supportedGenerationMethods': ['generateContent']},
            {'name': 'models/gemini-3.5-flash-image', 'supportedGenerationMethods': ['generateContent']},
            {'name': 'models/gemini-embedding-001', 'supportedGenerationMethods': ['embedContent']},
        ]
        return route.fulfill(status=200, content_type='application/json', body=json.dumps({'models': models}))
    prompt = json.loads(req.post_data)['contents'][0]['parts'][0]['text']
    words = re.findall(r'^\d+\. (.+)$', prompt.split('Words:')[1], re.M)
    gen_requests.append(len(words))
    retry = [{'@type': 'type.googleapis.com/google.rpc.RetryInfo', 'retryDelay': '0.3s'}]
    if mode['always_429'] or mode['429_once']:
        mode['429_once'] = False
        return err(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded', retry)
    if mode['truncate_over'] and len(words) > mode['truncate_over']:
        text = json.dumps({'words': [card_for(w) for w in words]})[:300]
        finish = 'MAX_TOKENS'
    else:
        text = json.dumps({'words': [card_for(w) for w in words if w not in mode['drop']]})
        finish = 'STOP'
    route.fulfill(status=200, content_type='application/json', body=json.dumps(
        {'candidates': [{'content': {'parts': [{'text': text}]}, 'finishReason': finish}]}))

def fake_dict(route):
    dict_calls.append(route.request.url)
    route.fulfill(status=404, body='{}')

def words_db(page):
    return {w['word']: w for w in page.evaluate("JSON.parse(localStorage.getItem('toeic-cards:words') || '[]')")}

def set_settings(page, **kw):
    page.evaluate("""(kw) => {
      const s = JSON.parse(localStorage.getItem('toeic-cards:settings') || '{}');
      localStorage.setItem('toeic-cards:settings', JSON.stringify({ ...s, ...kw }));
    }""", kw)

def wait_idle(page, timeout=20000):
    page.wait_for_function("() => !document.querySelector('#aiBox')?.textContent.includes('AI 生成中')", timeout=timeout)

def add_batch(page, words):
    page.goto(URL + '#/words')
    if not page.locator('#batch').get_attribute('open') is not None:
        page.click('#batch summary')
    page.fill('#batchInput', '\n'.join(words))
    page.click('#batchAdd')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1100, 'height': 900})
    ctx.route('https://generativelanguage.googleapis.com/**', gemini)
    ctx.route('https://api.dictionaryapi.dev/**', fake_dict)
    page = ctx.new_page()
    page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append('console: ' + m.text))
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))

    # 1. 沒有金鑰
    page.goto(URL + '#/words')
    page.wait_for_load_state('networkidle')
    page.fill('#addInput', 'approve')
    page.press('#addInput', 'Enter')
    page.wait_for_timeout(400)
    check('前往設定' in page.locator('#aiBox').inner_text(), '沒金鑰時提示去設定')
    check(gen_requests == [], '沒金鑰時不會呼叫 Gemini')

    # 2. 設定：錯的金鑰 → 對的金鑰
    page.goto(URL + '#/settings')
    page.fill('#keyInput', 'bad-key')
    page.click('#keyForm button[type=submit]')
    page.wait_for_selector('#keyStatus[data-kind=error]')
    check('金鑰無效' in page.locator('#keyStatus').inner_text(), f"錯的金鑰顯示錯誤：{page.locator('#keyStatus').inner_text()}")
    page.fill('#keyInput', GOOD_KEY)
    page.click('#keyForm button[type=submit]')
    page.wait_for_selector('#keyStatus[data-kind=ok]')
    opts = page.locator('#modelSelect option').all_inner_texts()
    check(page.locator('#modelSelect').input_value() == 'gemini-3.5-flash', f"預設選最新 Flash：{page.locator('#modelSelect').input_value()}")
    check('gemini-3.5-flash-image' not in opts and 'gemini-embedding-001' not in opts, f'過濾掉圖片／嵌入模型 {opts}')
    check(page.evaluate("localStorage.getItem('toeic-cards:gemini-key')") == GOOD_KEY, '金鑰存在 localStorage')
    check('test' in page.locator('.key-state').inner_text() and GOOD_KEY not in page.locator('.key-state').inner_text(), '金鑰只顯示遮罩')
    page.select_option('#modelSelect', 'gemini-2.5-flash-lite')
    check(json.loads(page.evaluate("localStorage.getItem('toeic-cards:settings')"))['llmModel'] == 'gemini-2.5-flash-lite', '切換模型會儲存')
    page.select_option('#modelSelect', 'gemini-3.5-flash')
    page.click('.seg:has(input[name=llmRpm][value="15"])')
    check(json.loads(page.evaluate("localStorage.getItem('toeic-cards:settings')"))['llmRpm'] == 15, '速率設定會儲存')
    page.screenshot(path=os.path.join(OUT, 's4_settings.png'), full_page=True)
    set_settings(page, llmRpm=600)   # 測試時加快

    # 3. 生成既有的字（第一次 429，會自動重試）
    mode['429_once'] = True
    page.goto(URL + '#/words')
    page.reload()
    page.wait_for_load_state('networkidle')
    check('1 個字還沒有 AI 內容' in page.locator('#aiBox').inner_text(), '顯示未生成數量')
    page.click('#aiGen')
    wait_idle(page)
    a = words_db(page)['approve']
    check(gen_requests == [1, 1], f'429 後自動重試 {gen_requests}')
    check(a['llm']['status'] == 'done' and a['en'] == 'simple meaning of approve', 'approve 生成完成')
    check(a['zh'].startswith('v. approve的多益意思') and a['src']['zh'] == 'llm', 'AI 中文覆蓋字典中文')
    check(len(a['examples']) == 2 and a['collocations'] and a['forms'] == ['approveal (n.)'], '例句、搭配詞、詞性變化都有存')
    check('全部 1 個字都已經有 AI 內容' in page.locator('#aiBox').inner_text(), '顯示全部完成')
    check(page.locator('.word-row .badge-ai').count() == 1, '列表顯示 AI 標記')

    # 4. 批次 45 個字（自動生成），其中 zzfail 會被漏掉
    gen_requests.clear()
    dict_calls.clear()
    mode['drop'] = {'zzfail'}
    batch = [f'word{chr(97 + i // 26)}{chr(97 + i % 26)}' for i in range(44)] + ['zzfail']
    add_batch(page, batch)
    wait_idle(page)
    db = words_db(page)
    check(gen_requests == [20, 20, 5], f'每批最多 20 個字：{gen_requests}')
    check(sum(1 for w in batch if db[w]['llm'] and db[w]['llm']['status'] == 'done') == 44, '44 個字生成完成')
    check(db['zzfail']['llm']['status'] == 'failed', '漏掉的字標為失敗')
    check('1 個字生成失敗' in page.locator('#aiBox').inner_text(), '顯示失敗數量')
    check(page.locator('.word-row', has_text='zzfail').locator('.badge-fail').count() == 1, '失敗的字有標記')
    check(not dict_calls, f'有金鑰時不查 Free Dictionary（{len(dict_calls)} 次）')
    page.screenshot(path=os.path.join(OUT, 's4_failed.png'))

    # 單獨重試
    mode['drop'] = set()
    gen_requests.clear()
    page.locator('.word-row', has_text='zzfail').locator('[data-act=regen]').click()
    wait_idle(page)
    check(gen_requests == [1] and words_db(page)['zzfail']['llm']['status'] == 'done', '單獨重試失敗的字')

    # 5. 使用者改過的欄位不被 AI 覆蓋
    page.locator('.word-row', has_text='approve').locator('[data-act=edit]').click()
    page.fill('#editForm [name=zh]', 'v. 我自己的解釋')
    page.fill('#editForm [name=collocations]', 'my own collocation')
    page.click('#editForm button[type=submit]')
    page.evaluate("""() => {
      const ws = JSON.parse(localStorage.getItem('toeic-cards:words'));
      const a = ws.find((w) => w.word === 'approve'); a.llm = null; a.en = 'old';
      localStorage.setItem('toeic-cards:words', JSON.stringify(ws));
    }""")
    page.reload()
    page.wait_for_load_state('networkidle')
    page.click('#aiGen')
    wait_idle(page)
    a = words_db(page)['approve']
    check(a['zh'] == 'v. 我自己的解釋' and a['collocations'] == ['my own collocation'], '手動改過的中文、搭配詞保留')
    check(a['en'] == 'simple meaning of approve', '沒改過的英文解釋會更新')

    # 6. 回應被截斷 → 自動拆半重送
    gen_requests.clear()
    mode['truncate_over'] = 10
    add_batch(page, [f'trunc{chr(97 + i)}' for i in range(15)])
    wait_idle(page)
    db = words_db(page)
    check(gen_requests == [15, 8, 7], f'截斷時拆半重送：{gen_requests}')
    check(all(db[f'trunc{chr(97 + i)}']['llm']['status'] == 'done' for i in range(15)), '拆半後全部完成')
    mode['truncate_over'] = 0

    # 7. 額度用完（一直 429）→ 停下來、字不算失敗
    gen_requests.clear()
    mode['always_429'] = True
    add_batch(page, ['quotaone', 'quotatwo'])
    wait_idle(page, timeout=30000)
    db = words_db(page)
    check(len(gen_requests) == 4, f'429 最多重試 3 次（共 {len(gen_requests)} 次請求）')
    check('免費額度' in page.locator('.ai-error').inner_text(), f"顯示額度錯誤：{page.locator('.ai-error').inner_text()!r}")
    check(not db['quotaone'].get('llm'), '額度用完的字不算失敗，之後可以再生成')
    check('2 個字還沒有 AI 內容' in page.locator('#aiBox').inner_text(), '仍顯示 2 個待生成')
    mode['always_429'] = False

    # 8. 金鑰被改壞 → 停下來並提示
    page.evaluate("localStorage.setItem('toeic-cards:gemini-key', 'broken')")
    page.click('#aiGen')
    wait_idle(page)
    check('金鑰無效' in page.locator('.ai-error').inner_text(), '金鑰錯誤時提示')
    check('前往設定' in page.locator('.ai-error').inner_text(), '金鑰錯誤有設定連結')
    page.evaluate(f"localStorage.setItem('toeic-cards:gemini-key', '{GOOD_KEY}')")

    # 9. 限速等待時顯示倒數，可以停止
    set_settings(page, llmRpm=6)    # 每 10 秒一個請求
    page.reload()
    page.wait_for_load_state('networkidle')
    gen_requests.clear()
    add_batch(page, [f'slow{chr(97 + i)}' for i in range(25)])   # 會分 2 批
    page.wait_for_function("() => /等待 \\d+ 秒/.test(document.querySelector('#aiBox')?.textContent || '')", timeout=15000)
    check(True, '限速時顯示等待倒數')
    page.screenshot(path=os.path.join(OUT, 's4_waiting.png'))
    page.click('#aiStop')
    wait_idle(page)
    db = words_db(page)
    stopped_missing = sum(1 for i in range(25) if not db[f'slow{chr(97 + i)}'].get('llm'))
    check(stopped_missing > 0 and len(gen_requests) <= 1, f'停止後不再送請求（剩 {stopped_missing} 個未生成，{len(gen_requests)} 次請求）')
    set_settings(page, llmRpm=600)

    # 10. 字卡顯示 AI 內容
    page.goto(URL + '#/cards')
    page.reload()
    page.wait_for_load_state('networkidle')
    for _ in range(200):
        if page.locator('.card-front .headword').inner_text() == 'zzfail':
            break
        page.keyboard.press('ArrowRight')
    page.click('.seg:has(input[value=en])')
    page.click('#card')
    page.wait_for_timeout(700)
    back = page.locator('.card-back').inner_text()
    check('simple meaning of zzfail' in back and 'Please zzfail the report.' in back and 'zzfail a plan' in back, '卡片背面顯示 AI 解釋、例句、搭配詞')
    page.screenshot(path=os.path.join(OUT, 's4_card.png'))

    # 11. 金鑰不會出現在網址
    check(all('key=' not in u and GOOD_KEY not in u for u in all_urls), '金鑰沒有放在網址裡')

    browser.close()

print('\nERRORS:' if errors else '\nALL PASSED', *errors, sep='\n')
sys.exit(1 if errors else 0)
