// 將 Firebase Console → 專案設定 → 一般 → 「你的應用程式」入面嘅 firebaseConfig 貼喺度。
// 呢啲值唔係秘密（會喺瀏覽器公開），資料安全係靠 firestore.rules 保護。
// 留空嘅話，app 會用「示範模式」：資料只會存喺呢部裝置，唔會同步。
export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};
