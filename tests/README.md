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
python tests/test_step1.py
python tests/test_step2.py
python tests/test_step3.py
python tests/test_step4.py
```

可以用環境變數 `BASE_URL` 指定網址。測試截圖會存在 `tests/screenshots/`，這個資料夾不會上傳到 git。

| 檔案 | 測試內容 |
|---|---|
| `test_step1.py` | 新增、刪除、編輯、搜尋、翻卡、中英切換、標記不熟、重新整理後資料保留、深色模式、手機版面 |
| `test_step2.py` | 本機字典查詢（繁體）、Free Dictionary 依詞性挑解釋、發音與口音設定、手動修改不被覆蓋、API 掛掉後自動重試 |
| `test_step3.py` | 拆字規則（逗號、換行、空白、中文、編號、片語）、預覽、去重、100 個字的效能、進度條 |
| `test_step4.py` | 金鑰檢查、模型清單、每批 20 個字、429 重試、截斷時拆半重送、額度用完、停止、失敗重試、手動修改不被覆蓋、金鑰不放在網址裡 |

`capture_screenshots.py` 用來產生 `docs/images/` 裡的截圖。
