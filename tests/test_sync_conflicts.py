"""真實 Firebase 交易：兩裝置改不同欄位、同欄位衝突、時鐘差異、刪後重建。"""
import json,os,time,urllib.request
from playwright.sync_api import sync_playwright
from onboarding_helpers import existing_user
from sync_helpers import sync_state
from shots import doc_shot
URL=os.environ.get('BASE_URL','http://127.0.0.1:8123/')
CFG="""window.__toeicFirebaseConfig={apiKey:'demo-key',authDomain:'demo-toeic.firebaseapp.com',projectId:'demo-toeic',appId:'demo-app',emulator:{auth:'http://127.0.0.1:9099',firestoreHost:'127.0.0.1',firestorePort:8090}};"""
email=f'conflict-{time.time_ns()}@test.invalid'
req=urllib.request.Request('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key',data=json.dumps({'email':email,'password':'test-password','returnSecureToken':True}).encode(),headers={'Content-Type':'application/json'})
with urllib.request.urlopen(req):pass
def sync(pg):
    pg.evaluate("import('/js/sync.js').then(m=>m.syncNow())")
    end=time.time()+25
    while time.time()<end:
        s=sync_state(pg)
        if s['status']=='error':raise AssertionError(s['error'])
        if s['status']=='idle' and s['lastSyncAt']:return
        pg.wait_for_timeout(100)
    raise AssertionError('sync timeout')
def word(pg):return pg.evaluate("import('/js/store.js').then(s=>s.getWords()[0])")
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True);contexts=[]
    def device():
        ctx=browser.new_context(bypass_csp=True);contexts.append(ctx);existing_user(ctx);ctx.add_init_script(CFG)
        ctx.route('https://api.dictionaryapi.dev/**',lambda r:r.fulfill(status=404,body='{}'))
        pg=ctx.new_page();pg.goto(URL+'#/settings',wait_until='networkidle');pg.fill('#pwEmail',email);pg.fill('#pwPassword','test-password');pg.click('#pwForm button[type=submit]');pg.locator('#signOut').wait_for();sync(pg);return pg
    a=device();b=device()
    a.evaluate("import('/js/store.js').then(s=>{s.addWords(['approve'],{autoGenerate:false});const w=s.getWords()[0];s.updateWord(w.id,{zh:'原始',en:'original',lookup:{dictAt:1,enDone:true}});})")
    sync(a);sync(b)
    a.evaluate("import('/js/store.js').then(s=>s.updateWord(s.getWords()[0].id,{zh:'A 中文'}))")
    b.evaluate("""async()=>{const s=await import('/js/store.js');window.__now=Date.now;Date.now=()=>window.__now()+365*86400000;
      s.updateWord(s.getWords()[0].id,{en:'B English',srs:{reps:1,interval:1,ease:2.5,lapses:0,due:200,last:100}});Date.now=window.__now;}""")
    # 都從相同基準改完才啟動同步；交易必須保留兩邊欄位。
    a.evaluate("import('/js/sync.js').then(m=>{m.syncNow();})");sync(b);sync(a)
    for pg in [a,b]:
        sync(pg);w=word(pg);assert w['zh']=='A 中文' and w['en']=='B English' and w['srs']['reps']==1
    a.evaluate("import('/js/store.js').then(s=>s.updateWord(s.getWords()[0].id,{zh:'甲版'}))")
    b.evaluate("import('/js/store.js').then(s=>s.updateWord(s.getWords()[0].id,{zh:'乙版'}))")
    sync(a);sync(b);sync(a)
    assert word(a)['_conflicts'] and word(b)['_conflicts']
    a.goto(URL+'#/words');a.click('#toggleLibraryEdit');a.locator('[data-act=edit]').click()
    assert a.locator('.sync-conflicts').is_visible()
    a.locator('[data-conflict="0"]').select_option('0')
    a.locator('#editDialog').screenshot(path=doc_shot('44-sync-conflict.png'))
    a.locator('#editForm button[type=submit]').click();sync(a);sync(b)
    assert not word(a)['_conflicts'] and not word(b)['_conflicts']
    # 設定／錯題以整份快照確認，不能因裝置時間較大就默默蓋掉另一邊。
    a.evaluate("import('/js/store.js').then(s=>s.updateSettings({dailyGoal:31}))")
    b.evaluate("import('/js/store.js').then(s=>s.updateSettings({dailyGoal:47}))")
    sync(a)
    b.evaluate("import('/js/sync.js').then(m=>m.syncNow())")
    conflict=b.evaluate("import('/js/sync.js').then(m=>m.getMetaConflict())")
    assert conflict['name']=='settings' and conflict['local']['dailyGoal']==47 and conflict['remote']['value']['dailyGoal']==31
    b.goto(URL+'#/settings');b.click('#metaLocal');sync(b);sync(a)
    assert a.evaluate("import('/js/store.js').then(s=>s.getSettings().dailyGoal)")==47
    for pg,text in [(a,'question-a'),(b,'question-b')]:
        pg.evaluate("""async text=>{const s=await import('/js/store.js');const w=s.getWords()[0];(await import('/js/mistakes.js')).addMistake({mode:'zh2en',wordId:w.id,word:w.word,prompt:text,options:['a','b','c','d'],answerIndex:0},1);}""",text)
    sync(a);b.evaluate("import('/js/sync.js').then(m=>m.syncNow())")
    conflict=b.evaluate("import('/js/sync.js').then(m=>m.getMetaConflict())")
    assert conflict['name']=='mistakes' and conflict['local'][0]['question']['prompt']=='question-b'
    b.goto(URL+'#/settings');b.locator('.meta-conflict').screenshot(path=doc_shot('44-meta-conflict.png'));b.click('#metaRemote');sync(b)
    assert b.evaluate("import('/js/mistakes.js').then(m=>m.getMistakes()[0].question.prompt)")=='question-a'
    # 舊字離線更新，不能復活另一裝置已刪除的這一代字卡。
    b.evaluate("import('/js/store.js').then(s=>s.updateWord(s.getWords()[0].id,{en:'offline edit'}))")
    a.evaluate("import('/js/store.js').then(s=>s.deleteWord(s.getWords()[0].id))");sync(a);sync(b)
    assert word(b) is None
    b.evaluate("import('/js/store.js').then(s=>s.addWords(['approve'],{autoGenerate:false}))");sync(b);sync(a)
    assert word(a)['word']=='approve' and not word(a).get('srs')
    for ctx in contexts:ctx.close()
    browser.close()
print('PASS 不同欄位與進度保留、時鐘差異、同欄位雙份保留與選擇、刪除優先及明確重新新增')
