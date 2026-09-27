# 🛒 屋企購物清單

一家人一齊用嘅購物清單。喺手機加嘢、剔嘢，屋企人部機即時見到。

- 即時同步（Firebase Firestore）
- 多張清單：超市、街市、藥房…
- 自動分類（蔬菜水果、肉類海鮮、奶類同蛋…），可以自己改
- 見到邊個加、邊個買咗
- 離線都用得，有網再自動同步
- 可以「加至主畫面」，用起上嚟好似 app 咁
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
4. 提示大家喺手機瀏覽器揀 **加至主畫面**（iPhone：Safari 分享 → 加至主畫面）。

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
  firebase-config.js    ← 你要填嘅設定
  sw.js                 離線快取
  vendor/firebase.js    Firebase SDK
firestore.rules         Firestore 安全規則
.github/workflows/      自動發佈到 GitHub Pages
```
