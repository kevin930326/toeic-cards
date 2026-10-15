"""將逐字撰寫的多益內容編成十份靜態 JSON；不呼叫任何模型或外部 API。

來源格式：單字|詞性(n/v/adj/adv/prep)|中文|英文解釋|英文例句|中文例句|搭配詞
詞形優先使用本機 ECDICT 的 exchange 欄位；原始資料與暫存不發布。
"""
import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'tools/word-pack-content.txt'
PACK = ROOT / 'data/packs/toeic-1000.json'
DEST = ROOT / 'data/packs/toeic-1000'
LABELS = {'p': '過去式', 'd': '過去分詞', 'i': '現在分詞', '3': '第三人稱單數', 's': '複數', 'r': '比較級', 't': '最高級'}


def build():
    pack = json.loads(PACK.read_text(encoding='utf-8'))
    entries = {}
    for number, line in enumerate(SOURCE.read_text(encoding='utf-8').splitlines(), 1):
        if not line or line.startswith('#'):
            continue
        fields = line.split('|')
        if len(fields) != 7:
            raise ValueError(f'第 {number} 行應有7欄，實際{len(fields)}欄')
        word, pos, zh, en, example, translation, collocation = fields
        if word in entries or word not in pack['words']:
            raise ValueError(f'重複或清單外單字：{word}')
        if pos not in {'n', 'v', 'adj', 'adv', 'prep'} or not all(fields):
            raise ValueError(f'欄位不完整：{word}')
        if len(en.split()) < 2 or not re.search(r'[。！？]$', translation):
            raise ValueError(f'解釋或翻譯不完整：{word}')
        if not example.endswith(('.', '?', '!')):
            raise ValueError(f'例句標點遺漏：{word}')
        entries[word] = {'word': word, 'pos': pos + '.', 'zh': zh, 'en': en,
                         'examples': [{'en': example, 'zh': translation}],
                         'collocations': collocation.split(';'), 'forms': [], 'synonyms': []}
    missing = set(pack['words']) - entries.keys()
    if missing:
        raise ValueError(f'尚缺 {len(missing)} 字：{", ".join(sorted(missing)[:12])}')
    # 使用既有 MIT 授權字典的詞形，不以字尾猜測不規則變化。
    with (ROOT / 'data/raw/ecdict.csv').open(encoding='utf-8', newline='') as f:
        for row in csv.DictReader(f):
            item = entries.get(row['word'])
            if not item:
                continue
            allowed = {'p', 'd', 'i', '3'} if item['pos'] == 'v.' else {'s'} if item['pos'] == 'n.' else {'r', 't'} if item['pos'] == 'adj.' else set()
            seen = set()
            for pair in row['exchange'].split('/'):
                key, _, form = pair.partition(':')
                if key in allowed and form and form != item['word'] and form not in seen:
                    item['forms'].append(f'{form}（{LABELS[key]}）')
                    seen.add(form)
    related = json.loads((ROOT / 'tools/word-pack-related.json').read_text(encoding='utf-8'))
    for word, value in related.items():
        if word not in entries:
            raise ValueError(f'關聯詞不在清單內：{word}')
        entries[word]['synonyms'] = value.get('synonyms', [])
        entries[word]['forms'].extend(value.get('forms', []))
    dictionaries = {}
    for word, item in entries.items():
        if word[0] not in dictionaries:
            dictionaries[word[0]] = json.loads((ROOT / f'data/dict/{word[0]}.json').read_text(encoding='utf-8'))
        item['phonetic'] = dictionaries[word[0]].get(word, {}).get('p', '')
    DEST.mkdir(parents=True, exist_ok=True)
    for group in range(10):
        words = pack['words'][group * 100:(group + 1) * 100]
        content = {'packId': pack['id'], 'version': 1, 'group': group,
                   'authoring': 'AI 撰寫的學習內容；詞形參考 ECDICT。非官方試題。',
                   'entries': [entries[word] for word in words]}
        (DEST / f'{group + 1:02d}.json').write_text(json.dumps(content, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'已編譯 {len(entries)} 字、10 份內容檔')


if __name__ == '__main__':
    build()
