import {saveArchive,openChatFolder} from './export-download.js';
// Keep handlers scoped when Vite concatenates this module with legacy reader scripts.
(() => {
const menu=document.querySelector('[data-ceobe-chat-menu]'),sub=document.querySelector('[data-ceobe-chat-submenu]');
const move=menu.querySelector('[data-chat-action=move]'),list=sub.querySelector('[data-chat-project-list]'),status=document.getElementById('ceobe-chat-status');
const layouts=JSON.parse(document.getElementById('ceobe-chat-layout').textContent);
const root=new URL(location.pathname.includes('/conversations/')?'../':'./',location.href);
let trigger=null,generation=0,busy=false,timer;
function tell(text){status.textContent=text;status.hidden=false;clearTimeout(timer);timer=setTimeout(()=>status.hidden=true,6000)}
function saveMarkdown(id,title){return saveArchive('md',id,title)}
function entries(panel){return [...panel.querySelectorAll('[role=menuitem]')]}
function visible(panel){return entries(panel).filter(e=>e.checkVisibility())}
function highlight(panel,item){for(const e of entries(panel))e.toggleAttribute('data-highlighted',e===item)}
function place(panel,rect,side=false){
 const layout=layouts[side?1:0],wrapper=panel.parentElement;
 panel.hidden=false;wrapper.hidden=false;panel.dataset.state='open';
 const s=wrapper.style;s.setProperty('--radix-popper-anchor-width',rect.width+'px');s.setProperty('--radix-popper-anchor-height',rect.height+'px');
 // Preserve the official wrapper's sizing mode and menu's CSS-variable relationships.
 // The offsets are read from the supplied measurements, never from screenshots.
 const x=(side?rect.right:rect.left)+layout.offset.x;
  let y=(side?rect.top:rect.bottom)+layout.offset.y,placement=layout.side;
  // Measure before constraining height, otherwise a bottom-edge popup looks
  // artificially short and never flips. Live Edge: top menu bottom is anchor.top + 4.333333px.
  s.setProperty('--radix-popper-available-height',innerHeight+'px');
  if(!side){
   const height=wrapper.getBoundingClientRect().height,above=Math.max(0,rect.top+4.333333),below=Math.max(0,innerHeight-y);
   if(height>below&&above>below){placement='top';y=above-Math.min(height,above)}
  }
 s.setProperty('--radix-popper-available-width',Math.max(0,side?innerWidth-x:innerWidth)+'px');
 s.setProperty('--radix-popper-available-height',Math.max(0,side?innerHeight:placement==='top'?rect.top+4.333333:innerHeight-y)+'px');
 s.transform=`translate(${x}px, ${y}px)`;
 panel.dataset.side=placement;panel.dataset.align=layout.align;
 // Keep oversized popups reachable after selecting a side. Submenu behavior is unchanged.
 const bounds=wrapper.getBoundingClientRect();
 if(bounds.right>innerWidth||bounds.bottom>innerHeight||x<0||y<0){
  s.transform=`translate(${Math.max(0,Math.min(x,innerWidth-bounds.width))}px, ${Math.max(0,Math.min(y,innerHeight-bounds.height))}px)`;
 }
}
function hide(panel){panel.hidden=true;panel.parentElement.hidden=true;panel.dataset.state='closed';highlight(panel,null)}
function closeSub(){generation++;hide(sub);move.setAttribute('aria-expanded','false');move.dataset.state='closed'}
function close(focus=true){closeSub();hide(menu);if(trigger){trigger.setAttribute('aria-expanded','false');trigger.dataset.state='closed';if(focus)trigger.focus()}trigger=null}
document.addEventListener('ceobe:close-chat-menu',()=>close(false));
function clearProjects(){for(const e of list.querySelectorAll('[data-chat-project-container]'))e.remove()}
async function openSub(focus=false){
 if(!trigger)return;const token=++generation;move.setAttribute('aria-expanded','true');move.dataset.state='open';
 clearProjects();sub.setAttribute('aria-busy','true');place(sub,move.getBoundingClientRect(),true);
 if(focus)entries(sub)[0].focus();
 try{
  const r=await fetch(new URL('api/projects',root),{cache:'no-store'}),data=await r.json();
  if(!r.ok||!Array.isArray(data.projects)||!data.writable)throw new Error();if(token!==generation)return;
  for(const [i,p] of data.projects.entries()){
   const container=document.getElementById('ceobe-chat-project-row').content.firstElementChild.cloneNode(true);
   if(i>0)container.querySelector('[role=separator]')?.remove();
   const row=container.querySelector('[role=menuitem]');row.dataset.chatProject=p.id;row.tabIndex=-1;row.querySelector('.truncate').textContent=p.name;
   const box=row.querySelector('[data-testid=project-folder-icon]');
   const image=[...document.querySelectorAll('#ceobe-chat-icon-bank [data-chat-icon]')].find(e=>e.dataset.chatIcon===p.icon)||document.querySelector('#ceobe-chat-icon-bank [data-chat-icon=folder]');
   // Keep the official project's SVG wrapper/attributes; only its symbol and user color change.
   const svg=box.querySelector('svg');svg.querySelector('use').setAttribute('href',image.querySelector('use').getAttribute('href'));
   svg.setAttribute('aria-label',image.getAttribute('aria-label')||p.icon);
   if(p.color!=='default')box.style.color=p.color;else box.removeAttribute('style');
   if(p.conversation_ids?.includes(trigger.dataset.ceobeChatId)){row.dataset.chatCurrent='';row.title='当前所属项目'}
   list.append(container);
  }
  if(!data.projects.length)tell('还没有本地项目，可通过“新项目”进入项目页创建。');
  place(sub,move.getBoundingClientRect(),true);
 }catch{if(token===generation)tell('项目服务不可用，无法读取或移动聊天。请使用本地开发或预览服务。')}
 finally{if(token===generation)sub.removeAttribute('aria-busy')}
}
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-ceobe-chat-id]');if(!b)return;e.preventDefault();e.stopPropagation();
 document.dispatchEvent(new Event('ceobe:close-reader-more'));if(trigger===b){close();return}close(false);trigger=b;b.setAttribute('aria-expanded','true');b.dataset.state='open';
 const pinItem=menu.querySelector('[data-chat-action=pin]');for(const node of pinItem.childNodes)if(node.nodeType===3&&node.textContent.trim())node.textContent=b.dataset.chatPinned==='true'?'取消置顶聊天':'置顶聊天';
 menu.setAttribute('aria-labelledby',b.id);place(menu,b.getBoundingClientRect());
 // Pointer opening focuses the menu container, not an artificially highlighted first row.
 if(e.detail===0)visible(menu)[0].focus();else menu.focus({preventScroll:true});
},true);
move.addEventListener('pointerenter',()=>{if(sub.hidden)openSub()});move.addEventListener('click',()=>openSub(true));
menu.addEventListener('pointerover',e=>{const item=e.target.closest('[data-chat-action]');if(item&&item!==move)closeSub()});
menu.addEventListener('click',e=>{const item=e.target.closest('[data-chat-action]');if(item&&item!==move){if(item.dataset.chatAction==='export-md'){const id=trigger?.dataset.ceobeChatId,title=trigger?.closest('li')?.querySelector('._NCija_content, a .font-medium')?.textContent||'聊天';close(false);saveMarkdown(id,title)}else if(item.dataset.chatAction==='open-folder'){const id=trigger?.dataset.ceobeChatId;close(false);openChatFolder(id)}else if(['rename','delete','pin'].includes(item.dataset.chatAction)){const id=trigger?.dataset.ceobeChatId,opener=trigger;close(false);document.dispatchEvent(new CustomEvent('ceobe:chat-action',{detail:{id,opener,action:item.dataset.chatAction}}))}else tell('“'+item.textContent.trim()+'”暂未接入本地归档，本次未修改聊天。')}});
sub.querySelector('[data-chat-new-project]').addEventListener('click',()=>{const detail={opener:trigger,conversationId:trigger?.dataset.ceobeChatId};close(false);document.dispatchEvent(new CustomEvent('ceobe:open-project',{detail}))});
list.addEventListener('click',async e=>{
 const row=e.target.closest('[data-chat-project]');if(!row||!trigger||busy)return;e.preventDefault();
 const id=trigger.dataset.ceobeChatId;busy=true;sub.setAttribute('aria-busy','true');
 try{const r=await fetch(new URL('api/projects/move',root),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId:id,projectId:row.dataset.chatProject})});
  const data=await r.json();if(!r.ok)throw new Error(data.error||'移动失败');
  tell('已移至“'+data.project.name+'”。本地项目关联已保存，原始聊天归档保持不变。');close();document.dispatchEvent(new Event('ceobe:project-moved'));
 }catch(err){tell(err instanceof TypeError?'连接失败，未确认移动成功，请重试。':err.message)}finally{busy=false;sub.removeAttribute('aria-busy')}
});
for(const panel of [menu,sub]){
 panel.addEventListener('pointermove',e=>{const item=e.target.closest('[role=menuitem]');if(item&&panel.contains(item))highlight(panel,item)});
 panel.addEventListener('pointerleave',()=>highlight(panel,null));
 panel.addEventListener('focusin',e=>highlight(panel,e.target.closest('[role=menuitem]')));
 panel.addEventListener('keydown',e=>{
  const items=visible(panel),i=items.indexOf(document.activeElement);
  if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();items[e.key==='Home'?0:e.key==='End'?items.length-1:i<0?(e.key==='ArrowDown'?0:items.length-1):(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus()}
  else if(e.key==='Escape'){e.preventDefault();if(panel===sub){closeSub();move.focus()}else close()}
  else if(e.key==='ArrowRight'&&document.activeElement===move){e.preventDefault();openSub(true)}
  else if(e.key==='ArrowLeft'&&panel===sub){e.preventDefault();closeSub();move.focus()}
  else if(e.key==='Enter'||e.key===' '){const item=document.activeElement.closest('[role=menuitem]');if(item){e.preventDefault();item.click()}}
  else if(e.key==='Tab')close(false);
 });
}
document.addEventListener('focusin',e=>{if(trigger&&!menu.contains(e.target)&&!sub.contains(e.target)&&e.target!==trigger)close(false)});
document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target)&&!sub.contains(e.target)&&!e.target.closest('[data-ceobe-chat-id]'))close(false)});
window.addEventListener('resize',()=>close(false));document.addEventListener('scroll',e=>{if(!menu.contains(e.target)&&!sub.contains(e.target))close(false)},true);
})();
