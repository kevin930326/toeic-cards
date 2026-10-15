"""大量既有字卡下，建立新集後批次新增不應逐字儲存／重建整份清單。"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from onboarding_helpers import existing_user

URL=os.environ.get('BASE_URL','http://127.0.0.1:8123/')
pack=json.loads(Path('data/packs/toeic-1000.json').read_text(encoding='utf-8'))
incoming=pack['words'][:100] if 'words' in pack else []

def letters(i):
    out=''
    for _ in range(4):
        out+=chr(97+i%26);i//=26
    return 'saved'+out

words=[dict(id='saved-'+str(i),word=letters(i),pos='n.',zh='已有字卡',en='an existing word',
            phonetic='',examples=[],collocations=[],forms=[],synonyms=[],unfamiliar=False,src={},
            lookup={'dictAt':1,'enDone':True},srs={'reps':2,'interval':3,'ease':2.5,'due':9999999999999},
            createdAt=i+1,updatedAt=1) for i in range(1000)]

with sync_playwright() as p:
    b=p.chromium.launch(headless=True)
    c=b.new_context(viewport={'width':375,'height':900},has_touch=True,is_mobile=True,service_workers='block')
    existing_user(c)
    c.add_init_script("window.__toeicFirebaseConfig=null;localStorage.setItem('toeic-cards:gemini-key','fake-batch-test');localStorage.setItem('toeic-cards:settings',JSON.stringify({autoGenerate:false}));")
    c.add_init_script("localStorage.setItem('toeic-cards:words',"+json.dumps(json.dumps(words))+");")
    c.route('https://fonts.googleapis.com/**',lambda r:r.fulfill(status=200,body=''))
    c.route('https://api.dictionaryapi.dev/**',lambda r:r.fulfill(status=404,body='{}'))
    c.route('https://generativelanguage.googleapis.com/**',lambda r:r.fulfill(status=403,body='{}'))
    pg=c.new_page();errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
    pg.goto(URL+'#/words');pg.wait_for_load_state('networkidle')
    pg.click('#openManageSets');pg.fill('#newSetName','自己貼上的單字')
    pg.locator('#createSetForm button').click()
    pg.locator('#manageSetsDialog [data-close]').click()
    pg.click('#openAddWords');pg.locator('[data-tool=batch]').click()
    options=pg.locator('#addToSet option').all()
    dest=next(el.get_attribute('value') for el in options if '自己貼上的單字' in el.inner_text())
    pg.select_option('#addToSet',dest)
    # 挑檔案裡原始的英文選字，不使用個人資料。
    incoming=pg.evaluate("async()=>{const p=await(await fetch('data/packs/toeic-1000.json')).json();return p.words || p.groups.flatMap(g=>g.words);}")[:100]
    pg.fill('#batchInput','\n'.join(incoming))
    pg.evaluate('''()=>{
      window.batchMetric={writes:0,renders:0,rowMutations:0,start:performance.now(),last:performance.now(),gap:0};
      const original=Storage.prototype.setItem;
      Storage.prototype.setItem=function(k,v){if(k==='toeic-cards:words')batchMetric.writes++;return original.call(this,k,v);};
      new MutationObserver(rs=>{batchMetric.renders++;batchMetric.rowMutations+=rs.filter(r=>r.type==='childList').length;}).observe(document.querySelector('#list'),{childList:true});
      const tick=()=>{const n=performance.now();batchMetric.gap=Math.max(batchMetric.gap,n-batchMetric.last);batchMetric.last=n;requestAnimationFrame(tick);};requestAnimationFrame(tick);
    }''')
    pg.click('#batchAdd')
    pg.wait_for_function("document.querySelector('#batchInput').value==='' && document.querySelector('#batchAdd').disabled")
    pg.wait_for_timeout(600)
    metrics=pg.evaluate('batchMetric')
    print('METRICS',json.dumps(metrics),flush=True)
    pg.locator('#addWordsDialog [data-close]').click(timeout=3000)
    pg.select_option('#setScope',dest)
    expect(pg.locator('.word-row')).to_have_count(100)
    assert pg.evaluate("JSON.parse(localStorage.getItem('toeic-cards:words')).filter(w=>w.word.startsWith('saved')).every(w=>w.srs.interval===3)")
    assert metrics['writes']<=5, '本機批次查字不應每個字都重存整份資料'
    assert metrics['renders']<=10, '單次批次加入不應逐字重建整份清單'
    assert metrics['rowMutations']<=700, '每次更新最多影響一頁，不能重建所有收藏'
    assert not errors,errors
    pg.screenshot(path='tests/screenshots/batch-add-paged.png')
    b.close()
print('ALL PASSED')
