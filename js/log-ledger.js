// 每個來源保留獨立快照。同來源取較新 revision，不把加總結果當成新的裝置紀錄。
const fields = ['reviews', 'again', 'good', 'learned', 'quiz', 'quizCorrect', 'goal'];
const number = value => Number.isFinite(Number(value)) ? Math.max(0,Number(value)) : 0;
export function cleanDays(raw) {
  const out = {};
  for (const [day, value] of Object.entries(raw || {}).sort(([a],[b])=>a.localeCompare(b))) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !value || typeof value !== 'object') continue;
    out[day] = {};
    for (const f of fields) if (value[f] !== undefined) out[day][f] = Math.round(number(value[f]));
  }
  return out;
}
export function cleanLedger(raw) {
  const sources = Object.create(null);
  for (const [id, s] of Object.entries(raw?.sources || {})) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !s || typeof s !== 'object') continue;
    sources[id] = { log: cleanDays(s.log), updatedAt: number(s.updatedAt) };
  }
  return { epoch: { id: String(raw?.epoch?.id || '').slice(0,64), at: number(raw?.epoch?.at) }, sources };
}
export function mergeLedgers(a, b) {
  a = cleanLedger(a); b = cleanLedger(b);
  if (a.epoch.at !== b.epoch.at) return a.epoch.at > b.epoch.at ? a : b;
  if (a.epoch.id !== b.epoch.id) return a.epoch.id > b.epoch.id ? a : b;
  const sources = { ...a.sources };
  for (const [id, entry] of Object.entries(b.sources)) {
    const old = sources[id];
    if (!old || entry.updatedAt > old.updatedAt || (entry.updatedAt === old.updatedAt && JSON.stringify(entry.log) > JSON.stringify(old.log))) sources[id] = entry;
  }
  return { epoch: a.epoch, sources };
}
export function ledgerTotal(raw) {
  const out = {};
  for (const source of Object.values(cleanLedger(raw).sources)) {
    for (const [day, values] of Object.entries(source.log)) {
      const d = out[day] ||= {};
      for (const [field, n] of Object.entries(values)) d[field] = field === 'goal' ? Math.max(d[field] || 0,n) : (d[field] || 0)+n;
    }
  }
  return out;
}
export function resetLedger(ledger, id, at = Date.now()) {
  const clean = cleanLedger(ledger);
  return { ...clean, epoch: {id, at: Math.max(at, clean.epoch.at+1)} };
}
// 舊備份只有總數，無法推定來源是否重疊，採各日最大值避免重複加總。
export function legacyLedger(log, id) {
  return cleanLedger({sources:{[id]:{log,updatedAt:1}}});
}
