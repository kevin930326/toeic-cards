import { saveOnboarding } from '../onboarding.js';

const modes = {
  review: ['今日複習', '依排程回想，再按「會／不熟」安排下次複習；會計入每日目標。'],
  free: ['自由翻卡', '自己決定順序，翻閱目前單字集所有字；翻面與換字不改排程。'],
  cards: ['探索', '直接閱讀中英文解釋、例句與搭配詞，適合查閱與理解。'],
};
export function renderHelp(root) {
  document.getElementById('tutorialBanner')?.remove();
  let step = new URLSearchParams(location.hash.split('?')[1]).get('tour') === '1' ? 1 : 0;
  let added = false, mode = 'review', flipped = false, feedback = '', completed = false;
  if (step) saveOnboarding('started');
  function stepContent() {
    if (step === 1) return `
      <h2>先準備想背的單字</h2>
      <p>到「單字庫 → ＋加入單字」，可輸入、批次貼上，或選內建多益 1000 單字包。先用這組練習看看。</p>
      <div class="tutorial-pack">
        <strong>商務入門 · 3 個練習字</strong><p lang="en">invoice · budget · meeting</p>
        <button class="btn btn-outline" id="demoAdd" type="button" ${added ? 'disabled' : ''}>${added ? '已加入練習單字' : '試加入這組練習單字'}</button>
        <p id="demoAddStatus" role="status" tabindex="-1">${added ? '練習字卡已備妥！正式加入時也會保留在你的單字庫。' : '這裡只示範操作，不會新增真正的字卡。'}</p>
      </div>`;
    if (step === 2) return `
      <h2>選擇適合你的學習方式</h2>
      <p>上方「複習 ▾」可切換今日複習與自由翻卡；想直接讀解釋則選「探索」。</p>
      <div class="tutorial-modes" role="group" aria-label="練習選擇學習方式">
        ${Object.entries(modes).map(([key, [name, desc]]) => `
          <button type="button" class="tutorial-mode" data-mode="${key}" aria-pressed="${mode === key}">
            <strong>${name}</strong><span>${desc}</span>
          </button>`).join('')}
      </div>
      <p role="status">已選：${modes[mode][0]}。下一步會用練習卡示範翻面與回饋。</p>`;
    return `
      <h2>先回想，再翻面確認</h2>
      <p>點卡片或聚焦後按 Enter／空白鍵翻面。這張練習卡不會記錄評分。</p>
      <button class="tutorial-practice" id="demoCard" type="button" aria-pressed="${flipped}"
        aria-label="${flipped ? '練習字卡背面，點擊回正面' : '練習字卡 invoice，點擊翻面'}">
        <small>${flipped ? '背面' : '正面'}</small><strong>${flipped ? 'n. 發票；請款單' : 'invoice'}</strong>
        <span>${flipped ? 'a document listing goods and their prices' : '想想它的意思，再點一下翻面'}</span>
      </button>
      <div class="tutorial-actions">
        <button class="btn btn-outline" id="demoAgain" type="button" ${flipped ? '' : 'disabled'}>還不熟（練習）</button>
        <button class="btn btn-outline" id="demoGood" type="button" ${flipped ? '' : 'disabled'}>我記得了（練習）</button>
      </div>
      <p id="demoFeedback" role="status">${feedback || '正式的今日複習會依評分安排時間；自由翻卡和探索不會。'}</p>`;
  }
  function draw(focus = false) {
    root.innerHTML = `<section class="page page-help"><p class="eyebrow">GET STARTED</p><h1 class="page-title" id="helpTitle" tabindex="-1">${step ? '跟著做，認識單字卡' : '使用教學'}</h1>
    ${step ? `<p class="tutorial-step-count" role="status">第 ${step} / 3 步</p><ol class="tutorial-steps" aria-label="導覽步驟">${['加入單字', '選學習方式', '試翻字卡'].map((label, i) => `<li ${step === i + 1 ? 'aria-current="step"' : ''}>${i + 1}. ${label}</li>`).join('')}</ol>
      <div class="panel tutorial-stage"><p class="tutorial-demo-label">練習區 · 不會加入正式字庫或改動進度</p>
      ${stepContent()}
      </div><div class="tutorial-actions"><button class="btn btn-ghost" id="tutorialExit" type="button">先結束教學</button>${step > 1 ? '<button class="btn btn-outline" id="tutorialBack" type="button">上一步</button>' : ''}<button class="btn btn-primary" id="tutorialNext" type="button">${step === 3 ? '完成教學' : '下一步'}</button></div>`
    : `<div class="panel"><h2>${completed ? '準備好開始了' : '從加入單字，到找到自己的學習節奏'}</h2><p>${completed ? '練習結束，接下來可以加入真正想學的單字，或回到你選的學習方式。' : '三步導覽使用獨立練習資料，不用金鑰，也不會修改真實字卡。隨時可以略過或重新觀看。'}</p><div class="tutorial-actions"><button class="btn btn-primary" id="tutorialStart" type="button">${completed ? '重新觀看導覽' : '開始三步導覽'}</button><a class="btn btn-outline" href="#/words?pack=toeic-1000">加入內建單字包</a>${completed ? `<a class="btn btn-ghost" href="#/${mode}">前往${modes[mode][0]}</a>` : ''}</div></div>
      <h2>三種學習方式怎麼選？</h2><div class="tutorial-reference">${Object.entries(modes).map(([key, [name, desc]]) => `<article class="panel"><h3>${name}</h3><p>${desc}</p><a href="#/${key}">前往${name} →</a></article>`).join('')}</div>
      <div class="panel"><h2>常見操作</h2><ul><li>「查單字」隨時查中文與收藏；英文解釋、例句也能直接點字查。</li><li>「批次整理」開啟後才顯示勾選框，可把單字加入或移出自訂單字集。</li><li>「編輯模式」開啟後可修改或刪除內容；星星代表標記不熟。</li><li>統計的「長期熟記」指複習間隔達 21 天，不是按一次「會」就算。</li><li>未登入時資料存在這個瀏覽器；可在設定備份，或登入啟用跨裝置同步。</li></ul><p class="hint-text">教學狀態只記在這個瀏覽器；換裝置、無痕模式或清除網站資料可能再次顯示。設定的「使用教學」可隨時重看。</p></div>`}</section>`;
    root.querySelector('#tutorialStart')?.addEventListener('click', () => { saveOnboarding('started'); history.replaceState(null, '', '#/help?tour=1'); step = 1; added = flipped = completed = false; feedback = ''; draw(true); });
    root.querySelector('#demoAdd')?.addEventListener('click', () => { added = true; draw(); root.querySelector('#demoAddStatus').focus(); });
    for (const button of root.querySelectorAll('[data-mode]')) button.addEventListener('click', () => { mode = button.dataset.mode; draw(); root.querySelector(`[data-mode="${mode}"]`).focus(); });
    root.querySelector('#demoCard')?.addEventListener('click', () => { flipped = !flipped; draw(); root.querySelector('#demoCard').focus(); });
    for (const [id, text] of [['demoAgain', '還不熟時，今日複習會安排較快再見到這個字。'], ['demoGood', '記得時，今日複習會逐步拉長複習間隔。']]) root.querySelector(`#${id}`)?.addEventListener('click', () => { feedback = `${text}這次只是練習，沒有記錄。`; draw(); root.querySelector(`#${id}`).focus(); });
    root.querySelector('#tutorialNext')?.addEventListener('click', () => { if (step < 3) step++; else { saveOnboarding('completed'); history.replaceState(null, '', '#/help'); completed = true; step = 0; } draw(true); });
    root.querySelector('#tutorialBack')?.addEventListener('click', () => { step--; draw(true); });
    root.querySelector('#tutorialExit')?.addEventListener('click', () => { saveOnboarding('skipped'); history.replaceState(null, '', '#/help'); step = 0; draw(true); });
    if (focus) root.querySelector('#helpTitle').focus();
  }
  draw();
}
