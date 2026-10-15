// 手機導覽先讓人看懂步驟，點輸入欄後才叫出鍵盤；平常操作與桌機保留原本焦點行為。
export function focusEntryInput(input, { select = false } = {}) {
  const guidedTouch = matchMedia('(hover: none)').matches && document.getElementById('guidedTour');
  if (guidedTouch) {
    if (document.activeElement?.matches('input, textarea, select')) document.activeElement.blur();
    input.closest('dialog')?.querySelector('[data-close]')?.focus({ preventScroll: true });
    return;
  }
  input.focus();
  if (select) input.select();
}
