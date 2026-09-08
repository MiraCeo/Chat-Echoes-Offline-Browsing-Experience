import assert from 'node:assert/strict';import{readFile,writeFile,mkdir,rm,mkdtemp,readdir,symlink}from'node:fs/promises';import{join}from'node:path';import{createHash}from'node:crypto';import{createChatStore,rebuildDeletionStage}from'./chat-store.mjs';import{createProjectStore}from'./project-store.mjs';
const base=process.cwd();await mkdir('data/private',{recursive:true});const root=await mkdtemp(join(base,'data/private/action-test-'));const json=async(p,v)=>{await mkdir(join(p,'..'),{recursive:true});await writeFile(p,JSON.stringify(v))};
try{
 const sample=JSON.parse(await readFile('samples/independent-conversation.json','utf8'));const entries=[];
 for(const id of ['chat-one','chat-two']){for(const stamp of ['2026-01-01','2026-02-01']){const dir=join(root,'archive/chatgpt-share',id,stamp);await mkdir(join(dir,'raw'),{recursive:true});await mkdir(join(dir,'assets'));await writeFile(join(dir,'raw/share.html'),'RAW-SECRET-'+id);await writeFile(join(dir,'assets/53bc8e6bd2720512dfebe2cab3c763e4503f55a41809b68bcc148637850bf871.txt'),'shared-safe');const bytes=Buffer.from('shared-safe');await json(join(dir,'conversation.ceobe.json'),{...sample,kind:'ceobe.conversation',title:id,resources:[{key:'shared',aliases:[],message_ids:[],name:'shared.txt',mime_type:'text/plain',status:'downloaded',local_path:'assets/53bc8e6bd2720512dfebe2cab3c763e4503f55a41809b68bcc148637850bf871.txt',sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,size_bytes:bytes.length}]})}entries.push({id,title:id,conversation_path:`archive/chatgpt-share/${id}/2026-02-01/conversation.ceobe.json`,page:`./conversations/${id}.html`})}
 await json(join(root,'archive/library.ceobe.json'),{schema_version:'1.0.0',kind:'ceobe.library',conversations:entries});
 for(const dir of ['replay','dist']){await mkdir(join(root,dir));await writeFile(join(root,dir,'old-secret.html'),'RAW-SECRET-chat-one')}
 const ps=createProjectStore(join(root,'data/private/projects.ceobe.json'));const project=await ps.create({name:'测试'});await ps.move('chat-one',project.id);
 const store=createChatStore(root,{rebuild:stage=>rebuildDeletionStage(stage,base)});
 await assert.rejects(()=>store.mutate({id:'../outside',action:'delete',confirm:'../outside'}));
 await assert.rejects(()=>store.mutate({id:'chat-one',action:'delete'}));
 await assert.rejects(()=>store.mutate({id:'chat-one',action:'rename',title:'  '}));
 await store.mutate({id:'chat-two',action:'rename',title:'新标题'});await store.mutate({id:'chat-two',action:'pin',pinned:true});assert.equal((await store.list()).find(c=>c.id==='chat-two').title,'新标题');assert.ok((await createChatStore(root).list()).find(c=>c.id==='chat-two').pinned_at);
 await mkdir(join(root,'outside'));await writeFile(join(root,'outside/keep.txt'),'keep');await symlink(join(root,'outside'),join(root,'archive/chatgpt-share/chat-one/linked'),'junction');await assert.rejects(()=>store.mutate({id:'chat-one',action:'delete',confirm:'chat-one'}));assert.equal(await readFile(join(root,'outside/keep.txt'),'utf8'),'keep');await rm(join(root,'archive/chatgpt-share/chat-one/linked'));
 const failed=createChatStore(root,{rebuild:async()=>{throw new Error('injected build failure')}});await assert.rejects(()=>failed.mutate({id:'chat-one',action:'delete',confirm:'chat-one'}));assert.equal(await readFile(join(root,'replay/old-secret.html'),'utf8'),'RAW-SECRET-chat-one');
 await store.mutate({id:'chat-one',action:'delete',confirm:'chat-one'});
 await assert.rejects(()=>readFile(join(root,'archive/chatgpt-share/chat-one/2026-01-01/raw/share.html')));
 assert.equal(await readFile(join(root,'archive/chatgpt-share/chat-two/2026-01-01/assets/53bc8e6bd2720512dfebe2cab3c763e4503f55a41809b68bcc148637850bf871.txt'),'utf8'),'shared-safe');
 assert.ok(!(await ps.list())[0].conversation_ids.includes('chat-one'));
 assert.equal((await store.list()).length,1);assert.equal((await store.list())[0].title,'新标题');
 for(const dir of ['replay','dist']){await assert.rejects(()=>readFile(join(root,dir,'old-secret.html')));await assert.rejects(()=>readFile(join(root,dir,'conversations/chat-one.html')))}
 assert.equal((await readdir(join(root,'data/private/delete-jobs'))).length,0);
 await store.mutate({id:'chat-two',action:'delete',confirm:'chat-two'});assert.equal((await store.list()).length,0);assert.ok((await readFile(join(root,'dist/index.html'),'utf8')).includes('本地聊天'));
 console.log('PASS: rename/pin persistence, path/confirmation validation, failed-build preservation, all archive versions removed, survivor shared attachment preserved, project unlink, clean replay/dist, last-chat empty rebuild. Isolated data only.');
}finally{await rm(root,{recursive:true,force:true})}
