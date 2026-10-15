// 多益短文閱讀的單元測試：node --test "tests/unit/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickReadingWords, buildReadingPrompt, normalizeReading, sanitizeSaved, readingScore, wordPattern, MAX_SAVED,
} from '../../js/reading.js';
import { mulberry32 } from '../../js/quiz.js';

const para = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const q = (answer = 1) => ({ question: 'What is the purpose of the email?', options: ['A', 'B', 'C', 'D'], answer, explanation: '第一段寫到。' });
const raw = {
  title: 'Office Move',
  paragraphs: [`We will relocate our office next month. ${para(40)}`, `Please approve the budget by Friday. ${para(30)}`],
  translation: ['我們下個月搬辦公室。', '請在星期五前核准預算。'],
  targets: ['relocate', 'approve'],
  questions: [q(0), q(1), q(2)],
};

test('挑字：不熟的優先，其次是學習中的字，最多 n 個', () => {
  const words = [
    { word: 'new1' }, { word: 'learn1', srs: { interval: 3 } }, { word: 'weak1', unfamiliar: true },
    { word: 'new2' }, { word: 'weak2', unfamiliar: true }, { word: '' },
  ];
  const picked = pickReadingWords(words, 3, mulberry32(1));
  assert.deepEqual(picked.slice(0, 2).sort(), ['weak1', 'weak2']);
  assert.equal(picked[2], 'learn1');
  assert.equal(pickReadingWords(words, 10).length, 5);   // 空白的字不算
});

test('AI 提示：列出目標字和文章類型，要求繁體中文翻譯與 Part 7 題型', () => {
  const p = buildReadingPrompt(['relocate', 'approve'], 'email');
  assert.match(p, /ONE business email/);   // 類型代碼換成英文說法
  assert.match(p, /relocate, approve/);
  assert.match(p, /繁體中文/);
});

test('變化形也算出現在短文裡', () => {
  assert.ok(wordPattern('approve').test('The budget was approved.'));
  assert.ok(wordPattern('take over').test('She will take over the team.'));
  assert.ok(!wordPattern('approve').test('We disapprove.'));
});

test('檢查短文：合格的整理好，只保留真的出現在文章裡的目標字', () => {
  const r = normalizeReading({ ...raw, type: 'email' }, ['relocate', 'approve', 'merger']);
  assert.equal(r.type, 'email');
  assert.equal(r.paragraphs.length, 2);
  assert.deepEqual(r.targets, ['relocate', 'approve']);
  assert.equal(r.questions.length, 3);
  assert.equal(normalizeReading({ ...raw, type: 'poem' }).type, 'article');   // 不認得的類型
});

test('檢查短文：太短、題目不夠、選項重複、答案超出範圍都不收', () => {
  assert.equal(normalizeReading({ ...raw, paragraphs: ['Too short.'] }), null);
  assert.equal(normalizeReading({ ...raw, questions: [q(), q()] }), null);
  assert.equal(normalizeReading({ ...raw, questions: [q(), q(), { ...q(), options: ['A', 'A', 'C', 'D'] }] }), null);
  assert.equal(normalizeReading({ ...raw, questions: [q(), q(), q(4)] }), null);
  assert.equal(normalizeReading(null), null);
});

test('存的短文：重新檢查，作答紀錄只留 0–3，id 格式不對的丟掉，最多保留上限篇', () => {
  const saved = sanitizeSaved([
    { ...raw, id: 'r1', answers: [0, 9, 'x'], at: 5 },
    { ...raw, id: 'bad id"><img>', answers: [], at: 1 },
    { title: 'broken' },
  ]);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].answers, [0, null, null]);
  assert.equal(sanitizeSaved(Array.from({ length: 30 }, (_, i) => ({ ...raw, id: `r${i}` }))).length, MAX_SAVED);
  assert.deepEqual(sanitizeSaved('nope'), []);
});

test('計分：只算已作答的，全部作答才算完成', () => {
  const r = sanitizeSaved([{ ...raw, id: 'r1', answers: [0, 2, null] }])[0];
  assert.deepEqual(readingScore(r), { answered: 2, correct: 1, total: 3, done: false });
});
