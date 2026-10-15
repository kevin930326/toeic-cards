# 多益字卡 TOEIC Cards

**只要輸入英文單字，其餘交給網站。**
中文意思、詞性、音標、淺白英文解釋、多益情境例句、常見搭配詞都會自動產生，再用間隔重複和多益風格測驗幫你記住。

🔗 **線上使用：<https://kevin930326.github.io/toeic-cards/>**（手機可以「加入主畫面」當 App 用，離線也能複習）

<p>
  <img src="docs/images/04-card-ai-zh.png" alt="AI 生成的多益單字卡" width="49%">
  <img src="docs/images/06-part5.png" alt="多益 Part 5 句子填空測驗" width="49%">
</p>

---

## 為什麼做這個

準備多益時，最花時間的不是背，而是**整理單字**：查中文、找例句、確認多益考的是哪個意思。市面上的字卡 App 要嘛要自己一個欄位一個欄位填，要嘛內建的單字不是自己需要的。

這個網站的想法很簡單：**你只需要貼上不會的單字**，其他交給字典和 AI；接著用「答錯的很快再出現、答對的越隔越久」的間隔重複複習，再用仿多益的題型檢驗自己。

## 功能

| | |
|---|---|
| **全站查單字** | 任何頁面點上方「查單字」（或 Ctrl／⌘ K），彈出查詢視窗；本機中文、發音、免費英文解釋，可直接收藏到單字集。關閉後繼續原本的複習或測驗，不使用 Gemini |
| **自動產生字卡** | 本機字典（3.2 萬字，繁體中文）立刻顯示中文和音標；填入 Gemini 金鑰後，AI 會產生**多益情境**的中文意思、淺白英文解釋、2 句例句、搭配詞、詞性變化 |
| **批次新增** | 一次貼上一整段（可以夾雜中文、編號、片語），自動拆字、去除重複，加入前先預覽 |
| **自訂單字集** | 自己命名「人事」「財務」「第 3 回模考」等單字集，批次加入或移出；同一字可屬於多集並共用進度，複習、自由瀏覽和測驗都能限定範圍；支援備份與跨裝置同步 |
| **內建多益 1000 單字包** | 1,000 字均附中文、英文解釋、一組雙語例句與搭配詞，免金鑰、不使用個人 AI 額度；每 100 字分組或全包加入，可自訂集名。已有字可選擇只補空白，保留內容與進度；載入後可離線加入 |
| **間隔重複** | 類似 Anki 的排程（簡化 SM-2）：答錯 10 分鐘後再出現，答對的間隔依 1 → 3 → 8 → 20 天拉長 |
| **自由翻卡** | 「複習 ▾」可選今日複習或自由翻卡；自由模式可翻閱目前單字集全部收藏、切換中英背面、隨機排序或只看不熟，不改排程與打卡紀錄 |
| **單字探索** | 從收藏清單搜尋英文／中文、切換單字集或只看不熟，直接閱讀雙語解釋、例句與搭配詞；上一字／下一字、發音、編輯都不需翻面，瀏覽不改動排程或每日學習量 |
| **滑卡** | 手機往右滑＝會、往左滑＝不熟；電腦上可以用鍵盤 ← → |
| **多益風格測驗** | 看中文選英文、看解釋選單字、**聽力測驗**、**Part 5 句子填空**（AI 出題，錯誤選項取自你自己的字卡）；答錯的字自動進**錯題本** |
| **多益四種口音** | 美、英、加、澳，以及「多益混合」；例句、搭配詞也能點來發音 |
| **每日目標＋連續打卡** | 達標才算打卡；統計頁顯示學習中字數、長期熟記（複習間隔 ≥ 21 天）、每日複習量、熟練度分布與未來 7 天到期量 |
| **離線使用（PWA）** | 可以安裝到手機主畫面或電腦桌面，沒有網路也能複習、測驗、查字典 |
| **跨裝置同步** | 用 Google 或 Email＋密碼登入，手機和電腦自動同步單字、複習進度、學習紀錄和錯題本（Firebase）；不登入也能用 |
| **備份與還原** | 匯出成 JSON，換裝置時匯入（可以合併或取代）；備份不包含金鑰 |
| **深色模式** | 跟隨系統，也可以手動切換 |

### 畫面

<p align="center">
  <img src="docs/images/readme/phones.png" alt="手機畫面：滑卡複習、學習統計（連續打卡、熟練度）、每日複習與測驗圖表" width="100%">
</p>
<p align="center"><sub>手機：滑卡複習 ／ 學習統計 ／ 每日複習與測驗圖表（深色模式）</sub></p>

<table>
  <tr>
    <td width="50%"><img src="docs/images/readme/batch.png" alt="批次新增預覽"></td>
    <td width="50%"><img src="docs/images/06-listen.png" alt="聽力測驗"></td>
  </tr>
  <tr>
    <td align="center"><sub>批次新增：貼上一整段，自動拆字、去重</sub></td>
    <td align="center"><sub>聽力測驗：聽發音選意思</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/06-mistakes.png" alt="錯題本"></td>
    <td width="50%"><img src="docs/images/01-dark-mode.png" alt="深色模式字卡"></td>
  </tr>
  <tr>
    <td align="center"><sub>錯題本：答錯的題目可以重做</sub></td>
    <td align="center"><sub>深色模式</sub></td>
  </tr>
</table>

## 開始使用

第一次開啟且沒有收藏或學習紀錄時，會提供「帶我開始／先自己逛逛」。三步導覽使用獨立練習卡，認識加入單字、今日複習／自由翻卡／探索，以及翻面與評分；不寫入真實字卡或打卡紀錄。已有資料只顯示可關閉的提示。完成、開始或略過後不再自動跳出；在 **設定 → 使用教學** 可隨時查閱或重看。此狀態只存在目前瀏覽器，不跨裝置同步或加入備份。

1. 打開網站，可先用上方「查單字」查意思並收藏；或到「單字庫 › ＋加入單字」輸入、批次貼上或選內建單字包
2. 到「複習」開始翻卡：點一下翻面，往右滑（或按「會」）、往左滑（或按「不熟」）
3. 想讓 AI 產生多益例句和 Part 5 題目：到右上角 **⚙ 設定 › Gemini AI** 填入金鑰（見下方）
4. 手機上：iPhone 用 Safari 的「分享 › 加入主畫面」；Android 用 Chrome 的「安裝應用程式」

### 用單字集分類與學習

單字庫預設隱藏每列的編輯與刪除操作，按「編輯模式」才顯示；按「完成編輯」或離開頁面就恢復收合。星星與發音隨時可用，標記不熟會直接更新該列，保留目前焦點。

在「單字庫」的單字集選單旁點「管理單字集」，於獨立視窗建立名稱，例如「財務」或「第 3 回模考」。按「批次整理」才會顯示勾選框，依「勾選單字 → 選擇單字集 → 套用分類變更」操作；完成整理會清空選取並隱藏方框。全選只針對目前搜尋與範圍的結果，批次整理與編輯模式分開開啟。新增或批次貼上時，也能先指定目的單字集，已有的字只會新增歸屬，保留內容和進度。

「單字集」選單提供全部、未分類與自己的單字集；複習、探索與測驗頁也使用同一個範圍。一個字可屬於多集，只有一份學習進度；移出或刪除單字集都會保留字卡。測驗需要集內至少四個符合題型的字。

### 今日複習、自由翻卡與探索怎麼選？

探索與複習的英文解釋、例句都能直接點字查中文、聽發音，並收藏到自訂單字集。查中文不使用 Gemini 額度；關閉後接著看原本的字。變化形先照原字查詢，未收錄時可以在查詢框改成原形。

- **探索**：想看懂某個已收藏的字，就在清單搜尋或點選。中英文解釋、例句與搭配詞直接顯示，不受到期日或每日新字數限制；閱讀與不熟標記不影響 SRS 或每日學習量。原 `#/cards` 網址仍可使用。
- **今日複習**：系統依到期排程與每日新字上限安排字卡，先回想再翻面，按「會／不熟」會更新下次複習時間，也計入每日目標。
- **自由翻卡**：在「複習」旁的 ▾ 選擇，不受到期日或每日上限限制。點擊／空白鍵翻面，左右滑動、方向鍵或按鈕換字；可隨機排序、只看不熟及切換中英背面。星星只改不熟標記，其他瀏覽不改排程或每日紀錄。複習完成畫面也可直接進入。
- **查單字**：還沒收藏、只想查字典，使用上方的全站查字視窗。

### 加入內建多益單字包

在「單字庫 › ＋加入單字 › 內建單字包」選擇第 1～10 組（每組 100 字），或全部 1,000 字，預覽這次會新增與已存在的字，再選擇目的單字集。也能用網址 `#/words?pack=toeic-1000` 直接開啟。預設名稱是「多益 1000 單」，可以自己命名；同名時沿用既有的集，分批加入不會建立副本。

全部單字已預先撰寫中文、淺白英文解釋、一組雙語例句與搭配詞，另收錄適用的詞形變化與部分同義詞。加入即可翻卡或做英文解釋測驗，不需要 Gemini 金鑰，也不會排隊生成或消耗個人額度；Part 5 即時出題仍需個人金鑰。

已有的字預設只加入單字集；勾選「也替已有單字補上空白內容」可補齊舊版加入的卡片，保留已填內容、手動清空的欄位與複習進度。內建內容以「內建」標記區分，仍可自行編輯。選字來源、拼字修正與內容編製方式見 [單字包資料說明](data/packs/README.md)。

### 取得 Gemini API 金鑰（免費）

1. 到 [Google AI Studio](https://aistudio.google.com/apikey)，用 Google 帳號登入
2. 按「Create API key」，複製產生的金鑰（`AIza` 開頭）
3. 回到網站 **⚙ 設定 › Gemini AI**，貼上後按「儲存並檢查」；網站會自動列出你能用的模型並選好預設
4. 按「**測試 AI**」可以看一次生成要幾秒、內容品質如何

> - 金鑰**只存在你的瀏覽器裡**，只會直接送給 Google，不會上傳到其他地方，也不會被匯出到備份檔
> - 免費方案只能用 Flash／Flash-Lite 系列，有每分鐘與每天的請求上限；網站會自動限速、遇到 429 錯誤時等待後重試
> - 送給 Gemini 的內容只有英文單字；免費方案下 Google 可能會用這些內容改進模型
> - 沒有金鑰也能使用：字典、複習、簡易測驗、聽力測驗都不需要 AI

### 資料存在哪裡？

- **沒登入**：資料只存在**這台裝置的瀏覽器**裡（localStorage）。清除瀏覽器資料就會消失。iPhone 上「主畫面的 App」和「Safari」的資料是分開的。
- **登入後**（⚙ 設定 › 帳號與同步，Google 或 Email＋密碼）：資料會自動同步到雲端（Firebase Firestore）。**清掉瀏覽器資料、換手機，只要重新登入，資料就會回來**。每個帳號只能讀寫自己的資料（[firestore.rules](firestore.rules)）。Gemini 金鑰不會上傳。
- **另外的保險**：在 **⚙ 設定 › 備份與還原** 匯出 JSON 備份檔，自己保存一份。

## 技術與架構

**純 HTML／CSS／JavaScript（ES modules），沒有框架、沒有建置步驟**，放上 GitHub Pages 就能運作（[為什麼這樣選](docs/decisions.md#6-純-htmlcssjavascriptes-modules不使用框架和建置工具)）。

```mermaid
flowchart LR
  user([使用者])
  subgraph browser[瀏覽器（全部在這裡執行）]
    ui[畫面<br/>js/views/*]
    logic[純邏輯模組<br/>srs・quiz・parse・stats・backup]
    store[(localStorage<br/>單字・紀錄・錯題・設定)]
    sw[Service Worker<br/>離線快取]
    speech[Web Speech API<br/>發音・四種口音]
  end
  dict[(本機字典<br/>ECDICT 子集・繁體<br/>data/dict/a–z.json)]
  fd[Free Dictionary API<br/>英文解釋備援]
  gemini[Google Gemini API<br/>使用者自己的金鑰]

  user --> ui
  ui <--> logic
  ui <--> store
  ui --> speech
  ui -- 中文・音標 --> dict
  ui -- 沒有金鑰或 AI 失敗時 --> fd
  ui -- 多益解釋・例句・Part 5 出題<br/>每 20 字一次請求、限速、重試 --> gemini
  sw -. 快取網站檔案與字典 .- ui
```

| 部分 | 做法 |
|---|---|
| 單字資料 | **字典＋AI 混合**：[ECDICT](https://github.com/skywind3000/ECDICT) 篩出 32,812 個常用字，用 OpenCC 轉台灣繁體，依首字母拆成 26 個檔案（共 2.75MB）按需載入；Gemini 補上多益情境的解釋與例句 |
| AI | Gemini 免費方案，**一次請求放 20 個字**、用 JSON Schema 規定格式；自動限速、429 依 Google 指示等待、回應被截斷時拆半重送、關閉模型的「思考」以加快速度 |
| 複習 | 簡化 SM-2 演算法（純函式，有單元測試），一天從早上 4 點開始算 |
| 圖表 | 自己用 SVG 畫，依照資料視覺化規範配色，並用工具驗證色盲可讀性 |
| 離線 | Service Worker：網站檔案先連網、斷線用快取；字典與字型有快取就用快取 |
| 測試 | Playwright 端對端測試（字典與 AI 使用假回應、Firebase 使用本機模擬器）、Node 單元測試 99 項；測試範圍見 [tests/README.md](tests/README.md) |

重要的技術選擇與取捨（共 76 條）都記錄在 **[docs/decisions.md](docs/decisions.md)**，例如：
- [為什麼讓使用者自己填金鑰](docs/decisions.md#2-讓使用者自己填-api-金鑰網站維持純前端)
- [批次生成：每個請求放 20 個字](docs/decisions.md#14-每個請求放-20-個字用-json-schema-規定輸出格式)
- [一個偶發的競態 bug 是怎麼找到的](docs/decisions.md#31-檢查和寫入之間不能有等待避免非同步的競態)
- [為什麼不用綠／紅表示會／不熟](docs/decisions.md#33-會不熟用藍橘兩個系列色不用綠紅)

## 在自己的電腦上執行

需要 Python（只用來開一個簡單的網頁伺服器）：

```bash
git clone https://github.com/kevin930326/toeic-cards.git
cd toeic-cards
python -m http.server 8000
```

然後用瀏覽器打開 http://localhost:8000 。

> 一定要透過伺服器開啟（不能直接雙擊 `index.html`），因為網站用了 ES modules 和 Service Worker。

## 測試

```bash
pip install playwright
playwright install chromium
node --test "tests/unit/*.test.mjs"        # 單元測試（不需要瀏覽器）
python -m http.server 8123 --bind 127.0.0.1  # 另開一個終端機
python tests/test_step1.py                   # 端對端測試（step1～step9 等）
```

每個測試檔案在測什麼，請看 [tests/README.md](tests/README.md)。

## 專案結構

```
index.html              頁面骨架
manifest.webmanifest    PWA 設定（名稱、圖示、全螢幕）
sw.js                   Service Worker（離線快取）
css/style.css           全部樣式（淺色／深色兩套色彩）
js/
  app.js                路由、主題、PWA 初始化
  store.js              資料儲存（localStorage）
  srs.js  quiz.js  parse.js  stats.js  backup.js  word-sets.js   純邏輯（都有單元測試）
  dictionary.js         本機字典＋Free Dictionary
  llm.js  generate.js  part5.js                    Gemini：請求、批次生成、Part 5 出題
  speech.js  swipe.js  charts.js  cardview.js  pwa.js ...
  views/                各頁面：複習、探索、測驗、單字庫、統計、設定
data/dict/              字典子集（a.json ~ z.json）
data/packs/             內建單字包、來源與整理紀錄
icons/                  App 圖示
tools/                  產生字典與圖示的腳本
tests/                  端對端測試、單元測試、截圖腳本
docs/                   開發紀錄、技術決策、截圖
```

## 開發過程

這個專案也是作品集，所以留下了完整的開發過程：

- **[docs/dev-log/](docs/dev-log/)**：每個功能一份紀錄，包括目標、做法、遇到的問題與解法、測試結果和截圖
- **[docs/decisions.md](docs/decisions.md)**：76 條技術決策，記錄選擇的理由與取捨
- **Git commit 歷史**：每完成一個小功能就 commit 一次，bug 修正都另外獨立成 commit

## 資料來源與授權

- 英漢字典：[ECDICT](https://github.com/skywind3000/ECDICT)（MIT License），用 [OpenCC](https://github.com/BYVoid/OpenCC) 轉換成台灣繁體
- 內建單字包：使用者提供的《【刷刷鍋】多益一千單字表》英文選字；原始翻譯、例句與版面未收錄，來源與修正見 [data/packs/README.md](data/packs/README.md)
- 英文解釋備援：[Free Dictionary API](https://dictionaryapi.dev/)
- AI：[Google Gemini API](https://ai.google.dev/)（使用者自己的金鑰）
- 發音：瀏覽器內建的 Web Speech API
- 字型：[Fraunces](https://fonts.google.com/specimen/Fraunces)、[Noto Sans TC](https://fonts.google.com/noto/specimen/Noto+Sans+TC)（SIL Open Font License）
