from onboarding_helpers import existing_user
"""每日目標＋連續打卡（端對端測試）"""
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

# 昨天、前天已經打卡（當時目標 10），今天還沒學；有 6 個新字可以複習
SEED = """async () => {
  const { dayKey, dayStart } = await import('/js/srs.js');
  const now = Date.now();
  const key = (i) => { const d = new Date(dayStart(now)); d.setDate(d.getDate() - i); return dayKey(d.getTime() + 60000); };
  const log = {};
  log[key(1)] = { reviews: 8, good: 8, again: 0, learned: 2, quiz: 2, quizCorrect: 2, goal: 10 };
  log[key(2)] = { reviews: 10, good: 9, again: 1, learned: 4, goal: 10 };
  const words = ['approve', 'invoice', 'deadline', 'negotiate', 'postpone', 'submit'].map((w, i) => ({
    id: w, word: w, phonetic: '', pos: 'v.', zh: 'v. ' + w + '的意思', en: 'meaning of ' + w, examples: [],
    collocations: [], forms: [], synonyms: [], unfamiliar: false, src: {}, lookup: { dictAt: 1, enDone: true },
    llm: null, srs: null, createdAt: i, updatedAt: i }));
  localStorage.clear();
  localStorage.setItem('toeic-cards:words', JSON.stringify(words));
  localStorage.setItem('toeic-cards:log', JSON.stringify(log));
}"""

def today(page):
    return page.evaluate("""async () => {
      const { dayKey } = await import('/js/srs.js');
      return JSON.parse(localStorage.getItem('toeic-cards:log'))[dayKey(Date.now())] || null;
    }""")

def pill(page):
    return page.locator('.goal-pill').inner_text().strip()

def answer(page):
    before = page.locator('#remain').inner_text() if page.locator('#remain').count() else None
    page.keyboard.press('ArrowRight')
    page.wait_for_timeout(450)
    return before

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1000, 'height': 900})
    existing_user(ctx)
    ctx.add_init_script('if (window.speechSynthesis) speechSynthesis.speak = () => {};')
    ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    page = ctx.new_page()
    page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append('console: ' + m.text))
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.goto(URL)
    page.evaluate(SEED)

    # ---- 設定每日目標 ----
    page.goto(URL + '#/settings')
    page.reload()
    page.wait_for_load_state('networkidle')
    check(page.locator('input[name=dailyGoal][value="20"]').is_checked(), '預設每日目標 20 題')
    page.click('.seg:has(input[name=dailyGoal][value="10"])')
    check(json.loads(page.evaluate("localStorage.getItem('toeic-cards:settings')"))['dailyGoal'] == 10, '每日目標設定會儲存')
    page.evaluate("""() => {
      const s = JSON.parse(localStorage.getItem('toeic-cards:settings'));
      localStorage.setItem('toeic-cards:settings', JSON.stringify({ ...s, dailyGoal: 3 }));   // 測試用：3 題就達標
    }""")

    # ---- 複習頁的目標徽章 ----
    page.goto(URL + '#/review')
    page.reload()
    page.wait_for_load_state('networkidle')
    check(pill(page) == '0/3' and 'is-met' not in page.get_attribute('.goal-pill', 'class'), f'今日進度 0/3（{pill(page)}）')
    answer(page)
    answer(page)
    check(pill(page) == '2/3', f'複習 2 張 → 2/3（{pill(page)}）')
    check(not page.locator('#toast').evaluate("e => e.classList.contains('show')") or '目標' not in page.locator('#toast').inner_text(), '還沒達標時不會慶祝')
    answer(page)
    toast = page.locator('#toast')
    check(toast.evaluate("e => e.classList.contains('show')") and '今日目標達成！連續打卡 3 天' in toast.inner_text(), f'達標時慶祝並顯示連續天數：{toast.inner_text()!r}')
    check(toast.get_attribute('data-kind') == 'success', '慶祝訊息用成功的樣式')
    check(pill(page) == '3/3' and 'is-met' in page.get_attribute('.goal-pill', 'class'), '達標後徽章變成完成狀態')
    check(page.locator('.goal-pill .goal-check').count() == 1, '進度環出現打勾')
    check(today(page)['goal'] == 3, f"當天的目標記在紀錄裡（{today(page).get('goal')}）")
    page.screenshot(path=os.path.join(OUT, 'goal_review.png'))

    # 復原到目標以下、再達標：不會再慶祝一次
    page.wait_for_timeout(2800)   # 等第一個訊息消失
    page.keyboard.press('z')
    page.wait_for_timeout(300)
    check(pill(page) == '2/3', '復原後回到 2/3')
    answer(page)
    shown = toast.evaluate("e => e.classList.contains('show')")
    check(not shown or '目標' not in toast.inner_text(), '同一天不會重複慶祝')

    # ---- 測驗也算進度 ----
    page.goto(URL + '#/quiz')
    page.click('.mode-btn[data-mode=zh2en]')
    for _ in range(2):
        page.keyboard.press('1')
        page.keyboard.press('Enter')
    t = today(page)
    check(t['reviews'] + t['quiz'] == 5, f"複習 3 張＋測驗 2 題＝ 5（{t['reviews']} + {t['quiz']}）")
    page.click('#quit')
    page.click('#home')

    # ---- 統計頁 ----
    page.goto(URL + '#/stats')
    hero = page.locator('.kpi-hero').inner_text().replace('\n', ' ')
    check(page.locator('#streakDays').inner_text() == '3', f"連續打卡 3 天（前天、昨天用當時的目標 10 也達標）：{page.locator('#streakDays').inner_text()}")
    check('今日 5 / 3 題' in hero and '打卡成功' in hero, f'統計頁顯示今日進度：{hero!r}')
    page.screenshot(path=os.path.join(OUT, 'goal_stats.png'))

    # ---- 今天把目標調高到 50：今天要重新達標，過去的打卡不受影響 ----
    page.goto(URL + '#/settings')
    page.click('.seg:has(input[name=dailyGoal][value="50"])')
    page.goto(URL + '#/stats')
    hero = page.locator('.kpi-hero').inner_text().replace('\n', ' ')
    check(page.locator('#streakDays').inner_text() == '2', f"目標調到 50：今天還沒打卡，從昨天算 2 天（{page.locator('#streakDays').inner_text()}）")
    check('還差 45 題就能打卡' in hero and '今日 5 / 50 題' in hero, f'顯示還差幾題：{hero!r}')

    # ---- 複習完的畫面：沒達標時建議去測驗 ----
    page.goto(URL + '#/review')
    for _ in range(10):
        if page.locator('.done-state').count():
            break
        answer(page)
    done = page.locator('.done-state').inner_text()
    check('還差' in done and '去測驗' in done, f'完成畫面提示還差幾題、可以去測驗：{done[:80]!r}')
    page.click('.goal-todo a')
    check(page.url.endswith('#/quiz'), '「去測驗」連結可以用')
    # 今天共 8 題（複習 6＋測驗 2）；目標改成 5 就達標
    page.evaluate("""() => {
      const s = JSON.parse(localStorage.getItem('toeic-cards:settings'));
      localStorage.setItem('toeic-cards:settings', JSON.stringify({ ...s, dailyGoal: 5 }));
    }""")
    page.goto(URL + '#/review')
    page.reload()
    page.wait_for_load_state('networkidle')
    check('今日目標達成！已連續打卡' in page.locator('.done-state').inner_text(), '達標時完成畫面顯示打卡成功')
    page.screenshot(path=os.path.join(OUT, 'goal_done.png'))

    # ---- 手機版 ----
    m = ctx.new_page()
    m.set_viewport_size({'width': 375, 'height': 812})
    m.goto(URL + '#/review')
    m.wait_for_load_state('networkidle')
    sw = m.evaluate('document.documentElement.scrollWidth')
    check(sw <= 375, f'手機無橫向捲動 {sw}')

    browser.close()

print('\nERRORS:' if errors else '\nALL PASSED', *errors, sep='\n')
sys.exit(1 if errors else 0)
