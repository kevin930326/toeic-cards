"""把手機截圖合成 README 用的一張展示圖。

先執行 tests/capture_readme.py 產生 docs/images/readme/ 裡的截圖（尺寸已經統一：
電腦 1000×760、手機 390×760），再執行這支：三張手機截圖並排成 phones.png，
加上圓角＋透明背景（GitHub 淺色、深色主題都好看）。

用法：python tools/make_readme_images.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / 'docs' / 'images' / 'readme'
PHONES = ['phone-review.png', 'phone-explore.png', 'phone-stats.png']
GAP = 40
RADIUS = 28


def rounded(im, radius=RADIUS):
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius, fill=255)
    out = im.convert('RGBA')
    out.putalpha(mask)
    return out


def phones():
    shots = [Image.open(OUT / name) for name in PHONES]
    w, h = shots[0].size
    assert all(s.size == (w, h) for s in shots), '手機截圖尺寸要一致'
    sheet = Image.new('RGBA', (w * len(shots) + GAP * (len(shots) - 1), h), (0, 0, 0, 0))
    for i, s in enumerate(shots):
        sheet.alpha_composite(rounded(s), (i * (w + GAP), 0))
    sheet.save(OUT / 'phones.png', optimize=True)


if __name__ == '__main__':
    phones()
    print('done: phones.png')
