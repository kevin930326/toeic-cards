"""從 ECDICT 原始 CSV 產生「中文 → 英文」反查索引；不下載資料、不呼叫 AI。

python tools/build_reverse_index.py data/raw/ecdict.csv data/dict

收錄：常用字典 a.json～z.json 的字、多益 1000 單字包的字、常用字組成的片語（如 check out），
      以及 tools/reverse-extra.tsv 的台灣常用說法（字典沒收的退房、外帶、打卡…）。
中文：用 CSV 的完整釋義（不像常用字典只留四行），含 [網路] 釋義（排序較後）；
      同時用 OpenCC s2twp（台灣用詞，菜单→選單）與 s2tw（只轉字，菜单→菜單）兩種轉法，兩種說法都查得到。
分片：中文詞裡每個字都登記一次，依碼位 % 512 分檔，每字保留排名前 PER_CHAR 個；
      前端讀查詢中每個字的分片後合併。另產生 s2t.json 簡體→繁體字對照，讓簡體輸入也查得到。
"""
import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import opencc

BUCKETS = 512
PER_CHAR = 400
PER_CHAR_RARE = 60     # 冷僻字（等級 3）每個中文字最多留 60 個，控制檔案大小
WEB_PENALTY = 6          # [網路] 釋義當作排在第 6 個意思之後
POS_RE = re.compile(r'^([a-z]+\.)(?:\s*(?:&|/)\s*[a-z]+\.)?\s*', re.I)
BRACKETS = re.compile(r'\[[^\]]*\]|\([^)]*\)|（[^）]*）|<[^>]*>|〔[^〕]*〕|【[^】]*】')
SPLIT = re.compile(r'[；;，,、/]')
CJK = re.compile(r'[㐀-鿿]')
LATIN = re.compile(r'[A-Za-z0-9]')
PROPER = ('男子名', '女子名', '人名', '姓氏', '地名', '城市', '州名', '國名', '男名', '女名')
POS_FIX = {'a.': 'adj.', 'ad.': 'adv.'}


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def senses(text):
    """把一筆 CSV 釋義拆成 [(中文詞, 詞性, 第幾個意思)]；跳過縮寫與專名。"""
    out, position = [], 0
    for raw in text.replace('\\n', '\n').split('\n'):
        line = raw.strip()
        if not line or line.startswith('abbr.') or any(mark in line for mark in PROPER):
            continue
        web = line.startswith('[網路]') or line.startswith('[網絡]')
        m = POS_RE.match(line)
        pos = POS_FIX.get(m.group(1).lower(), m.group(1).lower()) if m else ''
        body = BRACKETS.sub('', POS_RE.sub('', line))
        for term in SPLIT.split(body):
            term = term.strip(' .…·~～"“”‘’')
            if not term or LATIN.search(term) or not CJK.search(term) or len(term) > 10:
                continue
            out.append((term, pos, position + (WEB_PENALTY if web else 0)))
            position += 1
    return out


def main(source, dictionary):
    directory = Path(dictionary)
    common = set()
    for path in directory.glob('?.json'):
        common.update(json.loads(path.read_text(encoding='utf-8')))
    pack = {}
    for path in sorted((directory.parent / 'packs' / 'toeic-1000').glob('*.json')):
        for entry in json.loads(path.read_text(encoding='utf-8'))['entries']:
            pack[entry['word']] = entry
    twp, tw = opencc.OpenCC('s2twp'), opencc.OpenCC('s2tw')

    def wanted(word):
        if word in common or word in pack:
            return True
        # 由核心字組成、三個字以內的片語：check out、interest rate
        parts = re.split(r'[ -]', word)
        return 1 < len(parts) <= 3 and all(part in core for part in parts)

    with open(source, encoding='utf-8', newline='') as handle:
        all_rows = list(csv.DictReader(handle))
    # 片語的每個字都要是核心字（牛津核心或柯林斯有星），避免收進大量專業術語
    core = {row['word'] for row in all_rows if row['oxford'] == '1' or int(row['collins'] or 0) > 0}
    rows = {}
    for row in all_rows:
        word = row['word']
        if re.fullmatch(r"[a-z][a-z' -]*", word) and row['translation'].strip() and wanted(word):
            rows[word] = row

    def rank(word):
        """排名分數，越小越前面：等級 × 100000 ＋ 詞頻名次（COCA 為主，沒有才用 BNC）。
        等級 1 多益單字包、牛津核心或柯林斯三星以上，2 考試字表或常用字，3 其他（冷僻字，前端會退一級）。
        多益單字包的字詞頻名次再除以 4，同等級裡排前面。"""
        row = rows.get(word, {})
        frq, bnc = int(row.get('frq') or 0), int(row.get('bnc') or 0)
        position = min(frq or bnc or 99_999, 99_999)
        collins = int(row.get('collins') or 0)
        if word in pack or row.get('oxford') == '1' or collins >= 3:
            tier = 1
        elif row.get('tag') or collins or word in common:
            tier = 2
        else:
            tier = 3
        if (' ' in word or '-' in word) and tier < 2:
            tier = 2
        return tier * 100_000 + (position // 4 if word in pack else position)

    # (中文詞, 英文字) → (第幾個意思, 詞性)
    pairs = {}

    def add(term, word, position, pos):
        key = (term, word)
        if term and (key not in pairs or position < pairs[key][0]):
            pairs[key] = (position, pos)

    for word in sorted(set(rows) | set(pack)):
        if word in pack:
            zh = BRACKETS.sub('', pack[word].get('zh', ''))
            for i, term in enumerate(t.strip() for t in SPLIT.split(zh) if CJK.search(t)):
                add(term, word, i, pack[word].get('pos', ''))
        if word in rows:
            simplified = rows[word]['translation']
            for converter in (twp, tw):
                for term, pos, position in senses(converter.convert(simplified)):
                    add(term, word, position, pos)

    # 補充詞表：字典沒收的台灣常用說法，排在等級 1、依表中順序
    extra = {}
    for line in (Path(__file__).parent / 'reverse-extra.tsv').read_text(encoding='utf-8').splitlines():
        if not line.strip() or line.startswith('#'):
            continue
        term, words = line.split('	')
        for i, word in enumerate(w.strip() for w in words.split(',')):
            pairs[(term.strip(), word)] = (0, '')
            extra[(term.strip(), word)] = 100_000 + i * 2000

    shards = defaultdict(lambda: defaultdict(list))
    for (term, word), (position, pos) in pairs.items():
        if (term, word) in extra:
            for char in set(term):
                if CJK.match(char):
                    shards[ord(char) % BUCKETS][char].append((extra[(term, word)], term, word, pos, False))
            continue
        base = rank(word)
        score = base + position * 5000
        for char in set(term):
            if CJK.match(char):
                shards[ord(char) % BUCKETS][char].append((score, term, word, pos, base >= 300_000))

    dest = directory / 'reverse-v1'
    dest.mkdir(exist_ok=True)
    for old in dest.glob('*.json'):
        old.unlink()
    sizes = []
    for bucket in range(BUCKETS):
        data = {}
        for char, items in sorted(shards[bucket].items()):
            items.sort()
            # 冷僻字與片語只留中文詞最短的幾個（短詞最可能剛好等於使用者輸入，例如「利率」→ interest rate）
            rare = set(sorted((item for item in items if item[4]), key=lambda item: (len(item[1]), item[0]))[:PER_CHAR_RARE])
            kept = [item for item in items if not item[4] or item in rare][:PER_CHAR]
            # 每個詞：[中文, 英文, 排名分數, 詞性]；分數已含意思順序（後面的意思每個 +5000）
            data[char] = [[term, word, score, pos] for score, term, word, pos, _ in kept]
        blob = encode(data)
        (dest / f'{bucket:03x}.json').write_bytes(blob)
        sizes.append(len(blob))

    # 簡體 → 繁體的單字對照：只收轉換後不同的字，存成「簡繁簡繁…」字串
    s2t = {}
    for code in range(0x4e00, 0xa000):
        char = chr(code)
        converted = tw.convert(char)
        if len(converted) == 1 and converted != char:
            s2t[char] = converted
    (dest / 's2t.json').write_bytes(encode(''.join(k + v for k, v in sorted(s2t.items()))))

    meta = dict(version=2, source='ECDICT CSV (common words, TOEIC pack, common-word phrases) + TOEIC 1000 pack zh',
                converters=['s2twp', 's2tw'], buckets=BUCKETS, per_char=PER_CHAR, per_char_rare=PER_CHAR_RARE, pairs=len(pairs),
                words=len({w for _, w in pairs}), bytes=sum(sizes), max_bytes=max(sizes), s2t_chars=len(s2t),
                shard='ord(CJK char) % 512, three-digit hex; merge shards of each query char')
    (dest / 'meta.json').write_bytes(encode(meta))
    print(json.dumps(meta, ensure_ascii=False))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
