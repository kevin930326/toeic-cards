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

const state = { query: '', batchOpen: false, batchText: '' };
const PREVIEW_LIMIT = 80;

function badge(w) {
  if (isGenerating(w.id)) return '<span class="badge badge-busy">AI 生成中</span>';
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
  root.innerHTML = `
    <section class="page">
      <h1 class="page-title">單字庫</h1>
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
        <input class="search" id="search" type="search" placeholder="搜尋單字或中文" value="${esc(state.query)}" aria-label="搜尋">
        <span class="count" id="count"></span>
      </div>
      ${setScopeHTML()}
      <div class="set-bulk panel">
        <label class="check-row"><input id="selectShown" type="checkbox"><span>選取目前顯示的單字</span></label>
        <span id="selectedCount" role="status"></span>
        <label class="set-bulk-target"><span class="sr-only">批次歸類的單字集</span><select id="bulkSet">${setOptions()}</select></label>
        <button class="btn btn-outline btn-sm" id="bulkAssign" type="button">加入單字集</button>
        <button class="btn btn-ghost btn-sm" id="bulkRemove" type="button">移出單字集</button>
      </div>
      <ul class="word-list" id="list"></ul>
    </section>`;

  const listEl = root.querySelector('#list');
  const countEl = root.querySelector('#count');
  const refreshPanel = renderSetsPanel(root.querySelector('#setsPanel'));
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
    for (const id of ['bulkAssign', 'bulkRemove']) root.querySelector(`#${id}`).disabled = !selected.size || !root.querySelector('#bulkSet').value;
  }

  root.querySelector('#selectShown').addEventListener('change', (e) => {
    for (const w of shownWords()) { if (e.target.checked) selected.add(w.id); else selected.delete(w.id); }
    drawList();
  });
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
      listEl.innerHTML = `<li class="list-empty">${all.length ? '目前範圍沒有符合的單字，可切換單字集或新增單字。' : '還沒有單字，從上面輸入第一個吧！'}</li>`;
      return;
    }
    listEl.innerHTML = shown.map((w) => {
      const first = zhLines(w.zh)[0];
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
          <span class="word-set-tags">${setsForWord(getSetRecords(), w.word).map((s) => `<span class="chip">${esc(s.name)}</span>`).join('')}</span>
        </div>
        <div class="row-actions">
          ${w.llm?.status === 'failed' ? `<button class="btn btn-ghost btn-sm" type="button" data-act="regen" title="${esc(w.llm.error || '')}">重試 AI</button>` : ''}
          ${canSpeak() ? `<button class="icon-btn" type="button" data-act="speak" aria-label="播放 ${esc(w.word)} 的發音" title="發音">${speakerIcon}</button>` : ''}
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
    else if (act === 'mark') toggleUnfamiliar(id);
    else if (act === 'edit') openEditor(id);
    else if (act === 'delete') {
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
    if (!hasApiKey()) {
      aiBox.innerHTML = `<p class="ai-line">✨ 設定 Gemini 金鑰後，可以自動生成<strong>多益情境</strong>的解釋、例句和搭配詞。
        <a href="#/settings">前往設定</a></p>`;
      return;
    }
    const c = countByState();
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
      if (!c.missing && !c.failed) html += `<p class="ai-line ok">✓ 全部 ${c.done} 個字都已經有 AI 內容</p>`;
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
    refreshPanel(); refreshSetScope(root);
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
  return () => { unsub(); unsubLookup(); unsubGen(); };
}
