// 設定頁的「備份與還原」區塊：匯出 JSON、匯入（先預覽，再選合併或取代）
import { getWords, getSettings, replaceWords, replaceSettings, getDefaultSettings } from '../store.js';
import { getLog, replaceLog } from '../log.js';
import { getMistakes, replaceMistakes } from '../mistakes.js';
import { buildBackup, backupFileName, parseBackup, mergeBackup } from '../backup.js';
import { esc, toast, confirmAction } from '../ui.js';

const LAST_BACKUP_KEY = 'toeic-cards:lastBackup';

function lastBackup() {
  try { return Number(localStorage.getItem(LAST_BACKUP_KEY)) || 0; } catch (e) { return 0; }
}

function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 把資料寫回去。順序很重要：先換單字，錯題本才不會被「單字不存在」的清理機制刪掉
function apply({ words, mistakes, log, settings }) {
  replaceWords(words);
  replaceMistakes(mistakes);
  replaceLog(log);
  if (settings) replaceSettings(settings);
}

export function renderBackupPanel(container) {
  let pending = null;   // 讀進來、還沒套用的備份

  function draw() {
    const words = getWords();
    const days = Object.keys(getLog()).length;
    const last = lastBackup();
    container.innerHTML = `
      <h2 class="panel-title">備份與還原</h2>
      <p class="panel-desc">資料只存在這個瀏覽器裡。清除瀏覽器資料或換裝置前，記得先匯出備份。
        <strong>備份檔不包含 Gemini 金鑰。</strong></p>
      <p class="backup-now">目前：單字 <strong>${words.length}</strong> 個・學習紀錄 <strong>${days}</strong> 天・錯題 <strong>${getMistakes().length}</strong> 題
        <span class="muted">・${last ? `上次備份 ${fmtTime(last)}` : '還沒有備份過'}</span></p>
      <div class="backup-actions">
        <button class="btn btn-primary" type="button" id="exportBtn">匯出備份</button>
        <label class="btn btn-outline file-btn">
          匯入備份…
          <input type="file" id="importFile" accept=".json,application/json">
        </label>
      </div>
      <div id="importArea" aria-live="polite"></div>`;
    container.querySelector('#exportBtn').addEventListener('click', exportNow);
    container.querySelector('#importFile').addEventListener('change', onFile);
    if (pending) drawPreview();
  }

  function exportNow() {
    const now = Date.now();
    const backup = buildBackup({ words: getWords(), settings: getSettings(), log: getLog(), mistakes: getMistakes() }, now);
    const blob = new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFileName(now);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    try { localStorage.setItem(LAST_BACKUP_KEY, String(now)); } catch (e) { /* 只是提醒用，存不了沒關係 */ }
    toast(`已匯出 ${backup.counts.words} 個字`);
    draw();
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';   // 同一個檔案可以再選一次
    if (!file) return;
    let text = '';
    try { text = await file.text(); } catch (err) { showError('讀不到這個檔案'); return; }
    const res = parseBackup(text, getDefaultSettings());
    if (!res.ok) { showError(res.error); return; }
    pending = res.backup;
    drawPreview();
  }

  function showError(msg) {
    pending = null;
    container.querySelector('#importArea').innerHTML = `<p class="ai-error" role="alert">⚠ 無法匯入：${esc(msg)}</p>`;
  }

  function drawPreview() {
    const b = pending;
    const dry = mergeBackup({ words: getWords(), log: getLog(), mistakes: getMistakes() }, b);
    const when = b.exportedAt ? fmtTime(Date.parse(b.exportedAt)) : '不明';
    container.querySelector('#importArea').innerHTML = `
      <div class="import-preview">
        <p class="import-title">備份內容（${esc(when)} 匯出）</p>
        <p>單字 <strong>${b.words.length}</strong> 個・學習紀錄 <strong>${Object.keys(b.log).length}</strong> 天・錯題 <strong>${b.mistakes.length}</strong> 題
          ${b.skipped ? `<span class="muted">・略過 ${b.skipped} 筆格式不正確或重複的資料</span>` : ''}</p>
        <p class="import-merge">選「合併」會：新增 <strong>${dry.summary.added}</strong> 個字、更新 <strong>${dry.summary.updated}</strong> 個字（備份裡比較新）、
          <strong>${dry.summary.kept}</strong> 個字保留目前的版本；學習紀錄與錯題本合在一起。</p>
        <div class="backup-actions">
          <button class="btn btn-primary" type="button" id="doMerge">合併到目前資料</button>
          <button class="btn btn-outline danger" type="button" id="doReplace">用備份取代全部</button>
          <button class="btn btn-ghost" type="button" id="doCancel">取消</button>
        </div>
      </div>`;
    container.querySelector('#doMerge').addEventListener('click', () => {
      const merged = mergeBackup({ words: getWords(), log: getLog(), mistakes: getMistakes() }, pending);
      apply(merged);
      pending = null;
      toast(`已合併：新增 ${merged.summary.added} 個字、更新 ${merged.summary.updated} 個字`);
      draw();
    });
    container.querySelector('#doReplace').addEventListener('click', () => {
      if (!confirmAction('確定要用備份取代目前所有資料嗎？\n目前的單字、學習紀錄、錯題本和設定都會被覆蓋。\n（建議先按「匯出備份」保存目前的資料）')) return;
      const ids = new Set(pending.words.map((w) => w.id));
      apply({
        words: pending.words,
        mistakes: pending.mistakes.filter((m) => ids.has(m.question.wordId)),
        log: pending.log,
        settings: pending.settings,
      });
      const n = pending.words.length;
      pending = null;
      toast(`已還原備份：${n} 個字`);
      // 設定也換了（主題、口音、目標…），請主程式把整個設定頁重畫一次
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    container.querySelector('#doCancel').addEventListener('click', () => {
      pending = null;
      container.querySelector('#importArea').innerHTML = '';
    });
  }

  draw();
}
