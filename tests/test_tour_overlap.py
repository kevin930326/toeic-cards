"""額外視窗暫停導覽；手機空白複習與巨大目標上下排列、不遮住操作。"""
import os,re
from playwright.sync_api import sync_playwright,expect
from onboarding_helpers import existing_user
from shots import doc_shot
URL=os.environ.get('BASE_URL','http://127.0.0.1:8123/')
def frames(pg):pg.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
def advance(pg):
    old=pg.locator('#tourCount').inner_text();pg.click('#tourNext');expect(pg.locator('#tourCount')).not_to_have_text(old);frames(pg)
def separate(pg,a,b):
    return pg.evaluate("""([a,b])=>{const r=document.querySelector(a).getBoundingClientRect(),s=document.querySelector(b).getBoundingClientRect();return r.bottom<=s.top+1||s.bottom<=r.top+1||r.right<=s.left+1||s.right<=r.left+1;}""",[a,b])
with sync_playwright() as p:
    b=p.chromium.launch(headless=True)
    for width in [1100,393,320]:
        c=b.new_context(viewport={'width':width,'height':740},has_touch=width<600,is_mobile=width<600,service_workers='block',color_scheme='dark' if width==393 else 'light')
        existing_user(c);c.add_init_script('window.__toeicFirebaseConfig=null;')
        c.route('https://fonts.googleapis.com/**',lambda r:r.fulfill(status=200,body=''))
        for host in ['api.dictionaryapi.dev','generativelanguage.googleapis.com']:
            c.route('https://'+host+'/**',lambda r:r.fulfill(status=404,body='{}'))
        pg=c.new_page();errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
        pg.goto(URL+'#/help');pg.wait_for_load_state('networkidle')
        pg.click('[data-tour=library]');expect(pg.locator('#guidedTour')).to_be_visible()
        # 略過未開啟的新增視窗，走到管理分類。
        for _ in range(8):advance(pg)
        expect(pg.locator('#tourTitle')).to_have_text('建立自己的單字本')
        count=pg.locator('#tourCount').inner_text()
        pg.click('#openManageSets');expect(pg.locator('#guidedTour')).to_have_class(re.compile('is-paused'))
        expect(pg.locator('.tour-pause')).to_be_visible();expect(pg.locator('.tour-tip')).not_to_be_visible()
        assert separate(pg,'.tour-pause','#createSetForm')
        assert separate(pg,'.tour-pause','#manageSetsDialog [data-close]')
        # 暫停期間不能藉由程式 click 跳過到視窗後的步驟。
        pg.locator('#tourNext').evaluate('b=>b.click()');frames(pg)
        expect(pg.locator('#tourCount')).to_have_text(count)
        pg.fill('#newSetName','旅遊單字');pg.locator('#createSetForm button').click()
        expect(pg.locator('#setList')).to_contain_text('旅遊單字')
        expect(pg.locator('#tourCount')).to_have_text(count)
        if width==393:pg.screenshot(path=doc_shot('40-tour-paused-dialog.png'))
        pg.click('#manageSetsDialog [data-close]')
        expect(pg.locator('.tour-tip')).to_be_visible();expect(pg.locator('#guidedTour')).not_to_have_class(re.compile('is-paused'))
        advance(pg);expect(pg.locator('#tourTitle')).to_have_text('分類與內容分開整理')
        print(f'PASS {width}px 管理視窗以正常排版暫停教學，可建立分類、關閉後同一步恢復且不蓋住按鈕',flush=True)
        # 這一個步驟額外開點字查詢視窗，同樣不能持續講視窗外功能。
        pg.evaluate("document.dispatchEvent(new CustomEvent('toeic:lookup-word',{detail:{word:'invoice'}}))")
        expect(pg.locator('#guidedTour')).to_have_class(re.compile('is-paused'))
        pg.click('#lookupDialog [data-close]');expect(pg.locator('.tour-tip')).to_be_visible()
        pg.click('#tourExit')
        # review 主題的前兩步：沒有字卡時不畫整片備援光圈，更不蓋住新增按鈕。
        pg.goto(URL+'#/help');pg.click('[data-tour=review]');expect(pg.locator('#guidedTour')).to_be_visible();frames(pg)
        for index in range(2):
            if width<600:
                expect(pg.locator('#guidedTour')).to_have_class(re.compile('is-inline'))
                expect(pg.locator('.tour-ring')).not_to_be_visible()
                assert separate(pg,'.tour-tip','.done-state')
                assert separate(pg,'.tour-tip','.done-state a[href="#/words"]')
                assert pg.evaluate('document.documentElement.scrollWidth<=innerWidth')
                if width==393:
                    pg.evaluate("document.querySelector('#toast').classList.remove('show')")
                    pg.screenshot(path=doc_shot('40-tour-empty-review.png'))
            expect(pg.locator('#tourText')).to_contain_text('目前')
            if index==0:advance(pg)
        print(f'PASS {width}px 無字卡的翻面／評分說明符合狀態，手機教學與空白區不重疊',flush=True)
        # 下一個正常步驟必須恢復原本的按鈕導向與光圈。
        advance(pg);expect(pg.locator('#tourTitle')).to_have_text('隨時自由翻卡')
        pg.click('#reviewMenuToggle');expect(pg.locator('#tourTitle')).to_have_text('換到自由翻卡')
        pg.click('#reviewChoices a[href="#/free"]');expect(pg.locator('#tourTitle')).to_have_text('自由練習，不改複習排程')
        pg.click('#tourExit')
        assert not errors,errors;c.close()
    b.close()
print('ALL PASSED')
