// 共用的小工具：跳脫 HTML、提示訊息、編輯視窗
import { getWord, updateWord } from './store.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// 把中文意思拆成多行；每行若以詞性開頭（如「v. 核准」）就分出詞性
const POS_RE = /^((?:[a-z]+\.\s*(?:&|\/)?\s*)+)\s*(.*)$/i;
export function zhLines(zh) {
  return String(zh || '').split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const m = line.match(POS_RE);
    return m ? { pos: m[1].trim(), text: m[2] } : { pos: '', text: line };
  });
}

// 每日目標的進度環（複習頁、統計頁共用）
export function goalRingHTML(done, goal, size = 40) {
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const ratio = Math.min(1, goal ? done / goal : 0);
  return `<svg class="goal-ring ${ratio >= 1 ? 'is-met' : ''}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle class="goal-track" cx="${size / 2}" cy="${size / 2}" r="${r}"/>
    <circle class="goal-fill" cx="${size / 2}" cy="${size / 2}" r="${r}"
      stroke-dasharray="${(c * ratio).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    ${ratio >= 1 ? `<path class="goal-check" d="M${size * 0.32} ${size * 0.52} l${size * 0.12} ${size * 0.12} l${size * 0.24} -${size * 0.26}"/>` : ''}
  </svg>`;
}

let toastTimer;
export function toast(msg, kind = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.dataset.kind = kind;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

const splitList = (s) => String(s || '').split(/[,，、]/).map((x) => x.trim()).filter(Boolean);

// 打開編輯視窗；儲存成功回傳 true
export function openEditor(id) {
  const w = getWord(id);
  if (!w) return Promise.resolve(false);
  const dialog = document.getElementById('editDialog');
  const form = document.getElementById('editForm');
  dialog.querySelector('.sync-conflicts')?.remove();
  if(w._conflicts?.length) {
    const notice=document.createElement('div');notice.className='sync-conflicts pwa-note';
    const labels={zh:'中文意思',en:'英文解釋',pos:'詞性',phonetic:'音標',srs:'複習排程',unfamiliar:'不熟標記',examples:'例句',collocations:'搭配詞',forms:'詞形',synonyms:'同義詞'};
    notice.innerHTML=`<strong>這張卡有同步衝突</strong><p>不同欄位已合併；以下同一欄位有不同修改。請比較並選擇要保留的版本，也可以在下方表單再修改。按儲存代表已確認；取消仍保留兩份內容。</p>${w._conflicts.map((c,i)=>`<label> ${esc(labels[c.field]||'字卡內容')}<select data-conflict="${i}">${c.alternatives.map((a,j)=>`<option value="${j}" ${JSON.stringify(a.value)===JSON.stringify(w[c.field])?'selected':''}>${esc(typeof a.value==='string'?a.value:c.field==='srs'?`間隔 ${a.value?.interval||0} 天／連續答對 ${a.value?.reps||0} 次`:JSON.stringify(a.value))}</option>`).join('')}</select></label>`).join('')}`;
    notice.addEventListener('change',e=>{
      const c=w._conflicts[Number(e.target.dataset.conflict)];if(!c)return;
      const value=c.alternatives[Number(e.target.value)].value,field=form.elements.namedItem(c.field);
      if(field)field.value=Array.isArray(value)?c.field==='examples'?value.map(e=>e.en+(e.zh?' | '+e.zh:'')).join('\n'):value.join(', '):value??'';
    });
    form.prepend(notice);
  }
  form.word.value = w.word;
  form.pos.value = w.pos;
  form.zh.value = w.zh;
  form.en.value = w.en;
  form.examples.value = w.examples.map((e) => (e.zh ? `${e.en} | ${e.zh}` : e.en)).join('\n');
  form.collocations.value = w.collocations.join(', ');
  form.forms.value = w.forms.join(', ');
  form.synonyms.value = w.synonyms.join(', ');

  return new Promise((resolve) => {
    const cancel = document.getElementById('editCancel');
    const cleanup = () => {
      form.removeEventListener('submit', onSubmit);
      cancel.removeEventListener('click', onCancel);
      dialog.removeEventListener('close', onClose);
    };
    const onSubmit = (e) => {
      e.preventDefault();
      try {
        const pos = form.pos.value.trim();
        const zh = form.zh.value.trim();
        const en = form.en.value.trim();
        // 使用者改過的欄位標記為 'user'，之後自動生成時不會被蓋掉
        const src = { ...(w.src || {}) };
        if (pos !== w.pos) src.pos = 'user';
        if (zh !== w.zh) src.zh = 'user';
        if (en !== w.en) src.en = 'user';
        const lists = {
          examples: form.examples.value.split('\n').map((line) => {
            const [exEn, ...rest] = line.split('|');
            return { en: exEn.trim(), zh: rest.join('|').trim() };
          }).filter((e) => e.en),
          collocations: splitList(form.collocations.value),
          forms: splitList(form.forms.value),
          synonyms: splitList(form.synonyms.value),
        };
        for (const [k, v] of Object.entries(lists)) {
          if (JSON.stringify(v) !== JSON.stringify(w[k])) src[k] = 'user';
        }
        const resolved={};
        for(const select of dialog.querySelectorAll('[data-conflict]')) {
          const c=w._conflicts[Number(select.dataset.conflict)];
          if(!form.elements.namedItem(c.field))resolved[c.field]=c.alternatives[Number(select.value)].value;
        }
        updateWord(id, { word: form.word.value, pos, zh, en, src, ...lists, ...resolved, ...(w._conflicts?.length?{_conflicts:[]}: {}) });
        cleanup();
        dialog.close();
        toast('已儲存');
        resolve(true);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    const onCancel = () => { cleanup(); dialog.close(); resolve(false); };
    const onClose = () => { cleanup(); resolve(false); };
    form.addEventListener('submit', onSubmit);
    cancel.addEventListener('click', onCancel);
    dialog.addEventListener('close', onClose);
    dialog.showModal();
    form.word.focus();
  });
}

export function confirmAction(msg) {
  return window.confirm(msg);
}
