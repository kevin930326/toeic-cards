from onboarding_helpers import existing_user
from library_helpers import open_add, close_add, open_ai
"""AI 生成速度：降低思考（thinking）、不支援時自動改用其他設定、第一批先生成少量、失敗時用字典補、測試 AI 按鈕"""
import json, os, re, sys
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'screenshots')
os.makedirs(OUT, exist_ok=True)
URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
errors = []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        errors.append(msg)

calls = []          # 每次 generateContent：(模型, thinkingConfig, 字數)
mode = {'drop': set(), 'bad_key': False}

def gemini(route):
    req = route.request
    def err(code, msg, status='INVALID_ARGUMENT'):
        route.fulfill(status=code, content_type='application/json',
                      body=json.dumps({'error': {'code': code, 'message': msg, 'status': status}}))
    if mode['bad_key']:
        return err(400, 'API key not valid. Please pass a valid API key.')
    model = re.search(r'models/([^:]+):generateContent', req.url).group(1)
    body = json.loads(req.post_data)
    think = body['generationConfig'].get('thinkingConfig')
    prompt = body['contents'][0]['parts'][0]['text']
    words = re.findall(r'^\d+\. (.+)$', prompt.split('Words:')[1], re.M)
    calls.append((model, think, len(words)))
    # 模擬真實情況：有些模型不支援 minimal；有個模型完全不接受思考設定
    if model == 'gemini-3.5-flash' and think == {'thinkingLevel': 'minimal'}:
        return err(400, 'Thinking level MINIMAL is not supported for this model.')
    if model == 'gemini-nothink' and think is not None:
        return err(400, 'thinking_config is not supported for this model.')
    cards = [{'word': w, 'pos': 'v.', 'zh': f'v. {w}的意思', 'en': f'simple meaning of {w}', 'examples': [],
              'collocations': [], 'forms': [], 'synonyms': []} for w in words if w not in mode['drop']]
    route.fulfill(status=200, content_type='application/json', body=json.dumps({
        'candidates': [{'content': {'parts': [{'text': json.dumps({'words': cards})}]}, 'finishReason': 'STOP'}],
        'usageMetadata': {'candidatesTokenCount': 150 * len(words), 'thoughtsTokenCount': 0},
    }))

dict_calls = []
def free_dict(route):
    w = route.request.url.rstrip('/').split('/')[-1]
    dict_calls.append(w)
    route.fulfill(status=200, content_type='application/json', body=json.dumps(
        [{'word': w, 'meanings': [{'partOfSpeech': 'verb', 'definitions': [{'definition': f'dictionary meaning of {w}'}]}]}]))

def settings(page, **kw):
    page.evaluate("""(kw) => {
      const s = JSON.parse(localStorage.getItem('toeic-cards:settings') || '{}');
      localStorage.setItem('toeic-cards:settings', JSON.stringify({ ...s, ...kw }));
    }""", kw)

def words(page):
    return {w['word']: w for w in page.evaluate("JSON.parse(localStorage.getItem('toeic-cards:words') || '[]')")}

def open_ai_section(page):
    """設定頁分組後，「AI」預設收合；像使用者一樣點上方的「AI」按鈕打開"""
    page.wait_for_selector('.settings-nav')
    page.locator('.settings-nav button', has_text='AI').first.click()
    page.wait_for_selector('#testAi', state='visible')


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1000, 'height': 1000})
    existing_user(ctx)
    ctx.route('https://generativelanguage.googleapis.com/**', gemini)
    ctx.route('https://api.dictionaryapi.dev/**', free_dict)
    page = ctx.new_page()
    page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append('console: ' + m.text))
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.goto(URL)
    page.evaluate("localStorage.clear(); localStorage.setItem('toeic-cards:gemini-key', 'k')")
    settings(page, llmModel='gemini-3.5-flash', llmRpm=600)

    # ---- 測試 AI 按鈕；minimal 不支援 → 自動改用 low ----
    page.goto(URL + '#/settings')
    page.reload()
    page.wait_for_load_state('networkidle')
    open_ai_section(page)
    page.click('#testAi')
    page.wait_for_selector('#testAiResult .test-ok', timeout=10000)
    out = page.locator('#testAiResult').inner_text()
    check('3 個字花了' in out and '秒' in out, f'測試 AI 顯示花費時間：{out[:40]!r}')
    check('approve' in out and 'simple meaning of approve' in out, '測試 AI 顯示生成的內容（可以檢查品質）')
    check('思考設定 低' in out and '思考 0 tokens' in out, f'測試 AI 用白話顯示思考設定和 token 數：{out[:120]!r}')
    check([c[1] for c in calls] == [{'thinkingLevel': 'minimal'}, {'thinkingLevel': 'low'}], f'不支援 minimal → 自動改用 low：{[c[1] for c in calls]}')
    remembered = json.loads(page.evaluate("localStorage.getItem('toeic-cards:thinking')"))
    check(remembered == {'gemini-3.5-flash': 1}, f'記住這個模型可用的設定 {remembered}')
    check(len(words(page)) == 0, '測試 AI 不會存成單字')
    page.screenshot(path=os.path.join(OUT, 'ai_test.png'), full_page=True)

    # ---- 之後直接用記住的設定；第一批 5 個字 ----
    calls.clear()
    page.goto(URL + '#/words')
    open_add(page, 'batch')
    open_add(page, 'batch')
    page.fill('#batchInput', '\n'.join(f'word{chr(97 + i)}{chr(97 + j)}' for i in range(3) for j in range(4)))   # 12 個字
    open_add(page, 'batch')
    page.click('#batchAdd')
    close_add(page)
    page.wait_for_function("() => document.querySelector('#aiBox')?.textContent.includes('全部')", timeout=15000)
    check([c[1] for c in calls] == [{'thinkingLevel': 'low'}] * 2, f'直接用記住的 low，不再先試 minimal：{[c[1] for c in calls]}')
    check([c[2] for c in calls] == [5, 7], f'第一批先 5 個字，其餘一批：{[c[2] for c in calls]}')

    # ---- Gemini 2.5 用 thinkingBudget: 0 ----
    calls.clear()
    settings(page, llmModel='gemini-2.5-flash')
    page.reload()
    page.wait_for_load_state('networkidle')
    open_add(page, 'single')
    page.fill('#addInput', 'budget')
    open_add(page, 'single')
    page.press('#addInput', 'Enter')
    close_add(page)
    page.wait_for_function("() => JSON.parse(localStorage.getItem('toeic-cards:words')).find((w) => w.word === 'budget')?.llm?.status === 'done'", timeout=10000)
    check(calls[0][1] == {'thinkingBudget': 0}, f'Gemini 2.5 用 thinkingBudget 0：{calls[0][1]}')

    # ---- 完全不接受思考設定的模型：最後不帶思考設定 ----
    calls.clear()
    settings(page, llmModel='gemini-nothink')
    page.reload()
    page.wait_for_load_state('networkidle')
    open_add(page, 'single')
    page.fill('#addInput', 'fallback')
    open_add(page, 'single')
    page.press('#addInput', 'Enter')
    close_add(page)
    page.wait_for_function("() => JSON.parse(localStorage.getItem('toeic-cards:words')).find((w) => w.word === 'fallback')?.llm?.status === 'done'", timeout=10000)
    check([c[1] for c in calls] == [{'thinkingLevel': 'minimal'}, {'thinkingLevel': 'low'}, None], f'都不支援時改成不帶思考設定：{[c[1] for c in calls]}')

    # ---- 生成中顯示上次請求花多久 ----
    settings(page, llmModel='gemini-3.5-flash', llmRpm=6)   # 每 10 秒一次，方便看到「生成中」畫面
    page.reload()
    page.wait_for_load_state('networkidle')
    open_add(page, 'batch')
    open_add(page, 'batch')
    page.fill('#batchInput', '\n'.join(f'slow{chr(97 + i)}' for i in range(8)))
    open_add(page, 'batch')
    page.click('#batchAdd')
    close_add(page)
    page.wait_for_function("() => /上次請求 [\\d.]+ 秒・輸出 \\d+ tokens/.test(document.querySelector('#aiBox')?.textContent || '')", timeout=15000)
    check(True, 'AI 面板顯示上次請求花幾秒、輸出多少 tokens')
    page.screenshot(path=os.path.join(OUT, 'ai_progress.png'))
    page.click('#aiStop')
    settings(page, llmRpm=600)

    # ---- AI 漏掉的字：改用 Free Dictionary 補英文解釋 ----
    page.reload()
    page.wait_for_load_state('networkidle')
    dict_calls.clear()
    mode['drop'] = {'missingword'}
    open_add(page, 'single')
    page.fill('#addInput', 'missingword')
    open_add(page, 'single')
    page.press('#addInput', 'Enter')
    close_add(page)
    page.wait_for_function("() => JSON.parse(localStorage.getItem('toeic-cards:words')).find((w) => w.word === 'missingword')?.en", timeout=10000)
    w = words(page)['missingword']
    check(w['llm']['status'] == 'failed' and w['en'] == 'dictionary meaning of missingword' and w['src']['en'] == 'freedict',
          f"AI 失敗時用字典補英文解釋：{w['en']!r}")
    check(dict_calls == ['missingword'], f'只為失敗的字查字典 {dict_calls}')
    mode['drop'] = set()

    # ---- 測試 AI 失敗時顯示原因 ----
    mode['bad_key'] = True
    page.goto(URL + '#/settings')
    open_ai_section(page)
    page.click('#testAi')
    page.wait_for_selector('#testAiResult .ai-error', timeout=10000)
    check('金鑰' in page.locator('#testAiResult').inner_text(), '測試 AI 失敗時顯示原因')
    mode['bad_key'] = False

    browser.close()

print('\nERRORS:' if errors else '\nALL PASSED', *errors, sep='\n')
sys.exit(1 if errors else 0)
