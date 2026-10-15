"""單字探索：直接閱讀、篩選／選字、發音／編輯、複習分工與進度保護。"""
import os, sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

URL=os.environ.get('BASE_URL','http://127.0.0.1:8123/')
OUT=Path(__file__).parent/'screenshots'
OUT.mkdir(exist_ok=True)
errors=[]

def check(ok,message):
    print(('PASS ' if ok else 'FAIL ')+message,flush=True)
    if not ok:errors.append(message)

def store(pg,code):
    return pg.evaluate('async()=>{const s=await import("/js/store.js");'+code+'}')

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    ctx=browser.new_context(viewport={'width':1280,'height':960},service_workers='block')
    ctx.add_init_script('window.__toeicFirebaseConfig=null;window.__spoken=[];if(window.speechSynthesis)speechSynthesis.speak=u=>window.__spoken.push(u.text);')
    ctx.route('https://api.dictionaryapi.dev/**',lambda r:r.fulfill(status=404,body='{}'))
    ctx.route('https://generativelanguage.googleapis.com/**',lambda r:r.fulfill(status=403,body='{}'))
    ctx.route('https://fonts.googleapis.com/**',lambda r:r.fulfill(status=200,content_type='text/css',body=''))
    pg=ctx.new_page()
    pg.on('pageerror',lambda e:errors.append(str(e)))
    pg.goto(URL+'#/cards')
    pg.wait_for_load_state('networkidle')
    check(pg.locator('.empty-title').inner_text()=='還沒有收藏的單字','空探索頁有明確引導')
    ids=store(pg,'''const input=['invoice','budget','agenda','résumé'];
      s.addWords(input,{autoGenerate:false});
      const meanings={invoice:'發票',budget:'預算',agenda:'議程','résumé':'履歷'};
      const definitions={invoice:'a document listing goods or services and their prices',budget:'a plan for how money will be spent',agenda:'a list of topics to discuss at a meeting','résumé':'a short record of your education and work experience'};
      const ipa={invoice:'/ˈɪnvɔɪs/',budget:'/ˈbʌdʒɪt/',agenda:'/əˈdʒendə/','résumé':'/ˈrezʊmeɪ/'};
      s.updateWords(s.getWords().map(w=>[w.id,{zh:meanings[w.word],pos:'n.',en:definitions[w.word],
        phonetic:ipa[w.word],examples:[{en:'Please review the '+w.word+'.',zh:'請確認這份資料。'}],collocations:['review the '+w.word],forms:[],synonyms:[],
        unfamiliar:w.word==='budget',lookup:{dictAt:1,enDone:true},srs:{due:Date.now()+86400000,interval:5,reps:2,ease:2.5,lapses:0,last:1}}]));
      const finance=s.createWordSet('財務'),empty=s.createWordSet('空單字集');
      s.assignWordSet(s.getWords().filter(w=>['invoice','budget'].includes(w.word)).map(w=>w.id),finance.id);
      return {finance:finance.id,empty:empty.id};''')
    check(pg.locator('#exploreList .explore-item').count()==4,'所有收藏均能探索，尚未到期的字不受限制')
    check(pg.locator('.nav [data-route=cards]').inner_text()=='探索','原字卡入口改名探索，舊網址仍可用')
    check(pg.locator('#card').count()==0 and pg.locator('#good').count()==0 and pg.locator('#again').count()==0,'探索沒有翻面與複習評分按鈕')
    check(pg.locator('.back-zh').is_visible() and pg.locator('.back-en').is_visible() and pg.locator('.ex-en').is_visible(),'中文、英文與雙語例句直接可讀')
    before=store(pg,'return s.getWords().map(w=>[w.id,w.srs]);')
    log_before=pg.evaluate("localStorage.getItem('toeic-cards:log')")
    pg.locator('.explore-item').filter(has_text='invoice').click()
    expect(pg.locator('#exploreWord')).to_have_text('invoice')
    pg.click('#next')
    pg.keyboard.press('ArrowLeft')
    expect(pg.locator('#exploreWord')).to_have_text('invoice')
    pg.click('#exploreDetail [data-speak]')
    pg.click('[data-speak-text="review the invoice"]')
    pg.locator('.ex-en .mini-speak').click()
    check(pg.evaluate('window.__spoken')==['invoice','review the invoice','Please review the invoice.'],'單字、搭配詞與例句都能直接發音')
    pg.click('#openLookup')
    pg.keyboard.press('ArrowRight')
    pg.click('[aria-label="關閉查單字"]')
    expect(pg.locator('#exploreWord')).to_have_text('invoice')
    check(True,'全站查字視窗開啟時不會換探索選字')
    pg.fill('#exploreSearch','預算')
    expect(pg.locator('#exploreWord')).to_have_text('budget')
    check(pg.locator('.explore-item').count()==1 and pg.locator('#next').is_disabled(),'搜尋中文只留符合的收藏，單字一個時停用換字')
    pg.type('#exploreSearch','不存在')
    check(pg.locator('.empty-title').inner_text()=='找不到符合的收藏' and pg.locator('#exploreSearch').evaluate('(el)=>el===document.activeElement'),'輸入過程保留焦點，查無結果不跳回全部')
    pg.click('#clearExploreSearch')
    pg.fill('#exploreSearch','RE\u0301SUME\u0301')
    expect(pg.locator('#exploreWord')).to_have_text('résumé')
    pg.fill('#exploreSearch','')
    pg.select_option('#setScope',ids['finance'])
    check(pg.locator('.explore-item').count()==2,'探索只顯示選中的單字集')
    pg.locator('.seg:has(input[value=unfamiliar])').click()
    expect(pg.locator('#exploreWord')).to_have_text('budget')
    pg.click('#markBtn')
    check(pg.locator('.empty-title').inner_text()=='沒有標記為「不熟」的字','取消不熟後即時更新篩選，提供空狀態')
    pg.locator('.seg:has(input[value=all])').click()
    check(store(pg,'return s.getWords().map(w=>[w.id,w.srs]);')==before and pg.evaluate("localStorage.getItem('toeic-cards:log')")==log_before,'瀏覽、搜尋、切換與不熟標記不更動SRS或學習紀錄')
    pg.click('#editBtn')
    pg.fill('#editForm [name=en]','A custom explanation for this word')
    pg.click('#editForm button[type=submit]')
    expect(pg.locator('.back-en')).to_contain_text('A custom explanation for this word')
    check(True,'編輯既有收藏後探索內容即時更新')
    pg.select_option('#setScope',ids['empty'])
    check(pg.locator('.empty-title').inner_text()=='這個單字集還沒有字卡','空分類保持範圍，不混入其他收藏')
    pg.select_option('#setScope','')
    pg.locator('.explore-item').filter(has_text='invoice').click()
    pg.add_style_tag(content='#toast{visibility:hidden!important}')
    pg.screenshot(path=str(OUT/'explore-desktop.png'),full_page=True)
    pg.goto(URL+'#/review')
    # 將一字設為到期，驗證只有複習評分才調整排程。
    store(pg,"const w=s.getWords().find(w=>w.word==='invoice');s.updateWord(w.id,{srs:{...w.srs,due:1}});")
    pg.goto(URL+'#/stats')
    pg.goto(URL+'#/review')
    pg.wait_for_selector('#card')
    check(pg.locator('.review-purpose h1').inner_text()=='今日複習','複習頁說明回想、翻面與排程用途')
    pg.click('#card')
    check('is-flipped' in pg.locator('#card').get_attribute('class'),'今日複習保留翻面回想')
    pg.click('#good')
    pg.wait_for_timeout(450)
    check(store(pg,"return s.getWords().find(w=>w.word==='invoice').srs.interval;")>5,'今日複習評分才增加下次間隔')
    pg.goto(URL+'#/cards')
    check(pg.locator('#exploreWord').inner_text()=='invoice','回到探索保留先前選字')
    for width in [320,375,768]:
        pg.set_viewport_size({'width':width,'height':812})
        check(pg.evaluate('document.documentElement.scrollWidth<=innerWidth'),str(width)+'px 探索頁無橫向溢出')
        if width==375:
            pg.screenshot(path=str(OUT/'explore-mobile.png'),full_page=True)
            pg.click('#themeToggle')
            pg.screenshot(path=str(OUT/'explore-dark.png'),full_page=True)
            pg.click('#themeToggle')
    # 雲端同步移除目前字後，介面須選擇仍存在的有效字，不留下空白詳情。
    store(pg,"s.deleteWord(s.getWords().find(w=>w.word==='invoice').id);")
    check(pg.locator('#exploreWord').inner_text()!='invoice','目前字刪除後自動選擇有效收藏')
    store(pg,"s.addWords(['negative'],{autoGenerate:false,initialData:new Map([['negative',{pos:'adj.',zh:'負面的；否定的',en:'expressing an unfavorable opinion or result',lookup:{dictAt:1,enDone:true}}]])});")
    pg.locator('.explore-item').filter(has_text='negative').click()
    for width in [1280,375,320]:
        pg.set_viewport_size({'width':width,'height':900})
        close=pg.locator('.explore-reading .back-en').evaluate('''el=>{
          const pos=el.querySelector('.zh-pos').getBoundingClientRect();
          const text=el.querySelector('.lookup-token').getBoundingClientRect();
          return Math.abs((pos.top+pos.bottom)/2-(text.top+text.bottom)/2)<10 && text.left-pos.right<=16;
        }''')
        check(close,str(width)+'px 英文詞性與解釋在同一行且間距不超過16px')
        check(pg.locator('.explore-reading .back-pos').count()==0,'中文詞性也直接接在詞義旁邊')
        if width==1280:pg.locator('#exploreDetail').screenshot(path=str(OUT/'explore-spacing.png'))
    ctx.close()
    browser.close()
print('\nALL PASSED' if not errors else '\nERRORS: '+str(errors))
sys.exit(bool(errors))
