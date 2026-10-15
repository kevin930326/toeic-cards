"""既有功能回歸測試以已略過教學的使用者執行；首次體驗由 test_onboarding.py 驗證。"""
def existing_user(context_or_page):
    context_or_page.add_init_script("if (!localStorage.getItem('toeic-cards:onboarding')) localStorage.setItem('toeic-cards:onboarding', JSON.stringify({version:1,status:'skipped'}));")
