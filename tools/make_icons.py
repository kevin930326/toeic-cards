"""產生 App 圖示（PWA、iPhone 主畫面、瀏覽器分頁）。

圖示和網站左上角的標誌一樣：索引卡紅底＋米白色襯線字「T」。
用 Playwright 把一段 HTML 截圖成 PNG，字體和網站同樣是 Fraunces。

用法：
  python tools/make_icons.py
"""
import os
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'icons')
RED = '#c8402f'
CREAM = '#fffdf7'

# (檔名, 尺寸, 圓角比例, 字的大小比例)
#   一般圖示：圓角、四角透明
#   maskable：Android 會自己裁成圓形或圓角，內容要放在中間 80% 的安全區，所以字小一點、背景滿版
#   apple-touch-icon：iPhone 會自己加圓角，不能有透明
ICONS = [
    ('icon-192.png', 192, 0.22, 0.70),
    ('icon-512.png', 512, 0.22, 0.70),
    ('icon-maskable-512.png', 512, 0.0, 0.52),
    ('apple-touch-icon.png', 180, 0.0, 0.66),
    ('favicon-32.png', 32, 0.22, 0.78),
]

HTML = """<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700&display=block" rel="stylesheet">
<style>
  html, body {{ margin: 0; background: transparent; }}
  .icon {{
    width: {size}px; height: {size}px;
    border-radius: {radius}px;
    background: {red};
    display: grid; place-items: center;
    overflow: hidden;
  }}
  .t {{
    font-family: 'Fraunces', Georgia, serif;
    font-weight: 700;
    font-size: {font}px;
    line-height: 1;
    color: {cream};
    transform: translateY(-3%);
  }}
</style></head>
<body><div class="icon"><span class="t">T</span></div></body></html>"""

# 瀏覽器分頁用的向量圖示（不需要載入字型，用通用的襯線字）
FAVICON_SVG = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="{RED}"/>
  <text x="32" y="47" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="46" fill="{CREAM}">T</text>
</svg>
"""


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for name, size, radius, font in ICONS:
            page = browser.new_page(viewport={'width': size, 'height': size}, device_scale_factor=1)
            page.set_content(HTML.format(size=size, radius=round(size * radius), red=RED, cream=CREAM, font=round(size * font)))
            page.wait_for_load_state('networkidle')
            page.evaluate('document.fonts.ready')
            transparent = radius > 0   # 有圓角的圖示四角要透明
            page.locator('.icon').screenshot(path=os.path.join(OUT, name), omit_background=transparent)
            page.close()
            print('saved', name)
        browser.close()
    with open(os.path.join(OUT, 'favicon.svg'), 'w', encoding='utf-8') as f:
        f.write(FAVICON_SVG)
    print('saved favicon.svg')


if __name__ == '__main__':
    main()
