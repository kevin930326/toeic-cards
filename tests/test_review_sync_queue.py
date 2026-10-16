"""兩台裝置同時開著「今日複習」：同步進來別台的複習結果後，佇列要跟著更新（真實 Firebase 模擬器）。"""
import json, os, time, urllib.request
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

    browser.close()
print('ALL PASSED')
