"""審查修正：題庫延遲不覆蓋其他頁、已存詞性題不依賴題庫下載。"""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from onboarding_helpers import existing_user
from storage_helpers import flush

URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
BANK = (Path(__file__).resolve().parent.parent / 'data/packs/toeic-1000-forms.json').read_text(encoding='utf-8')
SAVED_Q = dict(id='saved-form', sentence='Both companies agreed to _____ a new contract next month.',
               answer='negotiate', distractors=['negotiation','negotiable','negotiated'],
               translation='兩家公司同意下個月協商新合約。', explanation='to 後接原形動詞。', usedAt=0, at=1)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    errors=[];ai_calls=[]

    def setup(workers=False):
        context=browser.new_context(service_workers='allow' if workers else 'block',viewport={'width':1000,'height':900})
        existing_user(context)
        context.add_init_script('window.__toeicFirebaseConfig=null;')
        context.route('https://fonts.googleapis.com/**',lambda r:r.fulfill(status=200,body=''))
        context.route('https://api.dictionaryapi.dev/**',lambda r:r.fulfill(status=404,body='{}'))
        context.route('https://generativelanguage.googleapis.com/**',lambda r:(ai_calls.append(r.request.url),r.fulfill(status=403,body='{}')))
        page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(URL+'#/stats');page.wait_for_load_state('networkidle')
        return context,page

    context,page=setup();held=[]
    context.route('**/data/packs/toeic-1000-forms.json',lambda r:held.append(r))
    page.click('a[data-route=quiz]');expect(page.locator('.mode-grid')).to_be_visible()
    for _ in range(20):
        if held: break
        page.wait_for_timeout(50)
    assert len(held)==1
    # 同一份下載尚未完成時，舊、新兩個測驗頁生命週期只讓目前這個重畫。
    page.click('a[data-route=stats]');expect(page.locator('#view h1')).to_have_text('統計')
    held.pop().fulfill(status=200,content_type='application/json',body=BANK)
    page.wait_for_load_state('networkidle')
    expect(page.locator('#view h1')).to_have_text('統計')
    assert page.url.endswith('#/stats') and page.locator('.mode-grid').count()==0
    page.click('a[data-route=quiz]');expect(page.locator('.mode-grid')).to_be_visible()
    print('PASS 題庫延遲回應不覆蓋已切換的統計頁，再進測驗仍正常',flush=True)
    context.close()

    context,page=setup(workers=True);bank_state={'fail':True}
    context.route('**/data/packs/toeic-1000-forms.json',lambda r:r.fulfill(
        status=503 if bank_state['fail'] else 200,content_type='application/json',body='{}' if bank_state['fail'] else BANK))
    page.evaluate('''async q=>{const s=await import('/js/store.js');
      const result=s.addWords(['negotiate','amount'],{autoGenerate:false});
      for(const w of result.added)s.updateWord(w.id,{zh:'已有中文',en:'a saved word',lookup:{dictAt:1,enDone:true},
        ...(w.word==='negotiate'?{formQs:[q]}:{pack:{id:'toeic-1000',version:1}})});
    }''',SAVED_Q)
    flush(page)
    page.click('a[data-route=quiz]');page.wait_for_load_state('networkidle')
    page.click('.mode-btn[data-mode=forms]')
    expect(page.locator('.q-sentence')).to_have_text(SAVED_Q['sentence'].replace('_____', '_______'))
    expect(page.locator('.quiz-progress')).to_have_text('1 / 1')
    expect(page.locator('#toast')).to_contain_text('只使用已存題目')
    assert not ai_calls
    print('PASS 題庫503時無金鑰仍可考已存題目，未存的字略過並提示',flush=True)
    page.click('#quit')
    page.evaluate("async()=>{const l=await import('/js/llm.js');l.setApiKey('fake-review-test');const s=await import('/js/store.js');s.updateSettings({part5Fresh:true});}")
    page.click('.mode-btn[data-mode=forms]');expect(page.locator('.q-sentence')).to_be_visible()
    expect(page.locator('.quiz-progress')).to_have_text('1 / 1')
    assert not ai_calls,'題庫故障不能使原本免費的內建字被送到AI'
    print('PASS 已設定金鑰且要求新題時，故障備援仍只用已存題目、不花AI額度',flush=True)

    # 沒載入題庫但已有快取題的字卡，在真正離線重整後也可作答。
    flush(page)
    assert page.evaluate('async()=>{await navigator.serviceWorker.ready;return !!navigator.serviceWorker.controller}')
    context.set_offline(True);page.reload();page.wait_for_load_state('networkidle')
    expect(page.locator('.mode-btn[data-mode=forms]')).to_be_enabled()
    page.click('.mode-btn[data-mode=forms]');expect(page.locator('.q-sentence')).to_be_visible()
    print('PASS 真正離線重整後從字卡恢復已存題目，不依賴記憶體題庫',flush=True)

    # 恢復題庫時應重新載入，免費內建字不能一直被視為缺題。
    bank_state['fail']=False
    context.set_offline(False)
    page.evaluate("async()=>{const l=await import('/js/llm.js');l.setApiKey('');const s=await import('/js/store.js');s.updateSettings({part5Fresh:false});}")
    page.click('#quit');page.wait_for_load_state('networkidle')
    page.click('.mode-btn[data-mode=forms]');expect(page.locator('.quiz-progress')).to_have_text('1 / 2')
    assert not ai_calls
    print('PASS 題庫恢復後可重試並重新納入免費內建題',flush=True)
    context.close()

    context,page=setup()
    context.route('**/data/packs/toeic-1000-forms.json',lambda r:r.fulfill(status=503,body='{}'))
    page.evaluate("async()=>{const s=await import('/js/store.js');s.addWords(['amount'],{autoGenerate:false,initialData:new Map([['amount',{pack:{id:'toeic-1000',version:1}}]])});}")
    page.click('a[data-route=quiz]');page.click('.mode-btn[data-mode=forms]')
    expect(page.locator('.ai-error')).to_contain_text('題庫目前讀不到')
    assert page.locator('.question').count()==0 and not ai_calls
    print('PASS 沒有已存題目時保留連網重試提示，不假裝已成功出題',flush=True)
    assert not errors,errors
    browser.close()
print('ALL PASSED')
