"""也譯作：單字包字卡背面顯示其他常見譯法、一鍵加上自己背的譯法（不翻面、會存成使用者修改）、
單字探索也看得到、AI 生成時附上其他譯法（Gemini 以假回應代替）。"""
import json
import os
from playwright.sync_api import sync_playwright, expect
from onboarding_helpers import existing_user
from storage_helpers import flush
from shots import doc_shot

URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
WORDS = "JSON.parse(localStorage.getItem('toeic-cards:words')||'[]')"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for name, options in [('mobile', dict(viewport={'width': 375, 'height': 860}, is_mobile=True, has_touch=True)),
                          ('desktop', dict(viewport={'width': 1280, 'height': 860}))]:
        context = browser.new_context(**options)
        existing_user(context)
        context.add_init_script('window.__toeicFirebaseConfig=null;')
        context.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, body=''))
        context.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
        prompts = []
        def gemini(route):
            prompts.append(route.request.post_data or '')
            words = {'words': [{'word': 'tenant', 'pos': 'n.', 'zh': 'n. 租戶', 'en': 'a person who rents a place',
                                'examples': [{'en': 'The tenant paid rent.', 'zh': '租戶付了租金。'}],
                                'collocations': ['new tenant'], 'forms': [], 'synonyms': ['renter'],
                                'zhAlt': ['房客', '承租人', '租戶']}]}
            route.fulfill(status=200, content_type='application/json',
                          body=json.dumps({'candidates': [{'content': {'parts': [{'text': json.dumps(words)}]}, 'finishReason': 'STOP'}]}))
        context.route('https://generativelanguage.googleapis.com/**', gemini)
        page = context.new_page(); errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(URL + '#/stats'); page.wait_for_load_state('networkidle')
        page.evaluate('''async()=>{const s=await import('/js/store.js');s.addWords(['prospective'],{autoGenerate:false,
          initialData:new Map([['prospective',{pos:'adj.',zh:'潛在的；未來可能的',en:'likely to become something',
            src:{pos:'pack',zh:'pack',en:'pack'},pack:{id:'toeic-1000',version:1},lookup:{dictAt:1,enDone:true}}]])});}''')
        flush(page)

        # 自由翻卡：翻面後看到「也譯作」
        page.goto(URL + '#/free'); page.wait_for_load_state('networkidle')
        page.locator('#card .card-front .card-flip').click()
        expect(page.locator('#card.is-flipped')).to_have_count(1)
        alt = page.locator('#card .back-alt')
        expect(alt).to_contain_text('也譯作')
        expect(alt).to_contain_text('預期的；將來的')
        if name == 'mobile':
            page.locator('#card').scroll_into_view_if_needed(); page.wait_for_timeout(800)
            page.locator('#card').screenshot(path=doc_shot('58-alt-meanings.png'))
        print(f'PASS[{name}] prospective 背面顯示 也譯作：預期的；將來的', flush=True)

        # 一鍵加上我背的譯法：不翻面、存成使用者修改
        page.locator('#card .back-alt-add').click()
        dialog = page.locator('.alt-dialog')
        expect(dialog).to_be_visible()
        assert 'is-flipped' in page.locator('#card').get_attribute('class'), '按鈕不應翻回正面'
        page.fill('#altInput', '有希望的')
        dialog.get_by_role('button', name='儲存').click()
        expect(dialog).to_have_count(0)
        flush(page)
        card = page.evaluate(f"{WORDS}.find(w=>w.word==='prospective')")
        assert card['zh'] == '潛在的；未來可能的\n也譯作：預期的；將來的；有希望的', card['zh']
        assert card['src']['zh'] == 'user'
        expect(page.locator('#card .back-alt')).to_contain_text('有希望的')
        print(f'PASS[{name}] 加上「有希望的」：保留整理表譯法、標記為使用者修改、卡片不翻面', flush=True)

        # 單字探索也看得到
        page.goto(URL + '#/cards'); page.wait_for_load_state('networkidle')
        expect(page.locator('.explore-reading .back-alt')).to_contain_text('預期的；將來的；有希望的')
        # 列表第一行仍是主要意思
        expect(page.locator('.explore-item-meaning').first).to_have_text('潛在的；未來可能的')

        # AI 生成：附上其他譯法，和主要意思重複的（租戶）不列
        page.evaluate("localStorage.setItem('toeic-cards:gemini-key', 'test-key')")
        page.evaluate('''async()=>{const s=await import('/js/store.js');const g=await import('/js/generate.js');
          const w=s.addWords(['tenant'],{autoGenerate:false}).added[0];g.enqueueGenerate([w.id]);}''')
        # 網站有 CSP，不能用 wait_for_function 的字串；改用輪詢
        for _ in range(100):
            flush(page)
            if page.evaluate(f"{WORDS}.find(w=>w.word==='tenant')?.llm?.status") == 'done':
                break
            page.wait_for_timeout(200)
        flush(page)
        tenant = page.evaluate(f"{WORDS}.find(w=>w.word==='tenant')")
        assert tenant['zh'] == 'n. 租戶\n也譯作：房客；承租人', tenant['zh']
        assert 'zhAlt' in prompts[0] and '預期的' in prompts[0]
        print(f'PASS[{name}] AI 生成附上 也譯作：房客；承租人（重複的租戶拿掉）', flush=True)
        assert not errors, errors
        context.close()
    browser.close()
print('ALL PASS')
