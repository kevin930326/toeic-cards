from onboarding_helpers import existing_user
"""1000 字單字庫：互動效能、局部更新與編輯模式。隔離資料，不使用正式帳號。"""
import os,sys,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect

URL=os.environ.get('BASE_URL','http://127.0.0.1:8123/')
ROOT=Path(__file__).resolve().parent.parent
errors=[]
def check(ok,msg):
    print(('PASS ' if ok else 'FAIL ')+msg,flush=True)
    if not ok:errors.append(msg)

with sync_playwright() as p:
    b=p.chromium.launch(headless=True)
    ctx=b.new_context(viewport={'width':1100,'height':900},service_workers='block')
    existing_user(ctx)
    ctx.add_init_script('window.__toeicFirebaseConfig=null;')
    ctx.route('https://fonts.googleapis.com/**',lambda r:r.fulfill(status=200,content_type='text/css',body=''))
    ctx.route('https://api.dictionaryapi.dev/**',lambda r:r.fulfill(status=404,body='{}'))
    ctx.route('https://generativelanguage.googleapis.com/**',lambda r:r.fulfill(status=403,body='{}'))
    pg=ctx.new_page();pg.on('pageerror',lambda e:errors.append(str(e)))
    pg.goto(URL+'#/stats');pg.wait_for_load_state('networkidle')
    entries=[]
    for i in range(1,11):entries.extend(json.loads((ROOT/f'data/packs/toeic-1000/{i:02}.json').read_text(encoding='utf-8'))['entries'])
    pg.evaluate('''async entries=>{const s=await import('/js/store.js'),p=await import('/js/word-packs.js');
      s.addWords(entries.map(e=>e.word),{autoGenerate:false,initialData:new Map(entries.map(e=>[e.word,p.initialPackData(e)]))});
      const set=s.createWordSet('多益1000單');s.assignWordSet(s.getWords().map(w=>w.id),set.id);
    }''',entries)
    times=pg.evaluate('''async()=>{const a=performance.now();
      document.querySelector('a[data-route=words]').click();
      while(!document.querySelector('.word-row')){
        if(performance.now()-a>5000)throw new Error('單字庫未完成顯示');
        await new Promise(r=>setTimeout(r,0));
      }
      document.querySelector('#list').getBoundingClientRect();const enter=performance.now()-a;
      const row=document.querySelector('.word-row');
      const start=performance.now();row.querySelector('[data-act=mark]').click();const mark=performance.now()-start;
      return {enter,mark,sameRow:row===document.querySelector('.word-row')};}''')
    print('TIMINGS '+json.dumps(times),flush=True)
    if os.environ.get('PROFILE_ONLY')=='1':
        b.close();sys.exit(0)
    check(times['sameRow'],'點星星保留原列節點，不重建全部1000列')
    check(pg.locator('.word-row').count()==1000,'仍顯示全部1000字，不改變搜尋或批次範圍')
    check(pg.evaluate('''async()=>{const s=await import('/js/store.js');const w=s.getWords()[0];
      return w.unfamiliar && !w.srs && JSON.parse(localStorage.getItem('toeic-cards:words'))[0].unfamiliar;}'''), '星星立即寫入本機儲存，且不改動複習排程')
    check(not pg.locator('[data-act=edit]').first.is_visible() and not pg.locator('[data-act=delete]').first.is_visible(),'預設隱藏編輯與刪除按鈕')
    check(not pg.locator('.word-select').first.is_visible() and not pg.locator('#bulkTools').is_visible(),'預設也隱藏勾選框與批次工具')
    pg.click('#toggleBulk')
    expect(pg.locator('.word-select').first).to_be_visible()
    expect(pg.locator('#bulkAssign')).to_be_disabled()
    pg.locator('.word-select').first.check()
    expect(pg.locator('#selectedCount')).to_have_text('已選 1 個字')
    pg.click('#clearSelected')
    expect(pg.locator('#selectedCount')).to_have_text('已選 0 個字')
    pg.fill('#search','invoice')
    pg.check('#selectShown')
    expect(pg.locator('#selectShownLabel')).to_have_text('全選目前結果（1 字）')
    expect(pg.locator('#selectedCount')).to_have_text('已選 1 個字')
    pg.select_option('#bulkSet',pg.locator('#bulkSet option').nth(1).get_attribute('value'))
    expect(pg.locator('#bulkAssign')).to_be_enabled()
    pg.click('#toggleBulk')
    check(not pg.locator('.word-select').first.is_visible() and not pg.locator('.word-select').first.is_checked(),'完成整理會清空選取並隱藏方框')
    pg.click('#toggleBulk')
    pg.locator('.word-select').first.check()
    pg.click('#toggleLibraryEdit')
    expect(pg.locator('#toggleBulk')).to_have_attribute('aria-expanded','false')
    check(not pg.locator('.word-select').first.is_visible(),'開啟編輯模式會結束批次整理，避免兩種模式混淆')
    expect(pg.locator('#toggleLibraryEdit')).to_have_attribute('aria-pressed','true')
    row=pg.locator('.word-row').first
    row.locator('[data-act=edit]').click()
    expect(pg.locator('#editDialog')).to_be_visible()
    pg.click('#editCancel')
    row.locator('[data-act=mark]').click()
    expect(pg.locator('#toggleLibraryEdit')).to_have_attribute('aria-pressed','true')
    check(row.locator('[data-act=edit]').is_visible(),'標記不熟後保留編輯模式')
    pg.click('#toggleLibraryEdit')
    check(not row.locator('[data-act=edit]').is_visible(),'按完成編輯立即收起操作')
    pg.fill('#search','invoice')
    check(pg.locator('.word-row').count()==1,'搜尋沿用全部收藏，結果正確')
    pg.locator('.word-row [data-act=mark]').click()
    expect(pg.locator('.word-row [data-act=mark]')).to_be_focused()
    check(True,'點星星後保留按鈕焦點')
    pg.set_viewport_size({'width':375,'height':812})
    check(pg.evaluate('document.documentElement.scrollWidth<=innerWidth'),'手機工具列無橫向溢出')
    pg.screenshot(path=str(ROOT/'tests/screenshots/library-interactions.png'))
    pg.click('#toggleBulk')
    for width in [375,320]:
        pg.set_viewport_size({'width':width,'height':812})
        check(pg.evaluate('document.documentElement.scrollWidth<=innerWidth'),f'{width}px三步驟批次工具無橫向溢出')
    pg.set_viewport_size({'width':375,'height':812})
    pg.screenshot(path=str(ROOT/'tests/screenshots/library-bulk-mobile.png'))
    pg.click('#toggleLibraryEdit')
    pg.click('a[data-route=stats]');pg.click('a[data-route=words]')
    expect(pg.locator('#toggleLibraryEdit')).to_have_attribute('aria-pressed','false')
    check(True,'離開再進單字庫，編輯模式恢復關閉')
    b.close()
print('ALL PASSED' if not errors else str(errors))
sys.exit(bool(errors))
