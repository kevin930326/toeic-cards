"""空間不足：所有學習資料有持續提示、可匯出記憶體資料、重試後重整保留。"""
import json,os
from playwright.sync_api import sync_playwright
from onboarding_helpers import existing_user
from shots import doc_shot
URL=os.environ.get('BASE_URL','http://127.0.0.1:8123/')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    ctx=browser.new_context(viewport={'width':393,'height':850});existing_user(ctx)
    ctx.add_init_script('window.__toeicFirebaseConfig=null;')
    ctx.route('https://api.dictionaryapi.dev/**',lambda r:r.fulfill(status=404,body='{}'))
    page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL+'#/settings',wait_until='networkidle')
    page.evaluate("""async()=>{const s=await import('/js/store.js');s.addWords(['recovery'],{autoGenerate:false});s.flushWords();(await import('/js/log.js')).recordQuiz(false);
      window.__save=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('toeic-cards:'))throw new DOMException('full','QuotaExceededError');return window.__save.call(this,k,v);};
      const w=s.getWords()[0];s.updateWord(w.id,{zh:'未存好的字義'});s.updateSettings({dailyGoal:31});
      (await import('/js/log.js')).recordQuiz(true);
      (await import('/js/mistakes.js')).addMistake({mode:'zh2en',wordId:w.id,word:w.word,prompt:'p',options:['a','b','c','d'],answerIndex:0},1);
      s.flushWords();
    }""")
    page.locator('.storage-notice').wait_for(state='visible')
    page.evaluate('window.scrollTo(0,0)');page.screenshot(path=doc_shot('44-storage-recovery.png'))
    with page.expect_download() as dl:page.click('#exportUnsaved')
    backup=json.loads(open(dl.value.path(),encoding='utf-8').read())['data']
    assert backup['words'][0]['zh']=='未存好的字義'
    assert backup['settings']['dailyGoal']==31
    assert sum(d.get('quiz',0) for d in backup['log'].values())==2
    assert len(backup['mistakes'])==1
    page.evaluate('()=>{Storage.prototype.setItem=window.__save;}')
    page.click('#retryStorage');page.locator('.storage-notice').wait_for(state='hidden')
    page.reload(wait_until='networkidle')
    state=page.evaluate("import('/js/restore-data.js').then(m=>m.currentData())")
    assert state['words'][0]['zh']=='未存好的字義' and state['settings']['dailyGoal']==31
    assert sum(d.get('quiz',0) for d in state['log'].values())==2 and len(state['mistakes'])==1
    assert not errors,errors
    ctx.close()
    blocked=browser.new_context();existing_user(blocked)
    blocked.add_init_script("window.__toeicFirebaseConfig=null;Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError')}})")
    pg=blocked.new_page();pg.goto(URL+'#/settings',wait_until='networkidle');assert pg.locator('#view h1').inner_text()=='設定'
    blocked.close();browser.close()
print('PASS 字卡／設定／紀錄／錯題失敗提示、記憶體備份、重試與封鎖儲存仍可開站')
