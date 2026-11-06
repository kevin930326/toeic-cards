"""中文反查英文：輸入中文出現英文候選、點選查完整解釋、按查詢列出清單、收藏字卡優先、
簡體輸入、口語補充詞、部分符合、找不到時的 AI 備援（Gemini 以假回應代替）。"""
import json
import os
from playwright.sync_api import sync_playwright, expect
from onboarding_helpers import existing_user
from storage_helpers import flush
from shots import doc_shot

URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for name, options in [('mobile', dict(viewport={'width': 375, 'height': 860}, is_mobile=True, has_touch=True)),
                          ('desktop', dict(viewport={'width': 1280, 'height': 860}))]:
        context = browser.new_context(**options)
        existing_user(context)
        context.add_init_script('window.__toeicFirebaseConfig=null;')
        context.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, body=''))
        context.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
        ai_calls = []
        def gemini(route):
            ai_calls.append(route.request.post_data or '')
            words = {'words': [{'word': 'file taxes', 'pos': 'phrase', 'zh': '報稅'}, {'word': 'tax return', 'pos': 'n.', 'zh': '報稅單'}]}
            route.fulfill(status=200, content_type='application/json',
                          body=json.dumps({'candidates': [{'content': {'parts': [{'text': json.dumps(words)}]}, 'finishReason': 'STOP'}]}))
        context.route('https://generativelanguage.googleapis.com/**', gemini)
        page = context.new_page(); errors = []; requests = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda req: requests.append(req.url) if '/reverse-v1/' in req.url else None)
        page.goto(URL + '#/stats'); page.wait_for_load_state('networkidle')
        assert not requests, '開站不下載中文索引'

        page.click('#openLookup')
        expect(page.locator('#lookupInput')).to_have_attribute('placeholder', '英文或中文，例如 invoice、發票')
        page.fill('#lookupInput', '發票')
        option = page.locator('[role=option]').first
        expect(option).to_contain_text('invoice')
        expect(option).to_contain_text('發票')
        assert 1 <= len(requests) <= 3, requests  # s2t 對照（16 KB）＋發、票兩片
        if name == 'mobile':
            page.screenshot(path=doc_shot('57-reverse-lookup-mobile.png'))
        option.click()
        expect(page.locator('#lookupResult h3')).to_have_text('invoice')
        expect(page.locator('.lookup-meaning')).to_contain_text('發票')
        print(f'PASS[{name}] 發票 → invoice 候選，點選顯示完整解釋', flush=True)

        # 按「查詢」：結果區列出清單
        page.fill('#lookupInput', '會議')
        page.locator('#lookupForm button').click()
        items = page.locator('.lookup-reverse-item')
        expect(items.first).to_be_visible()
        words = page.locator('.lookup-reverse-item span[lang=en]').all_text_contents()
        assert 'meeting' in words and 'conference' in words, words
        if name == 'desktop':
            page.screenshot(path=doc_shot('57-reverse-lookup.png'))
        page.locator('.lookup-reverse-item', has_text='meeting').first.click()
        expect(page.locator('#lookupResult h3')).to_have_text('meeting')
        print(f'PASS[{name}] 會議 按查詢列出 meeting、conference，點選查詢', flush=True)

        # 鍵盤：上下鍵選候選、Enter 查詢（桌機）
        if name == 'desktop':
            page.fill('#lookupInput', '預算')
            expect(page.locator('[role=option]').first).to_contain_text('budget')
            page.press('#lookupInput', 'ArrowDown'); page.press('#lookupInput', 'Enter')
            expect(page.locator('#lookupResult h3')).to_have_text('budget')
            print('PASS[desktop] 上下鍵＋Enter 選中文候選', flush=True)

        # 收藏字卡用自己改的中文優先
        page.evaluate('''async()=>{const s=await import('/js/store.js');s.addWords(['zorbify'],{autoGenerate:false,
          initialData:new Map([['zorbify',{zh:'v. 整理報表',lookup:{dictAt:1,enDone:true}}]])});}''')
        flush(page)
        page.fill('#lookupInput', '整理報表')
        first = page.locator('[role=option]').first
        expect(first).to_contain_text('zorbify'); expect(first).to_contain_text('已收藏')
        print(f'PASS[{name}] 自己字卡的中文排最前面並標已收藏', flush=True)

        # 簡體輸入：自動轉繁體
        page.fill('#lookupInput', '会议')
        page.locator('#lookupForm button').click()
        expect(page.locator('.lookup-reverse')).to_contain_text('已把簡體「会议」轉成「會議」查詢')
        expect(page.locator('.lookup-reverse-item', has_text='meeting').first).to_be_visible()
        # 口語補充詞與片語
        page.fill('#lookupInput', '退房')
        expect(page.locator('[role=option]').first).to_contain_text('check out')
        page.fill('#lookupInput', '利率')
        expect(page.locator('[role=option]').first).to_contain_text('interest rate')
        print(f'PASS[{name}] 簡體會議、口語退房、片語利率都查得到', flush=True)

        # 部分符合
        page.fill('#lookupInput', '海關申報')
        page.locator('#lookupForm button').click()
        expect(page.locator('.lookup-reverse')).to_contain_text('以下是部分符合')
        expect(page.locator('.lookup-reverse-item em').first).to_have_text('部分符合')

        # 找不到、沒有金鑰：提示可設定金鑰，不呼叫 AI
        page.fill('#lookupInput', '鑫鑫鑫')
        expect(page.locator('#lookupSuggestionStatus')).to_contain_text('字典找不到符合的英文')
        page.locator('#lookupForm button').click()
        expect(page.locator('#lookupResult')).to_contain_text('字典找不到')
        expect(page.locator('#lookupResult')).to_contain_text('填入 Gemini 金鑰')
        assert not ai_calls
        print(f'PASS[{name}] 部分符合標示；找不到且沒金鑰時只提示', flush=True)

        # 有金鑰：按 AI 才送出，只送輸入的中文
        page.evaluate("localStorage.setItem('toeic-cards:gemini-key', 'test-key')")
        page.fill('#lookupInput', '報稅')
        page.locator('#lookupForm button').click()
        expect(page.locator('#lookupAiStatus')).to_contain_text('送到 Google Gemini')
        assert not ai_calls, '按下按鈕前不呼叫 AI'
        page.click('#lookupAi')
        expect(page.locator('.lookup-ai .lookup-reverse-item').first).to_contain_text('file taxes')
        expect(page.locator('.lookup-ai')).to_contain_text('AI 的建議可能有誤')
        assert len(ai_calls) == 1 and '報稅' in ai_calls[0]
        if name == 'mobile':
            page.screenshot(path=doc_shot('57-reverse-lookup-ai.png'))
        page.locator('.lookup-ai .lookup-reverse-item', has_text='tax return').click()
        expect(page.locator('#lookupResult h3')).to_have_text('tax return')
        page.evaluate("localStorage.removeItem('toeic-cards:gemini-key')")
        print(f'PASS[{name}] 有金鑰時按鈕才呼叫 AI 一次，點選建議改用字典查詢', flush=True)

        # 英文查字照舊
        page.fill('#lookupInput', 'a')
        expect(page.get_by_role('option', name='apple', exact=True)).to_be_visible()
        print(f'PASS[{name}] 找不到時提示，英文候選不受影響', flush=True)
        assert not errors, errors
        context.close()
    browser.close()
print('ALL PASS')
