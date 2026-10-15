"""測試截圖要存在哪裡。

平常跑測試：存在 tests/screenshots/（不進 git），不會蓋掉開發紀錄裡的截圖。
真的要更新開發紀錄的截圖時，加上環境變數再跑一次那個測試：
  UPDATE_DOC_IMAGES=1 python tests/test_xxx.py
這時才會寫進 docs/images/，再檢查畫面、commit。
"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def doc_shot(name):
    folder = ROOT / ('docs/images' if os.environ.get('UPDATE_DOC_IMAGES') == '1' else 'tests/screenshots')
    folder.mkdir(parents=True, exist_ok=True)
    return str(folder / name)
