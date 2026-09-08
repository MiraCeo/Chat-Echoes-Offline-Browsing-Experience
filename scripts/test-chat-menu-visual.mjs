// Compare production DOM/computed styles with an independently rendered frozen reference.
// This test never reads 参考文件/ and never writes the user's project data.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {chromium} from 'playwright';
import {preview} from 'vite';
const f=JSON.parse(await readFile('official-templates/chat-menu.json','utf8'));
const production=process.env.CEOBE_TEST_DIST==='1'?await preview({configFile:'vite.config.mjs',root:'replay',build:{outDir:'../dist'},preview:{host:'127.0.0.1',port:0}}):null;
const base=production?`http://127.0.0.1:${production.httpServer.address().port}/`:'http://127.0.0.1:5173/';
const browser=await chromium.launch({channel:'msedge',headless:true});
const options={viewport:{width:f.viewport.width,height:f.viewport.height},deviceScaleFactor:f.viewport.dpr};
const properties=['width','minWidth','maxWidth','height','paddingTop','paddingRight','paddingBottom','paddingLeft','marginTop','marginRight','marginBottom','marginLeft','borderRadius','borderWidth','borderColor','boxShadow','backgroundColor','fontSize','fontFamily','lineHeight','gap','color','opacity'];
const sample=(page,selector)=>page.locator(selector).evaluate((e,props)=>{
 const all=[e,...e.querySelectorAll('*')];
 return {tree:all.map(n=>({tag:n.tagName,class:n.getAttribute('class')||'',role:n.getAttribute('role')||''})),
  metrics:[e,...e.querySelectorAll('[role=menuitem],[role=separator]')].map(n=>{const style=getComputedStyle(n),r=n.getBoundingClientRect(),parent=e.getBoundingClientRect();return {css:Object.fromEntries(props.map(k=>[k,style[k]])),relative:{x:r.x-parent.x,y:r.y-parent.y,width:r.width,height:r.height}}})};
},properties);
function compare(actual,expected,label){assert.deepEqual(actual.tree,expected.tree,label+' official element hierarchy/classes');assert.equal(actual.metrics.length,expected.metrics.length);for(let i=0;i<actual.metrics.length;i++){assert.deepEqual(actual.metrics[i].css,expected.metrics[i].css,label+' computed CSS, node '+i);for(const k of ['x','y','width','height'])assert.ok(Math.abs(actual.metrics[i].relative[k]-expected.metrics[i].relative[k])<0.1,label+' relative '+k+' at '+i)}}
try{
 const ref=await browser.newPage(options),page=await browser.newPage(options);
 const wrappers=f.layouts.map(l=>parseHTML(l.wrapper).document.querySelector('[data-radix-popper-content-wrapper]'));
 // User explicitly removed Archive; compare the same intentional product delta.
 wrappers[0].querySelectorAll('[role=menuitem]')[3].remove();
 const refSub=wrappers[1].querySelector('[role=menu]');const refRows=[...refSub.querySelectorAll('a[role=menuitem]')];refRows[0].querySelector('.truncate').textContent='测试';for(const row of refRows.slice(1))row.parentElement.remove();
 // Baseline has an open submenu, exactly as captured. No local styles/scripts are included.
 const html=`<!DOCTYPE html><html ${Object.entries(f.htmlAttributes).map(([k,v])=>`${k}="${v.replaceAll('\"','&quot;')}"`).join(' ')}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${f.styleSequence.map(s=>s.file?`<link rel="stylesheet" href="/reference-css/${s.file}">`:`<style>${s.text}</style>`).join('')}</head><body>${wrappers.map(w=>w.outerHTML).join('')}</body></html>`;
 await ref.route('**/*',async route=>{const path=new URL(route.request().url()).pathname;if(path==='/official-reference'){await route.fulfill({contentType:'text/html',body:html});return}if(path.startsWith('/reference-css/')){await route.fulfill({contentType:'text/css',body:await readFile('official-templates/assets/'+decodeURIComponent(path.split('/').pop()))});return}await route.abort()});
 await ref.goto(base+'official-reference',{waitUntil:'networkidle'});await ref.mouse.move(1000,900);
 await page.route('**/api/projects',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({writable:true,projects:[{id:'visual-test',name:'测试',icon:'folder',color:'default',conversation_ids:[]}]})}));
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base,{waitUntil:'networkidle'});
 const button=page.locator('[data-ceobe-chat-id]').first();await button.locator('xpath=ancestor::a').hover();await button.click();
 assert.equal(await page.locator('[data-ceobe-chat-menu] [data-highlighted]').count(),0,'Pointer opening does not highlight Share');
 assert.equal(await page.locator('[data-ceobe-chat-menu] [aria-disabled=true]').count(),0,'No invented disabled styling');
 await page.locator('[data-chat-action=move]').hover();await page.locator('[data-chat-project="visual-test"]').waitFor();await page.mouse.move(1000,900);
 const main=await sample(page,'[data-ceobe-chat-menu]'),sub=await sample(page,'[data-ceobe-chat-submenu]');
 const expectedMain=await sample(ref,'[role=menu] >> nth=0'),expectedSub=await sample(ref,'[role=menu] >> nth=1');
 compare(main,expectedMain,'Main menu');compare(sub,expectedSub,'Project submenu');
 for(const [i,selector,anchor] of [[0,'[data-ceobe-chat-menu]','[data-ceobe-chat-id][aria-expanded=true]'],[1,'[data-ceobe-chat-submenu]','[data-chat-action=move]']]){
  const actual=await page.locator(selector).evaluate((e,anchor)=>{const a=document.querySelector(anchor).getBoundingClientRect(),w=e.parentElement.getBoundingClientRect();return {dx:w.x-a.x,dxRight:w.x-a.right,dy:w.y-a.y,dyBottom:w.y-a.bottom}},anchor);
  assert.ok(Math.abs((i===0?actual.dx:actual.dxRight)-f.layouts[i].offset.x)<0.1,'Measured x offset');assert.ok(Math.abs((i===0?actual.dyBottom:actual.dy)-f.layouts[i].offset.y)<0.1,'Measured y offset');
 }
 const sizes={main:main.metrics[0].relative,submenu:sub.metrics[0].relative};
 assert.deepEqual(errors,[]);console.log('PASS: exact official DOM hierarchy/classes, per-row computed styles, shadow/radius/colors/spacing, separators, no disabled washout, no initial Share highlight, and supplied anchor-relative placement.',JSON.stringify(sizes));
}finally{await browser.close();if(production)await new Promise(r=>production.httpServer.close(r))}
