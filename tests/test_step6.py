from review_mock import mock_review
from onboarding_helpers import existing_user
from storage_helpers import flush
"""第 6 步：測驗（簡易模式、聽力、Part 5、錯題本）端對端測試"""
import json, os, re, sys
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'screenshots')
os.makedirs(OUT, exist_ok=True)
URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
KEY = 'test-key-ok'
errors = []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        errors.append(msg)

DATA = [
    ('approve', 'v.', 'v. 核准；批准', 'To officially agree that a plan or request is acceptable.'),
    ('negotiate', 'v.', 'v. 協商；談判', 'To discuss something to reach an agreement.'),
    ('postpone', 'v.', 'v. 延期；延後', 'To move an event to a later time.'),
    ('submit', 'v.', 'v. 提交；呈遞', 'To give a document to someone for a decision.'),
    ('invoice', 'n.', 'n. 發票；請款單', 'A document that lists the money you must pay.'),
    ('deadline', 'n.', 'n. 截止日期', 'The latest time by which something must be finished.'),
    ('itinerary', 'n.', 'n. 行程表', 'A detailed plan of a trip.'),
    ('reimbursement', 'n.', 'n. 報銷；退款', 'Money paid back to you for costs from work.'),
]
ZH = {w: zh.split(' ', 1)[1] for w, _, zh, _ in DATA}
EN = {w: en for w, _, _, en in DATA}

def make(word, pos, zh, en, i):
    return {'id': word, 'word': word, 'phonetic': '', 'pos': pos, 'zh': zh, 'en': en,
            'examples': [], 'collocations': [], 'forms': [], 'synonyms': [], 'unfamiliar': False,
            'src': {'zh': 'dict', 'en': 'llm'}, 'lookup': {'dictAt': 1, 'enDone': True},
            'llm': {'status': 'done', 'at': 1}, 'srs': None, 'createdAt': i, 'updatedAt': i}

# ---- 假的 Gemini：Part 5 出題 ----
gemini_calls = []
mode = {'broken': None, 'bad_key': False}

def gemini(route):
    req = route.request
    if mode['bad_key'] or req.headers.get('x-goog-api-key') != KEY:
        return route.fulfill(status=400, content_type='application/json',
                             body=json.dumps({'error': {'code': 400, 'message': 'API key not valid.', 'status': 'INVALID_ARGUMENT'}}))
    prompt = json.loads(req.post_data)['contents'][0]['parts'][0]['text']
    items = re.findall(r'^\d+\. target: "([^"]+)"; distractors: (.+)$', prompt, re.M)
    if mock_review(route,prompt,forms=False): return
    gemini_calls.append(items)
    qs = []
    for target, ds in items:
        ds = re.findall(r'"([^"]+)"', ds)
        # 句子裡放「反過來的答案」當記號，測試才知道正確答案（答案本身不能出現在句子裡）
        sentence = f'The manager asked us to _____ the forms (ref {target[::-1]}) before Friday.'
        if target == mode['broken']:
            sentence = 'This sentence has ___ two ___ blanks.'
        qs.append({'target': target, 'sentence': sentence, 'answer': target, 'distractors': ds,
                   'translation': f'經理要我們在週五前處理（{target}）。', 'explanation': f'句意需要「{ZH[target]}」。'})
    route.fulfill(status=200, content_type='application/json', body=json.dumps(
        {'candidates': [{'content': {'parts': [{'text': json.dumps({'questions': qs})}]}, 'finishReason': 'STOP'}]}))

def store(page, key):
    flush(page)
    return page.evaluate(f"JSON.parse(localStorage.getItem('toeic-cards:{key}') || 'null')")

def words(page):
    return {w['word']: w for w in store(page, 'words')}

def correct_index(page, mode_name):
    """依目前題目算出正確選項（測試用的作弊表）"""
    opts = page.locator('.option .option-text').all_inner_texts()
    if mode_name == 'zh2en':
        prompt = page.locator('.q-zh').inner_text()
        ans = next(w for w, z in ZH.items() if z in prompt)
    elif mode_name == 'en2word':
        prompt = page.locator('.q-en').inner_text()
        ans = next(w for w, e in EN.items() if e.split(' ')[-1] in prompt and e[:12] in prompt)
    elif mode_name == 'listen':
        ans = ZH[page.evaluate('window.__spoken[window.__spoken.length - 1]')]
    else:  # part5：句子裡的記號是反過來的答案
        ans = re.search(r'\(ref (\w+)\)', page.locator('.q-sentence').inner_text()).group(1)[::-1]
    return opts.index(ans)

def answer_all(page, mode_name, wrong_first=False):
    n = int(page.locator('.quiz-progress').inner_text().split('/')[1].strip('＋ '))
    for i in range(n):
        idx = correct_index(page, mode_name)
        if wrong_first and i == 0:
            idx = (idx + 1) % 4
        key = 'abcd'[idx] if mode_name == 'part5' else str(idx + 1)
        page.keyboard.press(key)
        page.keyboard.press('Enter')
    page.wait_for_selector('.result-state')
    return n

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1000, 'height': 900})
    existing_user(ctx)
    ctx.add_init_script('window.__spoken = []; if (window.speechSynthesis) speechSynthesis.speak = (u) => window.__spoken.push(u.text);')
    ctx.route('https://generativelanguage.googleapis.com/**', gemini)
    ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    page = ctx.new_page()
    page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append('console: ' + m.text))
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.on('dialog', lambda d: d.accept())
    page.goto(URL)
    flush(page)
    page.evaluate("ws => { localStorage.clear(); localStorage.setItem('toeic-cards:words', JSON.stringify(ws)); }",
                  [make(*d, i) for i, d in enumerate(DATA)][:3])
    page.goto(URL + '#/quiz')
    page.reload()
    page.wait_for_load_state('networkidle')

    # ---- 字不夠 ----
    card = page.locator('.mode-card[data-mode=zh2en]')
    check(card.locator('button').is_disabled() and '至少 4 個' in card.inner_text(), '只有 3 個字時不能測驗，並說明原因')
    flush(page)
    page.evaluate("ws => localStorage.setItem('toeic-cards:words', JSON.stringify(ws))", [make(*d, i) for i, d in enumerate(DATA)])
    page.reload()
    page.wait_for_load_state('networkidle')
    p5 = page.locator('.mode-card[data-mode=part5]')
    check(p5.locator('button').is_disabled() and '需要 Gemini 金鑰' in p5.inner_text(), '沒金鑰時 Part 5 停用')
    p5.locator('a').click()
    check(page.url.endswith('#/settings'), 'Part 5 卡片的「前往設定」連結可以點')
    page.goto(URL + '#/quiz')
    page.screenshot(path=os.path.join(OUT, 's6_home.png'), full_page=True)

    # ---- 看中文選英文：第一題故意答錯 ----
    page.click('.mode-btn[data-mode=zh2en]')
    check(page.locator('.quiz-progress').inner_text() == '1 / 8', '題數 10 但只有 8 個字 → 8 題')
    first_idx = correct_index(page, 'zh2en')
    first_word = page.locator('.option .option-text').nth(first_idx).inner_text()
    page.locator('.option').nth((first_idx + 1) % 4).click()
    check(page.locator('.feedback.bad').count() == 1 and first_word in page.locator('.fb-head').inner_text(), '答錯顯示正確答案')
    check(page.locator('.option.is-correct').count() == 1 and page.locator('.option.is-wrong').count() == 1, '正確／錯誤選項標上顏色')
    check(words(page)[first_word]['unfamiliar'] is True, '答錯的字自動標記不熟')
    check(len(store(page, 'mistakes')) == 1, '答錯的題目進錯題本')
    page.screenshot(path=os.path.join(OUT, 's6_wrong.png'))
    page.keyboard.press('Enter')
    for _ in range(7):
        page.keyboard.press(str(correct_index(page, 'zh2en') + 1))
        check(page.locator('.feedback.ok').count() == 1, '答對') if _ == 0 else None
        page.keyboard.press('Enter')
    page.wait_for_selector('.result-state')
    check(page.locator('.score').inner_text().replace('\n', '') == '7 / 8', f"結果 {page.locator('.score').inner_text()!r}")
    check(page.locator('.result-row.bad').count() == 1, '結果列表標出答錯的題目')
    page.screenshot(path=os.path.join(OUT, 's6_result.png'), full_page=True)

    # 重做錯的：答對 → 從錯題本移除
    page.click('#redoWrong')
    check('錯題重做' in page.locator('.quiz-mode').inner_text(), '重做錯題')
    page.keyboard.press(str(correct_index(page, 'zh2en') + 1))
    check('已從錯題本移除' in page.locator('.feedback').inner_text(), '重做答對提示已移除')
    check(len(store(page, 'mistakes')) == 0, '錯題本變成 0 題')
    page.keyboard.press('Enter')
    page.click('#home')

    # ---- 看英文解釋選單字：解釋裡的答案會被遮住 ----
    page.click('.mode-btn[data-mode=en2word]')
    prompt = page.locator('.q-en').inner_text()
    check(all(w not in prompt.lower() for w in EN), f'英文解釋不會直接出現答案字：{prompt!r}')
    n = answer_all(page, 'en2word')
    check(page.locator('.score').inner_text().replace('\n', '') == f'{n} / {n}', '看解釋選單字全對')
    page.click('#home')

    # ---- 聽力：自動播放、選項是中文 ----
    page.evaluate('window.__spoken = []')
    page.click('.mode-btn[data-mode=listen]')
    page.wait_for_timeout(200)
    spoken = page.evaluate('window.__spoken')
    check(len(spoken) == 1 and spoken[0] in ZH, f'聽力題自動播放發音 {spoken}')
    opts = page.locator('.option .option-text').all_inner_texts()
    check(all(o in ZH.values() for o in opts), f'聽力選項是中文 {opts}')
    check(spoken[0] not in page.locator('.question').inner_text(), '作答前不顯示英文單字')
    page.keyboard.press('p')
    check(len(page.evaluate('window.__spoken')) == 2, 'P 鍵再聽一次')
    page.click('#play')
    check(len(page.evaluate('window.__spoken')) == 3, '按鈕再聽一次')
    page.screenshot(path=os.path.join(OUT, 's6_listen.png'))
    page.keyboard.press(str(correct_index(page, 'listen') + 1))
    check(spoken[0] in page.locator('#play').inner_text(), '作答後顯示英文單字')
    page.keyboard.press('Enter')
    page.wait_for_timeout(100)
    check(len(page.evaluate('window.__spoken')) == 4, '下一題自動播放')
    page.click('#quit')
    check(page.locator('.result-state').count() == 1, '中途結束會顯示已作答的結果')
    check(page.locator('.score').inner_text().replace('\n', '') == '1 / 1', '中途結束只算已作答的題目')
    page.click('#home')

    # ---- Part 5（假的 Gemini）----
    page.evaluate(f"""() => {{
      localStorage.setItem('toeic-cards:gemini-key', '{KEY}');
      const s = JSON.parse(localStorage.getItem('toeic-cards:settings') || '{{}}');
      localStorage.setItem('toeic-cards:settings', JSON.stringify({{ ...s, llmRpm: 600 }}));
    }}""")
    page.reload()
    page.wait_for_load_state('networkidle')
    mode['broken'] = 'deadline'
    page.click('.mode-btn[data-mode=part5]')
    page.wait_for_selector('.q-sentence', timeout=10000)
    page.wait_for_selector('.quiz-pending', state='detached', timeout=10000)   # 等背景補完後面的題目
    check([len(c) for c in gemini_calls] == [5, 3], f'第一批 5 個字先出好就開考，其餘 3 個字邊考邊補（{[len(c) for c in gemini_calls]}）')
    sample = dict((t, re.findall(r'"([^"]+)"', d)) for c in gemini_calls for t, d in c)
    pos = {w: p_ for w, p_, _, _ in DATA}
    check(all(len(ds) == 3 and t not in ds and all(d in pos for d in ds) for t, ds in sample.items()), '錯誤選項都來自使用者自己的字卡')
    check(all(all(pos[d] == pos[t] for d in ds) for t, ds in sample.items()), '錯誤選項優先挑同詞性的字')
    check(page.locator('.quiz-progress').inner_text() == '1 / 7', '格式有問題的題目（兩個空格）被丟掉，只出 7 題')
    check(page.locator('.option-key').first.inner_text() == '(A)', 'Part 5 選項用 (A)–(D)')
    page.screenshot(path=os.path.join(OUT, 's6_part5.png'))
    idx = correct_index(page, 'part5')
    page.keyboard.press('abcd'[idx])
    check(page.locator('.blank.filled').count() == 1, '作答後空格填入答案')
    fb = page.locator('.feedback').inner_text()
    check('經理要我們' in fb and '句意需要' in fb, 'Part 5 顯示中文翻譯和解析')
    page.screenshot(path=os.path.join(OUT, 's6_part5_answered.png'))
    page.keyboard.press('Enter')
    for _ in range(6):
        page.keyboard.press('abcd'[correct_index(page, 'part5')])
        page.keyboard.press('Enter')
    page.wait_for_selector('.result-state')
    ws = words(page)
    check(sum(1 for w in ws.values() if w.get('part5')) == 7 and not ws['deadline'].get('part5'), '題目存在單字上（失敗的字沒有存）')

    # 再考一次：沒有存檔的 deadline 會再請求一次，其他用存檔
    mode['broken'] = None
    page.click('#home')
    page.click('.mode-btn[data-mode=part5]')
    page.wait_for_selector('.q-sentence', timeout=10000)
    page.wait_for_selector('.quiz-pending', state='detached', timeout=10000)   # 等背景補完後面的題目
    check(len(gemini_calls) == 3 and [t for t, _ in gemini_calls[2]] == ['deadline'], f'只為沒有題目的字呼叫 AI（{[[t for t, _ in c] for c in gemini_calls]}）')
    check(page.locator('.quiz-progress').inner_text() == '1 / 8', '8 題')
    page.click('#quit')
    check(page.locator('.mode-grid').count() == 1, '還沒作答就結束 → 直接回測驗首頁')

    # 勾選「出新題目」：全部重新出題，每個字存 2 題
    page.check('#fresh')
    page.click('.mode-btn[data-mode=part5]')
    page.wait_for_selector('.q-sentence', timeout=10000)
    page.wait_for_selector('.quiz-pending', state='detached', timeout=10000)   # 等背景補完後面的題目
    check(len(gemini_calls) == 5 and len(gemini_calls[3]) + len(gemini_calls[4]) == 8, '出新題目時全部重新出題')
    check(len(words(page)['approve']['part5']) == 2, '舊題目保留，每個字最多存 3 題')
    page.click('#quit')
    page.uncheck('#fresh')

    # 金鑰錯誤：回到首頁並顯示原因
    mode['bad_key'] = True
    page.check('#fresh')
    page.click('.mode-btn[data-mode=part5]')
    page.wait_for_selector('.ai-error', timeout=10000)
    check('金鑰' in page.locator('.ai-error').inner_text(), '出題失敗時顯示原因')
    mode['bad_key'] = False
    page.uncheck('#fresh')

    # ---- 錯題本 ----
    page.click('.mode-btn[data-mode=zh2en]')
    for i in range(3):   # 前 3 題故意答錯
        page.keyboard.press(str((correct_index(page, 'zh2en') + 1) % 4 + 1))
        page.keyboard.press('Enter')
    page.click('#quit')
    page.click('#home')
    check('3 題' in page.locator('#openMistakes').inner_text(), '首頁顯示錯題數')
    page.click('#openMistakes')
    check(page.locator('.mistake-row').count() == 3, '錯題本列出 3 題')
    page.screenshot(path=os.path.join(OUT, 's6_mistakes.png'), full_page=True)
    page.locator('.mistake-row').first.locator('[data-act=remove]').click()
    check(page.locator('.mistake-row').count() == 2, '可以移除單一錯題')
    page.click('#redoAll')
    page.keyboard.press(str(correct_index(page, 'zh2en') + 1))
    page.keyboard.press('Enter')
    q2 = (correct_index(page, 'zh2en') + 1) % 4 + 1
    page.keyboard.press(str(q2))   # 第二題又答錯
    page.keyboard.press('Enter')
    page.wait_for_selector('.result-state')
    m = store(page, 'mistakes')
    check(len(m) == 1 and m[0]['count'] == 2, f'重做答對的移除、又答錯的次數 +1（{[x["count"] for x in m]}）')
    check(page.locator('#again').count() == 0, '錯題重做的結果頁沒有「再測一次」')
    page.click('#home')

    # 刪掉單字 → 相關錯題一起清掉
    wid = m[0]['question']['wordId']
    page.goto(URL + '#/words')
    page.click('#toggleLibraryEdit')
    page.locator('.word-row', has_text=wid).first.locator('[data-act=delete]').click()
    page.click('#confirmWordDeletion')
    page.wait_for_timeout(200)
    check(store(page, 'mistakes') == [], '刪除單字時相關錯題也清掉')

    # 紀錄
    log = list(store(page, 'log').values())[0]
    check(log['quiz'] >= 30 and log['quizCorrect'] < log['quiz'], f'測驗題數記錄到每日紀錄 {log}')

    # ---- 手機版 ----
    mp = ctx.new_page()
    mp.set_viewport_size({'width': 375, 'height': 812})
    mp.goto(URL + '#/quiz')
    mp.wait_for_load_state('networkidle')
    sw = mp.evaluate('document.documentElement.scrollWidth')
    nav_overflow = mp.evaluate("(() => { const n = document.querySelector('.topbar'); return n.scrollWidth - n.clientWidth; })()")
    check(sw <= 375 and nav_overflow <= 0, f'手機無橫向捲動（頁面 {sw}、導覽列溢出 {nav_overflow}）')
    mp.click('.mode-btn[data-mode=part5]')
    mp.wait_for_selector('.q-sentence', timeout=10000)
    sw = mp.evaluate('document.documentElement.scrollWidth')
    check(sw <= 375, f'手機 Part 5 無橫向捲動 {sw}')
    mp.screenshot(path=os.path.join(OUT, 's6_mobile_part5.png'), full_page=True)

    browser.close()

print('\nERRORS:' if errors else '\nALL PASSED', *errors, sep='\n')
sys.exit(1 if errors else 0)
