# AGENTS.md（給 Codex 等 AI 程式助手）

> **這個專案是使用者的作品集**，公開放在 GitHub（https://github.com/kevin930326/toeic-cards），同時也是使用者自己準備多益用的工具。
> 開發過程本身也是作品集的一部分：commit 歷史、`docs/dev-log/`、`docs/decisions.md`、README 都會被別人看到，請維持一樣的品質和風格。

這個專案原本用 Claude Code 開發，**所有專案規則都寫在 [CLAUDE.md](CLAUDE.md)**。開始工作前請先完整讀過 CLAUDE.md，裡面的規則一樣適用，特別是：

- 用**繁體中文**和使用者溝通；使用者是初學者，解釋要淺白
- **API 金鑰絕對不能 commit**（Gemini 金鑰只存在使用者的瀏覽器）
- 每完成一個功能：測試通過 → 寫 `docs/dev-log/NN-*.md` → 重要技術選擇補進 `docs/decisions.md`（決策／考慮過的選項／理由／取捨）→ git commit（小步提交）
- 純 HTML／CSS／JS（ES modules），**沒有建置步驟**，不要引入框架或打包工具

CLAUDE.md 提到的「skills」是 Claude Code 的功能，在這裡的對應做法如下。

## 測試（對應 CLAUDE.md 的 `webapp-testing` skill）

每做完一個功能都要實際開瀏覽器測試，通過才算完成。做法說明在 `.claude/skills/webapp-testing/SKILL.md`（本機才有，沒有上傳到 git）；所有測試的說明在 [tests/README.md](tests/README.md)。

```bash
# 1. 本機伺服器：用 127.0.0.1:8123（8000 留給使用者自己用）
python -m http.server 8123 --bind 127.0.0.1

# 2. 語法檢查（很快，改完 JS 先跑）
for f in js/*.js js/views/*.js sw.js; do node --check "$f" || echo "語法錯誤：$f"; done

# 3. 單元測試（純函式，不需要瀏覽器）
node --test "tests/unit/*.test.mjs"

# 4. 端對端測試（Playwright，需要 pip install playwright、playwright install chromium）
python tests/test_step1.py      # 其他見 tests/README.md
```

- 外部 API（Free Dictionary、Gemini）在測試裡一律用 `page.route` 假造回應。真的 Free Dictionary API 常常掛掉（HTTP 522）
- 新功能要寫新的測試檔或加進對應的 `tests/test_*.py`；截圖存 `tests/screenshots/`（不進 git），要放進 dev-log 的截圖存 `docs/images/`

## 同步功能的測試（Firebase 模擬器）

`tests/test_step11.py` 用 Firebase 官方模擬器，不會碰到正式專案。需要 Java。設定檔是專案根目錄的 `firebase.json`。

```bash
npx firebase-tools emulators:start --only auth,firestore --project demo-toeic
```

- 測試用 `window.__toeicFirebaseConfig = {..., emulator: {...}}` 注入模擬器設定；設成 `null` 等於「沒設定 Firebase」（`js/firebase-config.js` 裡是正式專案的公開設定）
- Playwright 的 `wait_for_function` 遇到 async 函式會直接當成成立，要等非同步結果請自己用 `evaluate` 輪詢
- **不要用使用者的帳號登入正式專案，也不要在正式專案建立帳號**；正式網站上的登入測試由使用者自己做

## Windows 上的坑

- 停掉背景伺服器後，子程序常常沒被關掉，會繼續佔住連接埠（http.server 的 8123；模擬器的 9099、8080、4400），下次啟動就會失敗或 `ERR_EMPTY_RESPONSE`
- 停掉後用 `Get-NetTCPConnection -State Listen` 檢查這些連接埠，確認是自己開的程序（命令列含 http.server、firebase、firestore）再 `Stop-Process`

## 其他

- 要安裝軟體、下載檔案前，先問使用者
- **資安**（見 [docs/dev-log/23-security-review.md](docs/dev-log/23-security-review.md)）：
  - 外部資料（AI 回應、字典、匯入的備份、同步下來的資料）放進 HTML 前一律 `esc()`；匯入／同步的資料要經過 `js/backup.js` 的 sanitize 函式
  - `index.html` 有 CSP：新增外部服務（API、CDN、iframe）時要一起更新 CSP，並跑 `tests/test_security.py`；不要加內嵌 `<script>` 或 `onclick=` 這類屬性
  - 改了上傳到 Firestore 的資料格式，要一起改 `firestore.rules`，並請使用者到 Firebase 主控台重新發布
- push 前檢查沒有金鑰（`js/firebase-config.js` 裡的 Firebase apiKey 是公開識別碼，可以放）
- 部署：push 到 `main` 後 GitHub Pages 自動更新（https://kevin930326.github.io/toeic-cards/），說明見 [docs/deploy.md](docs/deploy.md)
- README 的展示圖：先 `python tests/capture_readme.py`（需要 8123 伺服器）再 `python tools/make_readme_images.py`；介面有明顯改變時重拍
