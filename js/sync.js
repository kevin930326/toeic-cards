// 跨裝置同步的流程控制：登入狀態、什麼時候同步、同步的步驟、錯誤訊息
//
// 什麼時候同步：登入後、打開網站時（之前登入過）、資料改變後約 8 秒（把連續的修改合在一起）、
//              切回這個分頁或 App 時、重新連上網路時、按「立即同步」
// 同步的順序：拉下雲端的單字 → 套用 → 上傳本機有變更的單字 → 每日紀錄 → 設定 → 錯題本 → 單字集
import { firebaseConfig } from './firebase-config.js';
import {
  getWords, replaceWords, getTombstones, setTombstones, getSettings, updateSettings, getDefaultSettings,
  settingsUpdatedAt, setSettingsUpdatedAt, subscribe,
  getSetRecords, mergeSetRecords, flushWords,
} from './store.js';
import { profileStorage, profileOwner, profileIsCurrent, pinProfileLayout, hasGuestData, readProfile, writeProfile, activateProfile } from './profile-storage.js';
import { mergeBackup, parseBackup, buildBackup } from './backup.js';
import { mergeLedgers } from './log-ledger.js';
import { getOwnLog, getLogLedger, setLogLedger, onLogChange } from './log.js';
export { deviceId } from './device-id.js';
import { getAllMistakes as getMistakes, mistakesUpdatedAt, setMistakesFromSync } from './mistakes.js';
import {
  applyRemoteWords, pendingChanges, pickSyncedSettings, remoteSettings, remoteLogs, remapMistakes, newerSide,
} from './sync-core.js';

const STATE_KEY = 'toeic-cards:sync';            // { [uid]: { lastPullAt, pushed } }
const DEVICE_KEY = 'toeic-cards:deviceId';
const ACTIVE_KEY = 'toeic-cards:syncActive';     // 登入過的 uid：下次打開網站時自動連線
const EMAIL_KEY = 'toeic-cards:emailForSignIn';  // 寄出登入連結的 Email（同一台裝置點連結時不用再輸入）
const PUSH_DELAY = 8000;
const FOCUS_THROTTLE = 30000;

const state = {
  remote: null,
  user: null,
  status: 'idle',     // idle | connecting | syncing | offline | error
  error: '',
  lastSyncAt: 0,
  summary: null,      // { added, updated, deleted, pushed }
  pendingLink: '',    // 用登入連結打開網站，但這台裝置不知道 Email 時
  linkSentTo: '',
  guestChoice: false,
};
const listeners = new Set();
let remotePromise = null;
let running = null;
let rerun = false;
let applying = false;
let pushTimer = null;
let lastFocusSync = 0;
let session = 0;
let signingOut = false;

function invalidateSession() {
  session++;
  clearTimeout(pushTimer);
  rerun = false;
}

function changeAccount(user) {
  invalidateSession();
  pinProfileLayout();
  emit({ user, lastSyncAt: 0, summary: null, status: 'idle', error: '', guestChoice: false });
  if (signingOut && user) return;
  const uid = user?.uid || '';
  if (uid) ls.set(ACTIVE_KEY, uid);
  else ls.del(ACTIVE_KEY);
  if (uid !== profileOwner()) {
    if (uid && !profileOwner() && hasGuestData()) {
      emit({ guestChoice: true });
      location.hash = '#/settings';
    } else {
      if (!flushWords()) throw new Error('目前字卡尚未存好，請先匯出備份並釋放空間，再重新整理。暫停同步以保護資料。');
      activateProfile(uid);
    }
  } else if (uid) syncNow();
}

export function resolveGuestData(merge) {
  const uid = state.user?.uid;
  if (!uid || !state.guestChoice || profileOwner()) return;
  if (!flushWords()) throw new Error('訪客資料尚未存好，請先匯出備份並釋放空間再試。');
  if (merge) {
    const guest = readProfile('');
    const clean = parseBackup(JSON.stringify(buildBackup({ words: guest.words || [], settings: {},
      log: guest.log || {}, logLedger: getLogLedger(), mistakes: guest.mistakes || [], wordSets: guest.wordSets || [] })), getDefaultSettings()).backup;
    // 先載入帳號的雲端資料，再合併訪客；不能用空白本機 meta 覆蓋既有帳號。
    writeProfile(uid, { pendingGuest: clean });
  }
  activateProfile(uid);
}

const ls = {
  get(k, fb) { try { const v = localStorage.getItem(k); return v === null ? fb : JSON.parse(v); } catch (e) { return fb; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 存不了就下次重來 */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* 忽略 */ } },
};

// 測試時可以用 window.__toeicFirebaseConfig 注入「本機模擬器」的設定；設成 null 代表「沒有設定 Firebase」
function getConfig() {
  return '__toeicFirebaseConfig' in window ? window.__toeicFirebaseConfig : firebaseConfig;
}

export function syncConfigured() {
  return !!getConfig();
}

export function syncState() {
  return { ...state, remote: undefined, configured: syncConfigured() };
}

export function onSyncChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(patch) {
  Object.assign(state, patch);
  for (const fn of listeners) fn(syncState());
}

export function invalidateSync() { invalidateSession(); }

function loadState(uid) {
  const all = ls.get(STATE_KEY, {});
  return { lastPullAt: 0, pushed: {}, ...(all[uid] || {}) };
}
function saveState(uid, st) {
  const all = ls.get(STATE_KEY, {});
  all[uid] = st;
  ls.set(STATE_KEY, all);
}

// 把 Firebase 的錯誤代碼翻成使用者看得懂的話
export function friendlyError(err) {
  const code = err?.code || '';
  const map = {
    'auth/popup-blocked': '瀏覽器擋住了登入視窗，請允許這個網站開啟彈出視窗，或改用 Email 登入連結',
    'auth/popup-closed-by-user': '登入視窗被關掉了，請再試一次',
    'auth/cancelled-popup-request': '登入視窗被關掉了，請再試一次',
    'auth/unauthorized-domain': '這個網址還沒加入 Firebase 的「授權網域」（見 docs/firebase-setup.md 第 4 步）',
    'auth/operation-not-allowed': '這個登入方式還沒在 Firebase 開啟（見 docs/firebase-setup.md 第 3 步）',
    'auth/invalid-email': 'Email 格式不正確',
    'auth/invalid-action-code': '登入連結已經失效或用過了，請重新寄一次',
    'auth/expired-action-code': '登入連結已經過期，請重新寄一次',
    'auth/network-request-failed': '連不上網路，請稍後再試',
    'auth/too-many-requests': '嘗試次數太多，請稍後再試',
    'auth/quota-exceeded': '今天寄登入信的次數已經達到上限（Firebase 免費方案整個專案每天只能寄 5 封），請改用「Email＋密碼」登入，或明天再試',
    'auth/invalid-credential': 'Email 或密碼不正確。如果這個帳號是用 Google 註冊的，請先在電腦用 Google 登入，再到「帳號與同步」按「設定密碼」',
    'auth/wrong-password': 'Email 或密碼不正確',
    'auth/user-not-found': '找不到這個帳號，可以按「建立新帳號」',
    'auth/missing-password': '請輸入密碼',
    'auth/weak-password': '密碼至少要 6 個字元',
    'auth/email-already-in-use': '這個 Email 已經註冊過了（可能是用 Google 註冊的），請直接登入；如果沒有密碼，先在電腦用 Google 登入後「設定密碼」',
    'auth/requires-recent-login': '為了安全，請先登出、重新登入一次，再設定密碼',
    'auth/provider-already-linked': '這個帳號已經有密碼了',
    'auth/credential-already-in-use': '這個 Email 已經被另一個帳號使用',
    'permission-denied': '雲端資料庫拒絕存取（請確認 Firestore 安全規則，見 docs/firebase-setup.md 第 5 步）',
    unavailable: '暫時連不上雲端資料庫，稍後會自動重試',
  };
  return map[code] || err?.message || String(err);
}

async function ensureRemote() {
  if (state.remote) return state.remote;
  if (!remotePromise) {
    emit({ status: 'connecting' });
    remotePromise = import('./firebase-remote.js')
      .then((m) => m.createFirebaseRemote(getConfig()))
      .then((remote) => {
        state.remote = remote;
        remote.onAuth(user => {
          if (!profileIsCurrent()) return;
          if (state.user?.uid === user?.uid && (user?.uid || '') === profileOwner()) return;
          try { changeAccount(user); }
          catch (err) { emit({ status: 'error', error: friendlyError(err) }); }
        });
        return remote;
      })
      .catch((err) => {
        remotePromise = null;
        emit({ status: navigator.onLine ? 'error' : 'offline', error: navigator.onLine ? `無法載入 Firebase：${err.message}` : '' });
        throw err;
      });
  }
  return remotePromise;
}

// 用「登入連結」打開網站時，完成登入並把網址上的參數清掉
async function handleEmailLinkLanding() {
  const remote = await ensureRemote();
  if (!remote.isEmailLink(location.href)) return;
  const email = ls.get(EMAIL_KEY, '');
  if (email) {
    await completeEmailLink(email, location.href);
  } else {
    // 在別的裝置／瀏覽器點了連結：請使用者輸入 Email 確認（設定頁會顯示輸入框）
    emit({ pendingLink: location.href });
    location.hash = '#/settings';
  }
}

function cleanUrl() {
  const hash = location.hash || '#/review';
  history.replaceState(null, '', location.pathname + hash);
}

export async function initSync() {
  if (!syncConfigured()) return;
  const looksLikeLink = /[?&]oobCode=/.test(location.search) && /[?&]mode=signIn/.test(location.search);
  // 之前登入過、或用登入連結打開網站，才載入 Firebase（沒用同步的人不會多下載任何東西）
  if (ls.get(ACTIVE_KEY, '') || looksLikeLink) {
    try {
      if (looksLikeLink) await handleEmailLinkLanding();
      else await ensureRemote();
    } catch (err) {
      emit({ status: 'error', error: friendlyError(err) });
    }
  }
  subscribe(schedulePush);
  onLogChange(schedulePush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.user && Date.now() - lastFocusSync > FOCUS_THROTTLE) {
      lastFocusSync = Date.now();
      syncNow();
    }
  });
  window.addEventListener('online', () => { if (state.user) syncNow(); });
  window.addEventListener('offline', () => { if (state.user) emit({ status: 'offline' }); });
}

function schedulePush() {
  if (!state.user || applying) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(syncNow, PUSH_DELAY);
}

// ---- 登入／登出 ----
export async function signInWithGoogle() {
  const remote = await ensureRemote();
  try {
    return await remote.signInGoogle();
  } catch (err) {
    throw new Error(friendlyError(err));
  }
}

// 登入連結會連回目前這個網址（不含 #/設定 等頁面）
export async function sendEmailLink(email) {
  const remote = await ensureRemote();
  const url = location.origin + location.pathname;
  try {
    await remote.sendEmailLink(email.trim(), url);
  } catch (err) {
    throw new Error(friendlyError(err));
  }
  ls.set(EMAIL_KEY, email.trim());
  emit({ linkSentTo: email.trim() });
}

// 完成 Email 連結登入；link 可以是目前的網址，也可以是使用者貼上的連結（iPhone 主畫面 App 用）
export async function completeEmailLink(email, link) {
  const remote = await ensureRemote();
  if (!remote.isEmailLink(link)) throw new Error('這不是有效的登入連結，請從信裡複製完整的連結');
  try {
    await remote.completeEmailLink(email.trim(), link);
  } catch (err) {
    throw new Error(friendlyError(err));
  }
  ls.del(EMAIL_KEY);
  emit({ pendingLink: '', linkSentTo: '' });
  if (/[?&]oobCode=/.test(location.search)) cleanUrl();
}

// ---- Email＋密碼 ----
async function withFriendly(fn) {
  try {
    return await fn();
  } catch (err) {
    throw new Error(friendlyError(err));
  }
}

export async function signInWithPassword(email, password) {
  const remote = await ensureRemote();
  return withFriendly(() => remote.signInPassword(email.trim(), password));
}

export async function registerWithPassword(email, password) {
  const remote = await ensureRemote();
  return withFriendly(() => remote.registerPassword(email.trim(), password));
}

// 已登入的帳號加上密碼（電腦用 Google 登入後設定，iPhone 主畫面 App 就能用 Email＋密碼登入同一個帳號）
export async function setAccountPassword(password) {
  const remote = await ensureRemote();
  const user = await withFriendly(() => remote.setPassword(password));
  emit({ user });
  return user;
}

export async function sendPasswordReset(email) {
  const remote = await ensureRemote();
  return withFriendly(() => remote.resetPassword(email.trim()));
}

export async function signOutSync() {
  if (!state.remote) return;
  signingOut = true;
  invalidateSession();
  try { await state.remote.signOut(); if (profileIsCurrent() && state.user) changeAccount(null); }
  finally { signingOut = false; }
}

// ---- 同步 ----
export function syncNow() {
  clearTimeout(pushTimer);
  if (running) { rerun = true; return running; }
  running = doSync().finally(() => {
    running = null;
    if (rerun) { rerun = false; syncNow(); }
  });
  return running;
}

async function doSync() {
  const remote = state.remote;
  const user = state.user;
  if (!remote || !user || state.guestChoice || signingOut || user.uid !== profileOwner() || !profileIsCurrent()) return;
  const token = session;
  const active = () => token === session && !signingOut && profileIsCurrent() && state.user?.uid === user.uid;
  const check = () => { if (!active()) throw Object.assign(new Error('帳號已切換'), { cancelled: true }); };
  if (!navigator.onLine) { emit({ status: 'offline' }); return; }
  emit({ status: 'syncing', error: '' });
  const uid = user.uid;
  try {
    const st = loadState(uid);
    const restoring = !!profileStorage.getItem('toeic-cards:restoreIntent');

    // 1. 拉下雲端有變動的單字，套用到本機
    //    （套用和寫入之間沒有任何等待，不會蓋掉同步途中使用者做的修改，見 decisions #31）
    const { docs, maxSyncedAt } = await remote.pullWords(uid, restoring ? 0 : st.lastPullAt);
    check();
    if (restoring) {
      const now = Math.max(Date.now(),...docs.map(d=>(Number(d.updatedAt)||0)+1),...getWords().map(w=>w.updatedAt+1));
      const wanted = new Set(getWords().map(w=>w.word));
      const tombs = {...getTombstones()};
      for (const d of docs) if (!wanted.has(d.word)) tombs[d.word]=now;
      for (const word of wanted) delete tombs[word];
      setTombstones(tombs);
      replaceWords(getWords().map(w=>({...w,updatedAt:now})));
      st.pushed = {};
    }
    const applied = applyRemoteWords(getWords(), getTombstones(), docs);
    for (const d of docs) st.pushed[d.word] = Math.max(st.pushed[d.word] || 0, Number(d.updatedAt) || 0);
    st.lastPullAt = maxSyncedAt;
    saveState(uid, st);
    const s = applied.summary;
    setTombstones(applied.tombstones);
    if (s.added || s.updated || s.deleted) {
      applying = true;
      try { replaceWords(applied.words); } finally { applying = false; }
    }

    // 2. 上傳本機有變更的單字和刪除紀錄
    const pending = pendingChanges(getWords(), getTombstones(), st.pushed);
    if (pending.length) {
      await remote.pushWords(uid, pending, active);
      check();
      for (const p of pending) st.pushed[p.word] = p.updatedAt;
      saveState(uid, st);
    }

    // 3. 每日紀錄：上傳自己的，拉下其他裝置的（顯示時加總）
    const ledger = await remote.syncLogLedger(uid, getLogLedger(), !!profileStorage.getItem('toeic-cards:logReset'), active);
    check();
    const latest = getLogLedger();
    setLogLedger(mergeLedgers(ledger, latest.epoch.id === ledger.epoch.id ? {...latest,epoch:ledger.epoch} : latest));
    profileStorage.removeItem('toeic-cards:logReset');

    // 4. 設定：比較新的勝出
    const rs = await remote.getMeta(uid, 'settings');
    check();
    if (restoring) setSettingsUpdatedAt(Math.max(Date.now(),(rs?.updatedAt||0)+1));
    const sSide = newerSide(settingsUpdatedAt(), rs);
    if (sSide === 'pull') {
      applying = true;
      try { updateSettings(remoteSettings(rs.value, getDefaultSettings()), { fromSync: true }); } finally { applying = false; }
      setSettingsUpdatedAt(rs.updatedAt);
    } else if (sSide === 'push') {
      await remote.setMeta(uid, 'settings', pickSyncedSettings(getSettings()), settingsUpdatedAt());
      check();
    }

    // 5. 錯題本：比較新的勝出（題目裡的單字 id 換成本機的）
    const rm = await remote.getMeta(uid, 'mistakes');
    check();
    if (restoring) setMistakesFromSync(getMistakes(),Math.max(Date.now(),(rm?.updatedAt||0)+1));
    const mSide = newerSide(mistakesUpdatedAt(), rm);
    if (mSide === 'pull') setMistakesFromSync(remapMistakes(rm.value, getWords()), rm.updatedAt);
    else if (mSide === 'push') await remote.setMeta(uid, 'mistakes', getMistakes(), mistakesUpdatedAt());
    check();

    // 6. 單字集與每個成員分別合併；等待網路期間的新修改也要保留。
    const sets = await remote.syncWordSets(uid, getSetRecords(), active, restoring);
    check();
    applying = true;
    try { mergeSetRecords(sets); } finally { applying = false; }
    if (restoring) profileStorage.removeItem('toeic-cards:restoreIntent');

    const guest = JSON.parse(profileStorage.getItem('toeic-cards:pendingGuest') || 'null');
    if (guest) {
      if (!flushWords()) throw new Error('帳號字卡尚未存好，訪客資料仍保留，請釋放空間後重試。');
      if (guest.logLedger) guest.logLedger.epoch = getLogLedger().epoch;
      const result = mergeBackup({ words: getWords(), log: getOwnLog(), logLedger:getLogLedger(), mistakes: getMistakes(), wordSets: getSetRecords() }, guest);
      writeProfile(uid, { words: result.words, log: result.log, mistakes: result.mistakes,
        ...(result.logLedger ? {logLedger:result.logLedger} : {}), wordSets: result.wordSets, mistakesAt: Date.now() });
      profileStorage.removeItem('toeic-cards:pendingGuest');
      location.reload();
      return;
    }

    // 其他裝置的紀錄和錯題不經過 store，主動通知畫面重畫
    applying = true;
    try { updateSettings({}, { fromSync: true }); } finally { applying = false; }
    emit({ status: 'idle', lastSyncAt: Date.now(), summary: { ...s, pushed: pending.length } });
  } catch (err) {
    if (!active() || err.cancelled) return;
    emit({ status: navigator.onLine ? 'error' : 'offline', error: friendlyError(err) });
  }
}
