"""變化形的中文：字典裡同形字的冷門意思（receives「n. 受光面」）不能蓋過原形的意思。"""
import os, sys
from playwright.sync_api import sync_playwright, expect
from onboarding_helpers import existing_user
from storage_helpers import flush
from shots import doc_shot

URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
DICT = '/js/dictionary.js?v=dictionary-scale-1'
errors = []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        errors.append(msg)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1000, 'height': 900})
    existing_user(ctx)
    ctx.add_init_script('window.__toeicFirebaseConfig=null;')
    ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.goto(URL + '#/stats')
    page.wait_for_load_state('networkidle')

    look = lambda w: page.evaluate('async ([path, w]) => (await import(path)).lookupLocal(w)', [DICT, w])

    # 1. 只有 -s 形、詞性又對不上 → 改用原形的意思
    r = look('receives')
    check('收到' in r['zh'] and '受光面' not in r['zh'] and r['pos'].startswith('vt'), f'receives 用 receive 的意思（{r["zh"]!r}）')
    check(r['lemma'] == 'receive' and r['form'] == '第三人稱單數', '仍標示是 receive 的第三人稱單數')
    r = look('viables')
    check(r['zh'] == 'adj. 能養活的；能生長發育的', f'複數形對不上詞性時也用原形（{r["zh"]!r}）')

    # 2. -ing／-ed 形的衍生意思保留，後面補上原形的意思
    r = look('substituting')
    check(r['zh'].startswith('n. 代入；取代\n') and 'vt. 代替' in r['zh'], f'substituting 保留自己的意思並補上 substitute 的動詞意思（{r["zh"]!r}）')

    # 3. 詞性對得上的變化形、常用字都不動
    r = look('offers')
    check(r['zh'].startswith('n. 提議') and r['zh'].count('提議') == 1, f'offers 不變（{r["zh"]!r}）')
    r = look('bearing')
    check(r['zh'] == 'n. 舉止；軸承；忍受；關係；意義', '常用小字典的 bearing 不變')

    # 4. 查單字視窗與收藏的字卡
    page.click('#openLookup')
    page.fill('#lookupInput', 'receives')
    page.locator('#lookupForm button').click()
    expect(page.locator('.lookup-meaning')).to_contain_text('收到')
    check('受光面' not in page.locator('.lookup-meaning').inner_text(), '查單字視窗不再顯示「受光面」')
    expect(page.locator('.lookup-form-note')).to_contain_text('receive 的第三人稱單數')
    page.screenshot(path=doc_shot('50-inflection-meaning.png'))
    page.click('#lookupSave')
    flush(page)
    saved = page.evaluate("JSON.parse(localStorage.getItem('toeic-cards:words')).find(w => w.word === 'receives')")
    check(saved and '收到' in saved['zh'] and '受光面' not in saved['zh'], '收藏的字卡用原形的中文，拼字保留 receives')
    browser.close()

print('\nERRORS:' if errors else '\nALL PASSED', *errors, sep='\n')
sys.exit(1 if errors else 0)
