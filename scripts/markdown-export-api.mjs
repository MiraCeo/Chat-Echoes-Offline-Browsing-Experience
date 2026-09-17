import{readFile,realpath}from'node:fs/promises';import{resolve,join,relative,isAbsolute}from'node:path';
import{createChatStore}from'./chat-store.mjs';import{exportConversationMarkdown}from'./export-conversation-markdown.mjs';import{markdownFilename}from'./markdown-filename.js';
const inside=(base,file)=>{const rel=relative(base,file);return rel!==''&&!rel.startsWith('..')&&!isAbsolute(rel)};
export async function readMarkdownEntry(root,entry){
 const id=entry.id;if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(id||''))throw Object.assign(Error('无效聊天 ID'),{status:400});
 const project=await realpath(root),archive=await realpath(join(root,'archive/chatgpt-share')),folder=await realpath(join(archive,id)),file=await realpath(resolve(root,entry.conversation_path));
 if(!inside(project,archive)||!inside(archive,folder)||!inside(folder,file))throw Object.assign(Error('归档路径异常，已拒绝导出'),{status:409});
 const conversation=JSON.parse(await readFile(file,'utf8'));conversation.title=entry.title;
 return {title:entry.title,filename:markdownFilename(entry.title),markdown:exportConversationMarkdown(conversation,{textOnly:true})};
}
export function markdownExportMiddleware(root){const store=createChatStore(root);return async(req,res,next)=>{
 const url=new URL(req.url,'http://localhost');if(url.pathname!=='/api/chats/export-md')return next();
 const send=(status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(data))};
 try{
  if(req.method!=='GET')return send(405,{error:'仅支持 GET'});
  if(req.headers['sec-fetch-site']==='cross-site'||req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return send(403,{error:'不允许跨站读取归档'});
  const id=url.searchParams.get('id');if(!id||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(id))return send(400,{error:'无效聊天 ID'});
  const entry=(await store.list()).find(c=>c.id===id);if(!entry)return send(404,{error:'聊天不存在或已删除'});
     return send(200,await readMarkdownEntry(root,entry));}catch(e){console.error('Markdown export:',e.message);return send(e.status||(e.code==='ENOENT'?404:500),{error:e.code==='ENOENT'?'聊天归档不存在或已删除':'导出失败，请检查本地归档和服务日志'})}
}}
