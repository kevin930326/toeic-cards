// 本機是否看過教學，與單字／學習進度分開判斷。
export function onboardingPrompt(record, hasData) {
  if (record && ['started', 'completed', 'skipped'].includes(record.status)) return 'none';
  return hasData ? 'banner' : 'welcome';
}
