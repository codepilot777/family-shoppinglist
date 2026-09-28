# 🛒 屋企購物清單

一家人一齊用嘅購物清單。喺手機加嘢、剔嘢，屋企人部機即時見到。

- 即時同步（Firebase Firestore）
- 多張清單：超市、街市、藥房…
- 自動分類（蔬菜水果、肉類海鮮、奶類同蛋…），可以自己改
- 見到邊個加、邊個買咗
- 離線都用得，有網再自動同步
- **📲 安裝到主畫面**：Android 一撳就裝；iPhone 有圖文步驟，用起上嚟好似 app 咁
- **三種語言**：繁體中文、English、Bahasa Indonesia，每部機自己揀
- **貨品名自動翻譯**：婆婆打「菜心」，姐姐部機見到「sawi hijau (choy sum)」；姐姐打「telur」，婆婆見到「雞蛋」
- **長者友善**：大字模式（標準／大／特大）、🎤 講嘢輸入
- **📷 相片**：影低包裝／截圖，買嘅人唔會買錯
- **🎁 想買清單**：旅行、網購、「見到就幫我買」嘅嘢，有相、價錢、連結，按「幫邊個買」分組
- **🍚 食飯**：今晚幾多人喺屋企食飯；星期日問卷、每朝確認（唔覆當冇改）、4pm 截數，自動通知 + WhatsApp 後備
- 免費：GitHub Pages + Firebase 免費方案（屋企用綽綽有餘）

## 設定（大約 10 分鐘，只需做一次）

### 1. 開 Firebase project

1. 去 <https://console.firebase.google.com> → **新增專案**（Google Analytics 可以唔開）。
2. 左邊 **Build → Authentication** → **開始使用** → **Sign-in method** → 開啟 **匿名 (Anonymous)**。
3. 左邊 **Build → Firestore Database** → **建立資料庫** → 揀近香港嘅位置（例如 `asia-east2`）→ 用 **production mode**。
4. 喺 Firestore 嘅 **規則 (Rules)** 分頁，將本 repo 嘅 [`firestore.rules`](firestore.rules) 全部內容貼上去，按 **發布**。
5. 去 **專案設定（⚙️）→ 一般 → 你的應用程式** → 撳 **`</>` (Web)** 新增網頁應用程式（唔使揀 Hosting），會見到一段 `firebaseConfig`。

### 2. 填 config

打開 [`public/firebase-config.js`](public/firebase-config.js)（喺 GitHub 網頁撳 ✏️ 都改得），將 `firebaseConfig` 嘅值貼入去，例如：

```js
export const firebaseConfig = {
  apiKey: 'AIza...',
  authDomain: 'my-family.firebaseapp.com',
  projectId: 'my-family',
  storageBucket: 'my-family.firebasestorage.app',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:abcdef',
};
```

> 呢啲值唔係密碼，放上公開 repo 冇問題；資料係靠 `firestore.rules` 同家庭代碼保護。

### 3. 用 GitHub Pages 發佈

1. Repo **Settings → Pages → Build and deployment → Source** 揀 **GitHub Actions**。
2. 將改動 merge 入 `main`，GitHub Actions 會自動發佈。
3. 網址會係 `https://<你的帳戶>.github.io/family-shoppinglist/`。

### 4. 邀請屋企人

1. 自己打開網址 → 填名 → **建立新家庭**。
2. 撳右上角 👪 → **分享連結**，WhatsApp 俾屋企人。
3. 佢哋打開連結、填個名就加入咗。
4. 叫大家撳 app 頂部嘅 **📲** 安裝到主畫面：Android 會直接彈出安裝；iPhone 會顯示步驟（Safari 分享 ⬆️ → 加至主畫面）。
   - iPhone 主畫面 app 同 Safari 資料分開，所以**建議 iPhone 用戶先安裝，再由主畫面打開加入家庭**（登入畫面都有提示）。

## 多語言同翻譯

- 語言喺登入畫面頂部或者 ⚙️ 設定度揀，每部機分開記。
- 貨品名翻譯次序：
  1. **家庭字典**：屋企人喺「編輯」度改過嘅翻譯，全家共用，下次加同一樣嘢自動用
  2. **內置字典**（[`public/dictionary.js`](public/dictionary.js)）：約 180 樣香港常用貨品
  3. **機翻**：用免費嘅 [MyMemory](https://mymemory.translated.net/) 服務（唔使 key，每日有免費上限），會標示「機翻／otomatis」
- 下面會細字顯示原文（例如姐姐會見到「菜心」），方便佢喺超市對返貨架上嘅中文。
- 翻錯咗：撳 ⋯ → 翻譯 → 改好 → 儲存，之後全家都用你改嘅版本。
- 🎤 講嘢輸入用瀏覽器內置語音辨識（Android Chrome 支援廣東話；唔支援嘅瀏覽器唔會顯示個掣）。手機鍵盤本身嘅咪高峰都用得。

> 已經發布過舊版 `firestore.rules`？更新之後記得將新版本再貼去 Firebase Console 發布一次，否則翻譯寫唔入。

## 相片同想買清單

- **加相**：打名之後撳 📷（唔打名都得），或者喺 ⋯ → 相片度加。每樣嘢最多 3 張。
- 相片會喺手機度壓縮（約 200 KB 一張），直接存入 Firestore，**唔使開 Firebase Storage**（Storage 而家要綁信用卡升級 Blaze plan）。免費嘅 1 GB 大約夠存幾千張相。
- 清單顯示細縮圖，撳落去先載入大相，慳流量。
- **想買清單**：新增清單時揀「🎁 想買清單」，例如「日本」、「網購」。
  - 每樣嘢可以填「幫邊個買」、參考價錢、連結；清單按人分組（「太太 想要」、「老爺 想要」）。
  - 可以直接貼連結（例如 Amazon JP、小紅書），會自動變成 🔗 項目。
  - 平時儲喺「想買」清單，確定去旅行時，喺 ⋯ → 清單度搬去「日本」。

> 已經發布過舊版 `firestore.rules`？呢次加咗相片同清單類型，要再貼新版去 Firebase Console 發布一次。

## 🍚 食飯

撳頂部「🍚 食飯」：

- **今晚 🍚 N 人**：邊個返、邊個唔返、帶幾多客、備註。截數（4pm）後先改嘅會紅色標示。
- **我今晚**：一撳「返／唔返」、加減客人。
- **未來幾日**：撳任何一日，可以幫任何人改（例如幫婆婆）。
- **📝 填下星期**：星期日問卷，已經按「固定規律」預設好，改唔同嘅就得。剔「記住做固定規律」，以後每星期預設咁（例如阿仔逢二唔返）。
- **👥 成員**：加屋企人。婆婆可以設「由其他人代填」（唔收通知）；姐姐可以唔剔「計入食飯人數」，佢會收到截數人數通知。
- **💬 WhatsApp 後備**：一撳發問卷或者今晚人數去 WhatsApp group；邊個未填會自動 @ 佢。

| 時間（香港） | 通知 | 收件人 |
|---|---|---|
| 星期日 8pm | 下星期食飯問卷 | 未填嘅成員 |
| 每日 8am | 「你今晚：✅ 返」，Android 可以直接撳「今晚唔返」 | 所有食飯成員 |
| 每日 8am | 今晚暫時人數 | 負責煮飯嘅人 |
| 每日 4pm | 截數人數 | 負責煮飯嘅人 |

「唔覆當冇改」：冇撳就維持原本（預設係返屋企食）。

### 開通知（一次性，大約 10 分鐘）

通知由 GitHub Actions 定時經 Firebase Cloud Messaging 發出，**唔使升級 Firebase 付費方案**。

1. **Web Push key**：Firebase Console → ⚙️ 專案設定 → **Cloud Messaging** → 最底「Web Push 憑證」→ **Generate key pair**，複製嗰條 key，喺 `public/firebase-config.js` 入面加一行：
   ```js
   const firebaseConfig = {
     apiKey: "…",
     …
     vapidKey: "貼喺度",
   };
   ```
2. **Service account**：⚙️ 專案設定 → **服務帳戶 (Service accounts)** → **產生新的私密金鑰**，會下載一個 `.json`。
   去 GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**：
   - Name：`FIREBASE_SERVICE_ACCOUNT`
   - Secret：成個 `.json` 檔案嘅內容
   > 呢個檔案係密碼，**唔好** commit 入 repo，用完可以刪走。
3. 將最新 `firestore.rules` 再貼去 Firebase Console 發布。
4. 每個人：打開 app → 🍚 食飯 → 揀返自己 → **🔔 開通知**。
   - iPhone：要先「加至主畫面」，由主畫面打開先開到通知（iOS 16.4 或以上）。
5. 測試：GitHub → **Actions → Dinner notifications → Run workflow**，揀 `daily`，`dry_run` 剔住會顯示會發咩；唔剔就真係發。

> GitHub 定時工作有時會遲 10–30 分鐘。repo 60 日冇改動，GitHub 會暫停定時工作，會 email 通知你，撳一下就恢復。

## 安全性

- 每個家庭有一個 20 位隨機代碼，只有收到邀請連結／代碼嘅人先讀寫到。
- 冇人可以列出所有家庭。
- 邀請連結等於鎖匙，唔好公開貼出去。如果外洩，可以開過個新家庭。

## 本機試用 / 開發

唔填 Firebase config 都可以即刻試（**示範模式**，資料只存喺本機，唔會同步）：

```sh
npm run serve   # 打開 http://localhost:8080
```

`public/vendor/firebase.js` 係由 npm 套件打包出嚟嘅 Firebase SDK。要升級版本：

```sh
npm install firebase@latest
npm run vendor
```

改完 `public/` 入面嘅檔案之後，記得將 `public/sw.js` 嘅 `CACHE` 版本號加一，等手機攞到新版本。

## 檔案結構

```
public/
  index.html            頁面
  app.js                介面同邏輯
  store.js              資料層（Firebase / 示範模式）
  i18n.js               介面文字（中 / 英 / 印尼文）
  translate.js          貨品名翻譯同分類
  dictionary.js         內置貨品字典
  image.js              相片壓縮
  dinner-view.js        🍚 食飯頁
  dinner.js / dates.js  食飯人數計算、香港時間（app 同通知 script 共用）
  ui.js                 共用介面小工具
  install.js            📲 安裝到主畫面
  firebase-config.js    ← 你要填嘅設定
  sw.js                 離線快取
  vendor/firebase.js    Firebase SDK
firestore.rules         Firestore 安全規則
scripts/notify/         食飯通知 script（GitHub Actions 定時執行）
.github/workflows/      自動發佈到 GitHub Pages、定時發通知
```
