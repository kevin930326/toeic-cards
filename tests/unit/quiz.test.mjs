// 測驗出題邏輯的單元測試：node --test "tests/unit/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mulberry32, shuffle, mainPos, firstMeaning, maskWord, checkMode, pickDistractors,
  buildSimpleQuestion, buildSimpleQuiz, pickTargets, normalizePart5, part5Question, buildPart5Prompt, BLANK,
} from '../../js/quiz.js';

const w = (id, pos, zh, en = '', unfamiliar = false) => ({ id, word: id, pos, zh, en, unfamiliar });
const WORDS = [
  w('approve', 'v.', 'v. 核准；批准', 'To officially agree to a plan.'),
  w('negotiate', 'v.', 'v. 協商；談判', 'To discuss to reach an agreement.'),
  w('postpone', 'v.', 'v. 延期', 'To move an event to a later time.'),
  w('submit', 'vt. / vi.', 'vt. 提交\nvi. 服從', 'To give a document for review.'),
  w('invoice', 'n.', 'n. 發票', 'A bill for goods.'),
  w('deadline', 'n.', 'n. 截止日期', 'The latest time to finish.'),
  w('itinerary', 'n.', 'n. 行程表', 'A plan of a trip.'),
  w('bill', 'n.', 'n. 發票', 'A list of charges.'),   // 和 invoice 中文一樣
];

test('mainPos：取第一個詞性並統一寫法', () => {
  assert.equal(mainPos('vt. / vi.'), 'v');
  assert.equal(mainPos('n. & v.'), 'n');
  assert.equal(mainPos('a.'), 'adj');
  assert.equal(mainPos(''), '');
});

test('firstMeaning：中文第一行去掉詞性', () => {
  assert.equal(firstMeaning('vt. 提交；呈遞\nvi. 服從'), '提交；呈遞');
  assert.equal(firstMeaning('出席人；參加者'), '出席人；參加者');
  assert.equal(firstMeaning(''), '');
});

test('maskWord：遮住答案和它的變化形', () => {
  assert.equal(maskWord('The manager approved the approval.', 'approve'), 'The manager _____ the _____.');
  assert.equal(maskWord('To approve something', 'approve'), 'To _____ something');
  assert.equal(maskWord('Please take over the task', 'take over'), 'Please _____ the task');
  assert.equal(maskWord('A bill is not a billion', 'bill'), 'A _____ is not a _____');   // 短字只用整個字當字根
});

test('pickDistractors：不含答案、選項不重複、同詞性優先', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const rng = mulberry32(seed);
    const target = WORDS[0];   // approve（動詞）
    const picked = pickDistractors(target, WORDS, 3, { rng });
    assert.equal(picked.length, 3);
    assert.ok(!picked.includes(target));
    assert.equal(new Set(picked.map((x) => x.id)).size, 3);
    // 動詞剛好有 3 個（negotiate、postpone、submit），應該全部挑動詞
    assert.ok(picked.every((x) => mainPos(x.pos) === 'v'), `seed ${seed}: ${picked.map((x) => x.id)}`);
  }
});

test('pickDistractors：用中文當選項時，中文一樣的字不會同時出現', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const picked = pickDistractors(WORDS[4], WORDS, 3, { key: (x) => firstMeaning(x.zh), rng: mulberry32(seed) });
    const texts = picked.map((x) => firstMeaning(x.zh));
    assert.ok(!texts.includes('發票'), `seed ${seed}: bill 的中文和答案 invoice 一樣，不能當錯誤選項`);
    assert.equal(new Set(texts).size, texts.length);
  }
});

test('buildSimpleQuestion：三種題型的題目與答案位置', () => {
  const rng = mulberry32(7);
  const q1 = buildSimpleQuestion('zh2en', WORDS[0], WORDS, rng);
  assert.equal(q1.prompt, 'v. 核准；批准');
  assert.equal(q1.options[q1.answerIndex], 'approve');
  assert.equal(q1.options.length, 4);

  const q2 = buildSimpleQuestion('en2word', WORDS[3], WORDS, rng);
  assert.equal(q2.options[q2.answerIndex], 'submit');

  const q3 = buildSimpleQuestion('listen', WORDS[3], WORDS, rng);
  assert.equal(q3.prompt, 'submit');
  assert.equal(q3.options[q3.answerIndex], '提交');
});

test('答案位置是隨機的（不會總是第一個）', () => {
  const positions = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    positions.add(buildSimpleQuestion('zh2en', WORDS[0], WORDS, mulberry32(seed)).answerIndex);
  }
  assert.equal(positions.size, 4);
});

test('checkMode：字不夠時說明原因', () => {
  assert.equal(checkMode('zh2en', WORDS).ok, true);
  const few = checkMode('zh2en', WORDS.slice(0, 3));
  assert.equal(few.ok, false);
  assert.match(few.reason, /至少 4 個/);
  const noEn = WORDS.map((x) => ({ ...x, en: '' }));
  assert.equal(checkMode('en2word', noEn).ok, false);
  assert.equal(checkMode('zh2en', WORDS, []).ok, false);
});

test('buildSimpleQuiz 與 pickTargets：題數、不重複、不熟的字優先', () => {
  const quiz = buildSimpleQuiz('zh2en', WORDS, WORDS, 5, mulberry32(3));
  assert.equal(quiz.length, 5);
  assert.equal(new Set(quiz.map((q) => q.wordId)).size, 5);

  const withUnfamiliar = WORDS.map((x, i) => ({ ...x, unfamiliar: i >= 6 }));
  let firstTwoUnfamiliar = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const t = pickTargets('zh2en', withUnfamiliar, 2, mulberry32(seed));
    firstTwoUnfamiliar += t.filter((x) => x.unfamiliar).length;
  }
  // 不熟的只有 2/8，隨機抽約 0.5 個；有優先時應該明顯更多
  assert.ok(firstTwoUnfamiliar / 50 > 0.9, `平均 ${firstTwoUnfamiliar / 50}`);
});

test('shuffle 不改原陣列、元素不變', () => {
  const a = [1, 2, 3, 4, 5];
  const b = shuffle(a, mulberry32(1));
  assert.deepEqual(a, [1, 2, 3, 4, 5]);
  assert.deepEqual([...b].sort(), [1, 2, 3, 4, 5]);
});

const good = {
  target: 'approve',
  sentence: 'The board ___ the new budget at Monday’s meeting.',
  answer: 'approved',
  distractors: ['negotiated', 'postponed', 'submitted'],
  translation: '董事會在週一的會議上核准了新預算。',
  explanation: '董事會對預算的動作是「核准」。',
};

test('normalizePart5：接受正常的題目並統一空格寫法', () => {
  const q = normalizePart5(good);
  assert.ok(q);
  assert.equal(q.sentence, `The board ${BLANK} the new budget at Monday’s meeting.`);
  assert.deepEqual(q.distractors, ['negotiated', 'postponed', 'submitted']);
});

test('normalizePart5：拒絕有問題的題目', () => {
  assert.equal(normalizePart5({ ...good, sentence: 'No blank here.' }), null, '沒有空格');
  assert.equal(normalizePart5({ ...good, sentence: 'The ___ and ___ again.' }), null, '兩個空格');
  assert.equal(normalizePart5({ ...good, distractors: ['negotiated', 'postponed'] }), null, '錯誤選項不夠');
  assert.equal(normalizePart5({ ...good, distractors: ['Approved', 'postponed', 'submitted'] }), null, '選項重複');
  assert.equal(normalizePart5({ ...good, sentence: 'The board approved ___ budget.' }), null, '答案已經出現在句子裡');
  assert.equal(normalizePart5({ ...good, answer: '' }), null, '沒有答案');
  assert.equal(normalizePart5(null), null);
});

test('part5Question：選項包含答案且位置正確', () => {
  const q = part5Question({ id: 'approve', word: 'approve' }, { id: 'q1', ...normalizePart5(good) }, mulberry32(9));
  assert.equal(q.options[q.answerIndex], 'approved');
  assert.equal(q.options.length, 4);
  assert.equal(q.extra.qid, 'q1');
});

test('buildPart5Prompt：每個字和它的錯誤選項都在提示詞裡', () => {
  const p = buildPart5Prompt([{ target: 'approve', distractors: ['negotiate', 'postpone', 'submit'] }]);
  assert.match(p, /1\. target: "approve"; distractors: "negotiate", "postpone", "submit"/);
  assert.match(p, /Traditional Chinese/);
});
