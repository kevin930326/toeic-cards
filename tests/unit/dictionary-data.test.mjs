import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dictionaryShard, createJsonCache } from '../../js/dictionary-data.js';

test('分片資料的每個字都符合前端雜湊與非空中文，總數吻合中繼資料', () => {
  const directory = new URL('../../data/dict/extended-v1/', import.meta.url);
  const meta = JSON.parse(fs.readFileSync(new URL('meta.json', directory)));
  let count = 0;
  for (let i = 0; i < meta.shards; i++) {
    const key = i.toString(16).padStart(3, '0');
    const chunk = JSON.parse(fs.readFileSync(new URL(key + '.json', directory)));
    for (const [word, entry] of Object.entries(chunk)) {
      assert.equal(dictionaryShard(word), key);
      assert.ok(entry.t.trim()); count++;
    }
  }
  assert.equal(count, meta.words);
  assert.ok(meta.max_shard_bytes < 64 * 1024);
});

test('來源明確的 discussed 詞形保留精確字條與原形；不建立錯字', () => {
  const read = (word) => JSON.parse(fs.readFileSync(new URL(`../../data/dict/extended-v1/${dictionaryShard(word)}.json`, import.meta.url)))[word];
  assert.equal(read('discussed').l, 'discuss');
  assert.ok(read('discussed').f.includes('d'));
  assert.match(read('discussed').t, /討論/);
  assert.equal(read('went').l, 'go');
  assert.equal(read('disscussed'), undefined);
});

test('LRU 合併同檔請求，命中更新順序；超額才淘汰最久沒用的分片', async () => {
  const calls = [];
  const read = createJsonCache(async (key) => { calls.push(key); return { key }; }, 2);
  const [a, b] = await Promise.all([read('a'), read('a')]);
  assert.equal(a, b);
  await read('b'); await read('a'); await read('c'); await read('b');
  assert.deepEqual(calls, ['a', 'b', 'c', 'b']);
});

test('HTTP／解析／離線失敗不當成空字典永久快取', async () => {
  let calls = 0;
  const read = createJsonCache(async () => { calls++; if (calls === 1) throw Error('offline'); if (calls === 2) return null; return {}; });
  assert.equal(await read('a'), null); assert.equal(await read('a'), null);
  assert.deepEqual(await read('a'), {}); await read('a'); assert.equal(calls, 3);
});
