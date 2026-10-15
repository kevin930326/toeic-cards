"""第 33 步：多益短文閱讀（AI 用自己的單字寫 Part 6／7 風格短文＋閱讀理解題）

- 沒有金鑰：可以進入頁面，但不能產生新短文，並說明原因
- 有金鑰：一次請求產生短文；不熟的字優先寫進文章；自己的字在文章裡有標記
- 文章裡的字可以點來查（全站查字視窗）
- 作答：每題立即顯示解析、計入每日測驗量；全部答完才顯示中文翻譯；重新整理後作答紀錄還在
- AI 回傳不完整的短文：不存，顯示錯誤；AI 回傳的 HTML 只當文字顯示
- 刪除短文、手機版面

用法（先在專案根目錄執行 python -m http.server 8123 --bind 127.0.0.1）：
  python tests/test_reading.py
"""
import json
import os
import re
import sys

from playwright.sync_api import sync_playwright

from onboarding_helpers import existing_user
from shots import doc_shot

URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
errors = []
prompts = []
mode = {'broken': False, 'html': False}


def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        errors.append(msg)


def gemini(route):
    req = route.request
    if req.method == 'GET':
        body = {'models': [{'name': 'models/gemini-2.5-flash', 'supportedGenerationMethods': ['generateContent']}]}
        return route.fulfill(status=200, content_type='application/json', body=json.dumps(body))
    prompt = json.loads(req.post_data)['contents'][0]['parts'][0]['text']
    prompts.append(prompt)
    # 假的 AI 回應：一封自然的商務 Email，用到測試加入的 8 個字（網站只會標出這次挑中的字）
    data = {
        'title': '<img src=x onerror="window.__pwned=1">Office Update' if mode['html'] else 'Office Move and Budget Deadline',
        'paragraphs': ['Too short.'] if mode['broken'] else [
            'Dear team, as you may have heard, the merger with Harbor Logistics will be completed next month. '
            'To prepare, we will relocate the accounting department to the third floor on May 12.',
            'Please confirm your new desk number with HR by Friday. All invoices received after May 5 should be sent '
            'to the new address. Managers must also approve the revised budget before the deadline on May 20, '
            'so that the moving schedule is not delayed.',
            'Thank you for your cooperation. Ellen Park, Office Manager',
        ],
        'translation': ['各位同仁：如各位所知，和 Harbor Logistics 的合併將在下個月完成。為此，會計部將在 5 月 12 日搬辦公室到三樓。',
                        '請在星期五前向人資部確認新的座位號碼。5 月 5 日以後收到的請款單請寄到新地址。主管也必須在 5 月 20 日截止前核准修訂後的預算，以免延誤搬遷時程。',
                        '感謝各位配合。辦公室經理 Ellen Park'],
        'targets': ['merger', 'invoice'],
        'questions': [
            {'question': 'What is the main purpose of the email?', 'options': ['To explain changes related to an office move', 'To announce a job opening', 'To advertise a new product', 'To cancel a meeting'], 'answer': 0, 'explanation': '第一段提到合併後會計部要搬辦公室，第二段說明要配合的事項。'},
            {'question': 'By when should employees confirm their desk number?', 'options': ['May 5', 'May 12', 'Friday', 'May 20'], 'answer': 2, 'explanation': '第二段第一句：by Friday。'},
            {'question': 'The word "approve" in paragraph 2 is closest in meaning to', 'options': ['deliver', 'authorize', 'describe', 'delay'], 'answer': 1, 'explanation': 'approve the budget 是「核准預算」，和 authorize（批准）意思最接近。'},
        ],
    }
    route.fulfill(status=200, content_type='application/json', body=json.dumps(
        {'candidates': [{'content': {'parts': [{'text': json.dumps(data)}]}, 'finishReason': 'STOP'}]}))


def store(pg, expr):
    return pg.evaluate(f"import('/js/store.js').then((s) => {{ {expr} }})")


def quiz_count(pg):
    log = json.loads(pg.evaluate("localStorage.getItem('toeic-cards:log')") or '{}')
    return sum(d.get('quiz', 0) for d in log.values())


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1000, 'height': 900})
    existing_user(ctx)
    ctx.add_init_script('if (window.speechSynthesis) speechSynthesis.speak = () => {};')
    ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    ctx.route('https://generativelanguage.googleapis.com/**', gemini)
    pg = ctx.new_page()
    pg.goto(URL + '#/quiz')
    pg.wait_for_load_state('networkidle')
    store(pg, """s.addWords(['relocate', 'confirm', 'budget', 'deadline', 'invoice', 'schedule', 'approve', 'merger'], { autoGenerate: false });
      const w = s.getWords(); s.toggleUnfamiliar(w.find((x) => x.word === 'merger').id, true);
      s.toggleUnfamiliar(w.find((x) => x.word === 'invoice').id, true); return true;""")

    # ---- 入口與沒有金鑰 ----
    pg.goto(URL + '#/quiz')
    pg.wait_for_selector('.reading-entry')
    check('短文閱讀' in pg.locator('.reading-entry').inner_text(), '測驗首頁有「短文閱讀」入口')
    pg.click('.reading-entry')
    pg.wait_for_selector('#generate')
    check(pg.locator('#generate').is_disabled() and 'Gemini 金鑰' in pg.locator('.reading-new').inner_text(),
          '沒有金鑰：不能產生新短文，並說明需要金鑰')

    # ---- 有金鑰：產生短文 ----
    pg.evaluate("localStorage.setItem('toeic-cards:gemini-key', 'fake-key-for-reading-test')")
    pg.reload()
    pg.wait_for_selector('#generate:not([disabled])')
    pg.select_option('#readingType', 'email')
    pg.click('#generate')
    pg.wait_for_selector('.reading-passage')
    check(len(prompts) == 1 and 'ONE business email' in prompts[0], '一次 AI 請求產生一篇 Email')
    used = re.search(r'fine\): (.+)\.', prompts[0]).group(1).split(', ')
    check(set(used[:2]) == {'merger', 'invoice'}, f'不熟的字優先寫進文章：{used}')
    check(pg.locator('.reading-title').inner_text() == 'Office Move and Budget Deadline' and pg.locator('.reading-body p').count() == 3,
          '顯示標題與段落')
    check(pg.locator('.reading-target').count() >= 2, '文章裡自己的字有標記')
    check(pg.locator('.reading-q').count() == 3 and pg.locator('.reading-translation').count() == 0,
          '三題閱讀理解；還沒答完不顯示翻譯')
    pg.screenshot(path=doc_shot('33-reading-passage.png'), full_page=True, style='.topbar { position: static !important; }')

    # 點文章裡的字查詢
    pg.locator('.reading-body .lookup-token', has_text='cooperation').first.click()
    pg.wait_for_selector('#lookupDialog[open]')
    check(pg.locator('#lookupInput').input_value() == 'cooperation', '點文章裡的字，打開查字視窗')
    pg.keyboard.press('Escape')

    # 作答：第 1 題答錯、第 2、3 題答對
    before = quiz_count(pg)
    pg.locator('.reading-q[data-q="0"] .option[data-o="1"]').click()
    pg.wait_for_selector('.reading-q[data-q="0"] .feedback.bad')
    check('正確答案是 (A)' in pg.locator('.reading-q[data-q="0"] .feedback').inner_text()
          and '第一段' in pg.locator('.reading-q[data-q="0"] .fb-explain').inner_text(), '答錯：顯示正確答案與解析')
    pg.locator('.reading-q[data-q="1"] .option[data-o="2"]').click()
    pg.locator('.reading-q[data-q="2"] .option[data-o="1"]').click()
    pg.wait_for_selector('.reading-translation')
    check(quiz_count(pg) - before == 3, '每答一題都計入每日測驗量')
    check('答對 2 / 3' in pg.locator('.quiz-progress').inner_text().replace('\n', ' '), '全部答完顯示分數')
    pg.click('.reading-translation summary')
    check('搬辦公室' in pg.locator('.reading-translation').inner_text(), '答完後可以看中文翻譯')
    pg.screenshot(path=doc_shot('33-reading-answered.png'), full_page=True, style='.topbar { position: static !important; }')

    # 重新整理後還在
    pg.reload()
    pg.wait_for_selector('.reading-item')
    check('答對 2 / 3' in pg.locator('.reading-item').first.inner_text(), '重新整理後，列表保留短文與分數')

    # ---- AI 回傳不完整：不存 ----
    mode['broken'] = True
    pg.click('#generate')
    pg.wait_for_selector('.ai-error')
    check('不完整' in pg.locator('.ai-error').inner_text() and pg.locator('.reading-item').count() == 1,
          'AI 回傳不完整的短文：顯示錯誤，不會存起來')
    mode['broken'] = False

    # ---- AI 回傳的 HTML 只當文字 ----
    mode['html'] = True
    pg.click('#generate')
    pg.wait_for_selector('.reading-passage')
    check(pg.evaluate('window.__pwned') is None and '<img' in pg.locator('.reading-title').inner_text(),
          'AI 回傳的 HTML 只當文字顯示，不會執行')
    mode['html'] = False

    # ---- 刪除 ----
    pg.once('dialog', lambda d: d.accept())
    pg.click('#delete')
    pg.wait_for_selector('.reading-item')
    check(pg.locator('.reading-item').count() == 1, '可以刪除短文')

    # ---- 手機版面 ----
    m = ctx.new_page()
    m.set_viewport_size({'width': 375, 'height': 812})
    m.goto(URL + '#/reading')
    m.wait_for_selector('.reading-item')
    m.click('.reading-item')
    m.wait_for_selector('.reading-passage')
    check(m.evaluate('document.documentElement.scrollWidth <= innerWidth'), '手機 375px 閱讀頁沒有橫向捲動')
    m.screenshot(path=doc_shot('33-reading-mobile.png'), full_page=True, style='.topbar { position: static !important; }')

    ctx.close()
    browser.close()

print()
print('ALL PASSED' if not errors else f'{len(errors)} FAILED')
sys.exit(1 if errors else 0)
