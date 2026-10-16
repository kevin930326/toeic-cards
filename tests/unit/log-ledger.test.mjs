import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeLedgers,ledgerTotal,resetLedger,legacyLedger,cleanLedger} from '../../js/log-ledger.js';
import {buildBackup,parseBackup,mergeBackup} from '../../js/backup.js';
const day='2026-10-16';
const source=(n,t=1)=>({log:{[day]:{reviews:n,good:n}},updatedAt:t});
const a=cleanLedger({sources:{pc:source(10),phone:source(20)}});
test('10+20=30；同來源重複同步與備份合併仍30',()=>{
 const b=parseBackup(JSON.stringify(buildBackup({words:[],settings:{},log:{},logLedger:a,mistakes:[]})),{}).backup;
 const local={words:[],log:ledgerTotal(a),logLedger:a,mistakes:[]};
 const twice=mergeBackup(mergeBackup(local,b),b);
 assert.equal(twice.log[day].reviews,30);
 assert.equal(ledgerTotal(mergeLedgers(a,twice.logLedger))[day].reviews,30);
});
test('換裝置保留來源；新來源新增一次才變31',()=>{
 const b=mergeLedgers(a,{sources:{newdevice:source(1)}});
 assert.equal(ledgerTotal(b)[day].reviews,31);
 assert.equal(ledgerTotal(mergeLedgers(b,a))[day].reviews,31);
});
test('較新來源快照允許復原減少次數，不以次數max取代版本',()=>{
 const b=mergeLedgers(a,{sources:{pc:source(9,2)}});
 assert.equal(ledgerTotal(b)[day].reviews,29);
});
test('取代產生新基準；較舊的雲端或離線紀錄不得加回',()=>{
 const b=resetLedger(a,'reset',10);
 assert.equal(ledgerTotal(mergeLedgers(b,{sources:{pc:source(100,999),other:source(20)}}))[day].reviews,30);
 assert.deepEqual(mergeLedgers(a,b),mergeLedgers(b,a));
});
test('舊版總數以獨立基準保存，不和原裝置再加一次',()=>{
 const b=resetLedger(legacyLedger({[day]:{reviews:30}},'legacy'),'reset',10);
 assert.equal(ledgerTotal(mergeLedgers(a,b))[day].reviews,30);
});
