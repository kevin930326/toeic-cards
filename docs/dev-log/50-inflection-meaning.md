# 第 50 步：變化形的中文意思

## 目標

使用者查 `receives`，畫面顯示「n. 受光面」，看起來完全不對。receives 是 receive 的第三人稱單數，應該是「收到、接到」。

## 做法

擴充字典（第 30 步）裡，變化形會記下原形（`l`）和變化種類（`f`：第三人稱單數、複數、過去式、現在分詞……），中文則直接沿用 ECDICT 原文。原文有時是同一個拼字的另一個冷門意思，詞性也就和變化種類對不上：第三人稱單數一定是動詞，receives 卻標成名詞。

`js/dictionary.js` 的 `inflectionFix` 在查到變化形時比對詞性：

- 詞性對得上（例如 offers 是複數、中文也是名詞）→ 不動
- 只有 -s 形或比較級／最高級，詞性對不上 → 改用原形的意思（receives → receive「收到；接到…」）
- 有 -ing／-ed 形，詞性對不上 → 保留自己的意思，後面補上原形的意思（substituting「n. 代入；取代」＋ substitute 的動詞意思）

查單字視窗、收藏字卡、新增單字自動補中文都經過同一個函式，所以一次修好。畫面上仍標示「receives 是 receive 的第三人稱單數」，收藏時保留原拼字。

## 遇到的問題與解法

- **不能一律換成原形**：統計擴充字典 53,559 個變化形，有 6,449 個詞性對不上，其中 -ing／-ed 形很多是有用的衍生意思（doing 行為、spoofing 電子欺騙），所以依變化種類分兩種處理。
- **測試選錯字**：fencing 同時收在常用小字典，那裡沒有變化形標記，本來就不會被調整；改用只在擴充字典的 substituting 測試。

## 測試結果

用 webapp-testing 新增 `tests/test_inflection_meaning.py`：receives、viables 改用原形意思；substituting 保留並補上原形意思；offers、bearing 不變；查單字視窗不再出現「受光面」，收藏的字卡也用原形中文。另重跑 dictionary_scale、lookup_suggestions、unknown_words、inline_lookup、card_lookup_mode，全部通過。

![receives 改顯示 receive 的意思](../images/50-inflection-meaning.png)
