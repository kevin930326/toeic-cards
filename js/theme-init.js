// 在畫面出現前套用主題，避免閃一下白色
try {
  const legacy = JSON.parse(localStorage.getItem('toeic-cards:profiles-v1') || 'null')?.legacyOwner ?? JSON.parse(localStorage.getItem('toeic-cards:syncActive') || '""');
  const owner = JSON.parse(localStorage.getItem('toeic-cards:profileOwner') || JSON.stringify(legacy));
  const key = owner === legacy ? 'toeic-cards:settings' : `toeic-cards:account:${owner ? encodeURIComponent(owner) : '_guest'}:settings`;
  const t = JSON.parse(localStorage.getItem(key) || '{}').theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {}
