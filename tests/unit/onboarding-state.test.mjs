import test from 'node:test';
import assert from 'node:assert/strict';
import { onboardingPrompt } from '../../js/onboarding-state.js';

test('沒有教學紀錄時，空資料歡迎；已有資料只顯示提示', () => {
  assert.equal(onboardingPrompt(null, false), 'welcome');
  assert.equal(onboardingPrompt(null, true), 'banner');
});
test('已開始、完成或略過，不因資料被清空而再次打擾', () => {
  for (const status of ['started', 'completed', 'skipped']) {
    for (const hasData of [true, false]) assert.equal(onboardingPrompt({ version: 1, status }, hasData), 'none');
  }
});
test('損壞或未識別的教學紀錄，仍依現有資料決定提示方式', () => {
  for (const record of [{}, [], 'invalid', { status: 'unknown' }]) {
    assert.equal(onboardingPrompt(record, true), 'banner');
    assert.equal(onboardingPrompt(record, false), 'welcome');
  }
});
