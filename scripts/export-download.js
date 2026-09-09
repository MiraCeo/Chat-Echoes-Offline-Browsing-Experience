import {markdownFilename} from './markdown-filename.js';
let busy=false,timer;
function tell(text){const node=document.getElementById('ceobe-chat-status');if(!node)return;node.textContent=text;node.hidden=false;clearTimeout(timer);timer=setTimeout(()=>node.hidden=true,7000)}
export async function saveArchive(kind,id,title){if(busy||!id)return;busy=true;let writable;const zip=kind==='zip',extension=zip?'.zip':'.md',mime=zip?'application/zip':'text/markdown',suggested=markdownFilename(title||(zip?'项目':'聊天')).slice(0,-3)+extension;
 try{const handle=typeof window.showSaveFilePicker==='function'&&window.isSecureContext?await window.showSaveFilePicker({id:'ceobe-'+kind+'-export',suggestedName:suggested,excludeAcceptAllOption:true,types:[{description:zip?'项目 Markdown 压缩包':'Markdown 纯文本',accept:{[mime]:[extension]}}]}):null;
  tell(zip?'正在打包项目内全部 Markdown…':'正在准备 Markdown…');const response=await fetch('/api/'+(zip?'projects/export-zip':'chats/export-md')+'?id='+encodeURIComponent(id),{cache:'no-store',signal:AbortSignal.timeout(zip?120000:30000)});let blob,filename;
  if(zip){if(!response.ok||!response.headers.get('Content-Type')?.includes('application/zip')){const error=await response.json().catch(()=>null);throw Error(error?.error||'无法生成 ZIP，请使用本地服务')}blob=await response.blob();filename=decodeURIComponent(response.headers.get('X-CEOBE-Filename')||encodeURIComponent(suggested))}
  else{const data=await response.json().catch(()=>null);if(!response.ok||typeof data?.markdown!=='string')throw Error(data?.error||'无法生成 Markdown，请使用本地服务');blob=new Blob([data.markdown],{type:mime+';charset=utf-8'});filename=markdownFilename(data.title||title)}
  if(handle){writable=await handle.createWritable();await writable.write(blob);await writable.close();writable=null;tell((zip?'ZIP':'Markdown')+' 已保存。')}
  else{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);tell('已交给浏览器下载 '+(zip?'ZIP':'Markdown')+'，保存位置由浏览器设置决定。')}
 }catch(e){if(writable)try{await writable.abort?.()}catch{}tell(e.name==='AbortError'?'已取消转存。':'转存失败：'+(e.message||'请稍后重试。'))}finally{busy=false}
}
