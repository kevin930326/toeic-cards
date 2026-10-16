"""由 emulators:exec 執行；自行管理唯一 HTTP 伺服器，API 由測試攔截。"""
import subprocess,sys,threading,os
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from functools import partial
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',8123),partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
os.environ['BASE_URL']='http://127.0.0.1:8123/'
# 自動找出所有瀏覽器測試（tests/test_*.py），新增的測試不會因為忘了加進清單而沒跑。
# test_deployed 會連到正式網站，不在這裡跑。
TESTS=sorted(p.stem.removeprefix('test_') for p in (ROOT/'tests').glob('test_*.py') if p.stem!='test_deployed')
try:
    for name in (sys.argv[1:] or TESTS):
        print('RUN',name,flush=True)
        subprocess.run([sys.executable,f'tests/test_{name}.py'],cwd=ROOT,check=True,timeout=240)
finally:server.shutdown();server.server_close()
