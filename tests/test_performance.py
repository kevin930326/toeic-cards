"""第 35 步：效能優化（字卡很多時的速度）

- 單字探索的清單分批畫：一開始 100 個，捲到底或按「顯示更多」再畫下一批；選到的字在後面時會畫到那個字
- 用 id 找字卡改成對照表：刪除、整批取代、新增後都找得到正確的字；刪掉又加回來會清掉刪除紀錄
- 存檔延後並合併：畫面先更新，稍後才寫進瀏覽器；關閉頁面、切到背景前一定存完；存檔失敗會提示
- 3,000 張字卡時的速度不退步（不限 CPU 的寬鬆上限，避免機器差異造成誤判）

用法（先在專案根目錄執行 python -m http.server 8123 --bind 127.0.0.1）：
  python tests/test_performance.py
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

from onboarding_helpers import existing_user

URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8123/')
errors = []


def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        errors.append(msg)


def store(pg, expr):
    return pg.evaluate(f"import('/js/store.js').then((s) => {{ {expr} }})")


def saved_words(pg):
    return json.loads(pg.evaluate("localStorage.getItem('toeic-cards:words')") or '[]')


# 產生 n 個字（單字包第 1～10 組的真實內容，超過 1000 個就加上編號）
SEED = """async (n) => {
  const entries = (await Promise.all(Array.from({ length: 10 }, (_, g) =>
    fetch(`/data/packs/toeic-1000/${String(g + 1).padStart(2, '0')}.json`).then((r) => r.json())))).flatMap((d) => d.entries);
  const words = Array.from({ length: n }, (_, i) => {
    const e = entries[i % entries.length];
    return { id: 'seed' + i, word: e.word + (i >= entries.length ? i : ''), phonetic: e.phonetic || '', pos: e.pos, zh: e.zh, en: e.en,
      examples: e.examples, collocations: e.collocations, forms: e.forms, synonyms: e.synonyms, unfamiliar: false,
      src: {}, lookup: { dictAt: 1, enDone: true }, autoGenerate: false, llm: null, srs: null, part5: [], createdAt: n - i, updatedAt: 1 };
  });
  localStorage.setItem('toeic-cards:words', JSON.stringify(words));
}"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1000, 'height': 900})
    existing_user(ctx)
    ctx.add_init_script('if (window.speechSynthesis) speechSynthesis.speak = () => {};')
    ctx.route('https://api.dictionaryapi.dev/**', lambda r: r.fulfill(status=404, body='{}'))
    pg = ctx.new_page()
    pg.goto(URL + '#/settings')
    pg.wait_for_load_state('networkidle')

    # ---- 單字探索分批畫 ----
    pg.evaluate(SEED, 250)
    pg.goto(URL + '#/cards')
    pg.reload()
    pg.wait_for_selector('.explore-item')
    items = lambda: pg.locator('#exploreList .explore-item').count()
    check(items() == 100 and '還有 150 個' in pg.locator('[data-more]').inner_text(), f'一開始只畫 100 個字，最後有「顯示更多（還有 150 個）」（{items()}）')
    check('250 / 250' in pg.locator('#exploreCount').inner_text(), '上方仍顯示全部 250 個收藏')
    pg.locator('#exploreList').evaluate('(el) => { el.scrollTop = el.scrollHeight; }')
    pg.wait_for_function('() => document.querySelectorAll("#exploreList .explore-item").length === 200')
    check(items() == 200, '捲到清單底部自動再畫 100 個')
    # 鍵盤使用者 Tab 到「顯示更多」：按鈕捲進畫面會自動載入，焦點要移到新出現的第一個字（不能掉回頁首）
    pg.locator('#exploreList .explore-item').nth(199).focus()
    pg.keyboard.press('Tab')
    pg.wait_for_function('() => document.querySelectorAll("#exploreList .explore-item").length === 250')
    pg.wait_for_timeout(100)
    check(pg.locator('[data-more]').count() == 0 and pg.evaluate("document.activeElement.dataset.id") == pg.locator('#exploreList .explore-item').nth(200).get_attribute('data-id'),
          '鍵盤 Tab 到「顯示更多」：載入下一批，焦點移到新出現的第一個字')
    pg.fill('#exploreSearch', 'a')
    pg.fill('#exploreSearch', '')
    pg.wait_for_function('() => document.querySelectorAll("#exploreList .explore-item").length === 100')
    check(items() == 100, '改變搜尋後，清單回到前 100 個')
    pg.locator('#exploreDetail').click(position={'x': 5, 'y': 5})
    for _ in range(120):
        pg.keyboard.press('ArrowRight')
    current = pg.locator('#exploreList [aria-current="true"]')
    check(current.count() == 1 and items() >= 121, f'用「下一字」走到第 121 個字：清單會畫到那個字（{items()} 個）')

    # ---- 用 id 找字卡 ----
    res = store(pg, """const w = s.getWords(); const del = w[5]; s.deleteWord(del.id);
      const afterDelete = s.getWord(del.id);
      const { added } = s.addWords([del.word], { autoGenerate: false });
      const readded = s.getWord(added[0].id)?.word;
      const tombCleared = !(del.word in s.getTombstones());
      s.replaceWords([{ ...w[0], id: 'replaced-1' }]);
      const replaced = s.getWord('replaced-1')?.word === w[0].word && !s.getWord(w[1].id);
      return { afterDelete: afterDelete ?? null, readded: readded === del.word, tombCleared, replaced };""")
    check(res == {'afterDelete': None, 'readded': True, 'tombCleared': True, 'replaced': True},
          f'刪除後找不到、加回來找得到且刪除紀錄被清掉、整批取代後找得到新的字 {res}')

    # ---- 存檔延後、合併、關閉前一定存完 ----
    pg.goto(URL + '#/settings')
    pg.evaluate(SEED, 250)
    pg.reload()
    pg.wait_for_load_state('networkidle')
    res = pg.evaluate("""async () => {
      const s = await import('/js/store.js');
      const read = () => JSON.parse(localStorage.getItem('toeic-cards:words'))[0].unfamiliar;
      let writes = 0; const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (k === 'toeic-cards:words') writes++; return orig.call(this, k, v); };
      const id = s.getWords()[0].id;
      s.updateWord(id, { unfamiliar: true }); s.updateWord(id, { pos: 'n.' }); s.updateWord(id, { unfamiliar: true });
      const immediately = read();
      await new Promise((r) => setTimeout(r, 200));
      const later = read();
      s.updateWord(id, { unfamiliar: false });
      window.dispatchEvent(new Event('pagehide'));
      const afterPagehide = read();
      Storage.prototype.setItem = orig;
      return { immediately, later, writes, afterPagehide };
    }""")
    check(res['immediately'] is False and res['later'] is True, '畫面先更新，稍後才寫進瀏覽器')
    check(res['writes'] == 2, f'同一瞬間的三次修改合併成一次存檔（加上關閉前一次，共 {res["writes"]} 次）')
    check(res['afterPagehide'] is False, '關閉頁面（pagehide）時立刻存完')

    # 改了馬上重新整理，資料也還在
    store(pg, "s.updateWord(s.getWords()[1].id, { unfamiliar: true }); return true;")
    pg.reload()
    pg.wait_for_load_state('networkidle')
    check(saved_words(pg)[1]['unfamiliar'] is True, '修改後立刻重新整理，資料沒有遺失')

    # 存檔失敗會提示
    pg.evaluate("""() => { const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (k === 'toeic-cards:words') throw new DOMException('full', 'QuotaExceededError'); return orig.call(this, k, v); }; }""")
    store(pg, "s.updateWord(s.getWords()[2].id, { unfamiliar: true }); return true;")
    pg.wait_for_selector('#toast.show')
    check('空間不足' in pg.locator('#toast').inner_text(), f'背景存檔失敗時顯示提示：{pg.locator("#toast").inner_text()!r}')
    pg.reload()

    # ---- 3,000 張字卡的速度（寬鬆上限，不限 CPU）----
    pg.goto(URL + '#/settings')
    pg.evaluate(SEED, 3000)
    pg.reload()
    pg.wait_for_load_state('networkidle')
    ms = pg.evaluate("""async () => { const a = performance.now(); location.hash = '#/cards';
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r))); return performance.now() - a; }""")
    check(ms < 400 and pg.locator('#exploreList .explore-item').count() == 100, f'3,000 張字卡：切到單字探索 {ms:.0f} ms（上限 400），只畫 100 個')
    res = store(pg, """const ids = s.getWords().map((w) => w.id).slice(-1000);
      let a = performance.now(); for (const id of ids) s.getWord(id); const lookup = performance.now() - a;
      a = performance.now(); s.updateWord(ids[0], { unfamiliar: true }); const update = performance.now() - a;
      return { lookup: Math.round(lookup * 10) / 10, update: Math.round(update * 10) / 10 };""")
    check(res['lookup'] < 20 and res['update'] < 30, f'3,000 張字卡：找 1,000 個字 {res["lookup"]} ms、改一張卡 {res["update"]} ms（不含背景存檔）')

    ctx.close()
    browser.close()

print()
print('ALL PASSED' if not errors else f'{len(errors)} FAILED')
sys.exit(1 if errors else 0)
