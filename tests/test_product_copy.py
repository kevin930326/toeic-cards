"""介面可找到教材限制，語音與資料傳送說明一致。"""
import os
from playwright.sync_api import sync_playwright,expect
from onboarding_helpers import existing_user
from shots import doc_shot
URL=os.environ.get('BASE_URL','http://127.0.0.1:8123/')
with sync_playwright() as p:
    b=p.chromium.launch();c=b.new_context(viewport={'width':1000,'height':850},service_workers='block');existing_user(c)
    c.add_init_script('window.__toeicFirebaseConfig=null;')
    c.route('https://api.dictionaryapi.dev/**',lambda r:r.fulfill(status=404,body='{}'))
    pg=c.new_page();pg.goto(URL+'#/help',wait_until='networkidle')
    panel=pg.locator('.panel').filter(has=pg.get_by_role('heading',name='教材來源與學習限制'))
    expect(panel).to_contain_text('396 題待覆核停用');expect(panel).to_contain_text('不能證明實際記憶能力')
    assert panel.get_by_role('link').get_attribute('href').endswith('/docs/question-quality.md')
    panel.scroll_into_view_if_needed();pg.screenshot(path=doc_shot('47-materials-limits.png'))
    pg.goto(URL+'#/settings');expect(pg.locator('#aiPanel')).to_contain_text('選項、翻譯與閱讀練習文字')
    expect(pg.locator('#speechPanel')).to_contain_text('是否可離線播放依裝置')
    assert '不需網路' not in pg.locator('#speechPanel').inner_text()
    pg.evaluate("async()=>{(await import('/js/store.js')).addWords(['approve'],{autoGenerate:false})}")
    pg.goto(URL+'#/stats');expect(pg.locator('#view')).to_contain_text('不能作為實際記憶能力或學習成效的證明')
    c.close();b.close()
print('PASS 教材來源入口、75/396狀態、排程限制、語音與AI資料傳送說明')
