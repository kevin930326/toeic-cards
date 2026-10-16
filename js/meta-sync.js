// 設定／錯題本以快照版本檢查，並行改同一份時先保留兩份讓使用者確認。
export function stableJSON(value) {
  if(Array.isArray(value))return '['+value.map(stableJSON).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableJSON(value[k])).join(',')+'}';
  return JSON.stringify(value)??'null';
}
export function metaSignature(value) {
  const text=stableJSON(value);let a=2166136261,b=5381;
  for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);a=Math.imul(a^c,16777619);b=Math.imul(b,33)^c;}
  return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
}
export function metaAction(known,localSig,cloudSig,localAt,remoteExists) {
  if(localSig===cloudSig)return 'none';
  const localChanged=known ? localSig!==known.local : localAt>0;
  const remoteChanged=known ? cloudSig!==known.cloud : remoteExists;
  if(localChanged&&remoteChanged)return 'conflict';
  if(localChanged)return 'push';
  if(remoteChanged)return 'pull';
  return 'none';
}
