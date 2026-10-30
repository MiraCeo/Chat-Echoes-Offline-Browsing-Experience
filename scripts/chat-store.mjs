import { markDistStale } from './dist-stale.mjs';
import {readFile,writeFile,mkdir,rename,rm,cp,lstat,readdir,link} from 'node:fs/promises';
import {join,resolve,relative,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {acquireMutation} from './workspace-mutation.mjs';
import {readBookmarkDocument} from './bookmark-store.mjs';
import {writeChatIndexMarkdown,CHAT_INDEX_FILE} from './chat-index-markdown.mjs';
const failure=(text,status=400)=>Object.assign(new Error(text),{status});
export async function readChatMetadata(root){
 try{const data=JSON.parse(await readFile(join(root,'data/private/chats.ceobe.json'),'utf8'));if(data.kind!=='ceobe.chat-metadata'||!data.items||Array.isArray(data.items))throw new Error('聊天元数据格式错误');return data}catch(e){if(e.code==='ENOENT')return {schema_version:'1.0.0',kind:'ceobe.chat-metadata',items:{}};throw e}
}
async function atomic(file,data){await mkdir(dirname(file),{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,JSON.stringify(data,null,2));await rename(tmp,file)}finally{await rm(tmp,{force:true})}}
async function exists(path){try{await lstat(path);return true}catch(e){if(e.code==='ENOENT')return false;throw e}}
export async function assertSafeTree(path){const s=await lstat(path);if(s.isSymbolicLink())throw failure('检测到符号链接或目录联接，已拒绝删除',409);if(s.isDirectory())for(const name of await readdir(path))await assertSafeTree(join(path,name))}
const run=(root,args)=>new Promise((yes,no)=>{const child=spawn(process.execPath,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let text='';for(const s of [child.stdout,child.stderr])s.on('data',b=>text=(text+b).slice(-10000));child.on('error',no);child.on('exit',code=>code===0?yes():no(new Error('生成页面失败：'+text)))});
// Deletion needs a writable replay stage, but almost all large trees are immutable
// inputs. Hardlink those instead of copying gigabytes on every delete. Files that
// the build can rewrite (pages, indexes, previews, library assets) stay real copies.
const cloneTree = async (source, target, { hardlink = false, hardlinkRoots = [], skip = [] } = {}) => {
  const normalizedRoots = hardlinkRoots.map(value => value.replaceAll('\\', '/'));
  const skipped = path => skip.some(prefix => path === prefix || path.startsWith(prefix + requireSeparator()));
  const walk = async (from, to, relativePath = '') => {
    await mkdir(to, { recursive: true });
    for (const entry of await readdir(from, { withFileTypes: true })) {
      const sourcePath = join(from, entry.name);
      if (skipped(sourcePath)) continue;
      const targetPath = join(to, entry.name);
      const nextRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(sourcePath, targetPath, nextRelative);
        continue;
      }
      if (!entry.isFile()) {
        await cp(sourcePath, targetPath, { recursive: true });
        continue;
      }
      const posixRelative = nextRelative.replaceAll('\\', '/');
      const shouldLink = hardlink || normalizedRoots.some(root => posixRelative === root || posixRelative.startsWith(root + '/'));
      if (!shouldLink) {
        await cp(sourcePath, targetPath, { force: true });
        continue;
      }
      try { await link(sourcePath, targetPath); }
      catch (error) {
        if (error.code === 'EEXIST') continue;
        await cp(sourcePath, targetPath, { force: true });
      }
    }
  };
  await walk(source, target);
};
export async function rebuildDeletionStage(stage,sourceRoot){
 const stageStarted=Date.now();
 for(const name of ['scripts','src','official-templates','samples'])await cp(join(sourceRoot,name),join(stage,name),{recursive:true});
 for(const name of ['package.json','vite.config.mjs'])await cp(join(sourceRoot,name),join(stage,name));
 await cp(join(sourceRoot,'node_modules/katex'),join(stage,'node_modules/katex'),{recursive:true});
 await mkdir(join(stage,'official-assets/cdn/assets'),{recursive:true});
 for(const file of ['sprites-core-26c3f2d4.svg','sprites-shell-097001e7.svg','OpenAISans-Semibold.woff2'])await cp(join(sourceRoot,'official-assets/cdn/assets',file),join(stage,'official-assets/cdn/assets',file));
 // 复用现有产物与构建指纹：只删掉那个会话的页面，其余页面按指纹跳过渲染，
 // 装饰指纹也一并带过去，没有变化的页面连解析、写盘都省掉。没有这步时暂存目录是空的，等于全量重建。
 if(await exists(join(sourceRoot,'replay'))) {
   await cloneTree(join(sourceRoot,'replay'),join(stage,'replay'),{hardlinkRoots:['archive-resources','public/archive-resources']});
 }
 // library.ceobe.json is written by build-library; break its hardlink before the
 // stage build so a failed deletion cannot mutate the live index through the link.
 const stagedArchiveIndex=join(stage,'archive/library.ceobe.json');
 if(await exists(stagedArchiveIndex)){
   const copy=stagedArchiveIndex+'.copy';
   await cp(stagedArchiveIndex,copy,{force:true});
   await rm(stagedArchiveIndex,{force:true});
   await rename(copy,stagedArchiveIndex);
 }
 const prepareMs=Date.now()-stageStarted;
 for(const name of ['library-stamps.json','decoration-stamps.json','asset-library-cache.json','timeline-summaries.json']){
  const source=join(sourceRoot,'data/private',name);
  if(await exists(source)){await mkdir(join(stage,'data/private'),{recursive:true});await cp(source,join(stage,'data/private',name))}
 }
 const buildStarted=Date.now();
 await run(stage,['scripts/build-library.mjs']);
 console.log(`Deletion stage: prepare ${(prepareMs/1000).toFixed(1)}s, build ${((Date.now()-buildStarted)/1000).toFixed(1)}s`);
 // 生产构建产物只在实际存在时才需要跟着更新；只用 dev 服务的用户不必为删除付这笔时间。
 // dist 不在这里重建：写操作只标记过期，npm run build 时再补。
}
// Windows 上本地服务会占用 replay/dist 的句柄，直接 rename 会 EPERM。
// 先短暂重试；仍失败时给出可执行的提示，而不是一句"操作失败"。
const renameWithRetry = async (from, to) => {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { await rename(from, to); return; }
    catch (error) {
      lastError = error;
      if (!['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(error.code)) break;
      await new Promise(done => setTimeout(done, 200 * (attempt + 1)));
    }
  }
  if (['EPERM', 'EBUSY', 'EACCES'].includes(lastError?.code)) {
    throw Object.assign(new Error('本地服务正在占用 replay/ 或 dist/，请先停止 npm run dev（或关闭本地服务）后再删除'), { status: 409 });
  }
  throw lastError;
};

// 本地服务会一直占用 replay/ 与 dist/：Windows 不允许重命名，但允许覆盖与删除其中的文件。
// 所以优先用重命名（快），被占用时退回"整份复制 + 剪枝"，保证开着服务也能删除。
const pruneToMatch = async (live, fresh) => {
  for (const name of await readdir(live)) {
    const a = join(live, name), b = join(fresh, name);
    if (!(await exists(b))) { await rm(a, { recursive: true, force: true }); continue; }
    const [sa, sb] = [await lstat(a), await lstat(b)];
    if (sa.isDirectory() && sb.isDirectory()) await pruneToMatch(a, b);
  }
};

const replaceTree = async (live, backupPath) => {
  const fresh = live; // 调用方传入的是"暂存目录中的同一路径"
  return { live, backupPath, fresh };
};

// replay is mostly a directory of generated files plus large content-addressed
// resources. Replacing the whole tree copies gigabytes even when only a page and
// two indexes changed. Diff it against the built stage, back up only changed or
// removed files, and leave unchanged resources alone.
const listFiles = async (root, relative = '') => {
  const files = new Map();
  if (!await exists(root)) return files;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const source = join(root, entry.name);
    const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      for (const [name, path] of await listFiles(source, nextRelative)) files.set(name, path);
    } else if (entry.isFile()) {
      files.set(nextRelative, source);
    }
  }
  return files;
};

const installReplayDelta = async (live, old, fresh) => {
  const [liveFiles, freshFiles] = await Promise.all([listFiles(live), listFiles(fresh)]);
  const changed = [], added = [], removed = [], backups = [];
  for (const [relative, freshPath] of freshFiles) {
    const livePath = liveFiles.get(relative);
    if (!livePath) { added.push({ relative, freshPath, livePath: join(live, relative) }); continue; }
    const [a, b] = await Promise.all([lstat(livePath), lstat(freshPath)]);
    if (a.ino && b.ino && a.ino === b.ino && a.dev === b.dev) continue;
    if (a.size !== b.size || a.mtimeMs !== b.mtimeMs) changed.push({ relative, freshPath, livePath });
  }
  for (const [relative, livePath] of liveFiles) {
    if (!freshFiles.has(relative)) removed.push({ relative, livePath, backupPath: join(old, relative) });
  }
  for (const item of [...changed, ...removed]) {
    const backupPath = join(old, item.relative);
    await mkdir(dirname(backupPath), { recursive: true });
    await cp(item.livePath, backupPath, { force: true });
    backups.push({ backupPath, livePath: item.livePath });
  }
  const write = async ({ freshPath, livePath }) => {
    await mkdir(dirname(livePath), { recursive: true });
    await cp(freshPath, livePath, { force: true });
  };
  const rollback = async () => {
    for (const { backupPath, livePath } of backups) {
      await mkdir(dirname(livePath), { recursive: true });
      await cp(backupPath, livePath, { force: true });
    }
    for (const { livePath } of added) await rm(livePath, { force: true });
  };
  try {
    for (const item of [...changed, ...added]) await write(item);
    for (const item of removed) await rm(item.livePath, { force: true });
  } catch (error) {
    await rollback();
    throw error;
  }
  return {
    hadOld: backups.length > 0,
    installed: changed.length + added.length + removed.length > 0,
    rollback,
  };
};

const installPath = async (live, old, fresh) => {
  const backup = async () => {
    if (!await exists(live)) return false;
    await mkdir(dirname(old), { recursive: true });
    try { await renameWithRetry(live, old); }
    catch (error) {
      if (error.status !== 409) throw error;
      await cp(live, old, { recursive: true });
    }
    return true;
  };
  const install = async () => {
    if (!await exists(fresh)) return false;
    await mkdir(dirname(live), { recursive: true });
    try { await renameWithRetry(fresh, live); }
    catch (error) {
      if (error.status !== 409) throw error;
      await cp(fresh, live, { recursive: true });
      await pruneToMatch(live, fresh);
    }
    return true;
  };
  const hadOld = await backup();
  const installed = await install();
  return { hadOld, installed };
};

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
    meta.items[body.id]={...meta.items[body.id],title};await atomic(join(root,'data/private/chats.ceobe.json'),meta);
    // The Markdown index is derived data: refresh it best-effort so titles stay current without a full rebuild.
    try{await writeChatIndexMarkdown(root,await list())}catch(e){console.error('Chat index:',e.message)}
    return {conversation:{...entry,title}};
   }
   if(body.action==='pin'){
    if(typeof body.pinned!=='boolean')throw failure('无效置顶状态');const pinned_at=body.pinned?(entry.pinned_at||new Date().toISOString()):null;
    meta.items[body.id]={...meta.items[body.id],pinned_at};await atomic(join(root,'data/private/chats.ceobe.json'),meta);return {conversation:{...entry,pinned_at}};
   }
   if(body.action!=='delete'||body.confirm!==body.id)throw failure('需要明确确认永久删除');
   // 会话可能来自分享归档，也可能是本地登录态采集（archive/chatgpt-web），两处都要找。
   const targetRoots=['archive/chatgpt-share','archive/chatgpt-web'].map(dir=>join(root,dir,body.id));
   for(const dir of targetRoots)if(relative(root,dir).startsWith('..'))throw failure('无效路径');
   // No reparse points are traversed. A nonstandard shared cross-archive path is
   // rejected rather than guessing whether its bytes may be removed.
   await assertSafeTree(join(root,'archive'));
   for(const dir of ['replay','dist'])if(await exists(join(root,dir)))await assertSafeTree(join(root,dir));
   const targets=[];
   for(const dir of targetRoots)if(await exists(dir))targets.push(dir);
   if(!targets.length)throw failure('原始归档目录不存在',409);
   const checkResources=async(dir)=>{for(const n of await readdir(dir,{withFileTypes:true})){const path=join(dir,n.name);if(n.isDirectory())await checkResources(path);else if(n.name==='conversation.ceobe.json'){const c=JSON.parse(await readFile(path,'utf8'));for(const r of c.resources||[]){if(!r.local_path)continue;const resolved=resolve(dirname(path),r.local_path);if(!resolved.startsWith(dirname(path)+requireSeparator()))throw failure('存在跨归档附件路径，需先检查共享资源，已取消删除',409)}}}};
   await checkResources(join(root,'archive/chatgpt-share'));
   const startedAt=Date.now();let rebuildMs=0;
   const job=join(root,'data/private/delete-jobs',randomUUID()),stage=join(job,'stage'),backup=join(job,'backup');await mkdir(stage,{recursive:true});await mkdir(backup);
   let committed=false,rollbackFailed=false;const moved=[];
   try{
    await cloneTree(join(root,'archive'),join(stage,'archive'),{hardlink:true,skip:targets});
    delete meta.items[body.id];await atomic(join(stage,'data/private/chats.ceobe.json'),meta);
    const projectFile=join(root,'data/private/projects.ceobe.json');
    if(await exists(projectFile)){const projects=JSON.parse(await readFile(projectFile,'utf8'));if(projects.kind!=='ceobe.projects'||!Array.isArray(projects.projects))throw new Error('项目文件格式错误');for(const p of projects.projects)p.conversation_ids=(p.conversation_ids||[]).filter(id=>id!==body.id);await atomic(join(stage,'data/private/projects.ceobe.json'),projects)}
    const bookmarkFile=join(root,'data/private/bookmarks.ceobe.json');
    if(await exists(bookmarkFile)){const bookmarks=await readBookmarkDocument(root);bookmarks.items=bookmarks.items.filter(b=>b.chat_id!==body.id);await atomic(join(stage,'data/private/bookmarks.ceobe.json'),bookmarks)}
    const rebuildStart=Date.now();await rebuild(stage,root);rebuildMs=Date.now()-rebuildStart;
    // Durable journal allows fail-closed manual recovery after a process/OS crash.
    await atomic(join(job,'journal.json'),{id:body.id,state:'prepared',paths:[]});
    const paths=[...(await exists(bookmarkFile)?['data/private/bookmarks.ceobe.json']:[]),...targets.map(dir=>relative(root,dir).replaceAll('\\','/')),'archive/library.ceobe.json',CHAT_INDEX_FILE,'data/private/chats.ceobe.json',...(await exists(join(stage,'data/private/decoration-stamps.json'))?['data/private/decoration-stamps.json']:[]),...(await exists(join(stage,'data/private/asset-library-cache.json'))?['data/private/asset-library-cache.json']:[]),...(await exists(projectFile)?['data/private/projects.ceobe.json']:[]),'replay'];
    for(const path of paths){
      const live=join(root,path),old=join(backup,path),fresh=join(stage,path);
      const item={path,hadOld:false,installed:false};
      if(path==='replay'){
        const result=await installReplayDelta(live,old,fresh);
        item.hadOld=result.hadOld;item.installed=result.installed;item.rollback=result.rollback;
      }else{
        const result=await installPath(live,old,fresh);
        item.hadOld=result.hadOld;item.installed=result.installed;
      }
      moved.push(item);
      await atomic(join(job,'journal.json'),{id:body.id,state:'committing',paths:moved.map(({path,hadOld,installed})=>({path,hadOld,installed}))});
    }
    committed=true;
    // Success is not returned while raw archives or old generated copies remain.
    await rm(job,{recursive:true});await markDistStale(root,'delete');
    console.log(`Chat delete: ${body.id} took ${((Date.now()-startedAt)/1000).toFixed(1)}s (rebuild ${(rebuildMs/1000).toFixed(1)}s)`);
    return {deleted:body.id,redirect:'./index.html'};
   }catch(e){
    if(!committed){try{for(const item of moved.reverse()){if(item.rollback){await item.rollback();continue}const live=join(root,item.path);if(item.installed)await rm(live,{recursive:true,force:true});if(item.hadOld){await mkdir(dirname(live),{recursive:true});try{await renameWithRetry(join(backup,item.path),live)}catch(error){if(error.status!==409)throw error;await cp(join(backup,item.path),live,{recursive:true})}}}}catch{rollbackFailed=true}}
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
