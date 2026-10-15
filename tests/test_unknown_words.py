"""未收錄拼字仍可原樣建卡，手動意思／草稿與分類進度保留。"""
import os
from playwright.sync_api import sync_playwright, expect
from onboarding_helpers import existing_user

URL=os.environ.get('BASE_URL','http://127.0.0.1:8123/')
with sync_playwright() as p:
    b=p.chromium.launch(headless=True)
    c=b.new_context(viewport={'width':375,'height':950},has_touch=True,is_mobile=True,service_workers='block')
    existing_user(c)
    c.add_init_script('window.__toeicFirebaseConfig=null;')
    c.route('https://fonts.googleapis.com/**',lambda r:r.fulfill(status=200,body=''))
    c.route('https://api.dictionaryapi.dev/**',lambda r:r.fulfill(status=503,body='{}'))
    pg=c.new_page();errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
    pg.goto(URL+'#/review');pg.wait_for_load_state('networkidle')
    before=pg.evaluate("[localStorage.getItem('toeic-cards:log'),localStorage.getItem('toeic-cards:settings')]")

    def query(word):
        pg.locator('#lookupDialog').wait_for(state='attached')
        if not pg.locator('#lookupDialog').is_visible(): pg.click('#openLookup')
        pg.fill('#lookupInput',word);pg.locator('#lookupForm button').click()
        expect(pg.locator('#lookupResult h3')).to_have_text(word)

    query('zzdiscussed')
    expect(pg.locator('.lookup-manual')).to_be_visible()
    pg.locator('.lookup-manual summary').tap()
    pg.fill('#lookupManualZh','討論（discuss 的過去式／過去分詞）')
    pg.fill('#lookupManualPos','v.')
    pg.locator('#lookupEnglish').tap()
    expect(pg.locator('#lookupEnglishStatus')).to_contain_text('仍可新增字卡')
    expect(pg.locator('#lookupManualZh')).to_have_value('討論（discuss 的過去式／過去分詞）')
    assert pg.evaluate('document.documentElement.scrollWidth<=innerWidth')
    pg.screenshot(path='tests/screenshots/custom-word-expanded.png',full_page=True)
    pg.locator('#lookupSave').tap()
    expect(pg.locator('.lookup-meaning')).to_contain_text('過去式')
    expect(pg.locator('#lookupResult h3')).to_have_text('zzdiscussed')
    saved=pg.evaluate("JSON.parse(localStorage.getItem('toeic-cards:words')).find(w=>w.word==='zzdiscussed')")
    assert saved['src']['zh']=='user' and saved['src']['pos']=='user' and saved['autoGenerate'] is False
    assert not pg.evaluate("JSON.parse(localStorage.getItem('toeic-cards:words')).some(w=>w.word==='discuss')")
    assert before==pg.evaluate("[localStorage.getItem('toeic-cards:log'),localStorage.getItem('toeic-cards:settings')]")
    print('PASS 未收錄測試字 zzdiscussed 原樣建卡與手動意思保留；查英文失敗不清草稿、不改學習進度',flush=True)

    # 成功查英文也會重畫；不得清掉已輸入的手動中文。
    c.route('https://api.dictionaryapi.dev/**',lambda r:r.fulfill(status=200,content_type='application/json',body='[{"meanings":[{"partOfSpeech":"verb","definitions":[{"definition":"past tense of discuss"}]}]}]'))
    query('zzcustomword')
    pg.locator('.lookup-manual summary').tap();pg.fill('#lookupManualZh','自訂意思 <img src=x>')
    pg.locator('#lookupEnglish').tap()
    expect(pg.locator('.lookup-en')).to_have_text('past tense of discuss')
    pg.locator('.lookup-manual summary').tap()
    expect(pg.locator('#lookupManualZh')).to_have_value('自訂意思 <img src=x>')
    pg.locator('#lookupSave').tap()
    expect(pg.locator('.lookup-meaning')).to_contain_text('<img src=x>')
    assert pg.locator('#lookupResult img').count()==0
    print('PASS 查英文成功後保留手動草稿，內容安全顯示為文字',flush=True)

    query('disscussed')
    pg.locator('#lookupSave').tap()
    expect(pg.locator('#lookupSaveStatus')).to_contain_text('尚無解釋')
    assert pg.evaluate("JSON.parse(localStorage.getItem('toeic-cards:words')).some(w=>w.word==='disscussed')")
    print('PASS 不自動改寫拼字，未填意思仍可新增並清楚提示補內容',flush=True)
    pg.locator('#lookupDialog [data-close]').tap();pg.reload();pg.wait_for_load_state('networkidle')
    query('zzdiscussed')
    expect(pg.locator('.lookup-meaning')).to_contain_text('過去式')
    assert pg.locator('.lookup-manual').count()==0
    print('PASS 重新整理仍保留自訂字義，既有卡不出現覆寫欄位',flush=True)
    assert not errors,errors
    b.close()
print('ALL PASSED')
