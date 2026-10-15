# 內建單字包資料

`toeic-1000.json` 是第一份單字包，包含 1,000 個不重複英文單字。網站沿用清單順序，每 100 字分一組，分組不是難度分級，也不代表官方出題頻率。

## 來源與整理範圍

- 選字依使用者提供的《【刷刷鍋】多益一千單字表》PDF 整理。原檔共 100 頁，每頁 10 筆；原始 PDF 不加入 Git。
- 從 PDF 只整理英文選字，不收錄原 PDF 的中文翻譯、中英例句、商標或版面。單字包的解釋與例句由 AI 另行撰寫；一般查字仍使用既有 ECDICT 子集與專案補充詞義。
- JSON 的 `source.sha256` 記錄原始 PDF 的 SHA-256，可確認重建時是否使用同一份原檔。
- 抽取時保留 `résumé` 的重音與 `blue-collar` 的連字號，並把 PDF 字距造成的 `c r e a t e` 還原為 `create`。

## 拼字修正

以下三筆經過 PDF 畫面與同筆英文例句對照後修正，詳細頁碼也記在 JSON 的 `source.corrections`：

| PDF 頁碼 | 原單字標題 | 網站採用 |
|---|---|---|
| 46 | aprove | approve |
| 59 | nconvenience | inconvenience |
| 62 | ompulsory | compulsory |

修正後仍為 1,000 個不重複單字，沒有加入清單以外的新選字。

## 重建

使用已安裝 `pypdf` 的 Python 環境執行：

```bash
python tools/extract_toeic_pack.py --source "原始 PDF 路徑"
```

預設輸出 `data/packs/toeic-1000.json`。腳本會驗證每頁 10 筆、總數 1,000、修正後不重複，以及拼字格式；遇到不符合的情況會中止，不會自行補字。

`js/dictionary-extra.js` 另有 15 個本機字典缺詞的基本詞義，以及 `download` 的中文勘誤。這些詞義由專案自行整理，與原 PDF 翻譯分開；不改動既有 ECDICT 原始子集。

## 預先編製的學習內容

`toeic-1000/01.json`～`10.json` 各含 100 筆完整字卡，與英文清單順序一致。每字包含詞性、台灣繁體中文詞義、淺白英文解釋、一組原創雙語例句與搭配詞；適用時附詞形變化及部分同義詞。不強行為每個字補出不自然的同義詞。

- 撰寫來源：`tools/word-pack-content.txt`，每行七欄；`tools/word-pack-related.json` 補充詞族與同義詞。均由 AI 為本專案撰寫，未呼叫使用者的 Gemini API。
- 音標取自既有 ECDICT 子集；不規則變化取自 MIT 授權 ECDICT 的 `exchange` 欄位，依詞性選取，排除與原字相同的變化，不自行猜字尾。
- 重建內容檔：先依 `tools/build_dict.py` 的說明備妥本機 `data/raw/ecdict.csv`，再執行 `python tools/build_pack_content.py`。網站直接讀取已提交的 JSON，使用者不需執行腳本。
- 單元測試驗證 1,000 字覆蓋、順序、欄位完整與格式；另檢查例句包含目標字或其變化形、例句未重複。這些是內容與結構檢查，並非語言教師逐字審訂，亦不是官方多益教材。
- 內容版本目前為 1；內容與來源標記隨字卡備份及同步。新版靜態檔不會自動覆蓋使用者已加入或編輯的字卡。
