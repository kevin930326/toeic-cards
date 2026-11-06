import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hasChinese, normalizeChinese, reverseShard, matchKind, rankReverse, ownedMatches, createReverseLookup } from '../../js/dictionary-reverse.js';

test('辨認中文輸入並去掉空白標點', () => {
  assert.ok(hasChinese('會議'));
  assert.ok(!hasChinese('meeting'));
  assert.equal(normalizeChinese(' 開 會！ '), '開會');
  assert.equal(reverseShard('議'), ('議'.codePointAt(0) % 256).toString(16).padStart(2, '0'));
});

test('完全相同優先於開頭相同，再來才是包含；同字只留最好的一筆', () => {
  assert.deepEqual([matchKind('會議', '會議'), matchKind('會議室', '會議'), matchKind('開會議', '會議'), matchKind('會', '會議')], [0, 1, 2, -1]);
  const ranked = rankReverse([
    ['董事會議室', 'boardroom', 10], ['會議', 'meeting', 400], ['會議', 'conference', 90],
    ['會議室', 'boardroom', 50], ['開會', 'meet', 1],
  ], '會議');
  assert.deepEqual(ranked.map((item) => item.word), ['conference', 'meeting', 'boardroom']);
  assert.equal(ranked[2].term, '會議室');
});

test('收藏字卡用自己的中文優先列出', () => {
  const owned = [{ word: 'invoice', zh: 'n. 發票；發貨單' }, { word: 'apple', zh: '蘋果' }];
  assert.deepEqual(ownedMatches('發票', owned), [{ word: 'invoice', term: '發票' }]);
});

test('合併每個字的分片、標記收藏，分片失敗回報 unavailable', async () => {
  const calls = [];
  const data = { [reverseShard('會')]: { 會: [['會議', 'meeting', 5], ['學會', 'learn', 3]] },
    [reverseShard('議')]: { 議: [['會議', 'conference', 2], ['建議', 'suggest', 1]] } };
  const lookup = createReverseLookup(async (key) => { calls.push(key); return data[key] || null; });
  const result = await lookup('會議', [{ word: 'meeting', zh: '會議' }]);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.words, [{ word: 'meeting', term: '會議', owned: true }, { word: 'conference', term: '會議', owned: false }]);
  assert.equal((await lookup('abc')).status, 'invalid');
  assert.equal((await lookup('貓')).status, 'unavailable');
});

test('實際索引：常見多益中文能反查到英文', async () => {
  const lookup = createReverseLookup(async (key) => {
    try { return JSON.parse(fs.readFileSync(new URL(`../../data/dict/reverse-v1/${key}.json`, import.meta.url), 'utf8')); }
    catch { return null; }
  });
  const expect = { 發票: 'invoice', 會議: 'meeting', 乘客: 'passenger', 預算: 'budget', 合約: 'contract' };
  for (const [zh, en] of Object.entries(expect)) {
    const { words } = await lookup(zh);
    assert.ok(words.slice(0, 6).some((item) => item.word === en), `${zh} → ${words.map((w) => w.word).join(', ')}`);
  }
});
