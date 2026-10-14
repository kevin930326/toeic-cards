// Firebase 連線（登入＋Firestore）：把 Firebase 的細節包起來，sync.js 只呼叫這裡的函式
//
// - Firebase SDK 從 Google 的 CDN 載入（固定版本），而且「用到才載入」：沒登入同步的人完全不會下載
// - Google 登入用彈出視窗（signInWithPopup）：網站不在 Firebase 自己的網域（我們在 GitHub Pages），
//   瀏覽器會擋掉「跳轉登入」需要的第三方儲存空間，官方建議改用彈出視窗
// - Email 登入連結：寄一封信，點信裡的連結就登入，不用密碼
import { wordDocId } from './sync-core.js';

export const FIREBASE_SDK_VERSION = '13.0.0';
const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;

// Firestore 不接受 undefined，先轉成純 JSON
const plain = (v) => JSON.parse(JSON.stringify(v));

export async function createFirebaseRemote(config) {
  const [appMod, authMod, fs] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-firestore.js`),
  ]);
  const { emulator, ...firebaseConfig } = config;
  const app = appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  auth.languageCode = 'zh-TW';   // Google 登入畫面、登入信件用繁體中文
  const db = fs.getFirestore(app);
  if (emulator) {
    // 測試用：連到本機的 Firebase 模擬器，不會碰到正式專案
    authMod.connectAuthEmulator(auth, emulator.auth, { disableWarnings: true });
    fs.connectFirestoreEmulator(db, emulator.firestoreHost, emulator.firestorePort);
  }

  const userInfo = (u) => (u ? {
    uid: u.uid,
    email: u.email || '',
    name: u.displayName || '',
    provider: u.providerData?.[0]?.providerId || 'password',
  } : null);

  const wordsCol = (uid) => fs.collection(db, 'users', uid, 'words');

  return {
    onAuth(cb) {
      return authMod.onAuthStateChanged(auth, (u) => cb(userInfo(u)));
    },
    currentUser() {
      return userInfo(auth.currentUser);
    },
    async signInGoogle() {
      const provider = new authMod.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const res = await authMod.signInWithPopup(auth, provider);
      return userInfo(res.user);
    },
    async sendEmailLink(email, url) {
      await authMod.sendSignInLinkToEmail(auth, email, { url, handleCodeInApp: true });
    },
    isEmailLink(url) {
      return authMod.isSignInWithEmailLink(auth, url);
    },
    async completeEmailLink(email, url) {
      const res = await authMod.signInWithEmailLink(auth, email, url);
      return userInfo(res.user);
    },
    async signOut() {
      await authMod.signOut(auth);
    },

    // 拉下 sinceMs（伺服器時間）之後有變動的單字；回傳 { docs, maxSyncedAt }
    async pullWords(uid, sinceMs) {
      const q = fs.query(wordsCol(uid), fs.where('syncedAt', '>=', fs.Timestamp.fromMillis(sinceMs || 0)));
      const snap = await fs.getDocs(q);
      let maxSyncedAt = sinceMs || 0;
      const docs = snap.docs.map((d) => {
        const v = d.data();
        const t = v.syncedAt?.toMillis?.() || 0;
        if (t > maxSyncedAt) maxSyncedAt = t;
        return { word: v.word, updatedAt: v.updatedAt, deleted: !!v.deleted, data: v.data || null };
      });
      return { docs, maxSyncedAt };
    },

    // 上傳單字（Firestore 一次批次最多 500 筆，這裡每 400 筆一批）
    async pushWords(uid, items) {
      for (let i = 0; i < items.length; i += 400) {
        const batch = fs.writeBatch(db);
        for (const it of items.slice(i, i + 400)) {
          batch.set(fs.doc(wordsCol(uid), wordDocId(it.word)), { ...plain(it), syncedAt: fs.serverTimestamp() });
        }
        await batch.commit();
      }
    },

    async pullLogs(uid) {
      const snap = await fs.getDocs(fs.collection(db, 'users', uid, 'logs'));
      return snap.docs.map((d) => ({ deviceId: d.id, log: d.data().log || {}, updatedAt: d.data().updatedAt || 0 }));
    },
    async pushLog(uid, deviceId, log) {
      await fs.setDoc(fs.doc(db, 'users', uid, 'logs', deviceId), { log: plain(log), updatedAt: Date.now() });
    },

    async getMeta(uid, name) {
      const snap = await fs.getDoc(fs.doc(db, 'users', uid, 'meta', name));
      return snap.exists() ? snap.data() : null;
    },
    async setMeta(uid, name, value, updatedAt) {
      await fs.setDoc(fs.doc(db, 'users', uid, 'meta', name), { value: plain(value), updatedAt });
    },
  };
}
