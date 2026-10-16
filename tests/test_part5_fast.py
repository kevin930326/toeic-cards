"""AI 出題不用乾等：Part 5／詞性變化先開考邊考邊補、分階段進度、優先挑已備好的字、
背景先備題（Part 5、詞性變化、下一篇短文）與每日額度、題目全被覆核刷掉時說明原因"""
import json, os, re, sys
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
    pos = 'v.' if i % 2 else 'n.'
    return {'id': word, 'word': word, 'phonetic': '', 'pos': pos, 'zh': f'{pos} 測試{i}', 'en': f'Meaning {i}.',
            'examples': [], 'collocations': [], 'forms': [], 'synonyms': [], 'unfamiliar': False,
            'src': {}, 'lookup': {'dictAt': 1, 'enDone': True}, 'llm': {'status': 'done', 'at': 1},
            'srs': None, 'createdAt': i, 'updatedAt': i}

# ---- 假的 Gemini：分辨 Part 5 出題、詞性題出題、覆核、短文 ----
calls = []
mock = {'reject_all': False}

def reply(route, obj):
    route.fulfill(status=200, content_type='application/json',
                  body=json.dumps({'candidates': [{'content': {'parts': [{'text': json.dumps(obj)}]}, 'finishReason': 'STOP'}]}))

def gemini(route):
    prompt = json.loads(route.request.post_data)['contents'][0]['parts'][0]['text']
    if 'Items JSON:\n' in prompt:   # 第二輪覆核（Part 5 與詞性題共用）
        items = json.loads(prompt.split('Items JSON:\n')[1])
        calls.append(('review', len(items)))
        reviews = []
        for it in items:
            ans = re.search(r'\(ref (\w+)\)', it['sentence']).group(1)[::-1]
            valid = [0, 1] if mock['reject_all'] else [it['options'].index(ans)]
            reviews.append({'id': it['id'], 'validIndexes': valid, 'reasons': ['測試用的逐選項說明。'] * 4, 'translationConsistent': True})
        return reply(route, {'reviews': reviews})
    if 'Part 7' in prompt:   # 短文
        words = re.search(r'any grammatical form is fine\): (.+)\.\n', prompt).group(1).split(', ')
        calls.append(('reading', len(words)))
        body = ' '.join(f'The team will {w} the plan on Monday.' for w in words)
        para = (body + ' ') * max(1, 70 // len(body.split()) + 1)
        q = lambda n: {'question': f'Question {n}?', 'options': [f'A{n}', f'B{n}', f'C{n}', f'D{n}'], 'answer': 1, 'explanation': '測試解析。'}
        return reply(route, {'title': 'Prepared Notice', 'paragraphs': [para.strip()], 'translation': ['測試翻譯。'],
                             'targets': words, 'questions': [q(1), q(2), q(3)]})
    if 'word-form questions' in prompt:   # 詞性變化
        targets = re.findall(r'^\d+\. (\S+)$', prompt, re.M)
        calls.append(('forms', len(targets)))
        return reply(route, {'questions': [{'target': t, 'sentence': f'They will _____ it soon (ref {t[::-1]}).', 'answer': t,
                                            'distractors': [t + 's', t + 'ed', t + 'ing'], 'translation': '測試翻譯。', 'explanation': '測試解析。'} for t in targets]})
    items = re.findall(r'^\d+\. target: "([^"]+)"; distractors: (.+)$', prompt, re.M)   # Part 5
    calls.append(('gen', len(items)))
    reply(route, {'questions': [{'target': t, 'sentence': f'Please _____ the file (ref {t[::-1]}) by Friday.', 'answer': t,
                                 'distractors': re.findall(r'"([^"]+)"', ds), 'translation': f'請在週五前處理（{t}）。', 'explanation': '測試解析。'}
                                for t, ds in items]})

def answer(page):
    ans = re.search(r'\(ref (\w+)\)', page.locator('.q-sentence').inner_text()).group(1)[::-1]
    page.keyboard.press('abcd'[page.locator('.option .option-text').all_inner_texts().index(ans)])

def seed(page, settings, words=WORDS):
    flush(page)
    page.evaluate("""([ws, key, st]) => { localStorage.clear(); localStorage.setItem('toeic-cards:words', JSON.stringify(ws));
      localStorage.setItem('toeic-cards:gemini-key', key);
      localStorage.setItem('toeic-cards:settings', JSON.stringify({ llmRpm: 600, quizCount: 10, ...st })); }""",
                  [[make(w, i) for i, w in enumerate(words)], KEY, settings])
    page.reload()
    page.wait_for_load_state('networkidle')

def stored_words(page):
    flush(page)
    return page.evaluate("JSON.parse(localStorage.getItem('toeic-cards:words'))")

def unused_part5(page):
    return sum(1 for w in stored_words(page) if any(not q.get('usedAt') for q in (w.get('part5') or [])))

def top_up(page):
    return page.evaluate("() => import('/js/ai-stock.js').then(m => m.topUpOnce())")

def watch_titles(page):
    page.evaluate("""() => { window.__titles = new Set();
      new MutationObserver(() => { const t = document.querySelector('#loadTitle'); if (t) window.__titles.add(t.textContent); })
        .observe(document.body, { childList: true, subtree: true }); }""")

# 讓第二批出題請求晚 1.5 秒回來，才看得到「＋出題中」與等待畫面
SLOW_SECOND = """() => { const orig = window.fetch; let gen = 0;
  window.fetch = async (url, opts) => { const r = await orig(url, opts);
    if (String(url).includes('generateContent') && !String(opts?.body || '').includes('Items JSON')) { gen++; if (gen === 2) await new Promise(res => setTimeout(res, 1500)); }
    return r; }; }"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1000, 'height': 900})
    existing_user(ctx)
    ctx.route('https://generativelanguage.googleapis.com/**', gemini)
    ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    page = ctx.new_page()
    page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append('console: ' + m.text))
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.goto(URL + '#/quiz')
    seed(page, {})

    # ---- 1. Part 5：第一批 5 題出好就開考，其餘邊考邊補 ----
    page.evaluate(SLOW_SECOND)
    watch_titles(page)
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
            check('出題中' in page.locator('#next').inner_text(), '已出好的最後一題：下一題按鈕說明還在出題')
        page.keyboard.press('Enter')
    if page.locator('.loading-state').count():
        check('下一題還在出題中' in page.inner_text('main'), '答完已出好的題目，顯示等待下一題')
    page.wait_for_selector('.q-sentence', timeout=10000)
    page.wait_for_selector('.quiz-pending', state='detached', timeout=10000)
    prog = page.locator('.quiz-progress').inner_text()
    check(prog.replace(' ', '') == '6/10', f'第二批出好後自動接著考，共 10 題（{prog}）')
    check(calls == [('gen', 5), ('review', 5), ('gen', 5), ('review', 5)], f'每批出題＋覆核兩次請求，第一批 5 字（{calls}）')
    for _ in range(5):
        answer(page)
        page.keyboard.press('Enter')
    page.wait_for_selector('.result-state')
    check(page.locator('.score').inner_text().replace('\n', '') == '10 / 10', '10 題全部作答並計分')

    # ---- 2. 挑字順序：剩下 6 個字沒題目，下一次 10 題 → 先考沒題目的 6 字，再重考 4 個考過的 ----
    page.click('#home')
    calls.clear()
    page.click('.mode-btn[data-mode=part5]')
    page.wait_for_selector('.q-sentence', timeout=10000)
    page.wait_for_selector('.quiz-pending', state='detached', timeout=10000)
    check(calls == [('gen', 5), ('review', 5), ('gen', 1), ('review', 1)], f'沒題目的 6 個字排在已考過的字前面（{calls}）')
    check(page.locator('.quiz-progress').inner_text().replace(' ', '') == '1/10', '共 10 題（含 4 題重考）')
    page.click('#quit')

    # ---- 3. 全部被覆核刷掉時說明原因 ----
    seed(page, {})
    mock['reject_all'] = True
    page.click('.mode-btn[data-mode=part5]')
    page.wait_for_selector('.ai-error', timeout=10000)
    msg = page.locator('.ai-error').inner_text()
    check('沒通過第二輪檢查' in msg, f'全被刷掉時說明是 AI 檢查刷掉（{msg}）')
    mock['reject_all'] = False

    # ---- 4. 詞性變化（自己加的字）也先開考邊考邊補 ----
    own = ['blorp', 'snizz', 'quaff', 'trunk', 'plonk', 'frizz', 'glomp', 'wibble']
    seed(page, {}, own)
    calls.clear()
    page.evaluate(SLOW_SECOND)
    page.click('.mode-btn[data-mode=forms]')
    page.wait_for_selector('.q-sentence', timeout=10000)
    prog = page.locator('.quiz-progress').inner_text()
    check(prog.replace(' ', '') == '1/5＋出題中', f'詞性變化第一批 5 題就開考（{prog}）')
    page.wait_for_selector('.quiz-pending', state='detached', timeout=10000)
    check(page.locator('.quiz-progress').inner_text().replace(' ', '') == '1/8', '後面 3 題補進來，共 8 題')
    check(calls == [('forms', 5), ('review', 5), ('forms', 3), ('review', 3)], f'詞性題也是每批出題＋覆核（{calls}）')
    page.click('#quit')

    # ---- 5. 背景先備題：Part 5、詞性變化、下一篇短文輪流補，補滿就停 ----
    seed(page, {})
    calls.clear()
    page.evaluate('window.__toeicAiPrefetchOff = false')
    results = [top_up(page) for _ in range(8)]
    check(results[-1] == 'enough' and results.count('filled') >= 3, f'輪流補到夠為止（{results}）')
    kinds = [c[0] for c in calls]
    check({'gen', 'forms', 'reading'} <= set(kinds), f'三種都有在背景準備（{kinds}）')
    check(unused_part5(page) == 16, f'範圍內 16 個字都有還沒考過的 Part 5 題目（{unused_part5(page)}）')
    need = page.evaluate("""async () => { const s = await import('/js/store.js'); const f = await import('/js/forms-quiz.js?v=review-fixes-1');
      return f.formsStockNeed(s.scopedWords(), 999); }""")
    check(need is None, '詞性變化：自己加的字都備好題目')
    prepared = page.evaluate("JSON.parse(localStorage.getItem('toeic-cards:reading-next'))")
    check(bool(prepared) and prepared['title'] == 'Prepared Notice', '先寫好下一篇短文')
    used = page.evaluate("JSON.parse(localStorage.getItem('toeic-cards:ai-prefetch')).requests")
    expect_used = sum(2 if k in ('gen', 'forms') else 1 if k == 'reading' else 0 for k in kinds)
    check(used == expect_used, f'背景用掉的請求有記在今天的額度（{used} = {expect_used}）')

    page.goto(URL + '#/quiz')
    page.wait_for_load_state('networkidle')
    stock = page.locator('.mode-card[data-mode=part5] .mode-stock')
    check(stock.count() == 1 and '16 個字' in stock.inner_text(), '測驗首頁顯示已備好幾個字的新題目')
    calls.clear()
    page.click('.mode-btn[data-mode=part5]')
    page.wait_for_selector('.q-sentence', timeout=3000)
    check(calls == [] and page.locator('.quiz-pending').count() == 0, f'已備好的字直接開考，不呼叫 AI（{calls}）')
    page.click('#quit')

    # 先寫好的短文：按下立刻打開，不用等 AI
    page.goto(URL + '#/reading')
    page.wait_for_load_state('networkidle')
    check('已在背景先寫好一篇' in page.inner_text('main'), '短文頁說明已先寫好一篇')
    calls.clear()
    page.click('#generate')
    page.wait_for_selector('.reading-title', timeout=3000)
    check(page.locator('.reading-title').inner_text() == 'Prepared Notice' and calls == [], f'直接打開先寫好的短文（{calls}）')
    check(page.evaluate("localStorage.getItem('toeic-cards:reading-next')") is None, '拿走後就不在待讀區')

    # ---- 6. 每日額度與開關 ----
    seed(page, {'aiPrefetchDaily': 12})
    page.evaluate('window.__toeicAiPrefetchOff = false')
    calls.clear()
    page.evaluate("() => import('/js/srs.js').then(s => localStorage.setItem('toeic-cards:ai-prefetch', JSON.stringify({ day: s.dayKey(Date.now()), requests: 12 })))")
    check(top_up(page) == 'budget' and calls == [], '今天背景額度用完就不再補')
    page.goto(URL + '#/settings')
    page.wait_for_load_state('networkidle')
    page.evaluate('window.__toeicAiPrefetchOff = false')
    check('今天已用 12 次' in page.inner_text('#aiPanel'), '設定頁顯示今天背景用了幾次')
    page.locator('input[name=aiPrefetchDaily][value="24"]').check(force=True)
    r = top_up(page)
    check(r == 'filled' and len(calls) == 2, f'調高每日上限後可以繼續補（{r}，{calls}）')
    page.screenshot(path=os.path.join(OUT, 'p5fast_settings.png'))
    box = page.locator('#aiPrefetch')
    check(box.is_checked(), '設定頁預設開啟背景備題')
    box.uncheck()
    calls.clear()
    check(top_up(page) == 'off' and calls == [], '關閉後不在背景出題')
    page.evaluate("() => import('/js/store.js').then(s => s.updateSettings({ aiPrefetch: true }))")
    page.evaluate("() => localStorage.removeItem('toeic-cards:gemini-key')")
    check(top_up(page) == 'off' and calls == [], '沒有金鑰不補')

    # 第 48 步第一版的 part5Prefetch 關掉過的人，沿用為關閉
    flush(page)
    page.evaluate("() => { const s = JSON.parse(localStorage.getItem('toeic-cards:settings')); delete s.aiPrefetch; s.part5Prefetch = false; localStorage.setItem('toeic-cards:settings', JSON.stringify(s)); }")
    page.reload()
    page.wait_for_load_state('networkidle')
    check(page.evaluate("() => import('/js/store.js').then(s => s.getSettings().aiPrefetch)") is False, '舊設定關閉過的人沿用關閉')

    # ---- 手機版：Part 5 不橫向捲動 ----
    mp = ctx.new_page()
    mp.set_viewport_size({'width': 375, 'height': 812})
    mp.goto(URL + '#/quiz')
    seed(mp, {})
    mp.click('.mode-btn[data-mode=part5]')
    mp.wait_for_selector('.q-sentence', timeout=10000)
    check(mp.evaluate('document.documentElement.scrollWidth') <= 375, '手機 Part 5 無橫向捲動')
    browser.close()

print('\nERRORS:' if errors else '\nALL PASSED', *errors, sep='\n')
sys.exit(1 if errors else 0)
