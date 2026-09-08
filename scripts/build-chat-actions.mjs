import {readFile,writeFile,copyFile,readdir} from 'node:fs/promises';import{join}from'node:path';import{createHash}from'node:crypto';import{parseHTML}from'linkedom';import{htmlSafeSvg}from'./serialize-html.mjs';
export async function buildChatActions(root,library){
 const base=join(root,'replay'),f=JSON.parse(await readFile(join(root,'official-templates/chat-actions.json'),'utf8'));
 const pinButton=JSON.parse(await readFile(join(root,'official-templates/chat-pin-button.json'),'utf8')).button;
  const projectPage=parseHTML(await readFile(join(base,'projects.html'),'utf8')).document;
 const pages=(await readdir(base)).filter(s=>s.endsWith('.html')).concat((await readdir(join(base,'conversations'))).filter(s=>s.endsWith('.html')).map(s=>'conversations/'+s));
 const assets={};for(const name of ['chat-actions.js','chat-actions.css']){const b=await readFile(join(root,'scripts',name));await writeFile(join(base,name),b);assets[name]=name+'?v='+createHash('sha256').update(b).digest('hex').slice(0,12)}
 for(const file of f.stylesheets)await copyFile(join(root,'official-templates/assets',file),join(base,'assets',file));
 for(const page of pages){
  const prefix=page.startsWith('conversations/')?'../':'./',d=parseHTML(await readFile(join(base,page),'utf8')).document;
  for(const b of d.querySelectorAll('[data-ceobe-chat-id]')){const pin=parseHTML(pinButton).document.querySelector('button');pin.dataset.chatUnpin=b.dataset.ceobeChatId;pin.setAttribute('aria-label','置顶 '+b.closest('a').getAttribute('aria-label'));pin.querySelector('use').setAttribute('href',prefix+'cdn/assets/sprites-shell-097001e7.svg#pin-sm');b.before(pin)}
   const modal=parseHTML(f.delete).document.querySelector('[data-testid=modal-delete-conversation-confirmation]');modal.dataset.chatDelete='';modal.hidden=true;modal.querySelector('strong').textContent='';
  const note=modal.querySelector('.text-token-text-tertiary');note.replaceChildren();note.textContent='将永久删除本地全部归档版本和阅读页面，并清除项目关联。此操作无法撤销。';note.setAttribute('role','status');
  modal.querySelector('[role=dialog]').setAttribute('aria-modal','true');
  d.body.append(modal);
  const section=parseHTML(f.pinnedSection).document.querySelector('div');const row=section.querySelector('li').cloneNode(true);section.querySelector('ul').replaceChildren();section.dataset.chatPinnedSection='';section.hidden=true;
  const recent=[...d.querySelectorAll('[data-ceobe-chat-id]')].map(e=>e.closest('li')).find(Boolean)?.parentElement;
  if(recent){recent.dataset.chatRecentList='';const block=recent.closest('.group\\/sidebar-expando-section')||recent.parentElement;block.before(section)}
  for(const [id,html]of [['ceobe-rename-row',f.rename],['ceobe-pinned-row',row.outerHTML]]){const t=d.createElement(id==='ceobe-pinned-row'?'div':'template');t.id=id;t.hidden=true;t.innerHTML=html;if(id==='ceobe-pinned-row')for(const use of t.querySelectorAll('use')){const h=use.getAttribute('href');use.setAttribute('href',prefix+'cdn/assets/'+(h.includes('sprites-shell')?'sprites-shell-097001e7.svg':'sprites-core-26c3f2d4.svg')+'#'+h.split('#')[1])}d.body.append(t)}
  const data=d.createElement('script');data.type='application/json';data.id='ceobe-chat-catalog';data.textContent=JSON.stringify(library.conversations).replaceAll('<','\\u003c');d.body.append(data);
  // Use the SAME already-built creation dialog and client, not an iframe/navigation.
  if(!d.querySelector('[data-project-modal]')){
   for(const selector of ['[data-project-modal]','[data-project-picker]','#ceobe-project-icons','#ceobe-projects-data'])d.body.append(projectPage.querySelector(selector).cloneNode(true));
   for(const e of projectPage.querySelectorAll('link[rel=stylesheet]')){const href=e.getAttribute('href');if(!href.includes('projects.css')&&!href.includes('assets/'))continue;const url=prefix+href.replace(/^\.\//,'');if([...d.querySelectorAll('link[rel=stylesheet]')].some(l=>l.getAttribute('href')===url))continue;const l=e.cloneNode(true);l.href=url;d.head.append(l)}
   const script=projectPage.querySelector('script[src*="projects.js"]').cloneNode(true);script.src=prefix+script.getAttribute('src').replace(/^\.\//,'');d.body.append(script);
  }
  for(const use of d.querySelectorAll('[data-chat-delete] use,[data-chat-pinned-section] use,[data-project-modal] use,[data-project-picker] use')){const h=use.getAttribute('href');use.setAttribute('href',prefix+'cdn/assets/'+(h.includes('sprites-shell')?'sprites-shell-097001e7.svg':'sprites-core-26c3f2d4.svg')+'#'+h.split('#')[1])}
  for(const file of f.stylesheets){const l=d.createElement('link');l.rel='stylesheet';l.href=prefix+'assets/'+file;d.head.append(l)}
  for(const name of ['chat-actions.css','chat-actions.js']){const e=d.createElement(name.endsWith('.css')?'link':'script');if(name.endsWith('.css')){e.rel='stylesheet';e.href=prefix+assets[name];d.head.append(e)}else{e.type='module';e.src=prefix+assets[name];d.body.append(e)}}
  await writeFile(join(base,page),'<!DOCTYPE html>\n'+htmlSafeSvg(d.documentElement.outerHTML));
 }
}
