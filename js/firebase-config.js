// Firebase 專案設定（跨裝置同步用）
//
// 這些值本來就是公開的（每個用 Firebase 的網站都看得到），不是密碼：
// apiKey 只是用來辨識「要連到哪一個 Firebase 專案」，不能用來讀別人的資料。
// 資料安全靠 Firestore 安全規則（firestore.rules）：每個人只能讀寫自己的資料。
// 設定方式見 docs/firebase-setup.md。設成 null 時網站照常運作，只是不會出現登入同步功能。
export const firebaseConfig = {
  apiKey: 'AIzaSyCPkk2jbDmwa5Vs82F1Lg019djsl3Hx67s',
  authDomain: 'toeic-cards.firebaseapp.com',
  projectId: 'toeic-cards',
  storageBucket: 'toeic-cards.firebasestorage.app',
  messagingSenderId: '352766773640',
  appId: '1:352766773640:web:389e5f64e0ca3aa303523d',
};
