import {readFile,writeFile,mkdir,rename,rm,cp,lstat,readdir} from 'node:fs/promises';
import {join,resolve,relative,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {acquireMutation} from './workspace-mutation.mjs';
import {readBookmarkDocument} from './bookmark-store.mjs';
const failure=(text,status=400)=>Object.assign(new Error(text),{status});
export async function readChatMetadata(root){
 try{const data=JSON.parse(await readFile(join(root,'data/private/chats.ceobe.json'),'utf8'));if(data.kind!=='ceobe.chat-metadata'||!data.items||Array.isArray(data.items))throw new Error('聊天元数据格式错误');return data}catch(e){if(e.code==='ENOENT')return {schema_version:'1.0.0',kind:'ceobe.chat-metadata',items:{}};throw e}
}
async function atomic(file,data){await mkdir(dirname(file),{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,JSON.stringify(data,null,2));await rename(tmp,file)}finally{await rm(tmp,{force:true})}}
async function exists(path){try{await lstat(path);return true}catch(e){if(e.code==='ENOENT')return false;throw e}}
export async function assertSafeTree(path){const s=await lstat(path);if(s.isSymbolicLink())throw failure('检测到符号链接或目录联接，已拒绝删除',409);if(s.isDirectory())for(const name of await readdir(path))await assertSafeTree(join(path,name))}
const run=(root,args)=>new Promise((yes,no)=>{const child=spawn(process.execPath,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let text='';for(const s of [child.stdout,child.stderr])s.on('data',b=>text=(text+b).slice(-10000));child.on('error',no);child.on('exit',code=>code===0?yes():no(new Error('生成页面失败：'+text)))});
export async function rebuildDeletionStage(stage,sourceRoot){
 for(const name of ['scripts','src','official-templates','samples'])await cp(join(sourceRoot,name),join(stage,name),{recursive:true});
 for(const name of ['package.json','vite.config.mjs'])await cp(join(sourceRoot,name),join(stage,name));
 await cp(join(sourceRoot,'node_modules/katex'),join(stage,'node_modules/katex'),{recursive:true});
 await mkdir(join(stage,'official-assets/cdn/assets'),{recursive:true});
 for(const file of ['sprites-core-26c3f2d4.svg','sprites-shell-097001e7.svg','OpenAISans-Semibold.woff2'])await cp(join(sourceRoot,'official-assets/cdn/assets',file),join(stage,'official-assets/cdn/assets',file));
 await run(stage,['scripts/build-library.mjs']);
 await run(stage,[join(sourceRoot,'node_modules/vite/bin/vite.js'),'build','replay','--config','vite.config.mjs','--outDir','../dist','--emptyOutDir']);
}
export function createChatStore(root,{rebuild=rebuildDeletionStage}={}){
 root=resolve(root);
 async function list(){const library=JSON.parse(await readFile(join(root,'archive/library.ceobe.json'),'utf8'));if(library.kind!=='ceobe.library'||!Array.isArray(library.conversations))throw new Error('聊天索引格式错误');const meta=await readChatMetadata(root);return library.conversations.map(e=>({...e,...meta.items[e.id]}))}
 async function mutate(body){
  const release=await acquireMutation(root);
  try{
   if(typeof body?.id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(body.id))throw failure('无效聊天 ID');
   const entry=(await list()).find(c=>c.id===body.id);if(!entry)throw failure('聊天不存在',404);
   const meta=await readChatMetadata(root);
   if(body.action==='rename'){
    if(typeof body.title!=='string')throw failure('请输入聊天标题');const title=body.title.trim().normalize('NFC');
    if(!title||[...title].length>200||/[\x00-\x1f\x7f]/.test(title))throw failure('标题须为 1–200 个字符，不能含控制字符');
    meta.items[body.id]={...meta.items[body.id],title};await atomic(join(root,'data/private/chats.ceobe.json'),meta);return {conversation:{...entry,title}};
   }
   if(body.action==='pin'){
    if(typeof body.pinned!=='boolean')throw failure('无效置顶状态');const pinned_at=body.pinned?(entry.pinned_at||new Date().toISOString()):null;
    meta.items[body.id]={...meta.items[body.id],pinned_at};await atomic(join(root,'data/private/chats.ceobe.json'),meta);return {conversation:{...entry,pinned_at}};
   }
   if(body.action!=='delete'||body.confirm!==body.id)throw failure('需要明确确认永久删除');
   const target=join(root,'archive/chatgpt-share',body.id);
   if(relative(root,target).startsWith('..'))throw failure('无效路径');
   // No reparse points are traversed. A nonstandard shared cross-archive path is
   // rejected rather than guessing whether its bytes may be removed.
   await assertSafeTree(join(root,'archive'));
   for(const dir of ['replay','dist'])if(await exists(join(root,dir)))await assertSafeTree(join(root,dir));
   if(!await exists(target))throw failure('原始归档目录不存在',409);
   const checkResources=async(dir)=>{for(const n of await readdir(dir,{withFileTypes:true})){const path=join(dir,n.name);if(n.isDirectory())await checkResources(path);else if(n.name==='conversation.ceobe.json'){const c=JSON.parse(await readFile(path,'utf8'));for(const r of c.resources||[]){if(!r.local_path)continue;const resolved=resolve(dirname(path),r.local_path);if(!resolved.startsWith(dirname(path)+requireSeparator()))throw failure('存在跨归档附件路径，需先检查共享资源，已取消删除',409)}}}};
   await checkResources(join(root,'archive/chatgpt-share'));
   const job=join(root,'data/private/delete-jobs',randomUUID()),stage=join(job,'stage'),backup=join(job,'backup');await mkdir(stage,{recursive:true});await mkdir(backup);
   let committed=false,rollbackFailed=false;const moved=[];
   try{
    await cp(join(root,'archive'),join(stage,'archive'),{recursive:true,filter:path=>path!==target&&!path.startsWith(target+requireSeparator())});
    delete meta.items[body.id];await atomic(join(stage,'data/private/chats.ceobe.json'),meta);
    const projectFile=join(root,'data/private/projects.ceobe.json');
    if(await exists(projectFile)){const projects=JSON.parse(await readFile(projectFile,'utf8'));if(projects.kind!=='ceobe.projects'||!Array.isArray(projects.projects))throw new Error('项目文件格式错误');for(const p of projects.projects)p.conversation_ids=(p.conversation_ids||[]).filter(id=>id!==body.id);await atomic(join(stage,'data/private/projects.ceobe.json'),projects)}
    const bookmarkFile=join(root,'data/private/bookmarks.ceobe.json');
    if(await exists(bookmarkFile)){const bookmarks=await readBookmarkDocument(root);bookmarks.items=bookmarks.items.filter(b=>b.chat_id!==body.id);await atomic(join(stage,'data/private/bookmarks.ceobe.json'),bookmarks)}
    await rebuild(stage,root);
    // Durable journal allows fail-closed manual recovery after a process/OS crash.
    await atomic(join(job,'journal.json'),{id:body.id,state:'prepared',paths:[]});
    const paths=[...(await exists(bookmarkFile)?['data/private/bookmarks.ceobe.json']:[]),'archive/chatgpt-share/'+body.id,'archive/library.ceobe.json','data/private/chats.ceobe.json',...(await exists(projectFile)?['data/private/projects.ceobe.json']:[]),'replay','dist'];
    for(const path of paths){const live=join(root,path),old=join(backup,path),fresh=join(stage,path);const item={path,hadOld:false,installed:false};moved.push(item);if(await exists(live)){await mkdir(dirname(old),{recursive:true});await rename(live,old);item.hadOld=true}if(await exists(fresh)){await mkdir(dirname(live),{recursive:true});await rename(fresh,live);item.installed=true}await atomic(join(job,'journal.json'),{id:body.id,state:'committing',paths:moved})}
    committed=true;
    // Success is not returned while raw archives or old generated copies remain.
    await rm(job,{recursive:true});return {deleted:body.id,redirect:'./index.html'};
   }catch(e){
    if(!committed){try{for(const item of moved.reverse()){const live=join(root,item.path);if(item.installed)await rm(live,{recursive:true,force:true});if(item.hadOld){await mkdir(dirname(live),{recursive:true});await rename(join(backup,item.path),live)}}}catch{rollbackFailed=true}}
    if(committed||rollbackFailed){e.message='操作未完全结束，已保留恢复记录；请检查 data/private/delete-jobs，勿重复操作。';e.status=500;throw e}
    await rm(job,{recursive:true,force:true});throw e;
   }
  }finally{await release()}
 }
 return {list,mutate};
}
// OS-aware containment; never concatenate untrusted IDs into arbitrary paths.
function requireSeparator(){return process.platform==='win32'?'\\':'/'}
export function chatMiddleware(root,options){const store=createChatStore(root,options);return async(req,res,next)=>{
 if(req.url.split('?')[0]!=='/api/chats')return next();const send=(code,data)=>{res.statusCode=code;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(data))};
 try{if(req.method==='GET')return send(200,{conversations:await store.list(),writable:true});if(req.method!=='POST')return send(405,{error:'仅支持 GET/POST'});
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw failure('需要 JSON 请求',415);
  if(req.headers['sec-fetch-site']==='cross-site'||req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)throw failure('不允许跨站修改',403);
  let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>4096)throw failure('请求过大',413);chunks.push(c)}let body;try{body=JSON.parse(Buffer.concat(chunks))}catch{throw failure('无效 JSON')}
  send(200,await store.mutate(body));
 }catch(e){send(e.status||500,{error:e.status?e.message:'操作失败，未确认保存或删除成功；请检查本地服务日志。'});console.error('Chat operation:',e.message)}
}}
