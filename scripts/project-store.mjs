import {acquireMutation} from './workspace-mutation.mjs';
import {readFile,writeFile,mkdir,rename,unlink} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
export const PROJECT_ICONS=['folder','currency-dollar','book','graduation-cap','edit','writing','function','terminal','music','popcorn','customize','palette','stethoscope','health','lotus','suitcase','bar-chart','kettlebell','dumbbell','logs','scale','desk-globe','plane','globe','wrench','paw','flask','brain','heart','plant'];
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
export function createProjectStore(file){
 let queue=Promise.resolve();
 async function list(){
  let text;try{text=await readFile(file,'utf8')}catch(e){if(e.code==='ENOENT')return [];throw e}
  const data=JSON.parse(text);if(data.kind!=='ceobe.projects'||!Array.isArray(data.projects))throw new Error('项目数据文件格式异常，未覆盖原文件');
  return data.projects.sort((a,b)=>String(b.pinned_at||'').localeCompare(String(a.pinned_at||''))||String(b.created_at||'').localeCompare(String(a.created_at||'')));
 }
 function create(body){
  const work=queue.then(async()=>{
   if(typeof body?.name!=='string')throw bad('请输入项目名称');
   const name=body.name.trim().normalize('NFC');
   if(!name||[...name].length>80||/[\x00-\x1f\x7f]/.test(name))throw bad('项目名称须为 1–80 个字符，不能包含控制字符');
   const color=body.color||'default',icon=body.icon||'folder';
   if(color!=='default'&&!/^#[a-f0-9]{6}$/i.test(color))throw bad('颜色须为六位十六进制色值');
   if(!PROJECT_ICONS.includes(icon))throw bad('无效项目图标');
   const projects=await list();
   if(body.requestId&&projects.some(p=>p.request_id===body.requestId))return projects.find(p=>p.request_id===body.requestId);
   if(projects.some(p=>p.name.toLocaleLowerCase()===name.toLocaleLowerCase()))throw bad('已存在同名项目，请换一个名称',409);
   const now=new Date().toISOString();
   const project={id:randomUUID(),name,icon,color:color.toLowerCase(),description:'',created_at:now,updated_at:now,conversation_ids:[],...(typeof body.requestId==='string'&&/^[\w-]{1,80}$/.test(body.requestId)?{request_id:body.requestId}:{})};
   await mkdir(dirname(file),{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';
   try{await writeFile(tmp,JSON.stringify({schema_version:'1.0.0',kind:'ceobe.projects',projects:[project,...projects]},null,2),'utf8');await rename(tmp,file)}finally{await unlink(tmp).catch(()=>{})}
   return project;
  });queue=work.catch(()=>{});return work;
 }
  function move(conversationId,projectId){
   const work=queue.then(async()=>{
    const projects=await list(),project=projects.find(p=>p.id===projectId);if(!project)throw bad("项目不存在",404);
    for(const p of projects){const ids=p.conversation_ids||[];p.conversation_ids=ids.filter(id=>id!==conversationId);if(p.id===projectId)p.conversation_ids.push(conversationId);if(ids.includes(conversationId)||p.id===projectId)p.updated_at=new Date().toISOString()}
    const tmp=file+"."+randomUUID()+".tmp";try{await writeFile(tmp,JSON.stringify({schema_version:"1.0.0",kind:"ceobe.projects",projects},null,2));await rename(tmp,file)}finally{await unlink(tmp).catch(()=>{})}return project;
   });queue=work.catch(()=>{});return work;
  }
  function mutate(body){
   const work=queue.then(async()=>{
    if(typeof body?.id!=='string'||!/^[a-f0-9-]{36}$/i.test(body.id))throw bad('无效项目 ID');
    const projects=await list(),project=projects.find(p=>p.id===body.id);if(!project)throw bad('项目不存在',404);
    if(body.action==='rename'){
     if(typeof body.name!=='string')throw bad('请输入项目名称');const name=body.name.trim().normalize('NFC');
     if(!name||[...name].length>80||/[\x00-\x1f\x7f]/.test(name))throw bad('项目名称须为 1–80 个字符，不能包含控制字符');
     if(projects.some(p=>p.id!==project.id&&p.name.toLocaleLowerCase()===name.toLocaleLowerCase()))throw bad('已存在同名项目，请换一个名称',409);project.name=name;
    }else if(body.action==='appearance'){
     if(typeof body.icon!=='string'||!PROJECT_ICONS.includes(body.icon))throw bad('无效项目图标');
     if(typeof body.color!=='string'||body.color!=='default'&&!/^#[a-f0-9]{6}$/i.test(body.color))throw bad('颜色须为 default 或六位十六进制色值');
     if(typeof body.previousIcon!=='string'||typeof body.previousColor!=='string')throw bad('缺少图标与颜色版本，请重新打开选择器');
     if(body.previousIcon!==(project.icon||'folder')||body.previousColor!==(project.color||'default'))throw bad('图标或颜色已在其他窗口更新；请重新打开设置后再修改',409);
     project.icon=body.icon;project.color=body.color.toLowerCase();
    }else if(body.action==='sources-add'||body.action==='sources-remove'){
     throw bad('项目文件现按聊天自动汇总，不再支持手动关联；请刷新页面',410);
    }else if(body.action==='description'){
     if(typeof body.description!=='string'||body.description.length>4000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body.description))throw bad('项目简介须为不超过 4000 个字符的纯文本');
     if(typeof body.previousDescription!=='string')throw bad('缺少项目简介版本，请重新打开设置');
     if(body.previousDescription!==(project.description??''))throw bad('项目简介已在其他窗口更新；请保留当前草稿，重新打开设置后合并修改',409);
     project.description=body.description.replace(/\r\n?/g,'\n');
    }else if(body.action==='pin'){
     if(typeof body.pinned!=='boolean')throw bad('无效置顶状态');project.pinned_at=body.pinned?(project.pinned_at||new Date().toISOString()):null;
    }else if(body.action==='delete'){
     if(body.confirm!==body.id)throw bad('需要明确确认删除项目');projects.splice(projects.indexOf(project),1);
    }else throw bad('无效项目操作');
    project.updated_at=new Date().toISOString();const tmp=file+'.'+randomUUID()+'.tmp';
    try{await writeFile(tmp,JSON.stringify({schema_version:'1.0.0',kind:'ceobe.projects',projects},null,2),'utf8');await rename(tmp,file)}finally{await unlink(tmp).catch(()=>{})}
    return body.action==='delete'?{deleted:project.id,conversationsPreserved:true}:{project};
   });queue=work.catch(()=>{});return work;
  }
  return {list,create,move,mutate};
}
export function projectsMiddleware(root){
 const store=createProjectStore(join(root,'data/private/projects.ceobe.json'));
 return async(req,res,next)=>{
   const path=req.url.split('?')[0];if(!['/api/projects','/api/projects/move','/api/projects/action'].includes(path))return next();
  const send=(status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(data))};
  let release;try{
    if(req.method==='GET'&&path==='/api/projects')return send(200,{projects:await store.list(),writable:true});
   if(req.method!=='POST')return send(405,{error:'仅支持 GET 和 POST'});
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return send(415,{error:'需要 JSON 请求'});
   if(req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host))return send(403,{error:'不允许跨站创建项目'});
   const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>(path==='/api/projects/action'?65536:4096))throw bad('请求内容过大',413);chunks.push(chunk)}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw bad('无效 JSON')}
    release=await acquireMutation(root);
     if(path==='/api/projects/action'){const result=await store.mutate(body);await release();release=null;return send(200,result);}
    if(path==='/api/projects/move'){
     if(typeof body?.conversationId!=='string'||typeof body?.projectId!=='string')throw bad('无效聊天或项目');
     const library=JSON.parse(await readFile(join(root,'archive/library.ceobe.json'),'utf8'));
     if(!library.conversations.some(c=>c.id===body.conversationId))throw bad('聊天不在本地资料库中',404);
     const project=await store.move(body.conversationId,body.projectId);await release();release=null;return send(200,{project});
    }
    const project=await store.create(body);await release();release=null;send(201,{project});
  }catch(e){send(e.status||500,{error:e.status?e.message:'项目数据读取或保存失败，原数据未被覆盖，请检查本地服务'})}finally{if(release)await release()}
 };
}
