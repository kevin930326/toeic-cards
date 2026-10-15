// 統計頁：連續學習天數、熟練度分布、每日複習／測驗量、未來到期量
// 期間篩選（7／30／90 天）放在最上面，套用到下面所有「期間」相關的數字和圖表
import { getWords, getSettings, updateSettings, subscribe, scopedWords, activeSetId, getWordSets } from '../store.js';
import { esc, goalRingHTML } from '../ui.js';
import { getLog, todayProgress, currentGoal } from '../log.js';
import { columnChart } from '../charts.js';
import {
  streak, longestStreak, dailySeries, totals, masteryBuckets, MASTERY_LEVELS, FAMILIAR_DAYS, forecast,
} from '../stats.js?v=stats-progress-1';
import { MASTERED_DAYS } from '../srs.js';
import { examPlan } from '../exam-plan.js';

// 目前單字集的名稱（考試計畫依這個範圍計算，和今日複習一樣）
function scopeName() {
  const id = activeSetId();
  if (!id) return '全部單字';
  if (id === 'unfiled') return '未分類';
  return getWordSets().find((s) => s.id === id)?.name || '全部單字';
}

const fmtExam = (d) => d.replaceAll('-', '/');

// 考試倒數卡片
function examCardHTML(s) {
  const plan = examPlan({ examDate: s.examDate, words: scopedWords(), newPerDay: s.newPerDay });
  if (!plan) {
    return `<a class="panel exam-card exam-empty" href="#/settings">設定多益考試日期，看倒數天數和每天建議的新字數 ›</a>`;
  }
  if (plan.status === 'past') {
    return `<div class="panel exam-card"><p>考試日期（${fmtExam(s.examDate)}）已經過了。<a href="#/settings">設定下一次的考試日期</a></p></div>`;
  }
  if (plan.status === 'today') {
    return `<div class="panel exam-card"><p class="exam-days"><strong>今天</strong>就是考試日，加油！</p></div>`;
  }
  const head = `<p class="exam-days">距離多益還有 <strong id="examDays">${plan.days}</strong> 天<span class="exam-date">${fmtExam(s.examDate)}</span></p>`;
  if (plan.status === 'allLearned') {
    return `<div class="panel exam-card">${head}<p>「${esc(scopeName())}」的字都學過了，接下來專心複習 👍</p></div>`;
  }
  return `<div class="panel exam-card" id="examCard">
    ${head}
    <p>「${esc(scopeName())}」還有 <strong>${plan.newLeft}</strong> 個新字沒學。</p>
    <p>建議每天學 <strong id="examSuggested">${plan.suggested}</strong> 個新字${plan.reviewWeek ? '，考前一週學完，最後一週專心複習' : '，考前學完'}。</p>
    <p class="${plan.onTrack ? 'exam-ok' : 'exam-behind'}">${plan.onTrack
      ? `目前設定每天 ${plan.current} 個，跟得上進度 ✓`
      : `目前設定每天 ${plan.current} 個，照這個速度要 ${plan.daysAtCurrent} 天才學完。`}</p>
    ${plan.onTrack ? '' : `<button class="btn btn-primary btn-sm" type="button" id="applyPlan" data-n="${plan.suggested}">改成每天 ${plan.suggested} 個新字</button>`}
  </div>`;
}

const PERIODS = [7, 30, 90];

const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

export function renderStats(root) {
  let cleanups = [];

  function draw() {
    cleanups.forEach((fn) => fn());
    cleanups = [];
    const now = Date.now();
    const words = getWords();
    const log = getLog();
    const days = PERIODS.includes(Number(getSettings().statsDays)) ? Number(getSettings().statsDays) : 30;
    const series = dailySeries(log, now, days);
    const t = totals(series);
    const goal = currentGoal();
    const today = todayProgress(now);
    const st = streak(log, now, goal);
    const best = Math.max(longestStreak(log, goal), st.days);
    const m = masteryBuckets(words);
    const unfamiliar = words.filter((w) => w.unfamiliar).length;

    if (!words.length && !Object.keys(log).length) {
      root.innerHTML = `<section class="page"><h1 class="page-title">統計</h1>
        <div class="empty-state"><p class="empty-title">還沒有學習紀錄</p>
        <p>新增單字、開始複習或測驗後，這裡會顯示你的進度。</p>
        <a class="btn btn-primary" href="#/words">新增單字</a></div></section>`;
      return;
    }

    const streakSub = st.todayDone
      ? '今日目標已達成，打卡成功 ✓'
      : `今天還差 ${today.goal - today.done} 題就能打卡`;

    root.innerHTML = `
      <section class="page page-stats">
        <h1 class="page-title">統計</h1>
        ${examCardHTML(getSettings())}
        <div class="filter-row">
          <span class="setting-label">期間</span>
          <div class="segmented" role="radiogroup" aria-label="統計期間">
            ${PERIODS.map((d) => `<label class="seg"><input type="radio" name="period" value="${d}" ${d === days ? 'checked' : ''}><span>近 ${d} 天</span></label>`).join('')}
          </div>
        </div>

        <div class="kpi-row">
          <div class="kpi kpi-hero">
            <p class="kpi-label">連續打卡</p>
            <p class="kpi-value"><span id="streakDays">${st.days}</span><small>天</small></p>
            <div class="kpi-sub hero-sub">
              <p class="goal-line">${goalRingHTML(today.done, today.goal, 28)}
                <span>今日 <strong id="goalDone">${today.done}</strong> / ${today.goal} 題</span></p>
              <p>${esc(streakSub)}・最長 ${best} 天</p>
            </div>
          </div>
          <div class="kpi kpi-total">
            <p class="kpi-label">單字總數</p>
            <p class="kpi-value" id="kpiWords">${words.length}</p>
            <p class="kpi-sub">不熟 ${unfamiliar} 個</p>
          </div>
          <div class="kpi">
            <p class="kpi-label">學習中</p>
            <p class="kpi-value" id="kpiLearning">${m.learning}</p>
            <p class="kpi-sub">已開始複習・間隔少於 ${FAMILIAR_DAYS} 天</p>
          </div>
          <div class="kpi">
            <p class="kpi-label">長期熟記</p>
            <p class="kpi-value" id="kpiMastered">${m.mastered}</p>
            <p class="kpi-sub">複習間隔 ≥ ${MASTERED_DAYS} 天・佔 ${pct(m.mastered, words.length)}%</p>
          </div>
          <div class="kpi kpi-period">
            <p class="kpi-label">複習次數（近 ${days} 天）</p>
            <p class="kpi-value" id="kpiReviews">${t.reviews}</p>
            <p class="kpi-sub">新學 ${t.learned} 個・學習 ${t.activeDays} 天</p>
          </div>
          <div class="kpi kpi-period">
            <p class="kpi-label">測驗正確率（近 ${days} 天）</p>
            <p class="kpi-value" id="kpiAccuracy">${t.accuracy === null ? '—' : `${Math.round(t.accuracy * 100)}<small>%</small>`}</p>
            <p class="kpi-sub">${t.quiz ? `共 ${t.quiz} 題，答對 ${t.quizCorrect} 題` : '這段期間還沒有測驗'}</p>
          </div>
        </div>

        <section class="panel chart-card" aria-labelledby="hMastery">
          <h2 class="panel-title" id="hMastery">熟練度</h2>
          <p class="chart-sub">依目前複習間隔分組，不受上方期間影響。按一次「會」不代表長期熟記；隨複習累積，間隔會逐步拉長。</p>
          ${words.length ? `
            <div class="mastery-bar" role="img" aria-label="${MASTERY_LEVELS.map((l) => `${l.label} ${m[l.key]} 個`).join('，')}">
              ${MASTERY_LEVELS.filter((l) => m[l.key]).map((l) => `<span class="mastery-seg lvl-${l.key}" style="flex-grow:${m[l.key]}"></span>`).join('')}
            </div>
            <ul class="mastery-legend">
              ${MASTERY_LEVELS.map((l) => `
                <li data-level="${l.key}"><span class="legend-swatch lvl-${l.key}"></span>
                  <span class="ml-name">${l.label}</span>
                  <strong class="ml-count">${m[l.key]}</strong>
                  <span class="ml-pct">${pct(m[l.key], words.length)}%</span>
                  <span class="ml-desc">${l.desc}</span></li>`).join('')}
            </ul>` : '<p class="muted">還沒有單字。</p>'}
        </section>

        <section class="panel chart-card" aria-labelledby="hReviews">
          <h2 class="panel-title" id="hReviews">每日複習</h2>
          <p class="chart-sub">近 ${days} 天共 ${t.reviews} 次・會 ${t.good}・不熟 ${t.again}</p>
          <div id="chartReviews"></div>
        </section>

        <section class="panel chart-card" aria-labelledby="hQuiz">
          <h2 class="panel-title" id="hQuiz">每日測驗</h2>
          <p class="chart-sub">近 ${days} 天共 ${t.quiz} 題・答對 ${t.quizCorrect}・答錯 ${t.quiz - t.quizCorrect}</p>
          <div id="chartQuiz"></div>
        </section>

        <section class="panel chart-card" aria-labelledby="hForecast">
          <h2 class="panel-title" id="hForecast">未來 7 天要複習的字</h2>
          <p class="chart-sub">已經過期的字算在今天</p>
          <div id="chartForecast"></div>
        </section>
      </section>`;

    root.querySelectorAll('input[name="period"]').forEach((i) =>
      i.addEventListener('change', () => updateSettings({ statsDays: Number(i.value) })));
    root.querySelector('#applyPlan')?.addEventListener('click', (e) => updateSettings({ newPerDay: Number(e.currentTarget.dataset.n) }));

    const rows = (keys) => series.map((d) => ({
      label: d.label,
      title: d.key,
      values: Object.fromEntries(keys.map((k) => [k, d[k]])),
    }));
    cleanups.push(columnChart(root.querySelector('#chartReviews'), {
      ariaLabel: `近 ${days} 天每日複習次數`,
      series: [
        { key: 'good', name: '會', color: 'var(--series-1)' },
        { key: 'again', name: '不熟', color: 'var(--series-2)' },
      ],
      rows: rows(['good', 'again']),
      unit: ' 次',
    }));
    cleanups.push(columnChart(root.querySelector('#chartQuiz'), {
      ariaLabel: `近 ${days} 天每日測驗題數`,
      series: [
        { key: 'quizCorrect', name: '答對', color: 'var(--series-1)' },
        { key: 'quizWrong', name: '答錯', color: 'var(--series-2)' },
      ],
      rows: rows(['quizCorrect', 'quizWrong']),
      unit: ' 題',
    }));
    const fc = forecast(words, now, 7);
    cleanups.push(columnChart(root.querySelector('#chartForecast'), {
      ariaLabel: '未來 7 天每天到期的字數',
      series: [{ key: 'due', name: '到期', color: 'var(--series-1)' }],
      rows: fc.map((d) => ({ label: d.label, title: d.key, values: { due: d.due } })),
      labelMode: 'all',
      unit: ' 個',
    }));
  }

  draw();
  const unsub = subscribe(draw);
  return () => { unsub(); cleanups.forEach((fn) => fn()); };
}
