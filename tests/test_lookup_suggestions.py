"""查字候選：前綴、觸控／鍵盤、競態、IME、離線與既有字卡。"""
import os
from playwright.sync_api import sync_playwright, expect
from onboarding_helpers import existing_user
from shots import doc_shot

URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width':375,'height':900}, is_mobile=True, has_touch=True)
    existing_user(context)
    context.add_init_script('window.__toeicFirebaseConfig=null;')
    context.route('https://fonts.googleapis.com/**', lambda r:r.fulfill(status=200,body=''))
    external=[]
    context.route('https://api.dictionaryapi.dev/**', lambda r:(external.append(r.request.url),r.fulfill(status=404,body='{}')))
    context.route('https://generativelanguage.googleapis.com/**', lambda r:(external.append(r.request.url),r.fulfill(status=403,body='{}')))
    page=context.new_page();errors=[];requests=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.on('request',lambda req:requests.append(req.url) if '/suggestions-v1/' in req.url else None)
    page.goto(URL+'#/stats');page.wait_for_load_state('networkidle')
    assert not requests,'尚未輸入時不下載候選索引'
    page.click('#openLookup');page.fill('#lookupInput','a')
    expect(page.get_by_role('option',name='apple',exact=True)).to_be_visible()
    assert page.locator('[role=option]').count()<=8 and len(requests)==1
    assert not page.evaluate("JSON.parse(localStorage.getItem('toeic-cards:words')||'[]').length")
    page.get_by_role('option',name='apple',exact=True).tap()
    expect(page.locator('#lookupResult h3')).to_have_text('apple')
    expect(page.locator('.lookup-meaning')).to_contain_text('蘋果')
    assert page.locator('#lookupSuggestions').is_hidden()
    print('PASS a 顯示 apple，觸控點選直接查中文；輸入本身不收藏、不呼叫 API',flush=True)

    page.evaluate('''async()=>{const s=await import('/js/store.js');s.addWords(['actcustom'],{autoGenerate:false,
      initialData:new Map([['actcustom',{zh:'我的自訂字',en:'custom',lookup:{dictAt:1,enDone:true}}]])});}''')
    before=page.evaluate("[localStorage.getItem('toeic-cards:log'),localStorage.getItem('toeic-cards:words')]")
    page.fill('#lookupInput','ac')
    expect(page.get_by_role('option',name='act',exact=True)).to_be_visible()
    expect(page.get_by_role('option',name='actcustom 已收藏')).to_be_visible()
    page.screenshot(path=doc_shot('31-lookup-suggestions.png'))
    options=page.locator('[role=option]').all_text_contents()
    position=next(i for i,text in enumerate(options) if text=='act')
    for _ in range(position+1):page.press('#lookupInput','ArrowDown')
    expect(page.locator('#lookupInput')).to_have_attribute('aria-activedescendant',f'lookupSuggestion-{position}')
    page.press('#lookupInput','Enter')
    expect(page.locator('#lookupResult h3')).to_have_text('act')
    assert before==page.evaluate("[localStorage.getItem('toeic-cards:log'),localStorage.getItem('toeic-cards:words')]")
    print('PASS ac 顯示 act；收藏標記、8字上限、鍵盤選字、窄螢幕且不改學習資料',flush=True)

    # 舊的 app 分片延遲，ban 已顯示後不得被蓋回。
    page.evaluate('''()=>{const original=window.fetch;window.fetch=async(...args)=>{
      const response=await original(...args);
      if(String(args[0]).includes('suggestions-v1/617070.json')){
        window.slowSuggestionStarted=true;await new Promise(r=>setTimeout(r,800));
      }return response;};}''')
    page.fill('#lookupInput','app')
    page.wait_for_function('()=>window.slowSuggestionStarted===true')
    page.fill('#lookupInput','ban')
    expect(page.locator('[role=option]').first).to_contain_text('ban')
    page.wait_for_timeout(1000)
    assert all(word.startswith('ban') for word in page.locator('[role=option]').all_text_contents())
    page.fill('#lookupInput','');page.wait_for_timeout(200)
    assert page.locator('#lookupSuggestions').is_hidden()
    print('PASS 快速改字忽略舊回應，清空輸入立即收起候選',flush=True)

    page.fill('#lookupInput','ac');expect(page.locator('#lookupSuggestions')).to_be_visible()
    page.press('#lookupInput','Escape');assert page.locator('#lookupDialog').is_visible()
    assert page.locator('#lookupSuggestions').is_hidden()
    page.press('#lookupInput','Escape');assert page.locator('#lookupDialog').is_hidden()
    page.click('#openLookup')
    page.evaluate('''()=>{const el=document.querySelector('#lookupInput');el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
      el.value='zz';el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));}''')
    page.wait_for_timeout(300)
    assert not any('/7a7a.json' in url for url in requests)
    assert page.locator('#lookupSuggestions').is_hidden()
    page.evaluate("document.querySelector('#lookupInput').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))")
    page.wait_for_function("()=>document.querySelector('#lookupSuggestionStatus').textContent!=='尋找候選單字…' && !document.querySelector('#lookupSuggestionStatus').hidden")
    page.fill('#lookupInput','zzunlistedword');page.press('#lookupInput','Enter')
    expect(page.locator('#lookupResult h3')).to_have_text('zzunlistedword')
    assert page.locator('#lookupSave').is_enabled()
    print('PASS Escape 先收候選再關視窗、輸入法組字不中斷、Enter 可直接查原拼字',flush=True)

    # 確認 app、ban 已落入 SW 快取，重整移除 JS 記憶體後仍有候選。
    assert page.evaluate("async()=>{const c=await caches.open('toeic-suggestions-v1');return !!await c.match(new URL('data/dict/suggestions-v1/617070.json',location.href))}")
    context.set_offline(True);page.reload();page.wait_for_load_state('networkidle')
    page.click('#openLookup');page.fill('#lookupInput','appl')
    expect(page.get_by_role('option',name='apple',exact=True)).to_be_visible()
    page.fill('#lookupInput','zebra')
    expect(page.locator('#lookupSuggestionStatus')).to_contain_text('尚未快取')
    page.fill('#lookupInput','actc')
    expect(page.get_by_role('option',name='actcustom 已收藏')).to_be_visible()
    context.set_offline(False)
    page.fill('#lookupInput','zebr')
    expect(page.get_by_role('option',name='zebra',exact=True)).to_be_visible()
    cache_bound=page.evaluate('''async()=>{
      const index=await(await fetch('data/dict/suggestions-v1/index.json')).json();
      for(const file of Object.values(index.leaves).slice(0,33))await(await fetch('data/dict/suggestions-v1/'+file)).text();
      const leaves=await caches.open('toeic-suggestions-v1'),base=await caches.open('toeic-dict-v1');
      return {count:(await leaves.keys()).length,index:!!await base.match(new URL('data/dict/suggestions-v1/index.json',location.href))};
    }''')
    assert cache_bound=={'count':32,'index':True},cache_bound
    assert not external,external
    assert not errors,errors
    for width in [320,375,768]:
        page.set_viewport_size({'width':width,'height':900})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    print('PASS 離線重整後使用已快取索引、離線仍找收藏字、未快取有提示且可重試',flush=True)
    print('PASS 候選快取最多32片，淘汰分片時保留路由索引',flush=True)
    desktop=browser.new_context(viewport={'width':1100,'height':900},service_workers='block')
    existing_user(desktop)
    desktop.add_init_script('window.__toeicFirebaseConfig=null;')
    desktop.route('https://fonts.googleapis.com/**',lambda r:r.fulfill(status=200,body=''))
    desktop_page=desktop.new_page();desktop_page.goto(URL+'#/stats');desktop_page.wait_for_load_state('networkidle')
    desktop_page.click('#openLookup');desktop_page.fill('#lookupInput','a')
    desktop_page.get_by_role('option',name='apple',exact=True).click()
    expect(desktop_page.locator('#lookupResult h3')).to_have_text('apple')
    print('PASS 桌機滑鼠選字正常',flush=True)
    browser.close()
print('ALL PASSED')
