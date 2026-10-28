import { markDistStale } from './dist-stale.mjs';
import {readFile,writeFile,mkdir,rename,rm,cp,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {acquireMutation} from './workspace-mutation.mjs';
import {assertSafeTree} from './chat-store.mjs';
import {createThrottle} from './import-throttle.mjs';
import {findSource} from './sources/registry.mjs';
import { CAPTURE_PACKAGE_FORMAT, CAPTURE_PACKAGE_VERSION } from './share-package-format.mjs';
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
// 浏览器扩展的来源白名单：只认扩展 scheme（Chromium 系 / Firefox / Safari Web Extension），
// 不认普通网站。扩展直连本地服务必须走这里，不能靠放宽 same-origin 判断。
export const isTrustedExtensionOrigin=origin=>typeof origin==='string'&&/^(?:chrome|moz|safari-web)-extension:\/\/[a-z0-9._-]+$/i.test(origin);
const summarize=log=>{
 const lines=String(log||'').split('\n').map(l=>l.trim()).filter(Boolean);
 const key=lines.filter(l=>/fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|Error|Traceback|失败/i.test(l)).at(-1);
 return (key||lines.at(-1)||'未知错误').replace(/\s+/g,' ').slice(0,180);
};

export const runLocal=(root,args)=>new Promise((yes,no)=>{const child=spawn(process.execPath,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';for(const s of [child.stdout,child.stderr])s.on('data',b=>log=(log+b).slice(-16000));child.on('error',no);child.on('close',code=>code===0?yes():no(new Error(log||'本地生成进程失败')))});
async function exists(p){try{await lstat(p);return true}catch(e){if(e.code==='ENOENT')return false;throw e}}
async function atomic(file,data){const tmp=file+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,JSON.stringify(data,null,2));await rename(tmp,file)}finally{await rm(tmp,{force:true})}}
export async function publishProduction(root){
 const token=randomUUID(),stage=join(root,'data/private/publish-'+token),dest=join(root,'dist'),backup=join(root,'data/private/previous-dist-'+token);let moved=false;
 try{
  await markDistStale(root, 'import');
  if(await exists(dest)){await assertSafeTree(dest);if(await exists(join(dest,'assets')))await cp(join(dest,'assets'),join(stage,'assets'),{recursive:true,force:false,errorOnExist:false});await rename(dest,backup);moved=true}
  try{await rename(stage,dest)}catch(e){if(moved){await rename(backup,dest);moved=false}throw e}
  if(moved)await rm(backup,{recursive:true,force:true}).catch(()=>{});
 }finally{await rm(stage,{recursive:true,force:true}).catch(()=>{})}
}
export function localImportMiddleware(root,{mode='development',archive=url=>runLocal(root,['scripts/archive-share.mjs',url,'--skip-library']),rebuild=()=>runLocal(root,['scripts/build-library.mjs']),publish=()=>publishProduction(root),throttle=createThrottle()}={}){
 root=resolve(root);
 return async(req,res,next)=>{
  const path=req.url.split('?')[0];if(!['/api/capabilities','/api/archive-share','/api/archive-package'].includes(path))return next();
  const send=(code,data)=>{res.statusCode=code;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(data))};
  let release,record,file;
  try{
   const origin=req.headers.origin,trustedExtension=isTrustedExtensionOrigin(origin);
   if(trustedExtension){
    res.setHeader('Access-Control-Allow-Origin',origin);
    res.setHeader('Vary','Origin');
    res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','Content-Type');
    res.setHeader('Access-Control-Max-Age','600');
   }
   // 扩展的 application/zip 会先发 OPTIONS 预检；只有白名单里的扩展 scheme 可以跨源。
   if(req.method==='OPTIONS'){
    if(!trustedExtension)throw bad('仅扩展可以跨源预检',403);
    res.statusCode=204;res.setHeader('Content-Length','0');return res.end();
   }
   const sameOrigin=!origin||(()=>{try{return new URL(origin).host===req.headers.host}catch{return false}})();
   if(req.headers['sec-fetch-site']==='cross-site'&&!trustedExtension)throw bad('不允许跨站操作',403);
   if(!trustedExtension&&!sameOrigin)throw bad('不允许跨站操作',403);
   if(path==='/api/capabilities'){if(req.method!=='GET')throw bad('仅支持 GET',405);return send(200,{mode,importShare:true,packageFormat:CAPTURE_PACKAGE_FORMAT,packageVersion:CAPTURE_PACKAGE_VERSION})}
   if(req.method!=='POST')throw bad('仅支持 POST',405);
   if(path==='/api/archive-package'){
   if(!/^(application\/zip|application\/octet-stream)(?:;|$)/i.test(req.headers['content-type']||''))throw bad('需要 zip 文件',415);
   release=await acquireMutation(root);
   try{
    const parts=[];let total=0;for await(const chunk of req){total+=chunk.length;if(total>200*1024*1024)throw bad('采集包超过 200 MB',413);parts.push(chunk)}
    const dir=join(root,'data/private/import-packages');await mkdir(dir,{recursive:true});
    const zip=join(dir,randomUUID()+'.zip');await writeFile(zip,Buffer.concat(parts));
    const log=await new Promise((yes,no)=>{const child=spawn(process.execPath,['scripts/import-share-package.mjs','--input',zip],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='';for(const stream of [child.stdout,child.stderr])stream.on('data',b=>out=(out+b).slice(-20000));child.on('error',no);child.on('close',code=>code===0?yes(out):no(new Error(out||'采集包导入失败')))});
    await rm(zip,{force:true});
    const id=(/SHARE_ID=([a-f0-9-]{36})/i.exec(log)||[])[1];if(!id)throw Error('采集包已导入，但未能确定会话标识');
    await runLocal(root,['scripts/build-library.mjs','--only',id]);
    const library=JSON.parse(await readFile(join(root,'archive/library.ceobe.json'),'utf8')),entry=library.conversations?.find(c=>c.id===id);
    if(!entry)throw Error('已归档，但索引中没有该会话');
    return send(200,{ok:true,shareId:id,title:entry.title,messageCount:entry.message_count,turnCount:entry.turn_count,resourceCounts:entry.resource_counts,page:'/conversations/'+id+'.html'});
   }catch(e){if(!e.status)e.status=422;throw e}
   finally{await release();release=null}
  }
if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw bad('需要 JSON 请求',415);
   let size=0;const chunks=[];for await(const b of req){size+=b.length;if(size>4096)throw bad('请求内容过大',413);chunks.push(b)}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw bad('无效 JSON')}
   let url;try{url=new URL(body?.url)}catch{throw bad('请输入公开的 ChatGPT 分享链接')}
   const source=findSource(url);
   if(!source||!source.isValidId(source.shareId(url)))throw bad(source?.message||'请输入公开的 ChatGPT 分享链接');url.search='';url.hash='';
   if(typeof body.requestId!=='string'||!/^[a-f0-9-]{36}$/i.test(body.requestId))throw bad('缺少有效的导入请求标识，请刷新后重试');
   // 限流闸门放在拿工作区锁之前：等待间隔时不占着锁。
   const rateLimited=gate=>{const retry=Math.max(0,Math.round(Number(gate.retryAfter)||0));res.setHeader('Retry-After',String(retry));return send(429,{
     error:(gate.reason==='failure-ratio'?'最近多次导入失败，已暂停本批（避免继续触发风控）。':'分享页限流，已暂停本批导入。')
       +(retry?`建议 ${Math.max(1,Math.ceil(retry/60))} 分钟后再试。`:''),
     stop:true,reason:gate.reason,retryAfter:retry})};
   const gate=await throttle.beforeRequest();if(gate?.stop)return rateLimited({reason:gate.reason,retryAfter:(gate.retryAfterMs||0)/1000});
   release=await acquireMutation(root);const dir=join(root,'data/private/import-jobs');await mkdir(dir,{recursive:true});file=join(dir,body.requestId+'.json');
   if(await exists(file)){record=JSON.parse(await readFile(file,'utf8'));if(record.url!==url.href)throw bad('请求标识与链接不一致',409);if(record.state==='complete')return send(200,record.result);if(record.state==='capturing')throw bad('上次归档状态未确认，请先检查本地导入记录，不会重复抓取',409)}
   else record={url:url.href,state:'new',created_at:new Date().toISOString()};
   if(!record.captured){
    record.state='capturing';await atomic(file,record);
    try{await archive(url.href);throttle.afterResponse({status:200})}
    catch(e){
     const marker=/RATE_LIMITED retryAfter=(\d+)/i.exec(String(e.message||''));
     const decision=throttle.afterResponse({status:marker?429:422,retryAfterSeconds:marker?Number(marker[1]):0});
     record.state='capture-failed';await atomic(file,record);
     // 被限流：本条没有归档，整批就此暂停，剩下的链接留给下次。
     if(marker)return rateLimited({stop:decision?.stop===true,reason:'rate-limit',retryAfter:Number(marker[1])});
     throw e;
    }
    record.captured=true;record.state='captured';await atomic(file,record);
   }
   record.state='publishing';await atomic(file,record);await rebuild();
   const id=source.shareId(url),library=JSON.parse(await readFile(join(root,'archive/library.ceobe.json'),'utf8')),entry=library.conversations?.find(c=>c.id===id);if(!entry)throw Error('归档已保存，但索引中没有该会话');
   if(mode==='production')await publish();
   const result={ok:true,shareId:id,title:entry.title,messageCount:entry.message_count,turnCount:entry.turn_count,userTurnCount:entry.user_turn_count,assistantTurnCount:entry.assistant_turn_count,resourceCounts:entry.resource_counts,page:'/conversations/'+id+'.html'};
   record.state='complete';record.result=result;await atomic(file,record);return send(200,result);
  }catch(e){console.error('Local import:',e.message);return send(e.status||500,{error:e.status?e.message:record?.captured?'归档已保存，但页面更新失败。重试只更新页面，不重复抓取。':
    '导入未完成：' + summarize(e.message),archived:!!record?.captured,retryPublish:!!record?.captured})}
  finally{if(release)await release()}
 };
}
