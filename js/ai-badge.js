// 測驗與練習的「AI」標示，全站用同一套規則：
//   'required'：一定要 Gemini 金鑰（Part 5、短文閱讀）
//   'partial'：有內建題目可以不用金鑰，自己加的字才用 AI（詞性變化）
//   不用 AI 的功能不加標示
const BADGES = {
  required: { text: 'AI', title: '需要 Gemini 金鑰，會用到免費額度', cls: 'badge-ai' },
  partial: { text: '部分 AI', title: '單字包的字有內建題目，不用金鑰；自己加的字用 Gemini 出題', cls: 'badge-ai badge-ai-partial' },
};

export function aiBadge(kind) {
  const b = BADGES[kind];
  return b ? `<span class="badge ${b.cls}" title="${b.title}">${b.text}<span class="sr-only">：${b.title}</span></span>` : '';
}

// 測驗首頁的說明
export const AI_BADGE_LEGEND = `${aiBadge('required')} 需要 Gemini 金鑰　${aiBadge('partial')} 單字包的字不用金鑰，自己加的字用 AI　沒有標示的不用 AI`;
