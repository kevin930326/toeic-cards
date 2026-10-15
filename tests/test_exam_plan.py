"""第 34 步：考試倒數＋讀書計畫

- 沒設定考試日期：統計頁顯示「設定考試日期」的入口
- 設定頁填入日期：統計頁顯示倒數天數、還沒學的新字數、建議每天新字數
- 速度不夠時提醒，按一下就把每天新字數改成建議值；設定頁顯示這個數字（考試計畫）
- 今日複習顯示倒數；考試日期已過、清除日期
- 手機版面

用法（先在專案根目錄執行 python -m http.server 8123 --bind 127.0.0.1）：
  python tests/test_exam_plan.py
"""
import os
import sys

from playwright.sync_api import sync_playwright

from onboarding_helpers import existing_user
from shots import doc_shot

URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
errors = []


def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        errors.append(msg)


def store(pg, expr):
    return pg.evaluate(f"import('/js/store.js').then((s) => {{ {expr} }})")


def date_after(pg, days):
    """瀏覽器裡「今天」（早上 4 點換日）往後 days 天的日期"""
    return pg.evaluate(f"""import('/js/srs.js').then(({{ dayKey, dayStart }}) => {{
      const d = new Date(dayStart(Date.now())); d.setDate(d.getDate() + {days}); return dayKey(d.getTime() + 60000); }})""")


def set_exam(pg, value):
    pg.goto(URL + '#/settings')
    pg.wait_for_selector('#examDate')
    pg.fill('#examDate', value)
    pg.locator('#examDate').dispatch_event('change')


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1000, 'height': 900})
    existing_user(ctx)
    ctx.add_init_script('if (window.speechSynthesis) speechSynthesis.speak = () => {};')
    ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    pg = ctx.new_page()
    pg.goto(URL + '#/stats')
    pg.wait_for_load_state('networkidle')
    # 50 個字，其中 10 個已經學過
    store(pg, """s.addWords(Array.from({ length: 50 }, (_, i) => 'examword' + String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + i % 26)), { autoGenerate: false });
      s.updateWords(s.getWords().slice(0, 10).map((w) => [w.id, { srs: { reps: 1, interval: 1, ease: 2.5, lapses: 0, due: Date.now() + 864e5 } }]));
      s.updateSettings({ newPerDay: 20 }); return true;""")

    # ---- 沒設定 ----
    pg.goto(URL + '#/stats')
    pg.wait_for_selector('.exam-card')
    check(pg.locator('a.exam-empty[href="#/settings"]').count() == 1, '沒設定考試日期：統計頁顯示設定入口')

    # ---- 30 天後考試：跟得上 ----
    set_exam(pg, date_after(pg, 30))
    check(store(pg, 'return s.getSettings().examDate;') == date_after(pg, 30), '設定頁可以填考試日期')
    pg.goto(URL + '#/stats')
    pg.wait_for_selector('#examDays')
    card = pg.locator('#examCard').inner_text()
    check(pg.locator('#examDays').inner_text() == '30' and '40 個新字沒學' in card, f'倒數 30 天、還有 40 個新字：{card!r}')
    check(pg.locator('#examSuggested').inner_text() == '2' and '考前一週學完' in card and '跟得上' in card,
          '超過 14 天：建議值讓新字在考前一週學完（40 ÷ 23 ≈ 2），目前 20 個跟得上')
    check(pg.locator('#applyPlan').count() == 0, '跟得上進度時不建議調低（不顯示套用按鈕）')

    # ---- 5 天後考試、每天只學 5 個：跟不上 ----
    set_exam(pg, date_after(pg, 5))
    store(pg, 's.updateSettings({ newPerDay: 5 }); return true;')
    pg.goto(URL + '#/stats')
    pg.wait_for_selector('#examDays')
    card = pg.locator('#examCard').inner_text()
    check(pg.locator('#examSuggested').inner_text() == '8' and '要 8 天才學完' in card,
          f'14 天以內：每天都學新字（40 ÷ 5 = 8）；目前 5 個跟不上並提醒：{card!r}')
    pg.evaluate('window.scrollTo(0, 0)')
    pg.wait_for_timeout(200)
    pg.screenshot(path=doc_shot('34-exam-plan.png'), clip={'x': 0, 'y': 0, 'width': 1000, 'height': 420})
    pg.click('#applyPlan')
    check(store(pg, 'return s.getSettings().newPerDay;') == 8 and '跟得上' in pg.locator('#examCard').inner_text(),
          '按「改成每天 8 個新字」就套用，卡片改成跟得上')
    pg.goto(URL + '#/settings')
    pg.wait_for_selector('input[name=newPerDay]')
    checked = pg.locator('input[name=newPerDay]:checked').evaluate('e => e.closest(".seg").innerText')
    check('8 個/天（考試計畫）' in checked, f'設定頁顯示套用後的每天新字數：{checked!r}')

    # ---- 今日複習顯示倒數 ----
    pg.goto(URL + '#/review')
    pg.wait_for_selector('.review-purpose')
    check('距離多益還有 5 天' in pg.locator('.review-purpose').inner_text().replace('\n', ''), '今日複習顯示考試倒數')

    # ---- 已經過了、清除 ----
    set_exam(pg, date_after(pg, -3))
    pg.goto(URL + '#/stats')
    pg.wait_for_selector('.exam-card')
    check('已經過了' in pg.locator('.exam-card').inner_text(), '考試日期已過：提醒設定下一次的日期')
    pg.goto(URL + '#/review')
    pg.wait_for_selector('.review-purpose')
    check('距離多益' not in pg.locator('.review-purpose').inner_text(), '考試日期已過：今日複習不顯示倒數')
    pg.goto(URL + '#/settings')
    pg.click('#examClear')
    check(store(pg, 'return s.getSettings().examDate;') == '', '可以清除考試日期')

    # ---- 手機版面 ----
    set_exam(pg, date_after(pg, 20))
    m = ctx.new_page()
    m.set_viewport_size({'width': 375, 'height': 812})
    m.goto(URL + '#/stats')
    m.wait_for_selector('#examCard')
    check(m.evaluate('document.documentElement.scrollWidth <= innerWidth'), '手機 375px 統計頁沒有橫向捲動')
    m.screenshot(path=doc_shot('34-exam-plan-mobile.png'))

    ctx.close()
    browser.close()

print()
print('ALL PASSED' if not errors else f'{len(errors)} FAILED')
sys.exit(1 if errors else 0)
