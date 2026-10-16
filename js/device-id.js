const KEY = 'toeic-cards:deviceId';
export function deviceId() {
  let id = '';
  try { id = JSON.parse(localStorage.getItem(KEY) || '""'); } catch { /* 重新建立 */ }
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, JSON.stringify(id));
  }
  return id;
}
