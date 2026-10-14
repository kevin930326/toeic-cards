// 發音：使用瀏覽器內建的語音合成（Web Speech API），免費、不需金鑰
import { getSettings } from './store.js';

const synth = window.speechSynthesis;
let voices = [];

function loadVoices() {
  voices = synth ? synth.getVoices() : [];
}
if (synth) {
  loadVoices();
  synth.addEventListener?.('voiceschanged', loadVoices);
}

export function canSpeak() {
  return !!synth;
}

// 挑選符合口音的英文語音；優先挑品質較好的（名稱含 Google / Natural / Online）
function pickVoice(lang) {
  const matches = voices.filter((v) => v.lang.replace('_', '-').toLowerCase() === lang.toLowerCase());
  const pool = matches.length ? matches : voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  return pool.find((v) => /natural|online|google/i.test(v.name)) || pool[0] || null;
}

export function speak(text, { rate } = {}) {
  if (!synth || !text) return false;
  const { accent, speechRate } = getSettings();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = accent || 'en-US';
  const voice = pickVoice(u.lang);
  if (voice) u.voice = voice;
  u.rate = rate ?? speechRate ?? 0.9;
  synth.cancel();
  synth.speak(u);
  return true;
}

export const speakerIcon = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
