import {readFile,writeFile,copyFile,readdir} from 'node:fs/promises';import{join}from'node:path';import{createHash}from'node:crypto';import{parseHTML}from'linkedom';import{htmlSafeSvg}from'./serialize-html.mjs';
import {applyProjectLabel} from './sidebar-project-label.js';
import {removeInjected,ensureStylesheet,placeStylesheet,placeScript} from './page-decoration.mjs';
// 侧栏行模板：抹掉这一行的会话身份（活动态、标题、id、置顶/菜单目标），
// 浏览器按 replay/chats.json 复制它生成每一行（见 chat-actions.js）。
function sidebarRowTemplate(li){
 const row=li.cloneNode(true),link=row.querySelector('a[data-sidebar-item]')||row;
 for(const attr of ['data-active','aria-current'])link.removeAttribute(attr);
 link.setAttribute('href','#main');link.setAttribute('aria-label','');
 for(const label of row.querySelectorAll('._NCija_content'))label.textContent='';
 const marquee=row.querySelector('._NCija_viewport'),host=marquee?.closest('div.truncate');
 if(row.querySelector('[data-sidebar-project-name]')&&host&&marquee){host.replaceChildren(marquee);marquee.removeAttribute('data-marquee-overflowing')}
 for(const button of row.querySelectorAll('button')){
  for(const attr of ['data-chat-unpin','data-ceobe-chat-id','data-chat-pinned','id','data-testid'])button.removeAttribute(attr);
  button.setAttribute('aria-label',button.hasAttribute('data-conversation-options-trigger')?'对话选项':'置顶');
 }
 return row.outerHTML;
}
export async function buildChatActions(root,library,pageCache=null,selected=null){
 const base=join(root,'replay'),f=JSON.parse(await readFile(join(root,'official-templates/chat-actions.json'),'utf8'));
 const pinButton=JSON.parse(await readFile(join(root,'official-templates/chat-pin-button.json'),'utf8')).button;
  const projectPage=parseHTML(await readFile(join(base,'projects.html'),'utf8')).document;
 const labelHTML=JSON.parse(await readFile(join(root,'official-templates/sidebar-project-label.json'),'utf8')).block;
 const projects=JSON.parse(projectPage.getElementById('ceobe-projects-data').textContent);
 await copyFile(join(root,'scripts/sidebar-project-label.js'),join(base,'sidebar-project-label.js'));
 const pages=selected??(await readdir(base)).filter(s=>s.endsWith('.html')).concat((await readdir(join(base,'conversations'))).filter(s=>s.endsWith('.html')).map(s=>'conversations/'+s));
 const assets={};for(const name of ['chat-actions.js','chat-actions.css']){const b=await readFile(join(root,'scripts',name));await writeFile(join(base,name),b);assets[name]=name+'?v='+createHash('sha256').update(b).digest('hex').slice(0,12)}
 for(const file of f.stylesheets)await copyFile(join(root,'official-templates/assets',file),join(base,'assets',file));
 for(const page of pages){
  const prefix=page.startsWith('conversations/')?'../':'./',d=pageCache?await pageCache.load(page):parseHTML(await readFile(join(base,page),'utf8')).document;
  // 幂等：先删掉本步骤上一次注入的节点与自己的资源引用，再重新注入。
  // 不这样做的话，每次重建都会多出一份弹窗/模板/样式表，删除一个会话就会改写每一页。
  removeInjected(d,['#ceobe-sidebar-project-label','#ceobe-sidebar-chat-row','[data-chat-delete]','[data-chat-pinned-section]','#ceobe-rename-row','#ceobe-pinned-row']);
  const labelTemplate=d.createElement('template');labelTemplate.id='ceobe-sidebar-project-label';labelTemplate.innerHTML=labelHTML;d.body.append(labelTemplate);
   for(const b of d.querySelectorAll('[data-ceobe-chat-id]')){
    // 标题只取自档案索引，不用 anchor 上已有的 aria-label：否则同一页“首次装饰”和“再次装饰”
    // 会因为标签里已经带了项目注解而产生不同字节（重渲染后页面就变了）。
    const c=library.conversations.find(item=>item.id===b.dataset.ceobeChatId),p=projects.find(item=>item.conversation_ids?.includes(c?.id));
    const title=c?.title||b.closest('a').getAttribute('aria-label')||'';
    const pin=parseHTML(pinButton).document.querySelector('button');pin.dataset.chatUnpin=b.dataset.ceobeChatId;pin.setAttribute('aria-label','置顶 '+title);pin.querySelector('use').setAttribute('href',prefix+'cdn/assets/sprites-shell-097001e7.svg#pin-sm');b.before(pin);
    if(c)applyProjectLabel(b.closest('li'),c.title,p,labelTemplate.content.firstElementChild)
   }
    const modal=parseHTML(f.delete).document.querySelector('[data-testid=modal-delete-conversation-confirmation]');modal.dataset.chatDelete='';modal.hidden=true;modal.querySelector('strong').textContent='';
  const note=modal.querySelector('.text-token-text-tertiary');note.replaceChildren();note.textContent='将永久删除本地全部归档版本和阅读页面，并清除项目关联。此操作无法撤销。';note.setAttribute('role','status');
  modal.querySelector('[role=dialog]').setAttribute('aria-modal','true');
  d.body.append(modal);
  const section=parseHTML(f.pinnedSection).document.querySelector('div');const row=section.querySelector('li').cloneNode(true);section.querySelector('ul').replaceChildren();section.dataset.chatPinnedSection='';section.hidden=true;
  const recent=[...d.querySelectorAll('[data-ceobe-chat-id]')].map(e=>e.closest('li')).find(Boolean)?.parentElement;
  if(recent){recent.dataset.chatRecentList='';const block=recent.closest('.group\\/sidebar-expando-section')||recent.parentElement;block.before(section)}
  // 页面里只保留当前会话那一行；其余会话只在 replay/chats.json 里出现一次。
  // 把那一行做成行模板，浏览器按清单复制出每一行（chat-actions.js）。
  const listRow=recent?.querySelector('li');
  if(listRow){const rowTemplate=d.createElement('template');rowTemplate.id='ceobe-sidebar-chat-row';rowTemplate.innerHTML=sidebarRowTemplate(listRow);d.body.append(rowTemplate)}
  for(const [id,html]of [['ceobe-rename-row',f.rename],['ceobe-pinned-row',row.outerHTML]]){const t=d.createElement(id==='ceobe-pinned-row'?'div':'template');t.id=id;t.hidden=true;t.innerHTML=html;if(id==='ceobe-pinned-row')for(const use of t.querySelectorAll('use')){const h=use.getAttribute('href');use.setAttribute('href',prefix+'cdn/assets/'+(h.includes('sprites-shell')?'sprites-shell-097001e7.svg':'sprites-core-26c3f2d4.svg')+'#'+h.split('#')[1])}d.body.append(t)}
  // 这里原本内嵌 #ceobe-chat-catalog（全部会话 JSON）。它让每一页都随会话增删而变，
  // 现在浏览器只取 replay/chats.json；页面里不再有任何“全部会话”的数据块。
  // Use the SAME already-built creation dialog and client, not an iframe/navigation.
  if(!d.querySelector('[data-project-modal]')){
   for(const selector of ['[data-project-modal]','[data-project-picker]','#ceobe-project-icons','#ceobe-projects-data'])d.body.append(projectPage.querySelector(selector).cloneNode(true));
   for(const e of projectPage.querySelectorAll('link[rel=stylesheet]')){const href=e.getAttribute('href');if(!href.includes('projects.css')&&!href.includes('assets/'))continue;const url=prefix+href.replace(/^\.\//,'');if([...d.querySelectorAll('link[rel=stylesheet]')].some(l=>l.getAttribute('href')===url))continue;const l=e.cloneNode(true);l.href=url;l.dataset.ceobeProjectStyle='';d.head.append(l)}
   const script=projectPage.querySelector('script[src*="projects.js"]').cloneNode(true);script.src=prefix+script.getAttribute('src').replace(/^\.\//,'');script.dataset.ceobeProjectScript='';d.body.append(script);
  }
  for(const use of d.querySelectorAll('[data-chat-delete] use,[data-chat-pinned-section] use,[data-project-modal] use,[data-project-picker] use')){const h=use.getAttribute('href');use.setAttribute('href',prefix+'cdn/assets/'+(h.includes('sprites-shell')?'sprites-shell-097001e7.svg':'sprites-core-26c3f2d4.svg')+'#'+h.split('#')[1])}
  for(const file of f.stylesheets)ensureStylesheet(d,prefix+'assets/'+file);
  placeStylesheet(d,'chat-actions.css',prefix+assets['chat-actions.css']);
  placeScript(d,'chat-actions',prefix+assets['chat-actions.js']);
  if(pageCache)pageCache.markDirty(page);else await writeFile(join(base,page),'<!DOCTYPE html>\n'+htmlSafeSvg(d.documentElement.outerHTML));
 }
}
