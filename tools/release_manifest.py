"""發布前更新完整快取清單；--check 供 CI 驗證。沒有執行時建置步驟。"""
import hashlib,json,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def manifest():
    paths=[ROOT/'index.html', ROOT/'manifest.webmanifest']
    for folder,pattern in [('js','*.js'),('css','*.css'),('icons','*'),('data/packs','*.json')]:
        paths += [p for p in (ROOT/folder).rglob(pattern) if p.is_file()]
    return {p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(paths)}

def stamp(source, assets):
    body=json.dumps(assets,sort_keys=True,separators=(',',':'))
    release=hashlib.sha256(body.encode()).hexdigest()[:16]
    block=f"// RELEASE_MANIFEST_START\nconst RELEASE = '{release}';\nconst ASSETS = {body};\n// RELEASE_MANIFEST_END"
    return re.sub(r'// RELEASE_MANIFEST_START.*?// RELEASE_MANIFEST_END',lambda m:block,source,flags=re.S)

if __name__=='__main__':
    if '--check' not in sys.argv:
        for folder,pattern in [('js','*.js'),('css','*.css'),('icons','*.svg'),('data/packs','*.json')]:
            for item in (ROOT/folder).rglob(pattern):item.write_bytes(item.read_bytes().replace(b'\r\n',b'\n'))
        for item in [ROOT/'index.html',ROOT/'manifest.webmanifest']:item.write_bytes(item.read_bytes().replace(b'\r\n',b'\n'))
    path=ROOT/'sw.js'; current=path.read_text(encoding='utf-8'); updated=stamp(current,manifest())
    if '--check' in sys.argv:
        if current!=updated:sys.exit('發布清單過期：請執行 python tools/release_manifest.py')
        print('PASS 完整發布清單與所有檔案內容一致')
    else:path.write_bytes(updated.encode('utf-8'));print('已更新 sw.js 完整發布清單')
