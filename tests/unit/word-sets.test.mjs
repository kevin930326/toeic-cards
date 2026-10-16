import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSets, mergeSets, setsForWord, filterSetWords, indexMembership } from '../../js/word-sets.js';
import { buildBackup, parseBackup, mergeBackup } from '../../js/backup.js';

const set = (id = 'finance', extra = {}) => ({ id, name: '財務', updatedAt: 10, deleted: false,
  members: { budget: { at: 10, present: true } }, ...extra });
const words = [{ id: 'a', word: 'budget' }, { id: 'b', word: 'agenda' }];

test('單字可屬於多集，全部與未分類保留原卡片', () => {
  const sets = mergeSets([], [set(), set('mock')]);
  assert.equal(setsForWord(sets, 'BUDGET').length, 2);
  assert.deepEqual(filterSetWords(words, sets, 'finance'), [words[0]]);
  assert.deepEqual(filterSetWords(words, sets, 'unfiled'), [words[1]]);
  assert.equal(filterSetWords(words, sets, ''), words);
  assert.equal(filterSetWords(words, sets, 'deleted-id'), words);
});

test('刪除單字集不刪除卡片，未分類不計已刪的集', () => {
  assert.deepEqual(filterSetWords(words, [set('finance', { deleted: true })], 'unfiled'), words);
});

test('不同裝置建立的集與新增的成員都保留', () => {
  const result = mergeSets([set()], [set('other'), set('finance', { members: { agenda: { at: 11, present: true } } })]);
  assert.equal(result.length, 2);
  assert.equal(result[0].members.budget.present, true);
  assert.equal(result[0].members.agenda.present, true);
});

test('移出紀錄不會被較舊裝置加回，再次加入取新的時間', () => {
  const removed = set('finance', { members: { budget: { at: 20, present: false } } });
  assert.equal(mergeSets([removed], [set()])[0].members.budget.present, false);
  const readded = set('finance', { members: { budget: { at: 21, present: true } } });
  assert.equal(mergeSets([removed], [readded])[0].members.budget.present, true);
});

test('改名與成員修改互不覆蓋，刪集紀錄不被舊名稱復活', () => {
  const renamed = set('finance', { name: '會計', updatedAt: 20 });
  const member = set('finance', { members: { agenda: { at: 30, present: true } } });
  const merged = mergeSets([renamed], [member])[0];
  assert.equal(merged.name, '會計');
  assert.equal(merged.members.agenda.present, true);
  assert.equal(mergeSets([set('finance', { updatedAt: 40, deleted: true })], [renamed])[0].deleted, true);
});

test('同時修改的合併順序與重複套用不影響結果，移出優先', () => {
  const a = [set()];
  const b = [set('finance', { name: '預算', members: { budget: { at: 10, present: false } } })];
  assert.deepEqual(mergeSets(a, b), mergeSets(b, a));
  const merged = mergeSets(a, b);
  assert.deepEqual(mergeSets(merged, a), merged);
  assert.equal(merged[0].members.budget.present, false);
});

test('清理備份資料：拒絕錯誤 id、空名稱與不合法成員，限制名稱長度', () => {
  assert.deepEqual(sanitizeSets([null, { ...set(), id: '../evil' }, set('unfiled'), set('empty', { name: ' ' })]), []);
  const cleaned = sanitizeSets([set('ok', { name: 'a'.repeat(70), members: { budget: { present: 'yes' }, agenda: { present: true, at: -1 } } })])[0];
  assert.equal(cleaned.name.length, 60);
  assert.equal(cleaned.members.budget, undefined);
  assert.deepEqual(cleaned.members.agenda, { at: 0, present: true });
});

test('constructor 等單字不受 JavaScript 物件原型影響', () => {
  const one = set('finance', { members: { constructor: { at: 12, present: true } } });
  const merged = mergeSets([set()], [one])[0];
  assert.equal(merged.members.constructor.present, true);
});

test('新版備份保留空單字集、分類與移出紀錄，舊版仍可讀', () => {
  const data = { words, log: {}, settings: {}, mistakes: [], wordSets: [set(), set('empty', { members: {} })] };
  const exported = buildBackup(data);
  assert.equal(exported.version, 3);
  const result = parseBackup(JSON.stringify(exported), {});
  assert.deepEqual(result.backup.wordSets, mergeSets([], data.wordSets));
  const legacy = parseBackup(JSON.stringify({ ...exported, version: 1, data: { ...data, wordSets: undefined } }), {});
  assert.deepEqual(legacy.backup.wordSets, []);
});

test('備份合併保留雙方分類且不重複建立單字集', () => {
  const local = { words, log: {}, mistakes: [], wordSets: [set()] };
  const incoming = { words, log: {}, mistakes: [], wordSets: [set('mock')] };
  const merged = mergeBackup(local, incoming);
  assert.equal(merged.wordSets.length, 2);
  assert.deepEqual(mergeBackup(merged, incoming).wordSets, merged.wordSets);
});

test('分類反向索引排除刪除集、移出紀錄與未收藏字，同字可屬多集', () => {
  const sets = [{ id: 'a', members: { budget: { present: true }, other: { present: true } } },
    { id: 'b', members: { budget: { present: true }, invoice: { present: false } } },
    { id: 'c', deleted: true, members: { invoice: { present: true } } }];
  const result = indexMembership([{ word: 'budget' }, { word: 'invoice' }], sets);
  assert.deepEqual([...result.counts], [['a', 1], ['b', 1]]);
  assert.deepEqual(result.byWord.get('budget').map((s) => s.id), ['a', 'b']);
  assert.equal(result.unfiled, 1);
});
