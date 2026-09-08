// Live official Edge measurements: data/private/live-compare/{result,extra}.json.
// Test fixtures are DOM-only; never write the user's chat/project store.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {preview} from 'vite';
const prod=process.env.CEOBE_TEST_DIST==='1'?await preview({configFile:'vite.config.mjs',root:'replay',build:{outDir:'../dist'},preview:{host:'127.0.0.1',port:0}}):null;
const base=prod?`http://127.0.0.1:${prod.httpServer.address().port}/`:'http://127.0.0.1:5173/';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 for(const viewport of [{width:1028,height:908},{width:1092,height:935}]){
  const page=await browser.newPage({viewport,deviceScaleFactor:1.5}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{assert.equal(route.request().method(),'GET');await route.continue()});
  await page.goto(base+'import.html',{waitUntil:'networkidle'});
  const organizer=page.locator('#ceobe-organizer-menu');
  for(const mode of ['list','projects']){
   const trigger=page.locator('[data-organizer-trigger]:visible').first();await trigger.locator('..').hover();await trigger.click();
   const a=await trigger.boundingBox(),r=await organizer.boundingBox();assert.equal(r.width,148);assert.equal(r.height,128);assert.ok(Math.abs(r.x-a.x+14)<0.1);assert.ok(Math.abs(r.y-a.y-a.height+4)<0.1,'Organizer bottom -4px in '+mode);
   if(mode==='list')await organizer.getByText('按项目',{exact:true}).click();else await page.keyboard.press('Escape');
  }
  await page.evaluate(()=>{const ul=document.querySelector('[data-chat-recent-list]'),row=ul.firstElementChild;if(row){for(let i=0;i<35;i++)ul.append(row.cloneNode(true))}});
  const b=page.locator('[data-chat-recent-list] [data-ceobe-chat-id]').last(),menu=page.locator('[data-ceobe-chat-menu]');await b.scrollIntoViewIfNeeded();await b.locator('xpath=ancestor::a').hover();await b.click();
  const a=await b.boundingBox(),r=await menu.boundingBox();assert.equal(await menu.getAttribute('data-side'),'top');assert.equal(r.height,234,'Full menu, not a 90px viewport-edge sliver');assert.ok(Math.abs(r.y+r.height-a.y-4.333333)<0.1,'Live measured top offset');assert.ok(r.y>=0&&r.y+r.height<=viewport.height);assert.equal(await menu.evaluate(e=>e.scrollHeight===e.clientHeight),true);
  await menu.locator('[data-chat-action=move]').hover();await page.locator('[data-ceobe-chat-submenu]').waitFor();assert.equal(await menu.isVisible(),true);await page.keyboard.press('Escape');
  // A second Escape may be needed if the keyboard focus is in the submenu.
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{const b=document.createElement('button');b.id='edge-position-fixture';b.dataset.ceobeChatId='edge-position-fixture';b.textContent='fixture';b.style.cssText='position:fixed;left:200px;top:24px;width:34px;height:36px;z-index:999';document.body.append(b)});
  const fixture=page.locator('#edge-position-fixture');await fixture.click();assert.equal(await menu.getAttribute('data-side'),'bottom','Reopening resets previous top placement');assert.equal((await menu.boundingBox()).height,234);await page.keyboard.press('Escape');
  // Neither side fits: choose the larger side, keep scrolling available and stay in viewport.
  await page.setViewportSize({width:viewport.width,height:160});await fixture.evaluate(e=>e.style.top='100px');await fixture.click();assert.equal(await menu.getAttribute('data-side'),'top');const small=await menu.boundingBox();assert.ok(small.y>=-0.1&&small.y+small.height<=160.1);assert.ok(await menu.evaluate(e=>e.scrollHeight>e.clientHeight));await menu.evaluate(e=>e.scrollTop=e.scrollHeight);assert.equal(await menu.isVisible(),true);
  assert.deepEqual(errors,[]);console.log('PASS menu edges',JSON.stringify(viewport),'full top menu, measured offset, submenu, bottom reset, short viewport scrolling, organizer list/project offsets; GET only');await page.close();
 }
}finally{await browser.close();if(prod)await new Promise(r=>prod.httpServer.close(r))}
