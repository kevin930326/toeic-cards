// 滑卡手勢：手指（或滑鼠）把卡片往左／右拖，超過門檻就算滑出
//
// - 用 Pointer Events，手機觸控和電腦滑鼠都能用
// - 垂直方向的移動交給瀏覽器捲動（CSS 設 touch-action: pan-y）
// - 移動不到 8px 視為「點一下」，由這裡直接呼叫 onTap（不依賴瀏覽器的 click）：
//   Chrome 在快速滑動（fling）後約 1 秒內，會把下一次點擊當成「停止慣性」而不送出 click，
//   導致滑完一張後馬上點下一張卻翻不了面
// - 拖曳之後放開，不會被當成點擊
const TAP_SLOP = 8;
const TAP_MAX_MS = 600;
const FLY_MS = 220;

// onTap(target)：點一下（target 是點到的元素）；有提供時，之後跟著來的 click 會被擋掉避免重複
export function attachSwipe(el, { onSwipe, onDrag, onTap, threshold = 90 }) {
  let active = false;
  let dragging = false;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startT = 0;
  let dx = 0;
  let suppressClickUntil = 0;

  function reset() {
    el.classList.remove('is-dragging');
    el.style.transform = '';
    onDrag?.(0);
  }

  function down(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // 從發音按鈕上開始拖也可以滑卡：沒拖動就是普通的點擊（照常發音），拖動了就會擋掉那次點擊
    if (e.target.closest('input, textarea, select')) return;
    active = true;
    dragging = false;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    startT = performance.now();
    dx = 0;
  }

  function move(e) {
    if (!active || e.pointerId !== pointerId) return;
    const mx = e.clientX - startX;
    const my = e.clientY - startY;
    if (!dragging) {
      if (Math.abs(mx) < TAP_SLOP && Math.abs(my) < TAP_SLOP) return;
      if (Math.abs(my) > Math.abs(mx)) { active = false; return; }   // 是在上下捲動
      dragging = true;
      el.setPointerCapture?.(pointerId);
      el.classList.add('is-dragging');
    }
    dx = mx;
    el.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
    onDrag?.(dx);
  }

  function up(e) {
    if (!active || e.pointerId !== pointerId) return;
    active = false;
    if (!dragging) {
      if (onTap && performance.now() - startT < TAP_MAX_MS) {
        suppressClickUntil = Date.now() + 700;
        onTap(e.target);
      }
      return;
    }
    dragging = false;
    suppressClickUntil = Date.now() + 350;
    const speed = Math.abs(dx) / Math.max(1, performance.now() - startT);   // px/ms
    // 拖超過門檻，或是快速甩一下（threshold 設 Infinity 代表不能滑）
    const passed = Math.abs(dx) > threshold
      || (Number.isFinite(threshold) && Math.abs(dx) > 40 && speed > 0.6);
    if (passed) {
      const dir = dx > 0 ? 'right' : 'left';
      flyOut(el, dir).then(() => onSwipe(dir));
    } else {
      el.classList.remove('is-dragging');
      el.style.transform = '';
      onDrag?.(0);
    }
  }

  function cancel(e) {
    if (e.pointerId !== pointerId) return;
    active = false;
    dragging = false;
    reset();
  }

  function click(e) {
    if (Date.now() < suppressClickUntil) {
      e.stopPropagation();
      e.preventDefault();
    }
  }

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('click', click, true);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
    el.removeEventListener('click', click, true);
  };
}

// 讓卡片往左或右飛出去（按鈕、鍵盤評分時也用同一個動畫）
export function flyOut(el, dir) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return Promise.resolve();
  el.classList.remove('is-dragging');
  el.classList.add('is-flying');
  const x = (dir === 'right' ? 1 : -1) * (window.innerWidth * 0.9 + 200);
  el.style.transform = `translateX(${x}px) rotate(${x / 40}deg)`;
  return new Promise((r) => setTimeout(r, FLY_MS));
}
