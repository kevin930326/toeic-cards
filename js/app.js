// 主程式：依網址的 #/xxx 切換頁面
import { getWords, getSettings, updateSettings, subscribe } from './store.js';
import { renderReview, reviewBadgeCount } from './views/review.js';
import { renderCards } from './views/cards.js';
import { renderQuiz } from './views/quiz.js';
import { pruneMistakes } from './mistakes.js';
import { renderWords } from './views/words.js';
import { renderSettings } from './views/settings.js';
import { lookupMissing } from './dictionary.js';
import { onRateWait } from './llm.js';
import { setWaiting } from './generate.js';

const routes = {
  review: renderReview,
  cards: renderCards,
  quiz: renderQuiz,
  words: renderWords,
  settings: renderSettings,
};

const view = document.getElementById('view');
let cleanup = null;

function currentRoute() {
  const name = location.hash.replace(/^#\/?/, '').split('?')[0];
  return routes[name] ? name : 'review';
}

function render() {
  const name = currentRoute();
  if (cleanup) cleanup();
  cleanup = routes[name](view) || null;
  document.querySelectorAll('.nav a').forEach((a) => {
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

window.addEventListener('hashchange', () => { render(); updateBadge(); });
applyTheme();
render();
updateBadge();
lookupMissing();
onRateWait(setWaiting);
