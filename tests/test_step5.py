"""第 5 步：間隔重複＋滑卡手勢（端對端測試）"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'screenshots')
os.makedirs(OUT, exist_ok=True)
URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
errors = []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        errors.append(msg)

HOUR = 3600 * 1000
DAY = 24 * HOUR

def make_word(word, created, srs=None, unfamiliar=False):
    return {
        'id': word, 'word': word, 'phonetic': '', 'pos': 'n.', 'zh': f'n. {word}的意思', 'en': f'meaning of {word}',
        'examples': [], 'collocations': [], 'forms': [], 'synonyms': [], 'unfamiliar': unfamiliar,
        'src': {'zh': 'dict', 'en': 'freedict'}, 'lookup': {'dictAt': 1, 'enDone': True},
        'llm': None, 'srs': srs, 'createdAt': created, 'updatedAt': created,
    }

def seed(page):
    now = page.evaluate('Date.now()')
    words = [
        make_word('overdue', 10, {'reps': 2, 'interval': 3, 'ease': 2.5, 'lapses': 0, 'due': now - 2 * HOUR}),
        make_word('mastered', 11, {'reps': 3, 'interval': 9, 'ease': 2.5, 'lapses': 0, 'due': now - HOUR}, unfamiliar=True),
        make_word('future', 12, {'reps': 1, 'interval': 3, 'ease': 2.5, 'lapses': 0, 'due': now + 3 * DAY}),
    ] + [make_word(f'new{i}', 100 + i) for i in range(1, 6)]
    page.evaluate("""([ws]) => {
      localStorage.setItem('toeic-cards:words', JSON.stringify(ws));
      localStorage.setItem('toeic-cards:settings', JSON.stringify({ newPerDay: 3 }));
      localStorage.removeItem('toeic-cards:log');
    }""", [words])

def db(page):
    return {w['word']: w for w in page.evaluate("JSON.parse(localStorage.getItem('toeic-cards:words'))")}

def today_log(page):
    log = page.evaluate("JSON.parse(localStorage.getItem('toeic-cards:log') || '{}')")
    return list(log.values())[0] if log else {}

def head(page):
    return page.locator('.card-front .headword').inner_text()

def remain(page):
    return int(page.locator('#remain').inner_text())

def wait_card(page, word):
    page.wait_for_function(f"() => document.querySelector('.card-front .headword')?.textContent === {json.dumps(word)}", timeout=3000)

def mouse_drag(page, dx):
    box = page.locator('#swipe').bounding_box()
    x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    for i in range(1, 11):
        page.mouse.move(x + dx * i / 10, y + 2)
        page.wait_for_timeout(16)
    page.mouse.up()
    page.wait_for_timeout(400)

def touch_tap(page, cdp, selector):
    # 觸控全部走同一個 DevTools 通道（和 Playwright 的 tap() 混用會讓 Chrome 的手勢狀態錯亂）
    box = page.locator(selector).bounding_box()
    x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    page.wait_for_timeout(600)

def touch_drag(page, cdp, dx, dy=0):
    box = page.locator('#swipe').bounding_box()
    x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
    for i in range(1, 11):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x + dx * i / 10, 'y': y + dy * i / 10}]})
        time.sleep(0.016)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    page.wait_for_timeout(400)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1000, 'height': 900})
    ctx.add_init_script('if (window.speechSynthesis) speechSynthesis.speak = () => {};')
    ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    page = ctx.new_page()
    page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append('console: ' + m.text))
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.goto(URL)
    page.wait_for_load_state('networkidle')
    seed(page)
    page.reload()
    page.wait_for_load_state('networkidle')

    # ---- 首頁是複習頁、排序正確 ----
    check(page.locator('.nav a.active').get_attribute('data-route') == 'review', '首頁是「複習」')
    check(page.locator('#reviewBadge').inner_text() == '5', f"導覽列徽章 {page.locator('#reviewBadge').inner_text()}（到期 2＋新字上限 3）")
    check(remain(page) == 5 and head(page) == 'overdue', '先複習最早到期的字')
    check('3 天' not in page.locator('#good').inner_text() and '8 天' in page.locator('#good').inner_text(), f"「會」按鈕預覽間隔：{page.locator('#good').inner_text()!r}")
    check('10 分鐘' in page.locator('#again').inner_text(), '「不熟」按鈕預覽 10 分鐘')
    page.screenshot(path=os.path.join(OUT, 's5_review.png'))

    # a. 點擊翻面 → 按「會」
    page.click('#card')
    page.wait_for_timeout(600)
    check('is-flipped' in page.get_attribute('#card', 'class'), '點擊翻面')
    page.click('#good')
    wait_card(page, 'mastered')
    w = db(page)['overdue']
    check(w['srs']['interval'] == 8 and w['srs']['reps'] == 3, f"overdue 間隔 3→8 天：{w['srs']['interval']}")
    check(remain(page) == 4 and page.locator('#reviewBadge').inner_text() == '4', '剩 4 張、徽章同步更新')
    check('is-flipped' not in page.get_attribute('#card', 'class'), '下一張從正面開始')

    # b. → 鍵：間隔達 21 天自動取消「不熟」
    page.keyboard.press('ArrowRight')
    wait_card(page, 'new1')
    w = db(page)['mastered']
    check(w['srs']['interval'] == 23 and w['unfamiliar'] is False, f"間隔 9→23 天，自動取消不熟（{w['srs']['interval']}, {w['unfamiliar']}）")

    # c. ← 鍵：不熟 → 標記不熟、隔幾張再出現
    page.keyboard.press('ArrowLeft')
    wait_card(page, 'new2')
    w = db(page)['new1']
    now = page.evaluate('Date.now()')
    check(w['unfamiliar'] is True and abs(w['srs']['due'] - (now + 10 * 60 * 1000)) < 5000, 'new1 標記不熟、10 分鐘後到期')
    check(remain(page) == 3, '答不熟的字留在這一輪')

    # d. Z 復原
    page.keyboard.press('z')
    wait_card(page, 'new1')
    w = db(page)['new1']
    check(w['srs'] is None and w['unfamiliar'] is False, '復原：new1 回到新字狀態')
    check(today_log(page).get('again') == 0 and today_log(page).get('reviews') == 2, f'復原也會扣回紀錄 {today_log(page)}')

    # e. 滑鼠往右滑 → 會
    mouse_drag(page, 260)
    wait_card(page, 'new2')
    check(db(page)['new1']['srs']['interval'] == 1, '滑鼠往右滑＝會')

    # f. 拖一點點會彈回、不評分；往左滑＝不熟
    mouse_drag(page, 30)
    check(head(page) == 'new2' and db(page)['new2']['srs'] is None, '拖一點點會彈回，不評分')
    check('is-flipped' not in page.get_attribute('#card', 'class'), '拖曳後放開不會被當成點擊翻面')
    check(page.evaluate("getComputedStyle(document.querySelector('#swipe')).transform") in ('none', 'matrix(1, 0, 0, 1, 0, 0)'), '卡片回到原位')
    mouse_drag(page, -260)
    wait_card(page, 'new3')
    check(db(page)['new2']['unfamiliar'] is True, '滑鼠往左滑＝不熟')

    # g. 按鈕評分剩下的
    page.click('#good')
    wait_card(page, 'new2')
    check(True, '答不熟的 new2 在這一輪稍後再出現')
    page.click('#good')
    page.wait_for_selector('.done-state')
    log = today_log(page)
    check(log == {'reviews': 6, 'again': 1, 'good': 5, 'learned': 3}, f'今日紀錄 {log}')
    done = page.locator('.done-state').inner_text()
    check('今天的複習完成了' in done and '複習了 6 次' in done, '完成畫面顯示統計')
    check('再學 2 個新字' in done, '還有新字時可以「再學」')
    check(page.locator('#reviewBadge').is_hidden(), '完成後徽章隱藏')
    page.screenshot(path=os.path.join(OUT, 's5_done.png'))

    # h. 再學新字
    page.click('#more')
    wait_card(page, 'new4')
    check(remain(page) == 2, '再學 2 個新字')
    page.keyboard.press('2')
    wait_card(page, 'new5')
    page.keyboard.press('2')
    page.wait_for_selector('.done-state')
    check(page.locator('#more').count() == 0, '沒有新字後不再顯示「再學」')
    check(today_log(page)['learned'] == 5, '今日新學 5 個字')

    # i. 重新整理：今天的新字額度用完、沒有到期的字
    page.reload()
    page.wait_for_load_state('networkidle')
    check(page.locator('.done-state').count() == 1, '重新整理後今天已完成')

    # ---- 觸控滑卡（手機）----
    m = browser.new_context(viewport={'width': 390, 'height': 800}, has_touch=True, is_mobile=True)
    m.add_init_script('window.__spoken = []; if (window.speechSynthesis) speechSynthesis.speak = (u) => window.__spoken.push(u.text);')
    m.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    mp = m.new_page()
    mp.on('pageerror', lambda e: errors.append('mobile pageerror: ' + str(e)))
    mp.goto(URL)
    mp.wait_for_load_state('networkidle')
    seed(mp)
    mp.reload()
    mp.wait_for_load_state('networkidle')
    cdp = m.new_cdp_session(mp)
    check('左右滑動評分' in mp.locator('.card-front .hint').inner_text(), '手機上提示可以滑動')
    sw = mp.evaluate('document.documentElement.scrollWidth')
    check(sw <= 390, f'手機無橫向捲動 {sw}')
    mp.screenshot(path=os.path.join(OUT, 's5_mobile.png'))
    touch_drag(mp, cdp, 220)
    wait_card(mp, 'mastered')
    check(db(mp)['overdue']['srs']['interval'] == 8, '手指往右滑＝會')
    touch_drag(mp, cdp, -220)
    wait_card(mp, 'new1')
    check(db(mp)['mastered']['unfamiliar'] is True, '手指往左滑＝不熟')
    touch_tap(mp, cdp, '.speak-btn')   # 滑完 0.4 秒內就點（Chrome 這時不會送 click）
    check(mp.evaluate('window.__spoken') == ['new1'] and 'is-flipped' not in mp.get_attribute('#card', 'class'), '點發音按鈕會發音、不會翻面')
    touch_tap(mp, cdp, '.card-front .headword')
    check('is-flipped' in mp.get_attribute('#card', 'class'), '手機點一下翻面')
    # 拖動中顯示「會」標籤
    box = mp.locator('#swipe').bounding_box()
    x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
    for i in range(1, 6):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x + 16 * i, 'y': y}]})
    op = float(mp.evaluate("getComputedStyle(document.querySelector('.swipe-good')).opacity"))
    check(op > 0.5, f'拖動時浮現「會」標籤（opacity {op:.2f}）')
    mp.screenshot(path=os.path.join(OUT, 's5_dragging.png'))
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    mp.wait_for_timeout(400)
    # 中間停下來截圖，所以是「慢慢拖 80px」：沒超過 90px 門檻也不夠快 → 應該彈回、不評分
    check(head(mp) == 'new1' and db(mp)['new1']['srs'] is None, '慢慢拖不到門檻就放開會彈回')

    # 主要是上下移動：當成捲動，不評分
    touch_drag(mp, cdp, 15, 200)
    check(head(mp) == 'new1' and db(mp)['new1']['srs'] is None, '上下滑動不會評分')

    # ---- 字卡（瀏覽）頁也能滑動換卡，且不影響排程 ----
    mp.goto(URL + '#/cards')
    mp.wait_for_load_state('networkidle')
    first = head(mp)
    before = db(mp)
    touch_drag(mp, cdp, -220)
    second = head(mp)
    check(second != first, f'瀏覽頁往左滑＝下一張（{first} → {second}）')
    touch_drag(mp, cdp, 220)
    check(head(mp) == first, '瀏覽頁往右滑＝上一張')
    after = db(mp)
    check(all(before[k]['srs'] == after[k]['srs'] for k in before), '瀏覽頁滑動不會改變複習排程')

    # ---- 批次加入的新字照貼上順序出現 ----
    o = browser.new_context()
    o.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    op_ = o.new_page()
    op_.goto(URL + '#/words')
    op_.wait_for_load_state('networkidle')
    op_.click('#batch summary')
    op_.fill('#batchInput', 'approve\ninvoice\ndeadline')
    op_.click('#batchAdd')
    op_.goto(URL + '#/review')
    op_.wait_for_load_state('networkidle')
    order = []
    for _ in range(3):
        order.append(head(op_))
        op_.keyboard.press('ArrowRight')
        op_.wait_for_timeout(400)
    check(order == ['approve', 'invoice', 'deadline'], f'新字照貼上順序複習 {order}')
    o.close()

    # ---- 設定：每日新字數 ----
    page.goto(URL + '#/settings')
    page.click('.seg:has(input[name=newPerDay][value="30"])')
    check(json.loads(page.evaluate("localStorage.getItem('toeic-cards:settings')"))['newPerDay'] == 30, '每日新字數設定會儲存')

    browser.close()

print('\nERRORS:' if errors else '\nALL PASSED', *errors, sep='\n')
sys.exit(1 if errors else 0)
