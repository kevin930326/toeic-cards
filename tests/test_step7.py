"""第 7 步：學習統計（端對端測試）"""
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

HOUR = 3600 * 1000
DAY = 24 * HOUR

# 用瀏覽器裡的 srs.js 算出「今天往回第 i 天」的 key（含早上 4 點換日規則）
SEED = """async () => {
  const { dayKey, dayStart } = await import('/js/srs.js');
  const now = Date.now();
  const key = (i) => { const d = new Date(dayStart(now)); d.setDate(d.getDate() - i); return dayKey(d.getTime() + 60000); };
  const log = {};
  // 每日目標 3 題：今天、昨天、前天達標（連續 3 天）；第 4 天前達標（中斷）；第 10~14 天前連續 5 天（最長紀錄）
  log[key(0)] = { reviews: 5, good: 4, again: 1, learned: 2, quiz: 10, quizCorrect: 8 };
  log[key(1)] = { reviews: 12, good: 9, again: 3, learned: 5 };
  log[key(2)] = { reviews: 3, good: 3, again: 0, learned: 0, quiz: 4, quizCorrect: 1 };
  log[key(4)] = { reviews: 7, good: 6, again: 1, learned: 3 };
  for (let i = 10; i <= 14; i++) log[key(i)] = { reviews: 3, good: 3, again: 0, learned: 1 };
  log[key(40)] = { reviews: 50, good: 50, again: 0, learned: 0 };   // 超過 30 天，不算在預設期間
  const start = dayStart(now);
  const w = (id, srs, unfamiliar = false) => ({ id, word: id, phonetic: '', pos: 'n.', zh: 'n. ' + id, en: 'x', examples: [],
    collocations: [], forms: [], synonyms: [], unfamiliar, src: {}, lookup: { dictAt: 1, enDone: true }, llm: null,
    srs, createdAt: 1, updatedAt: 1 });
  const words = [
    w('newone', null), w('newtwo', null),
    w('learnA', { reps: 1, interval: 1, ease: 2.5, lapses: 0, due: now - 2 * 3600e3 }, true),   // 過期 → 今天
    w('learnB', { reps: 1, interval: 3, ease: 2.5, lapses: 0, due: start + 86400e3 }),          // 明天
    w('famA', { reps: 3, interval: 8, ease: 2.5, lapses: 0, due: start + 3 * 86400e3 }, true),  // 第 4 天
    w('masterA', { reps: 5, interval: 30, ease: 2.5, lapses: 0, due: start + 30 * 86400e3 }),   // 7 天外
    w('masterB', { reps: 6, interval: 45, ease: 2.6, lapses: 0, due: start + 45 * 86400e3 }),
  ];
  localStorage.clear();
  localStorage.setItem('toeic-cards:settings', JSON.stringify({ dailyGoal: 3 }));   // 每天 3 題就算打卡
  localStorage.setItem('toeic-cards:words', JSON.stringify(words));
  localStorage.setItem('toeic-cards:log', JSON.stringify(log));
}"""

def tip_text(page):
    return page.locator('#chartReviews .chart-tip').inner_text()

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1000, 'height': 1000})
    ctx.add_init_script('window.__toeicFirebaseConfig=null; if (window.speechSynthesis) speechSynthesis.speak = () => {};')
    ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    page = ctx.new_page()
    page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append('console: ' + m.text))
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))

    # ---- 沒有資料 ----
    page.goto(URL + '#/stats')
    page.wait_for_load_state('networkidle')
    check('還沒有學習紀錄' in page.locator('.empty-state').inner_text(), '沒有資料時顯示說明')

    # ---- 導覽列 ----
    check(page.locator('.nav a[data-route=stats]').get_attribute('class') == 'active', '導覽列有「統計」且是目前頁面')
    page.click('.settings-link')
    page.wait_for_selector('.settings-link.active')
    check(page.url.endswith('#/settings') and 'active' in page.get_attribute('.settings-link', 'class'), '齒輪圖示進入設定頁並標示目前頁面')

    page.evaluate(SEED)
    page.goto(URL + '#/stats')
    page.reload()
    page.wait_for_load_state('networkidle')

    # ---- 數字卡片 ----
    check(page.locator('#streakDays').inner_text() == '3', f"連續學習 3 天（{page.locator('#streakDays').inner_text()}）")
    hero = page.locator('.kpi-hero').inner_text()
    check('打卡成功' in hero and '最長 5 天' in hero and '今日 15 / 3 題' in hero.replace('\n', ' '), f'今日已打卡、最長紀錄 5 天：{hero!r}')
    check(page.locator('#kpiWords').inner_text() == '7', '單字總數 7')
    check('不熟 2 個' in page.locator('.kpi').nth(1).inner_text(), '不熟 2 個')
    check(page.locator('#kpiLearning').inner_text() == '2', '學習中只計算已複習且間隔少於7天的2字，不包含新字或熟悉中字')
    mastered=page.locator('.kpi:has(#kpiMastered)').inner_text()
    check(page.locator('#kpiMastered').inner_text() == '2' and '佔 29%' in mastered and '長期熟記' in mastered and '複習間隔 ≥ 21 天' in mastered, '長期熟記2字並明示21天門檻（29%）')
    check(page.locator('#kpiReviews').inner_text() == '42', f"近 30 天複習 42 次（不含 40 天前的 50 次）：{page.locator('#kpiReviews').inner_text()}")
    check('新學 15 個・學習 9 天' in page.locator('.kpi:has(#kpiReviews)').inner_text(), '近 30 天新學 15 個、學習 9 天')
    acc = page.locator('#kpiAccuracy').inner_text().replace('\n', '')
    check(acc == '64%' and '共 14 題，答對 9 題' in page.locator('.kpi:has(#kpiAccuracy)').inner_text(), f'測驗正確率 9/14 = 64%（{acc}）')

    # ---- 熟練度 ----
    legend = {li.get_attribute('data-level'): li.locator('.ml-count').inner_text() for li in page.locator('.mastery-legend li').all()}
    check(legend == {'new': '2', 'learning': '2', 'familiar': '1', 'mastered': '2'}, f'熟練度分組 {legend}')
    check(page.locator('.mastery-seg').count() == 4, '熟練度橫條有 4 段')
    gap = page.evaluate("getComputedStyle(document.querySelector('.mastery-bar')).columnGap")
    check(gap == '2px', f'橫條各段之間 2px 空隙（{gap}）')

    # ---- 每日複習圖 ----
    check(page.locator('#chartReviews .chart-col').count() == 30, '近 30 天 → 30 根柱子')
    vals = page.locator('#chartReviews .chart-value').all_text_contents()
    check(vals == ['12'], f'只標最高的那根（{vals}）')
    check(page.locator('#chartReviews .chart-legend li').all_inner_texts() == ['會', '不熟'], '兩個系列有圖例')
    widths = page.evaluate("""() => [...document.querySelectorAll('#chartReviews .chart-col path')].map((p) => p.getBBox().width)""")
    check(widths and max(widths) <= 24.01, f'柱子最寬 24px（{max(widths):.1f}）')
    # 堆疊兩段之間有 2px 空隙：昨天（會 9、不熟 3）
    gap_px = page.evaluate("""() => {
      const cols = [...document.querySelectorAll('#chartReviews .chart-col')];
      const c = cols[cols.length - 2];
      const [a, b] = [...c.querySelectorAll('path')].map((p) => p.getBBox());
      return Math.round((a.y - (b.y + b.height)) * 10) / 10;
    }""")
    check(gap_px == 2, f'堆疊的兩段之間 2px 空隙（{gap_px}）')
    # 提示框
    cols = page.locator('#chartReviews .chart-hit')
    cols.nth(28).hover()
    t = tip_text(page)
    check('9' in t and '3' in t and '會' in t and '不熟' in t and not page.locator('#chartReviews .chart-tip').is_hidden(), f'滑鼠移上去顯示提示框：{t!r}')
    page.mouse.move(5, 5)
    check(page.locator('#chartReviews .chart-tip').is_hidden(), '移開後提示框消失')
    # 表格
    page.locator('#chartReviews summary').click()
    rows = page.locator('#chartReviews tbody tr')
    check(rows.count() == 30, '表格有 30 列')
    last = rows.nth(29).locator('td').all_inner_texts()
    check(last[1:] == ['4', '1', '5'], f'表格最後一列（今天）會 4、不熟 1、合計 5：{last}')
    page.screenshot(path=os.path.join(OUT, 's7_stats.png'), full_page=True)

    # ---- 期間篩選：7 天 ----
    page.click('.seg:has(input[name=period][value="7"])')
    check(page.locator('#chartReviews .chart-col').count() == 7 and page.locator('#chartQuiz .chart-col').count() == 7, '切到 7 天：兩張圖都變 7 根')
    check(page.locator('#kpiReviews').inner_text() == '27', f"近 7 天複習 27 次（{page.locator('#kpiReviews').inner_text()}）")
    check(page.locator('#kpiLearning').inner_text()=='2' and page.locator('#kpiMastered').inner_text()=='2', '期間切換不影響目前熟練度人數')
    check(json.loads(page.evaluate("localStorage.getItem('toeic-cards:settings')"))['statsDays'] == 7, '期間設定會儲存')
    # 鍵盤：7 根時柱子可以用 Tab 聚焦並顯示提示框
    page.locator('#chartQuiz .chart-hit').last.focus()
    qt = page.locator('#chartQuiz .chart-tip').inner_text()
    check(not page.locator('#chartQuiz .chart-tip').is_hidden() and '8' in qt and '2' in qt, f'鍵盤聚焦也會顯示提示框：{qt!r}')
    label = page.locator('#chartQuiz .chart-hit').last.get_attribute('aria-label')
    check('答對 8 題' in label and '答錯 2 題' in label, f'柱子有給螢幕閱讀器的說明：{label!r}')

    # ---- 未來 7 天 ----
    ticks = page.locator('#chartForecast .chart-tick').all_text_contents()
    check('今天' in ticks and '明天' in ticks, '未來圖的 X 軸有「今天」「明天」')
    page.locator('#chartForecast summary').click()
    due = [r.locator('td').nth(1).inner_text() for r in page.locator('#chartForecast tbody tr').all()]
    check(due == ['1', '1', '0', '1', '0', '0', '0'], f'到期分布：過期算今天、明天 1、第 4 天 1（{due}）')
    check(page.locator('#chartForecast .chart-value').all_text_contents() == ['1', '1', '1'], '柱子少時每根都標數字（0 不標）')
    check(page.locator('#chartForecast .chart-legend').count() == 0, '只有一個系列時不顯示圖例')

    # ---- 即時更新：複習一張後回來看 ----
    page.goto(URL + '#/review')
    page.keyboard.press('ArrowRight')
    page.wait_for_timeout(500)
    page.goto(URL + '#/stats')
    check(page.locator('#kpiReviews').inner_text() == '28', f"複習一張後近 7 天變 28 次（{page.locator('#kpiReviews').inner_text()}）")

    # ---- 深色模式：圖表換成深色版本的顏色 ----
    light_fill = page.evaluate("getComputedStyle(document.querySelector('#chartReviews .chart-col path')).fill")
    page.click('#themeToggle')
    dark_fill = page.evaluate("getComputedStyle(document.querySelector('#chartReviews .chart-col path')).fill")
    check(light_fill == 'rgb(42, 120, 214)' and dark_fill == 'rgb(57, 135, 229)', f'系列顏色跟著深淺模式切換（{light_fill} → {dark_fill}）')
    lvl = page.evaluate("getComputedStyle(document.querySelector('.mastery-seg.lvl-mastered')).backgroundColor")
    check(lvl == 'rgb(205, 226, 251)', f'深色模式的熟練度色階改為「越熟越亮」（{lvl}）')
    page.screenshot(path=os.path.join(OUT, 's7_dark.png'), full_page=True)
    page.click('#themeToggle')

    # ---- 手機 ----
    m = ctx.new_page()
    m.set_viewport_size({'width': 375, 'height': 812})
    m.goto(URL + '#/stats')
    m.wait_for_load_state('networkidle')
    sw = m.evaluate('document.documentElement.scrollWidth')
    bar = m.evaluate("(() => { const n = document.querySelector('.topbar'); return n.scrollWidth - n.clientWidth; })()")
    check(sw <= 375 and bar <= 0, f'手機無橫向捲動（頁面 {sw}、導覽列 {bar}）')
    # 導覽文字不能折成兩行（例如「字／卡」）：每個項目的高度要和單行文字一樣
    single_line = m.evaluate("""[...document.querySelectorAll('.nav > a, .review-nav > a')].every(a=>{
      const range=document.createRange();
      const text=[...a.childNodes].find(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim());
      range.selectNodeContents(text);
      return range.getBoundingClientRect().height<=parseFloat(getComputedStyle(a).lineHeight)+2;
    })""")
    check(single_line, '手機導覽文字不換行（量測文字本身，排除按鈕造成的容器伸展）')
    ticks = m.locator('#chartForecast .chart-tick').all_text_contents()
    check('明天' in ticks, f'手機上未來圖的 X 軸也有「明天」（{ticks}）')
    svg_w = m.evaluate("document.querySelector('#chartReviews svg').getBoundingClientRect().right")
    check(svg_w <= 375, f'圖表不超出畫面（{svg_w:.0f}）')
    m.screenshot(path=os.path.join(OUT, 's7_mobile.png'), full_page=True)
    m.set_viewport_size({'width':320,'height':812})
    m.wait_for_function('document.documentElement.scrollWidth<=innerWidth')
    check(m.evaluate('document.documentElement.scrollWidth<=innerWidth'), '320px統計卡片及門檻說明無橫向溢出')

    browser.close()

print('\nERRORS:' if errors else '\nALL PASSED', *errors, sep='\n')
sys.exit(1 if errors else 0)
