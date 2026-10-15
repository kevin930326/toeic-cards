// 詞性變化題的單元測試：node --test "tests/unit/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sameFamily, allSameFamily, normalizeFormQ, formsQuestion, parseFormsBank, checkMode, buildFormsPrompt, BLANK, MODES, mulberry32,
} from '../../js/quiz.js';
import { sanitizeWord, sanitizeMistakes } from '../../js/backup.js';

const good = {
  target: 'approve',
  sentence: 'The board is expected to give final _____ of the budget at Friday\'s meeting.',
  answer: 'approval',
  distractors: ['approve', 'approved', 'approving'],
  translation: '董事會預計在週五的會議上對預算給予最終核准。',
  explanation: '空格前有形容詞 final、後面接 of，需要名詞。',
};

test('同字族：開頭至少 3 個字母相同，很短的字放寬', () => {
  assert.ok(sameFamily('approval', 'approve'));
  assert.ok(sameFamily('successfully', 'success'));
  assert.ok(sameFamily('paid', 'pay'));          // 很短的字：字長−1＝2 個字母
  assert.ok(!sameFamily('reject', 'approve'));
  assert.ok(!sameFamily('', 'approve'));
});

test('同字族：和其他已確定同字族的選項相同也算（payment 的 paid 透過 pay）', () => {
  assert.ok(allSameFamily(['pay', 'payable', 'paid', 'payment'], 'payment'));
  assert.ok(!allSameFamily(['paid', 'payable', 'reject', 'payment'], 'payment'));
  assert.ok(!allSameFamily(['bought', 'buyer', 'buys', 'buying'], 'buy'));   // 不規則變化開頭不同，不收
});

test('詞性變化題：合格的題目整理成要存的格式', () => {
  const q = normalizeFormQ(good, 'approve');
  assert.equal(q.answer, 'approval');
  assert.deepEqual(q.distractors, ['approve', 'approved', 'approving']);
  assert.equal(q.sentence.split(BLANK).length - 1, 1);
});

test('詞性變化題：混進別的字、答案出現在句子裡、選項重複、沒有空格都不收', () => {
  assert.equal(normalizeFormQ({ ...good, distractors: ['approve', 'reject', 'approving'] }, 'approve'), null);
  assert.equal(normalizeFormQ({ ...good, sentence: 'Final approval of the _____ is needed.' }, 'approve'), null);
  assert.equal(normalizeFormQ({ ...good, distractors: ['approval', 'approved', 'approving'] }, 'approve'), null);
  assert.equal(normalizeFormQ({ ...good, sentence: 'The board gave its approval.' }, 'approve'), null);
  assert.equal(normalizeFormQ(null, 'approve'), null);
});

test('詞性變化題：出題時選項打亂，答案位置正確，題型是 forms', () => {
  const word = { id: 'w1', word: 'approve' };
  const q = formsQuestion(word, normalizeFormQ(good, 'approve'), mulberry32(7));
  assert.equal(q.mode, 'forms');
  assert.equal(q.options.length, 4);
  assert.equal(q.options[q.answerIndex], 'approval');
  assert.equal(q.extra.translation, good.translation);
});

test('內建題庫：格式不對丟出錯誤；不合格的題目略過，同一個字可以有多題', () => {
  assert.throws(() => parseFormsBank({ packId: 'x', version: 1, questions: [] }));
  assert.throws(() => parseFormsBank(null));
  const bank = parseFormsBank({ packId: 'toeic-1000', version: 1, questions: [
    good,
    { ...good, sentence: 'All requests must be _____ by a manager before payment.', answer: 'approved', distractors: ['approval', 'approve', 'approves'] },
    { ...good, target: 'company', distractors: ['reject', 'approved', 'approving'] },   // 混進別的字 → 略過
  ] });
  assert.equal(bank.get('approve').length, 2);
  assert.equal(bank.has('company'), false);
});

test('測驗模式：詞性變化不需要其他字當錯誤選項，範圍有字就能考', () => {
  assert.ok(MODES.includes('forms'));
  assert.deepEqual(checkMode('forms', [{ id: 'a', word: 'approve' }]), { ok: true });
  assert.equal(checkMode('forms', [], []).ok, false);
});

test('AI 出題提示：列出每個目標字，要求文法線索讓答案唯一', () => {
  const p = buildFormsPrompt(['approve', 'success']);
  assert.match(p, /1\. approve\n2\. success/);
  assert.match(p, /EXACTLY ONE option is grammatically correct/);
});

test('備份與同步：AI 出的詞性變化題會保留並清理；錯題本接受 forms 題型', () => {
  const w = sanitizeWord({ id: 'w1', word: 'approve', formQs: [{ ...good, id: 'q1', at: 1, usedAt: 0 }, { sentence: 'bad' }] });
  assert.equal(w.formQs.length, 1);
  assert.equal(w.formQs[0].answer, 'approval');
  assert.equal('formQs' in sanitizeWord({ id: 'w2', word: 'submit' }), false);
  const question = { mode: 'forms', wordId: 'w1', word: 'approve', prompt: good.sentence, options: ['approval', 'approve', 'approved', 'approving'], answerIndex: 0 };
  assert.equal(sanitizeMistakes([{ question, chosen: 1, count: 1, at: 1 }]).length, 1);
});
