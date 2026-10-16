# 第 50 步：變化形的中文意思

## 目標

使用者查 `receives`，畫面顯示「n. 受光面」。receives 是 receive 的第三人稱單數，應該是「收到、接到」。使用者接著問：其他字有沒有檢查？為什麼會這樣？能不能避免？

## 為什麼會這樣

擴充字典（第 30 步）來自 ECDICT。ECDICT 合併了一般字典、專業術語表、縮寫表等很多來源，變化形的拼字常剛好撞到別的詞條：

- receives「n. 受光面」（光學術語）
- scans「abbr. 網路系統自動程式控制」、bids「商業智慧開發工具集」（縮寫）
- faring「法林（遊戲中的地名）」、fared「法依笛（服裝品牌）」
- samples「例子（suffer 的複數形式）」（原文就寫錯）

建字典檔時，變化形記下了原形（`l`）和變化種類（`f`），但中文直接照抄這些詞條。

## 做法

變化形的意思本來就等於原形的意思，所以 `js/dictionary-data.js` 的 `inflectionMeaning` 改成：

1. **一律先顯示原形的意思**（receives → receive「收到；接到…」）
2. 字典原文只有在多出**原形沒有的詞性**時，才放在最後一行「另有：…」：exceeding 的形容詞「非常的」、promoted「晉升的」、vitals 的名詞「要害」
3. 不顯示：沒有詞性標記的術語、縮寫／人名／地名／品牌／遊戲、-s 形詞性對不上的冷門同形字、動詞的「名詞複數」（terminates「n. 結束」）、只是重複原形意思的寫法，以及「（offer 的複數）」這類說明

查單字視窗、收藏字卡、新增單字自動補中文都經過 `lookupLocalResult`，所以一次修好。畫面仍標示「receives 是 receive 的第三人稱單數」，收藏時保留原拼字。常用小字典的獨立詞條（bearing、savings、interesting）沒有變化形標記，不受影響；多益 1000 單字包的字卡內容是另外撰寫的，也不受影響。

## 檢查範圍與結果

用 Node 腳本把規則套到**多益 1000 單字包每個字的所有變化形**（只在擴充字典的 1,346 個），逐一列出結果檢查：

| 版本 | 結果 |
|---|---|
| 修正前 | 抽查發現受光面、縮寫、遊戲地名、錯的原形等多種錯誤 |
| 第一版（只看詞性對不上） | 修好 154 個，但縮寫、沒有詞性的術語、錯的說明仍漏掉 |
| 原形意思＋全部原文 | 1,104 個字多出只是換個說法的「另有」，太雜 |
| 最終規則 | 全部以原形意思為主，只有 112 個字有「另有」，抽查多為合理的形容詞／名詞用法 |

整本擴充字典 49,749 個可對到原形的變化形，最後有 1,722 個帶「另有」。

## 遇到的問題與解法

- **規則太鬆或太嚴**：第一版只處理詞性對不上的字，漏掉縮寫和術語；第二版保留全部原文，雜訊太多。最後改成「新詞性才列」，並用原形是不是形容詞，區分 durables／vitals（形容詞轉來的名詞，保留）和 terminates（動詞的名詞複數，不存在）。
- **測試選錯字**：fencing 同時收在常用小字典，那裡沒有變化形標記，本來就不會被調整。

## 測試結果

用 webapp-testing 新增 `tests/test_inflection_meaning.py`：receives、scans、faring、samples、offers 改用原形意思且不顯示錯誤內容；exceeding、vitals 列出新詞性；durables 不重複列；bearing 不變；查單字視窗與收藏的字卡都正確。另重跑 dictionary_scale、lookup_suggestions、unknown_words、inline_lookup、card_lookup_mode、step2、step3，全部通過。

![receives 改顯示 receive 的意思](../images/50-inflection-meaning.png)
