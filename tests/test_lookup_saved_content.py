"""點字收藏的字：英文版翻卡不能整張空白。
1. 免費英文字典查不到 → 英文版背面先顯示中文意思並註明「還沒有英文解釋」。
2. 免費英文字典查得到 → 收藏後自動在背景補上英文解釋（不必先按「查英文」）。"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from onboarding_helpers import existing_user
from storage_helpers import flush

URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
WORD = "JSON.parse(localStorage.getItem('toeic-cards:words')||'[]').find(w=>w.word==='substance')"
FREEDICT = [{'word': 'substance', 'phonetic': '/ˈsʌbstəns/', 'meanings': [
    {'partOfSpeech': 'noun', 'definitions': [{'definition': 'A particular kind of matter with uniform properties.'}]}]}]


def run(browser, english_found):
    context = browser.new_context(viewport={'width': 1100, 'height': 900}, service_workers='block')
    existing_user(context)
    context.add_init_script('window.__toeicFirebaseConfig=null;')
    context.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, body=''))
    calls = []

    def freedict(route):
        calls.append(route.request.url)
        if english_found and route.request.url.endswith('/substance'):
            route.fulfill(status=200, content_type='application/json', body=json.dumps(FREEDICT))
        else:
            route.fulfill(status=404, content_type='application/json', body='{}')
    context.route('https://api.dictionaryapi.dev/**', freedict)
    page = context.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL + '#/stats'); page.wait_for_load_state('networkidle')
    page.evaluate('''async()=>{const s=await import('/js/store.js');
      s.addWords(['goods'],{autoGenerate:false,initialData:new Map([['goods',{pos:'n.',zh:'商品',
        en:'things made from a substance and sold',src:{pos:'user',zh:'user',en:'user'},lookup:{dictAt:1,enDone:true}}]])});
      s.updateSettings({cardMode:'en'});}''')
    flush(page)
    page.goto(URL + '#/free'); page.wait_for_load_state('networkidle')
    page.locator('#card .card-front .card-flip').click()
    page.locator('.back-en [data-lookup-word=substance]').click()
    expect(page.locator('#lookupResult h3')).to_have_text('substance')
    page.click('#lookupSave')
    expect(page.locator('#lookupSaveStatus')).to_contain_text('已加入')
    page.click('[aria-label="關閉查單字"]')
    for _ in range(50):
        flush(page)
        w = page.evaluate(WORD)
        if w and w['lookup'].get('enDone'):
            break
        page.wait_for_timeout(100)
    w = page.evaluate(WORD)
    assert w['zh'], w
    assert any(u.endswith('/substance') for u in calls), '收藏後應在背景查英文解釋'

    # 翻到 substance 這張卡，英文版翻面
    for _ in range(3):
        if page.locator('.card-front .headword').inner_text().strip() == 'substance':
            break
        page.click('#freeNext')
    page.locator('#card .card-front .card-flip').click()
    back = page.locator('#card .card-back')
    expect(back).not_to_contain_text('還沒有資料')
    if english_found:
        expect(back.locator('.back-en')).to_contain_text('matter with uniform properties')
        print('PASS 查得到英文：收藏後自動補上英文解釋，英文版背面有內容', flush=True)
    else:
        expect(back.locator('.back-fallback')).to_contain_text('還沒有英文解釋')
        expect(back.locator('.back-zh')).to_contain_text(w['zh'].split('；')[0].split(' ')[-1])
        page.locator('#card').screenshot(path=str(Path(__file__).parent / 'screenshots' / 'lookup-saved-fallback.png'))
        print('PASS 查不到英文：英文版背面先顯示中文意思並註明', flush=True)
    assert not errors, errors
    context.close()


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    run(browser, english_found=False)
    run(browser, english_found=True)
    browser.close()
print('ALL PASS')
