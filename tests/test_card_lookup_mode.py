"""手機翻卡／查字模式分流；桌機與探索維持直接點字。"""
import json
import os
import re
from playwright.sync_api import sync_playwright, expect
from onboarding_helpers import existing_user
from shots import doc_shot

URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
WORDS = [dict(id=w, word=w, zh='測試中文', pos='n.', en='a document for a meeting',
              phonetic='', examples=[{'en':'The manager has a meeting.', 'zh':'經理有會議。'}],
              collocations=[], forms=[], synonyms=[], unfamiliar=False, src={},
              lookup={'dictAt':1,'enDone':True}, srs=None, createdAt=i+1, updatedAt=1)
         for i,w in enumerate(['invoice','budget'])]


def learning(page):
    return page.evaluate('''()=>({srs:JSON.parse(localStorage.getItem('toeic-cards:words')).filter(w=>['invoice','budget'].includes(w.word)).map(w=>[w.id,w.srs]),
      log:localStorage.getItem('toeic-cards:log'),settings:localStorage.getItem('toeic-cards:settings')})''')


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    errors, calls = [], []

    def setup(route, mobile=True, worker=False):
        c = browser.new_context(viewport={'width':375 if mobile else 1100,'height':950},
                               has_touch=mobile, is_mobile=mobile, service_workers='allow' if worker else 'block')
        existing_user(c)
        c.add_init_script('window.__toeicFirebaseConfig=null;window.spoken=[];speechSynthesis.speak=u=>spoken.push(u.text);')
        c.add_init_script("if(!localStorage.getItem('toeic-cards:words'))localStorage.setItem('toeic-cards:words',"+json.dumps(json.dumps(WORDS))+");")
        c.add_init_script("if(!localStorage.getItem('toeic-cards:settings'))localStorage.setItem('toeic-cards:settings',JSON.stringify({cardMode:'en'}));")
        c.route('https://fonts.googleapis.com/**', lambda r:r.fulfill(status=200,body=''))
        for host in ['api.dictionaryapi.dev','generativelanguage.googleapis.com']:
            c.route('https://'+host+'/**', lambda r:(calls.append(r.request.url),r.fulfill(status=404,body='{}')))
        page=c.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(URL+'#/'+route);page.wait_for_load_state('networkidle')
        return c,page

    for route in ['review','free']:
        c,page=setup(route)
        before=learning(page)
        toggle=page.locator('#cardLookupToggle')
        expect(toggle).to_have_attribute('aria-pressed','false')
        page.locator('.card-front .headword').tap()
        expect(page.locator('#card')).to_have_class(re.compile('is-flipped'))
        assert page.locator('[data-lookup-word]').count()==0
        page.locator('.back-en').tap()
        expect(page.locator('#card')).not_to_have_class(re.compile('is-flipped'))
        assert not page.locator('#lookupDialog').is_visible()
        print('PASS '+route+' 預設點英文翻面，不開查字')

        toggle.tap()
        expect(toggle).to_have_attribute('aria-pressed','true')
        expect(page.locator('#card')).to_have_class(re.compile('is-flipped'))
        page.locator('.card-back .card-corner').tap()
        expect(page.locator('#card')).to_have_class(re.compile('is-flipped'))
        page.locator('.mini-speak').tap()
        assert page.evaluate('spoken.includes("The manager has a meeting.")')
        for width in [320,375]:
            page.set_viewport_size({'width':width,'height':950})
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            assert toggle.bounding_box()['height']>=44
        page.screenshot(path=doc_shot(f'25-lookup-mode-{route}.png'),full_page=True,animations='disabled')
        page.emulate_media(color_scheme='dark')
        page.screenshot(path=doc_shot(f'25-lookup-mode-{route}-dark.png'),full_page=True,animations='disabled')
        print('PASS '+route+' 開啟後顯示背面，空白不翻面、例句發音與窄螢幕／深色正常')

        page.locator('.back-en [data-lookup-word=document]').tap()
        expect(page.locator('#lookupResult h3')).to_have_text('document')
        page.locator('#lookupSave').tap()
        expect(page.locator('#lookupSaveStatus')).to_contain_text('已加入')
        page.locator('#lookupDialog [data-close]').tap()
        expect(toggle).to_have_attribute('aria-pressed','true')
        expect(page.locator('#card')).to_have_class(re.compile('is-flipped'))
        assert learning(page)==before
        print('PASS '+route+' 查字收藏／背景重畫後保持開啟與翻面，學習資料不變')

        toggle.tap()
        expect(toggle).to_have_attribute('aria-pressed','false')
        page.locator('.back-en').tap()
        expect(page.locator('#card')).not_to_have_class(re.compile('is-flipped'))
        toggle.tap()
        page.locator('#good' if route=='review' else '#freeNext').tap()
        expect(page.locator('.card-front .headword')).to_have_text('budget')
        expect(toggle).to_have_attribute('aria-pressed','false')
        assert page.locator('[data-lookup-word]').count()==0
        print('PASS '+route+' 關閉後能點字翻面，換卡自動關閉查詢')

        # 同張卡切語言也重設；離開頁面與重新整理不保留模式。
        toggle.tap()
        page.locator('.seg:has(input[value=zh])').click()
        expect(toggle).to_have_attribute('aria-pressed','false')
        toggle.tap();page.reload();page.wait_for_load_state('networkidle')
        expect(toggle).to_have_attribute('aria-pressed','false')
        page.goto(URL+'#/cards')
        assert page.locator('#cardLookupToggle').count()==0
        page.locator('.explore-item[data-id=invoice]').tap()
        page.locator('.back-en [data-lookup-word=document]').tap()
        expect(page.locator('#lookupResult h3')).to_have_text('document')
        print('PASS '+route+' 切語言／重整重設，探索仍直接點字')
        c.close()

    c,page=setup('review',mobile=False)
    assert page.locator('#cardLookupToggle').count()==0
    page.locator('.card-front .headword').click()
    page.locator('.back-en [data-lookup-word=document]').click()
    expect(page.locator('#lookupDialog')).to_be_visible()
    print('PASS 桌機仍可直接點英文查字')
    c.close()

    c,page=setup('review',worker=True)
    page.evaluate('navigator.serviceWorker.ready')
    page.goto(URL+'#/free');page.reload();page.wait_for_load_state('networkidle')
    page.locator('#cardLookupToggle').tap()
    page.locator('.back-en [data-lookup-word=document]').tap()
    expect(page.locator('.lookup-meaning')).to_be_visible()
    page.locator('#lookupDialog [data-close]').tap()
    ready=False
    for _ in range(60):
        ready=page.evaluate('''async()=>{const c=await caches.open('toeic-shell-v1');
          const urls=performance.getEntriesByType('resource').map(e=>e.name).filter(u=>u.startsWith(location.origin)&&new URL(u).pathname.endsWith('.js'));
          return urls.some(u=>u.includes('card-lookup-mode.js')) && (await Promise.all(urls.map(u=>c.match(u)))).every(Boolean);}''')
        if ready: break
        page.wait_for_timeout(100)
    assert ready, '新版查字模式依賴需完成快取'
    c.set_offline(True);page.reload();page.wait_for_load_state('networkidle')
    expect(page.locator('#cardLookupToggle')).to_have_attribute('aria-pressed','false')
    page.locator('#cardLookupToggle').tap()
    page.locator('.back-en [data-lookup-word=document]').tap()
    expect(page.locator('#lookupResult h3')).to_have_text('document')
    expect(page.locator('.lookup-meaning')).to_be_visible()
    print('PASS 手機真正離線重新整理後仍可切換模式並查已快取中文字典')
    c.close();browser.close()
    assert not calls, calls
    assert not errors, errors
print('ALL PASSED')
