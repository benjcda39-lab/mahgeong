// Preview and regression checks for cleared-level replay. No live site or stored player data is used.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFileSync, mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('../../',import.meta.url);
const out=new URL('../out/level-menu/',import.meta.url); mkdirSync(out,{recursive:true});
const head='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:14px system-ui} [hidden]{display:none!important}</style></head><body>';
const server=createServer((req,res)=>{
  if(req.url.startsWith('/flags/')){try{res.end(readFileSync(new URL('.'+req.url,root)));}catch{res.writeHead(404);res.end();}return;}
  const file=req.url==='/before' && process.env.BEFORE_HTML ? process.env.BEFORE_HTML : new URL('index.html',root);
  res.setHeader('Content-Type','text/html');res.end(head+readFileSync(file,'utf8')+'</body></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
let checks=0;
try{
 for(const [name,width,height,scheme] of [['phone',390,844,'light'],['desktop',1100,850,'light'],['phone-dark',390,844,'dark']]){
  const context=await browser.newContext({viewport:{width,height},colorScheme:scheme});
  await context.addInitScript(()=>{localStorage.setItem('mahgeong-level-progress-v1','12');localStorage.setItem('mahgeong-last-tab','"levels"');});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  if(process.env.BEFORE_HTML){
   await page.goto(url+'/before'); await page.locator('#level-title').waitFor();
   await page.screenshot({path:new URL(`before-${name}.png`,out).pathname});
   await page.locator('#level-picker summary').click();
   await page.screenshot({path:new URL(`before-open-${name}.png`,out).pathname});
  }
  await page.goto(url);await page.locator('#level-picker').waitFor();await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>setTimeout(r,300));});await page.screenshot({path:new URL(`after-board-${name}.png`,out).pathname});await page.locator('#level-picker').click();
  await page.screenshot({path:new URL(`after-${name}.png`,out).pathname});
  assert.equal(await page.locator('#level-grid button:not(:disabled)').count(),12);
  assert.equal(await page.locator('#level-grid button:disabled').count(),48);
  assert.match(await page.locator('#level-next').innerText(),/Play level 13/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks+=4;
  await page.locator('[data-level="12"]').click();
  assert.deepEqual(await page.evaluate(()=>({n:state.level,done:state.done,alive:state.tiles.every(t=>t.alive),cleared:levelCleared})),{n:12,done:false,alive:true,cleared:12});checks++;
  // Simulate a real clear through the game's matching rules, then replay that exact saved completed board.
  await page.evaluate(()=>{while(!state.done){const m=findMove();if(!m)throw Error('No move');onTile(state.tiles.indexOf(m[0]));onTile(state.tiles.indexOf(m[1]));}closeOverlay();});
  await page.locator('#level-picker').click(); await page.locator('[data-level="12"]').click();
  assert.equal(await page.evaluate(()=>state.done),false);assert.equal(await page.evaluate(()=>levelCleared),12);checks+=2;
  // A started board requires a choice before it can be replaced. Cancel preserves its state.
  await page.evaluate(()=>{const m=findMove();onTile(state.tiles.indexOf(m[0]));onTile(state.tiles.indexOf(m[1]));});
  const before=await page.evaluate(()=>JSON.stringify({...snapshotOf(state),elapsed:0,elapsedMs:0}));
  await page.locator('#level-picker').click();page.once('dialog',d=>d.dismiss());await page.locator('[data-level="1"]').click();
  assert.equal(await page.evaluate(()=>JSON.stringify({...snapshotOf(state),elapsed:0,elapsedMs:0})),before);checks++;
  page.once('dialog',d=>d.accept());await page.locator('[data-level="1"]').click();
  assert.equal(await page.evaluate(()=>state.level),1);checks++;
  await page.locator('#level-picker').click();await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.querySelector('#level-menu').open),false);checks++;
  await page.locator('#level-picker').click();await page.locator('#level-next').click();assert.equal(await page.evaluate(()=>state.level),13);checks++;
  await page.evaluate(()=>{const m=findMove();onTile(state.tiles.indexOf(m[0]));onTile(state.tiles.indexOf(m[1]));});
  await page.locator('#level-restart').click();assert.equal(await page.evaluate(()=>state.tiles.every(t=>t.alive) && state.log.length===0 && state.level===13),true);checks++;
  assert.equal(await page.locator('#shade-range').inputValue(),'100');checks++;
  await page.locator('label[for=journey-expedition]').click();assert.equal(await page.locator('#level-picker').isVisible(),false);checks++;
  assert.deepEqual(errors,[]);checks++;
  await context.close();
 }
 // No-clear and all-cleared boundaries.
 for(const cleared of [0,60]){
  const context=await browser.newContext();await context.addInitScript(n=>{localStorage.setItem('mahgeong-level-progress-v1',String(n));localStorage.setItem('mahgeong-last-tab','"levels"');},cleared);
  const page=await context.newPage();await page.goto(url);await page.locator('#level-picker').click();
  assert.equal(await page.locator('#level-grid button:not(:disabled)').count(),cleared);
  assert.equal(await page.locator('#level-next').isVisible(),cleared<60);checks+=2;
  await context.close();
 }
 console.log(`${checks} level-menu checks passed; screenshots: ${out.pathname}`);
}finally{await browser.close();server.close();}
