import {readFile,writeFile,mkdir,rename,rm,cp,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {acquireMutation} from './workspace-mutation.mjs';
import {assertSafeTree} from './chat-store.mjs';
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
export const runLocal=(root,args)=>new Promise((yes,no)=>{const child=spawn(process.execPath,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';for(const s of [child.stdout,child.stderr])s.on('data',b=>log=(log+b).slice(-16000));child.on('error',no);child.on('close',code=>code===0?yes():no(new Error(log||'本地生成进程失败')))});
async function exists(p){try{await lstat(p);return true}catch(e){if(e.code==='ENOENT')return false;throw e}}
async function atomic(file,data){const tmp=file+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,JSON.stringify(data,null,2));await rename(tmp,file)}finally{await rm(tmp,{force:true})}}
export async function publishProduction(root){
 const token=randomUUID(),stage=join(root,'data/private/publish-'+token),dest=join(root,'dist'),backup=join(root,'data/private/previous-dist-'+token);let moved=false;
 try{
  await runLocal(root,[resolve(import.meta.dirname,'../node_modules/vite/bin/vite.js'),'build','replay','--config','vite.config.mjs','--outDir',stage,'--emptyOutDir']);
  if(await exists(dest)){await assertSafeTree(dest);if(await exists(join(dest,'assets')))await cp(join(dest,'assets'),join(stage,'assets'),{recursive:true,force:false,errorOnExist:false});await rename(dest,backup);moved=true}
  try{await rename(stage,dest)}catch(e){if(moved){await rename(backup,dest);moved=false}throw e}
  if(moved)await rm(backup,{recursive:true,force:true}).catch(()=>{});
 }finally{await rm(stage,{recursive:true,force:true}).catch(()=>{})}
}
export function localImportMiddleware(root,{mode='development',archive=url=>runLocal(root,['scripts/archive-share.mjs',url,'--skip-library']),rebuild=()=>runLocal(root,['scripts/build-library.mjs']),publish=()=>publishProduction(root)}={}){
 root=resolve(root);
 return async(req,res,next)=>{
  const path=req.url.split('?')[0];if(!['/api/capabilities','/api/archive-share'].includes(path))return next();
  const send=(code,data)=>{res.statusCode=code;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(data))};
  let release,record,file;
  try{
   if(req.headers['sec-fetch-site']==='cross-site'||req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)throw bad('不允许跨站操作',403);
   if(path==='/api/capabilities'){if(req.method!=='GET')throw bad('仅支持 GET',405);return send(200,{mode,importShare:true})}
   if(req.method!=='POST')throw bad('仅支持 POST',405);
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw bad('需要 JSON 请求',415);
   let size=0;const chunks=[];for await(const b of req){size+=b.length;if(size>4096)throw bad('请求内容过大',413);chunks.push(b)}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw bad('无效 JSON')}
   let url;try{url=new URL(body?.url)}catch{throw bad('请输入公开的 ChatGPT 分享链接')}
   if(url.protocol!=='https:'||url.hostname!=='chatgpt.com'||url.port||url.username||url.password||!/^\/share\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\/?$/i.test(url.pathname))throw bad('请输入公开的 ChatGPT 分享链接');url.search='';url.hash='';
   if(typeof body.requestId!=='string'||!/^[a-f0-9-]{36}$/i.test(body.requestId))throw bad('缺少有效的导入请求标识，请刷新后重试');
   release=await acquireMutation(root);const dir=join(root,'data/private/import-jobs');await mkdir(dir,{recursive:true});file=join(dir,body.requestId+'.json');
   if(await exists(file)){record=JSON.parse(await readFile(file,'utf8'));if(record.url!==url.href)throw bad('请求标识与链接不一致',409);if(record.state==='complete')return send(200,record.result);if(record.state==='capturing')throw bad('上次归档状态未确认，请先检查本地导入记录，不会重复抓取',409)}
   else record={url:url.href,state:'new',created_at:new Date().toISOString()};
   if(!record.captured){record.state='capturing';await atomic(file,record);try{await archive(url.href)}catch(e){record.state='capture-failed';await atomic(file,record);throw e}record.captured=true;record.state='captured';await atomic(file,record)}
   record.state='publishing';await atomic(file,record);await rebuild();
   const id=url.pathname.split('/')[2],library=JSON.parse(await readFile(join(root,'archive/library.ceobe.json'),'utf8')),entry=library.conversations?.find(c=>c.id===id);if(!entry)throw Error('归档已保存，但索引中没有该会话');
   if(mode==='production')await publish();
   const result={ok:true,shareId:id,title:entry.title,messageCount:entry.message_count,turnCount:entry.turn_count,userTurnCount:entry.user_turn_count,assistantTurnCount:entry.assistant_turn_count,resourceCounts:entry.resource_counts,page:'/conversations/'+id+'.html'};
   record.state='complete';record.result=result;await atomic(file,record);return send(200,result);
  }catch(e){console.error('Local import:',e.message);return send(e.status||500,{error:e.status?e.message:record?.captured?'归档已保存，但页面更新失败。重试只更新页面，不重复抓取。':'导入未完成，请检查分享链接、网络和本地服务日志。',archived:!!record?.captured,retryPublish:!!record?.captured})}
  finally{if(release)await release()}
 };
}
