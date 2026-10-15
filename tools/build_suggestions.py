"""從既有字典與原始詞頻產生候選索引；不下載資料、不轉換字義。

python tools/build_suggestions.py data/raw/ecdict.csv data/dict
"""
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

MAX_BYTES = 32768
STARTERS = ('apple book company discuss email food go help invoice job keep learn meeting '
            'name order plan question report study time use visit work x-ray year zero').split()


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def main(source, dictionary):
    directory = Path(dictionary)
    words, common = set(), set()
    for path in directory.glob('?.json'):
        common.update(json.loads(path.read_text(encoding='utf-8')))
    for path in (directory / 'extended-v1').glob('*.json'):
        if path.stem != 'meta':
            words.update(json.loads(path.read_text(encoding='utf-8')))
    words.update(common)
    ranks = {}
    with open(source, encoding='utf-8', newline='') as handle:
        for row in csv.DictReader(handle):
            word = row['word']
            if word not in words:
                continue
            frequencies = [int(row[key] or 0) for key in ('frq', 'bnc')]
            ranks[word] = min([n for n in frequencies if n > 0] or [10_000_000])
    ranked = sorted(words, key=lambda word: (word not in common, ranks.get(word, 10_000_000), len(word), word))
    branches, leaves, sizes = {}, {}, []
    dest = directory / 'suggestions-v1'
    dest.mkdir(exist_ok=True)

    def split(prefix, entries):
        data = encode(entries)
        if len(prefix) >= 2 and len(data) <= MAX_BYTES:
            filename = prefix.encode('utf-8').hex() + '.json'
            (dest / filename).write_bytes(data)
            leaves[prefix] = filename
            sizes.append(len(data))
            return
        candidates = entries[:8]
        if len(prefix) == 1:
            starter = STARTERS[ord(prefix) - ord('a')]
            if starter in words:
                candidates = [starter] + [word for word in entries if word != starter][:7]
        if prefix in entries:
            candidates = [prefix] + [word for word in candidates if word != prefix][:7]
        branches[prefix] = candidates
        groups = defaultdict(list)
        for word in entries:
            if len(word) > len(prefix):
                groups[word[:len(prefix) + 1]].append(word)
        for child, group in sorted(groups.items()):
            split(child, group)

    for letter in 'abcdefghijklmnopqrstuvwxyz':
        split(letter, [word for word in ranked if word.startswith(letter)])
    manifest = dict(version=1, words=len(words), ranking='common-first,frequency,length,word; single-letter starter',
                    branches=branches, leaves=leaves, max_leaf_bytes=max(sizes))
    data = encode(manifest)
    (dest / 'index.json').write_bytes(data)
    print(json.dumps(dict(words=len(words), files=len(leaves), index_bytes=len(data),
                          leaf_bytes=sum(sizes), max_leaf_bytes=max(sizes))))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
