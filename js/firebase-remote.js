// Firebase 連線（登入＋Firestore）：把 Firebase 的細節包起來，sync.js 只呼叫這裡的函式
//
// - Firebase SDK 從 Google 的 CDN 載入（固定版本），而且「用到才載入」：沒登入同步的人完全不會下載
// - Google 登入用彈出視窗（signInWithPopup）：網站不在 Firebase 自己的網域（我們在 GitHub Pages），
//   瀏覽器會擋掉「跳轉登入」需要的第三方儲存空間，官方建議改用彈出視窗
// - Email 登入連結：寄一封信，點信裡的連結就登入，不用密碼
import { wordDocId, mergeRemoteRecord } from './sync-core.js';
import { mergeSets } from './word-sets.js?v=dictionary-scale-1';
import { cleanLedger, mergeLedgers } from './log-ledger.js';
import {stableJSON} from './meta-sync.js';

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
    providers: (u.providerData || []).map((p) => p.providerId),   // 例如 ['google.com', 'password']
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
    // Email＋密碼：iPhone 主畫面 App 打不開 Google 登入視窗，Email 連結又有每天 5 封的上限，這是最穩的方式
    async signInPassword(email, password) {
      const res = await authMod.signInWithEmailAndPassword(auth, email, password);
      return userInfo(res.user);
    },
    async registerPassword(email, password) {
      const res = await authMod.createUserWithEmailAndPassword(auth, email, password);
      return userInfo(res.user);
    },
    // 已登入（例如用 Google）的帳號加上密碼，之後就能用 Email＋密碼登入同一個帳號
    async setPassword(password) {
      const u = auth.currentUser;
      if (!u) throw Object.assign(new Error('尚未登入'), { code: 'auth/no-current-user' });
      await u.reload();   // 這個帳號可能在別的裝置用 Email 連結登入過（也算「密碼」登入方式），先取得最新狀態
      if (u.providerData.some((p) => p.providerId === 'password')) {
        await authMod.updatePassword(u, password);
      } else {
        try {
          await authMod.linkWithCredential(u, authMod.EmailAuthProvider.credential(u.email, password));
        } catch (err) {
          // 有些情況（例如 Firebase 模擬器）會因為「這個 Email 已經被自己的 Google 帳號使用」而拒絕連結，
          // 這時直接替這個帳號設定密碼，效果一樣：之後可以用同一個 Email＋密碼登入同一個帳號
          if (!['auth/email-already-in-use', 'auth/credential-already-in-use', 'auth/provider-already-linked'].includes(err?.code)) throw err;
          await authMod.updatePassword(u, password);
        }
      }
      await u.reload();
      return userInfo(auth.currentUser);
    },
    async resetPassword(email) {
      await authMod.sendPasswordResetEmail(auth, email);
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
    async pushWords(uid, items, active = () => true) {
      const results=[];
      for (let i = 0; i < items.length; i += 400) {
        if (!active() || auth.currentUser?.uid !== uid) throw Object.assign(new Error('帳號已切換'), { cancelled: true });
        const chunk=items.slice(i,i+400);
        const merged=await fs.runTransaction(db,async tx=>{
          const refs=chunk.map(it=>fs.doc(wordsCol(uid),wordDocId(it.word)));
          const snaps=await Promise.all(refs.map(ref=>tx.get(ref)));
          if(!active()||auth.currentUser?.uid!==uid) throw Object.assign(new Error('帳號已切換'),{cancelled:true});
          const docs=chunk.map((it,j)=>{
            const data=snaps[j].exists()?snaps[j].data():null;
            const cloud=data?{word:data.word,updatedAt:data.updatedAt,deleted:data.deleted,data:data.data}:null;
            return mergeRemoteRecord(cloud,it);
          });
          docs.forEach((it,j)=>tx.set(refs[j],{...plain(it),syncedAt:fs.serverTimestamp()}));
          return docs;
        });
        results.push(...merged);
      }
      return results;
    },

    async pullLogs(uid) {
      const snap = await fs.getDocs(fs.collection(db, 'users', uid, 'logs'));
      return snap.docs.map((d) => ({ deviceId: d.id, log: d.data().log || {}, updatedAt: d.data().updatedAt || 0 }));
    },
    async syncLogLedger(uid, local, reset, active = () => true) {
      const ref = fs.doc(db, 'users', uid, 'meta', 'learningLog');
      // 舊版 logs 僅在帳本首次建立時遷移，之後不再把舊資料加回。
      const exists = await fs.getDoc(ref);
      const legacy = exists.exists() ? {docs:[]} : await fs.getDocs(fs.collection(db, 'users', uid, 'logs'));
      return fs.runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        if (!active() || auth.currentUser?.uid !== uid) throw Object.assign(new Error('帳號已切換'), {cancelled:true});
        const cloud = snap.exists() ? cleanLedger(snap.data().value) : cleanLedger({sources:Object.fromEntries(legacy.docs.map(d=>[d.id,d.data()]))});
        let merged;
        if (reset) merged = {...cleanLedger(local), epoch:{id:local.epoch.id,at:Math.max(Date.now(),local.epoch.at,cloud.epoch.at+1)}};
        else merged = mergeLedgers(cloud, local);
        tx.set(ref, {value:plain(merged)});
        return merged;
      });
    },
    async pushLog(uid, deviceId, log) {
      await fs.setDoc(fs.doc(db, 'users', uid, 'logs', deviceId), { log: plain(log), updatedAt: Date.now() });
    },

    async getMeta(uid, name) {
      const snap = await fs.getDoc(fs.doc(db, 'users', uid, 'meta', name));
      return snap.exists() ? snap.data() : null;
    },
    // 用交易在伺服器端重讀後合併，兩台裝置同時建立／改分類也不會整份互蓋。
    async syncWordSets(uid, local, active = () => true, replace = false) {
      const ref = fs.doc(db, 'users', uid, 'meta', 'wordSets');
      return fs.runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!active() || auth.currentUser?.uid !== uid) throw Object.assign(new Error('帳號已切換'), { cancelled: true });
        const cloud = snap.exists() ? snap.data().value : [];
        let desired = local;
        if (replace) {
          const all = mergeSets(cloud,local);
          const at = Math.max(Date.now(),...all.flatMap(s=>[s.updatedAt+1,...Object.values(s.members).map(m=>m.at+1)]));
          desired = all.map(old=>{
            const s=local.find(s=>s.id===old.id);
            const members=Object.fromEntries(Object.keys(old.members).map(w=>[w,{present:false,at}]));
            for(const [w,m] of Object.entries(s?.members||{})) members[w]={present:m.present,at};
            return {...(s||old),deleted:!s||s.deleted,updatedAt:at,members};
          });
        }
        const merged = mergeSets(cloud, desired);
        if (JSON.stringify(merged) !== JSON.stringify(cloud)) {
          tx.set(ref, { value: plain(merged) });
        }
        return merged;
      });
    },
    async setMeta(uid, name, value, updatedAt, expected, active=()=>true) {
      const ref=fs.doc(db,'users',uid,'meta',name);
      if(expected===undefined){await fs.setDoc(ref,{value:plain(value),updatedAt});return;}
      await fs.runTransaction(db,async tx=>{
        const snap=await tx.get(ref);const current=snap.exists()?snap.data():null;
        if(!active()||auth.currentUser?.uid!==uid)throw Object.assign(new Error('帳號已切換'),{cancelled:true});
        if(stableJSON(current)!==stableJSON(expected))throw Object.assign(new Error('雲端資料在同步途中改變，請再同步確認。'),{code:'sync/meta-changed'});
        tx.set(ref,{value:plain(value),updatedAt});
      });
    },
  };
}
