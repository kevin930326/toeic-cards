// 學習統計的計算（純函式，不碰畫面、不碰儲存，方便單獨測試）
//   log：每日紀錄 { 'YYYY-MM-DD': { reviews, again, good, learned, quiz, quizCorrect } }（見 log.js）
//   words：單字陣列（看 srs 判斷熟練度）
import { dayKey, dayStart, DAY, MASTERED_DAYS } from './srs.js';

export const FAMILIAR_DAYS = 7;   // 間隔 7 天以上算「熟悉中」，21 天以上算「已熟」

const n = (v) => Number(v) || 0;

export function isActive(day) {
  return !!day && (n(day.reviews) > 0 || n(day.quiz) > 0);
}

// 那一天有沒有「打卡」：複習＋測驗題數達到當天的目標
//   當天紀錄裡有 goal 就用它（之後改目標不影響過去）；舊資料沒有 goal 時用目前的目標
export function goalMet(day, fallbackGoal) {
  if (!day) return false;
  const goal = n(day.goal) || n(fallbackGoal) || 1;
  return n(day.reviews) + n(day.quiz) >= goal;
}

// 從今天往回數 count 天的 key（舊 → 新），用 setDate 避免夏令時間差一小時
export function lastDayKeys(now, count) {
  const keys = [];
  const start = new Date(dayStart(now));
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(start);
    d.setDate(d.getDate() - i);
    keys.push(dayKey(d.getTime() + 60 * 1000));   // +1 分鐘：避免剛好落在換日時間點
  }
  return keys;
}

// 連續打卡天數：今天已達標就從今天算；今天還沒達標，從昨天算（今天還有機會延續）
//   今天一律用「目前的目標」（今天改目標要立刻生效）；過去的日子用當天記下的目標
export function streak(log, now, goal) {
  const todayKey = dayKey(now);
  const todayDone = goalMet(log[todayKey] && { ...log[todayKey], goal }, goal);
  let days = 0;
  const start = new Date(dayStart(now));
  if (!todayDone) start.setDate(start.getDate() - 1);
  for (;;) {
    const k = dayKey(start.getTime() + 60 * 1000);
    const day = k === todayKey && log[k] ? { ...log[k], goal } : log[k];
    if (!goalMet(day, goal)) break;
    days++;
    start.setDate(start.getDate() - 1);
  }
  return { days, todayDone };
}

// 歷史上最長的連續打卡天數
export function longestStreak(log, goal) {
  const keys = Object.keys(log).filter((k) => goalMet(log[k], goal)).sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const k of keys) {
    const t = Date.UTC(...k.split('-').map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))));
    run = prev !== null && t - prev === DAY ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}

// 每天的數據（畫圖用），沒有紀錄的日子補 0
export function dailySeries(log, now, count) {
  return lastDayKeys(now, count).map((key) => {
    const d = log[key] || {};
    const [, m, day] = key.split('-');
    return {
      key,
      label: `${Number(m)}/${Number(day)}`,
      reviews: n(d.reviews),
      good: n(d.good),
      again: n(d.again),
      learned: n(d.learned),
      quiz: n(d.quiz),
      quizCorrect: n(d.quizCorrect),
      quizWrong: Math.max(0, n(d.quiz) - n(d.quizCorrect)),
    };
  });
}

export function totals(series) {
  const t = { reviews: 0, good: 0, again: 0, learned: 0, quiz: 0, quizCorrect: 0, activeDays: 0 };
  for (const d of series) {
    for (const k of ['reviews', 'good', 'again', 'learned', 'quiz', 'quizCorrect']) t[k] += d[k];
    if (d.reviews || d.quiz) t.activeDays++;
  }
  t.accuracy = t.quiz ? t.quizCorrect / t.quiz : null;
  return t;
}

// 熟練度分組（依複習間隔）
export const MASTERY_LEVELS = [
  { key: 'new', label: '新字', desc: '還沒複習過' },
  { key: 'learning', label: '學習中', desc: `間隔少於 ${FAMILIAR_DAYS} 天` },
  { key: 'familiar', label: '熟悉中', desc: `間隔 ${FAMILIAR_DAYS}–${MASTERED_DAYS - 1} 天` },
  { key: 'mastered', label: '已熟', desc: `間隔 ${MASTERED_DAYS} 天以上` },
];

export function masteryLevel(word) {
  if (!word.srs) return 'new';
  const iv = n(word.srs.interval);
  if (iv >= MASTERED_DAYS) return 'mastered';
  if (iv >= FAMILIAR_DAYS) return 'familiar';
  return 'learning';
}

export function masteryBuckets(words) {
  const b = { new: 0, learning: 0, familiar: 0, mastered: 0 };
  for (const w of words) b[masteryLevel(w)]++;
  return b;
}

// 未來幾天各有幾個字到期（已經過期的算在今天）
export function forecast(words, now, count = 7) {
  const start = dayStart(now);
  const bounds = [];
  for (let i = 0; i <= count; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    bounds.push(d.getTime());
  }
  const out = Array.from({ length: count }, (_, i) => {
    const d = new Date(bounds[i] + 60 * 1000);
    return { key: dayKey(d.getTime()), label: i === 0 ? '今天' : i === 1 ? '明天' : `${d.getMonth() + 1}/${d.getDate()}`, due: 0 };
  });
  for (const w of words) {
    if (!w.srs) continue;
    const due = n(w.srs.due);
    if (due < bounds[1]) { out[0].due++; continue; }
    for (let i = 1; i < count; i++) {
      if (due < bounds[i + 1]) { out[i].due++; break; }
    }
  }
  return out;
}

// 座標軸用的「好看的」最大值與刻度：1、2、5 × 10 的次方，最多 4 格
// 次數一定是整數，所以刻度間距至少是 1（不會出現 0.5 次）
export function niceScale(max, maxTicks = 4) {
  if (!(max > 0)) return { max: 4, ticks: [0, 1, 2, 3, 4] };
  const raw = max / maxTicks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw));
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { max: top, ticks };
}
