"""產生 App 圖示（PWA、iPhone 主畫面、瀏覽器分頁）和網站左上角的標誌。

標誌是「字母牌 T＋C」：墨黑圓角方塊上兩張錯開的字母牌，米白的 T 和陶土色的 C
（TOEIC Cards 的縮寫，像隨手抽出的字卡；設計說明見 docs/decisions.md #126）。

字母用 Fraunces（網站標題字型，SIL Open Font License）opsz 36、粗細 600 的字形外框，
已經轉成 SVG path 存在下面，所以圖示不靠字型載入，每個尺寸都一樣清楚；
再用 Playwright 把 SVG 截圖成 PNG。

用法：
  python tools/make_icons.py
"""
import os
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'icons')
INK, INK_HI = '#1e2422', '#2b322f'   # 墨黑底（左上略亮）
CREAM, CLAY = '#f4efe3', '#c98552'   # 米白 T 牌、陶土 C 牌

# Fraunces 字形外框（字型單位 2000／em；y 已經翻成 SVG 的往下為正）與外框範圍 (xmin, ymin, xmax, ymax)
GLYPH_T = 'M326 -1400L1050 -1400Q1086 -1400 1109 -1409Q1132 -1418 1150 -1427Q1168 -1436 1188 -1436Q1217 -1436 1232.5 -1421.5Q1248 -1407 1257 -1372L1323 -1042Q1329 -1016 1320 -999.5Q1311 -983 1289 -979Q1269 -975 1253 -982.5Q1237 -990 1226 -1013Q1173 -1135 1133.5 -1197.5Q1094 -1260 1055.5 -1283Q1017 -1306 964 -1306L842 -1306L842 -154Q842 -132 854.5 -119Q867 -106 891 -100L950 -87Q989 -75 989 -41Q989 0 935 0L443 0Q415 0 402 -11.5Q389 -23 389 -41Q389 -75 427 -87L487 -100Q511 -106 523.5 -119Q536 -132 536 -154L536 -1306L414 -1306Q362 -1306 323 -1282.5Q284 -1259 244.5 -1196.5Q205 -1134 151 -1013Q141 -990 125 -982.5Q109 -975 89 -979Q67 -983 58.5 -999.5Q50 -1016 55 -1042L121 -1372Q130 -1407 145.5 -1421.5Q161 -1436 190 -1436Q210 -1436 227.5 -1427Q245 -1418 268 -1409Q291 -1400 326 -1400Z'
GLYPH_C = 'M1329 -374Q1328 -301 1288.5 -228Q1249 -155 1176.5 -95Q1104 -35 1002 1Q900 37 771 37Q557 37 401 -56Q245 -149 160.5 -313Q76 -477 76 -690Q76 -852 126.5 -987.5Q177 -1123 268 -1223Q359 -1323 482 -1378.5Q605 -1434 750 -1434Q850 -1434 913 -1414Q976 -1394 1012 -1374Q1048 -1354 1067 -1354Q1091 -1354 1105 -1372Q1119 -1390 1133.5 -1407.5Q1148 -1425 1171 -1425Q1188 -1425 1198.5 -1414.5Q1209 -1404 1217 -1380L1321 -1028Q1328 -1007 1317.5 -990.5Q1307 -974 1286 -970Q1264 -966 1247 -974.5Q1230 -983 1220 -1005Q1165 -1127 1099.5 -1199.5Q1034 -1272 957.5 -1303.5Q881 -1335 793 -1335Q704 -1335 629.5 -1295Q555 -1255 500.5 -1179Q446 -1103 416.5 -997Q387 -891 387 -758Q387 -553 449 -412Q511 -271 619.5 -198Q728 -125 867 -125Q1002 -125 1101 -191.5Q1200 -258 1252 -378Q1262 -399 1274.5 -406.5Q1287 -414 1302 -411Q1316 -409 1322.5 -399.5Q1329 -390 1329 -374Z'
BOX_T, BOX_C = (50, 0, 1329, 1436), (76, -37, 1329, 1434)
UPM = 2000

# 64×64 格子裡的兩張牌：(中心 x, 中心 y, 旋轉角度, 牌色, 字色, 字形, 外框範圍)
TILE_W, TILE_H, TILE_R = 29.44, 32, 3.84
LETTER = 24   # 字的大小（em）
TILES = [
    (23.68, 26.24, -6, CREAM, INK, GLYPH_T, BOX_T),
    (40.32, 37.76, 5, CLAY, CREAM, GLYPH_C, BOX_C),
]


def art(uid):
    """兩張字母牌。後面那張先畫；每張牌下方有一條暗邊和柔和陰影，看得出前後。"""
    s = LETTER / UPM
    parts = [f'<filter id="{uid}s" x="-30%" y="-30%" width="160%" height="160%">'
             f'<feDropShadow dx="0" dy="2.5" stdDeviation="1.9" flood-color="#000" flood-opacity=".3"/></filter>']
    for cx, cy, deg, bg, fg, glyph, (x0, y0, x1, y1) in TILES:
        x, y = cx - TILE_W / 2, cy - TILE_H / 2
        tx = cx - (x0 + x1) / 2 * s
        ty = cy + (y0 + y1) / 2 * s - 0.45
        parts.append(
            f'<g transform="rotate({deg} {cx:g} {cy:g})">'
            f'<rect x="{x:g}" y="{y + 1:g}" width="{TILE_W:g}" height="{TILE_H:g}" rx="{TILE_R:g}" fill="#000" opacity=".28" filter="url(#{uid}s)"/>'
            f'<rect x="{x:g}" y="{y:g}" width="{TILE_W:g}" height="{TILE_H:g}" rx="{TILE_R:g}" fill="{bg}"/>'
            f'<path transform="translate({tx:.2f} {ty:.2f}) scale({s:g})" d="{glyph}" fill="{fg}"/></g>')
    return ''.join(parts)


def svg(rx=14, scale=1.0, uid='b'):
    """rx：圓角（0＝滿版方形）；scale：圖形縮放（maskable 要縮進安全區）；uid：漸層與陰影的 id 前綴。"""
    t = 32 - 32 * scale
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><linearGradient id="{uid}g" x1=".32" y1="0" x2=".68" y2="1"><stop offset="0" stop-color="{INK_HI}"/><stop offset="1" stop-color="{INK}"/></linearGradient></defs>
<rect width="64" height="64" rx="{rx}" fill="url(#{uid}g)"/>
<g transform="translate({t:g} {t:g}) scale({scale:g})">{art(uid)}</g>
</svg>
'''


# (檔名, 尺寸, SVG)
#   一般圖示：圓角、四角透明
#   maskable：Android 會自己裁成圓形或圓角，圖形要在中間 80% 的安全區，背景滿版
#   apple-touch-icon：iPhone 會自己加圓角，不能有透明
ICONS = [
    ('icon-192.png', 192, svg()),
    ('icon-512.png', 512, svg()),
    ('icon-maskable-512.png', 512, svg(rx=0, scale=0.8)),
    ('apple-touch-icon.png', 180, svg(rx=0, scale=0.92)),
    ('favicon-32.png', 32, svg()),
]
FAVICON_SVG = svg()
# 網站左上角的標誌（index.html 直接內嵌；id 另取前綴，避免和頁面其他 SVG 衝突）
BRAND_SVG = svg(uid='brand').replace('<svg ', '<svg class="brand-logo" aria-hidden="true" ', 1)


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for name, size, art_svg in ICONS:
            page = browser.new_page(viewport={'width': size, 'height': size}, device_scale_factor=1)
            sized = art_svg.replace('<svg ', f'<svg width="{size}" height="{size}" style="display:block" ', 1)
            page.set_content(f'<html><body style="margin:0;background:transparent">{sized}</body></html>')
            transparent = 'rx="0"' not in art_svg   # 有圓角的圖示四角要透明
            page.locator('svg').screenshot(path=os.path.join(OUT, name), omit_background=transparent)
            page.close()
            print('saved', name)
        browser.close()
    with open(os.path.join(OUT, 'favicon.svg'), 'w', encoding='utf-8') as f:
        f.write(FAVICON_SVG)
    print('saved favicon.svg')
    with open(os.path.join(ROOT, 'tmp', 'brand-logo.svg'), 'w', encoding='utf-8') as f:
        f.write(' '.join(BRAND_SVG.split()))
    print('saved tmp/brand-logo.svg（貼進 index.html 的 .brand-mark）')


if __name__ == '__main__':
    main()
