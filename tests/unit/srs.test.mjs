// 間隔重複演算法的單元測試：node --test tests/unit/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  grade, buildQueue, countToday, dayStart, dayKey, previewIntervals, formatInterval,
  DAY, MINUTE, LEARNING_STEP, DEFAULT_EASE, MIN_EASE,
} from '../../js/srs.js';

// 2026-10-14 15:00（本地時間）
const NOW = new Date(2026, 9, 14, 15, 0, 0).getTime();

test('一天從早上 4 點開始算', () => {
  assert.equal(dayKey(new Date(2026, 9, 14, 15, 0).getTime()), '2026-10-14');
  assert.equal(dayKey(new Date(2026, 9, 15, 1, 30).getTime()), '2026-10-14');  // 半夜 1 點還算前一天
  assert.equal(dayKey(new Date(2026, 9, 15, 4, 0).getTime()), '2026-10-15');
  assert.equal(new Date(dayStart(NOW)).getHours(), 4);
});

test('新字答「會」：1 天 → 3 天 → ×ease', () => {
  let s = grade(null, 'good', NOW);
  assert.equal(s.reps, 1);
  assert.equal(s.interval, 1);
  assert.equal(s.due, dayStart(NOW) + DAY);   // 明天早上 4 點就到期
  s = grade(s, 'good', NOW + DAY);
  assert.equal(s.interval, 3);
  s = grade(s, 'good', NOW + 4 * DAY);
  assert.equal(s.interval, Math.round(3 * DEFAULT_EASE));   // 8 天
  s = grade(s, 'good', NOW + 12 * DAY);
  assert.equal(s.interval, Math.round(8 * DEFAULT_EASE));   // 20 天
  assert.equal(s.ease, DEFAULT_EASE);
});

test('答「不熟」：10 分鐘後到期、連續次數歸零、ease 下降', () => {
  const learned = { reps: 3, interval: 8, ease: 2.5, lapses: 0, due: NOW };
  const s = grade(learned, 'again', NOW);
  assert.equal(s.due, NOW + LEARNING_STEP);
  assert.equal(s.reps, 0);
  assert.equal(s.interval, 0);
  assert.equal(s.ease, 2.3);
  assert.equal(s.lapses, 1);
  // 忘記後再答會，從 1 天重新開始
  assert.equal(grade(s, 'good', NOW + 11 * MINUTE).interval, 1);
});

test('新字第一次就答「不熟」不算遺忘', () => {
  assert.equal(grade(null, 'again', NOW).lapses, 0);
});

test('ease 不會低於 1.3', () => {
  let s = null;
  for (let i = 0; i < 20; i++) s = grade(s, 'again', NOW);
  assert.equal(s.ease, MIN_EASE);
});

test('間隔至少比上次多 1 天（ease 很低時也會前進）', () => {
  const s = grade({ reps: 5, interval: 2, ease: 1.3, lapses: 3 }, 'good', NOW);
  assert.equal(s.interval, 3);
});

test('不接受未知的評分', () => {
  assert.throws(() => grade(null, 'easy', NOW));
});

test('不會改到原本的物件', () => {
  const orig = { reps: 1, interval: 1, ease: 2.5, lapses: 0, due: NOW };
  const copy = { ...orig };
  grade(orig, 'good', NOW);
  assert.deepEqual(orig, copy);
});

const word = (id, srs, createdAt = 0) => ({ id, srs, createdAt });

test('複習清單：到期的舊字優先（越早到期越前面），再補新字（越早加入越前面），新字有上限', () => {
  const words = [
    word('new-late', null, 300),
    word('due-2', { due: NOW - 1000 }),
    word('future', { due: NOW + DAY }),
    word('new-early', null, 100),
    word('due-1', { due: NOW - 5000 }),
    word('new-mid', null, 200),
  ];
  assert.deepEqual(buildQueue(words, NOW, 2), ['due-1', 'due-2', 'new-early', 'new-mid']);
  assert.deepEqual(buildQueue(words, NOW, 0), ['due-1', 'due-2']);
  assert.deepEqual(buildQueue(words, NOW, -5), ['due-1', 'due-2']);
  assert.deepEqual(countToday(words, NOW, 2), { due: 2, fresh: 2, total: 4 });
});

test('按鈕上的間隔預覽與格式', () => {
  const p = previewIntervals(null, NOW);
  assert.equal(formatInterval(p.again), '10 分鐘');
  assert.equal(formatInterval(p.good), '1 天');
  assert.equal(formatInterval(3 * 60 * MINUTE), '3 小時');
  assert.equal(formatInterval(45 * DAY), '2 個月');
  assert.equal(formatInterval(400 * DAY), '1.1 年');
});
