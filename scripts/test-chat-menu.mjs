import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {preview} from 'vite';
import {createProjectStore,projectsMiddleware} from './project-store.mjs';
const production=process.env.CEOBE_TEST_DIST==='1'?await preview({configFile:'vite.config.mjs',root:'replay',build:{outDir:'../dist'},preview:{host:'127.0.0.1',port:0}}):null;
const base=production?`http://127.0.0.1:${production.httpServer.address().port}/`:'http://127.0.0.1:5173/';
const dir=await mkdtemp(join(tmpdir(),'ceobe-menu-'));const library=JSON.parse(await readFile('archive/library.ceobe.json','utf8'));await mkdir(join(dir,'archive'));await writeFile(join(dir,'archive/library.ceobe.json'),JSON.stringify(library));
const store=createProjectStore(join(dir,'data/private/projects.ceobe.json'));const first=await store.create({name:'隔离项目一'}),second=await store.create({name:'隔离项目二',color:'#ee7c37',icon:'heart'});
const server=createServer((req,res)=>projects(req,res,()=>res.end()));const projects=projectsMiddleware(dir);await new Promise(r=>server.listen(0,'127.0.0.1',r));const api=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1092,height:935},deviceScaleFactor:1.5});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base,{waitUntil:'networkidle'});const original=page.url();const button=page.locator('[data-ceobe-chat-id]').first(),menu=page.locator('[data-ceobe-chat-menu]'),sub=page.locator('[data-ceobe-chat-submenu]');await button.locator('xpath=ancestor::a').hover();await button.click();assert.equal(page.url(),original);await menu.locator('[data-chat-action=move]').hover();
 const real=await(await fetch(base+'api/projects')).json();for(const p of real.projects)await sub.locator('[data-chat-project]').filter({hasText:p.name}).waitFor();console.log('Actual synchronized projects:',real.projects.map(p=>p.name).join(', '));
 assert.equal(await sub.locator('[data-chat-project]').count(),real.projects.length);
 await page.keyboard.press('Escape'); // hover leaves focus in main; Escape closes both
 await page.route('**/api/projects**',async route=>{const req=route.request();const r=await fetch(api+new URL(req.url()).pathname,{method:req.method(),...(req.method()==='POST'?{headers:{'Content-Type':'application/json'},body:req.postData()}: {})});await route.fulfill({status:r.status,contentType:'application/json',body:await r.text()})});
 await button.locator('xpath=ancestor::a').hover();await button.click();await menu.locator('[data-chat-action=move]').click();await sub.locator(`[data-chat-project="${first.id}"]`).click();await page.waitForFunction(()=>document.getElementById('ceobe-chat-status').textContent.includes('已移至'));
 const id=await button.getAttribute('data-ceobe-chat-id');assert.ok((await store.list()).find(p=>p.id===first.id).conversation_ids.includes(id));
 await button.locator('xpath=ancestor::a').hover();await button.click();await menu.locator('[data-chat-action=move]').click();await sub.locator(`[data-chat-project="${second.id}"]`).click();await page.waitForFunction(()=>document.querySelector('[data-ceobe-chat-menu]').hidden);
 const saved=await createProjectStore(join(dir,'data/private/projects.ceobe.json')).list();assert.ok(saved.find(p=>p.id===second.id).conversation_ids.includes(id));assert.ok(!saved.find(p=>p.id===first.id).conversation_ids.includes(id));
 await page.reload({waitUntil:'networkidle'});await button.locator('xpath=ancestor::a').hover();await button.click();await menu.locator('[data-chat-action=move]').click();await sub.locator(`[data-chat-project="${second.id}"]`).waitFor();assert.equal(await sub.locator(`[data-chat-project="${second.id}"]`).getAttribute('data-chat-current'),'');
 const box=await sub.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=1092&&box.y+box.height<=935);await page.keyboard.press('Escape');assert.equal(await sub.isVisible(),false);assert.equal(await menu.isVisible(),true);await page.keyboard.press('Escape');assert.equal(await menu.isVisible(),false);
 await page.goto(base+library.conversations[0].page.replace('./',''),{waitUntil:'networkidle'});await button.locator('xpath=ancestor::a').hover();await button.click();await menu.locator('[data-chat-action=move]').click();await sub.locator(`[data-chat-project="${second.id}"]`).waitFor();
 for(const href of await sub.locator('[data-chat-project] use').evaluateAll(es=>es.map(e=>e.getAttribute('href')))){const r=await fetch(new URL(href,page.url()));assert.match(r.headers.get('content-type'),/svg/)}
 const invalid=await fetch(api+'/api/projects/move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId:'not-real',projectId:first.id})});assert.equal(invalid.status,404);
 assert.deepEqual(errors,[]);console.log('PASS: sidebar ID mapping, no navigation on ellipsis, official menus, live project names, persisted exclusive move, nested paths, icons, keyboard and viewport; real user data untouched.');
}finally{await browser.close();await new Promise(r=>server.close(r));if(production)await new Promise(r=>production.httpServer.close(r));await rm(dir,{recursive:true,force:true})}
