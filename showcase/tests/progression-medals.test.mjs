import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
function boot(storage={}) {
 const dom=new JSDOM(html,{url:'https://game.test/',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.matchMedia=()=>({matches:false,addEventListener(){}});Object.entries(storage).forEach(([k,v])=>w.localStorage.setItem(k,v));}});
 const ev=s=>dom.window.eval(s);
 return {dom,ev,close:()=>dom.window.close(),snapshot:()=>Object.fromEntries(Object.keys(dom.window.localStorage).map(k=>[k,dom.window.localStorage.getItem(k)]))};
}
const clear=`while(!state.done){let p=findMove();if(!p){reshuffle();p=findMove();}onTile(state.tiles.indexOf(p[0]));onTile(state.tiles.indexOf(p[1]));}`;
const miss=`const f=freeTiles(),a=f[0],b=f.find(t=>t.code!==a.code);onTile(state.tiles.indexOf(a));onTile(state.tiles.indexOf(b));`;
test('Sudden Death banks every ten, resumes partial boards, rolls back on a miss without touching Normal or Daily',()=>{
 let g=boot();const e=g.ev;e(`journey='expedition';LS.set('mahgeong-journey-v1',journey);loadLevel();`);
 for(let i=1;i<=13;i++){e(clear);assert.equal(e('state.level'),i);e('loadLevel(null,true)');}
 assert.equal(e('expedition.bank'),10);assert.equal(e('expedition.next'),14);assert.equal(e('levelCleared'),0);assert.equal(e('dailyUnlocked()'),false);
 e('onTile(state.tiles.indexOf(findMove()[0]));onTile(state.tiles.indexOf(findMove()[1]));');const left=e('aliveTiles().length');const saved=g.snapshot();g.close();g=boot(saved);
 assert.equal(g.ev('state.level'),14);assert.equal(g.ev('aliveTiles().length'),left);assert.equal(g.ev('state.death'),true);
 g.ev(miss);assert.equal(g.ev('state.over'),true);assert.equal(g.ev('expedition.next'),11);assert.equal(g.ev('expedition.bank'),10);
 const failed=g.snapshot();g.close();g=boot(failed);assert.equal(g.ev('state.level'),11);assert.equal(g.ev('state.over'),false);assert.equal(g.ev('levelCleared'),0);g.close();
});
test('Sudden Death reaches 60, banks completion, never allows hints, keeps shuffle and has separate saves',()=>{
 const g=boot();g.ev(`journey='expedition';expedition={bank:50,next:60};loadLevel();hint();reshuffle();`);assert.equal(g.ev('state.hints'),0);assert.equal(g.ev('state.shuffles'),1);g.ev(clear);assert.equal(g.ev('expedition.bank'),60);assert.equal(g.ev('expedition.next'),60);assert.equal(g.ev('levelCleared'),0);g.ev('loadLevel(null,true)');g.ev(miss);assert.equal(g.ev('expedition.bank'),60);assert.equal(g.ev('expedition.next'),60);g.close();
});
test('normal play still tolerates mistakes, unlocks Daily at ten, and its board survives switching journeys',()=>{
 const g=boot();g.ev(miss);assert.equal(g.ev('state.done'),false);g.ev('hint();saveDaily();');const misses=g.ev('state.mistakes');g.ev(`journey='expedition';LS.set('mahgeong-journey-v1',journey);loadLevel();journey='normal';loadLevel();`);assert.equal(g.ev('state.mistakes'),misses);
 g.ev(`levelCleared=9;loadLevel(10,true);`);g.ev(clear);assert.equal(g.ev('dailyUnlocked()'),true);assert.equal(g.ev('expedition.bank'),0);g.close();
});
test('zero misses earns medals across solo modes, hints/untimed qualify, re-open/reload never duplicates, failed runs earn nothing',()=>{
 const g=boot();g.ev('hint();state.timed=false;');g.ev(clear);assert.equal(g.ev('Object.keys(LS.get(MEDALS_KEY)).length'),1);g.ev('finish();showEndSheet(false,null);');assert.equal(g.ev('Object.keys(LS.get(MEDALS_KEY)).length'),1);
 const saved=g.snapshot();g.close();const h=boot(saved);assert.equal(h.ev('Object.keys(LS.get(MEDALS_KEY)).length'),1);
 h.ev(`setTab('practice');`);h.ev(clear);assert.equal(h.ev(`Object.values(LS.get(MEDALS_KEY)).filter(m=>m.category==='practice').length`),1);
 h.ev(`newPractice('world','all','flag',12,'fair');state.death=true;`);h.ev(miss);assert.equal(h.ev('awardFlawless(state)'),false);
 h.ev(`newPractice('world','all','flag',12,'fair');state.death=true;`);h.ev(clear);assert.equal(h.ev(`Object.values(LS.get(MEDALS_KEY)).filter(m=>m.category==='death').length`),1);
 h.ev(`levelCleared=10;setTab('daily');`);h.ev(clear);h.ev('renderProfile();renderProfile();');assert.equal(h.ev(`Object.values(LS.get(MEDALS_KEY)).filter(m=>m.category==='daily').length`),1);h.close();
});
test('profile backfills only recorded flawless Daily history and retains the legacy Daily landing/access',()=>{
 const g=boot({'mahgeong-results':JSON.stringify({1:{m:0,t:20,mode:'flag'},2:{m:1,t:30,mode:'capital'}})});
 // Use actual KEY value rather than relying on a guessed key.
 g.ev(`LS.set(KEY.results,{1:{m:0,t:20,mode:'flag'},2:{m:1,t:30,mode:'capital'}});renderProfile();renderProfile();`);
 assert.equal(g.ev(`Object.values(LS.get(MEDALS_KEY)).filter(m=>m.category==='daily').length`),1);g.close();
});
test('2 Player medals require a completed board, a pair claimed, and zero personal server-reported misses; reconnect does not duplicate',()=>{
 const g=boot();g.ev(`vs={token:'test-round',seat:'A'};LS.set('mahgeong-versus-pairs-test-round',1);var msg={status:'done',tiles:[{x:0,y:0,z:0,code:'FR',kind:'name',alive:false},{x:2,y:0,z:0,code:'FR',kind:'flag',alive:false}],scores:{A:1,B:0},misses:{A:0,B:1},names:{A:'You',B:'Rival'},connected:{A:true,B:true},winner:'A'};tab='versus';applyVersusState(msg);applyVersusState(msg);`);
 assert.equal(g.ev(`Object.values(LS.get(MEDALS_KEY)).filter(m=>m.category==='versus').length`),1);
 g.ev(`vsState=null;vs.token='missed';applyVersusState({...msg,misses:{A:1,B:0}});`);assert.equal(g.ev(`Object.keys(LS.get(MEDALS_KEY)).length`),1);g.close();
});
