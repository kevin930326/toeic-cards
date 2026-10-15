# 內建單字包資料

`toeic-1000.json` 是第一份單字包，包含 1,000 個不重複英文單字。網站沿用清單順序，每 100 字分一組，分組不是難度分級，也不代表官方出題頻率。

## 來源與整理範圍

- 選字依使用者提供的《【刷刷鍋】多益一千單字表》PDF 整理。原檔共 100 頁，每頁 10 筆；原始 PDF 不加入 Git。
- 只收錄英文單字，不收錄原 PDF 的中文翻譯、中英例句、商標或版面。網站中的中文來自既有 ECDICT 子集與專案自行整理的補充詞義。
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
