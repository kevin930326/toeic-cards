"""題目審核、停用、修訂與 AI 逐選項檢查（API 全模擬）。"""
import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright
from onboarding_helpers import existing_user
from shots import doc_shot
URL=os.environ.get('BASE_URL','http://127.0.0.1:8123/')
mode={'ambiguous':True};calls=[]
def api(route):
    prompt=json.loads(route.request.post_data)['contents'][0]['parts'][0]['text'];calls.append(prompt)
    if 'Items JSON:\n' in prompt:
        items=json.loads(prompt.split('Items JSON:\n')[1])
        body={'reviews':[{'id':x['id'],'validIndexes':[0,1] if mode['ambiguous'] else [x['options'].index('negotiate')],
            'reasons':['此處需要不定詞原形動詞。']*4,'translationConsistent':True} for x in items]}
    else:
        body={'questions':[{'target':'negotiate','sentence':'Both companies agreed to _____ a new contract next month.','answer':'negotiate',
            'distractors':['negotiation','negotiable','negotiated'],'translation':'兩家公司同意下個月協商新合約。','explanation':'agreed to 後接原形動詞。'}]}
    route.fulfill(content_type='application/json',body=json.dumps({'candidates':[{'content':{'parts':[{'text':json.dumps(body)}]},'finishReason':'STOP'}]}))
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    ctx=browser.new_context(viewport={'width':393,'height':850});existing_user(ctx)
    ctx.add_init_script('window.__toeicFirebaseConfig=null;')
    ctx.route('https://api.dictionaryapi.dev/**',lambda r:r.fulfill(status=404,body='{}'))
    ctx.route('https://generativelanguage.googleapis.com/**',api)
    pg=ctx.new_page();pg.goto(URL+'#/quiz',wait_until='networkidle')
    pg.evaluate("""async()=>{const s=await import('/js/store.js');s.addWords(['complementary','negligent','invite'],{autoGenerate:false});
      s.updateSettings({quizCount:10,llmRpm:60000});s.flushWords();
      const w=s.getWords()[0];(await import('/js/mistakes.js')).addMistake({mode:'forms',wordId:w.id,word:w.word,prompt:'Old ambiguous _____',options:['a','b','c','d'],answerIndex:0},1);
    }""")
    pg.reload(wait_until='networkidle')
    assert '396 題待覆核並停用' in pg.locator('.question-quality').first.inner_text()
    assert '1 題舊版' in pg.locator('.page').inner_text()
    pg.click('[data-mode=forms].mode-btn');pg.locator('.q-forms').wait_for()
    assert pg.locator('.quiz-progress').inner_text().endswith('/ 2'), '待覆核 invite 不得出題'
    pg.click('#reportQuestion');pg.locator('#questionReason').fill('測試回報：此題需要覆核')
    pg.locator('button[value=report]').click()
    assert pg.evaluate("import('/js/question-reports.js').then(m=>m.questionReports().length)")==1
    assert pg.evaluate("import('/js/log.js').then(m=>Object.keys(m.getLog()).length)")==0, '回報跳過不得計分'
    pg.locator('.q-forms').wait_for()
    sentence=pg.locator('.q-sentence').inner_text().replace('_______','_____')
    bank=json.loads(Path('data/packs/toeic-1000-forms.json').read_text(encoding='utf-8'))
    answer=next(q['answer'] for q in bank['questions'] if q['sentence']==sentence)
    pg.locator('.option').filter(has_text=answer).first.click()
    assert pg.locator('.option-explanations li').count()==4
    pg.evaluate('window.scrollTo(0,0)')
    pg.screenshot(path=doc_shot('43-question-review.png'),full_page=True)
    # 舊 AI 快取不再採用；新題若第二輪有兩個合理答案，拒用。
    out=pg.evaluate("""async()=>{const s=await import('/js/store.js');const w=s.addWords(['negotiate'],{autoGenerate:false}).added[0];
      const l=await import('/js/llm.js');l.setApiKey('test-only');
      const f=await import('/js/forms-quiz.js?v=review-fixes-1');return f.prepareForms([w],1);
    }""")
    assert not out['questions'] and out['failed'], '格式完整但答案不唯一仍須拒用'
    mode['ambiguous']=False
    out=pg.evaluate("""async()=>{const s=await import('/js/store.js');const f=await import('/js/forms-quiz.js?v=review-fixes-1');return f.prepareForms(s.getWords().filter(w=>w.word==='negotiate'),1);}""")
    assert len(out['questions'])==1 and out['questions'][0]['extra']['review']=='ai-checked'
    valid=pg.evaluate("""async q=>{const b=await import('/js/backup.js');const p=await import('/js/question-policy.js');return p.currentQuizQuestion(b.sanitizeMistakes([{question:q,chosen:1,count:1,at:1}])[0].question);}""",out['questions'][0])
    assert valid,'備份往返保留新版 AI 檢查資料'
    ctx.close();browser.close()
print('PASS 審核篩選、75/396揭露、回報跳過不計分、舊題封存、AI答案不唯一拒用、備份往返')
