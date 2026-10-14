// 發音：使用瀏覽器內建的語音合成（Web Speech API）
//   - 免費、不需金鑰、不需網路、不用 AI 額度
//   - 聲音來自作業系統／瀏覽器內建的語音，可用的口音和音質依裝置而不同
//
// 多益聽力會出現美式、英式、加拿大、澳洲四種口音；
// 「多益混合」每次隨機挑一種這台裝置有的口音，最接近真實考試
import { getSettings } from './store.js';

export const ACCENTS = [
  { id: 'en-US', label: '美式' },
  { id: 'en-GB', label: '英式' },
  { id: 'en-CA', label: '加拿大' },
  { id: 'en-AU', label: '澳洲' },
];
export const MIXED = 'mixed';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
let voices = [];
const voiceListeners = new Set();

function loadVoices() {
  voices = synth ? synth.getVoices() : [];
  for (const fn of voiceListeners) fn();
}
if (synth) {
  loadVoices();
  // 語音清單常常是非同步載入的（Chrome 一開始會是空的）
  synth.addEventListener?.('voiceschanged', loadVoices);
}

export function canSpeak() {
  return !!synth;
}

export function onVoicesChanged(fn) {
  voiceListeners.add(fn);
  return () => voiceListeners.delete(fn);
}

const normLang = (l) => String(l || '').replace('_', '-').toLowerCase();

// 某個口音可用的語音；品質好的排前面（名稱含 Natural / Online / Google）
function voicesFor(lang) {
  const want = normLang(lang);
  return voices
    .filter((v) => normLang(v.lang) === want)
    .sort((a, b) => quality(b) - quality(a));
}
const quality = (v) => (/natural/i.test(v.name) ? 3 : /online|neural/i.test(v.name) ? 2 : /google/i.test(v.name) ? 1 : 0);

export function accentLabel(id) {
  if (id === MIXED) return '多益混合';
  return ACCENTS.find((a) => a.id === id)?.label || id;
}

// 每種口音在這台裝置上有沒有語音
export function accentAvailability() {
  return ACCENTS.map((a) => {
    const v = voicesFor(a.id)[0];
    return { ...a, available: !!v, voiceName: v ? v.name : '' };
  });
}

// 把設定的口音變成實際要用的口音：「多益混合」→ 隨機挑一種有語音的口音
export function resolveAccent(accent, rng = Math.random) {
  if (accent !== MIXED) return accent || 'en-US';
  const avail = accentAvailability().filter((a) => a.available).map((a) => a.id);
  const pool = avail.length ? avail : ACCENTS.map((a) => a.id);
  return pool[Math.floor(rng() * pool.length)];
}

// 唸出文字；回傳實際使用的 { lang, voice, exact }（exact：有沒有找到該口音的語音）
export function speak(text, { rate, accent } = {}) {
  if (!synth || !text) return null;
  const s = getSettings();
  const lang = resolveAccent(accent || s.accent || 'en-US');
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  const voice = voicesFor(lang)[0];
  if (voice) u.voice = voice;   // 沒有這個口音的語音時，交給瀏覽器用預設的英文語音
  u.rate = rate ?? s.speechRate ?? 0.9;
  synth.cancel();
  synth.speak(u);
  return { lang, voice: voice ? voice.name : '', exact: !!voice };
}

export const speakerIcon = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
