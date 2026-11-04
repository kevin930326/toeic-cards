const KEY = 'toeic-cards:deviceId';
// crypto.randomUUID 只在安全連線（https、localhost）才有；用區網 IP 的 http 在手機上預覽時改用 getRandomValues 組出同格式的 id
export function randomId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function deviceId() {
  let id = '';
  try { id = JSON.parse(localStorage.getItem(KEY) || '""'); } catch { /* 重新建立 */ }
  if (!id) {
    id = randomId();
    localStorage.setItem(KEY, JSON.stringify(id));
  }
  return id;
}
