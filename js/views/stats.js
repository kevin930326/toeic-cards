// 統計頁：連續學習天數、熟練度分布、每日複習／測驗量、未來到期量
// 期間篩選（7／30／90 天）放在最上面，套用到下面所有「期間」相關的數字和圖表
import { getWords, getSettings, updateSettings, subscribe } from '../store.js';
import { esc, goalRingHTML } from '../ui.js';
import { getLog, todayProgress, currentGoal } from '../log.js';
import { columnChart } from '../charts.js';
import {
  streak, longestStreak, dailySeries, totals, masteryBuckets, MASTERY_LEVELS, forecast,
} from '../stats.js';

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
          <div class="kpi">
            <p class="kpi-label">單字總數</p>
            <p class="kpi-value" id="kpiWords">${words.length}</p>
            <p class="kpi-sub">不熟 ${unfamiliar} 個</p>
          </div>
          <div class="kpi">
            <p class="kpi-label">已熟</p>
            <p class="kpi-value" id="kpiMastered">${m.mastered}</p>
            <p class="kpi-sub">佔 ${pct(m.mastered, words.length)}%</p>
          </div>
          <div class="kpi">
            <p class="kpi-label">複習次數（近 ${days} 天）</p>
            <p class="kpi-value" id="kpiReviews">${t.reviews}</p>
            <p class="kpi-sub">新學 ${t.learned} 個・學習 ${t.activeDays} 天</p>
          </div>
          <div class="kpi">
            <p class="kpi-label">測驗正確率（近 ${days} 天）</p>
            <p class="kpi-value" id="kpiAccuracy">${t.accuracy === null ? '—' : `${Math.round(t.accuracy * 100)}<small>%</small>`}</p>
            <p class="kpi-sub">${t.quiz ? `共 ${t.quiz} 題，答對 ${t.quizCorrect} 題` : '這段期間還沒有測驗'}</p>
          </div>
        </div>

        <section class="panel chart-card" aria-labelledby="hMastery">
          <h2 class="panel-title" id="hMastery">熟練度</h2>
          <p class="chart-sub">依複習間隔分組；答「會」越多次，間隔越長</p>
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
