import {profileStorage} from '../profile-storage.js';
const KEY='toeic-cards:settingsSections';
const groups=[['syncPanel','帳號'],['aiPanel','AI'],['backupPanel','備份'],['pwaPanel','離線'],['learningPanel','學習偏好'],['appearancePanel','外觀'],['speechPanel','發音']];
export function bindSettingsSections(root) {
  let saved={};try{saved=JSON.parse(profileStorage.getItem(KEY)||'{}');}catch{}
  const nav=document.createElement('nav');nav.className='settings-nav';nav.setAttribute('aria-label','設定區塊');
  for(const [id,title] of groups) {
    const panel=root.querySelector('#'+id);if(!panel)continue;
    const group=document.createElement('details');group.className='settings-section';group.id=id+'Section';group.dataset.section=id;
    group.open=typeof saved[id]==='boolean'?saved[id]:['syncPanel','learningPanel'].includes(id);
    const summary=document.createElement('summary');summary.textContent=title;
    panel.before(group);group.append(summary,panel);
    group.addEventListener('toggle',()=>{
      saved={...saved,[id]:group.open};try{profileStorage.setItem(KEY,JSON.stringify(saved));}catch{}
    });
    const button=document.createElement('button');button.type='button';button.className='btn btn-ghost btn-sm';button.textContent=title;button.setAttribute('aria-controls',group.id);
    button.addEventListener('click',()=>{group.open=true;summary.focus({preventScroll:true});group.scrollIntoView({block:'start',behavior:'instant'});});
    nav.append(button);
  }
  root.querySelector('.page-title').after(nav);
}
