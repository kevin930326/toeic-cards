"""第 8 步：匯出／匯入（端對端測試）"""
import json, os, sys, tempfile
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'screenshots')
os.makedirs(OUT, exist_ok=True)
URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
TMP = tempfile.mkdtemp(prefix='toeic-backup-')
KEY = 'AIzaTEST-not-a-real-key-123'
errors = []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        errors.append(msg)

def word(w, i, **extra):
    base = {'id': f'id-{w}', 'word': w, 'phonetic': '/x/', 'pos': 'v.', 'zh': f'v. {w}的意思', 'en': f'meaning of {w}',
            'examples': [{'en': f'We {w} it.', 'zh': '例句'}], 'collocations': [f'{w} a plan'], 'forms': [], 'synonyms': [],
            'unfamiliar': i == 0, 'src': {'zh': 'llm'}, 'lookup': {'dictAt': 1, 'enDone': True}, 'llm': {'status': 'done', 'at': 1},
            'srs': {'reps': 2, 'interval': 3 + i, 'ease': 2.5, 'lapses': 0, 'due': 9999999999999, 'last': 1},
            'createdAt': i, 'updatedAt': 100 + i}
    base.update(extra)
    return base

WORDS_A = [word(w, i) for i, w in enumerate(['approve', 'invoice', 'deadline', 'negotiate'])]
LOG_A = {'2026-10-13': {'reviews': 12, 'good': 10, 'again': 2, 'learned': 4, 'goal': 10},
         '2026-10-14': {'reviews': 5, 'good': 5, 'again': 0, 'learned': 1, 'quiz': 3, 'quizCorrect': 2, 'goal': 10}}
MISTAKE = {'key': 'zh2en|id-approve|v. approve的意思', 'question': {'mode': 'zh2en', 'wordId': 'id-approve', 'word': 'approve',
           'prompt': 'v. approve的意思', 'options': ['approve', 'invoice', 'deadline', 'negotiate'], 'answerIndex': 0}, 'chosen': 2, 'count': 1, 'at': 1}

def seed(page, words, log, mistakes, settings, key=None):
    page.evaluate("""([ws, log, ms, st, key]) => {
      localStorage.clear();
      localStorage.setItem('toeic-cards:words', JSON.stringify(ws));
      localStorage.setItem('toeic-cards:log', JSON.stringify(log));
      localStorage.setItem('toeic-cards:mistakes', JSON.stringify(ms));
      localStorage.setItem('toeic-cards:settings', JSON.stringify(st));
      if (key) localStorage.setItem('toeic-cards:gemini-key', key);
    }""", [words, log, mistakes, settings, key])

def store(page, k):
    return page.evaluate(f"JSON.parse(localStorage.getItem('toeic-cards:{k}') || 'null')")

def new_page(browser):
    ctx = browser.new_context(viewport={'width': 1000, 'height': 1000}, accept_downloads=True)
    ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append('console: ' + m.text))
    pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    pg.on('dialog', lambda d: d.accept())
    return ctx, pg

def import_file(page, path):
    page.evaluate("document.querySelector('#importArea').innerHTML = ''")   # 清掉上一次的結果，避免讀到舊訊息
    page.set_input_files('#importFile', path)
    page.wait_for_selector('#importArea :is(.import-preview, .ai-error)')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # ======== 裝置 A：匯出 ========
    ctxA, a = new_page(browser)
    a.goto(URL)
    seed(a, WORDS_A, LOG_A, [MISTAKE], {'theme': 'dark', 'dailyGoal': 10, 'accent': 'en-GB'}, key=KEY)
    a.goto(URL + '#/settings')
    a.reload()
    a.wait_for_load_state('networkidle')
    now_text = a.locator('.backup-now').inner_text()
    check('單字 4 個' in now_text and '學習紀錄 2 天' in now_text and '錯題 1 題' in now_text and '還沒有備份過' in now_text, f'顯示目前資料量：{now_text!r}')
    with a.expect_download() as dl:
        a.click('#exportBtn')
    d = dl.value
    path = os.path.join(TMP, d.suggested_filename)
    d.save_as(path)
    check(d.suggested_filename.startswith('toeic-cards-backup-') and d.suggested_filename.endswith('.json'), f'檔名 {d.suggested_filename}')
    raw = open(path, encoding='utf-8').read()
    data = json.loads(raw)
    check(data['app'] == 'toeic-cards' and data['version'] == 1 and data['counts'] == {'words': 4, 'days': 2, 'mistakes': 1}, f"備份格式 {data['counts']}")
    check(KEY not in raw and 'gemini-key' not in raw, '備份檔不含 Gemini 金鑰')
    check(data['data']['words'][0]['srs']['interval'] == 3 and data['data']['settings']['accent'] == 'en-GB', '複習排程、設定都有匯出')
    check('上次備份' in a.locator('.backup-now').inner_text(), '匯出後顯示上次備份時間')
    a.screenshot(path=os.path.join(OUT, 's8_settings.png'), full_page=True)

    # ======== 裝置 B（全新的瀏覽器）：用「取代」還原 ========
    ctxB, b = new_page(browser)
    b.goto(URL + '#/settings')
    b.wait_for_load_state('networkidle')
    import_file(b, path)
    prev = b.locator('.import-preview').inner_text()
    check('單字 4 個' in prev and '學習紀錄 2 天' in prev and '錯題 1 題' in prev, f'匯入前先預覽：{prev[:60]!r}')
    check('新增 4 個字' in prev, '預覽合併結果')
    b.screenshot(path=os.path.join(OUT, 's8_preview.png'), full_page=True)
    b.click('#doReplace')
    b.wait_for_timeout(300)
    ws = store(b, 'words')
    check(len(ws) == 4 and ws[0]['srs']['interval'] == 3 and ws[0]['unfamiliar'] is True, '單字、複習排程、不熟標記都還原')
    check(ws[0]['examples'][0]['en'] == 'We approve it.' and ws[0]['llm']['status'] == 'done', 'AI 內容也還原，不用重新生成')
    check(store(b, 'log') == LOG_A, '學習紀錄還原')
    check(len(store(b, 'mistakes')) == 1, '錯題本還原')
    st = store(b, 'settings')
    check(st['theme'] == 'dark' and st['dailyGoal'] == 10 and st['accent'] == 'en-GB', f'設定還原 {st}')
    check(b.evaluate("document.documentElement.dataset.theme") == 'dark', '主題立刻套用（深色）')
    check(b.locator('input[name=accent][value="en-GB"]').is_checked(), '設定頁重畫，顯示還原後的口音')
    check(b.evaluate("localStorage.getItem('toeic-cards:gemini-key')") is None, '新裝置沒有金鑰（要自己重新填）')
    check(not b.locator('#toast').inner_text().startswith('🎉'), '匯入時不會跳出「目標達成」')
    b.goto(URL + '#/quiz')
    check('1 題' in b.locator('#openMistakes').inner_text(), '還原後錯題本可以使用')

    # ======== 裝置 B 多學一點，再把 A 的備份「合併」進來 ========
    b.evaluate("""() => {
      const ws = JSON.parse(localStorage.getItem('toeic-cards:words'));
      ws.find((w) => w.word === 'approve').zh = 'v. 在 B 改過'; ws.find((w) => w.word === 'approve').updatedAt = 999;
      ws.unshift({ ...ws[0], id: 'id-submit', word: 'submit', zh: 'v. 提交', updatedAt: 500 });
      localStorage.setItem('toeic-cards:words', JSON.stringify(ws));
      const log = JSON.parse(localStorage.getItem('toeic-cards:log'));
      log['2026-10-14'].reviews = 20;
      localStorage.setItem('toeic-cards:log', JSON.stringify(log));
    }""")
    b.goto(URL + '#/settings')
    b.reload()
    b.wait_for_load_state('networkidle')
    import_file(b, path)
    check('新增 0 個字' in b.locator('.import-preview').inner_text() and '4 個字保留目前的版本' in b.locator('.import-preview').inner_text().replace('\n', ''), '預覽：沒有新字、B 的版本比較新')
    b.click('#doMerge')
    b.wait_for_timeout(300)
    ws = {w['word']: w for w in store(b, 'words')}
    check(len(ws) == 5 and ws['approve']['zh'] == 'v. 在 B 改過' and 'submit' in ws, '合併：保留 B 新加的字和比較新的修改')
    log = store(b, 'log')
    check(log['2026-10-14']['reviews'] == 20 and log['2026-10-13']['reviews'] == 12, f"合併紀錄取較大值，不會重複加總 {log['2026-10-14']}")
    check('已合併' in b.locator('#toast').inner_text(), '合併後顯示結果')
    # 再合併一次：結果不變
    import_file(b, path)
    b.click('#doMerge')
    b.wait_for_timeout(300)
    check(len(store(b, 'words')) == 5 and store(b, 'log')['2026-10-14']['reviews'] == 20 and len(store(b, 'mistakes')) == 1, '同一份備份合併兩次，結果不變')

    # ======== 取消 ========
    import_file(b, path)
    b.click('#doCancel')
    check(b.locator('.import-preview').count() == 0 and len(store(b, 'words')) == 5, '取消不會改變資料')

    # ======== 壞掉／不對的檔案 ========
    bad = [('broken.json', '{"app": "toeic-cards", "data": ', 'JSON'),
           ('other.json', '{"hello": "world"}', '不是多益字卡'),
           ('empty.json', '', '空的')]
    for name, content, expect in bad:
        fp = os.path.join(TMP, name)
        open(fp, 'w', encoding='utf-8').write(content)
        import_file(b, fp)
        msg = b.locator('#importArea .ai-error').inner_text()
        check(expect in msg, f'{name}：{msg!r}')
    check(len(store(b, 'words')) == 5, '錯誤的檔案不會改變資料')

    # 被竄改的備份：含有 HTML 的字不會被執行
    evil = json.loads(raw)
    evil['data']['words'].append({**WORDS_A[0], 'id': 'evil', 'word': 'xss', 'zh': '<img src=x onerror="window.__pwned=1">'})
    fp = os.path.join(TMP, 'evil.json')
    open(fp, 'w', encoding='utf-8').write(json.dumps(evil))
    import_file(b, fp)
    b.click('#doMerge')
    b.goto(URL + '#/words')
    b.wait_for_timeout(300)
    check(b.evaluate('window.__pwned') is None and '<img' in b.locator('.word-row', has_text='xss').inner_text(), '備份裡的 HTML 只會當文字顯示')

    # ======== 手機版 ========
    m = ctxB.new_page()
    m.set_viewport_size({'width': 375, 'height': 812})
    m.goto(URL + '#/settings')
    m.wait_for_load_state('networkidle')
    sw = m.evaluate('document.documentElement.scrollWidth')
    check(sw <= 375, f'手機無橫向捲動 {sw}')

    browser.close()

print('\nERRORS:' if errors else '\nALL PASSED', *errors, sep='\n')
sys.exit(1 if errors else 0)
