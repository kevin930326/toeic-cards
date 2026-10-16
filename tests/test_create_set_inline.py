"""加字的地方可以直接新增單字集：查單字收藏、單字庫「新增時加入」、批次整理。"""
import os, sys
from playwright.sync_api import sync_playwright, expect
from onboarding_helpers import existing_user
from storage_helpers import flush
from shots import doc_shot

URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
NEW = '__new-set__'
errors = []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        errors.append(msg)

def sets(page):
    return page.evaluate("() => import('/js/store.js').then(s => s.getWordSets().map(x => ({ id: x.id, name: x.name })))")

def members(page, name):
    flush(page)
    return page.evaluate("""name => import('/js/store.js').then(s => {
      const set = s.getSetRecords().find(x => x.name === name && !x.deleted);
      return Object.entries(set.members).filter(([, m]) => m.present).map(([w]) => w).sort();
    })""", name)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1000, 'height': 900})
    existing_user(ctx)
    ctx.add_init_script('window.__toeicFirebaseConfig=null;')
    ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.goto(URL + '#/words')
    page.wait_for_load_state('networkidle')

    # ---- 1. 查單字視窗：收藏時新增單字集 ----
    page.click('#openLookup')
    page.fill('#lookupInput', 'approve')
    page.locator('#lookupForm button').click()
    expect(page.locator('#lookupSet')).to_be_visible()
    options = page.locator('#lookupSet option').all_inner_texts()
    check(options[-1] == '＋ 新增單字集…', f'收藏選單最後一項是「＋ 新增單字集…」（{options}）')
    page.select_option('#lookupSet', NEW)
    dialog = page.locator('.set-name-dialog')
    expect(dialog).to_be_visible()
    check('新增單字集' in dialog.locator('h2').inner_text(), '跳出新增單字集的命名視窗')
    check(page.locator('#lookupSet').input_value() != NEW, '命名時選單不會停在「＋ 新增」')
    page.screenshot(path=doc_shot('51-create-set-inline.png'))

    # 取消 → 回到原本的選擇，不建立
    dialog.locator('button[type=button]').click()
    check(page.locator('#lookupSet').input_value() == '' and sets(page) == [], '取消就回到原本的選擇，不建立單字集')
    check(page.locator('#lookupDialog').evaluate('d => d.open'), '取消後查單字視窗還開著')

    # 建立 → 自動選好，收藏進去
    page.select_option('#lookupSet', NEW)
    dialog.locator('input').fill('小黃本')
    dialog.locator('button[type=submit]').click()
    created = sets(page)
    check(len(created) == 1 and created[0]['name'] == '小黃本', '建立了「小黃本」')
    check(page.locator('#lookupSet').input_value() == created[0]['id'], '新的單字集自動選好')
    check(page.locator('#lookupDialog').evaluate('d => d.open'), '建立後仍在查單字視窗，不用離開')
    page.click('#lookupSave')
    check(members(page, '小黃本') == ['approve'], '收藏的字加進新的單字集')

    # 同名 → 提示，不關視窗
    page.fill('#lookupInput', 'invoice')
    page.locator('#lookupForm button').click()
    expect(page.locator('#lookupSave')).to_have_text('加入我的單字庫')
    page.select_option('#lookupSet', NEW)
    dialog.locator('input').fill(' 小黃本 ')
    dialog.locator('button[type=submit]').click()
    check('同名' in dialog.locator('[role=alert]').inner_text() and dialog.is_visible(), '同名會提示，不重複建立')
    page.keyboard.press('Escape')
    check(len(sets(page)) == 1 and page.locator('#lookupDialog').evaluate('d => d.open'), 'Escape 只關命名視窗')
    page.keyboard.press('Escape')

    # ---- 2. 單字庫「新增時加入」 ----
    page.click('#openAddWords')
    page.select_option('#addToSet', NEW)
    dialog.locator('input').fill('財務')
    dialog.locator('button[type=submit]').click()
    finance = next(s['id'] for s in sets(page) if s['name'] == '財務')
    check(page.locator('#addToSet').input_value() == finance, '新增時加入：建立後自動選好')
    page.click('[data-tool=single]')
    page.fill('#addInput', 'budget')
    page.press('#addInput', 'Enter')
    check(members(page, '財務') == ['budget'], '新加的字加進新的單字集')
    page.click('[aria-label="關閉加入單字"]')

    # ---- 3. 批次整理 ----
    page.click('#toggleBulk')
    page.select_option('#bulkSet', NEW)
    dialog.locator('input').fill('第 3 回模考')
    dialog.locator('button[type=submit]').click()
    mock = next(s['id'] for s in sets(page) if s['name'] == '第 3 回模考')
    check(page.locator('#bulkSet').input_value() == mock, '批次整理：建立後自動選好')
    page.get_by_role('checkbox', name='選取 approve', exact=True).check()
    check(page.locator('#bulkAssign').is_enabled(), '選好字後可以直接加入新的單字集')
    page.click('#bulkAssign')
    check(members(page, '第 3 回模考') == ['approve'], '批次加入新的單字集')

    # 別的選單也更新，且都有「＋ 新增」
    opts = page.locator('#addToSet option').all_inner_texts()
    check(any('第 3 回模考' in o for o in opts) and opts[-1] == '＋ 新增單字集…', '其他選單同步出現新的單字集')
    scope = page.locator('#setScope option').all_inner_texts()
    check(not any('新增單字集' in o for o in scope), '切換範圍的選單不出現「＋ 新增」')

    # ---- 手機 ----
    page.set_viewport_size({'width': 375, 'height': 812})
    page.click('#openLookup')
    page.fill('#lookupInput', 'agenda')
    page.locator('#lookupForm button').click()
    page.select_option('#lookupSet', NEW)
    expect(dialog).to_be_visible()
    check(page.evaluate('document.documentElement.scrollWidth') <= 375, '手機命名視窗沒有橫向捲動')
    browser.close()

print('\nERRORS:' if errors else '\nALL PASSED', *errors, sep='\n')
sys.exit(1 if errors else 0)
