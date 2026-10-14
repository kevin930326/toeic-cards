// 學習統計計算的單元測試：node --test "tests/unit/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  streak, longestStreak, goalMet, dailySeries, totals, masteryBuckets, masteryLevel, forecast, niceScale, lastDayKeys,
} from '../../js/stats.js';
import { DAY } from '../../js/srs.js';

// 2026-10-14 15:00（本地時間）
const NOW = new Date(2026, 9, 14, 15, 0).getTime();
const act = { reviews: 3 };   // 目標設 3 時剛好達標
const G = 3;

test('lastDayKeys：最近 N 天（舊 → 新）', () => {
  assert.deepEqual(lastDayKeys(NOW, 3), ['2026-10-12', '2026-10-13', '2026-10-14']);
  // 跨月
  assert.deepEqual(lastDayKeys(new Date(2026, 10, 1, 12).getTime(), 2), ['2026-10-31', '2026-11-01']);
});

test('連續天數：今天有學 → 從今天算', () => {
  const log = { '2026-10-12': act, '2026-10-13': act, '2026-10-14': act, '2026-10-10': act };
  assert.deepEqual(streak(log, NOW, G), { days: 3, todayDone: true });
});

test('連續天數：今天還沒學 → 從昨天算，不會歸零', () => {
  const log = { '2026-10-12': act, '2026-10-13': act };
  assert.deepEqual(streak(log, NOW, G), { days: 2, todayDone: false });
});

test('連續天數：昨天也沒學 → 0', () => {
  assert.deepEqual(streak({ '2026-10-12': act }, NOW, G), { days: 0, todayDone: false });
});

test('打卡：複習＋測驗合計達標才算；只做測驗也可以', () => {
  const log = { '2026-10-14': { quiz: 5 }, '2026-10-13': { reviews: 1, quiz: 1 } };   // 13 日只有 2 題，沒達標
  assert.deepEqual(streak(log, NOW, G), { days: 1, todayDone: true });
});

test('連續天數：半夜 1 點還算前一天', () => {
  const late = new Date(2026, 9, 15, 1, 0).getTime();   // 10/15 01:00 → 算 10/14
  assert.deepEqual(streak({ '2026-10-14': act, '2026-10-13': act }, late, G), { days: 2, todayDone: true });
});

test('最長連續天數（跨月）', () => {
  const log = {
    '2026-09-29': act, '2026-09-30': act, '2026-10-01': act, '2026-10-02': act,   // 4 天
    '2026-10-05': act, '2026-10-06': act,
    '2026-10-08': { reviews: 0 },
  };
  assert.equal(longestStreak(log, G), 4);
  assert.equal(longestStreak({}, G), 0);
});

test('dailySeries 補 0、totals 加總與正確率', () => {
  const log = {
    '2026-10-13': { reviews: 5, good: 4, again: 1, learned: 2, quiz: 10, quizCorrect: 7 },
    '2026-10-14': { reviews: 2, good: 2, again: 0 },
  };
  const s = dailySeries(log, NOW, 3);
  assert.equal(s.length, 3);
  assert.equal(s[0].reviews, 0);
  assert.equal(s[1].label, '10/13');
  assert.equal(s[1].quizWrong, 3);
  const t = totals(s);
  assert.equal(t.reviews, 7);
  assert.equal(t.activeDays, 2);
  assert.equal(t.accuracy, 0.7);
  assert.equal(totals(dailySeries({}, NOW, 7)).accuracy, null);   // 沒有測驗 → null，不是 0%
});

test('熟練度分組的邊界：7 天、21 天', () => {
  const w = (interval) => ({ srs: { interval } });
  assert.equal(masteryLevel({}), 'new');
  assert.equal(masteryLevel(w(0)), 'learning');
  assert.equal(masteryLevel(w(6)), 'learning');
  assert.equal(masteryLevel(w(7)), 'familiar');
  assert.equal(masteryLevel(w(20)), 'familiar');
  assert.equal(masteryLevel(w(21)), 'mastered');
  assert.deepEqual(masteryBuckets([{}, {}, w(1), w(10), w(30)]), { new: 2, learning: 1, familiar: 1, mastered: 1 });
});

test('未來 7 天到期：過期的算今天、超過 7 天的不算、新字不算', () => {
  const start = new Date(2026, 9, 14, 4, 0).getTime();   // 今天早上 4 點
  const words = [
    { srs: { due: NOW - 5 * DAY } },          // 過期 → 今天
    { srs: { due: NOW + 10 * 60 * 1000 } },   // 10 分鐘後 → 今天
    { srs: { due: start + DAY } },            // 明天 4 點 → 明天
    { srs: { due: start + 6 * DAY + 1000 } }, // 第 7 天
    { srs: { due: start + 7 * DAY } },        // 超出範圍
    {},                                       // 新字
  ];
  const f = forecast(words, NOW, 7);
  assert.equal(f.length, 7);
  assert.deepEqual(f.map((d) => d.due), [2, 1, 0, 0, 0, 0, 1]);
  assert.equal(f[0].label, '今天');
  assert.equal(f[1].label, '明天');
  assert.equal(f[2].label, '10/16');
});

test('niceScale：好看的刻度、整數間距', () => {
  assert.deepEqual(niceScale(0), { max: 4, ticks: [0, 1, 2, 3, 4] });
  assert.deepEqual(niceScale(1).ticks, [0, 1]);                // 不會出現 0.5
  assert.deepEqual(niceScale(7), { max: 8, ticks: [0, 2, 4, 6, 8] });
  assert.deepEqual(niceScale(23), { max: 30, ticks: [0, 10, 20, 30] });   // 最多 4 格
  assert.deepEqual(niceScale(130).ticks, [0, 50, 100, 150]);
});

test('打卡：用當天記下的目標，之後改目標不影響過去', () => {
  const log = {
    '2026-10-12': { reviews: 10, goal: 10 },   // 當時目標 10，達標
    '2026-10-13': { reviews: 10, goal: 10 },
    '2026-10-14': { reviews: 10 },              // 舊資料沒有 goal → 用目前的目標
  };
  assert.deepEqual(streak(log, NOW, 30), { days: 2, todayDone: false });   // 現在目標改成 30：今天沒達標，但過去兩天仍算
  assert.deepEqual(streak(log, NOW, 10), { days: 3, todayDone: true });
  assert.equal(goalMet({ reviews: 5, quiz: 5, goal: 10 }, 99), true);
  assert.equal(goalMet({ reviews: 5, quiz: 4, goal: 10 }, 1), false);
  assert.equal(goalMet(undefined, 1), false);
});

test('打卡：今天一律用目前的目標（今天把目標調高，今天就要重新達標）', () => {
  const log = { '2026-10-13': { reviews: 5, goal: 5 }, '2026-10-14': { reviews: 5, goal: 5 } };
  assert.deepEqual(streak(log, NOW, 5), { days: 2, todayDone: true });
  assert.deepEqual(streak(log, NOW, 50), { days: 1, todayDone: false });   // 昨天仍算，今天要達到 50
});
