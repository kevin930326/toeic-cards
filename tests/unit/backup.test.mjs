// 匯出／匯入邏輯的單元測試：node --test "tests/unit/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBackup, parseBackup, mergeBackup, sanitizeWord, sanitizeLog, sanitizeMistakes, sanitizeSettings, backupFileName,
} from '../../js/backup.js';
import { mistakeKey } from '../../js/mistakes.js';

const DEFAULTS = { theme: 'system', dailyGoal: 20, accent: 'en-US', autoGenerate: true };

const w = (word, extra = {}) => ({
  id: `id-${word}`, word, phonetic: '', pos: 'v.', zh: `v. ${word}`, en: '', examples: [], collocations: [],
  forms: [], synonyms: [], unfamiliar: false, src: {}, lookup: {}, llm: null, srs: null, part5: [],
  createdAt: 1, updatedAt: 1, ...extra,
});
const mistake = (wordId, prompt = 'p', count = 1) => {
  const question = { mode: 'zh2en', wordId, word: wordId, prompt, options: ['a', 'b', 'c', 'd'], answerIndex: 0 };
  return { key: mistakeKey(question), question, chosen: 1, count, at: 1 };
};
const roundTrip = (data) => parseBackup(JSON.stringify(buildBackup(data)), DEFAULTS);

test('匯出再匯入：資料完整保留', () => {
  const data = {
    words: [w('approve', { srs: { reps: 2, interval: 3, ease: 2.5, lapses: 0, due: 99, last: 9 }, unfamiliar: true,
      examples: [{ en: 'We approve.', zh: '我們核准。' }], src: { zh: 'llm' }, llm: { status: 'done', at: 5 } })],
    settings: { theme: 'dark', dailyGoal: 30, accent: 'mixed', autoGenerate: false },
    log: { '2026-10-14': { reviews: 5, good: 4, again: 1, goal: 20 } },
    mistakes: [mistake('id-approve')],
  };
  const r = roundTrip(data);
  assert.equal(r.ok, true);
  assert.deepEqual(r.backup.words[0], sanitizeWord(data.words[0]));
  assert.equal(r.backup.words[0].srs.interval, 3);
  assert.equal(r.backup.words[0].unfamiliar, true);
  assert.deepEqual(r.backup.settings, data.settings);
  assert.deepEqual(r.backup.log, data.log);
  assert.equal(r.backup.mistakes.length, 1);
});

test('備份不含 Gemini 金鑰，也不會讀進不認得的設定', () => {
  const r = roundTrip({ words: [], settings: { theme: 'dark', geminiKey: 'AIzaSECRET', dailyGoal: '99' }, log: {}, mistakes: [] });
  assert.deepEqual(r.backup.settings, { theme: 'dark' });   // dailyGoal 型別不對也不收
  assert.doesNotMatch(JSON.stringify(buildBackup({ words: [], settings: DEFAULTS, log: {}, mistakes: [] })), /AIza/);
});

test('拒絕不是備份檔的內容', () => {
  assert.match(parseBackup('', DEFAULTS).error, /空的/);
  assert.match(parseBackup('{oops', DEFAULTS).error, /JSON/);
  assert.match(parseBackup('{"hello":1}', DEFAULTS).error, /不是多益字卡/);
  assert.match(parseBackup('[]', DEFAULTS).error, /不是多益字卡/);
  assert.match(parseBackup(JSON.stringify({ app: 'toeic-cards', version: 99, data: {} }), DEFAULTS).error, /較新/);
});

test('清理：壞掉的單字被略過，欄位型別被修正', () => {
  const raw = { app: 'toeic-cards', version: 1, data: { words: [
    w('approve'),
    { word: '   ' },                     // 空白
    { word: '測試' },                     // 不是英文
    'not an object',
    w('Approve', { updatedAt: 5 }),      // 大小寫不同的重複字 → 留比較新的
    { word: 'submit', zh: 123, examples: 'x', srs: { interval: 'abc', ease: 99 }, unfamiliar: 'yes', src: { zh: 'hacker' } },
  ] } };
  const r = parseBackup(JSON.stringify(raw), DEFAULTS);
  assert.equal(r.ok, true);
  assert.deepEqual(r.backup.words.map((x) => x.word).sort(), ['approve', 'submit']);
  assert.equal(r.backup.words.find((x) => x.word === 'approve').updatedAt, 5);
  assert.equal(r.backup.skipped, 4);
  const s = r.backup.words.find((x) => x.word === 'submit');
  assert.equal(s.zh, '');
  assert.deepEqual(s.examples, []);
  assert.equal(s.srs.interval, 0);
  assert.equal(s.srs.ease, 5);              // 限制在 1.3–5
  assert.equal(s.unfamiliar, false);        // 只接受 true
  assert.deepEqual(s.src, {});              // 不認得的來源值丟掉
});

test('清理：學習紀錄只收日期格式的 key 與數字欄位', () => {
  assert.deepEqual(sanitizeLog({ '2026-10-14': { reviews: '5', hack: 1, quiz: -3 }, 'bad-key': { reviews: 1 }, '2026-10-15': 'x' }),
    { '2026-10-14': { reviews: 5, quiz: 0 } });
});

test('清理：錯題的選項必須剛好 4 個、答案位置合理', () => {
  const good = mistake('id-a');
  const bad1 = { ...good, question: { ...good.question, options: ['a', 'b'] } };
  const bad2 = { ...good, question: { ...good.question, answerIndex: 7 } };
  const bad3 = { ...good, question: { ...good.question, mode: 'evil' } };
  assert.equal(sanitizeMistakes([good, bad1, bad2, bad3, null]).length, 1);
});

test('合併：新字加入、比較新的蓋掉、比較舊的保留', () => {
  const local = {
    words: [w('approve', { zh: '本機版', updatedAt: 10 }), w('invoice', { zh: '本機版', updatedAt: 10 })],
    log: {}, mistakes: [],
  };
  const incoming = {
    words: [w('approve', { zh: '備份版', updatedAt: 20 }), w('invoice', { zh: '備份版', updatedAt: 5 }), w('deadline')],
    log: {}, mistakes: [],
  };
  const m = mergeBackup(local, incoming);
  assert.deepEqual(m.summary, { added: 1, updated: 1, kept: 1 });
  const by = Object.fromEntries(m.words.map((x) => [x.word, x]));
  assert.equal(by.approve.zh, '備份版');
  assert.equal(by.approve.id, 'id-approve');   // 保留本機的 id
  assert.equal(by.invoice.zh, '本機版');
  assert.equal(m.words[0].word, 'deadline');   // 新字在最前面
});

test('合併：id 撞到別的字時換一個新的', () => {
  const local = { words: [w('approve', { id: 'same' })], log: {}, mistakes: [] };
  const incoming = { words: [w('submit', { id: 'same' })], log: {}, mistakes: [] };
  const m = mergeBackup(local, incoming);
  const ids = m.words.map((x) => x.id);
  assert.equal(new Set(ids).size, 2);
});

test('合併：同一份備份匯入兩次，結果不變（紀錄不會重複計算）', () => {
  const local = { words: [w('approve')], log: { '2026-10-14': { reviews: 5, quiz: 2 } }, mistakes: [mistake('id-approve')] };
  const backup = { words: [w('approve'), w('submit')], log: { '2026-10-14': { reviews: 3, quiz: 4 }, '2026-10-13': { reviews: 7 } }, mistakes: [mistake('id-approve'), mistake('id-submit')] };
  const once = mergeBackup(local, backup);
  const twice = mergeBackup({ words: once.words, log: once.log, mistakes: once.mistakes }, backup);
  assert.deepEqual(once.log, { '2026-10-14': { reviews: 5, quiz: 4 }, '2026-10-13': { reviews: 7 } });   // 各欄位取較大值
  assert.deepEqual(twice.log, once.log);
  assert.equal(twice.words.length, once.words.length);
  assert.equal(twice.mistakes.length, 2);
  assert.deepEqual(twice.summary, { added: 0, updated: 0, kept: 2 });
});

test('合併：錯題本跟著換成合併後的 id', () => {
  const local = { words: [w('approve', { id: 'local-approve' })], log: {}, mistakes: [] };
  const incoming = { words: [w('approve', { id: 'other-device-id' })], log: {}, mistakes: [mistake('other-device-id'), mistake('missing-word')] };
  const m = mergeBackup(local, incoming);
  assert.equal(m.mistakes.length, 1);                              // 對不到單字的錯題丟掉
  assert.equal(m.mistakes[0].question.wordId, 'local-approve');
  assert.equal(m.mistakes[0].key, mistakeKey(m.mistakes[0].question));
});

test('sanitizeSettings 與檔名', () => {
  assert.deepEqual(sanitizeSettings({ theme: 'light', dailyGoal: 50, extra: 1 }, DEFAULTS), { theme: 'light', dailyGoal: 50 });
  assert.deepEqual(sanitizeSettings(null, DEFAULTS), {});
  assert.equal(backupFileName(new Date(2026, 9, 15, 10).getTime()), 'toeic-cards-backup-2026-10-15.json');
});

test('匯入：id 只接受英數字、- 和 _，夾帶 HTML 的 id 換成安全的 id', () => {
  assert.equal(sanitizeWord(w('approve', { id: 'abc-123_XY' })).id, 'abc-123_XY');
  assert.equal(sanitizeWord(w('approve', { id: '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f' })).id, '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f');
  assert.equal(sanitizeWord(w('approve', { id: 'x"><img src=x onerror="alert(1)">' })).id, 'imp-approve');
  assert.equal(sanitizeWord(w('take over', { id: 'a b' })).id, 'imp-take-over');
  assert.equal(sanitizeWord(w('résumé', { id: 123 })).id, 'imp-r-sum-');
  assert.equal(sanitizeWord(w('approve', { id: 'x'.repeat(81) })).id, 'imp-approve');
  for (const id of ['', '<', '"', "'", 'a&b', 'a/b']) assert.match(sanitizeWord(w('approve', { id })).id, /^[A-Za-z0-9_-]+$/);
});
