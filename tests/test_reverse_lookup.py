"""中文反查英文：輸入中文出現英文候選、點選查完整解釋、按查詢列出清單、收藏字卡優先、找不到時提示。"""
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
        assert 1 <= len(requests) <= 2, requests
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

        # 找不到
        page.fill('#lookupInput', '鑫鑫鑫')
        expect(page.locator('#lookupSuggestionStatus')).to_contain_text('找不到符合的英文')
        page.locator('#lookupForm button').click()
        expect(page.locator('#lookupResult')).to_contain_text('找不到')

        # 英文查字照舊
        page.fill('#lookupInput', 'a')
        expect(page.get_by_role('option', name='apple', exact=True)).to_be_visible()
        print(f'PASS[{name}] 找不到時提示，英文候選不受影響', flush=True)
        assert not errors, errors
        context.close()
    browser.close()
print('ALL PASS')
