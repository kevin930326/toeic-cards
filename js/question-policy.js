import { FORMS_CATALOG } from './forms-catalog.js';
export const QUESTION_POLICY = 2;
// 用於偵測修訂／快取內容，不作密碼學或安全憑證。
export function questionSignature(q) {
  const text=JSON.stringify([q.sentence,q.answer,[...(q.distractors||[])].sort(),q.translation,q.explanation]);
  let hash=2166136261;
  for(const c of text) { hash ^= c.charCodeAt(0); hash = Math.imul(hash,16777619); }
  return (hash>>>0).toString(16);
}
export function currentSavedQuestion(q) {
  if (!q || q.policy!==QUESTION_POLICY) return false;
  if(q.source==='builtin') return FORMS_CATALOG[q.id]?.signature===questionSignature(q) && FORMS_CATALOG[q.id]?.revision===q.revision;
  return q.source==='ai' && q.review==='ai-checked' && q.signature===questionSignature(q) && q.optionReasons?.length===4;
}
export function currentQuizQuestion(q) {
  if(!['part5','forms'].includes(q?.mode)) return true;
  return currentSavedQuestion({sentence:q.prompt,answer:q.options?.[q.answerIndex],distractors:q.options?.filter((_,i)=>i!==q.answerIndex),
    translation:q.extra?.translation,explanation:q.extra?.explanation,...q.extra,id:q.extra?.qid});
}
