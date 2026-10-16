// 備份套用集中在此：先使舊同步失效，再保存可重試的取代意圖。
import { getWords, getSettings, getSetRecords, replaceWords, replaceSettings, replaceSetRecords,
  restoreSetRecords, getTombstones, setTombstones, setSettingsUpdatedAt, flushWords } from './store.js';
import { getLog, getLogLedger, setLogLedger } from './log.js';
import { getAllMistakes, replaceMistakes } from './mistakes.js';
import { mergeBackup } from './backup.js';
import { legacyLedger, resetLedger } from './log-ledger.js';
import { profileStorage,pendingProfileWrites } from './profile-storage.js';
import { invalidateSync } from './sync.js';

export function currentData() {
  return {words:getWords(),settings:getSettings(),wordSets:getSetRecords(),mistakes:getAllMistakes(),log:getLog(),logLedger:getLogLedger()};
}
export function restoreBackup(incoming, replace = false) {
  invalidateSync();
  profileStorage.removeItem('toeic-cards:metaConflict');
  const before = currentData();
  profileStorage.setItem('toeic-cards:restoreIncomplete','true');
  const result = replace ? incoming : mergeBackup(before, incoming);
  let ledger = result.logLedger;
  if (!ledger) ledger = legacyLedger(result.log, `legacy-${crypto.randomUUID()}`);
  if (replace || incoming.legacyLog) {
    ledger = resetLedger(ledger,crypto.randomUUID());
    profileStorage.setItem('toeic-cards:logReset','true');
  }
  if (replace) {
    profileStorage.setItem('toeic-cards:restoreIntent','true');
    const now = Math.max(Date.now(),...before.words.map(w=>w.updatedAt+1),...result.words.map(w=>w.updatedAt+1));
    const wanted = new Set(result.words.map(w=>w.word));
    const tombs = {...getTombstones()};
    for (const w of before.words) if (!wanted.has(w.word)) tombs[w.word]=now;
    for (const word of wanted) delete tombs[word];
    setTombstones(tombs);
    result.words = result.words.map(w=>({...w,updatedAt:now}));
    restoreSetRecords(result.wordSets || []);
  } else replaceSetRecords(result.wordSets || []);
  replaceWords(result.words);
  replaceMistakes(result.mistakes);
  setLogLedger(ledger);
  if (replace) { replaceSettings(result.settings); setSettingsUpdatedAt(Date.now()); }
  if (!flushWords()||pendingProfileWrites()) throw new Error('備份尚未完整存到，請保留原備份並釋放空間後重試。');
  profileStorage.removeItem('toeic-cards:restoreIncomplete');
  return result;
}
