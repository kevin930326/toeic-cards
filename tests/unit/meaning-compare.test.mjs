import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { meaningTerms, similarTerms, splitZh, altMeanings, withAlt, parseAltInput, ALT_PREFIX } from '../../js/meaning-compare.js';

test('拆詞：去詞性、括號、也譯作前綴', () => {
  assert.deepEqual(meaningTerms('adj. 潛在的；未來可能的\n也譯作：預期的'), ['潛在的', '未來可能的', '預期的']);
  assert.deepEqual(meaningTerms('v. 核准（文件）、批准'), ['核准', '批准']);
});

test('同一種說法：包含或有兩字相同；只有一字相同不算', () => {
  assert.ok(similarTerms('接待員', '接待人員'));
  assert.ok(similarTerms('重要的', '重要'));
  assert.ok(similarTerms('污染', '汙染'));
  assert.ok(!similarTerms('收銀員', '出納員'));
  assert.ok(!similarTerms('潛在的', '預期的'));
});

test('也譯作：合併單字包與字卡、去掉和主要意思太像的；使用者整理過只用自己的', () => {
  const card = { zh: 'adj. 潛在的；未來可能的', src: { zh: 'pack' } };
  assert.deepEqual(altMeanings(card, '預期的；將來的；潛在'), ['預期的', '將來的']);
  const mine = { zh: `adj. 潛在的\n${ALT_PREFIX}可能的顧客`, src: { zh: 'user' } };
  assert.deepEqual(altMeanings(mine, '預期的'), ['可能的顧客']);
  assert.deepEqual(altMeanings({ zh: '', src: {} }, '預期的'), []);
});

test('寫回中文：主要意思不變，只換最後一行；空清單拿掉這一行', () => {
  const zh = withAlt('adj. 潛在的\n也譯作：舊的', ['預期的', '將來的', '預期的']);
  assert.equal(zh, 'adj. 潛在的\n也譯作：預期的；將來的');
  assert.deepEqual(splitZh(zh), { main: 'adj. 潛在的', alt: ['預期的', '將來的'] });
  assert.equal(withAlt(zh, []), 'adj. 潛在的');
  assert.deepEqual(parseAltInput(' 預期的；將來的, 有希望的 '), ['預期的', '將來的', '有希望的']);
});

test('單字包整理表：每個字都在單字包裡，且不和卡片主要意思重複', () => {
  const alt = JSON.parse(fs.readFileSync(new URL('../../data/packs/toeic-1000-alt.json', import.meta.url), 'utf8')).alt;
  const pack = {};
  for (const file of fs.readdirSync(new URL('../../data/packs/toeic-1000/', import.meta.url))) {
    for (const e of JSON.parse(fs.readFileSync(new URL(`../../data/packs/toeic-1000/${file}`, import.meta.url), 'utf8')).entries) pack[e.word] = e.zh;
  }
  assert.ok(Object.keys(alt).length > 250);
  assert.equal(alt.prospective, '預期的；將來的');
  for (const [word, text] of Object.entries(alt)) {
    assert.ok(pack[word], word);
    for (const term of meaningTerms(text)) assert.ok(!meaningTerms(pack[word]).some((own) => similarTerms(own, term)), `${word}: ${term}`);
  }
});
