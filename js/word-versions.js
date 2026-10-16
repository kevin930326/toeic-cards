// 字卡欄位的邏輯版本。計數只依已觀察版本遞增，與裝置時鐘無關。
export const WORD_FIELDS=['phonetic','pos','zh','en','examples','collocations','forms','synonyms','unfamiliar','lookup','llm','srs','part5','formQs','autoGenerate','pack',
  ...['pos','zh','en','examples','collocations','forms','synonyms'].map(k=>'src.'+k)];
const value=(w,k)=>k.startsWith('src.') ? w.src?.[k.slice(4)] : w[k];
const put=(w,k,v)=>{if(k.startsWith('src.')) {w.src={...w.src,[k.slice(4)]:v};} else w[k]=v;};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const clockToken=c=>c ? `${c[0]}:${c[1]}` : '';
export function compareClock(a=[0,''],b=[0,'']) {return a[0]-b[0] || (String(a[1])===String(b[1])?0:String(a[1])>String(b[1])?1:-1);}
export function birthClock(w) {return w?._rev?.birth || [Number(w?.createdAt)||Number(w?.updatedAt)||0,'legacy'];}
export function fieldClock(w,k) {return w?._rev?.fields?.[k] || (w?._rev ? birthClock(w) : [Number(w?.updatedAt)||0,'legacy']);}
export function versionCeiling(w) {return Math.max(w?.updatedAt||0,birthClock(w)[0],...Object.values(w?._rev?.fields||{}).map(c=>c[0]));}
export function stampWord(w,patch,n,actor) {
  const next={...w,...patch,src:patch.src||w.src};
  const rev=structuredClone(w._rev || {birth:birthClock(w),fields:{}});
  if(patch._conflicts?.length===0 && w._conflicts?.length) rev.resolved=[...new Set([...(rev.resolved||[]),...w._conflicts.map(c=>c.key)])].sort().slice(-300);
  for(const k of WORD_FIELDS) if(!equal(value(w,k),value(next,k)) || (patch._conflicts?.length===0 && w._conflicts?.some(c=>c.field===k))) rev.fields[k]=[n,actor,clockToken(fieldClock(w,k))];
  return {...next,_rev:rev,updatedAt:n};
}
export function mergeVersionedWords(a,b) {
  if(!a?._rev && !b?._rev) return (b.updatedAt||0)>(a.updatedAt||0) ? {...b,id:a.id} : a;
  // 刪後重新建立是另一代卡片，不能把舊進度重新拼回。
  if(compareClock(birthClock(a),birthClock(b))!==0) return compareClock(birthClock(a),birthClock(b))>0 ? a : {...b,id:a.id};
  const resolved=[...new Set([...(a._rev?.resolved||[]),...(b._rev?.resolved||[])])].sort().slice(-300);
  const out={...a,_rev:{birth:birthClock(a),fields:{...a._rev?.fields},...(resolved.length?{resolved}: {})}};
  const conflicts=new Map([...(a._conflicts||[]),...(b._conflicts||[])].map(c=>[c.key,c]));
  for(const k of WORD_FIELDS) {
    const ca=fieldClock(a,k),cb=fieldClock(b,k),cmp=compareClock(ca,cb);
    if(cmp<0) {put(out,k,value(b,k));out._rev.fields[k]=cb;}
    if(!['lookup','llm','part5','formQs'].includes(k) && !k.startsWith('src.') && cmp && !equal(value(a,k),value(b,k)) && ca[1]!=='legacy' && cb[1]!=='legacy' && ca[2]!==clockToken(cb) && cb[2]!==clockToken(ca)) {
      const pair=[{clock:ca,value:value(a,k)},{clock:cb,value:value(b,k)}].sort((x,y)=>compareClock(x.clock,y.clock));
      const key=k+'|'+pair.map(x=>clockToken(x.clock)).join('|');
      conflicts.set(key,{key,field:k,alternatives:pair});
    }
  }
  out._conflicts=[...conflicts.values()].filter(c=>!resolved.includes(c.key)).sort((x,y)=>x.key<y.key?-1:x.key>y.key?1:0).slice(-30);
  out.updatedAt=Math.max(versionCeiling(a),versionCeiling(b));
  return out;
}
export function sanitizeVersions(raw) {
  const clock=c=>Array.isArray(c)&&Number.isSafeInteger(c[0])&&c[0]>=0&&typeof c[1]==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(c[1]) ? [c[0],c[1],String(c[2]||'').slice(0,100)] : null;
  const birth=clock(raw?.birth);if(!birth)return undefined;
  const fields={};
  for(const k of WORD_FIELDS) {const c=clock(raw.fields?.[k]);if(c)fields[k]=c;}
  return {birth,fields,...(Array.isArray(raw.resolved)?{resolved:raw.resolved.filter(x=>typeof x==='string').map(x=>x.slice(0,300)).sort().slice(-300)}:{})};
}
