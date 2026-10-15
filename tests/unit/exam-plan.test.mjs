// 考試倒數＋讀書計畫的單元測試：node --test "tests/unit/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidExamDate, daysUntilExam, examPlan, REVIEW_WEEK } from '../../js/exam-plan.js';

// 2026-10-16 中午（本機時間）
const NOON = new Date(2026, 9, 16, 12, 0).getTime();
const words = (fresh, learned = 0) => [
  ...Array.from({ length: fresh }, (_, i) => ({ word: `n${i}`, srs: null })),
  ...Array.from({ length: learned }, (_, i) => ({ word: `l${i}`, srs: { interval: 3 } })),
];

test('考試日期格式：只接受真的日期', () => {
  assert.ok(isValidExamDate('2026-12-13'));
  assert.ok(!isValidExamDate('2026-02-30'));
  assert.ok(!isValidExamDate('2026/12/13'));
  assert.ok(!isValidExamDate(''));
  assert.ok(!isValidExamDate(null));
});

test('倒數天數：考試當天是 0、過了是負數；早上 4 點前還算前一天', () => {
  assert.equal(daysUntilExam('2026-10-26', NOON), 10);
  assert.equal(daysUntilExam('2026-10-16', NOON), 0);
  assert.equal(daysUntilExam('2026-10-15', NOON), -1);
  assert.equal(daysUntilExam('2026-10-17', new Date(2026, 9, 17, 2, 0).getTime()), 1);   // 半夜 2 點還是 16 日
  assert.equal(daysUntilExam('bad', NOON), null);
});

test('計畫：離考試超過 14 天，新字在考前一週學完', () => {
  const p = examPlan({ examDate: '2026-11-15', words: words(460, 40), newPerDay: 20, now: NOON });   // 30 天
  assert.equal(p.status, 'ok');
  assert.equal(p.days, 30);
  assert.equal(p.newLeft, 460);
  assert.equal(p.learnDays, 30 - REVIEW_WEEK);
  assert.equal(p.suggested, 20);   // 460 ÷ 23
  assert.equal(p.onTrack, true);
  assert.equal(p.daysAtCurrent, 23);
});

test('計畫：14 天以內每天都學新字；速度不夠時 onTrack 是 false', () => {
  const p = examPlan({ examDate: '2026-10-26', words: words(150), newPerDay: 10, now: NOON });   // 10 天
  assert.equal(p.learnDays, 10);
  assert.equal(p.reviewWeek, false);
  assert.equal(p.suggested, 15);
  assert.equal(p.onTrack, false);
});

test('計畫：考試當天、已經過了、新字都學完、沒有設定', () => {
  assert.equal(examPlan({ examDate: '2026-10-16', words: words(5), now: NOON }).status, 'today');
  assert.equal(examPlan({ examDate: '2026-10-01', words: words(5), now: NOON }).status, 'past');
  assert.equal(examPlan({ examDate: '2026-11-15', words: words(0, 9), now: NOON }).status, 'allLearned');
  assert.equal(examPlan({ examDate: '', words: words(5), now: NOON }), null);
});

test('計畫：建議值有上限，不會建議不可能的數字', () => {
  const p = examPlan({ examDate: '2026-10-17', words: words(1000), now: NOON });   // 明天考 1000 字
  assert.equal(p.suggested, 200);
});
