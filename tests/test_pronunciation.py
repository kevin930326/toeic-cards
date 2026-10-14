"""發音：多益四種口音、多益混合、例句與搭配詞發音（端對端測試）"""
import json, os, sys
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'screenshots')
os.makedirs(OUT, exist_ok=True)
URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
errors = []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        errors.append(msg)

# 假的語音：有美式、英式、澳洲，沒有加拿大；記錄每次唸了什麼、用哪個口音和語音
FAKE_SPEECH = """
window.__spoken = [];
const FAKE_VOICES = [
  { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US' },
  { name: 'Microsoft David - English (United States)', lang: 'en-US' },
  { name: 'Google UK English Female', lang: 'en-GB' },
  { name: 'Microsoft Natasha Online (Natural) - English (Australia)', lang: 'en-AU' },
];
window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; this.lang = ''; this.voice = null; this.rate = 1; } };
if (window.speechSynthesis) {
  speechSynthesis.getVoices = () => FAKE_VOICES;
  speechSynthesis.cancel = () => {};
  speechSynthesis.speak = (u) => window.__spoken.push({ text: u.text, lang: u.lang, voice: u.voice ? u.voice.name : null });
}
"""

def word(i, w, zh):
    return {
        'id': w, 'word': w, 'phonetic': '', 'pos': 'v.', 'zh': f'v. {zh}', 'en': f'meaning {i}',
        'examples': [{'en': f'Please {w} the request today.', 'zh': '請今天處理。'}],
        'collocations': [f'{w} a plan', f'{w} a budget'], 'forms': [], 'synonyms': [],
        'unfamiliar': False, 'src': {}, 'lookup': {'dictAt': 1, 'enDone': True}, 'llm': {'status': 'done'},
        'srs': None, 'createdAt': i, 'updatedAt': i,
        'part5': [{'id': f'q{i}', 'sentence': 'The manager will _____ the budget next week.', 'answer': w,
                   'distractors': ['delay', 'cancel', 'review'], 'translation': '經理下週會處理預算。',
                   'explanation': '解析', 'at': 1, 'usedAt': 0}],
    }

WORDS = [word(i, w, zh) for i, (w, zh) in enumerate([
    ('approve', '核准'), ('negotiate', '協商'), ('postpone', '延期'), ('submit', '提交'), ('reimburse', '核銷')])]

def spoken(page):
    return page.evaluate('window.__spoken')

def set_accent(page, accent):
    page.evaluate("""(a) => {
      const s = JSON.parse(localStorage.getItem('toeic-cards:settings') || '{}');
      localStorage.setItem('toeic-cards:settings', JSON.stringify({ ...s, accent: a }));
    }""", accent)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1000, 'height': 900})
    ctx.add_init_script(FAKE_SPEECH)
    ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    page = ctx.new_page()
    page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append('console: ' + m.text))
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.goto(URL)
    page.evaluate("ws => { localStorage.clear(); localStorage.setItem('toeic-cards:words', JSON.stringify(ws)); localStorage.setItem('toeic-cards:gemini-key', 'k'); }", WORDS)

    # ---- 設定頁：口音選項與可用性 ----
    page.goto(URL + '#/settings')
    page.reload()
    page.wait_for_load_state('networkidle')
    labels = page.locator('input[name=accent] + span').all_inner_texts()
    check(labels == ['美式', '英式', '加拿大', '澳洲', '多益混合'], f'口音選項 {labels}')
    rows = page.locator('#accentList li')
    check(rows.count() == 4, '列出四種口音的可用狀態')
    us = rows.nth(0).inner_text()
    check('Aria Online (Natural)' in us, f'美式優先挑 Natural 語音：{us!r}')
    check('missing' in rows.nth(2).get_attribute('class') and '會用其他英文語音代替' in rows.nth(2).inner_text(), '沒有加拿大語音時清楚說明')
    page.screenshot(path=os.path.join(OUT, 'sp_settings.png'), full_page=True)
    rows.nth(3).locator('[data-try]').click()
    last = spoken(page)[-1]
    check(last['lang'] == 'en-AU' and 'Natasha' in last['voice'], f'試聽澳洲口音 {last}')
    rows.nth(2).locator('[data-try]').click()
    last = spoken(page)[-1]
    check(last['lang'] == 'en-CA' and last['voice'] is None, f'沒有加拿大語音：仍設定 en-CA、交給瀏覽器預設語音 {last}')
    page.click('.seg:has(input[name=accent][value=mixed])')
    check(json.loads(page.evaluate("localStorage.getItem('toeic-cards:settings')"))['accent'] == 'mixed', '「多益混合」設定會儲存')

    # ---- 多益混合：只會挑這台裝置有的口音，而且會換 ----
    langs = page.evaluate("""async () => {
      const { speak } = await import('/js/speech.js');
      const out = new Set();
      for (let i = 0; i < 60; i++) out.add(speak('test').lang);
      return [...out].sort();
    }""")
    check(langs == ['en-AU', 'en-GB', 'en-US'], f'多益混合只用有語音的口音，而且會輪換：{langs}')

    # ---- 卡片背面：例句、搭配詞發音 ----
    set_accent(page, 'en-US')
    page.goto(URL + '#/cards')
    page.reload()
    page.wait_for_load_state('networkidle')
    page.click('#card')
    page.wait_for_timeout(700)
    before = len(spoken(page))
    page.locator('.card-back .mini-speak').first.click()
    s = spoken(page)
    first_word = page.locator('.card-front .headword').inner_text()
    check(len(s) == before + 1 and s[-1]['text'] == f'Please {first_word} the request today.', f'例句發音：{s[-1]}')
    check('is-flipped' in page.get_attribute('#card', 'class'), '點例句發音不會翻回正面')
    page.locator('.card-back .chip-speak').nth(1).click()
    check(spoken(page)[-1]['text'] == f'{first_word} a budget', f"搭配詞發音：{spoken(page)[-1]['text']!r}")
    check('is-flipped' in page.get_attribute('#card', 'class'), '點搭配詞不會翻面')
    page.screenshot(path=os.path.join(OUT, 'sp_card.png'))
    # 鍵盤也能操作例句發音
    page.locator('.card-back .mini-speak').first.focus()
    page.keyboard.press('Enter')
    check(spoken(page)[-1]['text'].startswith('Please'), '例句發音按鈕可以用鍵盤觸發')

    # 複習頁也一樣
    page.goto(URL + '#/review')
    page.click('.card-front .headword')
    page.wait_for_timeout(700)
    page.locator('.card-back .chip-speak').first.click()
    check(spoken(page)[-1]['text'].endswith('a plan') and 'is-flipped' in page.get_attribute('#card', 'class'), '複習頁的搭配詞發音')

    # ---- 聽力測驗：每題一個口音、重聽同口音、作答後顯示口音 ----
    set_accent(page, 'mixed')
    page.goto(URL + '#/quiz')
    page.reload()
    page.wait_for_load_state('networkidle')
    seen = set()
    page.evaluate('window.__spoken = []')
    page.click('.mode-btn[data-mode=listen]')
    for i in range(5):
        page.wait_for_timeout(100)
        first = spoken(page)[-1]
        page.keyboard.press('p')
        again = spoken(page)[-1]
        check(first['lang'] == again['lang'], f'第 {i + 1} 題重聽用同一個口音（{first["lang"]}）') if i == 0 else None
        seen.add(first['lang'])
        page.keyboard.press('1')
        label = page.locator('.feedback .fb-explain').inner_text()
        expect = {'en-US': '美式', 'en-GB': '英式', 'en-AU': '澳洲', 'en-CA': '加拿大'}[first['lang']]
        if i == 0:
            check(f'這題是{expect}口音' in label, f'作答後顯示口音：{label!r}')
            page.screenshot(path=os.path.join(OUT, 'sp_listen.png'))
        page.keyboard.press('Enter')
    check(seen <= {'en-US', 'en-GB', 'en-AU'}, f'聽力題只用有語音的口音 {seen}')

    # ---- Part 5：朗讀整句（答案填進空格）----
    page.click('#home')   # 聽力測驗 5 題做完後在結果頁
    page.click('.mode-btn[data-mode=part5]')
    page.wait_for_selector('.q-sentence')
    page.keyboard.press('a')
    page.click('#readSentence')
    text = spoken(page)[-1]['text']
    check('_____' not in text and text.startswith('The manager will ') and text.endswith(' the budget next week.'), f'朗讀整句（空格填入答案）：{text!r}')

    browser.close()

print('\nERRORS:' if errors else '\nALL PASSED', *errors, sep='\n')
sys.exit(1 if errors else 0)
