from onboarding_helpers import existing_user
"""內建單字包：預覽、分組與全部加入、預製內容、補空白與離線快取。
使用隔離瀏覽器與假的 Gemini／Free Dictionary 回應，不連 Firebase。
"""
import json, os, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
OUT = Path(__file__).parent / 'screenshots'
OUT.mkdir(exist_ok=True)
errors = []
requests = []
pack_data = json.loads((Path(__file__).parent.parent / 'data/packs/toeic-1000.json').read_text(encoding='utf-8'))

def check(ok, message):
    print(('PASS ' if ok else 'FAIL ') + message, flush=True)
    if not ok: errors.append(message)

def store(pg, expression):
    return pg.evaluate('async () => { const s = await import("/js/store.js"); ' + expression + ' }')

def gemini(route):
    body = route.request.post_data_json
    prompt = body['contents'][0]['parts'][0]['text']
    words = re.findall(r'^\d+\. (.+)$', prompt.split('Words:')[1], re.M)
    requests.extend(words)
    cards = [{'word': w, 'pos': 'n.', 'zh': '測試中文 ' + w, 'en': 'AI meaning of ' + w,
              'examples': [{'en': 'Example of ' + w, 'zh': '測試例句'}], 'collocations': [], 'forms': [], 'synonyms': []} for w in words]
    route.fulfill(status=200, content_type='application/json', body=json.dumps(
        {'candidates': [{'content': {'parts': [{'text': json.dumps({'words': cards})}]}, 'finishReason': 'STOP'}]}))

def setup(browser, key=False, worker=True):
    ctx = browser.new_context(viewport={'width': 1100, 'height': 1000}, service_workers='allow' if worker else 'block')
    existing_user(ctx)
    ctx.add_init_script('window.__toeicFirebaseConfig = null;')
    ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    ctx.route('https://generativelanguage.googleapis.com/**', gemini)
    ctx.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=''))
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(URL + '#/words')
    pg.wait_for_load_state('networkidle')
    if worker:
        pg.evaluate('navigator.serviceWorker.ready')
        pg.wait_for_function('() => !!navigator.serviceWorker.controller')
        # SW 接手不代表初次載入的 ES modules 已快取完；離線前等待全部依賴。
        for _ in range(60):
            shell_ready = pg.evaluate("""async () => {
              const cache=await caches.open('toeic-shell-v1');
              const required=performance.getEntriesByType('resource').map(e=>e.name).filter(u=>u.startsWith(location.origin)&&new URL(u).pathname.endsWith('.js'));
              return (await Promise.all(required.map(u=>cache.match(u)))).every(Boolean);
            }""")
            if shell_ready: break
            pg.wait_for_timeout(100)
        check(shell_ready, '初次載入的程式依賴均已完成離線快取')
    if key:
        pg.evaluate("localStorage.setItem('toeic-cards:gemini-key', 'fake-key-for-pack-tests')")
        store(pg, "s.updateSettings({llmRpm:600,autoGenerate:true,llmModel:'gemini-2.5-flash'});")
    return ctx, pg

def open_pack(pg, wait=True):
    if not pg.locator('#addWordsDialog').is_visible(): pg.click('#openAddWords')
    pg.click('[data-tool=pack]')
    if wait: pg.wait_for_selector('#packGroup')

def toggle_theme(pg):
    pg.click('[aria-label="關閉加入單字"]')
    pg.click('#themeToggle')
    open_pack(pg)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    fail_ctx, pg = setup(browser, worker=False)
    check(pg.evaluate("performance.getEntriesByType('resource').every(e => !e.name.includes('data/packs/'))"), '單字包資料按需載入，未開啟時不下載')
    pg.route('**/data/packs/toeic-1000.json', lambda r: r.fulfill(status=503, body='unavailable'))
    open_pack(pg, wait=False)
    expect(pg.locator('#packRetry')).to_be_visible()
    check(store(pg, 'return s.getWords().length') == 0, '載入失敗有提示，沒有新增任何資料')
    pg.unroute('**/data/packs/toeic-1000.json')
    pg.click('#packRetry')
    pg.wait_for_selector('#packGroup')
    check(True, '載入失敗後可重試，不會永久卡在失敗狀態')
    fail_ctx.close()
    partial_ctx, partial = setup(browser, worker=False)
    partial.route('**/data/packs/toeic-1000/05.json', lambda r: r.fulfill(status=503, body='unavailable'))
    open_pack(partial, wait=False)
    expect(partial.locator('#packRetry')).to_be_visible()
    check(store(partial, 'return s.getWords().length') == 0 and partial.locator('#packAdd').count() == 0, '任一組內容下載失敗時禁止加入殘缺單字包')
    partial.unroute('**/data/packs/toeic-1000/05.json')
    partial.click('#packRetry')
    partial.wait_for_selector('#packGroup')
    check(True, '內容檔下載失敗後可重新載入整包')
    partial_ctx.close()
    ctx, pg = setup(browser)
    open_pack(pg)
    check(pg.locator('#packGroup option').count() == 11 and pg.locator('#packWordList li').count() == 100, '可選十組或全部，預設預覽第一組100字')
    check('【刷刷鍋】' in pg.locator('.pack-source').inner_text() and '不代表難度' in pg.locator('#packBody').inner_text(), '標示選字來源與分組方式')
    check(pg.locator('#packAI').count()==0 and '免 API 金鑰' in pg.locator('#wordPack > summary').inner_text(), '內建完整內容，不需生成或金鑰選項')

    saved = store(pg, '''s.addWords(['company','zebra']);
      const w = s.getWords().find(w=>w.word==='company');
      s.updateWord(w.id,{zh:'我的公司意思',en:'My company definition',phonetic:'/test/',src:{zh:'user',en:'user'},
        lookup:{dictAt:1,enDone:true},llm:{status:'done',at:1},
        srs:{reps:3,interval:20,ease:2.5,lapses:0,due:9999999999999,last:1}});
      const other=s.createWordSet('原有單字集'); return {word:w,other:other.id};''')
    pg.fill('#packName', '')
    check(pg.locator('#packAdd').is_disabled(), '空白名稱不能建立單字集')
    pg.fill('#packName', '我的多益計畫')
    check('新增 99 字' in pg.locator('#packPreview').inner_text() and '已有 1 字' in pg.locator('#packPreview').inner_text(), '預覽區分新字與既有單字')
    pg.locator('#wordPack').screenshot(path=str(OUT / 'pack-desktop.png'))
    pg.set_viewport_size({'width':375,'height':812})
    check(pg.evaluate('document.documentElement.scrollWidth<=innerWidth'), '手機預覽沒有橫向捲動')
    pg.locator('#wordPack').screenshot(path=str(OUT / 'pack-mobile.png'), style='.topbar { visibility: hidden; }')
    toggle_theme(pg)
    check(pg.evaluate('document.documentElement.scrollWidth<=innerWidth'), '手機深色模式版面正常')
    pg.locator('#wordPack').screenshot(path=str(OUT / 'pack-dark.png'), style='.topbar { visibility: hidden; }')
    toggle_theme(pg)
    pg.set_viewport_size({'width':1100,'height':1000})
    pg.click('#packAdd')
    target = store(pg, 'return s.getWordSets().find(x=>x.name==="我的多益計畫").id;')
    check(store(pg, 'return s.getWords().length') == 101, '第一組只新增99字，已有 company 不重複建立')
    expect(pg.locator('#setScope')).to_have_value(target)
    check(pg.locator('.word-row').count() == 100, '加入後自動切換到指定單字集')
    pg.wait_for_function("() => JSON.parse(localStorage.getItem('toeic-cards:words')).filter(w=>w.word!=='zebra').every(w=>w.zh)")
    check(store(pg, "return s.getWords().filter(w=>w.pack).every(w=>w.en && w.examples.length && w.collocations.length && w.src.en==='pack');"), '第一組新字立即有英文解釋、中英例句、搭配詞與來源標記')
    check(store(pg, 'return s.getWords().find(w=>w.word==="company");') == saved['word'], '既有單字的內容、來源標記與複習排程完全保留')
    check(pg.locator('#packAdd').is_disabled(), '重複加入同組不重複建立字卡或單字集')

    pg.select_option('#packGroup','1')
    pg.click('#packAdd')
    check(store(pg, 'return s.getWords().length') == 201 and store(pg, 'return s.getWordSets().length') == 2, '下一組沿用同一單字集')
    pg.select_option('#packGroup','2')
    check(pg.locator('#packWordList li').filter(has_text='résumé').count() == 1, '預覽保留重音拼字 résumé')
    pg.click('#packAdd')
    pg.wait_for_function("() => JSON.parse(localStorage.getItem('toeic-cards:words')).find(w=>w.word==='résumé')?.zh")
    check(store(pg, "return s.getWords().find(w=>w.word==='résumé').zh;") == '履歷', 'résumé 直接加入且有正確內建詞義，不經貼上拆字')
    pg.select_option('#packGroup','all')
    check(pg.locator('#packWordList li').count() == 1000, '可以預覽全部1000字')
    pg.click('#packAdd')
    pg.wait_for_function("() => JSON.parse(localStorage.getItem('toeic-cards:words')).length===1001")
    pg.wait_for_function("() => JSON.parse(localStorage.getItem('toeic-cards:words')).filter(w=>w.word!=='zebra').every(w=>w.zh)", timeout=30000)
    check(pg.locator('.word-row').count() == 100 and store(pg,'return s.scopedWords().length;') == 1000, '全部加入後集內剛好1000字，首頁100列，原有其他單字保留')
    check(store(pg, 'return s.getWords().filter(w=>w.pack && w.autoGenerate===false).length;') == 999 and not requests, '999個新字直接帶入預製內容，沒有呼叫 Gemini')
    check(pg.locator('#packAdd').is_disabled(), '再次加入全部時停用按鈕，沒有重複資料')

    pg.select_option('#packTarget',saved['other'])
    pg.click('#packAdd')
    check(store(pg, 'return s.getWords().length') == 1001 and store(pg,'return s.scopedWords().length;') == 1000 and pg.locator('.word-row').count() == 100, '全包也可加入另一個現有集，同一張卡共用進度')
    check(store(pg, 'return s.getWords().find(w=>w.word==="company");') == saved['word'], '換目標集再次加入，仍不覆蓋原有內容')
    pg.select_option('#packTarget','')
    pg.fill('#packName',' 我的多益計畫 ')
    check(pg.locator('#packAdd').is_disabled() and store(pg, 'return s.getWordSets().length') == 2, '輸入同名時沿用既有單字集，不建立副本')
    backup_ok=pg.evaluate('''async () => {
      const s=await import('/js/store.js'), b=await import('/js/backup.js');
      const parsed=b.parseBackup(JSON.stringify(b.buildBackup({words:s.getWords(),settings:s.getSettings(),wordSets:s.getSetRecords(),log:{},mistakes:[]})),s.getDefaultSettings());
      return parsed.ok && parsed.backup.words.filter(w=>w.autoGenerate===false).length===999 && parsed.backup.wordSets.length===2;
    }''')
    check(backup_ok, '備份還原保留整包分類與不自動生成的選擇')
    cached = False
    for _ in range(30):
        cached = pg.evaluate("async () => !!(await (await caches.open('toeic-shell-v1')).match(new URL('data/packs/toeic-1000.json',location.href)))")
        if cached: break
        pg.wait_for_timeout(100)
    check(cached, '單字包資料已存入 Service Worker 快取')
    ctx.set_offline(True)
    pg.reload()
    open_pack(pg)
    check(pg.locator('#packWordList li').count() == 100, '真正離線重新整理後仍可載入單字包')
    check('1000 / 1000' in pg.locator('#packOwned').inner_text(), '離線預覽仍能計算目前已有單字')
    pg.click('[aria-label="關閉加入單字"]')
    pg.goto(URL+'#/cards')
    token=pg.locator('.back-en [data-lookup-word]').first
    word=token.get_attribute('data-lookup-word')
    token.click()
    expect(pg.locator('#lookupInput')).to_have_value(word)
    check(pg.locator('#lookupDialog').is_visible(), '真正離線重新整理後仍載入新版逐字查詢介面')
    pg.press('#lookupInput','Escape')
    pg.goto(URL+'#/free');pg.reload()
    expect(pg.locator('#freePosition')).to_have_text('1 / 1000')
    check(pg.locator('#card').is_visible(), '真正離線重新整理後仍可自由翻閱1000張字卡')
    pg.goto(URL+'#/help');pg.reload()
    pg.click('#tutorialStart');pg.click('#tutorialNext');pg.click('#tutorialNext')
    pg.click('#demoCard');pg.click('#demoGood')
    check(pg.locator('#demoFeedback').is_visible(), '真正離線重新整理後仍可完成教學練習')
    ctx.close()

    # 即使已有個人金鑰，全包不會重新生成；重連與手動生成缺項也不會重送。
    ai_ctx, ai = setup(browser, key=True)
    open_pack(ai)
    # 先等十份內容確實寫入快取，再從全新的離線頁面加入。
    for _ in range(40):
        ready = ai.evaluate(r"async () => { const c=await caches.open('toeic-shell-v1'); return (await c.keys()).filter(r=>/data\/packs\/toeic-1000\/\d+\.json/.test(r.url)).length===10; }")
        if ready: break
        ai.wait_for_timeout(100)
    check(ready, '十份完整內容均已快取')
    ai_ctx.set_offline(True)
    ai.reload()
    open_pack(ai)
    ai.select_option('#packGroup','all')
    ai.click('#packAdd')
    check(store(ai, 'return s.getWords().length===1000 && s.getWords().every(w=>w.examples.length && w.en);'), '真正離線重新整理後仍能一次加入1000張完整字卡')
    ai_ctx.set_offline(False)
    ai.evaluate("window.dispatchEvent(new Event('online'))")
    ai.wait_for_timeout(800)
    ai.evaluate("import('/js/generate.js').then(m=>m.generateMissing())")
    ai.wait_for_timeout(300)
    check(not requests, '已有金鑰時加入全包、重新連線與生成缺項，均不呼叫 Gemini')
    check(not ai.locator('#aiBox').is_visible(), '完整內建字卡的閒置AI工具收合，不顯示需要生成1000字的提示')
    check(ai.locator('.badge', has_text='內建').count()==100 and store(ai,'return s.getWords().every(w=>!!w.pack);'), '首頁100列顯示內建標籤，1000張字卡皆保留來源')
    ai.goto(URL+'#/cards')
    check(ai.locator('.ex-en').is_visible() and ai.locator('.ex-zh').is_visible(), '探索頁直接閱讀中英例句')
    ai.goto(URL+'#/quiz')
    check(ai.locator('.mode-btn[data-mode=en2word]').is_enabled(), '未使用個人額度也能做英文解釋測驗')
    ai_ctx.close()

    # 舊版已加入的空白卡片可明確選擇補齊，不覆蓋自訂內容或進度。
    old_ctx, old = setup(browser)
    original = store(old, '''s.addWords(['company']); const w=s.getWords()[0];
      s.updateWord(w.id,{zh:'我自訂的意思',src:{zh:'user',forms:'user'},forms:[],srs:{interval:20,reps:3,ease:2.5,lapses:0,due:9999999999999,last:1}});
      const set=s.createWordSet('多益 1000 單');s.assignWordSet([w.id],set.id);return w;''')
    open_pack(old)
    old.select_option('#packGroup','0')
    old.check('#packFillExisting')
    old.click('#packAdd')
    filled = store(old,'return s.getWords().find(w=>w.word==="company");')
    check(filled['zh']==original['zh'] and filled['srs']==original['srs'] and filled['forms']==[], '補空白保留使用者自訂詞義、刻意清空欄位與學習進度')
    check(filled['en'] and filled['examples'] and filled['src']['en']=='pack', '舊字卡可補齊空白英文解釋與例句')
    store(old, "s.updateWord(s.getWords().find(w=>w.word==='company').id,{llm:{status:'failed',at:1}});")
    old.evaluate("import('/js/generate.js').then(m=>{m.retryFailed(); return m.countByState();})")
    check(store(old, "return s.getWords().find(w=>w.word==='company').llm.status;")=='failed' and not requests, '補齊後的完整字卡即使留有舊失敗標記，也不會被批次重試')
    old.reload()
    old.goto(URL+'#/words?pack=toeic-1000')
    old.wait_for_selector('#packGroup')
    check(old.locator('#wordPack').get_attribute('open') is not None, '直接連結會展開多益1000單字包入口')
    old_ctx.close()
    browser.close()

print('\nERRORS:' if errors else '\nALL PASSED', *errors, sep='\n')
sys.exit(1 if errors else 0)
