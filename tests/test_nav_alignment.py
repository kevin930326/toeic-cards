"""有／無複習數字時，主導覽的文字垂直位置一致。"""
import os
from playwright.sync_api import sync_playwright, expect
from onboarding_helpers import existing_user
from shots import doc_shot

URL=os.environ.get('BASE_URL','http://127.0.0.1:8123/')
with sync_playwright() as p:
    b=p.chromium.launch(headless=True)
    c=b.new_context(service_workers='block')
    existing_user(c)
    c.add_init_script('window.__toeicFirebaseConfig=null;')
    c.route('https://fonts.googleapis.com/**',lambda r:r.fulfill(status=200,body=''))
    pg=c.new_page();pg.goto(URL);pg.wait_for_load_state('networkidle')
    for width in [1280,768,390,375,320]:
        pg.set_viewport_size({'width':width,'height':900})
        for badge in ['', '1','16','1000']:
            pg.locator('#reviewBadge').evaluate('(el,t)=>{el.hidden=!t;el.textContent=t;}',badge)
            centers=pg.evaluate('''()=>[document.querySelector('#reviewNav > a'),...document.querySelectorAll('.nav > a')].map(el=>{
              const r=document.createRange();r.selectNode(el.firstChild);const b=r.getBoundingClientRect();return b.y+b.height/2;
            })''')
            gap=max(centers)-min(centers)
            print(f'{width}px badge={badge or "hidden"}: text gap={gap:.2f}px',flush=True)
            assert gap<0.6, '複習與其他導覽文字應在同一高度'
            assert pg.evaluate('document.documentElement.scrollWidth<=innerWidth')
        pg.click('#reviewMenuToggle');expect(pg.locator('#reviewChoices')).to_be_visible()
        pg.keyboard.press('Escape');expect(pg.locator('#reviewMenuToggle')).to_be_focused()
    pg.set_viewport_size({'width':390,'height':900})
    pg.locator('#reviewBadge').evaluate("el=>{el.hidden=false;el.textContent='16';}")
    pg.locator('#reviewMenuToggle').evaluate('el=>el.blur()')
    pg.locator('.topbar').screenshot(path=doc_shot('28-nav-alignment.png'),animations='disabled')
    b.close()
print('ALL PASSED')
