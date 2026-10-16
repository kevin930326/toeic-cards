"""擴充字典、精確詞形、失敗重試與真正離線快取。"""
import os
from playwright.sync_api import sync_playwright, expect
from onboarding_helpers import existing_user
from shots import doc_shot

URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
DICT = '/js/dictionary.js?v=dictionary-scale-1'

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width':375, 'height':850}, has_touch=True, is_mobile=True)
    existing_user(context)
    context.add_init_script('window.__toeicFirebaseConfig=null;')
    context.route('https://fonts.googleapis.com/**', lambda r:r.fulfill(status=200, body=''))
    context.route('https://api.dictionaryapi.dev/**', lambda r:r.fulfill(status=503, body='{}'))
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error:errors.append(str(error)))
    page.goto(URL + '#/stats'); page.wait_for_load_state('networkidle')
    await_ready = '''async()=>{await navigator.serviceWorker.ready;return !!navigator.serviceWorker.controller;}'''
    page.evaluate('navigator.serviceWorker.ready');page.reload(wait_until='networkidle')
    assert page.evaluate(await_ready)
    requests=[]
    page.on('request', lambda req: requests.append(req.url) if '/data/dict/extended-v1/' in req.url else None)
    page.click('#openLookup');page.fill('#lookupInput','discussed');page.locator('#lookupForm button').click()
    expect(page.locator('.lookup-meaning')).to_contain_text('討論')
    expect(page.locator('.lookup-form-note')).to_contain_text('discuss')
    page.screenshot(path=doc_shot('30-expanded-dictionary.png'))
    page.click('#lookupSave')
    assert page.evaluate("async()=>{const s=await import('/js/store.js');return s.getWords().some(w=>w.word==='discussed'&&w.zh.includes('討論'))}")
    # 常用字只查原小字典，擴充字同片並行只送一次。
    before=len(requests)
    result=page.evaluate('''async path=>{const d=await import(path);return await Promise.all([d.lookupLocal('invoice'),d.lookupLocal('discussed'),d.lookupLocal('discussed')]);}''',DICT)
    assert len(requests)==before and all(r['zh'] for r in result)
    result=page.evaluate('''async path=>{const d=await import(path);return await Promise.all([d.lookupLocal('discussing'),d.lookupLocal('discussing')]);}''',DICT)
    assert result[0]['lemma']=='discuss' and len(requests)<=before+1
    print('PASS discussed／discussing 精確查詢與詞形提示、原拼字收藏、同片請求合併',flush=True)

    # SW 真正落盤後，重新載入 JS 模組（清除記憶體）仍可離線讀擴充分片。
    cached=page.evaluate("async()=>{const c=await caches.open('toeic-dict-extended-v1');return (await c.keys()).length}")
    assert 1<=cached<=128
    context.set_offline(True)
    page.locator('#lookupDialog [data-close]').click()
    page.reload();page.wait_for_load_state('networkidle')
    page.click('#openLookup');page.fill('#lookupInput','discussing');page.locator('#lookupForm button').click()
    expect(page.locator('.lookup-meaning')).to_contain_text('討論')
    expect(page.locator('.lookup-form-note')).to_contain_text('現在分詞')
    # 尚未快取的擴充字應說載入失敗，不把連線失敗當永久未收錄。
    page.fill('#lookupInput','photosynthesizing');page.locator('#lookupForm button').click()
    expect(page.locator('#lookupResult')).to_contain_text('目前無法載入所需字典檔')
    context.set_offline(False)
    page.locator('#lookupForm button').click()
    expect(page.locator('#lookupResult')).not_to_contain_text('目前無法載入所需字典檔')
    print('PASS 重新整理後離線查擴充詞；未快取檔提示連線狀態、恢復後可重試',flush=True)
    evicted=page.evaluate('''async()=>{
      await fetch('data/dict/a.json');
      for(let i=0;i<130;i++) await (await fetch('data/dict/extended-v1/'+i.toString(16).padStart(3,'0')+'.json')).text();
      const c=await caches.open('toeic-dict-extended-v1');
      return {count:(await c.keys()).length,old:!!await c.match(new URL('data/dict/extended-v1/000.json',location.href)),
        recent:!!await c.match(new URL('data/dict/extended-v1/081.json',location.href)),
        core:!!await (await caches.open('toeic-dict-v1')).match(new URL('data/dict/a.json',location.href))};
    }''')
    assert evicted=={'count':128,'old':False,'recent':True,'core':True},evicted
    print('PASS 130 片實際載入後擴充快取維持 128 片、淘汰舊片且保留常用字典',flush=True)
    assert not errors, errors
    browser.close()
print('ALL PASSED')
