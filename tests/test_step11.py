"""第 11 步：跨裝置同步（Firebase）端對端測試

使用 Firebase 官方的本機模擬器（真的 Firebase SDK，不會碰到正式專案），並套用專案的 firestore.rules：
  npx firebase emulators:start --only auth,firestore --project demo-toeic
  （firebase.json 的 firestore.rules 指向本專案的 firestore.rules；auth 9099、firestore 8080）

每個「裝置」是一個獨立的瀏覽器環境（各自的 localStorage），模擬電腦、手機、別人的裝置。
"""
import json, os, re, sys, time, urllib.request
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'screenshots')
os.makedirs(OUT, exist_ok=True)
URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
PROJECT = 'demo-toeic'
AUTH = 'http://127.0.0.1:9099'
FS = 'http://127.0.0.1:8080'
errors = []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        errors.append(msg)

CFG = f"""window.__toeicFirebaseConfig = {{ apiKey: 'demo-key', authDomain: '{PROJECT}.firebaseapp.com', projectId: '{PROJECT}', appId: 'demo-app',
  emulator: {{ auth: '{AUTH}', firestoreHost: '127.0.0.1', firestorePort: 8080 }} }};
if (window.speechSynthesis) speechSynthesis.speak = () => {{}};"""

def http(method, url, headers=None):
    req = urllib.request.Request(url, method=method, headers=headers or {})
    with urllib.request.urlopen(req) as r:
        body = r.read()
        return json.loads(body) if body else None

def reset_emulators():
    http('DELETE', f'{FS}/emulator/v1/projects/{PROJECT}/databases/(default)/documents')
    http('DELETE', f'{AUTH}/emulator/v1/projects/{PROJECT}/accounts')

def cloud_words(uid):
    """直接讀模擬器裡的資料（用管理者身分，不受安全規則限制），確認雲端真的有存"""
    try:
        res = http('GET', f'{FS}/v1/projects/{PROJECT}/databases/(default)/documents/users/{uid}/words?pageSize=300',
                   {'Authorization': 'Bearer owner'})
    except Exception:
        return {}
    out = {}
    for d in (res or {}).get('documents', []):
        f = d['fields']
        data = f.get('data', {}).get('mapValue', {}).get('fields', {})
        out[f['word']['stringValue']] = {
            'deleted': f.get('deleted', {}).get('booleanValue', False),
            'unfamiliar': data.get('unfamiliar', {}).get('booleanValue', False),
        }
    return out

def latest_link(email):
    codes = http('GET', f'{AUTH}/emulator/v1/projects/{PROJECT}/oobCodes')['oobCodes']
    return [c for c in codes if c['email'] == email and c['requestType'] == 'EMAIL_SIGNIN'][-1]['oobLink']

def landing_url(link):
    """模擬「點信裡的連結」：Firebase 會轉址回網站，網址帶著 oobCode 等參數"""
    q = link.split('?', 1)[1]
    params = dict(p.split('=', 1) for p in q.split('&'))
    return f"{URL}?apiKey={params['apiKey']}&oobCode={params['oobCode']}&mode=signIn&lang=zh-TW"

def word(w, i, **extra):
    return {'id': f'{w}-{i}', 'word': w, 'phonetic': '', 'pos': 'v.', 'zh': f'v. {w}的意思', 'en': f'meaning of {w}', 'examples': [],
            'collocations': [], 'forms': [], 'synonyms': [], 'unfamiliar': False, 'src': {}, 'lookup': {'dictAt': 1, 'enDone': True},
            'llm': None, 'srs': None, 'createdAt': i, 'updatedAt': 1000 + i, **extra}

def device(browser, name, words=None, own_log_reviews=0, mobile=False):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1000, 'height': 1000})
    ctx.add_init_script(CFG)
    ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append(f'{name} console: ' + m.text))
    pg.on('pageerror', lambda e: errors.append(f'{name} pageerror: ' + str(e)))
    pg.on('dialog', lambda d: d.accept())
    pg.goto(URL)
    pg.evaluate("""async ([ws, reviews]) => {
      localStorage.clear();
      if (ws) localStorage.setItem('toeic-cards:words', JSON.stringify(ws));
      if (reviews) {
        const { dayKey } = await import('/js/srs.js');
        localStorage.setItem('toeic-cards:log', JSON.stringify({ [dayKey(Date.now())]: { reviews, good: reviews, again: 0, learned: 0 } }));
      }
    }""", [words, own_log_reviews])
    pg.goto(URL + '#/settings')
    pg.reload()
    pg.wait_for_selector('#syncPanel .panel-title')
    return ctx, pg

def state(pg):
    return pg.evaluate("import('/js/sync.js').then((m) => { const s = m.syncState(); return { user: s.user, status: s.status, error: s.error }; })")

def wait_synced(pg, timeout=20000, since=0):
    # 注意：wait_for_function 遇到回傳 Promise 的函式會直接當成「成立」，所以改成自己輪詢
    end = time.time() + timeout / 1000
    while time.time() < end:
        st = pg.evaluate("""() => import('/js/sync.js').then((m) => {
          const s = m.syncState(); return { ok: !!s.user && s.status === 'idle' && s.lastSyncAt > 0, last: s.lastSyncAt, status: s.status, error: s.error };
        })""")
        if st['ok'] and st['last'] > since:
            return st
        time.sleep(0.3)
    raise AssertionError(f'等不到同步完成：{st}')

def sync_now(pg):
    before = pg.evaluate("import('/js/sync.js').then((m) => m.syncState().lastSyncAt)")
    pg.evaluate("import('/js/sync.js').then((m) => m.syncNow())")
    wait_synced(pg, since=before)

def local_words(pg):
    return {w['word']: w for w in pg.evaluate("JSON.parse(localStorage.getItem('toeic-cards:words') || '[]')")}

def today_combined(pg):
    return pg.evaluate("""async () => {
      const { getLog } = await import('/js/log.js'); const { dayKey } = await import('/js/srs.js');
      return getLog()[dayKey(Date.now())] || {};
    }""")

def google_login(pg, existing_email=None):
    with pg.expect_popup() as pop:
        pg.click('#googleBtn')
    popup = pop.value
    popup.wait_for_load_state()
    if existing_email:
        popup.get_by_text(existing_email).first.click()
    else:
        popup.get_by_text('Add new account').click()
        popup.get_by_text('Auto-generate user information').click()
        popup.get_by_text('Sign in with Google.com').click()
    wait_synced(pg)

reset_emulators()
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # ---- 沒有設定 Firebase 時 ----
    plain = browser.new_context()
    plain.add_init_script('window.__toeicFirebaseConfig = null;')   # 模擬「還沒設定 Firebase」
    pp = plain.new_page()
    pp.goto(URL + '#/settings')
    pp.wait_for_selector('#syncPanel .panel-title')
    check('還沒有設定' in pp.locator('#syncPanel').inner_text() and pp.locator('#googleBtn').count() == 0, '沒有 Firebase 設定時說明、不顯示登入')
    check(pp.evaluate("performance.getEntriesByType('resource').every((e) => !e.name.includes('firebasejs'))"), '沒用同步時不會下載 Firebase')
    plain.close()

    # ---- 電腦（A）：本機已經有 5 個字、今天複習 3 次，用 Google 登入 ----
    A_words = [word(w, i) for i, w in enumerate(['approve', 'invoice', 'negotiate', 'postpone', 'submit'])]
    ctxA, A = device(browser, 'A', A_words, own_log_reviews=3)
    check(A.locator('#googleBtn').is_visible() and A.locator('#emailForm').is_visible(), '登入前：Google 登入與 Email 登入連結')
    A.screenshot(path=os.path.join(OUT, 's11_login.png'), full_page=True)
    google_login(A)
    sa = state(A)
    uid, email = sa['user']['uid'], sa['user']['email']
    check(bool(uid) and 'Google' in A.locator('#syncPanel').inner_text(), f'Google 登入成功（{email}）')
    cw = cloud_words(uid)
    check(sorted(cw) == ['approve', 'invoice', 'negotiate', 'postpone', 'submit'], f'登入後把本機的字上傳到雲端 {sorted(cw)}')
    check('已同步' in A.locator('#syncPanel').inner_text(), '顯示「已同步」')

    # ---- 手機（B）：本機有自己的字 deadline、今天複習 2 次，登入同一個帳號 ----
    ctxB, B = device(browser, 'B', [word('deadline', 9)], own_log_reviews=2, mobile=True)
    google_login(B, existing_email=email)
    bw = local_words(B)
    check(sorted(bw) == ['approve', 'deadline', 'invoice', 'negotiate', 'postpone', 'submit'], f'手機拿到電腦的字，也保留自己的字 {sorted(bw)}')
    check(bw['approve']['zh'] == 'v. approve的意思', '單字內容完整')
    check(today_combined(B).get('reviews') == 5, f"手機的今日複習＝自己 2 ＋電腦 3 ＝ 5（{today_combined(B).get('reviews')}）")
    B.screenshot(path=os.path.join(OUT, 's11_phone.png'), full_page=True)

    sync_now(A)
    check('deadline' in local_words(A), '電腦拿到手機新增的字')
    check(today_combined(A).get('reviews') == 5, '電腦的今日複習也是 5（兩台加總，不會少算）')

    # ---- 修改：手機把 approve 標成不熟 → 電腦收到 ----
    B.evaluate("""async () => { const s = await import('/js/store.js'); const w = s.getWords().find((x) => x.word === 'approve'); s.toggleUnfamiliar(w.id); }""")
    sync_now(B)
    sync_now(A)
    check(local_words(A)['approve']['unfamiliar'] is True, '手機的修改同步到電腦')

    # ---- 刪除：電腦刪掉 invoice → 手機也刪掉 ----
    A.goto(URL + '#/words')
    A.locator('.word-row', has_text='invoice').locator('[data-act=delete]').click()
    sync_now(A)
    check(cloud_words(uid)['invoice']['deleted'] is True, '雲端留下刪除紀錄')
    sync_now(B)
    check('invoice' not in local_words(B), '電腦刪除的字，手機也刪掉了')

    # ---- 設定：手機改每日目標和主題 → 電腦只同步目標 ----
    B.goto(URL + '#/settings')
    B.click('.seg:has(input[name=dailyGoal][value="30"])')
    B.click('#themeToggle')
    sync_now(B)
    sync_now(A)
    sa_settings = A.evaluate("JSON.parse(localStorage.getItem('toeic-cards:settings') || '{}')")
    check(sa_settings.get('dailyGoal') == 30, '每日目標同步到電腦')
    check(sa_settings.get('theme', 'system') != 'dark', '主題不同步（每台裝置各自設定）')

    # ---- 錯題本：電腦答錯 → 手機也有，而且對應到手機自己的單字 id ----
    A.goto(URL + '#/quiz')
    A.click('.mode-btn[data-mode=zh2en]')
    prompt = A.locator('.q-zh').inner_text()
    answer = re.search(r'v\. (\w+)的意思', prompt).group(1)
    opts = A.locator('.option .option-text').all_inner_texts()
    A.locator('.option').nth((opts.index(answer) + 1) % 4).click()
    sync_now(A)
    sync_now(B)
    bm = B.evaluate("JSON.parse(localStorage.getItem('toeic-cards:mistakes') || '[]')")
    b_id = local_words(B)[answer]['id']
    check(len(bm) == 1 and bm[0]['question']['wordId'] == b_id, f'錯題本同步到手機，並換成手機的單字 id（{answer}）')

    # ---- 自動同步：改了東西不用按按鈕，約 8 秒後自動上傳 ----
    B.evaluate("""async () => { const s = await import('/js/store.js'); const w = s.getWords().find((x) => x.word === 'postpone'); s.toggleUnfamiliar(w.id); }""")
    deadline = time.time() + 20
    while time.time() < deadline and not cloud_words(uid).get('postpone', {}).get('unfamiliar'):
        time.sleep(1)
    check(cloud_words(uid)['postpone']['unfamiliar'] is True, '修改後自動同步到雲端（不用按按鈕）')

    # ---- 離線時改東西，連上網路後自動補上傳 ----
    ctxA.set_offline(True)
    A.evaluate("window.dispatchEvent(new Event('offline'))")
    A.evaluate("""async () => { const s = await import('/js/store.js'); const w = s.getWords().find((x) => x.word === 'submit'); s.toggleUnfamiliar(w.id); }""")
    A.wait_for_timeout(500)
    check(state(A)['status'] == 'offline', '離線時顯示「離線中」')
    ctxA.set_offline(False)
    A.evaluate("window.dispatchEvent(new Event('online'))")
    deadline = time.time() + 20
    while time.time() < deadline and not cloud_words(uid).get('submit', {}).get('unfamiliar'):
        time.sleep(1)
    check(cloud_words(uid)['submit']['unfamiliar'] is True, '連上網路後自動上傳離線時的修改')

    # ---- 重新打開網站：自動恢復登入並同步 ----
    A.goto(URL + '#/review')
    A.reload()
    wait_synced(A)
    check(state(A)['user']['uid'] == uid, '重新打開網站仍然是登入狀態，並自動同步')

    # ---- 別人（C）用 Email 登入連結：同一個瀏覽器點連結 → 自動完成 ----
    ctxC, C = device(browser, 'C', [word('other', 1)])
    C.fill('#emailInput', 'someone@example.com')
    C.click('#emailForm button[type=submit]')
    C.wait_for_selector('#syncPanel .sync-line.ok')
    check('已寄出登入連結' in C.locator('#syncPanel').inner_text(), '寄出 Email 登入連結')
    C.goto(landing_url(latest_link('someone@example.com')))
    wait_synced(C)
    sc = state(C)
    check(sc['user']['email'] == 'someone@example.com', '點連結後自動完成登入')
    check('oobCode' not in C.url, f'登入後網址上的參數被清掉（{C.url}）')
    check('approve' not in local_words(C) and sorted(local_words(C)) == ['other'], '別人的帳號看不到我的單字')

    # ---- 安全規則：C 不能讀寫 A 的資料 ----
    res = C.evaluate("""async (uidA) => {
      const fs = await import('https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js');
      const { getApp } = await import('https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js');
      const db = fs.getFirestore(getApp());
      const out = {};
      try { await fs.getDocs(fs.collection(db, 'users', uidA, 'words')); out.read = 'ALLOWED'; } catch (e) { out.read = e.code; }
      try { await fs.setDoc(fs.doc(db, 'users', uidA, 'meta', 'settings'), { value: {}, updatedAt: 1 }); out.write = 'ALLOWED'; } catch (e) { out.write = e.code; }
      return out;
    }""", uid)
    check(res == {'read': 'permission-denied', 'write': 'permission-denied'}, f'安全規則：別人不能讀、也不能寫我的資料 {res}')

    # ---- iPhone 主畫面 App：在 Safari 開連結沒用 → 貼上連結登入 ----
    ctxS, S = device(browser, 'Safari', mobile=True)
    S.fill('#emailInput', email)
    S.click('#emailForm button[type=submit]')
    S.wait_for_selector('#syncPanel .sync-line.ok')
    link = latest_link(email)
    ctxD, D = device(browser, 'App', [word('applocal', 3)], mobile=True)   # 主畫面 App：另一份 localStorage
    D.click('.paste-link summary')
    D.fill('#pasteEmail', email)
    D.fill('#pasteLink', link)
    D.click('#pasteForm button[type=submit]')
    wait_synced(D)
    check(state(D)['user']['uid'] == uid and 'approve' in local_words(D), '貼上登入連結就能登入同一個帳號並同步')
    D.screenshot(path=os.path.join(OUT, 's11_paste.png'), full_page=True)
    ctxS.close()

    # ---- 在另一台裝置點連結（這台不知道 Email）→ 請使用者確認 Email ----
    ctxE, E = device(browser, 'E')
    C.evaluate("import('/js/sync.js').then((m) => m.sendEmailLink('someone@example.com'))")
    C.wait_for_timeout(500)
    E.goto(landing_url(latest_link('someone@example.com')))
    E.wait_for_selector('#confirmForm', timeout=15000)
    check(E.url.endswith('#/settings'), '用登入連結打開、但這台不知道 Email → 帶到設定頁確認')
    E.fill('#confirmEmail', 'someone@example.com')
    E.click('#confirmForm button[type=submit]')
    wait_synced(E)
    check(state(E)['user']['email'] == 'someone@example.com', '輸入 Email 後完成登入')
    ctxE.close()

    # ---- 錯誤的連結 ----
    ctxD2, D2 = device(browser, 'D2')
    D2.click('.paste-link summary')
    D2.fill('#pasteEmail', 'x@example.com')
    D2.fill('#pasteLink', 'https://example.com/not-a-link')
    D2.click('#pasteForm button[type=submit]')
    D2.wait_for_timeout(800)
    check('不是有效的登入連結' in D2.locator('#toast').inner_text(), '貼錯連結時說明原因')
    ctxD2.close()

    # ---- 登出：資料保留 ----
    B.goto(URL + '#/settings')
    B.click('#signOut')
    B.wait_for_selector('#googleBtn')
    check(state(B)['user'] is None and 'approve' in local_words(B), '登出後回到登入畫面，這台裝置的資料保留')

    browser.close()

print('\nERRORS:' if errors else '\nALL PASSED', *errors, sep='\n')
sys.exit(1 if errors else 0)
