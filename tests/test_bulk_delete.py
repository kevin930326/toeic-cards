"""風格一致的單筆／批次刪除、跨頁快照、同步紀錄與一次更新。"""
import os
from playwright.sync_api import sync_playwright, expect
from onboarding_helpers import existing_user
from storage_helpers import flush
from shots import doc_shot
URL=os.environ.get('BASE_URL','http://127.0.0.1:8123/')

def store(pg, body):
    return pg.evaluate("async()=>{const s=await import('/js/store.js');"+body+"}")
with sync_playwright() as p:
    b=p.chromium.launch(headless=True)
    c=b.new_context(viewport={'width':1100,'height':950},service_workers='block')
    existing_user(c);c.add_init_script('window.__toeicFirebaseConfig=null;window.confirm=()=>{throw new Error("不應開啟原生確認框")};')
    c.route('https://fonts.googleapis.com/**',lambda r:r.fulfill(status=200,body=''))
    for host in ['api.dictionaryapi.dev','generativelanguage.googleapis.com']:
        c.route('https://'+host+'/**',lambda r:r.fulfill(status=404,body='{}'))
    pg=c.new_page();errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
    pg.goto(URL+'#/stats');pg.wait_for_load_state('networkidle')
    store(pg,"""const list=Array.from({length:235},(_,i)=>'sample'+String.fromCharCode(97+Math.floor(i/26),97+i%26));
      s.addWords(list,{autoGenerate:false,initialData:new Map(list.map(word=>[word,{zh:'測試中文',en:'test',lookup:{dictAt:1,enDone:true}}]))});
      const set=s.createWordSet('共同分類');s.assignWordSet(s.getWords().map(w=>w.id),set.id);
      window.original=JSON.stringify(s.getWords());window.first=s.getWords()[0].id;""")
    pg.goto(URL+'#/words');pg.wait_for_selector('.word-row')
    pg.click('#toggleLibraryEdit');pg.locator('[data-act=delete]').first.click()
    expect(pg.locator('#deleteWordsTitle')).to_have_text('刪除 1 張字卡？')
    expect(pg.locator('#cancelWordDeletion')).to_be_focused()
    expect(pg.locator('.delete-preview')).to_contain_text('sampleja')
    pg.screenshot(path=doc_shot('38-delete-confirm.png'))
    pg.keyboard.press('Enter')
    expect(pg.locator('#deleteWordsDialog')).to_have_count(0)
    assert store(pg,'return JSON.stringify(s.getWords())===window.original')
    pg.locator('[data-act=delete]').first.click();pg.keyboard.press('Escape')
    expect(pg.locator('#deleteWordsDialog')).to_have_count(0)
    assert store(pg,'return s.getWords().length')==235
    print('PASS 單筆使用網站確認視窗、預設取消、Enter 與 Escape 均保留字卡',flush=True)
    pg.click('#toggleBulk')
    expect(pg.locator('#bulkDelete')).to_be_disabled()
    pg.locator('.word-select').first.check()
    first=pg.locator('.word-row').first.get_attribute('data-id')
    pg.click('#nextWords');pg.locator('.word-select').first.check()
    second=pg.locator('.word-row').first.get_attribute('data-id')
    expect(pg.locator('#selectedCount')).to_have_text('已選 2 個字')
    # 刪除不需要先指定分類。
    pg.click('#bulkDelete')
    expect(pg.locator('#deleteWordsTitle')).to_have_text('刪除 2 張字卡？')
    expect(pg.locator('#deleteWordsDescription')).to_contain_text('所有單字集')
    pg.click('#cancelWordDeletion')
    expect(pg.locator('#selectedCount')).to_have_text('已選 2 個字')
    store(pg,"window.deleteEmits=0;window.off=s.subscribe(()=>window.deleteEmits++);window.targetIds="+__import__('json').dumps([first,second])+";")
    pg.click('#bulkDelete');pg.click('#confirmWordDeletion')
    expect(pg.locator('#selectedCount')).to_have_text('已選 0 個字')
    res=store(pg,"return {count:s.getWords().length,emits:window.deleteEmits,absent:window.targetIds.every(id=>!s.getWord(id)),tombs:Object.keys(s.getTombstones()).length,sets:s.getSetRecords().length};")
    assert res=={'count':233,'emits':1,'absent':True,'tombs':2,'sets':1},res
    assert store(pg,"return JSON.stringify(s.getWords())===JSON.stringify(JSON.parse(window.original).filter(w=>!window.targetIds.includes(w.id)))")
    store(pg,'window.off();')
    flush(pg);pg.reload();pg.wait_for_load_state('networkidle')
    assert store(pg,'return s.getWords().length')==233
    print('PASS 跨頁刪除兩張字卡，一次通知、同步刪除紀錄、分類保留、重整後仍刪除',flush=True)
    # 搜尋結果跨所有頁選取、預覽上限、手機／深色。
    pg.click('#toggleBulk');pg.fill('#search','sampleb');pg.check('#selectShown')
    expect(pg.locator('#selectedCount')).to_have_text('已選 26 個字')
    pg.click('#bulkDelete');expect(pg.locator('.delete-preview .chip')).to_have_count(8)
    expect(pg.locator('.delete-preview-more')).to_have_text('另 18 個字')
    for width in [375,320]:
        pg.set_viewport_size({'width':width,'height':812})
        assert pg.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert pg.locator('#confirmWordDeletion').is_visible()
    pg.emulate_media(color_scheme='dark');pg.wait_for_timeout(220)
    pg.screenshot(path=doc_shot('38-delete-mobile-dark.png'))
    pg.click('#confirmWordDeletion')
    expect(pg.locator('#list .word-row')).to_have_count(0)
    assert store(pg,'return s.getWords().length')==207
    print('PASS 全選搜尋結果只刪符合範圍，預覽最多八字，320／375px 深色可操作',flush=True)
    # 確認期間新增的字不能被納入原本的全選。
    pg.fill('#search','');pg.check('#selectShown');pg.click('#bulkDelete')
    store(pg,"s.addWords(['untouched'],{autoGenerate:false,initialData:new Map([['untouched',{zh:'保留',lookup:{dictAt:1,enDone:true}}]])});")
    pg.click('#confirmWordDeletion');expect(pg.locator('#selectedCount')).to_have_text('已選 0 個字')
    assert store(pg,'return s.getWords().map(w=>w.word)')==['untouched']
    print('PASS 刪除依開窗時的選取快照，期間新增的字保留',flush=True)
    pg.locator('.word-select').first.check();pg.click('#bulkDelete')
    pg.evaluate("location.hash='/stats'")
    expect(pg.locator('#deleteWordsDialog')).to_have_count(0)
    assert store(pg,'return s.getWords().length')==1
    print('PASS 切頁時取消未確認的刪除',flush=True)
    # 刪除紀錄寫入失敗時不能先刪記憶體資料。
    result=pg.evaluate("""async()=>{const s=await import('/js/store.js');const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='toeic-cards:deleted')throw new DOMException('blocked','QuotaExceededError');return original.call(this,k,v);};let threw=false;try{s.deleteWords(s.getWords().map(w=>w.id));}catch{threw=true;}finally{Storage.prototype.setItem=original;}return threw&&s.getWords().length===1;}""")
    assert result
    print('PASS 同步刪除紀錄寫入失敗保留原字卡',flush=True)
    assert not errors,errors
    b.close()
print('ALL PASSED')
