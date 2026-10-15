"""從既有 ECDICT CSV 建立完整英文字／片語分片；不下載資料。

python tools/build_extended_dict.py data/raw/ecdict.csv data/dict/extended-v1
依 FNV-1a 的低 10 位分成 1024 檔，與 js/dictionary-data.js 共用規格。
"""
import csv
import hashlib
import json
import sys
from pathlib import Path
import opencc
from build_dict import WORD_RE, clean_translation

LABELS = {'p': '過去式', 'd': '過去分詞', 'i': '現在分詞', '3': '第三人稱單數',
          's': '複數', 'r': '比較級', 't': '最高級'}


def shard(word):
    value = 2166136261
    for char in word:
        value = ((value ^ ord(char)) * 16777619) & 0xffffffff
    return f'{value % 1024:03x}'


def main(source, destination):
    converter = opencc.OpenCC('s2twp')
    entries, exchanges = {}, {}
    with open(source, encoding='utf-8', newline='') as handle:
        for row in csv.DictReader(handle):
            word = row['word']
            if not WORD_RE.fullmatch(word):
                continue
            exchange = dict(part.split(':', 1) for part in row['exchange'].split('/') if ':' in part)
            exchanges[word] = exchange
            pos, zh = clean_translation(row['translation'])
            if not zh:
                continue
            entry = {'t': converter.convert(zh)}
            if pos:
                entry['s'] = pos
            if row['phonetic']:
                entry['p'] = '/' + row['phonetic'].strip().replace('ә', 'ə') + '/'
            entries[word] = entry

    # 只採來源明確記錄的詞形，不用去尾碼猜原形；精確字條永遠優先。
    for word, exchange in exchanges.items():
        root = exchange.get('0', '')
        types = [kind for kind in exchange.get('1', '') if kind in LABELS]
        if word in entries and root in entries and root != word and types:
            entries[word].update(l=root, f=types)
    aliases = 0
    for root, exchange in exchanges.items():
        if root not in entries or '0' in exchange:
            continue
        for kind, form in exchange.items():
            if kind not in LABELS or form == root or not WORD_RE.fullmatch(form) or form in entries:
                continue
            entries[form] = {'t': f'{root} 的{LABELS[kind]}\n' + entries[root]['t'],
                             's': entries[root].get('s', ''), 'l': root, 'f': [kind]}
            aliases += 1

    chunks = {f'{i:03x}': {} for i in range(1024)}
    for word, entry in entries.items():
        chunks[shard(word)][word] = entry
    dest = Path(destination)
    dest.mkdir(parents=True, exist_ok=True)
    sizes = []
    for key, chunk in chunks.items():
        data = json.dumps(chunk, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode('utf-8')
        (dest / f'{key}.json').write_bytes(data)
        sizes.append(len(data))
    metadata = dict(source='https://github.com/skywind3000/ECDICT', license='MIT',
                    converted='OpenCC s2twp', source_sha256=hashlib.sha256(Path(source).read_bytes()).hexdigest(),
                    words=len(entries), generated_forms=aliases, shards=1024, algorithm='fnv1a-32-mod-1024',
                    bytes=sum(sizes), max_shard_bytes=max(sizes))
    (dest / 'meta.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(metadata, ensure_ascii=False))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
