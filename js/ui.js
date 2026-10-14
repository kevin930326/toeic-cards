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
        updateWord(id, { word: form.word.value, pos, zh, en, src, ...lists });
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
