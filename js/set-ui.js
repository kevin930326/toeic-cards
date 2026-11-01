// 單字庫、複習、自由瀏覽與測驗共用單字集選擇器。
import { getWordSets, getSetRecords, getWords, activeSetId, updateSettings, createWordSet } from './store.js';
import { indexMembership, filterSetWords, scopeIds, UNFILED } from './word-sets.js?v=dictionary-scale-1';
import { esc, toast } from './ui.js';

// 選單裡「＋ 新增單字集…」的值；選到時跳出命名視窗，不會被當成單字集 id 送出
export const NEW_SET = '__new-set__';
// 範圍選單裡「選擇多個單字集…」的值；選到時跳出勾選視窗
export const MULTI_SET = '__multi-set__';

const scopeName = (id) => id === UNFILED ? '未分類' : getWordSets().find((s) => s.id === id)?.name || '';

export function setOptions(selected = '', { scopes = false, create = false } = {}) {
  const words = getWords();
  const { counts, unfiled } = indexMembership(words, getSetRecords());
  const option = (id, name) => `<option value="${esc(id)}" ${selected === id ? 'selected' : ''}>${esc(name)}</option>`;
  // 目前選了多個單字集時，多一個代表這個組合的選項（顯示名稱與合計字數）
  const multi = scopes && scopeIds(selected).length > 1
    ? option(selected, `${scopeIds(selected).map(scopeName).join('＋')}（${filterSetWords(words, getSetRecords(), selected).length}）`) : '';
  return option('', scopes ? `全部單字（${words.length}）` : '不指定單字集')
    + (scopes ? option('unfiled', `未分類（${unfiled}）`) : '')
    + getWordSets().map((s) => option(s.id, `${s.name}（${counts.get(s.id) || 0}）`)).join('')
    + multi
    + (scopes && getWordSets().length ? `<option value="${MULTI_SET}">選擇多個單字集…</option>` : '')
    + (create ? `<option value="${NEW_SET}">＋ 新增單字集…</option>` : '');
}

// 加字選單的預設值：目前範圍裡第一個自訂單字集（全部、未分類時不指定）
export function addTargetSet() {
  return scopeIds(activeSetId()).find((id) => id !== UNFILED) || '';
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

// 選到「選擇多個單字集…」時先用 capture 攔下（其他 change 監聽器看不到這個假值），
// 勾選後才把組合寫回選單並照常觸發 change；取消就回到原本的選擇。
export function bindSetScope(root) {
  const select = root.querySelector('#setScope');
  if (!select) return;
  select.addEventListener('change', (event) => {
    if (select.value !== MULTI_SET) return;
    event.stopImmediatePropagation();
    const previous = activeSetId();
    select.value = previous;
    chooseSets(previous, (scope) => {
      select.innerHTML = setOptions(scope, { scopes: true });
      select.value = scope;
      select.dispatchEvent(new Event('change'));
    });
  }, true);
  select.addEventListener('change', (e) => updateSettings({ activeSetId: e.target.value }));
}

// 勾選視窗：可以同時勾多個單字集（含未分類），即時顯示合計字數（重複的字只算一次）
export function chooseSets(current, apply) {
  const words = getWords();
  const records = getSetRecords();
  const { counts, unfiled } = indexMembership(words, records);
  const picked = new Set(scopeIds(current));
  const rows = [[UNFILED, '未分類', unfiled], ...getWordSets().map((s) => [s.id, s.name, counts.get(s.id) || 0])];
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog set-multi-dialog';
  dialog.setAttribute('aria-labelledby', 'setMultiTitle');
  dialog.innerHTML = `<form><h2 class="dialog-title" id="setMultiTitle">選擇多個單字集</h2>
    <p class="hint-text">勾選的單字集合在一起練習；同一個字只會出現一次。</p>
    <fieldset class="set-multi-list"><legend class="sr-only">單字集</legend>
      ${rows.map(([id, name, n]) => `<label class="check-row"><input type="checkbox" value="${esc(id)}" ${picked.has(id) ? 'checked' : ''}>
        <span class="set-multi-name">${esc(name)}</span><span class="set-multi-count">${n}</span></label>`).join('')}
    </fieldset>
    <p class="set-multi-total" aria-live="polite"></p>
    <div class="dialog-actions">
      <button class="btn btn-ghost" type="button">取消</button><button class="btn btn-primary" type="submit">套用</button>
    </div></form>`;
  document.body.append(dialog);
  const boxes = [...dialog.querySelectorAll('input[type="checkbox"]')];
  const scope = () => boxes.filter((b) => b.checked).map((b) => b.value).join(',');
  const total = dialog.querySelector('.set-multi-total');
  const submit = dialog.querySelector('button[type="submit"]');
  const update = () => {
    const ids = scope();
    submit.disabled = !ids;
    total.textContent = ids ? `共 ${filterSetWords(words, records, ids).length} 個字` : '請至少勾選一個單字集';
  };
  dialog.addEventListener('change', update);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.querySelector('button[type="button"]').addEventListener('click', () => dialog.close());
  dialog.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const ids = scope();
    if (!ids) return;
    dialog.close();
    apply(ids);
  });
  update();
  dialog.showModal();
  (boxes.find((b) => b.checked) || boxes[0])?.focus();
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
