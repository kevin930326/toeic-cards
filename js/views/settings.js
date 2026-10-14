// 設定頁：外觀、發音、Gemini 金鑰與模型（之後會加上匯出匯入）
import { getSettings, updateSettings } from '../store.js';
import { speak, canSpeak, ACCENTS, MIXED, accentAvailability, onVoicesChanged } from '../speech.js';
import { getApiKey, setApiKey, listModels, pickDefaultModel, getModel } from '../llm.js';
import { esc, toast } from '../ui.js';

// 模型清單只在這次開啟網站時記住（不需要存）
let modelCache = null;

function segmented(name, value, options, label) {
  return `
    <div class="segmented" role="radiogroup" aria-label="${label}">
      ${options.map(([v, text]) => `
        <label class="seg">
          <input type="radio" name="${name}" value="${v}" ${String(value) === String(v) ? 'checked' : ''}>
          <span>${text}</span>
        </label>`).join('')}
    </div>`;
}

function maskKey(k) {
  return k.length > 10 ? `${k.slice(0, 4)}…${k.slice(-4)}` : '已設定';
}

export function renderSettings(root) {
  const s = getSettings();
  const key = getApiKey();
  const model = getModel();
  const models = modelCache || [{ id: model, name: model }];

  root.innerHTML = `
    <section class="page">
      <h1 class="page-title">設定</h1>

      <div class="panel" id="aiPanel">
        <h2 class="panel-title">Gemini AI</h2>
        <p class="panel-desc">用 AI 產生<strong>多益情境</strong>的中文意思、淺白英文解釋、例句、搭配詞，之後也用來出 Part 5 測驗題。
          沒有金鑰也能用字典和簡易測驗。</p>
        <ol class="steps">
          <li>到 <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio</a> 登入並建立免費的 API 金鑰</li>
          <li>把金鑰貼在下面，按「儲存並檢查」</li>
        </ol>
        <form id="keyForm" class="key-form" autocomplete="off">
          <label class="field grow">
            <span>API 金鑰 ${key ? `<em class="key-state ok">目前：${esc(maskKey(key))}</em>` : '<em class="key-state">尚未設定</em>'}</span>
            <div class="input-with-btn">
              <input id="keyInput" type="password" placeholder="${key ? '輸入新的金鑰以更換' : '貼上金鑰（AIza 開頭）'}" spellcheck="false" autocapitalize="off">
              <button class="btn btn-ghost btn-sm" type="button" id="keyShow" aria-label="顯示金鑰">顯示</button>
            </div>
          </label>
          <div class="key-actions">
            <button class="btn btn-primary" type="submit">儲存並檢查</button>
            ${key ? '<button class="btn btn-ghost danger" type="button" id="keyRemove">移除金鑰</button>' : ''}
          </div>
        </form>
        <p class="key-status" id="keyStatus" aria-live="polite"></p>

        <div class="setting-row wrap">
          <label class="setting-label" for="modelSelect">模型</label>
          <select id="modelSelect" class="select" ${key ? '' : 'disabled'}>
            ${models.map((m) => `<option value="${esc(m.id)}" ${m.id === model ? 'selected' : ''}>${esc(m.id)}</option>`).join('')}
          </select>
          ${key ? '<button class="btn btn-ghost btn-sm" type="button" id="loadModels">重新載入清單</button>' : ''}
        </div>
        <p class="hint-text">免費方案只能用 Flash／Flash-Lite 系列；Pro 需要付費。Flash-Lite 額度通常較多但品質稍差。</p>

        <div class="setting-row wrap">
          <span class="setting-label">速率</span>
          ${segmented('llmRpm', s.llmRpm, [['5', '5 次/分'], ['10', '10 次/分'], ['15', '15 次/分'], ['30', '30 次/分']], '每分鐘請求上限')}
        </div>
        <p class="hint-text">每次請求可處理 20 個字。請以 Google AI Studio 顯示的額度為準；遇到限制時會自動等待並重試。</p>

        <label class="check-row">
          <input type="checkbox" id="autoGenerate" ${s.autoGenerate ? 'checked' : ''}>
          <span>新增單字後自動用 AI 生成內容</span>
        </label>

        <p class="privacy">🔒 金鑰只存在這台電腦的瀏覽器裡，只會直接送給 Google，不會上傳到其他地方。
          送給 Gemini 的內容只有英文單字。免費方案下 Google 可能用這些內容改進模型。</p>
      </div>

      <div class="panel">
        <h2 class="panel-title">複習</h2>
        <div class="setting-row wrap">
          <span class="setting-label">目標</span>
          ${segmented('dailyGoal', s.dailyGoal, [['10', '10 題/天'], ['20', '20 題/天'], ['30', '30 題/天'], ['50', '50 題/天']], '每日目標')}
        </div>
        <p class="hint-text">複習一張卡或測驗答一題都算 1 題，達到目標才算「打卡」。之後改目標不會影響過去的打卡紀錄。</p>
        <div class="setting-row wrap">
          <span class="setting-label">新字</span>
          ${segmented('newPerDay', s.newPerDay, [['10', '10 個/天'], ['20', '20 個/天'], ['30', '30 個/天'], ['50', '50 個/天']], '每天新字數')}
        </div>
        <p class="hint-text">每天最多學幾個新字。到期要複習的舊字不受限制；複習完後也可以按「再學 10 個新字」。</p>
      </div>

      <div class="panel">
        <h2 class="panel-title">外觀</h2>
        ${segmented('theme', s.theme, [['system', '跟隨系統'], ['light', '淺色'], ['dark', '深色']], '主題')}
      </div>

      <div class="panel">
        <h2 class="panel-title">發音</h2>
        ${canSpeak() ? `
          <div class="setting-row wrap">
            <span class="setting-label">口音</span>
            ${segmented('accent', s.accent, [...ACCENTS.map((a) => [a.id, a.label]), [MIXED, '多益混合']], '口音')}
          </div>
          <p class="hint-text">多益聽力會出現美式、英式、加拿大、澳洲四種口音。「多益混合」每次隨機換一種，最接近真實考試。</p>
          <ul class="accent-list" id="accentList"></ul>
          <p class="hint-text">發音使用瀏覽器內建的語音合成，免費、不需網路，也不用 AI 額度；可用的口音取決於裝置。
            Windows 可到「設定 › 時間與語言 › 語音」新增英文語音；Edge 瀏覽器內建較多自然的語音。</p>
          <div class="setting-row">
            <span class="setting-label">速度</span>
            ${segmented('speechRate', s.speechRate, [['0.7', '慢'], ['0.9', '標準'], ['1.1', '快']], '速度')}
          </div>
          <button class="btn btn-outline" type="button" id="testSpeak">試聽 “schedule”</button>
        ` : '<p class="muted">這個瀏覽器不支援語音播放。</p>'}
      </div>
    </section>`;

  const statusEl = root.querySelector('#keyStatus');
  const setStatus = (msg, kind = '') => {
    statusEl.textContent = msg;
    statusEl.dataset.kind = kind;
  };

  // 檢查金鑰：向 Google 要模型清單；成功代表金鑰可用
  async function checkKey({ chooseDefault }) {
    setStatus('檢查中…');
    try {
      const list = await listModels();
      if (!list.length) throw new Error('這把金鑰沒有可用的 Gemini 模型');
      modelCache = list;
      const current = getSettings().llmModel;
      const keep = current && list.some((m) => m.id === current);
      if (chooseDefault || !keep) updateSettings({ llmModel: keep ? current : pickDefaultModel(list) });
      renderSettings(root);
      root.querySelector('#keyStatus').textContent = `✓ 金鑰可以使用，找到 ${list.length} 個模型`;
      root.querySelector('#keyStatus').dataset.kind = 'ok';
    } catch (err) {
      setStatus(`✗ ${err.message}`, 'error');
    }
  }

  root.querySelector('#keyForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = root.querySelector('#keyInput').value.trim();
    if (!v && !getApiKey()) { setStatus('請先貼上金鑰', 'error'); return; }
    if (v) setApiKey(v);
    checkKey({ chooseDefault: !getSettings().llmModel });
  });
  root.querySelector('#keyShow').addEventListener('click', (e) => {
    const input = root.querySelector('#keyInput');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    e.currentTarget.textContent = show ? '隱藏' : '顯示';
  });
  root.querySelector('#keyRemove')?.addEventListener('click', () => {
    setApiKey('');
    modelCache = null;
    toast('已移除金鑰');
    renderSettings(root);
  });
  root.querySelector('#loadModels')?.addEventListener('click', () => checkKey({ chooseDefault: false }));
  root.querySelector('#modelSelect').addEventListener('change', (e) => {
    updateSettings({ llmModel: e.target.value });
    toast(`已切換為 ${e.target.value}`);
  });
  root.querySelector('#autoGenerate').addEventListener('change', (e) => updateSettings({ autoGenerate: e.target.checked }));

  root.querySelectorAll('input[name="llmRpm"]').forEach((input) => {
    input.addEventListener('change', () => updateSettings({ llmRpm: Number(input.value) }));
  });
  root.querySelectorAll('input[name="dailyGoal"]').forEach((input) => {
    input.addEventListener('change', () => updateSettings({ dailyGoal: Number(input.value) }));
  });
  root.querySelectorAll('input[name="newPerDay"]').forEach((input) => {
    input.addEventListener('change', () => updateSettings({ newPerDay: Number(input.value) }));
  });
  root.querySelectorAll('input[name="theme"]').forEach((input) => {
    input.addEventListener('change', () => updateSettings({ theme: input.value }));
  });
  root.querySelectorAll('input[name="accent"]').forEach((input) => {
    input.addEventListener('change', () => updateSettings({ accent: input.value }));
  });
  root.querySelectorAll('input[name="speechRate"]').forEach((input) => {
    input.addEventListener('change', () => updateSettings({ speechRate: Number(input.value) }));
  });
  root.querySelector('#testSpeak')?.addEventListener('click', () => speak('schedule'));

  // 各口音在這台裝置上有沒有語音（語音清單會非同步載入，所以要能重畫）
  const list = root.querySelector('#accentList');
  function drawAccents() {
    if (!list) return;
    list.innerHTML = accentAvailability().map((a) => `
      <li class="${a.available ? 'ok' : 'missing'}">
        <span class="accent-name">${a.label}</span>
        <span class="accent-voice">${a.available ? `✓ ${esc(a.voiceName)}` : '✗ 這台裝置沒有，會用其他英文語音代替'}</span>
        <button class="btn btn-ghost btn-sm" type="button" data-try="${a.id}">試聽</button>
      </li>`).join('');
  }
  drawAccents();
  list?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-try]');
    if (b) speak('Please submit the invoice by Friday.', { accent: b.dataset.try });
  });
  return onVoicesChanged(drawAccents);
}
