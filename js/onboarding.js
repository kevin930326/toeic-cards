import { getWords, getSetRecords } from './store.js';
import { getLog } from './log.js';
import { onboardingPrompt } from './onboarding-state.js';

const KEY = 'toeic-cards:onboarding';
let memory = null;
export function readOnboarding() {
  try { return memory || JSON.parse(localStorage.getItem(KEY) || 'null'); }
  catch { return memory; }
}
export function saveOnboarding(status) {
  memory = { version: 1, status, updatedAt: Date.now() };
  try { localStorage.setItem(KEY, JSON.stringify(memory)); return true; }
  catch { return false; } // 儲存被封鎖時仍可完成教學與使用網站。
}
export function initOnboarding() {
  if (location.hash.split('?')[0] === '#/help') return;
  const kind = onboardingPrompt(readOnboarding(), !!(getWords().length || getSetRecords().length || Object.keys(getLog()).length));
  if (kind === 'none') return;
  function start() { saveOnboarding('started'); location.hash = '/help?tour=1'; }
  if (kind === 'banner') {
    const banner = document.createElement('aside');
    banner.id = 'tutorialBanner'; banner.className = 'tutorial-banner'; banner.setAttribute('aria-label', '使用教學提示');
    banner.innerHTML = '<span>新增使用教學：認識今日複習、自由翻卡與探索。</span><a class="btn btn-ghost btn-sm" href="#/help">看看教學</a><button class="icon-btn" type="button" aria-label="關閉教學提示">✕</button>';
    document.querySelector('.topbar').after(banner);
    banner.querySelector('button').addEventListener('click', () => { saveOnboarding('skipped'); banner.remove(); });
    banner.querySelector('a').addEventListener('click', () => { saveOnboarding('started'); banner.remove(); });
    return;
  }
  const dialog = document.createElement('dialog');
  dialog.id = 'welcomeDialog'; dialog.className = 'dialog tutorial-welcome'; dialog.setAttribute('aria-labelledby', 'welcomeTitle');
  dialog.innerHTML = '<p class="eyebrow">WELCOME TO TOEIC CARDS</p><h2 id="welcomeTitle">從第一張單字卡開始</h2><p>不用先設定 API 金鑰。花一點時間認識加入單字、選擇學習方式與翻卡操作。</p><p class="hint-text">教學使用練習資料，不會影響你的字卡與學習進度。</p><div class="tutorial-actions"><button class="btn btn-primary" id="startWelcome" type="button">帶我開始</button><button class="btn btn-ghost" id="skipWelcome" type="button">先自己逛逛</button></div>';
  document.body.append(dialog);
  dialog.querySelector('#startWelcome').addEventListener('click', () => { start(); dialog.close(); });
  dialog.querySelector('#skipWelcome').addEventListener('click', () => { saveOnboarding('skipped'); dialog.close(); });
  dialog.addEventListener('cancel', () => saveOnboarding('skipped'));
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  // 其他視窗開啟時不疊加歡迎視窗（例如直達單字包的連結）。
  if (document.querySelector('dialog[open]')) { dialog.remove(); return; }
  dialog.showModal();
}
