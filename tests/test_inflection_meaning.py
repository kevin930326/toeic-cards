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

    # 1. 變化形一律先顯示原形的意思；同形字的冷門意思、縮寫、遊戲地名、錯的說明都不顯示
    r = look('receives')
    check(r['zh'].startswith('vt. 收到') and '受光面' not in r['zh'] and r['pos'].startswith('vt'), f'receives 用 receive 的意思（{r["zh"]!r}）')
    check(r['lemma'] == 'receive' and r['form'] == '第三人稱單數', '仍標示是 receive 的第三人稱單數')
    r = look('scans')
    check('掃描' in r['zh'] and '網路系統' not in r['zh'], f'scans 不再顯示縮寫的意思（{r["zh"]!r}）')
    r = look('faring')
    check('遊戲' not in r['zh'] and '進展' in r['zh'], f'faring 不再顯示遊戲地名（{r["zh"]!r}）')
    r = look('samples')
    check('suffer' not in r['zh'] and '樣品' in r['zh'], f'samples 不再出現錯的「suffer 的複數」（{r["zh"]!r}）')
    r = look('offers')
    check('提議' in r['zh'] and '的複數' not in r['zh'] and '另有' not in r['zh'], f'offers 用原形意思、不重複列同義詞（{r["zh"]!r}）')
    r = look('terminates')
    check('另有：n. 結束' not in r['zh'] or 'adj.' in r['zh'], '動詞的「名詞複數」不另外列')

    # 2. 原形沒有的詞性才放在「另有」：-ing／-ed 的形容詞、形容詞轉來的名詞複數
    r = look('exceeding')
    check(r['zh'].startswith('vt. 超過') and r['zh'].endswith('另有：adj. 超越的；非常的；極度的'), f'exceeding 補上形容詞用法（{r["zh"]!r}）')
    r = look('vitals')
    check('另有：n. 重要器官' in r['zh'], f'vitals 保留名詞「要害」的用法（{r["zh"]!r}）')
    r = look('durables')
    check('另有' not in r['zh'] and '耐用' in r['zh'], f'只是重複原形意思的不另外列（{r["zh"]!r}）')

    # 3. 常用小字典的獨立詞條不動
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
