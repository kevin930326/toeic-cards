// 共用閱讀內容；翻面字卡用於複習，探索頁直接顯示雙語內容。
import { esc, zhLines } from './ui.js';
import { canSpeak, speakerIcon, speak } from './speech.js';
import { isLookingUp } from './dictionary.js';
import { isGenerating } from './generate.js';

const chips = (list) => `<p class="chips">${list.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</p>`;

// 可以點來發音的搭配詞（按鈕）
const speakChips = (list) => canSpeak()
  ? `<p class="chips">${list.map((c) => `<button type="button" class="chip chip-speak" data-speak-text="${esc(c)}" aria-label="播放「${esc(c)}」">${esc(c)}<span class="chip-icon" aria-hidden="true">${speakerIcon}</span></button>`).join('')}</p>`
  : chips(list);

const miniSpeak = (text) => canSpeak()
  ? `<button type="button" class="mini-speak" data-speak-text="${esc(text)}" aria-label="播放例句">${speakerIcon}</button>`
  : '';

// 卡片被點一下時：點到發音按鈕就發音，否則翻面（「複習」和「字卡」頁共用）
export function handleCardTap(target, word, flip) {
  const sp = target.closest('[data-speak-text]');
  if (sp) { speak(sp.dataset.speakText); return; }
  if (target.closest('[data-speak]')) { speak(word.word); return; }
  flip();
}

export function backHTML(w, mode) {
  const empty = isLookingUp(w.id) || isGenerating(w.id)
    ? `<p class="back-empty">${isGenerating(w.id) ? 'AI 生成中…' : '查字典中…'}</p>`
    : mode === 'both' ? '<p class="hint-text">尚無中文詞義，可用「編輯內容」補充。</p>'
      : '<p class="back-empty">還沒有資料<br><span>點下方「編輯」手動填寫</span></p>';
  let main;
  if (mode === 'zh' || mode === 'both') {
    const lines = zhLines(w.zh);
    const inlinePos = lines.some((l) => l.pos);
    main = lines.length
      ? `${mode !== 'both' && !inlinePos && w.pos ? `<p class="back-pos">${esc(w.pos)}</p>` : ''}
         <div class="back-zh ${lines.length > 1 ? 'multi' : ''}">${lines.map((l) => `
           <p>${l.pos || (mode === 'both' && !inlinePos && w.pos) ? `<span class="zh-pos">${esc(l.pos || w.pos)}</span>` : ''}${esc(l.text)}</p>`).join('')}</div>`
      : empty;
  } else {
    main = w.en
      ? `${w.pos ? `<p class="back-pos">${esc(w.pos)}</p>` : ''}<p class="back-en">${esc(w.en)}</p>`
      : empty;
  }
  if (mode === 'both') main = `<div class="explore-definition"><h3>中文詞義</h3>${main}</div>
    <div class="explore-definition"><h3>英文解釋</h3>${w.en ? `<p class="back-en" lang="en">${w.pos ? `<span class="zh-pos">${esc(w.pos)}</span>` : ''}${esc(w.en)}</p>` : '<p class="hint-text">尚無英文解釋，可用「編輯內容」補充。</p>'}</div>`;
  const extras = [];
  if (w.examples.length) {
    extras.push(`<div class="extra"><h3>例句</h3>${w.examples.map((e) => `
      <p class="ex-en">${esc(e.en)}${miniSpeak(e.en)}</p>${e.zh ? `<p class="ex-zh">${esc(e.zh)}</p>` : ''}`).join('')}</div>`);
  }
  if (w.collocations.length) extras.push(`<div class="extra"><h3>常見搭配</h3>${speakChips(w.collocations)}</div>`);
  if (w.forms.length || w.synonyms.length) {
    extras.push(`<div class="extra">
      ${w.forms.length ? `<h3>詞性變化</h3>${chips(w.forms)}` : ''}
      ${w.synonyms.length ? `<h3>同義詞</h3>${chips(w.synonyms)}` : ''}
    </div>`);
  }
  return `<div class="back-main">${main}</div>${extras.length ? `<div class="extras">${extras.join('')}</div>` : ''}`;
}

// 一張完整的卡片（含正反面）。corner：正面左上角的小字
export function flashcardHTML(w, { flipped, mode, corner, hint = '點一下翻面' }) {
  return `
    <div class="flashcard ${flipped ? 'is-flipped' : ''} ${w.unfamiliar ? 'is-unfamiliar' : ''}" id="card"
      role="button" tabindex="0" aria-label="${esc(w.word)}，按一下翻面">
      <div class="card-face card-front">
        <span class="card-corner">${esc(corner)}</span>
        ${w.unfamiliar ? '<span class="stamp">不熟</span>' : ''}
        <p class="headword">${esc(w.word)}</p>
        ${w.phonetic ? `<p class="phonetic">${esc(w.phonetic)}</p>` : ''}
        ${canSpeak() ? `<button class="icon-btn speak-btn" type="button" data-speak aria-label="播放 ${esc(w.word)} 的發音" title="發音">${speakerIcon}</button>` : ''}
        <p class="hint">${esc(hint)}</p>
      </div>
      <div class="card-face card-back">
        <span class="card-corner">${esc(w.word)}</span>
        ${backHTML(w, mode)}
      </div>
    </div>`;
}

// 滑卡時浮現的「會／不熟」標籤（放在卡片外層，翻面時才不會跟著鏡像）
export const swipeLabelsHTML = `
  <div class="swipe-label swipe-good" aria-hidden="true">會 ✓</div>
  <div class="swipe-label swipe-again" aria-hidden="true">✗ 不熟</div>`;

export function modeToggleHTML(cardMode) {
  return `
    <div class="segmented" role="radiogroup" aria-label="背面顯示">
      <label class="seg"><input type="radio" name="mode" value="zh" ${cardMode === 'zh' ? 'checked' : ''}><span>中文</span></label>
      <label class="seg"><input type="radio" name="mode" value="en" ${cardMode === 'en' ? 'checked' : ''}><span>English</span></label>
    </div>`;
}
