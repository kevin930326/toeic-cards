"""滑卡與頁面手勢分工；不代表已模擬 iPhone 系統返回動畫。"""
import json
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from onboarding_helpers import existing_user

URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
WORDS = [dict(id=w, word=w, zh='發票' if w == 'invoice' else '預算', pos='n.',
              en='a document for a meeting', phonetic='', examples=[], collocations=[],
              forms=[], synonyms=[], unfamiliar=False, src={},
              lookup={'dictAt': 1, 'enDone': True}, srs=None, createdAt=i+1, updatedAt=1)
         for i, w in enumerate(['invoice', 'budget'])]


def snapshot(page):
    return page.evaluate("[localStorage.getItem('toeic-cards:words'), localStorage.getItem('toeic-cards:log')]")


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True,
                                  is_mobile=True, service_workers='block')
    existing_user(context)
    context.add_init_script('''window.__toeicFirebaseConfig=null; window.spoken=[];
      speechSynthesis.speak=u=>window.spoken.push(u.text);
      localStorage.setItem('toeic-cards:settings',JSON.stringify({cardMode:'en'}));''')
    context.add_init_script("localStorage.setItem('toeic-cards:words'," + json.dumps(json.dumps(WORDS)) + ");")
    context.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, body=''))
    context.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL+'#/review')
    page.wait_for_load_state('networkidle')
    expect(page.locator('#swipe')).to_be_visible()
    expect(page.locator('.swipe-tip')).to_be_visible()
    for width in [320, 375, 390]:
        page.set_viewport_size({'width':width,'height':844})
        expect(page.locator('.swipe-tip')).to_be_visible()
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(Path('docs/images/24-swipe-isolation.png')), full_page=True)
    print('PASS 320／375／390px 手勢提示無橫向溢出')
    cdp = context.new_cdp_session(page)

    def start():
        box = page.locator('#swipe').bounding_box()
        x, y = box['x']+box['width']/2, box['y']+90
        cdp.send('Input.dispatchTouchEvent', {'type':'touchStart', 'touchPoints':[{'x':x,'y':y}]})
        return x, y

    def move(x, y):
        cdp.send('Input.dispatchTouchEvent', {'type':'touchMove', 'touchPoints':[{'x':x,'y':y}]})

    def unchanged(before):
        page.wait_for_timeout(350)
        assert snapshot(page) == before, '取消手勢不得寫入字卡或紀錄'
        assert page.locator('#swipe').evaluate("el=>!el.classList.contains('is-dragging') && !el.classList.contains('is-flying') && !el.style.transform")

    before = snapshot(page)
    # 合成邊緣起點，驗證卡片政策；此處無法產生 iOS 系統導覽手勢。
    for x in [2, 388]:
        page.locator('#swipe').evaluate('''(el,x)=>{
          for(const [type,px] of [['pointerdown',x],['pointermove',195],['pointerup',195]])
            el.dispatchEvent(new PointerEvent(type,{pointerType:'touch',pointerId:99,isPrimary:true,
              clientX:px,clientY:200,bubbles:true,cancelable:true}));
        }''', x)
        unchanged(before)
    print('PASS 左右邊緣起始不拖卡、不評分')

    page.evaluate("window.moves=[];document.addEventListener('touchmove',e=>moves.push(e.defaultPrevented));")
    x,y = start(); move(x+65,y)
    assert page.locator('#swipe').evaluate("el=>el.classList.contains('is-dragging')")
    assert page.evaluate('moves.some(Boolean)'), '卡片水平觸控應取消瀏覽器預設動作'
    cdp.send('Input.dispatchTouchEvent', {'type':'touchCancel','touchPoints':[]})
    unchanged(before)
    print('PASS 卡片內水平滑動取消預設動作；touchCancel 歸位且不評分')

    x,y = start(); move(x+60,y)
    cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':x+60,'y':y},{'x':x-50,'y':y+30}]})
    cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
    unchanged(before)
    print('PASS 第二根手指加入後停止拖卡、不評分')

    x,y = start(); move(x-65,y)
    page.evaluate("window.dispatchEvent(new Event('blur'))")
    cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
    unchanged(before)
    print('PASS 切出視窗時歸位、不評分')

    # 真正捲動，而不只檢查未評分。
    extra_height = page.add_style_tag(content='body { min-height: 2200px; }')
    page.evaluate('window.moves=[]')
    x,y = start(); move(x,y-40); move(x,y-100)
    cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
    page.wait_for_function('scrollY>0')
    assert not page.evaluate('moves.some(Boolean)')
    assert snapshot(page) == before
    print('PASS 從卡片上下滑動仍可捲動頁面、不評分')

    extra_height.evaluate('el=>el.remove()')
    page.evaluate('scrollTo(0,0)')
    page.wait_for_timeout(250)
    # 放手後的飛出動畫尚未結束就切頁，舊卡不可背景評分。
    x,y = start(); move(x-120,y)
    cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
    page.evaluate("location.hash='#/cards'")
    expect(page.locator('#exploreWord')).to_be_visible()
    page.wait_for_timeout(350)
    assert snapshot(page) == before
    print('PASS 飛出途中切頁不會背景評分')

    page.goto(URL+'#/review'); page.wait_for_load_state('networkidle')
    # 區域外的觸控不被卡片監聽器攔截。
    assert page.locator('h1').evaluate('''el=>{
      const t=new Touch({identifier:12,target:el,clientX:100,clientY:100});
      const e=new TouchEvent('touchmove',{touches:[t],bubbles:true,cancelable:true});
      el.dispatchEvent(e);return !e.defaultPrevented;
    }''')
    page.locator('.card-front .headword').tap()
    expect(page.locator('#card')).to_have_class(re.compile('is-flipped'))
    page.locator('#cardLookupToggle').tap()
    page.locator('[data-lookup-word="document"]').tap()
    expect(page.locator('#lookupDialog')).to_be_visible()
    page.locator('#lookupDialog [data-close]').tap()
    expect(page.locator('#card')).to_have_class(re.compile('is-flipped'))
    assert snapshot(page) == before
    print('PASS 點擊翻面與點字查詢保留；卡片外不攔觸控')

    page.locator('#cardLookupToggle').tap()
    page.locator('.card-back .card-corner').tap()
    page.locator('.card-front .speak-btn').tap()
    assert page.evaluate('spoken.length') > 0
    print('PASS 發音正常')
    assert not errors, errors
    browser.close()
print('ALL PASSED（iPhone Safari／主畫面 App 系統手勢仍需真機驗證）')
