"""把 tools/form-questions/*.txt 編成內建詞性變化題庫 data/packs/toeic-1000-forms.json

每行一題，用「 | 」分成 6 欄（# 開頭是註解）：
  目標字 | 句子（空格寫成 ___） | 答案 | 錯誤選項1 / 錯誤選項2 / 錯誤選項3 | 中文翻譯 | 解析

檢查規則和網站的 normalizeFormQ 一樣（不合格就停止，不會產生題庫）：
  - 目標字必須在多益 1000 單字包裡
  - 句子只有一個空格；四個選項不重複，而且都和目標字同字族（開頭至少 3 個字母相同，或和其他同字族選項相同）
  - 任何一個選項都不能已經出現在句子裡（否則等於送分）
  - 翻譯、解析不能是空的

用法：python tools/build_form_questions.py
"""
import json
import re
import sys
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'tools' / 'form-questions'
PACK = ROOT / 'data' / 'packs' / 'toeic-1000.json'
OUT = ROOT / 'data' / 'packs' / 'toeic-1000-forms.json'
BLANK = '_____'


def same_family(option, target):
    a, b = option.lower().split(' ')[0], target.lower().split(' ')[0]
    n = 0
    while n < len(a) and n < len(b) and a[n] == b[n]:
        n += 1
    return n >= min(3, len(b) - 1)


def check(line, pack_words):
    cols = [c.strip() for c in line.split('|')]
    if len(cols) != 6:
        return None, f'應該有 6 欄，實際 {len(cols)} 欄'
    target, sentence, answer, distractors, translation, explanation = cols
    sentence = re.sub(r'_{2,}', BLANK, sentence)
    distractors = [d.strip() for d in distractors.split('/') if d.strip()]
    options = [answer, *distractors]
    if target.lower() not in pack_words:
        return None, f'「{target}」不在單字包裡'
    if sentence.count(BLANK) != 1:
        return None, '句子要剛好一個空格'
    if len(distractors) != 3 or len({o.lower() for o in options}) != 4:
        return None, '要有 4 個不重複的選項'
    anchors = [target, *[o for o in options if same_family(o, target)]]
    if not all(any(same_family(o, a) for a in anchors) for o in options):
        return None, f'選項不是同一個字族：{options}'
    for o in options:
        if re.search(rf'\b{re.escape(o)}\b', sentence, re.I):
            return None, f'選項「{o}」已經出現在句子裡'
    if not translation or not explanation:
        return None, '缺少翻譯或解析'
    if len(sentence) > 400 or len(translation) > 400 or len(explanation) > 400:
        return None, '內容太長（上限 400 字）'
    return {'target': target.lower(), 'sentence': sentence, 'answer': answer, 'distractors': distractors,
            'translation': translation, 'explanation': explanation}, None


def main():
    pack_words = {w.lower() for w in json.loads(PACK.read_text(encoding='utf-8'))['words']}
    review_doc=json.loads((SRC/'review.json').read_text(encoding='utf-8'))
    reviews={r['target']:r for r in review_doc['reviews']}
    questions, errors = [], []
    for f in sorted(SRC.glob('*.txt')):
        for n, line in enumerate(f.read_text(encoding='utf-8').splitlines(), 1):
            if not line.strip() or line.lstrip().startswith('#'):
                continue
            q, err = check(line, pack_words)
            if err:
                errors.append(f'{f.name}:{n}  {err}')
            else:
                r=reviews.get(q['target'])
                digest=hashlib.sha256(json.dumps(q,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
                if not r or r['sha256']!=digest:
                    errors.append(f'{f.name}:{n} 題目已變動或缺少審核紀錄，請重新審核 review.json')
                    continue
                q.update(id=r['id'],revision=r['revision'],policy=2,source='builtin',review=r['status'],reviewReason=r['reason'])
                if r['status']=='approved-ai':
                    q['optionReasons']=[q['explanation'],*[f'「{d}」不是這裡需要的' + ('原形動詞。' if '原形動詞' in q['explanation'] else '名詞。' if q['target']=='negligent' else '過去分詞。' if q['target'] in ['selection','approve'] else '過去式。') for d in q['distractors']]]
                questions.append(q)
    if errors:
        print('\n'.join(errors))
        sys.exit(f'有 {len(errors)} 題不合格，沒有產生題庫')
    OUT.write_text(json.dumps({'packId': 'toeic-1000', 'version': 2, 'questions': questions},
                              ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    words = {q['target'] for q in questions}
    print(f'完成：{len(questions)} 題，涵蓋 {len(words)} / {len(pack_words)} 個字，{OUT.stat().st_size / 1024:.0f} KB')
    def signature(q):
        text=json.dumps([q['sentence'],q['answer'],sorted(q['distractors']),q['translation'],q['explanation']],ensure_ascii=False,separators=(',',':'))
        h=2166136261
        for c in text: h=((h^ord(c))*16777619)&0xffffffff
        return format(h,'x')
    approved={q['id']:{'revision':q['revision'],'signature':signature(q)} for q in questions if q['review']=='approved-ai'}
    (ROOT/'js/forms-catalog.js').write_text('// 由 tools/build_form_questions.py 產生；修改題目須重新審核。\nexport const FORMS_CATALOG = '+json.dumps(approved,separators=(',',':'))+';\n',encoding='utf-8')
    print(f'啟用 {len(approved)}；待覆核並停用 {len(questions)-len(approved)}')


if __name__ == '__main__':
    main()
