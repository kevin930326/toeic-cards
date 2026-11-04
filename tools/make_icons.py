"""產生 App 圖示（PWA、iPhone 主畫面、瀏覽器分頁）。

標誌是「書本 T」：橫畫是攤開的書頁、直畫是陶土色書籤（設計說明見 docs/decisions.md #125）。
全部用 SVG 幾何圖形畫，不靠字型，所以每個尺寸都一樣清楚；再用 Playwright 把 SVG 截圖成 PNG。
大尺寸（App 圖示）用有頁緣細線的完整版；32px 以下和網站左上角用去掉細線、筆畫較粗的小尺寸版。

用法：
  python tools/make_icons.py
"""
import os
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'icons')
GREEN, GREEN_HI = '#24545c', '#2e6670'   # 墨綠底（上方略亮，像檯燈照下來）
CREAM, CREAM_SHADE = '#f4efe3', '#e3ddcf'  # 左頁、右頁（右頁暗一點，看得出中縫）
CLAY = '#c98552'                           # 陶土色書籤

# 64×64 格子裡的圖形
DETAIL = f'''<path d="M27.6 24h8.8v26.4l-4.4-4.3-4.4 4.3z" fill="{CLAY}"/>
<path d="M27.6 27.2h8.8v2.4h-8.8z" fill="#000" opacity=".16"/>
<path d="M32 20.2C26.3 16.6 18.4 15.9 10.6 17.6v9.6c7.6-1.5 15.4-.8 21.4 2.8z" fill="{CREAM}"/>
<path d="M32 20.2c5.7-3.6 13.6-4.3 21.4-2.6v9.6c-7.6-1.5-15.4-.8-21.4 2.8z" fill="{CREAM_SHADE}"/>
<path d="M13.4 22.4c6.5-1.1 12.8-.5 17.6 2.2M51 22.4c-6.5-1.1-12.8-.5-17.6 2.2" fill="none" stroke="{GREEN}" stroke-width="1.1" stroke-linecap="round" opacity=".28"/>
<path d="M32 20.2V30" stroke="{GREEN}" stroke-width="1.2" opacity=".35"/>'''
SIMPLE = f'''<path d="M27 24h10v27l-5-4.6-5 4.6z" fill="{CLAY}"/>
<path d="M32 20C26 16.3 17.8 15.6 9.5 17.4v10.4c8-1.5 16.2-.8 22.5 3z" fill="{CREAM}"/>
<path d="M32 20c6-3.7 14.2-4.4 22.5-2.6v10.4c-8-1.5-16.2-.8-22.5 3z" fill="{CREAM_SHADE}"/>'''


def svg(art, rx=15, scale=1.0, gid='g'):
    """rx：圓角（0＝滿版方形）；scale：圖形縮放（maskable 要縮進安全區）。"""
    t = (32 - 32 * scale)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><linearGradient id="{gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{GREEN_HI}"/><stop offset="1" stop-color="{GREEN}"/></linearGradient></defs>
<rect width="64" height="64" rx="{rx}" fill="url(#{gid})"/>
<g transform="translate({t:g} {t:g}) scale({scale:g})">{art}</g>
</svg>
'''


# (檔名, 尺寸, SVG)
#   一般圖示：圓角、四角透明
#   maskable：Android 會自己裁成圓形或圓角，圖形要在中間 80% 的安全區，背景滿版
#   apple-touch-icon：iPhone 會自己加圓角，不能有透明
ICONS = [
    ('icon-192.png', 192, svg(DETAIL)),
    ('icon-512.png', 512, svg(DETAIL)),
    ('icon-maskable-512.png', 512, svg(DETAIL, rx=0, scale=0.78)),
    ('apple-touch-icon.png', 180, svg(DETAIL, rx=0, scale=0.9)),
    ('favicon-32.png', 32, svg(SIMPLE)),
]
FAVICON_SVG = svg(SIMPLE)
# 網站左上角的標誌（index.html 直接內嵌；漸層 id 另取名，避免和頁面其他 SVG 衝突）
BRAND_SVG = svg(SIMPLE, rx=15, gid='brandGrad').replace('<svg ', '<svg class="brand-logo" aria-hidden="true" ', 1)


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for name, size, art in ICONS:
            page = browser.new_page(viewport={'width': size, 'height': size}, device_scale_factor=1)
            page.set_content(f'<html><body style="margin:0;background:transparent">{art.replace("<svg ", f"<svg width=\"{size}\" height=\"{size}\" style=\"display:block\" ", 1)}</body></html>')
            transparent = 'rx="0"' not in art   # 有圓角的圖示四角要透明
            page.locator('svg').screenshot(path=os.path.join(OUT, name), omit_background=transparent)
            page.close()
            print('saved', name)
        browser.close()
    with open(os.path.join(OUT, 'favicon.svg'), 'w', encoding='utf-8') as f:
        f.write(FAVICON_SVG)
    print('saved favicon.svg')
    print('brand svg（貼進 index.html 的 .brand-mark）：')
    print(' '.join(BRAND_SVG.split()))


if __name__ == '__main__':
    main()
