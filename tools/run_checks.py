"""跨平台 CI／本機快速檢查；不下載工具。"""
import subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
for path in [*sorted((ROOT/'js').rglob('*.js')),ROOT/'sw.js']:
    subprocess.run(['node','--check',str(path)],cwd=ROOT,check=True)
subprocess.run(['node','--test',*[str(p) for p in sorted((ROOT/'tests/unit').glob('*.test.mjs'))]],cwd=ROOT,check=True)
subprocess.run([sys.executable,'tools/release_manifest.py','--check'],cwd=ROOT,check=True)
