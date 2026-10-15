# 第 23 步：資安審查與修正

## 目標

專案公開在 GitHub，也實際存放使用者的 Gemini 金鑰和學習資料。用攻擊者的角度把整個專案檢查一次：網頁注入（XSS）、金鑰處理、Firebase 安全規則、外部載入的程式、匯入與同步的資料、git 歷史，找到問題就修，並留下測試避免再犯。

## 審查範圍與結果

| 項目 | 結果 |
|---|---|
| git 歷史有沒有金鑰 | ✅ 只有 Firebase 的公開識別碼，而且只在 `js/firebase-config.js` |
| Gemini 金鑰 | ✅ 放在 HTTP 標頭，不在網址；不會匯出到備份 |
| AI、字典、備份裡的文字內容 | ✅ 顯示前都有跳脫 |
| 設定值 | ✅ 匯入時檢查型別；模型名稱編碼後才放進網址 |
| **匯入備份的單字 id** | 🔴 **可以注入程式**（見下方） |
| 同步下來的設定、錯題本 | 🟡 沒有清理（只有本人能寫，但帳號被盜時是破口） |
| 內容安全政策（CSP） | 🟡 沒有 |
| Firestore 規則 | 🟡 只限本人，但不限路徑和格式 |

做法：先列出程式裡所有把資料放進 HTML 的地方（322 處），排除程式自己產生的固定文字和數字，再追查剩下的「外部資料」從哪裡進來、進來時有沒有清理。

## 找到的漏洞：匯入惡意備份會執行別人的程式

匯入備份時每個欄位都會清理，但單字的 `id` 只限制長度；單字庫畫面又把 `id` 直接放進 `data-id="…"` 屬性。實際做出一份假備份，把 `"><img src=x onerror=…>` 藏在 id 裡，匯入後打開單字庫，程式就執行了，而且讀得到 Gemini 金鑰（測試用的假金鑰）。

可能的情境：有人分享「多益單字備份，匯入就能用」的檔案，使用者一匯入，對方就能偷走金鑰、用使用者的登入身分讀寫同步資料。

第一次做驗證時程式沒有執行，追查後發現是攻擊字串超過 id 的 80 字上限被截斷、語法壞掉，不是真的安全；改用較短的字串就成功了。所以長度限制不能算防護。

## 修正

1. **id 只接受英數字、`-`、`_`**（[decisions #77](../decisions.md)）：`sanitizeWord` 不合格的 id 換成 `imp-單字`；畫面的 `data-id` 也跳脫。同步下來的單字也經過 `sanitizeWord`，一起修好。
2. **雲端資料也清理**（[#78](../decisions.md)）：設定、其他裝置的每日紀錄、錯題本拉下來時，套用和匯入備份同一套清理函式。
3. **內容安全政策**（[#79](../decisions.md)）：只允許自己的程式、Firebase SDK 與 Google 登入腳本；連線只能到 Google API 和 Free Dictionary。原本內嵌在 `index.html` 的主題腳本搬到 `js/theme-init.js`，CSP 就能完全禁止內嵌程式。這樣就算以後又漏了跳脫，混進來的程式也不會執行，資料也送不出去。
4. **Firestore 規則限制路徑與格式**（[#80](../decisions.md)）：只能寫網站用到的三種資料，欄位名稱、型別、大小都要對；其他路徑一律拒絕，避免有人註冊帳號後把資料庫當免費雲端硬碟。

這次修改每一項都可以獨立運作，新舊檔案短暫混用也不會出錯，所以沒有更新模組的版本參數。

## 遇到的問題與解法

- **CSP 會不會擋到 Google 登入**：沒辦法用真的帳號測。直接讀 Firebase SDK 13.0.0 原始碼，列出它會連的網址（`identitytoolkit`、`securetoken`、`firestore` 都在 `*.googleapis.com`；Google 登入會載入 `apis.google.com/js/api.js`，再開 authDomain 的隱藏 iframe），全部放進允許清單，再用測試確認這些網址都沒有被擋。
- **Firebase 模擬器被 CSP 擋住**：模擬器在 `http://127.0.0.1`，不該為了測試放進正式網站的 CSP。同步測試改用 Playwright 的 `bypass_csp`，正式網址另外在 `test_security.py` 檢查。
- **CSP 擋到測試工具**：加上 CSP 後，`test_step9`、`test_ai_speed` 失敗，原因是 Playwright 的 `wait_for_function("某個運算式")` 會在頁面裡用 `eval` 執行字串，而 CSP 禁止 `eval`（這正是 CSP 該擋的東西）。改成 `wait_for_function("() => 運算式")` 的函式寫法就不需要 `eval`。選擇修測試而不是讓測試繞過 CSP，這樣測試跑的環境和正式網站一樣。
- **新測試字和舊測試撞名**：新加的注入測試字 `xssid` 也符合舊測試找 `xss` 的條件，改名為 `idinject`。

## 測試結果

使用 `webapp-testing` 的 Python Playwright 流程。

- **新增 `tests/test_security.py`（11 項）**：網站有 CSP 且沒有內嵌程式；單字包、各頁、點字查詢、測驗、Gemini、Firebase SDK、Google 登入腳本與 iframe、Service Worker 都沒有 CSP 違規；`onerror` 屬性、外部網站腳本不會執行，資料送不出去；主題設定重新整理後照樣套用。外部服務都用假回應，沒有連到真的 Google 或登入。
- **`test_step8.py`**：新增「備份裡夾帶 HTML 的 id 會被換成安全的 id，不會執行」。
- **`test_step11.py`（Firebase 模擬器，套用新規則）**：新增「只允許網站用到的路徑和欄位格式」，原有的雙向同步全部照常通過。
- **單元測試**：新增 4 項（id 格式、雲端設定、雲端每日紀錄、雲端錯題本），合計 103 項通過。
- 全部端對端測試重跑通過。

## 需要使用者自己做的

- 到 Firebase 主控台 › Firestore › 規則，貼上新的 `firestore.rules` 並發布（規則不會跟著 git push 更新）。
- Google Cloud Console 限制 Firebase API 金鑰只能從 `kevin930326.github.io` 和 `localhost` 使用。
- 確認 Authentication 的「電子郵件列舉保護」有開；維持免費的 Spark 方案。
