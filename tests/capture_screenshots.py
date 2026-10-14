"""產生文件用的截圖（docs/images/）。

使用真實的本機字典資料；Gemini 和 Free Dictionary 用預先寫好的假回應，
所以不需要網路或 API 金鑰。

用法（先在專案根目錄執行 python -m http.server 8123 --bind 127.0.0.1）：
  python tests/capture_screenshots.py
"""
import json
import os
import re

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'images')
URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
os.makedirs(OUT, exist_ok=True)

# 示範用的 AI 內容（模擬 Gemini 的回應格式）
AI = {
    'approve': {
        'pos': 'v.', 'zh': 'v. 核准；批准；贊成',
        'en': 'To officially agree that a plan, request, or payment is acceptable.',
        'examples': [
            {'en': 'The manager approved the budget for the new marketing campaign.', 'zh': '經理核准了新行銷活動的預算。'},
            {'en': 'All travel expenses must be approved in advance.', 'zh': '所有差旅費用都必須事先核准。'},
        ],
        'collocations': ['approve a request', 'approve a budget', 'formally approve'],
        'forms': ['approval (n.)', 'approved (adj.)'], 'synonyms': ['authorize', 'endorse'],
    },
    'invoice': {
        'pos': 'n. / v.', 'zh': 'n. 發票；請款單\nv. 開立發票',
        'en': 'A document that lists goods or services provided and how much must be paid.',
        'examples': [
            {'en': 'Please send the invoice to our accounting department.', 'zh': '請把發票寄到我們的會計部門。'},
            {'en': 'The supplier invoiced us for the extra shipping costs.', 'zh': '供應商向我們開立了額外運費的發票。'},
        ],
        'collocations': ['issue an invoice', 'pay an invoice', 'invoice number'],
        'forms': ['invoicing (n.)'], 'synonyms': ['bill', 'statement'],
    },
    'reimbursement': {
        'pos': 'n.', 'zh': 'n. 報銷；核銷；退款',
        'en': 'Money paid back to someone for costs they paid for work.',
        'examples': [
            {'en': 'Submit your receipts to receive reimbursement for travel costs.', 'zh': '請繳交收據以報銷差旅費用。'},
            {'en': 'Reimbursement requests are processed within ten business days.', 'zh': '報銷申請會在十個工作天內處理。'},
        ],
        'collocations': ['request reimbursement', 'expense reimbursement', 'reimbursement form'],
        'forms': ['reimburse (v.)'], 'synonyms': ['repayment', 'refund'],
    },
    'itinerary': {
        'pos': 'n.', 'zh': 'n. 行程表；旅行計畫',
        'en': 'A detailed plan of a trip, listing places, dates, and times.',
        'examples': [
            {'en': 'Your travel itinerary has been sent to your email.', 'zh': '你的旅遊行程表已寄到你的電子信箱。'},
            {'en': 'Please review the itinerary before the conference trip.', 'zh': '請在出差參加會議前確認行程表。'},
        ],
        'collocations': ['travel itinerary', 'detailed itinerary', 'revise the itinerary'],
        'forms': [], 'synonyms': ['schedule', 'travel plan'],
    },
    'deadline': {
        'pos': 'n.', 'zh': 'n. 截止日期；期限',
        'en': 'The latest time or date by which something must be finished.',
        'examples': [
            {'en': 'The deadline for submitting proposals is Friday at noon.', 'zh': '提案的截止時間是星期五中午。'},
            {'en': 'We worked overtime to meet the deadline.', 'zh': '我們加班以趕上期限。'},
        ],
        'collocations': ['meet a deadline', 'miss a deadline', 'extend the deadline'],
        'forms': [], 'synonyms': ['due date', 'time limit'],
    },
    'negotiate': {
        'pos': 'v.', 'zh': 'v. 協商；談判；洽談',
        'en': 'To discuss something with others in order to reach an agreement.',
        'examples': [
            {'en': 'We negotiated a lower price with the supplier.', 'zh': '我們和供應商談成了較低的價格。'},
            {'en': 'The two companies are negotiating a merger.', 'zh': '兩家公司正在洽談合併。'},
        ],
        'collocations': ['negotiate a contract', 'negotiate a price', 'negotiate terms'],
        'forms': ['negotiation (n.)', 'negotiator (n.)', 'negotiable (adj.)'], 'synonyms': ['bargain', 'discuss'],
    },
}
WORDS = list(AI)

# 示範用的 Part 5 題目（模擬 Gemini 的回應）
PART5 = {
    'approve': ('The finance director must _____ all expenses over $500 before payment is made.',
                '財務長必須核准所有超過 500 美元的支出，才能付款。', '空格後接「支出」，主管對支出的動作是「核准」。'),
    'negotiate': ('Our sales team will _____ a new contract with the supplier next week.',
                  '我們的業務團隊下週會和供應商協商新合約。', '「和供應商＿＿新合約」，搭配 negotiate a contract（協商合約）。'),
    'invoice': ('Please send the _____ to our accounting department by the end of the month.',
                '請在月底前把發票寄到我們的會計部門。', '寄給會計部門的文件，最合理的是「發票」。'),
    'deadline': ('The _____ for submitting the quarterly report has been moved to Friday.',
                 '提交季報的截止日期已改到星期五。', '「＿＿ for submitting…moved to Friday」指的是期限。'),
    'itinerary': ('Your travel _____ includes a two-night stay at the Grand Harbor Hotel.',
                  '你的旅遊行程包含在大港飯店住兩晚。', 'travel itinerary 是固定搭配，指「旅遊行程表」。'),
    'reimbursement': ('Employees should submit receipts within 30 days to receive _____ for business travel.',
                      '員工應在 30 天內繳交收據，以獲得出差費用的報銷。', '繳交收據後「獲得＿＿」，最合理的是「報銷」。'),
}


def gemini(route):
    req = route.request
    if req.method == 'GET':
        models = [{'name': f'models/{m}', 'supportedGenerationMethods': ['generateContent']}
                  for m in ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash']]
        return route.fulfill(status=200, content_type='application/json', body=json.dumps({'models': models}))
    prompt = json.loads(req.post_data)['contents'][0]['parts'][0]['text']
    if 'Part 5' in prompt:
        items = re.findall(r'^\d+\. target: "([^"]+)"; distractors: (.+)$', prompt, re.M)
        qs = [{'target': t, 'sentence': PART5[t][0], 'answer': t, 'distractors': re.findall(r'"([^"]+)"', d),
               'translation': PART5[t][1], 'explanation': PART5[t][2]} for t, d in items if t in PART5]
        return route.fulfill(status=200, content_type='application/json', body=json.dumps(
            {'candidates': [{'content': {'parts': [{'text': json.dumps({'questions': qs})}]}, 'finishReason': 'STOP'}]}))
    words = re.findall(r'^\d+\. (.+)$', prompt.split('Words:')[1], re.M)
    cards = [{'word': w, **AI[w]} for w in words if w in AI]
    route.fulfill(status=200, content_type='application/json', body=json.dumps(
        {'candidates': [{'content': {'parts': [{'text': json.dumps({'words': cards})}]}, 'finishReason': 'STOP'}]}))


def free_dict(route):
    word = route.request.url.rstrip('/').split('/')[-1]
    body = [{'word': word, 'meanings': [{'partOfSpeech': 'noun', 'definitions': [
        {'definition': f'(Free Dictionary definition of “{word}”)'}]}]}]
    route.fulfill(status=200, content_type='application/json', body=json.dumps(body))


def goto_word(page, word):
    for _ in range(50):
        if page.locator('.card-front .headword').inner_text() == word:
            return
        page.keyboard.press('ArrowRight')


def shot(page, name, **kw):
    # 不要把提示訊息拍進去
    page.evaluate("document.getElementById('toast')?.classList.remove('show')")
    page.wait_for_timeout(300)
    page.screenshot(path=os.path.join(OUT, name), **kw)
    print('saved', name)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # ---- 第 1–3 步：沒有金鑰，只用字典 ----
    ctx = browser.new_context(viewport={'width': 1000, 'height': 760}, device_scale_factor=1)
    ctx.add_init_script('if (window.speechSynthesis) speechSynthesis.speak = () => {};')
    ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    page = ctx.new_page()
    page.goto(URL + '#/words')
    page.wait_for_load_state('networkidle')
    page.click('#batch summary')
    page.fill('#batchInput', '1. approve 批准\n2. invoice\n3. reimbursement, itinerary\ndeadline negotiate\napprove\ntake over')
    shot(page, '03-batch-preview.png', full_page=True)
    page.click('#batchAdd')
    page.wait_for_timeout(800)
    page.click('#batch summary')
    shot(page, '03-word-list.png', full_page=True)

    page.goto(URL + '#/cards')
    page.wait_for_load_state('networkidle')
    goto_word(page, 'negotiate')
    shot(page, '01-card-front.png')
    page.click('#card')
    page.wait_for_timeout(700)
    shot(page, '02-dictionary-back.png')

    page.click('#markBtn')
    page.click('#card')
    page.wait_for_timeout(700)
    page.click('#themeToggle')
    shot(page, '01-dark-mode.png')
    page.click('#themeToggle')

    m = ctx.new_page()
    m.set_viewport_size({'width': 390, 'height': 760})
    m.goto(URL + '#/cards')
    m.wait_for_load_state('networkidle')
    goto_word(m, 'reimbursement')
    shot(m, '01-mobile.png')

    # ---- 第 5 步：複習頁、滑卡 ----
    m.goto(URL + '#/review')
    m.wait_for_load_state('networkidle')
    box = m.locator('#swipe').bounding_box()
    cx, cy = box['x'] + box['width'] / 2, box['y'] + 120
    m.mouse.move(cx, cy)
    m.mouse.down()
    for i in range(1, 11):
        m.mouse.move(cx + 9 * i, cy + i)
    shot(m, '05-swipe-mobile.png')
    for i in range(9, -1, -1):
        m.mouse.move(cx + 9 * i, cy)
    m.mouse.up()

    page.goto(URL + '#/review')
    page.wait_for_load_state('networkidle')
    page.click('.card-front .headword')
    page.wait_for_timeout(700)
    shot(page, '05-review.png')
    for _ in range(12):
        if page.locator('.done-state').count():
            break
        page.keyboard.press('ArrowLeft' if _ == 1 else 'ArrowRight')
        page.wait_for_timeout(450)
    shot(page, '05-done.png')
    ctx.close()

    # ---- 第 4 步：有 Gemini 金鑰 ----
    ctx = browser.new_context(viewport={'width': 1000, 'height': 760}, device_scale_factor=1)
    ctx.route('https://generativelanguage.googleapis.com/**', gemini)
    ctx.route('https://api.dictionaryapi.dev/**', free_dict)
    page = ctx.new_page()
    page.goto(URL + '#/settings')
    page.wait_for_load_state('networkidle')
    page.fill('#keyInput', 'demo-key-for-screenshot')
    page.click('#keyForm button[type=submit]')
    page.wait_for_selector('#keyStatus[data-kind=ok]')
    shot(page, '04-gemini-settings.png', full_page=True)

    # 截圖時不需要真的等待限速
    page.evaluate("""() => {
      const s = JSON.parse(localStorage.getItem('toeic-cards:settings') || '{}');
      localStorage.setItem('toeic-cards:settings', JSON.stringify({ ...s, llmRpm: 600 }));
    }""")
    page.goto(URL + '#/words')
    page.reload()
    page.wait_for_load_state('networkidle')
    page.click('#batch summary')
    page.fill('#batchInput', '\n'.join(WORDS))
    page.click('#batchAdd')
    page.wait_for_function("() => document.querySelector('#aiBox')?.textContent.includes('全部')", timeout=20000)
    page.click('#batch summary')
    shot(page, '04-ai-done-list.png', full_page=True)

    page.goto(URL + '#/cards')
    page.wait_for_load_state('networkidle')
    goto_word(page, 'approve')
    page.click('#card')
    page.wait_for_timeout(700)
    shot(page, '04-card-ai-zh.png')
    page.click('.seg:has(input[value=en])')
    shot(page, '04-card-ai-en.png')

    # ---- 第 6 步：測驗 ----
    page.goto(URL + '#/quiz')
    page.wait_for_load_state('networkidle')
    shot(page, '06-quiz-home.png', full_page=True)
    page.click('.mode-btn[data-mode=part5]')
    page.wait_for_selector('.q-sentence', timeout=10000)
    sentence = page.locator('.q-sentence').inner_text()
    answer = next(w for w, (sen, _, _) in PART5.items() if sen.split('_____')[0].strip() in sentence)
    page.locator('.option', has_text=answer).first.click()
    shot(page, '06-part5.png')
    page.click('#quit')
    page.click('#home')

    page.click('.mode-btn[data-mode=listen]')
    page.wait_for_selector('.listen-btn')
    page.locator('.option').first.click()
    if page.locator('.feedback.ok').count():
        page.keyboard.press('Enter')
        page.locator('.option').nth(1).click()
    shot(page, '06-listen.png')
    page.click('#quit')
    page.click('#home')
    page.click('#openMistakes')
    shot(page, '06-mistakes.png', full_page=True)
    ctx.close()

    # ---- 第 7 步：統計（一個月的示範學習紀錄，固定的數字，每次截圖都一樣）----
    # 視窗設得夠高，滑鼠移到圖表上時頁面才不會捲動（否則整頁截圖會把置頂的導覽列拍在中間）
    ctx = browser.new_context(viewport={'width': 1000, 'height': 1900}, device_scale_factor=1)
    page = ctx.new_page()
    page.goto(URL + '#/stats')
    page.wait_for_load_state('networkidle')
    page.evaluate("""async () => {
      const { dayKey, dayStart } = await import('/js/srs.js');
      const now = Date.now();
      const key = (i) => { const d = new Date(dayStart(now)); d.setDate(d.getDate() - i); return dayKey(d.getTime() + 60000); };
      const log = {};
      for (let i = 0; i < 30; i++) {
        if (i === 9 || i === 17 || i === 18) continue;                  // 有幾天沒學
        const reviews = 14 + ((i * 7) % 19);
        const again = Math.round(reviews * (0.28 - i * 0.004));         // 越近期答錯越少
        const quiz = i % 3 === 0 ? 10 : i % 5 === 0 ? 20 : 0;
        log[key(i)] = { reviews, again, good: reviews - again, learned: i < 25 ? 6 : 10,
          quiz, quizCorrect: Math.round(quiz * (0.65 + (30 - i) * 0.008)) };
      }
      const start = dayStart(now);
      const words = Array.from({ length: 160 }, (_, i) => {
        const iv = i < 26 ? null : [1, 3, 3, 8, 8, 12, 20, 25, 30, 48][i % 10];
        return { id: 'w' + i, word: 'word' + i, phonetic: '', pos: 'n.', zh: 'n. 示範', en: 'demo', examples: [],
          collocations: [], forms: [], synonyms: [], unfamiliar: i % 9 === 0, src: {}, lookup: { dictAt: 1, enDone: true },
          llm: null, srs: iv === null ? null : { reps: 2, interval: iv, ease: 2.5, lapses: 0, due: start + [0, 0, 1, 1, 1, 2, 3, 3, 4, 6, 6, 9, 12][(i * 7) % 13] * 86400e3 },
          createdAt: i, updatedAt: i };
      });
      localStorage.setItem('toeic-cards:words', JSON.stringify(words));
      localStorage.setItem('toeic-cards:log', JSON.stringify(log));
    }""")
    page.reload()
    page.wait_for_load_state('networkidle')
    page.locator('#chartReviews .chart-hit').nth(27).hover()
    page.wait_for_timeout(200)
    page.screenshot(path=os.path.join(OUT, '07-stats.png'), full_page=True)
    print('saved 07-stats.png')
    page.mouse.move(2, 2)
    page.click('#themeToggle')
    shot(page, '07-stats-dark.png', full_page=True)
    m = ctx.new_page()
    m.set_viewport_size({'width': 390, 'height': 800})
    m.goto(URL + '#/stats')
    m.wait_for_load_state('networkidle')
    shot(m, '07-stats-mobile.png', full_page=True)
    ctx.close()

    browser.close()
