"""既有功能回歸測試以已略過教學的使用者執行；首次體驗由 test_onboarding.py 驗證。"""
def existing_user(context_or_page):
    context_or_page.add_init_script("if (!localStorage.getItem('toeic-cards:onboarding')) localStorage.setItem('toeic-cards:onboarding', JSON.stringify({version:1,status:'skipped'}));")

    # 原有功能回歸保留「既有使用者已展開各設定」情境；預設收合由 test_accessibility.py 驗證。
    context_or_page.add_init_script("if (!localStorage.getItem('toeic-cards:settingsSections')) localStorage.setItem('toeic-cards:settingsSections', JSON.stringify(Object.fromEntries(['syncPanel','aiPanel','backupPanel','pwaPanel','learningPanel','appearancePanel','speechPanel'].map(k=>[k,true]))));")
