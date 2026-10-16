"""真實 Firebase SDK + 本機模擬器：訪客確認、切帳、晚回應及多分頁隔離。"""
import json
import os
import time
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
from onboarding_helpers import existing_user
from sync_helpers import sync_state
from shots import doc_shot

URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
PROJECT = 'demo-toeic'
CFG = """window.__toeicFirebaseConfig = {apiKey:'demo-key', authDomain:'demo-toeic.firebaseapp.com',
projectId:'demo-toeic',appId:'demo-app',emulator:{auth:'http://127.0.0.1:9099',firestoreHost:'127.0.0.1',firestorePort:8080}};"""

def wait_idle(page):
    until = time.time() + 30
    while time.time() < until:
        s = sync_state(page)
        if s['status'] == 'error':
            raise AssertionError(s['error'])
        if s['user'] and s['lastSyncAt'] and s['status'] == 'idle':
            return s
        page.wait_for_timeout(100)
    raise AssertionError('sync timeout')

def login(page, email, merge=None):
    page.locator('#pwEmail').fill(email)
    page.locator('#pwPassword').fill('test-password')
    page.locator('#pwForm button[type=submit]').click()
    if merge is not None:
        page.locator('#guestMerge').wait_for()
        # 首次登入尚未確認即重整，仍須停在選擇畫面，不可重新判成舊帳號資料。
        page.reload(wait_until='domcontentloaded')
        page.locator('#guestMerge').wait_for()
        s = sync_state(page)
        assert not s['lastSyncAt'], '未確認前不可同步'
        page.locator('#syncPanel').screenshot(path=doc_shot('41-guest-confirm.png'))
        page.locator('#guestMerge' if merge else '#guestKeep').click()
    page.wait_for_function("JSON.parse(localStorage.getItem('toeic-cards:profileOwner') || '\"\"') !== ''")
    page.wait_for_load_state('domcontentloaded')
    return wait_idle(page)

def logout(page):
    page.locator('#signOut').click()
    page.locator('#pwEmail').wait_for()
    page.wait_for_load_state('domcontentloaded')

def words(page):
    return page.evaluate("import('/js/store.js').then(m => m.getWords().map(w=>w.word))")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(bypass_csp=True, viewport={'width': 393, 'height': 800})
    existing_user(context)
    context.add_init_script(CFG)
    context.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    # 包裝真實 adapter：可讓 pull 晚回應，Auth/Firestore 仍用模擬器。
    source = Path('js/firebase-remote.js').read_text(encoding='utf-8').replace('export async function createFirebaseRemote', 'async function realRemote')
    source += """
export async function createFirebaseRemote(config) {
 const r = await realRemote(config); window.__remote = r; window.__uploads = [];
 const pull = r.pullWords; r.pullWords = async (...args) => {
   const out = await pull(...args);
   if (window.__holdPull) { window.__held = true; await new Promise(resolve => window.__release = resolve); }
   return out;
 };
 const push = r.pushWords; r.pushWords = async (...args) => { window.__uploads.push(args[0]); return push(...args); };
 return r;
} """
    context.route('**/js/firebase-remote.js', lambda r: r.fulfill(content_type='text/javascript', body=source))
    page = context.new_page()
    page.on('dialog', lambda d: d.accept())
    suffix = str(time.time_ns())
    users = []
    for name in ['a', 'b', 'c']:
        email = f'{name}-{suffix}@test.invalid'
        req = urllib.request.Request('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key',
            data=json.dumps({'email':email,'password':'test-password','returnSecureToken':True}).encode(), headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(req) as res:
            users.append((email, json.load(res)['localId']))
    page.goto(URL + '#/settings', wait_until='networkidle')
    page.evaluate("""async () => {
      const s=await import('/js/store.js'); s.addWords(['visitor'], {autoGenerate:false}); s.flushWords();
      (await import('/js/log.js')).recordQuiz(true);
      s.updateSettings({dailyGoal:37});
    }""")
    a = login(page, users[0][0], merge=False)
    assert words(page) == [], '拒絕合併後 A 不得看到訪客字卡'
    page.evaluate("""async () => {
      const s=await import('/js/store.js'); s.addWords(['accountalpha'], {autoGenerate:false}); s.flushWords();
      s.updateSettings({dailyGoal:42}); s.createWordSet('A only');
      const w=s.getWords()[0];
      (await import('/js/mistakes.js')).addMistake({mode:'zh2en',wordId:w.id,word:w.word,prompt:'A question',options:['a','b','c','d'],answerIndex:0},1);
      (await import('/js/log.js')).recordQuiz(true);
      (await import('/js/profile-storage.js')).profileStorage.setItem('toeic-cards:readings','[]');
      await (await import('/js/sync.js')).syncNow();
    }""")
    logout(page)
    assert words(page) == ['visitor'], '登出回到原本訪客空間'
    b = login(page, users[1][0], merge=False)
    assert words(page) == [], 'B 不得看到 A 或未確認的訪客字卡'
    assert page.evaluate("import('/js/store.js').then(s => s.getSettings().dailyGoal)") == 20
    assert page.evaluate("import('/js/log.js').then(m=>Object.keys(m.getLog()).length)") == 0
    assert page.evaluate("import('/js/store.js').then(s=>s.getWordSets().length)") == 0
    logout(page)
    login(page, users[0][0], merge=False)
    assert words(page) == ['accountalpha']
    assert page.evaluate("import('/js/store.js').then(s=>s.getSettings().dailyGoal)") == 42
    # 同步仍在等待時，登出立即使會話失效；模擬 signOut 還沒回應。
    page.evaluate("""async () => {
      window.__holdPull=true;
      (await import('/js/sync.js')).syncNow();
    }""")
    page.wait_for_function('window.__held')
    page.evaluate("""() => {
      window.__remote.signOut = () => new Promise(resolve=>window.__finishSignOut=resolve);
      import('/js/sync.js').then(m=>m.signOutSync());
      window.__uploads=[]; window.__holdPull=false; window.__release();
    }""")
    page.wait_for_timeout(500)
    assert page.evaluate('window.__uploads.length') == 0, '已失效的 pull 不得開始上傳'
    # 此處 Auth 模擬登出仍未回應，以重新載入解除測試包裝，再真正登出。
    page.reload(wait_until='domcontentloaded')
    wait_idle(page)
    logout(page)
    login(page, users[2][0], merge=True)
    assert words(page) == ['visitor'], '只有明確確認才合併訪客資料'
    # 雲端 B 的字卡應仍是空的（不是只在畫面隱藏）。
    req = urllib.request.Request(f'http://127.0.0.1:8080/v1/projects/{PROJECT}/databases/(default)/documents/users/{users[1][1]}/words', headers={'Authorization':'Bearer owner'})
    with urllib.request.urlopen(req) as res:
        assert not json.load(res).get('documents'), 'B 雲端不得收到 A 的字卡'
    other = context.new_page()
    other.goto(URL + '#/settings', wait_until='domcontentloaded')
    wait_idle(other)
    logout(page)
    other.wait_for_function("JSON.parse(localStorage.getItem('toeic-cards:profileOwner') || '\"\"') === ''")
    other.locator('#pwEmail').wait_for()
    assert words(other) == ['visitor'], '其他分頁也必須離開帳號資料'
    fresh = browser.new_context(bypass_csp=True)
    existing_user(fresh)
    fresh.add_init_script(CFG)
    fresh.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    fp = fresh.new_page()
    fp.goto(URL + '#/settings', wait_until='networkidle')
    fp.evaluate("import('/js/store.js').then(s=>{s.addWords(['newvisitor'],{autoGenerate:false});s.flushWords();})")
    login(fp, users[0][0], merge=True)
    assert set(words(fp)) == {'accountalpha','newvisitor'}
    assert fp.evaluate("import('/js/store.js').then(s=>s.getSettings().dailyGoal)") == 42, '訪客不能覆蓋雲端設定'
    assert fp.evaluate("import('/js/mistakes.js').then(s=>s.getMistakes().length)") == 1, '訪客不能清空雲端錯題'
    fresh.close()
    context.close()
    browser.close()
print('PASS 訪客確認、A/B 隔離、同帳號恢復、晚回應失效、雲端驗證、多分頁')
