# 測試

用 [Playwright](https://playwright.dev/python/) 開瀏覽器，實際操作網站來測試（端對端測試）。

外部服務都換成**假的回應**，所以測試不需要網路，也不需要 API 金鑰：

- Gemini API：模擬正常回應、429 速率限制、錯誤金鑰、回應被截斷、漏掉單字
- Free Dictionary API：模擬正常回應、查無此字、伺服器掛掉（522）
- 語音播放：攔截 `speechSynthesis.speak`，記錄唸了什麼字、用什麼口音

既有功能測試透過 `onboarding_helpers.existing_user()` 在測試瀏覽器建立「已略過教學」狀態，避免首次歡迎視窗攔住原測試；這是測試初始資料，不是產品開關。真正空白／舊資料的新手體驗由 `test_onboarding.py` 獨立驗證。`test_word_packs.py` 另檢查教學在真正離線重新整理後仍能操作。

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
python tests/test_step9.py   # 可加 LAN_URL=http://你的區網IP:8000/ 測試非 HTTPS 的情況
python tests/test_ai_speed.py
python tests/test_step11.py   # 需要先啟動 Firebase 模擬器（見檔案開頭說明，需要 Java）
python tests/test_word_sets.py # 自訂單字集（不需要 Firebase）
python tests/test_word_packs.py # 內建多益單字包（不需要 Firebase）
python tests/test_library_ui.py # 全站查字與單字庫 B 方案介面（不需要 Firebase）
python tests/test_explore.py    # 單字探索、直接閱讀與複習分工（不需要 Firebase）
python tests/test_inline_lookup.py # 解釋與例句點字查詢、收藏及複習狀態保護
python tests/test_library_interactions.py # 1000字互動、星星局部更新與編輯模式
python tests/test_free_cards.py # 複習選單、自由翻卡與排程／紀錄隔離
python tests/test_onboarding.py # 真正首次體驗、舊資料提示、三步教學、重看及資料隔離
```

改完 JS 之後，可以先用 Node 檢查所有檔案的語法（很快，能抓到打錯字造成整個網站打不開的問題）：

```bash
for f in js/*.js js/views/*.js sw.js; do node --check "$f" || echo "語法錯誤：$f"; done
```

可以用環境變數 `BASE_URL` 指定網址。測試截圖會存在 `tests/screenshots/`，這個資料夾不會上傳到 git。

`test_word_packs.py` 的離線檢查會等待包含版本參數的 JS 檔完成快取，並在真正離線重新整理後驗證逐字查詢視窗仍可開啟。

`test_step7.py` 另外驗證「學習中」排除新字與熟悉中字、「長期熟記」的 21 天說明、期間切換不影響目前熟練度，以及 320／375px 版面。

`test_free_cards.py` 另量測 1280／768／375／320px 的中英切換高度及張數垂直對齊，避免段落 margin 再次撐高按鈕。

`test_library_interactions.py` 也涵蓋批次勾選框預設隱藏、三步驟工具、全選目前搜尋結果、取消選取、結束模式後清空選取、整理與編輯模式互斥，以及 320／375px 批次工具排版；分類實際加入／移出由 `test_word_sets.py` 與 `test_library_ui.py` 回歸。

| 檔案 | 測試內容 |
|---|---|
| `test_onboarding.py` | 歡迎視窗、略過／Escape／完成後不再提示、舊字卡或僅紀錄的提示列、三步前後切換與練習翻面／評分、正式資料完全不變、無外部API、設定重看、直接連結與不疊窗、儲存被封鎖及320／375px／深色畫面 |
| `unit/onboarding-state.test.mjs` | 空白／舊資料分流、三種教學狀態、清空學習資料後仍不重複提示、錯誤格式紀錄 |
| `test_free_cards.py` | 複習選單開關／Escape／外側關閉／焦點與按鍵隔離、完成畫面入口、未到期字卡全覽、翻面、換字、隨機、中英切換、單字集與空範圍、不熟篩選、點字與發音、真實觸控滑動、SRS／紀錄不變及320／375px；離線1000字由 `test_word_packs.py` 覆蓋 |
| `test_library_interactions.py` | 1000 字進頁／星星處理時間、保留原列節點與焦點、本機儲存及 SRS、編輯／刪除預設隱藏、開啟及完成編輯、切頁恢復關閉、搜尋完整範圍與手機排版；時間只記錄，不用固定門檻判定 |
| `test_inline_lookup.py` | 解釋／例句點字查中文、桌面／手機／鍵盤、收藏到指定集、去重、關閉後焦點與原卡翻面／剩餘張數／SRS／每日紀錄保留、探索選字保留、HTML 安全顯示、不呼叫外部 API |
| `unit/word-tokens.test.mjs` | 保留原句標點與空白、重音拼字、大小寫、連字號與撇號、非英文文字及不猜測變化形 |
| `test_library_ui.py` | 六個頁面的全站查字、Ctrl／⌘ K 入口、Escape 關閉、免費英文與失敗重試、收藏／去重、獨立新增／批次／單字包／分類視窗、清單篩選、批次整理、複習／測驗不誤觸、320／375／768px 與深色畫面、不呼叫 Gemini |
| `test_explore.py` | 探索清單與直接雙語閱讀、搜尋／分類／不熟篩選、選字保留、發音／編輯、空結果、背景刪除、鍵盤與查字視窗、SRS／每日紀錄不變、今日複習翻面與評分、320／375／768px；另量測詞性與解釋在桌面及手機的相對位置 |
| `unit/explore.test.mjs` | 搜尋正規化與 Unicode、組合篩選、順序與進度不變、選字失效與空範圍、前後循環 |
| `test_step1.py` | 新增、刪除、編輯、搜尋、探索直接雙語閱讀、標記不熟、重新整理後資料保留、深色模式、手機複習翻面 |
| `test_step2.py` | 本機字典查詢（繁體）、Free Dictionary 依詞性挑解釋、發音與口音設定、手動修改不被覆蓋、API 掛掉後自動重試 |
| `test_step3.py` | 拆字規則（逗號、換行、空白、中文、編號、片語）、預覽、去重、100 個字的效能、進度條 |
| `test_step4.py` | 金鑰檢查、模型清單、每批 20 個字、429 重試、截斷時拆半重送、額度用完、停止、失敗重試、手動修改不被覆蓋、金鑰不放在網址裡、字典與 AI 寫入的競態 |
| `test_step5.py` | 複習排序、按鈕／鍵盤／滑鼠／觸控評分、拖不夠會彈回、上下滑不評分、復原、自動取消不熟、每日新字上限、滑完立刻點擊 |
| `test_step6.py` | 四種測驗模式、答錯標記不熟並加入錯題本、Part 5 出題（錯誤選項來自字卡、壞題目被丟掉、題目快取、出新題目、金鑰錯誤）、錯題本重做與清除、手機版面 |
| `test_step7.py` | 統計數字（連續天數、期間加總、正確率、熟練度）、圖表規格（柱寬、空隙、標示、圖例）、提示框（滑鼠與鍵盤）、表格、期間切換、即時更新、深色配色、手機版面 |
| `test_step8.py` | 匯出（檔案格式、不含金鑰）、在全新瀏覽器還原、合併（保留較新的修改、重複合併結果不變）、取消、壞檔案、HTML 注入 |
| `test_pronunciation.py` | 四種口音與多益混合（假語音清單，模擬沒有加拿大口音）、例句與搭配詞發音、聽力題口音、Part 5 朗讀整句 |
| `test_daily_goal.py` | 每日目標設定、進度徽章、達標慶祝（只一次）、測驗也算進度、改目標不影響過去、完成畫面提示 |
| `test_step9.py` | manifest 與圖示、Service Worker 快取、離線字典、真正離線時重新整理／複習／測驗／查字典、AI 生成暫停與恢復、安裝按鈕、App 模式、iPhone 教學、非 HTTPS 提示 |
| `test_ai_speed.py` | 思考設定（2.5 用 budget 0、3 以後 minimal → low → 不帶）、不支援時自動換並記住、第一批 5 個字、失敗時用字典補、測試 AI 按鈕、請求耗時顯示 |
| `test_step11.py` | 跨裝置同步（Firebase 模擬器）：Google 與 Email 連結登入、多台裝置雙向同步、每日紀錄加總、刪除、設定、錯題本、自動同步、離線補傳、安全規則、iPhone 貼上連結、登出 |
| `test_word_sets.py` | 自訂單字集：建立／改名／刪除、同字多集、批次加入／移出、既有單字歸類、限定複習／測驗／自由瀏覽、共用進度、備份版本相容、改拼字、HTML 注入、手機深色與離線操作 |
| `test_word_packs.py` | 單字包：按需載入、主檔及內容檔失敗重試、十組與全部加入、預覽與去重、同名／現有集、舊卡補空白且保留自訂內容與進度、特殊拼字、完整內容不呼叫 Gemini（含重連、生成缺項及批次重試）、備份、直接展開連結、手機深色與真正離線重新整理後加入全部 1,000 張完整字卡 |
| `unit/word-packs.test.mjs` | 單字包資料：1,000 字唯一性與來源修正、十組順序、預製內容完整性與錯誤格式拒絕、預覽計數、本機中文覆蓋、重音正規化、來源／內容版本／不自動生成標記的備份與同步、補空白保護手動欄位 |
| `unit/word-sets.test.mjs` | 單字集純邏輯：範圍篩選、個別成員的時間合併、移出與刪除紀錄、同時修改的結果一致、格式清理、備份往返與合併 |
| `unit/srs.test.mjs` | 間隔重複演算法：間隔計算、答錯重設、ease 下限、早上 4 點換日、複習清單排序 |
| `unit/parse.test.mjs` | 批次輸入解析：分隔符號、中文與編號、片語、去重 |
| `unit/stats.test.mjs` | 統計計算：連續天數（跨日、跨月、早上 4 點換日）、加總與正確率、熟練度邊界、未來到期、座標刻度 |
| `unit/backup.test.mjs` | 備份：匯出再匯入、不含金鑰、拒絕錯誤檔案、欄位清理、合併規則、重複合併不變、錯題 id 對應 |
| `unit/sync.test.mjs` | 同步合併規則：新增／更新／刪除與刪除後修改、重複套用不變、只傳變更、每日紀錄加總、同步設定的範圍、錯題 id 對應 |
| `unit/quiz.test.mjs` | 出題邏輯：錯誤選項（不含答案、不重複、同詞性優先）、遮住答案字、不熟優先、Part 5 題目驗證 |

`capture_screenshots.py` 用來產生 `docs/images/` 裡的截圖。

`test_step11.py` 也會驗證單字集的 Firestore 交易合併：兩台裝置同時建立、改名與成員修改互不覆蓋、離線裝置不復活已刪分類，以及其他帳號無法讀取分類。Firebase SDK 和字型快取測試需要連線取得公開檔案；帳號與資料僅寫入 `demo-toeic` 本機模擬器。

`test_deployed.py` 是部署後的冒煙測試，直接測真正的 GitHub Pages 網址（子路徑、HTTPS、Service Worker、離線）：

```bash
python tests/test_deployed.py
```
