// 專案自行整理的常用字補充與勘誤，填補 ECDICT 子集未收錄或明顯錯誤的詞。
// 只含基本詞義，不使用原單字表的翻譯或例句；靜態模組也可離線使用。
export const EXTRA_ENTRIES = Object.freeze(Object.assign(Object.create(null), {
  download: { s: 'v. / n.', t: 'v. 下載\nn. 下載的檔案；下載' },
  'résumé': { s: 'n.', t: 'n. 履歷' },
  utilities: { s: 'n.', t: 'n. 水電瓦斯等公共服務；公用事業' },
  webinar: { s: 'n.', t: 'n. 線上研討會' },
  headcount: { s: 'n.', t: 'n. 人數；員工總數' },
  'blue-collar': { s: 'adj.', t: 'adj. 從事體力或技術勞動的；藍領的' },
  onsite: { s: 'adj. / adv.', t: 'adj. 現場的\nadv. 在現場' },
  underperform: { s: 'v.', t: 'v. 表現低於預期' },
  workflow: { s: 'n.', t: 'n. 工作流程' },
  cofounder: { s: 'n.', t: 'n. 共同創辦人' },
  analytics: { s: 'n.', t: 'n. 資料分析' },
  onboarding: { s: 'n.', t: 'n. 新進人員或新使用者的引導與適應流程' },
  cybersecurity: { s: 'n.', t: 'n. 網路安全' },
  preemptive: { s: 'adj.', t: 'adj. 預先採取行動的' },
  offsite: { s: 'adj. / adv.', t: 'adj. 場外的\nadv. 在辦公或工作場所以外' },
  monetize: { s: 'v.', t: 'v. 將資產或服務轉為收益' },
}));
