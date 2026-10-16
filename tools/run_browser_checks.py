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
TESTS=['account_isolation','backup_sync','sync_conflicts','storage_recovery','question_quality',
       'accessibility','release_update','security','step9','card_lookup_mode','tour_keyboard','tour_overlap','onboarding',
       'forms_quiz','step6','review_regressions','bulk_delete','batch_add_responsiveness','product_copy','word_packs','dictionary_scale','lookup_suggestions','step11']
try:
    for name in (sys.argv[1:] or TESTS):
        print('RUN',name,flush=True)
        subprocess.run([sys.executable,f'tests/test_{name}.py'],cwd=ROOT,check=True,timeout=240)
finally:server.shutdown();server.server_close()
