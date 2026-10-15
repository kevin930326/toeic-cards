// 翻面字卡的查字模式只留在這一頁、這一張；探索頁仍可直接點字。
export function createCardLookupMode() {
  const touch = navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;
  let key = null, enabled = false;
  return {
    get enabled() { return !touch || enabled; },
    get lookupOnly() { return touch && enabled; },
    get touch() { return touch; },
    prepare(nextKey) { if (nextKey !== key) { key = nextKey; enabled = false; } },
    reset() { enabled = false; },
    toggle() { enabled = !enabled; },
    html() {
      return touch ? `<div class="card-lookup-tools">
        <button class="btn btn-outline btn-sm" id="cardLookupToggle" type="button" aria-pressed="${enabled}" aria-controls="card">${enabled ? '關閉點字查詢' : '開啟點字查詢'}</button>
        <p class="hint-text" role="status">${enabled ? '點英文查意思；關閉查詢後可點卡片翻面。' : '點卡片翻面；要查英文時，先開啟點字查詢。'}</p>
      </div>` : '';
    },
  };
}
