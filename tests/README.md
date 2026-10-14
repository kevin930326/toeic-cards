# 測試

用 [Playwright](https://playwright.dev/python/) 開瀏覽器，實際操作網站來測試（端對端測試）。

外部服務都換成**假的回應**，所以測試不需要網路，也不需要 API 金鑰：

- Gemini API：模擬正常回應、429 速率限制、錯誤金鑰、回應被截斷、漏掉單字
- Free Dictionary API：模擬正常回應、查無此字、伺服器掛掉（522）
- 語音播放：攔截 `speechSynthesis.speak`，記錄唸了什麼字、用什麼口音

## 執行

```bash
pip install playwright
playwright install chromium

# 在專案根目錄開一個本機伺服器（另一個終端機）
python -m http.server 8123 --bind 127.0.0.1

# 執行測試
node --test "tests/unit/*.test.mjs"   # 單元測試（純函式，不需要瀏覽器和伺服器）
python tests/test_step1.py
python tests/test_step2.py
python tests/test_step3.py
python tests/test_step4.py
python tests/test_step5.py
python tests/test_step6.py
python tests/test_step7.py
python tests/test_step8.py
python tests/test_pronunciation.py
python tests/test_daily_goal.py
```

可以用環境變數 `BASE_URL` 指定網址。測試截圖會存在 `tests/screenshots/`，這個資料夾不會上傳到 git。

| 檔案 | 測試內容 |
|---|---|
| `test_step1.py` | 新增、刪除、編輯、搜尋、翻卡、中英切換、標記不熟、重新整理後資料保留、深色模式、手機版面 |
| `test_step2.py` | 本機字典查詢（繁體）、Free Dictionary 依詞性挑解釋、發音與口音設定、手動修改不被覆蓋、API 掛掉後自動重試 |
| `test_step3.py` | 拆字規則（逗號、換行、空白、中文、編號、片語）、預覽、去重、100 個字的效能、進度條 |
| `test_step4.py` | 金鑰檢查、模型清單、每批 20 個字、429 重試、截斷時拆半重送、額度用完、停止、失敗重試、手動修改不被覆蓋、金鑰不放在網址裡、字典與 AI 寫入的競態 |
| `test_step5.py` | 複習排序、按鈕／鍵盤／滑鼠／觸控評分、拖不夠會彈回、上下滑不評分、復原、自動取消不熟、每日新字上限、滑完立刻點擊 |
| `test_step6.py` | 四種測驗模式、答錯標記不熟並加入錯題本、Part 5 出題（錯誤選項來自字卡、壞題目被丟掉、題目快取、出新題目、金鑰錯誤）、錯題本重做與清除、手機版面 |
| `test_step7.py` | 統計數字（連續天數、期間加總、正確率、熟練度）、圖表規格（柱寬、空隙、標示、圖例）、提示框（滑鼠與鍵盤）、表格、期間切換、即時更新、深色配色、手機版面 |
| `test_step8.py` | 匯出（檔案格式、不含金鑰）、在全新瀏覽器還原、合併（保留較新的修改、重複合併結果不變）、取消、壞檔案、HTML 注入 |
| `test_pronunciation.py` | 四種口音與多益混合（假語音清單，模擬沒有加拿大口音）、例句與搭配詞發音、聽力題口音、Part 5 朗讀整句 |
| `test_daily_goal.py` | 每日目標設定、進度徽章、達標慶祝（只一次）、測驗也算進度、改目標不影響過去、完成畫面提示 |
| `unit/srs.test.mjs` | 間隔重複演算法：間隔計算、答錯重設、ease 下限、早上 4 點換日、複習清單排序 |
| `unit/parse.test.mjs` | 批次輸入解析：分隔符號、中文與編號、片語、去重 |
| `unit/stats.test.mjs` | 統計計算：連續天數（跨日、跨月、早上 4 點換日）、加總與正確率、熟練度邊界、未來到期、座標刻度 |
| `unit/backup.test.mjs` | 備份：匯出再匯入、不含金鑰、拒絕錯誤檔案、欄位清理、合併規則、重複合併不變、錯題 id 對應 |
| `unit/quiz.test.mjs` | 出題邏輯：錯誤選項（不含答案、不重複、同詞性優先）、遮住答案字、不熟優先、Part 5 題目驗證 |

`capture_screenshots.py` 用來產生 `docs/images/` 裡的截圖。
