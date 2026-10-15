"""手機導覽焦點、VisualViewport 鍵盤／平移模擬、固定層座標及按鈕可見性。
Chromium 不會叫出 iOS 鍵盤：以獨立 EventTarget 模擬可見區域，不冒充真機測試。
"""
import os
from playwright.sync_api import sync_playwright, expect
from onboarding_helpers import existing_user
from shots import doc_shot
URL=os.environ.get('BASE_URL','http://127.0.0.1:8123/')
MOCK="""(() => {
 const native=window.visualViewport, vv=new EventTarget(); window.viewportMock={};
 for(const key of ['width','height','offsetTop','offsetLeft']) Object.defineProperty(vv,key,{get:()=>window.viewportMock[key] ?? native[key]});
 const registrations=new Map(); const add=vv.addEventListener.bind(vv), remove=vv.removeEventListener.bind(vv);
 vv.addEventListener=(type,fn,...rest)=>{if(!registrations.has(type))registrations.set(type,new Set());registrations.get(type).add(fn);add(type,fn,...rest);};
 vv.removeEventListener=(type,fn,...rest)=>{registrations.get(type)?.delete(fn);remove(type,fn,...rest);};
 window.viewportListenerCount=()=>[...registrations.values()].reduce((n,s)=>n+s.size,0);
 Object.defineProperty(window,'visualViewport',{value:vv,configurable:true});
 window.updateViewport=(metrics,event='resize')=>{Object.assign(window.viewportMock,metrics);vv.dispatchEvent(new Event(event));};
 window.inputFocuses=[];document.addEventListener('focusin',e=>{if(e.target.matches('input,textarea'))window.inputFocuses.push(e.target.id);});
})();"""
def wait_frame(pg): pg.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
def aligned(pg):
    wait_frame(pg)
    return pg.evaluate("""() => {
      const vv=visualViewport, tip=document.querySelector('.tour-tip').getBoundingClientRect();
      const field=document.querySelector('#batchTool:not([hidden]) #batchInput') || document.querySelector('#addForm');
      const r=field.getBoundingClientRect(), ring=document.querySelector('.tour-ring');
      const left=Math.max(vv.offsetLeft+4,r.left-5),right=Math.min(vv.offsetLeft+vv.width-4,r.right+5);
      const top=Math.max(vv.offsetTop+4,r.top-5),bottom=Math.min(vv.offsetTop+vv.height-4,r.bottom+5);
      const within=tip.left>=vv.offsetLeft && tip.right<=vv.offsetLeft+vv.width+1 && tip.top>=vv.offsetTop && tip.bottom<=vv.offsetTop+vv.height+1;
      if(right<=left||bottom<=top)return within&&ring.hidden;
      const q=ring.getBoundingClientRect();
      return within&&!ring.hidden&&Math.abs(q.left-left)<1&&Math.abs(q.top-top)<1&&Math.abs(q.right-right)<1&&Math.abs(q.bottom-bottom)<1;
    }""")
with sync_playwright() as p:
    b=p.chromium.launch(headless=True)
    for width in [393,320]:
        c=b.new_context(viewport={'width':width,'height':844},is_mobile=True,has_touch=True,service_workers='block',color_scheme='dark' if width==320 else 'light')
        existing_user(c);c.add_init_script('window.__toeicFirebaseConfig=null;');c.add_init_script(MOCK)
        c.route('https://fonts.googleapis.com/**',lambda r:r.fulfill(status=200,body=''))
        for host in ['api.dictionaryapi.dev','generativelanguage.googleapis.com']:
            c.route('https://'+host+'/**',lambda r:r.fulfill(status=404,body='{}'))
        pg=c.new_page(); errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
        pg.goto(URL+'#/help');pg.wait_for_load_state('networkidle')
        pg.click('[data-tour=library]');pg.click('#openAddWords')
        expect(pg.locator('#tourTitle')).to_have_text('一個字也能開始');wait_frame(pg)
        assert pg.evaluate('inputFocuses.length===0'),pg.evaluate('inputFocuses')
        assert aligned(pg)
        print(f'PASS {width}px 手機教學開新增視窗未曾聚焦文字欄，不會主動叫鍵盤',flush=True)
        pg.locator('#addInput').tap();pg.fill('#addInput','invoice')
        expect(pg.locator('.tour-tip')).to_have_class(__import__('re').compile('is-editing'))
        expect(pg.locator('#addInput')).to_be_focused()
        pg.evaluate("updateViewport({height:370,offsetTop:250},'resize')")
        assert aligned(pg)
        for y in [200,300,140]:
            pg.evaluate("y=>updateViewport({offsetTop:y},'scroll')",y)
            assert aligned(pg),y
            expect(pg.locator('#addInput')).to_be_focused()
        print('PASS 只有 VisualViewport scroll 事件時也能更新位置，且不搶輸入焦點',flush=True)
        # 模擬固定定位座標原點位移；光圈不能重複加算偏移。
        pg.evaluate("document.querySelector('#guidedTour').style.transform='translate(11px, 47px)';updateViewport({offsetTop:220,offsetLeft:8,width:innerWidth-16},'scroll')")
        assert aligned(pg)
        pg.screenshot(path=doc_shot('39-tour-keyboard-compact.png'))
        print('PASS 固定定位原點位移與左右可見範圍變動仍對齊',flush=True)
        pg.click('#tourKeyboard');expect(pg.locator('.tour-tip')).not_to_have_class(__import__('re').compile('is-editing'))
        pg.evaluate("updateViewport({height:260,offsetTop:180},'resize')")
        assert aligned(pg)
        for name in ['#tourNext','#tourExit']:
            assert pg.locator(name).evaluate("e=>{const r=e.getBoundingClientRect(),v=visualViewport;return r.top>=v.offsetTop&&r.bottom<=v.offsetTop+v.height;}")
        # 內容捲動不能把下一步按鈕捲走。
        before=pg.locator('#tourNext').bounding_box()['y']
        pg.locator('.tour-copy').evaluate('e=>e.scrollTop=1000');wait_frame(pg)
        assert abs(pg.locator('#tourNext').bounding_box()['y']-before)<1
        pg.screenshot(path=doc_shot('39-tour-keyboard-expanded.png'))
        print('PASS 狹小可見畫面下完整說明可捲動，下一步／結束固定可見',flush=True)
        pg.evaluate("document.querySelector('#guidedTour').style.transform='';viewportMock={};visualViewport.dispatchEvent(new Event('resize'))")
        pg.click('#tourNext');wait_frame(pg)
        assert pg.locator('.tour-copy').evaluate('e=>e.scrollTop')==0
        pg.click('[data-tool=batch]');wait_frame(pg)
        expect(pg.locator('#tourTitle')).to_have_text('確認預覽後才加入')
        assert not pg.evaluate("document.activeElement.matches('input,textarea')")
        pg.locator('#batchInput').tap();pg.fill('#batchInput','invoice, budget')
        pg.evaluate("document.querySelector('#addWordsDialog').style.maxHeight='310px';updateViewport({height:400,offsetTop:160},'resize')")
        assert aligned(pg)
        pg.locator('#addWordsDialog').evaluate('d=>d.scrollTop+=45');wait_frame(pg)
        assert aligned(pg)
        pg.evaluate("updateViewport({offsetTop:210},'scrollend')")
        assert aligned(pg)
        expect(pg.locator('#batchInput')).to_have_value('invoice, budget')
        print('PASS 批次輸入不自動叫鍵盤，手動輸入後視窗捲動仍對齊且文字保留',flush=True)
        pg.keyboard.press('Escape');expect(pg.locator('#guidedTour')).to_have_count(0)
        assert pg.evaluate('viewportListenerCount()')==0
        pg.evaluate("viewportMock={};document.querySelector('#addWordsDialog').style.maxHeight='';")
        pg.locator('#addWordsDialog [data-close]').click();pg.click('#openAddWords')
        expect(pg.locator('#addInput')).to_be_focused()
        pg.click('[data-tool=batch]');expect(pg.locator('#batchInput')).to_be_focused()
        print('PASS 導覽結束解除可見區域監聽，一般新增仍保留原本自動聚焦',flush=True)
        pg.locator('#addWordsDialog [data-close]').click();pg.goto(URL+'#/help')
        pg.click('[data-tour=lookup]');pg.click('#openLookup');wait_frame(pg)
        assert not pg.evaluate("document.activeElement.matches('input,textarea')")
        pg.locator('#lookupInput').tap();pg.fill('#lookupInput','ac')
        expect(pg.locator('#lookupSuggestions')).to_be_visible()
        expect(pg.locator('#lookupInput')).to_be_focused()
        print('PASS 查字教學也不自動叫鍵盤，手動輸入候選正常',flush=True)
        assert not errors,errors;c.close()
    b.close()
print('ALL PASSED')
