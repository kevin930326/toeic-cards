"""只重試切帳 reload 造成的讀取中斷；同步錯誤及其他 Playwright 錯誤仍原樣失敗。"""
import time
from playwright.sync_api import Error

def sync_state(page):
    end=time.monotonic()+30
    while True:
        try:return page.evaluate("import('/js/sync.js').then(m=>m.syncState())")
        except Error as error:
            if 'Execution context was destroyed' not in str(error) or time.monotonic()>=end:raise
            page.wait_for_load_state('domcontentloaded')
