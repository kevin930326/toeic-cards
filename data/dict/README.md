# 中文字典資料

來源：[ECDICT](https://github.com/skywind3000/ECDICT)，[MIT 授權](https://github.com/skywind3000/ECDICT/blob/master/LICENSE)。授權文字見 [LICENSE-ECDICT.txt](LICENSE-ECDICT.txt)。中文用 OpenCC `s2twp` 轉成台灣繁體，保留至多四行釋義、每行五個意思，不收錄原始例句。

- `a.json`～`z.json`：原有 32,812 個常用字，合計約 2.75 MiB；常用／考試篩選規則見 `tools/build_dict.py`。
- `extended-v1/000.json`～`3ff.json`：672,241 筆字條，包含前述常用範圍、片語、專業詞及明確記錄的詞形；不是全部 CSV 列數。僅保留符合英文小寫、空格、撇號及連字號格式且有非空字義的字條，再補來源明確記錄的 541 個詞形。
- `extended-v1/meta.json`：來源 SHA-256、筆數、檔案大小、分片演算法。完整擴充資料約 40.1 MiB，最大分片約 46.6 KiB。

不需在使用者開網站時載入整本資料。先查專案勘誤與常用分檔，缺字才用 FNV-1a 32-bit 計算 `hash % 1024`，轉成三位十六進位檔名。對照規格見 `js/dictionary-data.js` 與單元測試。

## 重建

原始 CSV 不進版本控制。以下指令需既有 Python 與 OpenCC；不會自動下載資料或安裝套件：

```bash
python tools/build_dict.py data/raw/ecdict.csv data/dict
python tools/build_extended_dict.py data/raw/ecdict.csv data/dict/extended-v1
node --test tests/unit/dictionary-data.test.mjs
```

更新常用檔須同步調整 `js/pwa.js`／`sw.js` 的常用快取版本。擴充檔重產發布時應改用新的資料目錄版本，並更新查詢路徑及 Service Worker 的擴充快取名稱與保留清單。使用相同 CSV 和 OpenCC 設定可重建；產生器不含時間戳。

詞形只使用 ECDICT `exchange` 中的原形與型別，不以規則猜測去尾碼，也不做自動拼字修正。精確字條優先；收藏的單字不會被原形取代。
