"""大量字卡分頁、完整範圍搜尋與分類、局部更新。"""
import json
import os
from playwright.sync_api import sync_playwright, expect
from onboarding_helpers import existing_user

URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width':375, 'height':850}, has_touch=True, is_mobile=True)
    existing_user(context)
    context.add_init_script('window.__toeicFirebaseConfig=null;')
    context.route('https://fonts.googleapis.com/**', lambda r:r.fulfill(status=200, body=''))
    context.route('https://api.dictionaryapi.dev/**', lambda r:r.fulfill(status=503, body='{}'))
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error:errors.append(str(error)))
    page.goto(URL + '#/stats'); page.wait_for_load_state('networkidle')
    page.evaluate('''async()=>{const s=await import('/js/store.js');
      const words=Array.from({length:3000},(_,i)=>'sample'+String.fromCharCode(97+Math.floor(i/676),97+Math.floor(i/26)%26,97+i%26));
      s.addWords(words,{autoGenerate:false,initialData:new Map(words.map(word=>[word,{zh:'測試中文',en:'test',lookup:{dictAt:1,enDone:true}}]))});
      s.createWordSet('完整範圍');}''')
    cdp = context.new_cdp_session(page)
    cdp.send('Emulation.setCPUThrottlingRate', {'rate':4})
    metrics = page.evaluate('''async()=>{const start=performance.now();document.querySelector('a[data-route=words]').click();
      while(!document.querySelector('.word-row'))await new Promise(r=>setTimeout(r,0));
      document.querySelector('#list').getBoundingClientRect();
      return {enter:performance.now()-start,rows:document.querySelectorAll('.word-row').length,nodes:document.querySelector('#list').querySelectorAll('*').length};}''')
    cdp.send('Emulation.setCPUThrottlingRate', {'rate':1})
    print('3000 WORDS / CPU 4x: ' + json.dumps(metrics), flush=True)
    assert metrics['rows'] == 100 and metrics['nodes'] < 2000
    expect(page.locator('#count')).to_contain_text('3000')
    page.click('#toggleBulk');page.locator('.word-select').first.check()
    first = page.locator('.word-row').first.get_attribute('data-id')
    page.click('#nextWords')
    expect(page.locator('#wordPage')).to_have_text('第 101–200 筆，共 3000 字')
    expect(page.locator('#selectedCount')).to_have_text('已選 1 個字')
    page.click('#previousWords')
    assert page.locator('.word-row').first.get_attribute('data-id') == first
    expect(page.locator('.word-select').first).to_be_checked()
    page.check('#selectShown')
    expect(page.locator('#selectedCount')).to_have_text('已選 3000 個字')
    page.select_option('#bulkSet',page.locator('#bulkSet option').nth(1).get_attribute('value'))
    page.click('#bulkAssign')
    assert page.evaluate("async()=>{const s=await import('/js/store.js');return Object.values(s.getWordSets()[0].members).filter(m=>m.present).length}") == 3000
    print('PASS 換頁保留勾選；全選與批次分類涵蓋未呈現的 3000 字', flush=True)
    page.click('#toggleBulk')
    unchanged = page.evaluate('''async()=>{const s=await import('/js/store.js');
      const rows=[...document.querySelectorAll('.word-row')];const keep=rows[1];const star=keep.querySelector('.star');star.focus();
      s.updateWord(rows[0].dataset.id,{zh:'更新第一列'});
      return keep===document.querySelectorAll('.word-row')[1] && document.activeElement===star;}''')
    assert unchanged
    last_word = page.evaluate("async()=>{const s=await import('/js/store.js');return s.getWords().at(-1).word}")
    page.click('#nextWords');page.fill('#search',last_word)
    expect(page.locator('.word-row')).to_have_count(1)
    expect(page.locator('.word-en')).to_have_text(last_word)
    assert page.locator('.library-pages').is_hidden()
    page.fill('#search','');expect(page.locator('#wordPage')).to_contain_text('第 1–100')
    for width in [320,375,768]:
        page.set_viewport_size({'width':width,'height':850})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.set_viewport_size({'width':375,'height':850})
    page.locator('.library-pages').scroll_into_view_if_needed()
    page.screenshot(path='docs/images/29-library-pages.png')
    print('PASS 完整搜尋、搜尋重設頁碼、背景局部更新保留其他列與焦點、窄螢幕', flush=True)

    # 101 字的第二頁只有一列，刪除後自動退回第一頁。
    page.evaluate('''async()=>{const s=await import('/js/store.js');const w=s.getWords().slice(0,101);
      const set=s.createWordSet('邊界');s.assignWordSet(w.map(w=>w.id),set.id);s.updateSettings({activeSetId:set.id});}''')
    page.click('#nextWords');expect(page.locator('.word-row')).to_have_count(1)
    page.evaluate("async()=>{const s=await import('/js/store.js');s.deleteWord(document.querySelector('.word-row').dataset.id)}")
    expect(page.locator('.word-row')).to_have_count(100)
    assert page.locator('.library-pages').is_hidden()
    print('PASS 最後一頁刪除後回到有效頁碼', flush=True)

    assert not errors, errors
    browser.close()
print('ALL PASSED')
