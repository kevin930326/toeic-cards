from onboarding_helpers import existing_user
from library_helpers import open_add, close_add, open_ai
import os, sys
from playwright.sync_api import sync_playwright, expect

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'screenshots')
os.makedirs(OUT, exist_ok=True)
URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
errors = []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        errors.append(msg)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1100, 'height': 850})
    existing_user(page)
    page.add_init_script('window.__toeicFirebaseConfig = null;')
    page.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append('console: ' + m.text))
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.on('dialog', lambda d: d.accept())
    page.goto(URL)
    page.wait_for_load_state('networkidle')

    check(page.locator('.empty-state').is_visible(), '空狀態顯示')

    # 新增單字
    page.click('text=新增單字')
    for w in ['approve', 'Deadline', 'invoice', 'approve']:
        open_add(page, 'single')
        page.fill('#addInput', w)
        open_add(page, 'single')
        page.press('#addInput', 'Enter')
        close_add(page)
    check(page.locator('.word-row').count() == 3, '新增 3 個字，重複的 approve 被擋下')
    check(page.locator('.word-en', has_text='deadline').count() == 1, '大寫自動轉小寫')
    open_add(page, 'single')
    page.fill('#addInput', '測試')
    open_add(page, 'single')
    page.press('#addInput', 'Enter')
    close_add(page)
    check(page.locator('.word-row').count() == 3, '非英文輸入被擋下')

    # 編輯
    page.click('#toggleLibraryEdit')
    row = page.locator('.word-row', has_text='approve')
    row.locator('[data-act=edit]').click()
    page.fill('#editForm [name=pos]', 'v.')
    page.fill('#editForm [name=zh]', '核准；批准')
    page.fill('#editForm [name=en]', 'to officially agree to a plan or request')
    page.fill('#editForm [name=examples]', 'The manager approved the budget. | 經理核准了預算。')
    page.fill('#editForm [name=collocations]', 'approve a request, approve a plan')
    page.fill('#editForm [name=forms]', 'approval (n.), approved (adj.)')
    page.click('#editForm button[type=submit]')
    row.scroll_into_view_if_needed()
    check('核准' in row.inner_text(), '編輯後列表顯示中文')

    # 搜尋
    page.fill('#search', '核准')
    check(page.locator('.word-row').count() == 1, '搜尋中文')
    page.fill('#search', '')

    # 標記不熟
    page.locator('.word-row', has_text='invoice').locator('[data-act=mark]').click()
    check(page.locator('.word-row.is-unfamiliar').count() == 1, '列表標記不熟')

    # 刪除
    page.locator('.word-row', has_text='deadline').locator('[data-act=delete]').click()
    check(page.locator('.word-row').count() == 2, '刪除單字')
    page.screenshot(path=os.path.join(OUT, 's1_words.png'), full_page=True)

    # 探索：直接閱讀雙語內容，複習的翻面由 test_step5 驗證。
    page.click('.nav a[data-route=cards]')
    check(page.locator('#exploreWord').inner_text() == 'invoice', '第一個探索字是 invoice')
    check(page.locator('#markBtn').get_attribute('aria-pressed') == 'true', '探索顯示不熟標記')
    page.keyboard.press('ArrowRight')
    check(page.locator('#exploreWord').inner_text() == 'approve', '右鍵換下一字')
    check('核准' in page.locator('.back-zh').inner_text(), '探索直接顯示中文')
    check('officially agree' in page.locator('.back-en').inner_text(), '探索同時顯示英文解釋')
    check(page.locator('#card').count() == 0, '探索不再提供翻面')
    page.screenshot(path=os.path.join(OUT, 's1_explore.png'))
    page.click('.seg:has(input[value=unfamiliar])')
    check(page.locator('#exploreWord').inner_text() == 'invoice', '不熟篩選只剩 invoice')
    page.click('#markBtn')
    check(page.locator('.empty-state').is_visible(), '取消不熟後顯示「沒有不熟的字」')
    page.click('.seg:has(input[value=all])')
    page.reload()
    page.wait_for_load_state('networkidle')
    check(page.locator('#exploreWord').count() == 1, '重新整理後資料保留')
    page.locator('.explore-item').filter(has_text='approve').click()
    check(page.locator('.back-zh').is_visible() and page.locator('.back-en').is_visible(), '重新整理後仍直接閱讀雙語')

    # 深色模式
    page.click('#themeToggle')
    bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
    check(bg == 'rgb(22, 24, 29)', f'深色模式背景 {bg}')
    page.screenshot(path=os.path.join(OUT, 's1_dark.png'))
    page.reload()
    page.wait_for_load_state('networkidle')
    check(page.evaluate("document.documentElement.dataset.theme") == 'dark', '深色模式重新整理後保留')

    # 手機版面
    m = browser.new_page(viewport={'width': 375, 'height': 812}, is_mobile=True, has_touch=True)
    existing_user(m)
    m.add_init_script('window.__toeicFirebaseConfig = null;')
    m.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    m.goto(URL)
    m.wait_for_load_state('networkidle')
    m.evaluate("""localStorage.setItem('toeic-cards:words', JSON.stringify([{id:'1',word:'reimbursement',pos:'n.',zh:'報銷；償還',en:'',examples:[],collocations:[],forms:[],synonyms:[],unfamiliar:false,createdAt:1,updatedAt:1}]))""")
    m.reload()
    m.wait_for_load_state('networkidle')
    sw = m.evaluate("document.documentElement.scrollWidth")
    check(sw <= 375, f'手機無橫向捲動 scrollWidth={sw}')
    m.screenshot(path=os.path.join(OUT, 's1_mobile.png'))
    m.tap('#card')
    m.wait_for_timeout(700)
    m.screenshot(path=os.path.join(OUT, 's1_mobile_back.png'))

    browser.close()

print('\nERRORS:' if errors else '\nALL PASSED', *errors, sep='\n')
sys.exit(1 if errors else 0)
