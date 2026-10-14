// Gemini API（使用者自己的金鑰，只存在這台電腦的瀏覽器裡）
//
// - 金鑰放在 HTTP 標頭 x-goog-api-key，不會出現在網址裡
// - 所有請求排隊、依「每分鐘請求上限」平均間隔送出，避免撞到免費額度
// - 429（請求太多）會依 Google 建議的等待時間重試；5xx 用退避重試
import { getSettings } from './store.js';

const KEY_STORAGE = 'toeic-cards:gemini-key';
const API = 'https://generativelanguage.googleapis.com/v1beta';
export const FALLBACK_MODEL = 'gemini-flash-latest';

export function getApiKey() {
  try { return localStorage.getItem(KEY_STORAGE) || ''; } catch (e) { return ''; }
}

export function setApiKey(key) {
  const k = String(key || '').trim();
  if (k) localStorage.setItem(KEY_STORAGE, k);
  else localStorage.removeItem(KEY_STORAGE);
}

export function hasApiKey() {
  return !!getApiKey();
}

export function getModel() {
  return getSettings().llmModel || FALLBACK_MODEL;
}

// 錯誤種類：
//   'key'     金鑰無效／沒權限 → 停下來請使用者檢查設定
//   'model'   模型不存在 → 停下來請使用者換模型
//   'quota'   一直 429 → 暫停，稍後再試
//   'network' 連不上
//   'server'  Google 那邊出錯
//   'parse'   回傳的內容不是預期的 JSON
export class LlmError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.kind = kind;
    this.detail = detail;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 限速：兩個請求之間至少間隔 60 秒 / RPM ----
let nextSlot = 0;
let waitListeners = new Set();

export function onRateWait(fn) {
  waitListeners.add(fn);
  return () => waitListeners.delete(fn);
}

async function waitForSlot(signal) {
  const rpm = Math.max(1, Number(getSettings().llmRpm) || 5);
  const gap = Math.ceil(60000 / rpm);
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + gap;
  if (at > now) await waitUntil(at, signal);
}

// 等到某個時間點；期間每秒通知一次剩幾秒（畫面上顯示倒數）
async function waitUntil(at, signal) {
  while (Date.now() < at) {
    if (signal?.aborted) throw new LlmError('aborted', '已停止');
    const left = Math.ceil((at - Date.now()) / 1000);
    for (const fn of waitListeners) fn(left);
    await sleep(Math.min(1000, at - Date.now()));
  }
  for (const fn of waitListeners) fn(0);
}

function parseRetryDelay(body) {
  const info = body?.error?.details?.find((d) => String(d['@type'] || '').includes('RetryInfo'));
  const m = String(info?.retryDelay || '').match(/^([\d.]+)s$/);
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : 0;
}

async function request(path, { method = 'GET', body, signal } = {}) {
  const key = getApiKey();
  if (!key) throw new LlmError('key', '還沒有設定 Gemini API 金鑰');
  let res;
  try {
    res = await fetch(`${API}/${path}`, {
      method,
      headers: { 'x-goog-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw new LlmError('aborted', '已停止');
    throw new LlmError('network', '連不上 Gemini，請檢查網路');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* 有些錯誤沒有 JSON */ }
  if (res.ok) return data;

  const msg = data?.error?.message || `HTTP ${res.status}`;
  const status = data?.error?.status || '';
  if (res.status === 429) {
    const err = new LlmError('quota', '請求太多，已達 Gemini 免費額度的速率或每日上限', msg);
    err.retryDelay = parseRetryDelay(data);
    throw err;
  }
  if (res.status === 404) throw new LlmError('model', `找不到模型「${getModel()}」，請到設定重新選擇`, msg);
  if (res.status === 401 || res.status === 403 || /API key|API_KEY/i.test(msg)) {
    throw new LlmError('key', 'Gemini 金鑰無效或沒有權限，請到設定檢查', msg);
  }
  if (res.status >= 500) throw new LlmError('server', 'Gemini 伺服器暫時出問題', msg);
  throw new LlmError('server', `Gemini 回傳錯誤：${status || res.status}`, msg);
}

// 列出這把金鑰能用的模型（只挑能生成文字的 Gemini 模型）
export async function listModels() {
  const data = await request('models?pageSize=1000');
  return (data?.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => ({ id: m.name.replace(/^models\//, ''), name: m.displayName || m.name }))
    .filter((m) => /^gemini/i.test(m.id) && !/image|tts|audio|live|embedding|vision|robotics|computer/i.test(m.id));
}

// 從清單中挑一個推薦的預設模型：Flash（非 Lite、非預覽版）中版本最新的
export function pickDefaultModel(models) {
  const score = (id) => {
    const v = parseFloat((id.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
    let s = v * 10;
    if (/flash/.test(id)) s += 100;
    if (/lite/.test(id)) s -= 30;
    if (/pro/.test(id)) s -= 200;            // Pro 需要付費
    if (/preview|exp|latest/.test(id)) s -= 5;
    if (/\d{3,}$|-\d{2}-\d{2}/.test(id)) s -= 3; // 帶日期的版本
    return s;
  };
  return [...models].sort((a, b) => score(b.id) - score(a.id))[0]?.id || FALLBACK_MODEL;
}

// 呼叫 Gemini 產生 JSON。會自動限速與重試。
export async function generateJSON({ prompt, schema, signal, maxRetries = 3, temperature = 0.4 }) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: 16384,
      responseMimeType: 'application/json',
      ...(schema ? { responseSchema: schema } : {}),
    },
  };
  let attempt = 0;
  for (;;) {
    await waitForSlot(signal);
    try {
      const data = await request(`models/${encodeURIComponent(getModel())}:generateContent`, { method: 'POST', body, signal });
      const cand = data?.candidates?.[0];
      const text = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
      if (!text) {
        const reason = cand?.finishReason || data?.promptFeedback?.blockReason || '空白回應';
        throw new LlmError('parse', `Gemini 沒有回傳內容（${reason}）`);
      }
      try {
        return { data: JSON.parse(text), finishReason: cand.finishReason };
      } catch (e) {
        const err = new LlmError('parse', 'Gemini 回傳的 JSON 不完整', text.slice(-200));
        err.truncated = cand.finishReason === 'MAX_TOKENS';
        throw err;
      }
    } catch (err) {
      const retryable = err.kind === 'quota' || err.kind === 'server';
      if (!retryable || attempt >= maxRetries) throw err;
      attempt++;
      // 429 照 Google 給的秒數等；沒給就 15、30、60 秒退避
      const wait = (err.retryDelay || 15000 * 2 ** (attempt - 1)) + 500;
      await waitUntil(Date.now() + wait, signal);
    }
  }
}
