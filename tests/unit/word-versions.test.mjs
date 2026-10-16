import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stampWord,mergeVersionedWords} from '../../js/word-versions.js';
import {mergeRemoteRecord,toRemoteWord,toRemoteTombstone,applyRemoteWords} from '../../js/sync-core.js';
const base={id:'w',word:'approve',zh:'原字義',en:'original',src:{zh:'dict',en:'dict'},createdAt:1,updatedAt:1,_rev:{birth:[1,'origin'],fields:{}}};
test('兩邊改不同內容欄位與進度，全部保留',()=>{
 const a=stampWord(base,{zh:'新字義',src:{...base.src,zh:'user'}},2,'a');
 const b=stampWord(base,{en:'new English',srs:{reps:1,interval:1},src:{...base.src,en:'user'}},2,'b');
 const m=mergeVersionedWords(a,b);
 assert.equal(m.zh,'新字義');assert.equal(m.en,'new English');assert.equal(m.srs.reps,1);
 assert.deepEqual(m.src,{zh:'user',en:'user'});
 assert.equal(m._conflicts.length,0);
});
test('同欄位並行修改保留兩份；合併順序一致且重複套用不累增',()=>{
 const a=stampWord(base,{zh:'甲'},2,'a'),b=stampWord(base,{zh:'乙'},2,'b');
 const m=mergeVersionedWords(a,b);
 assert.equal(m.zh,'乙');assert.equal(m._conflicts[0].alternatives.length,2);
 assert.deepEqual(mergeVersionedWords(b,a),m);
 assert.deepEqual(mergeVersionedWords(m,a),m);
});
test('觀察前版之後修改為因果更新，不是假衝突；時鐘差異不參與版本排序',()=>{
 const a=stampWord(base,{zh:'甲'},2,'a');const b=stampWord(a,{zh:'乙'},3,'b');
 assert.equal(mergeVersionedWords(a,b)._conflicts.length,0);
 assert.equal(mergeVersionedWords(a,b).zh,'乙');
});
test('刪除優先於同一代的離線修改；明確重建新一代才恢復',()=>{
 const offline=stampWord(base,{en:'late offline'},99,'a');
 const dead=toRemoteTombstone('approve',2,[2,'b','1:origin']);
 assert.equal(mergeRemoteRecord(toRemoteWord(offline),dead).deleted,true);
 const added={...base,_rev:{birth:[3,'a'],fields:{}},updatedAt:3};
 assert.equal(mergeRemoteRecord(dead,toRemoteWord(added)).deleted,false);
 const applied=applyRemoteWords([offline],{},[dead]);assert.equal(applied.words.length,0);
});
test('兩台同步前都複習同一張卡：以最後一次複習為準，不跳衝突；兩邊合併結果一樣且之後不再分歧',()=>{
 const learned=stampWord(base,{srs:{reps:1,interval:1,due:10,last:5},unfamiliar:false},2,'origin');
 const phone=stampWord(learned,{srs:{reps:0,interval:0,due:700,last:100},unfamiliar:true},3,'phone');   // 手機先按「不熟」
 const pc=stampWord(learned,{srs:{reps:2,interval:3,due:900,last:200},unfamiliar:false},3,'pc');       // 電腦較晚按「會」
 const m=mergeVersionedWords(phone,pc);
 assert.equal(m._conflicts.length,0);
 assert.equal(m.srs.last,200);assert.equal(m.srs.interval,3);assert.equal(m.unfamiliar,false);   // 不熟跟著同一次複習
 assert.deepEqual(mergeVersionedWords(pc,phone),m);
 // 各自拿到合併結果後再合併：不會再改變、不產生衝突
 assert.deepEqual(mergeVersionedWords(phone,m).srs,m.srs);
 assert.deepEqual(mergeVersionedWords(m,pc).srs,m.srs);
 assert.equal(mergeVersionedWords(pc,m)._conflicts.length,0);
});
test('看過對方版本後的復原（較舊的複習時間）照版本先後，不被「最後一次複習」蓋掉',()=>{
 const learned=stampWord(base,{srs:{reps:1,interval:1,due:10,last:5}},2,'origin');
 const rated=stampWord(learned,{srs:{reps:2,interval:3,due:900,last:200}},3,'pc');
 const undone=stampWord(rated,{srs:{reps:1,interval:1,due:10,last:5}},4,'pc');
 assert.equal(mergeVersionedWords(rated,undone).srs.last,5);
});
test('舊資料裡已存在的複習衝突不再顯示',()=>{
 const old={...base,_conflicts:[{key:'srs|1:a|1:b',field:'srs',alternatives:[{clock:[1,'a'],value:{}},{clock:[1,'b'],value:{}}]}]};
 assert.equal(mergeVersionedWords(old,base)._conflicts.length,0);
});
