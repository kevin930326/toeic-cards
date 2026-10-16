import {generateJSON} from './llm.js';
import {QUESTION_POLICY,questionSignature} from './question-policy.js';
// 第二次請求只給句子與打亂的選項，不揭露原先指定答案。這仍是 AI 檢查，不能當教師覆核。
export async function reviewGenerated(candidates, signal) {
  if(!candidates.length) return new Map();
  const items=candidates.map((q,i)=>{
    const options=[q.answer,...q.distractors];
    const shift=i%4;
    return {id:String(i),sentence:q.sentence,options:[...options.slice(shift),...options.slice(0,shift)],translation:q.translation};
  });
  const schema={type:'OBJECT',properties:{reviews:{type:'ARRAY',items:{type:'OBJECT',properties:{id:{type:'STRING'},validIndexes:{type:'ARRAY',items:{type:'INTEGER'}},reasons:{type:'ARRAY',items:{type:'STRING'}},translationConsistent:{type:'BOOLEAN'}},required:['id','validIndexes','reasons','translationConsistent']}}},required:['reviews']};
  const {data}=await generateJSON({signal,temperature:0,schema,prompt:`Review English questions for ambiguity. Independently insert EVERY option into the blank. Consider all reasonable tenses, noun compounds, gerunds, participles, ellipsis and ordinary business meanings; do not assume a tense without a clue. Return ALL reasonable option indexes, even if more than one. Give a Traditional Chinese reason for EACH option and check whether the Chinese translation matches the only valid reading. Reject unnatural sentences and uncertain distinctions. Do not invent context that is absent. Items JSON:\n${JSON.stringify(items)}`});
  const accepted=new Map();
  for(const item of items) {
    const matches=(data?.reviews||[]).filter(r=>r.id===item.id);
    if(matches.length!==1) continue;
    const r=matches[0],q=candidates[Number(item.id)];
    if(r.translationConsistent!==true || r.validIndexes?.length!==1 || item.options[r.validIndexes[0]]!==q.answer || r.reasons?.length!==4 || r.reasons.some(x=>typeof x!=='string'||x.trim().length<5)) continue;
    const reasons=[q.answer,...q.distractors].map(o=>r.reasons[item.options.indexOf(o)].slice(0,400));
    accepted.set(q,{...q,policy:QUESTION_POLICY,source:'ai',review:'ai-checked',optionReasons:reasons,signature:questionSignature(q)});
  }
  return accepted;
}
