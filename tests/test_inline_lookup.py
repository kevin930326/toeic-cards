"""解釋／例句點字查詢：桌面、觸控、鍵盤、收藏及複習狀態保護。"""
import os,re,sys
from pathlib import Path
from playwright.sync_api import sync_playwright,expect

URL=os.environ.get('BASE_URL','http://127.0.0.1:8123/')
OUT=Path(__file__).parent/'screenshots';OUT.mkdir(exist_ok=True)
errors=[]

def check(ok,message):
    print(('PASS ' if ok else 'FAIL ')+message,flush=True)
    if not ok:errors.append(message)

def store(pg,code):
    return pg.evaluate('async()=>{const s=await import("/js/store.js");'+code+'}')

def setup(browser,mobile=False):
    ctx=browser.new_context(viewport={'width':375,'height':812} if mobile else {'width':1100,'height':900},has_touch=mobile,is_mobile=mobile,service_workers='block')
    ctx.add_init_script("window.__toeicFirebaseConfig=null;localStorage.setItem('toeic-cards:gemini-key','fake-inline-key');")
    calls=[]
    ctx.route('https://api.dictionaryapi.dev/**',lambda r:(calls.append('dictionary'),r.fulfill(status=404,body='{}')))
    ctx.route('https://generativelanguage.googleapis.com/**',lambda r:(calls.append('gemini'),r.fulfill(status=403,body='{}')))
    ctx.route('https://fonts.googleapis.com/**',lambda r:r.fulfill(status=200,content_type='text/css',body=''))
    pg=ctx.new_page();pg.on('pageerror',lambda e:errors.append(str(e)))
    pg.goto(URL+'#/review');pg.wait_for_load_state('networkidle')
    set_id=store(pg,'''s.addWords(['appointment','invoice'],{autoGenerate:false});
      s.updateWords(s.getWords().map(w=>[w.id,{pos:'n.',zh:w.word==='appointment'?'約會':'發票',
        en:w.word==='appointment'?'an arrangement to meet at a certain time':'a bill for goods or services',
        examples:[{en:'The manager confirmed the appointment.',zh:'經理確認了約會。'}],lookup:{dictAt:1,enDone:true}}]));
      s.updateSettings({cardMode:'en'});return s.createWordSet('生字').id;''')
    return ctx,pg,set_id,calls

with sync_playwright() as p:
    b=p.chromium.launch(headless=True)
    ctx,pg,set_id,calls=setup(b)
    head=pg.locator('.card-front .headword').inner_text()
    remain=pg.locator('#remain').inner_text()
    original=store(pg,'return s.getWords().map(w=>[w.id,w.srs]);')
    log=pg.evaluate("localStorage.getItem('toeic-cards:log')")
    pg.click('#card')
    pg.locator('#swipe').screenshot(path=str(OUT/'inline-lookup-reading.png'),animations='disabled')
    arrangement=pg.locator('.back-en [data-lookup-word=arrangement]')
    arrangement.click()
    expect(pg.locator('#lookupInput')).to_have_value('arrangement')
    expect(pg.locator('#lookupResult h3')).to_have_text('arrangement')
    check(bool(pg.locator('.lookup-meaning').inner_text()),'點英文解釋自動顯示該字的中文，不需再次輸入')
    check(store(pg,'return s.getWords().length;')==2 and not calls,'只查中文不新增字卡，也不呼叫Gemini或免費英文API')
    pg.select_option('#lookupSet',set_id)
    pg.click('#lookupSave')
    expect(pg.locator('#lookupSaveStatus')).to_contain_text('已收藏')
    pg.screenshot(path=str(OUT/'inline-lookup-desktop.png'))
    pg.click('[aria-label="關閉查單字"]')
    check(pg.locator('.card-front .headword').inner_text()==head and pg.locator('#remain').inner_text()==remain and 'is-flipped' in pg.locator('#card').get_attribute('class'),'查字後收藏仍保留同一張複習卡、待複習數與翻面狀態')
    check(store(pg,'return s.getWords().filter(w=>w.word!=="arrangement").map(w=>[w.id,w.srs]);')==original and pg.evaluate("localStorage.getItem('toeic-cards:log')")==log,'原字卡排程與每日紀錄沒有被改動')
    check(pg.locator(':focus').get_attribute('data-lookup-word')=='arrangement','收藏造成畫面更新後，關閉仍回到原查字位置')
    pg.locator('.back-en [data-lookup-word=arrangement]').click()
    expect(pg.locator('#lookupOwn')).to_be_visible()
    pg.select_option('#lookupSet',set_id);pg.click('#lookupSave')
    check(store(pg,'return s.getWords().length;')==3,'已收藏的字可以查看或加入分類，不會重複建卡')
    pg.press('#lookupInput','Escape')
    pg.locator('.ex-en [data-lookup-word=manager]').click()
    expect(pg.locator('#lookupInput')).to_have_value('manager')
    expect(pg.locator('#lookupResult h3')).to_have_text('manager')
    check(True,'例句中的字也能查詢')
    pg.press('#lookupInput','Escape')
    word=pg.locator('.back-en [data-lookup-word=certain]')
    word.focus();pg.keyboard.press('Enter')
    expect(pg.locator('#lookupInput')).to_have_value('certain')
    pg.press('#lookupInput','Escape')
    check('is-flipped' in pg.locator('#card').get_attribute('class'),'鍵盤Enter點字查詢不會翻回正面')
    pg.goto(URL+'#/cards')
    pg.locator('.explore-item').filter(has_text='appointment').click()
    pg.locator('.back-en [data-lookup-word=arrangement]').click()
    expect(pg.locator('#lookupResult h3')).to_have_text('arrangement')
    pg.press('#lookupInput','Escape')
    check(pg.locator('#exploreWord').inner_text()=='appointment','探索點字查詢後仍保留原選字')
    # 不把來源資料的 HTML 當成標記執行。
    store(pg,"const w=s.getWords().find(w=>w.word==='appointment');s.updateWord(w.id,{en:'<img src=x onerror=alert(1)> a meeting.'});")
    check(pg.locator('.back-en img').count()==0 and '<img' in pg.locator('.back-en').inner_text(),'英文內容含HTML字樣時仍安全顯示為文字')
    check(not calls,'整個點字與收藏流程不使用個人AI額度')
    ctx.close()
    mobile,mp,_,mobile_calls=setup(b,True)
    mp.tap('.card-front .headword')
    expect(mp.locator('#card')).to_have_class(re.compile('is-flipped'))
    mp.locator('.back-en [data-lookup-word=arrangement]').tap()
    expect(mp.locator('#lookupResult h3')).to_have_text('arrangement')
    mp.screenshot(path=str(OUT/'inline-lookup-mobile.png'))
    mp.press('#lookupInput','Escape')
    check('is-flipped' in mp.locator('#card').get_attribute('class') and mp.locator('#remain').inner_text()=='2','手機直接點字能查詢，不翻卡或評分')
    check(mp.evaluate('document.documentElement.scrollWidth<=innerWidth'),'手機點字與查詢視窗沒有橫向溢出')
    check(not mobile_calls,'手機點字不呼叫外部API')
    mobile.close();b.close()
print('\nALL PASSED' if not errors else '\nERRORS: '+str(errors))
sys.exit(bool(errors))
