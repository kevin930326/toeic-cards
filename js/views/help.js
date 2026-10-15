import { startTour, tourTopics } from '../tour.js?v=tour-keyboard-1';

export function renderHelp(root) {
  document.getElementById('tutorialBanner')?.remove();
  root.innerHTML = `<section class="page page-help"><p class="eyebrow">LEARN BY DOING</p><h1 class="page-title">使用教學</h1>
    <div class="panel"><h2>在真正的畫面，跟著做一次</h2><p>導覽會圈出實際的按鈕，點下去就走正常流程，不用對照示意畫面。可直接操作，也可以略過步驟、隨時結束。</p><p class="hint-text">只有你親自按加入、評分或開始 AI 生成時，才會新增資料、記錄進度或使用額度。導覽不會自動執行這些操作。</p><div class="tutorial-actions"><button class="btn btn-primary" id="tutorialStart" type="button">開始實際操作導覽</button><a class="btn btn-outline" href="#/words?pack=toeic-1000">加入內建單字包</a></div></div>
    <h2>挑一個想了解的功能</h2><div class="tutorial-reference">${Object.entries(tourTopics).filter(([key]) => key !== 'start').map(([key, topic]) => `<article class="panel"><h3>${topic.title}</h3><p>${topic.description}</p><button class="btn btn-outline btn-sm" type="button" data-tour="${key}">帶我操作</button></article>`).join('')}</div>
    <h2>三種學習方式怎麼選？</h2><div class="tutorial-reference"><article class="panel"><h3>今日複習</h3><p>先回想、翻面，再按「會／不熟」。依間隔重複安排下次複習，也計入每日目標。</p><a href="#/review">前往今日複習 →</a></article><article class="panel"><h3>自由翻卡</h3><p>不用等到期就能翻所有收藏，可隨機或只看不熟。不改排程與打卡。</p><a href="#/free">前往自由翻卡 →</a></article><article class="panel"><h3>探索</h3><p>清單搜尋、直接讀雙語解釋、例句與搭配詞，不用翻面。不改排程與打卡。</p><a href="#/cards">前往探索 →</a></article></div>
    <div class="panel"><h2>手機與鍵盤小提醒</h2><ul><li>手機預設點卡片翻面；要查解釋裡的字，先開啟「點字查詢」，換卡後會自動關閉。</li><li>今日複習從卡片中央左滑＝不熟、右滑＝會；自由翻卡左右滑是換字。螢幕邊緣保留給系統上一頁／下一頁。</li><li>桌機空白鍵翻面，左右鍵評分，P 發音，Z 復原；查字用 Ctrl／⌘ K。輸入文字時不會觸發翻卡快捷鍵。</li><li>導覽中可按 Escape 結束，也能從設定重看任一主題。</li></ul></div>
    <div class="panel"><h2>資料、離線與 AI</h2><ul><li>單字包與本機字典不需要金鑰。Part 5、自己新增的詞性題、生成解釋及新短文才需要 Gemini；已存內容可重複使用。</li><li>查不到的字可自己填解釋，保留原本輸入的拼字與變化形。字典收錄不代表所有拼法都有資料。</li><li>未登入時資料在目前瀏覽器；定期到設定匯出 JSON 備份，也可登入同步。金鑰不會同步；短文最多存 20 篇，只留本機。</li><li>加入桌面後可離線讀已存字卡與曾載入的資料；還沒載入的字典、AI 新內容與同步需要網路。</li><li>教學狀態只記在這個瀏覽器，不同步或備份。既有使用者不會因教學更新再次被強制打斷。</li></ul></div></section>`;
  root.querySelector('#tutorialStart').addEventListener('click', () => startTour());
  for (const button of root.querySelectorAll('[data-tour]')) button.addEventListener('click', () => startTour(button.dataset.tour));
  if (new URLSearchParams(location.hash.split('?')[1]).get('tour') === '1') {
    const timer = setTimeout(() => startTour(), 0);
    return () => clearTimeout(timer);
  }
}
