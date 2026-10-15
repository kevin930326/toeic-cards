"""舊功能回歸測試共用的新入口；透過真實按鈕打開工具，不繞過產品邏輯。"""

def open_add(page, mode='single'):
    if not page.locator('#addWordsDialog').is_visible():
        page.click('#openAddWords')
    page.click(f'[data-tool={mode}]')

def close_add(page):
    if page.locator('#addWordsDialog').is_visible():
        page.click('[aria-label="關閉加入單字"]')

def open_ai(page):
    close_add(page)
    if not page.locator('#aiBox').is_visible():
        page.locator('#aiTools > summary').click()
