"""自訂單字集：管理、批次歸類、範圍、共用進度、備份與手機／離線操作。
外部服務全部攔截；不讀取使用者的瀏覽器資料或正式 Firebase。
"""
import json, os, sys
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
OUT = os.path.join(os.path.dirname(__file__), 'screenshots')
os.makedirs(OUT, exist_ok=True)
errors = []

def check(ok, message):
    print(('PASS ' if ok else 'FAIL ') + message, flush=True)
    if not ok: errors.append(message)

def setup(browser, mobile=False):
    ctx = browser.new_context(viewport={'width': 375, 'height': 812} if mobile else {'width': 1100, 'height': 900}, service_workers='block')
    ctx.add_init_script('window.__toeicFirebaseConfig = null;')
    ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    ctx.route('https://generativelanguage.googleapis.com/**', lambda r: r.fulfill(status=403, body='{}'))
    ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    ctx.route('https://fonts.gstatic.com/**', lambda r: r.abort())
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('dialog', lambda d: d.accept())
    pg.goto(URL + '#/words')
    pg.wait_for_load_state('networkidle')
    return ctx, pg

def store(pg, expression):
    return pg.evaluate('async () => { const s = await import("/js/store.js"); ' + expression + ' }')

def create(pg, name):
    if not pg.locator('#manageSetsDialog').is_visible(): pg.click('#openManageSets')
    pg.fill('#newSetName', name)
    pg.click('#createSetForm button')
    return store(pg, 'return s.getWordSets().find(x => x.name === ' + json.dumps(name) + ')?.id;')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx, pg = setup(browser)
    store(pg, '''s.addWords(['budget', 'invoice', 'agenda', 'salary', 'recruit']);
      const meanings = {budget:'預算',invoice:'發票',agenda:'議程',salary:'薪資',recruit:'招募'};
      s.updateWords(s.getWords().map(w => [w.id, { zh: meanings[w.word], en: 'Definition of ' + w.word, pos: 'n.' }]));''')
    check(pg.locator('.word-row').count() == 5, '既有單字不需要重新匯入')
    pg.select_option('#setScope', 'unfiled')
    check(pg.locator('.word-row').count() == 5, '既有單字一開始都屬於未分類')
    finance = create(pg, '財務')
    people = create(pg, '人事')
    empty = create(pg, '第 3 回模考')
    check(bool(finance and people and empty), '可以建立自訂名稱與空單字集')
    pg.fill('#newSetName', ' 財務 ')
    pg.click('#createSetForm button')
    check('同名' in pg.locator('#setError').inner_text(), '同名單字集會提示，不重複建立')
    pg.click('[aria-label="關閉管理單字集"]')
    pg.locator('#bulkTools > summary').click()

    pg.select_option('#setScope', '')
    for w in ['budget', 'invoice', 'agenda', 'salary']:
        pg.get_by_role('checkbox', name='選取 ' + w, exact=True).check()
    pg.select_option('#bulkSet', finance)
    pg.click('#bulkAssign')
    pg.get_by_role('checkbox', name='選取 budget', exact=True).check()
    pg.get_by_role('checkbox', name='選取 recruit', exact=True).check()
    pg.select_option('#bulkSet', people)
    pg.click('#bulkAssign')
    check(store(pg, 'return s.getWords().length') == 5, '同一字可加入多個集，不複製字卡')
    check(pg.locator('.word-row', has_text='budget').locator('.word-set-tags .chip').count() == 2, '卡片列出所屬的多個單字集')

    pg.select_option('#setScope', finance)
    check(pg.locator('.word-row').count() == 4, '單字庫只顯示指定單字集')
    check(pg.locator('#addToSet').input_value() == finance, '切換單字集後新增單字預設加入目前的集')
    pg.get_by_role('checkbox', name='選取 budget', exact=True).check()
    pg.select_option('#bulkSet', finance)
    pg.click('#bulkRemove')
    check(pg.locator('.word-row').count() == 3 and store(pg, 'return s.getWords().length') == 5, '移出分類只改歸屬，保留卡片')
    pg.click('#openAddWords')
    pg.select_option('#addToSet', finance)
    pg.fill('#addInput', 'budget')
    pg.press('#addInput', 'Enter')
    pg.click('[aria-label="關閉加入單字"]')
    check(pg.locator('.word-row').count() == 4 and store(pg, 'return s.getWords().length') == 5, '新增已存在的字時可直接加入指定單字集')

    pg.click('#openManageSets')
    pg.click('button[aria-label="重新命名 財務"]')
    pg.fill('.set-name-dialog input', '財務與預算')
    pg.click('.set-name-dialog button[type=submit]')
    check(store(pg, 'return s.getWordSets().find(x => x.name === "財務與預算").id') == finance, '改名保留識別碼與成員')
    pg.click('[aria-label="關閉管理單字集"]')
    pg.reload()
    expect(pg.locator('#setScope')).to_have_value(finance)
    check(pg.locator('.word-row').count() == 4, '重新整理保留單字集與目前範圍')

    pg.goto(URL + '#/quiz')
    expect(pg.locator('#setScope')).to_have_value(finance)
    pg.click('.mode-btn[data-mode=zh2en]')
    session = pg.locator('.option-text').all_text_contents()
    check(set(session) == {'budget', 'invoice', 'agenda', 'salary'}, '測驗題目與選項都從指定單字集挑選')
    pg.click('#quit')
    pg.select_option('#setScope', people)
    check(pg.locator('.mode-btn[data-mode=zh2en]').is_disabled(), '集內字數不足時不能開始四選一測驗')

    pg.goto(URL + '#/cards')
    expect(pg.locator('#setScope')).to_have_value(people)
    seen = set()
    for _ in range(3):
        seen.add(pg.locator('#exploreWord').inner_text())
        pg.click('#next')
    check(seen == {'budget', 'recruit'}, '單字探索限定單字集')
    pg.goto(URL + '#/review')
    pg.select_option('#setScope', finance)
    learned = pg.locator('.card-front .headword').inner_text()
    pg.click('#good')
    pg.wait_for_timeout(450)
    progress = store(pg, 'return s.getWords().find(w => w.word === ' + json.dumps(learned) + ').srs;')
    pg.goto(URL + '#/words')
    store(pg, 's.assignWordSet(s.getWords().filter(w => w.word === ' + json.dumps(learned) + ').map(w => w.id), ' + json.dumps(people) + ');')
    pg.select_option('#setScope', people)
    pg.goto(URL + '#/review')
    check(store(pg, 'return s.getWords().find(w => w.word === ' + json.dumps(learned) + ').srs;') == progress, '不同單字集共用同一份複習進度')
    check(pg.locator('.card-front .headword').inner_text() != learned, '切換到另一集不會立刻重背尚未到期的同一個字')
    pg.select_option('#setScope', empty)
    check('這個單字集還沒有字卡' in pg.locator('.empty-title').inner_text(), '空單字集有提示，仍可切換範圍')

    pg.goto(URL + '#/settings')
    with pg.expect_download() as download:
        pg.click('#exportBtn')
    with open(download.value.path(), encoding='utf-8') as f: backup = json.load(f)
    check(backup['version'] == 2 and len(backup['data']['wordSets']) == 3, '新版備份包含全部單字集與分類')
    ctx2, restored = setup(browser)
    restored.goto(URL + '#/settings')
    restored.locator('#importFile').set_input_files({'name': 'sets.json', 'mimeType': 'application/json', 'buffer': json.dumps(backup).encode()})
    restored.click('#doMerge')
    check(store(restored, 'return s.getWordSets().length') == 3, '全新裝置匯入後還原單字集')
    check(store(restored, 'return s.getSetRecords()') == backup['data']['wordSets'], '備份分類成員與移出紀錄完整保留')

    # 舊備份沒有分類；取代後也不應被較舊雲端紀錄復活。
    old_backup = {**backup, 'version': 1, 'data': {k: v for k, v in backup['data'].items() if k != 'wordSets'}}
    restored.locator('#importFile').set_input_files({'name': 'old.json', 'mimeType': 'application/json', 'buffer': json.dumps(old_backup).encode()})
    restored.click('#doReplace')
    check(store(restored, 'return s.getWordSets().length') == 0, '舊版備份仍可取代還原，單字顯示未分類')
    store(restored, 's.mergeSetRecords(' + json.dumps(backup['data']['wordSets']) + ');')
    check(store(restored, 'return s.getWordSets().length') == 0, '取代備份留下刪除紀錄，舊雲端分類不會復活')
    ctx2.close()

    pg.goto(URL + '#/words')
    pg.select_option('#setScope', finance)
    pg.click('#openManageSets')
    pg.click('button[aria-label="刪除單字集 財務與預算"]')
    pg.click('[aria-label="關閉管理單字集"]')
    expect(pg.locator('#setScope')).to_have_value('')
    check(store(pg, 'return s.getWords().length') == 5, '刪除單字集後回到全部，單字與進度保留')
    pg.select_option('#setScope', 'unfiled')
    check(pg.locator('.word-row').count() >= 1, '刪除分類後無其他分類的字回到未分類')

    # 名稱以純文字呈現，不能變成 HTML。
    evil = create(pg, '<img src=x onerror=alert(1)>')
    check(bool(evil) and pg.locator('#setList img').count() == 0, '自訂名稱安全顯示，不執行 HTML')
    pg.click('button[data-id="' + evil + '"][data-set-act=delete]')
    pg.click('[aria-label="關閉管理單字集"]')
    pg.select_option('#setScope', people)
    # 改單字拼字仍是同一張卡，原有分類保留。
    store(pg, 'const w = s.getWords().find(w => w.word === "recruit"); s.updateWord(w.id, {word:"recruitment"});')
    check(pg.locator('.word-row', has_text='recruitment').count() == 1, '編輯單字拼字保留分類歸屬')
    pg.add_style_tag(content='#toast { transition: none !important; }')
    pg.set_viewport_size({'width': 375, 'height': 812})
    pg.locator('#toast').evaluate('(el) => el.classList.remove("show")')
    pg.screenshot(path=os.path.join(OUT, 'sets-mobile.png'), full_page=True)
    check(pg.evaluate('document.documentElement.scrollWidth <= innerWidth'), '手機單字庫與批次歸類沒有橫向捲動')
    pg.click('#themeToggle')
    pg.locator('#toast').evaluate('(el) => el.classList.remove("show")')
    pg.screenshot(path=os.path.join(OUT, 'sets-dark.png'), full_page=True)
    check(pg.evaluate('document.documentElement.scrollWidth <= innerWidth'), '手機深色模式版面正常')
    pg.set_viewport_size({'width': 1100, 'height': 1000})
    pg.click('#themeToggle')
    pg.select_option('#setScope', '')
    pg.locator('#toast').evaluate('(el) => el.classList.remove("show")')
    pg.screenshot(path=os.path.join(OUT, 'sets-desktop.png'), full_page=True)
    ctx.set_offline(True)
    pg.select_option('#setScope', people)
    check(pg.locator('.word-row').count() >= 2, '離線時仍可切換與查看單字集')
    ctx.close()
    browser.close()

print('\nERRORS:' if errors else '\nALL PASSED', *errors, sep='\n')
sys.exit(1 if errors else 0)
