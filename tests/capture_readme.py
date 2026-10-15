"""產生 README 展示用的截圖（docs/images/readme/）。

用內建「多益 1000 單字包」的真實內容，加上固定的示範學習紀錄，所以每次截圖都一樣，
也不需要網路或 API 金鑰。所有截圖都用固定的視窗大小（電腦 1000×760、手機 390×760），
README 裡的圖片才會一樣大。截完再執行 tools/make_readme_images.py 把手機截圖合成一張。

用法（先在專案根目錄執行 python -m http.server 8123 --bind 127.0.0.1）：
  python tests/capture_readme.py
  python tools/make_readme_images.py
"""
import os

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'images', 'readme')
URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
DESKTOP = {'width': 1000, 'height': 760}
PHONE = {'width': 390, 'height': 760}
os.makedirs(OUT, exist_ok=True)

INIT = """
if (!localStorage.getItem('toeic-cards:onboarding'))
  localStorage.setItem('toeic-cards:onboarding', JSON.stringify({ version: 1, status: 'skipped' }));
if (window.speechSynthesis) speechSynthesis.speak = () => {};
"""

# 示範學習紀錄：一個月的複習與測驗，部分單字已排入複習（固定數字，每次截圖都一樣）
SEED = """async () => {
  const { dayKey, dayStart } = await import('/js/srs.js');
  const now = Date.now();
  const start = dayStart(now);
  const key = (i) => { const d = new Date(start); d.setDate(d.getDate() - i); return dayKey(d.getTime() + 60000); };
  const log = {};
  for (let i = 1; i < 30; i++) {
    if (i === 9 || i === 17 || i === 18) continue;
    const reviews = 14 + ((i * 7) % 19);
    const again = Math.round(reviews * (0.28 - i * 0.004));
    const quiz = i % 3 === 0 ? 10 : i % 5 === 0 ? 20 : 0;
    log[key(i)] = { reviews, again, good: reviews - again, learned: 6, goal: 20,
      quiz, quizCorrect: Math.round(quiz * (0.65 + (30 - i) * 0.008)) };
  }
  log[key(0)] = { reviews: 12, again: 3, good: 9, learned: 4, goal: 20, quiz: 0, quizCorrect: 0 };
  const words = JSON.parse(localStorage.getItem('toeic-cards:words'));
  words.forEach((w, i) => {
    if (i < 8) return;                                       // 前 8 個字留作今天的新字
    const iv = [1, 3, 3, 8, 8, 12, 20, 25, 30, 48][i % 10];
    w.srs = { reps: 2 + (i % 4), interval: iv, ease: 2.5, lapses: i % 7 === 0 ? 1 : 0,
      due: start + [0, 1, 1, 2, 3, 3, 4, 6, 9, 12][(i * 7) % 10] * 86400e3 };
    if (i % 9 === 0) w.unfamiliar = true;
  });
  localStorage.setItem('toeic-cards:words', JSON.stringify(words));
  localStorage.setItem('toeic-cards:log', JSON.stringify(log));
}"""


def shot(page, name, **kw):
    page.evaluate("document.getElementById('toast')?.classList.remove('show')")
    page.mouse.move(1, 1)
    page.wait_for_timeout(400)
    page.screenshot(path=os.path.join(OUT, name), **kw)
    print('saved', name)


def go(page, route):
    page.goto(URL + '#/' + route)
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(600)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport=DESKTOP, device_scale_factor=1)
    ctx.add_init_script(INIT)
    ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    page = ctx.new_page()

    # ---- 內建單字包：加入第 1 組 ----
    go(page, 'words')
    page.click('#openAddWords')
    page.click('[data-tool=pack]')
    page.wait_for_selector('#packGroup')
    page.fill('#packName', '多益 1000')
    shot(page, 'pack.png')
    page.click('#packAdd')
    page.wait_for_timeout(1500)
    page.click('[aria-label="關閉加入單字"]')
    page.evaluate(SEED)
    page.reload()
    page.wait_for_load_state('networkidle')

    # ---- 單字庫 ----
    go(page, 'words')
    shot(page, 'library.png')

    # ---- 今日複習：翻到背面 ----
    go(page, 'review')
    page.click('.card-front .headword')
    page.wait_for_timeout(800)
    shot(page, 'review.png')

    # ---- 單字探索，再點英文解釋裡的字查詢 ----
    go(page, 'cards')
    page.locator('#exploreList li').nth(3).click()
    page.wait_for_timeout(500)
    shot(page, 'explore.png')
    page.locator('#exploreDetail [data-lookup-word=event]').first.click()   # venue 的解釋：the place where an event is held
    page.wait_for_selector('#lookupResult .lookup-card')
    page.wait_for_timeout(500)
    shot(page, 'lookup.png')
    page.keyboard.press('Escape')

    # ---- 測驗：看中文選英文，故意答錯看說明 ----
    go(page, 'quiz')
    page.click('.mode-btn[data-mode=zh2en]')
    page.wait_for_selector('.option')
    page.locator('.option').first.click()
    if page.locator('.feedback.ok').count():
        page.keyboard.press('Enter')
        page.wait_for_selector('.option:not([disabled])')
        page.locator('.option').nth(1).click()
    shot(page, 'quiz.png')

    # ---- 統計 ----
    go(page, 'stats')
    shot(page, 'stats.png')

    # ---- 深色模式：自由翻卡 ----
    go(page, 'free')
    page.click('#themeToggle')
    page.click('.card-front .headword')
    page.wait_for_timeout(800)
    shot(page, 'dark.png')
    page.click('#themeToggle')

    # ---- 手機 ----
    m = ctx.new_page()
    m.set_viewport_size(PHONE)
    go(m, 'review')
    box = m.locator('#swipe').bounding_box()
    cx, cy = box['x'] + box['width'] / 2, box['y'] + 120
    m.mouse.move(cx, cy)
    m.mouse.down()
    for i in range(1, 11):
        m.mouse.move(cx + 9 * i, cy + i)
    m.wait_for_timeout(300)
    m.screenshot(path=os.path.join(OUT, 'phone-review.png'))
    print('saved phone-review.png')
    for i in range(9, -1, -1):
        m.mouse.move(cx + 9 * i, cy)
    m.mouse.up()

    go(m, 'cards')
    shot(m, 'phone-explore.png')
    go(m, 'stats')
    m.click('#themeToggle')
    shot(m, 'phone-stats.png')
    m.click('#themeToggle')

    ctx.close()
    browser.close()
