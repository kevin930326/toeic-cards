# Firebase 設定教學（跨裝置同步用）

跟著做大約 10 分鐘。全程免費，**不需要綁信用卡**（使用免費的 Spark 方案）。

> Firebase 的畫面偶爾會改版，按鈕名稱可能和這裡寫的不完全一樣，找意思相近的就可以。

## 1. 建立專案

1. 打開 <https://console.firebase.google.com/> ，用你的 Google 帳號登入
2. 按「**建立專案**」（Create a project）
3. 專案名稱輸入 `toeic-cards`（或任何你喜歡的名字）→ 繼續
4. **Google Analytics 可以關閉**（用不到）→ 建立專案，等它跑完 → 繼續

## 2. 新增網頁應用程式，取得設定碼

1. 在專案首頁，點 **網頁圖示 `</>`**（「將 Firebase 新增至你的網頁應用程式」）
2. 應用程式暱稱輸入 `toeic-cards-web`；**不要勾**「Firebase Hosting」→ 註冊應用程式
3. 畫面會出現一段程式碼，裡面有像這樣的一段，**整段複製下來貼給 Claude**：
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "toeic-cards-xxxxx.firebaseapp.com",
     projectId: "toeic-cards-xxxxx",
     storageBucket: "...",
     messagingSenderId: "...",
     appId: "..."
   };
   ```
4. 按「繼續前往控制台」

> **這段設定碼可以公開，放進程式碼也沒問題**（雖然裡面有個 `apiKey`）。它只是用來告訴網站「要連到哪一個 Firebase 專案」，不是密碼，和 Gemini 的金鑰不一樣。
> 資料安全是靠第 5 步的「安全規則」：**每個人只能讀寫自己的資料**。

## 3. 開啟登入方式

1. 左邊選單 **建構（Build）› Authentication** → 開始使用（Get started）
2. 在「**Sign-in method**（登入方式）」分頁：
   - 點 **Google** → 開啟（Enable）→「專案支援電子郵件」選你的 Gmail → 儲存
   - 點 **電子郵件/密碼（Email/Password）** → 開啟**兩個開關**：
     - 電子郵件/密碼（Email/Password）
     - **電子郵件連結（無密碼登入）**（Email link / passwordless sign-in）
   - → 儲存

## 4. 加入授權網域

1. 還是在 Authentication，切到「**設定（Settings）**」分頁 › **授權網域（Authorized domains）**
2. 按「新增網域」，加入：
   - `kevin930326.github.io` （正式網站）
   - `localhost` 和 `127.0.0.1` （在自己電腦上測試用，可以不加）

## 5. 建立資料庫並設定安全規則

1. 左邊選單 **建構（Build）› Firestore Database** → 建立資料庫
2. 版本選「**Standard**」（如果有問）；位置選 **`asia-east1`（台灣）**，之後無法更改
3. 選「**以正式版模式啟動**（production mode）」→ 建立
4. 建立好之後，切到「**規則（Rules）**」分頁，把內容**全部換成**下面這段 → 按「**發布（Publish）**」：

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 每個人只能讀寫自己的資料（users/自己的 uid/ 底下）
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

> 這段規則也存在專案的 `firestore.rules` 檔案裡。

## 完成！

把第 2 步複製的 `firebaseConfig` 貼給 Claude，網站就會出現「**帳號與同步**」功能。

## 免費額度夠嗎？

Spark 免費方案每天有 5 萬次讀取、2 萬次寫入、1GB 儲存空間。這個網站每次同步只傳「有變更的單字」：一天背幾十個字、在兩台裝置之間切換，大約只會用到幾百次讀寫，遠遠用不完。
