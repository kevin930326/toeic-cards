// 主程式：依網址的 #/xxx 切換頁面
import { getSettings, updateSettings, subscribe } from './store.js';
import { renderCards } from './views/cards.js';
import { renderWords } from './views/words.js';
import { renderSettings } from './views/settings.js';
import { lookupMissing } from './dictionary.js';
import { onRateWait } from './llm.js';
import { setWaiting } from './generate.js';

const routes = {
  cards: renderCards,
  words: renderWords,
  settings: renderSettings,
};

const view = document.getElementById('view');
let cleanup = null;

function currentRoute() {
  const name = location.hash.replace(/^#\/?/, '').split('?')[0];
  return routes[name] ? name : 'cards';
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

window.addEventListener('hashchange', render);
applyTheme();
render();
lookupMissing();
onRateWait(setWaiting);
