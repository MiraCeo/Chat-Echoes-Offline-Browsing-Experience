import{realpath,stat}from'node:fs/promises';import{resolve,join,relative,isAbsolute,dirname}from'node:path';import{spawn}from'node:child_process';
import{createChatStore}from'./chat-store.mjs';
const inside=(base,file)=>{const rel=relative(base,file);return rel!==''&&!rel.startsWith('..')&&!isAbsolute(rel)};
// Resolve the capture folder that holds a chat's archive (conversation.ceobe.json, conversation.md, assets/, raw/).
// The same containment checks as the Markdown export: the folder must be a real directory under archive/chatgpt-share/<id>/.
export async function resolveChatFolder(root,entry){
 const id=entry.id;if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(id||''))throw Object.assign(Error('无效聊天 ID'),{status:400});
 if(typeof entry.conversation_path!=='string'||!entry.conversation_path)throw Object.assign(Error('聊天归档路径缺失'),{status:409});
 const project=await realpath(root),archive=await realpath(join(root,'archive/chatgpt-share')),share=await realpath(join(archive,id)),folder=await realpath(dirname(resolve(root,entry.conversation_path)));
 if(!inside(project,archive)||!inside(archive,share)||!(folder===share||inside(share,folder)))throw Object.assign(Error('归档路径异常，已拒绝打开'),{status:409});
 if(!(await stat(folder)).isDirectory())throw Object.assign(Error('归档目录不存在'),{status:404});
 return folder;
}
// Windows: explorer.exe <folder>. Other platforms report unsupported rather than guessing at a file manager.
export function defaultOpener(folder){
 if(process.platform!=='win32')throw Object.assign(Error('仅支持在 Windows 上打开本地文件夹'),{status:501});
 return new Promise((yes,no)=>{const child=spawn('explorer.exe',[folder],{windowsHide:false,detached:true,stdio:'ignore'});child.on('error',no);child.on('spawn',()=>{child.unref();yes()})});
}
export function openFolderMiddleware(root,{open=defaultOpener}={}){const store=createChatStore(root);return async(req,res,next)=>{
 const url=new URL(req.url,'http://localhost');if(url.pathname!=='/api/chats/open-folder')return next();
 const send=(status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(data))};
 try{
  if(req.method!=='POST')return send(405,{error:'仅支持 POST'});
  if(req.headers['sec-fetch-site']==='cross-site'||req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return send(403,{error:'不允许跨站打开本地文件夹'});
  const id=url.searchParams.get('id');if(!id||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(id))return send(400,{error:'无效聊天 ID'});
  const entry=(await store.list()).find(c=>c.id===id);if(!entry)return send(404,{error:'聊天不存在或已删除'});
  const folder=await resolveChatFolder(root,entry);await open(folder);
  return send(200,{opened:true,folder:relative(root,folder).replaceAll('\\','/')});
 }catch(e){console.error('Open folder:',e.message);return send(e.status||(e.code==='ENOENT'?404:500),{error:e.status?e.message:e.code==='ENOENT'?'聊天归档不存在或已删除':'打开文件夹失败，请检查本地归档和服务日志'})}
}}
