"""備份＋同步整合：30 不變 50；重複合併、取代、換裝置與舊版還原。僅 Firebase 模擬器。"""
import json, os, time, urllib.request
from playwright.sync_api import sync_playwright
from onboarding_helpers import existing_user
from sync_helpers import sync_state
from shots import doc_shot

URL=os.environ.get('BASE_URL','http://127.0.0.1:8123/')
CFG="""window.__toeicFirebaseConfig={apiKey:'demo-key',authDomain:'demo-toeic.firebaseapp.com',projectId:'demo-toeic',appId:'demo-app',
emulator:{auth:'http://127.0.0.1:9099',firestoreHost:'127.0.0.1',firestorePort:8080}};"""
email=f'backup-{time.time_ns()}@test.invalid'
req=urllib.request.Request('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key',data=json.dumps({'email':email,'password':'test-password','returnSecureToken':True}).encode(),headers={'Content-Type':'application/json'})
with urllib.request.urlopen(req) as r: uid=json.load(r)['localId']

def sync(page):
    page.evaluate("import('/js/sync.js').then(m=>m.syncNow())")
    until=time.time()+25
    while time.time()<until:
        s=sync_state(page)
        if s['status']=='error': raise AssertionError(s['error'])
        if s['user'] and s['lastSyncAt'] and s['status']=='idle': return
        page.wait_for_timeout(100)
    raise AssertionError('sync timeout')

def total(page):
    return page.evaluate("import('/js/log.js').then(m=>Object.values(m.getLog()).reduce((n,d)=>n+(d.reviews||0),0))")

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    contexts=[]
    def device():
        ctx=browser.new_context(bypass_csp=True);contexts.append(ctx);existing_user(ctx);ctx.add_init_script(CFG)
        ctx.route('https://api.dictionaryapi.dev/**',lambda r:r.fulfill(status=404,body='{}'))
        pg=ctx.new_page();pg.on('dialog',lambda d:d.accept());pg.goto(URL+'#/settings',wait_until='networkidle')
        pg.fill('#pwEmail',email);pg.fill('#pwPassword','test-password');pg.click('#pwForm button[type=submit]')
        pg.locator('#signOut').wait_for();sync(pg);pg.locator('.settings-nav').get_by_role('button',name='備份',exact=True).click()
        return pg
    a=device();b=device()
    for pg,n in [(a,10),(b,20)]:
        pg.evaluate("""async n=>{const m=await import('/js/log.js');for(let i=0;i<n;i++)m.recordReview('good',false); }""",n)
        sync(pg)
    sync(a)
    assert total(a)==30
    # 真的從 UI 匯出，再經檔案欄位匯入。
    with a.expect_download() as dl: a.click('#exportBtn')
    backup=json.loads(open(dl.value.path(),encoding='utf-8').read())
    assert backup['version']==3 and len(backup['data']['logLedger']['sources'])==2
    def import_file(pg,data,replace=False):
        pg.set_input_files('#importFile',{'name':'backup.json','mimeType':'application/json','buffer':json.dumps(data).encode()})
        pg.locator('#doMerge').wait_for()
        pg.locator('#importArea').screenshot(path=doc_shot('42-backup-sources.png'))
        pg.click('#doReplace' if replace else '#doMerge')
        if replace: pg.locator('#importFile').wait_for()
        sync(pg)
    import_file(a,backup);import_file(a,backup)
    assert total(a)==30, '同份備份合併兩次仍30'
    import_file(a,backup,True)
    assert total(a)==30, '取代後重新同步仍30'
    sync(b)
    assert total(b)==30, '另一台也不再加回舊來源'
    c=device();import_file(c,backup)
    assert total(c)==30, '換裝置合併後仍30'
    # 舊來源雲端故意留著，數值100不能重新加回新帳本。
    c.evaluate("""async uid=>{
      const fs=await import('https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js');
      await fs.setDoc(fs.doc(fs.getFirestore(),'users',uid,'logs','old-device'),{log:{'2026-10-16':{reviews:100}},updatedAt:9999999999999});
    }""",uid)
    sync(c);assert total(c)==30
    legacy=json.loads(json.dumps(backup));legacy['version']=2;del legacy['data']['logLedger']
    import_file(c,legacy);assert total(c)==30
    import_file(c,legacy,True);assert total(c)==30
    sync(a);assert total(a)==30
    # 備份取代後，較舊雲端字卡、設定、錯題、分類不得復活。
    a.evaluate("""async()=>{const s=await import('/js/store.js');s.addWords(['obsolete'],{autoGenerate:false});s.createWordSet('obsolete-set');s.updateSettings({dailyGoal:99});s.flushWords();}""")
    sync(a)
    empty=json.loads(json.dumps(backup));empty['data']['words']=[];empty['data']['wordSets']=[];empty['data']['settings']={'dailyGoal':23}
    import_file(c,empty,True);sync(a)
    assert a.evaluate("import('/js/store.js').then(s=>s.getWords().length)")==0
    assert a.evaluate("import('/js/store.js').then(s=>s.getSettings().dailyGoal)")==23
    assert a.evaluate("import('/js/store.js').then(s=>s.getWordSets().length)")==0
    for ctx in contexts:ctx.close()
    browser.close()
print('PASS 10+20=30、重複合併、取代、換裝置、舊版備份與舊雲端資料不加回')
