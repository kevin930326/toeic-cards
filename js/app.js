// 主程式：依網址的 #/xxx 切換頁面
import { getWords, getSettings, updateSettings, subscribe } from './store.js';
import { renderReview, reviewBadgeCount } from './views/review.js';
import { renderCards } from './views/cards.js';
import { renderQuiz } from './views/quiz.js';
import { renderStats } from './views/stats.js';
import { pruneMistakes } from './mistakes.js';
import { onLogChange, todayProgress, getLog, currentGoal } from './log.js';
import { streak } from './stats.js';
import { dayKey } from './srs.js';
import { toast } from './ui.js';
import { initPWA } from './pwa.js';
import { initSync } from './sync.js';
import { hasApiKey } from './llm.js';
import { renderWords } from './views/words.js';
import { renderSettings } from './views/settings.js';
import { lookupMissing } from './dictionary.js';
import { onRateWait } from './llm.js';
import { setWaiting, generateMissing } from './generate.js';
import { initWordLookup } from './word-lookup.js';

const routes = {
  review: renderReview,
  cards: renderCards,
  quiz: renderQuiz,
  stats: renderStats,
  words: renderWords,
  settings: renderSettings,
};

const view = document.getElementById('view');
initWordLookup();
let cleanup = null;

function currentRoute() {
  const name = location.hash.replace(/^#\/?/, '').split('?')[0];
  return routes[name] ? name : 'review';
}

function render() {
  const name = currentRoute();
  if (cleanup) cleanup();
  cleanup = routes[name](view) || null;
  document.querySelectorAll('a[data-route]').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === name);
    if (a.dataset.route === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

// ---- 深色模式 ----
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme() {
  const t = getSettings().theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : media.matches;
}

document.getElementById('themeToggle').addEventListener('click', () => {
  updateSettings({ theme: isDark() ? 'light' : 'dark' });
  applyTheme();
});
media.addEventListener('change', applyTheme);
subscribe(applyTheme);

// 導覽列「複習」旁邊顯示今天還有幾張
function updateBadge() {
  const el = document.getElementById('reviewBadge');
  const n = reviewBadgeCount();
  el.textContent = n > 99 ? '99+' : String(n);
  el.hidden = n === 0;
}
subscribe(updateBadge);
// 單字被刪掉時，錯題本裡相關的題目也一起清掉
subscribe(() => pruneMistakes(getWords().map((w) => w.id)));

// 達成每日目標時跳出慶祝訊息（每天只跳一次；復原到目標以下再達標也不會重複）
const CELEBRATED_KEY = 'toeic-cards:celebrated';
onLogChange(() => {
  const t = todayProgress();
  if (!t.met) return;
  const today = dayKey(Date.now());
  let last = '';
  try { last = localStorage.getItem(CELEBRATED_KEY) || ''; } catch (e) { /* 讀不到就當作還沒慶祝 */ }
  if (last === today) return;
  try { localStorage.setItem(CELEBRATED_KEY, today); } catch (e) { /* 寫不進去頂多再跳一次 */ }
  const days = streak(getLog(), Date.now(), currentGoal()).days;
  toast(`🎉 今日目標達成！連續打卡 ${days} 天`, 'success');
});

window.addEventListener('hashchange', () => { render(); updateBadge(); });
applyTheme();
render();
updateBadge();
lookupMissing();
onRateWait(setWaiting);

// 跨裝置同步（有設定 Firebase、而且登入過才會連線）
initSync();

// PWA：離線使用、安裝到主畫面。重新連上網路時，補查字典、繼續 AI 生成
initPWA({
  onBackOnline: () => {
    toast('已重新連上網路');
    lookupMissing();
    if (hasApiKey() && getSettings().autoGenerate) generateMissing({ automatic: true });
  },
});
