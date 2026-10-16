import {test} from 'node:test';
import assert from 'node:assert/strict';
import {metaAction,metaSignature} from '../../js/meta-sync.js';
test('只有本機修改才推送，只有雲端修改才拉取，兩邊修改須確認',()=>{
 const known={local:'base',cloud:'base'};
 assert.equal(metaAction(known,'local','base',1,true),'push');
 assert.equal(metaAction(known,'base','remote',9999999999999,true),'pull');
 assert.equal(metaAction(known,'local','remote',1,true),'conflict');
 assert.equal(metaAction(known,'same','same',1,true),'none');
});
test('舊裝置初次遷移不自動以時間蓋掉不同快照',()=>{
 assert.equal(metaAction(null,'local','remote',9999999999999,true),'conflict');
 assert.equal(metaAction(null,'default','remote',0,true),'pull');
});
test('物件鍵順序不影響快照指紋',()=>{
 assert.equal(metaSignature({a:1,b:2}),metaSignature({b:2,a:1}));
 assert.notEqual(metaSignature({a:1}),metaSignature({a:2}));
});
