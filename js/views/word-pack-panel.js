import { getWords, getWordSets, addWords, updateWords, assignWordSet, createWordSet, updateSettings } from '../store.js';
import { normalizeSetName } from '../word-sets.js?v=dictionary-scale-1';
import { loadWordPack, previewPack, PACK_SET_NAME, initialPackData, packBackfill } from '../word-packs.js';
import { esc, toast } from '../ui.js';

// 切頁保留分組與目的地；內建內容不呼叫外部 API。
const state = { group: '0', targetId: '', name: PACK_SET_NAME };

export function renderWordPackPanel(container) {
  let pack = null;
  let loading = false;
  let disposed = false;
  let saving = false;
  let entries = new Map();
  const directlyOpen = new URLSearchParams(location.hash.split('?')[1] || '').get('pack') === 'toeic-1000';
  container.innerHTML = `<details class="panel word-pack" id="wordPack" ${directlyOpen ? 'open' : ''}>
    <summary>多益 1000 單字包<span class="summary-hint">內建完整內容 · 免 API 金鑰</span></summary>
    <div id="packBody"><p class="hint-text">開啟後預覽單字，自行選擇要加入的組別。</p></div>
  </details>`;
  const details = container.querySelector('#wordPack');
  const body = container.querySelector('#packBody');
  details.addEventListener('toggle', () => { if (details.open && !pack && !loading) load(); });

  async function load() {
    loading = true;
    body.innerHTML = '<p class="hint-text" role="status">正在載入單字包…</p>';
    try {
      const loaded = await loadWordPack();
      if (disposed) return;
      pack = loaded;
      entries = new Map(pack.entries.map((entry) => [entry.word, entry]));
      draw();
    } catch (err) {
      if (disposed) return;
      body.innerHTML = `<p class="set-error" role="alert">${esc(err.message)}。首次使用需要連線，載入後可離線使用。</p>
        <button class="btn btn-outline btn-sm" type="button" id="packRetry">重新載入單字包</button>`;
      body.querySelector('#packRetry').addEventListener('click', load);
    } finally { loading = false; }
  }

  function draw() {
    const defaultSet = getWordSets().find((s) => s.name === PACK_SET_NAME);
    if (!state.targetId && defaultSet) state.targetId = defaultSet.id;
    body.innerHTML = `
      <p class="hint-text">已備妥中文、英文解釋、中英例句與搭配詞，加入即可學習，不用等待 AI。每組 100 字，分組不代表難度。</p>
      <p class="pack-owned" id="packOwned"></p>
      <form id="packForm">
        <div class="field-row">
          <label class="field"><span>這次加入的範圍</span><select id="packGroup">
            ${Array.from({ length: 10 }, (_, i) => `<option value="${i}" ${state.group === String(i) ? 'selected' : ''}>第 ${i + 1} 組 · ${i * 100 + 1}–${(i + 1) * 100}</option>`).join('')}
            <option value="all" ${state.group === 'all' ? 'selected' : ''}>全部 1000 字</option>
          </select></label>
          <label class="field"><span>加入哪個單字集</span><select id="packTarget"></select></label>
        </div>
        <label class="field" id="packNameField"><span>單字集名稱</span><input id="packName" value="${esc(state.name)}" maxlength="60" required autocomplete="off"></label>
        <p class="hint-text" id="packTargetHint"></p>
        <div class="pack-preview" id="packPreview" aria-live="polite"></div>
        <ol class="pack-words" id="packWordList" aria-label="單字包預覽"></ol>
        <details class="pack-sample"><summary>查看本組內容範例</summary><div id="packSample"></div></details>
        <label class="check-row pack-ai"><input type="checkbox" id="packFillExisting">
          <span>也替已有單字補上空白內容<span class="hint-text">保留已填內容、手動修改與學習進度；不勾選則只新增歸屬。</span></span></label>
        <p class="hint-text" id="packFillHint"></p>
        <p class="hint-text">內建內容由 AI 預先撰寫，不需 Gemini 金鑰或個人生成額度。</p>
        <p class="set-error" id="packError" role="alert" hidden></p>
        <div class="pack-actions"><button class="btn btn-primary" id="packAdd" type="submit">加入單字集</button>
          <span class="hint-text" id="packResult" role="status"></span></div>
      </form>
      <p class="pack-source">選字來源：${esc(pack.source.title)}。${esc(pack.source.note)}
        載入過的單字包可離線開啟。</p>`;
    body.querySelector('#packGroup').addEventListener('change', (e) => { state.group = e.target.value; clearResult(); refresh(); });
    body.querySelector('#packTarget').addEventListener('change', (e) => { state.targetId = e.target.value; clearResult(); refresh(); });
    body.querySelector('#packName').addEventListener('input', (e) => { state.name = e.target.value; clearResult(); refresh(); });
    body.querySelector('#packFillExisting').addEventListener('change', refresh);
    body.querySelector('#packForm').addEventListener('submit', install);
    refresh();
  }

  function clearResult() { body.querySelector('#packResult').textContent = ''; body.querySelector('#packError').hidden = true; }

  function target() {
    const sets = getWordSets();
    return state.targetId ? sets.find((s) => s.id === state.targetId)
      : sets.find((s) => s.name.toLocaleLowerCase() === normalizeSetName(state.name).toLocaleLowerCase());
  }

  function refresh() {
    if (!pack || disposed) return;
    const select = body.querySelector('#packTarget');
    if (!select) return;
    const sets = getWordSets();
    if (state.targetId && !sets.some((s) => s.id === state.targetId)) state.targetId = '';
    const options = `<option value="">建立或使用同名單字集</option>` + sets.map((s) =>
      `<option value="${esc(s.id)}" ${state.targetId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    const optionsKey = JSON.stringify([state.targetId, sets.map((s) => [s.id, s.name])]);
    if (select.dataset.key !== optionsKey) { select.innerHTML = options; select.dataset.key = optionsKey; }
    select.value = state.targetId;
    const nameField = body.querySelector('#packNameField');
    nameField.hidden = !!state.targetId;
    body.querySelector('#packName').required = !state.targetId;
    const dest = target();
    const preview = previewPack(pack, state.group, getWords(), dest);
    body.querySelector('#packOwned').textContent = `單字庫已有 ${preview.owned} / 1000 字`;
    body.querySelector('#packTargetHint').textContent = dest ? `將加入「${dest.name}」` : '將建立新單字集；同名時會沿用現有的集。';
    body.querySelector('#packPreview').innerHTML = `<strong>這次 ${preview.selected.length} 字</strong>：新增 ${preview.fresh.length} 字，已有 ${preview.existing.length} 字
      ${preview.alreadyInSet.length ? `（其中 ${preview.alreadyInSet.length} 字已在本集）` : ''}。`;
    const existing = new Set(preview.existing);
    const start = state.group === 'all' ? 0 : Number(state.group) * 100;
    // 字典補資料不影響預覽清單；只有組別或已有單字變更時才更新，保留捲動位置。
    const list = body.querySelector('#packWordList');
    const listKey = JSON.stringify([state.group, preview.existing]);
    if (list.dataset.key !== listKey) {
      list.innerHTML = preview.selected.map((w, i) => `<li><span class="pack-index">${String(start + i + 1).padStart(3, '0')}</span>
        <span lang="en">${esc(w)}</span><small>${existing.has(w) ? '已有' : '新增'}</small></li>`).join('');
      list.dataset.key = listKey;
    }
    const sample = entries.get(preview.selected[0]);
    const sampleEl = body.querySelector('#packSample');
    if (sample && sampleEl.dataset.word !== sample.word) {
      sampleEl.innerHTML = `<p><strong>${esc(sample.word)}</strong> <span>${esc(sample.pos)} ${esc(sample.zh)}</span></p>
        <p lang="en">${esc(sample.en)}</p><p lang="en">${esc(sample.examples[0].en)}</p><p>${esc(sample.examples[0].zh)}</p>
        <p class="hint-text">搭配詞：${sample.collocations.map(esc).join('、')}</p>`;
      sampleEl.dataset.word = sample.word;
    }
    const patches = fillable(preview);
    const fill = body.querySelector('#packFillExisting');
    fill.disabled = !patches.length;
    if (fill.disabled) fill.checked = false;
    body.querySelector('#packFillHint').textContent = patches.length ? `這次有 ${patches.length} 個已有單字可補空白內容。` : '';
    const hasWork = preview.toAssign || (fill.checked && patches.length);
    const button = body.querySelector('#packAdd');
    button.disabled = saving || !normalizeSetName(dest?.name || state.name) || !hasWork;
    button.textContent = saving ? '加入中…' : !hasWork ? '這些單字都已在本集' : !preview.toAssign ? '補齊空白內容' : `加入 ${preview.selected.length} 字到單字集`;
  }

  function fillable(preview) {
    const existing = new Set(preview.existing);
    return getWords().filter((w) => existing.has(w.word)).map((w) => [w.id, packBackfill(w, entries.get(w.word))]).filter(([, patch]) => patch);
  }

  function install(e) {
    e.preventDefault();
    if (saving || !pack) return;
    const dest = target();
    const preview = previewPack(pack, state.group, getWords(), dest);
    const patches = body.querySelector('#packFillExisting').checked ? fillable(preview) : [];
    if (!preview.toAssign && !patches.length) return;
    saving = true;
    try {
      const set = dest || createWordSet(state.name);
      state.targetId = set.id;
      // 直接加入結構化清單，不經一般貼上解析器，保留 résumé 等拼字。
      const initialData = new Map(preview.fresh.map((word) => [word, initialPackData(entries.get(word))]));
      const { added } = addWords(preview.fresh, { autoGenerate: false, initialData });
      if (patches.length) updateWords(patches);
      const chosen = new Set(preview.selected);
      const ids = getWords().filter((w) => chosen.has(w.word)).map((w) => w.id);
      const assigned = assignWordSet(ids, set.id);
      updateSettings({ activeSetId: set.id });
      const message = `新增 ${added.length} 字，${assigned} 字加入「${set.name}」${patches.length ? `，補齊 ${patches.length} 字的空白內容` : ''}`;
      body.querySelector('#packResult').textContent = message;
      body.querySelector('#packError').hidden = true;
      toast(message);
    } catch (err) {
      const error = body.querySelector('#packError'); error.textContent = err.message; error.hidden = false;
    } finally { saving = false; refresh(); }
  }

  if (directlyOpen) load();
  return { refresh, cleanup() { disposed = true; } };
}
