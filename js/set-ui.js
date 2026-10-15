// 單字庫、複習、自由瀏覽與測驗共用單字集選擇器。
import { getWordSets, getSetRecords, getWords, activeSetId, updateSettings } from './store.js';
import { indexMembership } from './word-sets.js?v=dictionary-scale-1';
import { esc } from './ui.js';

export function setOptions(selected = '', { scopes = false } = {}) {
  const words = getWords();
  const { counts, unfiled } = indexMembership(words, getSetRecords());
  const option = (id, name) => `<option value="${esc(id)}" ${selected === id ? 'selected' : ''}>${esc(name)}</option>`;
  return option('', scopes ? `全部單字（${words.length}）` : '不指定單字集')
    + (scopes ? option('unfiled', `未分類（${unfiled}）`) : '')
    + getWordSets().map((s) => option(s.id, `${s.name}（${counts.get(s.id) || 0}）`)).join('');
}

export function setScopeHTML() {
  return `<label class="set-scope"><span>單字集</span><select id="setScope">${setOptions(activeSetId(), { scopes: true })}</select></label>`;
}

export function bindSetScope(root) {
  root.querySelector('#setScope')?.addEventListener('change', (e) => updateSettings({ activeSetId: e.target.value }));
}

export function refreshSetScope(root) {
  const el = root.querySelector('#setScope');
  if (el) el.innerHTML = setOptions(activeSetId(), { scopes: true });
}

// 改名使用原生 dialog，支援 Enter 儲存、Escape 取消與焦點返回。
export function askSetName(name, save) {
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog set-name-dialog';
  dialog.innerHTML = `<form><h2 class="dialog-title">重新命名單字集</h2>
    <label class="field"><span>單字集名稱</span><input name="setName" value="${esc(name)}" required maxlength="60"></label>
    <p class="ai-error" role="alert" hidden></p><div class="dialog-actions">
      <button class="btn btn-ghost" type="button">取消</button><button class="btn btn-primary" type="submit">儲存名稱</button>
    </div></form>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.querySelector('button[type="button"]').addEventListener('click', () => dialog.close());
  dialog.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    try { save(dialog.querySelector('input').value); dialog.close(); }
    catch (err) { const msg = dialog.querySelector('[role="alert"]'); msg.hidden = false; msg.textContent = err.message; }
  });
  dialog.showModal();
  dialog.querySelector('input').select();
}
