"""產生 README 用的展示圖（統一尺寸）。

- 手機截圖：每張裁成 390×760，三張並排成一張圖，圓角＋透明背景
  （GitHub 淺色、深色主題都好看）
- 電腦截圖：高度不一的裁成 1000×760，和其他截圖同樣比例

用法：python tools/make_readme_images.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'docs' / 'images'
OUT = SRC / 'readme'

PHONE = (390, 760)
DESKTOP = (1000, 760)
GAP = 40
RADIUS = 28


def rounded(im, radius=RADIUS):
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius, fill=255)
    out = im.convert('RGBA')
    out.putalpha(mask)
    return out


def crop(name, top, size):
    im = Image.open(SRC / name)
    return im.crop((0, top, size[0], top + size[1]))


def phones():
    shots = [
        crop('05-swipe-mobile.png', 0, PHONE),     # 滑卡
        crop('07-stats-mobile.png', 0, PHONE),     # 統計上半：連續打卡、總覽、熟練度
        crop('07-stats-mobile.png', 893, PHONE),   # 統計下半：每日複習、每日測驗圖表
    ]
    w = PHONE[0] * len(shots) + GAP * (len(shots) - 1)
    sheet = Image.new('RGBA', (w, PHONE[1]), (0, 0, 0, 0))
    for i, s in enumerate(shots):
        sheet.alpha_composite(rounded(s), (i * (PHONE[0] + GAP), 0))
    sheet.save(OUT / 'phones.png', optimize=True)


def desktop():
    crop('03-batch-preview.png', 0, DESKTOP).save(OUT / 'batch.png', optimize=True)


if __name__ == '__main__':
    OUT.mkdir(exist_ok=True)
    phones()
    desktop()
    print('done:', sorted(p.name for p in OUT.iterdir()))
