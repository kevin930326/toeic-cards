# 教材來源與題目審核

## 目前狀態

原內建詞性題 471 題已做第一輪檢視；目前 **75 題啟用、396 題待覆核並停用**。啟用題由 AI 核對句法、選項、翻譯與解析，**尚未經英文教師逐題覆核，也不是 ETS 官方題目**。不能把格式測試或這次初審視為「471 題答案唯一」的證明。

逐題狀態、理由、來源行號與內容 SHA-256 見 [`review.json`](../tools/form-questions/review.json)。待覆核題保留原始內容，但不進入內建測驗。修訂題目後必須更新審核記錄，編題工具會拒絕審核內容與原始題目不一致的版本。

## 已修正的歧義

| 目標字 | 原問題 | 修正 |
|---|---|---|
| complementary | complement／complemented 缺少時態限制 | 改為 must complement，助動詞要求原形 |
| negligent | negligence／neglect 都是名詞 | 移除 neglect，換成形容詞 neglectful |
| selection | select 也可作形容詞修飾 candidates | 改為 has selected，要求過去分詞 |
| allocate | budget allocation／budget allocated 都可能成立 | 改為 will allocate |
| obtain | can be obtained／obtainable 都可作補語 | 改為 can obtain |
| reimbursement | will be reimbursed／reimbursable 都可能成立 | 改為 will reimburse |
| enforce | will be enforced／enforceable 都可能成立 | 改為 will enforce |
| match | matching／matched pants 都有合理解讀 | 改為 must match |
| specialize | specializes／specialized 缺少時態線索 | 改為 will specialize |
| occur | occurs 也能描述週期性事件 | 加入 yesterday |

文法依據：[Cambridge：情態動詞後接動詞原形](https://dictionary.cambridge.org/grammar/british-grammar/modality)；[Cambridge：neglect 同時可作動詞與名詞](https://dictionary.cambridge.org/us/dictionary/english/neglect)。其他仍有動名詞、名詞複合、分詞或不同合理語意的題目，先列待覆核，沒有只憑原解析「要名詞／要形容詞」就放行。

## AI 生成與限制

自訂單字的詞性題與 Part 5 先生成一批候選題，再以**另一次請求**檢查：只給句子、打亂的四個選項與翻譯，不揭露原指定答案；要求列出所有合理選項、逐選項理由，以及翻譯是否一致。只有唯一有效選項與原答案一致時採用。回應缺漏、不確定或多解均拒用。

這仍由同一個模型檢查，可能重複相同誤判，不能等同人工或獨立專家的審核。每批需要生成與覆核兩次請求，會增加等待及個人 Gemini 額度使用；已通過檢查的題目可重用。畫面顯示 AI 參與狀態，作答後可查看每個選項的理由。

## 回報、停用與舊版本

- 每道句子題可按「題目有疑義？停用並回報」。回報先留在目前帳號的本機，該題該修訂版不再使用；尚未作答時跳過不增加學習紀錄。
- 測驗首頁可匯出回報，再自行到 GitHub 提交；網站不會自動公開自訂題目或傳送訊息。回報不跨裝置同步。
- 舊 AI 快取沒有新版覆核標記時不再出題。詞性題庫使用修訂 ID 與內容指紋；內建內容改版後，舊錯題封存，不再重做或重新計分。
- 封存的錯題仍保留在 JSON 備份，沒有悄悄刪除。過去已產生的每日總數不會自動扣除，因歷史紀錄不含逐題事件，無法可靠重算。

其他教材來源見 [單字包來源](../data/packs/README.md)。PDF 只取英文選字；中文字義、英文解釋及例句另行撰寫。AI 內容與裝置語音皆有品質限制，請以教材和正式練習交叉確認。
