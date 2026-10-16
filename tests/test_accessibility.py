"""真實鍵盤操作、設定預設收合、正式標籤、隱藏卡面與焦點返回。不需新增依賴。"""
import os,re
from playwright.sync_api import sync_playwright,expect
from shots import doc_shot
URL=os.environ.get('BASE_URL','http://127.0.0.1:8123/')
def contrast(a,b):
    def lum(c):
        x=[int(c[i:i+2],16)/255 for i in [1,3,5]]
        x=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in x]
        return sum(v*k for v,k in zip(x,[.2126,.7152,.0722]))
    x,y=sorted([lum(a),lum(b)]);return (y+.05)/(x+.05)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True);ctx=browser.new_context(viewport={'width':393,'height':850})
    ctx.add_init_script("window.__toeicFirebaseConfig={apiKey:'unused-test'};localStorage.setItem('toeic-cards:onboarding',JSON.stringify({version:2,status:'skipped'}));")
    ctx.route('https://api.dictionaryapi.dev/**',lambda r:r.fulfill(status=404,body='{}'))
    pg=ctx.new_page();errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
    pg.goto(URL+'#/settings',wait_until='networkidle')
    assert pg.locator('details.settings-section').count()==7
    assert pg.locator('#syncPanelSection').get_attribute('open') is not None
    assert pg.locator('#aiPanelSection').get_attribute('open') is None
    assert pg.get_by_label('Email',exact=True).get_attribute('id')=='pwEmail'
    assert pg.get_by_label('密碼',exact=True).get_attribute('id')=='pwPassword'
    pg.locator('.link-login>summary').click();assert pg.get_by_label('接收登入連結的 Email').is_visible()
    pg.locator('.paste-link>summary').click();assert pg.get_by_label('登入連結',exact=True).is_visible()
    pg.locator('.link-login>summary').click()
    pg.evaluate('window.scrollTo(0,0)');pg.screenshot(path=doc_shot('45-settings-sections.png'),full_page=True)
    pg.get_by_role('navigation',name='設定區塊').get_by_role('button',name='AI',exact=True).click()
    expect(pg.locator('#aiPanelSection>summary')).to_be_focused()
    assert pg.locator('#aiPanelSection').get_attribute('open') is not None
    pg.keyboard.press('Enter')
    pg.wait_for_function("()=>JSON.parse(localStorage.getItem('toeic-cards:settingsSections')||'{}').aiPanel===false")
    pg.reload(wait_until='networkidle');assert pg.locator('#aiPanelSection').get_attribute('open') is None
    for theme in ['light','dark']:
        pair=pg.evaluate("""theme=>{document.documentElement.dataset.theme=theme;const s=getComputedStyle(document.documentElement);return [s.getPropertyValue('--ink-faint').trim(),s.getPropertyValue('--surface').trim()];}""",theme)
        assert contrast(*pair)>=4.5,(theme,pair,contrast(*pair))
    pg.evaluate("""async()=>{const s=await import('/js/store.js');s.addWords(['approve'],{autoGenerate:false,initialData:new Map([['approve',{zh:'核准',en:'to officially accept a request',lookup:{dictAt:1,enDone:true}}]])});s.updateSettings({cardMode:'en'});s.flushWords();}""")
    pg.set_viewport_size({'width':1000,'height':900})
    pg.goto(URL+'#/free');pg.locator('#card').wait_for()
    assert pg.locator('#card').get_attribute('role')=='group'
    assert pg.locator('.card-back').get_attribute('aria-hidden')=='true'
    assert pg.locator('#card').get_by_role('button',name=re.compile('查詢')).count()==0
    pg.locator('#card').focus();pg.keyboard.press('Space')
    assert pg.locator('.card-front').get_attribute('aria-hidden')=='true' and pg.locator('.card-front').evaluate('(e)=>e.inert')
    assert pg.locator('#card').get_by_role('button',name=re.compile('查詢')).count()>0
    pg.evaluate("document.querySelector('.card-front [data-speak]').focus()")
    assert not pg.locator('.card-front').evaluate('(e)=>e.contains(document.activeElement)')
    pg.locator('#card').get_by_role('button',name='翻回正面').click()
    assert pg.locator('.card-back').evaluate('(e)=>e.inert')
    pg.goto(URL+'#/words');pg.click('#toggleLibraryEdit');pg.locator('[data-act=edit]').click();pg.keyboard.press('Escape')
    expect(pg.locator('[data-act=edit]')).to_be_focused()
    pg.locator('[data-act=edit]').click();pg.fill('#editForm [name=zh]','核准；批准');pg.click('#editForm button[type=submit]')
    expect(pg.locator('[data-act=edit]')).to_be_focused()
    pg.locator('[data-act=delete]').click();pg.click('#cancelWordDeletion');expect(pg.locator('[data-act=delete]')).to_be_focused()
    pg.locator('[data-act=delete]').click();pg.click('#confirmWordDeletion');expect(pg.locator('#openAddWords')).to_be_focused()
    pg.set_viewport_size({'width':393,'height':850})
    assert pg.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors,errors
    ctx.close();browser.close()
print('PASS 七組設定與鍵盤／持久化、正式標籤、文字對比、卡面 aria/inert、編輯與刪除焦點返回')
