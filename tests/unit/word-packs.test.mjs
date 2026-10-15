import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateWordPack, packWords, previewPack, validatePackContent, initialPackData, packBackfill } from '../../js/word-packs.js';
import { EXTRA_ENTRIES } from '../../js/dictionary-extra.js';
import { normalizeWord } from '../../js/parse.js';
import { buildBackup, parseBackup } from '../../js/backup.js';
import { applyRemoteWords, toRemoteWord } from '../../js/sync-core.js';

const raw = JSON.parse(readFileSync(new URL('../../data/packs/toeic-1000.json', import.meta.url), 'utf8'));
const pack = validateWordPack(raw);
const contentGroups = Array.from({ length: 10 }, (_, i) => JSON.parse(readFileSync(new URL(`../../data/packs/toeic-1000/${String(i + 1).padStart(2, '0')}.json`, import.meta.url), 'utf8')));
const entries = contentGroups.flatMap((group, i) => validatePackContent(group, pack, i));

test('1000 字預製內容對齊原序，每字有雙語解釋、雙語例句與搭配詞', () => {
  assert.deepEqual(entries.map((e) => e.word), pack.words);
  assert.equal(new Set(entries.map((e) => e.examples[0].en)).size, 1000);
  for (const entry of entries) {
    assert.ok(entry.zh && entry.en && entry.pos, entry.word);
    assert.ok(entry.examples[0].en && entry.examples[0].zh && entry.collocations.length, entry.word);
  }
  assert.equal(entries.find((e) => e.word === 'résumé').zh, '履歷');
  assert.ok(entries.find((e) => e.word === 'seek').forms.some((s) => s.startsWith('sought')));
  assert.ok(entries.find((e) => e.word === 'found').forms.some((s) => s.startsWith('founded')));
});

test('內容檔版本、組別或字序錯誤時拒絕載入', () => {
  const group = contentGroups[0];
  for (const invalid of [{ ...group, version: 2 }, { ...group, packId: 'other' }, { ...group, group: 1 },
    { ...group, entries: group.entries.slice(1) }, { ...group, entries: [...group.entries].reverse() }]) {
    assert.throws(() => validatePackContent(invalid, pack, 0));
  }
});

test('缺少雙語例句、搭配詞或欄位格式異常時拒絕內容', () => {
  for (const patch of [{ examples: [] }, { examples: [{ en: 'Example.', zh: '' }] }, { collocations: [] },
    { forms: 'invalid' }, { pos: '<img>' }, { en: '' }, { synonyms: ['x'.repeat(121)] }]) {
    const group = structuredClone(contentGroups[0]);
    Object.assign(group.entries[0], patch);
    assert.throws(() => validatePackContent(group, pack, 0));
  }
});

test('新字預填資料標示 pack 來源，不包含學習進度或虛構的 AI 呼叫紀錄', () => {
  const value = initialPackData(entries[0]);
  assert.equal(value.src.en, 'pack');
  assert.equal(value.src.examples, 'pack');
  assert.equal(value.lookup.enDone, true);
  assert.deepEqual(value.pack, { id: 'toeic-1000', version: 1 });
  assert.equal(value.srs, undefined);
  assert.equal(value.llm, undefined);
});

test('舊卡補空白保留自訂詞義、刻意清空的欄位與其他內容', () => {
  const word = { word: 'company', zh: '我的意思', src: { zh: 'user', forms: 'user' }, forms: [],
    srs: { interval: 20 }, examples: [{ en: 'My example.', zh: '我的例句。' }], lookup: { dictAt: 123, custom: true } };
  const before = structuredClone(word);
  const patch = packBackfill(word, entries[0]);
  assert.equal(patch.zh, undefined);
  assert.equal(patch.forms, undefined);
  assert.equal(patch.examples, undefined);
  assert.equal(patch.srs, undefined);
  assert.equal(patch.en, entries[0].en);
  assert.equal(patch.src.en, 'pack');
  assert.deepEqual(patch.lookup, { dictAt: 123, custom: true, enDone: true });
  assert.deepEqual(word, before);
});

test('完整字卡或明確清空全部內容的字卡不產生補寫', () => {
  assert.equal(packBackfill({ ...entries[0] }, entries[0]), null);
  const fields = ['phonetic', 'pos', 'zh', 'en', 'examples', 'collocations', 'forms', 'synonyms'];
  assert.equal(packBackfill({ src: Object.fromEntries(fields.map((f) => [f, 'user'])) }, entries[0]), null);
});

test('預製內容、來源與版本經備份及跨裝置資料轉換完整保留', () => {
  const word = { ...initialPackData(entries[0]), id: 'pack-company', word: 'company', autoGenerate: false, createdAt: 1, updatedAt: 2 };
  const backup = buildBackup({ words: [word], log: {}, mistakes: [], settings: {} });
  const restored = parseBackup(JSON.stringify(backup), {}).backup.words[0];
  const remote = applyRemoteWords([], {}, [toRemoteWord(word)]).words[0];
  for (const result of [restored, remote]) {
    assert.deepEqual(result.pack, word.pack);
    assert.equal(result.src.en, 'pack');
    assert.deepEqual(result.examples, word.examples);
    assert.deepEqual(result.collocations, word.collocations);
    assert.equal(result.autoGenerate, false);
  }
});

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
