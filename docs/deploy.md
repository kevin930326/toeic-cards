# 部署說明（GitHub Pages）

這個網站是純前端（沒有伺服器、沒有建置步驟），所以可以直接放在 **GitHub Pages**，完全免費，而且是 HTTPS（PWA 的離線功能需要 HTTPS）。

## 第一次部署

1. **建立 repo**：在 GitHub 建立一個**公開（Public）**的 repo，例如 `toeic-cards`（GitHub Pages 的免費方案需要公開的 repo）
2. **推上去**：
   ```bash
   git remote add origin https://github.com/<你的帳號>/toeic-cards.git
   git push -u origin main
   ```
3. **開啟 Pages**：repo 的 **Settings › Pages**
   - Source：**Deploy from a branch**
   - Branch：**main**，資料夾 **/ (root)**，按 Save
4. 等 1～2 分鐘，網址會是 `https://<你的帳號>.github.io/toeic-cards/`

> 網站裡的路徑全部是相對路徑（`./`），所以放在子路徑 `/toeic-cards/` 底下也能正常運作。
> 根目錄的 `.nojekyll` 讓 GitHub 不要用 Jekyll 處理檔案，原封不動地提供。

## 之後更新

改完程式、commit、`git push`，GitHub Pages 大約 1 分鐘內就會自動更新。

- **不需要改版本號**：Service Worker 對網站檔案採「先連網、斷線才用快取」，使用者下次打開網站就會拿到新版（見 [decisions #43](decisions.md)）
- **例外：重新產生字典時**（執行 `tools/build_dict.py` 之後），要把 `sw.js` 裡的 `DICT_CACHE` 版本號加 1（例如 `toeic-dict-v1` → `toeic-dict-v2`），否則已經下載過字典的使用者會繼續用舊的

## 上傳前的安全檢查

**API 金鑰絕對不能進 GitHub。** 這個專案的金鑰只存在使用者的瀏覽器，程式碼裡本來就不應該有任何金鑰。push 前可以用這行指令再確認一次（沒有輸出就是安全的）：

```bash
git grep -nE "AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9]{20,}" -- . ":!data/" ":!js/firebase-config.js"
```

> `js/firebase-config.js` 裡的 Firebase `apiKey` 也是 `AIza` 開頭，但它本來就是公開的（用來辨識 Firebase 專案，不是密碼），所以排除在檢查之外。GitHub 可能會寄「偵測到 Google API 金鑰」的通知，對這個檔案可以忽略。
> 想更保險的話，可以到 Google Cloud 主控台的「API 和服務 › 憑證」，把這把金鑰限制成只能從 `kevin930326.github.io` 使用。

`.gitignore` 已經排除了 `.env`、原始字典檔 `data/raw/`、測試截圖，以及 `.claude/` 本機設定。

## 自訂網域（選擇性）

如果買了自己的網域（一年約幾百元台幣），可以在 **Settings › Pages › Custom domain** 填入，並依 GitHub 的說明到網域商設定 DNS。網站使用相對路徑，換網域不需要改程式。

## 其他可以選擇的平台

Cloudflare Pages、Vercel、Netlify 也都可以連接 GitHub 自動部署，設定方式類似（「建置指令」留空、「輸出資料夾」設為根目錄）。如果之後要加後端函式（例如讓使用者不必自己申請 Gemini 金鑰），這些平台比較方便。
