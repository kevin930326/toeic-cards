import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exploreWords, selectedExploreWord, stepExploreWord } from '../../js/explore.js';

const words = [
  { id: 'a', word: 'invoice', zh: '發票', unfamiliar: false, srs: { due: 9999999999999 } },
  { id: 'b', word: 'résumé', zh: '履歷', unfamiliar: true },
  { id: 'c', word: 'budget', zh: '預算', unfamiliar: true, srs: { due: 1 } },
];

test('探索忽略到期與新字限制，保留輸入順序且不改進度', () => {
  const before = structuredClone(words);
  assert.deepEqual(exploreWords(words), words);
  exploreWords(words, { filter: 'unfamiliar', query: '預算' });
  stepExploreWord(words, 'c', 1);
  assert.deepEqual(words, before);
});

test('搜尋支援英文大小寫、中文與 Unicode 組合拼字', () => {
  assert.deepEqual(exploreWords(words, { query: ' INVO ' }).map((w) => w.id), ['a']);
  assert.deepEqual(exploreWords(words, { query: '履歷' }).map((w) => w.id), ['b']);
  assert.deepEqual(exploreWords(words, { query: 'RE\u0301SUME\u0301' }).map((w) => w.id), ['b']);
});

test('搜尋與不熟篩選共同限制結果，空結果不擅自回到全部', () => {
  assert.deepEqual(exploreWords(words, { filter: 'unfamiliar' }).map((w) => w.id), ['b', 'c']);
  assert.deepEqual(exploreWords(words, { filter: 'unfamiliar', query: 'invoice' }), []);
});

test('目前字在範圍內時保留，移出或刪除後選擇第一個有效字', () => {
  assert.equal(selectedExploreWord(words, 'b').id, 'b');
  assert.equal(selectedExploreWord(words.slice(1), 'a').id, 'b');
  assert.equal(selectedExploreWord([], 'a'), null);
});

test('上一字下一字只在目前清單循環，單字數一或零也安全', () => {
  assert.equal(stepExploreWord(words, 'a', -1).id, 'c');
  assert.equal(stepExploreWord(words, 'c', 1).id, 'a');
  const filtered = exploreWords(words, { filter: 'unfamiliar' });
  assert.equal(stepExploreWord(filtered, 'b', 1).id, 'c');
  assert.equal(stepExploreWord([words[0]], 'a', 1).id, 'a');
  assert.equal(stepExploreWord([], 'a', 1), null);
});
