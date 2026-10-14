// 跨裝置同步合併規則的單元測試：node --test "tests/unit/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wordDocId, applyRemoteWords, pendingChanges, combineLogs, pickSyncedSettings, remapMistakes, newerSide,
  toRemoteWord, toRemoteTombstone, SYNCED_SETTINGS,
} from '../../js/sync-core.js';
import { mistakeKey } from '../../js/mistakes.js';

const w = (word, updatedAt, extra = {}) => ({
  id: `id-${word}`, word, phonetic: '', pos: '', zh: `${word}@${updatedAt}`, en: '', examples: [], collocations: [],
  forms: [], synonyms: [], unfamiliar: false, src: {}, lookup: {}, llm: null, srs: null, part5: [],
  createdAt: 1, updatedAt, ...extra,
});

test('文件 id：片語、撇號、點都安全', () => {
  assert.equal(wordDocId('Take Over'), 'take%20over');
  assert.equal(wordDocId("o'clock"), "o'clock");
  assert.equal(wordDocId('e.g'), 'e%2Eg');
  assert.ok(!wordDocId('a/b').includes('/'));
});

test('拉下來：新字加入、比較新的蓋掉、比較舊的保留', () => {
  const local = [w('approve', 10), w('invoice', 10)];
  const remote = [toRemoteWord(w('approve', 20)), toRemoteWord(w('invoice', 5)), toRemoteWord(w('deadline', 7))];
  const r = applyRemoteWords(local, {}, remote);
  const by = Object.fromEntries(r.words.map((x) => [x.word, x]));
  assert.deepEqual(r.summary, { added: 1, updated: 1, deleted: 0 });
  assert.equal(by.approve.zh, 'approve@20');
  assert.equal(by.approve.id, 'id-approve');
  assert.equal(by.invoice.zh, 'invoice@10');
  assert.equal(r.words[0].word, 'deadline');
});

test('拉下來：別的裝置刪掉 → 本機比較舊就跟著刪，本機之後又改過就保留', () => {
  const local = [w('approve', 10), w('invoice', 30)];
  const remote = [toRemoteTombstone('approve', 20), toRemoteTombstone('invoice', 20)];
  const r = applyRemoteWords(local, {}, remote);
  assert.deepEqual(r.words.map((x) => x.word), ['invoice']);
  assert.equal(r.summary.deleted, 1);
  assert.equal(r.tombstones.approve, 20);
});

test('拉下來：本機在之後刪掉的字不會被加回來；更晚的修改會把它救回來', () => {
  const r1 = applyRemoteWords([], { approve: 50 }, [toRemoteWord(w('approve', 40))]);
  assert.equal(r1.words.length, 0);
  const r2 = applyRemoteWords([], { approve: 50 }, [toRemoteWord(w('approve', 60))]);
  assert.equal(r2.words.length, 1);
  assert.equal(r2.tombstones.approve, undefined);
});

test('拉下來：id 撞到其他字時換新的；壞掉的資料略過', () => {
  const local = [w('approve', 1, { id: 'same' })];
  const r = applyRemoteWords(local, {}, [toRemoteWord(w('submit', 2, { id: 'same' })), { word: 'x', data: null }, null]);
  assert.equal(new Set(r.words.map((x) => x.id)).size, 2);
  assert.equal(r.words.length, 2);
});

test('同一份雲端資料套用兩次，結果不變', () => {
  const remote = [toRemoteWord(w('approve', 20)), toRemoteTombstone('invoice', 15)];
  const once = applyRemoteWords([w('invoice', 10)], {}, remote);
  const twice = applyRemoteWords(once.words, once.tombstones, remote);
  assert.deepEqual(twice.words, once.words);
  assert.deepEqual(twice.summary, { added: 0, updated: 0, deleted: 0 });
});

test('要上傳的：只傳比上次上傳新的字和刪除紀錄', () => {
  const words = [w('approve', 10), w('invoice', 20), w('deadline', 5)];
  const pushed = { approve: 10, invoice: 15 };
  const out = pendingChanges(words, { submit: 30, old: 3 }, { ...pushed, old: 3 });
  assert.deepEqual(out.map((x) => [x.word, x.deleted]), [['invoice', false], ['deadline', false], ['submit', true]]);
});

test('每日紀錄：各裝置相加，目標取較大值', () => {
  const phone = { '2026-10-15': { reviews: 10, good: 8, again: 2, quiz: 0, goal: 20 } };
  const pc = { '2026-10-15': { reviews: 10, good: 10, quiz: 5, quizCorrect: 4, goal: 30 }, '2026-10-14': { reviews: 3 } };
  const c = combineLogs(phone, [pc]);
  assert.deepEqual(c['2026-10-15'], { reviews: 20, again: 2, good: 18, quiz: 5, quizCorrect: 4, goal: 30 });
  assert.deepEqual(c['2026-10-14'], { reviews: 3 });
  assert.deepEqual(combineLogs({}, []), {});
  assert.deepEqual(combineLogs(phone, [null, 'bad']), phone);
});

test('只同步學習相關的設定（外觀、口音、模型留在各自的裝置）', () => {
  const s = pickSyncedSettings({ dailyGoal: 30, newPerDay: 10, theme: 'dark', accent: 'en-GB', llmModel: 'x', statsDays: 7 });
  assert.deepEqual(s, { dailyGoal: 30, newPerDay: 10 });
  assert.ok(!SYNCED_SETTINGS.includes('theme') && !SYNCED_SETTINGS.includes('accent'));
});

test('錯題本：換成本機的 id，對不到的單字丟掉', () => {
  const q = (word, wordId) => ({ mode: 'zh2en', wordId, word, prompt: 'p', options: ['a', 'b', 'c', 'd'], answerIndex: 0 });
  const list = [{ key: 'old', question: q('approve', 'phone-id'), chosen: 1, count: 2, at: 1 }, { key: 'k', question: q('gone', 'x'), chosen: 1, count: 1, at: 1 }];
  const out = remapMistakes(list, [w('approve', 1, { id: 'pc-id' })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].question.wordId, 'pc-id');
  assert.equal(out[0].key, mistakeKey(out[0].question));
});

test('整份資料比較新的勝出', () => {
  assert.equal(newerSide(10, { updatedAt: 20 }), 'pull');
  assert.equal(newerSide(30, { updatedAt: 20 }), 'push');
  assert.equal(newerSide(20, { updatedAt: 20 }), 'none');
  assert.equal(newerSide(5, null), 'push');
  assert.equal(newerSide(0, null), 'none');
});
