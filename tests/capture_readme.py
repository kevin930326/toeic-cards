"""產生 README 展示用的截圖（docs/images/readme/）。

用內建「多益 1000 單字包」的真實內容，加上固定的示範學習紀錄，所以每次截圖都一樣，
也不需要網路或 API 金鑰。所有截圖都用固定的視窗大小（電腦 1000×760、手機 390×760），
README 裡的圖片才會一樣大。截完再執行 tools/make_readme_images.py 把手機截圖合成一張。

用法（先在專案根目錄執行 python -m http.server 8123 --bind 127.0.0.1）：
  python tests/capture_readme.py
  python tests/capture_readme.py --updates-only  # 只更新導覽、批次整理與刪除
  python tools/make_readme_images.py
"""
import json
import os
import argparse

from playwright.sync_api import sync_playwright
from storage_helpers import flush

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'images', 'readme')
URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
DESKTOP = {'width': 1000, 'height': 760}
PHONE = {'width': 390, 'height': 760}
os.makedirs(OUT, exist_ok=True)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--updates-only', action='store_true', help='只拍實際導覽、批次刪除及手機輸入的新展示圖')
args = parser.parse_args()

INIT = """
// 固定的隨機數：每次截圖抽到同樣的題目、同樣的順序，畫面沒改時截圖也不會變
(() => { let a = 20261016; Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
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


# 詞性變化題庫：用來找出每題的正確答案（截圖要拍「答對」的畫面）
BANK = json.load(open(os.path.join(ROOT, 'data', 'packs', 'toeic-1000-forms.json'), encoding='utf-8'))
ANSWER_BY_SENTENCE = {q['sentence']: q['answer'] for q in BANK['questions']}

# 短文閱讀的示範 AI 回應：一封用到單字包第 1 組 6 個字的 Email
READING_WORDS = ['appointment', 'reservation', 'receipt', 'payment', 'department', 'flight']
READING = {
    'title': 'Your Business Trip to Osaka',
    'paragraphs': [
        'Dear Mr. Chen, thank you for booking your business trip through our travel department. '
        'Your flight to Osaka departs at 9:15 a.m. on May 12, and your hotel reservation has been confirmed for three nights.',
        'Full payment for the trip was received yesterday. A copy of your receipt is attached to this email. '
        'Please keep it for your expense report.',
        'If you need to change your appointment with our client in Osaka, please let us know by Friday so that we can update your schedule.',
    ],
    'translation': [
        '陳先生您好：感謝您透過我們的差旅部門預訂這次出差。您飛往大阪的班機在 5 月 12 日上午 9:15 起飛，飯店也已確認訂好三晚。',
        '這趟行程的全額款項已於昨天收到。收據副本附在這封信裡，請保留以便申報費用。',
        '如果需要更改和大阪客戶的會面，請在星期五前告訴我們，以便更新您的行程。',
    ],
    'targets': READING_WORDS,
    'questions': [
        {'question': 'What is the main purpose of the email?', 'options': ['To confirm travel arrangements', 'To cancel a hotel booking', 'To request a payment', 'To announce a new office'], 'answer': 0, 'explanation': '第一段說明班機和飯店都已確認，整封信在確認出差安排。'},
        {'question': 'What is attached to the email?', 'options': ['A flight ticket', 'A receipt', 'A map of Osaka', 'An expense report'], 'answer': 1, 'explanation': '第二段：A copy of your receipt is attached。'},
        {'question': 'By when should Mr. Chen report a change to his appointment?', 'options': ['May 12', 'Tomorrow', 'Friday', 'After the trip'], 'answer': 2, 'explanation': '第三段：please let us know by Friday。'},
    ],
}


def gemini(route):
    body = {'candidates': [{'content': {'parts': [{'text': json.dumps(READING)}]}, 'finishReason': 'STOP'}]}
    route.fulfill(status=200, content_type='application/json', body=json.dumps(body))


def go(page, route):
    page.goto(URL + '#/' + route)
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(600)


def capture_updates(browser, page, context):
    go(page, 'help')
    page.click('[data-tour=library]')
    page.click('#openAddWords')
    page.wait_for_selector('#addWordsDialog #guidedTour')
    shot(page, 'tour.png')
    page.click('#tourExit')
    page.click('#addWordsDialog [data-close]')

    go(page, 'words')
    page.click('#toggleBulk')
    for i in range(3):
        page.locator('.word-select').nth(i).check()
    page.evaluate('scrollTo(0,0)')
    shot(page, 'bulk.png')
    page.click('#bulkDelete')
    shot(page, 'delete.png')
    page.click('#cancelWordDeletion')

    # 使用同一份示範字卡，真正的手機觸控 context；不注入／截出使用者資料。
    mobile = browser.new_context(viewport=PHONE, is_mobile=True, has_touch=True,
                                 device_scale_factor=1, storage_state=context.storage_state(), service_workers='block')
    mobile.add_init_script(INIT + '\nwindow.__toeicFirebaseConfig=null;')
    mobile.route('https://api.dictionaryapi.dev/**', lambda r:r.fulfill(status=404, body='{}'))
    m = mobile.new_page()
    m.on('pageerror', lambda e: print('mobile page error:', str(e), flush=True))
    go(m, 'help')
    if not m.locator('[data-tour=library]').count():
        m.screenshot(path=os.path.join(ROOT,'tests','screenshots','readme-mobile-debug.png'))
        raise AssertionError('手機教學頁未完成載入：' + m.locator('#view').inner_text()[:200])
    m.click('[data-tour=library]'); m.click('#openAddWords')
    m.wait_for_selector('#addWordsDialog #guidedTour')
    shot(m, 'phone-tour.png')
    m.locator('#addInput').tap(); m.fill('#addInput', 'invoice')
    m.wait_for_selector('.tour-tip.is-editing')
    shot(m, 'phone-tour-input.png')
    m.click('#tourKeyboard'); m.click('#tourExit')
    m.click('#addWordsDialog [data-close]')
    go(m, 'words'); m.click('#toggleBulk')
    for i in range(3):
        m.locator('.word-select').nth(i).check()
    m.click('#themeToggle'); m.click('#bulkDelete')
    shot(m, 'phone-delete.png')
    m.click('#cancelWordDeletion')
    mobile.close()
    go(page, 'help')


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport=DESKTOP, device_scale_factor=1)
    ctx.add_init_script(INIT)
    ctx.add_init_script('window.__toeicFirebaseConfig=null;')
    ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    page = ctx.new_page()

    # ---- 內建單字包：加入第 1 組 ----
    go(page, 'words')
    page.click('#openAddWords')
    page.click('[data-tool=pack]')
    page.wait_for_selector('#packGroup')
    page.fill('#packName', '多益 1000')
    if not args.updates_only:
        shot(page, 'pack.png')
    page.click('#packAdd')
    page.wait_for_timeout(1500)
    page.click('[aria-label="關閉加入單字"]')
    flush(page)
    page.evaluate(SEED)
    # 考試在 45 天後；示範用的金鑰（Gemini 用上面的假回應）
    page.evaluate("""async () => {
      const { dayKey, dayStart } = await import('/js/srs.js');
      const d = new Date(dayStart(Date.now())); d.setDate(d.getDate() + 45);
      const s = JSON.parse(localStorage.getItem('toeic-cards:settings') || '{}');
      localStorage.setItem('toeic-cards:settings', JSON.stringify({ ...s, examDate: dayKey(d.getTime() + 60000), newPerDay: 20 }));
      localStorage.setItem('toeic-cards:gemini-key', 'demo-key-for-screenshot');
    }""")
    ctx.route('https://generativelanguage.googleapis.com/**', gemini)
    page.reload()
    page.wait_for_load_state('networkidle')

    capture_updates(browser, page, ctx)
    if args.updates_only:
        ctx.close(); browser.close()
        raise SystemExit(0)

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

    # ---- 詞性變化：答對的畫面（先結束上一段的測驗；暫時拿掉金鑰，題目全部來自內建題庫）----
    page.click('#quit')
    page.click('#home')
    page.evaluate("localStorage.removeItem('toeic-cards:gemini-key')")
    go(page, 'quiz')
    page.reload()
    page.wait_for_selector('.mode-btn[data-mode=forms]')
    page.click('.mode-btn[data-mode=forms]')
    page.wait_for_selector('.q-forms .q-sentence')
    sentence = page.locator('.q-sentence').inner_text().replace('_______', '_____')
    opts = page.locator('.option .option-text').all_inner_texts()
    page.locator('.option').nth(opts.index(ANSWER_BY_SENTENCE[sentence])).click()
    page.wait_for_selector('.feedback.ok')
    shot(page, 'forms.png')
    page.click('#quit')
    page.evaluate("localStorage.setItem('toeic-cards:gemini-key', 'demo-key-for-screenshot')")

    # ---- 短文閱讀：用 6 個「不熟」的字產生，答完第一題 ----
    page.evaluate("""async (wanted) => {
      const s = await import('/js/store.js');
      for (const w of s.getWords()) s.toggleUnfamiliar(w.id, wanted.includes(w.word));
    }""", READING_WORDS)
    go(page, 'reading')
    page.select_option('#readingType', 'email')
    page.click('#generate')
    page.wait_for_selector('.reading-passage')
    page.locator('.reading-q[data-q="0"] .option[data-o="0"]').click()
    page.wait_for_timeout(300)
    page.evaluate('window.scrollTo(0, 0)')
    shot(page, 'reading.png')

    # ---- 統計（最上面是考試倒數）----
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
