import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hasChinese, normalizeChinese, reverseShard, matchKind, rankReverse, ownedMatches, createReverseLookup,
  parseS2T, toTraditional, PARTIAL } from '../../js/dictionary-reverse.js';
import { buildReversePrompt, cleanReverseResult } from '../../js/reverse-ai.js';

const realShard = async (key) => {
  try { return JSON.parse(fs.readFileSync(new URL(`../../data/dict/reverse-v1/${key}.json`, import.meta.url), 'utf8')); }
  catch { return null; }
};

test('辨認中文輸入並去掉空白標點', () => {
  assert.ok(hasChinese('會議'));
  assert.ok(!hasChinese('meeting'));
  assert.equal(normalizeChinese(' 開 會！ '), '開會');
  assert.equal(reverseShard('議'), ('議'.codePointAt(0) % 512).toString(16).padStart(3, '0'));
});

test('完全相同 → 開頭相同 → 包含 → 部分符合；同字只留最好的一筆', () => {
  assert.deepEqual([matchKind('會議', '會議'), matchKind('會議室', '會議'), matchKind('開會議', '會議'), matchKind('會', '會議')], [0, 1, 2, -1]);
  assert.equal(matchKind('員工', '新進員工'), PARTIAL);
  assert.equal(matchKind('重要的', '重要'), 0);
  const ranked = rankReverse([
    ['董事會議室', 'boardroom', 10], ['會議', 'meeting', 400, 'n.'], ['會議', 'conference', 90],
    ['會議室', 'boardroom', 50], ['開會', 'meet', 1],
  ], '會議');
  assert.deepEqual(ranked.map((item) => item.word), ['conference', 'meeting', 'boardroom']);
  assert.equal(ranked[1].pos, 'n.');
  assert.equal(ranked[2].term, '會議室');
  const partial = rankReverse([['員工', 'employee', 5], ['員', 'member', 1]], '新進員工');
  assert.deepEqual(partial.map((item) => [item.word, item.partial]), [['employee', true]]);
});

test('收藏字卡用自己的中文優先列出', () => {
  const owned = [{ word: 'invoice', zh: 'n. 發票；發貨單', pos: 'n.' }, { word: 'apple', zh: '蘋果' }];
  assert.deepEqual(ownedMatches('發票', owned), [{ word: 'invoice', term: '發票', pos: 'n.', partial: false }]);
});

test('簡體對照逐字轉換', () => {
  const map = parseS2T('会會议議');
  assert.equal(toTraditional('会议室', map), '會議室');
});

test('合併每個字的分片、標記收藏，分片失敗回報 unavailable', async () => {
  const data = { [reverseShard('會')]: { 會: [['會議', 'meeting', 5], ['學會', 'learn', 3]] },
    [reverseShard('議')]: { 議: [['會議', 'conference', 2], ['建議', 'suggest', 1]] }, s2t: '会會议議' };
  const lookup = createReverseLookup(async (key) => data[key] || null);
  const result = await lookup('會議', [{ word: 'meeting', zh: '會議' }]);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.words.map((item) => [item.word, item.owned]), [['meeting', true], ['conference', false]]);
  const simplified = await lookup('会议');
  assert.equal(simplified.query, '會議');
  assert.equal(simplified.words[0].word, 'conference');
  assert.equal((await lookup('abc')).status, 'invalid');
  assert.equal((await lookup('貓')).status, 'unavailable');
});

test('AI 備援：提示只含輸入的中文，回傳只收英文拼字並去重', () => {
  assert.match(buildReversePrompt('報稅'), /「報稅」/);
  const cleaned = cleanReverseResult({ words: [
    { word: 'file taxes', pos: 'phrase', zh: '報稅' }, { word: 'File Taxes', zh: '重複' },
    { word: '<script>', zh: 'x' }, { word: 'tax return', pos: 'n.', zh: '報稅單' },
  ] });
  assert.deepEqual(cleaned.map((item) => item.word), ['file taxes', 'tax return']);
  assert.ok(cleaned.every((item) => item.ai));
});

test('實際索引：常見多益中文（含簡體、口語）能反查到英文', async () => {
  const lookup = createReverseLookup(realShard);
  const expect = { 發票: 'invoice', 会议: 'meeting', 乘客: 'passenger', 預算: 'budget', 合約: 'contract',
    利率: 'interest rate', 菜單: 'menu', 退房: 'check out', 外帶: 'takeout', 重要: 'important', 延期: 'postpone' };
  for (const [zh, en] of Object.entries(expect)) {
    const { words } = await lookup(zh);
    assert.ok(words.slice(0, 6).some((item) => item.word === en), `${zh} → ${words.map((w) => w.word).join(', ')}`);
  }
  const { words } = await lookup('新進員工');
  assert.ok(words[0].word === 'new employee' || words[0].partial);
});
