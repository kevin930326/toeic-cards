// 複習頁（首頁）：依間隔重複排程，一張一張複習
//   往右滑／按「會」→ 隔越來越久才再出現
//   往左滑／按「不熟」→ 標記不熟，這一輪稍後再出現一次，10 分鐘後也會再到期
import { getWord, getSettings, updateSettings, updateWord, subscribe } from '../store.js';
import { openEditor, goalRingHTML } from '../ui.js';
import { speak } from '../speech.js';
import { setCardFlipped, handleCardTap, flashcardHTML, modeToggleHTML, swipeLabelsHTML } from '../cardview.js?v=dictionary-scale-1';
import { createCardLookupMode } from '../card-lookup-mode.js';
import { attachSwipe, flyOut } from '../swipe.js?v=swipe-isolation-1';
import {
  grade, buildQueue, reconcileQueue, previewIntervals, formatInterval, isNew, dayKey, dayStart, DAY, MASTERED_DAYS,
} from '../srs.js';
import { recordReview, learnedToday, getDay, todayProgress, getLog, currentGoal } from '../log.js';
import { streak } from '../stats.js?v=stats-progress-1';
import { onLookupStatus } from '../dictionary.js?v=dictionary-scale-1';
import { onGenerateStatus } from '../generate.js?v=dictionary-scale-1';
import { scopedWords, activeSetId } from '../store.js';
import { setScopeHTML, bindSetScope } from '../set-ui.js?v=dictionary-scale-1';
import { daysUntilExam } from '../exam-plan.js';

// 有設定考試日期時，在今日複習的說明後面加上倒數
function examLine() {
  const days = daysUntilExam(getSettings().examDate);
  return days !== null && days > 0 ? `<span class="exam-countdown">距離多益還有 <strong>${days}</strong> 天</span>` : '';
}

const AGAIN_GAP = 3;   // 答「不熟」的字，在這一輪中隔 3 張後再出現

// 這一輪複習的狀態（切換頁面回來還在；過了一天會重建）
let session = null;

function newLimitLeft(extra = 0) {
  return Math.max(0, (Number(getSettings().newPerDay) || 20) - learnedToday() + extra);
}

function startSession(extraNew = 0) {
  const now = Date.now();
  session = {
    day: dayKey(now),
    scope: scopeKey(),
    extraNew: (session && session.day === dayKey(now) && session.scope === scopeKey() ? session.extraNew : 0) + extraNew,
    queue: [],
    total: 0,
    history: [],     // 用來「復原」
    flipped: false,
  };
  session.queue = buildQueue(scopedWords(), now, newLimitLeft(session.extraNew));
  session.total = session.queue.length;
  // 每張卡排進佇列時看到的 srs.last；之後若變了，代表在別的裝置評分過（見 syncSession）
  session.known = new Map(session.queue.map((id) => [id, getWord(id)?.srs?.last || 0]));
}

// 佇列是開始這一輪時排好的；同步進來別台裝置的複習結果、或時間到了有字到期時，
// 用 reconcileQueue 對齊：別處複習過的字拿掉、新到期的字補上。回傳佇列有沒有改變。
function syncSession(now = Date.now()) {
  if (!session || session.day !== dayKey(now) || session.scope !== scopeKey()) return false;
  const front = session.queue[0];
  const r = reconcileQueue(session.queue, session.known, scopedWords(), now);
  session.known = r.known;
  if (!r.removed && !r.added) return false;
  session.queue = r.queue;
  session.total = Math.max(session.queue.length, session.total - r.removed + r.added);
  if (session.queue[0] !== front) session.flipped = false;
  return true;
}

function scopeKey() { return JSON.stringify([activeSetId(), scopedWords().map((w) => w.id)]); }

export function renderReview(root) {
  if (!session || session.day !== dayKey(Date.now()) || (!session.queue.length && !session.history.length)) {
    startSession();
  }
  let busy = false;   // 飛出動畫進行中，避免連按
  let detachSwipe;
  const lookupMode = createCardLookupMode();

  function current() {
    // 單字被刪掉的話直接略過
    while (session.queue.length && !getWord(session.queue[0])) session.queue.shift();
    return session.queue.length ? getWord(session.queue[0]) : null;
  }

  function draw() {
    detachSwipe?.();
    const nextScope = scopeKey();
    if (session.scope !== nextScope) {
      const [oldSet, oldIds] = JSON.parse(session.scope);
      const [nextSet, nextIds] = JSON.parse(nextScope);
      const available = new Set(nextIds);
      // 查字後收藏新字時，保留正在複習的卡片、翻面與佇列；新字留待下一輪。
      if (session.queue.length && oldSet === nextSet && oldIds.every((id) => available.has(id))) session.scope = nextScope;
      else startSession();
    }
    syncSession();
    const w = current();
    const { cardMode } = getSettings();
    lookupMode.prepare(JSON.stringify([activeSetId(), w?.id, cardMode]));
    if (!w) { drawDone(); return; }

    const now = Date.now();
    const iv = previewIntervals(w.srs, now);
    const doneCount = session.total - session.queue.length;
    const pct = session.total ? Math.round((doneCount / session.total) * 100) : 0;
    const tag = isNew(w) ? '新字' : `複習・間隔 ${w.srs.interval || 0} 天`;
    const touch = window.matchMedia('(hover: none)').matches;

    root.innerHTML = `
      <section class="page page-review">
        <div class="review-purpose"><h1>今日複習</h1><p>先回想，再翻面確認；評分會安排下次複習時間。${examLine()}</p></div>
        ${setScopeHTML()}
        <div class="review-head">
          <p class="review-count"><strong id="remain">${session.queue.length}</strong> 張待複習</p>
          ${goalPill()}
          ${modeToggleHTML(cardMode)}
        </div>
        <div class="progress review-progress" aria-hidden="true"><div class="progress-bar" style="width:${pct}%"></div></div>
        ${lookupMode.html()}
        <div class="card-stage review-stage">
          <div class="swipe-wrap" id="swipe">
            ${flashcardHTML(w, {
              flipped: session.flipped,
              mode: cardMode,
              corner: tag,
              lookupEnabled: lookupMode.enabled,
              lookupOnly: lookupMode.lookupOnly,
              hint: touch ? '點一下翻面・左右滑動評分' : '點一下翻面',
            })}
            ${swipeLabelsHTML}
          </div>
        </div>
        <div class="grade-controls">
          <button class="btn grade-btn grade-again" id="again" type="button">
            <span>✗ 不熟</span><small>${formatInterval(iv.again)}後</small>
          </button>
          <button class="btn grade-btn grade-good" id="good" type="button">
            <span>✓ 會</span><small>${formatInterval(iv.good)}後</small>
          </button>
        </div>
        <p class="swipe-tip hint-text">從卡片中央左右滑動；螢幕邊緣保留給上一頁／下一頁。</p>
        <div class="review-tools">
          <button class="btn btn-ghost btn-sm" id="undo" type="button" ${session.history.length ? '' : 'disabled'}>↶ 復原</button>
          <button class="btn btn-ghost btn-sm" id="edit" type="button">編輯</button>
        </div>
        ${lookupMode.touch ? '' : '<p class="hint-text">英文解釋與例句可點字查意思，也能加入單字集。</p>'}
        <p class="kbd-hint">鍵盤：空白鍵翻面　← 不熟　→ 會　P 發音　Z 復原</p>
      </section>`;

    bindMode();
    root.querySelector('#cardLookupToggle')?.addEventListener('click', () => {
      lookupMode.toggle();
      if (lookupMode.enabled) session.flipped = true;
      draw();
      root.querySelector('#cardLookupToggle').focus({ preventScroll: true });
    });
    bindSetScope(root);
    const card = root.querySelector('#card');
    const wrap = root.querySelector('#swipe');
    // 滑鼠／觸控的點擊由 attachSwipe 的 onTap 處理；這裡處理鍵盤觸發的 click
    const tap = (target) => handleCardTap(target, w, flip);
    card.addEventListener('click', (e) => { e.stopPropagation(); tap(e.target); });
    detachSwipe = attachSwipe(wrap, {
      onTap: tap,
      onSwipe: (dir) => answer(dir === 'right' ? 'good' : 'again', { animated: true }),
      onDrag: (dx) => {
        wrap.style.setProperty('--good', Math.max(0, Math.min(1, dx / 90)));
        wrap.style.setProperty('--again', Math.max(0, Math.min(1, -dx / 90)));
      },
    });
    root.querySelector('#again').addEventListener('click', () => answer('again'));
    root.querySelector('#good').addEventListener('click', () => answer('good'));
    root.querySelector('#undo').addEventListener('click', undo);
    root.querySelector('#edit').addEventListener('click', () => openEditor(w.id));
  }

  // 今日目標的小徽章：進度環＋「今日 12/20」
  function goalPill() {
    const t = todayProgress();
    return `<a class="goal-pill ${t.met ? 'is-met' : ''}" href="#/stats" title="今日目標" aria-label="今日目標 ${t.done} / ${t.goal} 題">
      ${goalRingHTML(t.done, t.goal, 26)}<span>${t.done}/${t.goal}</span></a>`;
  }

  function drawDone() {
    const now = Date.now();
    const words = scopedWords();
    const day = getDay(now);
    const tomorrowEnd = dayStart(now) + 2 * DAY;
    const dueTomorrow = words.filter((w) => w.srs && w.srs.due < tomorrowEnd).length;
    const newLeft = words.filter(isNew).length;

    let body;
    if (!words.length) {
      body = `<p class="empty-title">${activeSetId() ? '這個單字集還沒有字卡' : '還沒有任何字卡'}</p>
        <p>到「單字庫」輸入英文單字，就可以開始複習。</p>
        <a class="btn btn-primary" href="#/words">新增單字</a>`;
    } else {
      body = `
        <p class="done-mark" aria-hidden="true">✓</p>
        <p class="empty-title">今天的複習完成了！</p>
        ${day.reviews ? `<p class="done-stats">今天複習了 <strong>${day.reviews}</strong> 次：會 ${day.good}・不熟 ${day.again}・新學 ${day.learned} 個字</p>` : ''}
        ${goalLine()}
        <p class="muted">${dueTomorrow ? `明天有 ${dueTomorrow} 個字要複習` : '明天沒有到期的字'}</p>
        <div class="done-actions">
          ${newLeft ? `<button class="btn btn-primary" id="more" type="button">再學 ${Math.min(10, newLeft)} 個新字</button>` : ''}
          ${session.history.length ? '<button class="btn btn-ghost" id="undo" type="button">↶ 復原上一張</button>' : ''}
          <a class="btn btn-outline" href="#/free">自由翻卡</a><a class="btn btn-ghost" href="#/cards">探索單字</a>
        </div>`;
    }
    root.innerHTML = `<section class="page">${setScopeHTML()}<div class="empty-state done-state">${body}</div></section>`;
    bindSetScope(root);
    root.querySelector('#more')?.addEventListener('click', () => { startSession(10); draw(); });
    root.querySelector('#undo')?.addEventListener('click', undo);
  }

  // 完成畫面上的打卡狀態；還沒達標時建議去測驗補足
  function goalLine() {
    const t = todayProgress();
    const st = streak(getLog(), Date.now(), currentGoal());
    if (t.met) return `<p class="goal-done">🎉 今日目標達成！已連續打卡 <strong>${st.days}</strong> 天</p>`;
    return `<p class="goal-todo">今日目標 ${t.done} / ${t.goal} 題，還差 <strong>${t.goal - t.done}</strong> 題就能打卡
      <a href="#/quiz">去測驗 ›</a></p>`;
  }

  function bindMode() {
    root.querySelectorAll('input[name="mode"]').forEach((i) =>
      i.addEventListener('change', () => updateSettings({ cardMode: i.value })));
  }

  function flip() {
    session.flipped = !session.flipped;
    setCardFlipped(root.querySelector('#card'),session.flipped);
  }

  // 評分：更新複習排程、記錄、換下一張
  async function answer(rating, { animated = false } = {}) {
    if (busy) return;
    const w = current();
    if (!w) return;
    busy = true;
    lookupMode.reset();
    if (!animated) {
      const wrap = root.querySelector('#swipe');
      if (wrap) await flyOut(wrap, rating === 'good' ? 'right' : 'left');
    }
    const now = Date.now();
    const wasNew = isNew(w);
    session.history.push({ id: w.id, srs: w.srs || null, unfamiliar: w.unfamiliar, rating, wasNew, at: now, queue: [...session.queue] });
    if (session.history.length > 50) session.history.shift();

    const srs = grade(w.srs, rating, now);
    const patch = { srs };
    if (rating === 'again') patch.unfamiliar = true;
    else if (srs.interval >= MASTERED_DAYS) patch.unfamiliar = false;   // 已經很熟了

    session.known.set(w.id, srs.last);   // 這台裝置自己評分的，不算「別處複習過」
    session.queue.shift();
    if (rating === 'again') session.queue.splice(Math.min(AGAIN_GAP, session.queue.length), 0, w.id);
    session.flipped = false;
    recordReview(rating, wasNew, now);
    busy = false;
    updateWord(w.id, patch);   // 會觸發 subscribe → draw()
  }

  function undo() {
    lookupMode.reset();
    const h = session.history.pop();
    if (!h || !getWord(h.id)) return;
    session.queue = h.queue;
    session.known.set(h.id, h.srs?.last || 0);
    session.flipped = false;
    recordReview(h.rating, h.wasNew, h.at, -1);
    updateWord(h.id, { srs: h.srs, unfamiliar: h.unfamiliar });
  }

  function onKey(e) {
    if (document.querySelector('dialog[open]')) return;
    if (e.target.matches('input, textarea, select')) return;
    if (!current()) {
      if (e.key === 'z' || e.key === 'Z') undo();
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      if (e.target.closest('button, a')) return;
      e.preventDefault();
      flip();
    } else if (e.key === 'ArrowRight' || e.key === '2') answer('good');
    else if (e.key === 'ArrowLeft' || e.key === '1') answer('again');
    else if (e.key === 'z' || e.key === 'Z') undo();
    else if (e.key === 'p' || e.key === 'P') speak(current().word);
  }

  draw();
  const unsub = subscribe(() => { if (!busy) draw(); });
  // 沒有資料變動時，也要讓時間到了的字（例如 10 分鐘前在別台按「不熟」）出現
  const recheck = () => { if (!busy && document.visibilityState !== 'hidden' && syncSession()) draw(); };
  const timer = setInterval(recheck, 30000);
  document.addEventListener('visibilitychange', recheck);
  const unsubLookup = onLookupStatus(() => { if (!busy) draw(); });
  let genKey = '';
  const unsubGen = onGenerateStatus((st) => {
    const k = `${st.running}|${st.done}|${st.failed}`;
    if (k !== genKey) { genKey = k; if (!busy) draw(); }
  });
  document.addEventListener('keydown', onKey);
  return () => {
    detachSwipe?.(); unsub(); unsubLookup(); unsubGen(); clearInterval(timer);
    document.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', recheck);
  };
}

// 導覽列上的待複習數字
export function reviewBadgeCount() {
  syncSession();
  if (session && session.day === dayKey(Date.now()) && session.scope === scopeKey()) return session.queue.filter((id) => getWord(id)).length;
  return buildQueue(scopedWords(), Date.now(), newLimitLeft()).length;
}
