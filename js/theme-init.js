// 在畫面出現前套用主題，避免閃一下白色
try {
  const t = JSON.parse(localStorage.getItem('toeic-cards:settings') || '{}').theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {}
