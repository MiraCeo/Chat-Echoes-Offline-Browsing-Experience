import{readFile,realpath}from'node:fs/promises';import{resolve,join,relative,isAbsolute}from'node:path';
import{createChatStore}from'./chat-store.mjs';import{createProjectStore}from'./project-store.mjs';import{exportConversationMarkdown}from'./export-conversation-markdown.mjs';import{markdownFilename}from'./markdown-filename.js';
const inside=(base,file)=>{const rel=relative(base,file);return rel!==''&&!rel.startsWith('..')&&!isAbsolute(rel)};
// 下载通道默认输出“Obsidian 就绪”的 Markdown：frontmatter + `$` 数学 + 文末来源；
// 附件仍然是纯文本语义（textOnly），不会写出可点的本地附件链接。
export async function readMarkdownEntry(root,entry,{project=''}={}){
 const id=entry.id;if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(id||''))throw Object.assign(Error('无效聊天 ID'),{status:400});
 const projectRoot=await realpath(root),archive=await realpath(join(root,'archive/chatgpt-share')),folder=await realpath(join(archive,id)),file=await realpath(resolve(root,entry.conversation_path));
 if(!inside(projectRoot,archive)||!inside(archive,folder)||!inside(folder,file))throw Object.assign(Error('归档路径异常，已拒绝导出'),{status:409});
 const conversation=JSON.parse(await readFile(file,'utf8'));conversation.title=entry.title;conversation.id=entry.id;
 return {title:entry.title,filename:markdownFilename(entry.title),markdown:exportConversationMarkdown(conversation,{textOnly:true,timestamps:true,frontmatter:true,math:true,sources:true,project})};
}
export function markdownExportMiddleware(root){const store=createChatStore(root);const projects=createProjectStore(join(root,'data/private/projects.ceobe.json'));return async(req,res,next)=>{
 const url=new URL(req.url,'http://localhost');if(url.pathname!=='/api/chats/export-md')return next();
 const send=(status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(data))};
 try{
  if(req.method!=='GET')return send(405,{error:'仅支持 GET'});
  if(req.headers['sec-fetch-site']==='cross-site'||req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return send(403,{error:'不允许跨站读取归档'});
  const id=url.searchParams.get('id');if(!id||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(id))return send(400,{error:'无效聊天 ID'});
  const entry=(await store.list()).find(c=>c.id===id);if(!entry)return send(404,{error:'聊天不存在或已删除'});
  // 项目名只用于 frontmatter；项目文件缺失或损坏不应让导出失败。
  const project=(await projects.list().catch(()=>[])).find(item=>(item.conversation_ids||[]).includes(id))?.name||'';
     return send(200,await readMarkdownEntry(root,entry,{project}));}catch(e){console.error('Markdown export:',e.message);return send(e.status||(e.code==='ENOENT'?404:500),{error:e.code==='ENOENT'?'聊天归档不存在或已删除':'导出失败，请检查本地归档和服务日志'})}
}}
