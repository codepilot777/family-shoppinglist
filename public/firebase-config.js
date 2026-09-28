// 將 Firebase Console → 專案設定 → 一般 → 「你的應用程式」入面嘅 firebaseConfig 貼喺度（直接貼 Firebase 俾你嗰段都得）。
// 呢啲值唔係秘密（會喺瀏覽器公開），資料安全係靠 firestore.rules 保護。
// 留空嘅話，app 會用「示範模式」：資料只會存喺呢部裝置，唔會同步。
const firebaseConfig = {
  apiKey: "AIzaSyC-mEonSZZrop2nn8WLid0g15SxCB6i8ZA",
  authDomain: "family-shoppinglist-61e66.firebaseapp.com",
  projectId: "family-shoppinglist-61e66",
  storageBucket: "family-shoppinglist-61e66.firebasestorage.app",
  messagingSenderId: "1063414475176",
  appId: "1:1063414475176:web:401528ea4f2e238a1f559d",
  measurementId: "G-46RWFYL8KV",
  vapidKey: "BHwY9E70kbIHzLO7kw4hX7dvnZq-tKAwn2adW_dnNUQ0viGIR832Vwr8d46Xw9TJe2xl6E1GUEAYlKO9e6Q7Tt0"
};
