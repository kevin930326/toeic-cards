"""內建單字包：預覽、分組與全部加入、去重、內容保留、AI 選擇與離線快取。
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
        pg.wait_for_function('!!navigator.serviceWorker.controller')
    if key:
        pg.evaluate("localStorage.setItem('toeic-cards:gemini-key', 'fake-key-for-pack-tests')")
        store(pg, "s.updateSettings({llmRpm:600,autoGenerate:true,llmModel:'gemini-2.5-flash'});")
    return ctx, pg

def open_pack(pg):
    pg.locator('#wordPack > summary').click()
    pg.wait_for_selector('#packGroup')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    fail_ctx, pg = setup(browser, worker=False)
    check(pg.evaluate("performance.getEntriesByType('resource').every(e => !e.name.includes('data/packs/'))"), '單字包資料按需載入，未開啟時不下載')
    pg.route('**/data/packs/toeic-1000.json', lambda r: r.fulfill(status=503, body='unavailable'))
    pg.locator('#wordPack > summary').click()
    expect(pg.locator('#packRetry')).to_be_visible()
    check(store(pg, 'return s.getWords().length') == 0, '載入失敗有提示，沒有新增任何資料')
    pg.unroute('**/data/packs/toeic-1000.json')
    pg.click('#packRetry')
    pg.wait_for_selector('#packGroup')
    check(True, '載入失敗後可重試，不會永久卡在失敗狀態')
    fail_ctx.close()
    ctx, pg = setup(browser)
    open_pack(pg)
    check(pg.locator('#packGroup option').count() == 11 and pg.locator('#packWordList li').count() == 100, '可選十組或全部，預設預覽第一組100字')
    check('【刷刷鍋】' in pg.locator('.pack-source').inner_text() and '不代表難度' in pg.locator('#packBody').inner_text(), '標示選字來源與分組方式')
    check(pg.locator('#packAI').is_disabled() and not pg.locator('#packAI').is_checked(), '沒有金鑰也能使用，AI 選項停用且不勾選')

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
    pg.click('#themeToggle')
    check(pg.evaluate('document.documentElement.scrollWidth<=innerWidth'), '手機深色模式版面正常')
    pg.locator('#wordPack').screenshot(path=str(OUT / 'pack-dark.png'), style='.topbar { visibility: hidden; }')
    pg.click('#themeToggle')
    pg.set_viewport_size({'width':1100,'height':1000})
    pg.click('#packAdd')
    target = store(pg, 'return s.getWordSets().find(x=>x.name==="我的多益計畫").id;')
    check(store(pg, 'return s.getWords().length') == 101, '第一組只新增99字，已有 company 不重複建立')
    expect(pg.locator('#setScope')).to_have_value(target)
    check(pg.locator('.word-row').count() == 100, '加入後自動切換到指定單字集')
    pg.wait_for_function("JSON.parse(localStorage.getItem('toeic-cards:words')).filter(w=>w.word!=='zebra').every(w=>w.zh)")
    check(True, '不用金鑰，第一組所有單字都補上本機中文')
    check(store(pg, 'return s.getWords().find(w=>w.word==="company");') == saved['word'], '既有單字的內容、來源標記與複習排程完全保留')
    check(pg.locator('#packAdd').is_disabled(), '重複加入同組不重複建立字卡或單字集')

    pg.select_option('#packGroup','1')
    pg.click('#packAdd')
    check(store(pg, 'return s.getWords().length') == 201 and store(pg, 'return s.getWordSets().length') == 2, '下一組沿用同一單字集')
    pg.select_option('#packGroup','2')
    check(pg.locator('#packWordList li').filter(has_text='résumé').count() == 1, '預覽保留重音拼字 résumé')
    pg.click('#packAdd')
    pg.wait_for_function("JSON.parse(localStorage.getItem('toeic-cards:words')).find(w=>w.word==='résumé')?.zh")
    check(store(pg, "return s.getWords().find(w=>w.word==='résumé').zh;") == 'n. 履歷', 'résumé 直接加入且有正確本機詞義，不經貼上拆字')
    pg.select_option('#packGroup','all')
    check(pg.locator('#packWordList li').count() == 1000, '可以預覽全部1000字')
    pg.click('#packAdd')
    pg.wait_for_function("JSON.parse(localStorage.getItem('toeic-cards:words')).length===1001")
    pg.wait_for_function("JSON.parse(localStorage.getItem('toeic-cards:words')).filter(w=>w.word!=='zebra').every(w=>w.zh)", timeout=30000)
    check(pg.locator('.word-row').count() == 1000, '全部加入後集內剛好1000字，原有其他單字保留')
    check(store(pg, 'return s.getWords().filter(w=>w.autoGenerate===false).length;') == 999 and not requests, '999個新字預設不啟動 AI，選擇存在字卡內')
    check(pg.locator('#packAdd').is_disabled(), '再次加入全部時停用按鈕，沒有重複資料')

    pg.select_option('#packTarget',saved['other'])
    pg.click('#packAdd')
    check(store(pg, 'return s.getWords().length') == 1001 and pg.locator('.word-row').count() == 1000, '全包也可加入另一個現有集，同一張卡共用進度')
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
    ctx.close()

    # 已有金鑰與全站自動生成開啟，也必須尊重單字包「先不生成」的選擇。
    ai_ctx, ai = setup(browser, key=True)
    store(ai, '''const x=s.createWordSet('多益 1000 單'); s.addWords(['company']);
      const w=s.getWords()[0]; s.updateWord(w.id,{zh:'保留的中文',en:'Keep this',phonetic:'/c/',src:{zh:'user'},lookup:{dictAt:1,enDone:true}});''')
    open_pack(ai)
    check(not ai.locator('#packAI').is_checked() and not ai.locator('#packAI').is_disabled(), '有金鑰也預設不勾選 AI')
    ai.click('#packAdd')
    ai_ctx.set_offline(True)
    ai_ctx.set_offline(False)
    ai.evaluate("window.dispatchEvent(new Event('online'))")
    ai.wait_for_timeout(800)
    # 原本就有的 company 是一般字卡，允許既有的自動生成；單字包新加的99字都不可自動送出。
    check(set(requests).issubset({'company'}), '重新連線不會自動生成剛加入的99個單字包字卡')
    ai.evaluate("import('/js/generate.js').then(m=>m.stopGenerating())")
    requests.clear()
    ai.select_option('#packGroup','1')
    ai.check('#packAI')
    check('100 個新字' in ai.locator('#packAIHint').inner_text(), '勾選前後清楚顯示將生成的新字數')
    ai.click('#packAdd')
    ai.wait_for_function("JSON.parse(localStorage.getItem('toeic-cards:words')).filter(w=>w.word!=='company' && w.autoGenerate!==false && w.llm?.status==='done').length===100", timeout=30000)
    check(set(requests)==set(pack_data['words'][100:200]), '明確勾選後只生成這組100個新字，已有字與未勾選的組不送出')
    ai.evaluate("import('/js/generate.js').then(m=>m.stopGenerating())")
    # 手動生成仍可用，與自動生成的排除規則分開。
    requests.clear()
    ai.evaluate("import('/js/generate.js').then(m=>m.generateMissing())")
    ai.wait_for_function("JSON.parse(localStorage.getItem('toeic-cards:words')).every(w=>w.llm?.status==='done')", timeout=30000)
    check(set(pack_data['words'][1:100]).issubset(set(requests)), '未勾選 AI 的字之後仍可手動生成')
    ai_ctx.close()
    browser.close()

print('\nERRORS:' if errors else '\nALL PASSED', *errors, sep='\n')
sys.exit(1 if errors else 0)
