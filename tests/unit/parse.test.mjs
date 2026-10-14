// 批次輸入解析的單元測試：node --test tests/unit/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitWords, analyzeInput, normalizeWord } from '../../js/parse.js';

test('normalizeWord：小寫、去頭尾空白、合併空白', () => {
  assert.equal(normalizeWord('  Take   Over '), 'take over');
  assert.equal(normalizeWord(null), '');
});

test('各種分隔符號', () => {
  assert.deepEqual(splitWords('approve, deadline, invoice'), ['approve', 'deadline', 'invoice']);
  assert.deepEqual(splitWords('approve deadline invoice'), ['approve', 'deadline', 'invoice']);
  assert.deepEqual(splitWords('merger；refund、warranty\tpayroll/agenda'), ['merger', 'refund', 'warranty', 'payroll', 'agenda']);
});

test('中文、編號、項目符號會被忽略', () => {
  assert.deepEqual(splitWords('1. reimbursement 報銷\n2) itinerary 行程'), ['reimbursement', 'itinerary']);
  assert.deepEqual(splitWords('- approve\n• follow-up\na. b.'), ['approve', 'follow-up']);
});

test('含小字的片語保留成一個', () => {
  assert.deepEqual(splitWords('take over\nlook forward to\nin charge of'), ['take over', 'look forward to', 'in charge of']);
  assert.deepEqual(splitWords('annual report'), ['annual', 'report']);   // 名詞片語會被拆開（已知取捨）
});

test('analyzeInput：分出新字、貼上內容重複、已存在', () => {
  assert.deepEqual(
    analyzeInput('Approve, approve, invoice, deadline', ['invoice']),
    { fresh: ['approve', 'deadline'], dupes: ['approve'], existing: ['invoice'] },
  );
  assert.deepEqual(analyzeInput('', []), { fresh: [], dupes: [], existing: [] });
});
