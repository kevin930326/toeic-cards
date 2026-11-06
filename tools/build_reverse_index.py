"""從既有中文字典產生「中文 → 英文」反查索引；不下載資料、不呼叫 AI。

python tools/build_reverse_index.py data/raw/ecdict.csv data/dict

來源：常用字典 a.json～z.json（ECDICT 經 OpenCC 轉繁體）＋多益 1000 單字包的中文。
每個中文詞依「出現的每個字」分到 256 個分片（Unicode 碼位 % 256），
每個字只留排名前 300 個詞，前端讀查詢中每個字（最多 4 個）的分片後合併，
找出「包含」這串中文的詞。
"""
import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

BUCKETS = 256
PER_CHAR = 300   # 每個字最多保留排名前 300 個詞；查多字時前端會合併每個字的分片
POS = re.compile(r'^(?:n|v|vt|vi|adj|adv|a|prep|conj|pron|int|interj|num|art|aux|abbr|pl|s|ad)\.\s*', re.I)
BRACKETS = re.compile(r'\[[^\]]*\]|\([^)]*\)|（[^）]*）|<[^>]*>|〔[^〕]*〕')
SPLIT = re.compile(r'[；;，,、/]')
CJK = re.compile(r'[㐀-鿿]')
LATIN = re.compile(r'[A-Za-z0-9]')
# 人名、地名等專名不適合反查成一般單字
PROPER = ('男子名', '女子名', '人名', '姓氏', '地名', '城市', '州名', '國名')


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def terms_of(text, max_lines=4):
    """把字典釋義拆成短中文詞：去詞性、括號註解與縮寫行，用分號／逗號切開。"""
    out = []
    for line in text.split('\n')[:max_lines]:
        line = line.strip()
        if not line or line.startswith('abbr.') or line.startswith('[網路]') or line.startswith('[網絡]'):
            continue
        if any(mark in line for mark in PROPER):
            continue
        line = POS.sub('', line)
        line = BRACKETS.sub('', line)
        for term in SPLIT.split(line):
            term = term.strip(' .…·~～"“”‘’')
            if not term or LATIN.search(term) or not CJK.search(term) or len(term) > 10:
                continue
            if term not in out:
                out.append(term)
    return out


def main(source, dictionary):
    directory = Path(dictionary)
    common = {}
    for path in sorted(directory.glob('?.json')):
        common.update(json.loads(path.read_text(encoding='utf-8')))
    pack = {}
    for path in sorted((directory.parent / 'packs' / 'toeic-1000').glob('*.json')):
        for entry in json.loads(path.read_text(encoding='utf-8'))['entries']:
            pack[entry['word']] = entry.get('zh', '')

    ranks, tiers = {}, {}
    with open(source, encoding='utf-8', newline='') as handle:
        for row in csv.DictReader(handle):
            word = row['word']
            if word not in common:
                continue
            # 詞頻以 COCA（frq，現代美式）為主，沒有才用 BNC
            frq, bnc = int(row['frq'] or 0), int(row['bnc'] or 0)
            ranks[word] = frq or bnc or 99_999
            collins = int(row['collins'] or 0)
            tiers[word] = 1 if row['oxford'] == '1' or collins >= 3 else 2 if row['tag'] or collins else 3

    def rank(word):
        """排名分數，越小越前面：等級 × 100000 ＋ 詞頻名次。
        等級 1 多益單字包、牛津核心或柯林斯三星以上，2 考試字表，3 其他（冷僻字，前端會退一級）。
        多益單字包的字詞頻名次再除以 4，同等級裡排前面。"""
        tier = 1 if word in pack else tiers.get(word, 3)
        if ' ' in word or '-' in word:
            tier = max(tier, 2)
        position = min(ranks.get(word, 99_999), 99_999)
        return tier * 100_000 + (position // 4 if word in pack else position)

    # (中文詞, 英文字) → 最好的「第幾個意思」
    pairs = {}
    for word in sorted(set(common) | set(pack)):
        if not re.fullmatch(r"[a-z][a-z' -]*", word):
            continue
        terms = terms_of(pack[word], 2) if word in pack else []
        terms += [t for t in terms_of(common.get(word, {}).get('t', '')) if t not in terms]
        for position, term in enumerate(terms[:12]):
            key = (term, word)
            pairs[key] = min(pairs.get(key, 99), position)

    shards = defaultdict(lambda: defaultdict(list))
    for (term, word), position in pairs.items():
        for char in set(term):
            if CJK.match(char):
                shards[ord(char) % BUCKETS][char].append((term, word, rank(word), position))

    dest = directory / 'reverse-v1'
    dest.mkdir(exist_ok=True)
    for old in dest.glob('*.json'):
        old.unlink()
    sizes = []
    for bucket in range(BUCKETS):
        data = {}
        for char, items in sorted(shards[bucket].items()):
            # 每個詞：[中文, 英文, 排名分數]；分數已含意思順序（後面的意思每個 +5000），前端直接比大小
            items.sort(key=lambda item: (item[2] + item[3] * 5000, item[0], item[1]))
            data[char] = [[term, word, score + position * 5000] for term, word, score, position in items[:PER_CHAR]]
        blob = encode(data)
        (dest / f'{bucket:02x}.json').write_bytes(blob)
        sizes.append(len(blob))
    meta = dict(version=1, source='ECDICT common subset + TOEIC 1000 pack (zh)', buckets=BUCKETS,
                pairs=len(pairs), words=len({w for _, w in pairs}), bytes=sum(sizes), max_bytes=max(sizes),
                per_char=PER_CHAR, shard='ord(CJK char) % 256, two-digit hex; merge shards of each query char')
    (dest / 'meta.json').write_bytes(encode(meta))
    print(json.dumps(meta, ensure_ascii=False))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
