"""真實 Service Worker：完整更新、多分頁、動態模組、雜湊失敗與離線。"""
import hashlib,sys,threading,time
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from shots import doc_shot
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from release_manifest import stamp
TEMPLATE=(Path(__file__).resolve().parents[1]/'sw.js').read_text(encoding='utf-8')
state={'release':'A','broken':False}

def files(release):
    root=Path(__file__).resolve().parents[1]
    return {'index.html':f'<html><meta charset="utf-8"><link rel="stylesheet" href="css/style.css"><body><main class="page"><h1>release {release}</h1></main><script type="module" src="js/boot.js"></script></body></html>'.encode(),
            'js/lazy.js':f'export const version="{release}";'.encode(),
            'js/boot.js':b"import {initPWA} from './pwa.js';initPWA();",
            'js/pwa.js':(root/'js/pwa.js').read_bytes(),'css/style.css':(root/'css/style.css').read_bytes()}
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        path=self.path.split('?')[0].lstrip('/') or 'index.html';data=files(state['release'])
        if path=='sw.js':
            body=stamp(TEMPLATE,{k:hashlib.sha256(v).hexdigest() for k,v in data.items()}).encode();kind='text/javascript'
        elif path in data:
            body=data[path];kind='text/javascript' if path.endswith('.js') else 'text/css' if path.endswith('.css') else 'text/html'
            if state['broken'] and path=='js/lazy.js':body=b'wrong deployment bytes'
        else:self.send_error(404);return
        self.send_response(200);self.send_header('Content-Type',kind);self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body)

def poll(pg,js,expect=True):
    for _ in range(100):
        if pg.evaluate(js)==expect:return
        pg.wait_for_timeout(100)
    raise AssertionError(js)
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
URL=f'http://127.0.0.1:{server.server_port}/'
try:
    with sync_playwright() as p:
        b=p.chromium.launch();c=b.new_context(service_workers='allow');pg=c.new_page();pg.goto(URL)
        pg.evaluate("navigator.serviceWorker.register('/sw.js')");pg.evaluate('navigator.serviceWorker.ready');pg.reload()
        poll(pg,'() => !!navigator.serviceWorker.controller')
        other=c.new_page();other.goto(URL)
        state['release']='B';pg.evaluate('async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update()}')
        poll(pg,'async()=>!!(await navigator.serviceWorker.getRegistration()).waiting')
        expect(pg.locator('#appUpdateNotice')).to_be_visible()
        pg.screenshot(path=doc_shot('46-release-update.png'))
        assert pg.evaluate("async()=> (await fetch('/js/lazy.js?new')).text()")=='export const version="A";'
        other.reload();assert 'release A' in other.locator('body').inner_text()
        c.set_offline(True);pg.reload();assert 'release A' in pg.locator('body').inner_text();c.set_offline(False)
        print('PASS 新版等待期間兩分頁、動態載入與離線仍使用完整 A',flush=True)
        other.close();pg.close();pg=c.new_page();pg.goto(URL)
        poll(pg,'async()=>!(await navigator.serviceWorker.getRegistration()).waiting')
        pg.reload();assert 'release B' in pg.locator('body').inner_text()
        assert pg.evaluate("async()=> (await import('/js/lazy.js')).version")=='B'
        print('PASS 所有舊分頁關閉後整份切換 B',flush=True)
        pg.evaluate("async()=>{const n=(await caches.keys()).find(n=>n.startsWith('toeic-shell-'));await (await caches.open(n)).delete(new URL('/js/lazy.js',location.href));}")
        assert pg.evaluate("async()=> (await fetch('/js/lazy.js?restore')).text()")=='export const version="B";'
        print('PASS 快取被部分清除時只補回雜湊吻合的相同版本',flush=True)
        state['release']='C';state['broken']=True
        pg.evaluate('async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update()}')
        poll(pg,'async()=>!(await navigator.serviceWorker.getRegistration()).installing')
        assert pg.evaluate('async()=>!(await navigator.serviceWorker.getRegistration()).waiting')
        c.set_offline(True);pg.reload();assert 'release B' in pg.locator('body').inner_text()
        assert pg.evaluate("async()=> (await fetch('/js/lazy.js?retry')).text()")=='export const version="B";'
        assert pg.evaluate("async()=> (await fetch('/js/unknown.js')).status")==409
        print('PASS 發布雜湊失敗不接手，離線保留 B 且不混入未知程式',flush=True)
        c.close();b.close()
finally:server.shutdown();server.server_close()
print('ALL PASSED')
