import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prefixMatches, mergeSuggestions, createSuggestionLookup } from '../../js/dictionary-suggestions.js';

test('只匹配開頭、精確拼字優先、依預先排序限制八個候選', () => {
  assert.deepEqual(prefixMatches(['action', 'actually', 'act', 'react', 'active'], 'act', 3), ['act', 'action', 'actually']);
  assert.deepEqual(prefixMatches(['react'], 'act'), []);
});

test('最多三個收藏優先，字典候選去重並標記既有字卡', () => {
  const result = mergeSuggestions('ac', ['action', 'act', 'account', 'accept', 'actual', 'active', 'across', 'acquire'], ['ACT', 'action', 'acre', 'acme']);
  assert.equal(result.length, 8);
  assert.deepEqual(result.slice(0, 3), [{ word: 'act', owned: true }, { word: 'action', owned: true }, { word: 'acre', owned: true }]);
  assert.ok(result.some((item) => item.word === 'account' && !item.owned));
});

test('前綴路由只取需要的葉片，並行請求合併且同片繼續輸入不重抓', async () => {
  const calls = [];
  const lookup = createSuggestionLookup(async (path) => {
    calls.push(path);
    return path === 'index.json' ? { branches: { a: ['apple', 'act'] }, leaves: { ac: '6163.json' } } : ['action', 'act', 'account'];
  });
  assert.ok((await lookup('a')).words.some((item) => item.word === 'apple'));
  const [a, b] = await Promise.all([lookup('ac'), lookup('act')]);
  assert.ok(a.words.some((item) => item.word === 'act'));
  assert.equal(b.words[0].word, 'act');
  assert.deepEqual(calls, ['index.json', '6163.json']);
});

test('離線保留收藏候選，索引失敗可重試，空白與無效輸入不抓檔', async () => {
  let calls = 0;
  const lookup = createSuggestionLookup(async () => { calls++; return calls === 1 ? null : { branches: { z: ['zero'] }, leaves: {} }; });
  assert.equal((await lookup('')).status, 'invalid');
  assert.equal((await lookup('<img>')).status, 'invalid');
  assert.equal(calls, 0);
  const offline = await lookup('z', ['zzmine']);
  assert.equal(offline.status, 'unavailable');
  assert.deepEqual(offline.words, [{ word: 'zzmine', owned: true }]);
  assert.ok((await lookup('z')).words.some((item) => item.word === 'zero'));
  assert.equal(calls, 2);
});

test('constructor 不讀取物件原型；重音字仍可用專案補充與收藏候選', async () => {
  const lookup = createSuggestionLookup(async () => ({ branches: {}, leaves: {} }));
  assert.deepEqual((await lookup('constructor')).words, []);
  assert.ok((await lookup('RÉ', ['résumé'])).words.some((item) => item.word === 'résumé' && item.owned));
});

test('候選索引涵蓋字典筆數、前綴一致、每片不超過32KiB、單字母示例存在', () => {
  const directory = new URL('../../data/dict/suggestions-v1/', import.meta.url);
  const index = JSON.parse(fs.readFileSync(new URL('index.json', directory)));
  const words = new Set();
  for (const [prefix, candidates] of Object.entries(index.branches)) {
    assert.ok(candidates.length <= 8);
    for (const word of candidates) { assert.ok(word.startsWith(prefix)); words.add(word); }
  }
  for (const [prefix, filename] of Object.entries(index.leaves)) {
    assert.equal(filename, Buffer.from(prefix).toString('hex') + '.json');
    const bytes = fs.readFileSync(new URL(filename, directory));
    assert.ok(bytes.length <= 32768);
    for (const word of JSON.parse(bytes)) { assert.ok(word.startsWith(prefix)); words.add(word); }
  }
  assert.equal(words.size, index.words);
  assert.ok(index.branches.a.includes('apple'));
});
