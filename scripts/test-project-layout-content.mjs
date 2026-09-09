// Compare equal content, not different users' chat lists: intrinsic Grid widths depend on text.
// Live same-Edge cross-check: official DOM + local text = 705.333px;
// local DOM + official text = 736px at 1028x908, DPR 1.5. No private text is needed here.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {preview} from 'vite';
const reference=JSON.parse(await readFile('official-templates/project-detail.json','utf8'));
// Compare equal header content: the approved local share replacement is ZIP export.
reference.main=reference.main.replaceAll('分享','另存为 ZIP');
const prod=process.env.CEOBE_TEST_DIST==='1'?await preview({configFile:'vite.config.mjs',root:'replay',build:{outDir:'../dist'},preview:{host:'127.0.0.1',port:0}}):null;
const base=prod?`http://127.0.0.1:${prod.httpServer.address().port}/`:'http://127.0.0.1:5173/';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 for(const viewport of [{width:1028,height:908},{width:1092,height:935}]){
  const p=await browser.newPage({viewport,deviceScaleFactor:1.5});await p.route('**/api/**',async r=>{assert.equal(r.request().method(),'GET');await r.continue()});
  const data=await(await p.request.get(base+'api/projects')).json(),project=data.projects.find(p=>p.name==='测试');assert.ok(project);
  await p.goto(base+'project.html?id='+project.id,{waitUntil:'networkidle'});const local=await p.locator('main').evaluate(e=>e.outerHTML);
  for(const sample of ['简短内容','https://example.invalid/'+ 'LongUnbrokenToken'.repeat(24)]){
   const measurements=[];
   for(const html of [local,reference.main]){
    await p.evaluate(({html,sample})=>{document.querySelector('main').outerHTML=html;document.querySelector('[name=project-title]').textContent='布局测试';const list=document.querySelector('main ol'),row=list.firstElementChild.cloneNode(true);list.replaceChildren();for(let i=0;i<2;i++){const e=row.cloneNode(true);e.querySelector('a .font-medium').textContent='会话 '+i;e.querySelector('a .text-token-text-secondary').textContent=sample;e.querySelector('[data-testid=project-conversation-overflow-date]').textContent='9月9日';list.append(e)}},{html,sample});
    measurements.push(await p.evaluate(()=>['main h1','main [data-composer-surface]','main [role=tablist]','main ol','main ol li'].map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})));
   }
   assert.deepEqual(measurements[0],measurements[1],'Equal content must produce equal official/local geometry');
  }
  console.log('PASS project layout same-content matrix',JSON.stringify(viewport),'short text and long unbroken token; no fixed-width compensation; GET only');await p.close();
 }
}finally{await browser.close();if(prod)await new Promise(r=>prod.httpServer.close(r))}
