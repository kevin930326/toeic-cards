"""第 32 步：詞性變化題（內建題庫＋Gemini 補充）

- 單字包的字：沒有金鑰也能考，題目來自內建題庫；作答、錯題本、不熟標記、每日紀錄都和其他題型一樣
- 自己加的字：沒有金鑰時略過並說明；有金鑰時用 Gemini 出題並存起來，下次直接用存的題目
- AI 混進別的字（不是同字族）的題目會被丟掉
- 句子題的畫面（A–D、鍵盤、朗讀整句、翻譯與解析）

用法（先在專案根目錄執行 python -m http.server 8123 --bind 127.0.0.1）：
  python tests/test_forms_quiz.py
"""
import io
import json
import os
import sys
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

from onboarding_helpers import existing_user
from shots import doc_shot

URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
ROOT = Path(__file__).resolve().parent.parent
BANK = json.loads((ROOT / 'data/packs/toeic-1000-forms.json').read_text(encoding='utf-8'))
ANSWER_BY_SENTENCE = {q['sentence']: q['answer'] for q in BANK['questions']}
errors = []
gemini_calls = []
mode = {'bad': False}


def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        errors.append(msg)


def gemini(route):
    req = route.request
    if req.method == 'GET':
        body = {'models': [{'name': 'models/gemini-2.5-flash', 'supportedGenerationMethods': ['generateContent']}]}
        return route.fulfill(status=200, content_type='application/json', body=json.dumps(body))
    prompt = json.loads(req.post_data)['contents'][0]['parts'][0]['text']
    gemini_calls.append(prompt)
    targets = [line.split('. ', 1)[1] for line in prompt.split('Targets:')[1].strip().splitlines()]
    qs = []
    for t in targets:
        if t == 'negotiate':
            qs.append({'target': t, 'sentence': 'Both companies agreed to _____ a new contract next month.',
                       'answer': 'negotiate',
                       'distractors': ['reject', 'negotiation', 'negotiable'] if mode['bad'] else ['negotiation', 'negotiable', 'negotiated'],
                       'translation': '兩家公司同意下個月協商新合約。', 'explanation': 'agreed to 後面接原形動詞。'})
        elif t == 'procure':
            qs.append({'target': t, 'sentence': 'The _____ of new laptops took three weeks.', 'answer': 'procurement',
                       'distractors': ['procure', 'procured', 'procuring'],
                       'translation': '採購新筆電花了三週。', 'explanation': '冠詞 The 後面、of 前面要用名詞。'})
    text = json.dumps({'questions': qs})
    route.fulfill(status=200, content_type='application/json',
                  body=json.dumps({'candidates': [{'content': {'parts': [{'text': text}]}, 'finishReason': 'STOP'}]}))


def badge_offset(pg, sel):
    """徽章框的中心，和旁邊文字筆畫中心的差距（px，負數＝徽章偏上）。用 3 倍解析度截圖找出有筆畫的列"""
    bb = pg.locator(sel).first.bounding_box()
    tb = pg.evaluate("""(sel) => { const b = document.querySelector(sel);
      let n = b.nextSibling; while (n && !(n.nodeType === 3 && n.textContent.trim())) n = n.nextSibling;
      if (!n) { n = b.previousSibling; while (n && !(n.nodeType === 3 && n.textContent.trim())) n = n.previousSibling; }
      const r = document.createRange(); r.selectNodeContents(n);
      const t = [...r.getClientRects()].find((x) => x.height); return { x: t.x, y: t.y, width: Math.min(t.width, 120), height: t.height }; }""", sel)
    top = min(bb['y'], tb['y']) - 4
    bottom = max(bb['y'] + bb['height'], tb['y'] + tb['height']) + 4
    img = Image.open(io.BytesIO(pg.screenshot(clip={'x': tb['x'], 'y': top, 'width': tb['width'], 'height': bottom - top}))).convert('L')
    px, (w, h) = img.load(), img.size
    rows = [y for y in range(h) if any(abs(px[x, y] - px[0, 0]) > 60 for x in range(w))]
    scale = h / (bottom - top)
    return round(bb['y'] + bb['height'] / 2 - (top + (rows[0] + rows[-1]) / 2 / scale), 2)


def store(pg, expr):
    return pg.evaluate(f"import('/js/store.js').then((s) => {{ {expr} }})")


def add_pack_group(pg):
    pg.goto(URL + '#/words')
    pg.wait_for_load_state('networkidle')
    pg.click('#openAddWords')
    pg.click('[data-tool=pack]')
    pg.wait_for_selector('#packGroup')
    pg.fill('#packName', '多益 1000')
    pg.click('#packAdd')
    pg.wait_for_function("() => JSON.parse(localStorage.getItem('toeic-cards:words') || '[]').length >= 100", timeout=15000)
    pg.click('[aria-label="關閉加入單字"]')


def start_forms(pg):
    pg.goto(URL + '#/quiz')
    pg.wait_for_selector('.mode-btn[data-mode=forms]')
    pg.click('.mode-btn[data-mode=forms]')


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1000, 'height': 900}, device_scale_factor=3)   # 3 倍解析度：量標示位置用
    existing_user(ctx)
    ctx.add_init_script("window.__spoken = []; if (window.speechSynthesis) speechSynthesis.speak = (u) => window.__spoken.push(u.text);")
    ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    ctx.route('https://generativelanguage.googleapis.com/**', gemini)
    pg = ctx.new_page()

    # ---- 沒有字時：模式停用 ----
    pg.goto(URL + '#/quiz')
    pg.wait_for_selector('.mode-btn[data-mode=forms]')
    check(pg.locator('.mode-btn[data-mode=forms]').is_disabled(), '沒有字時，詞性變化不能開始')

    # ---- 單字包的字：沒有金鑰也能考 ----
    add_pack_group(pg)
    pg.goto(URL + '#/quiz')
    pg.wait_for_selector('.mode-btn[data-mode=forms]')
    check(pg.locator('.mode-btn[data-mode=forms]').is_enabled(), '有單字包的字，沒有金鑰也能考詞性變化')
    check('詞性變化' in pg.locator('.mode-card[data-mode=forms]').inner_text(), '測驗首頁有「詞性變化」')
    # AI 標示的規則（js/ai-badge.js）：一定要金鑰＝AI、部分用 AI＝部分 AI、不用 AI 不標
    badges = {m: pg.locator(f'.mode-card[data-mode={m}] .mode-title .badge').all_inner_texts()
              for m in ['zh2en', 'en2word', 'listen', 'part5', 'forms']}
    badges = {m: [t.split('：')[0].strip() for t in v] for m, v in badges.items()}
    check(badges == {'zh2en': [], 'en2word': [], 'listen': [], 'part5': ['AI'], 'forms': ['部分 AI']},
          f'測驗模式的 AI 標示一致：{badges}')
    check('AI' in pg.locator('.reading-entry .badge').inner_text() and pg.locator('.ai-legend').count() == 1,
          '短文閱讀也標 AI，首頁有標示說明')
    # AI 標示和旁邊文字看起來置中（使用者回報過偏上／偏下）：量「實際畫出來的筆畫」，不是行框
    offsets = [badge_offset(pg, sel) for sel in ['.ai-legend .badge', '.mode-card[data-mode=part5] .mode-title .badge',
                                                 '.mode-card[data-mode=forms] .mode-title .badge', '.reading-entry .badge']]
    check(max(abs(o) for o in offsets) <= 0.6, f'AI 標示和旁邊的文字垂直置中（差距 {offsets} px）')
    start_forms(pg)
    pg.wait_for_selector('.q-forms .q-sentence')
    total = int(pg.locator('.quiz-progress').inner_text().split('/')[1])
    check(total == 10 and gemini_calls == [], f'出 10 題，全部來自內建題庫、沒有呼叫 Gemini（{total} 題）')
    sentence = pg.locator('.q-sentence').inner_text().replace('_______', '_____')
    answer = ANSWER_BY_SENTENCE.get(sentence)
    check(answer is not None, f'題目是內建題庫的句子：{sentence}')
    opts = pg.locator('.option .option-text').all_inner_texts()
    check(len(opts) == 4 and answer in opts and pg.locator('.option-key').first.inner_text() == '(A)', f'四個選項、A–D 標示、包含答案：{opts}')
    pg.screenshot(path=doc_shot('32-forms-question.png'))

    # 答錯：標記不熟、進錯題本、計入每日紀錄
    wrong = next(i for i, o in enumerate(opts) if o != answer)
    pg.keyboard.press('abcd'[wrong])
    pg.wait_for_selector('.feedback.bad')
    fb = pg.locator('.feedback').inner_text()
    check(f'正確答案是「{answer}」' in fb and '已標記為「不熟」' in fb, '鍵盤 A–D 作答；答錯顯示正確答案')
    check(pg.locator('.fb-trans').count() == 1 and pg.locator('.fb-explain').count() == 1, '顯示中文翻譯與解析')
    pg.click('#readSentence')
    spoken = pg.evaluate('window.__spoken')
    check(spoken and '_____' not in spoken[-1] and answer in spoken[-1], f'朗讀整句時把答案填回句子：{spoken[-1] if spoken else None}')
    pg.screenshot(path=doc_shot('32-forms-feedback.png'))
    mistakes = json.loads(pg.evaluate("localStorage.getItem('toeic-cards:mistakes')") or '[]')
    check(any(m['question']['mode'] == 'forms' for m in mistakes), '答錯的詞性變化題進入錯題本')
    log = json.loads(pg.evaluate("localStorage.getItem('toeic-cards:log')") or '{}')
    check(sum(d.get('quiz', 0) for d in log.values()) == 1, '作答計入每日測驗量')

    # 答完全部
    for _ in range(total - 1):
        pg.keyboard.press('Enter')
        pg.wait_for_selector('.option:not([disabled])')
        s2 = pg.locator('.q-sentence').inner_text().replace('_______', '_____')
        opts2 = pg.locator('.option .option-text').all_inner_texts()
        pg.locator('.option').nth(opts2.index(ANSWER_BY_SENTENCE[s2])).click()
    pg.keyboard.press('Enter')
    pg.wait_for_selector('.result-state')
    check(f'{total - 1}' in pg.locator('.score').inner_text() and '詞性變化' in pg.locator('.result-state').inner_text(),
          f'結果頁：{pg.locator(".score").inner_text()}')

    # 錯題本重做
    pg.click('#home')
    pg.click('#openMistakes')
    check('詞性變化' in pg.locator('.mistake-list').inner_text(), '錯題本顯示詞性變化題型')
    pg.click('#redoAll')
    pg.wait_for_selector('.q-forms .q-sentence')
    check(pg.locator('.option').count() == 4, '錯題本可以重做詞性變化題')

    # ---- 自己加的字：沒有金鑰 → 停用並說明 ----
    store(pg, "s.addWords(['negotiate', 'procure'], { autoGenerate: false }); return true;")
    pg.evaluate("""() => { const s = JSON.parse(localStorage.getItem('toeic-cards:settings') || '{}');
      localStorage.setItem('toeic-cards:settings', JSON.stringify({ ...s, quizScope: 'all', activeSetId: 'unfiled' })); }""")
    pg.goto(URL + '#/quiz')
    pg.reload()
    pg.wait_for_selector('.mode-card[data-mode=forms]')
    reason = pg.locator('.mode-card[data-mode=forms] .mode-reason').inner_text()
    check(pg.locator('.mode-btn[data-mode=forms]').is_disabled() and 'Gemini 金鑰' in reason, f'範圍只有自己加的字、沒有金鑰：停用並說明（{reason}）')

    # ---- 有金鑰：Gemini 出題並存起來 ----
    pg.evaluate("localStorage.setItem('toeic-cards:gemini-key', 'fake-key-for-forms-test')")
    pg.reload()
    start_forms(pg)
    pg.wait_for_selector('.q-forms .q-sentence')
    check(len(gemini_calls) == 1 and 'negotiate' in gemini_calls[0] and 'procure' in gemini_calls[0], '自己的字用一次 Gemini 請求出題')
    saved = store(pg, "return s.getWords().filter((w) => w.formQs?.length).map((w) => w.word).sort();")
    check(saved == ['negotiate', 'procure'], f'AI 出的題目存在字卡上：{saved}')
    check(pg.locator('.quiz-progress').inner_text().endswith('2'), '兩個字各出一題')
    pg.click('#quit')
    start_forms(pg)
    pg.wait_for_selector('.q-forms .q-sentence')
    check(len(gemini_calls) == 1, '再考一次直接用存的題目，不再呼叫 Gemini')

    # ---- AI 混進別的字：丟掉 ----
    pg.click('#quit')
    store(pg, "s.updateWords(s.getWords().map((w) => [w.id, { formQs: [] }])); return true;")
    mode['bad'] = True
    start_forms(pg)
    pg.wait_for_selector('.q-forms .q-sentence')
    saved = store(pg, "return s.getWords().filter((w) => w.formQs?.length).map((w) => w.word).sort();")
    check(saved == ['procure'] and pg.locator('.quiz-progress').inner_text().endswith('1'),
          f'選項混進別的字（reject）的題目被丟掉，只考合格的：{saved}')

    # ---- 手機版面 ----
    m = ctx.new_page()
    m.set_viewport_size({'width': 375, 'height': 812})
    m.goto(URL + '#/quiz')
    m.wait_for_selector('.mode-card[data-mode=forms]')
    check(m.evaluate('document.documentElement.scrollWidth <= innerWidth'), '手機 375px 沒有橫向捲動')

    ctx.close()

    # ---- 單字包裡沒有內建題目的字（company、passenger）：題庫載入後就知道不能考 ----
    ctx2 = browser.new_context(viewport={'width': 1000, 'height': 900})
    existing_user(ctx2)
    ctx2.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    pg2 = ctx2.new_page()
    add_pack_group(pg2)
    store(pg2, "for (const w of s.getWords()) if (!['company', 'passenger'].includes(w.word)) s.deleteWord(w.id); return true;")
    pg2.goto(URL + '#/quiz')
    pg2.wait_for_selector('.mode-card[data-mode=forms] .mode-reason', timeout=10000)
    check(pg2.locator('.mode-btn[data-mode=forms]').is_disabled(),
          '題庫載入後，範圍裡的字都沒有內建題目、也沒有金鑰：停用')
    ctx2.close()
    browser.close()

print()
print('ALL PASSED' if not errors else f'{len(errors)} FAILED')
sys.exit(1 if errors else 0)
