"""Part 5 不用乾等：先開考邊考邊補、分階段進度、背景補題與每日上限、題目全被覆核刷掉時說明原因"""
import json, os, re, sys, time
from playwright.sync_api import sync_playwright
from onboarding_helpers import existing_user
from storage_helpers import flush
from shots import doc_shot

URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'screenshots')
os.makedirs(OUT, exist_ok=True)
KEY = 'test-key-fast'
errors = []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        errors.append(msg)

WORDS = ['approve', 'negotiate', 'postpone', 'submit', 'review', 'confirm', 'schedule', 'reserve',
         'invoice', 'deadline', 'itinerary', 'receipt', 'budget', 'contract', 'proposal', 'warranty']
def make(word, i):
    pos = 'v.' if i < 8 else 'n.'
    return {'id': word, 'word': word, 'phonetic': '', 'pos': pos, 'zh': f'{pos} 測試{i}', 'en': f'Meaning {i}.',
            'examples': [], 'collocations': [], 'forms': [], 'synonyms': [], 'unfamiliar': False,
            'src': {}, 'lookup': {'dictAt': 1, 'enDone': True}, 'llm': {'status': 'done', 'at': 1},
            'srs': None, 'createdAt': i, 'updatedAt': i}

# 假的 Gemini：出題請求和覆核請求分開記錄；delay 讓「第二批」慢一點，才看得到邊考邊補
calls = []
mock = {'gen_delay': [0.0], 'reject_all': False}

def gemini(route):
    body = json.loads(route.request.post_data)
    prompt = body['contents'][0]['parts'][0]['text']
    if 'Items JSON:\n' in prompt:   # 第二輪覆核
        items = json.loads(prompt.split('Items JSON:\n')[1])
        calls.append(('review', len(items)))
        reviews = []
        for it in items:
            ans = re.search(r'\(ref (\w+)\)', it['sentence']).group(1)[::-1]
            valid = [0, 1] if mock['reject_all'] else [it['options'].index(ans)]
            reviews.append({'id': it['id'], 'validIndexes': valid, 'reasons': ['測試用的逐選項說明。'] * 4, 'translationConsistent': True})
        text = json.dumps({'reviews': reviews})
    else:
        items = re.findall(r'^\d+\. target: "([^"]+)"; distractors: (.+)$', prompt, re.M)
        n = len([c for c in calls if c[0] == 'gen'])
        calls.append(('gen', len(items)))
        delay = mock['gen_delay'][min(n, len(mock['gen_delay']) - 1)]
        if delay: time.sleep(delay)
        qs = [{'target': t, 'sentence': f'Please _____ the file (ref {t[::-1]}) by Friday.', 'answer': t,
               'distractors': re.findall(r'"([^"]+)"', ds), 'translation': f'請在週五前處理（{t}）。', 'explanation': '測試解析。'}
              for t, ds in items]
        text = json.dumps({'questions': qs})
    route.fulfill(status=200, content_type='application/json',
                  body=json.dumps({'candidates': [{'content': {'parts': [{'text': text}]}, 'finishReason': 'STOP'}]}))

def answer(page):
    ans = re.search(r'\(ref (\w+)\)', page.locator('.q-sentence').inner_text()).group(1)[::-1]
    page.keyboard.press('abcd'[page.locator('.option .option-text').all_inner_texts().index(ans)])

def seed(page, settings):
    flush(page)
    page.evaluate("""([ws, key, st]) => { localStorage.clear(); localStorage.setItem('toeic-cards:words', JSON.stringify(ws));
      localStorage.setItem('toeic-cards:gemini-key', key);
      localStorage.setItem('toeic-cards:settings', JSON.stringify({ llmRpm: 600, quizCount: 10, ...st })); }""",
                  [[make(w, i) for i, w in enumerate(WORDS)], KEY, settings])
    page.reload()
    page.wait_for_load_state('networkidle')

def saved_count(page):
    flush(page)
    return page.evaluate("JSON.parse(localStorage.getItem('toeic-cards:words')).filter(w => (w.part5||[]).length).length")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1000, 'height': 900})
    existing_user(ctx)
    # Gemini 的回應用 threading 延遲會卡住 route handler，改在瀏覽器端用 setTimeout 模擬（見下方 init script）
    ctx.route('https://generativelanguage.googleapis.com/**', gemini)
    ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    page = ctx.new_page()
    page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append('console: ' + m.text))
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.goto(URL + '#/quiz')
    seed(page, {'part5Prefetch': False})

    # ---- 1. 第一批 5 題出好就開考，其餘邊考邊補 ----
    # 用瀏覽器端的 fetch 包裝讓「第二批出題」晚 1.5 秒回來，才看得到「＋」與等待畫面
    page.evaluate("""() => { const orig = window.fetch; let gen = 0;
      window.fetch = async (url, opts) => { const r = await orig(url, opts);
        if (String(url).includes('generateContent') && !String(opts?.body || '').includes('Items JSON')) { gen++; if (gen === 2) await new Promise(res => setTimeout(res, 1500)); }
        return r; }; }""")
    page.evaluate("""() => { window.__titles = new Set();
      new MutationObserver(() => { const t = document.querySelector('#loadTitle'); if (t) window.__titles.add(t.textContent); })
        .observe(document.body, { childList: true, subtree: true }); }""")
    page.click('.mode-btn[data-mode=part5]')
    page.wait_for_selector('.q-sentence', timeout=10000)
    titles = page.evaluate('() => [...window.__titles]')
    check(any('1/2' in t for t in titles) and any('2/2' in t for t in titles), f'載入畫面分階段顯示（{titles}）')
    prog = page.locator('.quiz-progress').inner_text()
    check(prog.replace(' ', '') == '1/5＋出題中', f'第一批 5 題就開考，總數旁顯示還在補題（{prog}）')
    page.screenshot(path=doc_shot('48-part5-progressive.png'))
    for i in range(5):
        answer(page)
        if i == 4 and page.locator('.quiz-pending').count():
            check('出題中' in page.locator('#next').inner_text(), '最後一題已出好的題目：下一題按鈕說明還在出題')
        page.keyboard.press('Enter')
        if page.locator('.q-sentence').count() == 0:
            break
    if page.locator('.loading-state').count():
        check('下一題還在出題中' in page.inner_text('main'), '答完已出好的題目，顯示等待下一題')
        page.screenshot(path=os.path.join(OUT, 'p5fast_waitnext.png'))
    page.wait_for_selector('.q-sentence', timeout=10000)
    page.wait_for_selector('.quiz-pending', state='detached', timeout=10000)
    prog = page.locator('.quiz-progress').inner_text()
    check(prog.replace(' ', '') == '6/10', f'第二批出好後自動接著考，共 10 題（{prog}）')
    check([c for c in calls] == [('gen', 5), ('review', 5), ('gen', 5), ('review', 5)], f'每批出題＋覆核兩次請求，第一批 5 字（{calls}）')
    for _ in range(5):
        answer(page)
        page.keyboard.press('Enter')
    page.wait_for_selector('.result-state')
    check(page.locator('.score').inner_text().replace('\n', '') == '10 / 10', '10 題全部作答並計分')

    # ---- 2. 中途結束會停止補題 ----
    page.click('#home')
    page.check('#fresh')
    calls.clear()
    page.click('.mode-btn[data-mode=part5]')
    page.wait_for_selector('.q-sentence', timeout=10000)
    page.click('#quit')
    page.wait_for_timeout(2000)
    check(page.locator('.mode-grid').count() == 1, '還沒作答就結束 → 回測驗首頁')
    check(len([c for c in calls if c[0] == 'gen']) <= 2, f'結束後不再送新的出題請求（{calls}）')
    page.uncheck('#fresh')

    # ---- 3. 全部被覆核刷掉時說明原因 ----
    seed(page, {'part5Prefetch': False})
    mock['reject_all'] = True
    page.click('.mode-btn[data-mode=part5]')
    page.wait_for_selector('.ai-error', timeout=10000)
    msg = page.locator('.ai-error').inner_text()
    check('沒通過第二輪檢查' in msg, f'全被刷掉時說明是 AI 檢查刷掉（{msg}）')
    mock['reject_all'] = False

    # ---- 4. 背景補題：開網站後自動補到範圍內 20 個字（這裡只有 16 字 → 補滿 16），每天有上限 ----
    calls.clear()
    seed(page, {'part5Prefetch': True})
    page.evaluate("() => import('/js/part5.js?v=part5-fast-1').then(m => m.topUpPart5())")
    check(saved_count(page) == 10 and calls == [('gen', 10), ('review', 10)], f'背景一批補 10 個字（{saved_count(page)}，{calls}）')
    r = page.evaluate("() => import('/js/part5.js?v=part5-fast-1').then(m => m.topUpPart5())")
    check(r == 'filled' and saved_count(page) == 16, f'再補一批，範圍內 16 個字都有題目（{saved_count(page)}）')
    r = page.evaluate("() => import('/js/part5.js?v=part5-fast-1').then(m => m.topUpPart5())")
    check(r == 'enough', f'補滿就停，不再送請求（{r}）')
    page.goto(URL + '#/quiz')
    page.wait_for_load_state('networkidle')
    stock = page.locator('.mode-card[data-mode=part5] .mode-stock')
    check(stock.count() == 1 and '16 個字' in stock.inner_text(), '測驗首頁顯示已備好幾個字的題目')
    calls.clear()
    page.click('.mode-btn[data-mode=part5]')
    page.wait_for_selector('.q-sentence', timeout=3000)
    check(calls == [] and page.locator('.quiz-pending').count() == 0, f'有存題時直接開考，不呼叫 AI（{calls}）')
    page.click('#quit')

    # 每日上限：今天已經補 4 批 → 不再補
    seed(page, {'part5Prefetch': True})
    calls.clear()
    page.evaluate("() => import('/js/srs.js').then(s => localStorage.setItem('toeic-cards:part5-stock', JSON.stringify({ day: s.dayKey(Date.now()), batches: 4 })))")
    r = page.evaluate("() => import('/js/part5.js?v=part5-fast-1').then(m => m.topUpPart5())")
    check(r == 'stop' and calls == [], f'達到每天上限就不再補（{r}）')
    # 關掉設定 → 不補
    page.evaluate("() => { localStorage.removeItem('toeic-cards:part5-stock'); }")
    page.goto(URL + '#/settings')
    page.wait_for_load_state('networkidle')
    page.evaluate("() => { const d = document.querySelector('#aiPanel')?.closest('details'); if (d) d.open = true; }")
    box = page.locator('#part5Prefetch')
    check(box.is_checked(), '設定頁預設開啟背景補題')
    box.uncheck()
    r = page.evaluate("() => import('/js/part5.js?v=part5-fast-1').then(m => m.topUpPart5())")
    check(r == 'skip' and calls == [], f'關閉後不在背景出題（{r}）')

    # 沒有金鑰 → 不補
    page.evaluate("() => { localStorage.removeItem('toeic-cards:gemini-key'); }")
    r = page.evaluate("() => import('/js/store.js').then(s => { s.updateSettings({ part5Prefetch: true }); return import('/js/part5.js?v=part5-fast-1'); }).then(m => m.topUpPart5())")
    check(r == 'skip' and calls == [], f'沒有金鑰不補（{r}）')

    # ---- 手機版：等待畫面不橫向捲動 ----
    mp = ctx.new_page()
    mp.set_viewport_size({'width': 375, 'height': 812})
    mp.goto(URL + '#/quiz')
    seed(mp, {'part5Prefetch': False})
    mp.click('.mode-btn[data-mode=part5]')
    mp.wait_for_selector('.q-sentence', timeout=10000)
    check(mp.evaluate('document.documentElement.scrollWidth') <= 375, '手機 Part 5 無橫向捲動')
    browser.close()

print('\nERRORS:' if errors else '\nALL PASSED', *errors, sep='\n')
sys.exit(1 if errors else 0)
