from onboarding_helpers import existing_user
"""多選單字集：範圍選單勾選多個單字集，今日複習、單字庫、統計都用聯集；手機視窗不跑版。
外部服務全部攔截；不讀取使用者的瀏覽器資料或正式 Firebase。
"""
import os, sys
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
OUT = os.path.join(os.path.dirname(__file__), 'screenshots')
os.makedirs(OUT, exist_ok=True)
errors = []
MULTI = '__multi-set__'

def check(ok, message):
    print(('PASS ' if ok else 'FAIL ') + message, flush=True)
    if not ok: errors.append(message)

def setup(browser, mobile=False):
    ctx = browser.new_context(viewport={'width': 375, 'height': 812} if mobile else {'width': 1100, 'height': 900}, service_workers='block')
    existing_user(ctx)
    ctx.add_init_script('window.__toeicFirebaseConfig = null;')
    ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    ctx.route('https://generativelanguage.googleapis.com/**', lambda r: r.fulfill(status=403, body='{}'))
    ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    ctx.route('https://fonts.gstatic.com/**', lambda r: r.abort())
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(URL + '#/words')
    pg.wait_for_load_state('networkidle')
    return ctx, pg

def store(pg, expression):
    return pg.evaluate('async () => { const s = await import("/js/store.js"); ' + expression + ' }')

SEED = '''s.addWords(['budget', 'invoice', 'agenda', 'salary', 'recruit', 'audit']);
  const w = s.getWords(); const id = (x) => w.find(c => c.word === x).id;
  for (const c of w) s.updateWord(c.id, { zh: '意思', pos: 'n.' });
  const a = s.createWordSet('財務'), b = s.createWordSet('人事'), c = s.createWordSet('會議');
  s.assignWordSet([id('budget'), id('invoice'), id('audit')], a.id);
  s.assignWordSet([id('salary'), id('recruit'), id('audit')], b.id);
  s.assignWordSet([id('agenda')], c.id);
  return [a.id, b.id, c.id];'''

def choose(pg, names):
    pg.select_option('#setScope', MULTI)
    dialog = pg.locator('.set-multi-dialog')
    expect(dialog).to_be_visible()
    for box in dialog.locator('.check-row').all():
        name = box.locator('.set-multi-name').inner_text()
        box.locator('input').set_checked(name in names)
    return dialog

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx, pg = setup(browser)
    fin, ppl, meet = store(pg, SEED)

    # ---- 今日複習 ----
    pg.goto(URL + '#/review'); pg.wait_for_load_state('networkidle')
    opts = pg.locator('#setScope option').all_inner_texts()
    check(opts[-1] == '選擇多個單字集…', '範圍選單最後有「選擇多個單字集…」')
    dialog = choose(pg, ['財務', '人事'])
    check(dialog.locator('.set-multi-total').inner_text() == '共 5 個字', '勾兩個集即時顯示合計（重複的 audit 只算一次）')
    for box in dialog.locator('input').all(): box.set_checked(False)
    check(dialog.locator('button[type=submit]').is_disabled(), '都沒勾時不能套用')
    dialog.locator('.check-row', has_text='財務').locator('input').check()
    dialog.locator('.check-row', has_text='人事').locator('input').check()
    pg.screenshot(path=os.path.join(OUT, 'multi-set-dialog.png'))
    dialog.locator('button[type=submit]').click()
    expect(dialog).to_have_count(0)
    scope = store(pg, 'return s.activeSetId();')
    order = store(pg, 'return s.getWordSets().map(x => x.id);')
    check(scope == ','.join(sorted([fin, ppl], key=order.index)), '設定存成逗號串起的單字集（依選單順序）')
    check(pg.locator('#setScope').input_value() == scope, '選單顯示這個組合')
    label = pg.locator('#setScope option:checked').inner_text()
    check(label in ('財務＋人事（5）', '人事＋財務（5）'), '組合選項顯示名稱與合計字數')
    check(pg.locator('#remain').inner_text() == '5', '今日複習只排這兩個集的 5 個字')
    seen = store(pg, 'return s.scopedWords().map(w => w.word).sort();')
    check(seen == ['audit', 'budget', 'invoice', 'recruit', 'salary'], '範圍是兩集的聯集')
    pg.screenshot(path=os.path.join(OUT, 'multi-set-review.png'))

    # 取消回到原本選擇
    choose(pg, ['會議'])
    pg.locator('.set-multi-dialog button[type=button]').click()
    check(store(pg, 'return s.activeSetId();') == scope, '取消不改變範圍')
    check(pg.locator('#setScope').input_value() == scope, '取消後選單回到原本組合')

    # 複習一張，進度照常
    pg.locator('.flashcard').click()
    pg.keyboard.press('ArrowRight')
    pg.wait_for_timeout(600)
    check(pg.locator('#remain').inner_text() == '4', '多選範圍下評分照常前進')

    # 改回單一集
    pg.select_option('#setScope', meet)
    check(pg.locator('#remain').inner_text() == '1', '改回單一集只剩那個集的字')
    check(not any('＋' in o for o in pg.locator('#setScope option').all_inner_texts()), '改回單一集後組合選項消失')

    # ---- 未分類＋自訂集、其他頁面 ----
    store(pg, 's.addWords(["memo"]);')
    choose(pg, ['未分類', '會議']).locator('button[type=submit]').click()
    check(store(pg, 'return s.scopedWords().map(w => w.word).sort();') == ['agenda', 'memo'], '未分類可以和自訂集一起選')
    pg.goto(URL + '#/words'); pg.wait_for_load_state('networkidle')
    check('未分類＋會議（2）' in pg.locator('#setScope option:checked').inner_text(), '單字庫共用同一個多選範圍')
    check(pg.locator('#addToSet').input_value() == meet, '新增時加入預設為範圍裡的自訂集')
    pg.goto(URL + '#/stats'); pg.wait_for_load_state('networkidle')
    pg.goto(URL + '#/free'); pg.wait_for_load_state('networkidle')
    check(pg.locator('#setScope').input_value() == store(pg, 'return s.activeSetId();'), '自由翻卡共用多選範圍')

    # 刪掉其中一個集：範圍自動只剩另一個
    store(pg, 's.deleteWordSet ? s.deleteWordSet(' + repr(meet) + ') : null;')
    if store(pg, 'return typeof s.deleteWordSet;') == 'function':
        check(store(pg, 'return s.activeSetId();') == 'unfiled', '刪掉的集自動從範圍移除')
    ctx.close()

    # ---- 手機 ----
    ctx, pg = setup(browser, mobile=True)
    store(pg, SEED)
    pg.goto(URL + '#/review'); pg.wait_for_load_state('networkidle')
    dialog = choose(pg, ['財務', '會議'])
    check(pg.evaluate('document.documentElement.scrollWidth') <= 375, '手機勾選視窗沒有橫向捲動')
    pg.screenshot(path=os.path.join(OUT, 'multi-set-mobile.png'))
    dialog.locator('button[type=submit]').click()
    check(pg.locator('#remain').inner_text() == '4', '手機套用後今日複習 4 張')
    ctx.close()
    browser.close()

print('\nERRORS:' if errors else '\nALL PASSED', *errors, sep='\n')
sys.exit(1 if errors else 0)
