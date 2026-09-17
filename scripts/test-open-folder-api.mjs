import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';import {join,resolve} from 'node:path';import {createServer} from 'node:http';
import {openFolderMiddleware,resolveChatFolder} from './open-folder-api.mjs';
await mkdir('data/private',{recursive:true});const root=await mkdtemp('data/private/open-folder-test-');const id='6a606f18-e6e0-83ee-b3c3-6c74f720a853',capture='2026-09-15T15-18-32.338Z';
let server;const opened=[];
try{
 const folder=join(root,'archive/chatgpt-share',id,capture);await mkdir(folder,{recursive:true});await writeFile(join(folder,'conversation.ceobe.json'),'{}');
 await writeFile(join(root,'archive/library.ceobe.json'),JSON.stringify({kind:'ceobe.library',conversations:[
  {id,title:'事件复盘与评价',conversation_path:`archive/chatgpt-share/${id}/${capture}/conversation.ceobe.json`},
  {id:'escaped-1111-1111-1111-111111111111',title:'逃逸',conversation_path:'data/private/other/conversation.ceobe.json'},
  {id:'missing-1111-1111-1111-111111111111',title:'目录不存在',conversation_path:'archive/chatgpt-share/missing-1111-1111-1111-111111111111/x/conversation.ceobe.json'}]}));
 await mkdir(join(root,'data/private/other'),{recursive:true});await writeFile(join(root,'data/private/other/conversation.ceobe.json'),'{}');
 await mkdir(join(root,'archive/chatgpt-share','escaped-1111-1111-1111-111111111111'),{recursive:true});// share folder exists, but its library path points elsewhere
 const middleware=openFolderMiddleware(root,{open:async f=>{opened.push(f)}});
 server=createServer((q,s)=>middleware(q,s,()=>{s.statusCode=404;s.end()}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const post=(qs,headers={})=>fetch(base+'/api/chats/open-folder'+qs,{method:'POST',headers});
 assert.equal((await fetch(base+'/api/chats/open-folder?id='+id)).status,405,'GET never opens anything');
 assert.equal((await post('?id='+id,{Origin:'https://example.com'})).status,403);
 assert.equal((await post('?id='+id,{'Sec-Fetch-Site':'cross-site'})).status,403);
 assert.equal((await post('?id=../../etc')).status,400);assert.equal((await post('')).status,400);
 assert.equal((await post('?id=00000000-0000-0000-0000-000000000000')).status,404);
 assert.equal((await post('?id=escaped-1111-1111-1111-111111111111')).status,409,'paths outside archive/chatgpt-share/<id>/ are refused');
 assert.equal((await post('?id=missing-1111-1111-1111-111111111111')).status,404,'library entry whose folder vanished');
 assert.deepEqual(opened,[],'nothing opened before a valid request');
 const ok=await post('?id='+id,{Origin:'http://127.0.0.1:'+server.address().port});const data=await ok.json();
 assert.equal(ok.status,200);assert.equal(data.opened,true);assert.equal(data.folder,`archive/chatgpt-share/${id}/${capture}`);
 assert.equal(opened.length,1);assert.equal(opened[0],await (await import('node:fs/promises')).realpath(folder),'explorer receives the real capture folder, not the file');
 // Opener failures surface as 500 without leaking the path.
 const failing=openFolderMiddleware(root,{open:async()=>{throw new Error('spawn failed')}});const s2=createServer((q,s)=>failing(q,s,()=>{s.statusCode=404;s.end()}));await new Promise(r=>s2.listen(0,'127.0.0.1',r));
 const bad=await fetch('http://127.0.0.1:'+s2.address().port+'/api/chats/open-folder?id='+id,{method:'POST'});assert.equal(bad.status,500);assert.ok(!JSON.stringify(await bad.json()).includes(root));await new Promise(r=>s2.close(r));
 // Non-Windows opener reports unsupported instead of guessing a file manager.
 if(process.platform!=='win32'){const {defaultOpener}=await import('./open-folder-api.mjs');await assert.rejects(()=>defaultOpener(folder),e=>e.status===501)}
 // A linked capture folder pointing outside the archive is refused: realpath containment (409) or, when the platform
 // cannot resolve the reparse point, ENOENT (404). Either way nothing is opened.
 try{const link=join(root,'archive/chatgpt-share','linked-1111-1111-1111-111111111111');await mkdir(link,{recursive:true});await symlink(resolve(root,'data/private/other'),join(link,'cap'),process.platform==='win32'?'junction':'dir');
  const before=opened.length;await assert.rejects(()=>resolveChatFolder(root,{id:'linked-1111-1111-1111-111111111111',conversation_path:'archive/chatgpt-share/linked-1111-1111-1111-111111111111/cap/conversation.ceobe.json'}),e=>e.status===409||e.code==='ENOENT');assert.equal(opened.length,before)}catch(e){if(e.code!=='EPERM')throw e}
 console.log('PASS open folder API: POST only, same-origin, id validation, 404/409 containment, explorer gets the capture folder, opener failure hidden');
}finally{if(server)await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true})}
