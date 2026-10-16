// 導覽只描述／觀察真正的控制項，不代按新增、評分或 AI 按鈕。
import { saveOnboarding } from './onboarding.js?v=tour-overlap-1';

const step = (route, target, title, text, action = '') => ({ route, target, title, text, action });
const library = [
  step('words', '#openAddWords', '加入你想學的字', '點亮起的「＋ 加入單字」，開啟真正的新增視窗。', '#openAddWords'),
  step('words', '#addForm', '一個字也能開始', '輸入英文再按加入，就會儲存到你的單字庫。上方可選擇新增時加入哪個單字集。可以現在試，也可以先看下一步。'),
  step('words', '[data-tool="batch"]', '一次貼上整份單字', '點「批次貼上」看看。換行、逗號、空白都可分隔；系統會預覽並排除重複的字。', '[data-tool="batch"]'),
  step('words', '#batchInput', '確認預覽後才加入', '貼上後先確認下方預覽，再按真正的「加入」。若開啟了新增後自動 AI 生成，加入也會使用你的金鑰；可在設定關閉。'),
  step('words', '[data-tool="pack"]', '沒有清單也能開始', '點「內建單字包」。多益 1000 字附中文、英文、例句與搭配詞，不需要金鑰。', '[data-tool="pack"]'),
  step('words', '#packTool', '選組別與收藏位置', '可每 100 字一組或全部加入。已有的字會保留內容和進度。這是正式加入，導覽不會自動替你新增。'),
  step('words', '#addWordsDialog [data-close]', '回到你的收藏', '完成加入或先看完後，點這個關閉按鈕。', '#addWordsDialog [data-close]'),
  step('words', '#search', '快速找到收藏', '可用英文或中文搜尋。每頁顯示 100 字；搜尋會涵蓋目前單字集全部的收藏。'),
  step('words', '#openManageSets', '建立自己的單字本', '在「管理單字集」建立主題分類；上方「單字集」切換這次要看的範圍。同一個字可以屬於多個集，共用內容和進度。'),
  step('words', '.library-edit-tools', '分類與內容分開整理', '「批次整理」開啟勾選工具，能跨頁選字、加入或移出分類，也能刪除所選字卡；刪除會影響所有分類與複習進度，確認前請看清預覽。「編輯模式」修改或刪除字卡。星星用來標記不熟。'),
];
const review = [
  step('review', '#card, .done-state, .page-review', '先回想，再點卡片翻面', '這裡就是你的今日複習。有字卡時可直接點卡片，或按空白鍵翻面；還沒有可複習的字時，先從單字庫加入。'),
  step('review', '.grade-controls, .done-state, .page-review', '按評分會真的記錄進度', '「不熟／會」決定下次複習時間，也計入每日目標；左右滑動同樣會評分。導覽不要求你試評分，想更正可按「復原」。手機請從卡片中央開始滑。'),
  step('review', '#reviewMenuToggle', '隨時自由翻卡', '點「複習」旁的箭頭，開啟真正的模式選單。', '#reviewMenuToggle'),
  step('review', '#reviewChoices a[href="#/free"]', '換到自由翻卡', '點「自由翻卡」前往。可以翻全部的收藏，不用等到複習日期。', '#reviewChoices a[href="#/free"]'),
  step('free', '#card, .page', '自由練習，不改複習排程', '點卡片翻面，左右滑動或按上一張／下一張換字。「只看不熟」與「隨機排序」調整練習範圍；這裡不計打卡。手機想點解釋裡的字，請先開啟「點字查詢」，換卡後會自動關閉。'),
];
export const tourTopics = {
  start: { title: '從加入單字到開始複習', description: '跟著實際按鈕走一遍，認識收藏、單字包、分類與翻卡。', steps: [
    step('review', '.done-state a[href="#/words"], a[data-route="words"]', '從你自己的單字開始', '點亮起的「新增單字」或「單字庫」，前往真正的收藏頁。你可以隨時結束，之後從設定重看。', '.done-state a[href="#/words"], a[data-route="words"]'),
    ...library, ...review,
  ] },
  library: { title: '新增與整理單字', description: '輸入、批次貼上、內建單字包、搜尋與分類。', steps: library },
  review: { title: '複習與自由翻卡', description: '翻面、評分、手機操作，以及不改排程的自由練習。', steps: review },
  lookup: { title: '查字與順手收藏', description: '輸入開頭找候選字、原樣收藏，以及解釋裡的點字查詢。', steps: [
    step('review', '#openLookup', '任何頁面都能查單字', '點這裡，或按 Ctrl／⌘ K。關閉後會回到原本的卡片或題目。', '#openLookup'),
    step('review', '#lookupInput', '不用打完整個字', '試著輸入 a 或 ac，會顯示候選字；用滑鼠點選，或方向鍵加 Enter。這只是在查字，不會自動使用 AI。'),
    step('review', '#lookupResult', '查到後再決定是否收藏', '查詢後可聽發音、選單字集並按「加入我的單字庫」。本機沒收錄時可連線查英文，或填自己的解釋並保留原拼字。英文解釋和例句的字也能直接點來查；手機翻卡要先開啟點字查詢。'),
    step('review', '#lookupDialog [data-close]', '查完回到原處', '點關閉，繼續剛才的學習。', '#lookupDialog [data-close]'),
  ] },
  explore: { title: '探索與閱讀解釋', description: '搜尋收藏、直接閱讀、點字查詢與發音。', steps: [
    step('cards', '#exploreSearch, .page', '直接閱讀收藏', '探索不用翻面。搜尋英文或中文，再選清單中的單字；可以按「只看不熟」縮小範圍。'),
    step('cards', '#exploreDetail, .page', '讀懂例句與搭配詞', '有收藏時這裡顯示解釋、例句、搭配詞和詞性變化。點英文裡不會的字即可查詢並收藏；喇叭能朗讀單字或例句。探索不改排程與打卡。'),
  ] },
  quiz: { title: '測驗、錯題與短文', description: '哪些模式免金鑰、AI 額度、錯題本與短文閱讀。', steps: [
    step('quiz', '.quiz-options', '先決定測驗範圍', '選單字集、全部或不熟，以及題數。答題會計入每日目標；答錯的字會標記不熟並收進錯題本。'),
    step('quiz', '.mode-grid', '依題型選擇練習', '簡易題與聽力不用金鑰；Part 5 需 Gemini。詞性變化優先使用單字包內建題，其他字可由 AI 補充。「出新題目」可能使用額度；沒勾選時優先重用已存題目。'),
    step('quiz', '#openMistakes', '把錯題再練一次', '錯題本可重做目前單字集答錯的題目。你可以完成導覽後再開始，教學不會自動幫你答題。'),
    step('quiz', '.reading-entry', '用熟悉的字練短文', '短文閱讀從這裡進入。產生新文章需要 Gemini；每篇一次請求，存在目前瀏覽器，最多 20 篇。文章可以反覆閱讀、點字查詢，並附理解題。'),
  ] },
  stats: { title: '統計與讀書計畫', description: '打卡、熟練度、未來複習量與考試倒數。', steps: [
    step('stats', '#streakDays', '達標才算打卡', '今日複習評分一張，或測驗答一題，都算一題；自由翻卡與探索不計入。每日目標可在設定調整。'),
    step('stats', '#hMastery', '看懂熟練度', '「長期熟記」指複習間隔達 21 天，不是按一次「會」就算。圖表期間只影響紀錄統計，不會改變目前熟練度。'),
    step('stats', '#hForecast', '預先掌握複習量', '這裡預估未來七天到期的字。設定考試日期後，上方另有倒數與每天新字數建議；超出可負擔範圍時會提醒調整計畫。'),
  ] },
  settings: { title: '備份、同步與個人設定', description: '資料保護、AI 金鑰、離線安裝、每日目標與口音。', steps: [
    step('settings', '#backupPanel', '先保護你的學習資料', '未登入時資料只在這個瀏覽器。可匯出 JSON 備份、換裝置後匯入；清除網站資料前請先備份。'),
    step('settings', '#syncPanel', '需要時才登入同步', '登入後可跨裝置同步字卡、分類和學習設定。Gemini 金鑰不會上傳；短文與教學狀態只留在這台裝置。'),
    step('settings', '#aiPanel', 'AI 是選用功能', '單字包、本機字典與簡易測驗不用金鑰。需要 AI 生成或短文時再設定；金鑰只留在這個瀏覽器。自動生成開啟後，新增單字也可能使用個人額度。'),
    step('settings', '#pwaPanel', '安裝與離線使用', '可加入手機桌面。先連網開過的網站、字典與已存字卡才能離線使用；新的 AI 內容與雲端同步需要網路。'),
    step('settings', '#examDate', '設定自己的節奏', '在這一區設定每日題數、每日新字上限與考試日期。往下還能選外觀、發音口音與速度；可用語音取決於裝置。'),
  ] },
};

let running = null;
export function startTour(topic = 'start') {
  running?.stop(false);
  const tour = tourTopics[topic] || tourTopics.start;
  saveOnboarding('started');
  document.getElementById('tutorialBanner')?.remove();
  let index = 0, frame = 0, target = null, stopped = false, followingAction = false, entering = false;
  const previousFocus = document.activeElement;
  const layer = document.createElement('div');
  layer.id = 'guidedTour'; layer.className = 'guided-tour'; layer.setAttribute('popover', 'manual');
  layer.innerHTML = `<aside class="tour-pause"><strong>教學已暫停</strong><p>請先完成或取消這個視窗的操作；關閉視窗後，會回到原本的教學步驟。</p><button class="btn btn-ghost btn-sm" type="button" id="tourPauseExit">結束導覽</button></aside><span class="tour-origin" aria-hidden="true"></span><div class="tour-ring" aria-hidden="true"></div><section class="tour-tip" role="dialog" aria-modal="false" aria-labelledby="tourTitle" aria-describedby="tourText" tabindex="-1"><div class="tour-copy"><p class="eyebrow" id="tourCount"></p><h2 id="tourTitle"></h2><p id="tourText"></p><p class="hint-text" id="tourInstruction"></p></div><div class="tour-footer"><button type="button" class="btn btn-outline btn-sm" id="tourKeyboard" hidden>收起鍵盤，看完整說明</button><div class="tour-buttons"><button type="button" class="btn btn-ghost btn-sm" id="tourExit">結束導覽</button><button type="button" class="btn btn-primary btn-sm" id="tourNext">下一步</button></div><a href="#/help" class="tour-help">查看全部教學</a></div></section>`;
  const tip = layer.querySelector('.tour-tip'), ring = layer.querySelector('.tour-ring');
  const next = layer.querySelector('#tourNext');
  const origin = layer.querySelector('.tour-origin');
  const keyboardButton = layer.querySelector('#tourKeyboard');
  const viewport = window.visualViewport;
  let inline = false;
  let watchedTarget = null;
  const sizes = new ResizeObserver(schedule);
  function stop(completed = false) {
    if (stopped) return;
    stopped = true;
    observer.disconnect(); sizes.disconnect(); cancelAnimationFrame(frame);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('hashchange', onRoute);
    window.removeEventListener('resize', schedule);
    document.removeEventListener('scroll', schedule, true);
    viewport?.removeEventListener('resize', schedule);
    viewport?.removeEventListener('scroll', schedule);
    viewport?.removeEventListener('scrollend', schedule);
    document.removeEventListener('focusin', schedule);
    document.removeEventListener('focusout', schedule);
    layer.remove(); running = null;
    saveOnboarding(completed ? 'completed' : 'skipped');
    if (previousFocus?.isConnected && !document.querySelector('dialog[open]')) previousFocus.focus({ preventScroll: true });
  }
  function advance(fromAction = false) {
    if (fromAction !== true) {
      const currentDialog = [...document.querySelectorAll('dialog[open]')].at(-1);
      const currentTarget = visible(tour.steps[index].target);
      if (currentDialog && (!currentTarget || !currentDialog.contains(currentTarget))) { schedule(); return; }
    }
    if (++index >= tour.steps.length) { stop(true); return; }
    showStep();
  }
  function visible(selector) {
    // 設定分組收合時，先展開教學目標所在區塊，不聚焦輸入欄位。
    if(entering)for(const el of document.querySelectorAll(selector)) {
      const group=el.closest('details.settings-section');if(group)group.open=true;
    }
    // 依列出的優先順序找，不能讓 DOM 中較前面的備援父容器搶過實際按鈕。
    return selector.split(',').flatMap(part => [...document.querySelectorAll(part.trim())])
      .find(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  }
  function position() {
    frame = 0;
    if (stopped) return;
    const s = tour.steps[index];
    const emptyReview = !s.action && s.route === 'review' && !document.querySelector('#card') && s.target.includes('.done-state');
    const text = emptyReview ? s.target.includes('.grade-controls')
      ? '目前沒有可評分的字卡。加入單字後，「不熟／會」會安排下次複習並計入每日目標；這裡可以先了解規則，再繼續導覽。'
      : '目前這個範圍沒有可複習的字卡。先用「新增單字」準備想學的內容；有卡片後，點卡片或按空白鍵就能翻面。'
      : s.text;
    if (layer.querySelector('#tourText').textContent !== text) layer.querySelector('#tourText').textContent = text;
    const dialog = [...document.querySelectorAll('dialog[open]')].at(-1) || null;
    target = visible(s.target);
    const blockedDialog = dialog && (!target || !dialog.contains(target)) ? dialog : null;
    if (blockedDialog) {
      // 正在操作其他視窗，先讓它完成；不能把下一步蓋在無關視窗上。
      if (typeof layer.hidePopover === 'function' && layer.matches(':popover-open')) layer.hidePopover();
      layer.removeAttribute('popover');
      layer.classList.remove('is-inline'); layer.classList.add('is-paused'); inline = false;
      const heading = dialog.querySelector('.tool-heading');
      if (layer.parentElement !== dialog) {
        if (heading) heading.after(layer); else dialog.prepend(layer);
      }
      ring.hidden = true;
      return;
    }
    layer.classList.remove('is-paused');
    if (inline && matchMedia('(hover: none)').matches && document.activeElement?.matches('input, textarea, select')) {
      inline = false; layer.classList.remove('is-inline');
    }
    if (inline) {
      // 同一步已選擇上下排列後就維持，避免捲動時來回切換造成跳動。
      placeInline(dialog);
      positionInline();
      return;
    }
    layer.setAttribute('popover', 'manual');
    if (layer.parentElement !== (dialog || document.body)) {
      if (typeof layer.hidePopover === 'function' && layer.matches(':popover-open')) layer.hidePopover();
      (dialog || document.body).append(layer);
    }
    if (typeof layer.showPopover === 'function' && !layer.matches(':popover-open')) layer.showPopover();
    if (target !== watchedTarget) {
      sizes.disconnect();
      if (target) sizes.observe(target);
      watchedTarget = target;
    }
    const touch = matchMedia('(hover: none)').matches;
    const editing = touch && document.activeElement?.matches('input, textarea, select, [contenteditable="true"]');
    // 輸入期間不搶捲動或焦點，只留下能收起鍵盤的小提示。
    tip.classList.toggle('is-editing', !!editing);
    keyboardButton.hidden = !editing;
    if (entering && !editing) target?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    const usable = target && (!dialog || dialog.contains(target));
    layer.querySelector('#tourInstruction').textContent = s.action && usable ? '請點亮起的實際按鈕，或按「先略過」繼續。' : usable ? '可以直接操作畫面；看完後按下一步。' : '目前沒有這個控制項，或已切換操作。可先略過，之後從使用教學重看。';
    const width = viewport?.width || innerWidth;
    const height = viewport?.height || innerHeight;
    const x = viewport?.offsetLeft || 0, y = viewport?.offsetTop || 0;
    // 與 target 一樣用 client 座標，再扣除固定定位原點，避免 Safari 的固定層位移被加算兩次。
    const base = origin.getBoundingClientRect();
    const r = usable ? target.getBoundingClientRect() : null;
    if (emptyReview) {
      if (touch && !editing) {
        inline = true; placeInline(dialog); positionInline(); return;
      }
    }
    const clipped = r && {
      left: Math.max(x + 4, r.left - 5), top: Math.max(y + 4, r.top - 5),
      right: Math.min(x + width - 4, r.right + 5), bottom: Math.min(y + height - 4, r.bottom + 5),
    };
    ring.hidden = !clipped || clipped.right <= clipped.left || clipped.bottom <= clipped.top;
    if (!ring.hidden) Object.assign(ring.style, {
      left: `${clipped.left - base.left}px`, top: `${clipped.top - base.top}px`,
      width: `${clipped.right - clipped.left}px`, height: `${clipped.bottom - clipped.top}px`,
    });
    const tw = Math.min(360, width - 24);
    tip.style.width = `${tw}px`;
    tip.style.maxHeight = `${Math.max(1, height - 24)}px`;
    let th = tip.getBoundingClientRect().height;
    if (!editing && r && r.bottom > y && r.top < y + height) {
      const above = Math.max(0, r.top - y - 28), below = Math.max(0, y + height - r.bottom - 28);
      const space = Math.max(above, below);
      if (space < Math.min(th, 180) && touch) {
        inline = true; placeInline(dialog); positionInline(); return;
      }
      if (space >= 130) {
        tip.style.maxHeight = `${Math.min(height - 24, space)}px`;
        th = tip.getBoundingClientRect().height;
      }
    }
    let top;
    if (editing) {
      // 小提示放在離輸入欄較遠的一側，輸入時不顯示整段教學蓋住欄位。
      const upper = r ? r.top - y : 0, lower = r ? y + height - r.bottom : height;
      top = upper > lower ? y + 12 : y + height - th - 12;
    } else {
      const below = r ? r.bottom + 16 : y + (height - th) / 2;
      top = r && below + th > y + height - 12 ? r.top - th - 16 : below;
    }
    top = Math.max(y + 12, Math.min(top, y + height - th - 12));
    const left = Math.max(x + 12, Math.min(r ? r.left : x + (width - tw) / 2, x + width - tw - 12));
    Object.assign(tip.style, { left: `${left - base.left}px`, top: `${top - base.top}px` });
    if (entering) {
      entering = false;
      // 原生視窗會先聚焦輸入框；使用者已開始輸入時，不搶焦點關掉候選字。
      if (!document.activeElement?.matches('input, textarea, select')) tip.focus({ preventScroll: true });
    }
  }
  function placeInline(dialog) {
    if (typeof layer.hidePopover === 'function' && layer.matches(':popover-open')) layer.hidePopover();
    layer.removeAttribute('popover'); layer.classList.add('is-inline');
    const container = dialog || target?.closest('.page') || document.querySelector('#view .page') || document.body;
    let anchor = target;
    if (!anchor || !container.contains(anchor) || anchor === container) {
      if (layer.parentElement !== container) container.prepend(layer);
      return;
    }
    while (anchor.parentElement !== container) anchor = anchor.parentElement;
    if (anchor.nextElementSibling !== layer) anchor.after(layer);
  }
  function positionInline() {
    // 教學成為正常排版的一部分，沒有疊在目標上的浮窗或巨大備援光圈。
    ring.hidden = true;
    tip.style.width = '100%'; tip.style.maxHeight = `${Math.max(130, (viewport?.height || innerHeight) - 24)}px`;
    if (entering) { entering = false; tip.scrollIntoView({ block: 'nearest', behavior: 'instant' }); tip.focus({ preventScroll: true }); }
  }
  function schedule() { if (!stopped && !frame) frame = requestAnimationFrame(position); }
  function showStep() {
    const s = tour.steps[index];
    entering = true;
    inline = false;
    layer.classList.remove('is-inline');
    layer.querySelector('#tourCount').textContent = `${tour.title} · ${index + 1} / ${tour.steps.length}`;
    layer.querySelector('#tourTitle').textContent = s.title;
    layer.querySelector('#tourText').textContent = s.text;
    layer.querySelector('.tour-copy').scrollTop = 0;
    next.textContent = index === tour.steps.length - 1 ? '完成導覽' : s.action ? '先略過' : '下一步';
    // 只導向正常頁面；視窗與分頁必須由使用者自己點開。
    if (location.hash.split('?')[0] !== `#/${s.route}`) location.hash = `/${s.route}`;
    schedule();
  }
  function onClick(e) {
    if (layer.contains(e.target)) return;
    const s = tour.steps[index];
    if (s.action && e.target.closest(s.action) && !e.target.closest(':disabled')) {
      // 等原本的 click handler / hashchange 跑完，不攔截正常導向。
      followingAction = true;
      setTimeout(() => { followingAction = false; if (!stopped && s === tour.steps[index]) advance(true); }, 0);
    }
  }
  function onRoute() {
    // 使用者自行切去別頁就結束，不把人拉回導覽指定的頁面。
    if (!followingAction && location.hash.split('?')[0] !== `#/${tour.steps[index].route}`) stop(false);
    else schedule();
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); stop(false); }
    else if (layer.contains(e.target)) e.stopPropagation();
  }
  const observer = new MutationObserver(records => {
    if (records.some(r => !layer.contains(r.target))) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'hidden'] });
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('hashchange', onRoute);
  window.addEventListener('resize', schedule);
  document.addEventListener('scroll', schedule, true);
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  viewport?.addEventListener('scrollend', schedule);
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', schedule);
  keyboardButton.addEventListener('click', () => {
    const active = document.activeElement;
    if (active?.matches('input, textarea, select, [contenteditable="true"]')) active.blur();
    tip.focus({ preventScroll: true }); schedule();
  });
  layer.querySelector('#tourExit').addEventListener('click', () => stop(false));
  layer.querySelector('#tourPauseExit').addEventListener('click', () => stop(false));
  layer.querySelector('.tour-help').addEventListener('click', () => stop(false));
  next.addEventListener('click', advance);
  running = { stop }; showStep();
}
