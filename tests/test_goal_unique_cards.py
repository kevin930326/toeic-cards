from onboarding_helpers import existing_user
"""每日目標：同一張卡當天只算一次（按「不熟」後又出現、再評分不重複加）。"""
import os, sys
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'screenshots')
os.makedirs(OUT, exist_ok=True)
URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
errors = []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg, flush=True)
    if not cond: errors.append(msg)

# 三個新字；昨天的舊紀錄沒有 repeat 欄位，打卡結果不能變
SEED = """async () => {
  const { dayKey, dayStart } = await import('/js/srs.js');
  const now = Date.now();
  const y = new Date(dayStart(now)); y.setDate(y.getDate() - 1);
  const log = { [dayKey(y.getTime() + 60000)]: { reviews: 10, good: 6, again: 4, learned: 3, goal: 10 } };
  const words = ['approve', 'invoice', 'deadline'].map((w, i) => ({
    id: w, word: w, phonetic: '', pos: 'v.', zh: 'v. ' + w + '的意思', en: 'meaning of ' + w, examples: [],
    collocations: [], forms: [], synonyms: [], unfamiliar: false, src: {}, lookup: { dictAt: 1, enDone: true },
    llm: null, srs: null, createdAt: i, updatedAt: i }));
  localStorage.clear();
  localStorage.setItem('toeic-cards:words', JSON.stringify(words));
  localStorage.setItem('toeic-cards:log', JSON.stringify(log));
  localStorage.setItem('toeic-cards:settings', JSON.stringify({ dailyGoal: 10 }));
}"""

def today(page):
    return page.evaluate("""async () => { const l = await import('/js/log.js'); return l.getDay(); }""")

def pill(page):
    return page.locator('.goal-pill span').inner_text().strip()

def word(page):
    return page.locator('.flashcard .card-word, .flashcard h2').first.inner_text().strip().lower()

def press(page, key):
    page.keyboard.press(key)
    page.wait_for_timeout(500)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1000, 'height': 900}, service_workers='block')
    existing_user(ctx)
    ctx.add_init_script('window.__toeicFirebaseConfig = null; if (window.speechSynthesis) speechSynthesis.speak = () => {};')
    ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    ctx.route('https://generativelanguage.googleapis.com/**', lambda r: r.fulfill(status=403, body='{}'))
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.goto(URL)
    page.evaluate(SEED)
    page.goto(URL + '#/review'); page.reload(); page.wait_for_load_state('networkidle')

    check(pill(page) == '0/10', '一開始 0/10')
    press(page, 'ArrowLeft')                     # approve 不熟 → 隔幾張再出現
    check(pill(page) == '1/10', '第一次評分 approve（不熟）算 1')
    press(page, 'ArrowRight'); press(page, 'ArrowRight')
    check(pill(page) == '3/10', '另外兩張各算 1')
    check(page.locator('#remain').inner_text() == '1', 'approve 又出現在這一輪')
    press(page, 'ArrowLeft')                     # approve 第二次評分（不熟）
    d = today(page)
    check(pill(page) == '3/10', '同一張卡再評分不加目標')
    check(d['reviews'] == 4 and d['repeat'] == 1, '評分次數仍記 4 次，其中 1 次重複')

    # 復原重複的那次：repeat 一起扣回
    press(page, 'z')
    d = today(page)
    check(d['reviews'] == 3 and d.get('repeat', 0) == 0 and pill(page) == '3/10', '復原重複評分時一起扣回')
    press(page, 'ArrowRight')                    # approve 第二次改按會
    done = page.evaluate("async () => (await import('/js/log.js')).todayProgress().done")
    check(done == 3, '重複出現按「會」也不加目標')
    page.screenshot(path=os.path.join(OUT, 'goal-unique-cards.png'))
    check('複習了 4 次' in page.locator('.done-stats').inner_text(), '完成畫面仍顯示評分次數 4 次')

    # 統計頁：今天 3、昨天舊紀錄照常打卡
    page.goto(URL + '#/stats'); page.wait_for_load_state('networkidle')
    streak = page.evaluate("""async () => { const s = await import('/js/stats.js'); const l = await import('/js/log.js');
      return s.streak(l.getLog(), Date.now(), l.currentGoal()); }""")
    check(streak['days'] == 1 and not streak['todayDone'], '昨天的舊紀錄（沒有 repeat）仍算打卡')
    browser.close()

print('\nERRORS:' if errors else '\nALL PASSED', *errors, sep='\n')
sys.exit(1 if errors else 0)
