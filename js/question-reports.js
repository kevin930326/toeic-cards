import {profileStorage} from './profile-storage.js';
import {currentQuizQuestion} from './question-policy.js';
import {esc} from './ui.js';
const KEY='toeic-cards:questionReports';
export function questionReports() {try{return JSON.parse(profileStorage.getItem(KEY)||'[]');}catch{return [];}}
export function questionEnabled(q) { return currentQuizQuestion(q) && !questionReports().some(r=>r.id===(q.extra?.qid||q.prompt) && r.revision===(q.extra?.revision||q.extra?.policy)); }
export function reportQuestion(q) {
  const prior=document.activeElement;
  const dialog=document.createElement('dialog');dialog.className='question-report-dialog';
  dialog.innerHTML=`<form method="dialog"><h2>停用並回報題目</h2><p>這題會在這個帳號的本機暫停使用。回報先保存在瀏覽器，不會自動傳送。</p><p>${esc(q.prompt)}</p><label for="questionReason">發現的問題</label><textarea id="questionReason" rows="3" maxlength="1000" placeholder="例如：兩個選項都合理，或翻譯與答案不一致"></textarea><div class="backup-actions"><button class="btn btn-outline" value="cancel">保留本題</button><button class="btn btn-primary" value="report">停用並保存回報</button></div></form>`;
  document.body.append(dialog);
  return new Promise((resolve)=>{
    dialog.addEventListener('close',()=>{
      let done=false;
      if(dialog.returnValue==='report') {
        const record={id:q.extra?.qid||q.prompt,revision:q.extra?.revision||q.extra?.policy,question:q,reason:dialog.querySelector('textarea').value,at:Date.now()};
        try {profileStorage.setItem(KEY,JSON.stringify([record,...questionReports()].slice(0,300)));done=true;}
        catch(err) {window.dispatchEvent(new CustomEvent('toeic:save-error',{detail:{message:err.message}}));}
      }
      dialog.remove();prior?.focus();resolve(done);
    },{once:true});
    dialog.showModal();dialog.querySelector('button[value=cancel]').focus();
  });
}
