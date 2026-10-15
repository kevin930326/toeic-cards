// 單字庫：新增（單個／批次）、搜尋、編輯、刪除
import { getWords, getSettings, addWords, deleteWord, toggleUnfamiliar, subscribe } from '../store.js';
import { esc, toast, openEditor, confirmAction, zhLines } from '../ui.js';
import { enqueueLookup, isLookingUp, onLookupStatus, lookupStatus } from '../dictionary.js';
import { analyzeInput } from '../parse.js';
import { hasApiKey, lastRequestStats } from '../llm.js';
import {
  enqueueGenerate, generateMissing, retryFailed, stopGenerating,
  onGenerateStatus, generateStatus, countByState, isGenerating,
} from '../generate.js';
import { speak, canSpeak, speakerIcon } from '../speech.js';
import { getSetRecords, scopedWords, activeSetId, assignWordSet } from '../store.js';
import { setsForWord } from '../word-sets.js';
import { setScopeHTML, bindSetScope, refreshSetScope, setOptions } from '../set-ui.js';
import { renderSetsPanel } from './sets-panel.js';
import { renderWordPackPanel } from './word-pack-panel.js';

const state = { query: '', batchOpen: false, batchText: '' };
const PREVIEW_LIMIT = 80;

function badge(w) {
  if (isGenerating(w.id)) return '<span class="badge badge-busy">AI 生成中</span>';
  if (w.pack) return '<span class="badge badge-ai" title="含多益1000單字包的內建內容">內建</span>';
  if (w.llm?.status === 'done') return '<span class="badge badge-ai" title="已用 AI 生成多益內容">AI</span>';
  if (w.llm?.status === 'failed') return '<span class="badge badge-fail">AI 失敗</span>';
  return '';
}

function chipList(words, cls = '') {
  const shown = words.slice(0, PREVIEW_LIMIT).map((w) => `<span class="chip ${cls}">${esc(w)}</span>`).join('');
  const more = words.length > PREVIEW_LIMIT ? `<span class="chip-more">…還有 ${words.length - PREVIEW_LIMIT} 個</span>` : '';
  return shown + more;
}

export function renderWords(root) {
  const selected = new Set();
  let editMode = false;
  let bulkMode = false;
  let markingId = null;
  root.innerHTML = `
    <section class="page">
      <div class="library-heading"><div><p class="eyebrow">MY VOCABULARY</p><h1 class="page-title">單字庫</h1><p class="hint-text">整理收藏，選好這次想背的範圍。</p></div>
        <button class="btn btn-primary" id="openAddWords" type="button">＋ 加入單字</button></div>
      <div id="wordPackPanel"></div>
      <div id="setsPanel"></div>
      <label class="set-scope add-set-scope"><span>新增時加入</span><select id="addToSet">${setOptions(activeSetId() === 'unfiled' ? '' : activeSetId())}</select></label>
      <form class="add-form panel" id="addForm" autocomplete="off">
        <label class="field grow">
          <span>新增英文單字</span>
          <input name="word" id="addInput" placeholder="例如 approve" spellcheck="false" autocapitalize="off">
        </label>
        <button class="btn btn-primary" type="submit">加入</button>
      </form>
      <details class="panel batch" id="batch" ${state.batchOpen ? 'open' : ''}>
        <summary>批次新增<span class="summary-hint">一次貼上很多字</span></summary>
        <label class="field">
          <span>用換行、逗號或空白分隔；中文、編號會自動忽略</span>
          <textarea id="batchInput" rows="6" spellcheck="false" autocapitalize="off"
            placeholder="approve, deadline, invoice&#10;1. reimbursement 報銷&#10;take over">${esc(state.batchText)}</textarea>
        </label>
        <div class="batch-preview" id="batchPreview" aria-live="polite"></div>
        <div class="batch-actions">
          <button class="btn btn-ghost" type="button" id="batchClear">清空</button>
          <button class="btn btn-primary" type="button" id="batchAdd" disabled>加入</button>
        </div>
      </details>
      <div class="panel ai-box" id="aiBox"></div>
      <div class="progress-box" id="lookupProgress" hidden>
        <div class="progress-label"><span id="progressText"></span></div>
        <div class="progress"><div class="progress-bar" id="progressBar"></div></div>
      </div>
      <div class="list-head">
        <input class="search" id="search" type="search" placeholder="搜尋我的字卡（英文或中文）" value="${esc(state.query)}" aria-label="搜尋我的字卡">
        <span class="count" id="count"></span>
      </div>
      <div class="library-scope">${setScopeHTML()}<button class="btn btn-ghost btn-sm" id="openManageSets" type="button">管理單字集</button></div>
      <div class="library-edit-tools"><button class="btn btn-outline btn-sm" id="toggleBulk" type="button" aria-expanded="false" aria-controls="bulkTools">批次整理</button><button class="btn btn-outline btn-sm" id="toggleLibraryEdit" type="button" aria-pressed="false" aria-controls="list">編輯模式</button><span class="hint-text" id="libraryEditHint">整理分類用「批次整理」；修改內容用「編輯模式」。</span></div>
      <section class="library-bulk panel" id="bulkTools" aria-label="批次整理單字" hidden>
        <div class="bulk-step"><h2>1. 勾選下方單字</h2><div class="bulk-selection"><label class="check-row"><input id="selectShown" type="checkbox"><span id="selectShownLabel">全選目前結果</span></label><button class="btn btn-ghost btn-sm" id="clearSelected" type="button">取消選取</button></div><p id="selectedCount" role="status"></p></div>
        <div class="bulk-step"><label class="field"><span>2. 選擇要整理的單字集</span><select id="bulkSet">${setOptions()}</select></label></div>
        <div class="bulk-step"><h2>3. 套用分類變更</h2><div class="bulk-actions"><button class="btn btn-primary btn-sm" id="bulkAssign" type="button">加入單字集</button><button class="btn btn-outline btn-sm" id="bulkRemove" type="button">移出單字集</button></div><p class="hint-text">加入可讓同一字屬於多個集；移出只移除分類，保留字卡與學習進度。</p></div>
      </section>
      <ul class="word-list" id="list"></ul>
      <details class="library-ai" id="aiTools"><summary>AI 內容工具<span class="summary-hint">生成缺項、查看狀態</span></summary><div id="aiToolsBody"></div></details>
      <dialog class="dialog word-tools-dialog" id="addWordsDialog" aria-labelledby="addWordsTitle">
        <div class="tool-heading"><div><p class="eyebrow">建立你的收藏</p><h2 id="addWordsTitle">加入單字</h2></div><button class="icon-btn" type="button" data-close aria-label="關閉加入單字">✕</button></div>
        <div class="word-tool-tabs" role="group" aria-label="加入方式"><button class="tool-tab" type="button" data-tool="single" aria-pressed="true">輸入單字</button><button class="tool-tab" type="button" data-tool="batch" aria-pressed="false">批次貼上</button><button class="tool-tab" type="button" data-tool="pack" aria-pressed="false">內建單字包</button></div>
        <div id="singleTool"></div><div id="batchTool" hidden></div><div id="packTool" hidden></div>
      </dialog>
      <dialog class="dialog word-tools-dialog" id="manageSetsDialog" aria-labelledby="manageSetsTitle">
        <div class="tool-heading"><div><p class="eyebrow">依主題或來源分類</p><h2 id="manageSetsTitle">管理單字集</h2></div><button class="icon-btn" type="button" data-close aria-label="關閉管理單字集">✕</button></div><div id="manageSetsBody"></div>
      </dialog>
    </section>`;

  const addDialog = root.querySelector('#addWordsDialog');
  const setsDialog = root.querySelector('#manageSetsDialog');
  const addScope = root.querySelector('.add-set-scope');
  root.querySelector('#singleTool').append(root.querySelector('#addForm'));
  root.querySelector('#batchTool').append(root.querySelector('#batch'));
  addDialog.querySelector('.word-tool-tabs').after(addScope);
  root.querySelector('#packTool').append(root.querySelector('#wordPackPanel'));
  root.querySelector('#manageSetsBody').append(root.querySelector('#setsPanel'));
  // 閒置的 AI 說明收進工具，進行中／失敗時才提升到清單上方。
  root.querySelector('#aiToolsBody').append(root.querySelector('#aiBox'));
  root.querySelector('#openAddWords').addEventListener('click', () => { addDialog.showModal(); chooseTool('single'); });
  root.querySelector('#openManageSets').addEventListener('click', () => setsDialog.showModal());
  for (const dialog of [addDialog, setsDialog]) dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  function chooseTool(tool) {
    for (const name of ['single', 'batch', 'pack']) root.querySelector(`#${name}Tool`).hidden = name !== tool;
    addScope.hidden = tool === 'pack';
    for (const button of addDialog.querySelectorAll('[data-tool]')) button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
    if (tool === 'single') root.querySelector('#addInput').focus();
    if (tool === 'batch') { root.querySelector('#batch').open = true; root.querySelector('#batchInput').focus(); }
    if (tool === 'pack') root.querySelector('#wordPack').open = true;
  }
  for (const button of addDialog.querySelectorAll('[data-tool]')) button.addEventListener('click', () => chooseTool(button.dataset.tool));

  const listEl = root.querySelector('#list');
  const countEl = root.querySelector('#count');
  function setBulkMode(enabled) {
    bulkMode = enabled;
    root.querySelector('#bulkTools').hidden = !enabled;
    listEl.classList.toggle('is-selecting', enabled);
    const button = root.querySelector('#toggleBulk');
    button.setAttribute('aria-expanded', String(enabled));
    button.textContent = enabled ? '完成整理' : '批次整理';
    if (!enabled) { selected.clear(); drawSelected(); }
  }
  root.querySelector('#toggleBulk').addEventListener('click', () => {
    if (!bulkMode && editMode) root.querySelector('#toggleLibraryEdit').click();
    setBulkMode(!bulkMode);
  });
  root.querySelector('#toggleLibraryEdit').addEventListener('click', (event) => {
    if (!editMode && bulkMode) setBulkMode(false);
    editMode = !editMode;
    listEl.classList.toggle('is-editing', editMode);
    event.currentTarget.setAttribute('aria-pressed', String(editMode));
    event.currentTarget.textContent = editMode ? '完成編輯' : '編輯模式';
    root.querySelector('#libraryEditHint').textContent = editMode ? '選擇字卡旁的編輯或刪除；完成後可收起操作。' : '整理分類用「批次整理」；修改內容用「編輯模式」。';
  });
  const refreshPanel = renderSetsPanel(root.querySelector('#setsPanel'));
  const packPanel = renderWordPackPanel(root.querySelector('#wordPackPanel'));
  root.querySelector('.sets-panel').open = true;
  if (new URLSearchParams(location.hash.split('?')[1] || '').get('pack') === 'toeic-1000') { addDialog.showModal(); chooseTool('pack'); }
  bindSetScope(root);
  root.querySelector('#setScope').addEventListener('change', () => {
    root.querySelector('#addToSet').value = activeSetId() === 'unfiled' ? '' : activeSetId();
    drawPreview();
  });

  function shownWords() {
    const q = state.query.trim().toLowerCase();
    return scopedWords().filter((w) => !q || w.word.includes(q) || w.zh.includes(q));
  }

  function drawSelected() {
    const shown = shownWords();
    const valid = new Set(shown.map((w) => w.id));
    for (const id of selected) if (!valid.has(id)) selected.delete(id);
    const all = root.querySelector('#selectShown');
    all.checked = !!shown.length && selected.size === shown.length;
    all.indeterminate = selected.size > 0 && selected.size < shown.length;
    all.disabled = !shown.length;
    root.querySelector('#selectedCount').textContent = `已選 ${selected.size} 個字`;
    root.querySelector('#selectShownLabel').textContent = `全選目前結果（${shown.length} 字）`;
    root.querySelector('#clearSelected').disabled = !selected.size;
    for (const checkbox of listEl.querySelectorAll('.word-select')) checkbox.checked = selected.has(checkbox.closest('.word-row').dataset.id);
    for (const id of ['bulkAssign', 'bulkRemove']) root.querySelector(`#${id}`).disabled = !selected.size || !root.querySelector('#bulkSet').value;
  }

  root.querySelector('#selectShown').addEventListener('change', (e) => {
    for (const w of shownWords()) { if (e.target.checked) selected.add(w.id); else selected.delete(w.id); }
    drawSelected();
  });
  root.querySelector('#clearSelected').addEventListener('click', () => { selected.clear(); drawSelected(); });
  root.querySelector('#bulkSet').addEventListener('change', drawSelected);
  for (const [id, present] of [['bulkAssign', true], ['bulkRemove', false]]) {
    root.querySelector(`#${id}`).addEventListener('click', () => {
      try {
        const n = assignWordSet([...selected], root.querySelector('#bulkSet').value, present);
        selected.clear(); drawList();
        toast(`${present ? '已加入' : '已移出'} ${n} 個字${present ? '' : '，單字與進度保留'}`);
      } catch (err) { toast(err.message, 'error'); }
    });
  }
  listEl.addEventListener('change', (e) => {
    if (!e.target.matches('.word-select')) return;
    const id = e.target.closest('.word-row').dataset.id;
    if (e.target.checked) selected.add(id); else selected.delete(id);
    drawSelected();
  });

  function drawList() {
    const q = state.query.trim().toLowerCase();
    const all = getWords();
    const shown = shownWords();
    countEl.textContent = q || activeSetId() ? `${shown.length} / ${all.length} 個字` : `共 ${all.length} 個字`;
    drawSelected();
    if (!shown.length) {
      listEl.innerHTML = `<li class="list-empty">${all.length ? '目前範圍沒有符合的單字，可切換單字集或新增單字。' : '還沒有收藏的單字。點「＋ 加入單字」，或用上方「查單字」找到第一個字。'}</li>`;
      return;
    }
    const records = getSetRecords();
    const speaking = canSpeak();
    listEl.innerHTML = shown.map((w) => {
      // 清單只呈現第一行，避免每次解析整份多行解釋。
      const first = zhLines(w.zh.split('\n').find((line) => line.trim()) || '')[0];
      const zhText = first
        ? `${first.pos || w.pos ? `<em>${esc(first.pos || w.pos)}</em> ` : ''}${esc(first.text)}`
        : (isLookingUp(w.id) ? '<span class="muted">查字典中…</span>' : '<span class="muted">（尚無中文）</span>');
      return `
      <li class="word-row ${w.unfamiliar ? 'is-unfamiliar' : ''}" data-id="${w.id}">
        <input class="word-select" type="checkbox" aria-label="選取 ${esc(w.word)}" ${selected.has(w.id) ? 'checked' : ''}>
        <button class="star" type="button" data-act="mark" aria-pressed="${w.unfamiliar}"
          title="${w.unfamiliar ? '取消不熟' : '標記不熟'}" aria-label="${w.unfamiliar ? '取消不熟' : '標記不熟'}：${esc(w.word)}">${w.unfamiliar ? '★' : '☆'}</button>
        <div class="word-info">
          <span class="word-en">${esc(w.word)}${badge(w)}</span>
          <span class="word-zh">${zhText}</span>
          <span class="word-set-tags">${setsForWord(records, w.word).map((s) => `<span class="chip">${esc(s.name)}</span>`).join('')}</span>
        </div>
        <div class="row-actions">
          ${w.llm?.status === 'failed' ? `<button class="btn btn-ghost btn-sm" type="button" data-act="regen" title="${esc(w.llm.error || '')}">重試 AI</button>` : ''}
          ${speaking ? `<button class="icon-btn" type="button" data-act="speak" aria-label="播放 ${esc(w.word)} 的發音" title="發音">${speakerIcon}</button>` : ''}
          <button class="btn btn-ghost btn-sm" type="button" data-act="edit">編輯</button>
          <button class="btn btn-ghost btn-sm danger" type="button" data-act="delete" aria-label="刪除 ${esc(w.word)}">刪除</button>
        </div>
      </li>`;
    }).join('');
  }

  function addFromText(text) {
    const { fresh, dupes, existing } = analyzeInput(text, getWords().map((w) => w.word));
    const setId = root.querySelector('#addToSet').value;
    if (!fresh.length && !(existing.length && setId)) {
      if (existing.length) toast(`「${existing[0]}」${existing.length > 1 ? ` 等 ${existing.length} 個字` : ''}已經在字卡裡了`, 'error');
      else toast('沒有找到英文單字', 'error');
      return 0;
    }
    const { added } = addWords(fresh);
    const existingIds = setId ? getWords().filter((w) => existing.includes(w.word)).map((w) => w.id) : [];
    const assigned = setId ? assignWordSet([...added.map((w) => w.id), ...existingIds], setId) : 0;
    const ids = added.map((w) => w.id);
    enqueueLookup(ids);
    if (hasApiKey() && getSettings().autoGenerate) enqueueGenerate(ids);
    const skipped = dupes.length + existing.length;
    toast(setId ? `新增 ${added.length} 個字，${assigned} 個字加入單字集` : added.length === 1 && !skipped
      ? `已加入「${added[0].word}」`
      : `已加入 ${added.length} 個字${skipped ? `，略過 ${skipped} 個重複` : ''}`);
    return added.length + assigned;
  }

  root.querySelector('#addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = root.querySelector('#addInput');
    if (!input.value.trim()) return;
    addFromText(input.value);
    input.value = '';
    input.focus();
  });

  // ---- 批次新增 ----
  const batchEl = root.querySelector('#batch');
  const batchInput = root.querySelector('#batchInput');
  const batchPreview = root.querySelector('#batchPreview');
  const batchAdd = root.querySelector('#batchAdd');

  function drawPreview() {
    const text = batchInput.value;
    if (!text.trim()) {
      batchPreview.innerHTML = '';
      batchAdd.disabled = true;
      batchAdd.textContent = '加入';
      return;
    }
    const { fresh, dupes, existing } = analyzeInput(text, getWords().map((w) => w.word));
    const setId = root.querySelector('#addToSet').value;
    batchAdd.disabled = !fresh.length && !(setId && existing.length);
    batchAdd.textContent = fresh.length ? `加入 ${fresh.length} 個字` : setId && existing.length ? '加入單字集' : '加入';
    batchPreview.innerHTML = `
      ${fresh.length
        ? `<p class="preview-title">將新增 <strong>${fresh.length}</strong> 個字</p><p class="chips">${chipList(fresh)}</p>`
        : '<p class="preview-title">沒有新的字可以加入</p>'}
      ${existing.length ? `<p class="preview-title muted">已在字卡裡，${setId ? '保留內容與進度，加入指定單字集' : '略過'} ${existing.length} 個</p><p class="chips">${chipList(existing, 'chip-muted')}</p>` : ''}
      ${dupes.length ? `<p class="preview-title muted">貼上的內容裡重複，只算一次：${dupes.length} 個</p><p class="chips">${chipList(dupes, 'chip-muted')}</p>` : ''}`;
  }

  batchEl.addEventListener('toggle', () => {
    state.batchOpen = batchEl.open;
    if (batchEl.open) batchInput.focus();
  });
  batchInput.addEventListener('input', () => {
    state.batchText = batchInput.value;
    drawPreview();
  });
  root.querySelector('#addToSet').addEventListener('change', drawPreview);
  root.querySelector('#batchClear').addEventListener('click', () => {
    batchInput.value = state.batchText = '';
    drawPreview();
    batchInput.focus();
  });
  batchAdd.addEventListener('click', () => {
    if (addFromText(batchInput.value)) {
      batchInput.value = state.batchText = '';
      drawPreview();
    }
  });

  // ---- 查字典進度 ----
  const progressBox = root.querySelector('#lookupProgress');
  function drawProgress(st = lookupStatus()) {
    const show = st.pending > 0 && st.total > 1;
    progressBox.hidden = !show;
    if (!show) return;
    root.querySelector('#progressText').textContent = `正在查英文解釋… ${st.done} / ${st.total}（中文意思已經先填好）`;
    root.querySelector('#progressBar').style.width = `${Math.round((st.done / st.total) * 100)}%`;
  }

  root.querySelector('#search').addEventListener('input', (e) => {
    state.query = e.target.value;
    drawList();
  });

  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('.word-row').dataset.id;
    const act = btn.dataset.act;
    if (act === 'regen') retryFailed(id);
    else if (act === 'speak') speak(getWords().find((x) => x.id === id)?.word);
    else if (act === 'mark') {
      // 儲存與同步仍走原流程；本次本機操作不必重建清單及隱藏的工具。
      markingId = id;
      try { toggleUnfamiliar(id); }
      catch (err) { toast(err.message, 'error'); }
      finally { markingId = null; }
    }
    else if (act === 'edit' && editMode) openEditor(id);
    else if (act === 'delete' && editMode) {
      const w = getWords().find((x) => x.id === id);
      if (w && confirmAction(`確定要刪除「${w.word}」嗎？`)) {
        deleteWord(id);
        toast(`已刪除「${w.word}」`);
      }
    }
  });

  // ---- AI 生成 ----
  const aiBox = root.querySelector('#aiBox');
  // 上一次 AI 請求花了多久（排查「很慢」用）
  function statsLine() {
    const r = lastRequestStats();
    if (!r) return '';
    if (!r.ok) return `<p class="ai-sub">上次請求 ${(r.ms / 1000).toFixed(1)} 秒後失敗：${esc(r.error || r.finishReason || '')}</p>`;
    return `<p class="ai-sub">上次請求 ${(r.ms / 1000).toFixed(1)} 秒・輸出 ${r.outputTokens} tokens${r.thoughtTokens ? `・思考 ${r.thoughtTokens} tokens` : ''}</p>`;
  }
  function drawAi(st = generateStatus()) {
    if (!getWords().length) { aiBox.hidden = true; return; }
    aiBox.hidden = false;
    const c = countByState();
    const attention = st.running || c.failed || (st.error && st.error.kind !== 'aborted' && (c.missing || c.failed));
    const target = attention ? root.querySelector('.list-head') : root.querySelector('#aiToolsBody');
    if (attention) target.before(aiBox); else target.append(aiBox);
    root.querySelector('#aiTools').hidden = !!attention;
    if (!c.missing && !c.failed && !st.running) {
      aiBox.innerHTML = `<p class="ai-line ok">✓ 全部 ${c.done} 個字已有學習內容，可以開始複習。</p>`;
      return;
    }
    if (!hasApiKey()) {
      aiBox.innerHTML = `<p class="ai-line">✨ 設定 Gemini 金鑰後，可以自動生成<strong>多益情境</strong>的解釋、例句和搭配詞。
        <a href="#/settings">前往設定</a></p>`;
      return;
    }
    let html = '';
    if (st.running) {
      const pct = st.total ? Math.round(((st.done + st.failed) / st.total) * 100) : 0;
      html += `
        <div class="ai-head">
          <p class="ai-line"><strong>AI 生成中</strong> ${st.done + st.failed} / ${st.total} 個字${st.failed ? `（失敗 ${st.failed}）` : ''}</p>
          <button class="btn btn-ghost btn-sm" type="button" id="aiStop">停止</button>
        </div>
        <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
        <p class="ai-sub" id="aiSub">${st.waiting
          ? `為了不超過免費額度，等待 ${st.waiting} 秒後送出下一批…`
          : `正在處理 ${st.current} 個字（每批最多 20 個字，一次請求）`}</p>
        ${statsLine()}`;
    } else {
      if (st.error && st.error.kind !== 'aborted') {
        html += `<p class="ai-error" role="alert">⚠ ${esc(st.error.message)}
          ${st.error.kind === 'key' || st.error.kind === 'model' ? ' <a href="#/settings">前往設定</a>' : ''}
          ${st.error.kind === 'quota' ? '<br><span>可以稍後再按「生成」，或到設定把速率調低。</span>' : ''}</p>`;
      }
      if (c.missing) {
        html += `<div class="ai-head"><p class="ai-line">✨ ${c.missing} 個字還沒有 AI 內容</p>
          <button class="btn btn-primary btn-sm" type="button" id="aiGen">生成 ${c.missing} 個字</button></div>`;
      }
      if (c.failed) {
        html += `<div class="ai-head"><p class="ai-line">${c.failed} 個字生成失敗</p>
          <button class="btn btn-outline btn-sm" type="button" id="aiRetry">重試失敗的字</button></div>`;
      }
    }
    aiBox.innerHTML = html;
    aiBox.querySelector('#aiStop')?.addEventListener('click', stopGenerating);
    aiBox.querySelector('#aiGen')?.addEventListener('click', generateMissing);
    aiBox.querySelector('#aiRetry')?.addEventListener('click', () => retryFailed());
  }

  drawList();
  drawPreview();
  drawProgress();
  drawAi();
  const unsub = subscribe(() => {
    if (markingId) {
      const w = getWords().find((word) => word.id === markingId);
      const row = [...listEl.children].find((element) => element.dataset.id === markingId);
      if (w && row) {
        row.classList.toggle('is-unfamiliar', w.unfamiliar);
        const star = row.querySelector('[data-act=mark]');
        const label = w.unfamiliar ? '取消不熟' : '標記不熟';
        star.textContent = w.unfamiliar ? '★' : '☆';
        star.setAttribute('aria-pressed', String(w.unfamiliar));
        star.setAttribute('aria-label', `${label}：${w.word}`);
        star.title = label;
      }
      return;
    }
    refreshPanel(); refreshSetScope(root);
    packPanel.refresh();
    for (const id of ['addToSet', 'bulkSet']) {
      const el = root.querySelector(`#${id}`);
      el.innerHTML = setOptions(el.value);
    }
    drawList(); drawAi(); drawPreview();
  });
  const unsubLookup = onLookupStatus((st) => { drawList(); drawProgress(st); });
  let lastKey = '';
  const unsubGen = onGenerateStatus((st) => {
    drawAi(st);
    // 倒數秒數每秒都會變，但只有字的狀態改變時才需要重畫列表
    const key = `${st.running}|${st.done}|${st.failed}|${st.current}`;
    if (key !== lastKey) drawList();
    lastKey = key;
  });
  return () => { unsub(); unsubLookup(); unsubGen(); packPanel.cleanup(); addDialog.close(); setsDialog.close(); };
}
