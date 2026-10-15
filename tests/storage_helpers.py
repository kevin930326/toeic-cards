"""測試直接讀寫瀏覽器裡的字卡資料前，先讓網站把還沒存的修改存完。

網站改了字卡會先更新畫面，約 50 毫秒後才寫進 localStorage（見 js/store.js、decisions #99）。
測試如果直接讀 localStorage，要先呼叫 flush(page)，才不會讀到舊資料；
直接寫入測試資料再重新整理前也要先 flush，否則網站離開頁面時存檔會蓋掉剛寫進去的資料。
"""

FLUSH = "import('/js/store.js').then((s) => { if (s.flushWords) s.flushWords(); })"


def flush(page):
    page.evaluate(FLUSH)
