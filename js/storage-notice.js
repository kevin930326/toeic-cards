import {flushWords} from './store.js';
import {pendingProfileWrites,retryProfileWrites,profileIsCurrent} from './profile-storage.js';
import {currentData} from './restore-data.js';
import {buildBackup,backupFileName} from './backup.js';
export function initStorageNotice() {
  const notice=document.createElement('aside');notice.className='storage-notice pwa-note';notice.hidden=true;notice.setAttribute('role','alert');
  notice.innerHTML='<strong>部分修改尚未儲存</strong><p>瀏覽器空間不足或封鎖儲存。請先匯出備份；釋放空間後可重試。關閉這個頁面可能失去尚未存好的修改。</p><div class="backup-actions"><button class="btn btn-outline" type="button" id="retryStorage">重試儲存</button><button class="btn btn-primary" type="button" id="exportUnsaved">先匯出目前資料</button></div>';
  document.querySelector('main').before(notice);
  window.addEventListener('toeic:save-error',()=>{notice.hidden=false;});
  window.addEventListener('toeic:profile-blocked',()=>{
    notice.hidden=false;notice.querySelector('strong').textContent='帳號已切換，舊頁面有尚未儲存的修改';
    document.querySelector('main').hidden=true;document.querySelector('header').inert=true;
    for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
  });
  notice.querySelector('#retryStorage').addEventListener('click',()=>{
    try {if(retryProfileWrites(flushWords)){if(!profileIsCurrent())location.reload();else {notice.hidden=true;window.dispatchEvent(new Event('toeic:storage-recovered'));}}}catch {notice.hidden=false;}
  });
  notice.querySelector('#exportUnsaved').addEventListener('click',()=>{
    const data=buildBackup(currentData());
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,1)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=backupFileName();a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  window.addEventListener('beforeunload',e=>{if(!flushWords()||pendingProfileWrites()){e.preventDefault();e.returnValue='';}});
}
