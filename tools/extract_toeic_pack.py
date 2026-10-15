"""從使用者提供的 PDF 重建英文清單；不複製翻譯、例句或版面。

用法：python tools/extract_toeic_pack.py --source <PDF 路徑>
需要 pypdf；原始 PDF 不放進版本控制。
"""
import argparse
import hashlib
import json
import re
import unicodedata
from pathlib import Path

from pypdf import PdfReader

# 對照原 PDF 畫面與該筆例句後確認的來源拼字修正；保留頁碼供人工查核。
CORRECTIONS = [
    {'page': 46, 'from': 'aprove', 'to': 'approve'},
    {'page': 59, 'from': 'nconvenience', 'to': 'inconvenience'},
    {'page': 62, 'from': 'ompulsory', 'to': 'compulsory'},
]


def extract_words(source):
    reader = PdfReader(source)
    words = []
    for page_number, page in enumerate(reader.pages, 1):
        page_words = []
        for line in page.extract_text().splitlines():
            # 只讀每筆開頭「單字（詞性.）」；中文與例句不納入輸出。
            match = re.match(r'^([^（]+)（\s*(?:[a-z]\s*)+\.', line)
            if not match:
                continue
            word = unicodedata.normalize('NFC', match.group(1).strip().lower())
            # PDF 的 create 被字距排版抽成 c r e a t e，還原單字。
            if re.fullmatch(r'(?:[a-z] ){2,}[a-z]', word):
                word = word.replace(' ', '')
            for correction in CORRECTIONS:
                if page_number == correction['page'] and word == correction['from']:
                    word = correction['to']
            if not re.fullmatch(r"[a-zà-öø-ÿ]+(?:[-' ][a-zà-öø-ÿ]+)*", word):
                raise ValueError(f'第 {page_number} 頁有待檢查的拼字：{word!r}')
            page_words.append(word)
        if len(page_words) != 10:
            raise ValueError(f'第 {page_number} 頁預期 10 字，實際 {len(page_words)} 字')
        words.extend(page_words)
    if len(words) != 1000 or len(set(words)) != 1000:
        raise ValueError(f'預期 1,000 個不重複單字，實際 {len(words)} 筆、{len(set(words))} 個不重複')
    return words


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('data/packs/toeic-1000.json'))
    args = parser.parse_args()
    words = extract_words(args.source)
    pack = {
        'id': 'toeic-1000', 'version': 1, 'title': '多益 1000 單', 'groupSize': 100,
        'source': {
            'title': '【刷刷鍋】多益一千單字表',
            'note': '英文選字依使用者提供的清單整理；依原順序分組，不代表難度或官方出題頻率。未收錄原 PDF 的翻譯、例句或版面。',
            'sha256': hashlib.sha256(args.source.read_bytes()).hexdigest(),
            'corrections': CORRECTIONS,
        },
        'words': words,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(pack, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'已整理 {len(words)} 個不重複單字 → {args.output}')


if __name__ == '__main__':
    main()
