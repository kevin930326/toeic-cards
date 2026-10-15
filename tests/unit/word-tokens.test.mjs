import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordTokens } from '../../js/word-tokens.js';

test('拆詞後仍能完整還原原句與標點空白', () => {
  const text = 'An arrangement, at a certain time.\n  Meet at 9:30!';
  const tokens = wordTokens(text);
  assert.equal(tokens.map((t) => t.text).join(''), text);
  assert.deepEqual(tokens.filter((t) => t.word).map((t) => t.word), ['an','arrangement','at','a','certain','time','meet','at']);
});
test('大小寫只影響查詢值，重音、連字號及撇號不拆散', () => {
  const tokens = wordTokens("RÉSUMÉ, blue-collar, company’s, RE\u0301SUME\u0301").filter((t) => t.word);
  assert.deepEqual(tokens.map((t) => t.word), ['résumé','blue-collar',"company's",'résumé']);
  assert.equal(tokens[0].text, 'RÉSUMÉ');
});
test('不把中文與數字當英文，也不猜測變化形', () => {
  assert.deepEqual(wordTokens('中文 123').filter((t) => t.word), []);
  assert.deepEqual(wordTokens('meetings arranged').map((t) => t.word).filter(Boolean), ['meetings','arranged']);
  assert.deepEqual(wordTokens(null), []);
});
