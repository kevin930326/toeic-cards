// 單字庫、複習、自由瀏覽與測驗共用單字集選擇器。
import { getWordSets, getSetRecords, getWords, activeSetId, updateSettings, createWordSet } from './store.js';
import { indexMembership } from './word-sets.js?v=dictionary-scale-1';
import { esc, toast } from './ui.js';

// 選單裡「＋ 新增單字集…」的值；選到時跳出命名視窗，不會被當成單字集 id 送出
export const NEW_SET = '__new-set__';

export function setOptions(selected = '', { scopes = false, create = false } = {}) {
  const words = getWords();
  const { counts, unfiled } = indexMembership(words, getSetRecords());
  const option = (id, name) => `<option value="${esc(id)}" ${selected === id ? 'selected' : ''}>${esc(name)}</option>`;
  return option('', scopes ? `全部單字（${words.length}）` : '不指定單字集')
    + (scopes ? option('unfiled', `未分類（${unfiled}）`) : '')
    + getWordSets().map((s) => option(s.id, `${s.name}（${counts.get(s.id) || 0}）`)).join('')
    + (create ? `<option value="${NEW_SET}">＋ 新增單字集…</option>` : '');
}

// 加字的選單（查單字收藏、新增時加入、批次整理）可以直接建立單字集，不必先到單字庫：
// 選到「＋ 新增單字集…」→ 命名視窗 → 建立後自動選好新的單字集，並照常觸發 change。
// 用 capture 先攔下，其他 change 監聽器不會看到 NEW_SET；取消就回到原本的選擇。
export function bindCreateSet(select) {
  if (!select) return;
  let previous = select.value === NEW_SET ? '' : select.value;
  select.addEventListener('change', (event) => {
    if (select.value !== NEW_SET) { previous = select.value; return; }
    event.stopImmediatePropagation();
    select.value = previous;
    askSetName('', (name) => {
      const set = createWordSet(name);
      select.innerHTML = setOptions(set.id, { create: true });
      previous = set.id;
      select.dispatchEvent(new Event('change'));
      toast(`已建立「${set.name}」並選好`);
    }, { title: '新增單字集', submit: '建立並選擇' });
  }, true);
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

// 命名（改名、新增）使用原生 dialog，支援 Enter 儲存、Escape 取消與焦點返回。
export function askSetName(name, save, { title = '重新命名單字集', submit = '儲存名稱' } = {}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog set-name-dialog';
  dialog.innerHTML = `<form><h2 class="dialog-title">${esc(title)}</h2>
    <label class="field"><span>單字集名稱</span><input name="setName" value="${esc(name)}" required maxlength="60"></label>
    <p class="ai-error" role="alert" hidden></p><div class="dialog-actions">
      <button class="btn btn-ghost" type="button">取消</button><button class="btn btn-primary" type="submit">${esc(submit)}</button>
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
