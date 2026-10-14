"""把 ECDICT（簡體、約 77 萬字）整理成網站用的小字典。

做的事：
  1. 只留常用字（詞頻前 3 萬、或考試標籤 / 柯林斯星級 / 牛津 3000）
  2. 中文意思用 OpenCC 轉成台灣繁體（s2twp：連用詞也轉，例如「软件」→「軟體」）
  3. 每個字最多留 4 行詞性、每行最多 5 個意思
  4. 依首字母拆成 data/dict/a.json ~ z.json，網站用到哪個字母才下載

用法：
  python -I tools/build_dict.py data/raw/ecdict.csv data/dict
"""
import csv
import json
import os
import re
import sys

import opencc

csv.field_size_limit(10_000_000)

WORD_RE = re.compile(r"^[a-z][a-z'\- ]*[a-z]$|^[a-z]$")
EXAM_TAGS = {'zk', 'gk', 'cet4', 'cet6', 'ky', 'toefl', 'ielts'}
POS_FIX = {'a.': 'adj.', 'ad.': 'adv.', 'adj.': 'adj.', 'adv.': 'adv.'}
LINE_POS = re.compile(r'^([a-z]+\.)(?:\s*(?:&|/)\s*([a-z]+\.))?\s*(.*)$')
FREQ_LIMIT = 30000


def keep(row):
    word = row['word']
    if not WORD_RE.match(word):
        return False
    if not row['translation'].strip():
        return False
    frq = int(row['frq'] or 0)
    bnc = int(row['bnc'] or 0)
    tags = set((row['tag'] or '').split())
    return (
        0 < frq <= FREQ_LIMIT
        or 0 < bnc <= FREQ_LIMIT
        or bool(tags & EXAM_TAGS)
        or int(row['collins'] or 0) > 0
        or row['oxford'] == '1'
    )


def clean_translation(text):
    """回傳 (詞性摘要, 多行中文)。"""
    text = text.replace('\\r', '').replace('\r', '').replace('\\n', '\n')
    parsed = []
    for line in (l.strip() for l in text.split('\n')):
        if not line:
            continue
        m = LINE_POS.match(line)
        pos = ''
        body = line
        if m:
            pos = POS_FIX.get(m.group(1), m.group(1))
            if m.group(2):
                pos = f"{pos} & {POS_FIX.get(m.group(2), m.group(2))}"
            body = m.group(3)
        parsed.append((pos, body.strip()))
    # 「[網絡]」是網路釋義、「[計]」「[醫]」是專業領域，有一般釋義時就不要
    normal = [p for p in parsed if not p[1].startswith('[')]
    # 只有專業領域釋義時，保留內容但拿掉「[計]」這類標籤
    parsed = normal or [(pos, re.sub(r'^\[[^\]]*\]\s*', '', body)) for pos, body in parsed]

    out = []
    pos_list = []
    for pos, body in parsed[:4]:
        # 去掉括號註解前後多餘空白、限制意思數量
        parts = [p.strip() for p in re.split(r'[,，;；]', body) if p.strip()]
        if not parts:
            continue
        body = '；'.join(parts[:5])
        out.append(f'{pos} {body}' if pos else body)
        for p in pos.split(' & '):
            if p and p not in pos_list:
                pos_list.append(p)
    return ' / '.join(pos_list), '\n'.join(out)


def main(src, dest):
    conv = opencc.OpenCC('s2twp')
    chunks = {}
    count = 0
    with open(src, encoding='utf-8', newline='') as f:
        for row in csv.DictReader(f):
            if not keep(row):
                continue
            pos, zh = clean_translation(row['translation'])
            if not zh:
                continue
            entry = {'t': conv.convert(zh)}
            if pos:
                entry['s'] = pos
            if row['phonetic']:
                # ECDICT 的音標混用了西里爾字母 ә，換成正確的 IPA ə
                entry['p'] = f"/{row['phonetic'].strip().replace('ә', 'ə')}/"
            word = row['word']
            key = word[0] if 'a' <= word[0] <= 'z' else '_'
            chunks.setdefault(key, {})[word] = entry
            count += 1

    os.makedirs(dest, exist_ok=True)
    total = 0
    for key, data in sorted(chunks.items()):
        path = os.path.join(dest, f'{key}.json')
        with open(path, 'w', encoding='utf-8') as out:
            json.dump(data, out, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
        total += os.path.getsize(path)
    with open(os.path.join(dest, 'meta.json'), 'w', encoding='utf-8') as out:
        json.dump({
            'source': 'ECDICT (https://github.com/skywind3000/ECDICT), MIT License',
            'converted': 'OpenCC s2twp',
            'words': count,
        }, out, ensure_ascii=False, indent=2)
    print(f'{count} 個字，{len(chunks)} 個檔案，共 {total / 1024 / 1024:.2f} MB')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
