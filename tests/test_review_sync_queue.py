"""兩台裝置同時開著「今日複習」：同步進來別台的複習結果後，佇列要跟著更新（真實 Firebase 模擬器）。"""
import json, os, re, time, urllib.request
from playwright.sync_api import sync_playwright, expect
from onboarding_helpers import existing_user
from sync_helpers import sync_state
from shots import doc_shot

URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
CFG = """window.__toeicFirebaseConfig={apiKey:'demo-key',authDomain:'demo-toeic.firebaseapp.com',projectId:'demo-toeic',appId:'demo-app',emulator:{auth:'http://127.0.0.1:9099',firestoreHost:'127.0.0.1',firestorePort:8090}};"""
email = f'review-queue-{time.time_ns()}@test.invalid'
req = urllib.request.Request('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key',
                             data=json.dumps({'email': email, 'password': 'test-password', 'returnSecureToken': True}).encode(),
                             headers={'Content-Type': 'application/json'})
with urllib.request.urlopen(req):
    pass

def sync(pg):
    pg.evaluate("import('/js/sync.js').then(m=>m.syncNow())")
    end = time.time() + 25
    while time.time() < end:
        s = sync_state(pg)
        if s['status'] == 'error':
            raise AssertionError(s['error'])
        if s['status'] == 'idle' and s['lastSyncAt']:
            return
        pg.wait_for_timeout(100)
    raise AssertionError('sync timeout')

def remain(pg):
    return int(pg.locator('#remain').inner_text()) if pg.locator('#remain').count() else 0

def front(pg):
    return pg.locator('.card-front .headword').inner_text().strip()

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    def device():
        ctx = browser.new_context(bypass_csp=True)
        existing_user(ctx)
        ctx.add_init_script(CFG)
        ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
        pg = ctx.new_page()
        pg.goto(URL + '#/settings', wait_until='networkidle')
        pg.fill('#pwEmail', email)
        pg.fill('#pwPassword', 'test-password')
        pg.click('#pwForm button[type=submit]')
        pg.locator('#signOut').wait_for()
        sync(pg)
        return pg
    a = device()
    b = device()

    # 三個今天到期的舊字
    a.evaluate("""async()=>{const s=await import('/js/store.js');s.addWords(['approve','invoice','budget'],{autoGenerate:false});
      s.updateWords(s.getWords().map((w,i)=>[w.id,{zh:'n. 測試',en:'test',lookup:{dictAt:1,enDone:true},llm:{status:'done',at:1},
        srs:{reps:1,interval:1,ease:2.5,lapses:0,due:1000+i,last:500+i}}]));}""")
    sync(a); sync(b)
    for pg in (a, b):
        pg.goto(URL + '#/review')
        pg.locator('#remain').wait_for()
    print('PASS 兩台裝置開始時都是', remain(a), remain(b), '張')
    assert remain(a) == 3 and remain(b) == 3

    # 1. A 複習了一張（會）→ 同步後 B 不重新整理也少一張
    first = front(a)
    a.click('#good')
    expect(a.locator('#remain')).to_have_text('2')
    sync(a); sync(b)
    expect(b.locator('#remain')).to_have_text('2')
    words_b = b.evaluate("import('/js/store.js').then(s=>s.getWords().filter(w=>w.srs.due<=Date.now()).map(w=>w.word))")
    assert first not in words_b and front(b) != first
    print(f'PASS A 複習過的 {first} 同步後從 B 的佇列拿掉（B 剩 2 張，不用重新整理）')
    b.screenshot(path=doc_shot('52-review-sync-queue.png'))

    # 2. B 按「不熟」：B 這一輪隔幾張再出現；A 那邊還沒到期 → 拿掉
    again = front(b)
    b.click('#again')
    expect(b.locator('.card-front .headword')).not_to_have_text(again)   # 等評分完成（張數前後都是 2）
    expect(b.locator('#remain')).to_have_text('2')
    sync(b); sync(a)
    expect(a.locator('#remain')).to_have_text('1')
    assert front(a) != again
    print(f'PASS B 按「不熟」的 {again}：B 留在這一輪，A 要等 10 分鐘到期才出現（A 剩 1 張）')

    # 3. 10 分鐘後 → A 不用重新整理，那張自己出現
    a.evaluate("()=>{const real=Date.now;Date.now=()=>real()+11*60000;document.dispatchEvent(new Event('visibilitychange'));}")
    expect(a.locator('#remain')).to_have_text('2')
    badge = a.evaluate("import('/js/views/review.js?v=exam-1').then(m=>m.reviewBadgeCount())")
    assert badge == 2, badge
    print('PASS 10 分鐘後到期的字自動補回 A 的佇列，導覽列數字一致')

    # 4. 這台自己按「不熟」的字不會被當成「別處複習過」拿掉
    mine = front(a)
    a.click('#again')
    expect(a.locator('.card-front .headword')).not_to_have_text(mine)
    a.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    queue = a.evaluate("import('/js/views/review.js?v=exam-1').then(m=>m.reviewBadgeCount())")
    assert queue == 2, queue
    print(f'PASS 自己按「不熟」的 {mine} 留在這一輪（仍 2 張）')

    # 5. 兩台在同步前都複習了同一張卡 → 以最後一次複習為準，不跳「同步衝突」
    # （A 的時間在上一段被調快 11 分鐘，這裡先還原）
    a.evaluate("()=>{delete Date.now;}")
    a.reload(); a.locator('.page-review, .done-state').first.wait_for()
    sync(a); sync(b)
    a.evaluate("""async()=>{const s=await import('/js/store.js');const w=s.getWords().find(x=>x.word==='budget');
      s.updateWord(w.id,{srs:{reps:0,interval:0,ease:2.3,lapses:1,due:Date.now()+600000,last:Date.now()-60000},unfamiliar:true});}""")
    b.evaluate("""async()=>{const s=await import('/js/store.js');const w=s.getWords().find(x=>x.word==='budget');
      s.updateWord(w.id,{srs:{reps:3,interval:7,ease:2.5,lapses:0,due:Date.now()+7*86400000,last:Date.now()},unfamiliar:false});}""")
    sync(a); sync(b); sync(a)
    got = [pg.evaluate("import('/js/store.js').then(s=>s.getWords().find(x=>x.word==='budget'))") for pg in (a, b)]
    assert all(not (w.get('_conflicts') or []) for w in got), [w.get('_conflicts') for w in got]
    assert got[0]['srs'] == got[1]['srs'] and got[0]['srs']['interval'] == 7 and got[0]['unfamiliar'] is False
    a.goto(URL + '#/settings')
    assert '同欄位修改衝突' not in a.locator('#syncPanel').inner_text()
    print('PASS 兩台都複習同一張卡：以較晚的那次為準、兩邊一致、沒有衝突提示')

    # 6. B 做了測驗 → A 的今日目標不重新整理也更新
    a.goto(URL + '#/review'); a.locator('.page-review, .done-state').first.wait_for()
    # 有卡時看右上的目標徽章，複習完時看完成畫面的「今日目標 n / 20 題」
    shown = lambda: int(re.search(r'今日目標 (\d+) / ', a.locator('.goal-pill').get_attribute('aria-label') if a.locator('.goal-pill').count() else a.locator('.goal-todo').inner_text()).group(1))
    n0 = shown()
    b.evaluate("import('/js/log.js').then(l=>{for(let i=0;i<5;i++) l.recordQuiz(true);})")
    sync(b); sync(a)
    end = time.time() + 10
    while shown() != n0 + 5 and time.time() < end:
        a.wait_for_timeout(100)
    n1 = shown()
    assert n1 == n0 + 5, (n0, n1)
    a.goto(URL + '#/stats'); a.wait_for_timeout(500)
    stats_before = a.locator('main').inner_text()
    b.evaluate("import('/js/log.js').then(l=>l.recordQuiz(true))")
    sync(b); sync(a)
    expect(a.locator('main')).not_to_have_text(stats_before)
    print(f'PASS 別台的測驗同步進來：今日目標 {n0} → {n1}、統計頁都自動更新')

    # 7. 複習頁開著跨過一天 → 換成今天的清單，和導覽列數字一致
    a.goto(URL + '#/review'); a.locator('.page-review, .done-state').first.wait_for()
    a.evaluate("()=>{const real=Date.now;Date.now=()=>real()+86400000;document.dispatchEvent(new Event('visibilitychange'));}")
    a.wait_for_timeout(300)
    page_count = remain(a)
    badge = a.evaluate("import('/js/views/review.js?v=exam-1').then(m=>m.reviewBadgeCount())")
    expected = a.evaluate("""async()=>{const s=await import('/js/store.js');return s.scopedWords().filter(w=>w.srs&&w.srs.due<=Date.now()).length;}""")
    assert page_count == badge == expected, (page_count, badge, expected)
    print(f'PASS 跨日後複習頁自動換成今天的清單（{page_count} 張），和導覽列一致')

    browser.close()
print('ALL PASSED')
