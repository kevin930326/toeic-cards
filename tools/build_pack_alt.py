"""把 tools/pack-alt-meanings.tsv 轉成 data/packs/toeic-1000-alt.json。

python tools/build_pack_alt.py

檢查：字一定要在單字包裡；每個「也譯作」不能和卡片原本的中文重複或太像（規則同 js/meaning-compare.js），
太像的詞會被拿掉並印出來，方便修表。
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VARIANTS = str.maketrans({'污': '汙', '台': '臺', '檯': '臺', '着': '著', '裏': '裡', '綫': '線'})


def terms(text):
    out = []
    for line in text.split('\n'):
        line = re.sub(r'\[[^\]]*\]|（[^）]*）|\([^)]*\)', '', re.sub(r'^[a-z]+\.\s*', '', line.strip()))
        out += [t.strip() for t in re.split(r'[；;，,、]', line) if t.strip()]
    return out


def normalize(term):
    return re.sub(r'[的地]$', '', re.sub(r'^[使被]', '', term.translate(VARIANTS)))


def similar(a, b):
    x, y = normalize(a), normalize(b)
    if not x or not y:
        return False
    if x in y or y in x:
        return True
    return any(x[i:i + 2] in y for i in range(len(x) - 1))


def main():
    pack = {}
    for path in sorted((ROOT / 'data/packs/toeic-1000').glob('*.json')):
        for entry in json.loads(path.read_text(encoding='utf-8'))['entries']:
            pack[entry['word']] = entry['zh']
    alt, dropped = {}, []
    for line in (ROOT / 'tools/pack-alt-meanings.tsv').read_text(encoding='utf-8').splitlines():
        if not line.strip() or line.startswith('#'):
            continue
        word, text = line.split('\t')
        if word not in pack:
            raise SystemExit(f'不在單字包裡：{word}')
        if word in alt:
            raise SystemExit(f'重複：{word}')
        mine = terms(pack[word])
        keep = []
        for term in terms(text)[:3]:
            if any(similar(own, term) for own in mine):
                dropped.append(f'{word}: {term}（卡片：{pack[word]}）')
            elif term not in keep:
                keep.append(term)
        if keep:
            alt[word] = '；'.join(keep)
    data = dict(packId='toeic-1000', version=1,
                note='同一個意思的其他常見中文說法，人工比對 ECDICT 主要釋義與台灣常見教材整理；非官方。',
                alt=dict(sorted(alt.items())))
    (ROOT / 'data/packs/toeic-1000-alt.json').write_text(
        json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{len(alt)} 個字；拿掉 {len(dropped)} 個和卡片太像的詞')
    for item in dropped:
        print('  -', item)


if __name__ == '__main__':
    main()
