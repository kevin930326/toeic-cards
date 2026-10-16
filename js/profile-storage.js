// 每份本機資料都有歸屬；舊資料原地保留，避免升級時複製整份字庫而超出空間。
const OWNER = 'toeic-cards:profileOwner';
const MIGRATED = 'toeic-cards:profiles-v1';
export const PROFILE_KEYS = ['words', 'settings', 'wordSets', 'deleted', 'log', 'remoteLogs',
  'settingsAt', 'mistakes', 'mistakesAt', 'lastBackup', 'celebrated', 'readings', 'gemini-key', 'thinking',
  'logLedger', 'logOrigin', 'logReset', 'restoreIntent', 'pendingGuest', 'questionReports'];
let raw;
try { raw = globalThis.localStorage; } catch { /* 被封鎖時仍讓網站可開啟 */ }
const parse = (s, fallback) => { try { return JSON.parse(s) ?? fallback; } catch { return fallback; } };
const readRaw = k => { try { return raw?.getItem(k) ?? null; } catch { return null; } };
const legacyOwner = parse(readRaw(MIGRATED), null)?.legacyOwner ?? parse(readRaw('toeic-cards:syncActive'), '');
const persistedOwner = () => parse(readRaw(OWNER), legacyOwner);
const owner = persistedOwner();
let leaving = false;
export function profileKey(key, uid = owner) {
  if (uid === legacyOwner) return key;
  return `toeic-cards:account:${uid ? encodeURIComponent(uid) : '_guest'}:${key.replace('toeic-cards:', '')}`;
}
export const profileOwner = () => owner;
export const profileIsCurrent = () => persistedOwner() === owner;
export function pinProfileLayout() {
  check();
  if (!raw) throw new Error('瀏覽器封鎖了儲存空間，無法安全切換帳號');
  raw.setItem(MIGRATED, JSON.stringify({legacyOwner}));
}
function check() {
  if (!profileIsCurrent() && !leaving) throw new Error('帳號已在另一個頁面切換，請重新整理後再操作。');
}
export const profileStorage = {
  getItem(key) { check(); return readRaw(profileKey(key)); },
  setItem(key, value) { check(); if (!raw) throw new Error('瀏覽器封鎖了儲存空間'); raw.setItem(profileKey(key), value); },
  removeItem(key) { check(); raw?.removeItem(profileKey(key)); },
};
export function readProfile(uid) {
  return Object.fromEntries(PROFILE_KEYS.map(k => [k, parse(readRaw(profileKey('toeic-cards:' + k, uid)), null)]));
}
export function hasGuestData() {
  const g = readProfile('');
  return !!(g.words?.length || Object.keys(g.log || {}).length || g.mistakes?.length || g.wordSets?.length);
}
export function activateProfile(uid) {
  check();
  if (!raw) throw new Error('瀏覽器封鎖了儲存空間，無法安全切換帳號');
  // 先保存舊資料的歸屬，才可改變目前帳號；任何一步失敗都不重載。
  pinProfileLayout();
  raw.setItem(OWNER, JSON.stringify(uid || ''));
  location.reload();
}
export function writeProfile(uid, values) {
  check();
  const old = [];
  try {
    for (const [k, v] of Object.entries(values)) {
      const key = profileKey('toeic-cards:' + k, uid);
      old.push([key, readRaw(key)]);
      raw.setItem(key, JSON.stringify(v));
    }
  } catch (err) {
    for (const [k, v] of old.reverse()) {
      try { if (v === null) raw.removeItem(k); else raw.setItem(k, v); } catch { /* 來源不刪除，可重試 */ }
    }
    throw err;
  }
}
if (typeof window !== 'undefined') window.addEventListener('storage', e => {
  if (e.key !== OWNER || profileIsCurrent()) return;
  // 另一分頁切帳時，將尚未完成的延後存檔寫回「舊帳號自己的槽位」。
  leaving = true;
  const event = new Event('toeic:profile-leave', {cancelable:true});
  window.dispatchEvent(event);
  leaving = false;
  if (!event.defaultPrevented) location.reload();
});
