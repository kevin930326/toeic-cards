// 間隔重複（Spaced Repetition）演算法：簡化版 SM-2（Anki 用的演算法的前身）
//
// 這個檔案只有純函式（不碰畫面、不碰儲存），方便單獨測試。
//
// 每個字的複習狀態存在 word.srs（沒有 srs 代表「新字」，還沒學過）：
//   { reps, interval, ease, lapses, due, last }
//   - reps     連續答「會」幾次
//   - interval 目前間隔幾天（0 = 還在短期學習中）
//   - ease     難易係數，答「會」時間隔乘上它；答「不熟」會降低（最低 1.3）
//   - lapses   忘記過幾次
//   - due      下次該複習的時間（毫秒）
//
// 規則：
//   不熟 → 10 分鐘後再出現、連續次數歸零、ease 降 0.2
//   會   → 第 1 次隔 1 天、第 2 次隔 3 天，之後每次 × ease（約 2.5 倍）
//   一天從早上 4 點開始算（半夜 1 點複習還算「昨天」），跟 Anki 一樣

export const MINUTE = 60 * 1000;
export const DAY = 24 * 60 * MINUTE;
export const LEARNING_STEP = 10 * MINUTE;
export const DEFAULT_EASE = 2.5;
export const MIN_EASE = 1.3;
export const DAY_START_HOUR = 4;
export const MASTERED_DAYS = 21;   // 間隔達到 21 天就視為「已熟」，自動取消「不熟」標記

// 「今天」從幾點開始（本地時間早上 4 點）
export function dayStart(now) {
  const d = new Date(now);
  d.setHours(DAY_START_HOUR, 0, 0, 0);
  if (d.getTime() > now) d.setDate(d.getDate() - 1);
  return d.getTime();
}

// 用來當作每日紀錄的 key，例如 '2026-10-14'
export function dayKey(now) {
  const d = new Date(dayStart(now));
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 從某天的開始往後加幾天（用 setDate 避免夏令時間造成差一小時）
function addDays(start, days) {
  const d = new Date(start);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

export function isNew(word) {
  return !word.srs;
}

export function isDue(word, now) {
  return !!word.srs && word.srs.due <= now;
}

// 依答題結果算出新的複習狀態。rating: 'again'（不熟）| 'good'（會）
export function grade(srs, rating, now) {
  const s = srs
    ? { ...srs }
    : { reps: 0, interval: 0, ease: DEFAULT_EASE, lapses: 0 };
  if (rating === 'again') {
    if (srs && srs.interval > 0) s.lapses += 1;   // 已經學會又忘記，才算一次遺忘
    s.reps = 0;
    s.interval = 0;
    s.ease = Math.max(MIN_EASE, round2(s.ease - 0.2));
    s.due = now + LEARNING_STEP;
  } else if (rating === 'good') {
    let interval;
    if (s.reps === 0) interval = 1;
    else if (s.reps === 1) interval = 3;
    else interval = Math.max(s.interval + 1, Math.round(s.interval * s.ease));
    s.reps += 1;
    s.interval = interval;
    s.due = addDays(dayStart(now), interval);
  } else {
    throw new Error(`未知的評分：${rating}`);
  }
  s.last = now;
  return s;
}

const round2 = (n) => Math.round(n * 100) / 100;

// 預覽按下「不熟」「會」之後各隔多久，顯示在按鈕上
export function previewIntervals(srs, now) {
  return {
    again: grade(srs, 'again', now).due - now,
    good: grade(srs, 'good', now).due - dayStart(now),
  };
}

export function formatInterval(ms) {
  if (ms < DAY) {
    const min = Math.round(ms / MINUTE);
    return min < 60 ? `${min} 分鐘` : `${Math.round(min / 60)} 小時`;
  }
  const days = Math.round(ms / DAY);
  if (days < 30) return `${days} 天`;
  if (days < 365) return `${Math.round(days / 30)} 個月`;
  return `${(days / 365).toFixed(1)} 年`;
}

// 建立今天的複習清單：先到期的舊字（越早到期越先），再補新字（越早加入越先）
export function buildQueue(words, now, newLimit) {
  const due = words.filter((w) => isDue(w, now)).sort((a, b) => a.srs.due - b.srs.due);
  const fresh = words
    .filter(isNew)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, Math.max(0, newLimit));
  return [...due, ...fresh].map((w) => w.id);
}

// 首頁顯示用：今天還有幾個字要複習
export function countToday(words, now, newLimit) {
  const due = words.filter((w) => isDue(w, now)).length;
  const fresh = Math.min(words.filter(isNew).length, Math.max(0, newLimit));
  return { due, fresh, total: due + fresh };
}
