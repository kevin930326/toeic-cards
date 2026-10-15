import { getWordSets, getSetRecords, getWords, createWordSet, renameWordSet, deleteWordSet } from '../store.js';
import { indexMembership } from '../word-sets.js?v=dictionary-scale-1';
import { esc, toast, confirmAction } from '../ui.js';
import { askSetName } from '../set-ui.js?v=dictionary-scale-1';

export function renderSetsPanel(container) {
  container.innerHTML = `<details class="panel sets-panel"><summary>管理單字集<span class="summary-hint">自己命名、自由分類</span></summary>
    <p class="hint-text">一個單字可以加入多個單字集，複習進度共用。刪除單字集會保留單字。</p>
    <form id="createSetForm" class="set-create">
      <label class="field grow"><span>新單字集名稱</span><input id="newSetName" required maxlength="60" placeholder="例如：人事、第 3 回模考" autocomplete="off"></label>
      <button class="btn btn-primary" type="submit">建立單字集</button>
    </form><p id="setError" class="set-error" role="alert" hidden></p><ul id="setList" class="set-list"></ul></details>`;
  container.querySelector('#createSetForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = container.querySelector('#newSetName');
    const error = container.querySelector('#setError');
    try { const set = createWordSet(input.value); input.value = ''; error.hidden = true; toast(`已建立「${set.name}」`); }
    catch (err) { error.textContent = err.message; error.hidden = false; }
  });
  container.querySelector('#setList').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-set-act]');
    if (!btn) return;
    const set = getWordSets().find((s) => s.id === btn.dataset.id);
    if (!set) return;
    if (btn.dataset.setAct === 'rename') askSetName(set.name, (name) => { renameWordSet(set.id, name); toast('已更新單字集名稱'); });
    else if (confirmAction(`確定要刪除「${set.name}」單字集嗎？\n單字與複習進度會保留。`)) { deleteWordSet(set.id); toast('已刪除單字集，單字保留'); }
  });
  function refresh() {
    const sets = getWordSets();
    const { counts } = indexMembership(getWords(), getSetRecords());
    container.querySelector('#setList').innerHTML = sets.length ? sets.map((s) => `<li class="set-row">
      <span class="set-label">${esc(s.name)}<small>${counts.get(s.id) || 0} 個字</small></span>
      <button class="btn btn-ghost btn-sm" data-set-act="rename" data-id="${esc(s.id)}" type="button" aria-label="重新命名 ${esc(s.name)}">改名</button>
      <button class="btn btn-ghost btn-sm danger" data-set-act="delete" data-id="${esc(s.id)}" type="button" aria-label="刪除單字集 ${esc(s.name)}">刪除</button>
    </li>`).join('') : '<li class="hint-text">還沒有單字集，先建立一個吧。</li>';
  }
  refresh();
  return refresh;
}
