import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateWordPack, packWords, previewPack } from '../../js/word-packs.js';
import { EXTRA_ENTRIES } from '../../js/dictionary-extra.js';
import { normalizeWord } from '../../js/parse.js';
import { buildBackup, parseBackup } from '../../js/backup.js';
import { applyRemoteWords, toRemoteWord } from '../../js/sync-core.js';

const raw = JSON.parse(readFileSync(new URL('../../data/packs/toeic-1000.json', import.meta.url), 'utf8'));
const pack = validateWordPack(raw);

test('單字包包含 1000 個不重複字，保留首尾與經查核的拼字', () => {
  assert.equal(pack.words.length, 1000);
  assert.equal(new Set(pack.words).size, 1000);
  assert.equal(pack.words[0], 'company');
  assert.equal(pack.words.at(-1), 'debrief');
  assert.equal(pack.words[450], 'approve');
  assert.equal(pack.words[580], 'inconvenience');
  assert.equal(pack.words[610], 'compulsory');
  assert.ok(pack.words.includes('create'));
  assert.ok(pack.words.includes('résumé'));
  assert.equal(raw.source.corrections.length, 3);
});

test('十組各100字，組別聯集和原順序完全一致，錯誤範圍不加入', () => {
  const groups = Array.from({ length: 10 }, (_, i) => packWords(pack, String(i)));
  assert.ok(groups.every((g) => g.length === 100));
  assert.deepEqual(groups.flat(), pack.words);
  assert.deepEqual(packWords(pack, 'all'), pack.words);
  for (const invalid of ['-1', '10', '0.5', 'abc', '']) assert.deepEqual(packWords(pack, invalid), []);
});

test('單字包格式錯誤或重複時拒絕，不偷偷補字或省略', () => {
  for (const invalid of [null, {}, { ...raw, version: 2 }, { ...raw, words: raw.words.slice(1) },
    { ...raw, words: raw.words.map((w, i) => i === 1 ? 'company' : w) },
    { ...raw, words: raw.words.map((w, i) => i === 1 ? '<img>' : w) }]) {
    assert.throws(() => validateWordPack(invalid));
  }
});

test('預覽分開計算新字、已有字與已在目標集的字，不修改既有資料', () => {
  const local = [{ id: 'x', word: 'company', zh: '我的意思', srs: { interval: 20 } }, { word: 'debrief' }];
  const before = JSON.stringify(local);
  const target = { members: { company: { present: true, at: 1 } } };
  const preview = previewPack(pack, '0', local, target);
  assert.equal(preview.fresh.length, 99);
  assert.deepEqual(preview.existing, ['company']);
  assert.deepEqual(preview.alreadyInSet, ['company']);
  assert.equal(preview.toAssign, 99);
  assert.equal(preview.owned, 2);
  assert.equal(JSON.stringify(local), before);
});

test('清單內所有字都有本機中文，補充詞義獨立於原始 PDF', () => {
  const dict = new Map();
  for (const word of pack.words) {
    const letter = word[0];
    if (!dict.has(letter)) dict.set(letter, JSON.parse(readFileSync(new URL(`../../data/dict/${letter}.json`, import.meta.url), 'utf8')));
    const entry = EXTRA_ENTRIES[word] || dict.get(letter)[word];
    assert.ok(entry?.t, `缺少本機詞義：${word}`);
  }
  assert.equal(Object.keys(EXTRA_ENTRIES).length, 16);
  assert.match(EXTRA_ENTRIES.download.t, /下載/);
  assert.doesNotMatch(EXTRA_ENTRIES.download.t, /解除安裝/);
  assert.equal(EXTRA_ENTRIES.constructor, undefined);
});

test('重音拼字保留，Unicode 組合形式仍視為同字', () => {
  assert.equal(normalizeWord('RE\u0301SUME\u0301'), 'résumé');
  assert.notEqual(normalizeWord('résumé'), normalizeWord('resume'));
});

test('不自動生成的選擇會通過備份與同步保留', () => {
  const word = { id: 'id-company', word: 'company', autoGenerate: false, createdAt: 1, updatedAt: 2 };
  const backup = buildBackup({ words: [word], log: {}, mistakes: [], settings: {} });
  const restored = parseBackup(JSON.stringify(backup), {}).backup.words;
  assert.equal(restored[0].autoGenerate, false);
  const applied = applyRemoteWords([], {}, [toRemoteWord(word)]);
  assert.equal(applied.words[0].autoGenerate, false);
});
